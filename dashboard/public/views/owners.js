// Chủ nhân bot (spec §4 #8, §7.1, §9): ZALO_ALLOWED_USERS trong .env của Hermes. Trợ lý nạp lại .env mỗi lượt nên đổi
// là có hiệu lực ngay; chỉ kết nối Zalo cần khởi động lại — dải vàng nhắc việc đó, và vẫn còn sau khi tải lại trang.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Notice, PageHead, Spinner } from '../ui.js';

const ZALO_UID = /^[1-9]\d{14,21}$/;
export const OWN_UID_MSG = 'Bạn đang bỏ UID của chính mình — bạn sẽ mất lệnh chủ nhân trên Zalo. Tiếp tục?';
export const LEAVE_MSG = 'Bạn đã nhập UID nhưng chưa bấm "Thêm chủ nhân". Bỏ UID đó và rời trang?';

/** Kiểm UID vừa nhập trước khi gửi; trả câu lỗi hoặc ''. */
export function uidProblem(uid, current) {
  if (!ZALO_UID.test(uid)) return 'UID Zalo là dãy 15–22 chữ số, không bắt đầu bằng 0 (không phải số điện thoại) — kiểm tra lại.';
  if (current.includes(uid)) return 'UID này đã là chủ nhân.';
  if (current.length >= 20) return 'Tối đa 20 chủ nhân — bỏ bớt trước khi thêm.';
  return '';
}

