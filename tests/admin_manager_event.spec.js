// Administration > Event Management  (https://dev-bo.royaledge.io/admin/manager-event)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/admin_manager_event.spec.js --project=setup --project=chromium
//
// Màn hình danh sách "Event Management": nhật ký các sự kiện BO gửi sang GameServer và kết quả xử lý (API POST action-ack/list,
// body {page, pageSize, sortBy:"updatedAt", sortDirection:"desc", filters:{timezoneId}}, response data {totalCount, list:[{traceId, items:[...]}]}).
//  - Filter: CHỈ có Timezone ("timezoneId", dropdown chọn 1, có dấu * bắt buộc, mặc định = timezone của user, danh sách option lấy từ timezone/list,
//    tên option "(GMT +08:00) Asia/Singapore, Singapore"). Xoá Timezone rồi Search thì app KHÔNG gọi API, hiện toast Error "Please start a search with Timezone"
//    và bảng trống. Không có filter nào khác (không Time / Username / Status ...).
//  - Bảng: mỗi dòng cha = 1 nhóm theo Trace ID (list[i].traceId), có nút expand đầu dòng. Dòng cha chỉ hiện Trace ID / Username / Topic / Application
//    (lấy từ item đầu của nhóm); Action Type / Status / Rollback Status / Updated At / Action của dòng cha để TRỐNG. Mở rộng dòng cha sẽ hiện bảng con
//    (mỗi item của nhóm, mới nhất lên trên) gồm cột Instance ID / Username / Topic / Action Type / Application / Status / Rollback Status / Updated At / Action.
//    Status và Rollback Status là tag (chữ cái đầu viết hoa: Fail / Success, NA / Success / Failed / Done / None). 1 nhóm có thể có 1-3 item
//    (vd game-paytable-update + game-paytable-rollback). "Showing x - y of N records": N = số NHÓM (totalCount), không phải số item.
//  - Cột Action của dòng con có icon con mắt: mở modal "Event Detail" (KHÔNG gọi API, dữ liệu lấy từ dòng đã tải) gồm Trace ID / Topic / Payload / Action Type /
//    Application / Instance ID / Status / Detail / Rollback Status / Rollback Detail / Paytable Names (affectedItems, nối bằng ", "; trống hiện "-").
//  - Không có sort cột nào (luôn sortBy updatedAt desc), không có Export / Add / Update / Delete / chọn dòng. Manage Columns chỉ có checkbox ẩn / hiện cột
//    của bảng cha (không có nút Save / Reset to Default).
//  - Filter (Timezone) và số dòng / trang được lưu ở localStorage (key *_admin_manager-event_filter / *_page_size) nên còn nguyên sau reload.
//
// AN TOÀN DỮ LIỆU: TOÀN BỘ test chỉ ĐỌC. Màn hình không có thao tác ghi; request ghi (POST không thuộc nhóm đọc) bị chặn ở tầng mạng (route.abort) và afterEach
// kiểm tra không có request ghi nào được gửi (watchWrites). Không tạo / sửa / xoá bản ghi nào, không có Export. Test "Không có kết quả" dùng response GIẢ của
// action-ack/list (request đọc, không ảnh hưởng dữ liệu). Dữ liệu event là dữ liệu CHUNG, luôn được người khác ghi thêm khi test chạy nên test không so sánh tổng số
// giữa 2 lần gọi API và không hard-code trace id / người dùng / topic: mọi giá trị đều lấy từ chính response.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/admin/manager-event";
const ORIGIN = "https://dev-bo.royaledge.io";

// Bảng cha: cột đầu là ô expand (header rỗng). Đúng thứ tự hiển thị
const COLUMNS = ["Trace ID", "Username", "Topic", "Action Type", "Application", "Status", "Rollback Status", "Updated At", "Action"];
const HEADERS = ["", ...COLUMNS];
// Bảng con: cột đầu là ô đệm (header rỗng), cột "Trace ID" đổi thành "Instance ID"
const CHILD_HEADERS = ["", "Instance ID", "Username", "Topic", "Action Type", "Application", "Status", "Rollback Status", "Updated At", "Action"];
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
const DATETIME = /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/;
const MSG = { noEntries: "There are no entries found", needTimezone: "Please start a search with Timezone" };
// Nhãn dòng của modal "Event Detail" đúng thứ tự
const DETAIL_LABELS = [
  "Trace ID",
  "Topic",
  "Payload",
  "Action Type",
  "Application",
  "Instance ID",
  "Status",
  "Detail",
  "Rollback Status",
  "Rollback Detail",
  "Paytable Names",
];
// Màu tag theo giá trị (đã quan sát): Status và Rollback Status
const STATUS_TAG = { Success: "tag-success", Fail: "tag-error" };
const ROLLBACK_TAG = { NA: "tag-warning", Success: "tag-success", Failed: "tag-error", Done: "tag-success", None: "tag-default" };

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI. Màn hình này gọi: action-ack/list, action-ack/notify/list, timezone/list, user/details, alertreport/list ...
// (cộng thêm geofencing/ip-restrict-list vì test điều hướng menu có ghé màn Geofencing; đây cũng là request đọc)
const READ = /\/(list|details|download|view)(\?|$)|\/dropdown\/|_dropdown(\?|$)|\/ip-restrict-list(\?|$)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/action-ack/list");
const isTimezoneList = endsWith("/timezone/list");

