'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardPaste, Download, Eye, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { today } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Button, Card, ErrorBox, Field, Input, Money, PageHeader, Table, Tabs, Td, Textarea, Th, clsx } from '@/components/ui';
import { NumInput } from '../../../quotes/_components/common';
import { WarningList } from '../../../purchasing/_components/common';
import { ProductPicker, Qty, WarehouseSelect, errMsg, type PickedProduct } from '../../_components/common';

interface Line { key: string; product: PickedProduct | null; qty: string; cost: string; serials: string }
interface Preview {
  warehouse: { id: string; code: string; nameAr: string };
  lines: { line: number; productId: string; code: string; name: string; qty: string; unitCostSar: string | null; costSource: 'entered' | 'average' | 'catalog' | 'none'; serials: string[]; onHand: string; valueSar: string | null }[];
  errors: { line: number; ar: string; en: string }[];
  warnings: { line: number; ar: string; en: string }[];
  totalSar: string | null;
  posted: { id: string; number: string } | null;
}

let seq = 0;
const newLine = (): Line => ({ key: `o${++seq}`, product: null, qty: '', cost: '', serials: '' });
const splitSerials = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const TEMPLATE = 'code,qty,unit_cost_sar,serials\nCAM-4MP,10,185.50,\nCABLE-CAT6,3,420,\nNVR-8CH,2,950,SN001 SN002\n';

