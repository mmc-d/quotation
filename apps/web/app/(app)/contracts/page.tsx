'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileSignature } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Button, Card, clsx, Empty, ErrorBox, LinkButton, Money, PageHeader, SearchBox, Spinner, StatusBadge, Table, Td, Th } from '@/components/ui';

interface ContractRow { id: string; number: string; title: string; subtitle: string | null; status: string; contractDate: string; total: string; partyId: string | null; partyName: string | null; clientName: string | null; ownerName: string | null }

const STATUSES: { value: string; label: string; labelEn: string }[] = [
  { value: 'draft', label: 'مسودة', labelEn: 'Draft' },
  { value: 'sent_for_signature', label: 'بانتظار التوقيع', labelEn: 'Awaiting signature' },
  { value: 'signed', label: 'موقّع', labelEn: 'Signed' },
  { value: 'active', label: 'ساري', labelEn: 'Active' },
  { value: 'completed', label: 'مكتمل', labelEn: 'Completed' },
  { value: 'terminated', label: 'منتهٍ', labelEn: 'Terminated' },
  { value: 'cancelled', label: 'ملغى', labelEn: 'Cancelled' },
];

const PAGE = 50;

function ContractsList() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { bi, locale } = useI18n();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [statuses, setStatuses] = useState<string[]>(() => (sp.get('status') ?? '').split(',').filter(Boolean));
  const [limit, setLimit] = useState(PAGE);
  const term = useDeferredValue(q.trim());
  const status = statuses.join(',');

  useEffect(() => {
    const next = qs({ q: term, status });
    if (next !== (sp.toString() ? `?${sp.toString()}` : '')) router.replace(`${pathname}${next}`, { scroll: false });
    setLimit(PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, status]);

  const list = useQuery({
    queryKey: ['contracts', term, status, limit],
    queryFn: () => api.get<{ rows: ContractRow[]; total: number }>(`/contracts${qs({ q: term, status, limit: Math.min(limit, 200) })}`),
    placeholderData: (prev) => prev,
  });
  const rows = list.data?.rows ?? [];
  const toggle = (s: string) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <>
      <PageHeader
        title={bi('العقود', 'Contracts')}
        subtitle={list.data ? bi(`${list.data.total} عقد`, `${list.data.total} contracts`) : 'Contracts'}
        actions={<LinkButton href="/quotes?status=accepted,approved,sent,viewed" icon={<FileSignature className="size-4" />}>{bi('عقد من عرض سعر', 'Contract from a quote')}</LinkButton>}
      />
      <Card padded={false}>
        <div className="space-y-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder={bi('رقم العقد، العنوان، اسم العميل…', 'Contract number, title, customer name…')} />
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setStatuses([])} className={clsx('rounded-full border px-2.5 py-1 text-xs font-bold transition', statuses.length === 0 ? 'border-primary bg-primary text-white' : 'border-line text-muted hover:bg-tint')}>{bi('الكل', 'All')}</button>
            {STATUSES.map((s) => (
              <button key={s.value} type="button" onClick={() => toggle(s.value)} aria-pressed={statuses.includes(s.value)} className={clsx('rounded-full border px-2.5 py-1 text-xs font-bold transition', statuses.includes(s.value) ? 'border-gold bg-tint text-primary' : 'border-line text-muted hover:bg-tint/60')}>{locale === 'en' ? s.labelEn : s.label}</button>
            ))}
          </div>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<FileSignature className="size-8" />} title={term || status ? bi('لا توجد عقود مطابقة', 'No matching contracts') : bi('لا توجد عقود بعد', 'No contracts yet')} hint={term || status ? bi('جرّب تغيير البحث أو الفلاتر.', 'Try changing the search or filters.') : bi('تُنشأ العقود من عروض الأسعار المعتمدة أو المقبولة عبر زر «إنشاء عقد».', 'Contracts are created from approved or accepted quotes via the “Create contract” button.')} />
        ) : (
          <>
            <Table>
              <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('العنوان', 'Title')}</Th><Th>{bi('العميل', 'Customer')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th className="text-end">{bi('القيمة', 'Value')}</Th><Th>{bi('التاريخ', 'Date')}</Th></tr></thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/contracts/${r.id}`)}>
                    <Td><Link href={`/contracts/${r.id}`} onClick={(e) => e.stopPropagation()} className="num whitespace-nowrap font-bold text-primary hover:underline" dir="ltr">{r.number}</Link></Td>
                    <Td><div className="font-bold">{r.title}</div>{r.subtitle && <div className="text-xs text-muted">{r.subtitle}</div>}</Td>
                    <Td>{r.partyName ?? r.clientName ?? '—'}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td className="text-end"><Money value={r.total} /></Td>
                    <Td className="num whitespace-nowrap text-xs">{date(r.contractDate)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {list.data && list.data.total > rows.length && limit < 200 && (
              <div className="flex justify-center border-t border-line p-3">
                <Button variant="outline" size="sm" loading={list.isFetching} onClick={() => setLimit((l) => Math.min(200, l + PAGE))}>{bi('عرض المزيد', 'Show more')} ({list.data.total - rows.length})</Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

export default function ContractsPage() {
  return <Suspense fallback={<Spinner />}><ContractsList /></Suspense>;
}
