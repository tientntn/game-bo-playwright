// Download History  (https://dev-bo.royaledge.io/download-history)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/download_history.spec.js --project=setup --project=chromium
//
// Màn hình danh sách "Download History": các file Export (CSV) do user đang đăng nhập yêu cầu từ các màn hình khác (API POST download/list,
// body {page,pageSize,sortBy,sortDirection,filters,timezoneId}; response data.list[{downloadId,module,section,fileName,fileSize,startTime,endTime,timezone,status,requestedBy,duration,link}] + data.totalCount).
//  - Filter: Time ("startTime", khoảng ngày giờ, CHỈ 3 preset Today / Yesterday / Last 7 Days; gửi lên dạng ["yyyy-MM-dd 00:00:00", "<ngày cuối + 1> 00:00:00"]),
//    Module ("module", chọn 1: Administration Agent "Developer Toolkit" Games House "Master Agent" Players Reports; gửi dạng enum IN HOA, riêng Developer Toolkit gửi "TOOL_KIT"),
//    ID ("downloadId", ô nhập, khớp CHÍNH XÁC, gửi dạng số), Status ("status", chọn 1: Completed = 1, Error = -1, Processing = 0). Filter rỗng thì KHÔNG gửi key đó.
//  - Bảng 13 cột: (checkbox) / ID / Module / Section / File Name / Size / Start Time / End Time / Timezone / Created By / Created Time / Status / Action.
//    Sort được 9 cột (mọi lần click đều gọi API, chu kỳ asc -> desc -> về mặc định id desc): ID (downloadId), Module, Section, File Name, Size (fileSize), Start Time, End Time,
//    Created Time (sort theo startTime - cột này luôn trùng giá trị Start Time), Status. Không sort: checkbox, Timezone, Created By, Action.
//    Size hiển thị đã định dạng (Bytes / KB / MB); End Time trống hiển thị "-"; Status: Completed (tag xanh, kèm icon (i) "File expires in 7 days"), Error (= ABORTED, tag đỏ), Processing.
//    Section hiển thị theo bảng ánh xạ cố định (không phải quy tắc chung) - xem SECTION_TEXT.
//  - Cột Action: icon Download (thẻ <a href> trỏ thẳng link S3 presigned, hết hạn 7 ngày; tooltip "Download"; bản ghi Error thì ẩn) và icon Delete (tooltip "Delete").
//  - Chọn dòng: checkbox từng dòng + checkbox ở header (chọn cả trang). Nút thùng rác (bulk delete) chỉ bật khi có dòng được chọn -> hộp thoại "Delete N files" -> POST download/delete {ids:[...]}.
//    Delete từng dòng: hộp thoại "Delete downloaded file with id N" -> cùng API download/delete {ids:[N]}.
//  - Manage Columns: chỉ có checkbox ẩn / hiện cột (không có Save / Reset to Default), không lưu sau reload. Không có Add / Update / Export / Details.
//  - Filter (mã hoá) và số dòng / trang được lưu ở localStorage (key DEV-download-history_filter / _page_size) nên còn nguyên sau reload.
//
// AN TOÀN DỮ LIỆU:
//  - Dữ liệu Download History là dữ liệu của chính tài khoản đăng nhập (tạo bởi các lần Export của test khác). Mọi describe trừ cuối là "chỉ đọc": request ghi (download/delete, download) bị chặn
//    ở tầng mạng (route.abort); test kiểm tra payload / thông báo của Delete dùng response GIẢ (request KHÔNG tới server). afterEach so sánh chính xác request ghi bắt được (watchWrites) với allowedWrites.
//    Click icon Download chỉ GET file từ S3 (đọc), không đổi dữ liệu.
//  - Describe cuối "CRUD (ghi dữ liệu thật)" chạy tuần tự, CHỈ thao tác trên file do chính test tạo: Export từ màn Administration > Currency với Code lọc ngẫu nhiên "QZ<8 số cuối timestamp>"
//    (không có currency nào khớp nên file CSV chỉ có dòng tiêu đề, vài chục byte). Mỗi bản ghi tạo ra được nhớ id và xoá lại bằng UI (Delete / bulk Delete) trong finally; afterAll quét nốt
//    các id còn sót. afterEach kiểm tra mọi request ghi chỉ là Export Currency với code QZ... hoặc download/delete các id đã tạo.
//    Các test này tạo bản ghi tạm ở Download History (xoá lại ngay) và gọi Export thật (tạo file CSV trên S3 của dev).
//  - Không hard-code dữ liệu: id / file / module lấy từ response list.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/download-history";
const CURRENCY_URL = "/admin/currency";
const ORIGIN = "https://dev-bo.royaledge.io";

// Đúng thứ tự hiển thị (cột đầu là checkbox có header rỗng)
const COLUMNS = ["", "ID", "Module", "Section", "File Name", "Size", "Start Time", "End Time", "Timezone", "Created By", "Created Time", "Status", "Action"];
const COL = { check: 0, id: 1, module: 2, section: 3, fileName: 4, size: 5, startTime: 6, endTime: 7, timezone: 8, createdBy: 9, createdTime: 10, status: 11, action: 12 };
const MANAGE_COLUMNS = COLUMNS.slice(1); // popover Manage Columns không có cột checkbox
// Cột sort được -> sortBy gửi API
const SORTABLE = {
  ID: "downloadId",
  Module: "module",
  Section: "section",
  "File Name": "fileName",
  Size: "fileSize",
  "Start Time": "startTime",
  "End Time": "endTime",
  "Created Time": "startTime",
  Status: "status",
};
const NOT_SORTABLE = ["", "Timezone", "Created By", "Action"];
const FILTERS = [
  ["startTime_0", "Time"],
  ["module", "Module"],
  ["downloadId", "ID"],
  ["status", "Status"],
];
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
const PRESETS = ["Today", "Yesterday", "Last 7 Days"];
// Option cố định (không có API dropdown): nhãn -> giá trị gửi API
const MODULES = {
  Administration: "ADMINISTRATION",
  Agent: "AGENT",
  "Developer Toolkit": "TOOL_KIT",
  Games: "GAMES",
  House: "HOUSE",
  "Master Agent": "MASTER_AGENT",
  Players: "PLAYERS",
  Reports: "REPORTS",
};
// Status: nhãn hiển thị -> { filters.status, status trong response, class của tag }
const STATUSES = {
  Completed: { filter: 1, api: "COMPLETED", cls: /tag-success/ },
  Error: { filter: -1, api: "ABORTED", cls: /tag-error/ },
  Processing: { filter: 0, api: "PROCESSING", cls: null },
};
const STATUS_TEXT = { COMPLETED: "Completed", ABORTED: "Error", PROCESSING: "Processing" };
// Section hiển thị: bảng ánh xạ cố định của app (không có quy tắc chung: "Report" / "Reports" lẫn lộn, REPORTS_GAME_RECOMMENDATION hiện nguyên enum)
const SECTION_TEXT = {
  ADMINISTRATION_CURRENCY: "Administration Currency",
  AGENT_PLAYERS_LIST: "Agent Players List",
  AGENT_LIST: "Agent List",
  MASTER_AGENT_LIST: "Master Agent List",
  HOUSE_LIST: "House List",
  EFFECTIVE_TURNOVER_EXCLUSION_LIST: "Effective Turnover Exclusion List",
  GAME_LIST: "Game List",
  REPORTS_GAME_RECOMMENDATION: "REPORTS_GAME_RECOMMENDATION",
  PROMO_REPORT: "Promotion Report",
  OPERATOR_REQUEST_DOWNLOAD: "Operator Request Download",
  REPORTS_GAME_FS_SUMMARY: "Report Game Free Spin Summary",
  REPORTS_GAME_SUMMARY: "Reports Game Summary",
  REPORTS_PLAYER_SUMMARY: "Report Player Summary",
  REPORTS_PLAYER_FS_SUMMARY: "Report Player Free Spin Summary",
  REPORTS_BET_HISTORY: "Reports Bet History",
};
const DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const MSG = {
  noEntries: "There are no entries found",
  expire: "File expires in 7 days",
  deleteOne: (id) => `Delete downloaded file with id ${id}`,
  deleteOneText: "Are you sure you want to delete this file?",
  deleteBulkOneText: "Are you sure you want to delete this downloaded file?",
  deleteN: (n) => `Delete ${n} files`,
  deleteNText: (n) => `Are you sure you want to delete ${n} files?`,
  processing: /Download is processing\. Please check ID:(\d+) in download history/,
};
const QA_CODE_PREFIX = "QZ";

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI (download = Export, download/delete = xoá)
// (download/status là request app tự gọi định kỳ để cập nhật trạng thái Processing -> Completed)
const READ = /\/(list|details|view|status)(\?|$)|\/dropdown\/|_dropdown(\?|$)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/download/list");
const isDelete = endsWith("/download/delete");
const isDownload = endsWith("/download");
const isCurrencyList = endsWith("/currency/list");

