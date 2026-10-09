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
import { useI18n } from '@/lib/i18n';

interface Address { buildingNumber?: string; street?: string; district?: string; city?: string; postalCode?: string; additionalNumber?: string; country?: string }
interface Branch { id: string; code: string; nameAr: string; nameEn: string | null; isHeadOffice: boolean; address: Record<string, string>; zatcaEgsUnit: string | null }
interface Company {
  legalNameAr: string; legalNameEn: string | null; tradeNameAr: string | null; unifiedNumber: string | null; crNumber: string | null;
  vatRegistered: boolean; vatEffectiveFrom: string | null; vatNumber: string | null; address: Address;
  phone: string | null; email: string | null; website: string | null; bankName: string | null; iban: string | null; bankAccountName: string | null; bankAccountNumber: string | null;
  representativeName: string | null; representativeTitle: string | null; representativeMobile: string | null;
  logoFileId: string | null; stampFileId: string | null; bankQrFileId: string | null;
  quoteDefaults: { validityDays?: number; notesAr?: string; termsAr?: string; termsEn?: string; warrantyText?: string };
  approvalPolicy: { maxDiscountPercent: number; minMarginPercent: number };
  branches: Branch[];
}

type Form = Omit<Company, 'branches' | 'logoFileId' | 'stampFileId' | 'bankQrFileId'>;

const s = (v: string | null | undefined) => v ?? '';
const nn = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export default function CompanySettingsPage() {
  const { bi } = useI18n();
  return <RequirePerm perm="admin.settings" title={bi('بيانات المنشأة', 'Company profile')}><CompanySettings /></RequirePerm>;
}

