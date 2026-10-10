/** XML text escape. Every interpolated value in the UBL builder goes through this. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Exactly 2 decimals from a decimal string / number (no float arithmetic on money). */
export function money(v: string | number): string {
  const s = typeof v === 'number' ? v.toFixed(2) : String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a decimal amount: ${s}`);
  const neg = s.startsWith('-');
  const [i = '0', f = ''] = s.replace('-', '').split('.');
  const frac = (f + '00').slice(0, 2);
  const out = `${i}.${frac}`;
  return neg && Number(out) !== 0 ? `-${out}` : out;
}
