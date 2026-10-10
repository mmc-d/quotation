/**
 * HTML → PDF through Gotenberg (headless Chromium with correct Arabic shaping). The template's own
 * @page rules control size and margins.
 */
export async function htmlToPdf(
  html: string,
  gotenbergUrl = process.env.GOTENBERG_URL ?? 'http://localhost:3300',
  fetchImpl: typeof fetch = fetch,
  /** `embeds` + `pdfa` produce an archival PDF/A-3b that carries the machine-readable source (the signed e-invoice XML) */
  opts: { pdfa?: 'PDF/A-1b' | 'PDF/A-2b' | 'PDF/A-3b'; embeds?: { name: string; content: string | Buffer }[] } = {},
): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  if (opts.pdfa) form.append('pdfa', opts.pdfa);
  for (const e of opts.embeds ?? []) form.append('embeds', new Blob([typeof e.content === 'string' ? e.content : new Uint8Array(e.content)], { type: 'application/xml' }), e.name);
  form.append('preferCssPageSize', 'true');
  form.append('printBackground', 'true');
  form.append('waitDelay', '300ms');
  const res = await fetchImpl(`${gotenbergUrl.replace(/\/$/, '')}/forms/chromium/convert/html`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Gotenberg ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}
