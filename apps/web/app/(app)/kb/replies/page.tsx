'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquareText, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Badge, Button, Card, Checkbox, Dialog, Empty, ErrorBox, Field, Input, PageHeader, SearchBox, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { useCannedReplies, type CannedReply } from '@/components/canned-replies';
import { RequirePerm } from '../../settings/_components/common';

const PLACEHOLDER_HELP: [string, string, string][] = [
  ['{customer_name}', 'اسم العميل', 'Customer name'],
  ['{ticket_number}', 'رقم البلاغ', 'Ticket number'],
  ['{technician_name}', 'اسم الفني', 'Technician name'],
  ['{agent_name}', 'اسمك', 'Your name'],
];

function RepliesManager() {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const list = useCannedReplies(undefined);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<CannedReply | 'new' | null>(null);
  const canShare = list.data?.canShare ?? can('kb.write');
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/kb/replies/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canned-replies'] }); toast.success(bi('تم الحذف', 'Deleted')); },
    onError: (e) => toast.error((e as Error).message),
  });
  const term = q.trim().toLowerCase();
  const rows = (list.data?.rows ?? []).filter((r) => !term || `${r.shortcut} ${r.title} ${r.bodyAr} ${r.bodyEn ?? ''}`.toLowerCase().includes(term));
  const editable = (r: CannedReply) => (r.shared ? canShare : r.mine);
  const SCOPE: Record<string, string> = { both: bi('الكل', 'Everywhere'), inbox: bi('صندوق الرسائل', 'Inbox'), ticket: bi('البلاغات', 'Service calls') };

  return (
    <>
      <PageHeader
        back="/kb"
        title={bi('الردود الجاهزة', 'Canned replies')}
        subtitle={bi('اكتب / ثم الاختصار في خانة الرد على البلاغات وصندوق الرسائل.', 'Type / and the shortcut in the reply box of service calls and the inbox.')}
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>{bi('رد جديد', 'New reply')}</Button>}
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={q} onChange={setQ} />
          <span className="text-xs text-muted">{bi('المتغيرات:', 'Placeholders:')}</span>
          {PLACEHOLDER_HELP.map(([k, ar, en]) => <span key={k} className="text-xs"><code dir="ltr" className="rounded bg-tint px-1 text-gold-dark">{k}</code> {locale === 'en' ? en : ar}</span>)}
        </div>
      </Card>
      <ErrorBox error={list.error} />
      <Card padded={false}>
        {list.isLoading ? <Spinner /> : rows.length === 0 ? <Empty icon={<MessageSquareText className="size-8" />} title={bi('لا توجد ردود جاهزة', 'No canned replies')} /> : (
          <Table>
            <thead><tr><Th>{bi('الاختصار', 'Shortcut')}</Th><Th>{bi('العنوان', 'Title')}</Th><Th>{bi('النص', 'Text')}</Th><Th>{bi('الاستخدام', 'Used in')}</Th><Th>{bi('النوع', 'Type')}</Th><Th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-tint/40">
                  <Td><span dir="ltr" className="font-mono text-xs font-bold text-primary">/{r.shortcut}</span></Td>
                  <Td className="font-bold">{r.title}</Td>
                  <Td><span className="line-clamp-2 whitespace-pre-wrap text-xs text-muted">{locale === 'en' && r.bodyEn ? r.bodyEn : r.bodyAr}</span></Td>
                  <Td className="text-xs">{SCOPE[r.scope] ?? r.scope}</Td>
                  <Td>{r.shared ? <Badge tone="green">{bi('مشترك', 'Shared')}</Badge> : <Badge>{bi('شخصي', 'Personal')}</Badge>}</Td>
                  <Td className="whitespace-nowrap text-end">
                    {editable(r) && <>
                      <Button variant="ghost" size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(r)} aria-label={bi('تعديل', 'Edit')} />
                      <Button variant="ghost" size="sm" icon={<Trash2 className="size-3.5 text-danger" />} loading={del.isPending && del.variables === r.id} onClick={() => del.mutate(r.id)} aria-label={bi('حذف', 'Delete')} />
                    </>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <ReplyDialog reply={editing === 'new' ? null : editing} canShare={canShare} onClose={() => setEditing(null)} />}
    </>
  );
}

function ReplyDialog({ reply, canShare, onClose }: { reply: CannedReply | null; canShare: boolean; onClose: () => void }) {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const [shortcut, setShortcut] = useState(reply?.shortcut ?? '');
  const [title, setTitle] = useState(reply?.title ?? '');
  const [bodyAr, setBodyAr] = useState(reply?.bodyAr ?? '');
  const [bodyEn, setBodyEn] = useState(reply?.bodyEn ?? '');
  const [scope, setScope] = useState<CannedReply['scope']>(reply?.scope ?? 'both');
  const [shared, setShared] = useState(reply ? reply.shared : canShare);
  const save = useMutation({
    mutationFn: () => {
      const body = { shortcut: shortcut.trim().replace(/^\//, ''), title: title.trim(), bodyAr, bodyEn: bodyEn.trim() || null, scope, shared };
      return reply ? api.put<CannedReply>(`/kb/replies/${reply.id}`, body) : api.post<CannedReply>('/kb/replies', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canned-replies'] }); toast.success(bi('تم الحفظ', 'Saved')); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const valid = /^\/?[\p{L}\p{N}_-]+$/u.test(shortcut.trim()) && title.trim() && bodyAr.trim();
  return (
    <Dialog open onClose={onClose} wide title={reply ? bi('تعديل رد جاهز', 'Edit canned reply') : bi('رد جاهز جديد', 'New canned reply')}
      footer={<><Button variant="outline" onClick={onClose}>{bi('إلغاء', 'Cancel')}</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{bi('حفظ', 'Save')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={bi('الاختصار *', 'Shortcut *')} hint={bi('حروف وأرقام و - أو _ فقط', 'Letters, digits, - or _ only')}><Input dir="ltr" value={shortcut} onChange={(e) => setShortcut(e.target.value)} maxLength={40} placeholder="visit" /></Field>
        <Field label={bi('العنوان *', 'Title *')}><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Field>
        <Field className="sm:col-span-2" label={bi('النص بالعربية *', 'Arabic text *')} hint={bi('مثال: مرحبًا {customer_name}، تم استلام طلبكم {ticket_number}.', 'e.g. مرحبًا {customer_name}، تم استلام طلبكم {ticket_number}.')}>
          <Textarea dir="rtl" rows={4} value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} maxLength={4000} />
        </Field>
        <Field className="sm:col-span-2" label={bi('النص بالإنجليزية', 'English text')}><Textarea dir="ltr" rows={3} value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} maxLength={4000} /></Field>
        <Field label={bi('يُستخدم في', 'Used in')}>
          <Select value={scope} onChange={(e) => setScope(e.target.value as CannedReply['scope'])}>
            <option value="both">{bi('البلاغات وصندوق الرسائل', 'Service calls & inbox')}</option>
            <option value="ticket">{bi('البلاغات فقط', 'Service calls only')}</option>
            <option value="inbox">{bi('صندوق الرسائل فقط', 'Inbox only')}</option>
          </Select>
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox label={bi('مشترك مع الفريق', 'Shared with the team')} checked={shared} disabled={!canShare} onChange={setShared} />
        </div>
      </div>
    </Dialog>
  );
}

export default function RepliesPage() {
  const { bi } = useI18n();
  return <RequirePerm perm={['kb.read', 'ticket.write', 'message.send']} title={bi('الردود الجاهزة', 'Canned replies')}><RepliesManager /></RequirePerm>;
}
