'use client';
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Plus, UserPlus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date } from '@/lib/format';
import { Button, Card, Checkbox, Empty, ErrorBox, PageHeader, SearchBox, Select, Spinner, StatusBadge, Table, Td, Th } from '@/components/ui';
import { label, INTEREST_LABELS, LEAD_SOURCES, LEAD_STATUS_LABELS, SOURCE_LABELS, waLink, type Lead } from '../_components/labels';
import { NewLeadDialog, ScoreBar } from '../_components/lead-form';

const PAGE = 50;

function LeadsInner() {
  const { can } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('new,contacted,qualified');
  const [source, setSource] = useState('');
  const [unassigned, setUnassigned] = useState(false);
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);

  const autoOpened = useRef(false);
  const canWrite = can('lead.write');
  useEffect(() => {
    if (!autoOpened.current && params.get('new') === '1' && canWrite) {
      autoOpened.current = true;
      setCreating(true);
    }
  }, [params, canWrite]);
  useEffect(() => setPage(0), [q, status, source, unassigned]);

  const closeNew = () => {
    setCreating(false);
    if (params.get('new')) router.replace(pathname);
  };

  const list = useQuery({
    queryKey: ['leads', q, status, source, unassigned, page],
    queryFn: () => api.get<{ rows: Lead[]; total: number }>(`/crm/leads${qs({ q, status, source, unassigned: unassigned ? 'true' : undefined, limit: PAGE, offset: page * PAGE })}`),
  });
  const total = list.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="العملاء المحتملون"
        subtitle={list.data ? `${total} سجل` : 'Leads'}
        actions={can('lead.write') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>عميل محتمل جديد</Button>}
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder="الاسم، الشركة، الجوال، الرقم…" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[11rem]" aria-label="الحالة">
            <option value="new,contacted,qualified">المفتوحة</option>
            <option value="">كل الحالات</option>
            {Object.entries(LEAD_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Select value={source} onChange={(e) => setSource(e.target.value)} className="max-w-[10rem]" aria-label="المصدر">
            <option value="">كل المصادر</option>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>)}
          </Select>
          <Checkbox label="غير مُسند" checked={unassigned} onChange={setUnassigned} />
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.rows.length ? (
          <Empty icon={<UserPlus className="size-8" />} title="لا يوجد عملاء محتملون" hint="تصل العملاء المحتملون من واتساب ونموذج الموقع تلقائيًا، أو أضفهم يدويًا." />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>الرقم</Th><Th>الاسم</Th><Th>الشركة</Th><Th>الجوال</Th><Th>المصدر</Th><Th>الاهتمام</Th><Th>التقييم</Th><Th>الحالة</Th><Th>المسؤول</Th><Th>تاريخ الإنشاء</Th></tr>
              </thead>
              <tbody>
                {list.data.rows.map((l) => {
                  const wa = waLink(l.mobile);
                  return (
                    <tr key={l.id} className="hover:bg-tint/50">
                      <Td className="num text-xs text-muted">{l.number ?? '—'}</Td>
                      <Td><Link href={`/crm/leads/${l.id}`} className="font-bold text-primary hover:underline">{l.name}</Link></Td>
                      <Td className="text-muted">{l.companyName ?? '—'}</Td>
                      <Td>
                        {l.mobile ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="num" dir="ltr">{l.mobile}</span>
                            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-800" aria-label="واتساب" title="فتح في واتساب"><MessageCircle className="size-4" /></a>}
                          </span>
                        ) : '—'}
                      </Td>
                      <Td className="whitespace-nowrap">{label(SOURCE_LABELS, l.source)}</Td>
                      <Td className="whitespace-nowrap">{label(INTEREST_LABELS, l.interest)}</Td>
                      <Td><ScoreBar score={l.score} /></Td>
                      <Td><StatusBadge status={l.status} /></Td>
                      <Td className="whitespace-nowrap text-muted">{l.ownerName ?? <span className="text-amber-700">غير مُسند</span>}</Td>
                      <Td className="num whitespace-nowrap text-xs text-muted">{date(l.createdAt)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {total > PAGE && (
              <div className="flex items-center justify-between gap-2 p-3 text-sm">
                <span className="text-muted num">{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} من {total}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>السابق</Button>
                  <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>التالي</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
      {can('lead.write') && <NewLeadDialog open={creating} onClose={closeNew} onCreated={(l) => router.push(`/crm/leads/${l.id}`)} />}
    </>
  );
}

export default function LeadsPage() {
  return <Suspense fallback={<Spinner />}><LeadsInner /></Suspense>;
}
