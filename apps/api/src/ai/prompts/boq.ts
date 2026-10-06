import { z } from 'zod';
import type { BoqRow } from '../boq.js';

/** AI-01 prompt. The catalog goes in a cached system block (see claudeParsed); rows go in the user turn. */
export const BOQ_SYSTEM = `You match rows of a consultant's Bill of Quantities (BOQ) for a Saudi low-current / smart-building integrator (CCTV, access control, intercom, networking, smart home, audio) to products in the company catalog provided below.

Rules:
- For every BOQ row return up to 3 candidate catalog products, best first, each with a confidence between 0 and 1 and a short reason (which words, model numbers or specifications matched).
- Only use product codes that appear in the catalog, copied exactly. If nothing fits, return an empty matches list and say why in notes. Never invent codes.
- Confidence ≥ 0.9 only for an exact model/code match or an unambiguous specification match; 0.5–0.8 for a plausible equivalent; below 0.5 for weak guesses.
- Keep ref, description and qty from the row (qty as a number). Rows may be Arabic or English.
- suggestedLabour = true when the row is installation, cabling, programming, testing or other labour rather than a device.
- notes: brief, in the row's language — e.g. missing specification, unit mismatch, needs a site survey.
- Prices are not your concern; never add products the BOQ does not ask for.`;

export const BoqOutput = z.object({
  rows: z.array(z.object({
    ref: z.string(),
    description: z.string(),
    qty: z.number(),
    matches: z.array(z.object({ productCode: z.string(), confidence: z.number(), reason: z.string() })),
    suggestedLabour: z.boolean(),
    notes: z.string(),
  })),
});
export type BoqOutputT = z.infer<typeof BoqOutput>;

export function boqUserText(rows: BoqRow[]): string {
  const lines = rows.map((r) => JSON.stringify({ ref: r.ref, code: r.code || undefined, description: r.description, qty: r.qty, unit: r.unit || undefined }));
  return `BOQ rows (${rows.length}, one JSON object per line):\n${lines.join('\n')}`;
}

export const BOQ_PDF_TEXT = 'The attached PDF is a consultant BOQ. Extract every priced line item (skip section titles and subtotals) and match each one to the catalog as instructed. Use the item number as ref.';
