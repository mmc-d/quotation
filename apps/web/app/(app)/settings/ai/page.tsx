'use client';
/**
 * Settings → AI: personal access tokens for the read-only MCP server (AI-06) and AI usage
 * (last 30 days by feature — everyone's with admin.settings, otherwise the user's own).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { date, dateTime } from '@/lib/format';
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';

interface Token { id: string; name: string; scopes: string[]; expiresAt: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
interface Usage {
  days: number; scope: 'own' | 'company'; sandbox: boolean; model: string;
  byFeature: { feature: string; calls: number; errors: number; inputTokens: number; outputTokens: number; costUsd: string }[];
  byUser: { userId: string | null; name: string | null; email: string | null; calls: number; costUsd: string }[];
  today: { spentUsd: number; budgetUsd: number };
}

const usd = (v: string | number) => `$${Number(v).toFixed(Number(v) < 1 ? 4 : 2)}`;

async function copy(text: string, ok: string, fail: string) {
  try { await navigator.clipboard.writeText(text); toast.success(ok); } catch { toast.error(fail); }
}

export default function AiSettingsPage() {
  const { bi } = useI18n();
  const { can } = useMe();
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2"><Bot className="size-5 text-gold" />{bi('الذكاء الاصطناعي', 'AI & tokens')}</span>} subtitle={bi('مفاتيح الوصول الشخصية لربط Claude بالمنصة (قراءة فقط) واستهلاك الذكاء الاصطناعي.', 'Personal access tokens to connect Claude to the platform (read-only) and AI usage.')} />
      {can('ai.use') ? <Tokens /> : <Card><p className="text-sm text-muted">{bi('لا تملك صلاحية استخدام الذكاء الاصطناعي.', 'You do not have the “use AI” permission.')}</p></Card>}
      <UsageCard />
    </>
  );
}

function Tokens() {
  const { bi } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Claude');
  const [days, setDays] = useState('30');
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const q = useQuery({ queryKey: ['ai-tokens'], queryFn: () => api.get<Token[]>('/ai/tokens') });
  const create = useMutation({
    mutationFn: () => api.post<{ token: string; name: string }>('/ai/tokens', { name: name.trim(), expiresInDays: Number(days) }),
    onSuccess: (r) => { setCreated(r); setOpen(false); qc.invalidateQueries({ queryKey: ['ai-tokens'] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/ai/tokens/${id}`),
    onSuccess: () => { toast.success(bi('أُلغي المفتاح', 'Token revoked')); qc.invalidateQueries({ queryKey: ['ai-tokens'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const url = `${origin}/api/mcp`;
  const cliCmd = `claude mcp add --transport http mmc-core ${url} --header "Authorization: Bearer ${created?.token ?? '<token>'}"`;
  const now = Date.now();

  return (
    <Card
      title={<span className="flex items-center gap-2"><KeyRound className="size-4 text-gold" />{bi('مفاتيح الوصول الشخصية (MCP)', 'Personal access tokens (MCP)')}</span>}
      actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => { setName('Claude'); setDays('30'); setOpen(true); }}>{bi('مفتاح جديد', 'New token')}</Button>}
    >
      <p className="text-sm text-muted">
        {bi('يتيح المفتاح لمساعد مثل Claude قراءة بياناتك بنفس صلاحياتك فقط (العملاء، العروض، العقود، المشاريع، المخزون، الأرصدة، الأجهزة، البلاغات) — دون أي تعديل. لا تشارك المفتاح؛ يمكنك إلغاؤه في أي وقت.', 'A token lets an assistant such as Claude read data with exactly your permissions (customers, quotes, contracts, projects, stock, balances, devices, service calls) — it cannot change anything. Do not share it; you can revoke it at any time.')}
      </p>
      <div className="mt-3 rounded-lg border border-line bg-tint/40 p-3 text-sm">
        <p className="font-bold">{bi('عنوان خادم MCP', 'MCP server URL')}</p>
        <div className="mt-1 flex items-center gap-2"><code dir="ltr" className="flex-1 truncate rounded bg-white px-2 py-1 text-xs">{url}</code><Button size="sm" variant="outline" icon={<Copy className="size-3.5" />} onClick={() => copy(url, bi('تم النسخ', 'Copied'), bi('تعذّر النسخ', 'Could not copy'))}>{bi('نسخ', 'Copy')}</Button></div>
        <p className="mt-2 text-xs text-muted">{bi('Claude Code: نفّذ الأمر التالي بعد إنشاء مفتاح. ‏Claude Desktop وغيره: أضف خادم MCP من نوع HTTP بهذا العنوان مع الترويسة Authorization: Bearer ومفتاحك.', 'Claude Code: run the command below after creating a token. Claude Desktop and other clients: add an HTTP MCP server with this URL and the header Authorization: Bearer <your token>.')}</p>
        <code dir="ltr" className="mt-1 block overflow-x-auto whitespace-pre rounded bg-white px-2 py-1 text-xs">{cliCmd}</code>
      </div>

      {created && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-bold text-emerald-900">{bi('انسخ المفتاح الآن — لن يُعرض مرة أخرى.', 'Copy the token now — it will not be shown again.')}</p>
          <div className="mt-1 flex items-center gap-2"><code dir="ltr" className="flex-1 break-all rounded bg-white px-2 py-1 text-xs">{created.token}</code><Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => copy(created.token, bi('تم نسخ المفتاح', 'Token copied'), bi('تعذّر النسخ', 'Could not copy'))}>{bi('نسخ', 'Copy')}</Button></div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setCreated(null)}>{bi('تم، أخفِ المفتاح', 'Done, hide it')}</Button>
        </div>
      )}

      <div className="mt-3">
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : !q.data?.length ? <Empty icon={<KeyRound className="size-8" />} title={bi('لا توجد مفاتيح', 'No tokens yet')} /> : (
          <Table>
            <thead><tr><Th>{bi('الاسم', 'Name')}</Th><Th>{bi('الحالة', 'Status')}</Th><Th>{bi('ينتهي', 'Expires')}</Th><Th>{bi('آخر استخدام', 'Last used')}</Th><Th /></tr></thead>
            <tbody>
              {q.data.map((t) => {
                const expired = new Date(t.expiresAt).getTime() < now;
                return (
                  <tr key={t.id}>
                    <Td className="font-bold">{t.name}</Td>
                    <Td>{t.revokedAt ? <Badge tone="red">{bi('ملغى', 'Revoked')}</Badge> : expired ? <Badge>{bi('منتهي', 'Expired')}</Badge> : <Badge tone="green">{bi('فعّال', 'Active')}</Badge>}</Td>
                    <Td><span className="num">{date(t.expiresAt)}</span></Td>
                    <Td><span className="num">{t.lastUsedAt ? dateTime(t.lastUsedAt) : '—'}</span></Td>
                    <Td className="text-end">{!t.revokedAt && !expired && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5 text-danger" />} loading={revoke.isPending && revoke.variables === t.id} onClick={() => revoke.mutate(t.id)}>{bi('إلغاء', 'Revoke')}</Button>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={bi('مفتاح وصول جديد', 'New access token')}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{bi('إلغاء', 'Cancel')}</Button><Button loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>{bi('إنشاء', 'Create')}</Button></>}
      >
        <Field label={bi('الاسم', 'Name')} hint={bi('مثال: Claude Desktop — حاسوب المكتب', 'e.g. Claude Desktop — office laptop')}><Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={bi('الصلاحية', 'Expires after')} className="mt-3">
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">{bi('7 أيام', '7 days')}</option>
            <option value="30">{bi('30 يومًا', '30 days')}</option>
            <option value="60">{bi('60 يومًا', '60 days')}</option>
            <option value="90">{bi('90 يومًا (الحد الأقصى)', '90 days (maximum)')}</option>
          </Select>
        </Field>
        <p className="mt-3 text-xs text-muted">{bi('النطاق: قراءة فقط (mcp:read).', 'Scope: read-only (mcp:read).')}</p>
        <ErrorBox error={create.error} />
      </Dialog>
    </Card>
  );
}

const FEATURE_LABELS: Record<string, [string, string]> = {
  boq: ['جدول الكميات ← عرض سعر', 'BOQ → quote'],
  reply: ['صياغة الردود', 'Reply drafting'],
  translate: ['الترجمة', 'Translation'],
};

function UsageCard() {
  const { bi } = useI18n();
  const q = useQuery({ queryKey: ['ai-usage'], queryFn: () => api.get<Usage>('/ai/usage?days=30') });
  const u = q.data;
  const label = (f: string) => {
    const l = FEATURE_LABELS[f];
    if (l) return bi(l[0], l[1]);
    return f.startsWith('mcp:') ? `MCP · ${f.slice(4)}` : f;
  };
  return (
    <Card className="mt-3" title={bi('استهلاك الذكاء الاصطناعي — آخر 30 يومًا', 'AI usage — last 30 days')} actions={u && <span className="flex items-center gap-2">{u.sandbox && <Badge tone="blue">{bi('وضع تجريبي', 'Sandbox')}</Badge>}<Badge>{u.scope === 'company' ? bi('كل المستخدمين', 'All users') : bi('استهلاكي فقط', 'My usage only')}</Badge></span>} padded={false}>
      {q.isLoading ? <Spinner /> : q.error ? <div className="p-3"><ErrorBox error={q.error} /></div> : !u?.byFeature.length ? <Empty title={bi('لا يوجد استهلاك بعد', 'No usage yet')} /> : (
        <>
          <Table>
            <thead><tr><Th>{bi('الميزة', 'Feature')}</Th><Th>{bi('الطلبات', 'Calls')}</Th><Th>{bi('أخطاء / مرفوضة', 'Errors / blocked')}</Th><Th>{bi('رموز الإدخال', 'Input tokens')}</Th><Th>{bi('رموز الإخراج', 'Output tokens')}</Th><Th>{bi('التكلفة', 'Cost')}</Th></tr></thead>
            <tbody>
              {u.byFeature.map((f) => (
                <tr key={f.feature}>
                  <Td className="font-bold">{label(f.feature)}</Td>
                  <Td><span className="num">{f.calls}</span></Td>
                  <Td><span className="num">{f.errors}</span></Td>
                  <Td><span className="num">{f.inputTokens.toLocaleString('en')}</span></Td>
                  <Td><span className="num">{f.outputTokens.toLocaleString('en')}</span></Td>
                  <Td><span className="num">{usd(f.costUsd)}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {u.byUser.length > 0 && (
            <Table className="mt-2">
              <thead><tr><Th>{bi('المستخدم', 'User')}</Th><Th>{bi('الطلبات', 'Calls')}</Th><Th>{bi('التكلفة', 'Cost')}</Th></tr></thead>
              <tbody>{u.byUser.map((x) => <tr key={x.userId ?? 'none'}><Td>{x.name ?? x.email ?? '—'}</Td><Td><span className="num">{x.calls}</span></Td><Td><span className="num">{usd(x.costUsd)}</span></Td></tr>)}</tbody>
            </Table>
          )}
        </>
      )}
      {u && <p className="border-t border-line px-3 py-2 text-xs text-muted">{bi('اليوم:', 'Today:')} <span className="num">{usd(u.today.spentUsd)} / {usd(u.today.budgetUsd)}</span> · {bi('النموذج:', 'Model:')} <span dir="ltr">{u.model}</span></p>}
    </Card>
  );
}
