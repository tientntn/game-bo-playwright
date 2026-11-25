// Nạp session từ playwright/.auth/session.txt thành storageState GỌN cho Playwright.
//
// session.txt là nguyên khối localStorage copy từ DevTools (mỗi dòng "KEY<TAB>VALUE") nên rất dài,
// phần lớn là rác không liên quan tới việc đăng nhập:
//   - iconify*        : cache icon của thư viện icon (vài KB)
//   - *_filter        : filter đã lưu của từng màn hình -> làm test phụ thuộc trạng thái cũ
//   - *_page_size     : số dòng/trang đã lưu của từng màn hình -> như trên
//   - sorter__*       : cách sắp xếp đã lưu của từng màn hình -> như trên (làm trang không mở với sort mặc định)
// Các key này bị loại bỏ; chỉ giữ lại các key đăng nhập (DEV-ctoken, DEV-rtoken, DEV-userId...).
//
// Dùng cho cả script của playwright-skill lẫn spec @playwright/test:
//   test.use({ storageState: buildStorageState() });
const fs = require("fs");
const path = require("path");

const SESSION_FILE = path.resolve(__dirname, "../../playwright/.auth/session.txt");

// Key bị loại bỏ (không dùng khi chạy test)
const DROP_KEYS = [/^iconify/i, /_filter$/i, /_page_size$/i, /^sorter__/i];

// Đọc toàn bộ cặp { name, value } trong session.txt (bỏ dòng trống / dòng thiếu giá trị)
function readSessionEntries(file = SESSION_FILE) {
  if (!fs.existsSync(file)) {
    throw new Error(`Không thấy ${file} - copy localStorage từ DevTools > Application vào file này.`);
  }
  return fs
    .readFileSync(file, "utf-8")
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

// Chỉ giữ key cần cho đăng nhập
function slimSessionEntries(file) {
  return readSessionEntries(file).filter(({ name }) => !DROP_KEYS.some((re) => re.test(name)));
}

// storageState dùng được cho browser.newContext({ storageState }) và test.use({ storageState })
function buildStorageState({ domain = process.env.BO_DOMAIN || "dev-bo.royaledge.io", file } = {}) {
  return {
    cookies: [],
    origins: [{ origin: `https://${domain}`, localStorage: slimSessionEntries(file) }],
  };
}

// Tiền tố key localStorage của app theo môi trường: dev-bo -> "DEV" (DEV-ctoken, DEV-appLang...), staging-bo -> "STAGING".
// Thứ tự: BO_STORAGE_PREFIX trong .env -> suy ra từ key "<PREFIX>-ctoken" trong session.txt (cùng môi trường với BO_DOMAIN)
// -> suy ra từ BO_DOMAIN ("staging-bo.xxx" -> "STAGING") -> "DEV".
function appStoragePrefix() {
  if (process.env.BO_STORAGE_PREFIX) return process.env.BO_STORAGE_PREFIX;
  try {
    for (const { name } of readSessionEntries()) {
      const m = /^(.+)-ctoken$/.exec(name);
      if (m) return m[1];
    }
  } catch {
    // không có session.txt -> thử suy ra từ domain bên dưới
  }
  const sub = (process.env.BO_DOMAIN || "dev-bo.royaledge.io").split(".")[0].replace(/-bo$/i, "");
  return (sub || "dev").toUpperCase();
}

module.exports = { readSessionEntries, slimSessionEntries, buildStorageState, appStoragePrefix, SESSION_FILE };
