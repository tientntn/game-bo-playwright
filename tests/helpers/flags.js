// Cờ điều khiển các test GHI dữ liệu thật (tạo / sửa bản ghi QA trên môi trường dev).
//
// Đặt trong .env (đọc bởi playwright.config.js):
//   RUN_FULL_TESTS=false   -> (mặc định) CHỈ chạy test không tạo dữ liệu; test ghi dữ liệu bị SKIP, không tạo rác.
//   RUN_FULL_TESTS=true    -> chạy FULL, gồm cả test submit tạo game / bản ghi QA.
// Chấp nhận true/1 (không phân biệt hoa thường) là BẬT; bất kỳ giá trị khác hoặc không khai báo là TẮT.
//
// Có thể ghi đè nhanh khi chạy, không cần sửa .env:
//   PowerShell:  $env:RUN_FULL_TESTS="true"; npx playwright test ...
//
// Cách dùng trong spec:
//   const { RUN_FULL_TESTS, SKIP_WRITE_REASON } = require("./helpers/flags");
//   test.describe("Tạo game", () => {
//     test.skip(!RUN_FULL_TESTS, SKIP_WRITE_REASON);   // skip cả describe
//     ...
//   });
//   // hoặc trong 1 test: test.skip(!RUN_FULL_TESTS, SKIP_WRITE_REASON);
const RUN_FULL_TESTS = /^(1|true)$/i.test(String(process.env.RUN_FULL_TESTS ?? "").trim());

const SKIP_WRITE_REASON = "Test tạo dữ liệu - đặt RUN_FULL_TESTS=true trong .env để chạy";

module.exports = { RUN_FULL_TESTS, SKIP_WRITE_REASON };
