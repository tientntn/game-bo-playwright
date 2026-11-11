// Players > Players  (https://dev-bo.royaledge.io/player)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/player.spec.js --project=setup --project=chromium
//
// Màn hình danh sách "Players": danh sách có phân trang + Export + Manage Columns. KHÔNG có Add New / View / Update (player do operator tạo qua API).
//  - API list: player/list {page,pageSize,sortBy,sortDirection,filters:{sasEntityId:[<id entity đang đăng nhập>],timezoneId,
//    [houseIds],[masterAgentIds],[agentIds],[currencyIds],[status],[username]}} (sasEntityId / timezoneId luôn có - test lấy từ lần load đầu, không hard-code;
//    các key còn lại chỉ gửi khi có chọn). House / Master Agent / Agent / Currency chọn NHIỀU (mảng id của dropdown); Status chọn 1 giá trị nhưng
//    gửi dạng MẢNG ([1] / [0]); Player Name là ô nhập chữ, gửi "username" (chuỗi, tìm không phân biệt hoa thường), Enter cũng kích hoạt Search.
//  - Dropdown: House = report/house_dropdown (option = tên), Master Agent = report/master_agent_dropdown {houseIds} (option = tên),
//    Agent = report/agent_dropdown {houseIds,masterAgentIds} (option = "code - tên"), Currency = dropdown/currency (option = label).
//    Chọn House thì dropdown Master Agent / Agent gửi lại request thu hẹp theo House; chọn Master Agent thì dropdown Agent thu hẹp theo Master Agent.
//    Lưu ý: id của house / master agent / agent trong response list (vd 335) KHÁC value của dropdown (vd 1) -> đối chiếu bằng code.
//  - Cột Username / Player ID / House / Master Agent / Agent / Status / Created Date sort được (sortBy username | id | house | masterAgent | agent |
//    status | createdDate). Cột Player ID đang là mặc định (id desc): click đầu tiên về "không sort" và KHÔNG gọi API, click 2 = asc, click 3 = desc.
//    Các cột còn lại: asc -> desc -> về mặc định (id desc). Supported Currencies / Action không sort.
//  - Cột Action: icon bật / tắt trạng thái (Deactivate khi đang Active, Activate khi đang Inactive; player/update-status {ids,status}) và icon Kick
//    (player/kick {playerKicks:[{agentCode,username,playerId}]}). Có checkbox chọn dòng + 3 nút Bulk Activate / Bulk Deactivate / Bulk Kick.
//
// AN TOÀN DỮ LIỆU:
//  - TOÀN BỘ file là "chỉ đọc": màn hình không có tạo / xoá player nên không có bản ghi QA để dọn. Request ghi (player/update-status, player/kick)
//    bị chặn ở tầng mạng (route.abort) hoặc được trả về response GIẢ (route.fulfill, request KHÔNG tới server) để kiểm tra payload / toast.
//    afterEach so sánh chính xác request ghi bắt được (watchWrites) với danh sách được phép (allowedWrites). Player có sẵn của team chỉ bị thao tác
//    bằng request GIẢ, KHÔNG bao giờ bị ghi thật (không có thật việc Activate / Deactivate / Kick).
//  - Export tạo bản ghi ở Download History; nếu file cùng filter đã tồn tại thì hộp thoại "Download Now / Download New" hiện ra và
//    test KHÔNG bấm Download New (tránh xoá file cũ).
//  - Không hard-code dữ liệu: house / master agent / agent / currency / player đều lấy từ response list và dropdown.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/player";
const ORIGIN = "https://dev-bo.royaledge.io";

// Đúng thứ tự hiển thị (cột đầu tiên là checkbox chọn dòng, không có tên)
const COLUMNS = ["Username", "Player ID", "House", "Master Agent", "Agent", "Supported Currencies", "Status", "Created Date", "Action"];
const HEADERS = ["", ...COLUMNS];
const COL = { check: 0, username: 1, id: 2, house: 3, ma: 4, agent: 5, currencies: 6, status: 7, created: 8, action: 9 };
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
// Cột sort được (không tính Player ID) -> sortBy gửi lên API (mặc định id giảm dần)
const SORTABLE = {
  Username: "username",
  House: "house",
  "Master Agent": "masterAgent",
  Agent: "agent",
  Status: "status",
  "Created Date": "createdDate",
};
const STATUS_TEXT = { 0: "Inactive", 1: "Active" };

// sasEntityId / timezoneId của filters (lấy từ lần load đầu tiên của mỗi test) - luôn có trong mọi request list
let BASE = {};
const F = (extra = {}) => ({ ...extra, ...BASE });
const defaultBody = () => ({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: F() });

const MSG = { noEntries: "There are no entries found" };

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI (player/update-status, player/kick)
const READ = /\/(list|details|download|view)(\?|$)|\/dropdown\/|_dropdown(\?|$)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/player/list");
const isDownload = endsWith("/download");
const isUpdateStatus = endsWith("/player/update-status");
const isKick = endsWith("/player/kick");
const isHouseDropdown = endsWith("/report/house_dropdown");
const isMasterAgentDropdown = endsWith("/report/master_agent_dropdown");
const isAgentDropdown = endsWith("/report/agent_dropdown");
const isCurrencyDropdown = endsWith("/dropdown/currency");

const exact = (s, flags = "") => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, flags);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};
const asc = (a, b) => a - b;
const statusOf = (x) => STATUS_TEXT[x.status];
// "10-11-2026 15:42:59" (DD-MM-YYYY HH:mm:ss) -> mili giây để so thứ tự
const dateMs = (s) => {
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
};
const isSorted = (arr, dir) => JSON.stringify(arr) === JSON.stringify([...arr].sort((a, b) => (dir === "asc" ? a - b : b - a)));
// Giá trị xuất hiện đúng 1 lần theo khoá (tên house / master agent có thể trùng nhau giữa các bản ghi)
const uniqueBy = (list, key) => list.filter((h) => list.filter((v) => key(v) === key(h)).length === 1);

const table = (page) => page.locator(".ant-table").first();
const rows = (page) => table(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
const th = (page, name) => table(page).locator("thead th").filter({ hasText: exact(name) });
const checkboxOf = (page, i) => rowAt(page, i).locator('input[type="checkbox"]');

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
// Nút số trang (button.ant-pagination-item, không có class theo số trang); Prev / Next là button có class riêng
const pageItem = (page, n) => page.locator(".ant-pagination-item").filter({ hasText: exact(String(n)) });
const pageSizeSelect = (page) => page.locator(".ant-pagination-options .ant-select");
const dialog = (page) => page.getByRole("dialog");
const toasts = (page) => page.locator(".Toastify__toast");
const tooltip = (page) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
const filterEl = (page, id) => page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
const usernameInput = (page) => page.locator("input#username");

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

// Icon ở cột Action của 1 dòng: 0 = bật / tắt trạng thái (Activate / Deactivate), 1 = Kick. Click phần tử cha của svg.
const actionIcon = (page, i, n) => rowAt(page, i).locator(".column-actions svg").nth(n);
const clickAction = (page, i, n) => actionIcon(page, i, n).locator("xpath=..").click();

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất). Chỉ tính spinner của bảng.
async function waitTableIdle(page) {
  await expect(page.locator(".ant-table-wrapper .ant-spin-spinning")).toHaveCount(0);
}
// Search đôi khi gửi 2 request list giống hệt nhau: chờ mạng yên để request thừa không bị nhầm là của thao tác kế tiếp
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
}

