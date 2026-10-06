import { createUserStore } from './users.js';
import { createSetupToken } from './setup-token.js';

/**
 * Link thiết lập tài khoản Quản trị đầu tiên. Trả về null khi đã có Quản trị
 * (không phát token mới, tránh để lại link còn hiệu lực không cần thiết).
 */
export function issueSetupLink({ paths, config }) {
  if (createUserStore(paths.usersFile).hasAdmin()) return null;
  const token = createSetupToken(paths.setupFile).issue();
  return `${config.publicUrl}/#/setup/${token}`;
}
