import express from 'express';
import { existsSync } from 'node:fs';
import { checkOrigin, securityHeaders, sessionMiddleware } from './lib/http-guards.js';
import { authRoutes } from './routes/auth.js';

export function createDashboardApp(deps) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', checkOrigin(deps.config));
  app.use('/api', sessionMiddleware(deps));
  app.use('/api', authRoutes(deps));
  // Các router khác được gắn thêm ở Task 6–8 theo cùng mẫu: app.use('/api', xxxRoutes(deps));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  if (deps.publicDir && existsSync(deps.publicDir)) app.use(express.static(deps.publicDir, { index: 'index.html' }));
  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Không có đường dẫn này' }));
  app.use((err, req, res, next) => {
    console.error('[dashboard]', err);
    res.status(500).json({ ok: false, error: 'Lỗi bên trong dashboard — xem nhật ký dịch vụ.' });
  });
  return app;
}
