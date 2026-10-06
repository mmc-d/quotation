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
import { useI18n } from '@/lib/i18n';
import { labelL, INTEREST_LABELS, INTEREST_LABELS_EN, LEAD_SOURCES, LEAD_STATUS_LABELS, LEAD_STATUS_LABELS_EN, SOURCE_LABELS, SOURCE_LABELS_EN, waLink, type Lead } from '../_components/labels';
import { NewLeadDialog, ScoreBar } from '../_components/lead-form';

const PAGE = 50;

function LeadsInner() {
  const { can } = useMe();
  const { bi, locale } = useI18n();
  const en = locale === 'en';
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
        title={bi('العملاء المحتملون', 'Leads')}
        subtitle={list.data ? bi(`${total} سجل`, `${total} records`) : 'Leads'}
        actions={can('lead.write') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{bi('عميل محتمل جديد', 'New lead')}</Button>}
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('الاسم، الشركة، الجوال، الرقم…', 'Name, company, mobile, number…')} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[11rem]" aria-label={bi('الحالة', 'Status')}>
            <option value="new,contacted,qualified">{bi('المفتوحة', 'Open')}</option>
            <option value="">{bi('كل الحالات', 'All statuses')}</option>
            {Object.entries(en ? LEAD_STATUS_LABELS_EN : LEAD_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Select value={source} onChange={(e) => setSource(e.target.value)} className="max-w-[10rem]" aria-label={bi('المصدر', 'Source')}>
            <option value="">{bi('كل المصادر', 'All sources')}</option>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{(en ? SOURCE_LABELS_EN : SOURCE_LABELS)[s] ?? s}</option>)}
          </Select>
          <Checkbox label={bi('غير مُسند', 'Unassigned')} checked={unassigned} onChange={setUnassigned} />
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.rows.length ? (
          <Empty icon={<UserPlus className="size-8" />} title={bi('لا يوجد عملاء محتملون', 'No leads')} hint={bi('تصل العملاء المحتملون من واتساب ونموذج الموقع تلقائيًا، أو أضفهم يدويًا.', 'Leads arrive automatically from WhatsApp and the website form, or add them manually.')} />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th>{bi('الشركة', 'Company')}</Th><Th>{bi('الجوال', 'Mobile')}</Th><Th>{bi('المصدر', 'Source')}</Th><Th>{bi('الاهتمام', 'Interest')}</Th><Th>{bi('التقييم', 'Score')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('المسؤول', 'Owner')}</Th><Th>{bi('تاريخ الإنشاء', 'Created')}</Th></tr>
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
                            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-800" aria-label={bi('واتساب', 'WhatsApp')} title={bi('فتح في واتساب', 'Open in WhatsApp')}><MessageCircle className="size-4" /></a>}
                          </span>
                        ) : '—'}
                      </Td>
                      <Td className="whitespace-nowrap">{labelL(locale, SOURCE_LABELS, SOURCE_LABELS_EN, l.source)}</Td>
                      <Td className="whitespace-nowrap">{labelL(locale, INTEREST_LABELS, INTEREST_LABELS_EN, l.interest)}</Td>
                      <Td><ScoreBar score={l.score} /></Td>
                      <Td><StatusBadge status={l.status} /></Td>
                      <Td className="whitespace-nowrap text-muted">{l.ownerName ?? <span className="text-amber-700">{bi('غير مُسند', 'Unassigned')}</span>}</Td>
                      <Td className="num whitespace-nowrap text-xs text-muted">{date(l.createdAt)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {total > PAGE && (
              <div className="flex items-center justify-between gap-2 p-3 text-sm">
                <span className="text-muted num">{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} {bi('من', 'of')} {total}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{bi('السابق', 'Previous')}</Button>
                  <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>{bi('التالي', 'Next')}</Button>
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
