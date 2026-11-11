// Thay đổi hoàn toàn sang dùng require để tránh lỗi SyntaxError: Cannot use import statement outside a module
const { defineConfig, devices } = require("@playwright/test");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

// Kích hoạt đọc file .env
// quiet: true để tắt dòng "tip" quảng cáo mà dotenv tự in ra console mỗi lần gọi config()
dotenv.config({ path: path.resolve(__dirname, ".env"), quiet: true });

// Lấy domain dự phòng nếu file .env chưa nhận diện được
const boDomain = process.env.BO_DOMAIN || "dev-bo.royaledge.io";

// Base URL của BO API (tests/api) - xem docs tại {API_BASE_URL}/swagger/index.html
// Dùng 127.0.0.1 thay vì "localhost": backend pin session theo IP lúc login
// (xem SessionValidator.cs), còn "localhost" có thể resolve ra IPv4 hoặc IPv6 (::1)
// không nhất quán giữa các process/worker Playwright khác nhau, khiến token bị
// coi là gọi sai IP (UNAUTHORIZED_USER) dù token còn hợp lệ.
const apiBaseURL = process.env.API_BASE_URL || "http://127.0.0.1:5000";

// File này chứa nguyên khối bạn copy từ DevTools > Application > Local Storage
// (mỗi dòng dạng "TÊN_KEY<TAB>GIÁ_TRỊ", paste y nguyên, không cần format lại)
const sessionDumpPath = path.resolve(__dirname, "playwright/.auth/session.txt");

function loadSessionEntries(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .map((line) =>
      line
        .split(/\t+/)
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .filter((parts) => parts.length >= 2)
    .map(([name, value]) => ({ name, value }));
}

const sessionEntries = loadSessionEntries(sessionDumpPath);

// Cookie gửi lên server KHÔNG được quá dài: session.txt có các key cache icon "iconify*"
// (tổng vài KB). Nếu nhét hết vào cookie thì header Cookie vượt ~8KB và server trả lỗi
// 4xx/5xx (vd 500). Token thực tế nằm ở localStorage (gửi qua header Bearer), nên chỉ
// đưa các key nhỏ, cần thiết vào cookie; localStorage vẫn giữ nguyên đầy đủ.
const MAX_COOKIE_VALUE_LENGTH = 600;
const cookieEntries = sessionEntries.filter(
  ({ name, value }) =>
    !/^iconify/i.test(name) && value.length <= MAX_COOKIE_VALUE_LENGTH,
);

// console.log(
//   `🚀 Đã đọc ${sessionEntries.length} key từ session.txt cho domain ${boDomain}`,
// );

module.exports = defineConfig({
  // Chia song song theo TỪNG TEST (mặc định chỉ chia theo file nên file 100+ test chạy tuần tự trong 1 worker).
  // Các nhóm CRUD vẫn tuần tự nhờ test.describe.configure({ mode: "serial" }) trong từng spec.
  // Project "api" bắt buộc --workers=1 (xem script test:api) nên không bị ảnh hưởng.
  fullyParallel: true,
  // Thêm response-reporter.js bên cạnh "list" mặc định - reporter này in ra terminal
  // toàn bộ request/response của các lần gọi apiPost() khi 1 test tests/api/* fail,
  // để dễ kiểm tra lỗi API mà không cần mở HTML report (xem tests/api/helpers/api-client.js).
  reporter: [["list"], ["./tests/api/helpers/response-reporter.js"]],
  // expect(...) fail sau 10s (mặc định 5s) - test.setTimeout() trong spec vẫn giữ nguyên cho luồng dài.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `https://${boDomain}/`,
    // Mặc định click/fill/waitFor KHÔNG có giới hạn riêng nên khi locator sai phải chờ hết test timeout (90-240s).
    // Đặt giới hạn để thao tác kẹt fail sau 30s. Lưu ý: actionTimeout cũng là timeout MẶC ĐỊNH của
    // page.waitForResponse / waitForRequest (không truyền { timeout }) nên 15s làm nhiều test chờ API chậm fail oan.
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
  projects: [
    // 1. Dự án chuyên đi đăng nhập (Nếu bạn dùng file setup để xử lý logic khác)
    {
      name: "setup",
      testDir: "./tests",
      testIgnore: /api[\\/]/,
      testMatch: /.*\.setup\.js/,
    },

    // 2. Dự án chạy test UI chính sử dụng session từ playwright/.auth/session.txt
    {
      name: "chromium",
      testDir: "./tests",
      testIgnore: [/.*\.setup\.js/, /api[\\/]/],
      use: {
        ...devices["Desktop Chrome"],
        storageState: {
          cookies: cookieEntries.map(({ name, value }) => ({
            name,
            value,
            domain: boDomain,
            path: "/",
            expires: Math.floor(Date.now() / 1000) + 3600 * 24,
          })),
          origins: [
            {
              origin: `https://${boDomain}`,
              // Bỏ sorter__*: cách sắp xếp đã lưu của từng màn hình (copy từ DevTools) làm trang không mở với sort mặc định
              localStorage: sessionEntries.filter(({ name }) => !/^sorter__/i.test(name)),
            },
          ],
        },
      },
      dependencies: ["setup"],
    },

    // 3. Dự án test API - mỗi test tự login riêng (xem tests/api/fixtures.js), KHÔNG dùng
    // chung 1 token vì backend chỉ cho phép 1 session/tài khoản (login mới sẽ huỷ session cũ).
    // Bắt buộc chạy với --workers=1 (xem script "test:api" trong package.json) để tránh
    // 2 test login cùng lúc đè session của nhau.
    {
      name: "api",
      testDir: "./tests/api",
      use: {
        baseURL: apiBaseURL,
      },
    },
  ],
});
