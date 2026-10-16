// Danh mục kết nối MCP bằng tiếng Việt: tên dễ hiểu, mô tả, nhóm nhu cầu/ngành để lọc, và gợi ý cho trường học.
// Khoá là tên kết nối trong danh mục Hermes. Kết nối mới chưa có ở đây vẫn hiện (mô tả gốc tiếng Anh, nhóm "Khác").

export const MCP_GROUPS = [
  ['goi-y', 'Gợi ý cho trường học'],
  ['giao-duc', 'Giáo dục & học tập'],
  ['van-phong', 'Văn phòng & công việc'],
  ['thiet-ke', 'Thiết kế & truyền thông'],
  ['ban-hang', 'Kinh doanh & bán hàng'],
  ['tai-chinh', 'Tài chính'],
  ['doi-song', 'Du lịch & đời sống'],
  ['du-lieu', 'Dữ liệu & phân tích'],
  ['lap-trinh', 'Lập trình & kỹ thuật'],
];

// tên → [tên hiển thị, mô tả tiếng Việt, nhóm]
const VI = {
  wolfram: ['Wolfram|Alpha', 'Tính toán toán, lý, hoá: giải phương trình, đạo hàm, tích phân, đổi đơn vị, tra số liệu khoa học có kiểm chứng.', ['goi-y', 'giao-duc', 'du-lieu']],
  'microsoft-learn': ['Microsoft Learn', 'Hướng dẫn chính thức của Microsoft: Word, Excel, PowerPoint, Office 365, Azure, kèm ví dụ.', ['goi-y', 'giao-duc', 'van-phong', 'lap-trinh']],
  canva: ['Canva', 'Tạo, tìm và quản lý thiết kế Canva trong tài khoản của bạn: poster, slide, ảnh mạng xã hội.', ['goi-y', 'thiet-ke', 'giao-duc']],
  gamma: ['Gamma', 'Tạo và sửa bài trình chiếu, tài liệu, trang web bằng AI.', ['goi-y', 'thiet-ke', 'giao-duc', 'van-phong']],
  notion: ['Notion', 'Đọc và ghi trang, cơ sở dữ liệu trong không gian Notion: ghi chép, kế hoạch, kho tài liệu.', ['goi-y', 'van-phong', 'giao-duc']],
  todoist: ['Todoist', 'Quản lý việc cần làm và dự án: thêm việc, đặt hạn, đánh dấu xong.', ['goi-y', 'van-phong']],
  miro: ['Miro', 'Đọc và sửa bảng trắng Miro: sơ đồ tư duy, sơ đồ quy trình, khung làm việc nhóm.', ['goi-y', 'giao-duc', 'thiet-ke', 'van-phong']],
  dropbox: ['Dropbox', 'Tìm, đọc và quản lý tệp trong Dropbox.', ['goi-y', 'van-phong']],
  craft: ['Craft', 'Tài liệu có cấu trúc, việc cần làm và kho kiến thức cá nhân.', ['van-phong', 'giao-duc']],
  hugging_face: ['Hugging Face', 'Tra mô hình AI, bộ dữ liệu, Spaces và bài báo trên Hugging Face.', ['giao-duc', 'lap-trinh', 'du-lieu']],
  fireflies: ['Fireflies', 'Biên bản cuộc họp: bản ghi lời nói, tóm tắt và việc cần làm sau họp.', ['van-phong']],
  calendly: ['Calendly', 'Lịch hẹn: link đặt lịch, sự kiện và người tham dự.', ['van-phong', 'ban-hang']],
  airtable: ['Airtable', 'Bảng dữ liệu (như Excel online) trong Airtable: base, bảng, bản ghi.', ['van-phong', 'du-lieu']],
  asana: ['Asana', 'Việc, dự án và mục tiêu trong Asana. Cần mã ứng dụng (client ID/secret) của Asana.', ['van-phong']],
  clickup: ['ClickUp', 'Việc, tài liệu và không gian làm việc trong ClickUp.', ['van-phong']],
  monday: ['monday.com', 'Bảng công việc, mục, tài liệu và quy trình trong monday.com.', ['van-phong']],
  linear: ['Linear', 'Tìm, tạo, cập nhật đầu việc, dự án và bình luận trong Linear.', ['van-phong', 'lap-trinh']],
  atlassian: ['Jira & Confluence', 'Đầu việc Jira và trang tài liệu Confluence của Atlassian.', ['van-phong', 'lap-trinh']],
  'n8n-official': ['n8n', 'Kết nối máy chủ n8n của bạn để chạy các quy trình tự động hoá. Cần địa chỉ MCP của n8n.', ['van-phong', 'lap-trinh']],
  figma: ['Figma', 'Đọc thiết kế Figma, liên kết với mã nguồn và vẽ trực tiếp lên khung thiết kế.', ['thiet-ke', 'lap-trinh']],
  cloudinary: ['Cloudinary', 'Tải lên, tìm và chỉnh sửa ảnh, video trong kho Cloudinary.', ['thiet-ke']],
  'comfy-cloud': ['Comfy Cloud', 'Tạo ảnh, video, âm thanh và mô hình 3D trên Comfy Cloud.', ['thiet-ke']],
  webflow: ['Webflow', 'Trang web, bộ sưu tập nội dung (CMS) và các trang trong Webflow.', ['thiet-ke', 'ban-hang']],
  'wordpress-com': ['WordPress.com', 'Bài viết, trang, bản nháp, thống kê và bình luận trên WordPress.com.', ['thiet-ke', 'ban-hang']],
  stripe: ['Stripe', 'Thanh toán, khách hàng và hoá đơn qua Stripe.', ['ban-hang', 'tai-chinh']],
  paypal: ['PayPal', 'Thanh toán, hoá đơn và gói thuê bao qua PayPal.', ['ban-hang', 'tai-chinh']],
  square: ['Square', 'Danh mục hàng, đơn hàng và thanh toán qua Square.', ['ban-hang', 'tai-chinh']],
  klaviyo: ['Klaviyo', 'Email marketing: chiến dịch, luồng tự động, phân nhóm khách và báo cáo.', ['ban-hang']],
  intercom: ['Intercom', 'Hội thoại chăm sóc khách hàng, phiếu hỗ trợ và dữ liệu khách trong Intercom.', ['ban-hang']],
  close: ['Close CRM', 'Quản lý bán hàng: khách tiềm năng, cơ hội, cuộc gọi và email.', ['ban-hang']],
  attio: ['Attio CRM', 'Hồ sơ khách hàng, danh sách và ghi chú trong Attio.', ['ban-hang']],
  indeed: ['Indeed', 'Tìm việc làm và tin tuyển dụng trên Indeed.', ['doi-song', 'ban-hang']],
  plaid: ['Plaid', 'Bảng điều khiển Plaid: tích hợp ngân hàng, tài khoản liên kết và gỡ lỗi sử dụng.', ['tai-chinh', 'lap-trinh']],
  robinhood: ['Robinhood', 'Giao dịch chứng khoán qua Robinhood: danh mục, số dư, lệnh đặt.', ['tai-chinh']],
  'twelve-data': ['Twelve Data', 'Dữ liệu thị trường: cổ phiếu, ngoại hối, tiền mã hoá.', ['tai-chinh', 'du-lieu']],
  kiwi: ['Kiwi.com', 'Tìm chuyến bay, hành trình kèm link đặt vé.', ['doi-song']],
  trivago: ['trivago', 'Tìm khách sạn, so sánh giá theo thành phố và ngày.', ['doi-song']],
  alltrails: ['AllTrails', 'Tìm cung đường leo núi, đi bộ đường dài kèm đánh giá.', ['doi-song']],
  strava: ['Strava', 'Hoạt động thể thao, xu hướng thể lực, khối lượng tập (chỉ đọc).', ['doi-song']],
  amplitude: ['Amplitude', 'Phân tích hành vi người dùng: biểu đồ, bảng tổng hợp, thử nghiệm.', ['du-lieu']],
  mixpanel: ['Mixpanel', 'Phân tích sự kiện, phễu chuyển đổi, tỉ lệ quay lại.', ['du-lieu']],
  motherduck: ['MotherDuck', 'Truy vấn kho dữ liệu DuckDB trên mây bằng SQL.', ['du-lieu', 'lap-trinh']],
  datadog: ['Datadog', 'Nhật ký, giám sát, bảng điều khiển và sự cố trong Datadog.', ['lap-trinh', 'du-lieu']],
  grafana: ['Grafana Cloud', 'Truy vấn số liệu, nhật ký, cảnh báo và sự cố trên Grafana Cloud.', ['lap-trinh', 'du-lieu']],
  algolia: ['Algolia', 'Tìm kiếm Algolia: chỉ mục, thống kê và cài đặt (chỉ đọc).', ['lap-trinh', 'du-lieu']],
  'aws-knowledge': ['Tài liệu AWS', 'Tài liệu chính thức, tham chiếu API và hướng dẫn của Amazon Web Services.', ['lap-trinh']],
  context7: ['Context7', 'Tài liệu thư viện lập trình đúng phiên bản, kèm ví dụ mã.', ['lap-trinh']],
  deepwiki: ['DeepWiki', 'Hỏi đáp về bất kỳ kho mã công khai nào trên GitHub.', ['lap-trinh']],
  'twilio-docs': ['Tài liệu Twilio', 'Tra tài liệu lập trình Twilio (SMS, gọi điện) — chỉ đọc.', ['lap-trinh']],
  'unreal-engine': ['Unreal Engine', 'Điều khiển trình biên tập Unreal Engine 5.8 trên máy (cần cài Unreal).', ['lap-trinh']],
  gitlab: ['GitLab', 'Đầu việc, yêu cầu gộp mã, pipeline và kho mã trên GitLab.', ['lap-trinh']],
  sentry: ['Sentry', 'Lỗi ứng dụng, dấu vết lỗi và ngữ cảnh từ Sentry.', ['lap-trinh']],
  semgrep: ['Semgrep', 'Quét mã nguồn tìm lỗ hổng bảo mật.', ['lap-trinh']],
  postman: ['Postman', 'Không gian làm việc, bộ API, môi trường trong Postman.', ['lap-trinh']],
  buildkite: ['Buildkite', 'Pipeline CI/CD, bản dựng và kết quả kiểm thử.', ['lap-trinh']],
  circleci: ['CircleCI', 'Chẩn đoán bản dựng lỗi, đọc nhật ký, chạy lại quy trình.', ['lap-trinh']],
  betterstack: ['Better Stack', 'Nhật ký, theo dõi máy chủ còn sống, sự cố và trang trạng thái.', ['lap-trinh']],
  globalping: ['Globalping', 'Ping, traceroute, DNS, HTTP từ các điểm đo khắp thế giới.', ['lap-trinh']],
  cloudflare: ['Cloudflare', 'Toàn quyền API Cloudflare: tên miền, DNS, Workers…', ['lap-trinh']],
  netlify: ['Netlify', 'Trang web, lượt triển khai và biến môi trường trên Netlify.', ['lap-trinh']],
  vercel: ['Vercel', 'Lượt triển khai, nhật ký và dự án trên Vercel.', ['lap-trinh']],
  railway: ['Railway', 'Dự án, dịch vụ, lượt triển khai và môi trường trên Railway.', ['lap-trinh']],
  supabase: ['Supabase', 'Cơ sở dữ liệu, đăng nhập và lưu trữ của dự án Supabase.', ['lap-trinh', 'du-lieu']],
  neon: ['Neon Postgres', 'Cơ sở dữ liệu Postgres không máy chủ: dự án, nhánh, SQL.', ['lap-trinh', 'du-lieu']],
  'prisma-postgres': ['Prisma Postgres', 'Tạo và quản lý cơ sở dữ liệu Prisma Postgres.', ['lap-trinh', 'du-lieu']],
};

