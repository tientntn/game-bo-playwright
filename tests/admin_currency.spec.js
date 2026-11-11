// Administration > Currency  (https://dev-bo.royaledge.io/admin/currency)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/admin_currency.spec.js --project=setup --project=chromium
//
// Màn hình danh sách "Currency": danh sách currency của hệ thống (API currency/list, filters.sasEntityId luôn = [1]) + Export + Manage Columns.
//  - Filter: Code ("code", input, khớp 1 phần, không phân biệt hoa thường), Name ("name", input), Sweep Stake ("isSweep", dropdown chọn 1: No / Yes, gửi SỐ 0 / 1),
//    Status ("status", dropdown chọn 1: Active / Inactive, gửi dạng MẢNG [1] / [0]). Filter rỗng thì KHÔNG gửi key đó lên API.
//  - Cột ID / Code / Name / Status sort được (sortBy id | code | name | status); Max Payout, Sweepstake, Exchange Rate(to USD), Action không sort.
//    Cột ID đang là mặc định (id desc): click đầu tiên về "không sort" và KHÔNG gọi API, click 2 = asc, click 3 = desc. 3 cột còn lại: asc -> desc -> về mặc định (id desc).
//  - Cột Action có 3 icon: History (hộp thoại "Currency History": lịch sử đổi tỉ giá, API currencyrate/history {id,page,pageSize}), Update (hộp thoại "Update Currencies",
//    currency/view {id}) và bật / tắt trạng thái (Deactivate khi đang Active / Activate khi đang Inactive; currency/deactivate {ids,status}). Có checkbox chọn dòng +
//    2 nút Bulk Activate / Bulk Deactivate (cùng API currency/deactivate). KHÔNG có chức năng xoá currency.
//  - Add New (hộp thoại "Add Currency"): Name, Code, Max Payout, Exchange Rate (số > 0), Sweep Stake (switch), Status (Active / Inactive). Save gọi currency/validate/code {code}
//    (kiểm tra mã: chỉ chữ HOA A-Z, dài 3-50, chưa tồn tại) rồi currency/create {name,code,maxPayout,exchangeRate,isSweep,status} (maxPayout / exchangeRate gửi dạng CHUỖI).
//  - Update: Code bị khoá; Save gọi currency/update {name,maxPayout,exchangeRate,isSweep,status,id}. Đổi Exchange Rate sinh 1 dòng lịch sử (cũ -> mới).
//
// AN TOÀN DỮ LIỆU:
//  - Mọi describe trừ cuối là "chỉ đọc": request ghi (currency/create, currency/update, currency/deactivate) bị chặn ở tầng mạng (route.abort); test kiểm tra payload / thông báo
//    dùng route.fulfill trả response GIẢ (request KHÔNG tới server). afterEach so sánh chính xác request ghi bắt được (watchWrites) với danh sách được phép (allowedWrites).
//    currency/validate/code, currencyrate/history, currency/view là request ĐỌC (validate chỉ kiểm tra, không ghi). Currency có sẵn của team chỉ bị thao tác bằng request GIẢ.
//  - Describe cuối "CRUD (ghi dữ liệu thật)" chạy tuần tự, CHỈ thao tác trên 1 currency QA (code "QAUI" + 6 chữ HOA, name "QA-UI-CURRENCY <code>"):
//      * Màn hình KHÔNG có chức năng xoá -> currency QA KHÔNG dọn được bằng UI, nên test chỉ TẠO khi chưa có currency QAUI... nào (tối đa 1 lần trong cả vòng đời),
//        các lần chạy sau dùng lại. Mọi test sửa (name / max payout / exchange rate / sweep / status) đều khôi phục về giá trị gốc trong finally + afterAll
//        (riêng lịch sử tỉ giá thì tăng thêm dòng sau mỗi lần đổi rồi khôi phục tỉ giá - không xoá được).
//      * afterEach kiểm tra mọi request ghi chỉ nhắm vào currency QA này (currency/update.id, currency/deactivate.ids = [id QA]; currency/create chỉ với code QAUI...).
//  - Export tạo bản ghi ở Download History; nếu file cùng filter đã tồn tại thì hộp thoại "Download Now / Download New" hiện ra và test KHÔNG bấm Download New.
//  - Không hard-code dữ liệu: currency dùng cho test đều lấy từ response list.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/admin/currency";
const ORIGIN = "https://dev-bo.royaledge.io";

// Đúng thứ tự hiển thị (cột đầu tiên là checkbox chọn dòng, không có tên)
const COLUMNS = ["ID", "Code", "Name", "Max Payout", "Sweepstake", "Exchange Rate(to USD)", "Status", "Action"];
const HEADERS = ["", ...COLUMNS];
const COL = { check: 0, id: 1, code: 2, name: 3, maxPayout: 4, sweep: 5, rate: 6, status: 7, action: 8 };
const FILTERS = [
  ["code", "Code"],
  ["name", "Name"],
  ["isSweep", "Sweep Stake"],
  ["status", "Status"],
];
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
const DEFAULT_BODY = {
  page: 1,
  pageSize: 10,
  sortBy: "id",
  sortDirection: "desc",
  filters: { sasEntityId: [1] },
};
const SORTABLE = { ID: "id", Code: "code", Name: "name", Status: "status" };
const STATUS_TEXT = { 0: "Inactive", 1: "Active" };
const SWEEP_TEXT = { 0: "No", 1: "Yes" };
const QA_CODE_PREFIX = "QAUI"; // code của currency QA: QAUI + 6 chữ HOA (code chỉ được chứa A-Z)
const QA_CODE_RE = /^QAUI[A-Z]{6}$/;

// Thông báo của form / toast (đọc từ màn hình thật)
const MSG = {
  name: "Please enter Name",
  code: "Please enter Code",
  maxPayout: "Please enter Max Payout",
  rate: "Please enter Exchange Rate",
  positive: "Please enter valid number greater than 0",
  number: "Please enter a valid numbers",
  duplicate: "Currency code is already existed",
  noEntries: "There are no entries found",
  noHistory: "No History Data Available",
};

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI (currency/create, currency/update, currency/deactivate)
const READ = /\/(list|details|download|view|history|validate\/code)(\?|$)|\/dropdown\/|_dropdown(\?|$)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/currency/list");
const isView = endsWith("/currency/view");
const isHistory = endsWith("/currencyrate/history");
const isValidate = endsWith("/currency/validate/code");
const isCreate = endsWith("/currency/create");
const isUpdate = endsWith("/currency/update");
const isDeactivate = endsWith("/currency/deactivate");
const isDownload = endsWith("/download");

const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};
const asc = (a, b) => a - b;
const near = (cell, value) => Math.abs(num(cell) - Number(value)) <= Math.max(1e-6, Math.abs(Number(value)) * 1e-9);
const qaCode = () => QA_CODE_PREFIX + [...String(Date.now()).slice(-6)].map((d) => "ABCDEFGHIJ"[d]).join("");

// Bảng chính (luôn là .ant-table đầu tiên trong DOM)
const table = (page) => page.locator(".ant-table").first();
const rows = (page) => table(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
const th = (page, name) => table(page).locator("thead th").filter({ hasText: exact(name) });
const checkboxOf = (page, i) => rowAt(page, i).locator('input[type="checkbox"]');
// Icon hành động của 1 dòng: 0 = History, 1 = Update, 2 = bật / tắt trạng thái
const actionIcon = (row, n) => row.locator(".column-actions svg").nth(n);
const ICON = { history: 0, update: 1, toggle: 2 };

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const addBtn = (page) => page.getByRole("button", { name: /Add New/ });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const exportBtn = (page) => page.locator("button.NextGen-export-button");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const bulkBtns = (page) => page.locator("button.NextGen-button-more-action__update");
const pageSizeSelect = (page) => page.locator(".ant-pagination-options .ant-select");
const dialog = (page) => page.getByRole("dialog");
const toasts = (page) => page.locator(".Toastify__toast");
const tooltip = (page) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
const filterEl = (page, id) => page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });

// Hộp thoại Add / Update (các ô nằm TRONG hộp thoại: id name / code trùng với filter ở trang nên luôn phải đi qua dialog)
const field = (page, id) => dialog(page).locator(`#${id}`);
const switchEl = (page) => dialog(page).locator("#isSweep");
const statusRadio = (page, text) => dialog(page).locator("label.ant-radio-wrapper").filter({ hasText: exact(text) });
const saveBtn = (page) => dialog(page).getByRole("button", { name: "Save", exact: true });
const cancelBtn = (page) => dialog(page).getByRole("button", { name: /Cancel$/ });
const closeX = (page) => dialog(page).locator(".ant-modal-close");
const formErrors = (page) => dialog(page).locator(".ant-form-item-explain-error");