const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
// Chữ cái đầu viết hoa, phần còn lại giữ nguyên ("fail" -> "Fail", "NA" -> "NA")
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
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
// Tên option timezone theo timezone/list: "(GMT +08:00) Asia/Singapore, Singapore"
const tzTitle = (t) => `(${t.gmtOffset}) ${t.timezone}, ${t.countryName}`;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Bảng chính. Header + body nằm chung 1 .NextGen-table; bảng con (khi mở rộng dòng) lồng bên trong nên mọi locator của bảng cha
// phải đi qua thead / tbody ĐẦU TIÊN và dùng ":scope >" để không lẫn dòng của bảng con.
const table = (page) => page.locator(".NextGen-table").first();
const mainHead = (page) => table(page).locator("thead").first();
const mainBody = (page) => table(page).locator("tbody").first();
const rows = (page) => mainBody(page).locator(":scope > tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const rowOf = (page, traceId) => mainBody(page).locator(`:scope > tr.ant-table-row[data-row-key="${traceId}"]`);
const th = (page, name) => mainHead(page).locator("th").filter({ hasText: exact(name) });
const expandBtn = (row) => row.locator("button.ant-table-row-expand-icon");
const expandedRowOf = (row) => row.locator("xpath=following-sibling::tr[1]");
const childRows = (row) => expandedRowOf(row).locator("tbody tr.ant-table-row");
const eyeIcon = (childRow) => childRow.locator("svg[data-icon=eye]");

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
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

// Khi filter vừa đổi, Search đôi khi gửi 2 request list GIỐNG HỆT nhau cách nhau ~200ms: chờ mạng yên sau mỗi lần gọi
// để request thừa không bị nhầm là request của thao tác kế tiếp.
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
}

// Danh sách timezone của lần mở trang gần nhất (response timezone/list) - dùng để đối chiếu option của dropdown
let tzList = [];

// Mở màn hình và chờ lần load đầu tiên (filter mặc định) xong. Trả về response action-ack/list đầu tiên
async function openPage(page) {
  test.setTimeout(Math.max(test.info().timeout, 90000));
  const firstLoad = page.waitForResponse(isList, { timeout: 60000 });
  firstLoad.catch(() => {}); // tránh unhandled rejection khi test kết thúc sớm
  const tzLoad = page.waitForResponse(isTimezoneList, { timeout: 60000 });
  tzLoad.catch(() => {});
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
  const res = await firstLoad;
  const json = await res.json();
  tzList = (await (await tzLoad).json()).data ?? [];
  await settle(page);
  await expect(page.locator(".NextGen-filter-bar")).toBeVisible();
  return json;
}

// Bấm Search, trả về { body, status, json }. Lấy response từ chính request vừa gửi.
async function search(page) {
  const [req] = await Promise.all([page.waitForRequest(isList), searchBtn(page).click()]);
  const res = await req.response();
  const json = await res.json();
  await settle(page);
  return { body: bodyOf(req), status: res.status(), json };
}

// Thực hiện 1 hành động làm bảng gọi lại API (đổi trang, đổi số dòng...) rồi trả về { body, json }
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

const headers = async (page) => (await mainHead(page).locator("th").allInnerTexts()).map((t) => t.trim());
const totalOf = async (page) => num((await summary(page).innerText()).match(/of ([\d,]+) records/)[1]);

// Toàn bộ ô của bảng cha ở trang hiện tại: [{ id (data-row-key), cells: [text...] }]
const tableMatrix = (page) =>
  rows(page).evaluateAll((trs) =>
    trs.map((tr) => ({
      id: tr.getAttribute("data-row-key"),
      cells: [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()),
    })),
  );

// Toàn bộ ô của các dòng con (đã mở rộng) của 1 dòng cha: [{ id (ackResultId), cells, tags: [class tag...] }]
const childMatrix = (row) =>
  childRows(row).evaluateAll((trs) =>
    trs.map((tr) => ({
      id: tr.getAttribute("data-row-key"),
      cells: [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()),
      tags: [...tr.children].map((td) => td.querySelector(".ant-tag")?.className.match(/tag-\w+/)?.[0] ?? null),
    })),
  );

// Mở rộng dòng cha của nhóm có traceId cho trước; trả về locator dòng cha
async function expandGroup(page, traceId) {
  const row = rowOf(page, traceId);
  await row.scrollIntoViewIfNeeded();
  await expandBtn(row).click();
  await expect(expandBtn(row)).toHaveAttribute("aria-expanded", "true");
  await expect(childRows(row).first()).toBeVisible();
  return row;
}

// Mở rộng TẤT CẢ dòng cha đang hiển thị
async function expandAll(page) {
  const n = await rows(page).count();
  for (let i = 0; i < n; i++) {
    const btn = expandBtn(rowAt(page, i));
    if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  }
  await expect(page.locator(".ant-table-row-expand-icon-expanded")).toHaveCount(n);
}

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
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
// Múi giờ không có DST, khác múi giờ hiện tại
const otherZone = (currentTitle) => ["Asia/Bangkok", "Asia/Tokyo"].find((z) => !currentTitle.includes(z));

// Xoá Timezone bằng nút (x) (chỉ render khi rê chuột vào ô)
async function clearTimezone(page) {
  await filterEl(page, "timezoneId").hover();
  await filterEl(page, "timezoneId").locator(".ant-select-clear").click({ force: true });
  await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toHaveCount(0);
}

// Có dữ liệu thì mới test tiếp (dev dùng chung nên gần như luôn có)
async function ensureData(page) {
  test.skip((await rows(page).count()) === 0, "Event Management không có bản ghi nào để test");
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

// Nội dung mong đợi của modal "Event Detail" cho 1 item của response
const expectedDetail = (it) => ({
  "Trace ID": it.traceId,
  Topic: it.topic,
  Payload: norm(it.payLoad),
  "Action Type": it.actionType,
  Application: it.application,
  "Instance ID": it.instanceId,
  Status: cap(it.status),
  Detail: norm(it.detail) || "-",
  "Rollback Status": cap(it.rollbackStatus),
  "Rollback Detail": norm(it.rollbackDetail) || "-",
  "Paytable Names": (it.affectedItems ?? []).map((a) => a.name).join(", ") || "-",
});

// Các dòng nhãn / giá trị trong modal "Event Detail": [{ label, value }]
const modalFields = (page) =>
  modal(page)
    .locator(".ant-descriptions-row")
    .evaluateAll((rs) =>
      rs.map((r) => ({
        label: r.querySelector("th").innerText.trim(),
        value: r.querySelector("td").innerText.replace(/\s+/g, " ").trim(),
      })),
    );

// Mở modal chi tiết của item thứ k trong nhóm (mở rộng dòng cha trước); trả về locator dòng cha
async function openDetail(page, group, k) {
  const row = await expandGroup(page, group.traceId);
  const child = childRows(row).nth(k);
  await eyeIcon(child).click();
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).locator(".ant-modal-title")).toHaveText("Event Detail");
  return row;
}

