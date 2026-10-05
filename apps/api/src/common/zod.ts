import { type PipeTransform } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { badRequest } from './errors.js';

/** Validate a body/query with zod; errors become 400 with field paths. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) throw badRequest('validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    return r.data;
  }
}

export const zMoney = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^-?\d+(\.\d{1,4})?$/.test(v), 'invalid amount');
export const zQty = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^\d+(\.\d{1,3})?$/.test(v) && Number(v) > 0, 'invalid quantity');
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const zUuid = z.string().uuid();
export const zPage = z.object({ q: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
