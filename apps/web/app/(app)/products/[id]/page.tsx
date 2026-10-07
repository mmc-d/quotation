'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, ExternalLink, ImagePlus, Package, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { Button, Card, Checkbox, Dialog, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { BilingualTranslate } from '@/components/ai-assist';
import { KitComponentsCard } from '../_components/kit-components';
import { CURRENCY_AR, CURRENCY_EN, PRODUCT_TYPES, PRODUCT_TYPES_EN, type Product } from '../_components/types';

interface Form {
  code: string; nameAr: string; nameEn: string; description: string; categoryId: string;
  type: Product['type']; uom: string; listPrice: string; installCost: string;
  costPrice: string; costCurrency: Product['costCurrency']; costRateToSar: string;
  warrantyMonths: string; serialTracked: boolean; imageUrl: string; datasheetUrl: string; status: Product['status'];
}

const EMPTY: Form = { code: '', nameAr: '', nameEn: '', description: '', categoryId: '', type: 'stock', uom: 'Nos', listPrice: '0', installCost: '0', costPrice: '', costCurrency: 'USD', costRateToSar: '3.75', warrantyMonths: '', serialTracked: false, imageUrl: '', datasheetUrl: '', status: 'active' };
const DEFAULT_RATE: Record<Product['costCurrency'], string> = { USD: '3.75', SAR: '1', CNY: '0.52' };

const amountOk = (v: string) => /^\d+(\.\d{1,4})?$/.test(v.trim());
const rateOk = (v: string) => /^\d+(\.\d{1,6})?$/.test(v.trim()) && Number(v) > 0;
/** "650.0000" → "650" (the API returns fixed decimals; the form shows what people type). */
const plain = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? '' : Number.isFinite(Number(v)) ? String(Number(v)) : String(v));

/** Product photo → JPEG ≤ 1000 px on white (transparent PNGs stay readable on the quote). */
async function productPhoto(file: File): Promise<{ name: string; contentType: 'image/jpeg'; data: string }> {
  if (!file.type.startsWith('image/')) throw new Error('unsupported');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('decode')); i.src = url; });
    const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = c.toDataURL('image/jpeg', 0.85);
    return { name: `${(file.name || 'product').replace(/\.[^.]+$/, '')}.jpg`, contentType: 'image/jpeg', data: d.slice(d.indexOf(',') + 1) };
  } finally { URL.revokeObjectURL(url); }
}

