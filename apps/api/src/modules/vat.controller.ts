import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { desc, eq, vatReturn } from '@mmc/db';
import { riyadhDate, vatPeriodOf, VAT_CODE_LABELS } from '@mmc/domain';
import type { ReportTable } from '@mmc/doc-templates';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { audit } from '../common/audit.js';
import { notFound } from '../common/errors.js';
import { ZodPipe, zDate, zUuid } from '../common/zod.js';
import { loadSettings } from './ledger.service.js';
import { reportFormat, send, type ReportFormat } from './report-kit.js';
import { fileReturn, prepareReturn, returnView, thresholdMonitor, unfileReturn } from './vat.service.js';

/** VAT return, filing and the registration-threshold monitor (Phase 6C). */

const prepareBody = z.object({ from: zDate.optional(), to: zDate.optional(), asOf: zDate.optional() });

const BOX_LABELS: [string, string][] = [
  ['box1', '1 — المبيعات الخاضعة للنسبة الأساسية'], ['box3', '3 — الصادرات'], ['box5', '5 — المبيعات المحلية الخاضعة لنسبة الصفر'], ['box6', '6 — المبيعات المعفاة'], ['box7', '7 — إجمالي المبيعات'],
  ['box8', '8 — المشتريات المحلية الخاضعة للنسبة الأساسية'], ['box9', '9 — الاستيرادات الخاضعة للضريبة المدفوعة في الجمارك'], ['box10', '10 — الاستيرادات الخاضعة للاحتساب العكسي'],
  ['box11', '11 — المشتريات الخاضعة لنسبة الصفر'], ['box12', '12 — المشتريات المعفاة'], ['box13', '13 — إجمالي المشتريات'],
];

type View = Awaited<ReturnType<typeof returnView>>;

function returnTable(v: View): ReportTable {
  const b = v.boxes as Record<string, { base: string; vat: string } | string>;
  const N = (x: string) => Math.round(Number(x) * 100);
  const rows: ReportTable['rows'] = [{ style: 'heading', cells: { box: 'المبيعات' } }];
  BOX_LABELS.forEach(([k, label], i) => {
    if (i === 5) rows.push({ style: 'heading', cells: { box: 'المشتريات' } });
    const x = b[k] as { base: string; vat: string };
    rows.push({ style: k === 'box7' || k === 'box13' ? 'subtotal' : 'normal', cells: { box: label, base: N(x.base), vat: N(x.vat) } });
  });
  rows.push({ style: 'normal', cells: { box: '14 — إجمالي ضريبة المخرجات المستحقة (تشمل الاحتساب العكسي)', vat: N(b.box14 as string) } });
  rows.push({ style: 'normal', cells: { box: '15 — إجمالي ضريبة المدخلات القابلة للخصم', vat: N(b.box15 as string) } });
  rows.push({ style: 'total', cells: { box: v.netVat.startsWith('-') ? '16 — صافي الضريبة القابلة للاسترداد' : '16 — صافي الضريبة المستحقة للهيئة', vat: N(v.netVat) } });
  return {
    title: 'إقرار ضريبة القيمة المضافة', titleEn: 'VAT return', subtitle: `${v.label} — من ${v.periodFrom} إلى ${v.periodTo} — ${v.status === 'filed' ? `مُقدَّم بتاريخ ${v.filedOn}` : 'مسودة'}`,
    columns: [{ key: 'box', label: 'البند', kind: 'text', width: 60 }, { key: 'base', label: 'المبلغ الخاضع (ر.س)', kind: 'money' }, { key: 'vat', label: 'مبلغ الضريبة (ر.س)', kind: 'money' }],
    rows, notes: Number(v.difference) === 0 ? [] : [`تنبيه: صافي الإقرار يختلف عن حركة حسابات الضريبة في الدفتر بمقدار ${v.difference}`],
  };
}