/** Bản tiếng Việt của một mục danh mục (giữ mô tả gốc nếu chưa dịch). */
export function viEntry(e) {
  const v = VI[e.name];
  return { ...e, title: v?.[0] || e.name, descVi: v?.[1] || e.description, groups: v?.[2] || ['khac'], pick: Boolean(v?.[2]?.includes('goi-y')) };
}

/** Nhãn quyền dễ hiểu: kết nối không cần tài khoản thì có thể mở cho thành viên; dùng tài khoản/khoá của chủ bot thì không nên. */
export function accessNote(auth) {
  return auth === 'none' ? { kind: 'ok', text: 'Không cần tài khoản — có thể mở cho thành viên' } : { kind: 'warn', text: 'Dùng tài khoản của bạn — nên để Chỉ chủ nhân' };
}

/** Lọc danh mục theo nhóm ('all' = tất cả), chữ tìm (tên, tên Việt, mô tả Việt/gốc, không dấu) và "chỉ không cần tài khoản". */
export function filterCatalog(entries, { group = 'all', q = '', noAccount = false, fold = (s) => s.toLowerCase() } = {}) {
  const k = fold(q).trim();
  return entries.filter((e) => (group === 'all' || e.groups.includes(group))
    && (!noAccount || e.auth === 'none')
    && (!k || fold(`${e.name} ${e.title} ${e.descVi} ${e.description}`).includes(k)))
    .sort((a, b) => Number(b.pick) - Number(a.pick) || a.title.localeCompare(b.title, 'vi'));
}