const exact = (s) => new RegExp(`^\\s*${String(s).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};
// "10-11-2026 00:00:00" -> "2026-11-10 00:00:00"
const toIso = (s) => s.replace(/^(\d{2})-(\d{2})-(\d{4})/, "$3-$2-$1");
// "2026-11-10 ..." -> Date (UTC, chỉ lấy phần ngày)
const parseDay = (s) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const dayStr = (date) => date.toISOString().slice(0, 10);
const addDays = (s, n) => dayStr(new Date(parseDay(s).getTime() + n * 86400000));
const diffDays = (a, b) => Math.round((parseDay(a) - parseDay(b)) / 86400000);
// Size hiển thị: 22 -> "22 Bytes", 6543 -> "6.39 KB", 1665853 -> "1.59 MB" (tối đa 2 số lẻ, bỏ số 0 thừa); "" -> "0 Bytes"
function fmtSize(raw) {
  const n = Number(raw || 0);
  if (n < 1024) return `${n} Bytes`;
  if (n < 1024 * 1024) return `${parseFloat((n / 1024).toFixed(2))} KB`;
  return `${parseFloat((n / 1024 / 1024).toFixed(2))} MB`;
}

// Bảng chính (header + body nằm trong cùng .ant-table đầu tiên)
const table = (page) => page.locator(".ant-table").first();
const rows = (page) => table(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
const rowOfId = (page, id) => rows(page).filter({ has: page.locator("td:nth-child(2)").filter({ hasText: exact(id) }) });
const th = (page, name) => table(page).locator("thead th").filter({ hasText: exact(name) });
const rowCheckbox = (row) => row.locator("td").first().locator("input[type=checkbox]");
const headerCheckbox = (page) => table(page).locator("thead input[type=checkbox]");
// Cột Action: 0 = Download (svg trong thẻ <a>), 1 = Delete (thùng rác đỏ)
const downloadLink = (row) => row.locator("td").nth(COL.action).locator("a");
const downloadIcon = (row) => row.locator("td").nth(COL.action).locator("svg").nth(0);
const deleteIcon = (row) => row.locator("td").nth(COL.action).locator("svg").nth(1);
const expireIcon = (row) => row.locator(".tooltip-expire__icon");
const bulkDeleteBtn = (page) => page.locator("button.NextGen-button-more-action__update");

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const pageSizeSelect = (page) => page.locator(".ant-pagination-options .ant-select");
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
const filterEl = (page, id) => page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
const dateRangeInput = (page) => page.locator("#startTime_dateRange");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const toasts = (page) => page.locator(".Toastify__toast");
const tooltip = (page, text) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: exact(text) });
// Hộp thoại Delete (1 dòng: .NextGen-modal-delete; bulk: class khác) -> dùng chung .ant-modal-content (chỉ có 1 hộp thoại mở tại 1 thời điểm)
const dialog = (page) => page.locator(".ant-modal-content");
// Tên accessible của nút có thể kèm icon ("close Cancel") -> khớp phần cuối
const dlgConfirm = (page) => dialog(page).getByRole("button", { name: /Delete$/ });
const dlgCancel = (page) => dialog(page).getByRole("button", { name: /Cancel$/ });

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-table-wrapper .ant-spin-spinning")).toHaveCount(0);
}

// Khi filter vừa đổi, Search đôi khi gửi 2 request list GIỐNG HỆT nhau cách nhau ~200ms: chờ mạng yên sau mỗi lần gọi
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

// Bấm Search, trả về { body, status, json }. Lấy response từ chính request vừa gửi (json = null nếu server trả lỗi không phải JSON)
async function search(page) {
  const [req] = await Promise.all([page.waitForRequest(isList), searchBtn(page).click()]);
  const res = await req.response();
  const json = await res.json().catch(() => null);
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

// Toàn bộ ô của bảng ở trang hiện tại: [{ cells: [text...], href, status: { text, cls }, ... }]
const tableMatrix = (page) =>
  rows(page).evaluateAll((trs) =>
    trs.map((tr) => ({
      cells: [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()),
      href: tr.children[12].querySelector("a")?.getAttribute("href") ?? null,
      tagClass: tr.children[11].querySelector(".ant-tag")?.className ?? "",
      hasExpire: !!tr.children[11].querySelector(".tooltip-expire"),
    })),
  );

// Mở dropdown của 1 filter bằng cách click vào LABEL của ô (không click giữa ô)
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (theo text) của filter dạng dropdown chọn 1, rồi click ra ngoài để chắc chắn dropdown đóng
async function selectOption(page, id, text) {
  await openDropdown(page, id);
  await openOptions(page).filter({ hasText: exact(text) }).first().click();
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

// Giá trị đang chọn của 1 filter dropdown chọn 1
const selectedTitles = (page, id) =>
  filterEl(page, id)
    .locator(".ant-select-selection-item[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));

// Gõ vào filter dạng input (ID): input bị ẩn cho tới khi click label
async function typeFilter(page, id, value) {
  await filterEl(page, id).locator("label").first().click();
  await page.locator(`#${id}`).fill(value);
}

// Chọn preset ngày (Today / Yesterday / Last 7 Days) cho Time
async function pickDatePreset(page, preset) {
  await filterEl(page, "startTime_0").locator("label").first().click();
  // Popup của picker đang mở luôn được append SAU cùng trong DOM -> .last()
  await page.locator(".NextGen-datetime-preset__item").filter({ hasText: preset }).last().click();
  // Popup không tự đóng: click ra ngoài (tiêu đề trang) để đóng
  await breadcrumb(page).click();
}

// Xoá Time bằng nút (x) (chỉ render khi rê chuột vào ô ngày)
async function clearDate(page) {
  await filterEl(page, "startTime_0").hover();
  await filterEl(page, "startTime_0").locator('[aria-label="close-circle"]').click({ force: true });
}

// Có dữ liệu thì mới test tiếp
async function ensureData(page) {
  test.skip((await rows(page).count()) === 0, "Download History không có bản ghi nào để test");
}

