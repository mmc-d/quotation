/** AI-02 reply drafting. Nothing is sent: the user copies or inserts the text and edits it. */
export type ReplyContext = 'whatsapp' | 'email';
export type ReplyTone = 'friendly' | 'formal' | 'brief' | 'apologetic';

export function replySystem(p: { context: ReplyContext; tone: ReplyTone; language: 'ar' | 'en'; dialect?: 'msa' | 'hijazi'; company: string }): string {
  const lang = p.language === 'en'
    ? 'English'
    : p.dialect === 'hijazi' ? 'Arabic in a natural, polite Hijazi (Jeddah) dialect' : 'Modern Standard Arabic (فصحى مبسطة)';
  const channel = p.context === 'whatsapp'
    ? 'a WhatsApp reply: short (2–5 sentences), no subject line, no signature block, at most one emoji only if the tone is friendly'
    : 'an e-mail body: greeting, 1–3 short paragraphs, a closing line; no subject line';
  return `You draft customer replies for staff of ${p.company}, a Saudi trading and smart-solutions company (CCTV, access control, intercom, smart home, networking).
Write ${channel}, in ${lang}, with a ${p.tone} tone.
Rules:
- Answer what the customer last asked, using only facts present in the conversation or the staff note. Never invent prices, dates, stock, discounts or commitments — where a fact is missing, leave a clear placeholder like [السعر] / [date].
- Placeholders such as [phone] or [email] in the conversation are redacted personal data — do not try to restore them.
- Output only the reply text, nothing else.`;
}

export function replyUser(thread: string, instructions?: string): string {
  return `Conversation (oldest first; "Customer:" and "Us:" prefixes):\n${thread}${instructions ? `\n\nStaff note for this reply: ${instructions}` : ''}`;
}

export function sandboxReply(p: { language: 'ar' | 'en'; dialect?: 'msa' | 'hijazi'; context: ReplyContext }): string {
  if (p.language === 'en') return p.context === 'email'
    ? 'Dear customer,\n\nThank you for your message. We have noted your request and will get back to you shortly with the details.\n\nBest regards,'
    : 'Thank you for your message! We have noted your request and will get back to you shortly with the details.';
  if (p.dialect === 'hijazi') return 'أهلين وسهلين، شكرًا على تواصلك معانا. استلمنا طلبك وراح نرجع لك بالتفاصيل قريب إن شاء الله.';
  return p.context === 'email'
    ? 'عزيزنا العميل،\n\nشكرًا لتواصلكم معنا. تم استلام طلبكم وسنعود إليكم بالتفاصيل في أقرب وقت.\n\nمع خالص التحية،'
    : 'شكرًا لتواصلكم معنا. تم استلام طلبكم وسنعود إليكم بالتفاصيل في أقرب وقت.';
}
