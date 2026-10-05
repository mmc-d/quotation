import { createHmac, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { and, conversation, eq, message, messageTemplate, sql, type Tx } from '@mmc/db';
import { config } from '../config.js';

/**
 * Outbound messaging. WhatsApp Cloud API when configured (approved templates outside the 24-hour
 * service window, free text inside it); otherwise a sandbox that records the message as "sent"
 * without delivering it. E-mail via SMTP or sandbox. Every message is logged in `message`.
 */
export interface SendResult { status: 'sent' | 'failed' | 'sandboxed'; providerMessageId: string | null; error?: string }

export function fill(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

async function whatsappSend(to: string, payload: Record<string, unknown>): Promise<SendResult> {
  if (!config.whatsapp.accessToken || !config.whatsapp.phoneNumberId) return { status: 'sandboxed', providerMessageId: `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  const res = await fetch(`https://graph.facebook.com/v23.0/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), ...payload }),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
  if (!res.ok) return { status: 'failed', providerMessageId: null, error: json.error?.message ?? `HTTP ${res.status}` };
  return { status: 'sent', providerMessageId: json.messages?.[0]?.id ?? null };
}

let mailer: nodemailer.Transporter | null = null;
async function emailSend(to: string, subject: string, text: string, attachments?: { filename: string; content: Buffer }[]): Promise<SendResult> {
  if (!config.smtpUrl) return { status: 'sandboxed', providerMessageId: `sandbox-mail-${Date.now()}` };
  mailer ??= nodemailer.createTransport(config.smtpUrl);
  try {
    const info = await mailer.sendMail({ from: config.mailFrom, to, subject, text, attachments });
    return { status: 'sent', providerMessageId: info.messageId };
  } catch (e) {
    return { status: 'failed', providerMessageId: null, error: (e as Error).message };
  }
}

async function ensureConversation(tx: Tx, channel: string, address: string, link: { contactId?: string | null; partyId?: string | null; leadId?: string | null }) {
  const [existing] = await tx.select().from(conversation).where(and(eq(conversation.channel, channel), eq(conversation.externalAddress, address)));
  if (existing) return existing;
  const [c] = await tx.insert(conversation).values({ channel, externalAddress: address, contactId: link.contactId ?? null, partyId: link.partyId ?? null, leadId: link.leadId ?? null }).returning();
  return c!;
}

export interface TemplateSend {
  channel: 'whatsapp' | 'email';
  to: string;
  templateKey: string;
  vars: Record<string, string>;
  language?: string;
  subject?: string;
  related?: { type: string; id: string };
  link?: { contactId?: string | null; partyId?: string | null; leadId?: string | null };
  sentBy?: string | null;
  attachments?: { filename: string; content: Buffer }[];
}

export async function sendTemplate(tx: Tx, s: TemplateSend) {
  const [tpl] = await tx.select().from(messageTemplate).where(and(eq(messageTemplate.key, s.templateKey), eq(messageTemplate.channel, s.channel), eq(messageTemplate.language, s.language ?? 'ar')));
  if (!tpl) throw new Error(`message template ${s.templateKey}/${s.channel} missing`);
  const body = fill(tpl.body, s.vars);
  const conv = await ensureConversation(tx, s.channel, s.to, s.link ?? {});
  let r: SendResult;
  if (s.channel === 'whatsapp') {
    const inWindow = conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < 24 * 3600_000;
    r = inWindow || !tpl.providerTemplateName
      ? await whatsappSend(s.to, { type: 'text', text: { body } })
      : await whatsappSend(s.to, { type: 'template', template: { name: tpl.providerTemplateName, language: { code: tpl.language }, components: [{ type: 'body', parameters: tpl.variables.map((v) => ({ type: 'text', text: s.vars[v] ?? '' })) }] } });
  } else {
    r = await emailSend(s.to, s.subject ?? 'MMC', body, s.attachments);
  }
  const [m] = await tx.insert(message).values({
    conversationId: conv.id, direction: 'out', channel: s.channel, to: s.to, templateKey: s.templateKey, body, status: r.status === 'failed' ? 'failed' : 'sent',
    providerMessageId: r.providerMessageId, error: r.error ?? null, category: tpl.category, relatedType: s.related?.type ?? null, relatedId: s.related?.id ?? null, sentBy: s.sentBy ?? null,
  }).returning();
  await tx.update(conversation).set({ lastMessageAt: new Date(), updatedAt: new Date() }).where(eq(conversation.id, conv.id));
  return { message: m!, result: r };
}

/** Free-text reply from the shared inbox (only valid inside the 24-hour customer-service window). */
export async function sendText(tx: Tx, conversationId: string, body: string, sentBy: string | null) {
  const [conv] = await tx.select().from(conversation).where(eq(conversation.id, conversationId));
  if (!conv) throw new Error('conversation not found');
  if (conv.channel === 'whatsapp' && (!conv.lastInboundAt || Date.now() - conv.lastInboundAt.getTime() >= 24 * 3600_000)) {
    throw new Error('outside the 24-hour WhatsApp window — send an approved template instead');
  }
  const r = conv.channel === 'whatsapp' ? await whatsappSend(conv.externalAddress, { type: 'text', text: { body } }) : await emailSend(conv.externalAddress, 'MMC', body);
  const [m] = await tx.insert(message).values({ conversationId, direction: 'out', channel: conv.channel, to: conv.externalAddress, body, status: r.status === 'failed' ? 'failed' : 'sent', providerMessageId: r.providerMessageId, error: r.error ?? null, category: 'service', sentBy }).returning();
  await tx.update(conversation).set({ lastMessageAt: new Date(), unreadCount: 0, updatedAt: new Date() }).where(eq(conversation.id, conversationId));
  return m!;
}

/** Meta signs webhook bodies: X-Hub-Signature-256: sha256=<hex HMAC of raw body with app secret>. */
export function verifyMetaSignature(raw: Buffer, header: string | undefined): boolean {
  if (!config.whatsapp.appSecret) return config.env !== 'production';
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', config.whatsapp.appSecret).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header.slice(7));
  return a.length === b.length && timingSafeEqual(a, b);
}

export { sql };
