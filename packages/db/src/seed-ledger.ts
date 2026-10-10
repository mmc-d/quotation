import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { CHART_OF_ACCOUNTS, DEFAULT_METHOD_KEYS, parentCode } from '@mmc/domain';
import { account, ledgerSettings } from './schema/ledger.js';
import type { Tx } from './index.js';

/**
 * Starter ledger for the current tenant: the Saudi chart of accounts (only when the tenant has no
 * accounts yet — the accountant edits it afterwards, so it is never re-applied) and the
 * `ledger_settings` row with the payment-method → account map. Idempotent; call inside withTenant.
 */
export async function seedLedger(tx: Tx): Promise<{ createdAccounts: number }> {
  let createdAccounts = 0;
  const [any] = await tx.select({ id: account.id }).from(account).limit(1);
  if (!any) {
    const groups = CHART_OF_ACCOUNTS.filter((c) => c.isGroup).map((c) => c.code);
    const ids = new Map(CHART_OF_ACCOUNTS.map((c) => [c.code, randomUUID()]));
    await tx.insert(account).values(CHART_OF_ACCOUNTS.map((c) => {
      const parent = parentCode(c.code, groups);
      return {
        id: ids.get(c.code)!, code: c.code, nameAr: c.nameAr, nameEn: c.nameEn, type: c.type, isGroup: !!c.isGroup,
        parentId: parent ? ids.get(parent)! : null, postingKey: c.postingKey ?? null, requiresParty: !!c.requiresParty,
      };
    }));
    createdAccounts = CHART_OF_ACCOUNTS.length;
  }
  await tx.insert(ledgerSettings).values({}).onConflictDoNothing();
  const [st] = await tx.select().from(ledgerSettings).limit(1);
  if (st && Object.keys(st.methodAccounts ?? {}).length === 0) {
    const keyed = new Map((await tx.select({ id: account.id, key: account.postingKey }).from(account)).flatMap((a) => (a.key ? [[a.key, a.id] as const] : [])));
    const methodAccounts: Record<string, string> = {};
    for (const [method, key] of Object.entries(DEFAULT_METHOD_KEYS)) if (keyed.has(key)) methodAccounts[method] = keyed.get(key)!;
    await tx.update(ledgerSettings).set({
      methodAccounts,
      defaultCashAccountId: st.defaultCashAccountId ?? keyed.get('cash') ?? null,
      defaultBankAccountId: st.defaultBankAccountId ?? keyed.get('bank') ?? null,
    }).where(eq(ledgerSettings.id, st.id));
  }
  return { createdAccounts };
}
