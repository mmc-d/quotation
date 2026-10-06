import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, Perm, type RequestActor } from '../auth/actor.js';
import { ZodPipe } from '../common/zod.js';
import {
  applyDraft, createToken, draftReply, getDraft, listDrafts, listTokens, rejectDraft, revokeToken, runBoq, translate, usage,
  type ApplyInput, type BoqInput, type ReplyInput,
} from './ai.service.js';

const boqSchema = z.object({
  text: z.string().max(200_000).nullish(),
  fileId: z.string().uuid().nullish(),
  file: z.object({ name: z.string().min(1).max(200), contentType: z.string().max(200), data: z.string().min(1).max(5_000_000) }).nullish(),
  partyId: z.string().uuid().nullish(),
});

const applySchema = z.object({
  lines: z.array(z.object({ ref: z.string().max(100).default(''), productCode: z.string().min(1).max(64), qty: z.number().positive().max(1_000_000), include: z.boolean() })).min(1).max(500),
  partyId: z.string().uuid().nullish(),
  title: z.string().max(300).nullish(),
});

const replySchema = z.object({
  context: z.enum(['whatsapp', 'email']),
  thread: z.string().max(40_000).nullish(),
  conversationId: z.string().uuid().nullish(),
  tone: z.enum(['friendly', 'formal', 'brief', 'apologetic']).default('friendly'),
  language: z.enum(['ar', 'en']),
  dialect: z.enum(['msa', 'hijazi']).nullish(),
  instructions: z.string().max(1000).nullish(),
});

const translateSchema = z.object({ text: z.string().min(1).max(8_000), to: z.enum(['ar', 'en']) });
const tokenSchema = z.object({ name: z.string().trim().min(1).max(100), expiresInDays: z.coerce.number().int().min(1).max(90).default(30) });

/** AI gateway features (module 12 §3). Every model call is logged in ai_call by the gateway. */
@Controller('ai')
export class AiController {
  /** AI-01: BOQ (XLSX / CSV / text / PDF) → suggested catalog matches, stored as a pending ai_draft. */
  @Post('boq')
  @Perm('ai.use')
  boq(@Actor() actor: RequestActor, @Body(new ZodPipe(boqSchema)) b: BoqInput) {
    return runBoq(actor, b);
  }

  @Get('drafts')
  @Perm('ai.use', 'ai.approve')
  drafts(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ status: z.string().max(100).optional() }))) q: { status?: string }) {
    return listDrafts(actor, q.status);
  }

  @Get('drafts/:id')
  @Perm('ai.use', 'ai.approve')
  draft(@Actor() actor: RequestActor, @Param('id') id: string) {
    return getDraft(actor, id);
  }

  /** A person turns the reviewed lines into a draft quote — the AI never creates it by itself. */
  @Post('drafts/:id/apply')
  @Perm('ai.approve')
  apply(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(applySchema)) b: ApplyInput) {
    return applyDraft(actor, id, b);
  }

  @Post('drafts/:id/reject')
  @Perm('ai.use', 'ai.approve')
  reject(@Actor() actor: RequestActor, @Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().max(1000).nullish() }))) b: { reason?: string | null }) {
    return rejectDraft(actor, id, b.reason);
  }

  /** AI-02: a reply suggestion; nothing is sent. */
  @Post('draft-reply')
  @Perm('ai.use')
  reply(@Actor() actor: RequestActor, @Body(new ZodPipe(replySchema)) b: ReplyInput) {
    return draftReply(actor, b);
  }

  @Post('translate')
  @Perm('ai.use')
  translate(@Actor() actor: RequestActor, @Body(new ZodPipe(translateSchema)) b: { text: string; to: 'ar' | 'en' }) {
    return translate(actor, b);
  }

  /** Usage by feature (own, or everyone's with admin.settings). */
  @Get('usage')
  usage(@Actor() actor: RequestActor, @Query(new ZodPipe(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }))) q: { days: number }) {
    return usage(actor, q.days);
  }

  // personal access tokens for the MCP server (AI-06)
  @Get('tokens')
  @Perm('ai.use')
  tokens(@Actor() actor: RequestActor) {
    return listTokens(actor);
  }

  @Post('tokens')
  @Perm('ai.use')
  createToken(@Actor() actor: RequestActor, @Body(new ZodPipe(tokenSchema)) b: { name: string; expiresInDays: number }) {
    return createToken(actor, b);
  }

  @Delete('tokens/:id')
  @Perm('ai.use')
  revokeToken(@Actor() actor: RequestActor, @Param('id') id: string) {
    return revokeToken(actor, id);
  }
}