/** Dòng chữ tên của một chủ nhân: tên Zalo trong lịch sử, tài khoản dashboard trùng UID. */
export function ownerLabel(o) {
  const parts = [];
  if (o.name) parts.push(o.name);
  if (o.dashboardUsers?.length) parts.push(`tài khoản dashboard: ${o.dashboardUsers.join(', ')}`);
  if (!parts.length) return 'Chưa rõ tên — người này chưa nhắn cho bot';
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function Owners({ me }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [uid, setUid] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({});
  const [restartMsg, setRestartMsg] = useState({});
  const [elapsed, setElapsed] = useState(0);

  const load = () => api('/api/admin/owners').then((r) => { setData(r); setLoadError(''); }).catch((err) => setLoadError(err.message));
  useEffect(() => { load(); }, []);

  // Khởi động lại có thể mất tới ~3 phút: đếm giây để người dùng biết trang vẫn đang chạy.
  useEffect(() => {
    if (busy !== 'restart') return undefined;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  // Như trang Phân quyền/Thương hiệu: UID đã gõ mà chưa thêm thì hỏi trước khi rời trang.
  const dirty = uid.trim() !== '';
  useEffect(() => {
    if (!dirty) return undefined;
    const here = location.hash;
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    const onPop = () => {
      if (location.hash === here || window.confirm(LEAVE_MSG)) return;
      history.replaceState(history.state, '', here);
    };
    addEventListener('beforeunload', onUnload);
    addEventListener('popstate', onPop);
    return () => { removeEventListener('beforeunload', onUnload); removeEventListener('popstate', onPop); };
  }, [dirty]);

  const head = html`<${PageHead} title="Chủ nhân bot" sub="Người có toàn quyền sai bảo bot qua Zalo. Thành viên khác chỉ dùng được các tính năng trong Phân quyền Bot." />`;
  if (loadError) return html`${head}<${Live} error=${loadError} />`;
  if (!data) return html`${head}<${Spinner} />`;

  const current = data.owners.map((o) => o.uid);
  async function save(next, okText) {
    if (!next.length) { setMsg({ error: 'Bot phải còn ít nhất một chủ nhân — thêm UID hợp lệ trước khi bỏ dòng này.' }); return false; }
    setBusy('save'); setMsg({}); setRestartMsg({});
    try { setData(await api('/api/admin/owners', { method: 'PUT', body: { owners: next } })); setMsg({ ok: okText }); return true; } catch (err) { setMsg({ error: err.message }); return false; } finally { setBusy(''); }
  }
  async function add(e) {
    e.preventDefault();
    const v = uid.trim();
    const problem = uidProblem(v, current);
    if (problem) { setMsg({ error: problem }); return; }
    if (await save([...current.filter((u) => ZALO_UID.test(u)), v], `Đã lưu ${v}. Bấm "Khởi động lại trợ lý" ở dải vàng để áp dụng.`)) setUid('');
  }
  const remove = (o) => {
    if (!confirm(`Bỏ quyền chủ nhân của ${o.name || o.uid}? Người này sẽ chỉ còn quyền như thành viên sau khi khởi động lại kết nối Zalo.`)) return;
    if (o.dashboardUsers?.includes(me?.username) && !confirm(OWN_UID_MSG)) return;
    save(current.filter((u) => u !== o.uid && ZALO_UID.test(u)), `Đã bỏ ${o.name || o.uid}. Bấm "Khởi động lại trợ lý" ở dải vàng để áp dụng.`);
  };
  async function restart() {
    if (!confirm('Khởi động lại trợ lý và kết nối Zalo? Bot sẽ ngừng trả lời khoảng một phút.')) return;
    setBusy('restart'); setRestartMsg({}); setMsg({});
    try {
      const r = await api('/api/admin/restart-assistant', { method: 'POST' });
      const next = await api('/api/admin/owners').catch(() => null);
      if (next) setData(next);
      if (r.sidecarFailed) setRestartMsg({ error: r.warning });
      else if (next?.shadowed || next?.osOverride) setRestartMsg({ error: 'Đã khởi động lại, nhưng kết nối Zalo vẫn theo danh sách khác — làm theo các bước trong khung đỏ bên dưới.' });
      else setRestartMsg({ ok: r.appliedOwners
        ? 'Đã khởi động lại — danh sách chủ nhân mới đã được áp dụng. Đợi khoảng một phút rồi nhắn thử bot từ tài khoản chủ nhân.'
        : 'Đã khởi động lại trợ lý. Đợi khoảng một phút rồi nhắn thử bot.' });
    } catch (err) { setRestartMsg({ error: err.message }); } finally { setBusy(''); }
  }
  const validCount = data.owners.filter((o) => o.valid).length;
  const restarting = busy === 'restart';

  return html`${head}
    ${data.pendingRestart ? html`<div class="notice notice-warn banner">
      <${Icon} name="warn" />
      <div><strong>Cần khởi động lại trợ lý.</strong> Danh sách mới áp dụng đầy đủ sau khi khởi động lại kết nối Zalo — trước đó người mới thêm chưa dùng được đủ lệnh chủ nhân. Trong lúc khởi động lại, bot tạm ngừng trả lời.</div>
      <button class="btn btn-primary btn-sm" disabled=${busy !== ''} onClick=${restart}><${Icon} name="refresh" size=${16} />
        ${restarting ? 'Đang khởi động lại…' : 'Khởi động lại trợ lý'}</button>
      ${restarting ? html`<p class="restart-progress" role="status"><span class="spinner" aria-hidden="true"></span>
        <span>Đang khởi động lại trợ lý và kết nối Zalo — đã ${elapsed} giây. Có thể mất tới 3 phút, đừng đóng trang này.</span></p>` : null}
    </div>` : null}
    <${Live} error=${restartMsg.error} ok=${restartMsg.ok} />
    ${data.osOverride ? html`<${Notice} kind="danger">
      <p><strong>Danh sách dưới đây đang bị ghi đè bởi môi trường hệ thống — kết nối Zalo không theo nó.</strong></p>
      <p>Biến <code>ZALO_ALLOWED_USERS</code> được đặt sẵn trong môi trường của dịch vụ/hệ điều hành với danh sách khác. Hãy báo người cài đặt xoá biến này khỏi môi trường hệ thống hoặc dịch vụ, rồi khởi động lại.</p><//>` : null}
    ${data.shadowed ? html`<${Notice} kind="danger">
      <p><strong>Danh sách dưới đây đang bị ghi đè — kết nối Zalo không theo nó.</strong></p>
      <p>Tệp <code>.env</code> trong thư mục cài bot Zalo cũng có dòng <code>ZALO_ALLOWED_USERS=</code> với danh sách khác, và dòng đó được ưu tiên. Cách sửa:</p>
      <ol class="fix-steps">
        <li>Mở tệp <code>.env</code> trong thư mục cài bot Zalo.</li>
        <li>Xoá cả dòng bắt đầu bằng <code>ZALO_ALLOWED_USERS=</code>, rồi lưu tệp.</li>
        <li>Bấm "Khởi động lại trợ lý" ở dải vàng phía trên.</li>
      </ol><//>` : null}
    <section class="card">
      <h2>Danh sách chủ nhân</h2>
      ${data.owners.length ? html`<ul class="owner-list">
        ${data.owners.map((o) => html`<li key=${o.uid}>
          <span class="avatar" aria-hidden="true"><${Icon} name="crown" size=${16} /></span>
          <span class="owner-main"><strong>${ownerLabel(o)}</strong><span class="mono muted">${o.uid}</span>
            ${o.valid ? null : html`<span class="badge badge-warn"><${Icon} name="warn" size=${14} /> Không phải UID Zalo — bỏ dòng này</span>`}</span>
          <button class="btn btn-secondary btn-sm" disabled=${busy !== '' || (o.valid && validCount <= 1)}
            title=${o.valid && validCount <= 1 ? 'Bot phải còn ít nhất một chủ nhân' : undefined}
            aria-label=${`Bỏ quyền chủ nhân của ${o.name || o.uid}`}
            onClick=${() => remove(o)}>Bỏ</button>
        </li>`)}
      </ul>` : html`<${Notice} kind="warn">Bot chưa có chủ nhân nào — thêm UID của bạn bên dưới.<//>`}
      ${validCount === 1 ? html`<p class="muted small">Bot phải còn ít nhất một chủ nhân — thêm người khác trước khi bỏ người cuối cùng.</p>` : null}
    </section>
    <form class="card" onSubmit=${add} novalidate>
      <h2>Thêm chủ nhân</h2>
      <div class="field">
        <label for="owner-uid">UID Zalo</label>
        <input id="owner-uid" class="mono" inputmode="numeric" autocomplete="off" spellcheck="false" value=${uid}
          aria-describedby="owner-uid-help" onInput=${(e) => setUid(e.currentTarget.value.replace(/\D/g, ''))} />
        <small id="owner-uid-help">Dãy 15–22 chữ số, không phải số điện thoại. Người đó nhắn <code>/sethome</code> cho bot để biết UID của mình.</small>
      </div>
      <button class="btn btn-primary" disabled=${busy !== ''}><${Icon} name="plus" size=${16} /> ${busy === 'save' ? 'Đang lưu…' : 'Thêm chủ nhân'}</button>
      <${Live} error=${msg.error} ok=${msg.ok} />
    </form>`;
}
