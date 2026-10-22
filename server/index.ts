import fs from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z, ZodError } from 'zod';
import { ACTIVE_STATUSES } from '../shared/jobs';
import { browserManager } from './browser/browserManager';
import { cdpRelay } from './bridge/cdpRelay';
import { config } from './config';
import { automationManager, BatchFailure, ValidationFailure } from './services/automationManager';
import { parseBatch, parseDraft, parseMetaPages, parseYouTubeChannels } from './services/contentValidator';
import { readSettings, writeSettings } from './utils/settings';
import { MediaError, mediaStore } from './services/mediaStore';
import { logger } from './utils/logger';

const app = express();
app.disable('x-powered-by');

// ---------- access control ----------
// The engine binds to 127.0.0.1. Requests must target a local Host (blocks DNS rebinding). Pages
// may call it only from a local origin or from a hosted dashboard listed in allowedOrigins (CORS);
// state-changing calls also need our custom header, which forces a CORS preflight. Media files can
// be loaded cross-site only with their per-file token.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLocalOrigin = (origin: string) => {
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
};
app.use((req, res, next) => {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (!LOCAL_HOSTS.has(host)) return res.status(403).json({ error: 'Forbidden host' });
  const origin = req.headers.origin;
  const hosted = !!origin && config.allowedOrigins.includes(origin);
  if (origin && !hosted && !isLocalOrigin(origin)) return res.status(403).json({ error: 'Forbidden origin' });
  // CORS for allowed hosted dashboards and for local pages on another port (e.g. a preview build).
  const corsOk = !!origin && (hosted || isLocalOrigin(origin));
  if (corsOk) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SPA-Client');
      // Chrome's Private/Local Network Access: a public page calling 127.0.0.1.
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.setHeader('Access-Control-Max-Age', '600');
      return res.status(204).end();
    }
  }
  const mediaFile = /^\/api\/media\/([\w-]+)\/file$/.exec(req.path);
  const tokenOk = !!mediaFile && req.method === 'GET' && mediaStore.validToken(mediaFile[1], String(req.query.t ?? ''));
  if (req.headers['sec-fetch-site'] === 'cross-site' && !corsOk && !tokenOk) return res.status(403).json({ error: 'Cross-site request blocked' });
  if (req.path.startsWith('/api/') && req.method !== 'GET' && req.headers['x-spa-client'] !== '1') {
    return res.status(403).json({ error: 'Missing client header' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  dest: mediaStore.tmpDir,
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 },
});

const asyncRoute = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

// ---------- media ----------
app.get('/api/media', (_req, res) => res.json(mediaStore.list()));

app.post(
  '/api/media',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    const n = (v: unknown) => (typeof v === 'string' && v ? Number(v) : undefined);
    const item = await mediaStore.adopt(req.file.path, Buffer.from(req.file.originalname, 'latin1').toString('utf8'), 'upload', {
      width: n(req.body?.width),
      height: n(req.body?.height),
      durationSec: n(req.body?.durationSec),
    });
    res.json(item);
  }),
);

app.post(
  '/api/media/import',
  asyncRoute(async (req, res) => {
    const { url } = z.object({ url: z.string().min(1).max(4000) }).parse(req.body);
    res.json(await mediaStore.importFromUrl(url));
  }),
);

app.get('/api/media/:id/file', (req, res) => {
  const item = mediaStore.get(String(req.params.id));
  if (!item) return res.status(404).end();
  res.setHeader('Content-Type', item.mime);
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(item.filePath, { dotfiles: 'allow' });
});

app.delete(
  '/api/media/:id',
  asyncRoute(async (req, res) => {
    res.json({ removed: await mediaStore.remove(String(req.params.id)) });
  }),
);

app.delete(
  '/api/media',
  asyncRoute(async (_req, res) => {
    await mediaStore.clear();
    res.json({ ok: true });
  }),
);

// ---------- automation ----------
app.post('/api/prepare', (req, res) => {
  // New shape: { posts: [{ id, title, draft }], publish? }. Old shape: { draft } (a single post).
  // Auto-publish only on an explicit boolean true from the dashboard's switch.
  if (req.body?.posts) {
    res.json({ jobs: automationManager.prepareBatch(parseBatch(req.body.posts), req.body.publish === true) });
  } else {
    res.json({ jobs: automationManager.prepare(parseDraft(req.body?.draft)) });
  }
});

app.get('/api/jobs', (_req, res) => res.json(automationManager.list()));
app.post('/api/jobs/:id/retry', (req, res) => res.json(automationManager.retry(String(req.params.id))));
app.post('/api/jobs/:id/continue', (req, res) => {
  automationManager.continue(String(req.params.id));
  res.json({ ok: true });
});
app.post('/api/jobs/:id/cancel', (req, res) => {
  automationManager.cancel(String(req.params.id));
  res.json({ ok: true });
});
app.post(
  '/api/jobs/:id/focus',
  asyncRoute(async (req, res) => {
    await automationManager.focus(String(req.params.id));
    res.json({ ok: true });
  }),
);
app.delete('/api/jobs/:id', (req, res) => {
  automationManager.dismiss(String(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/jobs', (_req, res) => {
  automationManager.clearFinished();
  res.json({ ok: true });
});

// ---------- browser ----------
app.get('/api/browser', (_req, res) => res.json(browserManager.state()));
// `user` lets a hosted dashboard tell apart the engines of several Windows users on one PC.
app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'prepost-engine', user: os.userInfo().username, port: config.port }));
app.post(
  '/api/browser/open',
  asyncRoute(async (req, res) => {
    // Only fixed, known platform pages can be opened; no user-supplied URLs.
    const { platform } = z.object({ platform: z.enum(['meta', 'x', 'youtube', 'tiktok']) }).parse(req.body);
    await automationManager.openPlatform(platform);
    res.json(browserManager.state());
  }),
);
app.post(
  '/api/browser/launch',
  asyncRoute(async (_req, res) => {
    await browserManager.getContext();
    res.json(browserManager.state());
  }),
);
app.post(
  '/api/browser/mode',
  asyncRoute(async (req, res) => {
    const { mode } = z.object({ mode: z.enum(['bundled', 'chrome', 'extension']) }).parse(req.body);
    if (automationManager.list().some((j) => ACTIVE_STATUSES.includes(j.status))) throw new Error('Cancel or finish running jobs before switching browsers.');
    await browserManager.setMode(mode);
    res.json(browserManager.state());
  }),
);
app.post(
  '/api/browser/open-dashboard',
  asyncRoute(async (req, res) => {
    // Only this app's own address may be opened: local, or an allowed hosted dashboard.
    const { origin } = z
      .object({ origin: z.string().refine((o) => /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(o) || config.allowedOrigins.includes(o), 'Not this app') })
      .parse(req.body);
    const page = await browserManager.newPage();
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    res.json(browserManager.state());
  }),
);
app.post(
  '/api/browser/close',
  asyncRoute(async (_req, res) => {
    await browserManager.close();
    res.json(browserManager.state());
  }),
);

