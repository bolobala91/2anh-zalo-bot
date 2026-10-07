/**
 * Gom phần đo của trang Sức khoẻ máy chủ: mỗi phút một lần đo (CPU/RAM/đĩa) vào kho 24 giờ và đưa cho
 * canh gác; mỗi 5 phút lấy một mẫu lượt gọi AI. server.js gọi `tick()` theo nhịp; route chỉ đọc.
 */
import { createCpuMeter, readHost } from './host-metrics.js';
import { createHealthHistory } from './health-history.js';
import { createAiUsage } from './ai-usage.js';

export function createHealthMonitor({
  diskPath, historyFile, usageFile, stateDb, services, watchdog = null, now = Date.now, usageEvery = 5,
  cpu = createCpuMeter(), read = readHost,
}) {
  const history = createHealthHistory({ file: historyFile, now });
  const usage = createAiUsage({ dbPath: stateDb, file: usageFile, now });
  let latest = null;
  let ticks = 0;
  return {
    async tick() {
      latest = read({ cpu, diskPath, now });
      history.add(latest);
      if (ticks++ % usageEvery === 0) usage.sample();
      if (watchdog) await watchdog.checkHost(latest);
    },
    latest: () => latest,
    points: () => history.points(),
    usage: () => usage.report(),
    services: () => services.check(),
  };
}
