/**
 * AI-06 read-only MCP server at POST /api/mcp (Streamable HTTP, stateless, JSON responses).
 *
 * Auth: `Authorization: Bearer mmc_pat_…` (a personal access token from Settings → AI). The token's
 * SHA-256 is resolved with tenant_for_api_token(), then the app user is loaded with the SAME code as
 * the session guard (loadActor). Each tool calls the existing REST handler for that data, so the
 * permission (@Perm equivalent) and record-scope checks are identical to the API; outputs are
 * whitelisted and cost/margin fields are removed unless the user holds the cost permission.
 * Cookies are never accepted here (no CSRF surface); every tool call is logged in ai_call.
 */
import { Controller, Delete, Get, HttpException, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { and, apiToken, eq, inArray, isNull, product, sql } from '@mmc/db';
import { fromHalalas, type Permission } from '@mmc/domain';
import { Public, type RequestActor } from '../auth/actor.js';
import { loadActor, mfaBlocked } from '../auth/auth.guard.js';
import { getDb, tenantTx } from '../common/db.js';
import { ContractsController } from '../modules/contracts.controller.js';
import { FieldServiceController } from '../modules/field-service.controller.js';
import { FinanceController } from '../modules/finance.controller.js';
import { InventoryController } from '../modules/inventory.controller.js';
import { PartiesController } from '../modules/parties.controller.js';
import { ProjectsController } from '../modules/projects.controller.js';
import { QuotesController } from '../modules/quotes.controller.js';
import { hashToken, TOKEN_PREFIX } from './ai.service.js';
import { logAiCall, summarize } from './gateway.js';

const OUTPUT_MAX = 60_000;
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Bearer token → actor (null = 401). Updates lastUsedAt. */
export async function actorFromToken(req: Request): Promise<RequestActor | null> {
  const h = req.headers.authorization ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (!m || !m[1]!.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashToken(m[1]!);
  const rows = await getDb().execute<{ tenant_id: string; user_id: string }>(sql`select * from tenant_for_api_token(${hash})`);
  const link = rows[0];
  if (!link) return null;
  const ok = await tenantTx(link.tenant_id, async (tx) => {
    const [t] = await tx.update(apiToken).set({ lastUsedAt: new Date() })
      .where(and(eq(apiToken.tokenHash, hash), isNull(apiToken.revokedAt), sql`${apiToken.expiresAt} > now()`)).returning({ scopes: apiToken.scopes });
    return !!t && t.scopes.includes('mcp:read');
  });
  if (!ok) return null;
  const actor = await loadActor(link.tenant_id, link.user_id, req);
  if (!actor || !actor.grants['ai.use'] || mfaBlocked(actor)) return null;
  return actor;
}

/** Remove cost/margin keys everywhere (defence in depth on top of the whitelists). */
function stripCostDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripCostDeep);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !/cost|margin/i.test(k)).map(([k, x]) => [k, stripCostDeep(x)]));
  }
  return v;
}

class ToolDenied extends Error {}

function need(actor: RequestActor, ...perms: Permission[]) {
  // same semantics as @Perm: any one of them
  if (!perms.some((p) => actor.grants[p])) throw new ToolDenied(`missing permission: ${perms.join(' | ')}`);
}

const parties = new PartiesController();
const quotes = new QuotesController();
const contracts = new ContractsController();
const projects = new ProjectsController();
const inventory = new InventoryController();
const finance = new FinanceController();
const field = new FieldServiceController();

type ToolFn = (actor: RequestActor, args: Record<string, unknown>) => Promise<unknown>;

