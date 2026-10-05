'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImageUp, Pencil, Plus, Save } from 'lucide-react';
import { isValidUnifiedNumber, isValidVatNumber } from '@mmc/domain';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { Badge, Button, Card, Checkbox, Dialog, ErrorBox, Field, Input, PageHeader, Spinner, Table, Td, Textarea, Th, clsx } from '@/components/ui';
import { InfoNote, RequirePerm, readFileBase64 } from '../_components/common';

interface Address { buildingNumber?: string; street?: string; district?: string; city?: string; postalCode?: string; additionalNumber?: string; country?: string }
interface Branch { id: string; code: string; nameAr: string; nameEn: string | null; isHeadOffice: boolean; address: Record<string, string>; zatcaEgsUnit: string | null }
interface Company {
  legalNameAr: string; legalNameEn: string | null; tradeNameAr: string | null; unifiedNumber: string | null; crNumber: string | null;
  vatRegistered: boolean; vatEffectiveFrom: string | null; vatNumber: string | null; address: Address;
  phone: string | null; email: string | null; website: string | null; bankName: string | null; iban: string | null;
  representativeName: string | null; representativeTitle: string | null; representativeMobile: string | null;
  logoFileId: string | null; stampFileId: string | null;
  quoteDefaults: { validityDays?: number; notesAr?: string; termsAr?: string; termsEn?: string; warrantyText?: string };
  approvalPolicy: { maxDiscountPercent: number; minMarginPercent: number };
  branches: Branch[];
}

type Form = Omit<Company, 'branches' | 'logoFileId' | 'stampFileId'>;

const s = (v: string | null | undefined) => v ?? '';
const nn = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export default function CompanySettingsPage() {
  return <RequirePerm perm="admin.settings" title="بيانات المنشأة"><CompanySettings /></RequirePerm>;
}