export default function NewOpeningPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const canCost = can('purchase.cost.read');
  const [mode, setMode] = useState<'paste' | 'manual'>('paste');
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [openedOn, setOpenedOn] = useState(today());
  const [notes, setNotes] = useState('');
  const [sheet, setSheet] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [preview, setPreview] = useState<Preview | null>(null);

  const setLine = (key: string, patch: Partial<Line>) => { setPreview(null); setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); };
  const body = useMemo(() => ({
    warehouseId, openedOn, notes: notes.trim() || null,
    ...(mode === 'paste'
      ? { sheet }
      : { lines: lines.filter((l) => l.product && Number(l.qty) > 0).map((l) => ({ productId: l.product!.id, qty: l.qty, unitCostSar: canCost && l.cost !== '' ? l.cost : null, serials: l.product!.serialTracked ? splitSerials(l.serials) : undefined })) }),
  }), [warehouseId, openedOn, notes, mode, sheet, lines, canCost]);

  const check = useMutation({
    mutationFn: () => api.post<Preview>('/inventory/opening-balances', { ...body, preview: true }),
    onSuccess: setPreview,
    onError: (e) => toast.error(errMsg(e)),
  });
  const post = useMutation({
    mutationFn: () => api.post<Preview>('/inventory/opening-balances', body),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['inv-openings'] });
      qc.invalidateQueries({ queryKey: ['inv-stock'] });
      toast.success(bi(`تم ترحيل الرصيد الافتتاحي ${r.posted!.number} (${r.lines.length} صنف)`, `Opening stock ${r.posted!.number} posted (${r.lines.length} items)`));
      router.push(`/inventory/opening/${r.posted!.id}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const ready = !!warehouseId && !!openedOn && (mode === 'paste' ? sheet.trim() !== '' : lines.some((l) => l.product && Number(l.qty) > 0));
  const canPost = !!preview && preview.errors.length === 0 && preview.lines.length > 0;

  if (!can('inventory.count')) return <ErrorBox error={new Error(bi('إدخال الرصيد الافتتاحي يتطلب صلاحية الجرد', 'Opening stock needs the stock-count permission'))} />;

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + TEMPLATE], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'opening-stock-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const costSource = (s: Preview['lines'][number]['costSource']) => ({
    entered: [bi('مُدخلة', 'Entered'), 'bg-emerald-100 text-emerald-800'],
    average: [bi('المتوسط الحالي', 'Current average'), 'bg-sky-100 text-sky-800'],
    catalog: [bi('سعر الشراء بالكتالوج', 'Catalogue cost'), 'bg-violet-100 text-violet-800'],
    none: [bi('بدون تكلفة', 'No cost'), 'bg-rose-100 text-rose-800'],
  } as const)[s];

  return (
    <>
      <PageHeader back="/inventory/opening" title={bi('رصيد افتتاحي جديد', 'New opening stock')}
        subtitle={bi('أدخل ما هو موجود فعلًا في المستودع اليوم. راجع المعاينة ثم رحّل — لا يمكن تعديل الرصيد بعد الترحيل إلا بالجرد.', 'Enter what is physically in the warehouse today. Review the preview, then post — afterwards only a stock count can correct it.')}
        actions={<>
          <Button variant="outline" icon={<Eye className="size-4" />} disabled={!ready} loading={check.isPending} onClick={() => check.mutate()}>{bi('معاينة', 'Preview')}</Button>
          <Button icon={<CheckCircle2 className="size-4" />} disabled={!canPost} loading={post.isPending} onClick={() => post.mutate()}>{bi('ترحيل الرصيد', 'Post opening stock')}</Button>
        </>} />
      <div className="space-y-4">
        <Card>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={bi('المستودع *', 'Warehouse *')}><WarehouseSelect value={warehouseId} onChange={(v) => { setWarehouseId(v); setPreview(null); }} excludeTransit /></Field>
            <Field label={bi('تاريخ الرصيد', 'As of')}><Input type="date" dir="ltr" value={openedOn} max={today()} onChange={(e) => { setOpenedOn(e.target.value); setPreview(null); }} /></Field>
            <Field label={bi('ملاحظات', 'Notes')}><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={bi('مثال: جرد بداية التشغيل', 'e.g. go-live count')} /></Field>
          </div>
        </Card>

        <Card padded={false}>
          <div className="border-b border-line px-3 pt-2">
            <Tabs value={mode} onChange={(m) => { setMode(m); setPreview(null); }} items={[{ value: 'paste', label: bi('لصق من Excel', 'Paste from Excel') }, { value: 'manual', label: bi('إدخال يدوي', 'Enter manually') }]} />
          </div>
          {mode === 'paste' ? (
            <div className="space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 text-xs text-muted">
                <p className="max-w-2xl leading-relaxed">
                  <ClipboardPaste className="me-1 inline size-3.5" />
                  {bi('انسخ الأعمدة من Excel بالترتيب: ', 'Copy the columns from Excel in this order: ')}
                  <b className="text-ink">{bi('الكود، الكمية، تكلفة الوحدة بالريال (بدون ضريبة)', 'code, quantity, unit cost in SAR (excl. VAT)')}</b>
                  {bi('، ثم الأرقام التسلسلية مفصولة بمسافة للأصناف المتتبَّعة. يمكن ترك التكلفة 0 لاستخدام سعر الشراء في الكتالوج.', ', then serial numbers separated by spaces for tracked items. Leave the cost 0 to use the catalogue purchase price.')}
                  {!canCost && <b className="text-amber-700"> {bi('لا تملك صلاحية التكلفة: اترك عمود التكلفة 0.', 'You have no cost permission: leave the cost column at 0.')}</b>}
                </p>
                <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={downloadTemplate}>{bi('تنزيل نموذج', 'Download template')}</Button>
              </div>
              <Textarea rows={12} dir="ltr" className="font-mono text-xs" value={sheet} onChange={(e) => { setSheet(e.target.value); setPreview(null); }} placeholder={'CAM-4MP\t10\t185.50\nCABLE-CAT6\t3\t420\nNVR-8CH\t2\t950\tSN001 SN002'} />
            </div>
          ) : (
            <>
              <Table>
                <thead><tr><Th className="min-w-[16rem]">{bi('المنتج', 'Product')}</Th><Th className="w-28">{bi('الكمية', 'Qty')}</Th>{canCost && <Th className="w-36">{bi('تكلفة الوحدة (ر.س)', 'Unit cost (SAR)')}</Th>}<Th /></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key} className="align-top">
                      <Td>
                        <ProductPicker value={l.product} onChange={(p) => setLine(l.key, { product: p })} />
                        {l.product?.serialTracked && <Textarea rows={2} dir="ltr" className="mt-1.5 font-mono text-xs" placeholder={bi('الأرقام التسلسلية — رقم في كل سطر', 'Serial numbers — one per line')} value={l.serials} onChange={(e) => setLine(l.key, { serials: e.target.value })} />}
                      </Td>
                      <Td><NumInput value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} step="1" /></Td>
                      {canCost && <Td><NumInput value={l.cost} onChange={(v) => setLine(l.key, { cost: v })} step="0.01" placeholder={bi('تلقائي', 'auto')} /></Td>}
                      <Td><button type="button" disabled={lines.length === 1} onClick={() => { setPreview(null); setLines((ls) => ls.filter((x) => x.key !== l.key)); }} className="rounded p-1.5 text-muted hover:bg-rose-50 hover:text-danger disabled:opacity-30" aria-label={bi('حذف', 'Remove')}><Trash2 className="size-4" /></button></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="border-t border-line p-3"><Button size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setLines((ls) => [...ls, newLine()])}>{bi('إضافة صنف', 'Add item')}</Button></div>
            </>
          )}
        </Card>

        {preview && (
          <>
            <WarningList tone="red" title={bi(`أخطاء يجب تصحيحها (${preview.errors.length})`, `Errors to fix (${preview.errors.length})`)} items={preview.errors.map((e) => ({ ar: `${bi('سطر', 'Line')} ${e.line}: ${e.ar}`, en: `Line ${e.line}: ${e.en}` }))} />
            <WarningList title={bi(`تنبيهات (${preview.warnings.length})`, `Warnings (${preview.warnings.length})`)} items={preview.warnings.map((e) => ({ ar: `${bi('سطر', 'Line')} ${e.line}: ${e.ar}`, en: `Line ${e.line}: ${e.en}` }))} />
            <Card padded={false} title={<>{bi('المعاينة', 'Preview')} — {preview.warehouse.code} <span className="text-xs font-normal text-muted">({preview.lines.length} {bi('صنف', 'items')})</span></>}
              actions={preview.totalSar !== null ? <span className="text-sm font-extrabold">{bi('القيمة الإجمالية', 'Total value')}: <Money value={preview.totalSar} /></span> : undefined}>
              {preview.lines.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا أصناف صالحة.', 'No valid items.')}</p> : (
                <Table>
                  <thead><tr><Th>#</Th><Th>{bi('الكود', 'Code')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th className="text-end">{bi('الكمية', 'Qty')}</Th><Th className="text-end">{bi('الرصيد الحالي', 'On hand now')}</Th>{canCost && <Th className="text-end">{bi('تكلفة الوحدة', 'Unit cost')}</Th>}<Th>{bi('مصدر التكلفة', 'Cost from')}</Th>{canCost && <Th className="text-end">{bi('القيمة', 'Value')}</Th>}</tr></thead>
                  <tbody>
                    {preview.lines.map((l) => {
                      const [txt, cls] = costSource(l.costSource);
                      return (
                        <tr key={l.productId}>
                          <Td className="text-muted">{l.line}</Td>
                          <Td><span dir="ltr" className="num font-bold">{l.code}</span></Td>
                          <Td>{l.name}{l.serials.length > 0 && <div dir="ltr" className="num text-[11px] text-muted">{l.serials.join(', ')}</div>}</Td>
                          <Td className="text-end"><Qty value={l.qty} className="font-bold" /></Td>
                          <Td className={clsx('text-end', Number(l.onHand) !== 0 && 'text-amber-700')}><Qty value={l.onHand} /></Td>
                          {canCost && <Td className="text-end">{l.unitCostSar === null ? '—' : <Money value={l.unitCostSar} />}</Td>}
                          <Td><span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-bold', cls)}>{txt}</span></Td>
                          {canCost && <Td className="text-end">{l.valueSar === null ? '—' : <Money value={l.valueSar} />}</Td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
              {canPost && <p className="border-t border-line p-3 text-xs text-muted">{locale === 'en' ? 'Everything checks out. Press “Post opening stock” to add these quantities to the warehouse.' : 'كل شيء سليم. اضغط «ترحيل الرصيد» لإضافة هذه الكميات للمستودع.'}</p>}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
