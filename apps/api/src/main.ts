import 'reflect-metadata';
import express from 'express';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module.js';
import { auth } from './auth/auth.js';
import { config } from './config.js';
import { closeDb } from './common/db.js';

/**
 * Better Auth is mounted before the JSON body parser (it reads the raw request). Webhooks that are
 * signature-checked keep the raw body in req.rawBody.
 */
export async function createApp() {
  const server = express();
  server.disable('x-powered-by');
  server.set('trust proxy', 1);
  server.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  server.all('/api/auth/{*any}', toNodeHandler(auth));
  // CSRF defence in depth (cookies are SameSite=Lax already): state-changing staff requests must come
  // from our own origin. Webhooks and public customer pages are exempt (signed or token-scoped).
  const allowed = new Set([config.webOrigin, config.publicBaseUrl].map((u) => new URL(u).origin));
  server.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/api/webhooks/') || req.path.startsWith('/api/public/')) return next();
    const origin = req.headers.origin ?? (req.headers.referer ? new URL(req.headers.referer).origin : undefined);
    if (origin && !allowed.has(origin)) return res.status(403).json({ error: 'forbidden', message: 'cross-site request refused' });
    if (!origin && req.headers.cookie?.includes('mmc.session_token')) return res.status(403).json({ error: 'forbidden', message: 'missing Origin header' });
    return next();
  });
  server.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf; } }));
  server.use(express.urlencoded({ extended: false, limit: '1mb' }));
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { bodyParser: false, logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: [config.webOrigin], credentials: true });
  app.enableShutdownHooks();
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const app = await createApp();
  await app.listen(config.port);
  console.log(`MMC Core API on :${config.port}`);
  if (config.runWorkerInProcess) {
    const { startWorker } = await import('./worker.js');
    await startWorker().catch((e) => console.error('worker failed to start', e));
  }
  const stop = async () => { await app.close(); await closeDb(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