const TOOLS: { name: string; title: string; description: string; input: z.ZodRawShape; run: ToolFn }[] = [
  {
    name: 'search_customers',
    title: 'Search customers',
    description: 'Search customers (companies and individuals) by name, VAT number or CR number; Arabic is normalised. Returns ids for the other tools.',
    input: { query: z.string().min(1).max(200).describe('name / VAT / CR, Arabic or English'), limit: z.number().int().min(1).max(25).optional() },
    run: async (actor, a) => {
      need(actor, 'party.read');
      const r = await parties.list(actor, { q: String(a.query), limit: Number(a.limit ?? 10), offset: 0, role: 'customer' });
      return { total: r.total, customers: r.rows.map((p) => ({ id: p.id, nameAr: p.nameAr, nameEn: p.nameEn, kind: p.kind, vatNumber: p.vatNumber, crNumber: p.crNumber, segment: p.segment })) };
    },
  },
  {
    name: 'get_quote',
    title: 'Get a quotation',
    description: 'One quotation by id or number (e.g. MMC-26401011): header, status, lines and totals in SAR.',
    input: { idOrNumber: z.string().min(1).max(64) },
    run: async (actor, a) => {
      need(actor, 'quote.read');
      let id = String(a.idOrNumber).trim();
      if (!isUuid(id)) {
        const r = await quotes.list(actor, { q: id, limit: 10, offset: 0, latestOnly: true });
        const hit = r.rows.find((x) => x.number.toLowerCase() === id.toLowerCase()) ?? r.rows[0];
        if (!hit) throw new ToolDenied('quote not found');
        id = hit.id;
      }
      const q = await quotes.get(actor, id);
      const cost = !!actor.grants['quote.cost.read'];
      const out = {
        id: q.id, number: q.number, revision: q.revision, status: q.status, quoteDate: q.quoteDate, validUntil: q.validUntil,
        customer: q.clientName, partyId: q.partyId, projectName: q.projectName, projectLocation: q.projectLocation, owner: q.owner?.nameAr ?? null,
        vatOn: q.vatOn, subtotal: q.subtotal, discountAmount: q.discountAmount, vatAmount: q.vatAmount, total: q.total, sentAt: q.sentAt, viewedAt: q.viewedAt,
        contract: q.contract,
        lines: q.lines.map((l) => ({ code: l.code, description: l.description, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, optional: l.isOptional, ...(cost ? { unitCost: l.unitCost } : {}) })),
        ...(cost ? { costTotal: q.costTotal, marginTotal: q.marginTotal } : {}),
      };
      return cost ? out : stripCostDeep(out);
    },
  },
  {
    name: 'get_contract',
    title: 'Get a contract',
    description: 'One contract by id or number: status, dates, totals, payment milestones and linked invoices/payment requests the user may see.',
    input: { idOrNumber: z.string().min(1).max(64) },
    run: async (actor, a) => {
      need(actor, 'contract.read');
      let id = String(a.idOrNumber).trim();
      if (!isUuid(id)) {
        const r = await contracts.list(actor, { q: id, limit: 10, offset: 0 });
        const hit = r.rows.find((x) => x.number.toLowerCase() === id.toLowerCase()) ?? r.rows[0];
        if (!hit) throw new ToolDenied('contract not found');
        id = hit.id;
      }
      const c = await contracts.get(actor, id);
      return stripCostDeep({
        id: c.id, number: c.number, title: c.title, status: c.status, contractDate: c.contractDate, startDate: c.startDate, endDate: c.endDate,
        customer: (c.clientBlock as { name?: string } | null)?.name ?? null, partyId: c.partyId, quote: c.quote,
        vatOn: c.vatOn, subtotal: c.subtotal, discountAmount: c.discountAmount, vatAmount: c.vatAmount, total: c.total, signedAt: c.signedAt,
        deliveryDays: { min: c.deliveryDaysMin, max: c.deliveryDaysMax }, warrantyMonths: c.warrantyMonths,
        milestones: c.milestones.map((m) => ({ name: m.nameAr, nameEn: m.nameEn, percent: m.percent, amount: m.amount, status: m.status, dueDate: m.dueDate })),
        invoices: c.invoices.map((i) => ({ number: i.number, typeCode: i.typeCode, issueDate: i.issueDate, total: i.total, balanceDue: i.balanceDue })),
        paymentRequests: c.paymentRequests.map((p) => ({ number: p.number, status: p.status, amount: p.amount, dueDate: p.dueDate })),
      });
    },
  },
  {
    name: 'get_project_status',
    title: 'Get project status',
    description: 'A delivery project by id or number (or by contract number): stage, delivery clock, open tasks/snags, approvals and milestones.',
    input: { idOrNumber: z.string().min(1).max(64) },
    run: async (actor, a) => {
      need(actor, 'project.read');
      let id = String(a.idOrNumber).trim();
      if (!isUuid(id)) {
        const r = await projects.list(actor, { q: id, limit: 10, offset: 0 } as Parameters<ProjectsController['list']>[1]);
        const hit = r.rows.find((x) => x.number.toLowerCase() === id.toLowerCase()) ?? r.rows[0];
        if (!hit) throw new ToolDenied('project not found');
        id = hit.id;
      }
      const p = await projects.get(actor, id);
      return stripCostDeep({
        id: p.id, number: p.number, name: p.name, stage: p.stage, stageLabel: p.stageLabel, status: p.status, manager: p.managerName,
        customer: p.customer, site: p.site ? { name: p.site.name, address: p.site.address } : null, contract: p.contract,
        clock: p.clock, gate: p.gate,
        tasks: { total: p.tasks.length, open: p.tasks.filter((t) => !['done', 'cancelled'].includes(String(t.status))).map((t) => ({ title: t.title, status: t.status, dueDate: t.dueDate, assignee: t.assigneeName })).slice(0, 30) },
        snags: { total: p.snags.length, open: p.snags.filter((s) => s.status !== 'verified').map((s) => ({ description: s.description, status: s.status, dueDate: s.dueDate, location: s.locationPath })).slice(0, 30) },
        approvals: p.approvals.map((g) => ({ kind: g.kind, label: g.label, required: g.required, status: (g as { status?: string }).status ?? null })),
        milestones: p.milestones.map((m) => ({ name: m.nameAr, percent: m.percent, amount: m.amount, paidAmount: m.paidAmount, status: m.status, dueDate: m.dueDate })),
      });
    },
  },
  {
    name: 'stock_availability',
    title: 'Stock availability',
    description: 'On-hand, reserved, incoming and available quantity per product code (all warehouses).',
    input: { codes: z.array(z.string().min(1).max(64)).min(1).max(50) },
    run: async (actor, a) => {
      need(actor, 'inventory.read', 'product.read', 'quote.read');
      need(actor, 'product.read');
      const codes = (a.codes as string[]).map((c) => c.trim()).filter(Boolean);
      // the catalog has no record scope (product.read is catalog-wide, like GET /products)
      const prods = await tenantTx(actor.tenantId, (tx) => tx.select({ id: product.id, code: product.code, nameAr: product.nameAr, nameEn: product.nameEn, uom: product.uom })
        .from(product).where(and(inArray(product.code, codes), isNull(product.archivedAt))));
      const qty = prods.length ? await inventory.availability(actor, { productIds: prods.map((p) => p.id).join(',') }) : {};
      return {
        products: prods.map((p) => ({ code: p.code, nameAr: p.nameAr, nameEn: p.nameEn, uom: p.uom, ...((qty as Record<string, unknown>)[p.id] ?? { onHand: '0', reserved: '0', incoming: '0', available: '0' }) })),
        unknownCodes: codes.filter((c) => !prods.some((p) => p.code === c)),
      };
    },
  },
  {
    name: 'ar_balance',
    title: 'Customer balance (AR)',
    description: 'Outstanding receivable balance of a customer in SAR with the latest statement entries.',
    input: { partyId: z.string().uuid() },
    run: async (actor, a) => {
      need(actor, 'invoice.read');
      const s = await finance.statement(actor, String(a.partyId));
      return { customer: { id: s.party.id, nameAr: s.party.nameAr }, balanceSar: fromHalalas(s.balance), lastEntries: s.entries.slice(-15).map((e) => ({ date: e.date, kind: e.kind, number: e.number, debitSar: fromHalalas(e.debit), creditSar: fromHalalas(e.credit), balanceSar: fromHalalas(e.balance) })) };
    },
  },
  {
    name: 'installed_devices',
    title: 'Installed devices',
    description: 'Installed base of a customer and/or site: device code, serial, status, location, warranty end dates, online state. Credentials and device attributes are never returned.',
    input: { partyId: z.string().uuid().optional(), siteId: z.string().uuid().optional(), query: z.string().max(100).optional(), limit: z.number().int().min(1).max(200).optional() },
    run: async (actor, a) => {
      need(actor, 'asset.read');
      if (!a.partyId && !a.siteId && !a.query) throw new ToolDenied('give partyId, siteId or query');
      const r = await field.assets(actor, { q: a.query as string | undefined, limit: Number(a.limit ?? 100), offset: 0, partyId: a.partyId as string | undefined, siteId: a.siteId as string | undefined });
      return { total: r.total, devices: r.rows.map((d) => ({ id: d.id, code: d.code, description: d.description, serial: d.serial, mac: d.mac, status: d.status, location: d.locationPath, installedOn: d.installedOn, labourWarrantyEnd: d.labourWarrantyEnd, partsWarrantyEnd: d.partsWarrantyEnd, manufacturerWarrantyEnd: d.manufacturerWarrantyEnd, online: d.iotOnline, lastSeenAt: d.iotLastSeenAt })) };
    },
  },
  {
    name: 'open_service_calls',
    title: 'Open service calls',
    description: 'Open and in-progress service tickets (optionally for one customer or site) with SLA state.',
    input: { partyId: z.string().uuid().optional(), siteId: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).optional() },
    run: async (actor, a) => {
      need(actor, 'ticket.read');
      const r = await field.tickets(actor, { limit: Number(a.limit ?? 50), offset: 0, status: 'open,in_progress', partyId: a.partyId as string | undefined, siteId: a.siteId as string | undefined });
      return { total: r.total, tickets: r.rows.map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, coverage: t.coverage, customer: t.partyName, site: t.siteName, asset: t.asset, location: t.locationPath, sla: t.sla, createdAt: t.createdAt })) };
    },
  },
];

