/**
 * Entry point: boot the in-memory database, seed it, start the live simulator
 * and serve both the JSON API and the mission-control dashboard.
 */
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { connectDatabase, disconnectDatabase } from './db';
import { seedDatabase, startSimulator } from './seeder';
import { helpers } from './controllers/views';
import apiRouter from './routes/api';
import viewRouter from './routes/views';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const TICK_SECONDS = Math.max(2, Number.parseInt(process.env.TICK_SECONDS ?? '10', 10) || 10);

export function createApp(): express.Express {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.disable('x-powered-by');

  app.use(express.json({ limit: '64kb' }));
  app.use('/api', apiRouter);
  app.use('/', viewRouter);

  // Unmatched page route.
  app.use((req, res) => {
    res.status(404).render('layout', {
      view: 'error',
      helpers,
      title: 'Not found',
      status: 404,
      heading: 'No such console',
      detail: `Nothing is mounted at ${req.path}.`,
    });
  });

  // Central error handler — the last line of defence for any thrown/rejected handler.
  const onError: ErrorRequestHandler = (error, req, res, _next) => {
    console.error('[error]', req.method, req.originalUrl, error);
    if (res.headersSent) return;

    if (req.path.startsWith('/api')) {
      res.status(500).json({ ok: false, error: 'Internal server error' });
      return;
    }
    res.status(500).render('layout', {
      view: 'error',
      helpers,
      title: 'Station link error',
      status: 500,
      heading: 'Telemetry link interrupted',
      detail: 'The twin hit an internal error rendering this console. Check the server log.',
    });
  };
  app.use(onError);

  return app;
}

async function main(): Promise<void> {
  console.log('[boot] starting in-memory MongoDB (first run downloads the mongod binary)...');
  const uri = await connectDatabase();
  console.log(`[boot] database ready at ${uri}`);

  const summary = await seedDatabase();
  console.log(`[boot] seeded ${summary.stations} stations with ${summary.readings} telemetry records`);

  const stopSimulator = startSimulator(TICK_SECONDS);
  console.log(`[boot] live simulator ticking every ${TICK_SECONDS}s`);

  const server = createApp().listen(PORT, () => {
    console.log(`[boot] dashboard  -> http://localhost:${PORT}`);
    console.log(`[boot] API health -> http://localhost:${PORT}/api/health`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[shutdown] ${signal} received, closing down...`);
    stopSimulator();
    server.close();
    await disconnectDatabase().catch((error) => console.error('[shutdown]', error));
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Keep the station on the air: log and carry on rather than dying mid-demo.
  process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
  process.on('uncaughtException', (error) => console.error('[uncaughtException]', error));
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[boot] fatal:', error);
    process.exit(1);
  });
}
