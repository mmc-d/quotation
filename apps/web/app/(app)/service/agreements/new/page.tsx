'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { addMonths, AGREEMENT_TIERS, BILLING_FREQUENCIES, billingSchedule, TIER_DEFAULTS, toHalalas, type AgreementTier } from '@mmc/domain';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { today } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { PartyPicker, type PickedParty } from '@/components/party-picker';
import { Button, Card, Checkbox, clsx, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { errMsg } from '../../../quotes/_components/common';
import { addDays, DeviceRef, Ltr, usePartySites, useLabel } from '../../../field/_components/common';
import type { AssetRow } from '../../../field/_components/types';
import { BILLING_LABEL, COVERAGE_WINDOW } from '../../_components/common';
import type { AgreementView } from '../../_components/types';

interface FormState {
  siteIds: string[]; explicit: boolean; assetIds: string[];
  tier: AgreementTier; responseHours: string; resolutionHours: string; coverage: 'business' | '24x7'; visitsPerYear: string; partsIncluded: boolean;
  startDate: string; endDate: string; price: string; billingFrequency: keyof typeof BILLING_FREQUENCIES; vatOn: boolean; autoRenew: boolean; upliftPercent: string; notes: string;
}

const oneYear = (start: string) => addDays(addMonths(start, 12), -1);

function blank(): FormState {
  const t = TIER_DEFAULTS.standard;
  const start = today();
  return {
    siteIds: [], explicit: false, assetIds: [], tier: 'standard', responseHours: String(t.responseHours), resolutionHours: String(t.resolutionHours), coverage: t.coverage, visitsPerYear: String(t.visitsPerYear),
    partsIncluded: false, startDate: start, endDate: oneYear(start), price: '', billingFrequency: 'annual', vatOn: true, autoRenew: false, upliftPercent: '0', notes: '',
  };
}

function fromView(a: AgreementView): FormState {
  return {
    siteIds: a.siteIds, explicit: a.assetIds.length > 0, assetIds: a.assetIds, tier: (a.tier as AgreementTier) ?? 'standard',
    responseHours: String(a.responseHours), resolutionHours: String(a.resolutionHours), coverage: a.coverage, visitsPerYear: String(a.visitsPerYear), partsIncluded: a.partsIncluded,
    startDate: a.startDate, endDate: a.endDate, price: a.price, billingFrequency: a.billingFrequency as FormState['billingFrequency'], vatOn: a.vatOn, autoRenew: a.autoRenew, upliftPercent: String(a.upliftPercent), notes: a.notes ?? '',
  };
}

function AgreementForm() {
  const sp = useSearchParams();
  const editId = sp.get('edit');
  const presetParty = sp.get('partyId');
  const { bi, locale } = useI18n();
  const label = useLabel();
  const { can, me } = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const [party, setParty] = useState<PickedParty | null>(null);
  const [f, setF] = useState<FormState>(blank);
  const [loaded, setLoaded] = useState(!editId);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const vatRegistered = me?.company?.vatRegistered !== false;

  const existing = useQuery({ queryKey: ['agreement', editId], queryFn: () => api.get<AgreementView>(`/service/agreements/${editId}`), enabled: !!editId });
  useEffect(() => {
    const a = existing.data;
    if (!a || loaded) return;
    setF(fromView(a));
    if (a.party) setParty({ id: a.party.id, nameAr: a.party.nameAr, nameEn: a.party.nameEn, phone: a.party.phone, email: null, vatNumber: null });
    setLoaded(true);
  }, [existing.data, loaded]);

  const preset = useQuery({ queryKey: ['party', presetParty], queryFn: () => api.get<PickedParty>(`/parties/${presetParty}`), enabled: !!presetParty && !editId });
  useEffect(() => { if (preset.data && !party) setParty(preset.data); }, [preset.data, party]);

  const sites = usePartySites(party?.id);
  const canAssets = can('asset.read');
  const deviceQs = useQueries({
    queries: (f.explicit && canAssets ? f.siteIds : []).map((sid) => ({
      queryKey: ['field-assets', 'site', sid, 'active'],
      queryFn: () => api.get<{ rows: AssetRow[]; total: number }>(`/field/assets${qs({ siteId: sid, status: 'active', limit: 200 })}`),
      staleTime: 60_000,
    })),
  });

  const pickParty = (p: PickedParty | null) => { setParty(p); setF((cur) => ({ ...cur, siteIds: [], assetIds: [] })); };
  const pickTier = (tier: AgreementTier) => {
    const t = TIER_DEFAULTS[tier];
    setF((cur) => ({ ...cur, tier, responseHours: String(t.responseHours), resolutionHours: String(t.resolutionHours), coverage: t.coverage, visitsPerYear: String(t.visitsPerYear) }));
  };
  const toggleSite = (id: string) => setF((cur) => {
    const on = cur.siteIds.includes(id);
    return { ...cur, siteIds: on ? cur.siteIds.filter((x) => x !== id) : [...cur.siteIds, id] };
  });
  const toggleAsset = (id: string) => setF((cur) => ({ ...cur, assetIds: cur.assetIds.includes(id) ? cur.assetIds.filter((x) => x !== id) : [...cur.assetIds, id] }));

  // keep explicit devices limited to the chosen sites
  const siteAssetIds = useMemo(() => new Set(deviceQs.flatMap((d) => (d.data?.rows ?? []).map((a) => a.id))), [deviceQs]);
  const devicesLoaded = deviceQs.every((d) => !d.isLoading);

  const priceOk = /^\d+(\.\d{1,2})?$/.test(f.price.trim());
  const schedule = useMemo(() => {
    if (!priceOk || !f.startDate || !f.endDate || f.endDate < f.startDate) return [];
    try { return billingSchedule(f.startDate, f.endDate, toHalalas(f.price.trim()), f.billingFrequency); } catch { return []; }
  }, [priceOk, f.price, f.startDate, f.endDate, f.billingFrequency]);

  const resp = Number(f.responseHours);
  const reso = Number(f.resolutionHours);
  const problems: string[] = [];
  if (!party) problems.push(bi('اختر العميل', 'Choose the customer'));
  if (!f.siteIds.length) problems.push(bi('اختر موقعًا واحدًا على الأقل', 'Choose at least one site'));
  if (f.explicit && devicesLoaded && !f.assetIds.filter((x) => siteAssetIds.has(x)).length) problems.push(bi('اختر جهازًا واحدًا على الأقل أو ألغِ تحديد الأجهزة', 'Choose at least one device or untick “specific devices”'));
  if (!f.startDate || !f.endDate || f.endDate < f.startDate) problems.push(bi('تاريخ النهاية قبل البداية', 'End date is before the start date'));
  if (!priceOk) problems.push(bi('أدخل قيمة العقد', 'Enter the agreement price'));
  if (!(resp >= 1) || !(reso >= 1)) problems.push(bi('أدخل ساعات الاستجابة والحل', 'Enter response and resolution hours'));
  else if (reso < resp) problems.push(bi('ساعات الحل يجب ألا تقل عن ساعات الاستجابة', 'Resolution hours must be at least the response hours'));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        partyId: party!.id, siteIds: f.siteIds, assetIds: f.explicit ? f.assetIds.filter((x) => siteAssetIds.has(x)) : [],
        tier: f.tier, startDate: f.startDate, endDate: f.endDate, visitsPerYear: Number(f.visitsPerYear) || 0, responseHours: resp, resolutionHours: reso, coverage: f.coverage,
        partsIncluded: f.partsIncluded, price: f.price.trim(), billingFrequency: f.billingFrequency, vatOn: vatRegistered && f.vatOn, autoRenew: f.autoRenew,
        upliftPercent: Number(f.upliftPercent) || 0, notes: f.notes.trim() || null,
      };
      return editId ? api.put<AgreementView>(`/service/agreements/${editId}`, { ...body, version: existing.data?.version }) : api.post<AgreementView>('/service/agreements', body);
    },
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['agreements'] });
      qc.setQueryData(['agreement', a.id], a);
      toast.success(editId ? bi('تم حفظ العقد', 'Agreement saved') : bi(`تم إنشاء العقد ${a.number}`, `Agreement ${a.number} created`));
      router.push(`/service/agreements/${a.id}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (!can('agreement.write')) return <ErrorBox error={new Error(bi('لا تملك صلاحية إنشاء عقود الصيانة', 'You cannot create service agreements'))} />;
  if (editId && (existing.isLoading || !loaded)) return existing.error ? <ErrorBox error={existing.error} /> : <Spinner />;
  if (editId && existing.data && existing.data.status !== 'draft') return <ErrorBox error={new Error(bi('يمكن تعديل المسودات فقط', 'Only draft agreements can be edited'))} />;

  return (
    <>
      <PageHeader
        back={editId ? `/service/agreements/${editId}` : '/service/agreements'}
        title={editId ? <>{bi('تعديل العقد', 'Edit agreement')} <Ltr>{existing.data?.number}</Ltr></> : bi('عقد صيانة جديد', 'New service agreement')}
        subtitle={bi('يُحفظ كمسودة؛ عند التفعيل تُنشأ الزيارات الوقائية وطلبات الدفع.', 'Saved as a draft; activating it creates the preventive visits and payment requests.')}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={bi('العميل والتغطية', 'Customer & coverage')}>
            <div className="grid gap-3">
              <Field label={bi('العميل *', 'Customer *')}><PartyPicker value={party} onChange={pickParty} /></Field>
              <div>
                <span className="mb-1 block text-xs font-bold text-gold-dark">{bi('المواقع المشمولة *', 'Covered sites *')}</span>
                {!party ? <p className="text-sm text-muted">{bi('اختر العميل أولًا', 'Pick the customer first')}</p> : sites.isLoading ? <Spinner /> : (sites.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted">{bi('لا توجد مواقع لهذا العميل — أضفها من صفحة العميل.', 'This customer has no sites — add them on the customer page.')}</p>
                ) : (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {sites.data!.map((s) => (
                      <label key={s.id} className={clsx('flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition', f.siteIds.includes(s.id) ? 'border-gold bg-tint/60' : 'border-line hover:bg-tint/40')}>
                        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" checked={f.siteIds.includes(s.id)} onChange={() => toggleSite(s.id)} />
                        <span><span className="font-bold">{s.name}</span>{(s.city || s.district) && <span className="block text-xs text-muted">{[s.district, s.city].filter(Boolean).join('، ')}</span>}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {canAssets && f.siteIds.length > 0 && (
                <div className="rounded-lg border border-line p-3">
                  <Checkbox label={bi('أجهزة محددة فقط (وإلا تُشمل كل الأجهزة الفعالة في المواقع)', 'Specific devices only (otherwise every active device on the sites)')} checked={f.explicit} onChange={(v) => set('explicit', v)} />
                  {f.explicit && (
                    <div className="mt-3 max-h-80 space-y-3 overflow-y-auto">
                      {f.siteIds.map((sid, i) => {
                        const d = deviceQs[i];
                        const site = sites.data?.find((s) => s.id === sid);
                        const rows = d?.data?.rows ?? [];
                        const allOn = rows.length > 0 && rows.every((a) => f.assetIds.includes(a.id));
                        return (
                          <div key={sid}>
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-xs font-extrabold text-primary">{site?.name ?? '—'}</span>
                              {rows.length > 0 && (
                                <button type="button" className="text-xs font-bold text-gold-dark hover:underline" onClick={() => setF((cur) => ({ ...cur, assetIds: allOn ? cur.assetIds.filter((x) => !rows.some((a) => a.id === x)) : [...new Set([...cur.assetIds, ...rows.map((a) => a.id)])] }))}>
                                  {allOn ? bi('إلغاء الكل', 'Clear all') : bi('تحديد الكل', 'Select all')}
                                </button>
                              )}
                            </div>
                            {d?.isLoading ? <Spinner /> : rows.length === 0 ? <p className="text-xs text-muted">{bi('لا توجد أجهزة فعالة مسجلة في هذا الموقع', 'No active devices registered on this site')}</p> : (
                              <ul className="divide-y divide-line/60 rounded-lg border border-line/70">
                                {rows.map((a) => (
                                  <li key={a.id}>
                                    <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-tint/40">
                                      <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={f.assetIds.includes(a.id)} onChange={() => toggleAsset(a.id)} />
                                      <DeviceRef code={a.code} serial={a.serial} className="font-bold" />
                                      <span className="truncate text-muted">{a.description ?? ''}</span>
                                      {a.locationPath && <Ltr className="ms-auto text-muted">{a.locationPath}</Ltr>}
                                    </label>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {f.explicit && <p className="mt-2 text-xs text-muted">{bi(`المحدد: ${f.assetIds.filter((x) => siteAssetIds.has(x)).length} جهاز`, `Selected: ${f.assetIds.filter((x) => siteAssetIds.has(x)).length} devices`)}</p>}
                </div>
              )}
            </div>
          </Card>

          <Card title={bi('الباقة ومستوى الخدمة', 'Tier & service level')}>
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              {AGREEMENT_TIERS.map((k) => {
                const t = TIER_DEFAULTS[k];
                return (
                  <button key={k} type="button" onClick={() => pickTier(k)} className={clsx('rounded-lg border px-3 py-2 text-start transition', f.tier === k ? 'border-gold bg-tint ring-2 ring-gold/20' : 'border-line hover:bg-tint/40')}>
                    <div className="font-extrabold text-primary">{locale === 'en' ? t.en : t.ar}</div>
                    <div className="text-xs text-muted">
                      {bi(`استجابة ${t.responseHours} س · حل ${t.resolutionHours} س`, `Response ${t.responseHours} h · resolution ${t.resolutionHours} h`)}<br />
                      {label(COVERAGE_WINDOW, t.coverage)} · {bi(`${t.visitsPerYear} زيارات/سنة`, `${t.visitsPerYear} visits/yr`)}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={bi('زمن الاستجابة (ساعات)', 'Response time (hours)')}><Input type="number" min={1} max={720} dir="ltr" className="text-start" value={f.responseHours} onChange={(e) => set('responseHours', e.target.value)} /></Field>
              <Field label={bi('زمن الحل (ساعات)', 'Resolution time (hours)')}><Input type="number" min={1} max={2160} dir="ltr" className="text-start" value={f.resolutionHours} onChange={(e) => set('resolutionHours', e.target.value)} /></Field>
              <Field label={bi('نافذة التغطية', 'Coverage window')} hint={f.coverage === 'business' ? bi('08:00–17:00 في أيام العمل حسب تقويم المنشأة', '08:00–17:00 on working days of the company calendar') : undefined}>
                <Select value={f.coverage} onChange={(e) => set('coverage', e.target.value as FormState['coverage'])}>
                  {Object.keys(COVERAGE_WINDOW).map((k) => <option key={k} value={k}>{label(COVERAGE_WINDOW, k)}</option>)}
                </Select>
              </Field>
              <Field label={bi('زيارات وقائية في السنة', 'Preventive visits per year')}><Input type="number" min={0} max={52} dir="ltr" className="text-start" value={f.visitsPerYear} onChange={(e) => set('visitsPerYear', e.target.value)} /></Field>
            </div>
            <div className="mt-3"><Checkbox label={bi('قطع الغيار مشمولة (وإلا العمالة فقط)', 'Parts included (otherwise labour only)')} checked={f.partsIncluded} onChange={(v) => set('partsIncluded', v)} /></div>
          </Card>

          <Card title={bi('ملاحظات', 'Notes')}>
            <Textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder={bi('شروط خاصة، استثناءات…', 'Special terms, exclusions…')} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={bi('المدة والقيمة', 'Term & price')}>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label={bi('البداية', 'Start')}><Input type="date" dir="ltr" value={f.startDate} onChange={(e) => { const v = e.target.value; setF((cur) => ({ ...cur, startDate: v, endDate: v && (!cur.endDate || cur.endDate === oneYear(cur.startDate)) ? oneYear(v) : cur.endDate })); }} /></Field>
                <Field label={bi('النهاية', 'End')}><Input type="date" dir="ltr" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
              </div>
              <Field label={bi('قيمة العقد للمدة (ر.س، بدون ضريبة)', 'Price for the term (SAR, excl. VAT)')}><Input inputMode="decimal" dir="ltr" className="text-start" value={f.price} onChange={(e) => set('price', e.target.value)} placeholder="0.00" /></Field>
              <Field label={bi('دورية الفوترة', 'Billing frequency')}>
                <Select value={f.billingFrequency} onChange={(e) => set('billingFrequency', e.target.value as FormState['billingFrequency'])}>
                  {Object.keys(BILLING_FREQUENCIES).map((k) => <option key={k} value={k}>{label(BILLING_LABEL, k)}</option>)}
                </Select>
              </Field>
              <Checkbox label={bi('تُضاف ضريبة القيمة المضافة 15%', 'Add 15% VAT')} checked={vatRegistered && f.vatOn} disabled={!vatRegistered} onChange={(v) => set('vatOn', v)} />
              {!vatRegistered && <p className="text-xs text-muted">{bi('المنشأة غير مسجلة في ضريبة القيمة المضافة', 'The company is not VAT-registered')}</p>}
              <Checkbox label={bi('تجديد تلقائي', 'Auto-renew')} checked={f.autoRenew} onChange={(v) => set('autoRenew', v)} />
              <Field label={bi('زيادة السعر عند التجديد %', 'Renewal uplift %')}><Input type="number" min={0} max={100} dir="ltr" className="text-start" value={f.upliftPercent} onChange={(e) => set('upliftPercent', e.target.value)} /></Field>
            </div>
          </Card>

          {schedule.length > 0 && (
            <Card title={bi('دفعات الفوترة (تقديري)', 'Billing periods (estimate)')}>
              <ul className="space-y-1 text-xs">
                {schedule.slice(0, 12).map((p) => (
                  <li key={p.from} className="flex items-center justify-between gap-2"><span dir="ltr" className="num">{p.from} → {p.to}</span><Money value={p.amount} fixed /></li>
                ))}
                {schedule.length > 12 && <li className="text-muted">… +<span className="num">{schedule.length - 12}</span></li>}
              </ul>
              <p className="mt-2 text-xs text-muted">{vatRegistered && f.vatOn ? bi('المبالغ قبل الضريبة؛ تُضاف 15% على كل دفعة.', 'Amounts before VAT; 15% is added to each period.') : bi('بدون ضريبة.', 'No VAT.')}</p>
            </Card>
          )}

          {problems.length > 0 && (
            <ul className="list-disc space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 py-2 pe-3 ps-7 text-xs text-amber-900">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          <Button className="w-full" icon={<Save className="size-4" />} loading={save.isPending} disabled={problems.length > 0} onClick={() => save.mutate()}>
            {editId ? bi('حفظ التعديلات', 'Save changes') : bi('حفظ كمسودة', 'Save as draft')}
          </Button>
        </div>
      </div>
    </>
  );
}

export default function NewAgreementPage() {
  return <Suspense fallback={<Spinner />}><AgreementForm /></Suspense>;
}
