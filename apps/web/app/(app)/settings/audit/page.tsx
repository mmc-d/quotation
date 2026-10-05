'use client';
import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronLeft, ScrollText, ShieldCheck, ShieldX } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
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
const ACTION_TONE: Record<string, 'green' | 'blue' | 'red' | 'gold' | 'gray'> = { create: 'green', update: 'blue', archive: 'red', suspend: 'red', delete: 'red', invite: 'gold', import: 'gold' };
const PAGE = 50;

export default function AuditPage() {
  return <RequirePerm perm="admin.audit" title="سجل التدقيق"><Audit /></RequirePerm>;
}

function Audit() {
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
      if (v.intact) toast.success('السجل سليم'); else toast.error('تم اكتشاف انقطاع في سلسلة السجل');
    } catch (e) { setVerifyError(e); } finally { setVerifying(false); }
  };

  return (
    <>
      <PageHeader
        title="سجل التدقيق"
        subtitle="سجل غير قابل للتعديل، كل قيد مربوط بتجزئة القيد السابق"
        actions={<Button variant="outline" loading={verifying} icon={<ShieldCheck className="size-4" />} onClick={runVerify}>التحقق من سلامة السجل</Button>}
      />
      <ErrorBox error={verifyError} />
      {verify && (
        <div className={`mb-4 flex items-start gap-3 rounded-lg border p-3 text-sm ${verify.intact ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
          {verify.intact ? <ShieldCheck className="size-5 shrink-0" /> : <ShieldX className="size-5 shrink-0" />}
          <div>
            <b>{verify.intact ? '✓ السجل سليم' : '✗ السلسلة منقطعة'}</b> — تم فحص <b className="num">{verify.entries}</b> قيدًا.
            {!verify.intact && <div className="mt-1 text-xs">القيود التي لا تطابق تجزئة ما قبلها: <span className="num" dir="ltr">{verify.brokenAt.join(', ')}</span></div>}
          </div>
        </div>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <SearchBox value={search} onChange={setSearch} placeholder="الإجراء أو نوع السجل…" />
          <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setOffset(0); }} className="max-w-[12rem]">
            <option value="">كل الأنواع</option>
            {Object.entries(ENTITY_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input value={entityId} onChange={(e) => { setEntityId(e.target.value); setOffset(0); }} placeholder="معرّف السجل (اختياري)" dir="ltr" className="max-w-[16rem]" />
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? <Empty icon={<ScrollText className="size-8" />} title="لا توجد قيود" /> : (
          <Table>
            <thead><tr><Th className="w-8" /><Th>الوقت</Th><Th>المستخدم</Th><Th>الإجراء</Th><Th>السجل</Th><Th>IP</Th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = open.has(r.id);
                const hasDetail = r.before != null || r.after != null || !!r.reason || !!r.userAgent;
                return (
                  <Fragment key={r.id}>
                    <tr className={`hover:bg-tint/50 ${hasDetail ? 'cursor-pointer' : ''}`} onClick={() => hasDetail && toggle(r.id)}>
                      <Td>{hasDetail && (isOpen ? <ChevronDown className="size-4 text-muted" /> : <ChevronLeft className="size-4 text-muted" />)}</Td>
                      <Td className="num whitespace-nowrap text-xs">{dateTime(r.at)}<div className="text-[10px] text-muted">#{r.id}</div></Td>
                      <Td className="text-xs">{r.actor ? <><div className="font-bold">{r.actor.nameAr ?? r.actor.email}</div>{r.actor.nameAr && <div className="text-muted" dir="ltr">{r.actor.email}</div>}</> : <span className="text-muted">النظام</span>}</Td>
                      <Td><Badge tone={ACTION_TONE[r.action] ?? 'gray'}>{r.action}</Badge></Td>
                      <Td className="text-xs"><div>{ENTITY_AR[r.entityType] ?? r.entityType}</div>{r.entityId && <div className="max-w-[14rem] truncate text-[10px] text-muted" dir="ltr" title={r.entityId}>{r.entityId}</div>}</Td>
                      <Td className="num text-xs text-muted"><span dir="ltr">{r.ip ?? '—'}</span></Td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} className="border-b border-line bg-gray-50 px-3 py-3">
                          {r.reason && <p className="mb-2 text-xs"><b>السبب:</b> {r.reason}</p>}
                          <div className="grid gap-3 lg:grid-cols-2">
                            <JsonBlock label="قبل" value={r.before} />
                            <JsonBlock label="بعد" value={r.after} />
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
            <Button size="sm" variant="outline" disabled={offset === 0 || list.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE))}>الأحدث</Button>
            <Button size="sm" variant="outline" disabled={rows.length < PAGE || list.isFetching} onClick={() => setOffset(offset + PAGE)}>الأقدم</Button>
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