function CompanySettings() {
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['settings-company'], queryFn: () => api.get<Company>('/settings/company') });
  const { refetch } = useMe();
  const qc = useQueryClient();
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (q.data && !f) {
      const { branches: _b, logoFileId: _l, stampFileId: _s, bankQrFileId: _q, ...rest } = q.data;
      setF({ ...rest, address: rest.address ?? {}, quoteDefaults: rest.quoteDefaults ?? {}, approvalPolicy: rest.approvalPolicy ?? { maxDiscountPercent: 10, minMarginPercent: 20 } });
    }
  }, [q.data, f]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <><PageHeader title={bi('بيانات المنشأة', 'Company profile')} /><ErrorBox error={q.error} /></>;
  if (!f || !q.data) return <Spinner />;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const setAddr = (k: keyof Address, v: string) => setF((x) => (x ? { ...x, address: { ...x.address, [k]: v } } : x));
  const setQd = (k: keyof Form['quoteDefaults'], v: string | number | undefined) => setF((x) => (x ? { ...x, quoteDefaults: { ...x.quoteDefaults, [k]: v } } : x));
  const setAp = (k: keyof Form['approvalPolicy'], v: number) => setF((x) => (x ? { ...x, approvalPolicy: { ...x.approvalPolicy, [k]: v } } : x));

  const ibanClean = s(f.iban).replace(/\s+/g, '').toUpperCase();
  const errs: Record<string, string | null> = {
    unifiedNumber: f.unifiedNumber && !isValidUnifiedNumber(f.unifiedNumber) ? bi('10 أرقام تبدأ بالرقم 7', '10 digits starting with 7') : null,
    vatNumber: f.vatRegistered && !s(f.vatNumber).trim() ? bi('الرقم الضريبي مطلوب للمنشأة المسجلة', 'VAT number is required for a registered company') : f.vatNumber && !isValidVatNumber(f.vatNumber) ? bi('15 رقمًا يبدأ وينتهي بالرقم 3', '15 digits starting and ending with 3') : null,
    buildingNumber: f.address.buildingNumber && !/^\d{4}$/.test(f.address.buildingNumber) ? bi('4 أرقام', '4 digits') : null,
    postalCode: f.address.postalCode && !/^\d{5}$/.test(f.address.postalCode) ? bi('5 أرقام', '5 digits') : null,
    additionalNumber: f.address.additionalNumber && !/^\d{4}$/.test(f.address.additionalNumber) ? bi('4 أرقام', '4 digits') : null,
    iban: ibanClean && !/^SA\d{22}$/.test(ibanClean) ? bi('SA متبوعة بـ 22 رقمًا', 'SA followed by 22 digits') : null,
    email: f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) ? bi('بريد غير صالح', 'Invalid email') : null,
    validityDays: f.quoteDefaults.validityDays !== undefined && (f.quoteDefaults.validityDays < 1 || f.quoteDefaults.validityDays > 365) ? bi('من 1 إلى 365', '1 to 365') : null,
    maxDiscount: f.approvalPolicy.maxDiscountPercent < 0 || f.approvalPolicy.maxDiscountPercent > 100 ? bi('من 0 إلى 100', '0 to 100') : null,
    minMargin: f.approvalPolicy.minMarginPercent < -100 || f.approvalPolicy.minMarginPercent > 100 ? bi('من -100 إلى 100', '-100 to 100') : null,
  };
  const invalid = Object.values(errs).some(Boolean);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) { toast.error(bi('راجع الحقول المظللة بالأحمر', 'Check the fields highlighted in red')); return; }
    setBusy(true); setError(null);
    const address = Object.fromEntries(Object.entries(f.address).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '').map(([k, v]) => [k, String(v).trim()]));
    const quoteDefaults = Object.fromEntries(Object.entries(f.quoteDefaults).filter(([, v]) => v !== undefined && v !== ''));
    const body = {
      legalNameAr: f.legalNameAr.trim(), legalNameEn: nn(f.legalNameEn), tradeNameAr: nn(f.tradeNameAr),
      unifiedNumber: nn(f.unifiedNumber), crNumber: nn(f.crNumber),
      vatRegistered: f.vatRegistered, vatNumber: nn(f.vatNumber), vatEffectiveFrom: nn(f.vatEffectiveFrom),
      address, phone: nn(f.phone), email: nn(f.email) ?? '', website: nn(f.website), bankName: nn(f.bankName), iban: ibanClean || null, bankAccountName: nn(f.bankAccountName), bankAccountNumber: nn(f.bankAccountNumber)?.replace(/\s+/g, '') ?? null,
      representativeName: nn(f.representativeName), representativeTitle: nn(f.representativeTitle), representativeMobile: nn(f.representativeMobile),
      quoteDefaults, approvalPolicy: f.approvalPolicy,
    };
    try {
      await api.put('/settings/company', body);
      toast.success(bi('تم حفظ بيانات المنشأة', 'Company profile saved'));
      qc.invalidateQueries({ queryKey: ['settings-company'] });
      refetch();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title={bi('بيانات المنشأة', 'Company profile')} subtitle={bi('تظهر في عروض الأسعار والعقود والفواتير', 'Shown on quotes, contracts and invoices')} />
      <form onSubmit={save} className="space-y-4">
        <Card title={bi('الهوية النظامية', 'Legal identity')}>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={bi('الاسم القانوني بالعربية *', 'Legal name (Arabic) *')}><Input required minLength={2} value={f.legalNameAr} onChange={(e) => set('legalNameAr', e.target.value)} /></Field>
            <Field label="Legal name (English)"><Input dir="ltr" value={s(f.legalNameEn)} onChange={(e) => set('legalNameEn', e.target.value)} /></Field>
            <Field label={bi('الاسم التجاري', 'Trade name')}><Input value={s(f.tradeNameAr)} onChange={(e) => set('tradeNameAr', e.target.value)} /></Field>
            <Field label={bi('الرقم الموحد (7xxxxxxxxx)', 'Unified number (7xxxxxxxxx)')} error={errs.unifiedNumber}><Input dir="ltr" inputMode="numeric" maxLength={10} value={s(f.unifiedNumber)} onChange={(e) => set('unifiedNumber', e.target.value.trim())} /></Field>
            <Field label={bi('رقم السجل التجاري', 'Commercial registration (CR) number')}><Input dir="ltr" inputMode="numeric" value={s(f.crNumber)} onChange={(e) => set('crNumber', e.target.value.trim())} /></Field>
          </div>
        </Card>

        <Card title={bi('ضريبة القيمة المضافة', 'VAT')}>
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
              <span className="block text-sm font-bold">{f.vatRegistered ? bi('المنشأة مسجلة في ضريبة القيمة المضافة', 'The company is registered for VAT') : bi('المنشأة غير مسجلة في ضريبة القيمة المضافة', 'The company is not registered for VAT')}</span>
              <span className="block text-xs text-muted">{bi('عند الإيقاف: لا تُضاف الضريبة إلى عروض الأسعار والعقود، وتصدر الفواتير كـ«فاتورة» عادية بلا رقم ضريبي ولا رمز QR، مع عبارة «البائع غير مسجل في ضريبة القيمة المضافة» (نفس وضع «غير مسجل» في الأداة القديمة).', 'When off: no VAT is added to quotes and contracts, and invoices are issued as a plain “Invoice” with no VAT number and no QR code, with the note “Seller not registered for VAT” (same as the “not registered” mode in the old tool).')}</span>
            </span>
          </label>
          {f.vatRegistered && (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Field label={bi('الرقم الضريبي *', 'VAT number *')} error={errs.vatNumber} hint={bi('15 رقمًا يبدأ وينتهي بالرقم 3', '15 digits starting and ending with 3')}><Input dir="ltr" inputMode="numeric" maxLength={15} value={s(f.vatNumber)} onChange={(e) => set('vatNumber', e.target.value.trim())} /></Field>
              <Field label={bi('تاريخ سريان التسجيل', 'Registration effective date')}><Input type="date" value={s(f.vatEffectiveFrom)} onChange={(e) => set('vatEffectiveFrom', e.target.value)} /></Field>
            </div>
          )}
        </Card>

        <Card title={bi('العنوان الوطني والتواصل', 'National address & contact')}>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Field label={bi('رقم المبنى', 'Building number')} error={errs.buildingNumber}><Input dir="ltr" inputMode="numeric" maxLength={4} value={s(f.address.buildingNumber)} onChange={(e) => setAddr('buildingNumber', e.target.value.trim())} /></Field>
            <Field label={bi('الشارع', 'Street')}><Input value={s(f.address.street)} onChange={(e) => setAddr('street', e.target.value)} /></Field>
            <Field label={bi('الحي', 'District')}><Input value={s(f.address.district)} onChange={(e) => setAddr('district', e.target.value)} /></Field>
            <Field label={bi('المدينة', 'City')}><Input value={s(f.address.city)} onChange={(e) => setAddr('city', e.target.value)} /></Field>
            <Field label={bi('الرمز البريدي', 'Postal code')} error={errs.postalCode}><Input dir="ltr" inputMode="numeric" maxLength={5} value={s(f.address.postalCode)} onChange={(e) => setAddr('postalCode', e.target.value.trim())} /></Field>
            <Field label={bi('الرقم الإضافي', 'Additional number')} error={errs.additionalNumber}><Input dir="ltr" inputMode="numeric" maxLength={4} value={s(f.address.additionalNumber)} onChange={(e) => setAddr('additionalNumber', e.target.value.trim())} /></Field>
            <Field label={bi('الهاتف', 'Phone')}><Input dir="ltr" inputMode="tel" value={s(f.phone)} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label={bi('البريد الإلكتروني', 'Email')} error={errs.email}><Input dir="ltr" type="email" value={s(f.email)} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label={bi('الموقع الإلكتروني', 'Website')}><Input dir="ltr" value={s(f.website)} onChange={(e) => set('website', e.target.value)} /></Field>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={bi('الحساب البنكي', 'Bank account')}>
            <div className="grid gap-3">
              <Field label={bi('اسم البنك', 'Bank name')}><Input value={s(f.bankName)} onChange={(e) => set('bankName', e.target.value)} /></Field>
              <Field label={bi('اسم صاحب الحساب (المستفيد)', 'Account holder (beneficiary)')} hint={bi('اتركه فارغًا لاستخدام اسم المنشأة', 'Leave empty to use the company name')}><Input value={s(f.bankAccountName)} onChange={(e) => set('bankAccountName', e.target.value)} /></Field>
              <Field label={bi('رقم الحساب', 'Account number')}><Input dir="ltr" inputMode="numeric" value={s(f.bankAccountNumber)} onChange={(e) => set('bankAccountNumber', e.target.value)} /></Field>
              <Field label={bi('رقم الآيبان (IBAN)', 'IBAN')} error={errs.iban} hint={bi('SA + 22 رقمًا', 'SA + 22 digits')}><Input dir="ltr" value={s(f.iban)} onChange={(e) => set('iban', e.target.value.toUpperCase())} placeholder="SA00 0000 0000 0000 0000 0000" /></Field>
            </div>
          </Card>
          <Card title={bi('الممثل النظامي (يظهر في العقود)', 'Authorized representative (shown on contracts)')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={bi('الاسم', 'Name')}><Input value={s(f.representativeName)} onChange={(e) => set('representativeName', e.target.value)} /></Field>
              <Field label={bi('الصفة', 'Title')}><Input value={s(f.representativeTitle)} onChange={(e) => set('representativeTitle', e.target.value)} placeholder={bi('المدير العام', 'General Manager')} /></Field>
              <Field label={bi('الجوال', 'Mobile')}><Input dir="ltr" inputMode="tel" value={s(f.representativeMobile)} onChange={(e) => set('representativeMobile', e.target.value)} placeholder="05XXXXXXXX" /></Field>
            </div>
          </Card>
        </div>

        <Card title={bi('الإعدادات الافتراضية لعروض الأسعار', 'Quote defaults')}>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={bi('مدة صلاحية العرض (يوم)', 'Quote validity (days)')} error={errs.validityDays}>
              <Input type="number" min={1} max={365} value={f.quoteDefaults.validityDays ?? ''} onChange={(e) => setQd('validityDays', e.target.value === '' ? undefined : Number(e.target.value))} />
            </Field>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Field label={bi('الملاحظات الفنية', 'Technical notes')}><Textarea rows={5} value={s(f.quoteDefaults.notesAr)} onChange={(e) => setQd('notesAr', e.target.value)} /></Field>
            <Field label={bi('الشروط والأحكام', 'Terms and conditions')}><Textarea rows={5} value={s(f.quoteDefaults.termsAr)} onChange={(e) => setQd('termsAr', e.target.value)} /></Field>
            <Field label="Terms & conditions (English)"><Textarea rows={4} dir="ltr" value={s(f.quoteDefaults.termsEn)} onChange={(e) => setQd('termsEn', e.target.value)} /></Field>
            <Field label={bi('نص الضمان', 'Warranty text')}><Textarea rows={4} value={s(f.quoteDefaults.warrantyText)} onChange={(e) => setQd('warrantyText', e.target.value)} /></Field>
          </div>
        </Card>

        <Card title={bi('سياسة الاعتماد', 'Approval policy')}>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Field label={bi('أقصى خصم بلا اعتماد (%)', 'Max discount without approval (%)')} error={errs.maxDiscount}><Input type="number" min={0} max={100} step="0.1" value={f.approvalPolicy.maxDiscountPercent} onChange={(e) => setAp('maxDiscountPercent', Number(e.target.value) || 0)} /></Field>
            <Field label={bi('أدنى هامش ربح (%)', 'Minimum profit margin (%)')} error={errs.minMargin}><Input type="number" min={-100} max={100} step="0.1" value={f.approvalPolicy.minMarginPercent} onChange={(e) => setAp('minMarginPercent', Number(e.target.value) || 0)} /></Field>
          </div>
          <p className="mt-2 text-xs text-muted">{bi('العرض الذي يتجاوز الخصم المسموح أو يقل هامشه عن الحد الأدنى يُحوَّل للاعتماد قبل الإرسال. لكل دور أيضًا حد خصم خاص به في شاشة الأدوار.', 'A quote that exceeds the allowed discount or falls below the minimum margin is sent for approval before it goes out. Each role also has its own discount limit on the Roles screen.')}</p>
        </Card>

        <ErrorBox error={error} />
        <div className="sticky bottom-0 z-10 -mx-1 flex justify-end bg-gradient-to-t from-white/95 to-white/0 px-1 py-3">
          <Button loading={busy} icon={<Save className="size-4" />}>{bi('حفظ بيانات المنشأة', 'Save company profile')}</Button>
        </div>
      </form>

      <div className="mt-2 grid gap-4 lg:grid-cols-2">
        <ImageUpload kind="logo" title={bi('الشعار', 'Logo')} fileId={q.data.logoFileId} note={bi('يظهر في رأس عروض الأسعار والعقود والفواتير.', 'Shown in the header of quotes, contracts and invoices.')} />
        <ImageUpload kind="bank_qr" title={bi('رمز QR للحساب البنكي', 'Bank account QR')} fileId={q.data.bankQrFileId} note={bi('صورة رمز QR من تطبيق البنك، تُطبع مع بيانات الحساب في طلبات الدفع. إن لم تُرفع يُطبع رمز QR يحتوي رقم الآيبان.', 'The QR image from your bank app, printed with the account details on payment requests. Without it, a QR containing the IBAN is printed.')} />
        <ImageUpload kind="stamp" title={bi('الختم', 'Stamp')} fileId={q.data.stampFileId} note={bi('لا يُطبع الختم تلقائيًا أبدًا: يُضاف فقط عندما يطبع مستخدم مخوَّل (صلاحية «طباعة العقد بالختم») نسخة مختومة من العقد صراحةً، ويُسجَّل ذلك في سجل التدقيق.', 'The stamp is never printed automatically: it is added only when an authorized user (the “print contract with stamp” permission) explicitly prints a stamped copy of the contract, and this is recorded in the audit log.')} />
      </div>

      <Branches branches={q.data.branches} />
    </>
  );
}

