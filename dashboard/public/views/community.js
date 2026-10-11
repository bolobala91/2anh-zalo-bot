// Cộng đồng 2Anh: nhóm Zalo trải nghiệm bot, fanpage và Facebook của tác giả. Link ngoài mở tab mới,
// không gửi Referer (đường dẫn dashboard của khách không lộ ra ngoài).
import { html, Icon } from '../ui.js';

export const COMMUNITY = {
  zalo: 'https://zalo.me/g/5fli05n11mnwu4ntdqhq',
  fanpage: 'https://2anhaieducation.pro.vn/',
  facebook: 'https://www.facebook.com/luonghaianh1208',
};

const ext = (href, cls, label, body) => html`<a class=${cls} href=${href} target="_blank" rel="noopener noreferrer" aria-label=${label}>${body}</a>`;

/** Nút "Cộng đồng 2Anh" trên thanh trạng thái: vào nhóm Zalo trải nghiệm bot. */
export function CommunityButton() {
  return ext(COMMUNITY.zalo, 'community-pill', 'Tham gia nhóm Zalo cộng đồng 2Anh (mở tab mới)',
    html`<${Icon} name="users" size=${18} /><span>Cộng đồng<span class="community-more"> 2Anh</span></span>`);
}

/** Ba link cộng đồng (cửa sổ Ủng hộ tác giả). */
export function CommunityLinks() {
  return html`<div class="community-links">
    <p class="small"><strong>Cộng đồng 2Anh</strong> — trải nghiệm bot, hỏi đáp và đặt dùng:</p>
    <ul>
      <li>${ext(COMMUNITY.zalo, 'link', 'Nhóm Zalo cộng đồng 2Anh (mở tab mới)', 'Nhóm Zalo cộng đồng 2Anh')}</li>
      <li>${ext(COMMUNITY.fanpage, 'link', 'Trang 2Anh AI Education (mở tab mới)', 'Trang 2Anh AI Education')}</li>
      <li>${ext(COMMUNITY.facebook, 'link', 'Facebook Lương Hải Anh (mở tab mới)', 'Facebook Lương Hải Anh')}</li>
    </ul>
  </div>`;
}
