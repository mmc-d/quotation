'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, Building2, Check, CheckCheck, Clock, Inbox, Lock, MessageCircle, Send, Unlock, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { Badge, Button, Checkbox, clsx, Dialog, Empty, ErrorBox, Field, Input, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';
import { AiAssist } from '@/components/ai-assist';
import { CannedReplies } from '@/components/canned-replies';
import { UserSelect } from '@/components/user-select';
import { useI18n } from '@/lib/i18n';
import { INTEREST_LABELS, INTEREST_LABELS_EN, INTERESTS } from './labels';

export interface ConvRow {
  id: string;
  channel: string;
  externalAddress: string;
  contactId: string | null;
  leadId: string | null;
  partyId: string | null;
  assigneeId: string | null;
  status: string;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  unreadCount: number;
  displayName?: string;
  assigneeName?: string | null;
  windowOpen: boolean;
}
interface Msg { id: string; direction: 'in' | 'out' | string; channel: string; templateKey: string | null; body: string | null; mediaUrl: string | null; status: string; error: string | null; createdAt: string }
interface Template { id: string; key: string; channel: string; category: string; language: string; body: string; variables: string[] }
interface ConvView extends ConvRow { messages: Msg[]; templates: Template[] }

function useSessionState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw) setV(JSON.parse(raw) as T);
    } catch { /* storage unavailable */ }
  }, [key]);
  return [v, (nv: T) => { setV(nv); try { window.sessionStorage.setItem(key, JSON.stringify(nv)); } catch { /* ignore */ } }];
}

function shortTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10) === new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  return sameDay ? d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit' });
}

const fill = (body: string, vars: Record<string, string>) => body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] || `{{${k}}}`);

