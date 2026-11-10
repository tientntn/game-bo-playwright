// Administration > Audit Logs  (https://dev-bo.royaledge.io/admin/audit-logs)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/admin_audit_logs.spec.js --project=setup --project=chromium
//
// Màn hình danh sách "Audit Logs": nhật ký thao tác của người dùng BO trên toàn hệ thống (API POST log, chi tiết thay đổi: POST log/view {id}).
//  - Filter: Timezone ("timezoneId", dropdown chọn 1, có dấu * bắt buộc, mặc định = timezone của user), Time ("time", khoảng ngày giờ, preset Today ... Last 90 Days),
//    User Name ("username", input, khớp 1 phần, không phân biệt hoa thường), Action Type ("actionType", dropdown chọn NHIỀU: Active Create Default Delete Inactive Kick Maintenance Update,
//    gửi lên API dạng IN HOA: ["KICK","DELETE"]), Module ("module", dropdown chọn NHIỀU, gửi đúng tên hiển thị: ["Roles"]), Applied To ("appliedTo", input, khớp 1 phần, không phân biệt hoa thường).
//    Filter rỗng thì KHÔNG gửi key đó lên API. Request luôn có filters.timezoneId (backend trả VALIDATION_FAILED nếu thiếu).
//  - Bảng 8 cột: Time / User Name / Action Type / Module / Entity / Applied To / IP Address / Changes. Chỉ cột Time sort được (asc -> desc -> về mặc định id desc, cả 3 lần đều gọi API).
//    Cột Action Type là các tag (1 log có thể có nhiều action, vd Update + Default + Create). Cột Changes là nút "Details" mở modal "Changes" (log/view) gồm bảng Field / Old Value / New Value.
//  - Manage Columns: chỉ có checkbox ẩn / hiện cột (KHÔNG có nút Save / Reset to Default) và KHÔNG được lưu lại sau khi reload.
//  - Filter và số dòng / trang được lưu ở localStorage (key *_admin_audit-logs_filter / *_page_size) nên còn nguyên sau reload.
//  - Không có Add / Update / Delete / Export / chọn dòng.
//
// AN TOÀN DỮ LIỆU: TOÀN BỘ test chỉ ĐỌC. Màn hình không có thao tác ghi; request ghi (POST không thuộc nhóm đọc) bị chặn ở tầng mạng (route.abort)
// và afterEach kiểm tra không có request ghi nào được gửi (watchWrites). Không tạo / sửa / xoá bản ghi nào, không có Export.
// Dữ liệu audit log là dữ liệu CHUNG, luôn được người khác ghi thêm trong lúc test chạy (tổng số bản ghi thay đổi liên tục) nên test không so sánh tổng số
// giữa 2 lần gọi API, và không hard-code người dùng / module / applied to: mọi giá trị đều lấy từ chính dòng đầu của danh sách.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/admin/audit-logs";

// Đúng thứ tự hiển thị
const COLUMNS = ["Time", "User Name", "Action Type", "Module", "Entity", "Applied To", "IP Address", "Changes"];
const COL = { time: 0, username: 1, actionType: 2, module: 3, entity: 4, appliedTo: 5, ip: 6, changes: 7 };
const FILTERS = [
  ["timezoneId", "Timezone"],
  ["time_0", "Time"],
  ["username", "User Name"],
  ["actionType", "Action Type"],
  ["module", "Module"],
  ["appliedTo", "Applied To"],
];
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
// Option cố định (không có API dropdown). Action Type: nhãn hiển thị -> giá trị gửi API
const ACTION_TYPES = {
  Active: "ACTIVE",
  Create: "CREATE",
  Default: "DEFAULT",
  Delete: "DELETE",
  Inactive: "INACTIVE",
  Kick: "KICK",
  Maintenance: "MAINTENANCE",
  Update: "UPDATE",
};
const MODULES = [
  "Agent Game Settings",
  "Agents",
  "Alert Reports",
  "Api Keys",
  "Currencies",
  "Denominations",
  "Event Contents",
  "Game Categories",
  "Game Recommendation Contents",
  "Game Recommendations",
  "Games",
  "Geofencing",
  "Pending Game Round",
  "Permissions",
  "Player",
  "Recommendation Groups",
  "Risk Management",
  "Roles",
  "Users",
];
const DATETIME = /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/;
const MSG = { noEntries: "There are no entries found" };

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI. Màn hình này gọi: log (danh sách), log/view (chi tiết), timezone/list ...
const READ = /\/(list|details|download|view|log)(\?|$)|\/dropdown\/|_dropdown(\?|$)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/log");
const isView = endsWith("/log/view");

const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};
// "23-10-2026 17:43:34" -> "2026-10-23 17:43:34" (so sánh chuỗi được theo thứ tự thời gian)
const toIso = (s) => s.replace(/^(\d{2})-(\d{2})-(\d{4})/, "$3-$2-$1");
// "09-11-2026 17:00:00" -> số phút từ epoch (coi như UTC) để tính chênh lệch giữa 2 múi giờ
const toMinutes = (s) => {
  const [d, m, y, hh, mm] = s.match(/\d+/g).map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) / 60000;
};
// "(GMT +08:00) Asia/Singapore, Singapore" -> 480
const gmtMinutes = (title) => {
  const [, sign, h, m] = title.match(/^\(GMT ([+-])(\d{2}):(\d{2})\)/);
  return (sign === "-" ? -1 : 1) * (Number(h) * 60 + Number(m));
};
// "09-11-2026 ..." -> Date (UTC, chỉ lấy phần ngày)
function parseDay(s) {
  const [d, m, y] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const diffDays = (a, b) => Math.round((a - b) / 86400000);

// Bảng chính (luôn là .ant-table đầu tiên trong DOM)
const table = (page) => page.locator(".ant-table").first();
const rows = (page) => table(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
const th = (page, name) => table(page).locator("thead th").filter({ hasText: exact(name) });
const detailsBtn = (row) => row.getByRole("button", { name: "Details" });

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const pageSizeSelect = (page) => page.locator(".ant-pagination-options .ant-select");
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
const filterEl = (page, id) => page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
const dateRangeInput = (page) => page.locator("#time_dateRange");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const modal = (page) => page.locator(".ant-modal-content");

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-table-wrapper .ant-spin-spinning")).toHaveCount(0);
}

// Khi filter vừa đổi, Search đôi khi gửi 2 request list GIỐNG HỆT nhau cách nhau ~200ms: chờ mạng yên sau mỗi lần gọi
// để request thừa không bị nhầm là request của thao tác kế tiếp.
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
}

