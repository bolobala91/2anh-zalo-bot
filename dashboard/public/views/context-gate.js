import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Spinner, PageHead } from '../ui.js';
import { REASONS, MODELS, STATUSES, PROVIDERS } from '../context-gate-data.js';

const when = (at) => new Date(at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
const noAttemptLabel = (reason) => {
  if (['unavailable', 'direct_address_fallback'].includes(reason)) return 'Không thực hiện được lượt phân loại';
  if (['tag_bot', 'call_word', 'reply_bot', 'no_context', 'expired', 'other_sender', 'other_target', 'missing_bot_context'].includes(reason)) return 'Quyết định theo luật của bản cũ · không gọi model nhận diện';
  return 'Bỏ qua theo quyền hoặc nguồn tin · không gọi model nhận diện';
};
export function ContextGatePanel({ conv, onJump, onClose }) {
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null);
  useEffect(() => {
    let disposed = false;
    let timer;
    setData(null); setError('');
    async function refresh() {
      try {
        const result = await api(`/api/chats/${encodeURIComponent(conv.threadId)}/context-gate?filter=${filter}`);
        if (!disposed) { setData(result); setError(''); }
      } catch (err) { if (!disposed) setError(err.message); }
      finally { if (!disposed) timer = setTimeout(refresh, 5000); }
    }
    refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [conv.threadId, filter]);
  async function rate(row, verdict) {
    setSaving(row.id); setError('');
    try {
      const result = await api(`/api/chats/${encodeURIComponent(conv.threadId)}/context-gate/${row.id}/feedback`, { method: 'POST', body: { verdict: row.feedback === verdict ? null : verdict } });
      setData((cur) => cur ? { ...cur, items: cur.items.map((item) => item.id === row.id ? { ...item, feedback: result.verdict } : item) } : cur);
    } catch (err) { setError(err.message); }
    finally { setSaving(null); }
  }
  return html`<aside class="side-panel gate-panel" aria-label="Lọc ngữ cảnh" onKeyDown=${(e) => { if (e.key === 'Escape') onClose(); }}>
    <header class="side-head"><h3>Lọc ngữ cảnh</h3>
      <button type="button" class="btn btn-ghost btn-sm" onClick=${onClose} aria-label="Đóng bảng lọc ngữ cảnh"><${Icon} name="close" /></button>
    </header>
    <div class="side-body">
      <p class="muted small">Quyết định cho nhóm này · tự cập nhật mỗi 5 giây. “Cho qua” nghĩa là đã qua bộ lọc; trợ lý còn kiểm tra quyền và xử lý yêu cầu.</p>
      <p><a href="#/context-gate">Theo dõi chất lượng từng model →</a></p>
      <label class="gate-filter">Hiển thị
        <select value=${filter} onChange=${(e) => setFilter(e.currentTarget.value)}>
          <option value="all">Tất cả</option><option value="ignore">Bỏ qua</option><option value="errors">Có lỗi phân loại</option>
        </select>
      </label>
      <${Live} error=${error} />
      ${!data && !error ? html`<${Spinner} />` : null}
      ${data && !data.items.length ? html`<p class="muted">${data.available ? 'Chưa có quyết định phù hợp cho nhóm này.' : 'Chưa có nhật ký. Các tin mới sẽ xuất hiện sau khi gateway chạy bản có ghi nhận quyết định.'}</p>` : null}
      <ol class="gate-list">${(data?.items || []).map((row) => html`<li class="gate-entry" key=${row.id}>
        <div class="gate-entry-head"><strong class=${row.decision === 'RESPOND' ? 'gate-respond' : 'gate-ignore'}>${row.decision === 'RESPOND' ? 'Cho qua bộ lọc' : 'Bỏ qua'}</strong>
          <time datetime=${new Date(row.at).toISOString()}>${when(row.at)}</time></div>
        <p>${REASONS[row.reason] || REASONS.unavailable}</p>
        ${Number.isFinite(row.probability) ? html`<p class="small">Xác suất <strong>${row.probability.toFixed(2)}</strong> / ngưỡng ${row.threshold?.toFixed(2) ?? '—'}${Number.isFinite(row.duration_ms) ? ` · ${row.duration_ms} ms` : ''}</p>` : null}
        ${row.stages.length ? html`<ol class="gate-stages">${row.stages.map((stage, index) => html`<li key=${index}>
          <span>${MODELS[stage.model]} · ${PROVIDERS[stage.provider]}</span>
          <span class="muted small">${STATUSES[stage.status]}${stage.http_status ? ` ${stage.http_status}` : ''}${Number.isFinite(stage.duration_ms) ? ` · ${stage.duration_ms} ms` : ''}</span>
        </li>`)}</ol>` : html`<p class="muted small">${noAttemptLabel(row.reason)}</p>`}
        ${row.ref ? html`<button type="button" class="btn btn-ghost btn-sm" onClick=${() => onJump(row.ref)}>Xem tin nhắn →</button>` : html`<span class="muted small">Tin chưa có trong lịch sử lưu</span>`}
        <div class="gate-feedback" aria-label="Đánh giá quyết định">
          <span class="muted small">Quyết định này:</span>
          <button type="button" class="btn btn-secondary btn-sm" disabled=${saving === row.id} aria-pressed=${row.feedback === 'correct'} onClick=${() => rate(row, 'correct')}>Đúng</button>
          <button type="button" class="btn btn-secondary btn-sm" disabled=${saving === row.id} aria-pressed=${row.feedback === 'incorrect'} onClick=${() => rate(row, 'incorrect')}>Sai</button>
        </div>
      </li>`)}</ol>
      <p class="muted small">Chỉ giữ nhật ký gần đây, tối đa khoảng 1 MB. Không ghi nội dung tin nhắn vào nhật ký phân loại.</p>
      <p class="muted small">Đánh dấu Đúng/Sai để đo chất lượng. Bấm lại để bỏ đánh giá. Đánh giá chưa tự thay đổi luật hoặc huấn luyện model.</p>
    </div>
  </aside>`;
}

export function ContextGateTracking() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let gone = false; let timer;
    async function refresh() {
      try { const result = await api('/api/context-gate/summary'); if (!gone) { setData(result); setError(''); } }
      catch (err) { if (!gone) setError(err.message); }
      finally { if (!gone) timer = setTimeout(refresh, 5000); }
    }
    refresh(); return () => { gone = true; clearTimeout(timer); };
  }, []);
  return html`
    <${PageHead} title="Lọc ngữ cảnh" sub="Theo dõi model nhận diện cuộc trao đổi với bot · cập nhật mỗi 5 giây." />
    <div class="row"><a class="btn btn-secondary" href="#/chats">Xem quyết định trong Phiên chat</a><a class="btn btn-secondary" href="#/settings">Chọn model / chỉnh ngưỡng</a></div>
    <p>Trong Phiên chat, chọn một nhóm rồi bấm <strong>Lọc ngữ cảnh</strong> ở góc trên khung tin. Dùng nút <strong>Đúng / Sai</strong> để chấm quyết định của bot.</p>
    <${Live} error=${error} />
    ${!data && !error ? html`<${Spinner} />` : null}
    ${data ? html`<section class="card">
      <h2>Thống kê model</h2>
      <p class="muted small">${data.events} quyết định trong nhật ký còn lưu${data.from ? ` · từ ${when(data.from)}` : ''}. Thống kê gộp các nhóm của tài khoản bot hiện tại.</p>
      ${!data.models.length ? html`<p>Chưa có lượt gọi model được ghi nhận. Tin bị loại theo luật hoặc tag/reply trực tiếp bot không cần gọi model.</p>` : html`
        <div class="table-wrap"><table class="gate-metrics"><thead><tr><th>Model</th><th>Lượt gọi</th><th>Thành công / lỗi</th><th>Timeout</th><th>TB / P95</th><th>Đúng / đã chấm</th><th>Trả lời nhầm / bỏ sót</th></tr></thead>
          <tbody>${data.models.map((m) => html`<tr key=${`${m.provider}:${m.model}`}>
            <td><strong>${MODELS[m.model]}</strong><div class="muted small">${PROVIDERS[m.provider]}</div></td>
            <td>${m.calls}</td><td>${m.succeeded} / ${m.failed}</td><td>${m.timeouts}</td>
            <td>${m.avgMs ?? '—'} / ${m.p95Ms ?? '—'} ms</td>
            <td>${m.reviewed ? `${m.correct}/${m.reviewed} (${Math.round(m.correct * 100 / m.reviewed)}%)` : 'Chưa có đánh giá'}</td>
            <td>${m.falsePositive} / ${m.falseNegative}</td>
          </tr>`)}</tbody></table></div>`}
      <p class="muted small">“Thành công” là nhận được kết quả hợp lệ. Tỷ lệ đúng chỉ tính trên các tin bạn đã chấm. P95 là thời gian mà 95% lượt gọi hoàn thành trong đó.</p>
      <p class="muted small">Mỗi model có thể gặp tập tin khác nhau vì cơ chế fallback. So sánh cần xét cả số mẫu đã chấm; bảng không tự chọn model thắng và không gọi thêm model để lấy số liệu.</p>
    </section>` : null}`;
}
