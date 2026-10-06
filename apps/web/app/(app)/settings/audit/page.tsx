'use client';
import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronLeft, ChevronRight, ScrollText, ShieldCheck, ShieldX } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, Empty, ErrorBox, Input, PageHeader, SearchBox, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { RequirePerm } from '../_components/common';

interface AuditRow {
  id: number; at: string; actorId: string | null; action: string; entityType: string; entityId: string | null;
  before: unknown; after: unknown; ip: string | null; userAgent: string | null; reason: string | null;
  actor: { id: string; email: string; nameAr: string | null } | null;
}
interface Verify { entries: number; intact: boolean; brokenAt: number[] }

const ENTITY_AR: Record<string, string> = {
  company: 'المنشأة', branch: 'الفرع', app_user: 'مستخدم', role: 'دور', numbering_series: 'الترقيم', clause_template: 'بند عقد', message_template: 'قالب رسالة',
  product: 'منتج', party: 'عميل', contact: 'جهة اتصال', quote: 'عرض سعر', contract: 'عقد', invoice: 'فاتورة', payment_request: 'طلب دفع', lead: 'عميل محتمل', opportunity: 'فرصة',
};
const ENTITY_EN: Record<string, string> = {
  company: 'Company', branch: 'Branch', app_user: 'User', role: 'Role', numbering_series: 'Numbering', clause_template: 'Contract clause', message_template: 'Message template',
  product: 'Product', party: 'Customer', contact: 'Contact', quote: 'Quotation', contract: 'Contract', invoice: 'Invoice', payment_request: 'Payment request', lead: 'Lead', opportunity: 'Opportunity',
};
const ACTION_TONE: Record<string, 'green' | 'blue' | 'red' | 'gold' | 'gray'> = { create: 'green', update: 'blue', archive: 'red', suspend: 'red', delete: 'red', invite: 'gold', import: 'gold' };
const PAGE = 50;

export default function AuditPage() {
  const { bi } = useI18n();
  return <RequirePerm perm="admin.audit" title={bi('سجل التدقيق', 'Audit log')}><Audit /></RequirePerm>;
}

