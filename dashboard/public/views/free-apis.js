// Khoá API & Model › API miễn phí: các dịch vụ không cần khoá mà bot đang gọi, kèm trang web của từng dịch vụ để
// người dùng biết dữ liệu đến từ đâu. Danh sách khớp với mã plugin (zalo_tools/academic.py, open_data.py,
// studio/images.py) — thêm nguồn mới ở plugin thì thêm vào đây.
import { html, Icon } from '../ui.js';

export const FREE_APIS = [
  {
    group: 'Tra cứu học thuật', switch: 'Tra cứu học thuật',
    items: [
      { name: 'PubMed (NCBI)', url: 'https://pubmed.ncbi.nlm.nih.gov/', use: 'Bài báo y sinh, sức khoẻ đã bình duyệt' },
      { name: 'PubMed Central', url: 'https://pmc.ncbi.nlm.nih.gov/', use: 'Đọc toàn văn bài y sinh mở' },
      { name: 'Europe PMC', url: 'https://europepmc.org/', use: 'Y sinh, khoa học sự sống, bản thảo, cờ toàn văn mở' },
      { name: 'arXiv', url: 'https://arxiv.org/', use: 'Bản thảo vật lý, toán, tin học, thống kê',
        note: 'arXiv giới hạn lượt gọi gắt — khi bị chặn, bot tự tra bản chỉ mục arXiv trên OpenAlex' },
      { name: 'OpenAlex', url: 'https://openalex.org/', use: 'Bài báo mọi ngành, số trích dẫn, link PDF mở',
        note: 'Không khoá vẫn chạy; đặt khoá OpenAlex ở tab Khoá API để có nhiều lượt hơn' },
      { name: 'Crossref', url: 'https://www.crossref.org/', use: 'Tra bài theo thông tin thư mục, tạo trích dẫn từ DOI' },
      { name: 'DOAJ', url: 'https://doaj.org/', use: 'Tra tạp chí truy cập mở theo ISSN hoặc tên' },
      { name: 'Free Dictionary', url: 'https://dictionaryapi.dev/', use: 'Từ điển tiếng Anh: phiên âm, nghĩa, ví dụ, đồng nghĩa' },
      { name: 'Wiktionary', url: 'https://en.wiktionary.org/', use: 'Từ điển nhiều thứ tiếng, có tiếng Việt' },
      { name: 'iNaturalist', url: 'https://www.inaturalist.org/', use: 'Tra loài sinh vật: tên thường gọi, ảnh, số quan sát' },
      { name: 'GBIF', url: 'https://www.gbif.org/', use: 'Phân loại khoa học của loài (giới → chi)' },
    ],
  },
  {
    group: 'Tra cứu thông tin', switch: 'Tra cứu web',
    items: [
      { name: 'Open-Meteo', url: 'https://open-meteo.com/', use: 'Thời tiết hiện tại và dự báo 7 ngày',
        note: 'Miễn phí cho mục đích phi thương mại — dùng thương mại cần gói trả phí của Open-Meteo' },
      { name: 'Frankfurter', url: 'https://frankfurter.dev/', use: 'Tỷ giá tham chiếu các đồng tiền lớn (nguồn ECB)' },
      { name: 'Currency-api', url: 'https://github.com/fawazahmed0/exchange-api', use: 'Tỷ giá có VND và hơn 150 đồng tiền' },
    ],
  },
  {
    group: 'Xưởng tạo sản phẩm (2Anh Studio)', switch: 'Xưởng tạo sản phẩm',
    items: [
      { name: 'Openverse', url: 'https://openverse.org/', use: 'Ảnh giấy phép mở cho slide, có tác giả để ghi nguồn' },
      { name: 'Iconify', url: 'https://iconify.design/', use: 'Icon cho slide (hơn 200 bộ icon mã nguồn mở)',
        note: 'Bộ icon giấy phép CC BY được ghi nguồn nhỏ ở chân trang' },
    ],
  },
];

const ext = (href, body, label) => html`<a class="btn btn-secondary btn-sm" href=${href} target="_blank" rel="noopener noreferrer" aria-label=${label}>${body}</a>`;

export function FreeApis() {
  const total = FREE_APIS.reduce((n, g) => n + g.items.length, 0);
  return html`<p class="muted small"><${Icon} name="info" size=${14} /> ${total} dịch vụ dưới đây bot gọi được ngay, <strong>không cần khoá</strong>. Bấm "Trang web" để xem dịch vụ đó là gì và điều khoản sử dụng. Thành viên chỉ dùng được khi công tắc tương ứng ở Phân quyền Bot đang bật.</p>
    ${FREE_APIS.map((g) => html`<h3 key=${g.group}>${g.group} <small class="muted">· công tắc "${g.switch}"</small></h3>
      <ul class="row-list">${g.items.map((it) => html`<li key=${it.name} class="row-item">
        <span class="row-main"><strong>${it.name}</strong><small class="muted">${it.use}</small>
          ${it.note ? html`<small class="muted">⚠ ${it.note}</small>` : null}</span>
        <span class="badge badge-ok">Không cần khoá</span>
        ${ext(it.url, html`<${Icon} name="link" size=${14} /> Trang web`, `Mở trang ${it.name} (tab mới)`)}
      </li>`)}</ul>`)}`;
}