function ImageUpload({ kind, title, fileId, note }: { kind: 'logo' | 'stamp' | 'bank_qr'; title: string; fileId: string | null; note: string }) {
  const { bi } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError(new Error(bi('الصيغة المسموحة: PNG أو JPEG', 'Allowed formats: PNG or JPEG'))); return; }
    if (file.size > 2_000_000) { setError(new Error(bi('حجم الصورة أكبر من 2 ميجابايت', 'The image is larger than 2 MB'))); return; }
    setBusy(true);
    try {
      const dataBase64 = await readFileBase64(file);
      await api.post(`/settings/company/${kind}`, { filename: file.name, mime: file.type, dataBase64 });
      toast.success(kind === 'logo' ? bi('تم رفع الشعار', 'Logo uploaded') : kind === 'stamp' ? bi('تم رفع الختم', 'Stamp uploaded') : bi('تم رفع رمز QR', 'QR uploaded'));
      qc.invalidateQueries({ queryKey: ['settings-company'] });
    } catch (e) { setError(e); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <Card title={title} actions={<>
      <input ref={ref} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      <Button size="sm" variant="outline" loading={busy} icon={<ImageUp className="size-4" />} onClick={() => ref.current?.click()}>{fileId ? bi('تغيير', 'Change') : bi('رفع', 'Upload')}</Button>
    </>}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="grid h-28 w-full shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-line bg-[repeating-conic-gradient(#f3f4f6_0_25%,#fff_0_50%)] bg-[length:16px_16px] sm:w-44">
          {fileId
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`/api/files/${fileId}`} alt={title} className="max-h-full max-w-full object-contain" />
            : <span className="text-xs text-muted">{bi('لا توجد صورة', 'No image')}</span>}
        </div>
        <p className="text-xs leading-relaxed text-muted">{note}<br />{bi('PNG أو JPEG بحجم أقصى 2 ميجابايت (يُفضَّل PNG بخلفية شفافة).', 'PNG or JPEG, up to 2 MB (PNG with a transparent background is preferred).')}</p>
      </div>
      <div className="mt-2"><ErrorBox error={error} /></div>
    </Card>
  );
}