function Audit() {
  const { bi, locale, dir } = useI18n();
  const entities = locale === 'en' ? ENTITY_EN : ENTITY_AR;
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [verify, setVerify] = useState<Verify | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<unknown>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setOffset(0); }, 300); return () => clearTimeout(t); }, [search]);

  const list = useQuery({ queryKey: ['audit', q, entityType, entityId, offset], queryFn: () => api.get<AuditRow[]>(`/audit${qs({ q, entityType, entityId: entityId.trim(), limit: PAGE, offset })}`), placeholderData: (prev) => prev });
  const rows = list.data ?? [];
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const runVerify = async () => {
    setVerifying(true); setVerifyError(null);
    try {
      const v = await api.get<Verify>('/audit/verify');
      setVerify(v);
      if (v.intact) toast.success(bi('السجل سليم', 'The log is intact')); else toast.error(bi('تم اكتشاف انقطاع في سلسلة السجل', 'A break in the log chain was detected'));
    } catch (e) { setVerifyError(e); } finally { setVerifying(false); }
  };

  return (
    <>
      <PageHeader
        title={bi('سجل التدقيق', 'Audit log')}
        subtitle={bi('سجل غير قابل للتعديل، كل قيد مربوط بتجزئة القيد السابق', 'An append-only log; each entry is chained to the hash of the previous one')}
        actions={<Button variant="outline" loading={verifying} icon={<ShieldCheck className="size-4" />} onClick={runVerify}>{bi('التحقق من سلامة السجل', 'Verify log integrity')}</Button>}
      />
      <ErrorBox error={verifyError} />
      {verify && (
        <div className={`mb-4 flex items-start gap-3 rounded-lg border p-3 text-sm ${verify.intact ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
          {verify.intact ? <ShieldCheck className="size-5 shrink-0" /> : <ShieldX className="size-5 shrink-0" />}
          <div>
            <b>{verify.intact ? bi('✓ السجل سليم', '✓ The log is intact') : bi('✗ السلسلة منقطعة', '✗ The chain is broken')}</b> — {bi('تم فحص', 'Checked')} <b className="num">{verify.entries}</b> {bi('قيدًا.', 'entries.')}
            {!verify.intact && <div className="mt-1 text-xs">{bi('القيود التي لا تطابق تجزئة ما قبلها:', 'Entries that do not match the previous hash:')} <span className="num" dir="ltr">{verify.brokenAt.join(', ')}</span></div>}
          </div>
        </div>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <SearchBox value={search} onChange={setSearch} placeholder={bi('الإجراء أو نوع السجل…', 'Action or record type…')} />
          <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setOffset(0); }} className="max-w-[12rem]">
            <option value="">{bi('كل الأنواع', 'All types')}</option>
            {Object.entries(entities).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input value={entityId} onChange={(e) => { setEntityId(e.target.value); setOffset(0); }} placeholder={bi('معرّف السجل (اختياري)', 'Record ID (optional)')} dir="ltr" className="max-w-[16rem]" />
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? <Empty icon={<ScrollText className="size-8" />} title={bi('لا توجد قيود', 'No entries')} /> : (
          <Table>
            <thead><tr><Th className="w-8" /><Th>{bi('الوقت', 'Time')}</Th><Th>{bi('المستخدم', 'User')}</Th><Th>{bi('الإجراء', 'Action')}</Th><Th>{bi('السجل', 'Record')}</Th><Th>IP</Th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = open.has(r.id);
                const hasDetail = r.before != null || r.after != null || !!r.reason || !!r.userAgent;
                return (
                  <Fragment key={r.id}>
                    <tr className={`hover:bg-tint/50 ${hasDetail ? 'cursor-pointer' : ''}`} onClick={() => hasDetail && toggle(r.id)}>
                      <Td>{hasDetail && (isOpen ? <ChevronDown className="size-4 text-muted" /> : dir === 'rtl' ? <ChevronLeft className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />)}</Td>
                      <Td className="num whitespace-nowrap text-xs">{dateTime(r.at)}<div className="text-[10px] text-muted">#{r.id}</div></Td>
                      <Td className="text-xs">{r.actor ? <><div className="font-bold">{r.actor.nameAr ?? r.actor.email}</div>{r.actor.nameAr && <div className="text-muted" dir="ltr">{r.actor.email}</div>}</> : <span className="text-muted">{bi('النظام', 'System')}</span>}</Td>
                      <Td><Badge tone={ACTION_TONE[r.action] ?? 'gray'}>{r.action}</Badge></Td>
                      <Td className="text-xs"><div>{entities[r.entityType] ?? r.entityType}</div>{r.entityId && <div className="max-w-[14rem] truncate text-[10px] text-muted" dir="ltr" title={r.entityId}>{r.entityId}</div>}</Td>
                      <Td className="num text-xs text-muted"><span dir="ltr">{r.ip ?? '—'}</span></Td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} className="border-b border-line bg-gray-50 px-3 py-3">
                          {r.reason && <p className="mb-2 text-xs"><b>{bi('السبب:', 'Reason:')}</b> {r.reason}</p>}
                          <div className="grid gap-3 lg:grid-cols-2">
                            <JsonBlock label={bi('قبل', 'Before')} value={r.before} />
                            <JsonBlock label={bi('بعد', 'After')} value={r.after} />
                          </div>
                          {r.userAgent && <p className="mt-2 break-all text-[10px] text-muted" dir="ltr">{r.userAgent}</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="flex items-center justify-between gap-2 p-3 text-sm">
          <span className="num text-muted">{rows.length ? `${offset + 1}–${offset + rows.length}` : ''}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={offset === 0 || list.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{bi('الأحدث', 'Newer')}</Button>
            <Button size="sm" variant="outline" disabled={rows.length < PAGE || list.isFetching} onClick={() => setOffset(offset + PAGE)}>{bi('الأقدم', 'Older')}</Button>
          </div>
        </div>
      </Card>
    </>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-xs font-bold text-gold-dark">{label}</div>
      {value == null ? <div className="rounded-md border border-line bg-white p-2 text-xs text-muted">—</div> : (
        <pre dir="ltr" className="max-h-80 overflow-auto rounded-md border border-line bg-white p-2 text-[11px] leading-relaxed text-ink">{JSON.stringify(value, null, 2)}</pre>
      )}
    </div>
  );
}
