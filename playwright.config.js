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

// console.log(
//   `🚀 Đã đọc ${sessionEntries.length} key từ session.txt cho domain ${boDomain}`,
// );

module.exports = defineConfig({
  // Thêm response-reporter.js bên cạnh "list" mặc định - reporter này in ra terminal
  // toàn bộ request/response của các lần gọi apiPost() khi 1 test tests/api/* fail,
  // để dễ kiểm tra lỗi API mà không cần mở HTML report (xem tests/api/helpers/api-client.js).
  reporter: [["list"], ["./tests/api/helpers/response-reporter.js"]],
  use: {
    baseURL: "https://dev-bo.royaledge.io/",
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
          cookies: sessionEntries.map(({ name, value }) => ({
            name,
            value,
            domain: boDomain,
            path: "/",
            expires: Math.floor(Date.now() / 1000) + 3600 * 24,
          })),
          origins: [
            {
              origin: `https://${boDomain}`,
              localStorage: sessionEntries,
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