function CompanySettings() {
  const q = useQuery({ queryKey: ['settings-company'], queryFn: () => api.get<Company>('/settings/company') });
  const { refetch } = useMe();
  const qc = useQueryClient();
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (q.data && !f) {
      const { branches: _b, logoFileId: _l, stampFileId: _s, ...rest } = q.data;
      setF({ ...rest, address: rest.address ?? {}, quoteDefaults: rest.quoteDefaults ?? {}, approvalPolicy: rest.approvalPolicy ?? { maxDiscountPercent: 10, minMarginPercent: 20 } });
    }
  }, [q.data, f]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <><PageHeader title="بيانات المنشأة" /><ErrorBox error={q.error} /></>;
  if (!f || !q.data) return <Spinner />;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const setAddr = (k: keyof Address, v: string) => setF((x) => (x ? { ...x, address: { ...x.address, [k]: v } } : x));
  const setQd = (k: keyof Form['quoteDefaults'], v: string | number | undefined) => setF((x) => (x ? { ...x, quoteDefaults: { ...x.quoteDefaults, [k]: v } } : x));
  const setAp = (k: keyof Form['approvalPolicy'], v: number) => setF((x) => (x ? { ...x, approvalPolicy: { ...x.approvalPolicy, [k]: v } } : x));

  const ibanClean = s(f.iban).replace(/\s+/g, '').toUpperCase();
  const errs: Record<string, string | null> = {
    unifiedNumber: f.unifiedNumber && !isValidUnifiedNumber(f.unifiedNumber) ? '10 أرقام تبدأ بالرقم 7' : null,
    vatNumber: f.vatRegistered && !s(f.vatNumber).trim() ? 'الرقم الضريبي مطلوب للمنشأة المسجلة' : f.vatNumber && !isValidVatNumber(f.vatNumber) ? '15 رقمًا يبدأ وينتهي بالرقم 3' : null,
    buildingNumber: f.address.buildingNumber && !/^\d{4}$/.test(f.address.buildingNumber) ? '4 أرقام' : null,
    postalCode: f.address.postalCode && !/^\d{5}$/.test(f.address.postalCode) ? '5 أرقام' : null,
    additionalNumber: f.address.additionalNumber && !/^\d{4}$/.test(f.address.additionalNumber) ? '4 أرقام' : null,
    iban: ibanClean && !/^SA\d{22}$/.test(ibanClean) ? 'SA متبوعة بـ 22 رقمًا' : null,
    email: f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) ? 'بريد غير صالح' : null,
    validityDays: f.quoteDefaults.validityDays !== undefined && (f.quoteDefaults.validityDays < 1 || f.quoteDefaults.validityDays > 365) ? 'من 1 إلى 365' : null,
    maxDiscount: f.approvalPolicy.maxDiscountPercent < 0 || f.approvalPolicy.maxDiscountPercent > 100 ? 'من 0 إلى 100' : null,
    minMargin: f.approvalPolicy.minMarginPercent < -100 || f.approvalPolicy.minMarginPercent > 100 ? 'من -100 إلى 100' : null,
  };
  const invalid = Object.values(errs).some(Boolean);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) { toast.error('راجع الحقول المظللة بالأحمر'); return; }
    setBusy(true); setError(null);
    const address = Object.fromEntries(Object.entries(f.address).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '').map(([k, v]) => [k, String(v).trim()]));
    const quoteDefaults = Object.fromEntries(Object.entries(f.quoteDefaults).filter(([, v]) => v !== undefined && v !== ''));
    const body = {
      legalNameAr: f.legalNameAr.trim(), legalNameEn: nn(f.legalNameEn), tradeNameAr: nn(f.tradeNameAr),
      unifiedNumber: nn(f.unifiedNumber), crNumber: nn(f.crNumber),
      vatRegistered: f.vatRegistered, vatNumber: nn(f.vatNumber), vatEffectiveFrom: nn(f.vatEffectiveFrom),
      address, phone: nn(f.phone), email: nn(f.email) ?? '', website: nn(f.website), bankName: nn(f.bankName), iban: ibanClean || null,
      representativeName: nn(f.representativeName), representativeTitle: nn(f.representativeTitle), representativeMobile: nn(f.representativeMobile),
      quoteDefaults, approvalPolicy: f.approvalPolicy,
    };
    try {
      await api.put('/settings/company', body);
      toast.success('تم حفظ بيانات المنشأة');
      qc.invalidateQueries({ queryKey: ['settings-company'] });
      refetch();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="بيانات المنشأة" subtitle="تظهر في عروض الأسعار والعقود والفواتير" />
      <form onSubmit={save} className="space-y-4">
        <Card title="الهوية النظامية">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="الاسم القانوني بالعربية *"><Input required minLength={2} value={f.legalNameAr} onChange={(e) => set('legalNameAr', e.target.value)} /></Field>
            <Field label="Legal name (English)"><Input dir="ltr" value={s(f.legalNameEn)} onChange={(e) => set('legalNameEn', e.target.value)} /></Field>
            <Field label="الاسم التجاري"><Input value={s(f.tradeNameAr)} onChange={(e) => set('tradeNameAr', e.target.value)} /></Field>
            <Field label="الرقم الموحد (7xxxxxxxxx)" error={errs.unifiedNumber}><Input dir="ltr" inputMode="numeric" maxLength={10} value={s(f.unifiedNumber)} onChange={(e) => set('unifiedNumber', e.target.value.trim())} /></Field>
            <Field label="رقم السجل التجاري"><Input dir="ltr" inputMode="numeric" value={s(f.crNumber)} onChange={(e) => set('crNumber', e.target.value.trim())} /></Field>
          </div>
        </Card>

        <Card title="ضريبة القيمة المضافة">
          <label className="flex cursor-pointer items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={f.vatRegistered}
              onClick={() => set('vatRegistered', !f.vatRegistered)}
              className={clsx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', f.vatRegistered ? 'bg-primary' : 'bg-gray-300')}
            >
              <span className={clsx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', f.vatRegistered ? 'start-[1.375rem]' : 'start-0.5')} />
            </button>
            <span>
              <span className="block text-sm font-bold">{f.vatRegistered ? 'المنشأة مسجلة في ضريبة القيمة المضافة' : 'المنشأة غير مسجلة في ضريبة القيمة المضافة'}</span>
              <span className="block text-xs text-muted">عند الإيقاف: لا تُضاف الضريبة إلى عروض الأسعار والعقود، وتصدر الفواتير كـ«فاتورة» عادية بلا رقم ضريبي ولا رمز QR، مع عبارة «البائع غير مسجل في ضريبة القيمة المضافة» (نفس وضع «غير مسجل» في الأداة القديمة).</span>
            </span>
          </label>
          {f.vatRegistered && (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Field label="الرقم الضريبي *" error={errs.vatNumber} hint="15 رقمًا يبدأ وينتهي بالرقم 3"><Input dir="ltr" inputMode="numeric" maxLength={15} value={s(f.vatNumber)} onChange={(e) => set('vatNumber', e.target.value.trim())} /></Field>
              <Field label="تاريخ سريان التسجيل"><Input type="date" value={s(f.vatEffectiveFrom)} onChange={(e) => set('vatEffectiveFrom', e.target.value)} /></Field>
            </div>
          )}
        </Card>

        <Card title="العنوان الوطني والتواصل">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Field label="رقم المبنى" error={errs.buildingNumber}><Input dir="ltr" inputMode="numeric" maxLength={4} value={s(f.address.buildingNumber)} onChange={(e) => setAddr('buildingNumber', e.target.value.trim())} /></Field>
            <Field label="الشارع"><Input value={s(f.address.street)} onChange={(e) => setAddr('street', e.target.value)} /></Field>
            <Field label="الحي"><Input value={s(f.address.district)} onChange={(e) => setAddr('district', e.target.value)} /></Field>
            <Field label="المدينة"><Input value={s(f.address.city)} onChange={(e) => setAddr('city', e.target.value)} /></Field>
            <Field label="الرمز البريدي" error={errs.postalCode}><Input dir="ltr" inputMode="numeric" maxLength={5} value={s(f.address.postalCode)} onChange={(e) => setAddr('postalCode', e.target.value.trim())} /></Field>
            <Field label="الرقم الإضافي" error={errs.additionalNumber}><Input dir="ltr" inputMode="numeric" maxLength={4} value={s(f.address.additionalNumber)} onChange={(e) => setAddr('additionalNumber', e.target.value.trim())} /></Field>
            <Field label="الهاتف"><Input dir="ltr" inputMode="tel" value={s(f.phone)} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="البريد الإلكتروني" error={errs.email}><Input dir="ltr" type="email" value={s(f.email)} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="الموقع الإلكتروني"><Input dir="ltr" value={s(f.website)} onChange={(e) => set('website', e.target.value)} /></Field>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="الحساب البنكي">
            <div className="grid gap-3">
              <Field label="اسم البنك"><Input value={s(f.bankName)} onChange={(e) => set('bankName', e.target.value)} /></Field>
              <Field label="رقم الآيبان (IBAN)" error={errs.iban} hint="SA + 22 رقمًا"><Input dir="ltr" value={s(f.iban)} onChange={(e) => set('iban', e.target.value.toUpperCase())} placeholder="SA00 0000 0000 0000 0000 0000" /></Field>
            </div>
          </Card>
          <Card title="الممثل النظامي (يظهر في العقود)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="الاسم"><Input value={s(f.representativeName)} onChange={(e) => set('representativeName', e.target.value)} /></Field>
              <Field label="الصفة"><Input value={s(f.representativeTitle)} onChange={(e) => set('representativeTitle', e.target.value)} placeholder="المدير العام" /></Field>
              <Field label="الجوال"><Input dir="ltr" inputMode="tel" value={s(f.representativeMobile)} onChange={(e) => set('representativeMobile', e.target.value)} placeholder="05XXXXXXXX" /></Field>
            </div>
          </Card>
        </div>

        <Card title="الإعدادات الافتراضية لعروض الأسعار">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="مدة صلاحية العرض (يوم)" error={errs.validityDays}>
              <Input type="number" min={1} max={365} value={f.quoteDefaults.validityDays ?? ''} onChange={(e) => setQd('validityDays', e.target.value === '' ? undefined : Number(e.target.value))} />
            </Field>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Field label="الملاحظات الفنية"><Textarea rows={5} value={s(f.quoteDefaults.notesAr)} onChange={(e) => setQd('notesAr', e.target.value)} /></Field>
            <Field label="الشروط والأحكام"><Textarea rows={5} value={s(f.quoteDefaults.termsAr)} onChange={(e) => setQd('termsAr', e.target.value)} /></Field>
            <Field label="Terms & conditions (English)"><Textarea rows={4} dir="ltr" value={s(f.quoteDefaults.termsEn)} onChange={(e) => setQd('termsEn', e.target.value)} /></Field>
            <Field label="نص الضمان"><Textarea rows={4} value={s(f.quoteDefaults.warrantyText)} onChange={(e) => setQd('warrantyText', e.target.value)} /></Field>
          </div>
        </Card>

        <Card title="سياسة الاعتماد">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Field label="أقصى خصم بلا اعتماد (%)" error={errs.maxDiscount}><Input type="number" min={0} max={100} step="0.1" value={f.approvalPolicy.maxDiscountPercent} onChange={(e) => setAp('maxDiscountPercent', Number(e.target.value) || 0)} /></Field>
            <Field label="أدنى هامش ربح (%)" error={errs.minMargin}><Input type="number" min={-100} max={100} step="0.1" value={f.approvalPolicy.minMarginPercent} onChange={(e) => setAp('minMarginPercent', Number(e.target.value) || 0)} /></Field>
          </div>
          <p className="mt-2 text-xs text-muted">العرض الذي يتجاوز الخصم المسموح أو يقل هامشه عن الحد الأدنى يُحوَّل للاعتماد قبل الإرسال. لكل دور أيضًا حد خصم خاص به في شاشة الأدوار.</p>
        </Card>

        <ErrorBox error={error} />
        <div className="sticky bottom-0 z-10 -mx-1 flex justify-end bg-gradient-to-t from-white/95 to-white/0 px-1 py-3">
          <Button loading={busy} icon={<Save className="size-4" />}>حفظ بيانات المنشأة</Button>
        </div>
      </form>

      <div className="mt-2 grid gap-4 lg:grid-cols-2">
        <ImageUpload kind="logo" title="الشعار" fileId={q.data.logoFileId} note="يظهر في رأس عروض الأسعار والعقود والفواتير." />
        <ImageUpload kind="stamp" title="الختم" fileId={q.data.stampFileId} note="لا يُطبع الختم تلقائيًا أبدًا: يُضاف فقط عندما يطبع مستخدم مخوَّل (صلاحية «طباعة العقد بالختم») نسخة مختومة من العقد صراحةً، ويُسجَّل ذلك في سجل التدقيق." />
      </div>

      <Branches branches={q.data.branches} />
    </>
  );
}

function ImageUpload({ kind, title, fileId, note }: { kind: 'logo' | 'stamp'; title: string; fileId: string | null; note: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError(new Error('الصيغة المسموحة: PNG أو JPEG')); return; }
    if (file.size > 2_000_000) { setError(new Error('حجم الصورة أكبر من 2 ميجابايت')); return; }
    setBusy(true);
    try {
      const dataBase64 = await readFileBase64(file);
      await api.post(`/settings/company/${kind}`, { filename: file.name, mime: file.type, dataBase64 });
      toast.success(kind === 'logo' ? 'تم رفع الشعار' : 'تم رفع الختم');
      qc.invalidateQueries({ queryKey: ['settings-company'] });
    } catch (e) { setError(e); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <Card title={title} actions={<>
      <input ref={ref} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      <Button size="sm" variant="outline" loading={busy} icon={<ImageUp className="size-4" />} onClick={() => ref.current?.click()}>{fileId ? 'تغيير' : 'رفع'}</Button>
    </>}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="grid h-28 w-full shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-line bg-[repeating-conic-gradient(#f3f4f6_0_25%,#fff_0_50%)] bg-[length:16px_16px] sm:w-44">
          {fileId
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`/api/files/${fileId}`} alt={title} className="max-h-full max-w-full object-contain" />
            : <span className="text-xs text-muted">لا توجد صورة</span>}
        </div>
        <p className="text-xs leading-relaxed text-muted">{note}<br />PNG أو JPEG بحجم أقصى 2 ميجابايت (يُفضَّل PNG بخلفية شفافة).</p>
      </div>
      <div className="mt-2"><ErrorBox error={error} /></div>
    </Card>
  );
}

