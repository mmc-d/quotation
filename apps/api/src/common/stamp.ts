import sharp from 'sharp';

/**
 * Stamps are usually photographed or scanned on paper: knock the paper colour out to transparency
 * and trim the empty margin, so the stamp prints cleanly over the document at its full size.
 * The paper colour is sampled from the corners; pixels close to it fade out smoothly.
 */
/** plenty for a ~5 cm stamp at print resolution */
const MAX = 600;

export async function cleanStampImage(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = (x: number, y: number) => (y * w + x) * 4;
  // already transparent around the edges (a cleaned PNG) → only trim
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  if (corners.every((i) => data[i + 3]! < 16)) return sharp(input).trim().resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((s, i) => s + data[i + c]!, 0) / corners.length));
  const LOW = 24; // within this distance of the paper → fully transparent
  const HIGH = 90; // beyond this → fully opaque ink
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.max(Math.abs(data[i]! - bg[0]!), Math.abs(data[i + 1]! - bg[1]!), Math.abs(data[i + 2]! - bg[2]!));
    const a = d <= LOW ? 0 : d >= HIGH ? 1 : (d - LOW) / (HIGH - LOW);
    data[i + 3] = Math.round(a * data[i + 3]!);
  }
  const trimmed = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer();
  return sharp(trimmed).resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
}
