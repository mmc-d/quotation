import { describe, expect, it } from 'vitest';
import { allocateHalalas, tafqit, tafqitHalalas, quotePrefixFor, zatcaTlvBase64, computeInvoiceLines } from '../src/index.js';
import { legacy, legacyFunctionSource } from './legacy.js';

// Deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe('parity with the legacy index.html', () => {
  it('tafqit matches on 5,000 amounts', () => {
    const legacyTafqit = legacy<(n: number) => string>('tafqit');
    const r = rng(42);
    const samples = [0, 1, 2, 3, 10, 11, 12, 19, 20, 21, 99, 100, 101, 200, 999, 1000, 1001, 2000, 2500, 3000, 10000, 11000, 100000, 250000.5, 1000000, 2000000, 1234567.89, 0.01, 0.5, 0.99];
    for (let k = 0; k < 5000; k++) samples.push(Math.round(r() * 10 ** (1 + Math.floor(r() * 8)) * 100) / 100);
    for (const a of samples) {
      expect(tafqit(a), `amount ${a}`).toBe(legacyTafqit(a));
      expect(tafqitHalalas(Math.round(a * 100)), `amount ${a}`).toBe(legacyTafqit(a));
    }
  });

  it('allocateHalalas matches', () => {
    const legacyAlloc = legacy<(t: number, w: number[]) => number[]>('allocateHalalas');
    const r = rng(7);
    for (let k = 0; k < 2000; k++) {
      const n = 1 + Math.floor(r() * 8);
      const w = Array.from({ length: n }, () => Math.floor(r() * 100000));
      const total = Math.floor(r() * 1000000);
      expect(allocateHalalas(total, w)).toEqual(legacyAlloc(total, w));
    }
  });

  it('quote prefix matches getQuotePrefix for every day 2024–2030', () => {
    const legacyPrefix = legacy<(d: Date) => string>('getQuotePrefix');
    for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2030, 11, 31); t += 86400000) {
      const d = new Date(t);
      const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
      expect(quotePrefixFor(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())).toBe(legacyPrefix(local));
    }
  });

  it('ZATCA TLV matches zatcaTlvBase64', () => {
    const legacyTlv = legacy<(f: [number, string][]) => string>('zatcaTlvBase64');
    const fields: [number, string][] = [
      [1, 'المدى المبارك للتجارة والحلول الذكية'],
      [2, '310122393500003'],
      [3, '2026-10-05T10:15:00'],
      [4, '1150.00'],
      [5, '150.00'],
    ];
    expect(zatcaTlvBase64(fields)).toBe(legacyTlv(fields));
    const long: [number, string][] = [[1, 'ش'.repeat(200)]];
    expect(zatcaTlvBase64(long)).toBe(legacyTlv(long));
  });

  it('invoice lines match computeInvoiceLines (discount + VAT spread)', () => {
    // The legacy function reads page globals (items, getDiscountAmount, allocateHalalas, VAT_RATE).
    const legacyAlloc = legacy<(t: number, w: number[]) => number[]>('allocateHalalas');
    const legacyInvoice = new Function('items', 'getDiscountAmount', 'allocateHalalas', 'VAT_RATE',
      `${legacyFunctionSource('computeInvoiceLines')}; return computeInvoiceLines();`);
    const r = rng(99);
    for (let k = 0; k < 500; k++) {
      const items = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, i) => ({ code: `P${i}`, desc: `Item ${i}`, unitPrice: Math.round(r() * 500000) / 100, qty: 1 + Math.floor(r() * 20) }));
      const pct = Math.floor(r() * 30);
      const getDiscountAmount = (sub: number) => (sub * pct) / 100;
      const old = legacyInvoice(items, getDiscountAmount, legacyAlloc, 15) as { lines: { vat: number; discount: number; total: number }[]; totals: { vat: number; total: number; discount: number } };
      const subH = items.reduce((s, it) => s + Math.round(it.unitPrice * it.qty * 100), 0);
      const discH = Math.min(subH, Math.max(0, Math.round(getDiscountAmount(subH / 100) * 100)));
      const ours = computeInvoiceLines(items.map((it) => ({ code: it.code, name: it.desc, qty: it.qty, unitPrice: it.unitPrice })), discH, 15);
      expect(ours.totals.discount / 100).toBe(old.totals.discount);
      expect(ours.totals.vat / 100).toBe(old.totals.vat);
      expect(ours.totals.total / 100).toBe(old.totals.total);
      expect(ours.lines.map((l) => l.vat / 100)).toEqual(old.lines.map((l) => l.vat));
      expect(ours.lines.map((l) => l.total / 100)).toEqual(old.lines.map((l) => l.total));
    }
  });
});

