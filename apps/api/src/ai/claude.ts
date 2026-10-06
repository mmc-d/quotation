/**
 * The only place that talks to the Claude API (module 12 §3.1: model/provider abstraction).
 * Everything else goes through `runAi` in gateway.ts, which adds permission, budget, PII redaction
 * and the append-only ai_call log.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod';
import { HttpException, HttpStatus } from '@nestjs/common';
import { config } from '../config.js';

export type Effort = 'low' | 'medium' | 'high';

/** Read per call so ops (and tests) can change them without a restart of the module graph. */
export const aiConfig = {
  get model() { return process.env.AI_MODEL?.trim() || 'claude-opus-5-5'; },
  get dailyUsd() { const raw = process.env.AI_DAILY_USD?.trim(); const v = raw ? Number(raw) : 20; return Number.isFinite(v) && v >= 0 ? v : 20; },
  get hasKey() { return !!process.env.ANTHROPIC_API_KEY?.trim(); },
  /** No API key → deterministic sandbox results (never in production without ALLOW_SANDBOX). */
  get sandbox() { return !this.hasKey && config.allowSandbox; },
};

/** USD per 1M tokens. Cache writes are billed at 1.25× input (5-minute TTL), reads at the listed rate. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWriteFactor: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWriteFactor: 1.25 },
};

export interface AiUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }

export function costUsd(model: string, u: AiUsage): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5']!;
  const usd = (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.input * p.cacheWriteFactor) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

function usageOf(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined): AiUsage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // reads ANTHROPIC_API_KEY; the SDK already retries 429/5xx with backoff
  client ??= new Anthropic({ maxRetries: 3, timeout: 120_000 });
  return client;
}

/** A failure the gateway logs as status 'error' and returns to the caller with an HTTP status. */
export class AiError extends HttpException {
  /** tokens billed even though the call failed (refusal, truncation, unparsable output) */
  usage?: AiUsage;
  model?: string;
  constructor(readonly code: string, message: string, status: number) {
    super({ error: code, message }, status);
  }
}

/** SDK errors → HTTP errors, most specific first. Never string-matches messages. */
export function mapSdkError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.RateLimitError) return new AiError('ai_rate_limited', 'the AI provider is busy — try again in a minute', HttpStatus.TOO_MANY_REQUESTS);
  if (e instanceof Anthropic.AuthenticationError) return new AiError('ai_not_configured', 'the AI provider rejected the API key', HttpStatus.SERVICE_UNAVAILABLE);
  if (e instanceof Anthropic.BadRequestError) return new AiError('ai_bad_request', 'the AI request was rejected by the provider', HttpStatus.BAD_GATEWAY);
  if (e instanceof Anthropic.APIConnectionError) return new AiError('ai_unreachable', 'the AI provider could not be reached', HttpStatus.GATEWAY_TIMEOUT);
  if (e instanceof Anthropic.APIError) return new AiError('ai_provider_error', `the AI provider failed (${e.status ?? 'no status'})`, HttpStatus.BAD_GATEWAY);
  return new AiError('ai_error', (e as Error)?.message ?? 'AI call failed', HttpStatus.BAD_GATEWAY);
}

function billed(e: AiError, usage: AiUsage, model: string): AiError {
  e.usage = usage;
  e.model = model;
  return e;
}

/** stop_reason before content: refusal → 422 (with the policy category), truncation → 502. */
function checkStop(stop: string | null, details: { category?: string | null } | null | undefined, usage: AiUsage, model: string) {
  if (stop === 'refusal') throw billed(new AiError('ai_refused', `the model declined this request${details?.category ? ` (${details.category})` : ''}`, HttpStatus.UNPROCESSABLE_ENTITY), usage, model);
  if (stop === 'max_tokens' || stop === 'model_context_window_exceeded') throw billed(new AiError('ai_truncated', 'the AI answer was cut off — try a smaller input', HttpStatus.BAD_GATEWAY), usage, model);
}

export interface LiveResult<T> { result: T; usage: AiUsage; model: string }

/**
 * Free text (reply drafting, translation). Beta endpoint so a refusal can fall back server-side
 * to the model's default fallback chain.
 */
export async function claudeText(p: { system: string; user: string; effort: Effort; maxTokens: number }): Promise<LiveResult<string>> {
  const model = aiConfig.model;
  const res = await getClient().beta.messages.create({
    model,
    max_tokens: p.maxTokens,
    system: p.system,
    messages: [{ role: 'user', content: p.user }],
    output_config: { effort: p.effort },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  const usage = usageOf(res.usage);
  checkStop(res.stop_reason, res.stop_details, usage, res.model || model);
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  if (!text) throw billed(new AiError('ai_empty', 'the model returned no text', HttpStatus.BAD_GATEWAY), usage, res.model || model);
  return { result: text, usage, model: res.model || model };
}

/**
 * Structured JSON validated against a zod schema. `cachedSystem` is the large frozen context
 * (e.g. the catalog) marked for prompt caching; volatile input goes in `content`.
 * No server-side fallbacks here: the stable `messages.parse` path does not take them.
 */
export async function claudeParsed<T>(p: {
  system: string;
  cachedSystem?: string;
  content: Anthropic.MessageParam['content'];
  schema: ZodType<T>;
  effort: Effort;
  maxTokens: number;
}): Promise<LiveResult<T>> {
  const model = aiConfig.model;
  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: p.system }];
  if (p.cachedSystem) system.push({ type: 'text', text: p.cachedSystem, cache_control: { type: 'ephemeral' } });
  const res = await getClient().messages.parse({
    model,
    max_tokens: p.maxTokens,
    system,
    messages: [{ role: 'user', content: p.content }],
    output_config: { format: zodOutputFormat(p.schema), effort: p.effort },
  });
  const usage = usageOf(res.usage);
  checkStop(res.stop_reason, res.stop_details, usage, res.model || model);
  if (res.parsed_output == null) throw billed(new AiError('ai_unparsable', 'the AI answer did not match the expected format', HttpStatus.BAD_GATEWAY), usage, res.model || model);
  return { result: res.parsed_output as T, usage, model: res.model || model };
}