// Mở màn hình và chờ lần load đầu tiên (default filter) xong
async function openPage(page) {
  test.setTimeout(Math.max(test.info().timeout, 90000));
  const firstLoad = page.waitForResponse(isList, { timeout: 60000 });
  firstLoad.catch(() => {}); // tránh unhandled rejection khi test kết thúc sớm
  await page.goto(URL);
  // Session hết hạn -> app chuyển về /login và không bao giờ gọi API: báo lỗi rõ ràng thay vì chờ timeout
  const redirectedToLogin = page
    .waitForURL(/\/login/, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (await Promise.race([firstLoad.then(() => false), redirectedToLogin])) {
    throw new Error(
      "Bị chuyển về /login: session trong playwright/.auth/session.txt đã hết hạn (backend chỉ cho 1 session/tài khoản - đăng nhập ở nơi khác sẽ làm session này mất hiệu lực; token chỉ sống khoảng 1 giờ). Copy lại localStorage từ DevTools.",
    );
  }
  await firstLoad;
  await settle(page);
  await expect(page.locator(".NextGen-filter-bar")).toBeVisible();
}

// Bấm Search, trả về { body, status, json }. Lấy response từ chính request vừa gửi.
async function search(page) {
  const [req] = await Promise.all([page.waitForRequest(isList), searchBtn(page).click()]);
  const res = await req.response();
  const json = await res.json();
  await settle(page);
  return { body: bodyOf(req), status: res.status(), json };
}

// Thực hiện 1 hành động làm bảng gọi lại API (đổi trang, sort...) rồi trả về { body, json }
async function reloadFull(page, action) {
  const [req] = await Promise.all([page.waitForRequest(isList), action()]);
  const res = await req.response();
  const json = await res.json();
  await settle(page);
  return { body: bodyOf(req), json };
}
const reloadBy = async (page, action) => (await reloadFull(page, action)).body;

// Bấm Reset và gom MỌI request list gửi đi cho tới khi mạng yên; trả về danh sách body (request cuối = trạng thái bảng cuối cùng).
// Lưu ý: Reset CHỈ gọi lại API khi filter đang áp dụng khác mặc định.
async function resetBodies(page) {
  const bodies = [];
  const onRequest = (r) => {
    if (isList(r)) bodies.push(bodyOf(r));
  };
  page.on("request", onRequest);
  try {
    const first = page.waitForRequest(isList, { timeout: 5000 }).catch(() => null);
    await resetBtn(page).click();
    await first;
    await settle(page);
  } finally {
    page.off("request", onRequest);
  }
  return bodies;
}

const headers = async (page) => (await table(page).locator("thead th").allInnerTexts()).map((t) => t.trim());
const totalOf = async (page) => num((await summary(page).innerText()).match(/of ([\d,]+) records/)[1]);

// Lấy toàn bộ giá trị của 1 cột (theo tên header) ở trang hiện tại
async function columnValues(page, name) {
  await expect.poll(() => headers(page), { message: `Không thấy cột "${name}"` }).toContain(name);
  const idx = (await headers(page)).indexOf(name);
  return rows(page).evaluateAll((trs, i) => trs.map((tr) => tr.children[i].innerText.replace(/\s+/g, " ").trim()), idx);
}

// Tag của cột Action Type ở từng dòng: [["Update","Default"], ["Create"], ...]
const actionTags = (page) =>
  rows(page).evaluateAll((trs) =>
    trs.map((tr) => [...tr.children[2].querySelectorAll(".ant-tag")].map((t) => t.innerText.trim())),
  );

// Toàn bộ ô của bảng ở trang hiện tại: [{ cells: [text...], tags: [[tag...]...] }]
const tableMatrix = (page) =>
  rows(page).evaluateAll((trs) =>
    trs.map((tr) => ({
      cells: [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()),
      tags: [...tr.children].map((td) => [...td.querySelectorAll(".ant-tag")].map((t) => t.innerText.trim())),
    })),
  );

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
// KHÔNG click giữa ô: với dropdown chọn nhiều, vị trí đó có thể rơi vào nút (x) của chip đã chọn -> xoá mất giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (theo text) của filter dạng dropdown rồi đóng dropdown.
// Gõ tên vào ô tìm kiếm trước để option chắc chắn nằm trong danh sách hiển thị (danh sách ảo).
async function selectOption(page, id, text) {
  await openDropdown(page, id);
  await page.keyboard.type(text);
  await openOptions(page).filter({ hasText: exact(text) }).first().click();
  // Dropdown chọn nhiều không tự đóng và Esc cũng không đóng được -> click ra ngoài
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Đọc toàn bộ option đang có của 1 dropdown
async function dropdownOptions(page, id) {
  await openDropdown(page, id);
  await openOptions(page).first().waitFor();
  const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
  return titles;
}

// Giá trị đang chọn (chip / giá trị đơn) của 1 filter dropdown
const selectedTitles = (page, id) =>
  filterEl(page, id)
    .locator(".ant-select-selection-item[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));

// Tổng số giá trị đang chọn của 1 filter chọn nhiều (ô chỉ hiện 1 chip + chip "+ N ..." không có title)
async function selectedCount(page, id) {
  const shown = await filterEl(page, id)
    .locator('.ant-select-selection-overflow-item:not([aria-hidden="true"]) .ant-select-selection-item[title]')
    .count();
  const rest = await filterEl(page, id).locator(".ant-select-selection-overflow-item-rest").allInnerTexts();
  const hidden = rest.reduce((sum, t) => sum + Number(t.match(/\+\s*(\d+)/)?.[1] ?? 0), 0);
  return shown + hidden;
}

// Gõ vào filter dạng input (User Name / Applied To): input bị ẩn cho tới khi click label
async function typeFilter(page, id, value) {
  await filterEl(page, id).locator("label").first().click();
  await page.locator(`#${id}`).fill(value);
}

// Chọn preset ngày (Today / Yesterday / Last 7 Days ...) cho Time
async function pickDatePreset(page, preset) {
  await filterEl(page, "time_0").locator("label").first().click();
  // Popup của picker đang mở luôn được append SAU cùng trong DOM -> .last()
  await page.locator(".NextGen-datetime-preset__item").filter({ hasText: preset }).last().click();
  // Popup không tự đóng: click ra ngoài (tiêu đề trang) để đóng
  await breadcrumb(page).click();
}

// Xoá Time bằng nút (x) (chỉ render khi rê chuột vào ô ngày)
async function clearDate(page) {
  await filterEl(page, "time_0").hover();
  await filterEl(page, "time_0").locator('[aria-label="close-circle"]').click({ force: true });
}

// Title (nhãn) timezone đang chọn
const currentTimezone = (page) => filterEl(page, "timezoneId").locator(".ant-select-selection-item").getAttribute("title");

// Chọn timezone theo tên vùng (vd "Asia/Bangkok") - tên option có dạng "(GMT +07:00) Asia/Bangkok, Thailand"
async function pickTimezone(page, zone) {
  await openDropdown(page, "timezoneId");
  await page.keyboard.type(zone);
  await openOptions(page).filter({ hasText: zone }).first().click();
  await expect(openOptions(page)).toHaveCount(0);
  await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toContainText(zone);
}

// Có dữ liệu thì mới test tiếp (dev dùng chung nên gần như luôn có)
async function ensureData(page) {
  test.skip((await rows(page).count()) === 0, "Audit log không có bản ghi nào để test");
}

// Ghi lại mọi request POST KHÔNG phải đọc dữ liệu (url + body đã bỏ traceId)
function watchWrites(page) {
  const writes = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /boapi/.test(r.url()) && !READ.test(r.url())) {
      writes.push({ url: r.url().replace(/^.*\/v1\//, ""), body: bodyOf(r) });
    }
  });
  return writes;
}

// Lớp bảo hiểm: chặn không cho request ghi dữ liệu thật tới server (request vẫn được watchWrites ghi nhận)
async function blockWrites(page) {
  await page.route(/boapi/, (route) => {
    const r = route.request();
    if (r.method() === "POST" && !READ.test(r.url())) return route.abort();
    return route.continue();
  });
}

// Bấm "Details" của dòng i; trả về { id, data } với data = response log/view; chờ modal "Changes" hiện
async function openDetails(page, i, id) {
  const [req] = await Promise.all([page.waitForRequest(isView), detailsBtn(rowAt(page, i)).click()]);
  const res = await req.response();
  const json = await res.json();
  expect(bodyOf(req)).toEqual({ id });
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).locator(".ant-modal-title")).toHaveText("Changes");
  return json.data;
}

// Các dòng "Field / Old / New" trong modal Changes (bỏ dòng tiêu đề nhóm colspan=3): [{ field, oldValue, newValue }]
const modalFields = (page) =>
  modal(page)
    .locator("tbody tr")
    .evaluateAll((trs) =>
      trs
        .filter((tr) => tr.children.length === 3)
        .map((tr) => ({
          field: tr.children[0].innerText.trim(),
          oldValue: tr.children[1].innerText.trim(),
          newValue: tr.children[2].innerText.trim(),
        })),
    );

// Tìm trang đầu: dòng đầu tiên có actionType chứa 1 action cho trước (Search theo filter Action Type); trả về { list } hoặc null
async function searchAction(page, label) {
  await selectOption(page, "actionType", label);
  const { json } = await search(page);
  return json.data.list.length ? json.data : null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Administration > Audit Logs", () => {
  let writes;

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, số dòng/trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__admin_audit_logs_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/admin_audit-logs_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__admin_audit_logs_spec_cleared", "1");
    });
    writes = watchWrites(page);
    await blockWrites(page);
    await openPage(page);
  });

  // Màn hình chỉ đọc: không được có request ghi nào
  test.afterEach(async () => {
    expect(writes, "Màn hình chỉ đọc: không được gửi request ghi dữ liệu").toEqual([]);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề 'Audit Logs'", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Audit Logs");
    });

    test("Có đủ 6 filter và 2 nút Search/Reset; Timezone có dấu * bắt buộc", async ({ page }) => {
      await expect(page.locator(".NextGen-filter-element")).toHaveCount(FILTERS.length);
      for (const [id, label] of FILTERS) await expect(filterEl(page, id), id).toContainText(label);
      await expect(filterEl(page, "timezoneId").locator("label").first()).toHaveText("Timezone*");
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Loại filter: User Name / Applied To là ô nhập chữ; Action Type / Module chọn nhiều; Timezone chọn 1", async ({ page }) => {
      for (const id of ["username", "appliedTo"]) {
        await expect(filterEl(page, id).locator("input"), id).toHaveCount(1);
        await expect(filterEl(page, id).locator(".ant-select"), id).toHaveCount(0);
      }
      for (const id of ["actionType", "module"]) {
        await expect(filterEl(page, id).locator(".ant-select-multiple"), id).toHaveCount(1);
      }
      await expect(filterEl(page, "timezoneId").locator(".ant-select")).toHaveCount(1);
      await expect(filterEl(page, "timezoneId").locator(".ant-select-multiple")).toHaveCount(0);
    });

    test("Giá trị filter mặc định: chỉ có Timezone, còn lại để trống", async ({ page }) => {
      await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toContainText(/^\(GMT [+-]\d{2}:\d{2}\)/);
      await expect(dateRangeInput(page)).toHaveValue("");
      for (const id of ["username", "appliedTo"]) await expect(page.locator(`#${id}`)).toHaveValue("");
      for (const id of ["actionType", "module"]) {
        await expect(filterEl(page, id).locator(".ant-select-selection-item"), `#${id} phải trống`).toHaveCount(0);
      }
    });

    test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự, có Manage Columns, không có Add New / Export / chọn dòng`, async ({ page }) => {
      expect(await headers(page)).toEqual(COLUMNS);
      await expect(columnBtn(page)).toBeVisible();
      await expect(page.getByRole("button", { name: /Add New/ })).toHaveCount(0);
      await expect(page.locator("button.NextGen-export-button")).toHaveCount(0);
      await expect(page.locator('.ant-table input[type="checkbox"]')).toHaveCount(0);
    });

    test("Mặc định: trang 1, 10 dòng, sort id giảm dần, filters chỉ có timezoneId", async ({ page }) => {
      const { body, status, json } = await search(page);
      expect(status).toBe(200);
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc" });
      expect(Object.keys(body.filters)).toEqual(["timezoneId"]);
      expect(body.filters.timezoneId).toEqual(expect.any(Number));
      expect(json.status).toBe("success");
      expect(json.data.list.length).toBeLessThanOrEqual(10);
    });

    test("Dòng tóm tắt 'Showing 1 - n of N records' khớp totalCount và số dòng hiển thị", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const shown = Math.min(10, json.data.totalCount);
      await expect(summary(page)).toHaveText(`Showing 1 - ${shown} of ${json.data.totalCount} records`);
      await expect(rows(page)).toHaveCount(shown);
    });

    test("Nút Filter thu gọn / mở rộng thanh filter", async ({ page }) => {
      const bar = page.locator(".NextGen-filter-bar__items");
      await expect(bar).toBeVisible();
      await filterToggle(page).click();
      await expect(bar).toBeHidden();
      await filterToggle(page).click();
      await expect(bar).toBeVisible();
    });
  });

  // ===== 2. Dữ liệu bảng =====
  test.describe("Dữ liệu bảng", () => {
    test("Mỗi dòng khớp response API (Time, User Name, Action Type, Module, Entity, Applied To, IP)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      await expect(rows(page)).toHaveCount(list.length);
      const matrix = await tableMatrix(page);
      for (const [i, x] of list.entries()) {
        const at = `dòng ${i + 1} (log ${x.id})`;
        const c = matrix[i].cells;
        expect(c[COL.time], at).toBe(x.time);
        expect(c[COL.username], at).toBe(norm(x.username));
        expect(matrix[i].tags[COL.actionType], at).toEqual(x.actionType);
        expect(c[COL.module], at).toBe(norm(x.module));
        expect(c[COL.entity], at).toBe(norm(x.entity));
        expect(c[COL.appliedTo], at).toBe(norm(x.appliedTo));
        expect(c[COL.ip], at).toBe(norm(x.ip));
      }
    });

    test("Định dạng: Time dạng dd-MM-yyyy HH:mm:ss, Action Type hợp lệ, các cột chữ không trống", async ({ page }) => {
      await ensureData(page);
      for (const v of await columnValues(page, "Time")) expect(v).toMatch(DATETIME);
      for (const tags of await actionTags(page)) {
        expect(tags.length).toBeGreaterThan(0);
        for (const t of tags) expect(Object.keys(ACTION_TYPES)).toContain(t);
      }
      for (const col of ["User Name", "Module", "Entity", "Applied To", "IP Address"]) {
        for (const v of await columnValues(page, col)) expect(v, col).not.toBe("");
      }
      for (const v of await columnValues(page, "Module")) expect(MODULES).toContain(v);
    });

    test("Mặc định sắp xếp theo id giảm dần và id không trùng nhau", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Không đủ dữ liệu");
      const ids = json.data.list.map((x) => x.id);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
      expect(new Set(ids).size).toBe(ids.length);
    });

    test("Cột Changes: mỗi dòng có đúng 1 nút Details", async ({ page }) => {
      await ensureData(page);
      const n = await rows(page).count();
      for (let i = 0; i < n; i++) await expect(detailsBtn(cellAt(page, i, COL.changes)), `dòng ${i + 1}`).toHaveCount(1);
    });
  });

  // ===== 3. Chi tiết thay đổi (modal Changes) =====
  test.describe("Details (modal Changes)", () => {
    test("Bấm Details gọi log/view đúng id, hiện modal 'Changes' với tiêu đề Module:Applied To và bảng Field / Old Value / New Value", async ({
      page,
    }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      const data = await openDetails(page, 0, x.id);

      expect(data.module).toBe(x.module);
      expect(data.entity).toBe(x.entity);
      expect(data.appliedTo).toBe(x.appliedTo);
      await expect(modal(page)).toContainText(data.module);
      await expect(modal(page)).toContainText(data.appliedToName);
      expect((await modal(page).locator("thead th").allInnerTexts()).map((t) => t.trim())).toEqual(["Field", "Old Value", "New Value"]);
    });

    test("Đóng modal bằng nút (x)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await openDetails(page, 0, json.data.list[0].id);
      await modal(page).locator(".ant-modal-close").click();
      await expect(modal(page)).toHaveCount(0);
    });

    test("Đóng modal bằng phím Esc (sau khi click tiêu đề modal để có focus)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await openDetails(page, 0, json.data.list[0].id);
      await modal(page).locator(".ant-modal-title").click();
      await page.keyboard.press("Escape");
      await expect(modal(page)).toHaveCount(0);
    });

    test("Mở modal của dòng khác thì hiển thị đúng dòng đó (gửi log/view theo id của dòng)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Không đủ dữ liệu");
      const x = json.data.list[1];
      const data = await openDetails(page, 1, x.id);
      expect(data.appliedTo).toBe(x.appliedTo);
      await expect(modal(page)).toContainText(data.appliedToName);
    });

    test("Log Create: các field có Old Value trống và New Value có giá trị", async ({ page }) => {
      const data = await searchAction(page, "Create");
      test.skip(!data, "Không có audit log Create");
      await openDetails(page, 0, data.list[0].id);
      const fields = await modalFields(page);
      expect(fields.length, "log Create phải liệt kê các field").toBeGreaterThan(0);
      for (const f of fields) {
        expect(f.oldValue, `${f.field}: Old Value`).toBe("");
        expect(f.newValue, `${f.field}: New Value`).not.toBe("");
      }
    });

    test("Log Update: các field hiển thị là field có thay đổi (Old Value khác New Value)", async ({ page }) => {
      const data = await searchAction(page, "Update");
      test.skip(!data, "Không có audit log Update");
      // Chỉ lấy dòng chỉ có đúng action Update (log gộp nhiều action có thể hiển thị khác)
      const i = data.list.findIndex((x) => x.actionType.length === 1);
      test.skip(i < 0, "Không có log chỉ có action Update ở trang đầu");
      await openDetails(page, i, data.list[i].id);
      const fields = await modalFields(page);
      expect(fields.length, "log Update phải liệt kê field thay đổi").toBeGreaterThan(0);
      for (const f of fields) expect(f.oldValue, `${f.field}: Old Value phải khác New Value`).not.toBe(f.newValue);
    });

    test("Log Delete: mở được modal, tiêu đề khớp response log/view", async ({ page }) => {
      const data = await searchAction(page, "Delete");
      test.skip(!data, "Không có audit log Delete");
      const view = await openDetails(page, 0, data.list[0].id);
      await expect(modal(page)).toContainText(view.module);
      await expect(modal(page)).toContainText(view.appliedToName);
    });
  });

  // ===== 4. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Search mặc định gửi đúng request (timezone, phân trang, sort) và không có filter nào khác", async ({ page }) => {
      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc" });
      expect(Object.keys(body.filters)).toEqual(["timezoneId"]);
    });

    for (const id of ["timezoneId", "actionType", "module"]) {
      test(`Dropdown ${id} load được danh sách option`, async ({ page }) => {
        expect((await dropdownOptions(page, id)).length).toBeGreaterThan(0);
      });
    }

    test("Option cố định của Action Type và Module", async ({ page }) => {
      expect(await dropdownOptions(page, "actionType")).toEqual(Object.keys(ACTION_TYPES));
      expect(await dropdownOptions(page, "module")).toEqual(MODULES);
    });

    test("Tìm theo User Name (không phân biệt hoa/thường, khớp một phần)", async ({ page }) => {
      await ensureData(page);
      const user = (await columnValues(page, "User Name"))[0];
      const part = user.slice(0, Math.max(3, user.length - 2)).toUpperCase();
      await typeFilter(page, "username", part);
      const { body } = await search(page);

      expect(body.filters.username).toBe(part);
      const values = await columnValues(page, "User Name");
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(v.toLowerCase()).toContain(part.toLowerCase());
    });

    test("Tìm theo Applied To (không phân biệt hoa/thường, khớp một phần)", async ({ page }) => {
      await ensureData(page);
      const target = (await columnValues(page, "Applied To"))[0];
      const part = target.slice(0, Math.max(3, target.length - 2)).toLowerCase();
      await typeFilter(page, "appliedTo", part);
      const { body } = await search(page);

      expect(body.filters.appliedTo).toBe(part);
      const values = await columnValues(page, "Applied To");
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(v.toLowerCase()).toContain(part);
    });

    // Mỗi giá trị Action Type gửi đúng giá trị IN HOA và mọi dòng có tag tương ứng
    for (const [label, code] of Object.entries(ACTION_TYPES)) {
      test(`Lọc theo Action Type = ${label} gửi ["${code}"] và mọi dòng có tag ${label}`, async ({ page }) => {
        await selectOption(page, "actionType", label);
        const { body, status, json } = await search(page);
        expect(status).toBe(200);
        expect(body.filters.actionType).toEqual([code]);
        test.skip(json.data.list.length === 0, `Không có audit log nào với action ${label}`);
        for (const tags of await actionTags(page)) expect(tags).toContain(label);
        for (const x of json.data.list) expect(x.actionType).toContain(label);
      });
    }

    test("Lọc theo Module (giá trị của dòng đầu) gửi đúng tên module và mọi dòng khớp", async ({ page }) => {
      await ensureData(page);
      const module = (await columnValues(page, "Module"))[0];
      await selectOption(page, "module", module);
      const { body, status } = await search(page);

      expect(status).toBe(200);
      expect(body.filters.module).toEqual([module]);
      const values = await columnValues(page, "Module");
      expect(values.length, `không có dòng nào với Module=${module}`).toBeGreaterThan(0);
      for (const v of values) expect(v).toBe(module);
    });

    test("Action Type chọn nhiều giá trị: gửi đủ giá trị và mọi dòng có ít nhất 1 tag đã chọn", async ({ page }) => {
      await selectOption(page, "actionType", "Kick");
      await selectOption(page, "actionType", "Delete");
      await expect.poll(() => selectedCount(page, "actionType"), { timeout: 10_000 }).toBe(2);
      const { body, json } = await search(page);

      expect(body.filters.actionType).toEqual(["KICK", "DELETE"]);
      test.skip(json.data.list.length === 0, "Không có log Kick / Delete");
      for (const tags of await actionTags(page)) {
        expect(tags.some((t) => t === "Kick" || t === "Delete"), `tags: ${tags}`).toBe(true);
      }
    });

    test("Module chọn nhiều giá trị: gửi đủ giá trị và mọi dòng thuộc 1 trong các module đã chọn", async ({ page }) => {
      await selectOption(page, "module", "Roles");
      await selectOption(page, "module", "Users");
      await expect.poll(() => selectedCount(page, "module"), { timeout: 10_000 }).toBe(2);
      const { body, json } = await search(page);

      expect(body.filters.module).toEqual(["Roles", "Users"]);
      test.skip(json.data.list.length === 0, "Không có log của Roles / Users");
      for (const v of await columnValues(page, "Module")) expect(["Roles", "Users"]).toContain(v);
    });

    test("Kết hợp nhiều filter cùng lúc (AND)", async ({ page }) => {
      await ensureData(page);
      const [user, module] = await Promise.all(["User Name", "Module"].map((c) => columnValues(page, c).then((v) => v[0])));
      await typeFilter(page, "username", user);
      await selectOption(page, "module", module);
      const { body, json } = await search(page);

      expect(body.filters.username).toBe(user);
      expect(body.filters.module).toEqual([module]);
      expect(json.data.list.length, "dòng đầu của danh sách phải thoả cả 2 filter").toBeGreaterThan(0);
      for (const v of await columnValues(page, "User Name")) expect(v.toLowerCase()).toContain(user.toLowerCase());
      for (const v of await columnValues(page, "Module")) expect(v).toBe(module);
    });

    test("Không có kết quả -> hiển thị 'There are no entries found'", async ({ page }) => {
      await typeFilter(page, "username", "no_such_user_zzz_999");
      await search(page);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText(MSG.noEntries).first()).toBeVisible();
      // Khi không có kết quả app ẩn luôn dòng tóm tắt "Showing ..."
      await expect(summary(page)).toHaveCount(0);
    });

    test("Đổi Timezone: gửi timezoneId mới và Time của cùng 1 log lệch đúng bằng chênh lệch múi giờ", async ({ page }) => {
      const before = await search(page);
      test.skip(before.json.data.list.length === 0, "Không có dữ liệu");
      const currentTitle = await currentTimezone(page);
      // Chọn múi giờ không có DST khác với múi giờ hiện tại
      const zone = ["Asia/Bangkok", "Asia/Tokyo"].find((z) => !currentTitle.includes(z));
      await pickTimezone(page, zone);
      const newTitle = await currentTimezone(page);
      const after = await search(page);

      expect(after.body.filters.timezoneId).not.toBe(before.body.filters.timezoneId);
      const expectedShift = gmtMinutes(newTitle) - gmtMinutes(currentTitle);
      expect(expectedShift, "2 múi giờ phải khác nhau").not.toBe(0);
      // Log mới có thể được người khác ghi thêm giữa 2 lần gọi -> chỉ so các id có ở cả 2 response
      const beforeById = new Map(before.json.data.list.map((x) => [x.id, x.time]));
      const common = after.json.data.list.filter((x) => beforeById.has(x.id));
      expect(common.length, "phải có log chung giữa 2 lần gọi").toBeGreaterThan(0);
      for (const x of common) {
        expect(toMinutes(x.time) - toMinutes(beforeById.get(x.id)), `log ${x.id}`).toBe(expectedShift);
      }
      // Bảng hiển thị đúng giá trị của response mới
      expect(await columnValues(page, "Time")).toEqual(after.json.data.list.map((x) => x.time));
    });

    // HÀNH VI HIỆN TẠI CẦN XÁC NHẬN: Timezone có dấu * (bắt buộc) nhưng xoá đi rồi Search thì app KHÔNG báo lỗi form,
    // vẫn gửi request không có timezoneId, backend trả VALIDATION_FAILED ("Filters.TimeZoneId ...") và bảng chỉ hiện "There are no entries found".
    test("Xoá Timezone rồi Search: request thiếu timezoneId, backend từ chối (VALIDATION_FAILED), bảng trống", async ({ page }) => {
      await filterEl(page, "timezoneId").hover();
      await filterEl(page, "timezoneId").locator(".ant-select-clear").click({ force: true });
      await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toHaveCount(0);

      const { body, status, json } = await search(page);
      expect(body.filters.timezoneId).toBeUndefined();
      expect(status).toBe(200);
      expect(json.status).toBe("fail");
      expect(json.messageCode).toBe("VALIDATION_FAILED");
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText(MSG.noEntries).first()).toBeVisible();
    });
  });

  // ===== 5. Bộ lọc thời gian =====
  test.describe("Time", () => {
    test("Time có đủ các preset", async ({ page }) => {
      await filterEl(page, "time_0").locator("label").first().click();
      const presets = page.locator(".NextGen-datetime-preset__item");
      await expect(presets.first()).toBeVisible();
      expect((await presets.allInnerTexts()).map((t) => t.trim())).toEqual([
        "Today",
        "Yesterday",
        "Last 7 Days",
        "Last 14 Days",
        "Last 30 Days",
        "Last 90 Days",
      ]);
    });

    test("Các preset cho khoảng ngày đúng và gửi đúng request filters.time", async ({ page }) => {
      // [preset, số ngày tính cả hôm nay]
      const PRESETS = [
        ["Today", 1],
        ["Last 7 Days", 7],
        ["Last 14 Days", 14],
        ["Last 30 Days", 30],
        ["Last 90 Days", 90],
      ];
      let today;
      for (const [preset, days] of PRESETS) {
        await pickDatePreset(page, preset);
        const [from, to] = (await dateRangeInput(page).inputValue()).split(" - ");
        expect(from.slice(11), preset).toBe("00:00:00");
        expect(to.slice(11), preset).toBe("23:59:59");
        if (preset === "Today") today = parseDay(to);
        expect(parseDay(to).getTime(), preset).toBe(today.getTime()); // luôn kết thúc ở hôm nay
        expect(diffDays(parseDay(to), parseDay(from)) + 1, preset).toBe(days);

        const { body } = await search(page);
        expect(body.filters.time, preset).toEqual([from, to]);
      }
    });

    test("Preset Yesterday = hôm qua", async ({ page }) => {
      await pickDatePreset(page, "Today");
      const today = parseDay((await dateRangeInput(page).inputValue()).split(" - ")[1]);
      await pickDatePreset(page, "Yesterday");
      const [from, to] = (await dateRangeInput(page).inputValue()).split(" - ");
      expect(diffDays(today, parseDay(from))).toBe(1);
      expect(diffDays(today, parseDay(to))).toBe(1);
    });

    test("Xoá bằng nút (x) -> request không còn filters.time (Time không bắt buộc)", async ({ page }) => {
      await pickDatePreset(page, "Last 7 Days");
      await expect(dateRangeInput(page)).not.toHaveValue("");
      await clearDate(page);
      await expect(dateRangeInput(page)).toHaveValue("");

      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body.filters.time).toBeUndefined();
    });

    test("Mọi dòng có Time nằm trong khoảng đã chọn", async ({ page }) => {
      await pickDatePreset(page, "Last 90 Days");
      const { body } = await search(page);
      const [from, to] = body.filters.time.map(toIso);

      const dates = await columnValues(page, "Time");
      test.skip(dates.length === 0, "Không có audit log nào trong 90 ngày gần nhất");
      for (const d of dates) {
        expect(toIso(d) >= from, `${d} phải >= ${from}`).toBe(true);
        expect(toIso(d) <= to, `${d} phải <= ${to}`).toBe(true);
      }
    });

    test("Thu hẹp khoảng ngày thì số bản ghi không tăng", async ({ page }) => {
      await pickDatePreset(page, "Last 90 Days");
      const wide = (await search(page)).json.data.totalCount;
      await pickDatePreset(page, "Last 7 Days");
      const narrow = (await search(page)).json.data.totalCount;
      expect(narrow).toBeLessThanOrEqual(wide);
    });
  });

  // ===== 6. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá toàn bộ filter đã chọn, đưa Timezone về mặc định và gửi lại request mặc định", async ({ page }) => {
      await ensureData(page);
      const defaultTz = await currentTimezone(page);
      const defaultBody = (await search(page)).body;
      const module = (await columnValues(page, "Module"))[0];

      await selectOption(page, "module", module);
      await selectOption(page, "actionType", "Update");
      await typeFilter(page, "username", "abc");
      await typeFilter(page, "appliedTo", "abc");
      await pickDatePreset(page, "Last 7 Days");
      await pickTimezone(page, ["Asia/Bangkok", "Asia/Tokyo"].find((z) => !defaultTz.includes(z)));
      await search(page);

      const bodies = await resetBodies(page);
      for (const id of ["actionType", "module"]) {
        await expect(filterEl(page, id).locator(".ant-select-selection-item")).toHaveCount(0);
      }
      for (const id of ["username", "appliedTo"]) await expect(page.locator(`#${id}`)).toHaveValue("");
      await expect(dateRangeInput(page)).toHaveValue("");
      expect(await currentTimezone(page)).toBe(defaultTz);

      expect(bodies.length, "Reset phải gọi lại API").toBeGreaterThan(0);
      expect(bodies[bodies.length - 1]).toEqual(defaultBody);
    });
  });

  // ===== 7. Phân trang =====
  test.describe("Phân trang", () => {
    test.beforeEach(async ({ page }) => {
      const total = await totalOf(page);
      test.skip(total <= 20, `Chỉ có ${total} bản ghi, không đủ để test phân trang`);
    });

    test("Chuyển sang trang 2 rồi quay lại trang 1", async ({ page }) => {
      const page1 = await rows(page).allInnerTexts();

      const body2 = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      expect(body2.page).toBe(2);
      await expect(summary(page)).toHaveText(/^Showing 11 - 20 of /);
      expect(await rows(page).allInnerTexts()).not.toEqual(page1);

      const body1 = await reloadBy(page, () => page.locator(".ant-pagination-item-1").click());
      expect(body1.page).toBe(1);
      await expect(summary(page)).toHaveText(/^Showing 1 - 10 of /);
    });

    test("Nút Next / Previous", async ({ page }) => {
      // Previous / Next là thẻ <li> nên kiểm tra bằng class ant-pagination-disabled (toBeDisabled không áp dụng được)
      await expect(page.locator(".ant-pagination-prev")).toHaveClass(/ant-pagination-disabled/);

      const next = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(next.page).toBe(2);
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");

      const prev = await reloadBy(page, () => page.locator(".ant-pagination-prev").click());
      expect(prev.page).toBe(1);
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
    });

    test("Nhảy tới trang cuối: dòng tóm tắt và số dòng hiển thị khớp response", async ({ page }) => {
      const lastItem = page.locator(".ant-pagination-item").last();
      const lastPage = Number(await lastItem.innerText());
      const { body, json } = await reloadFull(page, () => lastItem.click());

      expect(body.page).toBe(lastPage);
      const { totalCount, list } = json.data;
      expect(list.length).toBeGreaterThan(0);
      expect(list.length).toBeLessThanOrEqual(10);
      await expect(rows(page)).toHaveCount(list.length);
      await expect(summary(page)).toHaveText(`Showing ${(lastPage - 1) * 10 + 1} - ${Math.min(lastPage * 10, totalCount)} of ${totalCount} records`);
      await expect(page.locator(".ant-pagination-next")).toHaveClass(/ant-pagination-disabled/);
    });

    test("Đổi số dòng / trang", async ({ page }) => {
      await pageSizeSelect(page).click();
      expect(await openOptions(page).allInnerTexts()).toEqual(PAGE_SIZES);

      const body = await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
      expect(body.pageSize).toBe(20);
      expect(body.page).toBe(1);
      await expect(rows(page)).toHaveCount(20);
      await expect(summary(page)).toHaveText(/^Showing 1 - 20 of /);
    });

    // Hành vi hiện tại: đổi số dòng khi đang ở trang 2 thì app GIỮ NGUYÊN số trang (page=2, không quay về 1) nếu trang đó vẫn hợp lệ
    test("Đổi số dòng / trang khi đang ở trang 2: giữ trang 2 với số dòng mới", async ({ page }) => {
      await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      await pageSizeSelect(page).click();
      const body = await reloadBy(page, () => openOptions(page).filter({ hasText: "50 / page" }).click());
      expect(body.pageSize).toBe(50);
      expect(body.page).toBe(2);
      await expect(summary(page)).toHaveText(/^Showing 51 - 100 of /);
    });

    test("Giữ nguyên filter khi chuyển trang", async ({ page }) => {
      await selectOption(page, "actionType", "Update");
      const first = await search(page);
      test.skip(first.json.data.totalCount <= 10, "Action Update chỉ có 1 trang");

      const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(body.page).toBe(2);
      expect(body.filters).toEqual(first.body.filters);
      for (const tags of await actionTags(page)) expect(tags).toContain("Update");
    });

    test("Số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
      await pageSizeSelect(page).click();
      await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

      const reqPromise = page.waitForRequest(isList);
      await page.reload();
      expect(bodyOf(await reqPromise).pageSize).toBe(20);
      await settle(page);
      await expect(rows(page)).toHaveCount(20);
    });
  });

  // ===== 8. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    test("Sort cột Time: tăng dần -> giảm dần -> về mặc định (id giảm dần)", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
      const header = th(page, "Time");
      const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

      const asc = await reloadBy(page, () => header.click());
      expect(asc).toMatchObject({ sortBy: "time", sortDirection: "asc" });
      let v = (await columnValues(page, "Time")).map(toIso);
      expect(v).toEqual([...v].sort(cmp));

      const desc = await reloadBy(page, () => header.click());
      expect(desc).toMatchObject({ sortBy: "time", sortDirection: "desc" });
      v = (await columnValues(page, "Time")).map(toIso);
      expect(v).toEqual([...v].sort((a, b) => cmp(b, a)));

      // Click lần 3: bỏ sort -> quay về mặc định id giảm dần (vẫn gọi API)
      const none = await reloadBy(page, () => header.click());
      expect(none).toMatchObject({ sortBy: "id", sortDirection: "desc" });
    });

    test("Các cột còn lại không có chức năng sort", async ({ page }) => {
      for (const column of COLUMNS.filter((c) => c !== "Time")) {
        await expect(th(page, column), column).not.toHaveClass(/ant-table-column-has-sorters/);
      }
      await expect(th(page, "Time")).toHaveClass(/ant-table-column-has-sorters/);
    });

    test("Giữ nguyên filter khi sort", async ({ page }) => {
      await selectOption(page, "actionType", "Update");
      const first = await search(page);
      test.skip(first.json.data.list.length < 2, "Không đủ dữ liệu");
      const body = await reloadBy(page, () => th(page, "Time").click());
      expect(body.sortBy).toBe("time");
      expect(body.filters).toEqual(first.body.filters);
    });
  });

  // ===== 9. Manage Columns =====
  test.describe("Manage Columns", () => {
    // hasText dạng RegExp khớp CHÍNH XÁC tên cột
    const item = (page, name) =>
      columnPopover(page).locator(".NextGen-popover-manage-column__list__items", { hasText: exact(name) });

    test("Popover liệt kê đủ cột, đều được chọn; không có nút Save / Reset to Default", async ({ page }) => {
      await columnBtn(page).click();
      await expect(columnPopover(page)).toBeVisible();
      const names = await columnPopover(page).locator(".NextGen-popover-manage-column__list__items .ant-typography").allInnerTexts();
      expect(names.map((n) => n.trim())).toEqual(COLUMNS);
      await expect(columnPopover(page).locator("input[type=checkbox]:checked")).toHaveCount(COLUMNS.length);
      await expect(columnPopover(page).getByRole("button")).toHaveCount(0);
    });

    test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Entity").locator("label").click();
      expect(await headers(page)).not.toContain("Entity");
      expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

      await item(page, "Entity").locator("label").click();
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Ẩn nhiều cột cùng lúc", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "IP Address").locator("label").click();
      await item(page, "Entity").locator("label").click();
      expect(await headers(page)).toEqual(COLUMNS.filter((c) => c !== "IP Address" && c !== "Entity"));
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      await ensureData(page);
      const before = await columnValues(page, "User Name");
      await columnBtn(page).click();
      await item(page, "Entity").locator("label").click();
      expect(await columnValues(page, "User Name")).toEqual(before);
    });

    test("Cấu hình cột KHÔNG được lưu: reload trang thì hiện lại đủ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Entity").locator("label").click();
      expect(await headers(page)).not.toContain("Entity");

      await openPage(page); // reload
      expect(await headers(page)).toEqual(COLUMNS);
    });
  });

  // ===== 10. Ghi nhớ filter =====
  test.describe("Ghi nhớ filter", () => {
    test("Filter được ghi nhớ sau khi reload trang", async ({ page }) => {
      await ensureData(page);
      const [user, module] = await Promise.all(["User Name", "Module"].map((c) => columnValues(page, c).then((v) => v[0])));
      await typeFilter(page, "username", user);
      await selectOption(page, "module", module);
      await selectOption(page, "actionType", "Update");
      await pickDatePreset(page, "Last 90 Days");
      const { body } = await search(page);

      const reqPromise = page.waitForRequest(isList);
      await openPage(page); // reload
      expect(bodyOf(await reqPromise).filters).toEqual(body.filters);
      await expect(page.locator("#username")).toHaveValue(user);
      expect(await selectedTitles(page, "module")).toEqual([module]);
      expect(await selectedTitles(page, "actionType")).toEqual(["Update"]);
      await expect(dateRangeInput(page)).toHaveValue(body.filters.time.join(" - "));
    });

    test("Timezone đã đổi được ghi nhớ sau khi reload trang", async ({ page }) => {
      const defaultTz = await currentTimezone(page);
      await pickTimezone(page, ["Asia/Bangkok", "Asia/Tokyo"].find((z) => !defaultTz.includes(z)));
      const chosen = await currentTimezone(page);
      await search(page);

      await openPage(page); // reload
      expect(await currentTimezone(page)).toBe(chosen);
    });
  });
});
