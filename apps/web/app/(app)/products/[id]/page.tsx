'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, ExternalLink, Package, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { Button, Card, Checkbox, Dialog, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { CURRENCY_AR, PRODUCT_TYPES, type Product } from '../_components/types';

interface Form {
  code: string; nameAr: string; nameEn: string; description: string; categoryId: string;
  type: Product['type']; uom: string; listPrice: string; installCost: string;
  costPrice: string; costCurrency: Product['costCurrency']; costRateToSar: string;
  warrantyMonths: string; serialTracked: boolean; imageUrl: string; datasheetUrl: string; status: Product['status'];
}

const EMPTY: Form = { code: '', nameAr: '', nameEn: '', description: '', categoryId: '', type: 'stock', uom: 'Nos', listPrice: '0', installCost: '0', costPrice: '', costCurrency: 'USD', costRateToSar: '3.75', warrantyMonths: '', serialTracked: false, imageUrl: '', datasheetUrl: '', status: 'active' };
const DEFAULT_RATE: Record<Product['costCurrency'], string> = { USD: '3.75', SAR: '1', CNY: '0.52' };

const amountOk = (v: string) => /^\d+(\.\d{1,4})?$/.test(v.trim());

function fromProduct(p: Product): Form {
  return {
    code: p.code, nameAr: p.nameAr, nameEn: p.nameEn ?? '', description: p.description ?? '', categoryId: p.categoryId ?? '',
    type: p.type, uom: p.uom, listPrice: String(p.listPrice ?? '0'), installCost: String(p.installCost ?? '0'),
    costPrice: p.costPrice ?? '', costCurrency: p.costCurrency, costRateToSar: p.costRateToSar ?? '3.75',
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
  const canWrite = can('product.write');
  const showCost = can('product.cost.read');

  const q = useQuery({ queryKey: ['product', id], queryFn: () => api.get<Product>(`/products/${id}`), enabled: !isNew });
  const meta = useQuery({ queryKey: ['products-meta'], queryFn: () => api.get<{ categories: { id: string; nameAr: string }[] }>('/products/meta'), staleTime: 300_000 });
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState<'save' | 'archive' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [imgBroken, setImgBroken] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  useEffect(() => { if (q.data) setF(fromProduct(q.data)); }, [q.data]);
  useEffect(() => setImgBroken(false), [f.imageUrl]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const errs = {
    listPrice: amountOk(f.listPrice) ? null : 'مبلغ غير صالح',
    installCost: amountOk(f.installCost) ? null : 'مبلغ غير صالح',
    costPrice: !f.costPrice.trim() || amountOk(f.costPrice) ? null : 'مبلغ غير صالح',
    costRateToSar: amountOk(f.costRateToSar) ? null : 'سعر صرف غير صالح',
    warrantyMonths: !f.warrantyMonths || /^\d+$/.test(f.warrantyMonths) ? null : 'عدد صحيح',
  };
  const invalid = Object.values(errs).some(Boolean);
  const costSar = f.costPrice && amountOk(f.costPrice) && amountOk(f.costRateToSar) ? Number(f.costPrice) * Number(f.costRateToSar) : null;
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
      toast.success(isNew ? 'تمت إضافة المنتج' : 'تم حفظ المنتج');
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.setQueryData(['product', saved.id], saved);
      if (isNew) router.replace(`/products/${saved.id}`);
    } catch (err) { setError(err); } finally { setBusy(null); }
  };

  const archive = async () => {
    setBusy('archive'); setError(null);
    try {
      await api.del(`/products/${id}`);
      toast.success('تمت أرشفة المنتج');
      qc.invalidateQueries({ queryKey: ['products'] });
      router.push('/products');
    } catch (err) { setError(err); } finally { setBusy(null); }
  };

  if (!isNew && q.isLoading) return <Spinner />;
  if (!isNew && q.error) return <><PageHeader title="المنتج" back="/products" /><ErrorBox error={q.error} /></>;
  // Without product.cost.read the API hides the cost; never send it back as null over an existing one.
  const costHidden = !showCost && !isNew;

  return (
    <>
      <PageHeader
        title={isNew ? 'منتج جديد' : f.nameAr || 'المنتج'}
        subtitle={!isNew && <span dir="ltr" className="num">{q.data?.code}</span>}
        back="/products"
        actions={!isNew && canWrite && !q.data?.archivedAt && <Button variant="outline" icon={<Archive className="size-4" />} onClick={() => setConfirmArchive(true)}>أرشفة</Button>}
      />
      {q.data?.archivedAt && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">هذا المنتج مؤرشف. حفظه بحالة «نشط» لا يلغي الأرشفة؛ أعد استيراده من الشيت لإرجاعه.</div>}
      <form onSubmit={save} className="grid gap-4 lg:grid-cols-3">
        <fieldset disabled={!canWrite} className="space-y-4 lg:col-span-2">
          <Card title="البيانات الأساسية">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="رقم القطعة / الكود *"><Input required dir="ltr" maxLength={64} value={f.code} onChange={(e) => set('code', e.target.value)} /></Field>
              <Field label="الحالة">
                <Select value={f.status} onChange={(e) => set('status', e.target.value as Form['status'])}>
                  <option value="active">نشط</option><option value="discontinued">متوقف</option>
                </Select>
              </Field>
              <Field label="الاسم بالعربية *"><Input required value={f.nameAr} onChange={(e) => set('nameAr', e.target.value)} /></Field>
              <Field label="Name (English)"><Input dir="ltr" value={f.nameEn} onChange={(e) => set('nameEn', e.target.value)} /></Field>
              <Field label="النوع">
                <Select value={f.type} onChange={(e) => set('type', e.target.value as Form['type'])}>
                  {Object.entries(PRODUCT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="وحدة القياس"><Input dir="ltr" value={f.uom} onChange={(e) => set('uom', e.target.value)} placeholder="Nos" /></Field>
              {(meta.data?.categories.length ?? 0) > 0 && (
                <Field label="التصنيف">
                  <Select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                    <option value="">—</option>
                    {meta.data!.categories.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="الضمان (شهر)" error={errs.warrantyMonths}><Input type="number" min={0} value={f.warrantyMonths} onChange={(e) => set('warrantyMonths', e.target.value)} /></Field>
            </div>
            <Field label="الوصف" className="mt-3" hint="الوصف الثنائي القديم «عربي | English» يظهر في عرض السعر.">
              <Textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <div className="mt-3"><Checkbox label="يُتتبَّع بالرقم التسلسلي" checked={f.serialTracked} onChange={(v) => set('serialTracked', v)} /></div>
          </Card>

          <Card title="الأسعار">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="سعر البيع (ر.س) *" error={errs.listPrice}><Input dir="ltr" inputMode="decimal" required value={f.listPrice} onChange={(e) => set('listPrice', e.target.value)} /></Field>
              <Field label="تكلفة التركيب للوحدة (ر.س)" error={errs.installCost}><Input dir="ltr" inputMode="decimal" value={f.installCost} onChange={(e) => set('installCost', e.target.value)} /></Field>
            </div>
            {showCost && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-xs font-bold text-muted">سعر الشراء (يظهر فقط لمن لديه صلاحية رؤية التكلفة)</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="سعر الشراء" error={errs.costPrice}><Input dir="ltr" inputMode="decimal" value={f.costPrice} onChange={(e) => set('costPrice', e.target.value)} /></Field>
                  <Field label="العملة">
                    <Select value={f.costCurrency} onChange={(e) => { const c = e.target.value as Form['costCurrency']; setF((x) => ({ ...x, costCurrency: c, costRateToSar: DEFAULT_RATE[c] })); }}>
                      {Object.entries(CURRENCY_AR).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
                    </Select>
                  </Field>
                  <Field label="سعر التحويل إلى الريال" error={errs.costRateToSar} hint={f.costCurrency === 'USD' ? 'الدولار مربوط بـ 3.75' : undefined}><Input dir="ltr" inputMode="decimal" value={f.costRateToSar} onChange={(e) => set('costRateToSar', e.target.value)} /></Field>
                </div>
                {costSar !== null && (
                  <p className="mt-2 text-xs text-muted">
                    التكلفة بالريال: <b className="num text-ink">{costSar.toFixed(2)}</b>
                    {margin !== null && <> · هامش الربح على سعر البيع: <b className={margin < 0 ? 'num text-danger' : 'num text-ok'}>{margin.toFixed(1)}%</b></>}
                  </p>
                )}
              </div>
            )}
            {costHidden && <p className="mt-3 text-xs text-muted">سعر الشراء مخفي حسب صلاحياتك، ولن يتغيّر عند الحفظ.</p>}
          </Card>
        </fieldset>

        <fieldset disabled={!canWrite} className="space-y-4">
          <Card title="الصورة والمرفقات">
            <div className="mb-3 grid aspect-square w-full place-items-center overflow-hidden rounded-lg border border-line bg-tint/40">
              {f.imageUrl && !imgBroken
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={f.imageUrl} alt={f.nameAr} className="max-h-full max-w-full object-contain" onError={() => setImgBroken(true)} />
                : <div className="text-center text-xs text-muted"><Package className="mx-auto mb-1 size-8 text-gold" />{imgBroken ? 'تعذّر تحميل الصورة' : 'لا توجد صورة'}</div>}
            </div>
            <Field label="رابط الصورة"><Input dir="ltr" type="url" value={f.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" /></Field>
            <Field label="رابط النشرة الفنية (Datasheet)" className="mt-3"><Input dir="ltr" type="url" value={f.datasheetUrl} onChange={(e) => set('datasheetUrl', e.target.value)} placeholder="https://…" /></Field>
            {f.datasheetUrl && /^https?:\/\//.test(f.datasheetUrl) && (
              <a href={f.datasheetUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-gold-dark hover:underline"><ExternalLink className="size-3.5" />فتح النشرة الفنية</a>
            )}
          </Card>
          <ErrorBox error={error} />
          {canWrite && <Button className="w-full" loading={busy === 'save'} disabled={invalid} icon={<Save className="size-4" />}>{isNew ? 'إضافة المنتج' : 'حفظ التغييرات'}</Button>}
        </fieldset>
      </form>
      <Dialog open={confirmArchive} onClose={() => setConfirmArchive(false)} title="أرشفة المنتج" footer={<>
        <Button variant="outline" onClick={() => setConfirmArchive(false)}>إلغاء</Button>
        <Button variant="danger" loading={busy === 'archive'} onClick={archive}>أرشفة</Button>
      </>}>
        <p className="text-sm">سيُخفى المنتج من الكتالوج ومن عروض الأسعار الجديدة، وتبقى العروض السابقة كما هي.</p>
      </Dialog>
    </>
  );
}
