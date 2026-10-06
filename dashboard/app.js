import express from 'express';
import { existsSync } from 'node:fs';
import { checkOrigin, securityHeaders, sessionMiddleware } from './lib/http-guards.js';
import { authRoutes } from './routes/auth.js';
import { statusRoutes } from './routes/status.js';
import { zaloRoutes } from './routes/zalo.js';
import { chatRoutes } from './routes/chats.js';
import { auditRoutes } from './routes/audit.js';
import { telegramRoutes } from './routes/telegram.js';
import { adminRoutes } from './routes/admin.js';

export function createDashboardApp(deps) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', checkOrigin(deps.config));
  app.use('/api', sessionMiddleware(deps));
  app.use('/api', authRoutes(deps));
  app.use('/api', statusRoutes(deps));
  app.use('/api', zaloRoutes(deps));
  app.use('/api', chatRoutes(deps));
  app.use('/api', auditRoutes(deps));
  if (deps.linker) app.use('/api', telegramRoutes(deps));
  app.use('/api', adminRoutes(deps));
  // Các router khác được gắn thêm ở Task 8 theo cùng mẫu: app.use('/api', xxxRoutes(deps));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  if (deps.publicDir && existsSync(deps.publicDir)) app.use(express.static(deps.publicDir, { index: 'index.html' }));
  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Không có đường dẫn này' }));
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode;
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      return res.status(status).json({ ok: false, error: status === 413 ? 'Dữ liệu gửi lên quá lớn — thu nhỏ rồi thử lại.' : 'Dữ liệu gửi lên không hợp lệ — kiểm tra lại rồi thử lại.' });
    }
    console.error('[dashboard]', err);
    res.status(500).json({ ok: false, error: 'Lỗi bên trong dashboard — xem nhật ký dịch vụ.' });
  });
  return app;
}
