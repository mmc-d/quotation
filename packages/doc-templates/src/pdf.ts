/**
 * HTML → PDF through Gotenberg (headless Chromium with correct Arabic shaping). The template's own
 * @page rules control size and margins.
 */
export async function htmlToPdf(html: string, gotenbergUrl = process.env.GOTENBERG_URL ?? 'http://localhost:3300', fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('preferCssPageSize', 'true');
  form.append('printBackground', 'true');
  form.append('waitDelay', '300ms');
  const res = await fetchImpl(`${gotenbergUrl.replace(/\/$/, '')}/forms/chromium/convert/html`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Gotenberg ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}
