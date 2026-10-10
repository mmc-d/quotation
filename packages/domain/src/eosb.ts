import type { Halalas } from './money.js';

/**
 * End-of-service benefit (Saudi Labor Law Art. 84): half a month's wage for each of the first five
 * years and a full month's wage for each year after, pro rata for part years. The wage is basic +
 * housing + the other fixed allowances. The provision uses the full Art. 84 award (the entitlement on
 * termination by the employer / contract end); Art. 85 reductions on resignation are shown on the
 * schedule but not booked, which is the conservative reading.
 */

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Service in years (days ÷ 365) between hire and `asOf` — 0 before the hire date. */
export function serviceYears(hireDate: string, asOf: string): number {
  const days = Math.round((ms(asOf) - ms(hireDate)) / DAY) + 1; // first and last day both count
  return days <= 0 ? 0 : days / 365;
}

export interface EosbAward {
  years: number;
  firstFive: Halalas;
  after: Halalas;
  /** the Art. 84 award */
  amount: Halalas;
}

/** Art. 84 award for `years` of service on a monthly `wage` (halalas). */
export function eosbAward(years: number, wage: Halalas): EosbAward {
  const y = Math.max(0, years);
  const firstFive = Math.round(Math.min(y, 5) * 0.5 * wage);
  const after = Math.round(Math.max(0, y - 5) * wage);
  return { years: Math.round(y * 100) / 100, firstFive, after, amount: firstFive + after };
}

/** Art. 85 share of the award due on resignation: < 2 y none, 2–5 one third, 5–10 two thirds, 10+ all. */
export function resignationShare(years: number): number {
  if (years < 2) return 0;
  if (years < 5) return 1 / 3;
  if (years < 10) return 2 / 3;
  return 1;
}

export interface EosbEmployee {
  id: string;
  hireDate: string;
  terminationDate?: string | null;
  /** monthly wage in halalas: basic + housing + fixed allowances */
  wage: Halalas;
}

/** Liability for one employee at `asOf`: nothing before hire, frozen at the termination date after it. */
export function eosbLiability(e: EosbEmployee, asOf: string): EosbAward {
  const end = e.terminationDate && e.terminationDate < asOf ? e.terminationDate : asOf;
  return eosbAward(serviceYears(e.hireDate, end), e.wage);
}

export interface ProvisionLine { employeeId: string; target: Halalas; booked: Halalas; delta: Halalas }

/**
 * Monthly accrual: for each employee, target liability at month end − what the ledger already holds
 * for them. `total delta` against the whole account may differ (balances brought forward without an
 * employee tag); that remainder is returned separately so the entry still lands on the right total.
 */
export function eosbProvision(employees: readonly EosbEmployee[], asOf: string, bookedByEmployee: ReadonlyMap<string, Halalas>, accountBalance: Halalas): { lines: ProvisionLine[]; remainder: Halalas; target: Halalas } {
  const lines = employees.map((e) => {
    const target = eosbLiability(e, asOf).amount;
    const booked = bookedByEmployee.get(e.id) ?? 0;
    return { employeeId: e.id, target, booked, delta: target - booked };
  });
  const target = lines.reduce((s, l) => s + l.target, 0);
  const tagged = lines.reduce((s, l) => s + l.delta, 0);
  return { lines: lines.filter((l) => l.delta !== 0), remainder: target - accountBalance - tagged, target };
}
