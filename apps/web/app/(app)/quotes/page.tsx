'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, FileText } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date } from '@/lib/format';
import { Button, Card, clsx, Empty, ErrorBox, LinkButton, Money, PageHeader, SearchBox, Spinner, StatusBadge, Table, Td, Th } from '@/components/ui';

interface QuoteRow {
  id: string; number: string; revision: number; status: string; quoteDate: string; validUntil: string | null;
  clientName: string | null; projectName: string | null; total: string; partyId: string | null; partyName: string | null;
  ownerId: string | null; ownerName: string | null; sentAt: string | null; viewedAt: string | null; marginTotal?: string;
}

const STATUSES: { value: string; label: string }[] = [
  { value: 'draft', label: 'مسودة' },
  { value: 'pending_approval', label: 'بانتظار الموافقة' },
  { value: 'approved', label: 'معتمد' },
  { value: 'sent', label: 'مُرسل' },
  { value: 'viewed', label: 'تمت المشاهدة' },
  { value: 'accepted', label: 'مقبول' },
  { value: 'rejected', label: 'مرفوض' },
  { value: 'lost', label: 'خسارة' },
  { value: 'expired', label: 'منتهي' },
];

const PAGE = 50;

function QuotesList() {
  const { can } = useMe();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [statuses, setStatuses] = useState<string[]>(() => (sp.get('status') ?? '').split(',').filter(Boolean));
  const [limit, setLimit] = useState(PAGE);
  const term = useDeferredValue(q.trim());
  const status = statuses.join(',');

  // keep the URL in sync (shareable filters; dashboard links use ?status=)
  useEffect(() => {
    const next = qs({ q: term, status });
    if (next !== (sp.toString() ? `?${sp.toString()}` : '')) router.replace(`${pathname}${next}`, { scroll: false });
    setLimit(PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, status]);

  const list = useQuery({
    queryKey: ['quotes', term, status, limit],
    queryFn: () => api.get<{ rows: QuoteRow[]; total: number }>(`/quotes${qs({ q: term, status, limit: Math.min(limit, 200), offset: 0 })}`),
    placeholderData: (prev) => prev,
  });
  const rows = list.data?.rows ?? [];
  const showMargin = rows.some((r) => r.marginTotal !== undefined);
  const toggle = (s: string) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <>
      <PageHeader
        title="عروض الأسعار"
        subtitle={list.data ? `${list.data.total} عرض` : 'Quotations'}
        actions={can('quote.write') && <LinkButton href="/quotes/new" variant="primary" icon={<FilePlus2 className="size-4" />}>عرض سعر جديد</LinkButton>}
      />
      <Card padded={false}>
        <div className="space-y-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder="رقم العرض، العميل، المشروع، الجوال…" />
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setStatuses([])} className={clsx('rounded-full border px-2.5 py-1 text-xs font-bold transition', statuses.length === 0 ? 'border-primary bg-primary text-white' : 'border-line text-muted hover:bg-tint')}>الكل</button>
            {STATUSES.map((s) => (
              <button key={s.value} type="button" onClick={() => toggle(s.value)} aria-pressed={statuses.includes(s.value)} className={clsx('rounded-full border px-2.5 py-1 text-xs font-bold transition', statuses.includes(s.value) ? 'border-gold bg-tint text-primary' : 'border-line text-muted hover:bg-tint/60')}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<FileText className="size-8" />} title={term || status ? 'لا توجد عروض مطابقة' : 'لا توجد عروض أسعار بعد'} hint={term || status ? 'جرّب تغيير البحث أو الفلاتر.' : 'ابدأ بإنشاء أول عرض سعر.'} action={can('quote.write') && !term && !status ? <LinkButton href="/quotes/new" variant="primary">عرض سعر جديد</LinkButton> : undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>الرقم</Th><Th>التاريخ</Th><Th>العميل / المشروع</Th><Th className="hidden md:table-cell">المندوب</Th><Th>الحالة</Th><Th className="text-end">الإجمالي</Th>
                  {showMargin && <Th className="hidden text-end lg:table-cell">الهامش</Th>}
                </tr>
              </thead>
              <tbody className={clsx(list.isFetching && 'opacity-70')}>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/quotes/${r.id}`)}>
                    <Td><Link href={`/quotes/${r.id}`} onClick={(e) => e.stopPropagation()} className="num whitespace-nowrap font-bold text-primary hover:underline" dir="ltr">{r.number}{r.revision ? `-R${r.revision}` : ''}</Link></Td>
                    <Td className="num whitespace-nowrap text-xs">{date(r.quoteDate)}</Td>
                    <Td>
                      <div className="font-bold">{r.partyName ?? r.clientName ?? '—'}</div>
                      {r.projectName && <div className="text-xs text-muted">{r.projectName}</div>}
                    </Td>
                    <Td className="hidden text-xs text-muted md:table-cell">{r.ownerName ?? '—'}</Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td className="text-end"><Money value={r.total} /></Td>
                    {showMargin && <Td className="hidden text-end lg:table-cell">{r.marginTotal !== undefined ? <Money value={r.marginTotal} className={Number(r.marginTotal) < 0 ? 'text-danger' : 'text-ok'} /> : '—'}</Td>}
                  </tr>
                ))}
              </tbody>
            </Table>
            {list.data && list.data.total > rows.length && limit < 200 && (
              <div className="flex justify-center border-t border-line p-3">
                <Button variant="outline" size="sm" loading={list.isFetching} onClick={() => setLimit((l) => Math.min(200, l + PAGE))}>عرض المزيد ({list.data.total - rows.length})</Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

export default function QuotesPage() {
  return <Suspense fallback={<Spinner />}><QuotesList /></Suspense>;
}
