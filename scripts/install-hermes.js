#!/usr/bin/env node
import { installHermes, parseCliArgs } from './hermes-install-lib.js';
import { loadRepoEnv } from './setup-env.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

try {
  const options = parseCliArgs(process.argv.slice(2));
  const sidecar = options.sidecarRoot;
  const envPath = join(sidecar, '.env');
  if (existsSync(envPath)) loadRepoEnv(envPath);

  const result = await installHermes(options);
  // Chuyển chỗ plugin (≤ 2.36 chép vào mã Hermes, nay ở <HERMES_HOME>/plugins): báo rõ đã dọn gì, giữ gì.
  for (const path of result.migration?.removed || []) console.log(`[MIGRATED] đã gỡ bản plugin cũ: ${path}`);
  for (const { path, reason } of result.migration?.kept || []) console.log(`[WARN] giữ bản plugin cũ ${path} (${reason}) — gỡ tay để Hermes dùng bản mới`);
  // Chỉ còn trường hợp hỏng mà không dừng cài: Hermes mới, `hermes pm install` lỗi (đã in [WARN] kèm lệnh chạy tay).
  for (const check of result.checks) console.log(`[${check.ok ? 'PASS' : 'WARN'}] ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
  if (result.dashboard) {
    // Không cài được dịch vụ vẫn là PASS kèm chi tiết (cảnh báo), không làm hỏng bản cài.
    console.log(`[PASS] dashboard-service - ${result.dashboard.installed ? '' : 'chưa tự chạy: '}${result.dashboard.detail}`);
    if (result.setupLink) console.log(`\nMở dashboard: ${result.setupLink}`);
    if (result.caddy) console.log(`\nThêm khối này vào Caddyfile rồi chạy "systemctl reload caddy":\n${result.caddy}`);
    // Second brain (spec §18.5.4): chỉ in cách bật khi thấy OpenViking trên Linux — không bao giờ tự đặt biến.
    if (result.secondBrain) console.log(`\n${result.secondBrain}`);
    // Trí nhớ dài hạn (spec §19.10): chỉ in cách bật, không bao giờ tự bật.
    if (result.memory) console.log(`\n${result.memory}`);
  }
  console.log('\nCài đặt hoàn tất. Mở dashboard (link thiết lập ở trên, hoặc http://127.0.0.1:3880) → mục Tài khoản Zalo để quét QR, rồi xác lập UID chủ nhân theo README.');
  console.log('Sau khi đăng nhập, khởi động hoặc khởi động lại Hermes gateway theo cách máy này đang quản lý dịch vụ.');
} catch (error) {
  console.error(`[FAIL] ${error?.message || error}`);
  process.exitCode = 1;
}
