// Administration > Risk Management  (https://dev-bo.royaledge.io/admin/risk-management)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/admin_risk_management.spec.js --project=setup --project=chromium
//
// Màn hình danh sách "Risk Management": các RULE cảnh báo rủi ro (API POST rulesetting/list; xem chi tiết: rulesetting/view {id}).
//  - Filter: Rule Name ("name", input, khớp 1 phần, không phân biệt hoa thường), Severity ("severity", dropdown chọn NHIỀU: Critical / Info / Warning,
//    gửi API dạng IN HOA ["CRITICAL","INFO"]), Channels ("channels", chọn NHIỀU: Discord / Email, gửi ["DISCORD","EMAIL"]),
//    Status ("status", chọn 1: Active = 1 / Inactive = 0, gửi số). Filter rỗng thì KHÔNG gửi key đó. Option đều cố định (không có API dropdown).
//  - Bảng 9 cột: Rule Name / Trigger Condition / Severity / Game Categories / Games / Channels / Last Triggered (GMT+8) / Status / Action.
//    Sort được 4 cột: Rule Name (name), Severity (severity), Last Triggered (lastTriggered), Status (status); chu kỳ asc -> desc -> về mặc định id desc
//    (cả 3 lần click đều gọi API). Sort được app LƯU ở localStorage (sorter__admin_risk-management) nên còn nguyên sau reload.
//  - Game Categories / Games hiển thị "N Items" hoặc "All Items" (select all) là NÚT mở modal liệt kê (không gọi API, dùng dữ liệu của list).
//  - Cột Action có 3 icon: View (/admin/risk-management/view/{id}), Update (/admin/risk-management/update/{id}), toggle Activate / Deactivate
//    (hộp thoại xác nhận, gọi rulesetting/deactivate {ruleSettingIds:[id], status:0|1}). KHÔNG có nút xoá rule, không có Export / chọn dòng.
//  - Add New -> /admin/risk-management/create (form 2 bước: Basic Information -> Review & Submit; Next / Previous / Submit; Cancel về danh sách).
//    Trường: Rule Name (3-50 ký tự, chữ + số + khoảng trắng + <>=%-), Severity (chọn 1), Game Categories (chọn nhiều, có "All Categories" = [-1]),
//    Games (chọn nhiều, có "All Games" = [-1], chỉ bật sau khi chọn category, nạp bằng rulesetting/filter-game), Channels (Discord / Email, mỗi kênh 1 ô nhập),
//    Conditions (tối đa 2 điều kiện: Win Rate / Total Win Amount, toán tử < > =, ngưỡng; điều kiện thứ 2 có chọn And / Or), Description.
//  - Manage Columns: chỉ có checkbox ẩn / hiện cột (KHÔNG có nút Save / Reset to Default).
//  - Filter và số dòng / trang được lưu ở localStorage (key *_admin_risk-management_filter / *_page_size) nên còn nguyên sau reload.
//
// AN TOÀN DỮ LIỆU:
//  - Mọi describe trừ cuối là "chỉ đọc": request ghi (rulesetting/create | update | deactivate) bị chặn ở tầng mạng (route.abort); test kiểm tra payload / thông báo
//    dùng route.fulfill trả response GIẢ (request KHÔNG tới server). afterEach kiểm tra request ghi bắt được đúng danh sách được phép.
//    Rule có sẵn của team (kể cả "QA Rule ..." / "ZZ Audit Rule" của bộ test API) chỉ bị thao tác bằng request GIẢ, không bao giờ bị ghi thật.
//  - Describe cuối "CRUD (ghi dữ liệu thật)" chạy tuần tự, CHỈ thao tác trên 1 rule QA có tên bắt đầu "QA-AUTO-<số>":
//      * Màn hình KHÔNG có chức năng xoá rule -> rule QA KHÔNG xoá được bằng UI, nên test chỉ TẠO rule QA khi chưa có rule nào (tối đa 1 lần trong cả vòng đời),
//        các lần chạy sau dùng lại rule đó. Rule QA luôn được đưa về trạng thái INACTIVE khi kết thúc (afterAll) để không sinh cảnh báo thật.
//      * Test sửa (Name / Severity / Description / ngưỡng) luôn khôi phục lại giá trị gốc trong finally; test Activate / Deactivate kết thúc ở Inactive.
//      * Test tạo trùng tên và test ngưỡng ngoài khoảng (-999..999) gửi request THẬT nhưng backend từ chối nên không tạo gì.
//      * afterEach kiểm tra mọi request ghi chỉ nhắm vào rule QA (create: name QA-AUTO-...; update / deactivate: id = id rule QA).
//  - Không hard-code dữ liệu: rule / category / game đều lấy từ response list và dropdown.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/admin/risk-management";
const ORIGIN = "https://dev-bo.royaledge.io";
const QA_PREFIX = "QA-AUTO-";

// Đúng thứ tự hiển thị
const COLUMNS = [
  "Rule Name",
  "Trigger Condition",
  "Severity",
  "Game Categories",
  "Games",
  "Channels",
  "Last Triggered (GMT+8)",
  "Status",
  "Action",
];
const COL = { name: 0, condition: 1, severity: 2, cats: 3, games: 4, channels: 5, lastTriggered: 6, status: 7, action: 8 };
const SORTABLE = {
  "Rule Name": "name",
  Severity: "severity",
  "Last Triggered (GMT+8)": "lastTriggered",
  Status: "status",
};
const FILTERS = [
  ["name", "Rule Name"],
  ["severity", "Severity"],
  ["channels", "Channels"],
  ["status", "Status"],
];
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
// Nhãn hiển thị -> giá trị gửi API
const SEVERITIES = { Critical: "CRITICAL", Info: "INFO", Warning: "WARNING" };
const CHANNELS = { Discord: "DISCORD", Email: "EMAIL" };
const STATUSES = { Active: 1, Inactive: 0 };
const FORM_SEVERITIES = ["Info", "Warning", "Critical"]; // thứ tự option ở form
const RULE_TYPES = { WinRate: "Win Rate", TotalWinAmount: "Total Win Amount" };
const RULE_TYPE_OPTIONS = ["Total Win Amount", "Win Rate"];
const OPERATORS = ["<", ">", "="];
const DATETIME = /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/;
const MSG = {
  noEntries: "There are no entries found",
  required: "This field is required",
  name: "Rule name must be between 3 to 50 characters long, can only contain alphanumeric characters, spaces, and the following symbols: <>, =, %, -",
  channel: "Please select at least one channel",
  type: "Please select value type",
  operator: "Please select operator",
  threshold: "Threshold value is required",
  number: "Please enter a valid number",
  created: "Create rule setting successfully",
  updated: "Update rule setting successfully",
  statusUpdated: "Rule setting status successfully updated",
};

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI (rulesetting/create | update | deactivate).
// rulesetting/filter-game là API ĐỌC (lọc game theo category) dù tên không có "list".
const READ = /\/(list|details|download|view|filter-game)(\?|$)|\/dropdown\/|_dropdown(\?|$)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/rulesetting/list");
const isView = endsWith("/rulesetting/view");
const isFilterGame = endsWith("/rulesetting/filter-game");
const isCreate = endsWith("/rulesetting/create");
const isUpdate = endsWith("/rulesetting/update");
const isStatus = endsWith("/rulesetting/deactivate");

const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const asc = (a, b) => a - b;
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};

// Bảng chính (luôn là .ant-table đầu tiên trong DOM; bảng trong modal nằm sau)
const table = (page) => page.locator(".ant-table").first();
const rows = (page) => table(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
const th = (page, name) => table(page).locator("thead th").filter({ hasText: exact(name) });
const actionIcons = (row) => row.locator(".column-actions > *");
const ICON = { view: 0, update: 1, toggle: 2 };
const itemsBtn = (page, i, col) => cellAt(page, i, col).getByRole("button");

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const addBtn = (page) => page.getByRole("button", { name: /Add New/ });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const titleEl = (page) => page.locator(".Breadcrumb__itemFinal"); // chữ tiêu đề cuối của breadcrumb (không phải link)
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const pageSizeSelect = (page) => page.locator(".ant-pagination-options .ant-select");
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
const filterEl = (page, id) => page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const modal = (page) => page.locator(".ant-modal-content");
const toasts = (page) => page.locator(".Toastify__toast");

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-table-wrapper .ant-spin-spinning")).toHaveCount(0);
}

// Khi vừa vào / quay lại danh sách app có thể gửi nhiều request list liên tiếp (vd filters {} rồi filters đã lưu):
// chờ mạng yên sau mỗi lần gọi để request thừa không bị nhầm là request của thao tác kế tiếp.
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
}

// Mở màn hình và chờ lần load đầu tiên xong
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

// Toàn bộ ô của bảng ở trang hiện tại: [{ cells: [text...], lines: [[dòng...]...] }] (lines = các thẻ div con, dùng cho cột Channels)
const tableMatrix = (page) =>
  rows(page).evaluateAll((trs) =>
    trs.map((tr) => ({
      cells: [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()),
      lines: [...tr.children].map((td) => [...td.querySelectorAll("div")].map((d) => d.innerText.trim())),
    })),
  );

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
// KHÔNG click giữa ô: với dropdown chọn nhiều, vị trí đó có thể rơi vào nút (x) của chip đã chọn -> xoá mất giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (theo text) của filter dạng dropdown rồi đóng dropdown.
async function selectOption(page, id, text) {
  await openDropdown(page, id);
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

// Giá trị đang chọn (chip / giá trị đơn) của 1 filter dropdown.
// LƯU Ý: chip của Severity là thẻ màu ".ant-tag" (KHÔNG có thuộc tính title), Channels / Status là ".ant-select-selection-item[title]".
const CHIP = '.ant-select-selection-item[title], .ant-select-selection-overflow-item:not([aria-hidden="true"]) .ant-tag';
const selectedTitles = (page, id) =>
  filterEl(page, id)
    .locator(CHIP)
    .evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? e.innerText.trim()));

// Tổng số giá trị đang chọn của 1 filter chọn nhiều (ô chỉ hiện 1 chip + chip "+ N ..." không có title)
async function selectedCount(page, id) {
  const shown = await filterEl(page, id)
    .locator(`.ant-select-selection-overflow-item:not([aria-hidden="true"]) :is(.ant-select-selection-item[title], .ant-tag)`)
    .count();
  const rest = await filterEl(page, id).locator(".ant-select-selection-overflow-item-rest").allInnerTexts();
  const hidden = rest.reduce((sum, t) => sum + Number(t.match(/\+\s*(\d+)/)?.[1] ?? 0), 0);
  return shown + hidden;
}

// Gõ vào filter dạng input (Rule Name): input bị ẩn cho tới khi click label
async function typeFilter(page, id, value) {
  await filterEl(page, id).locator("label").first().click();
  await page.locator(`#${id}`).fill(value);
}

// Có dữ liệu thì mới test tiếp (dev dùng chung nên gần như luôn có)
async function ensureData(page) {
  test.skip((await rows(page).count()) === 0, "Không có rule nào để test");
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

// Dùng cho test kiểm tra payload / thông báo: request ghi vẫn KHÔNG tới server, được trả về response GIẢ
// (route đăng ký sau được ưu tiên hơn route chặn ở beforeEach)
async function mockWrites(page, response) {
  await page.route(/boapi/, (route) => {
    const r = route.request();
    if (r.method() === "POST" && !READ.test(r.url())) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": ORIGIN, "access-control-allow-credentials": "true" },
        body: JSON.stringify(response),
      });
    }
    return route.continue();
  });
}