// ---------- Meta Pages (names only; stored with app settings) ----------
app.get('/api/meta/pages', (_req, res) => res.json({ pages: (readSettings().metaPages as unknown[]) ?? [] }));
app.put('/api/meta/pages', (req, res) => {
  const pages = parseMetaPages(req.body?.pages);
  writeSettings({ metaPages: pages });
  res.json({ pages });
});
app.post(
  '/api/meta/pages/refresh',
  asyncRoute(async (_req, res) => {
    const fetched = await automationManager.refreshMetaPages();
    const pages = parseMetaPages(fetched);
    writeSettings({ metaPages: pages });
    res.json({ pages });
  }),
);

// ---------- YouTube channels (names only; stored with app settings) ----------
app.get('/api/youtube/channels', (_req, res) => res.json({ channels: (readSettings().youtubeChannels as unknown[]) ?? [] }));
app.put('/api/youtube/channels', (req, res) => {
  const channels = parseYouTubeChannels(req.body?.channels);
  writeSettings({ youtubeChannels: channels });
  res.json({ channels });
});
app.post(
  '/api/youtube/channels/refresh',
  asyncRoute(async (_req, res) => {
    const channels = parseYouTubeChannels(await automationManager.refreshYouTubeChannels());
    writeSettings({ youtubeChannels: channels });
    res.json({ channels });
  }),
);

app.get('/api/logs', (_req, res) => res.json(logger.recent(300)));

// ---------- live updates (Server-Sent Events) ----------
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('jobs', automationManager.list());
  send('browser', browserManager.state());
  const onJobs = (jobs: unknown) => send('jobs', jobs);
  const onBrowser = (state: unknown) => send('browser', state);
  automationManager.on('change', onJobs);
  browserManager.on('change', onBrowser);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    automationManager.off('change', onJobs);
    browserManager.off('change', onBrowser);
  });
});

cdpRelay.on('change', () => browserManager.emit('change', browserManager.state()));

browserManager.on('change', (state: { open: boolean }) => {
  if (!state.open) automationManager.abortAll('The browser was closed.');
});

// ---------- production frontend ----------
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (config.production && fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// ---------- errors ----------
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof BatchFailure) return res.status(422).json({ error: err.message, posts: err.posts });
  if (err instanceof ValidationFailure) return res.status(422).json({ error: err.message, details: err.details });
  if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid request.', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  if (err instanceof MediaError) return res.status(400).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : err.message });
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error('server', message);
  res.status(400).json({ error: message });
});

const ENGINE_PORTS =Array.from({ length: 10 }, (_, i) => 5174 + i);

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = app.listen(port, config.host);
    s.once('listening', () => resolve(s));
    s.once('error', reject);
  });
}

/**
 * Every Windows user signed in on one PC shares 127.0.0.1, so each user's engine needs its own port.
 * `npm start` keeps the port it used last time (saved in this user's data folder, so the extension's
 * port setting stays valid) and otherwise takes the first free one of 5174–5183. PORT pins it (dev).
 */
async function listenForThisUser(): Promise<Server> {
  const portFile = path.join(config.dataDir, 'engine-port');
  let saved = 0;
  try {
    saved = Number(fs.readFileSync(portFile, 'utf8').trim()) || 0;
  } catch {
    /* first start for this user */
  }
  const candidates = !config.production || process.env.PORT ? [config.port] : [...new Set([saved, ...ENGINE_PORTS].filter(Boolean))];
  for (const port of candidates) {
    try {
      const server = await listenOn(port);
      config.port = port;
      // Chrome's debugging port would collide the same way in "Google Chrome, separate profile" mode.
      if (!process.env.SPA_CHROME_DEBUG_PORT) config.chromeDebugPort = 9222 + (port - 5174);
      fs.writeFileSync(portFile, String(port));
      return server;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port === candidates.at(-1)) throw e;
      logger.info('server', `Port ${port} is taken (another user's Prepost?), trying the next one`);
    }
  }
  throw new Error('No free port');
}

async function main() {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(config.dataDir, 0o700);
  await mediaStore.init();
  const server = await listenForThisUser();
  logger.info('server', `API listening on http://${config.host}:${config.port} (user ${os.userInfo().username})`);
  if (config.production) logger.info('server', `Open http://localhost:${config.port} in your browser`);
  cdpRelay.attach(server);
  const shutdown = async () => {
    logger.info('server', 'Shutting down');
    server.close();
    await browserManager.close();
    await mediaStore.clear().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
