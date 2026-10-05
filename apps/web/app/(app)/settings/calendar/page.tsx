'use client';
/** Company work calendar (PLT-74): working weekdays + public holidays, used for due dates and reminders. */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, CalendarPlus, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { Button, Card, clsx, Dialog, Empty, ErrorBox, Field, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { InfoNote, RequirePerm } from '../_components/common';

interface Holiday { id: string; date: string; nameAr: string; nameEn: string | null }
interface CalendarData { workingDays: number[]; holidays: Holiday[]; years: number[] }

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

export default function CalendarSettingsPage() {
  return <RequirePerm perm="admin.settings" title="تقويم العمل"><CalendarSettings /></RequirePerm>;
}

function CalendarSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['calendar'], queryFn: () => api.get<CalendarData>('/calendar') });
  const [days, setDays] = useState<number[] | null>(null);
  const [edit, setEdit] = useState<Holiday | 'new' | null>(null);
  const [del, setDel] = useState<Holiday | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendar'] });

  if (q.isLoading) return <Spinner />;
  if (!q.data) return <><PageHeader title="تقويم العمل" /><ErrorBox error={q.error} /></>;
  const cal = q.data;
  const current = days ?? cal.workingDays;
  const dirty = days !== null && JSON.stringify([...days].sort()) !== JSON.stringify([...cal.workingDays].sort());
  const toggle = (d: number) => setDays(current.includes(d) ? current.filter((x) => x !== d) : [...current, d].sort((a, b) => a - b));

  const saveDays = async () => {
    if (!current.length) { toast.error('اختر يوم عمل واحدًا على الأقل'); return; }
    setBusy('days');
    try {
      await api.put('/calendar/working-days', { workingDays: current });
      toast.success('تم حفظ أيام العمل');
      setDays(null);
      await refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const seedFixed = async (year: number) => {
    setBusy(`seed${year}`);
    try {
      const r = await api.post<{ added: string[] }>('/calendar/holidays/seed-fixed', { year });
      toast.success(r.added.length ? `أُضيفت ${r.added.length} عطلة ثابتة لعام ${year}` : `العطلات الثابتة لعام ${year} موجودة مسبقًا`);
      await refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const remove = async (hol: Holiday) => {
    setBusy('del');
    try {
      await api.del(`/calendar/holidays/${hol.id}`);
      toast.success(`حُذفت العطلة: ${hol.nameAr}`);
      setDel(null);
      await refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <>
      <PageHeader title="تقويم العمل" subtitle="أيام العمل الأسبوعية والعطلات الرسمية — تُستخدم في تواريخ استحقاق طلبات الدفع وإرسال التذكيرات" />
      <div className="space-y-5">
        <Card title="أيام العمل" actions={<Button size="sm" icon={<Save className="size-4" />} disabled={!dirty} loading={busy === 'days'} onClick={() => void saveDays()}>حفظ</Button>}>
          <div className="flex flex-wrap gap-2" role="group" aria-label="أيام العمل">
            {DAYS.map((name, d) => {
              const on = current.includes(d);
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => toggle(d)}
                  className={clsx('min-w-[6.5rem] rounded-xl border px-4 py-2.5 text-sm font-bold transition', on ? 'border-primary bg-primary text-white' : 'border-line bg-white text-muted hover:bg-tint')}>
                  {name}<div className="text-[11px] font-normal opacity-80">{on ? 'يوم عمل' : 'عطلة'}</div>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted">الافتراضي في المملكة: من الأحد إلى الخميس. عند إنشاء طلب دفع دون تاريخ استحقاق، يكون الاستحقاق اليوم + مدة السداد للعميل، ويُرحّل إلى أول يوم عمل إذا وقع في عطلة. ولا تُرسل تذكيرات الدفع إلا في أيام العمل.</p>
        </Card>

        <Card title="العطلات الرسمية" padded={false}
          actions={<>
            {cal.years.map((y) => <Button key={y} size="sm" variant="outline" icon={<CalendarPlus className="size-4" />} loading={busy === `seed${y}`} onClick={() => void seedFixed(y)}>إضافة العطلات الثابتة {y}</Button>)}
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>عطلة جديدة</Button>
          </>}>
          <div className="p-4 pb-0">
            <InfoNote tone="amber">العطلات الثابتة (يوم التأسيس 22 فبراير، واليوم الوطني 23 سبتمبر) تُضاف بزر «إضافة العطلات الثابتة». أما إجازتا <b>عيد الفطر وعيد الأضحى</b> فتتبعان تقويم أم القرى وتتغير تواريخهما كل عام، لذا يجب إضافتهما يدويًا كل سنة حسب التعميم الرسمي (يومًا بيوم).</InfoNote>
          </div>
          {cal.holidays.length === 0 ? <Empty icon={<CalendarDays className="size-8" />} title="لا توجد عطلات مسجلة" hint="ابدأ بإضافة العطلات الثابتة ثم أضف أيام العيدين." /> : (
            <Table className="mt-3">
              <thead><tr><Th>التاريخ</Th><Th>اليوم</Th><Th>العطلة</Th><Th>English</Th><Th /></tr></thead>
              <tbody>
                {cal.holidays.map((hol) => (
                  <tr key={hol.id} className="hover:bg-tint/40">
                    <Td className="num font-bold">{date(hol.date)}</Td>
                    <Td className="text-xs">{DAYS[weekdayOf(hol.date)]}{!current.includes(weekdayOf(hol.date)) && <span className="ms-1 text-muted">(عطلة أسبوعية)</span>}</Td>
                    <Td>{hol.nameAr}</Td>
                    <Td className="text-xs text-muted" ><span dir="ltr">{hol.nameEn ?? '—'}</span></Td>
                    <Td className="text-end">
                      <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(hol)}>تعديل</Button>
                      <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setDel(hol)}>حذف</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {edit && <HolidayDialog holiday={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void refresh(); }} />}
      <Dialog open={!!del} onClose={() => setDel(null)} title="حذف العطلة"
        footer={<><Button variant="outline" onClick={() => setDel(null)}>إلغاء</Button><Button variant="danger" loading={busy === 'del'} onClick={() => del && void remove(del)}>حذف</Button></>}>
        <p className="text-sm">سيُحذف «{del?.nameAr}» بتاريخ <span className="num">{del ? date(del.date) : ''}</span> ويصبح يوم عمل عاديًا إن كان من أيام العمل.</p>
      </Dialog>
    </>
  );
}

function HolidayDialog({ holiday, onClose, onSaved }: { holiday: Holiday | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ date: holiday?.date ?? '', nameAr: holiday?.nameAr ?? '', nameEn: holiday?.nameEn ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.nameAr.trim().length > 0;
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.put(`/calendar/holidays/${holiday?.id ?? 'new'}`, { date: f.date, nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim() || null });
      toast.success('تم حفظ العطلة');
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={holiday ? 'تعديل عطلة' : 'عطلة جديدة'} footer={<><Button variant="outline" onClick={onClose}>إلغاء</Button><Button loading={busy} disabled={!valid} onClick={() => void save()}>حفظ</Button></>}>
      <div className="space-y-3">
        <Field label="التاريخ *" hint="لعطلة من عدة أيام (كإجازة العيد) أضف كل يوم على حدة."><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="اسم العطلة *"><Input value={f.nameAr} maxLength={120} onChange={(e) => setF({ ...f, nameAr: e.target.value })} placeholder="إجازة عيد الفطر" /></Field>
        <Field label="الاسم بالإنجليزية"><Input dir="ltr" value={f.nameEn} maxLength={120} onChange={(e) => setF({ ...f, nameEn: e.target.value })} placeholder="Eid al-Fitr holiday" /></Field>
        <ErrorBox error={error} />
      </div>
    </Dialog>
  );
}