function buildServer(actor: RequestActor): McpServer {
  const server = new McpServer({ name: 'mmc-core', version: '0.1.0' }, { instructions: 'Read-only access to Al-Mada Al-Mubarak (MMC Core) data as the signed-in user, with that user\'s permissions. Amounts are SAR. Nothing can be changed through this server.' });
  for (const t of TOOLS) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input, annotations: { readOnlyHint: true, openWorldHint: false } }, async (args: Record<string, unknown>) => {
      const started = Date.now();
      const feature = `mcp:${t.name}`;
      const inputSummary = summarize(Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])));
      try {
        const data = await t.run(actor, args);
        let text = JSON.stringify(data);
        if (text.length > OUTPUT_MAX) text = `${text.slice(0, OUTPUT_MAX)}… [truncated]`;
        await logAiCall(actor, { feature, model: 'none', provider: 'mcp', status: 'ok', inputSummary, output: { bytes: text.length }, latencyMs: Date.now() - started });
        return { content: [{ type: 'text' as const, text }] };
      } catch (e) {
        const denied = e instanceof ToolDenied || (e instanceof HttpException && [403, 404].includes(e.getStatus()));
        const msg = e instanceof HttpException ? ((e.getResponse() as { message?: string }).message ?? e.message) : (e as Error).message;
        await logAiCall(actor, { feature, model: 'none', provider: 'mcp', status: denied ? 'blocked' : 'error', inputSummary, error: msg, latencyMs: Date.now() - started });
        return { content: [{ type: 'text' as const, text: denied ? `Not available: ${msg}` : 'The tool failed.' }], isError: true };
      }
    });
  }
  return server;
}

const rpcError = (res: Response, status: number, code: number, message: string) => res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

@Controller('mcp')
@Public()
export class McpController {
  @Post()
  async handle(@Req() req: Request, @Res() res: Response) {
    const actor = await actorFromToken(req);
    if (!actor) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="mmc-core"');
      return rpcError(res, 401, -32001, 'a valid personal access token is required (Settings → AI)');
    }
    const server = buildServer(actor);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('MCP request failed', e);
      if (!res.headersSent) rpcError(res, 500, -32603, 'internal error');
    }
  }

  /** Stateless server: no SSE stream, no sessions to delete. */
  @Get()
  get(@Res() res: Response) { return rpcError(res, 405, -32000, 'method not allowed'); }

  @Delete()
  del(@Res() res: Response) { return rpcError(res, 405, -32000, 'method not allowed'); }
}
