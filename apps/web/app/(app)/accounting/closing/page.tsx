'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarCheck, Download, Lock, LockOpen } from 'lucide-react';
import { api, openFile } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, today } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { ConfirmDialog, ReasonDialog, errMsg } from '../../quotes/_components/common';
import { RequirePerm } from '../../settings/_components/common';
import { Amt } from '../_components/ledger-kit';

interface Year {
  label: string; start: string; end: string; status: 'open' | 'closed'; closingEntryId: string | null; postedEntries: number; drafts: number;
  profit: string; suspense: string; blockers: string[]; canClose: boolean;
}

export default function ClosingPage() {
  const { bi } = useI18n();
  return <RequirePerm perm="ledger.read" title={bi('الإقفال وحزمة المراجع', 'Closing & auditor pack')}><Screen /></RequirePerm>;
}

function Screen() {
  const { bi } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const years = useQuery({ queryKey: ['fiscal-years'], queryFn: () => api.get<Year[]>('/accounting/fiscal-years') });
  const settings = useQuery({ queryKey: ['ledger-settings'], queryFn: () => api.get<{ lockedThrough: string | null; goLiveDate: string | null }>('/accounting/settings') });
  const [closing, setClosing] = useState<Year | null>(null);
  const [reopening, setReopening] = useState<Year | null>(null);
  const [lockDate, setLockDate] = useState('');
  const [pack, setPack] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['fiscal-years'] }); void qc.invalidateQueries({ queryKey: ['ledger-settings'] }); void qc.invalidateQueries({ queryKey: ['ledger-dashboard'] }); void qc.invalidateQueries({ queryKey: ['ledger-accounts'] }); };

  const close = useMutation({
    mutationFn: (y: Year) => api.post<{ label: string; profit: string; entry: { number: string } | null }>('/accounting/fiscal-years/close', { start: y.start }),
    onSuccess: (r) => { toast.success(bi(`أُقفلت السنة ${r.label} — صافي ${r.profit}`, `Year ${r.label} closed — net ${r.profit}`)); setClosing(null); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const lock = useMutation({
    mutationFn: () => api.post('/accounting/periods/lock', { through: lockDate }),
    onSuccess: () => { toast.success(bi('قُفلت الفترة', 'Period locked')); setLockDate(''); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const list = years.data ?? [];
  const packYear = pack || list[list.length - 1]?.start || '';
  return (
    <>
      <PageHeader title={bi('الإقفال وحزمة المراجع', 'Closing & auditor pack')} subtitle={bi('إقفال السنة المالية يرحّل الأرباح إلى الأرباح المبقاة ويقفل الدفاتر حتى نهاية السنة.', 'Closing a year moves profit to retained earnings and locks the books through its end.')} />
      <ErrorBox error={years.error} />

      <Card className="mb-4" title={bi('قفل الفترات', 'Period lock')}>
        {settings.data && (
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <p className="me-2 flex items-center gap-2">
              {settings.data.lockedThrough ? <><Lock className="size-4 text-gold-dark" />{bi('الدفاتر مقفلة حتى', 'Books locked through')} <b className="num" dir="ltr">{date(settings.data.lockedThrough)}</b></> : <><LockOpen className="size-4 text-muted" />{bi('لا توجد فترة مقفلة', 'No period is locked')}</>}
            </p>
            {can('ledger.close') && <>
              <Field label={bi('قفل حتى تاريخ', 'Lock through')}><Input type="date" max={today()} value={lockDate} onChange={(e) => setLockDate(e.target.value)} className="w-auto" /></Field>
              <Button variant="outline" disabled={!lockDate} loading={lock.isPending} onClick={() => lock.mutate()}>{bi('قفل', 'Lock')}</Button>
              {settings.data.lockedThrough && <Button variant="ghost" onClick={() => setUnlocking(true)}>{bi('إعادة فتح الفترات', 'Re-open periods')}</Button>}
            </>}
          </div>
        )}
      </Card>

      <Card padded={false} title={bi('السنوات المالية', 'Fiscal years')}>
        {years.isLoading ? <Spinner /> : !list.length ? <Empty icon={<CalendarCheck className="size-8" />} title={bi('لا توجد سنوات بعد', 'No fiscal years yet')} /> : (
          <Table>
            <thead><tr><Th>{bi('السنة', 'Year')}</Th><Th>{bi('الفترة', 'Period')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th className="text-end">{bi('صافي الربح', 'Net profit')}</Th><Th className="text-end">{bi('قيود', 'Entries')}</Th><Th>{bi('موانع الإقفال', 'Blockers')}</Th><Th /></tr></thead>
            <tbody>
              {list.map((y) => (
                <tr key={y.start} className="hover:bg-tint/50 align-top">
                  <Td><b className="num" dir="ltr">{y.label}</b></Td>
                  <Td className="num text-xs"><span dir="ltr">{date(y.start)} → {date(y.end)}</span></Td>
                  <Td>{y.status === 'closed' ? <Badge tone="green">{bi('مقفلة', 'Closed')}</Badge> : <Badge tone="gold">{bi('مفتوحة', 'Open')}</Badge>}</Td>
                  <Td className="text-end"><Amt v={y.profit} strong /></Td>
                  <Td className="num text-end text-xs">{y.postedEntries}{y.drafts ? <span className="text-gold-dark"> +{y.drafts} {bi('مسودة', 'draft')}</span> : null}</Td>
                  <Td className="max-w-[22rem] text-xs">{y.blockers.length ? <ul className="list-disc ps-4">{y.blockers.map((b) => <li key={b}>{b}</li>)}</ul> : y.status === 'open' ? <span className="text-ok">{bi('جاهزة للإقفال', 'Ready to close')}</span> : '—'}</Td>
                  <Td className="text-end whitespace-nowrap">
                    {y.status === 'open' && can('ledger.close') && <Button size="sm" disabled={!y.canClose} onClick={() => setClosing(y)}>{bi('إقفال السنة', 'Close year')}</Button>}
                    {y.status === 'closed' && can('ledger.close') && <Button size="sm" variant="outline" onClick={() => setReopening(y)}>{bi('إعادة فتح', 'Re-open')}</Button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {can('ledger.close') && (
        <Card className="mt-4" title={bi('حزمة المراجع (المحاسب القانوني)', 'Auditor pack')}>
          <p className="mb-3 text-sm text-muted">{bi('ملف مضغوط يضم القوائم المالية وأعمار الذمم ودفتر اليومية وسجل الأصول وإقرارات الضريبة وجدول نهاية الخدمة والتسويات البنكية وورقة الزكاة وفحوصات المطابقة وسجل التدقيق، مع بصمة SHA-256 لكل ملف. يتضمن بيانات رواتب.', 'A zip with the statements, aging, journal, asset register, VAT returns, EOSB schedule, bank reconciliations, Zakat schedule, checks and the audit trail, with a SHA-256 manifest. Contains salary data.')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={bi('السنة المالية', 'Fiscal year')}>
              <Select value={packYear} onChange={(e) => setPack(e.target.value)}>{list.map((y) => <option key={y.start} value={y.start}>{y.label}</option>)}</Select>
            </Field>
            <Button icon={<Download className="size-4" />} disabled={!packYear} onClick={() => openFile(`/accounting/auditor-pack?start=${packYear}`)}>{bi('تنزيل الحزمة', 'Download pack')}</Button>
          </div>
        </Card>
      )}

      <ConfirmDialog open={!!closing} onClose={() => setClosing(null)} loading={close.isPending} title={bi('إقفال السنة المالية', 'Close the fiscal year')}
        message={closing && <div className="grid gap-2"><p>{bi('سيُنشأ قيد إقفال بتاريخ', 'A closing entry will be posted on')} <b className="num" dir="ltr">{date(closing.end)}</b> {bi('يُصفّر حسابات الإيرادات والمصروفات إلى الأرباح المبقاة، وتُقفل الدفاتر حتى هذا التاريخ.', 'zeroing income and expense into retained earnings, and the books lock through that date.')}</p><p>{bi('صافي نتيجة السنة', 'Net result')}: <Amt v={closing.profit} strong /></p></div>}
        confirmLabel={bi('إقفال', 'Close')} onConfirm={() => closing && close.mutate(closing)} />
      <ReasonDialog open={!!reopening} required danger title={bi('إعادة فتح السنة المالية', 'Re-open the fiscal year')} hint={bi('للمالك فقط. يُعكس قيد الإقفال وتُفتح الفترة.', 'Owner only. The closing entry is reversed and the period opens.')}
        onClose={() => setReopening(null)}
        onConfirm={async (reason) => { try { await api.post('/accounting/fiscal-years/reopen', { start: reopening!.start, reason }); toast.success(bi('أُعيد فتح السنة', 'Year re-opened')); setReopening(null); refresh(); } catch (e) { toast.error(errMsg(e)); } }} />
      <ReasonDialog open={unlocking} required danger title={bi('إعادة فتح الفترات المقفلة', 'Re-open locked periods')} hint={bi('للمالك فقط، ويُسجَّل في سجل التدقيق. تُفتح كل الفترات المقفلة.', 'Owner only, audited. All locked periods open.')}
        onClose={() => setUnlocking(false)}
        onConfirm={async (reason) => { try { await api.post('/accounting/periods/unlock', { through: null, reason }); toast.success(bi('فُتحت الفترات', 'Periods re-opened')); setUnlocking(false); refresh(); } catch (e) { toast.error(errMsg(e)); } }} />
    </>
  );
}
