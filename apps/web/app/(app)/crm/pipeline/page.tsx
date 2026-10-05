'use client';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, GripVertical, Plus, Target, User } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date, h } from '@/lib/format';
import { Button, Card, clsx, Empty, ErrorBox, Money, PageHeader, SearchBox, Select, Spinner } from '@/components/ui';
import { UserSelect } from '@/components/user-select';
import { label, PROJECT_LABELS, type Opportunity, type Stage } from '../_components/labels';
import { LostDialog, NewOpportunityDialog, useMoveStage, type PipelineData } from '../_components/opportunity';

const STAGE_TONE: Record<string, string> = { won: 'border-t-ok', lost: 'border-t-danger', open: 'border-t-gold' };

export default function PipelinePage() {
  const { can } = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<{ id: string; stageId: string } | null>(null);
  const canWrite = can('opportunity.write');

  const key = ['pipeline', ownerId ?? '', q];
  const data = useQuery({ queryKey: key, queryFn: () => api.get<PipelineData>(`/crm/pipeline${qs({ ownerId, q })}`) });
  const move = useMoveStage(() => setPendingLost(null));

  const doMove = (id: string, stageId: string, lostReasonKey?: string, lostNote?: string | null) => {
    const stage = data.data?.stages.find((s) => s.id === stageId);
    qc.setQueryData<PipelineData>(key, (old) => old && { ...old, opportunities: old.opportunities.map((o) => (o.id === id ? { ...o, stageId, probability: stage?.probability ?? o.probability } : o)) });
    move.mutate({ id, stageId, lostReasonKey, lostNote });
  };

  const requestMove = (id: string, stageId: string) => {
    const opp = data.data?.opportunities.find((o) => o.id === id);
    if (!opp || opp.stageId === stageId) return;
    const stage = data.data?.stages.find((s) => s.id === stageId);
    if (stage?.kind === 'lost') setPendingLost({ id, stageId });
    else doMove(id, stageId);
  };

  const stages = data.data?.stages ?? [];
  const opps = data.data?.opportunities ?? [];
  const openOpps = opps.filter((o) => stages.find((s) => s.id === o.stageId)?.kind === 'open');
  const openTotal = openOpps.reduce((a, o) => a + h(o.amount), 0);
  const openWeighted = openOpps.reduce((a, o) => a + Math.round((h(o.amount) * o.probability) / 100), 0);

  return (
    <>
      <PageHeader
        title="خط المبيعات"
        subtitle={data.data ? <span>{openOpps.length} فرصة مفتوحة · <Money value={openTotal} /> · المرجّح <Money value={openWeighted} /></span> : 'Pipeline'}
        actions={canWrite && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>فرصة جديدة</Button>}
      />
      <Card padded={false} className="mb-4">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <SearchBox value={search} onChange={setSearch} placeholder="بحث في عناوين الفرص…" />
          <div className="w-full max-w-[14rem]"><UserSelect value={ownerId} onChange={setOwnerId} emptyLabel="كل المسؤولين" /></div>
        </div>
      </Card>
      <ErrorBox error={data.error} />
      {data.isLoading ? <Spinner /> : !stages.length ? (
        <Empty icon={<Target className="size-8" />} title="لا يوجد خط مبيعات مُعد" />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
          <div className="flex gap-3" style={{ minWidth: `${stages.length * 17}rem` }}>
            {stages.map((s) => {
              const items = opps.filter((o) => o.stageId === s.id);
              const total = items.reduce((a, o) => a + h(o.amount), 0);
              const weighted = Math.round((total * s.probability) / 100);
              return (
                <section
                  key={s.id}
                  onDragOver={(e) => { if (canWrite && dragId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverStage(s.id); } }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage((v) => (v === s.id ? null : v)); }}
                  onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragId; setOverStage(null); setDragId(null); if (id) requestMove(id, s.id); }}
                  className={clsx('flex w-[17rem] shrink-0 flex-col rounded-xl border border-t-4 border-line bg-gray-50/70 transition', STAGE_TONE[s.kind] ?? 'border-t-gold', overStage === s.id && 'bg-primary-50 ring-2 ring-gold/40')}
                >
                  <header className="border-b border-line px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-extrabold text-primary">{s.nameAr}</h2>
                      <span className="rounded-full bg-white px-2 text-xs font-bold text-gold-dark num">{items.length}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                      <Money value={total} className="font-bold text-ink" />
                      <span title="القيمة المرجّحة">{s.probability}% · <Money value={weighted} /></span>
                    </div>
                  </header>
                  <div className="flex min-h-[8rem] flex-1 flex-col gap-2 p-2">
                    {items.length === 0 && <p className="py-6 text-center text-xs text-muted">{canWrite ? 'اسحب فرصة إلى هنا' : 'لا توجد فرص'}</p>}
                    {items.map((o) => (
                      <OppCard
                        key={o.id}
                        o={o}
                        stages={stages}
                        canWrite={canWrite}
                        dragging={dragId === o.id}
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', o.id); e.dataTransfer.effectAllowed = 'move'; setDragId(o.id); }}
                        onDragEnd={() => { setDragId(null); setOverStage(null); }}
                        onMove={(stageId) => requestMove(o.id, stageId)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
      {pendingLost && (
        <LostDialog
          open
          reasons={data.data?.lostReasons ?? []}
          loading={move.isPending}
          onClose={() => setPendingLost(null)}
          onConfirm={(reason, note) => doMove(pendingLost.id, pendingLost.stageId, reason, note)}
        />
      )}
      {canWrite && <NewOpportunityDialog open={creating} onClose={() => setCreating(false)} onCreated={(o) => router.push(`/crm/opportunities/${o.id}`)} />}
    </>
  );
}

function OppCard({ o, stages, canWrite, dragging, onDragStart, onDragEnd, onMove }: {
  o: Opportunity; stages: Stage[]; canWrite: boolean; dragging: boolean;
  onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void; onMove: (stageId: string) => void;
}) {
  return (
    <article
      draggable={canWrite}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={clsx('rounded-lg border border-line bg-white p-2.5 shadow-sm transition', canWrite && 'cursor-grab active:cursor-grabbing', dragging && 'opacity-40')}
    >
      <div className="flex items-start gap-1">
        {canWrite && <GripVertical className="mt-0.5 hidden size-4 shrink-0 text-muted md:block" aria-hidden />}
        <div className="min-w-0 flex-1">
          <Link href={`/crm/opportunities/${o.id}`} className="block text-sm font-bold leading-snug text-primary hover:underline" draggable={false}>{o.title}</Link>
          {o.partyName && <div className="truncate text-xs text-muted">{o.partyName}</div>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs">
        <Money value={o.amount} className="font-bold" />
        {o.projectType && <span className="rounded bg-tint px-1.5 text-[10px] text-gold-dark">{label(PROJECT_LABELS, o.projectType)}</span>}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1"><User className="size-3" />{o.ownerName ?? '—'}</span>
        {o.expectedClose && <span className="inline-flex items-center gap-1 num"><CalendarDays className="size-3" />{date(o.expectedClose)}</span>}
      </div>
      {canWrite && (
        <Select value={o.stageId} onChange={(e) => onMove(e.target.value)} className="mt-2 !py-1 text-xs" aria-label="نقل إلى مرحلة">
          {stages.map((s) => <option key={s.id} value={s.id}>{s.id === o.stageId ? `المرحلة: ${s.nameAr}` : `نقل إلى: ${s.nameAr}`}</option>)}
        </Select>
      )}
    </article>
  );
}