const MOCK_OK = { status: "success", messageCode: "SUCCESS", message: "OK", data: {} };
const MOCK_CREATE_OK = { status: "success", messageCode: "CREATE_RULE_SETTING_SUCCESS", message: "Create rule setting successfully", data: {} };
const MOCK_UPDATE_OK = { status: "success", messageCode: "UPDATE_RULE_SETTING_SUCCESS", message: "Update rule setting successfully", data: {} };
const MOCK_STATUS_OK = { status: "success", messageCode: "UPDATE_RULE_SETTING_STATUS_SUCCESS", message: "Rule setting status updated successfully", data: {} };
const MOCK_VALIDATION = {
  status: "fail",
  messageCode: "VALIDATION_FAILED",
  message: "One or more validation errors occurred.",
  validation: { "Conditions.Rules[0].Threshold": ["Threshold must be between -999 and 999"] },
};

// --- Dữ liệu rule ---
const sevLabel = (code) => cap(code); // "CRITICAL" -> "Critical"
const itemsLabel = (all, arr) => (all ? "All Items" : `${arr.length} Items`);
// Cột Channels ở danh sách: "Email: a@b.c" / "Discord: ...". LƯU Ý: danh sách hiển thị link Discord ĐÃ MẤT "https:" ("//discord.com/...")
// trong khi API và màn hình View có đủ "https://discord.com/..." -> phía kỳ vọng bỏ "https:" (xem phần "Cần xác nhận" của báo cáo).
const channelLinesList = (chs) => chs.map((c) => `${cap(c.channelType)}: ${c.recipients}`.replace(/^(Discord: )https?:/, "$1")).sort();
const channelLinesView = (chs) => chs.map((c) => `${cap(c.channelType)}: ${c.recipients}`).sort();

// ---------------------------------------------------------------------------
// Màn hình View / form Create / Update
// ---------------------------------------------------------------------------
const desc = (page, label) =>
  page
    .locator(".ant-descriptions-item")
    .filter({ has: page.locator(".ant-descriptions-item-label", { hasText: exact(label) }) })
    .locator(".ant-descriptions-item-content");

// Từ danh sách vào màn hình View / Update của dòng i. Trả về rulesetting/view (data)
// Lưu ý: app CACHE kết quả rulesetting/view của rule vừa mở Update trong cùng lần tải trang (mở View ngay sau khi Update lại KHÔNG gọi API nữa)
// -> test phải reload trang (openPage) trước khi mở View / Update của rule đó lần 2, nếu không sẽ không có request để chờ.
async function openRowAction(page, i, icon) {
  const viewRes = page.waitForResponse(isView, { timeout: 15000 });
  viewRes.catch(() => {});
  await actionIcons(rowAt(page, i)).nth(icon).click();
  await expect(page).toHaveURL(icon === ICON.view ? /\/admin\/risk-management\/view\/\d+$/ : /\/admin\/risk-management\/update\/\d+$/);
  const data = (await (await viewRes).json()).data;
  await expect(breadcrumb(page)).toContainText(icon === ICON.view ? "Rule Details" : "Update Rule");
  if (icon === ICON.update) await expect(nameInput(page)).toHaveValue(data.name);
  return data;
}

// Đi từ danh sách vào form Create (bấm Add New). Trả về { cats } = response dropdown/gamecategory (null nếu app không gọi lại)
async function openCreate(page) {
  const catRes = page.waitForResponse((r) => post(r) && /\/dropdown\/gamecategory$/.test(reqOf(r).url()), { timeout: 8000 }).catch(() => null);
  await addBtn(page).click();
  await expect(page).toHaveURL(/\/admin\/risk-management\/create$/);
  await expect(nameInput(page)).toBeVisible();
  const res = await catRes;
  return { cats: res ? (await res.json()).data : null };
}

const nameInput = (page) => page.locator("#name");
const descInput = (page) => page.locator("#description");
const formItem = (page, id) => page.locator(".ant-form-item").filter({ has: page.locator(`#${id}`) });
const fieldErrors = (page) => page.locator(".ant-form-item-explain-error");
const nextBtn = (page) => page.getByRole("button", { name: "Next", exact: true });
const prevBtn = (page) => page.getByRole("button", { name: "Previous", exact: true });
const submitBtn = (page) => page.getByRole("button", { name: "Submit", exact: true });
const cancelBtn = (page) => page.getByRole("button", { name: /Cancel$/ });
const addConditionBtn = (page) => page.getByRole("button", { name: /Add condition/ });
const channelWrapper = (page, label) => page.locator("label.ant-checkbox-wrapper").filter({ hasText: exact(label) });
const channelBox = (page, label) => channelWrapper(page, label).locator("input");
const channelInput = (page, label) => page.getByPlaceholder(`Enter ${label.toLowerCase()} path/address`);
const ruleField = (i, f) => `conditions_rules_${i}_${f}`;
const threshold = (page, i) => page.locator(`#${ruleField(i, "threshold")}`);

// Chọn option của ô select trong form (severity / category / game / loại / toán tử / and-or) rồi đóng dropdown
async function pickFormOption(page, id, text, { type = false } = {}) {
  await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  await page.locator(`#${id}`).click({ force: true });
  if (type) await page.keyboard.type(text);
  // Thỉnh thoảng danh sách option của antd nằm ngoài khung nhìn (Playwright báo "element is outside of the viewport" và click mãi không được)
  // -> dự phòng: gõ tên option rồi Enter (chọn option đang được highlight, tức option khớp đầu tiên)
  await openOptions(page)
    .filter({ hasText: exact(text) })
    .first()
    .click({ timeout: 8000 })
    .catch(async () => {
      if (!type) await page.keyboard.type(text);
      await page.keyboard.press("Enter");
    });
  // Ô chọn nhiều không tự đóng -> click vào chữ tiêu đề (không phải link) để đóng
  await titleEl(page).click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Chip đang chọn của 1 ô select trong form
const chips = (page, id) => page.locator(".ant-select").filter({ has: page.locator(`#${id}`) }).locator(".ant-select-selection-item").allInnerTexts().then((a) => a.map((t) => t.trim()));
// Chip của ô Games / Categories được app điền sau khi nạp xong danh sách (rulesetting/filter-game) nên đọc có retry
const expectChips = (page, id, expected) => expect.poll(() => chips(page, id), { message: `chip của #${id}` }).toEqual(expected);
const optionTexts = (page) => openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));

// Đọc option của 1 ô select trong form
async function formOptions(page, id) {
  await page.locator(`#${id}`).click({ force: true });
  await openOptions(page).first().waitFor();
  const t = await optionTexts(page);
  await titleEl(page).click();
  await expect(openOptions(page)).toHaveCount(0);
  return t;
}

// Chọn category (chờ filter-game) rồi game. Trả về { catIds (gửi lên filter-game), games (response filter-game) }
async function pickCategoryAndGame(page, { category, game } = {}) {
  const fg = page.waitForRequest(isFilterGame);
  const fgRes = page.waitForResponse(isFilterGame);
  await page.locator("#gameCategoryIds").click({ force: true });
  await openOptions(page).first().waitFor();
  const label = category ?? (await optionTexts(page)).find((t) => t !== "All Categories");
  await openOptions(page).filter({ hasText: exact(label) }).first().click();
  await titleEl(page).click();
  await expect(openOptions(page)).toHaveCount(0);
  const catIds = bodyOf(await fg).gameCategoryIds;
  const games = (await (await fgRes).json()).data.games;
  await expect(page.locator("#gameIds")).toBeEnabled();
  // Game: mặc định lấy game đầu tiên có tên xuất hiện đúng 1 lần (tên có thể trùng nhau)
  const target = game ? games.find((g) => g.name === game) : games.find((g) => games.filter((x) => x.name === g.name).length === 1);
  await pickFormOption(page, "gameIds", target.name, { type: true });
  return { catIds, games, game: target, category: label };
}

// Điền toàn bộ form hợp lệ. channels: { Email: "...", Discord: "..." }; rules: [{ type: "WinRate", operator: "<", threshold: "-50" }]
async function fillRuleForm(page, { name, severity = "Info", channels = { Email: "qa-auto@example.com" }, rules, description, allCategories = false, allGames = false } = {}) {
  await nameInput(page).fill(name);
  await pickFormOption(page, "severity", severity);
  let picked;
  if (allCategories) {
    const fg = page.waitForResponse(isFilterGame);
    await pickFormOption(page, "gameCategoryIds", "All Categories");
    await fg;
    await expect(page.locator("#gameIds")).toBeEnabled();
  } else {
    picked = await pickCategoryAndGame(page);
  }
  if (allGames) await pickFormOption(page, "gameIds", "All Games");
  for (const [label, value] of Object.entries(channels)) {
    await channelWrapper(page, label).click();
    await expect(channelBox(page, label)).toBeChecked();
    await channelInput(page, label).fill(value);
  }
  const list = rules ?? [{ type: "WinRate", operator: "<", threshold: "-50" }];
  for (const [i, r] of list.entries()) {
    if (i > 0) {
      await addConditionBtn(page).click();
      await pickFormOption(page, "conditions_relation", r.relation ?? "And");
    }
    await pickFormOption(page, ruleField(i, "type"), RULE_TYPES[r.type]);
    await pickFormOption(page, ruleField(i, "operator"), r.operator);
    await threshold(page, i).fill(r.threshold);
  }
  if (description !== undefined) await descInput(page).fill(description);
  return picked;
}

// Chờ qua bước Review: kiểm tra đang ở bước 2 (có nút Submit)
async function goReview(page) {
  await nextBtn(page).click();
  await expect(submitBtn(page)).toBeVisible();
  await expect(desc(page, "Rule Name")).toBeVisible();
}