// Đặt số dòng / trang rồi trả về { body, json } của request vừa gửi
async function setPageSize(page, label) {
  await pageSizeSelect(page).click();
  return reloadFull(page, () => openOptions(page).filter({ hasText: exact(label) }).click());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Administration > Event Management", () => {
  let writes;
  let first; // response action-ack/list của lần load đầu

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, số dòng/trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__admin_manager_event_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/admin_manager-event_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__admin_manager_event_spec_cleared", "1");
    });
    writes = watchWrites(page);
    await blockWrites(page);
    first = await openPage(page);
  });

  // Màn hình chỉ đọc: không được có request ghi nào
  test.afterEach(async () => {
    expect(writes, "Màn hình chỉ đọc: không được gửi request ghi dữ liệu").toEqual([]);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề 'Event Management' (breadcrumb)", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Event Management");
    });

    test("Chỉ có 1 filter Timezone (bắt buộc, dấu *) và 2 nút Search / Reset", async ({ page }) => {
      await expect(page.locator(".NextGen-filter-element")).toHaveCount(1);
      await expect(filterEl(page, "timezoneId")).toContainText("Timezone");
      await expect(filterEl(page, "timezoneId").locator("label").first()).toHaveText("Timezone*");
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Timezone là dropdown chọn 1 giá trị, mặc định là timezone của user (khớp timezoneId của request đầu)", async ({ page }) => {
      await expect(filterEl(page, "timezoneId").locator(".ant-select")).toHaveCount(1);
      await expect(filterEl(page, "timezoneId").locator(".ant-select-multiple")).toHaveCount(0);
      const title = await currentTimezone(page);
      expect(title).toMatch(/^\(GMT [+-]\d{2}:\d{2}\) \S+, .+$/);
      const { body } = await search(page);
      const tz = tzList.find((t) => t.id === body.filters.timezoneId);
      expect(tz, "timezoneId của request phải có trong timezone/list").toBeTruthy();
      expect(title).toBe(tzTitle(tz));
    });

    test(`Bảng cha có đủ ${COLUMNS.length} cột (kèm ô expand đầu dòng) đúng thứ tự`, async ({ page }) => {
      expect(await headers(page)).toEqual(HEADERS);
    });

    test("Có Manage Columns; không có Add New / Export / cột chọn dòng", async ({ page }) => {
      await expect(columnBtn(page)).toBeVisible();
      await expect(page.getByRole("button", { name: /Add New/ })).toHaveCount(0);
      await expect(page.locator("button.NextGen-export-button")).toHaveCount(0);
      await expect(table(page).locator('input[type="checkbox"]')).toHaveCount(0);
    });

    test("Request mặc định khi mở màn hình: trang 1, 10 dòng, sort updatedAt giảm dần, filters chỉ có timezoneId", async ({ page }) => {
      const [req] = await Promise.all([page.waitForRequest(isList), page.reload()]);
      const body = bodyOf(req);
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "updatedAt", sortDirection: "desc" });
      expect(Object.keys(body.filters)).toEqual(["timezoneId"]);
      expect(body.filters.timezoneId).toEqual(expect.any(Number));
      const res = await req.response();
      expect(res.status()).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("success");
      expect(json.data.list.length).toBeLessThanOrEqual(10);
    });

    test("Dòng tóm tắt 'Showing 1 - n of N records' khớp totalCount và số dòng hiển thị", async ({ page }) => {
      test.skip(first.data.list.length === 0, "Không có dữ liệu");
      const shown = Math.min(10, first.data.totalCount);
      await expect(summary(page)).toHaveText(`Showing 1 - ${shown} of ${first.data.totalCount} records`);
      await expect(rows(page)).toHaveCount(first.data.list.length);
      expect(first.data.list.length).toBe(shown);
    });

    test("Nút Filter thu gọn / mở rộng thanh filter", async ({ page }) => {
      const bar = page.locator(".NextGen-filter-bar__items");
      await expect(bar).toBeVisible();
      await filterToggle(page).click();
      await expect(bar).toBeHidden();
      await filterToggle(page).click();
      await expect(bar).toBeVisible();
    });

    test("Điều hướng bằng menu: sang Geofencing rồi quay lại Event Management vẫn hiện đủ danh sách", async ({ page }) => {
      // Lưu ý: khi quay lại trong cùng phiên SPA app có thể dùng cache nên không chờ request list
      await page.locator("a[href='/admin/geofencing']").click();
      await expect(page).toHaveURL(/\/admin\/geofencing$/);
      await page.locator("a[href='/admin/manager-event']").click();
      await expect(page).toHaveURL(/\/admin\/manager-event$/);
      await expect(breadcrumb(page)).toHaveText("Event Management");
      await expect(rows(page).first()).toBeVisible();
    });
  });

  // ===== 2. Dữ liệu bảng (dòng cha) =====
  test.describe("Dữ liệu bảng (dòng cha theo Trace ID)", () => {
    test("Mỗi dòng cha khớp response: Trace ID, Username, Topic, Application lấy từ item đầu của nhóm", async ({ page }) => {
      const list = first.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      const matrix = await tableMatrix(page);
      expect(matrix).toHaveLength(list.length);
      for (const [i, g] of list.entries()) {
        const at = `dòng ${i + 1} (trace ${g.traceId})`;
        const it = g.items[0];
        const c = matrix[i].cells;
        expect(matrix[i].id, at).toBe(g.traceId);
        expect(c[1], at).toBe(g.traceId);
        expect(c[2], at).toBe(norm(it.username));
        expect(c[3], at).toBe(norm(it.topic));
        expect(c[5], at).toBe(norm(it.application));
      }
    });

    test("Dòng cha để trống các cột Action Type, Status, Rollback Status, Updated At, Action", async ({ page }) => {
      await ensureData(page);
      for (const [i, m] of (await tableMatrix(page)).entries()) {
        for (const col of [4, 6, 7, 8, 9]) expect(m.cells[col], `dòng ${i + 1} cột ${HEADERS[col]}`).toBe("");
      }
      await expect(table(page).locator("tbody").first().locator(":scope > tr.ant-table-row .ant-tag")).toHaveCount(0);
    });

    test("Các cột chữ của dòng cha không trống; Trace ID không trùng nhau", async ({ page }) => {
      await ensureData(page);
      const matrix = await tableMatrix(page);
      for (const m of matrix) {
        for (const col of [1, 2, 3, 5]) expect(m.cells[col], `${m.id} cột ${HEADERS[col]}`).not.toBe("");
      }
      const ids = matrix.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    test("Mỗi dòng cha có đúng 1 nút expand, mặc định thu gọn", async ({ page }) => {
      await ensureData(page);
      const n = await rows(page).count();
      await expect(rows(page).locator("button.ant-table-row-expand-icon")).toHaveCount(n);
      await expect(page.locator(".ant-table-row-expand-icon-expanded")).toHaveCount(0);
      await expect(page.locator("tr.ant-table-expanded-row")).toHaveCount(0);
    });

    test("Mặc định sắp xếp theo Updated At giảm dần (theo item đầu của nhóm)", async ({ page }) => {
      const list = first.data.list;
      test.skip(list.length < 2, "Không đủ dữ liệu");
      const times = list.map((g) => toIso(g.items[0].updatedAt));
      expect(times).toEqual([...times].sort((a, b) => cmp(b, a)));
    });

    test("Ràng buộc dữ liệu: mỗi nhóm có 1+ item, item cùng Trace ID với nhóm, Updated At đúng định dạng và giảm dần trong nhóm", async ({ page }) => {
      const list = first.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      for (const g of list) {
        expect(g.items.length, g.traceId).toBeGreaterThan(0);
        for (const it of g.items) {
          expect(it.traceId, g.traceId).toBe(g.traceId);
          expect(it.updatedAt, g.traceId).toMatch(DATETIME);
        }
        const t = g.items.map((it) => toIso(it.updatedAt));
        expect(t, g.traceId).toEqual([...t].sort((a, b) => cmp(b, a)));
      }
    });
  });

  // ===== 3. Bảng con (mở rộng dòng) =====
  test.describe("Mở rộng dòng (bảng con)", () => {
    test("Bấm nút expand hiện bảng con đúng cột, bấm lần nữa thì thu gọn", async ({ page }) => {
      const g = first.data.list[0];
      test.skip(!g, "Không có dữ liệu");
      const row = await expandGroup(page, g.traceId);
      const head = (await expandedRowOf(row).locator("thead th").allInnerTexts()).map((t) => t.trim());
      expect(head).toEqual(CHILD_HEADERS);
      await expect(childRows(row)).toHaveCount(g.items.length);

      await expandBtn(row).click();
      await expect(expandBtn(row)).toHaveAttribute("aria-expanded", "false");
      await expect(expandedRowOf(row)).toBeHidden();
    });

    test("Mở rộng không gọi API (dữ liệu có sẵn trong response danh sách)", async ({ page }) => {
      const g = first.data.list[0];
      test.skip(!g, "Không có dữ liệu");
      const calls = [];
      const onReq = (r) => {
        if (/boapi/.test(r.url())) calls.push(r.url());
      };
      page.on("request", onReq);
      await expandGroup(page, g.traceId);
      await settle(page);
      page.off("request", onReq);
      expect(calls).toEqual([]);
    });

    test("Mọi dòng con của trang hiện tại khớp response (Instance ID, Username, Topic, Action Type, Application, Status, Rollback Status, Updated At)", async ({ page }) => {
      const list = first.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      await expandAll(page);
      for (const g of list) {
        const m = await childMatrix(rowOf(page, g.traceId));
        expect(m, g.traceId).toHaveLength(g.items.length);
        for (const [k, it] of g.items.entries()) {
          const at = `nhóm ${g.traceId} item ${k + 1} (ack ${it.ackResultId})`;
          const c = m[k].cells;
          expect(m[k].id, at).toBe(String(it.ackResultId));
          expect(c[1], at).toBe(norm(it.instanceId));
          expect(c[2], at).toBe(norm(it.username));
          expect(c[3], at).toBe(norm(it.topic));
          expect(c[4], at).toBe(norm(it.actionType));
          expect(c[5], at).toBe(norm(it.application));
          expect(c[6], at).toBe(cap(it.status));
          expect(c[7], at).toBe(cap(it.rollbackStatus));
          expect(c[8], at).toBe(it.updatedAt);
        }
      }
    });

    test("Tổng số dòng con khi mở rộng tất cả = tổng số item của trang", async ({ page }) => {
      const list = first.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      await expandAll(page);
      const total = list.reduce((s, g) => s + g.items.length, 0);
      await expect(page.locator("tr.ant-table-expanded-row tbody tr.ant-table-row")).toHaveCount(total);
    });

    test("Status và Rollback Status là tag đúng màu; Updated At đúng định dạng; mỗi dòng con có đúng 1 icon xem chi tiết", async ({ page }) => {
      const list = first.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      await expandAll(page);
      for (const g of list) {
        const row = rowOf(page, g.traceId);
        const m = await childMatrix(row);
        for (const [k, it] of g.items.entries()) {
          const at = `nhóm ${g.traceId} item ${k + 1}`;
          // Chỉ kiểm tra màu với các giá trị đã biết; giá trị mới sẽ báo rõ để bổ sung vào bảng
          expect(STATUS_TAG, `Status lạ "${cap(it.status)}" - cần bổ sung`).toHaveProperty(cap(it.status));
          expect(ROLLBACK_TAG, `Rollback Status lạ "${cap(it.rollbackStatus)}" - cần bổ sung`).toHaveProperty(cap(it.rollbackStatus));
          expect(m[k].tags[6], `${at} Status`).toBe(STATUS_TAG[cap(it.status)]);
          expect(m[k].tags[7], `${at} Rollback Status`).toBe(ROLLBACK_TAG[cap(it.rollbackStatus)]);
          expect(m[k].cells[8], at).toMatch(DATETIME);
          await expect(childRows(row).nth(k).locator("svg"), at).toHaveCount(1);
          await expect(eyeIcon(childRows(row).nth(k)), at).toHaveCount(1);
        }
      }
    });

    test("Các cột chữ của dòng con không trống (Instance ID, Username, Topic, Action Type, Application)", async ({ page }) => {
      const list = first.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      await expandAll(page);
      for (const g of list) {
        for (const [k, c] of (await childMatrix(rowOf(page, g.traceId))).entries()) {
          for (const col of [1, 2, 3, 4, 5]) expect(c.cells[col], `nhóm ${g.traceId} item ${k + 1} cột ${CHILD_HEADERS[col]}`).not.toBe("");
        }
      }
    });

    test("Nhóm có nhiều item: dòng con theo thứ tự response (mới nhất lên trên)", async ({ page }) => {
      // Trang đầu (10 nhóm) thường không có nhóm nhiều item (~1/4 nhóm có) nên nạp 200 nhóm/trang để chắc chắn có
      const { json } = await setPageSize(page, "200 / page");
      const g = json.data.list.find((x) => x.items.length > 1);
      test.skip(!g, "Không có nhóm nhiều item");
      const row = await expandGroup(page, g.traceId);
      const m = await childMatrix(row);
      expect(m.map((x) => x.id)).toEqual(g.items.map((it) => String(it.ackResultId)));
      expect(m.map((x) => x.cells[8])).toEqual(g.items.map((it) => it.updatedAt));
    });
  });

  // ===== 4. Chi tiết (modal Event Detail) =====
  test.describe("Event Detail (modal)", () => {
    test("Bấm icon con mắt mở modal 'Event Detail' đủ nhãn đúng thứ tự, không gọi API", async ({ page }) => {
      const g = first.data.list[0];
      test.skip(!g, "Không có dữ liệu");
      const calls = [];
      const onReq = (r) => {
        if (/boapi/.test(r.url())) calls.push(r.url());
      };
      page.on("request", onReq);
      await openDetail(page, g, 0);
      await settle(page);
      page.off("request", onReq);
      expect(calls).toEqual([]);
      expect((await modalFields(page)).map((f) => f.label)).toEqual(DETAIL_LABELS);
    });

    test("Nội dung modal khớp response của item (dòng đầu của danh sách)", async ({ page }) => {
      const g = first.data.list[0];
      test.skip(!g, "Không có dữ liệu");
      await openDetail(page, g, 0);
      const exp = expectedDetail(g.items[0]);
      const got = Object.fromEntries((await modalFields(page)).map((f) => [f.label, f.value]));
      expect(got).toEqual(exp);
    });

    test("Nội dung modal khớp response với mọi item của trang đầu", async ({ page }) => {
      const list = first.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      test.setTimeout(240000);
      await expandAll(page);
      for (const g of list) {
        for (const [k, it] of g.items.entries()) {
          await eyeIcon(childRows(rowOf(page, g.traceId)).nth(k)).click();
          await expect(modal(page)).toBeVisible();
          const got = Object.fromEntries((await modalFields(page)).map((f) => [f.label, f.value]));
          expect(got, `nhóm ${g.traceId} item ${k + 1}`).toEqual(expectedDetail(it));
          await modal(page).locator("button.ant-modal-close").click();
          await expect(modal(page)).toBeHidden();
        }
      }
    });

    test("Status / Rollback Status trong modal là tag cùng màu với bảng", async ({ page }) => {
      const g = first.data.list[0];
      test.skip(!g, "Không có dữ liệu");
      const it = g.items[0];
      await openDetail(page, g, 0);
      const tags = await modal(page).locator(".ant-tag").evaluateAll((es) => es.map((e) => [e.innerText.trim(), e.className.match(/tag-\w+/)?.[0]]));
      expect(tags).toEqual([
        [cap(it.status), STATUS_TAG[cap(it.status)]],
        [cap(it.rollbackStatus), ROLLBACK_TAG[cap(it.rollbackStatus)]],
      ]);
    });

    test("Item thứ 2 của nhóm nhiều item: modal hiển thị đúng item đó (không phải item đầu)", async ({ page }) => {
      const { json } = await setPageSize(page, "200 / page");
      const g = json.data.list.find((x) => x.items.length > 1);
      test.skip(!g, "Không có nhóm nhiều item");
      await openDetail(page, g, 1);
      const got = Object.fromEntries((await modalFields(page)).map((f) => [f.label, f.value]));
      expect(got).toEqual(expectedDetail(g.items[1]));
      expect(got["Instance ID"]).toBe(g.items[1].instanceId);
    });

    test("Paytable Names nhiều giá trị nối bằng dấu phẩy; item không có thì hiện '-'", async ({ page }) => {
      const { json } = await setPageSize(page, "200 / page");
      const multi = json.data.list.find((g) => g.items.some((it) => (it.affectedItems ?? []).length >= 2));
      const none = json.data.list.find((g) => g.items.some((it) => (it.affectedItems ?? []).length === 0));
      test.skip(!multi || !none, "Không có đủ dữ liệu (cần item có 2+ paytable và item không có paytable)");
      for (const [g, pred] of [
        [multi, (it) => (it.affectedItems ?? []).length >= 2],
        [none, (it) => (it.affectedItems ?? []).length === 0],
      ]) {
        const k = g.items.findIndex(pred);
        await openDetail(page, g, k);
        const got = Object.fromEntries((await modalFields(page)).map((f) => [f.label, f.value]));
        expect(got["Paytable Names"]).toBe(expectedDetail(g.items[k])["Paytable Names"]);
        await modal(page).locator("button.ant-modal-close").click();
        await expect(modal(page)).toBeHidden();
      }
    });

    test("Rollback Failed có Rollback Detail: modal hiện đúng nội dung lỗi", async ({ page }) => {
      const { json } = await setPageSize(page, "200 / page");
      const g = json.data.list.find((x) => x.items.some((it) => it.rollbackStatus === "failed" && it.rollbackDetail));
      test.skip(!g, "Không có item rollback failed kèm detail");
      const k = g.items.findIndex((it) => it.rollbackStatus === "failed" && it.rollbackDetail);
      await openDetail(page, g, k);
      const got = Object.fromEntries((await modalFields(page)).map((f) => [f.label, f.value]));
      expect(got["Rollback Status"]).toBe("Failed");
      expect(got["Rollback Detail"]).toBe(norm(g.items[k].rollbackDetail));
    });

    test("Đóng modal bằng nút (x)", async ({ page }) => {
      const g = first.data.list[0];
      test.skip(!g, "Không có dữ liệu");
      await openDetail(page, g, 0);
      await modal(page).locator("button.ant-modal-close").click();
      await expect(modal(page)).toBeHidden();
    });

    test("Đóng modal bằng phím Esc (sau khi click tiêu đề modal để có focus)", async ({ page }) => {
      const g = first.data.list[0];
      test.skip(!g, "Không có dữ liệu");
      await openDetail(page, g, 0);
      await modal(page).locator(".ant-modal-title").click();
      await page.keyboard.press("Escape");
      await expect(modal(page)).toBeHidden();
    });

    test("Mở modal của dòng khác thì hiển thị đúng dòng đó", async ({ page }) => {
      const list = first.data.list;
      test.skip(list.length < 2, "Không đủ dữ liệu");
      await openDetail(page, list[0], 0);
      await modal(page).locator("button.ant-modal-close").click();
      await expect(modal(page)).toBeHidden();
      await openDetail(page, list[1], 0);
      const got = Object.fromEntries((await modalFields(page)).map((f) => [f.label, f.value]));
      expect(got["Trace ID"]).toBe(list[1].traceId);
      expect(got["Instance ID"]).toBe(list[1].items[0].instanceId);
    });
  });

  // ===== 5. Search / Filter =====
  test.describe("Search / Filter (Timezone)", () => {
    test("Search mặc định gửi đúng request (timezone, phân trang, sort) và không có filter nào khác", async ({ page }) => {
      const { body, status, json } = await search(page);
      expect(status).toBe(200);
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "updatedAt", sortDirection: "desc" });
      expect(Object.keys(body.filters)).toEqual(["timezoneId"]);
      expect(json.status).toBe("success");
    });

    test("Dropdown Timezone load được danh sách option, tên đúng dạng '(GMT ±hh:mm) vùng, quốc gia' và khớp timezone/list", async ({ page }) => {
      const titles = await dropdownOptions(page, "timezoneId");
      expect(titles.length).toBeGreaterThan(50);
      for (const t of titles) expect(t).toMatch(/^\(GMT [+-]\d{2}:\d{2}\) \S+, .+$/);
      const known = new Set(tzList.map(tzTitle));
      expect(known.size).toBeGreaterThan(50);
      for (const t of titles) expect(known.has(t), `option "${t}" không có trong timezone/list`).toBe(true);
    });

    test("Gõ tên vào ô Timezone để tìm: chỉ còn option khớp", async ({ page }) => {
      await openDropdown(page, "timezoneId");
      await page.keyboard.type("Bangkok");
      await expect(openOptions(page).first()).toBeVisible();
      const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      expect(titles.length).toBeGreaterThan(0);
      for (const t of titles) expect(t.toLowerCase()).toContain("bangkok");
      await breadcrumb(page).click();
    });

    test("Đổi Timezone: gửi timezoneId mới và Updated At của cùng 1 nhóm lệch đúng bằng chênh lệch múi giờ", async ({ page }) => {
      test.skip(first.data.list.length === 0, "Không có dữ liệu");
      const before = await search(page);
      const currentTitle = await currentTimezone(page);
      const zone = otherZone(currentTitle);
      await pickTimezone(page, zone);
      const newTitle = await currentTimezone(page);
      const after = await search(page);

      expect(after.body.filters.timezoneId).not.toBe(before.body.filters.timezoneId);
      expect(after.body.filters.timezoneId).toBe(tzList.find((t) => tzTitle(t) === newTitle).id);
      const expectedShift = gmtMinutes(newTitle) - gmtMinutes(currentTitle);
      expect(expectedShift, "2 múi giờ phải khác nhau").not.toBe(0);
      // Event mới có thể được ghi thêm giữa 2 lần gọi -> chỉ so các nhóm có ở cả 2 response
      const beforeById = new Map(before.json.data.list.map((g) => [g.traceId, g.items[0].updatedAt]));
      const common = after.json.data.list.filter((g) => beforeById.has(g.traceId));
      expect(common.length, "phải có nhóm chung giữa 2 lần gọi").toBeGreaterThan(0);
      for (const g of common) {
        expect(toMinutes(g.items[0].updatedAt) - toMinutes(beforeById.get(g.traceId)), `nhóm ${g.traceId}`).toBe(expectedShift);
      }
      // Bảng hiển thị đúng giá trị của response mới (Updated At nằm ở bảng con)
      const g0 = after.json.data.list[0];
      const row = await expandGroup(page, g0.traceId);
      expect((await childMatrix(row)).map((c) => c.cells[8])).toEqual(g0.items.map((it) => it.updatedAt));
    });

    // Hành vi hiện tại: Timezone có dấu * (bắt buộc) - xoá đi rồi Search thì app KHÔNG gửi request, hiện toast Error và làm trống bảng.
    test("Xoá Timezone rồi Search: không gọi API, hiện toast 'Please start a search with Timezone' và bảng trống", async ({ page }) => {
      await clearTimezone(page);
      const calls = [];
      const onReq = (r) => {
        if (isList(r)) calls.push(bodyOf(r));
      };
      page.on("request", onReq);
      await searchBtn(page).click();
      await expect(toasts(page).filter({ hasText: MSG.needTimezone })).toBeVisible();
      await expect(toasts(page).filter({ hasText: MSG.needTimezone })).toContainText("Error");
      await settle(page);
      page.off("request", onReq);
      expect(calls, "không được gửi request khi thiếu Timezone").toEqual([]);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText(MSG.noEntries).first()).toBeVisible();
      await expect(summary(page)).toHaveCount(0);
    });

    test("Không có kết quả (response giả danh sách rỗng) -> hiển thị 'There are no entries found'", async ({ page }) => {
      // Màn hình chỉ có filter Timezone nên không thể tạo "không có kết quả" bằng dữ liệu thật: dùng response GIẢ cho request ĐỌC action-ack/list
      await page.route(/boapi/, (route) => {
        if (isList(route.request())) {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": ORIGIN, "access-control-allow-credentials": "true" },
            body: JSON.stringify({ status: "success", messageCode: "SUCCESS", message: "SUCCESS", data: { totalCount: 0, list: [] } }),
          });
        }
        return route.fallback();
      });
      await search(page);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText(MSG.noEntries).first()).toBeVisible();
      await expect(summary(page)).toHaveCount(0);
    });

    test("Search khi đang ở trang 2 thì quay về trang 1", async ({ page }) => {
      const total = await totalOf(page);
      test.skip(total <= 10, `Chỉ có ${total} bản ghi`);
      await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      await expect(summary(page)).toHaveText(/^Showing 11 - 20 of /);
      const { body } = await search(page);
      expect(body.page).toBe(1);
      await expect(summary(page)).toHaveText(/^Showing 1 - 10 of /);
    });
  });

  // ===== 6. Reset =====
  test.describe("Reset", () => {
    test("Reset đưa Timezone về mặc định và gửi lại request mặc định", async ({ page }) => {
      const defaultTz = await currentTimezone(page);
      const defaultBody = (await search(page)).body;
      await pickTimezone(page, otherZone(defaultTz));
      const changed = await search(page);
      expect(changed.body.filters.timezoneId).not.toBe(defaultBody.filters.timezoneId);

      const bodies = await resetBodies(page);
      expect(await currentTimezone(page)).toBe(defaultTz);
      expect(bodies.length, "Reset phải gọi lại API").toBeGreaterThan(0);
      expect(bodies[bodies.length - 1]).toEqual(defaultBody);
    });

    test("Reset khi filter đang là mặc định không gọi lại API", async ({ page }) => {
      const bodies = await resetBodies(page);
      expect(bodies).toEqual([]);
      await expect(rows(page).first()).toBeVisible();
    });

    test("Reset sau khi xoá Timezone: Timezone về mặc định và bảng nạp lại dữ liệu", async ({ page }) => {
      test.skip(first.data.list.length === 0, "Không có dữ liệu");
      const defaultTz = await currentTimezone(page);
      await clearTimezone(page);
      await searchBtn(page).click();
      await expect(rows(page)).toHaveCount(0);

      const bodies = await resetBodies(page);
      expect(await currentTimezone(page)).toBe(defaultTz);
      expect(bodies.length, "Reset phải gọi lại API").toBeGreaterThan(0);
      await expect(rows(page).first()).toBeVisible();
    });

    // HÀNH VI ĐÚNG (đã được user xác nhận): Reset khi đang ở trang 2 giữ nguyên trang đang xem.
    test("Reset khi đang ở trang 2 (có filter): đặt lại filter nhưng giữ nguyên trang 2", async ({ page }) => {
      const total = await totalOf(page);
      test.skip(total <= 10, `Chỉ có ${total} bản ghi`);
      await pickTimezone(page, otherZone(await currentTimezone(page)));
      await search(page);
      await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      await expect(summary(page)).toHaveText(/^Showing 11 - 20 of /);

      const bodies = await resetBodies(page);
      expect(bodies.length, "Reset phải gọi lại API").toBeGreaterThan(0);
      expect(bodies[bodies.length - 1].page, "Reset giữ nguyên trang 2").toBe(2);
      await expect(summary(page)).toHaveText(/^Showing 11 - 20 of /);
    });
  });

  // ===== 7. Phân trang =====
  test.describe("Phân trang", () => {
    test.beforeEach(async ({ page }) => {
      const total = await totalOf(page);
      test.skip(total <= 20, `Chỉ có ${total} bản ghi, không đủ để test phân trang`);
    });

    test("Chuyển sang trang 2 rồi quay lại trang 1", async ({ page }) => {
      const page1 = (await tableMatrix(page)).map((m) => m.id);

      const body2 = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      expect(body2.page).toBe(2);
      await expect(summary(page)).toHaveText(/^Showing 11 - 20 of /);
      expect((await tableMatrix(page)).map((m) => m.id)).not.toEqual(page1);

      const body1 = await reloadBy(page, () => page.locator(".ant-pagination-item-1").click());
      expect(body1.page).toBe(1);
      await expect(summary(page)).toHaveText(/^Showing 1 - 10 of /);
      expect((await tableMatrix(page)).map((m) => m.id).length).toBe(page1.length);
    });

    test("Dòng của trang 2 khớp response (Trace ID theo thứ tự) và không trùng trang 1", async ({ page }) => {
      const { json } = await reloadFull(page, () => page.locator(".ant-pagination-item-2").click());
      expect((await tableMatrix(page)).map((m) => m.id)).toEqual(json.data.list.map((g) => g.traceId));
      const page1Ids = new Set(first.data.list.map((g) => g.traceId));
      const overlap = json.data.list.filter((g) => page1Ids.has(g.traceId));
      // Event mới ghi thêm giữa 2 lần gọi có thể đẩy 1-2 nhóm sang trang 2 -> chỉ yêu cầu phần lớn là nhóm mới
      expect(overlap.length).toBeLessThan(json.data.list.length);
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

    test("Mỗi lựa chọn số dòng / trang gửi đúng pageSize và hiện tối đa từng ấy dòng", async ({ page }) => {
      for (const label of PAGE_SIZES.slice(2)) {
        const size = Number(label.match(/\d+/)[0]);
        const { body, json } = await setPageSize(page, label);
        expect(body.pageSize).toBe(size);
        await expect(rows(page)).toHaveCount(Math.min(size, json.data.totalCount));
      }
    });

    test("Giữ nguyên filter (Timezone) khi chuyển trang", async ({ page }) => {
      await pickTimezone(page, otherZone(await currentTimezone(page)));
      const firstSearch = await search(page);
      test.skip(firstSearch.json.data.totalCount <= 10, "Chỉ có 1 trang");

      const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(body.page).toBe(2);
      expect(body.filters).toEqual(firstSearch.body.filters);
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

  // ===== 8. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    test("Không cột nào có chức năng sort; bấm vào header không gọi lại API", async ({ page }) => {
      for (const column of COLUMNS) {
        await expect(th(page, column), column).not.toHaveClass(/ant-table-column-has-sorters/);
      }
      await expect(mainHead(page).locator(".ant-table-column-has-sorters")).toHaveCount(0);

      const calls = [];
      const onReq = (r) => {
        if (isList(r)) calls.push(bodyOf(r));
      };
      page.on("request", onReq);
      await th(page, "Updated At").click();
      await th(page, "Username").click();
      await settle(page);
      page.off("request", onReq);
      expect(calls).toEqual([]);
    });

    test("Mọi request đều sort theo updatedAt giảm dần (kể cả khi chuyển trang / đổi số dòng)", async ({ page }) => {
      const total = await totalOf(page);
      test.skip(total <= 10, "Chỉ có 1 trang");
      const p2 = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      expect(p2).toMatchObject({ sortBy: "updatedAt", sortDirection: "desc" });
      const size = await setPageSize(page, "20 / page");
      expect(size.body).toMatchObject({ sortBy: "updatedAt", sortDirection: "desc" });
    });
  });

  // ===== 9. Manage Columns =====
  test.describe("Manage Columns", () => {
    // hasText dạng RegExp khớp CHÍNH XÁC tên cột
    const item = (page, name) =>
      columnPopover(page).locator(".NextGen-popover-manage-column__list__items", { hasText: exact(name) });

    test("Popover liệt kê đủ cột của bảng cha, đều được chọn; không có nút Save / Reset to Default", async ({ page }) => {
      await columnBtn(page).click();
      await expect(columnPopover(page)).toBeVisible();
      const names = await columnPopover(page).locator(".NextGen-popover-manage-column__list__items .ant-typography").allInnerTexts();
      expect(names.map((n) => n.trim())).toEqual(COLUMNS);
      await expect(columnPopover(page).locator("input[type=checkbox]:checked")).toHaveCount(COLUMNS.length);
      await expect(columnPopover(page).getByRole("button")).toHaveCount(0);
    });

    test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Status").locator("label").click();
      expect(await headers(page)).not.toContain("Status");
      expect(await headers(page)).toHaveLength(HEADERS.length - 1);

      await item(page, "Status").locator("label").click();
      expect(await headers(page)).toEqual(HEADERS);
    });

    test("Ẩn nhiều cột cùng lúc", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Topic").locator("label").click();
      await item(page, "Application").locator("label").click();
      expect(await headers(page)).toEqual(HEADERS.filter((c) => c !== "Topic" && c !== "Application"));
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      await ensureData(page);
      const before = (await tableMatrix(page)).map((m) => m.cells[2]);
      await columnBtn(page).click();
      await item(page, "Topic").locator("label").click();
      const after = (await tableMatrix(page)).map((m) => m.cells[2]);
      expect(after).toEqual(before);
    });

    test("Cấu hình cột được ghi nhớ hay không sau khi reload trang (quan sát hành vi hiện tại: KHÔNG lưu, hiện lại đủ cột)", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Status").locator("label").click();
      expect(await headers(page)).not.toContain("Status");

      await openPage(page); // reload
      expect(await headers(page)).toEqual(HEADERS);
    });
  });

  // ===== 10. Ghi nhớ filter =====
  test.describe("Ghi nhớ filter", () => {
    test("Timezone đã đổi được ghi nhớ sau khi reload trang", async ({ page }) => {
      const defaultTz = await currentTimezone(page);
      await pickTimezone(page, otherZone(defaultTz));
      const chosen = await currentTimezone(page);
      const { body } = await search(page);

      const reqPromise = page.waitForRequest(isList);
      await openPage(page); // reload
      expect(bodyOf(await reqPromise).filters).toEqual(body.filters);
      expect(await currentTimezone(page)).toBe(chosen);
    });

    test("Reset xoá Timezone đã lưu: reload trang thì về timezone mặc định", async ({ page }) => {
      const defaultTz = await currentTimezone(page);
      await pickTimezone(page, otherZone(defaultTz));
      await search(page);
      await resetBodies(page);

      await openPage(page); // reload
      expect(await currentTimezone(page)).toBe(defaultTz);
    });
  });
});
