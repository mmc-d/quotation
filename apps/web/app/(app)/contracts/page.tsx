'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileSignature } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { date } from '@/lib/format';
import { Button, Card, clsx, Empty, ErrorBox, LinkButton, Money, PageHeader, SearchBox, Spinner, StatusBadge, Table, Td, Th } from '@/components/ui';

interface ContractRow { id: string; number: string; title: string; subtitle: string | null; status: string; contractDate: string; total: string; partyId: string | null; partyName: string | null; clientName: string | null; ownerName: string | null }

const STATUSES: { value: string; label: string }[] = [
  { value: 'draft', label: 'مسودة' },
  { value: 'sent_for_signature', label: 'بانتظار التوقيع' },
  { value: 'signed', label: 'موقّع' },
  { value: 'active', label: 'ساري' },
  { value: 'completed', label: 'مكتمل' },
  { value: 'terminated', label: 'منتهٍ' },
  { value: 'cancelled', label: 'ملغى' },
];

const PAGE = 50;

function ContractsList() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
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
        title="العقود"
        subtitle={list.data ? `${list.data.total} عقد` : 'Contracts'}
        actions={<LinkButton href="/quotes?status=accepted,approved,sent,viewed" icon={<FileSignature className="size-4" />}>عقد من عرض سعر</LinkButton>}
      />
      <Card padded={false}>
        <div className="space-y-2 border-b border-line p-3">
          <SearchBox value={q} onChange={setQ} placeholder="رقم العقد، العنوان، اسم العميل…" />
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setStatuses([])} className={clsx('rounded-full border px-2.5 py-1 text-xs font-bold transition', statuses.length === 0 ? 'border-primary bg-primary text-white' : 'border-line text-muted hover:bg-tint')}>الكل</button>
            {STATUSES.map((s) => (
              <button key={s.value} type="button" onClick={() => toggle(s.value)} aria-pressed={statuses.includes(s.value)} className={clsx('rounded-full border px-2.5 py-1 text-xs font-bold transition', statuses.includes(s.value) ? 'border-gold bg-tint text-primary' : 'border-line text-muted hover:bg-tint/60')}>{s.label}</button>
            ))}
          </div>
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={<FileSignature className="size-8" />} title={term || status ? 'لا توجد عقود مطابقة' : 'لا توجد عقود بعد'} hint={term || status ? 'جرّب تغيير البحث أو الفلاتر.' : 'تُنشأ العقود من عروض الأسعار المعتمدة أو المقبولة عبر زر «إنشاء عقد».'} />
        ) : (
          <>
            <Table>
              <thead><tr><Th>الرقم</Th><Th>العنوان</Th><Th>العميل</Th><Th>الحالة</Th><Th className="text-end">القيمة</Th><Th>التاريخ</Th></tr></thead>
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
                <Button variant="outline" size="sm" loading={list.isFetching} onClick={() => setLimit((l) => Math.min(200, l + PAGE))}>عرض المزيد ({list.data.total - rows.length})</Button>
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