// Payload rulesetting/create mong đợi
const createBody = ({ name, severity, description, rules, relation = null, channels, gameCategoryIds, gameIds }) => ({
  name,
  severity,
  ...(description ? { description } : {}),
  conditions: { rules, relation },
  channels,
  gameCategoryIds,
  gameIds,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Administration > Risk Management", () => {
  let writes;
  let allowedUrls; // URL ghi được phép (chỉ các test dùng response giả; request KHÔNG tới server thật)

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, số dòng/trang, sort được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__admin_risk_management_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/admin_risk-management_(filter|page_size)$|^sorter__admin_risk-management$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__admin_risk_management_spec_cleared", "1");
    });
    writes = watchWrites(page);
    allowedUrls = [];
  });

  // ===== NHÓM CHỈ ĐỌC (không ghi dữ liệu thật) =====
  test.describe("Chỉ đọc (không ghi dữ liệu thật)", () => {
    test.beforeEach(async ({ page }) => {
      await blockWrites(page);
      await openPage(page);
    });

    // Mọi test không được gửi request ghi nào ngoài danh sách được phép (và request được phép cũng không tới server thật)
    test.afterEach(async () => {
      expect(
        writes.map((w) => w.url),
        "Request ghi dữ liệu bắt được phải đúng danh sách được phép",
      ).toEqual(allowedUrls);
    });

    // ===== 1. Hiển thị màn hình =====
    test.describe("Hiển thị mặc định", () => {
      test("Có tiêu đề 'Risk Management'", async ({ page }) => {
        await expect(breadcrumb(page)).toHaveText("Risk Management");
      });

      test("Có đủ 4 filter và 2 nút Search/Reset", async ({ page }) => {
        await expect(page.locator(".NextGen-filter-element")).toHaveCount(FILTERS.length);
        for (const [id, label] of FILTERS) await expect(filterEl(page, id), id).toContainText(label);
        await expect(searchBtn(page)).toBeVisible();
        await expect(resetBtn(page)).toBeVisible();
      });

      test("Loại filter: Rule Name là ô nhập chữ; Severity / Channels chọn nhiều; Status chọn 1", async ({ page }) => {
        await expect(filterEl(page, "name").locator("input")).toHaveCount(1);
        await expect(filterEl(page, "name").locator(".ant-select")).toHaveCount(0);
        for (const id of ["severity", "channels"]) {
          await expect(filterEl(page, id).locator(".ant-select-multiple"), id).toHaveCount(1);
        }
        await expect(filterEl(page, "status").locator(".ant-select")).toHaveCount(1);
        await expect(filterEl(page, "status").locator(".ant-select-multiple")).toHaveCount(0);
      });

      test("Giá trị filter mặc định: tất cả để trống", async ({ page }) => {
        await expect(page.locator("#name")).toHaveValue("");
        for (const id of ["severity", "channels", "status"]) {
          await expect(filterEl(page, id).locator(".ant-select-selection-item"), `#${id} phải trống`).toHaveCount(0);
        }
      });

      test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự, có Add New + Manage Columns, không có Export / chọn dòng`, async ({ page }) => {
        expect(await headers(page)).toEqual(COLUMNS);
        await expect(addBtn(page)).toBeVisible();
        await expect(columnBtn(page)).toBeVisible();
        await expect(page.locator("button.NextGen-export-button")).toHaveCount(0);
        await expect(page.locator('.ant-table input[type="checkbox"]')).toHaveCount(0);
      });

      test("Mặc định: trang 1, 10 dòng, sort id giảm dần, filters rỗng", async ({ page }) => {
        const { body, status, json } = await search(page);
        expect(status).toBe(200);
        expect(body).toEqual({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: {} });
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
      test("Mỗi dòng khớp response API (Name, Condition, Severity, Categories, Games, Channels, Last Triggered, Status)", async ({ page }) => {
        const { json } = await search(page);
        const list = json.data.list;
        test.skip(list.length === 0, "Không có dữ liệu");
        await expect(rows(page)).toHaveCount(list.length);
        const matrix = await tableMatrix(page);
        for (const [i, x] of list.entries()) {
          const at = `dòng ${i + 1} (rule ${x.id})`;
          const c = matrix[i].cells;
          expect(c[COL.name], at).toBe(norm(x.name));
          expect(c[COL.condition], at).toBe(norm(x.conditions));
          expect(c[COL.severity], at).toBe(sevLabel(x.severity));
          expect(c[COL.cats], at).toBe(itemsLabel(x.gameCategorySelectAll === 1, x.gameCategories));
          expect(c[COL.games], at).toBe(itemsLabel(x.gameSelectAll === 1, x.games));
          expect([...matrix[i].lines[COL.channels]].sort(), at).toEqual(channelLinesList(x.channels));
          expect(c[COL.lastTriggered], at).toBe(x.lastTriggered);
          expect(c[COL.status], at).toBe(x.status === 1 ? "Active" : "Inactive");
        }
      });

      test("Định dạng: Severity / Status hợp lệ, Last Triggered là 'N/A' hoặc dd-MM-yyyy HH:mm:ss, tên và điều kiện không trống", async ({ page }) => {
        await ensureData(page);
        for (const v of await columnValues(page, "Severity")) expect(Object.keys(SEVERITIES)).toContain(v);
        for (const v of await columnValues(page, "Status")) expect(Object.keys(STATUSES)).toContain(v);
        for (const v of await columnValues(page, "Last Triggered (GMT+8)")) expect(v === "N/A" || DATETIME.test(v), v).toBe(true);
        for (const col of ["Rule Name", "Trigger Condition"]) {
          for (const v of await columnValues(page, col)) expect(v, col).not.toBe("");
        }
        for (const v of await columnValues(page, "Game Categories")) expect(v).toMatch(/^(All Items|\d+ Items)$/);
        for (const v of await columnValues(page, "Games")) expect(v).toMatch(/^(All Items|\d+ Items)$/);
      });

      test("Mặc định sắp xếp theo id giảm dần và id không trùng nhau", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length < 2, "Không đủ dữ liệu");
        const ids = json.data.list.map((x) => x.id);
        expect(ids).toEqual([...ids].sort((a, b) => b - a));
        expect(new Set(ids).size).toBe(ids.length);
      });

      test("Cột Action: mỗi dòng có 3 icon View / Update / Activate-Deactivate, tooltip đúng theo trạng thái", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const tooltip = page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");
        for (const i of [0, 1].filter((k) => k < json.data.list.length)) {
          const x = json.data.list[i];
          await expect(actionIcons(rowAt(page, i)), `dòng ${i + 1}`).toHaveCount(3);
          const expected = ["View", "Update", x.status === 1 ? "Deactivate" : "Activate"];
          for (const [k, text] of expected.entries()) {
            await actionIcons(rowAt(page, i)).nth(k).hover();
            await expect(tooltip.filter({ hasText: exact(text) }), `dòng ${i + 1} icon ${k}`).toBeVisible();
          }
          // Icon công tắc: đang Active -> toggle-off ("Deactivate"), Inactive -> toggle-on ("Activate")
          await expect(actionIcons(rowAt(page, i)).nth(ICON.toggle).locator("svg")).toHaveAttribute(
            "data-icon",
            x.status === 1 ? "toggle-off" : "toggle-on",
          );
        }
      });

      test("Cột Game Categories / Games là nút mở modal liệt kê, mỗi dòng có đúng 1 nút", async ({ page }) => {
        await ensureData(page);
        const n = await rows(page).count();
        for (let i = 0; i < n; i++) {
          await expect(itemsBtn(page, i, COL.cats), `dòng ${i + 1} categories`).toHaveCount(1);
          await expect(itemsBtn(page, i, COL.games), `dòng ${i + 1} games`).toHaveCount(1);
        }
      });
    });

    // ===== 3. Modal Game Categories / Games =====
    test.describe("Modal Game Categories / Games", () => {
      test("Bấm 'N Items' ở Game Categories: modal 'Game Categories - <tên rule>' liệt kê đúng category, không gọi API", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const calls = [];
        page.on("request", (r) => post(r) && /boapi/.test(r.url()) && calls.push(r.url()));
        await itemsBtn(page, 0, COL.cats).click();
        await expect(modal(page)).toBeVisible();
        await expect(modal(page)).toContainText(`Game Categories - ${norm(x.name)}`);
        await expect(modal(page)).toContainText(`(${x.gameCategories.length} Items)`);
        expect((await modal(page).locator("thead th").allInnerTexts()).map((t) => t.trim())).toEqual(["#", "Game Category Code", "Game Category Name"]);
        const shown = await modal(page).locator("tbody tr.ant-table-row").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.innerText.trim())));
        expect(shown.length).toBe(Math.min(20, x.gameCategories.length));
        // Thứ tự category trong modal không được kiểm tra (chưa rõ app sắp theo gì) - chỉ kiểm tra từng dòng có trong response
        for (const r of shown) {
          const c = x.gameCategories.find((g) => g.code === r[1]);
          expect(c, `category ${r[1]} phải có trong response`).toBeTruthy();
          expect(r[2]).toBe(c.name);
        }
        expect(shown.map((r) => r[0])).toEqual(shown.map((_, i) => String(i + 1)));
        expect(calls, "mở modal không được gọi API").toEqual([]);
      });

      test("Bấm 'N Items' ở Games: modal 'Games - <tên rule>' liệt kê đúng game (đúng thứ tự response), phân trang 20 / page", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await itemsBtn(page, 0, COL.games).click();
        await expect(modal(page)).toBeVisible();
        await expect(modal(page)).toContainText(`Games - ${norm(x.name)}`);
        await expect(modal(page)).toContainText(`(${x.games.length} Items)`);
        expect((await modal(page).locator("thead th").allInnerTexts()).map((t) => t.trim())).toEqual(["#", "Game Code", "Game Name"]);
        const shown = await modal(page).locator("tbody tr.ant-table-row").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.innerText.trim())));
        expect(shown.length).toBe(Math.min(20, x.games.length));
        for (const [i, r] of shown.entries()) expect(r, `dòng ${i + 1}`).toEqual([String(i + 1), x.games[i].code, x.games[i].name]);
        await expect(modal(page).locator(".ant-pagination")).toContainText(`1-${shown.length} of ${x.games.length} items`);
      });

      test("Rule 'All Items' (select all): modal vẫn liệt kê các category / game đang áp dụng", async ({ page }) => {
        const { json } = await search(page);
        const i = json.data.list.findIndex((x) => x.gameCategorySelectAll === 1 || x.gameSelectAll === 1);
        test.skip(i < 0, "Không có rule select-all ở trang đầu");
        const x = json.data.list[i];
        const col = x.gameCategorySelectAll === 1 ? COL.cats : COL.games;
        const arr = x.gameCategorySelectAll === 1 ? x.gameCategories : x.games;
        await expect(cellAt(page, i, col)).toHaveText("All Items");
        await itemsBtn(page, i, col).click();
        await expect(modal(page)).toBeVisible();
        await expect(modal(page)).toContainText(`(${arr.length} Items)`);
        await expect(modal(page).locator("tbody tr.ant-table-row")).toHaveCount(Math.min(20, arr.length));
      });

      test("Đóng modal bằng nút (x)", async ({ page }) => {
        await ensureData(page);
        await itemsBtn(page, 0, COL.cats).click();
        await expect(modal(page)).toBeVisible();
        await modal(page).locator(".ant-modal-close").click();
        await expect(modal(page)).toHaveCount(0);
      });

      test("Đóng modal bằng phím Esc (sau khi click vào modal để có focus)", async ({ page }) => {
        await ensureData(page);
        await itemsBtn(page, 0, COL.games).click();
        await expect(modal(page)).toBeVisible();
        await modal(page).locator("thead").first().click();
        await page.keyboard.press("Escape");
        await expect(modal(page)).toHaveCount(0);
      });
    });

    // ===== 4. Search / Filter =====
    test.describe("Search / Filter", () => {
      test("Search mặc định gửi đúng request và không có filter nào", async ({ page }) => {
        const { body, status } = await search(page);
        expect(status).toBe(200);
        expect(body).toEqual({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: {} });
      });

      test("Option cố định của Severity / Channels / Status", async ({ page }) => {
        expect(await dropdownOptions(page, "severity")).toEqual(Object.keys(SEVERITIES));
        expect(await dropdownOptions(page, "channels")).toEqual(Object.keys(CHANNELS));
        expect(await dropdownOptions(page, "status")).toEqual(Object.keys(STATUSES));
      });

      test("Tìm theo Rule Name (không phân biệt hoa/thường, khớp một phần)", async ({ page }) => {
        await ensureData(page);
        const name = (await columnValues(page, "Rule Name"))[0];
        const part = name.slice(0, Math.max(3, name.length - 2)).toUpperCase();
        await typeFilter(page, "name", part);
        const { body } = await search(page);

        expect(body.filters).toEqual({ name: part });
        const values = await columnValues(page, "Rule Name");
        expect(values.length).toBeGreaterThan(0);
        for (const v of values) expect(v.toLowerCase()).toContain(part.toLowerCase());
      });

      // Mỗi giá trị Severity gửi đúng giá trị IN HOA và mọi dòng khớp
      for (const [label, code] of Object.entries(SEVERITIES)) {
        test(`Lọc theo Severity = ${label} gửi ["${code}"] và mọi dòng có Severity ${label}`, async ({ page }) => {
          await selectOption(page, "severity", label);
          const { body, status, json } = await search(page);
          expect(status).toBe(200);
          expect(body.filters).toEqual({ severity: [code] });
          test.skip(json.data.list.length === 0, `Không có rule nào với severity ${label}`);
          for (const v of await columnValues(page, "Severity")) expect(v).toBe(label);
          for (const x of json.data.list) expect(x.severity).toBe(code);
        });
      }

      for (const [label, code] of Object.entries(CHANNELS)) {
        test(`Lọc theo Channels = ${label} gửi ["${code}"] và mọi dòng có kênh ${label}`, async ({ page }) => {
          await selectOption(page, "channels", label);
          const { body, status, json } = await search(page);
          expect(status).toBe(200);
          expect(body.filters).toEqual({ channels: [code] });
          test.skip(json.data.list.length === 0, `Không có rule nào dùng kênh ${label}`);
          for (const x of json.data.list) expect(x.channels.map((c) => c.channelType), `rule ${x.id}`).toContain(code);
          for (const lines of (await tableMatrix(page)).map((r) => r.lines[COL.channels])) {
            expect(lines.some((l) => l.startsWith(`${label}:`)), `Channels: ${lines}`).toBe(true);
          }
        });
      }

      for (const [label, code] of Object.entries(STATUSES)) {
        test(`Lọc theo Status = ${label} gửi status = ${code} và mọi dòng ${label}`, async ({ page }) => {
          await selectOption(page, "status", label);
          const { body, status, json } = await search(page);
          expect(status).toBe(200);
          expect(body.filters).toEqual({ status: code });
          test.skip(json.data.list.length === 0, `Không có rule nào ${label}`);
          for (const v of await columnValues(page, "Status")) expect(v).toBe(label);
          for (const x of json.data.list) expect(x.status).toBe(code);
        });
      }

      test("Severity chọn nhiều giá trị: gửi đủ giá trị và mọi dòng thuộc 1 trong các severity đã chọn", async ({ page }) => {
        await selectOption(page, "severity", "Critical");
        await selectOption(page, "severity", "Info");
        await expect.poll(() => selectedCount(page, "severity"), { timeout: 10_000 }).toBe(2);
        const { body, json } = await search(page);

        expect(body.filters.severity).toEqual(["CRITICAL", "INFO"]);
        test.skip(json.data.list.length === 0, "Không có rule Critical / Info");
        for (const v of await columnValues(page, "Severity")) expect(["Critical", "Info"]).toContain(v);
      });

      test("Channels chọn nhiều giá trị: gửi đủ giá trị và mọi rule có ít nhất 1 kênh đã chọn", async ({ page }) => {
        await selectOption(page, "channels", "Discord");
        await selectOption(page, "channels", "Email");
        await expect.poll(() => selectedCount(page, "channels"), { timeout: 10_000 }).toBe(2);
        const { body, json } = await search(page);

        expect(body.filters.channels).toEqual(["DISCORD", "EMAIL"]);
        test.skip(json.data.list.length === 0, "Không có rule dùng Discord / Email");
        for (const x of json.data.list) expect(x.channels.length).toBeGreaterThan(0);
      });

      test("Kết hợp nhiều filter cùng lúc (AND): Rule Name + Severity + Status của dòng đầu", async ({ page }) => {
        await ensureData(page);
        const first = (await search(page)).json.data.list[0];
        const sev = sevLabel(first.severity);
        const st = first.status === 1 ? "Active" : "Inactive";
        const part = norm(first.name).slice(0, 8);
        await typeFilter(page, "name", part);
        await selectOption(page, "severity", sev);
        await selectOption(page, "status", st);
        const { body, json } = await search(page);

        expect(body.filters).toEqual({ name: part, severity: [first.severity], status: first.status });
        expect(json.data.list.length, "dòng đầu của danh sách phải thoả cả 3 filter").toBeGreaterThan(0);
        for (const x of json.data.list) {
          expect(x.name.toLowerCase()).toContain(part.toLowerCase());
          expect(x.severity).toBe(first.severity);
          expect(x.status).toBe(first.status);
        }
      });

      test("Không có kết quả -> hiển thị 'There are no entries found'", async ({ page }) => {
        await typeFilter(page, "name", "no_such_rule_zzz_999");
        const { json } = await search(page);
        expect(json.data.totalCount).toBe(0);
        await expect(rows(page)).toHaveCount(0);
        await expect(page.getByText(MSG.noEntries).first()).toBeVisible();
        // Khi không có kết quả app ẩn luôn dòng tóm tắt "Showing ..."
        await expect(summary(page)).toHaveCount(0);
      });
    });

    // ===== 5. Reset =====
    test.describe("Reset", () => {
      test("Reset xoá toàn bộ filter đã chọn và gửi lại request mặc định", async ({ page }) => {
        await ensureData(page);
        const defaultBody = (await search(page)).body;

        await typeFilter(page, "name", "abc");
        await selectOption(page, "severity", "Info");
        await selectOption(page, "channels", "Email");
        await selectOption(page, "status", "Active");
        await search(page);

        const bodies = await resetBodies(page);
        await expect(page.locator("#name")).toHaveValue("");
        for (const id of ["severity", "channels", "status"]) {
          await expect(filterEl(page, id).locator(".ant-select-selection-item")).toHaveCount(0);
        }
        expect(bodies.length, "Reset phải gọi lại API").toBeGreaterThan(0);
        expect(bodies[bodies.length - 1]).toEqual(defaultBody);
      });
    });

    // ===== 6. Phân trang =====
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

      test("Giữ nguyên filter khi chuyển trang", async ({ page }) => {
        // Severity có nhiều rule nhất ở môi trường dev (rule QA của bộ test API là Critical) - chọn severity có > 10 rule
        let picked;
        for (const label of Object.keys(SEVERITIES)) {
          await selectOption(page, "severity", label);
          const r = await search(page);
          if (r.json.data.totalCount > 10) {
            picked = r;
            break;
          }
          await resetBodies(page);
        }
        test.skip(!picked, "Không có severity nào có hơn 10 rule");

        const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
        expect(body.page).toBe(2);
        expect(body.filters).toEqual(picked.body.filters);
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

    // ===== 7. Sắp xếp =====
    test.describe("Sắp xếp", () => {
      // Chu kỳ: asc -> desc -> về mặc định (id giảm dần); cả 3 lần đều gọi API
      for (const [column, sortBy] of Object.entries(SORTABLE)) {
        test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định (sortBy ${sortBy})`, async ({ page }) => {
          const header = th(page, column);
          const asc1 = await reloadFull(page, () => header.click());
          expect(asc1.body).toMatchObject({ sortBy, sortDirection: "asc" });
          const desc1 = await reloadFull(page, () => header.click());
          expect(desc1.body).toMatchObject({ sortBy, sortDirection: "desc" });
          const none = await reloadBy(page, () => header.click());
          expect(none).toMatchObject({ sortBy: "id", sortDirection: "desc" });

          // Severity gửi / sắp theo mã IN HOA (CRITICAL < INFO < WARNING) nên kiểm tra được thứ tự.
          // Cột Rule Name / Last Triggered phụ thuộc collation server -> chỉ kiểm tra request.
          // HÀNH VI CẦN XÁC NHẬN: sortBy "status" bị backend BỎ QUA - asc và desc đều trả đúng thứ tự mặc định (id giảm dần),
          // nên với cột Status chỉ kiểm tra request (không kiểm tra thứ tự dữ liệu).
          if (column === "Severity") {
            const a = asc1.json.data.list.map((x) => x.severity);
            const d = desc1.json.data.list.map((x) => x.severity);
            test.skip(a.length < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
            expect(a).toEqual([...a].sort());
            expect(d).toEqual([...d].sort().reverse());
          }
        });
      }

      test("Các cột còn lại không có chức năng sort", async ({ page }) => {
        for (const column of COLUMNS.filter((c) => !(c in SORTABLE))) {
          await expect(th(page, column), column).not.toHaveClass(/ant-table-column-has-sorters/);
        }
        for (const column of Object.keys(SORTABLE)) {
          await expect(th(page, column), column).toHaveClass(/ant-table-column-has-sorters/);
        }
      });

      test("Giữ nguyên filter khi sort", async ({ page }) => {
        await selectOption(page, "status", "Active");
        const first = await search(page);
        test.skip(first.json.data.list.length < 2, "Không đủ dữ liệu");
        const body = await reloadBy(page, () => th(page, "Rule Name").click());
        expect(body.sortBy).toBe("name");
        expect(body.filters).toEqual(first.body.filters);
      });

      test("Sort được ghi nhớ sau khi reload trang (localStorage sorter__admin_risk-management)", async ({ page }) => {
        await reloadBy(page, () => th(page, "Rule Name").click());

        const reqPromise = page.waitForRequest(isList);
        await page.reload();
        expect(bodyOf(await reqPromise)).toMatchObject({ sortBy: "name", sortDirection: "asc" });
        await settle(page);
        await expect(th(page, "Rule Name")).toHaveAttribute("aria-sort", "ascending");
      });
    });

    // ===== 8. Màn hình View =====
    test.describe("Màn hình View", () => {
      test("Bấm icon View: sang /view/{id}, gọi rulesetting/view đúng id, breadcrumb 'Risk Management > Rule Details'", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const [req] = await Promise.all([page.waitForRequest(isView), actionIcons(rowAt(page, 0)).nth(ICON.view).click()]);
        expect(bodyOf(req)).toEqual({ id: x.id });
        await expect(page).toHaveURL(new RegExp(`/admin/risk-management/view/${x.id}$`));
        await expect(breadcrumb(page)).toContainText("Risk Management");
        await expect(breadcrumb(page)).toContainText("Rule Details");
        await expect(desc(page, "Rule Name")).toBeVisible();
      });

      test("Hiển thị đủ thông tin và khớp response rulesetting/view (Name, Severity, Categories, Games, Conditions, Channels, Description)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const d = await openRowAction(page, 0, ICON.view);

        await expect(desc(page, "Rule Name")).toHaveText(d.name);
        await expect(desc(page, "Severity")).toHaveText(d.severity);
        await expect(desc(page, "Game Categories")).toHaveText(d.gameCategorySelectAll === 1 ? "All Game Categories" : `${d.gameCategories.length} Game Categories`);
        await expect(desc(page, "Games")).toHaveText(d.gameSelectAll === 1 ? "All Games" : `${d.games.length} Games`);
        const condition = norm(await desc(page, "Conditions").innerText());
        for (const r of d.conditions.rules) expect(condition).toContain(`${r.type} ${r.operator} ${r.threshold}`);
        if (d.conditions.rules.length > 1) expect(condition.toUpperCase()).toContain(d.conditions.relation);
        const lines = (await desc(page, "Channels").locator("div > div").allInnerTexts()).map(norm).sort();
        expect(lines).toEqual(channelLinesView(d.channels));
        await expect(desc(page, "Description")).toHaveText(d.description ?? "");
      });

      test("Bấm link số category / game trên màn View mở modal liệt kê", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const d = await openRowAction(page, 0, ICON.view);
        await desc(page, "Game Categories").getByRole("button").click();
        await expect(modal(page)).toContainText(`Game Categories - ${norm(d.name)}`);
        await modal(page).locator(".ant-modal-close").click();
        await expect(modal(page)).toHaveCount(0);
        await desc(page, "Games").getByRole("button").click();
        // LƯU Ý: modal Games ở màn View có tiêu đề "Games" (KHÔNG kèm "- <tên rule>" như ở danh sách và như modal Game Categories ở màn View)
        await expect(modal(page)).toContainText("Games");
        await expect(modal(page)).toContainText(`(${d.games.length} Items)`);
        await modal(page).locator(".ant-modal-close").click();
        await expect(modal(page)).toHaveCount(0);
      });

      test("Link 'Risk Management' ở breadcrumb quay về danh sách", async ({ page }) => {
        await ensureData(page);
        await openRowAction(page, 0, ICON.view);
        await breadcrumb(page).getByRole("link", { name: "Risk Management" }).click();
        await expect(page).toHaveURL(/\/admin\/risk-management$/);
      });

      test("Màn View chỉ xem: không có nút Next / Submit / ô nhập", async ({ page }) => {
        await ensureData(page);
        await openRowAction(page, 0, ICON.view);
        await expect(page.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);
        await expect(page.locator("#name")).toHaveCount(0);
      });
    });

    // ===== 9. Hộp thoại Activate / Deactivate (request GIẢ) =====
    test.describe("Activate / Deactivate (response giả, không ghi thật)", () => {
      test("Bấm icon công tắc: hiện hộp thoại xác nhận đúng tên rule; Cancel không gửi request và không đổi trạng thái", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const verb = x.status === 1 ? "Deactivate" : "Activate";
        await actionIcons(rowAt(page, 0)).nth(ICON.toggle).click();
        await expect(modal(page)).toBeVisible();
        await expect(modal(page)).toContainText(`${verb} ${norm(x.name)}`);
        await expect(modal(page)).toContainText(`Are you sure you want to ${verb.toLowerCase()} this rule?`);
        await expect(modal(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
        await expect(modal(page).getByRole("button", { name: new RegExp(`${verb}$`) })).toBeVisible();

        await modal(page).getByRole("button", { name: /Cancel$/ }).click();
        await expect(modal(page)).toHaveCount(0);
        await expect(cellAt(page, 0, COL.status)).toHaveText(x.status === 1 ? "Active" : "Inactive");
        expect(writes).toEqual([]);
      });

      test("Xác nhận: gửi rulesetting/deactivate {ruleSettingIds:[id], status} và toast thành công", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await mockWrites(page, MOCK_STATUS_OK);
        allowedUrls.push("rulesetting/deactivate");
        const x = json.data.list[0];
        const verb = x.status === 1 ? "Deactivate" : "Activate";
        await actionIcons(rowAt(page, 0)).nth(ICON.toggle).click();
        const [req] = await Promise.all([page.waitForRequest(isStatus), modal(page).getByRole("button", { name: new RegExp(`${verb}$`) }).click()]);
        expect(bodyOf(req)).toEqual({ ruleSettingIds: [x.id], status: x.status === 1 ? 0 : 1 });
        await expect(toasts(page).filter({ hasText: MSG.statusUpdated })).toBeVisible();
        await expect(modal(page)).toHaveCount(0);
      });
    });

    // ===== 10. Form Add New (không ghi dữ liệu thật) =====
    test.describe("Form Add New (không ghi dữ liệu thật)", () => {
      test("Add New: sang /create, breadcrumb 'Risk Management > Create Rule', có đủ trường và nút Cancel / Next; Games bị khoá", async ({ page }) => {
        await openCreate(page);
        await expect(breadcrumb(page)).toContainText("Create Rule");
        await expect(page.locator(".ant-steps-item")).toHaveText([/Basic Information/, /Review & Submit/]);
        for (const id of ["name", "severity", "gameCategoryIds", "gameIds", ruleField(0, "type"), ruleField(0, "operator"), ruleField(0, "threshold"), "description"]) {
          await expect(page.locator(`#${id}`), id).toBeVisible();
        }
        await expect(channelWrapper(page, "Discord")).toBeVisible();
        await expect(channelWrapper(page, "Email")).toBeVisible();
        await expect(addConditionBtn(page)).toBeVisible();
        await expect(page.locator("#gameIds")).toBeDisabled();
        await expect(cancelBtn(page)).toBeVisible();
        await expect(nextBtn(page)).toBeVisible();
        await expect(prevBtn(page)).toHaveCount(0);
        await expect(channelBox(page, "Discord")).not.toBeChecked();
        await expect(channelBox(page, "Email")).not.toBeChecked();
      });

      test("Bấm Next khi để trống: báo đủ 8 lỗi bắt buộc và ở lại bước 1", async ({ page }) => {
        await openCreate(page);
        await nextBtn(page).click();
        await expect(fieldErrors(page)).toHaveText([
          MSG.required, // Rule Name
          MSG.required, // Severity
          MSG.required, // Game Categories
          MSG.required, // Games
          MSG.required, // Channels
          MSG.type,
          MSG.operator,
          MSG.threshold,
        ]);
        await expect(submitBtn(page)).toHaveCount(0);
        await expect(page).toHaveURL(/\/create$/);
        expect(writes).toEqual([]);
      });

      test("Rule Name: chỉ nhận 3-50 ký tự gồm chữ, số, khoảng trắng và <>=%-", async ({ page }) => {
        await openCreate(page);
        const nameError = formItem(page, "name").locator(".ant-form-item-explain-error");
        for (const bad of ["ab", "a!b", "rule@1", "x".repeat(51)]) {
          await nameInput(page).fill(bad);
          await expect(nameError, JSON.stringify(bad)).toHaveText(MSG.name);
        }
        for (const good of ["abc", "x".repeat(50), "QA <>=%- ok 1"]) {
          await nameInput(page).fill(good);
          await expect(nameError, JSON.stringify(good)).toHaveCount(0);
        }
      });

      test("Option của Severity / Game Categories / loại điều kiện / toán tử", async ({ page }) => {
        const { cats } = await openCreate(page);
        expect(await formOptions(page, "severity")).toEqual(FORM_SEVERITIES);
        const catOptions = await formOptions(page, "gameCategoryIds");
        expect(catOptions[0]).toBe("All Categories");
        expect(catOptions.length).toBeGreaterThan(1);
        if (cats) expect(catOptions.slice(1)).toEqual(cats.slice(0, catOptions.length - 1).map((c) => c.label));
        expect(await formOptions(page, ruleField(0, "type"))).toEqual(RULE_TYPE_OPTIONS);
        expect(await formOptions(page, ruleField(0, "operator"))).toEqual(OPERATORS);
      });

      test("Chọn category: gọi rulesetting/filter-game với đúng id, Games được mở và có 'All Games' + danh sách game", async ({ page }) => {
        const { cats } = await openCreate(page);
        const { catIds, games, game } = await pickCategoryAndGame(page);
        expect(catIds).toHaveLength(1);
        if (cats) expect(cats.map((c) => c.value)).toContain(catIds[0]);
        expect(games.length).toBeGreaterThan(0);
        await expectChips(page, "gameIds", [game.name]);

        await page.locator("#gameIds").click({ force: true });
        await openOptions(page).first().waitFor();
        const options = await optionTexts(page);
        expect(options[0]).toBe("All Games");
        expect(options.slice(1)).toEqual(games.slice(0, options.length - 1).map((g) => g.name));
        await titleEl(page).click();
      });

      test("Chọn 'All Categories': filter-game gửi gameCategoryIds [-1]; chọn 'All Games' thay cho từng game", async ({ page }) => {
        await openCreate(page);
        const fg = page.waitForRequest(isFilterGame);
        const fgRes = page.waitForResponse(isFilterGame);
        await pickFormOption(page, "gameCategoryIds", "All Categories");
        expect(bodyOf(await fg)).toEqual({ gameCategoryIds: [-1] });
        await fgRes; // chờ danh sách game nạp xong rồi mới mở ô Games (danh sách đang đổi thì option không ổn định để click)
        await expectChips(page, "gameCategoryIds", ["All Categories"]);
        await expect(page.locator("#gameIds")).toBeEnabled();
        await pickFormOption(page, "gameIds", "All Games");
        await expectChips(page, "gameIds", ["All Games"]);
      });

      test("Gõ tên vào ô Games thì danh sách option được lọc", async ({ page }) => {
        await openCreate(page);
        const { games } = await pickCategoryAndGame(page);
        const other = games.find((g) => g.name !== (games[0]?.name) && games.filter((x) => x.name === g.name).length === 1);
        test.skip(!other, "Không có game phụ để lọc");
        await page.locator("#gameIds").click({ force: true });
        await page.keyboard.type(other.name);
        expect(await optionTexts(page)).toContain(other.name);
        expect((await optionTexts(page)).length).toBeLessThanOrEqual(games.length);
        await titleEl(page).click();
      });

      test("Bỏ hết category thì Games bị khoá lại và mất lựa chọn", async ({ page }) => {
        await openCreate(page);
        await pickCategoryAndGame(page);
        await formItem(page, "gameCategoryIds").locator(".ant-select-selection-item-remove").first().click();
        await expect(formItem(page, "gameCategoryIds").locator(".ant-select-selection-item")).toHaveCount(0);
        await expect(page.locator("#gameIds")).toBeDisabled();
        await expect(formItem(page, "gameIds").locator(".ant-select-selection-item")).toHaveCount(0);
      });

      test("Channels: tick Email / Discord hiện ô nhập tương ứng, bỏ tick thì ẩn ô nhập", async ({ page }) => {
        await openCreate(page);
        for (const label of ["Email", "Discord"]) {
          await expect(channelInput(page, label)).toHaveCount(0);
          await channelWrapper(page, label).click();
          await expect(channelInput(page, label)).toBeVisible();
        }
        await channelWrapper(page, "Email").click();
        await expect(channelInput(page, "Email")).toHaveCount(0);
        await expect(channelInput(page, "Discord")).toBeVisible();
      });

      test("Không chọn kênh nào (tick rồi bỏ tick): báo 'Please select at least one channel'", async ({ page }) => {
        await openCreate(page);
        await channelWrapper(page, "Email").click();
        await channelWrapper(page, "Email").click();
        await nextBtn(page).click();
        await expect(formItem(page, "name").locator(".ant-form-item-explain-error")).toHaveText(MSG.required);
        await expect(page.locator(".ant-form-item").filter({ hasText: "Channels" }).first().locator(".ant-form-item-explain-error")).toHaveText(MSG.channel);
      });

      test("Conditions: Add condition thêm điều kiện 2 (có And / Or + nút xoá), tối đa 2 điều kiện, xoá được", async ({ page }) => {
        await openCreate(page);
        await expect(page.locator('[aria-label="delete"]')).toHaveCount(0);
        await addConditionBtn(page).click();
        await expect(threshold(page, 1)).toBeVisible();
        expect(await formOptions(page, "conditions_relation")).toEqual(["And", "Or"]);
        await expect(page.locator('[aria-label="delete"]')).toHaveCount(1);
        // Chỉ có 2 loại điều kiện nên tối đa 2 dòng: nút Add condition ẩn đi
        await expect(addConditionBtn(page)).toHaveCount(0);

        await page.locator('[aria-label="delete"]').click();
        await expect(threshold(page, 1)).toHaveCount(0);
        await expect(addConditionBtn(page)).toBeVisible();
      });

      test("Ngưỡng (threshold): chữ -> 'Please enter a valid number'; số âm / thập phân được chấp nhận ở client", async ({ page }) => {
        await openCreate(page);
        const err = formItem(page, ruleField(0, "threshold")).locator(".ant-form-item-explain-error");
        await threshold(page, 0).fill("abc");
        await expect(err).toHaveText(MSG.number);
        for (const ok of ["-5.5", "0", "999"]) {
          await threshold(page, 0).fill(ok);
          await expect(err, ok).toHaveCount(0);
        }
      });

      test("Bước Review: hiển thị đúng giá trị đã nhập; Previous quay lại bước 1 và giữ nguyên dữ liệu", async ({ page }) => {
        await openCreate(page);
        const name = `${QA_PREFIX}${Date.now()}`;
        const picked = await fillRuleForm(page, {
          name,
          severity: "Warning",
          channels: { Email: "qa-auto@example.com" },
          rules: [{ type: "TotalWinAmount", operator: ">", threshold: "123" }],
          description: "mô tả QA",
        });
        await goReview(page);
        await expect(desc(page, "Rule Name")).toHaveText(name);
        await expect(desc(page, "Severity")).toHaveText("WARNING");
        await expect(desc(page, "Game Categories")).toHaveText("1 Game Categories");
        await expect(desc(page, "Games")).toHaveText("1 Games");
        expect(norm(await desc(page, "Conditions").innerText())).toContain("TotalWinAmount > 123");
        await expect(desc(page, "Channels")).toContainText("Email: qa-auto@example.com");
        await expect(desc(page, "Description")).toHaveText("mô tả QA");

        await prevBtn(page).click();
        await expect(nameInput(page)).toHaveValue(name);
        await expectChips(page, "severity", ["Warning"]);
        await expectChips(page, "gameIds", [picked.game.name]);
        await expect(channelBox(page, "Email")).toBeChecked();
        await expect(channelInput(page, "Email")).toHaveValue("qa-auto@example.com");
        await expect(threshold(page, 0)).toHaveValue("123");
        await expect(descInput(page)).toHaveValue("mô tả QA");
        expect(writes).toEqual([]);
      });

      // HÀNH VI HIỆN TẠI CẦN XÁC NHẬN: client KHÔNG kiểm tra định dạng / bắt buộc của ô nhập kênh (Email / Discord):
      // email sai định dạng hoặc để trống vẫn qua bước Next sang Review (và khi Submit backend cũng nhận - đã kiểm thủ công với "not-an-email").
      test("Email sai định dạng hoặc để trống vẫn qua bước Next (không có validate ô nhập kênh)", async ({ page }) => {
        await openCreate(page);
        await fillRuleForm(page, { name: `${QA_PREFIX}${Date.now()}`, channels: { Email: "not-an-email" } });
        await goReview(page);
        await expect(desc(page, "Channels")).toContainText("Email: not-an-email");
        await prevBtn(page).click();
        await channelInput(page, "Email").fill("");
        await goReview(page);
        await expect(desc(page, "Channels")).toContainText("Email:");
        expect(writes).toEqual([]);
      });

      test("Cancel ở form Create quay về danh sách, không gửi request ghi", async ({ page }) => {
        await openCreate(page);
        await nameInput(page).fill(`${QA_PREFIX}cancel`);
        await cancelBtn(page).click();
        await expect(page).toHaveURL(/\/admin\/risk-management$/);
        expect(writes).toEqual([]);
      });

      test("Link 'Risk Management' ở breadcrumb của form Create quay về danh sách", async ({ page }) => {
        await openCreate(page);
        await breadcrumb(page).getByRole("link", { name: "Risk Management" }).click();
        await expect(page).toHaveURL(/\/admin\/risk-management$/);
      });

      test("Submit (response giả): payload rulesetting/create đúng, toast Success, về danh sách", async ({ page }) => {
        await mockWrites(page, MOCK_CREATE_OK);
        allowedUrls.push("rulesetting/create");
        await openCreate(page);
        const name = `${QA_PREFIX}MOCK ${Date.now()}`;
        const picked = await fillRuleForm(page, {
          name,
          severity: "Info",
          channels: { Email: "qa-mock@example.com" },
          rules: [{ type: "WinRate", operator: "<", threshold: "-50" }],
          description: "mock create",
        });
        await goReview(page);
        const [req] = await Promise.all([page.waitForRequest(isCreate), submitBtn(page).click()]);
        expect(bodyOf(req)).toEqual(
          createBody({
            name,
            severity: "INFO",
            description: "mock create",
            rules: [{ type: "WinRate", operator: "<", threshold: "-50" }],
            channels: [{ recipients: "qa-mock@example.com", channelType: "EMAIL" }],
            gameCategoryIds: picked.catIds,
            gameIds: [picked.game.id],
          }),
        );
        await expect(toasts(page).filter({ hasText: "Success" })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/risk-management$/);
      });

      test("Submit (response giả) với All Categories + All Games + 2 điều kiện Or + cả 2 kênh: payload đúng", async ({ page }) => {
        await mockWrites(page, MOCK_CREATE_OK);
        allowedUrls.push("rulesetting/create");
        await openCreate(page);
        const name = `${QA_PREFIX}MOCK2 ${Date.now()}`;
        await fillRuleForm(page, {
          name,
          severity: "Critical",
          allCategories: true,
          allGames: true,
          channels: { Discord: "https://discord.com/api/webhooks/qa-mock", Email: "qa-mock@example.com" },
          rules: [
            { type: "WinRate", operator: "<", threshold: "-10" },
            { type: "TotalWinAmount", operator: ">", threshold: "500", relation: "Or" },
          ],
        });
        await goReview(page);
        await expect(desc(page, "Game Categories")).toHaveText("All Game Categories");
        await expect(desc(page, "Games")).toHaveText("All Games");
        const [req] = await Promise.all([page.waitForRequest(isCreate), submitBtn(page).click()]);
        const body = bodyOf(req);
        expect(body).toEqual(
          createBody({
            name,
            severity: "CRITICAL",
            rules: [
              { type: "WinRate", operator: "<", threshold: "-10" },
              { type: "TotalWinAmount", operator: ">", threshold: "500" },
            ],
            relation: "OR",
            channels: expect.arrayContaining([
              { recipients: "https://discord.com/api/webhooks/qa-mock", channelType: "DISCORD" },
              { recipients: "qa-mock@example.com", channelType: "EMAIL" },
            ]),
            gameCategoryIds: [-1],
            gameIds: [-1],
          }),
        );
        expect(body.channels).toHaveLength(2);
      });

      test("Backend từ chối (response giả VALIDATION_FAILED): toast Error 'Validation failed' và ở lại màn Review", async ({ page }) => {
        await mockWrites(page, MOCK_VALIDATION);
        allowedUrls.push("rulesetting/create");
        await openCreate(page);
        await fillRuleForm(page, { name: `${QA_PREFIX}MOCK3 ${Date.now()}` });
        await goReview(page);
        await Promise.all([page.waitForRequest(isCreate), submitBtn(page).click()]);
        await expect(toasts(page).filter({ hasText: "Error" }).filter({ hasText: "Validation failed" })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/risk-management\/create$/);
      });
    });

    // ===== 11. Form Update (không ghi dữ liệu thật) =====
    test.describe("Form Update (không ghi dữ liệu thật)", () => {
      test("Update: sang /update/{id}, gọi rulesetting/view + filter-game, breadcrumb 'Update Rule', điền sẵn đúng dữ liệu của rule", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const d = await openRowAction(page, 0, ICON.update);

        await expect(nameInput(page)).toHaveValue(d.name);
        await expectChips(page, "severity", [cap(d.severity)]);
        if (d.gameCategorySelectAll !== 1) await expectChips(page, "gameCategoryIds", d.gameCategories.map((c) => c.name));
        if (d.gameSelectAll !== 1 && d.games.length <= 3) await expectChips(page, "gameIds", d.games.map((g) => g.name));
        for (const label of Object.keys(CHANNELS)) {
          const ch = d.channels.find((c) => c.channelType === CHANNELS[label]);
          if (ch) {
            await expect(channelBox(page, label), label).toBeChecked();
            await expect(channelInput(page, label), label).toHaveValue(ch.recipients);
          } else {
            await expect(channelBox(page, label), label).not.toBeChecked();
          }
        }
        for (const [i, r] of d.conditions.rules.entries()) {
          await expectChips(page, ruleField(i, "type"), [RULE_TYPES[r.type]]);
          await expectChips(page, ruleField(i, "operator"), [r.operator]);
          await expect(threshold(page, i)).toHaveValue(String(r.threshold));
        }
        await expect(descInput(page)).toHaveValue(d.description ?? "");
        await expect(cancelBtn(page)).toBeVisible();
        await expect(nextBtn(page)).toBeVisible();
      });

      test("Xoá Rule Name rồi Next: báo lỗi bắt buộc và ở lại bước 1", async ({ page }) => {
        await ensureData(page);
        await openRowAction(page, 0, ICON.update);
        await nameInput(page).fill("");
        await nextBtn(page).click();
        await expect(formItem(page, "name").locator(".ant-form-item-explain-error")).toHaveText(MSG.required);
        await expect(submitBtn(page)).toHaveCount(0);
      });

      test("Cancel ở form Update quay về danh sách, không gửi request ghi", async ({ page }) => {
        await ensureData(page);
        await openRowAction(page, 0, ICON.update);
        await cancelBtn(page).click();
        await expect(page).toHaveURL(/\/admin\/risk-management$/);
        expect(writes).toEqual([]);
      });

      test("Next sang Review rồi Previous giữ nguyên dữ liệu đang sửa", async ({ page }) => {
        await ensureData(page);
        const d = await openRowAction(page, 0, ICON.update);
        const newName = `${QA_PREFIX}EDIT ${Date.now()}`;
        await nameInput(page).fill(newName);
        await goReview(page);
        await expect(desc(page, "Rule Name")).toHaveText(newName);
        await expect(desc(page, "Severity")).toHaveText(d.severity);
        await prevBtn(page).click();
        await expect(nameInput(page)).toHaveValue(newName);
      });

      test("Submit (response giả): payload rulesetting/update có id + dữ liệu đã sửa, toast Success, về danh sách", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await mockWrites(page, MOCK_UPDATE_OK);
        allowedUrls.push("rulesetting/update");
        const d = await openRowAction(page, 0, ICON.update);
        const newName = `${QA_PREFIX}MOCKUPD ${Date.now()}`;
        await nameInput(page).fill(newName);
        await descInput(page).fill("mock update");
        await goReview(page);
        const [req] = await Promise.all([page.waitForRequest(isUpdate), submitBtn(page).click()]);
        const body = bodyOf(req);
        expect(String(body.id), "id gửi dạng chuỗi").toBe(String(d.id));
        expect(body).toMatchObject({ name: newName, severity: d.severity, description: "mock update" });
        expect(body.conditions.rules).toHaveLength(d.conditions.rules.length);
        expect(body.channels.length).toBe(d.channels.length);
        await expect(toasts(page).filter({ hasText: "Success" })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/risk-management$/);
      });
    });

    // ===== 12. Manage Columns =====
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
        await item(page, "Channels").locator("label").click();
        expect(await headers(page)).not.toContain("Channels");
        expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

        await item(page, "Channels").locator("label").click();
        expect(await headers(page)).toEqual(COLUMNS);
      });

      test("Ẩn nhiều cột cùng lúc", async ({ page }) => {
        await columnBtn(page).click();
        await item(page, "Games").locator("label").click();
        await item(page, "Channels").locator("label").click();
        expect(await headers(page)).toEqual(COLUMNS.filter((c) => c !== "Games" && c !== "Channels"));
      });

      test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
        await ensureData(page);
        const before = await columnValues(page, "Rule Name");
        await columnBtn(page).click();
        await item(page, "Games").locator("label").click();
        expect(await columnValues(page, "Rule Name")).toEqual(before);
      });
    });

    // ===== 13. Ghi nhớ filter =====
    test.describe("Ghi nhớ filter", () => {
      test("Filter được ghi nhớ sau khi reload trang", async ({ page }) => {
        await ensureData(page);
        await typeFilter(page, "name", "a");
        await selectOption(page, "severity", "Info");
        await selectOption(page, "channels", "Email");
        await selectOption(page, "status", "Active");
        const { body } = await search(page);

        const reqPromise = page.waitForRequest(isList);
        await openPage(page); // reload
        expect(bodyOf(await reqPromise).filters).toEqual(body.filters);
        await expect(page.locator("#name")).toHaveValue("a");
        expect(await selectedTitles(page, "severity")).toEqual(["Info"]);
        expect(await selectedTitles(page, "channels")).toEqual(["Email"]);
        expect(await selectedTitles(page, "status")).toEqual(["Active"]);
      });
    });
  });

  // ===== NHÓM CRUD (GHI DỮ LIỆU THẬT trên rule QA) =====
  test.describe("CRUD (ghi dữ liệu thật trên rule QA-AUTO, kết thúc ở Inactive)", () => {
    test.describe.configure({ mode: "serial" });

    let qa; // { id, name } - rule QA (tên bắt đầu QA-AUTO-<số>)

    // Lọc danh sách theo Rule Name rồi Search. Trả về { body, json }
    async function filterByName(page, name) {
      await typeFilter(page, "name", name);
      return search(page);
    }

    // Tìm rule QA (mới nhất) theo tiền tố. Trả về null nếu chưa có
    async function findQa(page) {
      const { json } = await filterByName(page, QA_PREFIX);
      const x = json.data.list.find((r) => new RegExp(`^${QA_PREFIX}\\d`).test(r.name));
      return x ? { id: x.id, name: x.name } : null;
    }

    // Tìm rule QA theo id (tên có thể đang là tên gốc hoặc tên tạm của test sửa). Trả về { x, json } với x = bản ghi của list
    async function findById(page, names) {
      for (const name of names) {
        const { json } = await filterByName(page, name);
        const x = json.data.list.find((r) => r.id === qa.id);
        if (x) return { x, json };
      }
      return { x: null };
    }

    // Mở lại danh sách (reload), lọc theo rule QA và trả về { x, index }
    async function openQaRow(page, names = [qa.name]) {
      await openPage(page);
      const { x, json } = await findById(page, names);
      expect(x, `Không thấy rule QA id ${qa.id} trong danh sách`).toBeTruthy();
      return { x, index: json.data.list.findIndex((r) => r.id === qa.id) };
    }

    // Bật / tắt rule QA qua hộp thoại xác nhận; kiểm tra request / response / toast / dòng trong danh sách
    async function toggleQa(page, index, from) {
      const verb = from === 1 ? "Deactivate" : "Activate";
      const to = from === 1 ? 0 : 1;
      await actionIcons(rowAt(page, index)).nth(ICON.toggle).click();
      await expect(modal(page)).toContainText(`${verb} ${qa.name}`);
      const [req, res] = await Promise.all([
        page.waitForRequest(isStatus),
        page.waitForResponse(isStatus),
        modal(page).getByRole("button", { name: new RegExp(`${verb}$`) }).click(),
      ]);
      expect(bodyOf(req), "chỉ được gửi lên đúng rule QA").toEqual({ ruleSettingIds: [qa.id], status: to });
      const json = await res.json();
      expect(json.status, `response: ${JSON.stringify(json)}`).toBe("success");
      expect(json.messageCode).toBe("UPDATE_RULE_SETTING_STATUS_SUCCESS");
      await expect(toasts(page).filter({ hasText: MSG.statusUpdated })).toBeVisible();
      await expect(modal(page)).toHaveCount(0);
      await settle(page); // app tải lại danh sách sau khi đổi trạng thái
      return to;
    }

    // Giá trị gốc của rule QA trước khi test sửa (để afterAll vẫn khôi phục được nếu test sửa bị timeout / lỗi giữa chừng)
    let origin;

    // Khôi phục Name / Severity / Description / ngưỡng điều kiện 1 của rule QA về giá trị gốc (chỉ ghi lên đúng rule QA). Không làm gì nếu chưa bị đổi
    async function restoreQa(page) {
      if (!origin) return;
      await openPage(page);
      const { x, json } = await findById(page, [qa.name, `${qa.name}-E`.slice(0, 50)]);
      if (!x || (x.name === origin.name && x.severity === origin.severity.toUpperCase() && x.conditions === origin.condition)) return;
      await actionIcons(rowAt(page, json.data.list.findIndex((r) => r.id === qa.id))).nth(ICON.update).click();
      await expect(page).toHaveURL(/\/admin\/risk-management\/update\/\d+$/);
      await expect(nameInput(page)).not.toHaveValue("");
      await nameInput(page).fill(origin.name);
      await pickFormOption(page, "severity", origin.severity);
      await descInput(page).fill(origin.description);
      await threshold(page, 0).fill(origin.threshold);
      await goReview(page);
      const [r, resp] = await Promise.all([page.waitForRequest(isUpdate), page.waitForResponse(isUpdate), submitBtn(page).click()]);
      expect(String(bodyOf(r).id), "chỉ được sửa đúng rule QA").toBe(String(qa.id));
      expect((await resp.json()).status).toBe("success");
      await expect(page).toHaveURL(/\/admin\/risk-management$/);
      await settle(page);
    }

    // Đưa rule QA về Inactive (dùng trong finally / afterAll). Chỉ ghi lên đúng rule QA
    async function ensureInactive(page) {
      await openPage(page);
      const { x, json } = await findById(page, [qa.name, `${qa.name}-E`.slice(0, 50)]);
      if (!x || x.status === 0) return;
      await toggleQa(page, json.data.list.findIndex((r) => r.id === qa.id), 1);
    }

    test.afterAll(async ({ browser }) => {
      test.setTimeout(120000);
      if (!qa) return;
      const ctx = await browser.newContext({ storageState: buildStorageState(), viewport: VIEWPORT });
      const page = await ctx.newPage();
      try {
        await page.addInitScript(() => {
          for (const k of Object.keys(localStorage)) {
            if (/admin_risk-management_(filter|page_size)$|^sorter__admin_risk-management$/.test(k)) localStorage.removeItem(k);
          }
        });
        await restoreQa(page);
        await ensureInactive(page);
      } finally {
        await ctx.close();
      }
    });

    test.beforeEach(async ({ page }) => {
      await openPage(page);
      test.setTimeout(240000); // test CRUD có nhiều bước ghi + tải lại danh sách (openPage đặt 90s)
    });

    // Mọi request ghi của nhóm này chỉ được nhắm vào rule QA (không bao giờ sửa rule có sẵn của team)
    test.afterEach(async () => {
      for (const w of writes) {
        expect(["rulesetting/create", "rulesetting/update", "rulesetting/deactivate"], "URL ghi không nằm trong danh sách").toContain(w.url);
        if (w.url === "rulesetting/create") expect(w.body.name, "create chỉ dùng name QA-AUTO-...").toMatch(new RegExp(`^${QA_PREFIX}`));
        if (w.url === "rulesetting/update") expect(String(w.body.id), "update phải nhắm đúng rule QA").toBe(String(qa.id));
        if (w.url === "rulesetting/deactivate") expect(w.body.ruleSettingIds, "deactivate phải nhắm đúng rule QA").toEqual([qa.id]);
      }
    });

    test("Tạo rule QA (chỉ khi CHƯA có rule QA-AUTO nào - rule không xoá được bằng UI): Submit gửi rulesetting/create, toast, về danh sách, dòng mới ở đầu", async ({ page }) => {
      qa = await findQa(page);
      test.skip(!!qa, `Đã có rule QA "${qa?.name}" (do lần chạy trước tạo) - không tạo thêm vì màn hình không có chức năng xoá`);

      await openCreate(page);
      const name = `${QA_PREFIX}${Date.now()}`;
      const picked = await fillRuleForm(page, {
        name,
        severity: "Info",
        channels: { Email: "qa-auto@example.com" },
        rules: [{ type: "WinRate", operator: "<", threshold: "-50" }],
        description: "QA auto rule",
      });
      await goReview(page);
      const [req, res] = await Promise.all([page.waitForRequest(isCreate), page.waitForResponse(isCreate), submitBtn(page).click()]);
      expect(bodyOf(req)).toEqual(
        createBody({
          name,
          severity: "INFO",
          description: "QA auto rule",
          rules: [{ type: "WinRate", operator: "<", threshold: "-50" }],
          channels: [{ recipients: "qa-auto@example.com", channelType: "EMAIL" }],
          gameCategoryIds: picked.catIds,
          gameIds: [picked.game.id],
        }),
      );
      const json = await res.json();
      expect(json.status, `response: ${JSON.stringify(json)}`).toBe("success");
      expect(json.messageCode).toBe("CREATE_RULE_SETTING_SUCCESS");
      await expect(toasts(page).filter({ hasText: MSG.created })).toBeVisible();
      await expect(page).toHaveURL(/\/admin\/risk-management$/);
      await settle(page);

      // Rule mới: tìm lại theo tên (response create không trả id)
      const { json: list } = await filterByName(page, name);
      expect(list.data.list).toHaveLength(1);
      expect(list.data.list[0]).toMatchObject({ name, severity: "INFO", status: 1, conditions: "WinRate < -50" });
      qa = { id: list.data.list[0].id, name };
      await expect(cellAt(page, 0, COL.name)).toHaveText(name);
    });

    test("Rule QA có trong danh sách: dòng khớp response (tên, điều kiện, severity, kênh, trạng thái) và lọc được theo Rule Name", async ({ page }) => {
      qa = qa ?? (await findQa(page));
      test.skip(!qa, "Chưa có rule QA");
      const { json } = await filterByName(page, qa.name);
      const i = json.data.list.findIndex((r) => r.id === qa.id);
      expect(i, "rule QA phải nằm trong kết quả lọc").toBeGreaterThanOrEqual(0);
      const x = json.data.list[i];
      const matrix = await tableMatrix(page);
      expect(matrix[i].cells[COL.name]).toBe(norm(x.name));
      expect(matrix[i].cells[COL.condition]).toBe(norm(x.conditions));
      expect(matrix[i].cells[COL.severity]).toBe(sevLabel(x.severity));
      expect([...matrix[i].lines[COL.channels]].sort()).toEqual(channelLinesList(x.channels));
      expect(matrix[i].cells[COL.status]).toBe(x.status === 1 ? "Active" : "Inactive");
    });

    test("View rule QA: hiển thị đúng Name / Severity / Conditions / Channels", async ({ page }) => {
      test.skip(!qa, "Chưa có rule QA");
      const { index } = await openQaRow(page);
      const d = await openRowAction(page, index, ICON.view);
      expect(d.id).toBe(qa.id);
      await expect(desc(page, "Rule Name")).toHaveText(d.name);
      await expect(desc(page, "Severity")).toHaveText(d.severity);
      await expect(desc(page, "Conditions")).toContainText(`${d.conditions.rules[0].type}`);
      expect((await desc(page, "Channels").locator("div > div").allInnerTexts()).map(norm).sort()).toEqual(channelLinesView(d.channels));
    });

    test("Sửa rule QA (Name / Severity / Description / ngưỡng điều kiện 1): Submit gửi rulesetting/update, toast, danh sách + View hiển thị giá trị mới; rồi khôi phục giá trị gốc", async ({ page }) => {
      test.skip(!qa, "Chưa có rule QA");
      const newName = `${qa.name}-E`.slice(0, 50);
      let original;
      try {
        const { index } = await openQaRow(page);
        const d = await openRowAction(page, index, ICON.update);
        original = origin = {
          name: d.name,
          severity: cap(d.severity),
          description: d.description ?? "",
          threshold: String(d.conditions.rules[0].threshold),
          condition: d.condition,
        };
        const newSeverity = FORM_SEVERITIES.find((s) => s !== original.severity);
        const old = Number(original.threshold);
        const newThreshold = String(old >= 999 ? old - 1 : old + 1);

        await nameInput(page).fill(newName);
        await pickFormOption(page, "severity", newSeverity);
        await descInput(page).fill("QA auto updated");
        await threshold(page, 0).fill(newThreshold);
        await goReview(page);
        const [req, res] = await Promise.all([page.waitForRequest(isUpdate), page.waitForResponse(isUpdate), submitBtn(page).click()]);
        const body = bodyOf(req);
        expect(String(body.id), "update phải nhắm đúng rule QA").toBe(String(qa.id));
        expect(body).toMatchObject({ name: newName, severity: SEVERITIES[newSeverity], description: "QA auto updated" });
        expect(Number(body.conditions.rules[0].threshold)).toBe(Number(newThreshold));
        const json = await res.json();
        expect(json.status, `response: ${JSON.stringify(json)}`).toBe("success");
        expect(json.messageCode).toBe("UPDATE_RULE_SETTING_SUCCESS");
        await expect(toasts(page).filter({ hasText: MSG.updated })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/risk-management$/);
        await settle(page);

        // Danh sách + View hiển thị giá trị mới
        const { json: after } = await filterByName(page, newName);
        const i = after.data.list.findIndex((r) => r.id === qa.id);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(after.data.list[i]).toMatchObject({ name: newName, severity: SEVERITIES[newSeverity] });
        await expect(cellAt(page, i, COL.name)).toHaveText(newName);
        await expect(cellAt(page, i, COL.severity)).toHaveText(newSeverity);
        const { index: i2 } = await openQaRow(page, [newName]); // reload để View lấy dữ liệu mới từ server (không dùng cache)
        const view = await openRowAction(page, i2, ICON.view);
        expect(view).toMatchObject({ id: qa.id, name: newName, severity: SEVERITIES[newSeverity], description: "QA auto updated" });
        expect(Number(view.conditions.rules[0].threshold)).toBe(Number(newThreshold));
      } finally {
        await restoreQa(page);
      }
      const { x } = await findById(page, [qa.name]);
      expect(x, "sau khi khôi phục rule QA phải mang lại tên gốc").toBeTruthy();
      expect(x.name).toBe(qa.name);
    });

    test("Deactivate / Activate rule QA: hộp thoại xác nhận, rulesetting/deactivate đúng id + status, toast, dòng đổi trạng thái + tooltip; Status filter phản ánh; kết thúc ở Inactive", async ({ page }) => {
      test.skip(!qa, "Chưa có rule QA");
      try {
        const { x, index } = await openQaRow(page);
        let status = x.status;
        // Bảo đảm bắt đầu từ Active để test cả 2 chiều
        if (status === 0) status = await toggleQa(page, index, 0);
        await filterByName(page, qa.name);
        await expect(cellAt(page, index, COL.status)).toHaveText("Active");

        // Cancel không gửi request
        const before = writes.length;
        await actionIcons(rowAt(page, index)).nth(ICON.toggle).click();
        await expect(modal(page)).toContainText(`Deactivate ${qa.name}`);
        await modal(page).getByRole("button", { name: /Cancel$/ }).click();
        await expect(modal(page)).toHaveCount(0);
        expect(writes.length).toBe(before);

        // Deactivate
        await toggleQa(page, index, 1);
        const { json: inactive } = await filterByName(page, qa.name);
        expect(inactive.data.list.find((r) => r.id === qa.id).status).toBe(0);
        await expect(cellAt(page, index, COL.status)).toHaveText("Inactive");
        await actionIcons(rowAt(page, index)).nth(ICON.toggle).hover();
        await expect(page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: exact("Activate") })).toBeVisible();
        // Status filter = Inactive chứa rule QA
        await selectOption(page, "status", "Inactive");
        const { json: byStatus } = await search(page);
        expect(byStatus.data.list.map((r) => r.id)).toContain(qa.id);
        await resetBodies(page);

        // Activate lại
        await filterByName(page, qa.name);
        await toggleQa(page, index, 0);
        const { json: active } = await filterByName(page, qa.name);
        expect(active.data.list.find((r) => r.id === qa.id).status).toBe(1);
        await expect(cellAt(page, index, COL.status)).toHaveText("Active");
      } finally {
        await ensureInactive(page);
      }
      const { x } = await findById(page, [qa.name]);
      expect(x.status, "rule QA phải kết thúc ở Inactive").toBe(0);
    });

    // HÀNH VI HIỆN TẠI CẦN XÁC NHẬN: tạo rule trùng tên bị backend từ chối nhưng với UNKNOWN_ERROR ("Unknown Error. Please contact your account manager.")
    // thay vì thông báo "tên đã tồn tại" như các màn hình khác (vd ROLE_NAME_EXIST) -> test chỉ khẳng định bị từ chối + không tạo thêm rule.
    test("Tạo rule trùng Name với rule QA: backend từ chối (status fail), toast Error, ở lại form, không tạo thêm rule", async ({ page }) => {
      test.skip(!qa, "Chưa có rule QA");
      const { json: before } = await filterByName(page, qa.name);
      const countBefore = before.data.totalCount;
      await openCreate(page);
      await fillRuleForm(page, { name: qa.name, allCategories: true, allGames: true, rules: [{ type: "WinRate", operator: "<", threshold: "-10" }] });
      await goReview(page);
      const [res] = await Promise.all([page.waitForResponse(isCreate), submitBtn(page).click()]);
      const json = await res.json();
      expect(json.status, `response: ${JSON.stringify(json)}`).toBe("fail");
      await expect(toasts(page).filter({ hasText: "Error" })).toBeVisible();
      await expect(page).toHaveURL(/\/admin\/risk-management\/create$/);

      await openPage(page);
      const { json: after } = await filterByName(page, qa.name);
      expect(after.data.totalCount, "không được tạo thêm rule trùng tên").toBe(countBefore);
    });

    // HÀNH VI HIỆN TẠI CẦN XÁC NHẬN: form KHÔNG kiểm tra khoảng của ngưỡng; chỉ backend từ chối (VALIDATION_FAILED, "Threshold must be between -999 and 999")
    test("Ngưỡng ngoài khoảng -999..999 khi tạo: backend từ chối VALIDATION_FAILED, toast Error 'Validation failed', không tạo rule", async ({ page }) => {
      test.skip(!qa, "Chưa có rule QA");
      await openCreate(page);
      const name = `${QA_PREFIX}RANGE ${Date.now()}`;
      await fillRuleForm(page, { name, allCategories: true, allGames: true, rules: [{ type: "WinRate", operator: "<", threshold: "-1000" }] });
      await goReview(page);
      const [res] = await Promise.all([page.waitForResponse(isCreate), submitBtn(page).click()]);
      const json = await res.json();
      expect(json.status, `response: ${JSON.stringify(json)}`).toBe("fail");
      expect(json.messageCode).toBe("VALIDATION_FAILED");
      expect(json.validation["Conditions.Rules[0].Threshold"]).toEqual(["Threshold must be between -999 and 999"]);
      await expect(toasts(page).filter({ hasText: "Error" }).filter({ hasText: "Validation failed" })).toBeVisible();
      await expect(page).toHaveURL(/\/admin\/risk-management\/create$/);

      await openPage(page);
      const { json: after } = await filterByName(page, name);
      expect(after.data.totalCount).toBe(0);
    });

    test("Ngưỡng ngoài khoảng khi sửa rule QA: backend từ chối, rule QA không đổi", async ({ page }) => {
      test.skip(!qa, "Chưa có rule QA");
      const { index } = await openQaRow(page);
      const d = await openRowAction(page, index, ICON.update);
      await threshold(page, 0).fill("1000");
      await goReview(page);
      const [res] = await Promise.all([page.waitForResponse(isUpdate), submitBtn(page).click()]);
      const json = await res.json();
      expect(json.status, `response: ${JSON.stringify(json)}`).toBe("fail");
      expect(json.messageCode).toBe("VALIDATION_FAILED");
      await expect(toasts(page).filter({ hasText: "Error" }).filter({ hasText: "Validation failed" })).toBeVisible();
      await expect(page).toHaveURL(/\/admin\/risk-management\/update\/\d+$/);

      const { index: i2 } = await openQaRow(page);
      const view = await openRowAction(page, i2, ICON.view);
      expect(String(view.conditions.rules[0].threshold)).toBe(String(d.conditions.rules[0].threshold));
    });
  });
});
