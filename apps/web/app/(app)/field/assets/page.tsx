'use client';
import Link from 'next/link';
import { Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Cpu, FileUp, FolderTree, Plus, X, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Badge, Button, Card, clsx, Dialog, Empty, ErrorBox, Field, Input, PageHeader, SearchBox, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { PartyPicker, type PickedParty } from '@/components/party-picker';
import { ASSET_STATUS, Chip, Ltr, SiteSelect } from '../_components/common';
import { LocationPicker, LocationsPanel, flatten, useLocationTree } from '../_components/locations';
import { partyStub } from '../_components/ticket-dialog';
import type { AssetRow } from '../_components/types';

const PAGE = 100;

function AssetsExplorer() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { bi } = useI18n();
  const { can } = useMe();
  const canWrite = can('asset.write');
  const [projectId, setProjectId] = useState<string | null>(sp.get('projectId'));
  const [party, setParty] = useState<PickedParty | null>(null);
  const [siteId, setSiteId] = useState<string | null>(sp.get('siteId'));
  const [locationId, setLocationId] = useState<string | null>(null);
  const [search, setSearch] = useState(sp.get('q') ?? '');
  const term = useDeferredValue(search.trim());
  const [limit, setLimit] = useState(PAGE);
  const [registering, setRegistering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showLocations, setShowLocations] = useState(true);

  // Context from ?projectId= (customer + site of the project) or ?siteId=
  const proj = useQuery({
    queryKey: ['project-min', projectId],
    queryFn: () => api.get<{ id: string; number: string; name: string; partyId: string | null; siteId: string | null; customer?: { id: string; nameAr: string; nameEn: string | null } | null }>(`/projects/${projectId}`),
    enabled: !!projectId,
    retry: false,
  });
  const siteTree = useLocationTree(siteId);
  useEffect(() => {
    const p = proj.data;
    if (!p) return;
    if (p.customer && !party) setParty({ ...partyStub(p.customer)!, nameEn: p.customer.nameEn ?? null });
    if (p.siteId && !siteId) setSiteId(p.siteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj.data]);
  useEffect(() => {
    const s = siteTree.data?.site;
    if (s?.partyId && !party) api.get<PickedParty>(`/parties/${s.partyId}`).then((p) => setParty((cur) => cur ?? p)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteTree.data?.site.id]);

  useEffect(() => {
    const next = qs({ projectId, siteId, q: term });
    if (next !== (sp.toString() ? `?${sp.toString()}` : '')) router.replace(`${pathname}${next}`, { scroll: false });
    setLimit(PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, siteId, term]);

  const filters = { q: term, projectId, siteId, partyId: siteId ? undefined : party?.id, locationId, limit };
  const list = useQuery({
    queryKey: ['field-assets', filters],
    queryFn: () => api.get<{ rows: AssetRow[]; total: number }>(`/field/assets${qs(filters)}`),
    placeholderData: (prev) => prev,
  });
  const rows = list.data?.rows ?? [];
  const selectedPath = useMemo(() => flatten(siteTree.data?.tree).find((l) => l.id === locationId)?.path ?? null, [siteTree.data, locationId]);
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title={bi('الأجهزة المركبة', 'Installed devices')}
        subtitle={list.data ? bi(`${list.data.total} جهاز`, `${list.data.total} devices`) : bi('قاعدة الأجهزة المركبة لدى العملاء', 'The installed base at customer sites')}
        actions={canWrite && (
          <>
            <Button variant="outline" icon={<FileUp className="size-4" />} disabled={!siteId} title={!siteId ? bi('اختر الموقع أولًا', 'Pick a site first') : undefined} onClick={() => setImporting(true)}>{bi('استيراد CSV', 'Import CSV')}</Button>
            <Button icon={<Plus className="size-4" />} disabled={!siteId} title={!siteId ? bi('اختر الموقع أولًا', 'Pick a site first') : undefined} onClick={() => setRegistering(true)}>{bi('تسجيل جهاز', 'Register device')}</Button>
          </>
        )}
      />
      <Card padded={false} className="mb-4">
        <div className="grid gap-3 p-3 md:grid-cols-3">
          <Field label={bi('العميل', 'Customer')}><PartyPicker value={party} onChange={(p) => { setParty(p); setSiteId(null); setLocationId(null); }} /></Field>
          <Field label={bi('الموقع', 'Site')}><SiteSelect partyId={party?.id} value={siteId} onChange={(s) => { setSiteId(s); setLocationId(null); }} emptyLabel={bi('كل المواقع', 'All sites')} /></Field>
          <Field label={bi('بحث', 'Search')}><SearchBox value={search} onChange={setSearch} placeholder={bi('الكود، التسلسلي، MAC، IP…', 'Code, serial, MAC, IP…')} /></Field>
        </div>
        {(projectId || locationId) && (
          <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2">
            {projectId && (
              <button type="button" onClick={() => setProjectId(null)} className="inline-flex items-center gap-1 rounded-full bg-tint px-2.5 py-1 text-xs font-bold text-primary">
                {bi('المشروع', 'Project')}: <span dir="ltr" className="num">{proj.data?.number ?? projectId.slice(0, 8)}</span> <X className="size-3" />
              </button>
            )}
            {locationId && (
              <button type="button" onClick={() => setLocationId(null)} className="inline-flex items-center gap-1 rounded-full bg-tint px-2.5 py-1 text-xs font-bold text-primary">
                {bi('المكان', 'Location')}: <span dir="ltr" className="num">{selectedPath ?? '…'}</span> <X className="size-3" />
              </button>
            )}
          </div>
        )}
      </Card>

      <div className={clsx('grid gap-4', siteId && showLocations && 'lg:grid-cols-[minmax(0,1fr)_20rem]')}>
        <Card padded={false} title={bi('الأجهزة', 'Devices')} actions={siteId && <Button size="sm" variant="ghost" icon={<FolderTree className="size-4" />} onClick={() => setShowLocations((v) => !v)}>{showLocations ? bi('إخفاء الأماكن', 'Hide locations') : bi('الأماكن', 'Locations')}</Button>}>
          <ErrorBox error={list.error} />
          {list.isLoading ? <Spinner /> : rows.length === 0 ? (
            <Empty icon={<Cpu className="size-8" />} title={term || siteId || party || projectId ? bi('لا توجد أجهزة مطابقة', 'No matching devices') : bi('لا توجد أجهزة مسجلة بعد', 'No devices registered yet')} hint={!siteId ? bi('اختر عميلًا وموقعًا لتسجيل الأجهزة أو استيرادها.', 'Pick a customer and a site to register or import devices.') : undefined} />
          ) : (
            <>
              <Table>
                <thead><tr>
                  <Th>{bi('الكود', 'Code')}</Th><Th>{bi('الوصف', 'Description')}</Th><Th>{bi('المكان', 'Location')}</Th><Th>{bi('التسلسلي', 'Serial')}</Th>
                  <Th>MAC</Th><Th>IP</Th><Th>{bi('البرنامج', 'Firmware')}</Th><Th>{bi('الاختبار', 'Test')}</Th><Th>{bi('نهاية الضمان', 'Warranty end')}</Th><Th>{bi('الحالة', 'Status')}</Th>
                </tr></thead>
                <tbody className={clsx(list.isFetching && 'opacity-70')}>
                  {rows.map((a) => (
                    <tr key={a.id} className="cursor-pointer hover:bg-tint/50" onClick={() => router.push(`/field/assets/${a.id}`)}>
                      <Td><Link href={`/field/assets/${a.id}`} onClick={(e) => e.stopPropagation()} dir="ltr" className="num whitespace-nowrap font-bold text-primary hover:underline">{a.code}</Link></Td>
                      <Td className="max-w-[16rem] truncate text-xs">{a.description ?? '—'}</Td>
                      <Td className="whitespace-nowrap text-xs"><Ltr>{a.locationPath}</Ltr></Td>
                      <Td className="whitespace-nowrap text-xs"><Ltr>{a.serial}</Ltr></Td>
                      <Td className="whitespace-nowrap text-xs"><Ltr>{a.mac}</Ltr></Td>
                      <Td className="whitespace-nowrap text-xs"><Ltr>{a.ip}</Ltr></Td>
                      <Td className="whitespace-nowrap text-xs"><Ltr>{a.firmware}</Ltr></Td>
                      <Td>{a.testPassed === null ? <span className="text-xs text-muted">—</span> : a.testPassed ? <Badge tone="green"><CheckCircle2 className="me-1 size-3" />{bi('ناجح', 'Passed')}</Badge> : <Badge tone="red"><XCircle className="me-1 size-3" />{bi('فشل', 'Failed')}</Badge>}</Td>
                      <Td className={clsx('num whitespace-nowrap text-xs', a.labourWarrantyEnd && a.labourWarrantyEnd < today && 'text-danger')}>{a.labourWarrantyEnd ? date(a.labourWarrantyEnd) : '—'}</Td>
                      <Td><Chip map={ASSET_STATUS} value={a.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {list.data && list.data.total > rows.length && limit < 200 && (
                <div className="flex justify-center border-t border-line p-3">
                  <Button variant="outline" size="sm" loading={list.isFetching} onClick={() => setLimit((l) => Math.min(200, l + PAGE))}>{bi('عرض المزيد', 'Show more')} (<span className="num">{list.data.total - rows.length}</span>)</Button>
                </div>
              )}
            </>
          )}
        </Card>
        {siteId && showLocations && (
          <Card title={<>{bi('الأماكن', 'Locations')}{siteTree.data && <span className="ms-1 text-xs font-bold text-muted">— {siteTree.data.site.name}</span>}</>}>
            <p className="mb-2 text-xs text-muted">{bi('اضغط على مكان لتصفية الأجهزة.', 'Click a location to filter the devices.')}</p>
            <LocationsPanel siteId={siteId} canWrite={canWrite} selectedId={locationId} onSelect={setLocationId} />
          </Card>
        )}
      </div>

      {siteId && <RegisterDeviceDialog open={registering} siteId={siteId} projectId={projectId} defaultLocationId={locationId} onClose={() => setRegistering(false)} />}
      {siteId && <ImportDialog open={importing} siteId={siteId} projectId={projectId} onClose={() => setImporting(false)} />}
    </>
  );
}

function RegisterDeviceDialog({ open, siteId, projectId, defaultLocationId, onClose }: { open: boolean; siteId: string; projectId: string | null; defaultLocationId: string | null; onClose: () => void }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const empty = { code: '', description: '', serial: '', mac: '', ip: '', firmware: '', installedOn: '' };
  const [f, setF] = useState(empty);
  const [locationId, setLocationId] = useState<string | null>(defaultLocationId);
  useEffect(() => { if (open) setLocationId(defaultLocationId); }, [open, defaultLocationId]);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => api.post<AssetRow>('/field/assets', {
      code: f.code.trim(), description: f.description.trim() || null, serial: f.serial.trim() || null, mac: f.mac.trim() || null, ip: f.ip.trim() || null, firmware: f.firmware.trim() || null,
      siteId, projectId, locationId, installedOn: f.installedOn || null, attributes: {},
    }),
    onSuccess: (a) => {
      toast.success(bi('تم تسجيل الجهاز', 'Device registered'), { action: { label: bi('فتح', 'Open'), onClick: () => router.push(`/field/assets/${a.id}`) } });
      qc.invalidateQueries({ queryKey: ['field-assets'] });
      qc.invalidateQueries({ queryKey: ['field-locations', siteId] });
      setF(empty);
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const close = () => { setF(empty); onClose(); };
  return (
    <Dialog open={open} onClose={close} wide title={bi('تسجيل جهاز', 'Register device')}
      footer={<><Button variant="outline" onClick={close}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!f.code.trim()} onClick={() => save.mutate()}>{bi('تسجيل', 'Register')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('الكود (رقم القطعة)', 'Code (part number)')}><Input dir="ltr" className="text-start" value={f.code} onChange={set('code')} autoFocus /></Field>
        <Field label={bi('الوصف', 'Description')} hint={bi('يُملأ من الكتالوج إن تُرك فارغًا', 'Filled from the catalog when empty')}><Input value={f.description} onChange={set('description')} /></Field>
        <Field label={bi('الرقم التسلسلي', 'Serial number')}><Input dir="ltr" className="text-start" value={f.serial} onChange={set('serial')} /></Field>
        <Field label="MAC"><Input dir="ltr" className="text-start" value={f.mac} onChange={set('mac')} placeholder="AA:BB:CC:DD:EE:FF" /></Field>
        <Field label="IP"><Input dir="ltr" className="text-start" value={f.ip} onChange={set('ip')} placeholder="192.168.1.10" /></Field>
        <Field label={bi('إصدار البرنامج', 'Firmware')}><Input dir="ltr" className="text-start" value={f.firmware} onChange={set('firmware')} /></Field>
        <Field label={bi('المكان', 'Location')}><LocationPicker siteId={siteId} value={locationId} onChange={setLocationId} /></Field>
        <Field label={bi('تاريخ التركيب', 'Installed on')}><Input type="date" dir="ltr" value={f.installedOn} onChange={set('installedOn')} /></Field>
      </div>
    </Dialog>
  );
}

interface ImportResult { dryRun: boolean; total: number; created: number; valid: number; locationsCreated: number; errors: ImportRow[]; rows: ImportRow[] }
interface ImportRow { row: number; code: string; serial: string | null; status: 'ok' | 'error'; message?: string; locationPath?: string | null }

function ImportDialog({ open, siteId, projectId, onClose }: { open: boolean; siteId: string; projectId: string | null; onClose: () => void }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.post<ImportResult>('/field/assets/import', { siteId, projectId, csv, dryRun }),
    onSuccess: (r) => {
      setPreview(r);
      if (!r.dryRun) {
        toast.success(bi(`تم استيراد ${r.created} جهاز`, `${r.created} device(s) imported`));
        qc.invalidateQueries({ queryKey: ['field-assets'] });
        qc.invalidateQueries({ queryKey: ['field-locations', siteId] });
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const close = () => { setCsv(''); setPreview(null); setOnlyErrors(false); onClose(); };
  const readFile = (file: File | undefined) => {
    if (!file) return;
    file.text().then((t) => { setCsv(t); setPreview(null); });
  };
  const shown = preview ? (onlyErrors ? preview.errors : preview.rows) : [];
  const imported = preview && !preview.dryRun;
  return (
    <Dialog open={open} onClose={close} wide title={bi('استيراد الأجهزة من CSV', 'Import devices from CSV')}
      footer={imported ? <Button onClick={close}>{bi('تم', 'Done')}</Button> : (
        <>
          <Button variant="outline" onClick={close}>{bi('إلغاء', 'Cancel')}</Button>
          <Button variant="outline" loading={run.isPending && run.variables === true} disabled={!csv.trim()} onClick={() => run.mutate(true)}>{bi('معاينة (تجربة)', 'Preview (dry run)')}</Button>
          <Button loading={run.isPending && run.variables === false} disabled={!preview || preview.valid === 0} onClick={() => run.mutate(false)}>{preview ? bi(`استيراد ${preview.valid} جهاز`, `Import ${preview.valid} device(s)`) : bi('استيراد', 'Import')}</Button>
        </>
      )}>
      {!imported && (
        <>
          <p className="mb-2 text-sm text-muted">
            {bi('الأعمدة:', 'Columns:')} <code dir="ltr" className="num rounded bg-tint px-1">code,serial,mac,ip,firmware,location</code> — {bi('صف العناوين اختياري، والمكان بصيغة', 'header row optional; location as')} <code dir="ltr" className="num rounded bg-tint px-1">B1/F2/U203</code> {bi('(تُنشأ الأماكن الناقصة تلقائيًا).', '(missing locations are created).')}
          </p>
          <div className="mb-2"><input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => readFile(e.target.files?.[0])} className="text-sm" /></div>
          <Textarea rows={6} dir="ltr" className="font-mono text-xs" value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} placeholder={'code,serial,mac,ip,firmware,location\nDS-KD8003,J12345678,AA:BB:CC:00:11:22,192.168.1.20,V2.2.5,B1/F1/101'} />
        </>
      )}
      {preview && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {preview.dryRun ? <Badge tone="blue">{bi('معاينة — لم يُحفظ شيء', 'Preview — nothing saved')}</Badge> : <Badge tone="green">{bi('تم الاستيراد', 'Imported')}</Badge>}
            <span>{bi('الإجمالي', 'Total')} <b className="num">{preview.total}</b></span>
            <span className="text-ok">{bi('صالح', 'Valid')} <b className="num">{preview.valid}</b></span>
            <span className="text-danger">{bi('أخطاء', 'Errors')} <b className="num">{preview.errors.length}</b></span>
            <span className="text-muted">{bi('أماكن جديدة', 'New locations')} <b className="num">{preview.locationsCreated}</b></span>
            {preview.errors.length > 0 && <label className="ms-auto inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />{bi('الأخطاء فقط', 'Errors only')}</label>}
          </div>
          <Table className="max-h-72 overflow-y-auto rounded-lg border border-line">
            <thead><tr><Th>#</Th><Th>{bi('الكود', 'Code')}</Th><Th>{bi('التسلسلي', 'Serial')}</Th><Th>{bi('المكان', 'Location')}</Th><Th>{bi('النتيجة', 'Result')}</Th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.row} className={r.status === 'error' ? 'bg-rose-50/60' : ''}>
                  <Td className="num text-xs">{r.row}</Td>
                  <Td className="text-xs"><Ltr>{r.code}</Ltr></Td>
                  <Td className="text-xs"><Ltr>{r.serial}</Ltr></Td>
                  <Td className="text-xs"><Ltr>{r.locationPath}</Ltr></Td>
                  <Td className="text-xs">{r.status === 'ok' ? <span className="font-bold text-ok">{bi('صالح', 'OK')}</span> : <span dir="ltr" className="text-danger">{r.message}</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}

export default function AssetsPage() {
  return <Suspense fallback={<Spinner />}><AssetsExplorer /></Suspense>;
}
