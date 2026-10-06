'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { PartyPicker, type PickedParty } from '@/components/party-picker';
import { CoverageBadge, SiteSelect, WO_TYPE, useLabel } from '../../_components/common';
import { LocationPicker } from '../../_components/locations';
import { AssetSearch, type PickedAsset } from '../../_components/asset-search';
import { partyStub } from '../../_components/ticket-dialog';
import type { AssetDetail, TicketDetail, WorkOrderView } from '../../_components/types';

interface ProjectMin { id: string; number: string; name: string; partyId: string | null; siteId: string | null; customer?: { id: string; nameAr: string; nameEn: string | null } | null }

function NewWorkOrder() {
  const sp = useSearchParams();
  const router = useRouter();
  const { bi } = useI18n();
  const label = useLabel();
  const projectId = sp.get('projectId');
  const ticketId = sp.get('ticketId');
  const assetId = sp.get('assetId');

  const [type, setType] = useState(projectId ? 'installation' : 'corrective');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [party, setParty] = useState<PickedParty | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [asset, setAsset] = useState<PickedAsset | null>(null);

  const project = useQuery({ queryKey: ['project-min', projectId], queryFn: () => api.get<ProjectMin>(`/projects/${projectId}`), enabled: !!projectId, retry: false });
  const ticket = useQuery({ queryKey: ['field-ticket', ticketId], queryFn: () => api.get<TicketDetail>(`/field/tickets/${ticketId}`), enabled: !!ticketId });
  const presetAsset = useQuery({ queryKey: ['field-asset', assetId], queryFn: () => api.get<AssetDetail>(`/field/assets/${assetId}`), enabled: !!assetId });

  useEffect(() => {
    const p = project.data;
    if (!p) return;
    if (p.customer) setParty({ ...partyStub(p.customer)!, nameEn: p.customer.nameEn ?? null });
    if (p.siteId) setSiteId(p.siteId);
    setTitle((t) => t || `${p.number} — ${p.name}`);
  }, [project.data]);
  useEffect(() => {
    const t = ticket.data;
    if (!t) return;
    if (t.partyId) setParty(partyStub({ id: t.partyId, nameAr: t.partyName ?? '' }));
    setSiteId(t.siteId);
    setLocationId(t.locationId);
    if (t.asset) setAsset({ id: t.asset.id, code: t.asset.code, serial: t.asset.serial, mac: null, description: null, siteId: t.siteId, partyId: t.partyId, locationId: t.locationId, locationPath: t.locationPath });
    setTitle((x) => x || t.subject);
    setDescription((x) => x || t.description || '');
    setType(t.coverage === 'warranty' ? 'warranty' : 'corrective');
  }, [ticket.data]);
  useEffect(() => {
    const a = presetAsset.data;
    if (!a) return;
    setAsset(a);
    setParty((p) => p ?? partyStub(a.party));
    setSiteId((s) => s ?? a.siteId);
    setLocationId((l) => l ?? a.locationId);
    if (!ticketId && !projectId) setType(a.coverageToday.coverage === 'warranty' ? 'warranty' : 'corrective');
  }, [presetAsset.data, ticketId, projectId]);

  const create = useMutation({
    mutationFn: () => api.post<WorkOrderView>('/field/work-orders', {
      type, title: title.trim(), description: description.trim() || null, projectId, ticketId, partyId: party?.id ?? null, siteId, locationId, assetId: asset?.id ?? null,
    }),
    onSuccess: (wo) => { toast.success(bi(`تم إنشاء أمر العمل ${wo.number}`, `Work order ${wo.number} created`)); router.push(`/field/work-orders/${wo.id}`); },
    onError: (e) => toast.error((e as Error).message),
  });

  const loading = project.isLoading || ticket.isLoading || presetAsset.isLoading;
  const pickAsset = (a: PickedAsset | null) => {
    setAsset(a);
    if (a?.siteId) setSiteId(a.siteId);
    if (a?.locationId) setLocationId(a.locationId);
  };

  return (
    <>
      <PageHeader back="/field/work-orders" title={bi('أمر عمل جديد', 'New work order')} />
      {loading ? <Spinner /> : (
        <Card className="max-w-3xl">
          {(project.data || ticket.data) && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-tint/60 px-3 py-2 text-sm">
              {project.data && <span>{bi('من المشروع', 'From project')} <Link href={`/projects/${project.data.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{project.data.number}</Link> — {bi('التغطية: ضمن مشروع', 'coverage: project')}</span>}
              {ticket.data && <span className="flex items-center gap-2">{bi('من البلاغ', 'From service call')} <Link href={`/field/tickets/${ticket.data.id}`} dir="ltr" className="num font-bold text-primary hover:underline">{ticket.data.number}</Link>{!projectId && <CoverageBadge coverage={ticket.data.coverage} reason={ticket.data.coverageReason} />}</span>}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={bi('النوع', 'Type')}>
              <Select value={type} onChange={(e) => setType(e.target.value)}>{Object.keys(WO_TYPE).map((k) => <option key={k} value={k}>{label(WO_TYPE, k)}</option>)}</Select>
            </Field>
            <Field label={bi('العنوان', 'Title')}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label={bi('العميل', 'Customer')} className="sm:col-span-2"><PartyPicker value={party} onChange={(p) => { setParty(p); setSiteId(null); setLocationId(null); }} /></Field>
            <Field label={bi('الموقع', 'Site')}><SiteSelect partyId={party?.id} value={siteId} onChange={(s) => { setSiteId(s); setLocationId(null); }} /></Field>
            <Field label={bi('المكان', 'Location')}><LocationPicker siteId={siteId} value={locationId} onChange={setLocationId} /></Field>
            <Field label={bi('الجهاز', 'Device')} hint={bi('اختياري — يحدد الضمان', 'Optional — decides warranty')} className="sm:col-span-2"><AssetSearch value={asset} onChange={pickAsset} siteId={siteId} partyId={party?.id} /></Field>
            <Field label={bi('الوصف', 'Description')} className="sm:col-span-2"><Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          </div>
          <p className="mt-3 text-xs text-muted">{bi('تُقرَّر التغطية (مشروع / ضمان / عقد صيانة / مدفوع) تلقائيًا عند الحفظ، وتُنشأ قائمة الفحص حسب النوع.', 'Coverage (project / warranty / maintenance contract / chargeable) is decided on save, and the checklist follows the type.')}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.back()}>{bi('إلغاء', 'Cancel')}</Button>
            <Button loading={create.isPending} disabled={!title.trim()} onClick={() => create.mutate()}>{bi('إنشاء أمر العمل', 'Create work order')}</Button>
          </div>
        </Card>
      )}
    </>
  );
}

export default function NewWorkOrderPage() {
  return <Suspense fallback={<Spinner />}><NewWorkOrder /></Suspense>;
}