@Controller('accounting')
export class VatController {
  @Get('vat/threshold')
  @Perm('ledger.read')
  async threshold(@Actor() actor: RequestActor, @Query(new ZodPipe(prepareBody)) q: { asOf?: string }) {
    return tenantTx(actor.tenantId, (tx) => thresholdMonitor(tx, q.asOf ?? riyadhDate()));
  }

  @Get('vat/codes')
  @Perm('ledger.read')
  codes() {
    return Object.entries(VAT_CODE_LABELS).map(([code, l]) => ({ code, ...l }));
  }

  @Get('vat-returns')
  @Perm('ledger.read')
  async list(@Actor() actor: RequestActor) {
    return tenantTx(actor.tenantId, async (tx) => {
      const s = await loadSettings(tx);
      const rows = await tx.select().from(vatReturn).orderBy(desc(vatReturn.periodFrom));
      const next = vatPeriodOf(riyadhDate(), s.vatReturnFrequency as 'monthly' | 'quarterly');
      return { frequency: s.vatReturnFrequency, suggested: next, items: await Promise.all(rows.map((r) => returnView(tx, r))) };
    });
  }

  @Get('vat-returns/:id')
  @Perm('ledger.read')
  async get(@Actor() actor: RequestActor, @Res() res: Response, @Param('id', new ZodPipe(zUuid)) id: string, @Query(new ZodPipe(z.object({ format: reportFormat }))) q: { format: ReportFormat }) {
    const v = await tenantTx(actor.tenantId, async (tx) => {
      const [r] = await tx.select().from(vatReturn).where(eq(vatReturn.id, id));
      if (!r) throw notFound('VAT return');
      return returnView(tx, r, true);
    });
    return send(res, actor, q.format, v, returnTable(v), `vat-return-${v.label}`);
  }

  /** Prepare (or refresh) the draft return of a period; without dates, the current period by the configured frequency. */
  @Post('vat-returns')
  @Perm('ledger.write')
  async prepare(@Actor() actor: RequestActor, @Body(new ZodPipe(prepareBody)) b: { from?: string; to?: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const s = await loadSettings(tx);
      const p = b.from && b.to ? { from: b.from, to: b.to, label: `${b.from}..${b.to}` } : vatPeriodOf(b.from ?? riyadhDate(), s.vatReturnFrequency as 'monthly' | 'quarterly');
      const id = await prepareReturn(tx, actor, p);
      const [r] = await tx.select().from(vatReturn).where(eq(vatReturn.id, id));
      await audit(tx, actor, 'prepare', 'vat_return', id, null, { label: r!.label, net: r!.netVat });
      return returnView(tx, r!, true);
    }, actor.userId);
  }

  @Post('vat-returns/:id/file')
  @Perm('ledger.post')
  async file(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ filedOn: zDate.optional(), acknowledgeDifference: z.boolean().default(false) }))) b: { filedOn?: string; acknowledgeDifference: boolean }) {
    return tenantTx(actor.tenantId, async (tx) => {
      const res = await fileReturn(tx, actor, id, { acknowledgeDifference: b.acknowledgeDifference, filedOn: b.filedOn ?? riyadhDate() });
      await audit(tx, actor, 'file', 'vat_return', id, { status: 'draft' }, { status: 'filed', net: res.boxes.box16, entry: res.entryId });
      const [r] = await tx.select().from(vatReturn).where(eq(vatReturn.id, id));
      return returnView(tx, r!);
    }, actor.userId);
  }

  @Post('vat-returns/:id/unfile')
  @Perm('ledger.close')
  async unfile(@Actor() actor: RequestActor, @Param('id', new ZodPipe(zUuid)) id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(1).max(500) }))) b: { reason: string }) {
    return tenantTx(actor.tenantId, async (tx) => {
      await unfileReturn(tx, actor, id, b.reason);
      await audit(tx, actor, 'unfile', 'vat_return', id, { status: 'filed' }, { status: 'draft' }, b.reason);
      const [r] = await tx.select().from(vatReturn).where(eq(vatReturn.id, id));
      return returnView(tx, r!, true);
    }, actor.userId);
  }
}