export function InboxShell({ selectedId }: { selectedId: string | null }) {
  const { bi, dir } = useI18n();
  const [status, setStatus] = useSessionState<'open' | 'closed' | 'all'>('inbox.status', 'open');
  const [mine, setMine] = useSessionState<boolean>('inbox.mine', false);
  const list = useQuery({
    queryKey: ['inbox', status, mine],
    queryFn: () => api.get<ConvRow[]>(`/crm/inbox${qs({ status, mine: mine ? 'true' : undefined })}`),
    refetchInterval: 20_000,
  });
  const rows = list.data ?? [];
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[28rem] overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
      <aside className={clsx('w-full shrink-0 flex-col border-line md:flex md:w-80 md:border-e lg:w-96', selectedId ? 'hidden' : 'flex')}>
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-extrabold text-primary">{bi('صندوق الوارد', 'Inbox')}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Select value={status} onChange={(e) => setStatus(e.target.value as 'open' | 'closed' | 'all')} className="max-w-[8rem] !py-1.5" aria-label={bi('الحالة', 'Status')}>
              <option value="open">{bi('المفتوحة', 'Open')}</option>
              <option value="closed">{bi('المغلقة', 'Closed')}</option>
              <option value="all">{bi('الكل', 'All')}</option>
            </Select>
            <Checkbox label={bi('المُسندة لي', 'Assigned to me')} checked={mine} onChange={setMine} />
          </div>
        </div>
        <ErrorBox error={list.error} />
        <ul className="flex-1 divide-y divide-line overflow-y-auto">
          {list.isLoading ? <li><Spinner /></li> : rows.length === 0 ? (
            <li><Empty icon={<Inbox className="size-8" />} title={bi('لا توجد محادثات', 'No conversations')} /></li>
          ) : rows.map((c) => (
            <li key={c.id}>
              <Link href={`/crm/inbox/${c.id}`} className={clsx('block px-3 py-2.5 transition hover:bg-tint/50', c.id === selectedId && 'bg-primary-50')}>
                <div className="flex items-center justify-between gap-2">
                  <span className={clsx('truncate text-sm', c.unreadCount > 0 ? 'font-extrabold text-ink' : 'font-bold text-ink/80')}>{c.displayName ?? c.externalAddress}</span>
                  <span className={clsx('num shrink-0 text-[11px]', c.unreadCount > 0 ? 'font-bold text-ok' : 'text-muted')}>{shortTime(c.lastMessageAt)}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="num truncate text-xs text-muted" dir="ltr">{c.externalAddress}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {c.windowOpen && <span className="size-2 rounded-full bg-ok" title={bi('نافذة الـ24 ساعة مفتوحة', '24-hour window open')} aria-label={bi('النافذة مفتوحة', 'Window open')} />}
                    {c.status === 'closed' && <Lock className="size-3 text-muted" aria-label={bi('مغلقة', 'Closed')} />}
                    {c.unreadCount > 0 && <span className="num grid min-w-5 place-items-center rounded-full bg-ok px-1.5 text-[10px] font-bold text-white">{c.unreadCount}</span>}
                  </span>
                </div>
                {c.assigneeName && <div className="mt-0.5 truncate text-[11px] text-gold-dark">{dir === 'rtl' ? '←' : '→'} {c.assigneeName}</div>}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <main className={clsx('min-w-0 flex-1 flex-col', selectedId ? 'flex' : 'hidden md:flex')}>
        {selectedId ? <Thread id={selectedId} row={selected} /> : (
          <div className="grid flex-1 place-items-center"><Empty icon={<MessageCircle className="size-10" />} title={bi('اختر محادثة', 'Select a conversation')} hint={bi('محادثات واتساب الواردة تظهر هنا. يمكن الرد بحرية خلال 24 ساعة من آخر رسالة للعميل، وبعدها بالقوالب المعتمدة فقط.', 'Incoming WhatsApp conversations appear here. You can reply freely within 24 hours of the customer\'s last message; after that, only with approved templates.')} /></div>
        )}
      </main>
    </div>
  );
}

function Ticks({ m }: { m: Msg }) {
  const { bi } = useI18n();
  if (m.direction !== 'out') return null;
  switch (m.status) {
    case 'read': return <CheckCheck className="size-3.5 text-sky-500" aria-label={bi('مقروءة', 'Read')} />;
    case 'delivered': return <CheckCheck className="size-3.5 text-muted" aria-label={bi('تم التسليم', 'Delivered')} />;
    case 'sent': return <Check className="size-3.5 text-muted" aria-label={bi('أُرسلت', 'Sent')} />;
    case 'failed': return <AlertCircle className="size-3.5 text-danger" aria-label={bi('فشل الإرسال', 'Failed to send')} />;
    default: return <Clock className="size-3.5 text-muted" aria-label={bi('قيد الإرسال', 'Sending')} />;
  }
}

function Thread({ id, row }: { id: string; row: ConvRow | null }) {
  const { can } = useMe();
  const { bi, locale } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const [text, setText] = useState('');
  const [tplKey, setTplKey] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadName, setLeadName] = useState('');
  const [leadInterest, setLeadInterest] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const q = useQuery({ queryKey: ['conversation', id], queryFn: () => api.get<ConvView>(`/crm/inbox/${id}`), refetchInterval: 10_000 });
  const c = q.data;
  const msgCount = c?.messages.length ?? 0;

  // Opening a thread zeroes its unread count — refresh the list once loaded.
  const loadedId = c?.id;
  useEffect(() => { if (loadedId) qc.invalidateQueries({ queryKey: ['inbox'] }); }, [loadedId, qc]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [msgCount, id]);
  useEffect(() => { setText(''); setTplKey(''); setVars({}); }, [id]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['conversation', id] }); qc.invalidateQueries({ queryKey: ['inbox'] }); };
  const reply = useMutation({
    mutationFn: (body: { body?: string; templateKey?: string; vars?: Record<string, string> }) => api.post(`/crm/inbox/${id}/reply`, body),
    onSuccess: () => { setText(''); setTplKey(''); setVars({}); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const assign = useMutation({
    mutationFn: (body: { assigneeId?: string | null; status?: 'open' | 'closed' }) => api.post(`/crm/inbox/${id}/assign`, body),
    onSuccess: (_r, v) => { refresh(); toast.success(v.status === 'closed' ? bi('أُغلقت المحادثة', 'Conversation closed') : v.status === 'open' ? bi('أُعيد فتح المحادثة', 'Conversation reopened') : bi('تم الإسناد', 'Assigned')); },
    onError: (e) => toast.error((e as Error).message),
  });
  const mkLead = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/crm/inbox/${id}/lead`, { name: leadName.trim(), interest: leadInterest || null }),
    onSuccess: (l) => { refresh(); setLeadOpen(false); toast.success(bi('أُنشئ العميل المحتمل', 'Lead created')); router.push(`/crm/leads/${l.id}`); },
  });

  const tpl = useMemo(() => c?.templates.find((t) => t.key === tplKey) ?? null, [c, tplKey]);
  if (q.isLoading) return <Spinner />;
  if (!c) return <div className="p-4"><ErrorBox error={q.error} /></div>;

  const canSend = can('message.send');
  const name = row?.displayName ?? c.externalAddress;
  const missingVars = tpl ? tpl.variables.some((v) => !vars[v]?.trim()) : true;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/crm/inbox" className="rounded p-1 text-muted hover:bg-black/5 md:hidden" aria-label={bi('رجوع', 'Back')}><ArrowRight className="size-5 ltr:-scale-x-100" /></Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span className="truncate font-extrabold text-primary">{name}</span><StatusBadge status={c.status} /></div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="num" dir="ltr">{c.externalAddress}</span>
              {c.windowOpen ? <Badge tone="green">{bi('النافذة مفتوحة', 'Window open')}</Badge> : <Badge tone="gray">{bi('خارج نافذة 24 ساعة', 'Outside the 24-hour window')}</Badge>}
              {c.leadId && <Link href={`/crm/leads/${c.leadId}`} className="inline-flex items-center gap-1 font-bold text-primary hover:underline"><UserPlus className="size-3" />{bi('العميل المحتمل', 'Lead')}</Link>}
              {c.partyId && <Link href={`/customers/${c.partyId}`} className="inline-flex items-center gap-1 font-bold text-primary hover:underline"><Building2 className="size-3" />{bi('العميل', 'Customer')}</Link>}
            </div>
          </div>
        </div>
        {canSend && (
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="w-40"><UserSelect value={c.assigneeId} onChange={(v) => assign.mutate({ assigneeId: v })} /></div>
            {c.status === 'open'
              ? <Button size="sm" variant="outline" icon={<Lock className="size-3.5" />} loading={assign.isPending && assign.variables?.status === 'closed'} onClick={() => assign.mutate({ status: 'closed' })}>{bi('إغلاق', 'Close')}</Button>
              : <Button size="sm" variant="outline" icon={<Unlock className="size-3.5" />} loading={assign.isPending && assign.variables?.status === 'open'} onClick={() => assign.mutate({ status: 'open' })}>{bi('إعادة فتح', 'Reopen')}</Button>}
            {!c.leadId && !c.partyId && can('lead.write') && <Button size="sm" variant="gold" icon={<UserPlus className="size-3.5" />} onClick={() => { setLeadName(row?.displayName && row.displayName !== c.externalAddress ? row.displayName : ''); setLeadOpen(true); }}>{bi('إنشاء عميل محتمل', 'Create lead')}</Button>}
          </div>
        )}
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto bg-[#f5f1e8] px-3 py-4">
        {c.messages.length === 0 && <p className="py-8 text-center text-sm text-muted">{bi('لا توجد رسائل', 'No messages')}</p>}
        {c.messages.map((m) => {
          const out = m.direction === 'out';
          return (
            <div key={m.id} className={clsx('flex', out ? 'justify-end' : 'justify-start')}>
              <div className={clsx('max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-sm md:max-w-[70%]', out ? 'rounded-se-sm bg-[#dcf8c6]' : 'rounded-ss-sm bg-white', m.status === 'failed' && 'ring-1 ring-danger/40')}>
                {m.templateKey && <div className="mb-1 text-[10px] font-bold text-gold-dark">{bi('قالب:', 'Template:')} {m.templateKey}</div>}
                {m.body && <div className="whitespace-pre-line break-words">{m.body}</div>}
                {m.mediaUrl && <a href={m.mediaUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs font-bold text-primary underline">{bi('مرفق', 'Attachment')}</a>}
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted">
                  <span className="num">{dateTime(m.createdAt)}</span>
                  <Ticks m={m} />
                </div>
                {m.status === 'failed' && m.error && <div className="mt-1 text-[11px] text-danger">{m.error}</div>}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {canSend && (
        <footer className="border-t border-line p-3">
          {c.windowOpen ? (
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) reply.mutate({ body: text.trim() }); }}>
              <Textarea
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (text.trim() && !reply.isPending) reply.mutate({ body: text.trim() }); } }}
                placeholder={bi('اكتب ردًا… (Enter للإرسال، Shift+Enter لسطر جديد)', 'Type a reply… (Enter to send, Shift+Enter for a new line)')}
                maxLength={4096}
                className="flex-1 resize-none"
              />
              <Button loading={reply.isPending} disabled={!text.trim()} icon={<Send className="size-4 rtl:-scale-x-100" />} aria-label={bi('إرسال', 'Send')}>{bi('إرسال', 'Send')}</Button>
              <CannedReplies scope="inbox" conversationId={c.id} text={text} onInsert={(b, replace) => setText(replace || !text.trim() ? b : `${text}\n${b}`)} />
              <AiAssist context={c.channel === 'email' ? 'email' : 'whatsapp'} thread={c.messages.filter((m) => m.body).slice(-30).map((m) => `${m.direction === 'in' ? 'Customer' : 'Us'}: ${m.body}`).join('\n')} onInsert={setText} />
            </form>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted">{bi('مرّت أكثر من 24 ساعة على آخر رسالة من العميل — يمكن الإرسال بالقوالب المعتمدة فقط.', 'More than 24 hours have passed since the customer\'s last message — only approved templates can be sent.')}</p>
              {c.templates.length === 0 ? <p className="text-sm text-danger">{bi('لا توجد قوالب معتمدة لهذه القناة.', 'No approved templates for this channel.')}</p> : (
                <>
                  <Select value={tplKey} onChange={(e) => { setTplKey(e.target.value); setVars({}); }} aria-label={bi('القالب', 'Template')}>
                    <option value="">{bi('— اختر قالبًا —', '— Choose a template —')}</option>
                    {c.templates.map((t) => <option key={t.id} value={t.key}>{t.key}{t.language !== 'ar' ? ` (${t.language})` : ''}</option>)}
                  </Select>
                  {tpl && (
                    <>
                      {tpl.variables.length > 0 && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {tpl.variables.map((v) => <Field key={v} label={v}><Input value={vars[v] ?? ''} onChange={(e) => setVars({ ...vars, [v]: e.target.value })} /></Field>)}
                        </div>
                      )}
                      <div className="whitespace-pre-line rounded-lg bg-[#dcf8c6] px-3 py-2 text-sm">{fill(tpl.body, vars)}</div>
                      <div className="flex justify-end">
                        <Button loading={reply.isPending} disabled={missingVars} icon={<Send className="size-4 rtl:-scale-x-100" />} onClick={() => reply.mutate({ templateKey: tpl.key, vars })}>{bi('إرسال القالب', 'Send template')}</Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </footer>
      )}

      <Dialog open={leadOpen} onClose={() => setLeadOpen(false)} title={bi('إنشاء عميل محتمل من المحادثة', 'Create a lead from the conversation')} footer={<><Button variant="outline" onClick={() => setLeadOpen(false)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={mkLead.isPending} disabled={!leadName.trim()} onClick={() => mkLead.mutate()}>{bi('إنشاء', 'Create')}</Button></>}>
        <div className="space-y-3">
          <Field label={bi('الاسم *', 'Name *')}><Input value={leadName} onChange={(e) => setLeadName(e.target.value)} /></Field>
          <Field label={bi('الاهتمام', 'Interest')}>
            <Select value={leadInterest} onChange={(e) => setLeadInterest(e.target.value)}>
              <option value="">—</option>
              {INTERESTS.map((i) => <option key={i} value={i}>{(locale === 'en' ? INTEREST_LABELS_EN : INTEREST_LABELS)[i] ?? i}</option>)}
            </Select>
          </Field>
          <ErrorBox error={mkLead.error} />
        </div>
      </Dialog>
    </>
  );
}
