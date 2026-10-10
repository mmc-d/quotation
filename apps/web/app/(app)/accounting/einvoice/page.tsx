'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, FileCode2, FileText, Play, Plus, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { api, openFile, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date } from '@/lib/format';
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Input, Money, PageHeader, Select, Spinner, Table, Tabs, Td, Th } from '@/components/ui';
import { ReasonDialog, errMsg } from '../../quotes/_components/common';
import { RequirePerm } from '../../settings/_components/common';

interface Unit {
  id: string; name: string; environment: 'sandbox' | 'simulation' | 'production'; serial: string | null; status: string; icvCounter: number;
  liveFrom: string | null; hasKey: boolean; hasComplianceCsid: boolean; hasProductionCsid: boolean;
  complianceResults: { kind: string; subtype: string; accepted: boolean; errors: string[]; warnings: string[] }[] | null;
}
interface Overview {
  enabled: boolean; ready: boolean; options: { zeroRatedReason?: string; zeroRatedReasonText?: string; paymentMeansCode?: string };
  checks: { key: string; ok: boolean; message: string }[]; units: Unit[]; documents: Record<string, number>; blockedInvoices: number;
}
interface Doc {
  id: string; number: string; typeCode: string; subtype: string; icv: number; issueDate: string; submission: string; status: string; attempts: number;
  lastError: string | null; submittedAt: string | null; invoiceId: string; total: string; customer: string | null;
}

const UNIT_STEPS: Record<string, [string, string]> = {
  draft: ['جديدة — بانتظار رمز OTP', 'New — needs an OTP'],
  csr_generated: ['طلب الشهادة لم يكتمل', 'CSR sent, not completed'],
  compliance_csid: ['شهادة الامتثال صادرة — شغّل الفحوصات', 'Compliance CSID — run the checks'],
  compliance_passed: ['اجتازت الفحوصات — اطلب شهادة الإنتاج', 'Checks passed — request the production CSID'],
  production: ['تعمل (شهادة الإنتاج)', 'Live (production CSID)'],
  revoked: ['موقوفة', 'Revoked'],
};
const CHECK: Record<string, [string, string]> = {
  registered: ['المنشأة مسجلة في ضريبة القيمة المضافة', 'The company is VAT-registered'],
  identity: ['هوية البائع والعنوان الوطني مكتملان', 'Seller identity and national address are complete'],
  erpnext: ['النظام هو محرك الفوترة (بلا ERPNext)', 'Core is the invoicing engine (no ERPNext)'],
  unit: ['توجد وحدة إصدار عاملة بشهادة إنتاج', 'A live EGS unit holds a production CSID'],
};
const TYPE: Record<string, [string, string]> = { '388': ['فاتورة ضريبية', 'Tax invoice'], '386': ['دفعة مقدمة', 'Prepayment'], '381': ['إشعار دائن', 'Credit note'], '383': ['إشعار مدين', 'Debit note'] };
const DOC_TONE: Record<string, 'gray' | 'gold' | 'green' | 'red' | 'blue'> = { pending: 'gold', error: 'red', rejected: 'red', cleared: 'green', reported: 'blue' };
const DOC_LABEL: Record<string, [string, string]> = { pending: ['بانتظار الإرسال', 'Pending'], error: ['تعذّر الاتصال — سيُعاد', 'Retrying'], rejected: ['مرفوضة', 'Rejected'], cleared: ['معتمدة', 'Cleared'], reported: ['مُبلَّغ عنها', 'Reported'] };

export default function EInvoicePage() {
  const { bi } = useI18n();
  return <RequirePerm perm="ledger.read" title={bi('الفوترة الإلكترونية — المرحلة الثانية', 'E-invoicing — Phase 2')}><Screen /></RequirePerm>;
}

