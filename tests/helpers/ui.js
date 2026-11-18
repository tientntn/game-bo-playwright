// Helper UI dùng chung cho các spec trong tests/*.spec.js (màn hình BO dùng Ant Design).
//
// Chỉ chứa các hàm GIỐNG HỆT nhau ở nhiều spec (trước đây mỗi spec tự khai báo lại).
// Hàm phụ thuộc hằng số riêng của từng màn hình (openPage, isList, READ, headers, rows, ...) vẫn khai báo trong spec.
//
// Cách dùng: chỉ import đúng những tên cần dùng, và KHÔNG tự khai báo lại tên đã import (sẽ lỗi "already been declared"):
//   const { filterEl, openDropdown, waitTableIdle, settle } = require("./helpers/ui");
// Màn hình cần hành vi khác (vd hộp thoại riêng, spinner riêng) thì khai báo hàm riêng với TÊN KHÁC hoặc không import tên đó.
// Màn hình mà ô filter tìm phía server làm spinner chạy lâu dùng bản "Scoped":
//   const { waitTableIdleScoped: waitTableIdle, settleScoped: settle } = require("./helpers/ui");
const { expect } = require("@playwright/test");

// Phần tử bao 1 filter (theo id của input bên trong)
const filterEl = (page, id) => page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });

const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });

// Hộp thoại chung (role=dialog). Spec có hộp thoại đặc biệt thì tự khai báo riêng, không import tên này.
const dialog = (page) => page.getByRole("dialog");

// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};

// Origin của BO dev (dùng cho header CORS khi trả response giả cho request ghi)
const ORIGIN = "https://dev-bo.royaledge.io";

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
// KHÔNG click giữa ô: với dropdown chọn nhiều, vị trí đó có thể rơi vào nút (x) của chip đã chọn
// (vị trí chip còn đổi theo lúc antd đo lại) -> bấm vào sẽ XOÁ giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Tổng số giá trị đang chọn của 1 filter chọn nhiều: ô chỉ hiện 1 chip + chip "+ N ..." (không có title) nên cộng cả hai.
async function selectedCount(page, id) {
  const shown = await filterEl(page, id)
    .locator('.ant-select-selection-overflow-item:not([aria-hidden="true"]) .ant-select-selection-item[title]')
    .count();
  const rest = await filterEl(page, id).locator(".ant-select-selection-overflow-item-rest").allInnerTexts();
  const hidden = rest.reduce((sum, t) => sum + Number(t.match(/\+\s*(\d+)/)?.[1] ?? 0), 0);
  return shown + hidden;
}

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
}

// Khi filter vừa đổi, Search đôi khi gửi 2 request list GIỐNG HỆT nhau cách nhau ~200ms: chờ mạng yên sau mỗi lần gọi
// để request thừa không bị nhầm là request của thao tác kế tiếp.
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
}

// Như waitTableIdle nhưng chỉ tính spinner của bảng: các ô filter tìm phía server (vd Name / Code / Username)
// cũng có thể hiện spinner khi đang nạp option.
async function waitTableIdleScoped(page) {
  await expect(page.locator(".ant-table-wrapper .ant-spin-spinning")).toHaveCount(0);
}

// Như settle nhưng dùng waitTableIdleScoped.
async function settleScoped(page) {
  await waitTableIdleScoped(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdleScoped(page);
}

module.exports = {
  filterEl,
  resetBtn,
  dialog,
  bodyOf,
  ORIGIN,
  openDropdown,
  selectedCount,
  waitTableIdle,
  settle,
  waitTableIdleScoped,
  settleScoped,
};