// Mở màn hình và chờ lần load đầu tiên (default filter) xong. Lấy sasEntityId / timezoneId của filters làm BASE.
async function openPage(page) {
  test.setTimeout(90000);
  const firstReq = page.waitForRequest(isList, { timeout: 60000 });
  const firstLoad = page.waitForResponse(isList, { timeout: 60000 });
  firstReq.catch(() => {}); // tránh unhandled rejection khi test kết thúc sớm
  firstLoad.catch(() => {});
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
  const { sasEntityId, timezoneId } = bodyOf(await firstReq).filters;
  BASE = { sasEntityId, timezoneId };
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

// Bấm Reset và gom MỌI request list gửi đi cho tới khi mạng yên (request cuối = trạng thái bảng cuối cùng).
// Lưu ý: Reset khi chưa có filter nào đang áp dụng thì KHÔNG gọi lại API -> chỉ dùng sau khi đã Search với filter.
async function resetBodies(page) {
  const bodies = [];
  const onRequest = (r) => {
    if (isList(r)) bodies.push(bodyOf(r));
  };
  page.on("request", onRequest);
  try {
    const first = page.waitForRequest(isList);
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

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô. KHÔNG click giữa ô: ô chọn nhiều có chip
// "Tên ×" và tâm ô thường rơi đúng nút (x) -> xoá giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn 1 option (theo text hiển thị) ở filter rồi đóng dropdown. Dropdown chọn nhiều không tự đóng và Esc không đóng
// -> click ra ngoài (breadcrumb). Gõ text vào ô tìm kiếm để option chắc chắn có trong DOM (danh sách ảo).
async function selectFilter(page, id, text) {
  await openDropdown(page, id);
  await page.keyboard.type(text);
  await openOptions(page).filter({ hasText: exact(text) }).first().click();
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Các giá trị đang được chọn của 1 filter (title = text option; gồm cả chip bị antd ẩn / gom "+ N")
const selectedFilter = (page, id) =>
  filterEl(page, id)
    .locator(".ant-select-selection-item[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));

// Đọc các option đang hiển thị của 1 dropdown filter rồi đóng lại (danh sách ảo: chỉ gồm option đang render)
async function dropdownTitles(page, id) {
  await openDropdown(page, id);
  await expect.poll(() => openOptions(page).count()).toBeGreaterThan(0);
  const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
  return titles;
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

// Gõ vào ô Player Name (ô bị ẩn cho tới khi click label)
async function typeUsername(page, text) {
  await filterEl(page, "username").locator("label").first().click();
  await usernameInput(page).fill(text);
}

// Chọn 1 option ở filter House / Master Agent rồi trả về các request dropdown (master agent / agent) được gửi lại theo lựa chọn
async function selectAndCollectDropdownReqs(page, id, text) {
  const reqs = [];
  const onRequest = (r) => {
    if (isMasterAgentDropdown(r)) reqs.push({ api: "master_agent_dropdown", body: bodyOf(reqOf(r)) });
    if (isAgentDropdown(r)) reqs.push({ api: "agent_dropdown", body: bodyOf(reqOf(r)) });
  };
  page.on("request", onRequest);
  try {
    await selectFilter(page, id, text);
    await expect.poll(() => reqs.some((q) => q.api === "agent_dropdown")).toBe(true);
    await page.waitForLoadState("networkidle").catch(() => {});
  } finally {
    page.off("request", onRequest);
  }
  return reqs;
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
const MOCK_OK = { status: "success", messageCode: "SUCCESS", message: "SUCCESS", data: null };
const MOCK_FAIL = { status: "fail", messageCode: "QA_MOCK_ERROR", message: "QA mock error", data: null };

// Payload dự kiến của player/kick cho các dòng của list
const kickBody = (items) => ({
  playerKicks: items.map((x) => ({ agentCode: x.agent.code, username: x.username, playerId: x.id })),
});

// Xoá filter / page size đã lưu ở localStorage 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
// (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động). Chỉ khớp key "<env>-player_(filter|page_size)".
const clearSavedState = async (page) =>
  page.addInitScript(() => {
    if (sessionStorage.getItem("__player_spec_cleared")) return;
    for (const k of Object.keys(localStorage)) {
      if (/^[^-]+-player_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
    }
    sessionStorage.setItem("__player_spec_cleared", "1");
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Players > Players (danh sách, chỉ đọc)", () => {
  let writes;
  let allowedWrites; // request ghi được phép (chỉ các test dùng response giả; request KHÔNG tới server thật)
  let housesLoaded; // promise của response report/house_dropdown lúc mở trang
  let masterAgentsLoaded;
  let agentsLoaded;
  let currenciesLoaded;
  const houses = async () => (await (await housesLoaded).json()).data; // [{ value, code, label }]
  const masterAgents = async () => (await (await masterAgentsLoaded).json()).data;
  const agents = async () => (await (await agentsLoaded).json()).data;
  const currencies = async () => (await (await currenciesLoaded).json()).data;
  const agentText = (a) => `${a.code} - ${a.label}`; // option của filter Agent

  // Option của dropdown ứng với house / master agent / agent / currency của 1 dòng player (đối chiếu bằng code; chỉ lấy khi
  // tên option xuất hiện đúng 1 lần để chọn theo tên không bị nhầm). Trả về undefined nếu không có.
  const houseOf = async (x) => {
    const all = await houses();
    const h = all.find((v) => v.code === x.house.code);
    return h && all.filter((v) => norm(v.label) === norm(h.label)).length === 1 ? h : undefined;
  };
  const maOf = async (x) => {
    const all = await masterAgents();
    const m = all.find((v) => v.code === x.masterAgent.code);
    return m && all.filter((v) => norm(v.label) === norm(m.label)).length === 1 ? m : undefined;
  };
  const agentOf = async (x) => (await agents()).find((v) => v.code === x.agent.code);
  const currencyOf = async (x) => {
    const all = await currencies();
    const cur = x.playerCurrencies[0];
    const c = all.find((v) => v.code === cur) ?? all.find((v) => v.label === cur);
    return c && all.filter((v) => norm(v.label) === norm(c.label)).length === 1 ? c : undefined;
  };

  test.beforeEach(async ({ page }) => {
    await clearSavedState(page);
    writes = watchWrites(page);
    allowedWrites = [];
    housesLoaded = page.waitForResponse(isHouseDropdown, { timeout: 60000 });
    masterAgentsLoaded = page.waitForResponse(isMasterAgentDropdown, { timeout: 60000 });
    agentsLoaded = page.waitForResponse(isAgentDropdown, { timeout: 60000 });
    currenciesLoaded = page.waitForResponse(isCurrencyDropdown, { timeout: 60000 });
    for (const p of [housesLoaded, masterAgentsLoaded, agentsLoaded, currenciesLoaded]) p.catch(() => {});
    await blockWrites(page);
    await openPage(page);
  });

  // Mọi test không được gửi request ghi nào ngoài danh sách được phép (và request được phép cũng không tới server thật)
  test.afterEach(async () => {
    expect(writes, "Request ghi dữ liệu bắt được phải đúng danh sách được phép").toEqual(allowedWrites);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề 'Players'", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Players");
    });

    test("Có đủ 6 filter House, Master Agent, Agent, Player Name, Currency, Status và 2 nút Search/Reset", async ({ page }) => {
      await expect(page.locator(".NextGen-filter-element")).toHaveCount(6);
      await expect(filterEl(page, "houseIds")).toContainText("House");
      await expect(filterEl(page, "masterAgentIds")).toContainText("Master Agent");
      await expect(filterEl(page, "agentIds")).toContainText("Agent");
      await expect(filterEl(page, "username")).toContainText("Player Name");
      await expect(filterEl(page, "currencyIds")).toContainText("Currency");
      await expect(filterEl(page, "status")).toContainText("Status");
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: để trống", async ({ page }) => {
      await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
      await expect(usernameInput(page)).toHaveValue("");
    });

    test("House / Master Agent / Agent / Currency chọn nhiều giá trị, Status chọn 1 giá trị; đều có tìm kiếm", async ({ page }) => {
      for (const id of ["houseIds", "masterAgentIds", "agentIds", "currencyIds"]) {
        await expect(filterEl(page, id).locator(".ant-select-multiple"), id).toHaveCount(1);
        await expect(filterEl(page, id).locator(".ant-select-show-search"), id).toHaveCount(1);
        await expect(filterEl(page, id).locator(".ant-select-allow-clear"), id).toHaveCount(1);
      }
      await expect(filterEl(page, "status").locator(".ant-select-multiple")).toHaveCount(0);
      await expect(filterEl(page, "status").locator(".ant-select")).toHaveCount(1);
      await expect(usernameInput(page)).toHaveCount(1);
    });

    test("Có Export, Manage Columns, 3 nút thao tác hàng loạt; không có Add New", async ({ page }) => {
      await expect(exportBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
      await expect(bulkBtns(page)).toHaveCount(3);
      await expect(addBtn(page)).toHaveCount(0);
    });

    test(`Bảng có đủ ${COLUMNS.length} cột (+ cột checkbox) đúng thứ tự`, async ({ page }) => {
      expect(await headers(page)).toEqual(HEADERS);
    });

    test("Mặc định: trang 1, 10 dòng, sort id giảm dần, filters chỉ có sasEntityId + timezoneId", async ({ page }) => {
      const { body, status, json } = await search(page);
      expect(status).toBe(200);
      expect(body).toEqual(defaultBody());
      expect(BASE.sasEntityId).toEqual([expect.any(Number)]);
      expect(BASE.timezoneId).toEqual(expect.any(Number));
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
    test("Mỗi dòng khớp response API (Username, Player ID, House, Master Agent, Agent, Currency, Status, Created Date)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      await expect(rows(page)).toHaveCount(list.length);
      for (const [i, x] of list.entries()) {
        const at = `dòng ${i + 1} (player ${x.id})`;
        expect(norm(await cellAt(page, i, COL.username).innerText()), at).toBe(norm(x.username));
        expect(norm(await cellAt(page, i, COL.id).innerText()), at).toBe(String(x.id));
        expect(norm(await cellAt(page, i, COL.house).innerText()), at).toBe(norm(x.house.name));
        expect(norm(await cellAt(page, i, COL.ma).innerText()), at).toBe(norm(x.masterAgent.name));
        expect(norm(await cellAt(page, i, COL.agent).innerText()), at).toBe(norm(x.agent.name));
        expect(norm(await cellAt(page, i, COL.status).innerText()), at).toBe(statusOf(x));
        expect(norm(await cellAt(page, i, COL.created).innerText()), at).toBe(x.createDate);
      }
    });

    test("Mặc định sắp xếp Player ID giảm dần; ID và Username không trùng nhau; Status chỉ Active hoặc Inactive", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Không đủ dữ liệu");
      const ids = json.data.list.map((x) => x.id);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
      expect(new Set(ids).size).toBe(ids.length);
      const names = json.data.list.map((x) => x.username);
      expect(new Set(names).size).toBe(names.length);
      for (const x of json.data.list) expect([0, 1], `status của player ${x.id}`).toContain(x.status);
    });

    test("Mỗi player có Username, House, Master Agent, Agent (id / mã / tên) và ít nhất 1 currency, không để trống", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const x of json.data.list) {
        expect(x.username, `username của player ${x.id}`).toBeTruthy();
        for (const k of ["house", "masterAgent", "agent"]) {
          expect(x[k]?.name, `${k}.name của player ${x.id}`).toBeTruthy();
          expect(x[k]?.code, `${k}.code của player ${x.id}`).toBeTruthy();
          expect(x[k]?.id, `${k}.id của player ${x.id}`).toBeTruthy();
        }
        expect(x.playerCurrencies.length, `currency của player ${x.id}`).toBeGreaterThan(0);
      }
    });

    test("Created Date có định dạng DD-MM-YYYY HH:mm:ss", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const x of json.data.list) expect(x.createDate, `player ${x.id}`).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
      for (const [i, x] of json.data.list.entries()) await expect(cellAt(page, i, COL.created), `dòng ${i + 1}`).toHaveText(x.createDate);
    });

    test("House, Master Agent, Agent của từng dòng là bản ghi có thật trong dropdown (đối chiếu theo code + tên)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const hs = new Map((await houses()).map((h) => [h.code, norm(h.label)]));
      const ms = new Map((await masterAgents()).map((m) => [m.code, norm(m.label)]));
      const as = new Map((await agents()).map((a) => [a.code, norm(a.label)]));
      for (const x of json.data.list) {
        expect(hs.get(x.house.code), `house ${x.house.code} của player ${x.id}`).toBe(norm(x.house.name));
        expect(ms.get(x.masterAgent.code), `master agent ${x.masterAgent.code} của player ${x.id}`).toBe(norm(x.masterAgent.name));
        expect(as.get(x.agent.code), `agent ${x.agent.code} của player ${x.id}`).toBe(norm(x.agent.name));
      }
    });

    test("Supported Currencies hiển thị dạng chip, mỗi chip là 1 mã currency của player", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const [i, x] of json.data.list.entries()) {
        const chips = (await cellAt(page, i, COL.currencies).locator(".ant-tag").allInnerTexts()).map(norm);
        const codes = chips.filter((c) => !/^\+/.test(c));
        expect(codes, `dòng ${i + 1}`).toEqual(x.playerCurrencies.slice(0, codes.length));
        if (codes.length === chips.length) expect(codes, `dòng ${i + 1}`).toEqual(x.playerCurrencies);
      }
    });

    test("Status hiển thị dạng tag: Active (xanh) / Inactive (đỏ)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const [i, x] of json.data.list.entries()) {
        await expect(cellAt(page, i, COL.status).locator(".ant-tag"), `dòng ${i + 1}`).toHaveClass(
          x.status === 1 ? /tag-success/ : /tag-error/,
        );
      }
    });

    test("Mỗi dòng có 2 icon hành động; icon trạng thái đúng với Status (toggle-off khi Active, toggle-on khi Inactive) và icon Kick", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const [i, x] of json.data.list.entries()) {
        await expect(rowAt(page, i).locator(".column-actions svg"), `dòng ${i + 1}`).toHaveCount(2);
        await expect(actionIcon(page, i, 0), `dòng ${i + 1}`).toHaveAttribute("data-icon", x.status === 1 ? "toggle-off" : "toggle-on");
        await expect(actionIcon(page, i, 1), `dòng ${i + 1}`).toHaveAttribute("data-icon", "user-xmark");
      }
    });

    test("Tooltip các icon: Deactivate / Activate (theo Status) và Kick", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await hoverTip(page, actionIcon(page, 0, 0), json.data.list[0].status === 1 ? "Deactivate" : "Activate");
      await hoverTip(page, actionIcon(page, 0, 1), "Kick");
    });

    test("Tooltip của Export ('Download as CSV') và Manage Columns", async ({ page }) => {
      await hoverTip(page, exportBtn(page), "Download as CSV");
      await hoverTip(page, columnBtn(page), "Manage Columns");
    });
  });

  // ===== 3. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Dropdown House liệt kê house của house_dropdown (theo tên)", async ({ page }) => {
      const data = await houses();
      test.skip(data.length === 0, "Không có house nào");
      const known = new Set(data.map((h) => norm(h.label)));
      for (const t of await dropdownTitles(page, "houseIds")) expect(known.has(norm(t)), `option "${t}" không có trong house_dropdown`).toBe(true);
    });

    test("Dropdown Master Agent: request {houseIds: []} và liệt kê master agent của master_agent_dropdown (theo tên)", async ({ page }) => {
      const res = await masterAgentsLoaded;
      expect(bodyOf(reqOf(res))).toEqual({ houseIds: [] });
      const data = (await res.json()).data;
      test.skip(data.length === 0, "Không có master agent nào");
      const known = new Set(data.map((m) => norm(m.label)));
      for (const t of await dropdownTitles(page, "masterAgentIds")) expect(known.has(norm(t)), `option "${t}" không có trong master_agent_dropdown`).toBe(true);
    });

    test("Dropdown Agent: request {houseIds: [], masterAgentIds: []} và option dạng 'code - tên'", async ({ page }) => {
      const res = await agentsLoaded;
      expect(bodyOf(reqOf(res))).toEqual({ houseIds: [], masterAgentIds: [] });
      const data = (await res.json()).data;
      test.skip(data.length === 0, "Không có agent nào");
      const known = new Set(data.map(agentText));
      for (const t of await dropdownTitles(page, "agentIds")) expect(known.has(t), `option "${t}" không có trong agent_dropdown`).toBe(true);
    });

    test("Dropdown Currency liệt kê currency của dropdown/currency", async ({ page }) => {
      const data = await currencies();
      test.skip(data.length === 0, "Không có currency nào");
      const known = new Set(data.map((c) => c.label));
      for (const t of await dropdownTitles(page, "currencyIds")) expect(known.has(t), `option "${t}" không có trong dropdown/currency`).toBe(true);
    });

    test("Dropdown Status có đúng 2 option Active, Inactive", async ({ page }) => {
      await openDropdown(page, "status");
      await expect(openOptions(page)).toHaveText(["Active", "Inactive"]);
      await openOptions(page).first().click();
      await expect(openOptions(page)).toHaveCount(0);
    });

    test("Search không chọn gì: gửi filters mặc định và trả về cùng tổng bản ghi", async ({ page }) => {
      const first = await search(page);
      const second = await search(page);
      expect(second.body).toEqual(defaultBody());
      expect(second.json.data.totalCount).toBe(first.json.data.totalCount);
    });

    test("Chọn House của dòng đầu: gửi filters.houseIds = [value] và mọi dòng thuộc house đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const h = await houseOf(x);
      test.skip(!h, "House của dòng đầu không có trong dropdown hoặc tên bị trùng");

      await selectFilter(page, "houseIds", h.label);
      expect(await selectedFilter(page, "houseIds")).toEqual([h.label]);
      const { body, json } = await search(page);
      expect(body).toMatchObject({ page: 1, pageSize: 10 });
      expect(body.filters).toEqual(F({ houseIds: [h.value] }));
      expect(json.data.list.length).toBeGreaterThan(0);
      for (const r of json.data.list) expect(r.house.code, `player ${r.id}`).toBe(h.code);
      await expect(rows(page)).toHaveCount(json.data.list.length);
      for (const [i, r] of json.data.list.entries()) await expect(cellAt(page, i, COL.house)).toHaveText(norm(r.house.name));
      expect(json.data.totalCount).toBeLessThanOrEqual(all.data.totalCount);
    });

    test("Chọn House: dropdown Master Agent và Agent gửi lại request {houseIds: [value]} và chỉ liệt kê bản ghi của house đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const h = await houseOf(x);
      test.skip(!h, "House của dòng đầu không có trong dropdown hoặc tên bị trùng");
      const allMa = (await masterAgents()).map((m) => norm(m.label));
      const allAgents = (await agents()).map(agentText);

      const reqs = await selectAndCollectDropdownReqs(page, "houseIds", h.label);
      expect(reqs.filter((q) => q.api === "master_agent_dropdown").at(-1)?.body).toEqual({ houseIds: [h.value] });
      expect(reqs.filter((q) => q.api === "agent_dropdown").at(-1)?.body).toEqual({ houseIds: [h.value], masterAgentIds: [] });

      const maTitles = (await dropdownTitles(page, "masterAgentIds")).map(norm);
      for (const t of maTitles) expect(allMa, `option "${t}" không có trong master_agent_dropdown`).toContain(t);
      expect(maTitles).toContain(norm(x.masterAgent.name));
      expect(maTitles.length).toBeLessThanOrEqual(allMa.length);

      const agentTitles = await dropdownTitles(page, "agentIds");
      for (const t of agentTitles) expect(allAgents, `option "${t}" không có trong agent_dropdown`).toContain(t);
      expect(agentTitles).toContain(`${x.agent.code} - ${norm(x.agent.name)}`);
    });

    test("Chọn Master Agent của dòng đầu: gửi filters.masterAgentIds = [value], dropdown Agent thu hẹp theo và mọi dòng thuộc master agent đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const m = await maOf(x);
      test.skip(!m, "Master agent của dòng đầu không có trong dropdown hoặc tên bị trùng");

      const reqs = await selectAndCollectDropdownReqs(page, "masterAgentIds", m.label);
      expect(reqs.filter((q) => q.api === "agent_dropdown").at(-1)?.body).toEqual({ houseIds: [], masterAgentIds: [m.value] });
      expect(await selectedFilter(page, "masterAgentIds")).toEqual([m.label]);
      const { body, json } = await search(page);
      expect(body.filters).toEqual(F({ masterAgentIds: [m.value] }));
      expect(json.data.list.map((r) => r.id)).toContain(x.id);
      for (const r of json.data.list) expect(r.masterAgent.code, `player ${r.id}`).toBe(m.code);
      await expect(rows(page)).toHaveCount(json.data.list.length);
      for (const [i, r] of json.data.list.entries()) await expect(cellAt(page, i, COL.ma)).toHaveText(norm(r.masterAgent.name));
    });

    test("Chọn Agent của dòng đầu: gửi filters.agentIds = [value] và mọi dòng thuộc agent đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const a = await agentOf(x);
      test.skip(!a, "Agent của dòng đầu không có trong dropdown");

      await selectFilter(page, "agentIds", agentText(a));
      expect(await selectedFilter(page, "agentIds")).toEqual([agentText(a)]);
      const { body, json } = await search(page);
      expect(body.filters).toEqual(F({ agentIds: [a.value] }));
      expect(json.data.list.map((r) => r.id)).toContain(x.id);
      for (const r of json.data.list) expect(r.agent.code, `player ${r.id}`).toBe(a.code);
      await expect(rows(page)).toHaveCount(json.data.list.length);
      for (const [i, r] of json.data.list.entries()) await expect(cellAt(page, i, COL.agent)).toHaveText(norm(r.agent.name));
    });

    test("Chọn Currency của dòng đầu: gửi filters.currencyIds = [value] và mọi dòng có currency đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const c = await currencyOf(x);
      test.skip(!c, "Currency của dòng đầu không có trong dropdown hoặc tên bị trùng");

      await selectFilter(page, "currencyIds", c.label);
      expect(await selectedFilter(page, "currencyIds")).toEqual([c.label]);
      const { body, json } = await search(page);
      expect(body.filters).toEqual(F({ currencyIds: [c.value] }));
      expect(json.data.list.length).toBeGreaterThan(0);
      for (const r of json.data.list) expect(r.playerCurrencies, `player ${r.id}`).toContain(x.playerCurrencies[0]);
      await expect(rows(page)).toHaveCount(json.data.list.length);
    });

    for (const [label, code] of [["Active", 1], ["Inactive", 0]]) {
      test(`Chọn Status = ${label}: gửi filters.status = [${code}] (mảng) và mọi dòng là ${label}`, async ({ page }) => {
        await selectFilter(page, "status", label);
        expect(await selectedFilter(page, "status")).toEqual([label]);
        const { body, json } = await search(page);
        expect(body.filters).toEqual(F({ status: [code] }));
        test.skip(json.data.list.length === 0, `Không có player ${label}`);
        for (const r of json.data.list) expect(r.status, `player ${r.id}`).toBe(code);
        await expect(rows(page)).toHaveCount(json.data.list.length);
        for (const [i] of json.data.list.entries()) await expect(cellAt(page, i, COL.status)).toHaveText(label);
      });
    }

    test("Player Name: gõ username của dòng đầu -> gửi filters.username (chuỗi) và dòng đó có trong kết quả", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      await typeUsername(page, x.username);
      const { body, json } = await search(page);
      expect(body.filters).toEqual(F({ username: x.username }));
      expect(json.data.list.map((r) => r.id)).toContain(x.id);
      for (const r of json.data.list) expect(r.username.toLowerCase(), `player ${r.id}`).toContain(x.username.toLowerCase());
    });

    test("Player Name: gõ 1 phần username -> mọi dòng có username chứa chuỗi đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const text = all.data.list[0].username.slice(0, 4);
      await typeUsername(page, text);
      const { body, json } = await search(page);
      expect(body.filters).toEqual(F({ username: text }));
      expect(json.data.list.length).toBeGreaterThan(0);
      for (const r of json.data.list) expect(r.username.toLowerCase(), `player ${r.id}`).toContain(text.toLowerCase());
    });

    test("Player Name không phân biệt hoa thường: gõ IN HOA vẫn tìm ra player", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      test.skip(x.username === x.username.toUpperCase(), "Username không có chữ thường");
      await typeUsername(page, x.username.toUpperCase());
      const { body, json } = await search(page);
      expect(body.filters.username).toBe(x.username.toUpperCase());
      expect(json.data.list.map((r) => r.id)).toContain(x.id);
    });

    test("Player Name: nhấn Enter trong ô cũng gửi Search", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      await typeUsername(page, x.username);
      const [req] = await Promise.all([page.waitForRequest(isList), usernameInput(page).press("Enter")]);
      expect(bodyOf(req).filters).toEqual(F({ username: x.username }));
      await settle(page);
    });

    test("Search không có kết quả: hiện 'There are no entries found' và 'Showing 0 - 0 of 0 records'", async ({ page }) => {
      await typeUsername(page, `zzqa${Date.now()}`);
      const { json } = await search(page);
      expect(json.data.totalCount).toBe(0);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText(MSG.noEntries)).toBeVisible();
      await expect(page.getByText("Showing 0 - 0 of 0 records")).toBeVisible();
    });

    test("Chọn nhiều House: gửi houseIds có đủ các value và mọi dòng thuộc 1 trong các house đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const h1 = await houseOf(all.data.list[0]);
      const h2 = uniqueBy(await houses(), (v) => norm(v.label)).find((v) => v.code !== h1?.code);
      test.skip(!h1 || !h2, "Không đủ 2 house khác nhau trong dropdown");
      await selectFilter(page, "houseIds", h1.label);
      await selectFilter(page, "houseIds", h2.label);
      await expect.poll(() => selectedCount(page, "houseIds")).toBe(2);
      const { body, json } = await search(page);
      expect([...body.filters.houseIds].sort(asc)).toEqual([h1.value, h2.value].sort(asc));
      for (const r of json.data.list) expect([h1.code, h2.code], `player ${r.id}`).toContain(r.house.code);
      expect(json.data.list.length).toBeGreaterThan(0);
    });

    test("Kết hợp House + Master Agent + Agent + Status của cùng 1 player: gửi đủ các key (AND), player đó có trong kết quả", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const h = await houseOf(x);
      const m = await maOf(x);
      const a = await agentOf(x);
      test.skip(!h || !m || !a, "House / master agent / agent của dòng đầu không có trong dropdown hoặc tên bị trùng");
      await selectFilter(page, "houseIds", h.label);
      await selectFilter(page, "masterAgentIds", m.label);
      await selectFilter(page, "agentIds", agentText(a));
      await selectFilter(page, "status", statusOf(x));
      const { body, json } = await search(page);
      expect(body.filters).toEqual(F({ houseIds: [h.value], masterAgentIds: [m.value], agentIds: [a.value], status: [x.status] }));
      expect(json.data.list.map((r) => r.id)).toContain(x.id);
      for (const r of json.data.list) {
        expect(r.house.code, `house của player ${r.id}`).toBe(h.code);
        expect(r.masterAgent.code, `master agent của player ${r.id}`).toBe(m.code);
        expect(r.agent.code, `agent của player ${r.id}`).toBe(a.code);
        expect(r.status, `status của player ${r.id}`).toBe(x.status);
      }
    });

    test("Kết hợp Currency + Status + Player Name: gửi đủ các key và mọi dòng thoả cả 3", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const c = await currencyOf(x);
      test.skip(!c, "Currency của dòng đầu không có trong dropdown hoặc tên bị trùng");
      const text = x.username.slice(0, 3);
      await selectFilter(page, "currencyIds", c.label);
      await selectFilter(page, "status", statusOf(x));
      await typeUsername(page, text);
      const { body, json } = await search(page);
      expect(body.filters).toEqual(F({ currencyIds: [c.value], status: [x.status], username: text }));
      expect(json.data.list.map((r) => r.id)).toContain(x.id);
      for (const r of json.data.list) {
        expect(r.playerCurrencies, `player ${r.id}`).toContain(x.playerCurrencies[0]);
        expect(r.status, `player ${r.id}`).toBe(x.status);
        expect(r.username.toLowerCase(), `player ${r.id}`).toContain(text.toLowerCase());
      }
    });

    test("Đổi filter rồi Search lại: kết quả cũ được thay bằng kết quả mới (totalCount khớp dòng tóm tắt)", async ({ page }) => {
      await selectFilter(page, "status", "Inactive");
      const { json } = await search(page);
      test.skip(json.data.totalCount === 0, "Không có player Inactive");
      await expect(summary(page)).toHaveText(
        new RegExp(`^Showing 1 - ${Math.min(10, json.data.totalCount)} of ${json.data.totalCount} records$`),
      );
    });
  });

  // ===== 4. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá toàn bộ filter đã chọn và gửi lại request mặc định", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const h = await houseOf(all.data.list[0]);
      test.skip(!h, "House của dòng đầu không có trong dropdown hoặc tên bị trùng");
      await selectFilter(page, "houseIds", h.label);
      await selectFilter(page, "status", statusOf(all.data.list[0]));
      await typeUsername(page, all.data.list[0].username);
      await search(page);

      const bodies = await resetBodies(page);
      expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual(defaultBody());
      await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
      await expect(usernameInput(page)).toHaveValue("");
      await expect(summary(page)).toHaveText(new RegExp(`of ${all.data.totalCount} records$`));
    });

    test("Reset đưa sort về mặc định (id giảm dần)", async ({ page }) => {
      await selectFilter(page, "status", "Active");
      await search(page);
      await reloadBy(page, () => th(page, "Agent").click());
      const bodies = await resetBodies(page);
      expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual(defaultBody());
    });

    // HÀNH VI ĐÚNG (đã được user xác nhận): Reset xoá filter nhưng GIỮ NGUYÊN trang đang xem, request list sau Reset vẫn là page=2.
    test("Reset khi đang ở trang 2: xoá filter nhưng giữ nguyên trang 2", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.totalCount <= 10, "Chỉ có 1 trang");
      await selectFilter(page, "status", "Active");
      await search(page);
      await reloadBy(page, () => pageItem(page, 2).click());
      const bodies = await resetBodies(page);
      expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toMatchObject({ page: 2, filters: F() });
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
    });
  });

  // ===== 5. Phân trang =====
  test.describe("Phân trang", () => {
    test("Trang 2 gọi API page=2 và dòng tóm tắt đúng (khi có > 10 bản ghi)", async ({ page }) => {
      const total = await totalOf(page);
      test.skip(total <= 10, "Chỉ có 1 trang");
      const { body, json } = await reloadFull(page, () => pageItem(page, 2).click());
      expect(body).toMatchObject({ page: 2, pageSize: 10 });
      await expect(summary(page)).toHaveText(`Showing 11 - ${Math.min(20, total)} of ${total} records`);
      await expect(rows(page)).toHaveCount(json.data.list.length);
    });

    test("Trang 2 không trùng dòng nào với trang 1 và vẫn sort id giảm dần liên tục", async ({ page }) => {
      test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
      const { json: p1 } = await search(page);
      const { json: p2 } = await reloadFull(page, () => pageItem(page, 2).click());
      const ids1 = p1.data.list.map((x) => x.id);
      for (const x of p2.data.list) expect(ids1).not.toContain(x.id);
      expect(Math.max(...p2.data.list.map((x) => x.id))).toBeLessThan(Math.min(...ids1));
    });

    test("Nút Next / Previous chuyển trang qua lại", async ({ page }) => {
      test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
      await expect(page.locator(".ant-pagination-prev")).toBeDisabled();
      const next = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(next).toMatchObject({ page: 2 });
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
      const prev = await reloadBy(page, () => page.locator(".ant-pagination-prev").click());
      expect(prev).toMatchObject({ page: 1 });
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
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
        await expect(summary(page)).toHaveText(`Showing 1 - ${shown} of ${total} records`);
      });
    }

    test("Giữ filter đang chọn khi chuyển trang / đổi số dòng", async ({ page }) => {
      // Chọn Status có > 10 bản ghi để có trang 2
      let status = null;
      for (const [label, code] of [["Active", 1], ["Inactive", 0]]) {
        await selectFilter(page, "status", label);
        const { json } = await search(page);
        if (json.data.totalCount > 10) {
          status = code;
          break;
        }
      }
      test.skip(status === null, "Không đủ dữ liệu để sang trang 2");
      const p2 = await reloadBy(page, () => pageItem(page, 2).click());
      expect(p2).toMatchObject({ page: 2, filters: F({ status: [status] }) });
      await pageSizeSelect(page).click();
      const size = await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
      expect(size).toMatchObject({ pageSize: 20, filters: F({ status: [status] }) });
    });

    test("Search khi đang ở trang 2 thì quay về trang 1", async ({ page }) => {
      test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
      await reloadBy(page, () => pageItem(page, 2).click());
      const { body } = await search(page);
      expect(body).toMatchObject({ page: 1 });
    });
  });

  // ===== 6. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    test("Sort cột Player ID: mặc định giảm dần, bấm lần lượt -> (bỏ sort) -> tăng dần -> giảm dần", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
      // Cột Player ID đang ở trạng thái giảm dần (mặc định): lần bấm đầu về "không sort" nên không gọi lại API
      await th(page, "Player ID").click();

      const a = await reloadBy(page, () => th(page, "Player ID").click());
      expect(a).toMatchObject({ sortBy: "id", sortDirection: "asc", page: 1 });
      await expect.poll(async () => isSorted((await columnValues(page, "Player ID")).map(Number), "asc")).toBe(true);

      const d = await reloadBy(page, () => th(page, "Player ID").click());
      expect(d).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      await expect.poll(async () => isSorted((await columnValues(page, "Player ID")).map(Number), "desc")).toBe(true);
    });

    for (const [column, sortBy] of Object.entries(SORTABLE)) {
      test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định (id giảm dần)`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
        // Cột chữ phụ thuộc collation của server nên chỉ kiểm tra request; Status (0 / 1) và Created Date kiểm tra được thứ tự
        const key = column === "Status" ? (v) => (v === "Active" ? 1 : 0) : column === "Created Date" ? dateMs : null;

        const a = await reloadBy(page, () => th(page, column).click());
        expect(a).toMatchObject({ sortBy, sortDirection: "asc", page: 1, pageSize: 10 });
        if (key) await expect.poll(async () => isSorted((await columnValues(page, column)).map(key), "asc"), { message: "thứ tự tăng dần" }).toBe(true);

        const d = await reloadBy(page, () => th(page, column).click());
        expect(d).toMatchObject({ sortBy, sortDirection: "desc" });
        if (key) await expect.poll(async () => isSorted((await columnValues(page, column)).map(key), "desc"), { message: "thứ tự giảm dần" }).toBe(true);

        const none = await reloadBy(page, () => th(page, column).click());
        expect(none).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      });
    }

    test("Sort giữ nguyên khi Search với filter", async ({ page }) => {
      await reloadBy(page, () => th(page, "Agent").click());
      await selectFilter(page, "status", "Active");
      const { body } = await search(page);
      expect(body).toMatchObject({ sortBy: "agent", sortDirection: "asc", filters: F({ status: [1] }) });
    });

    test("Sort giữ nguyên khi chuyển trang", async ({ page }) => {
      test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
      await reloadBy(page, () => th(page, "Username").click());
      const p2 = await reloadBy(page, () => pageItem(page, 2).click());
      expect(p2).toMatchObject({ page: 2, sortBy: "username", sortDirection: "asc" });
    });

    test("Chỉ Username, Player ID, House, Master Agent, Agent, Status, Created Date sort được; Supported Currencies / Action không sort", async ({ page }) => {
      for (const c of COLUMNS) {
        if (c === "Player ID" || c in SORTABLE) await expect(th(page, c), c).toHaveClass(/ant-table-column-has-sorters/);
        else await expect(th(page, c), c).not.toHaveClass(/ant-table-column-has-sorters/);
      }
    });
  });

  // ===== 7. Chọn dòng và thao tác hàng loạt =====
  test.describe("Thao tác hàng loạt (Cancel, hoặc xác nhận bằng response GIẢ)", () => {
    // 3 nút: Bulk Activate (update-status status 1), Bulk Deactivate (status 0), Bulk Kick (player/kick)
    const BULK = [
      { i: 0, tip: "Bulk Activate", btn: "Activate", one: (u) => `Activate ${u} user`, many: "Activate 2 users", q1: "activate this user", qn: "activate these 2 users" },
      { i: 1, tip: "Bulk Deactivate", btn: "Deactivate", one: (u) => `Deactivate ${u} user`, many: "Deactivate 2 users", q1: "deactivate this user", qn: "deactivate these 2 users" },
      { i: 2, tip: "Bulk Kick", btn: "Kick", one: (u) => `Kick ${u} player`, many: "Kick 2 players", q1: "kick this player", qn: "kick these 2 players" },
    ];

    test("Chưa chọn dòng nào thì 3 nút thao tác hàng loạt bị vô hiệu", async ({ page }) => {
      for (let i = 0; i < 3; i++) await expect(bulkBtns(page).nth(i)).toBeDisabled();
    });

    test("Chọn 1 dòng thì 3 nút được bật, bỏ chọn thì tắt lại", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      await checkboxOf(page, 0).check();
      for (let i = 0; i < 3; i++) await expect(bulkBtns(page).nth(i)).toBeEnabled();
      await checkboxOf(page, 0).uncheck();
      for (let i = 0; i < 3; i++) await expect(bulkBtns(page).nth(i)).toBeDisabled();
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

    test("Tooltip của 3 nút thao tác hàng loạt", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      await checkboxOf(page, 0).check();
      for (const b of BULK) await hoverTip(page, bulkBtns(page).nth(b.i), b.tip);
    });

    for (const b of BULK) {
      // Quan sát: tiêu đề Bulk Activate / Deactivate dùng từ "user" ("Activate <username> user", "...this user?"), Bulk Kick dùng "player"
      // (không đồng nhất với hộp thoại Activate / Deactivate của từng dòng dùng "player") -> ghi ở report.md
      test(`${b.tip} 1 player: hộp thoại '${b.one("<username>")}' + câu hỏi xác nhận đúng hành động, đóng bằng Cancel`, async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await checkboxOf(page, 0).check();
        await bulkBtns(page).nth(b.i).click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toContainText(b.one(norm(json.data.list[0].username)));
        await expect(dialog(page)).toContainText(`Are you sure you want to ${b.q1}?`);
        await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
        await expect(dialog(page).getByRole("button", { name: new RegExp(`${b.btn}$`) })).toBeVisible();
        await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
        await expect(dialog(page)).toBeHidden();
        await expect(checkboxOf(page, 0)).toBeChecked(); // dòng vẫn đang được chọn
      });

      test(`${b.tip} nhiều player: hộp thoại ghi rõ số lượng ('${b.many}') và câu hỏi đúng hành động, đóng bằng Cancel`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Cần ít nhất 2 player");
        await checkboxOf(page, 0).check();
        await checkboxOf(page, 1).check();
        await bulkBtns(page).nth(b.i).click();
        await expect(dialog(page)).toContainText(b.many);
        await expect(dialog(page)).toContainText(`Are you sure you want to ${b.qn}?`);
        await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
        await expect(dialog(page)).toBeHidden();
      });
    }

    for (const [i, action] of ["Activate", "Deactivate"].entries()) {
      test(`${action} hàng loạt 2 player (xác nhận, response GIẢ): gửi player/update-status {ids,status}, có toast, tải lại danh sách`, async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length < 2, "Cần ít nhất 2 player");
        await mockWrites(page, MOCK_OK);
        const ids = json.data.list.slice(0, 2).map((x) => x.id);
        await checkboxOf(page, 0).check();
        await checkboxOf(page, 1).check();
        await bulkBtns(page).nth(i).click();
        const status = action === "Activate" ? 1 : 0;
        const [req] = await Promise.all([
          page.waitForRequest(isUpdateStatus),
          page.waitForRequest(isList),
          dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click(),
        ]);
        expect(bodyOf(req)).toEqual({ ids, status });
        allowedWrites.push({ url: "player/update-status", body: { ids, status } });
        await expect(toasts(page).first()).toBeVisible();
        await expect(dialog(page)).toBeHidden();
      });
    }

    test("Kick hàng loạt 2 player (xác nhận, response GIẢ): gửi player/kick {playerKicks:[{agentCode,username,playerId}]} và có toast", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Cần ít nhất 2 player");
      await mockWrites(page, MOCK_OK);
      const picked = json.data.list.slice(0, 2);
      await checkboxOf(page, 0).check();
      await checkboxOf(page, 1).check();
      await bulkBtns(page).nth(2).click();
      const [req] = await Promise.all([page.waitForRequest(isKick), dialog(page).getByRole("button", { name: /Kick$/ }).click()]);
      expect(bodyOf(req)).toEqual(kickBody(picked));
      allowedWrites.push({ url: "player/kick", body: kickBody(picked) });
      await expect(toasts(page).first()).toBeVisible();
      await expect(dialog(page)).toBeHidden();
    });

    test("Kick hàng loạt 1 player (xác nhận, response GIẢ): payload chỉ có 1 phần tử", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await mockWrites(page, MOCK_OK);
      await checkboxOf(page, 0).check();
      await bulkBtns(page).nth(2).click();
      const [req] = await Promise.all([page.waitForRequest(isKick), dialog(page).getByRole("button", { name: /Kick$/ }).click()]);
      expect(bodyOf(req)).toEqual(kickBody([json.data.list[0]]));
      allowedWrites.push({ url: "player/kick", body: kickBody([json.data.list[0]]) });
      await expect(toasts(page).first()).toBeVisible();
    });

    test("Backend báo lỗi khi Bulk Deactivate (response GIẢ): hiện toast lỗi, không có toast thành công", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await mockWrites(page, MOCK_FAIL);
      await checkboxOf(page, 0).check();
      await bulkBtns(page).nth(1).click();
      await Promise.all([page.waitForRequest(isUpdateStatus), dialog(page).getByRole("button", { name: /Deactivate$/ }).click()]);
      allowedWrites.push({ url: "player/update-status", body: { ids: [json.data.list[0].id], status: 0 } });
      await expect(toasts(page).first()).toBeVisible();
      await expect(toasts(page).filter({ hasText: /Success/ })).toHaveCount(0);
    });
  });

  // ===== 8. Thao tác trên từng dòng (icon Activate / Deactivate, Kick) =====
  test.describe("Icon trên dòng: Activate / Deactivate, Kick (Cancel hoặc response GIẢ)", () => {
    test("Activate / Deactivate từng dòng: hộp thoại xác nhận đúng tiêu đề + nút, đóng bằng Cancel", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      const action = x.status === 1 ? "Deactivate" : "Activate";
      await clickAction(page, 0, 0);
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText(`${action} ${norm(x.username)}`);
      await expect(dialog(page)).toContainText(`Are you sure you want to ${action.toLowerCase()} this player?`);
      await expect(dialog(page).getByRole("button", { name: new RegExp(`${action}$`) })).toBeVisible();
      await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
      await expect(dialog(page)).toBeHidden();
    });

    test("Xác nhận (response GIẢ): gửi player/update-status {ids:[id], status đảo}, có toast, tải lại danh sách", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await mockWrites(page, MOCK_OK);
      const x = json.data.list[0];
      const action = x.status === 1 ? "Deactivate" : "Activate";
      await clickAction(page, 0, 0);
      const [req] = await Promise.all([
        page.waitForRequest(isUpdateStatus),
        page.waitForRequest(isList),
        dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click(),
      ]);
      expect(bodyOf(req)).toEqual({ ids: [x.id], status: 1 - x.status });
      allowedWrites.push({ url: "player/update-status", body: { ids: [x.id], status: 1 - x.status } });
      await expect(toasts(page).first()).toBeVisible();
      await expect(dialog(page)).toBeHidden();
    });

    test("Dòng ở trạng thái còn lại (Inactive <-> Active) cũng gửi đúng status đảo (response GIẢ)", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      // Lọc ra trạng thái ngược với dòng đầu để kiểm tra cả 2 chiều Activate / Deactivate
      const other = 1 - all.data.list[0].status;
      await selectFilter(page, "status", STATUS_TEXT[other]);
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, `Không có player ${STATUS_TEXT[other]}`);
      await mockWrites(page, MOCK_OK);
      const x = json.data.list[0];
      const action = x.status === 1 ? "Deactivate" : "Activate";
      await hoverTip(page, actionIcon(page, 0, 0), action);
      await clickAction(page, 0, 0);
      await expect(dialog(page)).toContainText(`${action} ${norm(x.username)}`);
      const [req] = await Promise.all([page.waitForRequest(isUpdateStatus), dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click()]);
      expect(bodyOf(req)).toEqual({ ids: [x.id], status: 1 - x.status });
      allowedWrites.push({ url: "player/update-status", body: { ids: [x.id], status: 1 - x.status } });
      await expect(toasts(page).first()).toBeVisible();
    });

    test("Backend báo lỗi khi Activate / Deactivate (response GIẢ): hiện toast lỗi, không có toast thành công", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await mockWrites(page, MOCK_FAIL);
      const x = json.data.list[0];
      const action = x.status === 1 ? "Deactivate" : "Activate";
      await clickAction(page, 0, 0);
      await Promise.all([page.waitForRequest(isUpdateStatus), dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click()]);
      allowedWrites.push({ url: "player/update-status", body: { ids: [x.id], status: 1 - x.status } });
      await expect(toasts(page).first()).toBeVisible();
      await expect(toasts(page).filter({ hasText: /Success/ })).toHaveCount(0);
    });

    // Quan sát: hộp thoại Kick từng dòng có tiêu đề "You are about to kick player <username>" và nút xác nhận là "OK",
    // còn Bulk Kick có tiêu đề "Kick <username> player" và nút "Kick" (không đồng nhất) -> ghi ở report.md
    test("Kick từng dòng: hộp thoại 'You are about to kick player <username>' + câu hỏi xác nhận, đóng bằng Cancel", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      await clickAction(page, 0, 1);
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText(`You are about to kick player ${norm(x.username)}`);
      await expect(dialog(page)).toContainText("Are you sure you want to kick this player?");
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: "OK", exact: true })).toBeVisible();
      await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
      await expect(dialog(page)).toBeHidden();
    });

    test("Xác nhận Kick (response GIẢ): gửi player/kick {playerKicks:[{agentCode,username,playerId}]} và có toast", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await mockWrites(page, MOCK_OK);
      const x = json.data.list[0];
      await clickAction(page, 0, 1);
      const [req] = await Promise.all([page.waitForRequest(isKick), dialog(page).getByRole("button", { name: "OK", exact: true }).click()]);
      expect(bodyOf(req)).toEqual(kickBody([x]));
      allowedWrites.push({ url: "player/kick", body: kickBody([x]) });
      await expect(toasts(page).first()).toBeVisible();
      await expect(dialog(page)).toBeHidden();
    });

    test("Backend báo lỗi khi Kick (response GIẢ): hiện toast lỗi, không có toast thành công", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await mockWrites(page, MOCK_FAIL);
      const x = json.data.list[0];
      await clickAction(page, 0, 1);
      await Promise.all([page.waitForRequest(isKick), dialog(page).getByRole("button", { name: "OK", exact: true }).click()]);
      allowedWrites.push({ url: "player/kick", body: kickBody([x]) });
      await expect(toasts(page).first()).toBeVisible();
      await expect(toasts(page).filter({ hasText: /Success/ })).toHaveCount(0);
    });

    test("Dòng của Kick / Activate không chuyển trang (vẫn ở /player)", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      await clickAction(page, 0, 1);
      await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
      await expect(page).toHaveURL(/\/player$/);
    });
  });

  // ===== 9. Manage Columns =====
  test.describe("Manage Columns", () => {
    // hasText dạng RegExp khớp CHÍNH XÁC tên cột
    const item = (page, name) =>
      columnPopover(page).locator(".NextGen-popover-manage-column__list__items", { hasText: exact(name) });

    test("Popover liệt kê đủ cột", async ({ page }) => {
      await columnBtn(page).click();
      const names = await columnPopover(page).locator(".NextGen-popover-manage-column__list__items").allInnerTexts();
      expect(names.map((n) => n.trim())).toEqual(COLUMNS);
    });

    test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Agent").locator("label").click();
      expect(await headers(page)).not.toContain("Agent");
      expect(await headers(page)).toHaveLength(HEADERS.length - 1);
      await item(page, "Agent").locator("label").click();
      expect(await headers(page)).toEqual(HEADERS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      const before = await columnValues(page, "Username");
      await columnBtn(page).click();
      await item(page, "Agent").locator("label").click();
      expect(await columnValues(page, "Username")).toEqual(before);
    });

    test("Cấu hình cột không được lưu: tải lại trang thì hiện đủ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Agent").locator("label").click();
      expect(await headers(page)).not.toContain("Agent");
      await openPage(page); // reload
      expect(await headers(page)).toEqual(HEADERS);
    });
  });

  // ===== 10. Export =====
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

    test("Export tạo job tải xuống (module PLAYERS, section AGENT_PLAYERS_LIST) gồm toàn bộ cột", async ({ page }) => {
      const { body, payload } = await exportAndCheck(page);
      expect(body.module).toBe("PLAYERS");
      expect(body.section).toBe("AGENT_PLAYERS_LIST");
      expect(body.timezoneId).toBe(BASE.timezoneId);
      expect(payload.filters.fields).toEqual(COLUMNS);
      expect(payload.filters).toMatchObject(BASE);
    });

    test("Export đi kèm đúng filter hiện tại (House, Player Name, Currency, Status)", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const h = await houseOf(x);
      const c = await currencyOf(x);
      test.skip(!h || !c, "House / currency của dòng đầu không có trong dropdown hoặc tên bị trùng");
      await selectFilter(page, "houseIds", h.label);
      await selectFilter(page, "currencyIds", c.label);
      await selectFilter(page, "status", statusOf(x));
      await typeUsername(page, x.username.slice(0, 3));
      await search(page);
      const { payload } = await exportAndCheck(page);
      expect(payload.filters).toMatchObject(
        F({ houseIds: [h.value], currencyIds: [c.value], status: [x.status], username: x.username.slice(0, 3) }),
      );
    });

    test("Export chỉ chứa các cột đang hiển thị", async ({ page }) => {
      await columnBtn(page).click();
      await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items", { hasText: exact("Agent") })
        .locator("label")
        .click();
      const [req] = await Promise.all([page.waitForRequest(isDownload), exportBtn(page).click()]);
      const payload = JSON.parse(bodyOf(req).payload);
      expect(payload.filters.fields).not.toContain("Agent");
      expect(payload.filters.fields).toContain("Username");
      await page.keyboard.press("Escape");
    });
  });

  // ===== 11. Ghi nhớ filter =====
  test.describe("Ghi nhớ filter", () => {
    test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
      await selectFilter(page, "status", "Active");
      await search(page);
      await pageSizeSelect(page).click();
      await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

      await openPage(page); // reload
      expect(await selectedFilter(page, "status")).toEqual(["Active"]);
      await expect(pageSizeSelect(page)).toContainText("20 / page");
    });

    test("Sau reload, request list đầu tiên đã mang filter được lưu", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      await typeUsername(page, all.data.list[0].username);
      await selectFilter(page, "status", statusOf(all.data.list[0]));
      await search(page);

      const [req] = await Promise.all([page.waitForRequest(isList), page.reload()]);
      expect(bodyOf(req).filters).toMatchObject({ username: all.data.list[0].username, status: [all.data.list[0].status] });
      await settle(page);
    });

    test("Reset xoá filter đã ghi nhớ: reload lại thì filter trống", async ({ page }) => {
      await selectFilter(page, "status", "Active");
      await search(page);
      await resetBodies(page);
      await openPage(page); // reload
      await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
    });
  });
});
