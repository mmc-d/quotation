'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Checkbox, Dialog, Field, Input, Select } from '@/components/ui';
import type { StaffUser } from '@/components/user-select';
import { fromRiyadhLocal, toRiyadhLocal } from './common';
import type { DispatchBoard, WoSummary } from './types';

export interface StaffOption { id: string; name: string; isTechnician: boolean }

/** Technicians (from the dispatch board — users with the technician role) + other staff (users list, when allowed). */
export function useStaffOptions() {
  const board = useQuery({ queryKey: ['field-board-techs'], queryFn: () => api.get<DispatchBoard>('/field/dispatch-board'), staleTime: 300_000 });
  const users = useQuery({ queryKey: ['users-min'], queryFn: () => api.get<StaffUser[]>('/users').catch(() => [] as StaffUser[]), staleTime: 300_000 });
  return useMemo<StaffOption[]>(() => {
    const out = new Map<string, StaffOption>();
    for (const t of board.data?.technicians ?? []) out.set(t.id, { id: t.id, name: t.name ?? t.id.slice(0, 8), isTechnician: t.isTechnician });
    for (const u of users.data ?? []) {
      if (u.status === 'suspended') continue;
      const tech = u.roles?.includes('technician') ?? false;
      const prev = out.get(u.id);
      out.set(u.id, { id: u.id, name: u.nameAr ?? u.email, isTechnician: tech || !!prev?.isTechnician });
    }
    return [...out.values()].sort((a, b) => Number(b.isTechnician) - Number(a.isTechnician) || a.name.localeCompare(b.name));
  }, [board.data, users.data]);
}

/**
 * Book a work order on the board (POST /schedule). `preset` pre-fills the technician and/or the start
 * (e.g. a card dropped on a lane at 10:00).
 */
export function ScheduleDialog({ wo, preset, onClose, onDone }: {
  wo: Pick<WoSummary, 'id' | 'number' | 'title' | 'technicianId' | 'crewIds' | 'scheduledStart' | 'scheduledEnd'> | null;
  preset?: { technicianId?: string | null; start?: string | null } | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const staff = useStaffOptions();
  const [tech, setTech] = useState('');
  const [crew, setCrew] = useState<string[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => {
    if (!wo) return;
    setTech(preset?.technicianId ?? wo.technicianId ?? '');
    setCrew(wo.crewIds ?? []);
    const s = preset?.start ?? toRiyadhLocal(wo.scheduledStart) ?? '';
    const defStart = s || `${toRiyadhLocal(new Date()).slice(0, 10)}T09:00`;
    setStart(defStart);
    const dur = wo.scheduledStart && wo.scheduledEnd ? Date.parse(wo.scheduledEnd) - Date.parse(wo.scheduledStart) : 2 * 3600_000;
    setEnd(preset?.start || !wo.scheduledEnd ? toRiyadhLocal(new Date(Date.parse(fromRiyadhLocal(defStart)) + dur)) : toRiyadhLocal(wo.scheduledEnd));
  }, [wo, preset]);

  const changeStart = (v: string) => {
    // keep the duration when the start moves
    if (start && end && v) {
      const dur = Date.parse(fromRiyadhLocal(end)) - Date.parse(fromRiyadhLocal(start));
      if (dur > 0) setEnd(toRiyadhLocal(new Date(Date.parse(fromRiyadhLocal(v)) + dur)));
    }
    setStart(v);
  };

  const valid = !!tech && !!start && !!end && end > start;
  const save = useMutation({
    mutationFn: () => api.post(`/field/work-orders/${wo!.id}/schedule`, { technicianId: tech, crewIds: crew.filter((c) => c !== tech), scheduledStart: fromRiyadhLocal(start), scheduledEnd: fromRiyadhLocal(end) }),
    onSuccess: () => {
      toast.success(bi('تمت الجدولة', 'Scheduled'));
      qc.invalidateQueries({ queryKey: ['field-board'] });
      qc.invalidateQueries({ queryKey: ['field-wo'] });
      qc.invalidateQueries({ queryKey: ['field-wos'] });
      onDone?.();
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const techs = staff.filter((s) => s.isTechnician);
  const others = staff.filter((s) => !s.isTechnician);

  return (
    <Dialog open={!!wo} onClose={onClose} title={<>{bi('جدولة أمر العمل', 'Schedule work order')} <span dir="ltr" className="num">{wo?.number}</span></>}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{bi('جدولة', 'Schedule')}</Button></>}>
      {wo && <p className="mb-3 text-sm font-bold">{wo.title}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('الفني المسؤول', 'Lead technician')} className="sm:col-span-2">
          <Select value={tech} onChange={(e) => setTech(e.target.value)}>
            <option value="">{bi('— اختر الفني —', '— Select technician —')}</option>
            {techs.length > 0 && <optgroup label={bi('الفنيون', 'Technicians')}>{techs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
            {others.length > 0 && <optgroup label={bi('موظفون آخرون', 'Other staff')}>{others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
          </Select>
        </Field>
        <Field label={bi('البداية (توقيت الرياض)', 'Start (Riyadh time)')}><Input type="datetime-local" dir="ltr" value={start} onChange={(e) => changeStart(e.target.value)} /></Field>
        <Field label={bi('النهاية', 'End')} error={start && end && end <= start ? bi('النهاية يجب أن تكون بعد البداية', 'End must be after start') : null}><Input type="datetime-local" dir="ltr" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-bold text-gold-dark">{bi('الفريق المساعد', 'Crew')}</span>
        {staff.filter((s) => s.id !== tech).length === 0 ? <p className="text-xs text-muted">{bi('لا يوجد موظفون آخرون', 'No other staff')}</p> : (
          <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
            {staff.filter((s) => s.id !== tech).map((s) => (
              <Checkbox key={s.id} label={<span>{s.name}{s.isTechnician && <span className="ms-1 text-[10px] text-muted">({bi('فني', 'technician')})</span>}</span>} checked={crew.includes(s.id)} onChange={(v) => setCrew((c) => (v ? [...c, s.id] : c.filter((x) => x !== s.id)))} />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
