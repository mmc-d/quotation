'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, FilePlus2, FileText, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date, dateTime } from '@/lib/format';
import { Badge, Button, Card, clsx, ErrorBox, Field, Input, LinkButton, Money, PageHeader, Select, Spinner, StatusBadge, Table, Td, Th } from '@/components/ui';
import { Timeline, type Activity } from '@/components/timeline';
import { UserSelect } from '@/components/user-select';
import { label, PROJECT_LABELS, PROJECT_TYPES, type Opportunity, type Stage } from '../../_components/labels';
import { isMoney, LostDialog, useLostReasons, useMoveStage } from '../../_components/opportunity';
import { useUserName } from '../../_components/use-users';

interface OppView extends Opportunity {
  party: { id: string; nameAr: string; nameEn: string | null; phone: string | null; email: string | null } | null;
  quotes: { id: string; number: string; revision: number; status: string; total: string }[];
  activities: Activity[];
  stages: Stage[];
}

function Stepper({ stages, current, canWrite, onPick, busy }: { stages: Stage[]; current: string; canWrite: boolean; onPick: (s: Stage) => void; busy: boolean }) {
  const idx = stages.findIndex((s) => s.id === current);
  const cur = stages[idx];
  return (
    <ol className="flex flex-wrap gap-1.5">
      {stages.map((s, i) => {
        const active = s.id === current;
        const passed = cur?.kind === 'open' || cur?.kind === 'won' ? s.kind === 'open' && i < idx : false;
        const tone = active
          ? s.kind === 'won' ? 'bg-ok text-white border-ok' : s.kind === 'lost' ? 'bg-danger text-white border-danger' : 'bg-primary text-white border-primary'
          : passed ? 'bg-primary-50 text-primary border-primary/30' : s.kind === 'won' ? 'border-ok/40 text-ok bg-white' : s.kind === 'lost' ? 'border-danger/40 text-danger bg-white' : 'bg-white text-muted border-line';
        return (
          <li key={s.id} className="min-w-[7rem] flex-1">
            <button
              type="button"
              disabled={!canWrite || active || busy}
              onClick={() => onPick(s)}
              className={clsx('flex w-full items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-bold transition', tone, canWrite && !active && 'hover:border-gold hover:shadow-sm', 'disabled:cursor-default')}
              title={`${s.nameAr} · ${s.probability}%`}
            >
              {passed && <Check className="size-3.5" />}
              {s.kind === 'lost' && active && <X className="size-3.5" />}
              {s.nameAr}
              <span className="num opacity-70">{s.probability}%</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function EditForm({ o, onDone }: { o: OppView; onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(o.title);
  const [amount, setAmount] = useState(String(Number(o.amount) || 0));
  const [expectedClose, setExpectedClose] = useState(o.expectedClose ?? '');
  const [projectType, setProjectType] = useState(o.projectType ?? '');
  const [competitors, setCompetitors] = useState((o.competitors ?? []).join('، '));
  const [ownerId, setOwnerId] = useState<string | null>(o.ownerId);
  const save = useMutation({
    mutationFn: () => api.put(`/crm/opportunities/${o.id}`, {
      title: title.trim(),
      partyId: o.partyId,
      contactId: o.contactId,
      amount: amount.trim() || '0',
      expectedClose: expectedClose || null,
      projectType: projectType || null,
      competitors: competitors.split(/[,،]/).map((c) => c.trim()).filter(Boolean),
      ownerId,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['opportunity', o.id] }); qc.invalidateQueries({ queryKey: ['pipeline'] }); toast.success('تم الحفظ'); onDone(); },
  });
  const amountOk = !amount.trim() || isMoney(amount);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (title.trim() && amountOk) save.mutate(); }} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="العنوان *" className="md:col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="القيمة (ر.س)" error={amountOk ? null : 'قيمة غير صحيحة'}><Input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="تاريخ الإغلاق المتوقع"><Input type="date" value={expectedClose} onChange={(e) => setExpectedClose(e.target.value)} /></Field>
        <Field label="نوع المشروع">
          <Select value={projectType} onChange={(e) => setProjectType(e.target.value)}>
            <option value="">—</option>
            {PROJECT_TYPES.map((p) => <option key={p} value={p}>{PROJECT_LABELS[p] ?? p}</option>)}
          </Select>
        </Field>
        <Field label="المسؤول"><UserSelect value={ownerId} onChange={setOwnerId} allowEmpty={!ownerId} /></Field>
        <Field label="المنافسون" hint="افصل بينهم بفاصلة" className="md:col-span-2"><Input value={competitors} onChange={(e) => setCompetitors(e.target.value)} /></Field>
      </div>
      <ErrorBox error={save.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>إلغاء</Button>
        <Button loading={save.isPending} disabled={!title.trim() || !amountOk}>حفظ</Button>
      </div>
    </form>
  );
}

function Info({ k, children }: { k: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-bold text-gold-dark">{k}</dt><dd className="mt-0.5 text-sm">{children}</dd></div>;
}

export default function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useMe();
  const userName = useUserName();
  const [editing, setEditing] = useState(false);
  const [lostStage, setLostStage] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['opportunity', id], queryFn: () => api.get<OppView>(`/crm/opportunities/${id}`) });
  const move = useMoveStage(() => setLostStage(null));
  const reasons = useLostReasons(!!lostStage || !!q.data?.lostReasonKey);
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const o = q.data;
  const canWrite = can('opportunity.write');
  const stage = o.stages.find((s) => s.id === o.stageId);
  const weighted = Math.round(Number(o.amount) * o.probability) / 100;
  const quoteHref = `/quotes/new?opportunityId=${o.id}${o.partyId ? `&partyId=${o.partyId}` : ''}`;

  return (
    <>
      <PageHeader
        back="/crm/pipeline"
        title={o.title}
        subtitle={<span className="flex flex-wrap items-center gap-2">{stage && <Badge tone={stage.kind === 'won' ? 'green' : stage.kind === 'lost' ? 'red' : 'gold'}>{stage.nameAr}</Badge>}<Money value={o.amount} /> · احتمال {o.probability}%</span>}
        actions={
          <>
            {canWrite && !editing && <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>تعديل</Button>}
            {can('quote.write') && <LinkButton href={quoteHref} variant="gold" icon={<FilePlus2 className="size-4" />}>عرض سعر جديد</LinkButton>}
          </>
        }
      />
      <Card className="mb-4">
        <Stepper
          stages={o.stages}
          current={o.stageId}
          canWrite={canWrite}
          busy={move.isPending}
          onPick={(s) => (s.kind === 'lost' ? setLostStage(s.id) : move.mutate({ id: o.id, stageId: s.id }))}
        />
        {stage?.kind === 'lost' && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-danger">
            سبب الخسارة: <b>{reasons.find((r) => r.key === o.lostReasonKey)?.nameAr ?? o.lostReasonKey ?? '—'}</b>{o.lostNote ? ` — ${o.lostNote}` : ''}{o.lostAt ? <span className="num text-xs"> · {date(o.lostAt)}</span> : null}
          </p>
        )}
        {stage?.kind === 'won' && o.wonAt && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-ok">تم الفوز في <span className="num">{date(o.wonAt)}</span></p>}
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card title="التفاصيل">
            {editing ? <EditForm o={o} onDone={() => setEditing(false)} /> : (
              <dl className="grid grid-cols-2 gap-3">
                <Info k="العميل">{o.party ? <Link href={`/customers/${o.party.id}`} className="inline-flex items-center gap-1 font-bold text-primary hover:underline"><Building2 className="size-3.5" />{o.party.nameAr}</Link> : '—'}</Info>
                <Info k="المسؤول">{userName(o.ownerId) ?? '—'}</Info>
                <Info k="القيمة"><Money value={o.amount} /></Info>
                <Info k="القيمة المرجّحة"><Money value={String(weighted)} /></Info>
                <Info k="الإغلاق المتوقع"><span className="num">{date(o.expectedClose)}</span></Info>
                <Info k="نوع المشروع">{label(PROJECT_LABELS, o.projectType)}</Info>
                <Info k="المنافسون">{o.competitors?.length ? <span className="flex flex-wrap gap-1">{o.competitors.map((c) => <Badge key={c}>{c}</Badge>)}</span> : '—'}</Info>
                <Info k="آخر نشاط"><span className="num text-xs">{dateTime(o.lastActivityAt)}</span></Info>
                {o.leadId && <Info k="العميل المحتمل"><Link href={`/crm/leads/${o.leadId}`} className="text-primary hover:underline">فتح السجل</Link></Info>}
              </dl>
            )}
          </Card>
          <Card title="عروض الأسعار" padded={false} actions={can('quote.write') && <LinkButton href={quoteHref} size="sm" icon={<FilePlus2 className="size-3.5" />}>عرض جديد</LinkButton>}>
            {o.quotes.length === 0 ? <p className="p-4 text-sm text-muted">لا توجد عروض مرتبطة بعد</p> : (
              <Table>
                <thead><tr><Th>الرقم</Th><Th>الحالة</Th><Th>الإجمالي</Th></tr></thead>
                <tbody>
                  {o.quotes.map((qt) => (
                    <tr key={qt.id} className="hover:bg-tint/50">
                      <Td><Link href={`/quotes/${qt.id}`} className="inline-flex items-center gap-1 font-bold text-primary hover:underline num"><FileText className="size-3.5" />{qt.number}{qt.revision > 0 ? `-R${qt.revision}` : ''}</Link></Td>
                      <Td><StatusBadge status={qt.status} /></Td>
                      <Td><Money value={qt.total} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <Card title="السجل والمهام" className="lg:col-span-2">
          <Timeline entityType="opportunity" entityId={o.id} items={o.activities} invalidate={['opportunity', id]} canWrite={can('activity.write')} />
        </Card>
      </div>
      {lostStage && (
        <LostDialog
          open
          reasons={reasons}
          loading={move.isPending}
          onClose={() => setLostStage(null)}
          onConfirm={(reason, note) => move.mutate({ id: o.id, stageId: lostStage, lostReasonKey: reason, lostNote: note })}
        />
      )}
    </>
  );
}