const emptyBranch = { code: '', nameAr: '', nameEn: '', isHeadOffice: false, city: '', zatcaEgsUnit: '' };

function Branches({ branches }: { branches: Branch[] }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ id: string; base: Branch | null } | null>(null);
  const [b, setB] = useState(emptyBranch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const open = (br: Branch | null) => {
    setError(null);
    setB(br ? { code: br.code, nameAr: br.nameAr, nameEn: br.nameEn ?? '', isHeadOffice: br.isHeadOffice, city: br.address?.city ?? '', zatcaEgsUnit: br.zatcaEgsUnit ?? '' } : emptyBranch);
    setEdit({ id: br?.id ?? 'new', base: br });
  };
  const save = async () => {
    if (!edit) return;
    setBusy(true); setError(null);
    try {
      const address = { ...(edit.base?.address ?? {}) };
      if (b.city.trim()) address.city = b.city.trim(); else delete address.city;
      await api.put(`/settings/branches/${edit.id}`, { code: b.code.trim(), nameAr: b.nameAr.trim(), nameEn: b.nameEn.trim() || null, isHeadOffice: b.isHeadOffice, address, zatcaEgsUnit: b.zatcaEgsUnit.trim() || null });
      toast.success('تم حفظ الفرع');
      qc.invalidateQueries({ queryKey: ['settings-company'] });
      setEdit(null);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Card title="الفروع" className="mt-4" padded={false} actions={<Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => open(null)}>فرع جديد</Button>}>
      {branches.length === 0 ? <p className="p-4 text-sm text-muted">لا توجد فروع بعد.</p> : (
        <Table>
          <thead><tr><Th>الرمز</Th><Th>الاسم</Th><Th>المدينة</Th><Th /><Th /></tr></thead>
          <tbody>
            {branches.map((br) => (
              <tr key={br.id} className="hover:bg-tint/50">
                <Td className="num" ><span dir="ltr">{br.code}</span></Td>
                <Td><div className="font-bold">{br.nameAr}</div>{br.nameEn && <div className="text-xs text-muted" dir="ltr">{br.nameEn}</div>}</Td>
                <Td className="text-muted">{br.address?.city ?? '—'}</Td>
                <Td>{br.isHeadOffice && <Badge tone="gold">المركز الرئيسي</Badge>}</Td>
                <Td className="text-end"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => open(br)}>تعديل</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id === 'new' ? 'فرع جديد' : 'تعديل الفرع'} footer={<>
        <Button variant="outline" onClick={() => setEdit(null)}>إلغاء</Button>
        <Button loading={busy} disabled={!b.code.trim() || !b.nameAr.trim()} onClick={save}>حفظ</Button>
      </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الرمز *"><Input dir="ltr" value={b.code} onChange={(e) => setB({ ...b, code: e.target.value })} placeholder="RUH" /></Field>
          <Field label="المدينة"><Input value={b.city} onChange={(e) => setB({ ...b, city: e.target.value })} /></Field>
          <Field label="الاسم بالعربية *"><Input value={b.nameAr} onChange={(e) => setB({ ...b, nameAr: e.target.value })} /></Field>
          <Field label="Name (English)"><Input dir="ltr" value={b.nameEn} onChange={(e) => setB({ ...b, nameEn: e.target.value })} /></Field>
          <Field label="وحدة الفوترة الإلكترونية (EGS)" hint="اختياري — للمرحلة الثانية من زاتكا" className="sm:col-span-2"><Input dir="ltr" value={b.zatcaEgsUnit} onChange={(e) => setB({ ...b, zatcaEgsUnit: e.target.value })} /></Field>
        </div>
        <div className="mt-3"><Checkbox label="المركز الرئيسي" checked={b.isHeadOffice} onChange={(v) => setB({ ...b, isHeadOffice: v })} /></div>
        <div className="mt-3"><ErrorBox error={error} /></div>
      </Dialog>
      <div className="p-3"><InfoNote>يُربط كل مستخدم بفرع، وتُستخدم الفروع لنطاق الصلاحيات «الفرع».</InfoNote></div>
    </Card>
  );
}
