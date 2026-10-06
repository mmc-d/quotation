'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck, CheckCircle2, Copy, Download, FileSignature, FileSpreadsheet, FileText, GitBranch, Info, Layers, Lock, MoreHorizontal, PackagePlus, Save, Send, Tags, ThumbsDown, ThumbsUp, Wrench, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatNationalAddress } from '@mmc/domain';
import { api, openFile, qs } from '@/lib/api';
import { useMe } from '@/lib/me';
import { useI18n } from '@/lib/i18n';
import { date, dateTime } from '@/lib/format';
import { Badge, Button, Card, LinkButton, Checkbox, clsx, Dialog, Field, Input, Money, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui';
import { PartyPicker, type PickedParty } from '@/components/party-picker';
import { CatalogPanel } from './catalog-panel';
import { ConfirmDialog, errMsg, isConflict, NumInput, ReasonDialog } from './common';
import { KitDialog, productLine } from './kit-dialog';
import { LinesEditor, type SectionActions } from './lines-editor';
import { Menu } from './menu';
import { SendDialog, type PartyContact } from './send-dialog';
import { TotalsPanel } from './totals';
import { TEMPLATE_SETS, type TemplateSet } from '../../contracts/_components/types';
import {
  calcDraft, cleanMoney, cleanQty, draftFromView, draftToBody, groupLines, INS_CODE, INS_DESC, newKey, quoteNo, syncLines, trimNum, type EditLine, type Product, type QuoteDraft, type QuoteView, type ResolvedPrices,
} from './types';

interface PartySite { id: string; name: string; type: string; buildingNumber: string | null; street: string | null; district: string | null; city: string | null; postalCode: string | null; additionalNumber: string | null }
export interface PartyDetail { id: string; nameAr: string; nameEn: string | null; phone: string | null; email: string | null; vatNumber: string | null; contacts: PartyContact[]; sites: PartySite[] }

const APPROVAL_STATUS: Record<string, [string, 'gold' | 'green' | 'red' | 'gray', string]> = {
  pending: ['بانتظار القرار', 'gold', 'Awaiting decision'], approved: ['موافق عليه', 'green', 'Approved'], rejected: ['مرفوض', 'red', 'Rejected'],
};

/** Server approval reasons are English ("discount 12% > 10%") — show them in the UI language. */
function reasonText(r: string, bi: (ar: string, en: string) => string): string {
  let m = /^discount ([\d.]+)% > ([\d.]+)%$/.exec(r);
  if (m) return bi(`الخصم ${m[1]}% أعلى من الحد المسموح ${m[2]}%`, `Discount ${m[1]}% is above the allowed limit ${m[2]}%`);
  m = /^margin ([\d.-]+)% < ([\d.]+)%$/.exec(r);
  if (m) return bi(`هامش الربح ${m[1]}% أقل من الحد الأدنى ${m[2]}%`, `Margin ${m[1]}% is below the minimum ${m[2]}%`);
  m = /^discount ([\d.]+)% above your limit ([\d.]+)%$/.exec(r);
  if (m) return bi(`الخصم ${m[1]}% يتجاوز حدّك ${m[2]}%`, `Discount ${m[1]}% exceeds your limit ${m[2]}%`);
  return r;
}

type Pending = null | 'reject-approval' | 'lost' | 'rejected' | 'accept' | 'revise' | 'contract' | 'send' | 'catalog' | 'approve';

export function QuoteEditor({ view, initial }: { view?: QuoteView; initial: QuoteDraft }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { me, can } = useMe();
  const { bi, locale } = useI18n();
  const arReason = (r: string) => reasonText(r, bi);
  const vatRegistered = view?.vatRegistered ?? me?.company?.vatRegistered ?? true;
  const showCost = can('quote.cost.read');
  const canWrite = can('quote.write');
  const readOnly = !canWrite || (view ? !view.editable : false);

  const [draft, setDraft] = useState<QuoteDraft>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const loaded = useRef(view ? `${view.id}:${view.version}` : 'new');
  useEffect(() => {
    if (!view) return;
    const k = `${view.id}:${view.version}`;
    if (loaded.current === k) return;
    loaded.current = k;
    const d = draftFromView(view);
    setDraft(d);
    setBaseline(JSON.stringify(d));
  }, [view]);
  const dirty = !readOnly && JSON.stringify(draft) !== baseline;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const partyQ = useQuery({
    queryKey: ['party', draft.partyId],
    queryFn: () => api.get<PartyDetail>(`/parties/${draft.partyId}`),
    enabled: !!draft.partyId && can('party.read'),
    staleTime: 60_000,
  });
  const party = partyQ.data && partyQ.data.id === draft.partyId ? partyQ.data : null;
  const picked: PickedParty | null = draft.partyId
    ? party ? { id: party.id, nameAr: party.nameAr, nameEn: party.nameEn, phone: party.phone, email: party.email, vatNumber: party.vatNumber } : { id: draft.partyId, nameAr: draft.clientName || '…', nameEn: null, phone: null, email: null, vatNumber: null }
    : null;

  const calc = useMemo(() => calcDraft(draft, vatRegistered), [draft, vatRegistered]);
  const t = calc.totals;

  const warnings = useMemo(() => {
    const out = new Set<string>();
    if (me && t.discountPercent > me.maxDiscountPercent) out.add(bi(`الخصم ${t.discountPercent}% يتجاوز حدّك المسموح ${me.maxDiscountPercent}%`, `Discount ${t.discountPercent}% exceeds your allowed limit ${me.maxDiscountPercent}%`));
    const policy = me?.company?.approvalPolicy;
    if (policy && t.discountPercent > policy.maxDiscountPercent) out.add(bi(`الخصم ${t.discountPercent}% أعلى من الحد المسموح ${policy.maxDiscountPercent}%`, `Discount ${t.discountPercent}% is above the allowed limit ${policy.maxDiscountPercent}%`));
    if (policy && showCost && t.cost > 0 && t.marginPercent !== null && t.marginPercent < policy.minMarginPercent) out.add(bi(`هامش الربح ${t.marginPercent}% أقل من الحد الأدنى ${policy.minMarginPercent}%`, `Margin ${t.marginPercent}% is below the minimum ${policy.minMarginPercent}%`));
    if (view && !dirty) view.approvalReasons.forEach((r) => out.add(arReason(r)));
    return [...out];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, t, showCost, view, dirty, locale]);

  // ── draft mutations ─────────────────────────────────────────
  const set = (patch: Partial<QuoteDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setLines = (fn: (lines: EditLine[], d: QuoteDraft) => EditLine[], extra?: Partial<QuoteDraft>) =>
    setDraft((d) => {
      const next = { ...d, ...extra };
      return { ...next, lines: syncLines(fn(d.lines, next), next.insDeleted) };
    });

  const addedIds = useMemo(() => new Set(draft.lines.map((l) => l.productId).filter((x): x is string => !!x)), [draft.lines]);
  const addedCodes = useMemo(() => new Set(draft.lines.map((l) => l.code)), [draft.lines]);

  // new lines go to this section (CPQ-13); '' = no section
  const [addTo, setAddTo] = useState('');
  const targetSection = addTo && draft.sections.some((s) => s.key === addTo) ? addTo : null;
  const [kitPick, setKitPick] = useState<{ p: Product; price?: string } | null>(null);

  /** customerPrice: the customer's price-list price (unit price); the list price stays the catalog price. */
  const addProduct = (p: Product, customerPrice?: string) => {
    if (p.type === 'kit') { setKitPick({ p, price: customerPrice }); return; }
    if (addedIds.has(p.id) || addedCodes.has(p.code)) { toast.info(bi(`المنتج ${p.code} موجود في العرض`, `Product ${p.code} is already in the quote`)); return; }
    setLines((lines) => [...lines, productLine(p, '1', { price: customerPrice, sectionKey: targetSection })]);
    toast.success(bi(`تمت إضافة ${p.code}`, `${p.code} added`));
  };
  const addKitLines = (newLines: EditLine[], mode: 'expand' | 'single') => {
    const kit = kitPick?.p;
    setKitPick(null);
    if (mode === 'single' && kit && (addedIds.has(kit.id) || addedCodes.has(kit.code))) { toast.info(bi(`الباقة ${kit.code} موجودة في العرض`, `Package ${kit.code} is already in the quote`)); return; }
    setLines((lines) => {
      const out = [...lines];
      for (const nl of newLines) {
        // a component already in the quote (same section, same optional flag) gets its qty raised instead of a duplicate line
        const j = out.findIndex((l) => l.productId === nl.productId && l.isOptional === nl.isOptional && (l.sectionKey ?? null) === (nl.sectionKey ?? null));
        if (j >= 0) out[j] = { ...out[j]!, qty: trimNum(Number(cleanQty(out[j]!.qty)) + Number(nl.qty)) };
        else out.push(nl);
      }
      return out;
    });
    toast.success(mode === 'expand' ? bi(`أُضيفت مكونات الباقة ${kit?.code ?? ''} (${newLines.length} بند)`, `Package ${kit?.code ?? ''} components added (${newLines.length} lines)`) : bi(`تمت إضافة الباقة ${kit?.code ?? ''}`, `Package ${kit?.code ?? ''} added`));
  };

  // ── sections (CPQ-13) ───────────────────────────────────────
  const addSection = () => {
    const key = newKey();
    setDraft((d) => ({ ...d, sections: [...d.sections, { key, title: '' }] }));
    setAddTo(key);
  };
  const sectionActions: SectionActions = {
    rename: (key, title) => setDraft((d) => ({ ...d, sections: d.sections.map((s) => (s.key === key ? { ...s, title } : s)) })),
    move: (key, dir) => setDraft((d) => {
      const i = d.sections.findIndex((s) => s.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.sections.length) return d;
      const sections = [...d.sections];
      [sections[i], sections[j]] = [sections[j]!, sections[i]!];
      return { ...d, sections };
    }),
    remove: (key) => {
      setDraft((d) => ({ ...d, sections: d.sections.filter((s) => s.key !== key), lines: d.lines.map((l) => (l.sectionKey === key ? { ...l, sectionKey: null } : l)) }));
      if (addTo === key) setAddTo('');
    },
  };
  const sectionTotals = useMemo(() => new Map(t.sections.map((s) => [s.key, s.subtotal])), [t.sections]);
  const changeLine = (i: number, patch: Partial<EditLine>) => setLines((lines) => lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => {
    const isIns = draft.lines[i]?.code === INS_CODE;
    setLines((lines) => lines.filter((_, j) => j !== i), isIns ? { insDeleted: true } : undefined);
    if (isIns) toast.info(bi('حُذف صف التركيب — يمكنك إعادته من الكتالوج', 'Installation line removed — you can restore it from the catalog'));
  };
  // moves inside the line's group (its section, or "no section"); INS stays last
  const moveLine = (i: number, dir: -1 | 1) => setLines((lines, d) => {
    const g = groupLines(lines, d.sections).find((x) => !x.ins && x.items.some((it) => it.i === i));
    if (!g) return lines;
    const pos = g.items.findIndex((it) => it.i === i);
    const j = g.items[pos + dir]?.i;
    if (j === undefined) return lines;
    const copy = [...lines];
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    return copy;
  });
  const resetIns = () => setLines((lines) => lines.map((l) => (l.code === INS_CODE ? { ...l, manualPrice: false } : l)));
  const restoreIns = () => {
    setDraft((d) => {
      let lines = syncLines(d.lines, false);
      if (!lines.some((l) => l.code === INS_CODE)) {
        lines = [...lines, { key: newKey(), productId: null, code: INS_CODE, description: INS_DESC, listPrice: '0', unitPrice: '0', qty: '1', installCost: '0', unitCost: null, isOptional: false, manualPrice: true, imageUrl: null, sectionKey: null }];
      }
      return { ...d, insDeleted: false, lines };
    });
    toast.success(bi('أُعيد صف التركيب', 'Installation line restored'));
  };

  const pickParty = (p: PickedParty | null) => {
    const prevPartyId = draft.partyId;
    if (!p) set({ partyId: null, contactId: null, siteId: null });
    else set({ partyId: p.id, contactId: null, siteId: null, clientName: p.nameAr, clientPhone: p.phone ?? draft.clientPhone, clientEmail: p.email ?? draft.clientEmail });
    if ((p?.id ?? null) !== prevPartyId) void repriceForParty(prevPartyId, p?.id ?? null);
  };
  /**
   * Customer changed: lines still at the previous customer's price move to the new customer's price
   * (price list, else catalog). Hand-edited prices and kit prices don't match the old price, so they stay.
   */
  const repriceForParty = async (fromParty: string | null, toParty: string | null) => {
    const ids = [...new Set(draft.lines.filter((l) => l.productId && l.code !== INS_CODE).map((l) => l.productId!))];
    if (!ids.length || !can('product.read')) return;
    try {
      const resolve = (partyId: string | null) => api.get<ResolvedPrices>(`/price-lists/resolve${qs({ partyId, productIds: ids.join(',') })}`);
      const [before, after] = await Promise.all([resolve(fromParty), resolve(toParty)]);
      const reprice = (l: EditLine): EditLine | null => {
        const was = l.productId ? before.prices[l.productId] : undefined;
        const now = l.productId ? after.prices[l.productId] : undefined;
        if (!was || !now || l.code === INS_CODE || Number(l.unitPrice) !== Number(was.price) || Number(now.price) === Number(l.unitPrice)) return null;
        return { ...l, unitPrice: trimNum(now.price), listPrice: trimNum(now.listPrice) };
      };
      // count from the snapshot (state updaters run later); apply to the latest lines
      const changed = draft.lines.filter((l) => reprice(l)).length;
      setLines((lines) => lines.map((l) => reprice(l) ?? l));
      if (changed) toast.info(after.priceList ? bi(`أُعيد تسعير ${changed} بند حسب قائمة «${after.priceList.name}»`, `${changed} lines repriced per price list “${after.priceList.name}”`) : bi(`أُعيد تسعير ${changed} بند بسعر الكتالوج`, `${changed} lines repriced at catalog price`));
    } catch (e) {
      toast.error(bi(`تعذّر تحديث الأسعار: ${errMsg(e)}`, `Could not update prices: ${errMsg(e)}`));
    }
  };
  const pickContact = (id: string) => {
    const c = party?.contacts.find((x) => x.id === id);
    set({ contactId: id || null, ...(c ? { clientPhone: c.mobile ?? c.whatsapp ?? draft.clientPhone, clientEmail: c.email ?? draft.clientEmail } : {}) });
  };
  const pickSite = (id: string) => {
    const s = party?.sites.find((x) => x.id === id);
    set({ siteId: id || null, ...(s ? { projectLocation: formatNationalAddress(s) || s.name } : {}) });
  };

  // ── server actions ──────────────────────────────────────────
  const applyView = (v: QuoteView) => {
    qc.setQueryData(['quote', v.id], v);
    qc.invalidateQueries({ queryKey: ['quotes'] });
  };

  const save = async (): Promise<QuoteView | null> => {
    const body = draftToBody(draft, vatRegistered);
    setBusy('save');
    try {
      if (!view) {
        const v = await api.post<QuoteView>('/quotes', body);
        setBaseline(JSON.stringify(draft));
        qc.setQueryData(['quote', v.id], v);
        qc.invalidateQueries({ queryKey: ['quotes'] });
        toast.success(bi(`تم حفظ العرض ${v.number}`, `Quote ${v.number} saved`));
        router.replace(`/quotes/${v.id}`);
        return v;
      }
      const v = await api.put<QuoteView>(`/quotes/${view.id}`, { ...body, version: view.version });
      applyView(v);
      toast.success(view.status !== v.status && v.status === 'draft' ? bi('تم الحفظ — أُعيد العرض إلى مسودة ويحتاج اعتمادًا جديدًا', 'Saved — the quote is back to draft and needs a new approval') : bi('تم حفظ العرض', 'Quote saved'));
      return v;
    } catch (e) {
      if (isConflict(e)) {
        toast.error(bi('عدّل مستخدم آخر هذا العرض — أعد التحميل لرؤية آخر نسخة', 'Another user edited this quote — reload to see the latest version'), { action: { label: bi('إعادة التحميل', 'Reload'), onClick: () => qc.invalidateQueries({ queryKey: ['quote', view?.id] }).then(() => { loaded.current = ''; }) }, duration: 10_000 });
      } else toast.error(errMsg(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  /** Save pending edits first, then run the action on the saved quote. */
  const withSaved = async (fn: (v: QuoteView) => Promise<void> | void) => {
    if (!view) return;
    let v: QuoteView | null = view;
    if (dirty) v = await save();
    if (v) await fn(v);
  };

  const run = async <T,>(key: string, fn: () => Promise<T>, ok?: string): Promise<T | null> => {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error(errMsg(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const submit = () => withSaved(async (v) => {
    const r = await run('submit', () => api.post<{ status: string; quote: QuoteView }>(`/quotes/${v.id}/submit`));
    if (r) { applyView(r.quote); toast.success(r.status === 'approved' ? bi('اعتُمد العرض تلقائيًا — جاهز للإرسال', 'Quote approved automatically — ready to send') : bi('أُرسل العرض للموافقة', 'Quote submitted for approval')); }
  });
  const approve = async (comment: string) => {
    if (!view) return;
    const v = await run('approve', () => api.post<QuoteView>(`/quotes/${view.id}/approve`, { comment: comment || null }), bi('تمت الموافقة على العرض', 'Quote approved'));
    if (v) { applyView(v); setPending(null); }
  };
  const rejectApproval = async (comment: string) => {
    if (!view) return;
    const v = await run('reject', () => api.post<QuoteView>(`/quotes/${view.id}/reject-approval`, { comment }), bi('رُفض الطلب وأُعيد العرض إلى مسودة', 'Request rejected and the quote returned to draft'));
    if (v) { applyView(v); setPending(null); }
  };
  const setStatus = async (status: 'accepted' | 'lost' | 'rejected', reason?: string) => {
    if (!view) return;
    const msg = { accepted: bi('عُلّم العرض كمقبول', 'Quote marked as accepted'), lost: bi('عُلّم العرض كخسارة', 'Quote marked as lost'), rejected: bi('عُلّم العرض كمرفوض', 'Quote marked as rejected') }[status];
    const v = await run('status', () => api.post<QuoteView>(`/quotes/${view.id}/status`, { status, reason: reason || null }), msg);
    if (v) { applyView(v); setPending(null); }
  };
  const revise = async () => {
    if (!view) return;
    const v = await run('revise', () => api.post<QuoteView>(`/quotes/${view.id}/revise`), bi('أُنشئت نسخة معدّلة', 'Revision created'));
    if (v) { qc.invalidateQueries({ queryKey: ['quote', view.id] }); qc.invalidateQueries({ queryKey: ['quotes'] }); setPending(null); router.push(`/quotes/${v.id}`); }
  };
  const duplicate = () => withSaved(async (v) => {
    const n = await run('duplicate', () => api.post<QuoteView>(`/quotes/${v.id}/duplicate`), bi('تم إنشاء نسخة جديدة من العرض', 'A new copy of the quote was created'));
    if (n) { qc.invalidateQueries({ queryKey: ['quotes'] }); router.push(`/quotes/${n.id}`); }
  });
  const [contractSet, setContractSet] = useState<TemplateSet>('supply_install');
  const createContract = async () => {
    if (!view) return;
    const c = await run('contract', () => api.post<{ id: string; number: string }>(`/contracts/from-quote/${view.id}`, { templateSet: contractSet }), bi('تم إنشاء العقد', 'Contract created'));
    if (c) { qc.invalidateQueries({ queryKey: ['quote', view.id] }); qc.invalidateQueries({ queryKey: ['contracts'] }); setPending(null); router.push(`/contracts/${c.id}`); }
  };

  const status = view?.status ?? 'draft';
  const needsApproval = dirty ? warnings.length > 0 : (view?.needsApproval ?? warnings.length > 0);
  const canSend = !!view && can('quote.send') && (['approved', 'sent', 'viewed'].includes(status) || (status === 'draft' && !needsApproval));
  const canContract = !!view && can('contract.write') && ['accepted', 'approved', 'sent', 'viewed'].includes(status);
  const canRevise = !!view && canWrite && ['sent', 'viewed', 'rejected', 'expired'].includes(status);

  const title = view ? <span className="flex flex-wrap items-center gap-2">{bi('عرض سعر', 'Quote')} <span className="num" dir="ltr">{quoteNo(view.number, view.revision)}</span><StatusBadge status={view.status} />{dirty && <Badge tone="gold">{bi('تعديلات غير محفوظة', 'Unsaved changes')}</Badge>}</span> : bi('عرض سعر جديد', 'New quote');

  const catalog = (
    <CatalogPanel addedIds={addedIds} addedCodes={addedCodes} onAdd={addProduct} onAddIns={restoreIns} insAvailable={!draft.lines.some((l) => l.code === INS_CODE)} partyId={draft.partyId} className="h-full" />
  );

  return (
    <>
      <PageHeader
        back="/quotes"
        title={title}
        subtitle={view ? <>{bi('بتاريخ', 'Dated')} <span className="num">{date(view.quoteDate)}</span>{view.owner && <> · {bi('المندوب:', 'Sales rep:')} {view.owner.nameAr ?? view.owner.email}</>}{view.sentAt && <> · {bi('أُرسل', 'Sent')} <span className="num">{dateTime(view.sentAt)}</span></>}{view.viewedAt && <> · {bi('شوهد', 'Viewed')} <span className="num">{dateTime(view.viewedAt)}</span></>}</> : bi('اختر العميل ثم أضف البنود من الكتالوج', 'Choose the customer, then add lines from the catalog')}
        actions={
          <>
            {!readOnly && <Button icon={<Save className="size-4" />} loading={busy === 'save'} disabled={!!view && !dirty} onClick={() => void save()}>{view ? bi('حفظ', 'Save') : bi('حفظ العرض', 'Save quote')}</Button>}
            {view && status === 'draft' && canWrite && <Button variant="gold" icon={<BadgeCheck className="size-4" />} loading={busy === 'submit'} onClick={() => void submit()}>{needsApproval ? bi('إرسال للموافقة', 'Submit for approval') : bi('اعتماد العرض', 'Approve quote')}</Button>}
            {view && status === 'pending_approval' && can('quote.approve') && (
              <>
                <Button variant="gold" icon={<ThumbsUp className="size-4" />} loading={busy === 'approve'} onClick={() => setPending('approve')}>{bi('موافقة', 'Approve')}</Button>
                <Button variant="outline" icon={<ThumbsDown className="size-4" />} onClick={() => setPending('reject-approval')}>{bi('رفض', 'Reject')}</Button>
              </>
            )}
            {canSend && <Button variant={status === 'approved' ? 'gold' : 'outline'} icon={<Send className="size-4" />} onClick={() => void withSaved(() => setPending('send'))}>{bi('إرسال', 'Send')}</Button>}
            {view && <Button variant="outline" icon={<FileText className="size-4" />} onClick={() => void withSaved((v) => openFile(`/quotes/${v.id}/pdf`))}>PDF</Button>}
            {view?.contract ? (
              <LinkButton href={`/contracts/${view.contract.id}`} icon={<FileSignature className="size-4" />}>{bi('العقد', 'Contract')} {view.contract.number}</LinkButton>
            ) : canContract && <Button variant={status === 'accepted' ? 'gold' : 'outline'} icon={<FileSignature className="size-4" />} onClick={() => setPending('contract')}>{bi('إنشاء عقد', 'Create contract')}</Button>}
            {view && (
              <Menu label={bi('المزيد', 'More')} icon={<MoreHorizontal className="size-4" />} items={[
                { label: bi('تصدير Excel', 'Export Excel'), icon: <FileSpreadsheet className="size-4" />, onClick: () => void withSaved((v) => openFile(`/quotes/${v.id}/excel`)) },
                { label: bi('نسخة معدّلة (Revision)', 'Revision'), icon: <GitBranch className="size-4" />, onClick: () => setPending('revise'), hidden: !canRevise },
                { label: bi('تكرار العرض', 'Duplicate quote'), icon: <Copy className="size-4" />, onClick: () => void duplicate(), hidden: !canWrite },
                { label: bi('تعليم كمقبول', 'Mark as accepted'), icon: <CheckCircle2 className="size-4" />, onClick: () => setPending('accept'), hidden: !canWrite || !['approved', 'sent', 'viewed'].includes(status) },
                { label: bi('تعليم كمرفوض من العميل', 'Mark as rejected by customer'), icon: <XCircle className="size-4" />, onClick: () => setPending('rejected'), hidden: !canWrite || !['sent', 'viewed'].includes(status), danger: true },
                { label: bi('تعليم كخسارة', 'Mark as lost'), icon: <XCircle className="size-4" />, onClick: () => setPending('lost'), hidden: !canWrite || !['draft', 'approved', 'sent', 'viewed'].includes(status), danger: true },
              ]} />
            )}
          </>
        }
      />

      {view && !view.editable && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <span className="flex items-center gap-2"><Lock className="size-4" />{status === 'superseded' ? bi('هذه نسخة قديمة استُبدلت بنسخة أحدث — للعرض فقط.', 'This is an old version superseded by a newer one — read only.') : ['accepted', 'lost'].includes(status) ? bi('العرض مغلق — للعرض فقط.', 'The quote is closed — read only.') : bi('العرض مُرسل ولا يمكن تعديله. لإجراء تغييرات أنشئ نسخة معدّلة (Revision).', 'The quote has been sent and cannot be edited. To make changes, create a revision.')}{view.lostReason && <> {bi('السبب:', 'Reason:')} <b>{view.lostReason}</b></>}</span>
          {canRevise && <Button size="sm" variant="outline" icon={<GitBranch className="size-3.5" />} loading={busy === 'revise'} onClick={() => setPending('revise')}>{bi('إنشاء نسخة معدّلة', 'Create revision')}</Button>}
        </div>
      )}
      {view && status === 'pending_approval' && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div>{bi('العرض بانتظار الموافقة', 'The quote is pending approval')}{view.approvalReasons.length > 0 && <>: {view.approvalReasons.map(arReason).join(bi('، ', '; '))}</>}{bi('. أي تعديل يعيده إلى مسودة.', '. Any edit returns it to draft.')}</div>
        </div>
      )}
      {view && status === 'approved' && !dirty && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><BadgeCheck className="size-4" />{bi('العرض معتمد وجاهز للإرسال. أي تعديل يلغي الاعتماد.', 'The quote is approved and ready to send. Any edit cancels the approval.')}</div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="min-w-0 space-y-5">
          <Card title={bi('العميل والمشروع', 'Customer & project')}>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Field label={bi('العميل (من سجل العملاء)', 'Customer (from the customer register)')} className="md:col-span-2 lg:col-span-1">
                {readOnly ? <div className="rounded-lg border border-line bg-gray-50 px-3 py-2 text-sm font-bold">{picked ? (draft.partyId ? <Link href={`/customers/${draft.partyId}`} className="text-primary hover:underline">{picked.nameAr}</Link> : picked.nameAr) : '—'}</div> : <PartyPicker value={picked} onChange={pickParty} />}
              </Field>
              {party && party.contacts.length > 0 && (
                <Field label={bi('جهة الاتصال', 'Contact')}>
                  <Select value={draft.contactId ?? ''} onChange={(e) => pickContact(e.target.value)} disabled={readOnly}>
                    <option value="">—</option>
                    {party.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isPrimary ? ' ★' : ''}</option>)}
                  </Select>
                </Field>
              )}
              {party && party.sites.length > 0 && (
                <Field label={bi('الموقع / العنوان', 'Site / address')}>
                  <Select value={draft.siteId ?? ''} onChange={(e) => pickSite(e.target.value)} disabled={readOnly}>
                    <option value="">—</option>
                    {party.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
              )}
              <Field label={bi('اسم العميل (كما يُطبع)', 'Customer name (as printed)')}><Input value={draft.clientName} onChange={(e) => set({ clientName: e.target.value })} disabled={readOnly} /></Field>
              <Field label={bi('الجوال', 'Mobile')}><Input dir="ltr" type="tel" value={draft.clientPhone} onChange={(e) => set({ clientPhone: e.target.value })} disabled={readOnly} placeholder="05XXXXXXXX" /></Field>
              <Field label={bi('البريد الإلكتروني', 'E-mail')}><Input dir="ltr" type="email" value={draft.clientEmail} onChange={(e) => set({ clientEmail: e.target.value })} disabled={readOnly} /></Field>
              <Field label={bi('اسم المشروع', 'Project name')}><Input value={draft.projectName} onChange={(e) => set({ projectName: e.target.value })} disabled={readOnly} /></Field>
              <Field label={bi('موقع المشروع', 'Project location')}><Input value={draft.projectLocation} onChange={(e) => set({ projectLocation: e.target.value })} disabled={readOnly} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={bi('تاريخ العرض', 'Quote date')}><Input type="date" value={draft.quoteDate} onChange={(e) => set({ quoteDate: e.target.value })} disabled={readOnly} /></Field>
                <Field label={bi('صالح حتى', 'Valid until')} hint={!draft.validUntil && !view ? bi('تلقائي حسب الإعدادات', 'Automatic per settings') : undefined}><Input type="date" value={draft.validUntil} onChange={(e) => set({ validUntil: e.target.value })} disabled={readOnly} /></Field>
              </div>
            </div>
          </Card>

          <Card
            padded={false}
            title={<span className="flex flex-wrap items-center gap-2">{bi('البنود', 'Lines')} <span className="rounded-full bg-tint px-2 text-[11px] text-gold-dark">{draft.lines.length}</span>{view?.priceList && view.partyId === draft.partyId && <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 text-[11px] font-bold text-primary" title={bi('قائمة الأسعار المطبّقة على هذا العرض', 'Price list applied to this quote')}><Tags className="size-3" />{view.priceList.name}</span>}</span>}
            actions={!readOnly && (
              <>
                {draft.sections.length > 0 && (
                  <Select value={targetSection ?? ''} onChange={(e) => setAddTo(e.target.value)} aria-label={bi('إضافة البنود الجديدة إلى', 'Add new lines to')} title={bi('إضافة البنود الجديدة إلى', 'Add new lines to')} className="h-8 w-auto max-w-[11rem] py-0 text-xs">
                    <option value="">{bi('الإضافة إلى: بدون قسم', 'Add to: no section')}</option>
                    {draft.sections.map((s, k) => <option key={s.key} value={s.key}>{bi('الإضافة إلى:', 'Add to:')} {s.title.trim() || bi(`قسم ${k + 1}`, `Section ${k + 1}`)}</option>)}
                  </Select>
                )}
                <Button size="sm" variant="outline" icon={<Layers className="size-3.5" />} onClick={addSection}>{bi('إضافة قسم', 'Add section')}</Button>
                {draft.insDeleted && !draft.lines.some((l) => l.code === INS_CODE) && <Button size="sm" variant="ghost" icon={<Wrench className="size-3.5" />} onClick={restoreIns} className="hidden sm:inline-flex">{bi('إعادة صف التركيب', 'Restore installation line')}</Button>}
                <Button size="sm" icon={<PackagePlus className="size-3.5" />} onClick={() => setPending('catalog')} className="xl:hidden">{bi('إضافة من الكتالوج', 'Add from catalog')}</Button>
              </>
            )}
          >
            {draft.lines.length === 0 && draft.sections.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <PackagePlus className="size-8 text-gold" />
                <p className="font-bold">{bi('لا توجد بنود بعد', 'No lines yet')}</p>
                <p className="text-sm text-muted">{readOnly ? bi('هذا العرض بلا بنود.', 'This quote has no lines.') : bi('اختر المنتجات من الكتالوج لإضافتها إلى العرض. يُضاف صف التركيب والبرمجة تلقائيًا.', 'Pick products from the catalog to add them to the quote. The installation & programming line is added automatically.')}</p>
                {!readOnly && <Button size="sm" onClick={() => setPending('catalog')} className="xl:hidden">{bi('فتح الكتالوج', 'Open catalog')}</Button>}
              </div>
            ) : (
              <LinesEditor lines={draft.lines} results={calc.lines} readOnly={readOnly} onChange={changeLine} onRemove={removeLine} onMove={moveLine} onResetIns={resetIns} sections={draft.sections} sectionTotals={sectionTotals} sectionActions={sectionActions} />
            )}
          </Card>

          <Card title={bi('الملاحظات الفنية والشروط', 'Technical notes & terms')}>
            <div className="grid gap-3 lg:grid-cols-2">
              <Field label={bi('ملاحظات فنية', 'Technical notes')} hint={!view ? bi('تُملأ من الإعدادات الافتراضية عند الحفظ إذا تُركت فارغة', 'Filled from the default settings on save if left empty') : undefined}>
                {readOnly ? <p className="min-h-[3rem] whitespace-pre-line rounded-lg border border-line bg-gray-50 px-3 py-2 text-sm">{draft.notes || '—'}</p> : <Textarea rows={7} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />}
              </Field>
              <Field label={bi('الشروط والأحكام', 'Terms & conditions')}>
                {readOnly ? <p className="min-h-[3rem] whitespace-pre-line rounded-lg border border-line bg-gray-50 px-3 py-2 text-sm">{draft.terms || '—'}</p> : <Textarea rows={7} value={draft.terms} onChange={(e) => set({ terms: e.target.value })} />}
              </Field>
            </div>
          </Card>
        </div>

        <aside className="min-w-0 space-y-5">
          <Card title={bi('الإجمالي', 'Total')}>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <Field label={bi('خصم %', 'Discount %')}>
                <NumInput value={draft.discountType === 'percent' ? draft.discountValue : ''} placeholder="0" disabled={readOnly} ariaLabel={bi('نسبة الخصم', 'Discount percentage')} onChange={(v) => set({ discountType: 'percent', discountValue: v })} />
              </Field>
              <Field label={bi('خصم بالمبلغ', 'Discount amount')}>
                <NumInput value={draft.discountType === 'amount' ? draft.discountValue : ''} placeholder="0" disabled={readOnly} ariaLabel={bi('مبلغ الخصم', 'Discount amount')} onChange={(v) => set({ discountType: 'amount', discountValue: v })} />
              </Field>
            </div>
            {draft.discountType === 'percent' && Number(cleanMoney(draft.discountValue)) > 100 && <p className="-mt-2 mb-2 text-xs text-danger">{bi('نسبة الخصم لا تتجاوز 100%', 'Discount cannot exceed 100%')}</p>}
            <div className="mb-3 rounded-lg border border-line px-3 py-2">
              <Checkbox label={bi('إضافة ضريبة القيمة المضافة 15%', 'Add 15% VAT')} checked={draft.vatOn && vatRegistered} disabled={readOnly || !vatRegistered} onChange={(v) => set({ vatOn: v })} />
              {!vatRegistered && <p className="mt-1 text-xs font-bold text-amber-800">{bi('المنشأة غير مسجلة في ضريبة القيمة المضافة', 'The company is not registered for VAT')}</p>}
            </div>
            <TotalsPanel totals={t} showCost={showCost} vatRegistered={vatRegistered} warnings={warnings} />
          </Card>

          {!readOnly && (
            <Card title={bi('الكتالوج', 'Catalog')} className="hidden xl:block">
              <div className="h-[34rem]">{catalog}</div>
            </Card>
          )}

          {view && view.revisions.length > 1 && (
            <Card title={bi('النسخ', 'Revisions')}>
              <ul className="space-y-1">
                {view.revisions.map((r) => (
                  <li key={r.id}>
                    <Link href={`/quotes/${r.id}`} className={clsx('flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-tint', r.id === view.id && 'bg-primary-50 font-extrabold')}>
                      <span className="num font-bold text-primary">R{r.revision}</span>
                      <StatusBadge status={r.status} />
                      <Money value={r.total} className="text-xs" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {view && view.approvals.length > 0 && (
            <Card title={bi('سجل الموافقات', 'Approval history')}>
              <ul className="space-y-3">
                {view.approvals.map((a) => {
                  const [labelAr, tone, labelEn] = APPROVAL_STATUS[a.status] ?? [a.status, 'gray', a.status];
                  const label = bi(labelAr, labelEn);
                  return (
                    <li key={a.id} className="border-s-2 border-line ps-3 text-sm">
                      <div className="flex items-center justify-between gap-2"><Badge tone={tone}>{label}</Badge><span className="num text-[11px] text-muted">{dateTime(a.decidedAt ?? a.createdAt)}</span></div>
                      {a.reasons.length > 0 && <div className="mt-1 text-xs text-muted">{a.reasons.map(arReason).join(bi('، ', '; '))}</div>}
                      {a.comment && <div className="mt-1 rounded bg-tint/60 px-2 py-1 text-xs">«{a.comment}»</div>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {view && view.documents.length > 0 && (
            <Card title={bi('المستندات الصادرة', 'Issued documents')}>
              <ul className="space-y-1">
                {view.documents.map((d) => (
                  <li key={d.id}>
                    <a href={`/api/files/${d.fileId}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-tint">
                      <span className="flex items-center gap-2"><Download className="size-4 text-gold" /><span className="num font-bold">{quoteNo(d.number, d.revision)}.pdf</span></span>
                      <span className="num text-[11px] text-muted">{dateTime(d.issuedAt)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      {/* dialogs */}
      <Dialog open={pending === 'catalog'} onClose={() => setPending(null)} title={bi('إضافة من الكتالوج', 'Add from catalog')} footer={<Button onClick={() => setPending(null)}>{bi('تم', 'Done')}</Button>}>
        <div className="h-[60vh]">{pending === 'catalog' && catalog}</div>
      </Dialog>
      {kitPick && <KitDialog kit={kitPick.p} kitPrice={kitPick.price} partyId={draft.partyId} sectionKey={targetSection} onClose={() => setKitPick(null)} onAdd={addKitLines} />}
      {view && pending === 'send' && <SendDialog open onClose={() => setPending(null)} quote={view} contacts={party?.contacts ?? []} onSent={applyView} />}
      <ReasonDialog open={pending === 'approve'} title={bi('الموافقة على العرض', 'Approve quote')} label={bi('تعليق (اختياري)', 'Comment (optional)')} confirmLabel={bi('موافقة', 'Approve')} loading={busy === 'approve'} onConfirm={(c) => void approve(c)} onClose={() => setPending(null)} hint={view && view.approvalReasons.length > 0 ? bi(`أسباب طلب الموافقة: ${view.approvalReasons.map(arReason).join('، ')}`, `Approval reasons: ${view.approvalReasons.map(arReason).join('; ')}`) : undefined} />
      <ReasonDialog open={pending === 'reject-approval'} title={bi('رفض طلب الموافقة', 'Reject approval request')} label={bi('سبب الرفض', 'Rejection reason')} required danger confirmLabel={bi('رفض', 'Reject')} loading={busy === 'reject'} onConfirm={(c) => void rejectApproval(c)} onClose={() => setPending(null)} hint={bi('سيعود العرض إلى مسودة ويُبلَّغ المندوب بالسبب.', 'The quote returns to draft and the sales rep is notified of the reason.')} />
      <ReasonDialog open={pending === 'lost'} title={bi('تعليم العرض كخسارة', 'Mark quote as lost')} label={bi('سبب الخسارة', 'Loss reason')} required danger confirmLabel={bi('تعليم كخسارة', 'Mark as lost')} loading={busy === 'status'} onConfirm={(r) => void setStatus('lost', r)} onClose={() => setPending(null)} />
      <ReasonDialog open={pending === 'rejected'} title={bi('رفض العميل للعرض', 'Customer rejected the quote')} label={bi('سبب الرفض', 'Rejection reason')} danger confirmLabel={bi('تعليم كمرفوض', 'Mark as rejected')} loading={busy === 'status'} onConfirm={(r) => void setStatus('rejected', r)} onClose={() => setPending(null)} />
      <ConfirmDialog open={pending === 'accept'} title={bi('تعليم العرض كمقبول', 'Mark quote as accepted')} message={bi('سيُعلَّم العرض كمقبول من العميل وتنتقل الفرصة المرتبطة إلى «تم الفوز». يمكنك بعدها إنشاء العقد.', 'The quote will be marked as accepted by the customer and the linked opportunity moves to “Won”. You can then create the contract.')} confirmLabel={bi('تعليم كمقبول', 'Mark as accepted')} loading={busy === 'status'} onConfirm={() => void setStatus('accepted')} onClose={() => setPending(null)} />
      <ConfirmDialog open={pending === 'revise'} title={bi('إنشاء نسخة معدّلة', 'Create revision')} message={view ? <>{bi('ستُنشأ النسخة', 'Revision')} <b className="num">R{Math.max(...view.revisions.map((r) => r.revision), view.revision) + 1}</b> {bi('كمسودة قابلة للتعديل، وتُعلَّم هذه النسخة كمُستبدلة.', 'will be created as an editable draft, and this version will be marked as superseded.')}</> : null} confirmLabel={bi('إنشاء النسخة', 'Create revision')} loading={busy === 'revise'} onConfirm={() => void revise()} onClose={() => setPending(null)} />
      <ConfirmDialog open={pending === 'contract'} title={bi('إنشاء عقد من العرض', 'Create contract from quote')} message={<>
        <p>{bi('سيُنشأ عقد (مسودة) من بنود هذا العرض مع البنود القانونية وجدول الدفعات الافتراضي لنوع العقد.', 'A draft contract will be created from this quote’s lines, with the legal clauses and the default payment schedule for the contract type.')}{status !== 'accepted' && <> {bi('سيُعلَّم العرض كمقبول.', 'The quote will be marked as accepted.')}</>}</p>
        <div className="mt-3 space-y-2" role="radiogroup" aria-label={bi('نوع العقد', 'Contract type')}>
          {TEMPLATE_SETS.map((ts) => (
            <label key={ts.value} className={clsx('flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2', contractSet === ts.value ? 'border-primary bg-primary-50' : 'border-line hover:bg-tint/40')}>
              <input type="radio" name="contract-set" className="mt-1 accent-[var(--color-primary)]" checked={contractSet === ts.value} onChange={() => setContractSet(ts.value)} />
              <span><span className="block font-bold">{bi(ts.label, ts.labelEn)}</span><span className="block text-xs text-muted">{bi(ts.hint, ts.hintEn)}</span></span>
            </label>
          ))}
        </div>
      </>} confirmLabel={bi('إنشاء العقد', 'Create contract')} loading={busy === 'contract'} onConfirm={() => void createContract()} onClose={() => setPending(null)} />
    </>
  );
}
