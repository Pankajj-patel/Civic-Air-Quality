import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ensureDatabaseSchema } from './src/db/index.ts';
import { errorHandler } from './src/server/middleware/errorHandler.ts';
import { authRoutes } from './src/server/routes/authRoutes.ts';
import { briefingRoutes } from './src/server/routes/briefingRoutes.ts';
import { comparisonRoutes } from './src/server/routes/comparisonRoutes.ts';
import { datasetRoutes } from './src/server/routes/datasetRoutes.ts';
import { jobRoutes } from './src/server/routes/jobRoutes.ts';
import { orgRoutes } from './src/server/routes/orgRoutes.ts';

dotenv.config();

export async function createApp() {
  ensureDatabaseSchema();

  const app = express();
  app.set('trust proxy', 1);

  // Security headers compatible with iframe preview & Vite module scripts
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    }),
  );

  app.use(express.json({ limit: '4mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 1000 : 150,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', apiLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'civic-air-quality-briefing-studio',
      database: 'sqlite',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/orgs', orgRoutes);
  app.use('/api/datasets', datasetRoutes);
  app.use('/api/briefings', briefingRoutes);
  app.use('/api/comparisons', comparisonRoutes);
  app.use('/api/jobs', jobRoutes);

  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'API endpoint not found.',
      },
    });
  });

  app.use(errorHandler);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else if (process.env.NODE_ENV !== 'test') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  return app;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (process.env.NODE_ENV !== 'test' && isDirectRun) {
  const PORT = Number(process.env.PORT || 3000);
  createApp()
    .then((app) => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Civic Air Quality Briefing Studio server listening on http://0.0.0.0:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}