function fromProduct(p: Product): Form {
  return {
    code: p.code, nameAr: p.nameAr, nameEn: p.nameEn ?? '', description: p.description ?? '', categoryId: p.categoryId ?? '',
    type: p.type, uom: p.uom, listPrice: plain(p.listPrice) || '0', installCost: plain(p.installCost) || '0',
    costPrice: plain(p.costPrice), costCurrency: p.costCurrency, costRateToSar: plain(p.costRateToSar) || '3.75',
    warrantyMonths: p.warrantyMonths != null ? String(p.warrantyMonths) : '', serialTracked: p.serialTracked,
    imageUrl: p.imageUrl ?? '', datasheetUrl: p.datasheetUrl ?? '', status: p.status,
  };
}

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === 'new';
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useMe();
  const { bi, locale } = useI18n();
  const canWrite = can('product.write');
  const showCost = can('product.cost.read');

  const q = useQuery({ queryKey: ['product', id], queryFn: () => api.get<Product>(`/products/${id}`), enabled: !isNew });
  const meta = useQuery({ queryKey: ['products-meta'], queryFn: () => api.get<{ categories: { id: string; nameAr: string }[] }>('/products/meta'), staleTime: 300_000 });
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState<'save' | 'archive' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [imgBroken, setImgBroken] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (pendingPreview) URL.revokeObjectURL(pendingPreview); }, [pendingPreview]);

  const uploadImage = async (productId: string, file: File) => {
    setImgBusy(true);
    try {
      const saved = await api.post<Product>(`/products/${productId}/image`, await productPhoto(file));
      qc.setQueryData(['product', productId], saved);
      qc.invalidateQueries({ queryKey: ['products'] });
      setF((x) => ({ ...x, imageUrl: saved.imageUrl ?? '' }));
      toast.success(bi('تم رفع صورة المنتج', 'Product photo uploaded'));
    } catch (err) {
      toast.error((err as Error).message === 'unsupported' || (err as Error).message === 'decode' ? bi('الملف ليس صورة مدعومة', 'Not a supported image') : (err as Error).message);
    } finally { setImgBusy(false); }
  };
  const onPickImage = (file: File | undefined) => {
    if (!file) return;
    if (isNew) { setPendingImage(file); setPendingPreview(URL.createObjectURL(file)); return; }
    void uploadImage(id, file);
  };
  const removeImage = async () => {
    setImgBusy(true);
    try {
      const saved = await api.del<Product>(`/products/${id}/image`);
      qc.setQueryData(['product', id], saved);
      qc.invalidateQueries({ queryKey: ['products'] });
      setF((x) => ({ ...x, imageUrl: '' }));
    } catch (err) { toast.error((err as Error).message); } finally { setImgBusy(false); }
  };
  useEffect(() => { if (q.data) setF(fromProduct(q.data)); }, [q.data]);
  useEffect(() => setImgBroken(false), [f.imageUrl]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const errs = {
    listPrice: amountOk(f.listPrice) ? null : bi('مبلغ غير صالح', 'Invalid amount'),
    installCost: amountOk(f.installCost) ? null : bi('مبلغ غير صالح', 'Invalid amount'),
    costPrice: !f.costPrice.trim() || amountOk(f.costPrice) ? null : bi('مبلغ غير صالح', 'Invalid amount'),
    costRateToSar: rateOk(f.costRateToSar) ? null : bi('سعر صرف غير صالح', 'Invalid exchange rate'),
    warrantyMonths: !f.warrantyMonths || /^\d+$/.test(f.warrantyMonths) ? null : bi('عدد صحيح', 'Whole number'),
  };
  const invalid = Object.values(errs).some(Boolean);
  const costSar = f.costPrice && amountOk(f.costPrice) && rateOk(f.costRateToSar) ? Number(f.costPrice) * Number(f.costRateToSar) : null;
  const margin = costSar !== null && Number(f.listPrice) > 0 ? ((Number(f.listPrice) - costSar) / Number(f.listPrice)) * 100 : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy('save'); setError(null);
    const body: Record<string, unknown> = {
      code: f.code.trim(), nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim() || null, description: f.description,
      categoryId: f.categoryId || null, type: f.type, uom: f.uom.trim() || 'Nos',
      listPrice: f.listPrice.trim(), installCost: f.installCost.trim(),
      warrantyMonths: f.warrantyMonths ? Number(f.warrantyMonths) : null, serialTracked: f.serialTracked,
      imageUrl: f.imageUrl.trim() || null, datasheetUrl: f.datasheetUrl.trim() || null, status: f.status,
    };
    if (showCost) Object.assign(body, { costPrice: f.costPrice.trim() || null, costCurrency: f.costCurrency, costRateToSar: f.costRateToSar.trim() });
    else if (q.data) Object.assign(body, { costCurrency: q.data.costCurrency, ...(q.data.costRateToSar ? { costRateToSar: q.data.costRateToSar } : {}) });
    try {
      const saved = await api.put<Product>(`/products/${id}`, body);
      toast.success(isNew ? bi('تمت إضافة المنتج', 'Product added') : bi('تم حفظ المنتج', 'Product saved'));
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.setQueryData(['product', saved.id], saved);
      if (isNew && pendingImage) await uploadImage(saved.id, pendingImage);
      if (isNew) router.replace(`/products/${saved.id}`);
    } catch (err) { setError(err); } finally { setBusy(null); }
  };

  const archive = async () => {
    setBusy('archive'); setError(null);
    try {
      await api.del(`/products/${id}`);
      toast.success(bi('تمت أرشفة المنتج', 'Product archived'));
      qc.invalidateQueries({ queryKey: ['products'] });
      router.push('/products');
    } catch (err) { setError(err); } finally { setBusy(null); }
  };

  if (!isNew && q.isLoading) return <Spinner />;
  if (!isNew && q.error) return <><PageHeader title={bi('المنتج', 'Product')} back="/products" /><ErrorBox error={q.error} /></>;
  // Without product.cost.read the API hides the cost; never send it back as null over an existing one.
  const costHidden = !showCost && !isNew;

  return (
    <>
      <PageHeader
        title={isNew ? bi('منتج جديد', 'New product') : (locale === 'en' && f.nameEn) || f.nameAr || bi('المنتج', 'Product')}
        subtitle={!isNew && <span dir="ltr" className="num">{q.data?.code}</span>}
        back="/products"
        actions={!isNew && canWrite && !q.data?.archivedAt && <Button variant="outline" icon={<Archive className="size-4" />} onClick={() => setConfirmArchive(true)}>{bi('أرشفة', 'Archive')}</Button>}
      />
      {q.data?.archivedAt && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{bi('هذا المنتج مؤرشف. حفظه بحالة «نشط» لا يلغي الأرشفة؛ أعد استيراده من الشيت لإرجاعه.', 'This product is archived. Saving it as “Active” does not unarchive it; re-import it from the sheet to restore it.')}</div>}
      <form onSubmit={save} className="grid gap-4 lg:grid-cols-3">
        <fieldset disabled={!canWrite} className="space-y-4 lg:col-span-2">
          <Card title={bi('البيانات الأساسية', 'Basic details')}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={bi('رقم القطعة / الكود *', 'Part number / code *')}><Input required dir="ltr" maxLength={64} value={f.code} onChange={(e) => set('code', e.target.value)} /></Field>
              <Field label={bi('الحالة', 'Status')}>
                <Select value={f.status} onChange={(e) => set('status', e.target.value as Form['status'])}>
                  <option value="active">{bi('نشط', 'Active')}</option><option value="discontinued">{bi('متوقف', 'Discontinued')}</option>
                </Select>
              </Field>
              <Field label={bi('الاسم بالعربية *', 'Name (Arabic) *')}><Input required value={f.nameAr} onChange={(e) => set('nameAr', e.target.value)} /></Field>
              <Field label="Name (English)"><Input dir="ltr" value={f.nameEn} onChange={(e) => set('nameEn', e.target.value)} /></Field>
              <Field label={bi('النوع', 'Type')}>
                <Select value={f.type} onChange={(e) => set('type', e.target.value as Form['type'])}>
                  {Object.entries(locale === 'en' ? PRODUCT_TYPES_EN : PRODUCT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label={bi('وحدة القياس', 'Unit of measure')}><Input dir="ltr" value={f.uom} onChange={(e) => set('uom', e.target.value)} placeholder="Nos" /></Field>
              {(meta.data?.categories.length ?? 0) > 0 && (
                <Field label={bi('التصنيف', 'Category')}>
                  <Select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                    <option value="">—</option>
                    {meta.data!.categories.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
                  </Select>
                </Field>
              )}
              <Field label={bi('الضمان (شهر)', 'Warranty (months)')} error={errs.warrantyMonths}><Input type="number" min={0} value={f.warrantyMonths} onChange={(e) => set('warrantyMonths', e.target.value)} /></Field>
            </div>
            <Field label={bi('الوصف', 'Description')} className="mt-3" hint={bi('الوصف الثنائي القديم «عربي | English» يظهر في عرض السعر.', 'The legacy bilingual description “Arabic | English” appears on the quotation.')}>
              <Textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} />
              <BilingualTranslate value={f.description} onChange={(v) => set('description', v)} />
            </Field>
            <div className="mt-3"><Checkbox label={bi('يُتتبَّع بالرقم التسلسلي', 'Tracked by serial number')} checked={f.serialTracked} onChange={(v) => set('serialTracked', v)} /></div>
          </Card>

          <Card title={bi('الأسعار', 'Prices')}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={bi('سعر البيع (ر.س) *', 'Selling price (SAR) *')} error={errs.listPrice}><Input dir="ltr" inputMode="decimal" required value={f.listPrice} onChange={(e) => set('listPrice', e.target.value)} /></Field>
              <Field label={bi('تكلفة التركيب للوحدة (ر.س)', 'Installation cost per unit (SAR)')} error={errs.installCost}><Input dir="ltr" inputMode="decimal" value={f.installCost} onChange={(e) => set('installCost', e.target.value)} /></Field>
            </div>
            {showCost && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-xs font-bold text-muted">{bi('سعر الشراء (يظهر فقط لمن لديه صلاحية رؤية التكلفة)', 'Purchase price (visible only to users allowed to see cost)')}</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label={bi('سعر الشراء', 'Purchase price')} error={errs.costPrice}><Input dir="ltr" inputMode="decimal" value={f.costPrice} onChange={(e) => set('costPrice', e.target.value)} /></Field>
                  <Field label={bi('العملة', 'Currency')}>
                    <Select value={f.costCurrency} onChange={(e) => { const c = e.target.value as Form['costCurrency']; setF((x) => ({ ...x, costCurrency: c, costRateToSar: DEFAULT_RATE[c] })); }}>
                      {Object.entries(locale === 'en' ? CURRENCY_EN : CURRENCY_AR).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
                    </Select>
                  </Field>
                  <Field label={bi('سعر التحويل إلى الريال', 'Exchange rate to SAR')} error={errs.costRateToSar} hint={f.costCurrency === 'USD' ? bi('الدولار مربوط بـ 3.75', 'The dollar is pegged at 3.75') : undefined}><Input dir="ltr" inputMode="decimal" value={f.costRateToSar} onChange={(e) => set('costRateToSar', e.target.value)} /></Field>
                </div>
                {costSar !== null && (
                  <p className="mt-2 text-xs text-muted">
                    {bi('التكلفة بالريال:', 'Cost in SAR:')} <b className="num text-ink">{costSar.toFixed(2)}</b>
                    {margin !== null && <> · {bi('هامش الربح على سعر البيع:', 'Margin on selling price:')} <b className={margin < 0 ? 'num text-danger' : 'num text-ok'}>{margin.toFixed(1)}%</b></>}
                  </p>
                )}
              </div>
            )}
            {costHidden && <p className="mt-3 text-xs text-muted">{bi('سعر الشراء مخفي حسب صلاحياتك، ولن يتغيّر عند الحفظ.', 'The purchase price is hidden by your permissions and will not change on save.')}</p>}
          </Card>
        </fieldset>

        <fieldset disabled={!canWrite} className="space-y-4">
          <Card title={bi('الصورة والمرفقات', 'Image & attachments')}>
            <div className="mb-3 grid aspect-square w-full place-items-center overflow-hidden rounded-lg border border-line bg-tint/40">
              {pendingPreview
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={pendingPreview} alt={f.nameAr} className="max-h-full max-w-full object-contain" />
                : f.imageUrl && !imgBroken
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={f.imageUrl} alt={f.nameAr} className="max-h-full max-w-full object-contain" onError={() => setImgBroken(true)} />
                : <div className="text-center text-xs text-muted"><Package className="mx-auto mb-1 size-8 text-gold" />{imgBroken ? bi('تعذّر تحميل الصورة', 'Could not load the image') : bi('لا توجد صورة', 'No image')}</div>}
            </div>
            {canWrite && (
              <div className="mb-3 flex flex-wrap gap-2">
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { onPickImage(e.target.files?.[0]); e.target.value = ''; }} />
                <Button type="button" variant="outline" size="sm" loading={imgBusy} icon={<ImagePlus className="size-4" />} onClick={() => fileInput.current?.click()}>
                  {f.imageUrl || pendingImage ? bi('تغيير الصورة', 'Change photo') : bi('رفع صورة', 'Upload photo')}
                </Button>
                {!isNew && f.imageUrl && <Button type="button" variant="ghost" size="sm" disabled={imgBusy} icon={<Trash2 className="size-4" />} onClick={removeImage}>{bi('إزالة', 'Remove')}</Button>}
                {isNew && pendingImage && <span className="self-center text-[11px] text-muted">{bi('تُرفع الصورة عند إضافة المنتج', 'Uploaded when the product is added')}</span>}
              </div>
            )}
            <Field label={bi('أو رابط صورة', 'Or an image URL')}><Input dir="ltr" value={f.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://…" /></Field>
            <Field label={bi('رابط النشرة الفنية (Datasheet)', 'Datasheet URL')} className="mt-3"><Input dir="ltr" type="url" value={f.datasheetUrl} onChange={(e) => set('datasheetUrl', e.target.value)} placeholder="https://…" /></Field>
            {f.datasheetUrl && /^https?:\/\//.test(f.datasheetUrl) && (
              <a href={f.datasheetUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-gold-dark hover:underline"><ExternalLink className="size-3.5" />{bi('فتح النشرة الفنية', 'Open datasheet')}</a>
            )}
          </Card>
          <ErrorBox error={error} />
          {canWrite && <Button className="w-full" loading={busy === 'save'} disabled={invalid} icon={<Save className="size-4" />}>{isNew ? bi('إضافة المنتج', 'Add product') : bi('حفظ التغييرات', 'Save changes')}</Button>}
        </fieldset>
      </form>
      {!isNew && q.data && <div className="mt-4"><KitComponentsCard product={q.data} canWrite={canWrite} /></div>}
      <Dialog open={confirmArchive} onClose={() => setConfirmArchive(false)} title={bi('أرشفة المنتج', 'Archive product')} footer={<>
        <Button variant="outline" onClick={() => setConfirmArchive(false)}>{bi('إلغاء', 'Cancel')}</Button>
        <Button variant="danger" loading={busy === 'archive'} onClick={archive}>{bi('أرشفة', 'Archive')}</Button>
      </>}>
        <p className="text-sm">{bi('سيُخفى المنتج من الكتالوج ومن عروض الأسعار الجديدة، وتبقى العروض السابقة كما هي.', 'The product will be hidden from the catalog and from new quotations; earlier quotations stay as they are.')}</p>
      </Dialog>
    </>
  );
}