function Screen() {
  const { bi } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const manage = can('einvoice.manage');
  const [tab, setTab] = useState<'documents' | 'setup' | 'blocked'>('documents');
  const ov = useQuery({ queryKey: ['einvoice-status'], queryFn: () => api.get<Overview>('/einvoice/status') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['einvoice-status'] }); void qc.invalidateQueries({ queryKey: ['einvoice-docs'] }); void qc.invalidateQueries({ queryKey: ['einvoice-blocked'] }); };
  const submit = useMutation({
    mutationFn: () => api.post<{ attempted: number; cleared: number; reported: number; rejected: number; failed: number; stoppedBy?: string }>('/einvoice/submit', {}),
    onSuccess: (r) => { toast.success(bi(`أُرسل ${r.attempted}: اعتماد ${r.cleared} · إبلاغ ${r.reported} · رفض ${r.rejected} · تعذّر ${r.failed}`, `Sent ${r.attempted}: cleared ${r.cleared}, reported ${r.reported}, rejected ${r.rejected}, failed ${r.failed}`)); if (r.stoppedBy) toast.warning(r.stoppedBy); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const verify = useMutation({
    mutationFn: () => api.get<{ checked: number; ok: boolean; problems: string[] }>('/einvoice/verify'),
    onSuccess: (r) => (r.ok ? toast.success(bi(`السلسلة سليمة — ${r.checked} مستند`, `Chain intact — ${r.checked} documents`)) : toast.error(r.problems.slice(0, 3).join(' · '))),
    onError: (e) => toast.error(errMsg(e)),
  });
  const o = ov.data;
  const live = o?.units.find((u) => u.status === 'production');
  const docs = o?.documents ?? {};
  return (
    <>
      <PageHeader title={bi('الفوترة الإلكترونية — المرحلة الثانية', 'E-invoicing — Phase 2')}
        subtitle={bi('توقيع الفواتير وإرسالها لهيئة الزكاة (اعتماد B2B وإبلاغ B2C) من داخل النظام. لا تعمل إلا بعد التسجيل في الضريبة وإشعار الهيئة.', 'Sign invoices and send them to ZATCA (B2B clearance, B2C reporting) from inside Core. Only applies once registered and notified.')}
        actions={<>
          {can('ledger.close') && <Button variant="outline" icon={<ShieldCheck className="size-4" />} loading={verify.isPending} onClick={() => verify.mutate()}>{bi('فحص السلسلة', 'Verify chain')}</Button>}
          {manage && <Button icon={<Play className="size-4" />} loading={submit.isPending} onClick={() => submit.mutate()}>{bi('إرسال المعلّق الآن', 'Send pending now')}</Button>}
        </>} />
      <ErrorBox error={ov.error} />
      {!o ? <Spinner /> : (
        <>
          <Card className="mb-4" title={bi('الحالة', 'Status')} actions={<Badge tone={o.enabled ? 'green' : 'gray'}>{o.enabled ? bi('مفعّلة', 'Enabled') : bi('متوقفة', 'Disabled')}</Badge>}>
            <div className="grid gap-4 md:grid-cols-2">
              <ul className="grid gap-1.5 text-sm">
                {o.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                    <span className={c.ok ? '' : 'font-bold'}>
                      {bi(...(CHECK[c.key] ?? [c.message, c.message]))}
                      {!c.ok && <span className="block text-xs font-normal text-muted" dir="ltr">{c.message}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                {(['pending', 'cleared', 'reported', 'rejected'] as const).map((k) => (
                  <div key={k} className="rounded-lg border border-line bg-white px-2 py-2">
                    <div className="num text-xl font-extrabold" dir="ltr">{docs[k] ?? 0}</div>
                    <div className="text-[11px] text-muted">{bi(DOC_LABEL[k]![0], DOC_LABEL[k]![1])}</div>
                  </div>
                ))}
              </div>
            </div>
            {live && <p className="mt-3 text-xs text-muted">{bi('الوحدة العاملة', 'Live unit')}: <b>{live.name}</b> · ICV <span className="num" dir="ltr">{live.icvCounter}</span> · {live.environment}</p>}
            {manage && <Enable o={o} onChanged={refresh} />}
          </Card>
          <Tabs value={tab} onChange={setTab} items={[
            { value: 'documents', label: bi('المستندات', 'Documents') },
            { value: 'blocked', label: `${bi('فواتير موقوفة', 'Blocked invoices')}${o.blockedInvoices ? ` (${o.blockedInvoices})` : ''}` },
            { value: 'setup', label: bi('وحدات الإصدار والتهيئة', 'Units & onboarding') },
          ]} />
          {tab === 'documents' && <Documents manage={manage} onChanged={refresh} />}
          {tab === 'blocked' && <Blocked manage={manage} onChanged={refresh} />}
          {tab === 'setup' && <Setup o={o} manage={manage} onChanged={refresh} />}
        </>
      )}
    </>
  );
}

function Enable({ o, onChanged }: { o: Overview; onChanged: () => void }) {
  const { bi } = useI18n();
  const [reason, setReason] = useState(o.options.zeroRatedReason ?? '');
  const [text, setText] = useState(o.options.zeroRatedReasonText ?? '');
  const [pm, setPm] = useState(o.options.paymentMeansCode ?? '1');
  const save = useMutation({
    mutationFn: (enabled: boolean) => api.put('/einvoice/settings', { enabled, zeroRatedReason: reason || null, zeroRatedReasonText: text || null, paymentMeansCode: pm }),
    onSuccess: (_r, enabled) => { toast.success(enabled ? bi('فُعّلت الفوترة الإلكترونية', 'E-invoicing enabled') : bi('أُوقفت الفوترة الإلكترونية', 'E-invoicing disabled')); onChanged(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="mt-4 grid gap-3 border-t border-line pt-3 sm:grid-cols-3">
      <Field label={bi('وسيلة الدفع الافتراضية على الفاتورة', 'Default payment means')}>
        <Select value={pm} onChange={(e) => setPm(e.target.value)}>
          <option value="1">{bi('غير محددة', 'Not specified')}</option><option value="10">{bi('نقدًا', 'Cash')}</option><option value="30">{bi('تحويل بنكي', 'Credit transfer')}</option>
          <option value="42">{bi('حساب بنكي', 'Bank account')}</option><option value="48">{bi('بطاقة', 'Card')}</option>
        </Select>
      </Field>
      <Field label={bi('كود سبب نسبة الصفر (VATEX-SA-…)', 'Zero-rating reason code')} hint={bi('مطلوب فقط للفواتير بلا ضريبة', 'Only needed for invoices without VAT')}>
        <Input dir="ltr" placeholder="VATEX-SA-32" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={bi('نص السبب', 'Reason text')}><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Export of goods" dir="ltr" /></Field>
      <div className="flex gap-2 sm:col-span-3">
        {o.enabled
          ? <><Button variant="outline" loading={save.isPending} onClick={() => save.mutate(true)}>{bi('حفظ الخيارات', 'Save options')}</Button><Button variant="danger" loading={save.isPending} onClick={() => save.mutate(false)}>{bi('إيقاف الفوترة الإلكترونية', 'Disable')}</Button></>
          : <Button loading={save.isPending} disabled={!o.ready} onClick={() => save.mutate(true)}>{bi('تفعيل الفوترة الإلكترونية', 'Enable e-invoicing')}</Button>}
      </div>
    </div>
  );
}

function Documents({ manage, onChanged }: { manage: boolean; onChanged: () => void }) {
  const { bi } = useI18n();
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['einvoice-docs', status], queryFn: () => api.get<{ rows: Doc[]; total: number }>(`/einvoice/documents${qs({ status: status || undefined, limit: 100 })}`) });
  const [reissue, setReissue] = useState<Doc | null>(null);
  const re = useMutation({
    mutationFn: (id: string) => api.post(`/einvoice/documents/${id}/reissue`, {}),
    onSuccess: () => { toast.success(bi('أُصدر مستند جديد بديل', 'Replacement document issued')); setReissue(null); onChanged(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Card padded={false} title={bi('سجل المستندات (بترتيب ICV)', 'Document register (ICV order)')} actions={
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto">
        <option value="">{bi('الكل', 'All')}</option>
        {Object.entries(DOC_LABEL).map(([k, v]) => <option key={k} value={k}>{bi(v[0], v[1])}</option>)}
      </Select>}>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : !q.data?.rows.length ? (
        <Empty icon={<FileCode2 className="size-8" />} title={bi('لا توجد مستندات بعد', 'No documents yet')} hint={bi('تُنشأ مع كل فاتورة بعد تفعيل الخدمة وجاهزية وحدة الإصدار.', 'One is created with every invoice once enabled and a unit is live.')} />
      ) : (
        <Table>
          <thead><tr><Th>ICV</Th><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('النوع', 'Type')}</Th><Th>{bi('العميل', 'Customer')}</Th><Th>{bi('التاريخ', 'Date')}</Th><Th className="text-end">{bi('الإجمالي', 'Total')}</Th><Th>{bi('الهيئة', 'ZATCA')}</Th><Th /></tr></thead>
          <tbody>
            {q.data.rows.map((d) => (
              <tr key={d.id} className="hover:bg-tint/50">
                <Td><span className="num font-bold" dir="ltr">{d.icv}</span></Td>
                <Td><span className="num" dir="ltr">{d.number}</span></Td>
                <Td>{bi(...(TYPE[d.typeCode] ?? [d.typeCode, d.typeCode]))}<div className="text-[11px] text-muted">{d.subtype === 'standard' ? bi('اعتماد (B2B)', 'Clearance (B2B)') : bi('إبلاغ (B2C)', 'Reporting (B2C)')}</div></Td>
                <Td>{d.customer ?? '—'}</Td>
                <Td><span className="num" dir="ltr">{date(d.issueDate)}</span></Td>
                <Td className="text-end"><Money value={d.total} /></Td>
                <Td>
                  <Badge tone={DOC_TONE[d.status] ?? 'gray'}>{bi(...(DOC_LABEL[d.status] ?? [d.status, d.status]))}</Badge>
                  {d.lastError && <div className="mt-1 max-w-64 text-[11px] text-danger">{d.lastError}</div>}
                </Td>
                <Td className="text-end">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" icon={<FileCode2 className="size-3.5" />} onClick={() => openFile(`/einvoice/documents/${d.id}/xml`)}>XML</Button>
                    <Button size="sm" variant="outline" icon={<FileText className="size-3.5" />} onClick={() => openFile(`/einvoice/documents/${d.id}/pdf`)}>PDF/A-3</Button>
                    {manage && d.status === 'rejected' && <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => setReissue(d)}>{bi('إعادة إصدار', 'Re-issue')}</Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={!!reissue} onClose={() => setReissue(null)} title={bi('إعادة إصدار مستند مرفوض', 'Re-issue a rejected document')}
        footer={<><Button variant="outline" onClick={() => setReissue(null)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={re.isPending} onClick={() => reissue && re.mutate(reissue.id)}>{bi('إعادة الإصدار', 'Re-issue')}</Button></>}>
        <p className="text-sm">{bi('يُنشأ مستند جديد بـ ICV وUUID جديدين لنفس الفاتورة بعد معالجة سبب الرفض. يبقى المستند المرفوض في السلسلة للأثر.', 'A new document (new ICV and UUID) is issued for the same invoice once the cause is fixed; the rejected one stays in the chain for the record.')}</p>
        {reissue?.lastError && <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-danger">{reissue.lastError}</p>}
      </Dialog>
    </Card>
  );
}

function Blocked({ manage, onChanged }: { manage: boolean; onChanged: () => void }) {
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['einvoice-blocked'], queryFn: () => api.get<{ id: string; number: string; typeCode: string; issueDate: string; error: string; customer: string | null }[]>('/einvoice/blocked') });
  const retry = useMutation({
    mutationFn: () => api.post<{ issued: number; blocked: number }>('/einvoice/issue-missing', {}),
    onSuccess: (r) => { toast.success(bi(`أُصدر ${r.issued} · ما زال موقوفًا ${r.blocked}`, `Issued ${r.issued} · still blocked ${r.blocked}`)); onChanged(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Card padded={false} title={bi('فواتير لا تقبلها الهيئة بعد', 'Invoices ZATCA would refuse')} actions={manage && <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={retry.isPending} onClick={() => retry.mutate()}>{bi('إعادة المحاولة', 'Retry')}</Button>}>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Spinner /> : !q.data?.length ? (
        <Empty icon={<CheckCircle2 className="size-8" />} title={bi('لا توجد فواتير موقوفة', 'Nothing is blocked')} />
      ) : (
        <Table>
          <thead><tr><Th>{bi('الرقم', 'Number')}</Th><Th>{bi('العميل', 'Customer')}</Th><Th>{bi('ما ينقص', 'What is missing')}</Th></tr></thead>
          <tbody>
            {q.data.map((b) => (
              <tr key={b.id}>
                <Td><span className="num" dir="ltr">{b.number}</span><div className="num text-[11px] text-muted" dir="ltr">{date(b.issueDate)}</div></Td>
                <Td>{b.customer ?? '—'}</Td>
                <Td><div className="flex items-start gap-1.5 text-xs"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-gold-dark" /><span>{b.error}</span></div></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="px-4 py-3 text-xs text-muted">{bi('الفاتورة الضريبية الموقوفة لا يمكن مشاركتها مع العميل. أكمل بيانات العميل أو المنشأة (عنوان الفوترة، الرقم الضريبي) ثم أعد المحاولة.', 'A blocked tax invoice cannot be shared with the customer. Complete the customer or company data (billing address, VAT number), then retry.')}</p>
    </Card>
  );
}

function Setup({ o, manage, onChanged }: { o: Overview; manage: boolean; onChanged: () => void }) {
  const { bi } = useI18n();
  const [create, setCreate] = useState(false);
  const [form, setForm] = useState({ name: '', environment: 'production' as 'simulation' | 'production' });
  const [otpFor, setOtpFor] = useState<Unit | null>(null);
  const [otp, setOtp] = useState('');
  const [revoke, setRevoke] = useState<Unit | null>(null);
  const [rehearsal, setRehearsal] = useState<{ passed: boolean; documents: { kind: string; subtype: string; accepted: boolean; errors: string[] }[] } | null>(null);
  const mk = useMutation({
    mutationFn: () => api.post('/einvoice/units', form),
    onSuccess: () => { toast.success(bi('أُنشئت الوحدة', 'Unit created')); setCreate(false); onChanged(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const sendOtp = useMutation({
    mutationFn: () => api.post(`/einvoice/units/${otpFor!.id}/otp`, { otp }),
    onSuccess: () => { toast.success(bi('صدرت شهادة الامتثال', 'Compliance CSID issued')); setOtpFor(null); setOtp(''); onChanged(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const step = useMutation({
    mutationFn: ({ id, what }: { id: string; what: 'compliance' | 'production' }) => api.post<{ passed?: boolean }>(`/einvoice/units/${id}/${what}`, {}),
    onSuccess: (r, v) => { if (v.what === 'compliance') (r.passed ? toast.success(bi('اجتازت الفحوصات الستة', 'All six checks passed')) : toast.error(bi('فشل بعض الفحوصات', 'Some checks failed'))); else toast.success(bi('الوحدة تعمل الآن', 'The unit is live')); onChanged(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const test = useMutation({
    mutationFn: () => api.post<NonNullable<typeof rehearsal> & { productionCsid: boolean }>('/einvoice/self-test', {}),
    onSuccess: (r) => { setRehearsal(r); (r.passed ? toast.success : toast.error)(r.passed ? bi('نجحت التجربة على بيئة الهيئة التجريبية', 'Sandbox rehearsal passed') : bi('فشلت التجربة', 'Rehearsal failed')); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <>
      <Card padded={false} title={bi('وحدات الإصدار (EGS)', 'EGS units')} actions={manage && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreate(true)}>{bi('وحدة جديدة', 'New unit')}</Button>}>
        {!o.units.length ? <Empty title={bi('لا توجد وحدات', 'No units')} hint={bi('أنشئ وحدة ثم أدخل رمز OTP من بوابة فاتورة (Fatoora).', 'Create a unit, then enter the OTP from the Fatoora portal.')} /> : (
          <Table>
            <thead><tr><Th>{bi('الوحدة', 'Unit')}</Th><Th>{bi('البيئة', 'Environment')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>ICV</Th><Th /></tr></thead>
            <tbody>
              {o.units.map((u) => (
                <tr key={u.id}>
                  <Td><b>{u.name}</b><div className="num text-[11px] text-muted" dir="ltr">{u.serial}</div></Td>
                  <Td><Badge tone={u.environment === 'production' ? 'green' : 'blue'}>{u.environment === 'production' ? bi('الإنتاج', 'Production') : bi('المحاكاة', 'Simulation')}</Badge></Td>
                  <Td>
                    <Badge tone={u.status === 'production' ? 'green' : u.status === 'revoked' ? 'red' : 'gold'}>{bi(...(UNIT_STEPS[u.status] ?? [u.status, u.status]))}</Badge>
                    {u.complianceResults && u.status !== 'production' && <div className="mt-1 text-[11px] text-muted">{u.complianceResults.filter((r) => r.accepted).length}/{u.complianceResults.length} {bi('فحوصات ناجحة', 'checks passed')}</div>}
                  </Td>
                  <Td><span className="num" dir="ltr">{u.icvCounter}</span></Td>
                  <Td className="text-end">
                    {manage && (
                      <div className="flex justify-end gap-1">
                        {['draft', 'csr_generated'].includes(u.status) && <Button size="sm" onClick={() => setOtpFor(u)}>{bi('إدخال OTP', 'Enter OTP')}</Button>}
                        {u.status === 'compliance_csid' && <Button size="sm" loading={step.isPending} onClick={() => step.mutate({ id: u.id, what: 'compliance' })}>{bi('تشغيل فحوصات الامتثال', 'Run compliance checks')}</Button>}
                        {u.status === 'compliance_passed' && <Button size="sm" loading={step.isPending} onClick={() => step.mutate({ id: u.id, what: 'production' })}>{bi('طلب شهادة الإنتاج', 'Request production CSID')}</Button>}
                        {u.status !== 'revoked' && <Button size="sm" variant="danger" onClick={() => setRevoke(u)}>{bi('إيقاف', 'Revoke')}</Button>}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {manage && (
        <Card className="mt-4" title={bi('تجربة على بيئة الهيئة التجريبية', 'Sandbox rehearsal')}>
          <p className="text-sm text-muted">{bi('تُشغّل المراحل كلها على بيئة الهيئة التجريبية برمز OTP المعلن وجهة اختبار الهيئة، ولا تكتب شيئًا ولا تستهلك رمزك. تثبت أن مستنداتنا تجتاز مدقّق الهيئة؛ ولا تثبت تسجيل منشأتك.', 'Runs the whole ladder against ZATCA’s sandbox with its published OTP and test taxpayer. It writes nothing and uses none of your OTPs. It proves our documents pass ZATCA’s validator — not that your company is onboarded.')}</p>
          <div className="mt-3"><Button variant="outline" loading={test.isPending} onClick={() => test.mutate()}>{bi('تشغيل التجربة', 'Run rehearsal')}</Button></div>
          {rehearsal && (
            <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
              {rehearsal.documents.map((d, i) => <li key={i} className="flex items-center gap-2">{d.accepted ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-danger" />}<span>{d.subtype}/{d.kind}</span>{d.errors.length > 0 && <span className="text-xs text-danger">{d.errors.join(', ')}</span>}</li>)}
            </ul>
          )}
        </Card>
      )}

      <Dialog open={create} onClose={() => setCreate(false)} title={bi('وحدة إصدار جديدة', 'New EGS unit')}
        footer={<><Button variant="outline" onClick={() => setCreate(false)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={mk.isPending} disabled={!form.name.trim()} onClick={() => mk.mutate()}>{bi('إنشاء', 'Create')}</Button></>}>
        <div className="grid gap-3">
          <Field label={bi('اسم الوحدة / الفرع', 'Unit / branch name')}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={bi('البيئة', 'Environment')} hint={bi('المحاكاة للتجربة قبل الإنتاج؛ الإنتاج للفواتير الحقيقية.', 'Simulation to rehearse before production; production for real invoices.')}>
            <Select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value as 'simulation' | 'production' })}>
              <option value="simulation">{bi('المحاكاة (Simulation)', 'Simulation')}</option><option value="production">{bi('الإنتاج (Production)', 'Production')}</option>
            </Select>
          </Field>
        </div>
      </Dialog>

      <Dialog open={!!otpFor} onClose={() => setOtpFor(null)} title={bi('رمز التفعيل OTP', 'Activation OTP')}
        footer={<><Button variant="outline" onClick={() => setOtpFor(null)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={sendOtp.isPending} disabled={!/^\d{4,10}$/.test(otp)} onClick={() => sendOtp.mutate()}>{bi('إرسال الطلب', 'Send request')}</Button></>}>
        <Field label="OTP" hint={bi('من بوابة فاتورة ← إدارة الأجهزة. الرمز يُستخدم مرة واحدة وينتهي سريعًا؛ إن فشل الطلب أنشئ رمزًا جديدًا.', 'From the Fatoora portal. Single use and short-lived — if the request fails, generate a new one.')}>
          <Input dir="ltr" inputMode="numeric" value={otp} onChange={(e) => setOtp(e.target.value.trim())} autoFocus />
        </Field>
      </Dialog>

      <ReasonDialog open={!!revoke} required danger title={bi('إيقاف وحدة الإصدار', 'Revoke the unit')} hint={bi('لا يمكن حذف الوحدة ولا إعادة تفعيلها؛ ستحتاج وحدة جديدة وشهادة جديدة.', 'A unit cannot be deleted or re-activated; you will need a new unit and certificate.')}
        onClose={() => setRevoke(null)} onConfirm={async (reason) => { try { await api.post(`/einvoice/units/${revoke!.id}/revoke`, { reason }); toast.success(bi('أُوقفت الوحدة', 'Unit revoked')); setRevoke(null); onChanged(); } catch (e) { toast.error(errMsg(e)); } }} />
    </>
  );
}
