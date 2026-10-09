'use client';
import { useI18n } from '@/lib/i18n';
import { Badge } from '@/components/ui';

export interface PayrollLine {
  id: string; employeeId: string; employeeNumber: string; nameAr: string; jobTitleAr: string | null; department: string | null; iban: string | null; bankName: string | null;
  workedDays: number; basic: string; housing: string; transport: string; other: string; bonuses: string; gross: string; unpaidLeave: string; sickDeduction: string;
  deductions: string; gosi: string; totalDeductions: string; net: string;
  details: { leaveDays?: Record<string, number>; unpaidLeaveDays?: number; sickDays?: { full: number; threeQuarter: number; unpaid: number }; warnings?: string[]; adjustments?: { kind: string; amount: string; reason: string }[] };
}
export interface PayrollRun {
  id: string; month: string; status: 'draft' | 'approved' | 'paid'; employeeCount: number; gross: string; totalDeductions: string; net: string; calculatedAt: string | null;
  approvedByName: string | null; approvedAt: string | null; paidAt: string | null; paidRef: string | null; createdBy: string | null; createdByName?: string | null; lines?: PayrollLine[];
}

export const WARNING: Record<string, [string, string]> = {
  deductions_over_half: ['الخصومات تتجاوز نصف الأجر (المادة 92)', 'Deductions exceed half the wage (Art. 92)'],
  deductions_exceed_pay: ['الاستقطاعات أكبر من المستحق', 'Deductions exceed the pay'],
  partial_month: ['شهر جزئي (مباشرة أو انتهاء خدمة)', 'Partial month (joined or left)'],
  suspended: ['الموظف موقوف — راجع استحقاقه', 'Employee suspended — check pay'],
  no_iban: ['لا يوجد آيبان', 'No IBAN'],
};

export function PayrollStatus({ status }: { status: PayrollRun['status'] }) {
  const { bi } = useI18n();
  return status === 'draft' ? <Badge tone="gold">{bi('مسودة', 'Draft')}</Badge> : status === 'approved' ? <Badge tone="blue">{bi('معتمد — بانتظار الصرف', 'Approved — to pay')}</Badge> : <Badge tone="green">{bi('مصروف', 'Paid')}</Badge>;
}
