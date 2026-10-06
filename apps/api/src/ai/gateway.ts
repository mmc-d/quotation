/**
 * AI gateway (module 12 §3.1). Every model call in Core goes through `runAi`:
 *  - permission `ai.use`;
 *  - PII redaction of every free-text input before it leaves Core (`redactPii`);
 *  - a daily budget per tenant (AI_DAILY_USD, default 20) checked against today's ai_call sum;
 *  - one append-only ai_call row per call (ok | error | blocked | sandbox), written in its own
 *    transaction so it survives a rollback of the caller's work.
 * The model call itself runs outside any DB transaction (no connection held for a minute).
 */
import { HttpStatus } from '@nestjs/common';
import { aiCall, sql } from '@mmc/db';
import { redactPii } from '@mmc/domain';
import type { RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { AiError, aiConfig, costUsd, mapSdkError, type AiUsage, type LiveResult } from './claude.js';

const SUMMARY_MAX = 2048;

export interface AiRequest<I extends Record<string, string>, T> {
  /** e.g. 'boq' | 'reply' | 'translate' */
  feature: string;
  /** free-text inputs; each is redacted before reaching `live` / `sandbox` / the log */
  input: I;
  /** short description of the non-text parameters for the log (no personal data) */
  meta?: Record<string, unknown>;
  /** deterministic result without the API (no key + sandbox allowed) */
  sandbox: (input: I) => T | Promise<T>;
  /** the real call (prompts in ./prompts) */
  live: (input: I) => Promise<LiveResult<T>>;
  /** what to keep in ai_call.output (defaults to the result) */
  logOutput?: (result: T) => unknown;
}

export interface AiResponse<T> { result: T; callId: string; sandbox: boolean; model: string; costUsd: number }

/** Riyadh-day start, the budget window. */
const TODAY = sql`(date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh')`;

export async function spentTodayUsd(tenantId: string): Promise<number> {
  return tenantTx(tenantId, async (tx) => {
    const [r] = await tx.select({ usd: sql<string>`coalesce(sum(${aiCall.costUsd}), 0)` }).from(aiCall).where(sql`${aiCall.createdAt} >= ${TODAY}`);
    return Number(r?.usd ?? 0);
  });
}

export function summarize(input: Record<string, string>, meta?: Record<string, unknown>): string {
  const s = JSON.stringify({ ...(meta ?? {}), ...input });
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s;
}

/** Append-only log (the app role has INSERT + SELECT only on ai_call). */
export async function logAiCall(actor: RequestActor, row: {
  feature: string; model: string; provider?: string; status: 'ok' | 'error' | 'blocked' | 'sandbox'; usage?: AiUsage | null; costUsd?: number | null;
  inputSummary?: string | null; output?: unknown; error?: string | null; latencyMs?: number | null;
}): Promise<string> {
  return tenantTx(actor.tenantId, async (tx) => {
    const [r] = await tx.insert(aiCall).values({
      userId: actor.userId,
      feature: row.feature,
      provider: row.provider ?? 'anthropic',
      model: row.model,
      inputTokens: row.usage ? row.usage.inputTokens + row.usage.cacheReadTokens + row.usage.cacheWriteTokens : null,
      outputTokens: row.usage?.outputTokens ?? null,
      costUsd: row.costUsd != null ? row.costUsd.toFixed(6) : null,
      status: row.status,
      inputSummary: row.inputSummary ? redactPii(row.inputSummary).slice(0, SUMMARY_MAX) : null,
      output: row.output ?? null,
      error: row.error?.slice(0, 1000) ?? null,
      latencyMs: row.latencyMs ?? null,
    }).returning({ id: aiCall.id });
    return r!.id;
  });
}

export async function runAi<I extends Record<string, string>, T>(actor: RequestActor, req: AiRequest<I, T>): Promise<AiResponse<T>> {
  const input = Object.fromEntries(Object.entries(req.input).map(([k, v]) => [k, redactPii(v ?? '')])) as I;
  const inputSummary = summarize(input, req.meta);
  const model = aiConfig.model;
  if (!actor.grants['ai.use']) {
    await logAiCall(actor, { feature: req.feature, model, status: 'blocked', inputSummary, error: 'missing permission: ai.use' });
    throw new AiError('forbidden', 'missing permission: ai.use', HttpStatus.FORBIDDEN);
  }
  const sandbox = aiConfig.sandbox;
  if (!sandbox && !aiConfig.hasKey) {
    await logAiCall(actor, { feature: req.feature, model, status: 'blocked', inputSummary, error: 'ANTHROPIC_API_KEY not set' });
    throw new AiError('ai_not_configured', 'AI is not configured on this server', HttpStatus.SERVICE_UNAVAILABLE);
  }
  const budget = aiConfig.dailyUsd;
  const spent = await spentTodayUsd(actor.tenantId);
  if (spent >= budget) {
    await logAiCall(actor, { feature: req.feature, model, status: 'blocked', inputSummary, error: `daily AI budget reached (${spent.toFixed(2)} / ${budget} USD)` });
    throw new AiError('ai_budget_exceeded', `today's AI budget (${budget} USD) is used up — it resets at midnight Riyadh time`, HttpStatus.TOO_MANY_REQUESTS);
  }
  const started = Date.now();
  if (sandbox) {
    const result = await req.sandbox(input);
    const callId = await logAiCall(actor, { feature: req.feature, model: 'sandbox', status: 'sandbox', usage: null, costUsd: 0, inputSummary, output: (req.logOutput ?? ((x) => x))(result), latencyMs: Date.now() - started });
    return { result, callId, sandbox: true, model: 'sandbox', costUsd: 0 };
  }
  try {
    const r = await req.live(input);
    const usd = costUsd(r.model, r.usage);
    const callId = await logAiCall(actor, {
      feature: req.feature, model: r.model, status: 'ok', usage: r.usage, costUsd: usd, inputSummary,
      output: { result: (req.logOutput ?? ((x) => x))(r.result), cache: { readTokens: r.usage.cacheReadTokens, writeTokens: r.usage.cacheWriteTokens } },
      latencyMs: Date.now() - started,
    });
    return { result: r.result, callId, sandbox: false, model: r.model, costUsd: usd };
  } catch (e) {
    const err = mapSdkError(e);
    const usd = err.usage ? costUsd(err.model ?? model, err.usage) : null;
    await logAiCall(actor, { feature: req.feature, model: err.model ?? model, status: 'error', usage: err.usage ?? null, costUsd: usd, inputSummary, error: `${err.code}: ${err.message}`, latencyMs: Date.now() - started });
    throw err;
  }
}
