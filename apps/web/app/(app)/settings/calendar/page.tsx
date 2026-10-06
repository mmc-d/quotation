'use client';
/** Company work calendar (PLT-74): working weekdays + public holidays, used for due dates and reminders. */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, CalendarPlus, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Button, Card, clsx, Dialog, Empty, ErrorBox, Field, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { InfoNote, RequirePerm } from '../_components/common';

interface Holiday { id: string; date: string; nameAr: string; nameEn: string | null }
interface CalendarData { workingDays: number[]; holidays: Holiday[]; years: number[] }

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

export default function CalendarSettingsPage() {
  const { bi } = useI18n();
  return <RequirePerm perm="admin.settings" title={bi('تقويم العمل', 'Work calendar')}><CalendarSettings /></RequirePerm>;
}

function CalendarSettings() {
  const qc = useQueryClient();
  const { bi, locale } = useI18n();
  const en = locale === 'en';
  const dayNames = en ? DAYS_EN : DAYS;
  const q = useQuery({ queryKey: ['calendar'], queryFn: () => api.get<CalendarData>('/calendar') });
  const [days, setDays] = useState<number[] | null>(null);
  const [edit, setEdit] = useState<Holiday | 'new' | null>(null);
  const [del, setDel] = useState<Holiday | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendar'] });

  if (q.isLoading) return <Spinner />;
  if (!q.data) return <><PageHeader title={bi('تقويم العمل', 'Work calendar')} /><ErrorBox error={q.error} /></>;
  const cal = q.data;
  const current = days ?? cal.workingDays;
  const dirty = days !== null && JSON.stringify([...days].sort()) !== JSON.stringify([...cal.workingDays].sort());
  const toggle = (d: number) => setDays(current.includes(d) ? current.filter((x) => x !== d) : [...current, d].sort((a, b) => a - b));

  const saveDays = async () => {
    if (!current.length) { toast.error(bi('اختر يوم عمل واحدًا على الأقل', 'Choose at least one working day')); return; }
    setBusy('days');
    try {
      await api.put('/calendar/working-days', { workingDays: current });
      toast.success(bi('تم حفظ أيام العمل', 'Working days saved'));
      setDays(null);
      await refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const seedFixed = async (year: number) => {
    setBusy(`seed${year}`);
    try {
      const r = await api.post<{ added: string[] }>('/calendar/holidays/seed-fixed', { year });
      toast.success(r.added.length ? bi(`أُضيفت ${r.added.length} عطلة ثابتة لعام ${year}`, `Added ${r.added.length} fixed holidays for ${year}`) : bi(`العطلات الثابتة لعام ${year} موجودة مسبقًا`, `The fixed holidays for ${year} already exist`));
      await refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const remove = async (hol: Holiday) => {
    setBusy('del');
    try {
      await api.del(`/calendar/holidays/${hol.id}`);
      toast.success(bi(`حُذفت العطلة: ${hol.nameAr}`, `Holiday deleted: ${hol.nameEn || hol.nameAr}`));
      setDel(null);
      await refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <>
      <PageHeader title={bi('تقويم العمل', 'Work calendar')} subtitle={bi('أيام العمل الأسبوعية والعطلات الرسمية — تُستخدم في تواريخ استحقاق طلبات الدفع وإرسال التذكيرات', 'Weekly working days and public holidays — used for payment-request due dates and sending reminders')} />
      <div className="space-y-5">
        <Card title={bi('أيام العمل', 'Working days')} actions={<Button size="sm" icon={<Save className="size-4" />} disabled={!dirty} loading={busy === 'days'} onClick={() => void saveDays()}>{bi('حفظ', 'Save')}</Button>}>
          <div className="flex flex-wrap gap-2" role="group" aria-label={bi('أيام العمل', 'Working days')}>
            {dayNames.map((name, d) => {
              const on = current.includes(d);
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => toggle(d)}
                  className={clsx('min-w-[6.5rem] rounded-xl border px-4 py-2.5 text-sm font-bold transition', on ? 'border-primary bg-primary text-white' : 'border-line bg-white text-muted hover:bg-tint')}>
                  {name}<div className="text-[11px] font-normal opacity-80">{on ? bi('يوم عمل', 'Working day') : bi('عطلة', 'Holiday')}</div>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted">{bi('الافتراضي في المملكة: من الأحد إلى الخميس. عند إنشاء طلب دفع دون تاريخ استحقاق، يكون الاستحقاق اليوم + مدة السداد للعميل، ويُرحّل إلى أول يوم عمل إذا وقع في عطلة. ولا تُرسل تذكيرات الدفع إلا في أيام العمل.', 'The Saudi default is Sunday to Thursday. When a payment request is created without a due date, it is due today + the customer’s payment terms, moved to the next working day if it falls on a holiday. Payment reminders are sent on working days only.')}</p>
        </Card>

        <Card title={bi('العطلات الرسمية', 'Public holidays')} padded={false}
          actions={<>
            {cal.years.map((y) => <Button key={y} size="sm" variant="outline" icon={<CalendarPlus className="size-4" />} loading={busy === `seed${y}`} onClick={() => void seedFixed(y)}>{bi(`إضافة العطلات الثابتة ${y}`, `Add fixed holidays ${y}`)}</Button>)}
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>{bi('عطلة جديدة', 'New holiday')}</Button>
          </>}>
          <div className="p-4 pb-0">
            <InfoNote tone="amber">{en ? <>Fixed holidays (Founding Day 22 February and National Day 23 September) are added with the “Add fixed holidays” button. The <b>Eid al-Fitr and Eid al-Adha</b> holidays follow the Umm al-Qura calendar and change every year, so add them manually each year per the official circular (day by day).</> : <>العطلات الثابتة (يوم التأسيس 22 فبراير، واليوم الوطني 23 سبتمبر) تُضاف بزر «إضافة العطلات الثابتة». أما إجازتا <b>عيد الفطر وعيد الأضحى</b> فتتبعان تقويم أم القرى وتتغير تواريخهما كل عام، لذا يجب إضافتهما يدويًا كل سنة حسب التعميم الرسمي (يومًا بيوم).</>}</InfoNote>
          </div>
          {cal.holidays.length === 0 ? <Empty icon={<CalendarDays className="size-8" />} title={bi('لا توجد عطلات مسجلة', 'No holidays recorded')} hint={bi('ابدأ بإضافة العطلات الثابتة ثم أضف أيام العيدين.', 'Start by adding the fixed holidays, then add the Eid days.')} /> : (
            <Table className="mt-3">
              <thead><tr><Th>{bi('التاريخ', 'Date')}</Th><Th>{bi('اليوم', 'Day')}</Th><Th>{bi('العطلة', 'Holiday')}</Th><Th>{bi('English', 'English name')}</Th><Th /></tr></thead>
              <tbody>
                {cal.holidays.map((hol) => (
                  <tr key={hol.id} className="hover:bg-tint/40">
                    <Td className="num font-bold">{date(hol.date)}</Td>
                    <Td className="text-xs">{dayNames[weekdayOf(hol.date)]}{!current.includes(weekdayOf(hol.date)) && <span className="ms-1 text-muted">{bi('(عطلة أسبوعية)', '(weekly day off)')}</span>}</Td>
                    <Td>{hol.nameAr}</Td>
                    <Td className="text-xs text-muted" ><span dir="ltr">{hol.nameEn ?? '—'}</span></Td>
                    <Td className="text-end">
                      <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(hol)}>{bi('تعديل', 'Edit')}</Button>
                      <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setDel(hol)}>{bi('حذف', 'Delete')}</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {edit && <HolidayDialog holiday={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void refresh(); }} />}
      <Dialog open={!!del} onClose={() => setDel(null)} title={bi('حذف العطلة', 'Delete holiday')}
        footer={<><Button variant="outline" onClick={() => setDel(null)}>{bi('إلغاء', 'Cancel')}</Button><Button variant="danger" loading={busy === 'del'} onClick={() => del && void remove(del)}>{bi('حذف', 'Delete')}</Button></>}>
        <p className="text-sm">{en ? <>“{del?.nameEn || del?.nameAr}” on <span className="num">{del ? date(del.date) : ''}</span> will be deleted and becomes a normal working day if it is one of the working days.</> : <>سيُحذف «{del?.nameAr}» بتاريخ <span className="num">{del ? date(del.date) : ''}</span> ويصبح يوم عمل عاديًا إن كان من أيام العمل.</>}</p>
      </Dialog>
    </>
  );
}

function HolidayDialog({ holiday, onClose, onSaved }: { holiday: Holiday | null; onClose: () => void; onSaved: () => void }) {
  const { bi } = useI18n();
  const [f, setF] = useState({ date: holiday?.date ?? '', nameAr: holiday?.nameAr ?? '', nameEn: holiday?.nameEn ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.nameAr.trim().length > 0;
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.put(`/calendar/holidays/${holiday?.id ?? 'new'}`, { date: f.date, nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim() || null });
      toast.success(bi('تم حفظ العطلة', 'Holiday saved'));
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={holiday ? bi('تعديل عطلة', 'Edit holiday') : bi('عطلة جديدة', 'New holiday')} footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button loading={busy} disabled={!valid} onClick={() => void save()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="space-y-3">
        <Field label={bi('التاريخ *', 'Date *')} hint={bi('لعطلة من عدة أيام (كإجازة العيد) أضف كل يوم على حدة.', 'For a multi-day holiday (such as Eid), add each day separately.')}><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={bi('اسم العطلة *', 'Holiday name (Arabic) *')}><Input value={f.nameAr} maxLength={120} onChange={(e) => setF({ ...f, nameAr: e.target.value })} placeholder="إجازة عيد الفطر" /></Field>
        <Field label={bi('الاسم بالإنجليزية', 'Name in English')}><Input dir="ltr" value={f.nameEn} maxLength={120} onChange={(e) => setF({ ...f, nameEn: e.target.value })} placeholder="Eid al-Fitr holiday" /></Field>
        <ErrorBox error={error} />
      </div>
    </Dialog>
  );
}
