'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Tags } from 'lucide-react';
import { SEGMENTS } from '@mmc/domain';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Badge, Button, Card, Checkbox, Dialog, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { SEGMENT_FALLBACK, type PriceList } from '../_components/price-list-types';

/** Price lists per customer segment (CPQ-05): a customer on a list gets its prices as unit prices on new quote lines. */
export default function PriceListsPage() {
  const { can } = useMe();
  const { tx, bi } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const canWrite = can('product.write');
  const [archived, setArchived] = useState(false);
  const list = useQuery({ queryKey: ['price-lists', archived], queryFn: () => api.get<PriceList[]>(`/price-lists${qs({ includeArchived: archived || undefined })}`) });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [segment, setSegment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const seg = (s: string | null) => (s ? tx(`segment.${s}`, SEGMENT_FALLBACK[s] ?? s) : '—');

  const create = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError(null);
    try {
      const pl = await api.put<PriceList>('/price-lists/new', { name: name.trim(), segment: segment || null });
      toast.success(bi('أُنشئت قائمة الأسعار — أضف الأصناف وأسعارها', 'Price list created — add items and their prices'));
      qc.invalidateQueries({ queryKey: ['price-lists'] });
      router.push(`/products/price-lists/${pl.id}`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        title={bi('قوائم الأسعار', 'Price lists')}
        subtitle={bi('أسعار خاصة لكل شريحة أو عميل — تُطبَّق على البنود الجديدة في عروض الأسعار', 'Special prices per segment or customer — applied to new lines in quotations')}
        back="/products"
        actions={canWrite && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>{bi('قائمة جديدة', 'New list')}</Button>}
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <Checkbox label={bi('إظهار المؤرشفة', 'Show archived')} checked={archived} onChange={setArchived} />
        </div>
        <ErrorBox error={list.error} />
        {list.isLoading ? <Spinner /> : !list.data?.length ? (
          <Empty icon={<Tags className="size-8" />} title={bi('لا توجد قوائم أسعار بعد', 'No price lists yet')} hint={bi('أنشئ قائمة (مثل: المقاولون، المطورون) وأضف أسعارها، ثم اربطها بالعملاء من صفحة العميل أو اجعلها افتراضية لشريحة.', 'Create a list (e.g. contractors, developers) and add its prices, then link it to customers from the customer page or make it the default for a segment.')} />
        ) : (
          <Table>
            <thead>
              <tr><Th>{bi('القائمة', 'List')}</Th><Th>{bi('الشريحة', 'Segment')}</Th><Th>{bi('السريان', 'Validity')}</Th><Th>{bi('العملة', 'Currency')}</Th><Th>{bi('الأصناف', 'Items')}</Th><Th>{bi('العملاء', 'Customers')}</Th><Th>{bi('الحالة', 'Status')}</Th></tr>
            </thead>
            <tbody>
              {list.data.map((l) => (
                <tr key={l.id} className="hover:bg-tint/50">
                  <Td>
                    <Link href={`/products/price-lists/${l.id}`} className="font-bold text-primary hover:underline">{l.name}</Link>
                    {l.isDefault && <span className="ms-1.5 align-middle"><Badge tone="gold">{bi('افتراضية للشريحة', 'Segment default')}</Badge></span>}
                  </Td>
                  <Td>{seg(l.segment)}</Td>
                  <Td className="num whitespace-nowrap text-xs">{l.validFrom || l.validTo ? <>{l.validFrom ? date(l.validFrom) : '…'} — {l.validTo ? date(l.validTo) : '…'}</> : <span className="text-muted">{bi('مفتوحة', 'Open-ended')}</span>}</Td>
                  <Td className="num">{l.currency}</Td>
                  <Td className="num">{l.itemCount ?? 0}</Td>
                  <Td className="num">{l.partyCount ?? 0}</Td>
                  <Td>{l.archivedAt ? <Badge tone="red">{bi('مؤرشفة', 'Archived')}</Badge> : l.active ? <Badge tone="green">{bi('سارية', 'Active')}</Badge> : <Badge>{bi('غير سارية', 'Inactive')}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={open} onClose={() => setOpen(false)} title={bi('قائمة أسعار جديدة', 'New price list')} footer={<>
        <Button variant="outline" onClick={() => setOpen(false)}>{bi('إلغاء', 'Cancel')}</Button>
        <Button loading={busy} disabled={!name.trim()} onClick={create}>{bi('إنشاء', 'Create')}</Button>
      </>}>
        <form onSubmit={create} className="space-y-3">
          <Field label={bi('اسم القائمة *', 'List name *')}><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={bi('مثل: أسعار المقاولين 2026', 'e.g. Contractor prices 2026')} /></Field>
          <Field label={bi('الشريحة', 'Segment')} hint={bi('اختياري — يمكن جعل القائمة افتراضية لعملاء هذه الشريحة من صفحتها', 'Optional — the list can be made the default for this segment’s customers from its page')}>
            <Select value={segment} onChange={(e) => setSegment(e.target.value)}>
              <option value="">—</option>
              {SEGMENTS.map((s) => <option key={s} value={s}>{seg(s)}</option>)}
            </Select>
          </Field>
          <ErrorBox error={error} />
        </form>
      </Dialog>
    </>
  );
}