const emptyBranch = { code: '', nameAr: '', nameEn: '', isHeadOffice: false, city: '', zatcaEgsUnit: '' };

function Branches({ branches }: { branches: Branch[] }) {
  const { t, bi } = useI18n();
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
      toast.success(bi('تم حفظ الفرع', 'Branch saved'));
      qc.invalidateQueries({ queryKey: ['settings-company'] });
      setEdit(null);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Card title={bi('الفروع', 'Branches')} className="mt-4" padded={false} actions={<Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => open(null)}>{bi('فرع جديد', 'New branch')}</Button>}>
      {branches.length === 0 ? <p className="p-4 text-sm text-muted">{bi('لا توجد فروع بعد.', 'No branches yet.')}</p> : (
        <Table>
          <thead><tr><Th>{bi('الرمز', 'Code')}</Th><Th>{bi('الاسم', 'Name')}</Th><Th>{bi('المدينة', 'City')}</Th><Th /><Th /></tr></thead>
          <tbody>
            {branches.map((br) => (
              <tr key={br.id} className="hover:bg-tint/50">
                <Td className="num" ><span dir="ltr">{br.code}</span></Td>
                <Td><div className="font-bold">{br.nameAr}</div>{br.nameEn && <div className="text-xs text-muted" dir="ltr">{br.nameEn}</div>}</Td>
                <Td className="text-muted">{br.address?.city ?? '—'}</Td>
                <Td>{br.isHeadOffice && <Badge tone="gold">{bi('المركز الرئيسي', 'Head office')}</Badge>}</Td>
                <Td className="text-end"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => open(br)}>{t('common.edit')}</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id === 'new' ? bi('فرع جديد', 'New branch') : bi('تعديل الفرع', 'Edit branch')} footer={<>
        <Button variant="outline" onClick={() => setEdit(null)}>{t('common.cancel')}</Button>
        <Button loading={busy} disabled={!b.code.trim() || !b.nameAr.trim()} onClick={save}>{t('common.save')}</Button>
      </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={bi('الرمز *', 'Code *')}><Input dir="ltr" value={b.code} onChange={(e) => setB({ ...b, code: e.target.value })} placeholder="RUH" /></Field>
          <Field label={bi('المدينة', 'City')}><Input value={b.city} onChange={(e) => setB({ ...b, city: e.target.value })} /></Field>
          <Field label={bi('الاسم بالعربية *', 'Name (Arabic) *')}><Input value={b.nameAr} onChange={(e) => setB({ ...b, nameAr: e.target.value })} /></Field>
          <Field label="Name (English)"><Input dir="ltr" value={b.nameEn} onChange={(e) => setB({ ...b, nameEn: e.target.value })} /></Field>
          <Field label={bi('وحدة الفوترة الإلكترونية (EGS)', 'E-invoicing unit (EGS)')} hint={bi('اختياري — للمرحلة الثانية من زاتكا', 'Optional — for ZATCA Phase 2')} className="sm:col-span-2"><Input dir="ltr" value={b.zatcaEgsUnit} onChange={(e) => setB({ ...b, zatcaEgsUnit: e.target.value })} /></Field>
        </div>
        <div className="mt-3"><Checkbox label={bi('المركز الرئيسي', 'Head office')} checked={b.isHeadOffice} onChange={(v) => setB({ ...b, isHeadOffice: v })} /></div>
        <div className="mt-3"><ErrorBox error={error} /></div>
      </Dialog>
      <div className="p-3"><InfoNote>{bi('يُربط كل مستخدم بفرع، وتُستخدم الفروع لنطاق الصلاحيات «الفرع».', 'Each user is linked to a branch, and branches are used for the “Branch” permission scope.')}</InfoNote></div>
    </Card>
  );
}