// Tooltip antd mở / đóng có độ trễ: tooltip cũ còn đang mờ dần thì có 2 tooltip cùng lúc (strict mode violation).
// Đưa chuột ra ngoài, đợi tooltip cũ ẩn hết rồi hover lại, thử lại tới khi tooltip có đúng nội dung.
const hoverTip = async (page, target, text) => {
  await expect(async () => {
    await page.mouse.move(0, 0);
    await expect(tooltip(page)).toHaveCount(0, { timeout: 2000 });
    await target.hover();
    await expect(tooltip(page).filter({ hasText: exact(text) })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
};

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
  test.setTimeout(Math.max(test.info().timeout, 90000)); // không hạ timeout đã nới ở các test CRUD khi openPage được gọi lại giữa test
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
    // Filter đang là mặc định thì Reset không gọi API -> chờ ngắn rồi đi tiếp (không treo tới hết timeout)
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

// Toàn bộ ô của bảng ở trang hiện tại: [{ cells: [text...], statusClass }]
const tableMatrix = (page) =>
  rows(page).evaluateAll((trs) =>
    trs.map((tr) => ({
      cells: [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()),
      statusClass: tr.children[7]?.querySelector(".ant-tag")?.className ?? "",
    })),
  );

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (theo text) của filter dạng dropdown (Sweep Stake / Status: chọn 1) rồi đóng dropdown.
async function selectOption(page, id, text) {
  await openDropdown(page, id);
  await openOptions(page).filter({ hasText: exact(text) }).first().click();
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Gõ vào filter dạng input (Code / Name): input bị ẩn cho tới khi click label
async function typeFilter(page, id, value) {
  await filterEl(page, id).locator("label").first().click();
  await filterEl(page, id).locator("input").fill(value);
}

// Giá trị đang chọn (chip) của 1 filter dropdown
const selectedTitles = (page, id) =>
  filterEl(page, id)
    .locator(".ant-select-selection-item[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));

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

const fulfillJson = (route, response) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": ORIGIN, "access-control-allow-credentials": "true" },
    body: JSON.stringify(response),
  });

// Dùng cho test kiểm tra payload / thông báo: request ghi vẫn KHÔNG tới server, được trả về response GIẢ
// (route đăng ký sau được ưu tiên hơn route chặn ở beforeEach)
async function mockWrites(page, response) {
  await page.route(/boapi/, (route) => {
    const r = route.request();
    if (r.method() === "POST" && !READ.test(r.url())) return fulfillJson(route, response);
    return route.continue();
  });
}
const MOCK_OK = { status: "success", messageCode: "SUCCESS", message: "OK", data: {} };
const MOCK_FAIL = { status: "fail", messageCode: "QA_MOCK_ERROR", message: "QA mock error", data: null };

// --- Hộp thoại Add / Update / History ---
async function openCreate(page) {
  await addBtn(page).click();
  await expect(dialog(page)).toContainText("Add Currency");
  await expect(field(page, "name")).toBeVisible();
}

// Mở hộp thoại Update của 1 dòng (icon thứ 2). Trả về currency/view response (data)
// Lưu ý: sau currency/view, hộp thoại Update còn gọi currencyrate/history và khi response này về thì form BỊ RESET về giá trị gốc
// (giá trị gõ vào trước đó bị mất - đã tái hiện bằng script, ghi ở report.md) -> phải chờ cả 2 response + mạng yên rồi mới nhập.
// Mở lại hộp thoại Update của cùng 1 dòng (cùng phiên) thì app có thể KHÔNG gọi lại currency/view / history (dùng cache) -> không chờ vô hạn.
async function openUpdate(page, row) {
  const viewRes = page.waitForResponse(isView, { timeout: 8000 }).catch(() => null);
  const histRes = page.waitForResponse(isHistory, { timeout: 8000 }).catch(() => null);
  await actionIcon(row, ICON.update).click();
  await expect(dialog(page)).toContainText("Update Currencies");
  const res = await viewRes;
  await histRes;
  await page.waitForLoadState("networkidle").catch(() => {});
  if (res) {
    const data = (await res.json()).data;
    await expect(field(page, "name")).toHaveValue(data.name);
    return data;
  }
  await expect(field(page, "name")).not.toHaveValue("");
  return {
    name: await field(page, "name").inputValue(),
    code: await field(page, "code").inputValue(),
    maxPayout: Number(await field(page, "maxPayout").inputValue()),
    exchangeRate: Number(await field(page, "exchangeRate").inputValue()),
    isSweep: (await switchEl(page).getAttribute("aria-checked")) === "true" ? 1 : 0,
    status: (await statusRadio(page, "Active").locator("input").isChecked()) ? 1 : 0,
  };
}

// Mở hộp thoại History của 1 dòng. Trả về currencyrate/history response (data)
async function openHistory(page, row) {
  const [res] = await Promise.all([page.waitForResponse(isHistory), actionIcon(row, ICON.history).click()]);
  await expect(dialog(page)).toContainText("Currency History");
  return (await res.json()).data;
}

// Điền hộp thoại Add / Update (các giá trị dạng chuỗi như người dùng gõ). Bỏ qua trường không truyền.
// Form của hộp thoại có thể bị reset bất đồng bộ bởi response đến muộn (xem openUpdate) -> điền xong kiểm tra lại giá trị, nếu bị mất thì điền lại.
async function fillForm(page, { name, code, maxPayout, exchangeRate, isSweep, status }) {
  const texts = { name, code, maxPayout, exchangeRate };
  await expect(async () => {
    for (const [id, v] of Object.entries(texts)) if (v !== undefined) await field(page, id).fill(v);
    if (isSweep !== undefined && (await switchEl(page).getAttribute("aria-checked")) !== String(!!isSweep)) await switchEl(page).click();
    if (status !== undefined) await statusRadio(page, STATUS_TEXT[status]).click();
    await page.waitForLoadState("networkidle").catch(() => {});
    for (const [id, v] of Object.entries(texts)) if (v !== undefined) await expect(field(page, id)).toHaveValue(v, { timeout: 1500 });
    if (isSweep !== undefined) await expect(switchEl(page)).toHaveAttribute("aria-checked", String(!!isSweep), { timeout: 1500 });
    if (status !== undefined) await expect(statusRadio(page, STATUS_TEXT[status]).locator("input")).toBeChecked({ timeout: 1500 });
  }).toPass({ timeout: 20000 });
}

// Đóng hộp thoại bằng Cancel
async function cancelDialog(page) {
  await cancelBtn(page).click();
  await expect(dialog(page)).toBeHidden();
}

// Điền hợp lệ nhưng chưa Save (mặc định: code mới chưa tồn tại)
const validCreate = (over = {}) => ({
  name: "QA-UI-FAKE",
  code: qaCode(),
  maxPayout: "123.5",
  exchangeRate: "2.5",
  ...over,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Administration > Currency", () => {
  let writes;
  let allowedWrites; // request ghi được phép (chỉ các test dùng response giả; request KHÔNG tới server thật)

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, số dòng/trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__admin_currency_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/admin_currency_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__admin_currency_spec_cleared", "1");
    });
    writes = watchWrites(page);
    allowedWrites = [];
  });

  // ===== NHÓM CHỈ ĐỌC (không ghi dữ liệu thật) =====
  test.describe("Chỉ đọc (không ghi dữ liệu thật)", () => {
    test.beforeEach(async ({ page }) => {
      await blockWrites(page);
      await openPage(page);
    });

    // Mọi test không được gửi request ghi nào ngoài danh sách được phép (và request được phép cũng không tới server thật)
    test.afterEach(async () => {
      expect(writes, "Request ghi dữ liệu bắt được phải đúng danh sách được phép").toEqual(allowedWrites);
    });

    // ===== 1. Hiển thị màn hình =====
    test.describe("Hiển thị mặc định", () => {
      test("Có tiêu đề 'Currency'", async ({ page }) => {
        await expect(breadcrumb(page)).toHaveText("Currency");
      });

      test("Có đủ 4 filter Code, Name, Sweep Stake, Status và 2 nút Search/Reset", async ({ page }) => {
        await expect(page.locator(".NextGen-filter-element")).toHaveCount(FILTERS.length);
        for (const [id, label] of FILTERS) await expect(filterEl(page, id), id).toContainText(label);
        await expect(searchBtn(page)).toBeVisible();
        await expect(resetBtn(page)).toBeVisible();
      });

      test("Code / Name là ô nhập chữ; Sweep Stake và Status là dropdown chọn 1 giá trị (có nút xoá)", async ({ page }) => {
        for (const id of ["code", "name"]) {
          await expect(filterEl(page, id).locator("input"), id).toHaveCount(1);
          await expect(filterEl(page, id).locator(".ant-select"), id).toHaveCount(0);
        }
        for (const id of ["isSweep", "status"]) {
          await expect(filterEl(page, id).locator(".ant-select"), id).toHaveCount(1);
          await expect(filterEl(page, id).locator(".ant-select-multiple"), id).toHaveCount(0);
          await expect(filterEl(page, id).locator(".ant-select-allow-clear"), id).toHaveCount(1);
        }
      });

      test("Giá trị filter mặc định: để trống", async ({ page }) => {
        for (const id of ["code", "name"]) await expect(filterEl(page, id).locator("input")).toHaveValue("");
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
      });

      test("Có nút Add New, Export, Manage Columns và 2 nút thao tác hàng loạt", async ({ page }) => {
        await expect(addBtn(page)).toBeVisible();
        await expect(exportBtn(page)).toBeVisible();
        await expect(columnBtn(page)).toBeVisible();
        await expect(bulkBtns(page)).toHaveCount(2);
      });

      test(`Bảng có đủ ${COLUMNS.length} cột (+ cột checkbox) đúng thứ tự`, async ({ page }) => {
        expect(await headers(page)).toEqual(HEADERS);
      });

      test("Mặc định: trang 1, 10 dòng, sort id giảm dần, filters chỉ có sasEntityId = [1]", async ({ page }) => {
        const { body, status, json } = await search(page);
        expect(status).toBe(200);
        expect(body).toEqual(DEFAULT_BODY);
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
      test("Mỗi dòng khớp response API (ID, Code, Name, Max Payout, Sweepstake, Exchange Rate, Status)", async ({ page }) => {
        const { json } = await search(page);
        const list = json.data.list;
        test.skip(list.length === 0, "Không có dữ liệu");
        await expect(rows(page)).toHaveCount(list.length);
        const matrix = await tableMatrix(page);
        for (const [i, x] of list.entries()) {
          const at = `dòng ${i + 1} (currency ${x.id})`;
          const c = matrix[i].cells;
          expect(c[COL.id], at).toBe(String(x.id));
          expect(c[COL.code], at).toBe(norm(x.code));
          expect(c[COL.name], at).toBe(norm(x.name));
          expect(near(c[COL.maxPayout], x.maxPayout), `${at}: Max Payout ${c[COL.maxPayout]} vs ${x.maxPayout}`).toBe(true);
          expect(c[COL.sweep], at).toBe(SWEEP_TEXT[x.isSweep]);
          expect(near(c[COL.rate], x.exchangeRate), `${at}: Exchange Rate ${c[COL.rate]} vs ${x.exchangeRate}`).toBe(true);
          expect(c[COL.status], at).toBe(STATUS_TEXT[x.status]);
        }
      });

      test("Mặc định sắp xếp ID giảm dần và ID không trùng nhau", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length < 2, "Không đủ dữ liệu");
        const ids = json.data.list.map((x) => x.id);
        expect(ids).toEqual([...ids].sort((a, b) => b - a));
        expect(new Set(ids).size).toBe(ids.length);
      });

      test("Ràng buộc dữ liệu (200 dòng đầu): Code là chữ HOA A-Z không trùng, Name không trống, Max Payout / Exchange Rate >= 0, Sweep / Status là 0 hoặc 1", async ({ page }) => {
        await pageSizeSelect(page).click();
        const { json } = await reloadFull(page, () => openOptions(page).filter({ hasText: "200 / page" }).click());
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const codes = json.data.list.map((x) => x.code);
        expect(new Set(codes).size, "Code không được trùng nhau").toBe(codes.length);
        for (const x of json.data.list) {
          const at = `currency ${x.id}`;
          expect(x.code, `code của ${at}`).toMatch(/^[A-Z]{3,50}$/);
          expect(norm(x.name), `name của ${at}`).not.toBe("");
          // Dữ liệu có sẵn có nhiều currency Max Payout = 0 / Exchange Rate = 0 (form Add / Update lại từ chối 0: "greater than 0") -> chỉ kiểm tra >= 0, ghi ở report.md
          expect(x.maxPayout, `maxPayout của ${at}`).toBeGreaterThanOrEqual(0);
          expect(x.exchangeRate, `exchangeRate của ${at}`).toBeGreaterThanOrEqual(0);
          expect([0, 1], `isSweep của ${at}`).toContain(x.isSweep);
          expect([0, 1], `status của ${at}`).toContain(x.status);
        }
      });

      test("Status hiển thị dạng tag: Active (xanh) / Inactive (đỏ)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const matrix = await tableMatrix(page);
        for (const [i, x] of json.data.list.entries()) {
          expect(matrix[i].statusClass, `dòng ${i + 1}`).toMatch(x.status === 1 ? /tag-success/ : /tag-error/);
        }
      });

      test("Mỗi dòng có 3 icon hành động (History, Update, bật / tắt); icon trạng thái đúng với Status (toggle-off khi Active, toggle-on khi Inactive)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        for (const [i, x] of json.data.list.entries()) {
          await expect(rowAt(page, i).locator(".column-actions svg"), `dòng ${i + 1}`).toHaveCount(3);
          await expect(actionIcon(rowAt(page, i), ICON.history), `dòng ${i + 1}`).toHaveAttribute("data-icon", "eye");
          await expect(actionIcon(rowAt(page, i), ICON.update), `dòng ${i + 1}`).toHaveAttribute("data-icon", "pen-to-square");
          await expect(actionIcon(rowAt(page, i), ICON.toggle), `dòng ${i + 1}`).toHaveAttribute("data-icon", x.status === 1 ? "toggle-off" : "toggle-on");
        }
      });

      test("Tooltip các icon: History, Update, Deactivate / Activate (theo Status)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const row = rowAt(page, 0);
        await hoverTip(page, actionIcon(row, ICON.history), "History");
        await hoverTip(page, actionIcon(row, ICON.update), "Update");
        await hoverTip(page, actionIcon(row, ICON.toggle), json.data.list[0].status === 1 ? "Deactivate" : "Activate");
      });

      test("Tooltip của Export ('Download as CSV') và Manage Columns", async ({ page }) => {
        await hoverTip(page, exportBtn(page), "Download as CSV");
        await hoverTip(page, columnBtn(page), "Manage Columns");
      });
    });

    // ===== 3. Search / Filter =====
    test.describe("Search / Filter", () => {
      // Lấy 1 currency có sẵn làm mẫu (dòng đầu danh sách)
      const sample = async (page) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        return json.data.list[0];
      };

      test("Dropdown Sweep Stake có 2 giá trị No, Yes", async ({ page }) => {
        await openDropdown(page, "isSweep");
        await expect(openOptions(page)).toHaveText(["No", "Yes"]);
        await breadcrumb(page).click();
        await expect(openOptions(page)).toHaveCount(0);
      });

      test("Dropdown Status có 2 giá trị Active, Inactive", async ({ page }) => {
        await openDropdown(page, "status");
        await expect(openOptions(page)).toHaveText(["Active", "Inactive"]);
        await breadcrumb(page).click();
        await expect(openOptions(page)).toHaveCount(0);
      });

      test("Search không chọn gì: gửi filters mặc định và trả về cùng tổng bản ghi", async ({ page }) => {
        const first = await search(page);
        const second = await search(page);
        expect(second.body).toEqual(DEFAULT_BODY);
        expect(second.json.data.totalCount).toBe(first.json.data.totalCount);
      });

      test("Gõ Code: gửi filters.code và mọi dòng có Code chứa chuỗi đó", async ({ page }) => {
        const x = await sample(page);
        const term = x.code.slice(0, 3);
        await typeFilter(page, "code", term);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ code: term, sasEntityId: [1] });
        expect(json.data.list.map((r) => r.id)).toContain(x.id);
        for (const r of json.data.list) expect(r.code.toLowerCase(), `currency ${r.id}`).toContain(term.toLowerCase());
        expect(await columnValues(page, "Code")).toEqual(json.data.list.map((r) => norm(r.code)));
      });

      test("Code không phân biệt hoa thường: gõ chữ thường vẫn tìm ra currency", async ({ page }) => {
        const x = await sample(page);
        const term = x.code.toLowerCase();
        await typeFilter(page, "code", term);
        const { body, json } = await search(page);
        expect(body.filters.code).toBe(term);
        expect(json.data.list.map((r) => r.id)).toContain(x.id);
      });

      test("Gõ Name: gửi filters.name và mọi dòng có Name chứa chuỗi đó", async ({ page }) => {
        const x = await sample(page);
        const term = norm(x.name).slice(0, 3);
        await typeFilter(page, "name", term);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ name: term, sasEntityId: [1] });
        expect(json.data.list.map((r) => r.id)).toContain(x.id);
        for (const r of json.data.list) expect(r.name.toLowerCase(), `currency ${r.id}`).toContain(term.toLowerCase());
        expect(await columnValues(page, "Name")).toEqual(json.data.list.map((r) => norm(r.name)));
      });

      test("Name khớp 1 phần (giữa chuỗi) và không phân biệt hoa thường", async ({ page }) => {
        const { json: base } = await search(page);
        const x = base.data.list.find((r) => norm(r.name).length >= 7);
        test.skip(!x, "Không có currency nào có Name đủ dài");
        const term = norm(x.name).slice(2, 6).toLowerCase();
        await typeFilter(page, "name", term);
        const { body, json } = await search(page);
        expect(body.filters.name).toBe(term);
        expect(json.data.list.map((r) => r.id)).toContain(x.id);
        for (const r of json.data.list) expect(r.name.toLowerCase(), `currency ${r.id}`).toContain(term);
      });

      for (const [text, value] of [["Yes", 1], ["No", 0]]) {
        test(`Chọn Sweep Stake = ${text}: gửi filters.isSweep = ${value} (số) và mọi dòng có Sweepstake = ${text}`, async ({ page }) => {
          await selectOption(page, "isSweep", text);
          const { body, json } = await search(page);
          expect(body.filters).toEqual({ isSweep: value, sasEntityId: [1] });
          expect(json.data.totalCount).toBeGreaterThan(0);
          for (const r of json.data.list) expect(r.isSweep, `currency ${r.id}`).toBe(value);
          expect(await columnValues(page, "Sweepstake")).toEqual(json.data.list.map(() => text));
        });
      }

      for (const [text, value] of [["Active", 1], ["Inactive", 0]]) {
        test(`Chọn Status = ${text}: gửi filters.status = [${value}] (mảng) và mọi dòng là ${text}`, async ({ page }) => {
          await selectOption(page, "status", text);
          const { body, json } = await search(page);
          expect(body.filters).toEqual({ status: [value], sasEntityId: [1] });
          expect(json.data.totalCount).toBeGreaterThan(0);
          for (const r of json.data.list) expect(r.status, `currency ${r.id}`).toBe(value);
          expect(await columnValues(page, "Status")).toEqual(json.data.list.map(() => text));
        });
      }

      test("Tổng số bản ghi Active + Inactive = tổng khi không lọc; Sweep Yes + No = tổng", async ({ page }) => {
        const all = await search(page);
        await selectOption(page, "status", "Active");
        const a = await search(page);
        await selectOption(page, "status", "Inactive");
        const i = await search(page);
        expect(a.json.data.totalCount + i.json.data.totalCount).toBe(all.json.data.totalCount);
        await resetBodies(page);
        await selectOption(page, "isSweep", "Yes");
        const y = await search(page);
        await selectOption(page, "isSweep", "No");
        const n = await search(page);
        expect(y.json.data.totalCount + n.json.data.totalCount).toBe(all.json.data.totalCount);
      });

      test("Xoá Status bằng nút (x): filters không còn key status và bảng về đủ bản ghi", async ({ page }) => {
        const all = await search(page);
        await selectOption(page, "status", "Inactive");
        await search(page);
        await filterEl(page, "status").hover();
        await filterEl(page, "status").locator(".ant-select-clear").click({ force: true });
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ sasEntityId: [1] });
        expect(json.data.totalCount).toBe(all.json.data.totalCount);
      });

      test("Kết hợp Code + Status + Sweep Stake (AND): request mang đủ 3 filter, mọi dòng thoả cả 3", async ({ page }) => {
        const x = await sample(page);
        const term = x.code.slice(0, 2);
        await typeFilter(page, "code", term);
        await selectOption(page, "status", STATUS_TEXT[x.status]);
        await selectOption(page, "isSweep", SWEEP_TEXT[x.isSweep]);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ code: term, status: [x.status], isSweep: x.isSweep, sasEntityId: [1] });
        expect(json.data.list.map((r) => r.id)).toContain(x.id);
        for (const r of json.data.list) {
          expect(r.code.toLowerCase(), `currency ${r.id}`).toContain(term.toLowerCase());
          expect(r.status, `currency ${r.id}`).toBe(x.status);
          expect(r.isSweep, `currency ${r.id}`).toBe(x.isSweep);
        }
      });

      test("Kết hợp Code + Name (AND): kết quả là giao của 2 filter", async ({ page }) => {
        const x = await sample(page);
        const code = x.code.slice(0, 2);
        const name = norm(x.name).slice(0, 2);
        await typeFilter(page, "code", code);
        await typeFilter(page, "name", name);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ code, name, sasEntityId: [1] });
        expect(json.data.list.map((r) => r.id)).toContain(x.id);
        for (const r of json.data.list) {
          expect(r.code.toLowerCase(), `currency ${r.id}`).toContain(code.toLowerCase());
          expect(r.name.toLowerCase(), `currency ${r.id}`).toContain(name.toLowerCase());
        }
      });

      test("Filter không có kết quả: hiện 'There are no entries found' và không có dòng nào", async ({ page }) => {
        await typeFilter(page, "code", `ZZ-NO-SUCH-${Date.now()}`);
        const { json } = await search(page);
        expect(json.data.totalCount).toBe(0);
        expect(json.data.list).toEqual([]);
        await expect(page.getByText(MSG.noEntries)).toBeVisible();
        await expect(rows(page)).toHaveCount(0);
      });

      test("Search khi đang ở trang 2 thì quay về trang 1", async ({ page }) => {
        test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
        await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        await selectOption(page, "status", "Active");
        const { body } = await search(page);
        expect(body).toMatchObject({ page: 1, filters: { status: [1] } });
      });
    });

    // ===== 4. Reset =====
    test.describe("Reset", () => {
      test("Reset xoá mọi filter đã nhập / chọn và gửi lại request mặc định", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await typeFilter(page, "code", x.code.slice(0, 2));
        await typeFilter(page, "name", norm(x.name).slice(0, 2));
        await selectOption(page, "isSweep", SWEEP_TEXT[x.isSweep]);
        await selectOption(page, "status", STATUS_TEXT[x.status]);
        await search(page);

        const bodies = await resetBodies(page);
        expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual(DEFAULT_BODY);
        for (const id of ["code", "name"]) await expect(filterEl(page, id).locator("input")).toHaveValue("");
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
        await expect(summary(page)).toHaveText(new RegExp(`of ${json.data.totalCount} records$`));
        await expect(rows(page)).toHaveCount(Math.min(10, json.data.totalCount));
      });

      test("Reset đưa sort về mặc định (id giảm dần) và gửi lại request mặc định", async ({ page }) => {
        await search(page);
        await reloadBy(page, () => th(page, "Name").click());
        const body = await reloadBy(page, () => resetBtn(page).click());
        expect(body).toEqual(DEFAULT_BODY);
      });

      // HÀNH VI ĐÚNG (đã được user xác nhận): bấm Reset khi đang ở trang 2 thì filter bị xoá nhưng giữ nguyên trang đang xem (request list gửi page=2).
      test("Reset khi đang ở trang 2 (có filter): xoá filter nhưng giữ nguyên trang 2", async ({ page }) => {
        test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
        await selectOption(page, "status", "Active");
        const { json } = await search(page);
        test.skip(json.data.totalCount <= 10, "Filter Status = Active chỉ có 1 trang");
        await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        const bodies = await resetBodies(page);
        expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual({ ...DEFAULT_BODY, page: 2 });
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
      });
    });

    // ===== 5. Phân trang =====
    test.describe("Phân trang", () => {
      test("Ít bản ghi (1 trang): chỉ có trang 1, Previous / Next đều bị khoá", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total > 10, "Có nhiều hơn 1 trang");
        await expect(page.locator(".ant-pagination-item")).toHaveCount(1);
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
        await expect(page.locator(".ant-pagination-prev")).toHaveClass(/ant-pagination-disabled/);
        await expect(page.locator(".ant-pagination-next")).toHaveClass(/ant-pagination-disabled/);
      });

      test("Trang 2 gọi API page=2 và dòng tóm tắt đúng (khi có > 10 bản ghi)", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 10, "Chỉ có 1 trang");
        const { body, json } = await reloadFull(page, () => page.locator(".ant-pagination-item-2").click());
        expect(body).toMatchObject({ page: 2, pageSize: 10 });
        await expect(summary(page)).toHaveText(`Showing 11 - ${Math.min(20, total)} of ${total} records`);
        await expect(rows(page)).toHaveCount(json.data.list.length);
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
      });

      test("Next / Previous chuyển trang 1 <-> 2 và trang 2 không trùng dòng nào của trang 1", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 10, "Chỉ có 1 trang");
        const p1 = await columnValues(page, "ID");
        const next = await reloadFull(page, () => page.locator(".ant-pagination-next").click());
        expect(next.body).toMatchObject({ page: 2 });
        const p2 = await columnValues(page, "ID");
        expect(p2.filter((id) => p1.includes(id))).toEqual([]);
        const prev = await reloadBy(page, () => page.locator(".ant-pagination-prev button").click());
        expect(prev).toMatchObject({ page: 1 });
        expect(await columnValues(page, "ID")).toEqual(p1);
      });

      test("Trang 2 vẫn sort id giảm dần liên tục so với trang 1", async ({ page }) => {
        test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
        const p1 = (await columnValues(page, "ID")).map(Number);
        await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        const p2 = (await columnValues(page, "ID")).map(Number);
        expect(p2).toEqual([...p2].sort((a, b) => b - a));
        expect(Math.max(...p2)).toBeLessThan(Math.min(...p1));
      });

      test("Trang cuối: gửi đúng số trang, dòng tóm tắt 'Showing x - N of N' và số dòng còn lại", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 10, "Chỉ có 1 trang");
        const last = Math.ceil(total / 10);
        // Các trang ở giữa bị rút gọn bằng "•••" nhưng trang cuối luôn có nút
        const { body, json } = await reloadFull(page, () => page.locator(`.ant-pagination-item-${last}`).click());
        expect(body).toMatchObject({ page: last, pageSize: 10 });
        const shown = total - (last - 1) * 10;
        expect(json.data.list).toHaveLength(shown);
        await expect(rows(page)).toHaveCount(shown);
        await expect(summary(page)).toHaveText(`Showing ${(last - 1) * 10 + 1} - ${total} of ${total} records`);
        await expect(page.locator(".ant-pagination-next")).toHaveClass(/ant-pagination-disabled/);
      });

      test("Dropdown số dòng / trang có đủ 10/20/50/100/200", async ({ page }) => {
        await pageSizeSelect(page).click();
        await expect(openOptions(page)).toHaveText(PAGE_SIZES);
        await page.keyboard.press("Escape");
      });

      for (const size of [20, 50, 100, 200]) {
        test(`Đổi sang ${size} dòng / trang gửi pageSize=${size} và hiển thị đúng số dòng`, async ({ page }) => {
          const total = await totalOf(page);
          await pageSizeSelect(page).click();
          const { body, json } = await reloadFull(page, () => openOptions(page).filter({ hasText: `${size} / page` }).click());
          expect(body).toMatchObject({ page: 1, pageSize: size });
          const shown = Math.min(size, total);
          expect(json.data.list).toHaveLength(shown);
          await expect(rows(page)).toHaveCount(shown);
          await expect(pageSizeSelect(page)).toContainText(`${size} / page`);
          if (shown > 0) await expect(summary(page)).toHaveText(`Showing 1 - ${shown} of ${total} records`);
        });
      }

      test("Giữ filter đang chọn khi chuyển trang / đổi số dòng", async ({ page }) => {
        await selectOption(page, "status", "Active");
        const { json } = await search(page);
        test.skip(json.data.totalCount <= 10, "Filter Status = Active chỉ có 1 trang");
        const next = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        expect(next).toMatchObject({ page: 2, filters: { status: [1] } });
        await pageSizeSelect(page).click();
        const body = await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
        expect(body).toMatchObject({ pageSize: 20, filters: { status: [1] } });
      });

      test("Giữ sort khi chuyển trang", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 10, "Chỉ có 1 trang");
        await reloadBy(page, () => th(page, "Name").click());
        const body = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        expect(body).toMatchObject({ page: 2, sortBy: "name", sortDirection: "asc" });
      });
    });

    // ===== 6. Sắp xếp =====
    test.describe("Sắp xếp", () => {
      // Cột ID là sort mặc định (id desc): click 1 = bỏ sort (KHÔNG gọi API), click 2 = asc, click 3 = desc
      test('Sort cột "ID": click 1 không gọi API, click 2 = asc, click 3 = desc', async ({ page }) => {
        await search(page);
        let calls = 0;
        const onRequest = (r) => {
          if (isList(r)) calls++;
        };
        page.on("request", onRequest);
        await th(page, "ID").click();
        await settle(page);
        page.off("request", onRequest);
        expect(calls, "Click đầu tiên vào cột ID (đang sort mặc định) không được gọi API").toBe(0);
        await expect(th(page, "ID")).not.toHaveClass(/ant-table-column-sort/);

        const b2 = await reloadBy(page, () => th(page, "ID").click());
        expect(b2).toMatchObject({ sortBy: "id", sortDirection: "asc", page: 1, pageSize: 10 });
        const b3 = await reloadBy(page, () => th(page, "ID").click());
        expect(b3).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      });

      test('Sort cột "ID" tăng dần: ID trong bảng tăng dần theo response; giảm dần: giảm dần', async ({ page }) => {
        const { json: base } = await search(page);
        test.skip(base.data.list.length < 2, "Không đủ dữ liệu");
        await th(page, "ID").click(); // bỏ sort mặc định (không gọi API)
        await settle(page);
        const up = await reloadFull(page, () => th(page, "ID").click());
        const idsUp = up.json.data.list.map((x) => x.id);
        expect(idsUp).toEqual([...idsUp].sort(asc));
        expect((await columnValues(page, "ID")).map(Number)).toEqual(idsUp);
        const down = await reloadFull(page, () => th(page, "ID").click());
        const idsDown = down.json.data.list.map((x) => x.id);
        expect(idsDown).toEqual([...idsDown].sort((a, b) => b - a));
        expect((await columnValues(page, "ID")).map(Number)).toEqual(idsDown);
      });

      for (const [name, key] of Object.entries(SORTABLE).filter(([n]) => n !== "ID")) {
        test(`Sort cột "${name}": asc -> desc -> về mặc định (id desc)`, async ({ page }) => {
          await search(page);
          const b1 = await reloadBy(page, () => th(page, name).click());
          expect(b1).toMatchObject({ sortBy: key, sortDirection: "asc", page: 1, pageSize: 10 });
          const b2 = await reloadBy(page, () => th(page, name).click());
          expect(b2).toMatchObject({ sortBy: key, sortDirection: "desc" });
          const b3 = await reloadBy(page, () => th(page, name).click());
          expect(b3).toMatchObject({ sortBy: "id", sortDirection: "desc" });
        });

        test(`Sort cột "${name}": bảng hiển thị đúng thứ tự response (asc)`, async ({ page }) => {
          await search(page);
          const { json } = await reloadFull(page, () => th(page, name).click());
          test.skip(json.data.list.length === 0, "Không có dữ liệu");
          // Thứ tự chữ phụ thuộc collation của server nên chỉ kiểm tra bảng hiển thị đúng thứ tự response
          const shown = await columnValues(page, name);
          expect(shown).toEqual(json.data.list.map((x) => (key === "status" ? STATUS_TEXT[x.status] : norm(x[key]))));
        });
      }

      test('Sort cột "Status": asc thì Inactive (0) đứng trước, desc thì Active (1) đứng trước', async ({ page }) => {
        await search(page);
        const up = await reloadFull(page, () => th(page, "Status").click());
        const s1 = up.json.data.list.map((x) => x.status);
        expect(s1).toEqual([...s1].sort(asc));
        const down = await reloadFull(page, () => th(page, "Status").click());
        const s2 = down.json.data.list.map((x) => x.status);
        expect(s2).toEqual([...s2].sort((a, b) => b - a));
        expect(s1[0], "asc: trang đầu bắt đầu từ Status nhỏ nhất").toBeLessThanOrEqual(s2[0]);
      });

      test("Giữ sort khi tìm kiếm với filter (Search không làm mất sort)", async ({ page }) => {
        await search(page);
        await reloadBy(page, () => th(page, "Code").click());
        await selectOption(page, "status", "Active");
        const { body } = await search(page);
        expect(body).toMatchObject({ sortBy: "code", sortDirection: "asc", filters: { status: [1] } });
      });

      test("4 cột ID, Code, Name, Status sort được; Max Payout, Sweepstake, Exchange Rate, Action không sort", async ({ page }) => {
        for (const c of COLUMNS) {
          if (c in SORTABLE) await expect(th(page, c), c).toHaveClass(/ant-table-column-has-sorters/);
          else await expect(th(page, c), c).not.toHaveClass(/ant-table-column-has-sorters/);
        }
      });
    });

    // ===== 7. Thao tác hàng loạt =====
    test.describe("Thao tác hàng loạt (Cancel, hoặc xác nhận bằng response GIẢ)", () => {
      // Bulk Activate (currency/deactivate status 1) và Bulk Deactivate (status 0)
      const BULK = [
        { i: 0, tip: "Bulk Activate", btn: "Activate", status: 1, verb: "activate" },
        { i: 1, tip: "Bulk Deactivate", btn: "Deactivate", status: 0, verb: "deactivate" },
      ];

      test("Chưa chọn dòng nào thì 2 nút thao tác hàng loạt bị vô hiệu", async ({ page }) => {
        for (let i = 0; i < 2; i++) await expect(bulkBtns(page).nth(i)).toBeDisabled();
      });

      test("Chọn 1 dòng thì 2 nút được bật, bỏ chọn thì tắt lại", async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        await checkboxOf(page, 0).check();
        for (let i = 0; i < 2; i++) await expect(bulkBtns(page).nth(i)).toBeEnabled();
        await checkboxOf(page, 0).uncheck();
        for (let i = 0; i < 2; i++) await expect(bulkBtns(page).nth(i)).toBeDisabled();
      });

      test("Checkbox ở tiêu đề chọn / bỏ chọn tất cả dòng", async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        const all = page.getByRole("checkbox", { name: "Select all" });
        await all.check();
        const n = await rows(page).count();
        await expect(page.locator('tbody tr.ant-table-row input[type="checkbox"]:checked')).toHaveCount(n);
        await all.uncheck();
        await expect(page.locator('tbody tr.ant-table-row input[type="checkbox"]:checked')).toHaveCount(0);
      });

      test("Tooltip của 2 nút thao tác hàng loạt", async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        await checkboxOf(page, 0).check();
        for (const b of BULK) await hoverTip(page, bulkBtns(page).nth(b.i), b.tip);
      });

      for (const b of BULK) {
        test(`${b.tip} 1 currency: hộp thoại '${b.btn} <tên> currency' + câu hỏi xác nhận đúng hành động, đóng bằng Cancel`, async ({ page }) => {
          const { json } = await search(page);
          test.skip(json.data.list.length === 0, "Không có dữ liệu");
          await checkboxOf(page, 0).check();
          await bulkBtns(page).nth(b.i).click();
          await expect(dialog(page)).toBeVisible();
          await expect(dialog(page)).toContainText(`${b.btn} ${norm(json.data.list[0].name)} currency`);
          await expect(dialog(page)).toContainText(`Are you sure you want to ${b.verb} this currency?`);
          await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
          await expect(dialog(page).getByRole("button", { name: new RegExp(`${b.btn}$`) })).toBeVisible();
          await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
          await expect(dialog(page)).toBeHidden();
          await expect(checkboxOf(page, 0)).toBeChecked(); // dòng vẫn đang được chọn
        });

        // Quan sát: câu hỏi khi chọn NHIỀU dòng kết thúc không có dấu "?" ("...these 2 currencies"), còn 1 dòng thì có ("...this currency?") -> ghi ở report.md
        test(`${b.tip} nhiều currency: hộp thoại ghi rõ số lượng ('${b.btn} 2 currencies') và câu hỏi đúng hành động, đóng bằng Cancel`, async ({ page }) => {
          test.skip((await rows(page).count()) < 2, "Cần ít nhất 2 currency");
          await checkboxOf(page, 0).check();
          await checkboxOf(page, 1).check();
          await bulkBtns(page).nth(b.i).click();
          await expect(dialog(page)).toContainText(`${b.btn} 2 currencies`);
          await expect(dialog(page)).toContainText(`Are you sure you want to ${b.verb} these 2 currencies`);
          await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
          await expect(dialog(page)).toBeHidden();
        });

        test(`${b.btn} hàng loạt 2 currency (xác nhận, response GIẢ): gửi currency/deactivate {ids,status:${b.status}}, có toast, tải lại danh sách`, async ({ page }) => {
          const { json } = await search(page);
          test.skip(json.data.list.length < 2, "Cần ít nhất 2 currency");
          await mockWrites(page, MOCK_OK);
          const ids = json.data.list.slice(0, 2).map((x) => x.id);
          await checkboxOf(page, 0).check();
          await checkboxOf(page, 1).check();
          await bulkBtns(page).nth(b.i).click();
          const [req] = await Promise.all([
            page.waitForRequest(isDeactivate),
            page.waitForRequest(isList),
            dialog(page).getByRole("button", { name: new RegExp(`${b.btn}$`) }).click(),
          ]);
          expect(bodyOf(req)).toEqual({ ids, status: b.status });
          allowedWrites.push({ url: "currency/deactivate", body: { ids, status: b.status } });
          await expect(toasts(page).filter({ hasText: "Success" })).toBeVisible();
          await expect(dialog(page)).toBeHidden();
        });
      }

      test("Backend báo lỗi khi Bulk Deactivate (response GIẢ): hiện toast lỗi, không có toast thành công", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await mockWrites(page, MOCK_FAIL);
        await checkboxOf(page, 0).check();
        await bulkBtns(page).nth(1).click();
        await Promise.all([page.waitForRequest(isDeactivate), dialog(page).getByRole("button", { name: /Deactivate$/ }).click()]);
        allowedWrites.push({ url: "currency/deactivate", body: { ids: [json.data.list[0].id], status: 0 } });
        await expect(toasts(page).filter({ hasText: "Error" })).toBeVisible();
        await expect(toasts(page).filter({ hasText: /Success/ })).toHaveCount(0);
      });
    });

    // ===== 8. Icon trên từng dòng: bật / tắt trạng thái =====
    test.describe("Icon bật / tắt trạng thái từng dòng (Cancel hoặc response GIẢ)", () => {
      test("Hộp thoại xác nhận đúng tiêu đề '<Activate|Deactivate> <tên>' + câu hỏi + nút, đóng bằng Cancel", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const action = x.status === 1 ? "Deactivate" : "Activate";
        await actionIcon(rowAt(page, 0), ICON.toggle).click();
        await expect(dialog(page)).toContainText(`${action} ${norm(x.name)}`);
        await expect(dialog(page)).toContainText(`Are you sure you want to ${action.toLowerCase()} this currency?`);
        await expect(dialog(page).getByRole("button", { name: new RegExp(`${action}$`) })).toBeVisible();
        await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
        await expect(dialog(page)).toBeHidden();
      });

      test("Xác nhận (response GIẢ): gửi currency/deactivate {ids:[id], status đảo}, có toast, tải lại danh sách", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await mockWrites(page, MOCK_OK);
        const x = json.data.list[0];
        const action = x.status === 1 ? "Deactivate" : "Activate";
        const status = x.status === 1 ? 0 : 1;
        await actionIcon(rowAt(page, 0), ICON.toggle).click();
        const [req] = await Promise.all([
          page.waitForRequest(isDeactivate),
          page.waitForRequest(isList),
          dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click(),
        ]);
        expect(bodyOf(req)).toEqual({ ids: [x.id], status });
        allowedWrites.push({ url: "currency/deactivate", body: { ids: [x.id], status } });
        await expect(toasts(page).filter({ hasText: "Success" })).toBeVisible();
        await expect(dialog(page)).toBeHidden();
      });

      test("Dòng ở trạng thái còn lại (Inactive <-> Active) cũng gửi đúng status đảo (response GIẢ)", async ({ page }) => {
        const first = await search(page);
        const wanted = first.json.data.list[0]?.status === 1 ? 0 : 1;
        await selectOption(page, "status", STATUS_TEXT[wanted]);
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, `Không có currency ${STATUS_TEXT[wanted]}`);
        await mockWrites(page, MOCK_OK);
        const x = json.data.list[0];
        const action = x.status === 1 ? "Deactivate" : "Activate";
        const status = x.status === 1 ? 0 : 1;
        await actionIcon(rowAt(page, 0), ICON.toggle).click();
        const [req] = await Promise.all([
          page.waitForRequest(isDeactivate),
          dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click(),
        ]);
        expect(bodyOf(req)).toEqual({ ids: [x.id], status });
        allowedWrites.push({ url: "currency/deactivate", body: { ids: [x.id], status } });
      });

      // Quan sát: khi server báo lỗi thì hộp thoại xác nhận của từng dòng vẫn mở (hộp thoại Bulk thì cũng chỉ đóng khi thành công)
      test("Backend báo lỗi (response GIẢ): hiện toast lỗi, không có toast thành công", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await mockWrites(page, MOCK_FAIL);
        const x = json.data.list[0];
        const action = x.status === 1 ? "Deactivate" : "Activate";
        const status = x.status === 1 ? 0 : 1;
        await actionIcon(rowAt(page, 0), ICON.toggle).click();
        await Promise.all([page.waitForRequest(isDeactivate), dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click()]);
        allowedWrites.push({ url: "currency/deactivate", body: { ids: [x.id], status } });
        await expect(toasts(page).filter({ hasText: "Error" })).toBeVisible();
        await expect(toasts(page).filter({ hasText: /Success/ })).toHaveCount(0);
        await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
      });
    });

    // ===== 9. History =====
    test.describe("Hộp thoại History (Currency History)", () => {
      test("Icon History mở hộp thoại 'Currency History', gọi currencyrate/history {id,page,pageSize} và hiển thị đúng số dòng lịch sử", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const [req, res] = await Promise.all([
          page.waitForRequest(isHistory),
          page.waitForResponse(isHistory),
          actionIcon(rowAt(page, 0), ICON.history).click(),
        ]);
        expect(bodyOf(req)).toEqual({ id: x.id, page: 1, pageSize: 10 });
        const data = (await res.json()).data;
        await expect(dialog(page)).toContainText("Currency History");
        if (data.totalCount === 0) await expect(dialog(page)).toContainText(MSG.noHistory);
        else await expect(dialog(page).locator("tr, .ant-list-item, .ant-timeline-item").first()).toBeVisible();
      });

      test("Hộp thoại History đóng bằng nút (x)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await openHistory(page, rowAt(page, 0));
        await closeX(page).click();
        await expect(dialog(page)).toBeHidden();
      });

      test("Hiển thị lịch sử (response GIẢ): mỗi dòng có ngày giờ DD-MM-YYYY HH:mm:ss và tỉ giá cũ -> mới, đúng thứ tự response", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const fake = [
          { id: 9001, code: x.code, name: x.name, date: "10-11-2026 09:59:10", exchangeRateOld: 2.5, exchangeRateNew: 3.25 },
          { id: 9000, code: x.code, name: x.name, date: "09-11-2026 08:01:02", exchangeRateOld: 1, exchangeRateNew: 2.5 },
        ];
        await page.route(/currencyrate\/history/, (route) =>
          fulfillJson(route, { status: "success", messageCode: "SUCCESS", message: "SUCCESS", data: { totalCount: 2, list: fake } }),
        );
        await Promise.all([page.waitForResponse(isHistory), actionIcon(rowAt(page, 0), ICON.history).click()]);
        await expect(dialog(page)).toContainText("10-11-2026 09:59:10");
        const text = norm(await dialog(page).innerText());
        expect(text).toContain("10-11-2026 09:59:10");
        expect(text).toContain("09-11-2026 08:01:02");
        expect(text).toMatch(/2\.5\s+3\.25/);
        expect(text).toMatch(/1\s+2\.5/);
        expect(text.indexOf("10-11-2026 09:59:10")).toBeLessThan(text.indexOf("09-11-2026 08:01:02"));
        expect(text).not.toContain(MSG.noHistory);
      });
    });

    // ===== 10. Hộp thoại Update =====
    test.describe("Hộp thoại Update (không ghi dữ liệu thật)", () => {
      test("Icon Update mở hộp thoại 'Update Currencies', gọi currency/view {id} và điền đúng form", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const [req] = await Promise.all([page.waitForRequest(isView), actionIcon(rowAt(page, 0), ICON.update).click()]);
        expect(bodyOf(req)).toEqual({ id: x.id });
        await expect(dialog(page)).toContainText("Update Currencies");
        await expect(field(page, "name")).toHaveValue(x.name);
        await expect(field(page, "code")).toHaveValue(x.code);
        expect(Number(await field(page, "maxPayout").inputValue())).toBe(Number(x.maxPayout));
        expect(Number(await field(page, "exchangeRate").inputValue())).toBe(Number(x.exchangeRate));
        await expect(switchEl(page)).toHaveAttribute("aria-checked", String(x.isSweep === 1));
        await expect(statusRadio(page, STATUS_TEXT[x.status]).locator("input")).toBeChecked();
        await expect(dialog(page)).toContainText("Exchange Rate History");
      });

      test("Ô Code bị khoá (không sửa được), các ô còn lại sửa được", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await openUpdate(page, rowAt(page, 0));
        await expect(field(page, "code")).toBeDisabled();
        for (const id of ["name", "maxPayout", "exchangeRate"]) await expect(field(page, id), id).toBeEnabled();
      });

      test("Hộp thoại có đủ nhãn Name, Code, Max Payout, Exchange Rate, Sweep Stake, Status (Active / Inactive) và nút Cancel / Save", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await openUpdate(page, rowAt(page, 0));
        for (const t of ["Name", "Code", "Max Payout", "Exchange Rate", "Sweep Stake", "Status", "Active", "Inactive"]) {
          await expect(dialog(page).locator("label").filter({ hasText: exact(t) }), t).toHaveCount(1);
        }
        await expect(saveBtn(page)).toBeVisible();
        await expect(cancelBtn(page)).toBeVisible();
      });

      test("Currency Sweepstake = Yes: switch Sweep Stake đang bật", async ({ page }) => {
        await selectOption(page, "isSweep", "Yes");
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có currency Sweepstake");
        await openUpdate(page, rowAt(page, 0));
        await expect(switchEl(page)).toHaveAttribute("aria-checked", "true");
      });

      test("Currency Inactive: radio Inactive đang chọn", async ({ page }) => {
        await selectOption(page, "status", "Inactive");
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có currency Inactive");
        await openUpdate(page, rowAt(page, 0));
        await expect(statusRadio(page, "Inactive").locator("input")).toBeChecked();
        await expect(statusRadio(page, "Active").locator("input")).not.toBeChecked();
      });

      test("Xoá trống Name / Max Payout / Exchange Rate rồi Save: báo 3 lỗi bắt buộc và KHÔNG gửi request update", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await openUpdate(page, rowAt(page, 0));
        await fillForm(page, { name: "", maxPayout: "", exchangeRate: "" });
        await saveBtn(page).click();
        await expect(formErrors(page)).toHaveText([MSG.name, MSG.maxPayout, MSG.rate]);
        await expect(dialog(page)).toBeVisible();
      });

      for (const [label, value, msg] of [
        ["0", "0", MSG.positive],
        ["số âm", "-5", MSG.number],
        ["chữ", "abc", MSG.number],
      ]) {
        test(`Max Payout = ${label}: báo '${msg}' và KHÔNG gửi request update`, async ({ page }) => {
          const { json } = await search(page);
          test.skip(json.data.list.length === 0, "Không có dữ liệu");
          await openUpdate(page, rowAt(page, 0));
          await fillForm(page, { maxPayout: value });
          await saveBtn(page).click();
          await expect(formErrors(page)).toHaveText([msg]);
        });

        test(`Exchange Rate = ${label}: báo '${msg}' và KHÔNG gửi request update`, async ({ page }) => {
          const { json } = await search(page);
          test.skip(json.data.list.length === 0, "Không có dữ liệu");
          await openUpdate(page, rowAt(page, 0));
          await fillForm(page, { exchangeRate: value });
          await saveBtn(page).click();
          await expect(formErrors(page)).toHaveText([msg]);
        });
      }

      test("Đổi Name / Max Payout / Exchange Rate / Sweep Stake / Status rồi Save: gửi currency/update đủ trường + id, toast Success, đóng hộp thoại (request GIẢ)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await mockWrites(page, MOCK_OK);
        await openUpdate(page, rowAt(page, 0));
        await fillForm(page, { name: "QA-UI-FAKE-UPDATE", maxPayout: "777", exchangeRate: "1.25", isSweep: x.isSweep !== 1, status: x.status === 1 ? 0 : 1 });
        const [req] = await Promise.all([page.waitForRequest(isUpdate), saveBtn(page).click()]);
        const body = { name: "QA-UI-FAKE-UPDATE", maxPayout: "777", exchangeRate: "1.25", isSweep: x.isSweep === 1 ? 0 : 1, status: x.status === 1 ? 0 : 1, id: x.id };
        expect(bodyOf(req)).toEqual(body);
        allowedWrites.push({ url: "currency/update", body });
        await expect(toasts(page).filter({ hasText: "Success" })).toBeVisible();
        await expect(dialog(page)).toBeHidden();
      });

      test("Server báo lỗi khi Save (response GIẢ): toast Error, hộp thoại vẫn mở và dữ liệu đã nhập còn nguyên", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await mockWrites(page, MOCK_FAIL);
        await openUpdate(page, rowAt(page, 0));
        await fillForm(page, { name: "QA-UI-FAKE-ERR", maxPayout: "888", exchangeRate: "3" });
        const [req] = await Promise.all([page.waitForRequest(isUpdate), saveBtn(page).click()]);
        allowedWrites.push({ url: "currency/update", body: bodyOf(req) });
        expect(bodyOf(req).id).toBe(x.id);
        await expect(toasts(page).filter({ hasText: "Error" })).toBeVisible();
        await expect(dialog(page)).toBeVisible();
        await expect(field(page, "name")).toHaveValue("QA-UI-FAKE-ERR");
      });

      test("Cancel / nút (x) đóng hộp thoại Update, không gửi request ghi", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await openUpdate(page, rowAt(page, 0));
        await fillForm(page, { name: "QA-UI-FAKE-CANCEL" });
        await cancelDialog(page);
        await openUpdate(page, rowAt(page, 0));
        await expect(field(page, "name")).toHaveValue(json.data.list[0].name); // thay đổi cũ không được giữ lại
        await closeX(page).click();
        await expect(dialog(page)).toBeHidden();
        await expect(rowAt(page, 0).locator("td").nth(COL.name)).toHaveText(norm(json.data.list[0].name));
      });
    });

    // ===== 11. Hộp thoại Add New =====
    test.describe("Hộp thoại Add New (không ghi dữ liệu thật)", () => {
      test("Add New mở hộp thoại 'Add Currency' với đủ 4 ô trống, Sweep Stake tắt, Status = Active", async ({ page }) => {
        await openCreate(page);
        for (const id of ["name", "code", "maxPayout", "exchangeRate"]) await expect(field(page, id), id).toHaveValue("");
        await expect(field(page, "name")).toHaveAttribute("placeholder", "Enter Currency Name");
        await expect(field(page, "code")).toHaveAttribute("placeholder", "Enter Currency Code");
        await expect(field(page, "maxPayout")).toHaveAttribute("placeholder", "Enter Number");
        await expect(field(page, "exchangeRate")).toHaveAttribute("placeholder", "Enter Number");
        await expect(field(page, "code")).toBeEnabled();
        await expect(switchEl(page)).toHaveAttribute("aria-checked", "false");
        await expect(statusRadio(page, "Active").locator("input")).toBeChecked();
        await expect(statusRadio(page, "Inactive").locator("input")).not.toBeChecked();
        for (const t of ["Name", "Code", "Max Payout", "Exchange Rate", "Sweep Stake", "Status"]) {
          await expect(dialog(page).locator("label").filter({ hasText: exact(t) }), t).toHaveCount(1);
        }
      });

      test("Save form trống: báo đủ 4 lỗi bắt buộc và KHÔNG gửi request create", async ({ page }) => {
        await openCreate(page);
        await saveBtn(page).click();
        await expect(formErrors(page)).toHaveText([MSG.name, MSG.code, MSG.maxPayout, MSG.rate]);
        await expect(dialog(page)).toBeVisible();
      });

      for (const [label, value, msg] of [
        ["0", "0", MSG.positive],
        ["số âm", "-5", MSG.number],
        ["chữ", "abc", MSG.number],
      ]) {
        test(`Max Payout = ${label}: báo '${msg}' và KHÔNG gửi request create`, async ({ page }) => {
          await openCreate(page);
          await fillForm(page, validCreate({ maxPayout: value }));
          await saveBtn(page).click();
          await expect(formErrors(page)).toHaveText([msg]);
        });

        test(`Exchange Rate = ${label}: báo '${msg}' và KHÔNG gửi request create`, async ({ page }) => {
          await openCreate(page);
          await fillForm(page, validCreate({ exchangeRate: value }));
          await saveBtn(page).click();
          await expect(formErrors(page)).toHaveText([msg]);
        });
      }

      test("Code đã tồn tại (lấy từ dòng đầu danh sách): gọi currency/validate/code, báo 'Currency code is already existed' và KHÔNG gửi request create", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await openCreate(page);
        await fillForm(page, validCreate({ code: x.code }));
        const [vreq, vres] = await Promise.all([page.waitForRequest(isValidate), page.waitForResponse(isValidate), saveBtn(page).click()]);
        expect(bodyOf(vreq)).toEqual({ code: x.code });
        expect((await vres.json()).messageCode).toBe("DUPLICATE_CURRENCY_CODE");
        await expect(formErrors(page)).toHaveText([MSG.duplicate]);
        await expect(dialog(page)).toBeVisible();
      });

      // Server trả VALIDATION_FAILED kèm chi tiết ở validation.Code (vd "Code must contain only uppercase letters (A–Z)" / "Code must be between 3 and 50 characters long")
      // nhưng UI chỉ hiện thông báo chung "One or more validation errors occurred." (ghi ở report.md). Test chỉ kiểm tra có lỗi ở ô Code và không tạo.
      for (const [label, code, detail] of [
        ["chữ thường", "abc", /uppercase/],
        ["có chữ số", "AB1", /uppercase/],
        ["có ký tự gạch ngang", "AB-C", /uppercase/],
        ["quá ngắn (2 ký tự)", "AB", /between 3 and 50/],
      ]) {
        test(`Code ${label} ('${code}'): server từ chối ở currency/validate/code, hiện lỗi ở ô Code và KHÔNG gửi request create`, async ({ page }) => {
          await openCreate(page);
          await fillForm(page, validCreate({ code }));
          const [vres] = await Promise.all([page.waitForResponse(isValidate), saveBtn(page).click()]);
          const json = await vres.json();
          expect(json.messageCode).toBe("VALIDATION_FAILED");
          expect(JSON.stringify(json.validation?.Code)).toMatch(detail);
          await expect(formErrors(page)).toHaveCount(1);
          await expect(dialog(page)).toBeVisible();
        });
      }

      test("Code hợp lệ (chữ HOA, chưa tồn tại): validate OK rồi gửi currency/create đúng payload (maxPayout / exchangeRate dạng chuỗi), toast Success, đóng hộp thoại (request GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        await openCreate(page);
        const v = validCreate({ name: "QA-UI-FAKE-A", maxPayout: "1234.5", exchangeRate: "2.5" });
        await fillForm(page, v);
        const [vres, req] = await Promise.all([page.waitForResponse(isValidate), page.waitForRequest(isCreate), saveBtn(page).click()]);
        expect((await vres.json()).status).toBe("success");
        const body = { name: v.name, code: v.code, maxPayout: "1234.5", exchangeRate: "2.5", isSweep: 0, status: 1 };
        expect(bodyOf(req)).toEqual(body);
        allowedWrites.push({ url: "currency/create", body });
        await expect(toasts(page).filter({ hasText: "Success" })).toBeVisible();
        await expect(dialog(page)).toBeHidden();
      });

      test("Bật Sweep Stake + chọn Inactive: payload có isSweep = 1, status = 0 (request GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        await openCreate(page);
        const v = validCreate({ name: "QA-UI-FAKE-B", isSweep: true, status: 0 });
        await fillForm(page, v);
        await expect(switchEl(page)).toHaveAttribute("aria-checked", "true");
        const [req] = await Promise.all([page.waitForRequest(isCreate), saveBtn(page).click()]);
        const body = { name: v.name, code: v.code, maxPayout: "123.5", exchangeRate: "2.5", isSweep: 1, status: 0 };
        expect(bodyOf(req)).toEqual(body);
        allowedWrites.push({ url: "currency/create", body });
      });

      test("Server báo lỗi khi tạo (response GIẢ): toast Error, hộp thoại vẫn mở và dữ liệu đã nhập còn nguyên", async ({ page }) => {
        await mockWrites(page, MOCK_FAIL);
        await openCreate(page);
        const v = validCreate({ name: "QA-UI-FAKE-C" });
        await fillForm(page, v);
        const [req] = await Promise.all([page.waitForRequest(isCreate), saveBtn(page).click()]);
        allowedWrites.push({ url: "currency/create", body: bodyOf(req) });
        await expect(toasts(page).filter({ hasText: "Error" })).toBeVisible();
        await expect(dialog(page)).toBeVisible();
        await expect(field(page, "name")).toHaveValue("QA-UI-FAKE-C");
        await expect(field(page, "code")).toHaveValue(v.code);
      });

      test("Cancel / nút (x) đóng hộp thoại, không gửi request ghi; mở lại thì form trống", async ({ page }) => {
        await openCreate(page);
        await fillForm(page, { name: "QA-UI-FAKE-D", code: "QAUIFAKE" });
        await cancelDialog(page);
        await openCreate(page);
        await expect(field(page, "name")).toHaveValue("");
        await expect(field(page, "code")).toHaveValue("");
        await closeX(page).click();
        await expect(dialog(page)).toBeHidden();
      });
    });

    // ===== 12. Manage Columns =====
    test.describe("Manage Columns", () => {
      // hasText dạng RegExp khớp CHÍNH XÁC tên cột
      const item = (page, name) =>
        columnPopover(page).locator(".NextGen-popover-manage-column__list__items", { hasText: exact(name) });

      test("Popover liệt kê đủ cột (không gồm cột checkbox), tất cả đang được chọn", async ({ page }) => {
        await columnBtn(page).click();
        const names = await columnPopover(page).locator(".NextGen-popover-manage-column__list__items").allInnerTexts();
        expect(names.map((n) => n.trim())).toEqual(COLUMNS);
        await expect(columnPopover(page).locator("input[type=checkbox]:checked")).toHaveCount(COLUMNS.length);
      });

      test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
        await columnBtn(page).click();
        await item(page, "Max Payout").locator("label").click();
        expect(await headers(page)).not.toContain("Max Payout");
        expect(await headers(page)).toHaveLength(HEADERS.length - 1);

        await item(page, "Max Payout").locator("label").click();
        expect(await headers(page)).toEqual(HEADERS);
      });

      test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        const codes = await columnValues(page, "Code");
        const names = await columnValues(page, "Name");
        await columnBtn(page).click();
        await item(page, "Max Payout").locator("label").click();
        expect(await columnValues(page, "Code")).toEqual(codes);
        expect(await columnValues(page, "Name")).toEqual(names);
        expect(await headers(page)).not.toContain("Max Payout");
      });

      test("Cấu hình cột không được lưu: tải lại trang thì hiện đủ cột", async ({ page }) => {
        await columnBtn(page).click();
        await item(page, "Max Payout").locator("label").click();
        expect(await headers(page)).not.toContain("Max Payout");
        await openPage(page); // reload
        expect(await headers(page)).toEqual(HEADERS);
      });
    });

    // ===== 13. Export =====
    test.describe("Export", () => {
      // Bấm Export rồi kiểm tra kết quả. Trả về { body, payload } của request /download.
      // 2 kết quả hợp lệ tuỳ việc file cùng filter đã được export trước đó hay chưa:
      //  - Lần đầu: toast "Download is processing. Please check ID:xxx in download history"
      //  - Đã có file cũ: hộp thoại "already exist in download history ... Download Now / Download New".
      //    KHÔNG bấm Download New (sẽ xoá file cũ trong Download History), chỉ kiểm tra rồi đóng.
      async function exportAndCheck(page) {
        const [req] = await Promise.all([page.waitForRequest(isDownload), exportBtn(page).click()]);
        const body = bodyOf(req);
        const processing = page.getByText(/Download is processing\. Please check ID:\d+ in download history/).first();
        const duplicate = page.getByText(/already exist in download history with id \d+/);
        await expect(processing.or(duplicate)).toBeVisible();
        if (await duplicate.isVisible()) {
          await expect(page.getByRole("button", { name: "Download Now" })).toBeVisible();
          await expect(page.getByRole("button", { name: "Download New" })).toBeVisible();
          await page.keyboard.press("Escape");
        }
        return { body, payload: JSON.parse(body.payload) };
      }

      test("Export tạo job tải xuống (module ADMINISTRATION, section ADMINISTRATION_CURRENCY) gồm toàn bộ cột", async ({ page }) => {
        const { body, payload } = await exportAndCheck(page);
        expect(body.module).toBe("ADMINISTRATION");
        expect(body.section).toBe("ADMINISTRATION_CURRENCY");
        expect(payload.filters.fields).toEqual(COLUMNS);
        expect(payload.filters.sasEntityId).toEqual([1]);
      });

      test("Export đi kèm đúng filter hiện tại (Code, Status, Sweep Stake)", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length === 0, "Không có dữ liệu");
        const x = all.data.list[0];
        await typeFilter(page, "code", x.code.slice(0, 2));
        await selectOption(page, "status", STATUS_TEXT[x.status]);
        await selectOption(page, "isSweep", SWEEP_TEXT[x.isSweep]);
        await search(page);
        const { payload } = await exportAndCheck(page);
        expect(payload.filters).toMatchObject({ code: x.code.slice(0, 2), status: [x.status], isSweep: x.isSweep, sasEntityId: [1] });
      });

      test("Export chỉ chứa các cột đang hiển thị", async ({ page }) => {
        await columnBtn(page).click();
        await columnPopover(page)
          .locator(".NextGen-popover-manage-column__list__items", { hasText: exact("Max Payout") })
          .locator("label")
          .click();
        const [req] = await Promise.all([page.waitForRequest(isDownload), exportBtn(page).click()]);
        const payload = JSON.parse(bodyOf(req).payload);
        expect(payload.filters.fields).not.toContain("Max Payout");
        expect(payload.filters.fields).toContain("Code");
        await page.keyboard.press("Escape");
      });
    });

    // ===== 14. Ghi nhớ filter =====
    test.describe("Ghi nhớ filter", () => {
      test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const term = x.code.slice(0, 2);
        await typeFilter(page, "code", term);
        await selectOption(page, "status", STATUS_TEXT[x.status]);
        await search(page);
        await pageSizeSelect(page).click();
        await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

        const [req] = await Promise.all([page.waitForRequest(isList), openPage(page)]); // reload
        expect(bodyOf(req)).toMatchObject({ pageSize: 20, filters: { code: term, status: [x.status] } });
        await expect(filterEl(page, "code").locator("input")).toHaveValue(term);
        expect(await selectedTitles(page, "status")).toEqual([STATUS_TEXT[x.status]]);
        await expect(pageSizeSelect(page)).toContainText("20 / page");
      });

      test("Sau Reset rồi reload: filter không còn được ghi nhớ", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await selectOption(page, "status", STATUS_TEXT[json.data.list[0].status]);
        await search(page);
        await reloadBy(page, () => resetBtn(page).click());

        await openPage(page); // reload
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
        await expect(rows(page)).toHaveCount(Math.min(10, json.data.totalCount));
      });
    });
  });

  // ===== NHÓM CRUD (GHI DỮ LIỆU THẬT trên currency QA) =====
  test.describe("CRUD (ghi dữ liệu thật trên currency QA, luôn khôi phục lại)", () => {
    test.describe.configure({ mode: "serial" });

    let qa; // { id, code, name, maxPayout, exchangeRate, isSweep, status } - currency QA gốc (code QAUI + 6 chữ HOA, name QA-UI-CURRENCY <code>)

    // Lọc danh sách CHỈ theo Code của currency QA rồi Search. Trả về { body, json }.
    // Filter được app ghi nhớ sau reload (vd Sweep Stake / Status / Name do test trước chọn) có thể loại currency QA khỏi danh sách -> xoá các filter khác trước.
    async function filterQa(page, code = QA_CODE_PREFIX) {
      const others = (await page.locator(".NextGen-filter-element .ant-select-selection-item").count()) > 0 || (await filterEl(page, "name").locator("input").inputValue()) !== "";
      if (others) await resetBodies(page);
      if ((await filterEl(page, "code").locator("input").inputValue().catch(() => "")) !== code) await typeFilter(page, "code", code);
      return search(page);
    }

    // Tìm currency QA (QAUI + 6 chữ HOA) trong danh sách. Trả về null nếu chưa có
    async function findQa(page) {
      const { json } = await filterQa(page);
      const x = json.data.list.find((r) => QA_CODE_RE.test(r.code));
      return x ? { id: x.id, code: x.code, name: x.name, maxPayout: x.maxPayout, exchangeRate: x.exchangeRate, isSweep: x.isSweep, status: x.status } : null;
    }

    const qaRow = (page) => rows(page).filter({ has: page.locator("td").nth(COL.code).filter({ hasText: exact(qa.code) }) }).first();

    // Mở lại danh sách (reload), lọc theo currency QA. Trả về dòng của currency QA
    async function openQaList(page) {
      await openPage(page);
      const { json } = await filterQa(page);
      const x = json.data.list.find((r) => r.id === qa.id);
      expect(x, `Không thấy currency QA ${qa.id} trong danh sách`).toBeTruthy();
      return { row: qaRow(page), item: x };
    }

    // Lưu hộp thoại Update và kiểm tra request / response currency/update. Chỉ gửi lên đúng currency QA
    async function saveUpdate(page, fields) {
      const [req, res] = await Promise.all([page.waitForRequest(isUpdate), page.waitForResponse(isUpdate), saveBtn(page).click()]);
      const body = bodyOf(req);
      expect(body).toMatchObject({ id: qa.id, ...fields });
      const json = await res.json();
      expect(json.status, JSON.stringify(json)).toBe("success");
      await expect(dialog(page)).toBeHidden();
      await expect(toasts(page).filter({ hasText: "Currency successfully updated" })).toBeVisible();
      await settle(page);
      return body;
    }

    // Đưa currency QA về giá trị gốc (nếu bị đổi). Dùng trong finally / afterAll; chỉ ghi lên đúng currency QA
    async function restoreQa(page) {
      await openPage(page);
      const { json } = await filterQa(page);
      const cur = json.data.list.find((r) => r.id === qa.id);
      expect(cur, `Không thấy currency QA ${qa.id} khi khôi phục`).toBeTruthy();
      const same =
        cur.name === qa.name &&
        Number(cur.maxPayout) === Number(qa.maxPayout) &&
        Number(cur.exchangeRate) === Number(qa.exchangeRate) &&
        cur.isSweep === qa.isSweep &&
        cur.status === qa.status;
      if (same) return;
      await openUpdate(page, qaRow(page));
      await fillForm(page, {
        name: qa.name,
        maxPayout: String(qa.maxPayout),
        exchangeRate: String(qa.exchangeRate),
        isSweep: qa.isSweep === 1,
        status: qa.status,
      });
      await saveUpdate(page, { name: qa.name, isSweep: qa.isSweep, status: qa.status });
    }

    test.afterAll(async ({ browser }) => {
      test.setTimeout(120000);
      if (!qa) return;
      const ctx = await browser.newContext({ storageState: buildStorageState(), viewport: VIEWPORT });
      const page = await ctx.newPage();
      try {
        await page.addInitScript(() => {
          for (const k of Object.keys(localStorage)) if (/admin_currency_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
        });
        await restoreQa(page);
      } finally {
        await ctx.close();
      }
    });

    test.beforeEach(async ({ page }) => {
      await openPage(page);
      // Test CRUD gồm nhiều lần tải trang + khôi phục currency QA trong finally -> cần timeout dài hơn mặc định
      test.setTimeout(240000);
    });

    // Mọi request ghi của nhóm này chỉ được nhắm vào currency QA (không bao giờ sửa currency có sẵn của team)
    test.afterEach(async () => {
      for (const w of writes) {
        expect(["currency/update", "currency/create", "currency/deactivate"], "URL ghi không nằm trong danh sách").toContain(w.url);
        if (w.url === "currency/update") expect(w.body.id, "currency/update phải nhắm đúng currency QA").toBe(qa.id);
        if (w.url === "currency/deactivate") expect(w.body.ids, "currency/deactivate phải nhắm đúng currency QA").toEqual([qa.id]);
        if (w.url === "currency/create") {
          expect(w.body.code, "currency/create chỉ dùng code QAUI...").toMatch(QA_CODE_RE);
          expect(w.body.name, "currency/create chỉ dùng name QA-UI-CURRENCY ...").toMatch(/^QA-UI-CURRENCY /);
        }
      }
    });

    test("Tạo currency QA (chỉ khi CHƯA có currency QAUI... nào - currency không xoá được bằng UI): Save gửi validate + create, dòng mới có đủ giá trị", async ({ page }) => {
      qa = await findQa(page);
      test.skip(!!qa, `Đã có currency QA ${qa?.code} (do lần chạy trước tạo) - không tạo thêm vì màn hình không có chức năng xoá`);

      await resetBodies(page);
      await openCreate(page);
      const code = qaCode();
      const name = `QA-UI-CURRENCY ${code}`;
      await fillForm(page, { name, code, maxPayout: "1234.5", exchangeRate: "2.5" });
      const [vres, req, res] = await Promise.all([
        page.waitForResponse(isValidate),
        page.waitForRequest(isCreate),
        page.waitForResponse(isCreate),
        saveBtn(page).click(),
      ]);
      expect((await vres.json()).status).toBe("success");
      expect(bodyOf(req)).toEqual({ name, code, maxPayout: "1234.5", exchangeRate: "2.5", isSweep: 0, status: 1 });
      const json = await res.json();
      expect(json.status, JSON.stringify(json)).toBe("success");
      await expect(toasts(page).filter({ hasText: "Currency successfully created" })).toBeVisible();
      await expect(dialog(page)).toBeHidden();
      await settle(page);

      qa = await findQa(page);
      expect(qa, "Không tìm thấy currency QA vừa tạo qua filter Code").not.toBeNull();
      expect(qa.code).toBe(code);
      await expect(qaRow(page).locator("td").nth(COL.name)).toHaveText(name);
      await expect(qaRow(page).locator("td").nth(COL.maxPayout)).toHaveText("1,234.5");
      await expect(qaRow(page).locator("td").nth(COL.sweep)).toHaveText("No");
      await expect(qaRow(page).locator("td").nth(COL.rate)).toHaveText("2.5");
      await expect(qaRow(page).locator("td").nth(COL.status)).toHaveText("Active");
    });

    test("Tạo lại với Code của currency QA: báo 'Currency code is already existed' và không tạo thêm", async ({ page }) => {
      qa = qa ?? (await findQa(page));
      test.skip(!qa, "Chưa có currency QA");
      await openCreate(page);
      await fillForm(page, { name: "QA-UI-CURRENCY DUP", code: qa.code, maxPayout: "10", exchangeRate: "1" });
      const [vres] = await Promise.all([page.waitForResponse(isValidate), saveBtn(page).click()]);
      expect((await vres.json()).messageCode).toBe("DUPLICATE_CURRENCY_CODE");
      await expect(formErrors(page)).toHaveText([MSG.duplicate]);
      await cancelDialog(page);
    });

    test("Tìm được currency QA bằng filter Code / Name và hộp thoại Update hiển thị đúng giá trị (Code bị khoá)", async ({ page }) => {
      qa = qa ?? (await findQa(page));
      test.skip(!qa, "Chưa có currency QA");
      await resetBodies(page);
      await typeFilter(page, "name", qa.name);
      const { json } = await search(page);
      expect(json.data.list.map((r) => r.id)).toContain(qa.id);
      await resetBodies(page);
      const { row } = await openQaList(page);
      const data = await openUpdate(page, row);
      expect(data).toMatchObject({ id: qa.id, code: qa.code, name: qa.name, isSweep: qa.isSweep, status: qa.status });
      await expect(field(page, "code")).toHaveValue(qa.code);
      await expect(field(page, "code")).toBeDisabled();
      await cancelDialog(page);
    });

    test("Sửa Name / Max Payout: Save gửi currency/update, toast Success, dòng đổi giá trị; rồi khôi phục", async ({ page }) => {
      test.skip(!qa, "Chưa có currency QA");
      const edited = { name: `${qa.name} E`, maxPayout: "1000" };
      try {
        const { row } = await openQaList(page);
        await openUpdate(page, row);
        await fillForm(page, edited);
        const body = await saveUpdate(page, { ...edited, isSweep: qa.isSweep, status: qa.status });
        // Ô Exchange Rate không đụng tới được gửi lại dạng SỐ (ô đã sửa thì gửi dạng chuỗi)
        expect(Number(body.exchangeRate)).toBe(Number(qa.exchangeRate));
        expect(body).toMatchObject({ ...edited, isSweep: qa.isSweep, status: qa.status, id: qa.id });

        const { json } = await filterQa(page);
        expect(json.data.list.find((r) => r.id === qa.id)).toMatchObject({ name: edited.name, maxPayout: 1000 });
        await expect(qaRow(page).locator("td").nth(COL.name)).toHaveText(edited.name);
        await expect(qaRow(page).locator("td").nth(COL.maxPayout)).toHaveText("1,000");
        // Mở lại hộp thoại Update: hiển thị giá trị mới
        const data = await openUpdate(page, qaRow(page));
        expect(data).toMatchObject({ name: edited.name, maxPayout: 1000 });
        await cancelDialog(page);
      } finally {
        await restoreQa(page);
      }
      const { json } = await filterQa(page);
      expect(json.data.list.find((r) => r.id === qa.id)).toMatchObject({ name: qa.name, maxPayout: qa.maxPayout });
    });

    test("Đổi Exchange Rate: dòng đổi tỉ giá, History có thêm dòng 'cũ -> mới' (cả ở hộp thoại History và Update); rồi khôi phục tỉ giá", async ({ page }) => {
      test.skip(!qa, "Chưa có currency QA");
      const oldRate = Number(qa.exchangeRate);
      const newRate = oldRate + 1;
      try {
        const { row } = await openQaList(page);
        await openUpdate(page, row);
        await fillForm(page, { exchangeRate: String(newRate) });
        await saveUpdate(page, { exchangeRate: String(newRate), name: qa.name });
        await expect(qaRow(page).locator("td").nth(COL.rate)).toHaveText(String(newRate));

        const hist = await openHistory(page, qaRow(page));
        expect(hist.list.some((h) => Number(h.exchangeRateOld) === oldRate && Number(h.exchangeRateNew) === newRate), JSON.stringify(hist.list)).toBe(true);
        const entry = hist.list.find((h) => Number(h.exchangeRateOld) === oldRate && Number(h.exchangeRateNew) === newRate);
        expect(entry.code).toBe(qa.code);
        expect(entry.date).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
        expect(norm(await dialog(page).innerText())).toContain(entry.date);
        expect(norm(await dialog(page).innerText())).toMatch(new RegExp(`${oldRate}\\s+${newRate}`));
        await closeX(page).click();
        await expect(dialog(page)).toBeHidden();

        const data = await openUpdate(page, qaRow(page));
        expect(Number(data.exchangeRate)).toBe(newRate);
        expect(norm(await dialog(page).innerText())).toContain(entry.date);
        await cancelDialog(page);
      } finally {
        await restoreQa(page);
      }
      const { json } = await filterQa(page);
      expect(Number(json.data.list.find((r) => r.id === qa.id).exchangeRate)).toBe(oldRate);
    });

    test("Bật Sweep Stake: dòng có Sweepstake = Yes, lọc Sweep Stake = Yes thấy currency QA; rồi tắt lại (khôi phục)", async ({ page }) => {
      test.skip(!qa, "Chưa có currency QA");
      try {
        const { row } = await openQaList(page);
        await openUpdate(page, row);
        await fillForm(page, { isSweep: qa.isSweep !== 1 });
        const want = qa.isSweep === 1 ? 0 : 1;
        const body = await saveUpdate(page, { isSweep: want, name: qa.name });
        expect(body.isSweep).toBe(want);
        await expect(qaRow(page).locator("td").nth(COL.sweep)).toHaveText(SWEEP_TEXT[want]);

        await selectOption(page, "isSweep", SWEEP_TEXT[want]);
        const { body: sbody, json } = await search(page);
        expect(sbody.filters).toMatchObject({ code: QA_CODE_PREFIX, isSweep: want });
        expect(json.data.list.map((r) => r.id)).toContain(qa.id);
        const data = await openUpdate(page, qaRow(page));
        expect(data.isSweep).toBe(want);
        await cancelDialog(page);
      } finally {
        await restoreQa(page);
      }
      const { json } = await filterQa(page);
      expect(json.data.list.find((r) => r.id === qa.id).isSweep).toBe(qa.isSweep);
    });

    test("Đổi Status bằng hộp thoại Update (Inactive): dòng Inactive, icon toggle-on, lọc Status = Inactive thấy currency QA; rồi khôi phục", async ({ page }) => {
      test.skip(!qa, "Chưa có currency QA");
      const want = qa.status === 1 ? 0 : 1;
      try {
        const { row } = await openQaList(page);
        await openUpdate(page, row);
        await fillForm(page, { status: want });
        await saveUpdate(page, { status: want, name: qa.name });
        await expect(qaRow(page).locator("td").nth(COL.status)).toHaveText(STATUS_TEXT[want]);
        await expect(actionIcon(qaRow(page), ICON.toggle)).toHaveAttribute("data-icon", want === 1 ? "toggle-off" : "toggle-on");

        await selectOption(page, "status", STATUS_TEXT[want]);
        const { body, json } = await search(page);
        expect(body.filters).toMatchObject({ code: QA_CODE_PREFIX, status: [want] });
        expect(json.data.list.map((r) => r.id)).toContain(qa.id);
      } finally {
        await restoreQa(page);
      }
      const { json } = await filterQa(page);
      expect(json.data.list.find((r) => r.id === qa.id).status).toBe(qa.status);
    });

    test("Icon bật / tắt trên dòng (xác nhận thật): gửi currency/deactivate {ids:[id QA], status đảo}, toast Success, Status + icon đổi; rồi khôi phục", async ({ page }) => {
      test.skip(!qa, "Chưa có currency QA");
      const flip = async (from, action) => {
        const [req, res] = await Promise.all([
          page.waitForRequest(isDeactivate),
          page.waitForResponse(isDeactivate),
          (async () => {
            await actionIcon(qaRow(page), ICON.toggle).click();
            await expect(dialog(page)).toContainText(`${action} ${norm(qa.name)}`);
            await expect(dialog(page)).toContainText(`Are you sure you want to ${action.toLowerCase()} this currency?`);
            await dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click();
          })(),
        ]);
        expect(bodyOf(req)).toEqual({ ids: [qa.id], status: from === 1 ? 0 : 1 });
        const json = await res.json();
        expect(json.status, JSON.stringify(json)).toBe("success");
        await expect(toasts(page).filter({ hasText: "Currency status successfully updated" })).toBeVisible();
        await expect(dialog(page)).toBeHidden();
        await settle(page);
        await expect(qaRow(page).locator("td").nth(COL.status)).toHaveText(STATUS_TEXT[from === 1 ? 0 : 1]);
        await expect(actionIcon(qaRow(page), ICON.toggle)).toHaveAttribute("data-icon", from === 1 ? "toggle-on" : "toggle-off");
      };
      try {
        await openQaList(page);
        const from = qa.status;
        await flip(from, from === 1 ? "Deactivate" : "Activate");
        await hoverTip(page, actionIcon(qaRow(page), ICON.toggle), from === 1 ? "Activate" : "Deactivate");
        await flip(from === 1 ? 0 : 1, from === 1 ? "Activate" : "Deactivate");
      } finally {
        await restoreQa(page);
      }
    });

    test("Bulk Deactivate / Activate (xác nhận thật) 1 currency QA: hộp thoại ghi tên, gửi currency/deactivate {ids:[id QA]}, Status đổi; rồi khôi phục", async ({ page }) => {
      test.skip(!qa, "Chưa có currency QA");
      try {
        await openQaList(page);
        const first = qa.status === 1 ? { btn: "Deactivate", i: 1, status: 0 } : { btn: "Activate", i: 0, status: 1 };
        const second = qa.status === 1 ? { btn: "Activate", i: 0, status: 1 } : { btn: "Deactivate", i: 1, status: 0 };
        for (const step of [first, second]) {
          await qaRow(page).locator('input[type="checkbox"]').check();
          await bulkBtns(page).nth(step.i).click();
          await expect(dialog(page)).toContainText(`${step.btn} ${norm(qa.name)} currency`);
          const [req, res] = await Promise.all([
            page.waitForRequest(isDeactivate),
            page.waitForResponse(isDeactivate),
            dialog(page).getByRole("button", { name: new RegExp(`${step.btn}$`) }).click(),
          ]);
          expect(bodyOf(req)).toEqual({ ids: [qa.id], status: step.status });
          expect((await res.json()).status).toBe("success");
          await expect(toasts(page).filter({ hasText: "Currency status successfully updated" })).toBeVisible();
          await expect(dialog(page)).toBeHidden();
          await settle(page);
          await expect(qaRow(page).locator("td").nth(COL.status)).toHaveText(STATUS_TEXT[step.status]);
        }
      } finally {
        await restoreQa(page);
      }
    });
  });
});