// Đổi số dòng / trang
async function setPageSize(page, label) {
  await pageSizeSelect(page).click();
  return reloadFull(page, () => openOptions(page).filter({ hasText: label }).click());
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

// Dùng cho test kiểm tra payload / thông báo: request ghi vẫn KHÔNG tới server thật, được trả về response GIẢ
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

// Nạp 1 trang 100 dòng (chỉ để đọc nhiều dòng cùng lúc) -> trả về { list, totalCount }; số dòng / trang này bị app lưu nhưng beforeEach xoá ở test sau
async function loadMany(page) {
  const { json } = await setPageSize(page, "100 / page");
  return json.data;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Download History", () => {
  let writes;
  let allowedWrites; // request ghi được phép (chỉ các test dùng response giả; request KHÔNG tới server thật)

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, số dòng/trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__download_history_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/download-history_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__download_history_spec_cleared", "1");
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
      test("Có tiêu đề 'Download History'", async ({ page }) => {
        await expect(breadcrumb(page)).toHaveText("Download History");
      });

      test("Có đủ 4 filter và 2 nút Search/Reset", async ({ page }) => {
        await expect(page.locator(".NextGen-filter-element")).toHaveCount(FILTERS.length);
        for (const [id, label] of FILTERS) await expect(filterEl(page, id), id).toContainText(label);
        await expect(searchBtn(page)).toBeVisible();
        await expect(resetBtn(page)).toBeVisible();
      });

      test("Loại filter: ID là ô nhập chữ; Module / Status chọn 1 (không chọn nhiều); Time là khoảng ngày", async ({ page }) => {
        await expect(filterEl(page, "downloadId").locator("input")).toHaveCount(1);
        await expect(filterEl(page, "downloadId").locator(".ant-select")).toHaveCount(0);
        for (const id of ["module", "status"]) {
          await expect(filterEl(page, id).locator(".ant-select"), id).toHaveCount(1);
          await expect(filterEl(page, id).locator(".ant-select-multiple"), id).toHaveCount(0);
        }
        await expect(filterEl(page, "startTime_0").locator("#startTime_dateRange")).toHaveCount(1);
      });

      test("Giá trị filter mặc định: tất cả để trống", async ({ page }) => {
        await expect(dateRangeInput(page)).toHaveValue("");
        await expect(page.locator("#downloadId")).toHaveValue("");
        for (const id of ["module", "status"]) {
          await expect(filterEl(page, id).locator(".ant-select-selection-item"), `#${id} phải trống`).toHaveCount(0);
        }
      });

      test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự, có Manage Columns và nút xoá hàng loạt, không có Add New / Export`, async ({ page }) => {
        expect(await headers(page)).toEqual(COLUMNS);
        await expect(columnBtn(page)).toBeVisible();
        await expect(bulkDeleteBtn(page)).toBeVisible();
        await expect(page.getByRole("button", { name: /Add New/ })).toHaveCount(0);
        await expect(page.locator("button.NextGen-export-button")).toHaveCount(0);
      });

      test("Mặc định: trang 1, 10 dòng, sort id giảm dần, filters rỗng và có timezoneId", async ({ page }) => {
        const { body, status, json } = await search(page);
        expect(status).toBe(200);
        expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: {} });
        expect(body.timezoneId).toEqual(expect.any(Number));
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

      test("Mặc định chưa chọn dòng nào: checkbox bỏ chọn và nút xoá hàng loạt bị vô hiệu", async ({ page }) => {
        await ensureData(page);
        await expect(table(page).locator("tbody input[type=checkbox]:checked")).toHaveCount(0);
        await expect(headerCheckbox(page)).not.toBeChecked();
        await expect(bulkDeleteBtn(page)).toBeDisabled();
      });
    });

    // ===== 2. Dữ liệu bảng =====
    test.describe("Dữ liệu bảng", () => {
      test("Mỗi dòng khớp response API (ID, Module, Section, File Name, Size, Start / End Time, Timezone, Created By, Created Time, Status)", async ({
        page,
      }) => {
        const { json } = await search(page);
        const list = json.data.list;
        test.skip(list.length === 0, "Không có dữ liệu");
        await expect(rows(page)).toHaveCount(list.length);
        const matrix = await tableMatrix(page);
        for (const [i, x] of list.entries()) {
          const at = `dòng ${i + 1} (download ${x.downloadId})`;
          const c = matrix[i].cells;
          expect(SECTION_TEXT, `${at}: section ${x.section} chưa có trong bảng ánh xạ SECTION_TEXT`).toHaveProperty(x.section);
          expect(STATUS_TEXT, `${at}: status ${x.status} chưa có trong STATUS_TEXT`).toHaveProperty(x.status);
          expect(c[COL.id], at).toBe(String(x.downloadId));
          expect(c[COL.module], at).toBe(x.module);
          expect(c[COL.section], at).toBe(SECTION_TEXT[x.section]);
          expect(c[COL.fileName], at).toBe(norm(x.fileName));
          expect(c[COL.size], at).toBe(fmtSize(x.fileSize));
          expect(c[COL.startTime], at).toBe(x.startTime);
          expect(c[COL.endTime], at).toBe(x.endTime || "-");
          expect(c[COL.timezone], at).toBe(norm(x.timezone));
          expect(c[COL.createdBy], at).toBe(norm(x.requestedBy));
          expect(c[COL.createdTime], at).toBe(x.startTime); // cột Created Time luôn trùng Start Time
          expect(c[COL.status], at).toBe(STATUS_TEXT[x.status]);
        }
      });

      test("Định dạng: ngày giờ yyyy-MM-dd HH:mm:ss, Timezone dạng '(GMT +hh:mm) ...', Size dạng Bytes / KB / MB, Module IN HOA", async ({ page }) => {
        await ensureData(page);
        for (const col of ["Start Time", "Created Time"]) for (const v of await columnValues(page, col)) expect(v, col).toMatch(DATETIME);
        for (const v of await columnValues(page, "End Time")) expect(v, "End Time").toMatch(new RegExp(`${DATETIME.source}|^-$`));
        for (const v of await columnValues(page, "Timezone")) expect(v).toMatch(/^\(GMT [+-]\d{2}:\d{2}\) \S/);
        for (const v of await columnValues(page, "Size")) expect(v).toMatch(/^\d+(\.\d{1,2})? (Bytes|KB|MB|GB)$/);
        for (const v of await columnValues(page, "Module")) expect(v).toMatch(/^[A-Z_]+$/);
        for (const v of await columnValues(page, "Created By")) expect(v).not.toBe("");
      });

      test("Ràng buộc dữ liệu: ID không trùng, mặc định id giảm dần, End Time >= Start Time, Created Time = Start Time", async ({ page }) => {
        const { json } = await search(page);
        const list = json.data.list;
        test.skip(list.length < 2, "Không đủ dữ liệu");
        const ids = list.map((x) => x.downloadId);
        expect(ids).toEqual([...ids].sort((a, b) => b - a));
        expect(new Set(ids).size).toBe(ids.length);
        for (const x of list.filter((l) => l.endTime)) expect(x.endTime >= x.startTime, `download ${x.downloadId}`).toBe(true);
        expect(await columnValues(page, "Created Time")).toEqual(await columnValues(page, "Start Time"));
      });

      // QUAN SÁT: enum section REPORTS_GAME_RECOMMENDATION chưa có nhãn nên hiện nguyên enum (các section khác hiện chữ thường dễ đọc); test này chỉ ghi nhận
      // hiện trạng của bảng ánh xạ SECTION_TEXT. Nếu app bổ sung nhãn thì sửa SECTION_TEXT.
      test("Section: chỉ hiển thị nhãn thân thiện, ngoại trừ enum chưa có nhãn hiện nguyên enum (ghi nhận hiện trạng)", async ({ page }) => {
        await ensureData(page);
        const values = await columnValues(page, "Section");
        const raw = values.filter((v) => /^[A-Z_]+$/.test(v));
        for (const v of raw) expect(Object.values(SECTION_TEXT).filter((t) => /^[A-Z_]+$/.test(t)), `${v} hiện nguyên enum`).toContain(v);
      });

      test("Trạng thái: tag đúng màu (Completed xanh, Error đỏ); chỉ Completed có icon (i) 'File expires in 7 days'", async ({ page }) => {
        await ensureData(page);
        const matrix = await tableMatrix(page);
        for (const [i, m] of matrix.entries()) {
          const at = `dòng ${i + 1}`;
          const s = Object.entries(STATUSES).find(([label]) => label === m.cells[COL.status]);
          expect(s, `${at}: status "${m.cells[COL.status]}" không hợp lệ`).toBeTruthy();
          if (s[1].cls) expect(m.tagClass, at).toMatch(s[1].cls);
          expect(m.hasExpire, `${at}: icon expire chỉ có ở Completed`).toBe(m.cells[COL.status] === "Completed");
        }
      });

      test("Hover icon (i) cạnh Completed hiện tooltip 'File expires in 7 days'", async ({ page }) => {
        await ensureData(page);
        const i = (await tableMatrix(page)).findIndex((m) => m.hasExpire);
        test.skip(i < 0, "Không có bản ghi Completed ở trang đầu");
        await expireIcon(rowAt(page, i)).hover();
        await expect(tooltip(page, MSG.expire)).toBeVisible();
      });

      test("Cột Action: mỗi dòng có icon Delete; bản ghi Completed có link Download trỏ đúng link S3 (hết hạn 7 ngày) và tooltip 'Download'", async ({ page }) => {
        const { json } = await search(page);
        const list = json.data.list;
        test.skip(list.length === 0, "Không có dữ liệu");
        const matrix = await tableMatrix(page);
        let checked = false;
        for (const [i, x] of list.entries()) {
          await expect(deleteIcon(rowAt(page, i)), `dòng ${i + 1}: icon Delete`).toBeVisible();
          if (x.status !== "COMPLETED" || !x.link) continue;
          checked = true;
          expect(matrix[i].href, `dòng ${i + 1}: href`).toBe(x.link);
          expect(x.link).toMatch(/^https:\/\/[^/]+\.s3\.[^/]+\.amazonaws\.com\/.+X-Amz-Expires=604800/);
          await expect(downloadLink(rowAt(page, i))).toBeVisible();
        }
        test.skip(!checked, "Không có bản ghi Completed ở trang đầu");
        const first = list.findIndex((x) => x.status === "COMPLETED" && x.link);
        await downloadIcon(rowAt(page, first)).hover();
        await expect(tooltip(page, "Download")).toBeVisible();
      });

      test("Hover icon thùng rác của dòng hiện tooltip 'Delete'", async ({ page }) => {
        await ensureData(page);
        await deleteIcon(rowAt(page, 0)).hover();
        await expect(tooltip(page, "Delete")).toBeVisible();
      });

      test("Click icon Download tải về file CSV có tên bắt đầu bằng File Name của dòng (chỉ đọc file từ S3)", async ({ page }) => {
        const { json } = await search(page);
        const i = json.data.list.findIndex((x) => x.status === "COMPLETED" && x.link);
        test.skip(i < 0, "Không có bản ghi Completed ở trang đầu");
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), downloadIcon(rowAt(page, i)).click()]);
        expect(dl.suggestedFilename()).toMatch(new RegExp(`^${json.data.list[i].fileName}`));
        expect(dl.suggestedFilename()).toMatch(/\.csv$/i);
        await expect(page).toHaveURL(new RegExp(`${URL}$`)); // không điều hướng đi đâu
      });

      test("Bản ghi Error (nếu có): không có icon Download (ẩn), không có icon 'File expires', size '0 Bytes', End Time '-', vẫn xoá được", async ({ page }) => {
        await selectOption(page, "status", "Error");
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có bản ghi Error");
        for (const i of json.data.list.keys()) {
          await expect(downloadLink(rowAt(page, i)), `dòng ${i + 1}`).toBeHidden();
          await expect(expireIcon(rowAt(page, i))).toHaveCount(0);
          await expect(deleteIcon(rowAt(page, i))).toBeVisible();
        }
        const x = json.data.list[0];
        if (!x.fileSize) await expect(cellAt(page, 0, COL.size)).toHaveText("0 Bytes");
        if (!x.endTime) await expect(cellAt(page, 0, COL.endTime)).toHaveText("-");
        if (!x.fileName) await expect(cellAt(page, 0, COL.fileName)).toHaveText("");
      });
    });

    // ===== 3. Search / Filter =====
    test.describe("Search / Filter", () => {
      test("Search mặc định gửi đúng request (phân trang, sort, filters rỗng)", async ({ page }) => {
        const { body, status } = await search(page);
        expect(status).toBe(200);
        expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: {} });
      });

      for (const id of ["module", "status"]) {
        test(`Dropdown ${id} load được danh sách option`, async ({ page }) => {
          expect((await dropdownOptions(page, id)).length).toBeGreaterThan(0);
        });
      }

      test("Option cố định của Module và Status", async ({ page }) => {
        expect(await dropdownOptions(page, "module")).toEqual(Object.keys(MODULES));
        expect(await dropdownOptions(page, "status")).toEqual(Object.keys(STATUSES));
      });

      // Mỗi Module gửi đúng enum và mọi dòng có Module tương ứng
      for (const [label, value] of Object.entries(MODULES)) {
        test(`Lọc theo Module = ${label} gửi "${value}" và mọi dòng thuộc module đó`, async ({ page }) => {
          await selectOption(page, "module", label);
          const { body, status, json } = await search(page);
          expect(status).toBe(200);
          expect(body.filters).toEqual({ module: value });
          test.skip(json.data.list.length === 0, `Không có bản ghi nào của module ${label}`);
          for (const v of await columnValues(page, "Module")) expect(v).toBe(value);
          for (const x of json.data.list) expect(x.module).toBe(value);
        });
      }

      // Mỗi Status gửi đúng số và mọi dòng có trạng thái tương ứng
      for (const [label, s] of Object.entries(STATUSES)) {
        test(`Lọc theo Status = ${label} gửi ${s.filter} và mọi dòng có trạng thái ${label}`, async ({ page }) => {
          await selectOption(page, "status", label);
          const { body, status, json } = await search(page);
          expect(status).toBe(200);
          expect(body.filters).toEqual({ status: s.filter });
          test.skip(json.data.list.length === 0, `Không có bản ghi nào ở trạng thái ${label}`);
          for (const v of await columnValues(page, "Status")) expect(v).toBe(label);
          for (const x of json.data.list) expect(x.status).toBe(s.api);
        });
      }

      test("Lọc theo ID (giá trị của dòng đầu): gửi downloadId dạng SỐ, chỉ trả đúng 1 dòng", async ({ page }) => {
        await ensureData(page);
        const id = (await columnValues(page, "ID"))[0];
        await typeFilter(page, "downloadId", id);
        const { body, json } = await search(page);

        expect(body.filters.downloadId).toBe(Number(id));
        expect(json.data.totalCount).toBe(1);
        expect(await columnValues(page, "ID")).toEqual([id]);
        await expect(summary(page)).toHaveText(`Showing 1 - 1 of 1 records`);
      });

      test("ID khớp CHÍNH XÁC (không khớp 1 phần): gõ bỏ chữ số cuối không trả các ID bắt đầu bằng chuỗi đó", async ({ page }) => {
        await ensureData(page);
        const id = (await columnValues(page, "ID"))[0];
        const prefix = id.slice(0, -1);
        await typeFilter(page, "downloadId", prefix);
        const { body, json } = await search(page);
        expect(body.filters.downloadId).toBe(Number(prefix));
        for (const x of json.data.list) expect(x.downloadId, `chỉ được khớp đúng ID ${prefix}`).toBe(Number(prefix));
      });

      test("ID có khoảng trắng đầu / cuối được tự cắt (gửi số đã trim)", async ({ page }) => {
        await ensureData(page);
        const id = (await columnValues(page, "ID"))[0];
        await typeFilter(page, "downloadId", ` ${id} `);
        const { body, json } = await search(page);
        expect(body.filters.downloadId).toBe(Number(id));
        expect(json.data.list.map((x) => x.downloadId)).toEqual([Number(id)]);
      });

      test("ID không tồn tại -> hiển thị 'There are no entries found'", async ({ page }) => {
        await typeFilter(page, "downloadId", "0");
        const { json } = await search(page);
        expect(json.data.totalCount).toBe(0);
        await expect(rows(page)).toHaveCount(0);
        await expect(page.getByText(MSG.noEntries).first()).toBeVisible();
        // Khi không có kết quả app ẩn luôn dòng tóm tắt "Showing ..."
        await expect(summary(page)).toHaveCount(0);
      });

      // HÀNH VI HIỆN TẠI CẦN XÁC NHẬN: ô ID là ô text, không chặn chữ; giá trị không phải số bị app đổi thành null -> filter bị BỎ QUA và bảng trả toàn bộ danh sách
      test("ID không phải số ('abc'): app gửi downloadId = null, filter bị bỏ qua và bảng trả toàn bộ danh sách (hành vi hiện tại)", async ({ page }) => {
        await typeFilter(page, "downloadId", "abc");
        const { body, status, json } = await search(page);
        expect(status).toBe(200);
        expect(body.filters.downloadId).toBeNull();
        expect(json.data.list.length).toBeGreaterThan(0);
      });

      // HÀNH VI HIỆN TẠI CẦN XÁC NHẬN: ID thập phân hoặc quá lớn vẫn được gửi lên và server trả HTTP 400 (app không chặn, không hiện thông báo lỗi nào)
      test("ID thập phân ('1.5'): request vẫn được gửi và server trả HTTP 400 (hành vi hiện tại)", async ({ page }) => {
        await typeFilter(page, "downloadId", "1.5");
        const { body, status } = await search(page);
        expect(body.filters.downloadId).toBe(1.5);
        expect(status).toBe(400);
      });

      // HÀNH VI HIỆN TẠI CẦN XÁC NHẬN: khi chỉ nhập ID (Time để trống) app tự gắn filters.startTime = hôm nay (ô Time vẫn trống), nhưng server bỏ qua startTime
      // khi có downloadId nên vẫn trả đúng bản ghi của ngày cũ.
      test("Chỉ nhập ID: request tự gắn startTime = hôm nay (ô Time vẫn trống), server vẫn trả bản ghi của ngày khác", async ({ page }) => {
        const { list } = await loadMany(page);
        const today = (await tableMatrix(page))[0].cells[COL.startTime].slice(0, 10);
        const old = list.find((x) => x.startTime.slice(0, 10) !== today && x.downloadId);
        test.skip(!old, "Không có bản ghi của ngày khác (mọi bản ghi cùng 1 ngày)");
        await typeFilter(page, "downloadId", String(old.downloadId));
        const { body, json } = await search(page);

        expect(body.filters.downloadId).toBe(old.downloadId);
        expect(body.filters.startTime).toHaveLength(2);
        expect(body.filters.startTime[0]).toMatch(/^\d{4}-\d{2}-\d{2} 00:00:00$/);
        expect(body.filters.startTime[1]).toBe(`${addDays(body.filters.startTime[0], 1)} 00:00:00`);
        await expect(dateRangeInput(page)).toHaveValue("");
        expect(json.data.list.map((x) => x.downloadId)).toEqual([old.downloadId]);
      });

      test("Kết hợp Module + Status (AND): mọi dòng thoả cả 2", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length === 0, "Không có dữ liệu");
        const x = all.data.list[0];
        const moduleLabel = Object.keys(MODULES).find((k) => MODULES[k] === x.module);
        await selectOption(page, "module", moduleLabel);
        await selectOption(page, "status", STATUS_TEXT[x.status]);
        const { body, json } = await search(page);

        expect(body.filters).toEqual({ module: x.module, status: STATUSES[STATUS_TEXT[x.status]].filter });
        expect(json.data.list.length, "dòng đầu của danh sách phải thoả cả 2 filter").toBeGreaterThan(0);
        for (const v of await columnValues(page, "Module")) expect(v).toBe(x.module);
        for (const v of await columnValues(page, "Status")) expect(v).toBe(STATUS_TEXT[x.status]);
      });

      test("Kết hợp ID + Module không khớp (AND) -> không có kết quả", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length === 0, "Không có dữ liệu");
        const x = all.data.list[0];
        const other = Object.keys(MODULES).find((k) => MODULES[k] !== x.module);
        await selectOption(page, "module", other);
        await typeFilter(page, "downloadId", String(x.downloadId));
        const { body, json } = await search(page);
        expect(body.filters).toMatchObject({ module: MODULES[other], downloadId: x.downloadId });
        expect(json.data.totalCount).toBe(0);
        await expect(page.getByText(MSG.noEntries).first()).toBeVisible();
      });

      test("Module + Status không có dữ liệu -> 'There are no entries found'", async ({ page }) => {
        await selectOption(page, "module", "Developer Toolkit");
        await selectOption(page, "status", "Processing");
        const { json } = await search(page);
        test.skip(json.data.totalCount > 0, "Có bản ghi Developer Toolkit đang Processing");
        await expect(rows(page)).toHaveCount(0);
        await expect(page.getByText(MSG.noEntries).first()).toBeVisible();
      });
    });

    // ===== 4. Bộ lọc thời gian =====
    test.describe("Time", () => {
      test("Time chỉ có 3 preset: Today, Yesterday, Last 7 Days", async ({ page }) => {
        await filterEl(page, "startTime_0").locator("label").first().click();
        const presets = page.locator(".NextGen-datetime-preset__item");
        await expect(presets.first()).toBeVisible();
        expect((await presets.allInnerTexts()).map((t) => t.trim())).toEqual(PRESETS);
      });

      test("Các preset cho khoảng ngày đúng, hiển thị 00:00:00 - 23:59:59 và gửi startTime [ngày đầu 00:00:00, ngày cuối + 1 00:00:00]", async ({ page }) => {
        const PRESET_DAYS = [
          ["Today", 1],
          ["Last 7 Days", 7],
        ];
        let today;
        for (const [preset, days] of PRESET_DAYS) {
          await pickDatePreset(page, preset);
          const [from, to] = (await dateRangeInput(page).inputValue()).split(" - ");
          expect(from.slice(11), preset).toBe("00:00:00");
          expect(to.slice(11), preset).toBe("23:59:59");
          if (preset === "Today") today = toIso(to).slice(0, 10);
          expect(toIso(to).slice(0, 10), preset).toBe(today); // luôn kết thúc ở hôm nay
          expect(diffDays(toIso(to), toIso(from)) + 1, preset).toBe(days);

          const { body } = await search(page);
          expect(body.filters.startTime, preset).toEqual([toIso(from), `${addDays(toIso(to), 1)} 00:00:00`]);
        }
      });

      test("Preset Yesterday = hôm qua", async ({ page }) => {
        await pickDatePreset(page, "Today");
        const today = toIso((await dateRangeInput(page).inputValue()).split(" - ")[1]).slice(0, 10);
        await pickDatePreset(page, "Yesterday");
        const [from, to] = (await dateRangeInput(page).inputValue()).split(" - ");
        expect(diffDays(today, toIso(from))).toBe(1);
        expect(diffDays(today, toIso(to))).toBe(1);
        const { body } = await search(page);
        expect(body.filters.startTime).toEqual([toIso(from), `${today} 00:00:00`]);
      });

      test("Xoá bằng nút (x) -> request không còn filters.startTime", async ({ page }) => {
        await pickDatePreset(page, "Last 7 Days");
        await expect(dateRangeInput(page)).not.toHaveValue("");
        await clearDate(page);
        await expect(dateRangeInput(page)).toHaveValue("");

        const { body, status } = await search(page);
        expect(status).toBe(200);
        expect(body.filters.startTime).toBeUndefined();
      });

      test("Mọi dòng có Start Time nằm trong khoảng đã chọn (Last 7 Days)", async ({ page }) => {
        await pickDatePreset(page, "Last 7 Days");
        const { body } = await search(page);
        const [from, to] = body.filters.startTime;

        const dates = await columnValues(page, "Start Time");
        test.skip(dates.length === 0, "Không có bản ghi nào trong 7 ngày gần nhất");
        for (const d of dates) {
          expect(d >= from, `${d} phải >= ${from}`).toBe(true);
          expect(d < to, `${d} phải < ${to}`).toBe(true);
        }
      });

      test("Preset Today: mọi dòng có Start Time là hôm nay", async ({ page }) => {
        await pickDatePreset(page, "Today");
        const { body } = await search(page);
        const [from, to] = body.filters.startTime;
        const dates = await columnValues(page, "Start Time");
        test.skip(dates.length === 0, "Hôm nay chưa có bản ghi nào");
        for (const d of dates) {
          expect(d >= from && d < to, `${d} phải nằm trong [${from}, ${to})`).toBe(true);
        }
      });

      test("Thu hẹp khoảng ngày thì số bản ghi không tăng (Today <= Last 7 Days)", async ({ page }) => {
        await pickDatePreset(page, "Today");
        const narrow = (await search(page)).json.data.totalCount;
        await pickDatePreset(page, "Last 7 Days");
        const wide = (await search(page)).json.data.totalCount;
        expect(narrow).toBeLessThanOrEqual(wide);
      });
    });

    // ===== 5. Reset =====
    test.describe("Reset", () => {
      test("Reset xoá toàn bộ filter đã chọn và gửi lại request mặc định", async ({ page }) => {
        await ensureData(page);
        const defaultBody = (await search(page)).body;

        await selectOption(page, "module", "Reports");
        await selectOption(page, "status", "Completed");
        await typeFilter(page, "downloadId", "1");
        await pickDatePreset(page, "Last 7 Days");
        await search(page);

        const bodies = await resetBodies(page);
        for (const id of ["module", "status"]) await expect(filterEl(page, id).locator(".ant-select-selection-item")).toHaveCount(0);
        await expect(page.locator("#downloadId")).toHaveValue("");
        await expect(dateRangeInput(page)).toHaveValue("");

        expect(bodies.length, "Reset phải gọi lại API").toBeGreaterThan(0);
        expect(bodies[bodies.length - 1]).toEqual(defaultBody);
      });

      test("Reset khi chưa Search filter nào: xoá lựa chọn trên form nhưng không gọi lại API", async ({ page }) => {
        await ensureData(page);
        await selectOption(page, "module", "Reports");
        const bodies = await resetBodies(page);
        await expect(filterEl(page, "module").locator(".ant-select-selection-item")).toHaveCount(0);
        expect(bodies).toEqual([]);
      });

      // HÀNH VI ĐÚNG (đã được user xác nhận): Reset xoá filter nhưng giữ nguyên trang đang xem (request list gửi page=2).
      test("Reset khi đang ở trang 2 (có filter): xoá filter nhưng giữ nguyên trang 2", async ({ page }) => {
        await selectOption(page, "status", "Completed");
        const { json } = await search(page);
        test.skip(json.data.totalCount <= 10, "Completed chỉ có 1 trang");
        await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        await expect(summary(page)).toHaveText(/^Showing 11 - /);

        const bodies = await resetBodies(page);
        expect(bodies.length, "Reset phải gọi lại API").toBeGreaterThan(0);
        expect(bodies[bodies.length - 1]).toMatchObject({ page: 2, filters: {} });
        await expect(summary(page)).toHaveText(/^Showing 11 - /);
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
        // Previous / Next là thẻ <li> nên kiểm tra bằng class ant-pagination-disabled
        await expect(page.locator(".ant-pagination-prev")).toHaveClass(/ant-pagination-disabled/);

        const next = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
        expect(next.page).toBe(2);
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");

        const prev = await reloadBy(page, () => page.locator(".ant-pagination-prev").click());
        expect(prev.page).toBe(1);
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
      });

      test("Trang 2 không trùng ID với trang 1 (mặc định id giảm dần)", async ({ page }) => {
        const ids1 = await columnValues(page, "ID");
        await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        const ids2 = await columnValues(page, "ID");
        // Bản ghi mới có thể được thêm / xoá giữa 2 lần gọi làm lệch trang -> chỉ kiểm tra trang 2 toàn ID nhỏ hơn hoặc bằng ID nhỏ nhất của trang 1 (tối đa lệch bởi bản ghi mới)
        expect(ids2.length).toBeGreaterThan(0);
        expect(new Set(ids2).size).toBe(ids2.length);
        expect(ids2.map(Number)).toEqual([...ids2.map(Number)].sort((a, b) => b - a));
        expect(Math.max(...ids2.map(Number))).toBeLessThan(Math.max(...ids1.map(Number)));
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
        await selectOption(page, "status", "Completed");
        const first = await search(page);
        test.skip(first.json.data.totalCount <= 10, "Completed chỉ có 1 trang");

        const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
        expect(body.page).toBe(2);
        expect(body.filters).toEqual(first.body.filters);
        for (const v of await columnValues(page, "Status")) expect(v).toBe("Completed");
      });

      test("Số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
        await setPageSize(page, "20 / page");

        const reqPromise = page.waitForRequest(isList);
        await page.reload();
        expect(bodyOf(await reqPromise).pageSize).toBe(20);
        await settle(page);
        await expect(rows(page)).toHaveCount(20);
      });
    });

    // ===== 7. Sắp xếp =====
    test.describe("Sắp xếp", () => {
      // Chu kỳ chung: asc -> desc -> về mặc định (id giảm dần); cả 3 lần click đều gọi API
      for (const [column, sortBy] of Object.entries(SORTABLE)) {
        test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định (sortBy ${sortBy})`, async ({ page }) => {
          const header = th(page, column);
          const asc = await reloadBy(page, () => header.click());
          expect(asc).toMatchObject({ sortBy, sortDirection: "asc" });
          const desc = await reloadBy(page, () => header.click());
          expect(desc).toMatchObject({ sortBy, sortDirection: "desc" });
          const none = await reloadBy(page, () => header.click());
          expect(none).toMatchObject({ sortBy: "id", sortDirection: "desc" });
        });
      }

      test("Sort ID: thứ tự ID tăng dần rồi giảm dần đúng", async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
        await reloadBy(page, () => th(page, "ID").click());
        let v = (await columnValues(page, "ID")).map(Number);
        expect(v).toEqual([...v].sort((a, b) => a - b));
        await reloadBy(page, () => th(page, "ID").click());
        v = (await columnValues(page, "ID")).map(Number);
        expect(v).toEqual([...v].sort((a, b) => b - a));
      });

      test("Sort Start Time: thứ tự thời gian tăng dần rồi giảm dần đúng (Created Time cùng thứ tự vì cùng giá trị)", async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
        const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
        await reloadBy(page, () => th(page, "Start Time").click());
        let v = await columnValues(page, "Start Time");
        expect(v).toEqual([...v].sort(cmp));
        expect(await columnValues(page, "Created Time")).toEqual(v);
        await reloadBy(page, () => th(page, "Start Time").click());
        v = await columnValues(page, "Start Time");
        expect(v).toEqual([...v].sort((a, b) => cmp(b, a)));
      });

      test("Sort Size: sắp xếp theo số byte (không theo chữ), Size trống (0 Bytes) đứng đầu khi tăng dần", async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
        const bytes = (list) => list.map((x) => Number(x.fileSize || 0));
        const asc = await reloadFull(page, () => th(page, "Size").click());
        expect(bytes(asc.json.data.list)).toEqual([...bytes(asc.json.data.list)].sort((a, b) => a - b));
        const desc = await reloadFull(page, () => th(page, "Size").click());
        expect(bytes(desc.json.data.list)).toEqual([...bytes(desc.json.data.list)].sort((a, b) => b - a));
      });

      test("Sort File Name / Module / Status: chỉ kiểm tra đúng sortBy (thứ tự chữ phụ thuộc collation server)", async ({ page }) => {
        for (const [column, sortBy] of [["File Name", "fileName"], ["Module", "module"], ["Status", "status"]]) {
          const asc = await reloadBy(page, () => th(page, column).click());
          expect(asc, column).toMatchObject({ sortBy, sortDirection: "asc" });
          await reloadBy(page, () => th(page, column).click());
          await reloadBy(page, () => th(page, column).click()); // về mặc định
        }
      });

      test("Các cột còn lại (checkbox, Timezone, Created By, Action) không có chức năng sort", async ({ page }) => {
        for (const column of NOT_SORTABLE) {
          await expect(th(page, column), `"${column}"`).not.toHaveClass(/ant-table-column-has-sorters/);
        }
        for (const column of Object.keys(SORTABLE)) {
          await expect(th(page, column), column).toHaveClass(/ant-table-column-has-sorters/);
        }
      });

      test("Giữ nguyên filter khi sort", async ({ page }) => {
        await selectOption(page, "status", "Completed");
        const first = await search(page);
        test.skip(first.json.data.list.length < 2, "Không đủ dữ liệu");
        const body = await reloadBy(page, () => th(page, "Start Time").click());
        expect(body.sortBy).toBe("startTime");
        expect(body.filters).toEqual(first.body.filters);
      });
    });

    // ===== 8. Chọn dòng + xoá hàng loạt (request ghi chỉ là GIẢ) =====
    test.describe("Chọn dòng và xoá hàng loạt (không ghi dữ liệu thật)", () => {
      test("Chọn 1 dòng: checkbox được tick, nút xoá hàng loạt bật; bỏ chọn thì tắt lại", async ({ page }) => {
        await ensureData(page);
        await rowCheckbox(rowAt(page, 0)).check();
        await expect(rowCheckbox(rowAt(page, 0))).toBeChecked();
        await expect(bulkDeleteBtn(page)).toBeEnabled();
        await rowCheckbox(rowAt(page, 0)).uncheck();
        await expect(bulkDeleteBtn(page)).toBeDisabled();
      });

      test("Checkbox ở header chọn / bỏ chọn tất cả dòng của trang hiện tại", async ({ page }) => {
        await ensureData(page);
        const n = await rows(page).count();
        await headerCheckbox(page).check();
        await expect(table(page).locator("tbody input[type=checkbox]:checked")).toHaveCount(n);
        await expect(bulkDeleteBtn(page)).toBeEnabled();
        await headerCheckbox(page).uncheck();
        await expect(table(page).locator("tbody input[type=checkbox]:checked")).toHaveCount(0);
        await expect(bulkDeleteBtn(page)).toBeDisabled();
      });

      test("Tick đủ từng dòng thì checkbox header tự được tick", async ({ page }) => {
        await ensureData(page);
        const n = await rows(page).count();
        for (let i = 0; i < n; i++) await rowCheckbox(rowAt(page, i)).check();
        await expect(headerCheckbox(page)).toBeChecked();
        await rowCheckbox(rowAt(page, 0)).uncheck();
        await expect(headerCheckbox(page)).not.toBeChecked();
      });

      test("Bulk Delete với 1 dòng: hộp thoại 'Delete downloaded file with id N' + 2 nút Cancel / Delete", async ({ page }) => {
        await ensureData(page);
        const id = (await columnValues(page, "ID"))[0];
        await rowCheckbox(rowAt(page, 0)).check();
        await bulkDeleteBtn(page).click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toContainText(MSG.deleteOne(id));
        await expect(dialog(page)).toContainText(MSG.deleteBulkOneText);
        await expect(dlgCancel(page)).toBeVisible();
        await expect(dlgConfirm(page)).toBeVisible();
      });

      test("Bulk Delete với nhiều dòng: hộp thoại 'Delete N files' + 'Are you sure you want to delete N files?'", async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu");
        const n = await rows(page).count();
        await headerCheckbox(page).check();
        await bulkDeleteBtn(page).click();
        await expect(dialog(page)).toContainText(MSG.deleteN(n));
        await expect(dialog(page)).toContainText(MSG.deleteNText(n));
      });

      test("Cancel đóng hộp thoại bulk, không gửi request xoá, các dòng vẫn được chọn và danh sách không đổi", async ({ page }) => {
        await ensureData(page);
        const before = await rows(page).allInnerTexts();
        await rowCheckbox(rowAt(page, 0)).check();
        await bulkDeleteBtn(page).click();
        await dlgCancel(page).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(rowCheckbox(rowAt(page, 0))).toBeChecked();
        expect(await rows(page).allInnerTexts()).toEqual(before);
      });

      test("Bulk Delete gửi download/delete {ids} đúng các dòng đã chọn, hiện toast Success, đóng hộp thoại, bỏ chọn và nạp lại danh sách (request GIẢ)", async ({
        page,
      }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu");
        await mockWrites(page, MOCK_OK);
        const ids = (await columnValues(page, "ID")).slice(0, 2).map(Number);
        await rowCheckbox(rowAt(page, 0)).check();
        await rowCheckbox(rowAt(page, 1)).check();
        await bulkDeleteBtn(page).click();
        await expect(dialog(page)).toContainText(MSG.deleteN(2));
        const [req] = await Promise.all([page.waitForRequest(isDelete), page.waitForRequest(isList), dlgConfirm(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "download/delete", body }];
        expect(body).toEqual({ ids });
        await expect(dialog(page)).toHaveCount(0);
        await expect(toasts(page).filter({ hasText: "Success" }).first()).toBeVisible();
        await settle(page);
        await expect(table(page).locator("tbody input[type=checkbox]:checked")).toHaveCount(0);
        await expect(bulkDeleteBtn(page)).toBeDisabled();
        // Request xoá chỉ là GIẢ nên bản ghi vẫn còn sau khi nạp lại danh sách
        expect((await columnValues(page, "ID")).slice(0, 2).map(Number)).toEqual(ids);
      });
    });

    // ===== 9. Xoá từng dòng (request ghi chỉ là GIẢ) =====
    test.describe("Hộp thoại Delete từng dòng (không ghi dữ liệu thật)", () => {
      test("Icon thùng rác mở hộp thoại 'Delete downloaded file with id N' với câu hỏi xác nhận và 2 nút Cancel / Delete", async ({ page }) => {
        await ensureData(page);
        const id = (await columnValues(page, "ID"))[0];
        await deleteIcon(rowAt(page, 0)).click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toContainText(MSG.deleteOne(id));
        await expect(dialog(page)).toContainText(MSG.deleteOneText);
        await expect(dlgCancel(page)).toBeVisible();
        await expect(dlgConfirm(page)).toBeVisible();
      });

      test("Hộp thoại của dòng khác hiển thị đúng ID của dòng đó", async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu");
        const id = (await columnValues(page, "ID"))[1];
        await deleteIcon(rowAt(page, 1)).click();
        await expect(dialog(page)).toContainText(MSG.deleteOne(id));
      });

      test("Cancel đóng hộp thoại, không gửi request xoá, danh sách không đổi", async ({ page }) => {
        await ensureData(page);
        const before = await rows(page).allInnerTexts();
        await deleteIcon(rowAt(page, 0)).click();
        await dlgCancel(page).click();
        await expect(dialog(page)).toHaveCount(0);
        expect(await rows(page).allInnerTexts()).toEqual(before);
      });

      test("Delete gửi download/delete {ids:[id]} của đúng dòng, hiện toast Success 'Delete succesfully', nạp lại danh sách (request GIẢ)", async ({ page }) => {
        await ensureData(page);
        await mockWrites(page, MOCK_OK);
        const n = await rows(page).count();
        const id = Number((await columnValues(page, "ID"))[0]);
        await deleteIcon(rowAt(page, 0)).click();
        const [req] = await Promise.all([page.waitForRequest(isDelete), page.waitForRequest(isList), dlgConfirm(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "download/delete", body }];
        expect(body).toEqual({ ids: [id] });
        await expect(dialog(page)).toHaveCount(0);
        // Lưu ý: app viết sai chính tả "succesfully" (thiếu 1 chữ 's'); regex chấp nhận cả khi đã sửa
        await expect(toasts(page).filter({ hasText: /Delete succes+fully/ }).first()).toBeVisible();
        await settle(page);
        // Request xoá chỉ là GIẢ nên bản ghi vẫn còn sau khi nạp lại danh sách
        await expect(rows(page)).toHaveCount(n);
        await expect(cellAt(page, 0, COL.id)).toHaveText(String(id));
      });

      // LỖI ỨNG DỤNG (chưa xác nhận): response download/delete trả status "fail" nhưng app vẫn hiện toast Success "Delete succesfully" và đóng hộp thoại
      // (app không kiểm tra kết quả xoá). Test FAIL cho tới khi xác nhận / sửa.
      test("Server từ chối xoá (response GIẢ fail): không được hiện toast Success 'Delete succesfully', phải báo lỗi", async ({ page }) => {
        await ensureData(page);
        await mockWrites(page, { status: "fail", messageCode: "FORBIDDEN", message: "Forbidden", data: {} });
        await deleteIcon(rowAt(page, 0)).click();
        const [req] = await Promise.all([page.waitForRequest(isDelete), dlgConfirm(page).click()]);
        allowedWrites = [{ url: "download/delete", body: bodyOf(req) }];
        await expect(toasts(page).first()).toBeVisible();
        await expect(toasts(page).filter({ hasText: /Delete succes+fully/ }), "xoá thất bại không được báo Success").toHaveCount(0);
      });
    });

    // ===== 10. Manage Columns =====
    test.describe("Manage Columns", () => {
      // hasText dạng RegExp khớp CHÍNH XÁC tên cột
      const item = (page, name) =>
        columnPopover(page).locator(".NextGen-popover-manage-column__list__items", { hasText: exact(name) });

      test("Popover liệt kê đủ cột (không có cột checkbox), đều được chọn; không có nút Save / Reset to Default", async ({ page }) => {
        await columnBtn(page).click();
        await expect(columnPopover(page)).toBeVisible();
        const names = await columnPopover(page).locator(".NextGen-popover-manage-column__list__items .ant-typography").allInnerTexts();
        expect(names.map((n) => n.trim())).toEqual(MANAGE_COLUMNS);
        await expect(columnPopover(page).locator("input[type=checkbox]:checked")).toHaveCount(MANAGE_COLUMNS.length);
        await expect(columnPopover(page).getByRole("button")).toHaveCount(0);
      });

      test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
        await columnBtn(page).click();
        await item(page, "Timezone").locator("label").click();
        expect(await headers(page)).not.toContain("Timezone");
        expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

        await item(page, "Timezone").locator("label").click();
        expect(await headers(page)).toEqual(COLUMNS);
      });

      test("Ẩn nhiều cột cùng lúc", async ({ page }) => {
        await columnBtn(page).click();
        await item(page, "Timezone").locator("label").click();
        await item(page, "Created By").locator("label").click();
        expect(await headers(page)).toEqual(COLUMNS.filter((c) => c !== "Timezone" && c !== "Created By"));
      });

      // LỖI ỨNG DỤNG (chưa xác nhận): Start Time và Created Time dùng chung 1 key cột nên bỏ chọn 1 trong 2 sẽ ẩn / hiện CẢ HAI cột
      // (popover chỉ bỏ tick cột vừa bấm, cột còn lại vẫn tick nhưng đã biến mất khỏi bảng). Test FAIL cho tới khi sửa.
      test("Ẩn 'Created Time' chỉ ẩn đúng cột Created Time (Start Time vẫn hiển thị) và ngược lại", async ({ page }) => {
        await columnBtn(page).click();
        await item(page, "Created Time").locator("label").click();
        expect(await headers(page)).toEqual(COLUMNS.filter((c) => c !== "Created Time"));
        await item(page, "Created Time").locator("label").click();
        await item(page, "Start Time").locator("label").click();
        expect(await headers(page)).toEqual(COLUMNS.filter((c) => c !== "Start Time"));
      });

      test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột; cột checkbox vẫn còn", async ({ page }) => {
        await ensureData(page);
        const before = await columnValues(page, "ID");
        await columnBtn(page).click();
        await item(page, "Module").locator("label").click();
        expect(await columnValues(page, "ID")).toEqual(before);
        expect((await headers(page))[0]).toBe("");
        await expect(rowCheckbox(rowAt(page, 0))).toBeVisible();
      });

      test("Cấu hình cột KHÔNG được lưu: reload trang thì hiện lại đủ cột", async ({ page }) => {
        await columnBtn(page).click();
        await item(page, "Timezone").locator("label").click();
        expect(await headers(page)).not.toContain("Timezone");

        await openPage(page); // reload
        expect(await headers(page)).toEqual(COLUMNS);
      });
    });

    // ===== 11. Ghi nhớ filter =====
    test.describe("Ghi nhớ filter", () => {
      test("Filter được ghi nhớ sau khi reload trang", async ({ page }) => {
        await ensureData(page);
        await selectOption(page, "module", "Reports");
        await selectOption(page, "status", "Completed");
        await pickDatePreset(page, "Last 7 Days");
        const { body } = await search(page);
        const shownRange = await dateRangeInput(page).inputValue();

        const reqPromise = page.waitForRequest(isList);
        await openPage(page); // reload
        expect(bodyOf(await reqPromise).filters).toEqual(body.filters);
        expect(await selectedTitles(page, "module")).toEqual(["Reports"]);
        expect(await selectedTitles(page, "status")).toEqual(["Completed"]);
        await expect(dateRangeInput(page)).toHaveValue(shownRange);
      });

      test("Filter chỉ chọn trên form mà chưa Search thì KHÔNG được ghi nhớ", async ({ page }) => {
        await ensureData(page);
        await selectOption(page, "module", "Reports");
        const reqPromise = page.waitForRequest(isList);
        await openPage(page); // reload
        expect(bodyOf(await reqPromise).filters).toEqual({});
        await expect(filterEl(page, "module").locator(".ant-select-selection-item")).toHaveCount(0);
      });

      test("Sau Reset rồi reload: filter không còn được ghi nhớ", async ({ page }) => {
        await ensureData(page);
        await selectOption(page, "status", "Completed");
        await search(page);
        await resetBodies(page);

        const reqPromise = page.waitForRequest(isList);
        await openPage(page); // reload
        expect(bodyOf(await reqPromise).filters).toEqual({});
        await expect(filterEl(page, "status").locator(".ant-select-selection-item")).toHaveCount(0);
      });
    });
  });

  // ===== NHÓM GHI DỮ LIỆU THẬT (chỉ trên file do chính test tạo qua Export Currency, luôn xoá lại) =====
  test.describe("CRUD (ghi dữ liệu thật trên file QA, luôn xoá lại)", () => {
    test.describe.configure({ mode: "serial" });

    const trackedIds = new Set(); // downloadId do lần chạy này tạo mà CHƯA xoá (để afterAll quét nốt nếu test dừng giữa chừng)
    const createdIds = new Set(); // mọi downloadId do lần chạy này tạo (không bao giờ bị bỏ; afterEach chỉ cho phép xoá các id này)
    const trackedCodes = new Set(); // Code filter dùng khi Export (afterEach chỉ cho phép Export với code này)

    const qaCode = () => {
      const code = `${QA_CODE_PREFIX}${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10)}`;
      trackedCodes.add(code);
      return code;
    };

    // Export từ Administration > Currency với Code không khớp currency nào (file chỉ có dòng tiêu đề).
    // Trả về { id, code, body } (body = request /download). Kết thúc ở màn Currency.
    async function createExport(page, code = qaCode()) {
      await page.goto(CURRENCY_URL);
      await page.waitForResponse(isCurrencyList, { timeout: 60000 });
      await settle(page);
      await filterEl(page, "code").locator("label").first().click();
      await filterEl(page, "code").locator("input").fill(code);
      await Promise.all([page.waitForRequest(endsWith("/currency/list")), searchBtn(page).click()]);
      await settle(page);
      const [req] = await Promise.all([page.waitForRequest(isDownload), page.locator("button.NextGen-export-button").click()]);
      const body = bodyOf(req);
      const toast = toasts(page).filter({ hasText: MSG.processing }).first();
      await expect(toast).toBeVisible();
      const id = Number((await toast.innerText()).match(MSG.processing)[1]);
      trackedIds.add(id);
      createdIds.add(id);
      return { id, code, body };
    }

    // Lọc theo ID rồi Search (chịu được trường hợp request giống hệt lần trước bị app bỏ qua)
    async function searchById(page, id) {
      await typeFilter(page, "downloadId", String(id));
      const req = page.waitForRequest(isList, { timeout: 8000 }).catch(() => null);
      await searchBtn(page).click();
      await req;
      await settle(page);
    }

    // Xoá bản ghi QA bằng UI (icon thùng rác của dòng). Trả về true nếu đã xoá. KHÔNG chạm bản ghi không nằm trong trackedIds.
    async function deleteById(page, id) {
      if (!createdIds.has(id)) throw new Error(`Từ chối xoá download ${id}: không phải bản ghi QA do test tạo`);
      await searchById(page, id);
      const row = rowOfId(page, id);
      if ((await row.count()) === 0) return false;
      await deleteIcon(row).click();
      await expect(dialog(page)).toContainText(MSG.deleteOne(id));
      const [req] = await Promise.all([page.waitForRequest(isDelete), dlgConfirm(page).click()]);
      expect(bodyOf(req)).toEqual({ ids: [id] });
      await expect(dialog(page)).toHaveCount(0);
      await settle(page);
      return true;
    }

    // Xoá nhiều bản ghi QA trong finally (không làm hỏng lỗi gốc của test nếu dọn dẹp cũng lỗi)
    async function cleanup(page, ids) {
      await openPage(page).catch(() => {});
      for (const id of ids) await deleteById(page, id).catch(() => {});
    }

    // Chờ job export hoàn tất (Processing -> Completed) bằng cách tải lại màn hình; trả về item của response list
    async function waitCompleted(page, id) {
      let item;
      await expect
        .poll(
          async () => {
            const [res] = await Promise.all([page.waitForResponse(isList), page.reload()]);
            const json = await res.json().catch(() => null); // reload làm mất body của response -> thử lại ở vòng sau
            item = json?.data.list.find((x) => x.downloadId === id);
            await settle(page);
            return item?.status;
          },
          { message: `Download ${id} không chuyển sang COMPLETED`, timeout: 120000, intervals: [3000] },
        )
        .toBe("COMPLETED");
      return item;
    }

    test.afterAll(async ({ browser }) => {
      test.setTimeout(180000);
      if (trackedIds.size === 0) return;
      const ctx = await browser.newContext({ storageState: buildStorageState(), viewport: VIEWPORT });
      const page = await ctx.newPage();
      try {
        await cleanup(page, [...trackedIds]);
      } finally {
        await ctx.close();
      }
    });

    test.beforeEach(async () => {
      test.setTimeout(240000); // mỗi test gồm Export + chờ hoàn tất + xoá + dọn trong finally
    });

    // Mọi request ghi của nhóm này chỉ được nhắm vào file QA: Export Currency với code QZ... hoặc download/delete các id đã tạo
    test.afterEach(async () => {
      for (const w of writes) {
        expect(["download", "download/delete"], "URL ghi không nằm trong danh sách").toContain(w.url);
        if (w.url === "download") {
          expect(w.body.module).toBe("ADMINISTRATION");
          expect(w.body.section).toBe("ADMINISTRATION_CURRENCY");
          expect(trackedCodes.has(JSON.parse(w.body.payload).filters.code), "Export chỉ dùng code QA").toBe(true);
        } else {
          expect(w.body.ids.length).toBeGreaterThan(0);
          for (const id of w.body.ids) expect(createdIds.has(id), `delete phải nhắm bản ghi QA, gặp id ${id}`).toBe(true);
        }
      }
    });

    test("Export Currency tạo bản ghi mới ở Download History: dòng đầu danh sách, Module / Section / Created By đúng, chuyển Completed, tải được file, rồi xoá bằng icon Delete", async ({
      page,
    }) => {
      let id;
      try {
        const created = await createExport(page);
        id = created.id;
        expect(created.body).toMatchObject({ module: "ADMINISTRATION", section: "ADMINISTRATION_CURRENCY" });
        const user = await page.locator("button[class*='NextGen-popover-profile']").first().innerText();

        await openPage(page);
        await searchById(page, id);
        const row = rowOfId(page, id);
        await expect(row).toHaveCount(1);
        const item = await waitCompleted(page, id);
        await expect(rowOfId(page, id)).toHaveCount(1);

        const cells = (await tableMatrix(page)).find((m) => m.cells[COL.id] === String(id)).cells;
        expect(cells[COL.module]).toBe("ADMINISTRATION");
        expect(cells[COL.section]).toBe("Administration Currency");
        expect(cells[COL.fileName]).toMatch(/^[A-Za-z]+_\d{14}_Currencies$/);
        expect(cells[COL.fileName]).toBe(item.fileName);
        expect(cells[COL.size]).toBe(fmtSize(item.fileSize));
        expect(cells[COL.startTime]).toMatch(DATETIME);
        expect(cells[COL.endTime]).toMatch(DATETIME);
        expect(cells[COL.endTime] >= cells[COL.startTime]).toBe(true);
        expect(cells[COL.createdBy]).toBe(item.requestedBy);
        expect(norm(user)).toContain(item.requestedBy);
        expect(cells[COL.status]).toBe("Completed");
        await expect(expireIcon(rowOfId(page, id))).toHaveCount(1);

        // Tải file thật
        await expect(downloadLink(rowOfId(page, id))).toHaveAttribute("href", item.link);
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), downloadIcon(rowOfId(page, id)).click()]);
        expect(dl.suggestedFilename()).toMatch(new RegExp(`^${item.fileName}`));

        // Xoá bằng icon Delete: request đúng, toast, dòng biến mất
        await deleteIcon(rowOfId(page, id)).click();
        await expect(dialog(page)).toContainText(MSG.deleteOne(id));
        const [req] = await Promise.all([page.waitForRequest(isDelete), dlgConfirm(page).click()]);
        expect(bodyOf(req)).toEqual({ ids: [id] });
        await expect(toasts(page).filter({ hasText: /Delete succes+fully/ }).first()).toBeVisible();
        await settle(page);
        await expect(rowOfId(page, id)).toHaveCount(0);
        await expect(page.getByText(MSG.noEntries).first()).toBeVisible();
        trackedIds.delete(id);
        id = undefined;
      } finally {
        if (id) await cleanup(page, [id]);
      }
    });

    test("Cancel khi xoá file thật: bản ghi vẫn còn; sau đó Delete thì biến mất khỏi danh sách và khỏi lọc theo ID", async ({ page }) => {
      let id;
      try {
        ({ id } = await createExport(page));
        await openPage(page);
        await searchById(page, id);
        await expect(rowOfId(page, id)).toHaveCount(1);

        await deleteIcon(rowOfId(page, id)).click();
        await dlgCancel(page).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(rowOfId(page, id)).toHaveCount(1);
        expect(writes.filter((w) => w.url === "download/delete")).toEqual([]);

        expect(await deleteById(page, id)).toBe(true);
        await expect(rowOfId(page, id)).toHaveCount(0);
        // Tải lại trang (filter ID còn được ghi nhớ): vẫn không còn bản ghi
        await openPage(page);
        await expect(rowOfId(page, id)).toHaveCount(0);
        trackedIds.delete(id);
        id = undefined;
      } finally {
        if (id) await cleanup(page, [id]);
      }
    });

    test("Bulk Delete 2 file QA: chọn 2 dòng, hộp thoại 'Delete 2 files', gửi download/delete {ids:[2 id]}, cả 2 biến mất", async ({ page }) => {
      let ids = [];
      try {
        for (let k = 0; k < 2; k++) ids.push((await createExport(page)).id);
        await openPage(page);
        // Lọc theo Module ADMINISTRATION + Today để 2 file mới nằm ở đầu danh sách (sort mặc định id giảm dần)
        await selectOption(page, "module", "Administration");
        await search(page);
        for (const id of ids) await expect(rowOfId(page, id)).toHaveCount(1);
        for (const id of ids) await rowCheckbox(rowOfId(page, id)).check();

        await bulkDeleteBtn(page).click();
        await expect(dialog(page)).toContainText(MSG.deleteN(2));
        const [req] = await Promise.all([page.waitForRequest(isDelete), dlgConfirm(page).click()]);
        const body = bodyOf(req);
        expect([...body.ids].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
        await expect(dialog(page)).toHaveCount(0);
        await expect(toasts(page).filter({ hasText: "Success" }).first()).toBeVisible();
        await settle(page);
        for (const id of ids) await expect(rowOfId(page, id)).toHaveCount(0);
        await expect(bulkDeleteBtn(page)).toBeDisabled();
        ids.forEach((id) => trackedIds.delete(id));
        ids = [];
      } finally {
        if (ids.length) await cleanup(page, ids);
      }
    });

    test("Export lại cùng filter: hộp thoại 'already exist ... with id N'; Download New hỏi xác nhận xoá file cũ (Cancel không làm gì, OK xoá file cũ và tạo bản ghi mới)", async ({
      page,
    }) => {
      const ids = [];
      try {
        const first = await createExport(page);
        ids.push(first.id);
        await openPage(page);
        await searchById(page, first.id);
        await waitCompleted(page, first.id);

        // Export lần 2 cùng code -> file đã tồn tại (response messageCode EXIST)
        await createExportDuplicate(page, first.code);
        const duplicate = page.getByText(/already exist in download history with id (\d+)/);
        await expect(duplicate).toBeVisible();
        expect((await duplicate.innerText()).match(/with id (\d+)/)[1]).toBe(String(first.id));
        await expect(page.getByRole("button", { name: "Download Now" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Download New" })).toBeVisible();

        // Download New -> hộp thoại xác nhận; Cancel thì không gửi thêm request ghi nào (chỉ có 2 lần Export đã gửi)
        const confirmDlg = page.locator(".ant-modal-content").filter({ hasText: "We will delete the old file" });
        const exportsBefore = writes.length;
        await page.getByRole("button", { name: "Download New" }).click();
        await expect(confirmDlg).toContainText("We will delete the old file download before downloading the new file. Do you agree ?");
        await confirmDlg.getByRole("button", { name: "Cancel" }).click();
        await expect(confirmDlg).toHaveCount(0);
        expect(writes.length, "Cancel không được gửi request ghi").toBe(exportsBefore);

        // Download New -> OK: xoá file cũ rồi Export lại -> id mới, toast processing
        if (!(await page.getByRole("button", { name: "Download New" }).isVisible())) await createExportDuplicate(page, first.code);
        await page.getByRole("button", { name: "Download New" }).click();
        const toast = toasts(page).filter({ hasText: MSG.processing }).first();
        await confirmDlg.getByRole("button", { name: "OK" }).click();
        await expect(toast).toBeVisible();
        const second = Number((await toast.innerText()).match(MSG.processing)[1]);
        trackedIds.add(second);
        createdIds.add(second);
        ids.push(second);
        expect(second).toBeGreaterThan(first.id);
        const deletes = writes.filter((w) => w.url === "download/delete");
        expect(deletes.map((w) => w.body)).toEqual([{ ids: [first.id] }]);

        // Bản ghi cũ đã bị xoá khỏi Download History, bản ghi mới có
        await openPage(page);
        await searchById(page, first.id);
        await expect(rowOfId(page, first.id)).toHaveCount(0);
        await searchById(page, second);
        await expect(rowOfId(page, second)).toHaveCount(1);
        trackedIds.delete(first.id);
      } finally {
        // deleteById trả về false nếu bản ghi không còn (bị xoá bởi Download New)
        await cleanup(page, ids.filter((id) => trackedIds.has(id)));
      }
    });

    // Export lần 2 với code đã dùng: không chờ toast Success (vì app hiện hộp thoại trùng)
    async function createExportDuplicate(page, code) {
      await page.goto(CURRENCY_URL);
      await page.waitForResponse(isCurrencyList, { timeout: 60000 });
      await settle(page);
      await filterEl(page, "code").locator("label").first().click();
      await filterEl(page, "code").locator("input").fill(code);
      await Promise.all([page.waitForRequest(endsWith("/currency/list")), searchBtn(page).click()]);
      await settle(page);
      await Promise.all([page.waitForRequest(isDownload), page.locator("button.NextGen-export-button").click()]);
    }
  });
});
