import { formatSar, formatSar2, toHalalas } from '@mmc/domain';

/** Halalas (number) or SAR string (NUMERIC from the API) → display. */
export function money(v: number | string | null | undefined, opts: { fixed?: boolean } = {}): string {
  if (v === null || v === undefined || v === '') return '—';
  const h = typeof v === 'number' ? v : toHalalas(v);
  return opts.fixed ? formatSar2(h) : formatSar(h);
}

export function h(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  return typeof v === 'number' ? v : toHalalas(v);
}

export function date(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v.length === 10 ? `${v}T12:00:00` : v) : v;
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
}

export function dateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function today(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}
