import type { Response } from 'express';
import { z } from 'zod';
import type { Tx } from '@mmc/db';
import { fiscalYearOf, halalasToFixed, riyadhDate, toHalalas } from '@mmc/domain';
import { htmlToPdf, renderReportHtml, type ReportTable } from '@mmc/doc-templates';
import type { RequestActor } from '../auth/actor.js';
import { tenantTx } from '../common/db.js';
import { companyBlock } from '../common/company.js';
import { config } from '../config.js';
import { tableToXlsx } from './ledger-export.js';
import { loadSettings } from './ledger.service.js';

/** Shared by the financial-report controllers: one table rendered to JSON, Excel and PDF. */

export const fx = halalasToFixed;
export const H = (v: string | number | null | undefined) => toHalalas(String(v ?? '0'));
export const reportFormat = z.enum(['json', 'xlsx', 'pdf']).default('json');
export type ReportFormat = 'json' | 'xlsx' | 'pdf';
export const flag = z.enum(['true', 'false', '1', '0']).optional().transform((v) => v === 'true' || v === '1');

/** Requested range, defaulting to the fiscal year containing `to` (today by default). */
export async function defaultRange(tx: Tx, r: { from?: string; to?: string }) {
  const s = await loadSettings(tx);
  const to = r.to ?? riyadhDate();
  return { from: r.from ?? fiscalYearOf(to, s.fiscalYearStartMonth).start, to };
}

export async function renderXlsx(actor: RequestActor, table: ReportTable): Promise<Buffer> {
  const company = await tenantTx(actor.tenantId, async (tx) => (await companyBlock(tx)).legalNameAr);
  return tableToXlsx(table, company);
}

export async function renderPdf(actor: RequestActor, table: ReportTable): Promise<Buffer> {
  return tenantTx(actor.tenantId, async (tx) => htmlToPdf(renderReportHtml(await companyBlock(tx), table, `طُبع بتاريخ ${riyadhDate()}`), config.gotenbergUrl));
}

export async function send(res: Response, actor: RequestActor, fmt: ReportFormat, json: unknown, table: ReportTable, file: string) {
  if (fmt === 'json') return res.json(json);
  const stamp = riyadhDate();
  if (fmt === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file}-${stamp}.xlsx"`);
    return res.send(await renderXlsx(actor, table));
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${file}-${stamp}.pdf"`);
  return res.send(await renderPdf(actor, table));
}
