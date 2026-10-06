'use client';
/**
 * AI-02 helpers: "Draft reply with AI" (dialog → editable suggestion → copy / insert) and a small
 * "Translate" button. Nothing is sent from here — the user always reviews and sends it themselves.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, CornerDownLeft, Languages, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/me';
import { Badge, Button, Dialog, ErrorBox, Field, Select, Textarea } from './ui';

type Tone = 'friendly' | 'formal' | 'brief' | 'apologetic';
interface AiText { text: string; sandbox: boolean }

export function AiAssist({ context, thread, conversationId, onInsert, size = 'sm' }: {
  context: 'whatsapp' | 'email';
  /** conversation text ("Customer: …" / "Us: …" lines); or pass conversationId */
  thread?: string;
  conversationId?: string;
  onInsert?: (text: string) => void;
  size?: 'sm' | 'md';
}) {
  const { bi, locale } = useI18n();
  const { can } = useMe();
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<Tone>('friendly');
  const [language, setLanguage] = useState<'ar' | 'en'>(locale);
  const [dialect, setDialect] = useState<'msa' | 'hijazi'>('msa');
  const [instructions, setInstructions] = useState('');
  const [text, setText] = useState('');
  const [sandbox, setSandbox] = useState(false);
  const gen = useMutation({
    mutationFn: () => api.post<AiText>('/ai/draft-reply', { context, thread: thread || null, conversationId: thread ? null : conversationId ?? null, tone, language, dialect: language === 'ar' ? dialect : null, instructions: instructions.trim() || null }),
    onSuccess: (r) => { setText(r.text); setSandbox(r.sandbox); },
  });
  if (!can('ai.use')) return null;

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success(bi('تم النسخ', 'Copied')); } catch { toast.error(bi('تعذّر النسخ', 'Could not copy')); }
  };

  return (
    <>
      <Button type="button" variant="outline" size={size} icon={<Sparkles className="size-4 text-gold" />} onClick={() => setOpen(true)}>
        {bi('صياغة رد بالذكاء الاصطناعي', 'Draft reply with AI')}
      </Button>
      {/* portalled: the button often sits inside a reply <form>, whose submit must never fire from here */}
      {open && createPortal(<Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-gold" />{bi('صياغة رد بالذكاء الاصطناعي', 'Draft reply with AI')}{sandbox && <Badge tone="blue">{bi('وضع تجريبي', 'Sandbox')}</Badge>}</span>}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{bi('إغلاق', 'Close')}</Button>
            <Button type="button" variant="outline" icon={<Copy className="size-4" />} disabled={!text.trim()} onClick={copy}>{bi('نسخ', 'Copy')}</Button>
            {onInsert && <Button type="button" icon={<CornerDownLeft className="size-4 rtl:-scale-x-100" />} disabled={!text.trim()} onClick={() => { onInsert(text.trim()); setOpen(false); }}>{bi('إدراج في الرد', 'Insert into reply')}</Button>}
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={bi('الأسلوب', 'Tone')}>
            <Select value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
              <option value="friendly">{bi('ودّي', 'Friendly')}</option>
              <option value="formal">{bi('رسمي', 'Formal')}</option>
              <option value="brief">{bi('مختصر', 'Brief')}</option>
              <option value="apologetic">{bi('اعتذاري', 'Apologetic')}</option>
            </Select>
          </Field>
          <Field label={bi('اللغة', 'Language')}>
            <Select value={language} onChange={(e) => setLanguage(e.target.value as 'ar' | 'en')}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </Select>
          </Field>
          {language === 'ar' && (
            <Field label={bi('اللهجة', 'Dialect')}>
              <Select value={dialect} onChange={(e) => setDialect(e.target.value as 'msa' | 'hijazi')}>
                <option value="msa">{bi('فصحى مبسطة', 'Modern Standard')}</option>
                <option value="hijazi">{bi('حجازية', 'Hijazi')}</option>
              </Select>
            </Field>
          )}
        </div>
        <Field label={bi('توجيه إضافي (اختياري)', 'Extra instructions (optional)')} className="mt-3">
          <Textarea rows={2} maxLength={1000} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={bi('مثال: اعتذر عن التأخير واقترح زيارة يوم الأحد', 'e.g. apologise for the delay and offer a visit on Sunday')} />
        </Field>
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="gold" loading={gen.isPending} icon={<Sparkles className="size-4" />} onClick={() => gen.mutate()}>{text ? bi('إعادة الصياغة', 'Regenerate') : bi('اقترح ردًا', 'Suggest a reply')}</Button>
        </div>
        <ErrorBox error={gen.error} />
        {(text || gen.isPending) && (
          <Field label={bi('الرد المقترح — راجعه وعدّله قبل الإرسال', 'Suggested reply — review and edit before sending')} className="mt-3">
            <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} dir={language === 'ar' ? 'rtl' : 'ltr'} />
          </Field>
        )}
        <p className="mt-2 text-xs text-muted">{bi('لا يُرسل شيء تلقائيًا. تُحذف أرقام الجوال والهوية والبريد قبل إرسال النص لمزوّد الذكاء الاصطناعي.', 'Nothing is sent automatically. Phone numbers, IDs and e-mails are removed before the text goes to the AI provider.')}</p>
      </Dialog>, document.body)}
    </>
  );
}

/** Translate a text field AR↔EN; the result replaces nothing until the caller applies it. */
export function TranslateButton({ text, to, onResult }: { text: string; to: 'ar' | 'en'; onResult: (text: string) => void }) {
  const { bi } = useI18n();
  const { can } = useMe();
  const tr = useMutation({
    mutationFn: () => api.post<AiText>('/ai/translate', { text, to }),
    onSuccess: (r) => { onResult(r.text); toast.success(r.sandbox ? bi('ترجمة تجريبية (وضع تجريبي)', 'Sandbox translation') : bi('تمت الترجمة — راجع النص', 'Translated — please review')); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!can('ai.use')) return null;
  return (
    <Button type="button" variant="ghost" size="sm" loading={tr.isPending} disabled={!text.trim()} icon={<Languages className="size-4 text-gold" />} onClick={() => tr.mutate()}>
      {to === 'en' ? bi('ترجمة إلى الإنجليزية', 'Translate to English') : bi('ترجمة إلى العربية', 'Translate to Arabic')}
    </Button>
  );
}

/**
 * For the legacy bilingual description «عربي | English»: fills the missing half by translating the
 * present one (Arabic → English, or English → Arabic). The user still saves the form.
 */
export function BilingualTranslate({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [ar, en] = value.split('|').map((s) => s.trim());
  const hasArabic = /[؀-ۿ]/.test(ar ?? '');
  if (en) return null;
  const src = (ar ?? '').trim();
  return hasArabic
    ? <TranslateButton text={src} to="en" onResult={(t) => onChange(`${src} | ${t}`)} />
    : <TranslateButton text={src} to="ar" onResult={(t) => onChange(`${t} | ${src}`)} />;
}
