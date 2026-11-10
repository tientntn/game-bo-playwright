// Master Agents > Master Agents  (https://dev-bo.royaledge.io/master-agent/entity)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/master_agent_entity.spec.js --project=setup --project=chromium
//
// Màn hình quản lý Master Agent (cấp ngay dưới House): danh sách có phân trang + Export + Manage Columns.
//  - API list: masteragent/list {page,pageSize,sortBy,sortDirection,filters:{houseIds,masterAgentIds,gameCategoryIds,currencyIds,status}}
//    (filter Status chọn 1 giá trị gửi số 1 / 0; 4 filter còn lại chọn nhiều, gửi mảng id).
//  - Dropdown: House = report/house_dropdown, Master Agent = report/master_agent_dropdown {houseIds} (chọn House thì dropdown Master Agent
//    chỉ còn MA thuộc House đó), Game Category = dropdown/gamecategory, Currency = dropdown/currency.
//  - Cột Currency chỉ hiện 6 mã đầu + chip "+ N ..."; Login Code / Game Category / Currency / Action không sort được.
//  - Cột Action: View (/master-agent/entity/view/{id}), Update (/master-agent/entity/update/{id}) và menu "..." gồm Activate / Deactivate,
//    Create Master Agent User (/master-agent/users/create). Bấm tên Master Agent -> /agent/entity (danh sách Agent đã lọc theo MA).
//  - Add New -> /master-agent/entity/create: wizard 3 bước (Basic Information -> Backoffice Geofencing -> Review & Submit),
//    Submit gọi masteragent/create; Update là wizard tương tự (masteragent/update). Name / Code chỉ nhập được sau khi chọn House.
//  - Activate / Deactivate (từng dòng + hàng loạt) gọi masteragent/update-status {ids,status}.
//
// AN TOÀN DỮ LIỆU:
//  - Mọi describe trừ describe cuối là CHỈ ĐỌC: request ghi (masteragent/create, update, update-status...) bị chặn ở tầng mạng
//    (route.abort) hoặc được trả về response GIẢ (route.fulfill, request KHÔNG tới server) để kiểm tra payload / toast. Mỗi test khai báo
//    request ghi được phép (allowedWrites) và afterEach so sánh chính xác với request ghi bắt được (watchWrites). Master Agent có sẵn của team
//    chỉ bị thao tác bằng request GIẢ, KHÔNG bao giờ bị ghi thật. Không bao giờ bấm Submit thật ở màn hình Update.
//  - Describe cuối "Create Master Agent (ghi dữ liệu thật)": tạo 1 master agent tên "QA-AUTO-<timestamp>" bằng UI (gắn vào house đầu tiên
//    trong dropdown) rồi DỌN bằng cách Deactivate (màn hình không có Delete nên không xoá được; MA QA-AUTO để lại ở trạng thái Inactive).
//    afterEach kiểm tra mọi request ghi chỉ là masteragent/create đúng tên QA-AUTO và masteragent/update-status chỉ nhắm vào id vừa tạo.
//  - Export tạo bản ghi ở Download History; nếu file cùng filter đã tồn tại thì hộp thoại "Download Now / Download New" hiện ra và
//    test KHÔNG bấm Download New (tránh xoá file cũ).
//  - Không hard-code dữ liệu: house / master agent / currency / game category / id đều lấy từ response list và dropdown; id màn hình con
//    lấy từ icon ở dòng.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/master-agent/entity";
const ORIGIN = "https://dev-bo.royaledge.io";

// Đúng thứ tự hiển thị (cột đầu tiên là checkbox chọn dòng, không có tên)
const COLUMNS = ["ID", "Master Agent", "Code", "Login Code", "House", "Game Category", "Currency", "Status", "Action"];
const HEADERS = ["", ...COLUMNS];
const COL = { check: 0, id: 1, name: 2, code: 3, login: 4, house: 5, category: 6, currency: 7, status: 8, action: 9 };
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
const DEFAULT_BODY = { page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: {} };
// Cột sort được -> sortBy gửi lên API (mặc định id giảm dần)
const SORTABLE = { "Master Agent": "name", Code: "code", House: "house", Status: "status" };
const STATUS_TEXT = { 0: "Inactive", 1: "Active" };
const MAX_CURRENCY_CHIPS = 6; // số mã currency hiện trong ô; phần còn lại gom thành "+ N ..."

const MSG = {
  noEntries: "There are no entries found",
  required: "This field is required",
  house: "Please select house",
  currencies: "Please select at least 1 currencies",
  category: "Please select at least 1 Game Category",
  dupName: "Name is already existed",
  dupCode: "Entity code is already existed",
};

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI
// (validate/entityname, validate/entitycode chỉ kiểm tra trùng; house/supportedcurrency, house/supportedcategories chỉ đọc)
const READ = /\/(list|details|download|view)(\?|$)|\/dropdown\/|_dropdown(\?|$)|\/validate\/|\/supported(currency|categories)(\?|$)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/masteragent/list");
const isView = endsWith("/masteragent/view");
const isDownload = endsWith("/download");
const isUpdateStatus = endsWith("/masteragent/update-status");
const isCreate = endsWith("/masteragent/create");
const isUpdate = endsWith("/masteragent/update");
const isHouseDropdown = endsWith("/report/house_dropdown");
const isMasterAgentDropdown = endsWith("/report/master_agent_dropdown");
const isCurrencyDropdown = endsWith("/dropdown/currency");
const isCategoryDropdown = endsWith("/dropdown/gamecategory");

const exact = (s, flags = "") => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, flags);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};

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
const pageSizeSelect = (page) => page.locator(".ant-pagination-options .ant-select");
const dialog = (page) => page.getByRole("dialog");
const toasts = (page) => page.locator(".Toastify__toast");
const tooltip = (page) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
const filterEl = (page, id) => page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });

// Tooltip antd mở / đóng có độ trễ: tooltip cũ còn đang mờ dần thì có 2 tooltip cùng lúc (strict mode violation).
// Đưa chuột ra ngoài, đợi tooltip cũ ẩn hết rồi hover lại, thử lại tới khi tooltip có đúng nội dung.
const hoverTip = async (page, target, text) => {
  await expect(async () => {
    await page.mouse.move(0, 0);
    await expect(tooltip(page)).toHaveCount(0, { timeout: 2000 });
    await target.hover();
    await expect(tooltip(page).filter({ hasText: text })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
};

// Icon ở cột Action của 1 dòng: 0 = View, 1 = Update, 2 = "..." (menu; chỉ phản hồi khi click phần tử cha của svg)
const actionIcon = (page, i, n) => rowAt(page, i).locator(".column-actions svg").nth(n);
const menuItems = (page) => page.locator(".ant-dropdown:not(.ant-dropdown-hidden) li");
async function openRowMenu(page, i) {
  await actionIcon(page, i, 2).locator("xpath=..").click();
  await expect(menuItems(page).first()).toBeVisible();
}
async function closeRowMenu(page) {
  await page.keyboard.press("Escape");
  await expect(menuItems(page)).toHaveCount(0);
}

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
}
// Search đôi khi gửi 2 request list giống hệt nhau: chờ mạng yên để request thừa không bị nhầm là của thao tác kế tiếp
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
}

// Mở màn hình và chờ lần load đầu tiên (default filter) xong
async function openPage(page) {
  test.setTimeout(90000);
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

// Chip (span) của 1 ô Game Category / Currency trong bảng
const chipsOf = (page, i, col) => cellAt(page, i, col).locator("span").allInnerTexts().then((a) => a.map(norm));

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô. KHÔNG click giữa ô: ô chọn nhiều có chip
// "Tên ×" và tâm ô thường rơi đúng nút (x) -> xoá giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn 1 option (theo text hiển thị) ở filter rồi đóng dropdown. Dropdown chọn nhiều không tự đóng và Esc không đóng
// -> click ra ngoài (breadcrumb). Gõ text vào ô tìm kiếm để option chắc chắn có trong DOM.
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

// Đọc toàn bộ option đang có của 1 dropdown rồi đóng lại
async function dropdownTitles(page, id) {
  await openDropdown(page, id);
  await openOptions(page).first().waitFor();
  const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
  return titles;
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

const statusOf = (x) => STATUS_TEXT[x.status];
// Xoá filter / page size đã lưu ở localStorage 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
// (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
const clearSavedState = () =>
  (page) =>
    page.addInitScript(() => {
      if (sessionStorage.getItem("__ma_entity_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/master-agent_entity_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__ma_entity_spec_cleared", "1");
    });

// ---------------------------------------------------------------------------
// Tests: danh sách (chỉ đọc)
// ---------------------------------------------------------------------------
test.describe("Master Agents > Master Agents (danh sách)", () => {
  let writes;
  let allowedWrites; // request ghi được phép (chỉ các test dùng response giả; request KHÔNG tới server thật)
  let housesLoaded; // promise của response report/house_dropdown lúc mở trang
  let masterAgentsLoaded;
  let currenciesLoaded;
  let categoriesLoaded;
  const houses = async () => (await (await housesLoaded).json()).data; // [{ value, code, label }]
  const masterAgents = async () => (await (await masterAgentsLoaded).json()).data; // [{ value, code, label }]
  const currencies = async () => (await (await currenciesLoaded).json()).data; // [{ value, code, label }]
  const categories = async () => (await (await categoriesLoaded).json()).data; // [{ value, code, label }]
  const optText = (h) => `${h.code} - ${h.label}`;

  test.beforeEach(async ({ page }) => {
    await clearSavedState()(page);
    writes = watchWrites(page);
    allowedWrites = [];
    housesLoaded = page.waitForResponse(isHouseDropdown, { timeout: 60000 });
    masterAgentsLoaded = page.waitForResponse(isMasterAgentDropdown, { timeout: 60000 });
    currenciesLoaded = page.waitForResponse(isCurrencyDropdown, { timeout: 60000 });
    categoriesLoaded = page.waitForResponse(isCategoryDropdown, { timeout: 60000 });
    for (const p of [housesLoaded, masterAgentsLoaded, currenciesLoaded, categoriesLoaded]) p.catch(() => {});
    await blockWrites(page);
    await openPage(page);
  });

  // Mọi test không được gửi request ghi nào ngoài danh sách được phép (và request được phép cũng không tới server thật)
  test.afterEach(async () => {
    expect(writes, "Request ghi dữ liệu bắt được phải đúng danh sách được phép").toEqual(allowedWrites);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề 'Master Agents', đủ 5 filter House / Master Agent / Game Category / Currency / Status và 2 nút Search/Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Master Agents");
      await expect(page.locator(".NextGen-filter-element")).toHaveCount(5);
      await expect(filterEl(page, "houseIds")).toContainText("House");
      await expect(filterEl(page, "masterAgentIds")).toContainText("Master Agent");
      await expect(filterEl(page, "gameCategoryIds")).toContainText("Game Category");
      await expect(filterEl(page, "currencyIds")).toContainText("Currency");
      await expect(filterEl(page, "status")).toContainText("Status");
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: tất cả để trống", async ({ page }) => {
      await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
    });

    test("House / Master Agent / Game Category / Currency chọn nhiều, Status chọn 1 giá trị", async ({ page }) => {
      for (const id of ["houseIds", "masterAgentIds", "gameCategoryIds", "currencyIds"]) {
        await expect(filterEl(page, id).locator(".ant-select-multiple"), id).toHaveCount(1);
      }
      await expect(filterEl(page, "status").locator(".ant-select-single")).toHaveCount(1);
      await expect(filterEl(page, "status").locator(".ant-select-multiple")).toHaveCount(0);
    });

    test("Có Add New, 2 nút thao tác hàng loạt, Export và Manage Columns", async ({ page }) => {
      await expect(addBtn(page)).toBeVisible();
      await expect(bulkBtns(page)).toHaveCount(2);
      await expect(exportBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
    });

    test(`Bảng có đủ ${COLUMNS.length} cột (+ cột checkbox) đúng thứ tự`, async ({ page }) => {
      expect(await headers(page)).toEqual(HEADERS);
    });

    test("Mặc định: trang 1, 10 dòng, sort id giảm dần, không gửi filter", async ({ page }) => {
      const { body, status, json } = await search(page);
      expect(status).toBe(200);
      expect(body).toEqual(DEFAULT_BODY);
      expect(json.status).toBe("success");
      expect(json.data.list.length).toBeLessThanOrEqual(10);
      const ids = json.data.list.map((x) => x.id);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
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
    test("Mỗi dòng khớp response API (ID, Master Agent, Code, Login Code, House, Status)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      await expect(rows(page)).toHaveCount(list.length);
      for (const [i, x] of list.entries()) {
        const at = `dòng ${i + 1} (master agent ${x.id})`;
        expect(norm(await cellAt(page, i, COL.id).innerText()), at).toBe(String(x.id));
        expect(norm(await cellAt(page, i, COL.name).innerText()), at).toBe(norm(x.name));
        expect(norm(await cellAt(page, i, COL.code).innerText()), at).toBe(norm(x.code));
        expect(norm(await cellAt(page, i, COL.login).innerText()), at).toBe(norm(x.loginCode));
        expect(norm(await cellAt(page, i, COL.house).innerText()), at).toBe(norm(x.house.name));
        expect(norm(await cellAt(page, i, COL.status).innerText()), at).toBe(statusOf(x));
      }
    });

    test("Cột Currency hiện tối đa 6 mã đầu, phần còn lại gom thành chip '+ N ...'; không có currency thì để trống", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const [i, x] of json.data.list.entries()) {
        const at = `dòng ${i + 1} (master agent ${x.id}, ${x.currencies.length} currency)`;
        const chips = await chipsOf(page, i, COL.currency);
        const shown = x.currencies.slice(0, MAX_CURRENCY_CHIPS);
        if (x.currencies.length > MAX_CURRENCY_CHIPS) {
          expect(chips, at).toEqual([...shown, `+ ${x.currencies.length - MAX_CURRENCY_CHIPS} ...`]);
        } else {
          expect(chips, at).toEqual(shown);
        }
      }
    });

    test("Cột Game Category hiện đúng danh sách category của master agent", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const [i, x] of json.data.list.entries()) {
        expect(await chipsOf(page, i, COL.category), `dòng ${i + 1} (master agent ${x.id})`).toEqual(x.gameCategories.map(norm));
      }
    });

    test("Tên Master Agent là link; ID / Code duy nhất; Status chỉ Active hoặc Inactive; mỗi MA thuộc 1 House", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (let i = 0; i < json.data.list.length; i++) await expect(cellAt(page, i, COL.name).locator("a")).toHaveCount(1);
      const ids = json.data.list.map((x) => x.id);
      const codes = json.data.list.map((x) => x.code);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(codes).size).toBe(codes.length);
      for (const x of json.data.list) {
        expect([0, 1]).toContain(x.status);
        expect(x.house, `master agent ${x.id} phải có house`).toBeTruthy();
      }
    });

    test("Mỗi dòng có icon View, Update (tooltip) và menu '...'", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await expect(rowAt(page, 0).locator(".column-actions svg")).toHaveCount(3);
      await hoverTip(page, actionIcon(page, 0, 0), "View");
      await hoverTip(page, actionIcon(page, 0, 1), "Update");
    });

    test("Menu '...' của dòng: Activate (đang Inactive) hoặc Deactivate (đang Active) + Create Master Agent User", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const i of [...new Set([0, json.data.list.findIndex((x) => x.status !== json.data.list[0].status)])].filter((v) => v >= 0)) {
        await openRowMenu(page, i);
        const toggle = json.data.list[i].status === 1 ? "Deactivate" : "Activate";
        expect((await menuItems(page).allInnerTexts()).map(norm), `dòng ${i + 1}`).toEqual([toggle, "Create Master Agent User"]);
        await closeRowMenu(page);
      }
    });
  });

  // ===== 3. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Dropdown House liệt kê đủ house của report/house_dropdown (dạng 'code - tên')", async ({ page }) => {
      const data = await houses();
      test.skip(data.length === 0, "Không có house nào");
      const titles = await dropdownTitles(page, "houseIds");
      expect([...titles].sort()).toEqual(data.map(optText).sort());
    });

    test("Dropdown Master Agent liệt kê đủ master agent của report/master_agent_dropdown (dạng 'code - tên')", async ({ page }) => {
      const data = await masterAgents();
      test.skip(data.length === 0, "Không có master agent nào");
      const titles = await dropdownTitles(page, "masterAgentIds");
      expect([...titles].sort()).toEqual(data.map(optText).sort());
    });

    test("Dropdown Game Category liệt kê đủ category của dropdown/gamecategory", async ({ page }) => {
      const data = await categories();
      test.skip(data.length === 0, "Không có category nào");
      const titles = await dropdownTitles(page, "gameCategoryIds");
      expect([...titles].sort()).toEqual(data.map((c) => c.label).sort());
    });

    test("Dropdown Currency liệt kê đủ currency của dropdown/currency", async ({ page }) => {
      const data = await currencies();
      test.skip(data.length === 0, "Không có currency nào");
      const titles = await dropdownTitles(page, "currencyIds");
      expect([...titles].sort()).toEqual(data.map((c) => c.label).sort());
    });

    test("Option cố định của Status: Active, Inactive", async ({ page }) => {
      expect(await dropdownTitles(page, "status")).toEqual(["Active", "Inactive"]);
    });

    test("Gõ vào ô tìm kiếm của filter Master Agent chỉ còn option khớp", async ({ page }) => {
      const data = await masterAgents();
      test.skip(data.length === 0, "Không có master agent nào");
      const m = data[data.length - 1];
      await openDropdown(page, "masterAgentIds");
      await page.keyboard.type(m.code);
      const expected = data.filter((v) => optText(v).toLowerCase().includes(m.code.toLowerCase())).map(optText);
      await expect(openOptions(page)).toHaveCount(expected.length);
      expect(await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")))).toEqual(expected);
      await breadcrumb(page).click();
    });

    test("Search không chọn gì: gửi filters rỗng và trả về cùng tổng bản ghi", async ({ page }) => {
      const first = await search(page);
      const second = await search(page);
      expect(second.body).toEqual(DEFAULT_BODY);
      expect(second.json.data.totalCount).toBe(first.json.data.totalCount);
    });

    test("Chọn House: gửi filters.houseIds = [id] và mọi master agent đều thuộc house đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const h = (await houses()).find((v) => v.code === x.house.code);
      test.skip(!h, "House của dòng đầu không có trong dropdown");

      await selectFilter(page, "houseIds", optText(h));
      expect(await selectedFilter(page, "houseIds")).toEqual([optText(h)]);
      const { body, json } = await search(page);
      expect(body).toMatchObject({ page: 1, pageSize: 10 });
      expect(body.filters).toEqual({ houseIds: [h.value] });
      expect(json.data.totalCount).toBeGreaterThan(0);
      expect(json.data.list.map((r) => r.id)).toContain(x.id);
      for (const r of json.data.list) expect(r.house.id, `master agent ${r.id}`).toBe(h.value);
      for (const t of await columnValues(page, "House")) expect(t).toBe(norm(x.house.name));
    });

    test("Chọn House thì dropdown Master Agent gửi houseIds và chỉ còn master agent thuộc house đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const h = (await houses()).find((v) => v.code === x.house.code);
      test.skip(!h, "House của dòng đầu không có trong dropdown");
      const allMa = (await masterAgents()).map(optText);

      const [req] = await Promise.all([page.waitForRequest(isMasterAgentDropdown), selectFilter(page, "houseIds", optText(h))]);
      expect(bodyOf(req)).toEqual({ houseIds: [h.value] });
      const titles = await dropdownTitles(page, "masterAgentIds");
      expect(titles.length).toBeGreaterThan(0);
      expect(titles.length).toBeLessThanOrEqual(allMa.length);
      for (const t of titles) expect(allMa).toContain(t);
      expect(titles).toContain(`${x.code} - ${x.name}`);
    });

    test("Chọn Master Agent: gửi filters.masterAgentIds = [id] và chỉ còn đúng master agent đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const m = (await masterAgents()).find((v) => v.code === x.code);
      test.skip(!m, "Master agent của dòng đầu không có trong dropdown");

      await selectFilter(page, "masterAgentIds", optText(m));
      expect(await selectedFilter(page, "masterAgentIds")).toEqual([optText(m)]);
      const { body, json } = await search(page);
      expect(body.filters).toEqual({ masterAgentIds: [m.value] });
      expect(json.data.totalCount).toBe(1);
      expect(json.data.list.map((r) => r.id)).toEqual([x.id]);
      await expect(rows(page)).toHaveCount(1);
      await expect(cellAt(page, 0, COL.name)).toHaveText(norm(x.name));
      await expect(summary(page)).toHaveText("Showing 1 - 1 of 1 records");
    });

    test("Chọn nhiều Master Agent: gửi masterAgentIds theo thứ tự chọn và chỉ còn các master agent đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length < 2, "Cần ít nhất 2 master agent");
      const dd = await masterAgents();
      const picks = all.data.list.slice(0, 2).map((x) => dd.find((v) => v.code === x.code));
      test.skip(picks.some((p) => !p), "Master agent không có trong dropdown");

      for (const m of picks) await selectFilter(page, "masterAgentIds", optText(m));
      expect(await selectedFilter(page, "masterAgentIds")).toEqual(picks.map(optText));
      const { body, json } = await search(page);
      expect(body.filters).toEqual({ masterAgentIds: picks.map((m) => m.value) });
      expect(json.data.totalCount).toBe(2);
      expect(json.data.list.map((r) => r.id).sort((a, b) => a - b)).toEqual(
        all.data.list.slice(0, 2).map((r) => r.id).sort((a, b) => a - b),
      );
    });

    test("Chọn Currency: gửi filters.currencyIds = [id] và mọi master agent đều có currency đó", async ({ page }) => {
      const { json: all } = await search(page);
      const withCur = all.data.list.find((x) => x.currencies.length > 0);
      test.skip(!withCur, "Không có master agent nào có currency");
      const dd = await currencies();
      const code = withCur.currencies[0];
      const cur = dd.filter((c) => c.label === code);
      test.skip(cur.length !== 1, "Tên currency không xác định duy nhất trong dropdown");

      await selectFilter(page, "currencyIds", code);
      expect(await selectedFilter(page, "currencyIds")).toEqual([code]);
      const { body, json } = await search(page);
      expect(body.filters).toEqual({ currencyIds: [cur[0].value] });
      expect(json.data.totalCount).toBeGreaterThan(0);
      expect(json.data.list.map((r) => r.id)).toContain(withCur.id);
      for (const r of json.data.list) expect(r.currencies, `master agent ${r.id} (${r.name}) không có currency ${code}`).toContain(code);
    });

    test("Chọn Game Category: gửi filters.gameCategoryIds = [id] và mọi master agent đều có category đó", async ({ page }) => {
      const { json: all } = await search(page);
      const withCat = all.data.list.find((x) => x.gameCategories.length > 0);
      test.skip(!withCat, "Không có master agent nào có game category");
      const name = withCat.gameCategories[0];
      const cat = (await categories()).filter((c) => c.label === name);
      test.skip(cat.length !== 1, "Tên category không xác định duy nhất trong dropdown");

      await selectFilter(page, "gameCategoryIds", name);
      expect(await selectedFilter(page, "gameCategoryIds")).toEqual([name]);
      const { body, json } = await search(page);
      expect(body.filters).toEqual({ gameCategoryIds: [cat[0].value] });
      expect(json.data.list.map((r) => r.id)).toContain(withCat.id);
      for (const r of json.data.list) expect(r.gameCategories, `master agent ${r.id} (${r.name})`).toContain(name);
    });

    for (const [label, code] of [["Active", 1], ["Inactive", 0]]) {
      test(`Lọc theo Status = ${label} gửi status=${code} và mọi dòng khớp`, async ({ page }) => {
        await selectFilter(page, "status", label);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ status: code });
        for (const r of json.data.list) expect(r.status).toBe(code);
        for (const t of await columnValues(page, "Status")) expect(t).toBe(label);
      });
    }

    test("Số master agent Active + Inactive bằng tổng số master agent", async ({ page }) => {
      const { json: all } = await search(page);
      await selectFilter(page, "status", "Active");
      const active = (await search(page)).json.data.totalCount;
      await selectFilter(page, "status", "Inactive");
      const inactive = (await search(page)).json.data.totalCount;
      expect(active + inactive).toBe(all.data.totalCount);
    });

    test("Status chỉ chọn được 1 giá trị (chọn giá trị mới thì thay thế)", async ({ page }) => {
      await selectFilter(page, "status", "Active");
      await selectFilter(page, "status", "Inactive");
      expect(await selectedFilter(page, "status")).toEqual(["Inactive"]);
      expect((await search(page)).body.filters).toEqual({ status: 0 });
    });

    test("Kết hợp House + Master Agent + Status khớp nhau (AND)", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const h = (await houses()).find((v) => v.code === x.house.code);
      const m = (await masterAgents()).find((v) => v.code === x.code);
      test.skip(!h || !m, "House / master agent của dòng đầu không có trong dropdown");
      await selectFilter(page, "houseIds", optText(h));
      await selectFilter(page, "masterAgentIds", optText(m));
      await selectFilter(page, "status", statusOf(x));
      const { body, json } = await search(page);
      expect(body.filters).toEqual({ houseIds: [h.value], masterAgentIds: [m.value], status: x.status });
      expect(json.data.list.map((r) => r.id)).toEqual([x.id]);
    });

    test("Master Agent + Status không khớp nhau -> 'There are no entries found'", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const m = (await masterAgents()).find((v) => v.code === x.code);
      test.skip(!m, "Master agent của dòng đầu không có trong dropdown");
      const other = x.status === 1 ? "Inactive" : "Active";
      await selectFilter(page, "masterAgentIds", optText(m));
      await selectFilter(page, "status", other);
      const { body, json } = await search(page);
      expect(body.filters).toEqual({ masterAgentIds: [m.value], status: 1 - x.status });
      expect(json.data.totalCount).toBe(0);
      expect(json.data.list).toEqual([]);
      await expect(page.getByText(MSG.noEntries)).toBeVisible();
      await expect(rows(page)).toHaveCount(0);
    });

    test("Xoá giá trị đã chọn bằng nút (x) rồi Search: không còn gửi filter đó", async ({ page }) => {
      await selectFilter(page, "status", "Active");
      await filterEl(page, "status").hover();
      await filterEl(page, "status").locator(".ant-select-clear").click({ force: true });
      expect(await selectedFilter(page, "status")).toEqual([]);
      expect((await search(page)).body).toEqual(DEFAULT_BODY);
    });
  });

  // ===== 4. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá toàn bộ filter đã chọn và gửi lại request mặc định", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const h = (await houses()).find((v) => v.code === all.data.list[0].house.code);
      test.skip(!h, "House của dòng đầu không có trong dropdown");
      await selectFilter(page, "houseIds", optText(h));
      await selectFilter(page, "status", statusOf(all.data.list[0]));
      await search(page);

      const bodies = await resetBodies(page);
      expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual(DEFAULT_BODY);
      await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
      await expect(summary(page)).toHaveText(new RegExp(`of ${all.data.totalCount} records$`));
    });

    test("Reset đưa sort về mặc định (id giảm dần)", async ({ page }) => {
      await selectFilter(page, "status", "Active");
      await search(page);
      await reloadBy(page, () => th(page, "Master Agent").click());
      const bodies = await resetBodies(page);
      expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual(DEFAULT_BODY);
    });

    test("Reset khi đang ở trang 2 thì quay về trang 1", async ({ page }) => {
      await selectFilter(page, "status", "Active");
      const { json } = await search(page);
      test.skip(json.data.totalCount <= 10, "Chỉ có 1 trang");
      await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      const bodies = await resetBodies(page);
      expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toMatchObject({ page: 1, filters: {} });
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
    });
  });

  // ===== 5. Phân trang =====
  test.describe("Phân trang", () => {
    test("Trang 2 gọi API page=2 và dòng tóm tắt đúng (khi có > 10 bản ghi)", async ({ page }) => {
      const total = await totalOf(page);
      test.skip(total <= 10, "Chỉ có 1 trang");
      const { body, json } = await reloadFull(page, () => page.locator(".ant-pagination-item-2").click());
      expect(body).toMatchObject({ page: 2, pageSize: 10 });
      await expect(summary(page)).toHaveText(`Showing 11 - ${Math.min(20, total)} of ${total} records`);
      await expect(rows(page)).toHaveCount(json.data.list.length);
    });

    test("Trang 2 không trùng dòng nào với trang 1", async ({ page }) => {
      test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
      const { json: p1 } = await search(page);
      const { json: p2 } = await reloadFull(page, () => page.locator(".ant-pagination-item-2").click());
      const ids1 = p1.data.list.map((x) => x.id);
      for (const x of p2.data.list) expect(ids1).not.toContain(x.id);
    });

    test("Nút Next / Previous chuyển trang qua lại", async ({ page }) => {
      test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
      await expect(page.locator(".ant-pagination-prev")).toHaveClass(/ant-pagination-disabled/);
      const next = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(next).toMatchObject({ page: 2 });
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
      const prev = await reloadBy(page, () => page.locator(".ant-pagination-prev button").click());
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
      await selectFilter(page, "status", "Active");
      const { json } = await search(page);
      test.skip(json.data.totalCount <= 10, "Không đủ dữ liệu để sang trang 2");
      const p2 = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      expect(p2).toMatchObject({ page: 2, filters: { status: 1 } });
      await pageSizeSelect(page).click();
      const size = await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
      expect(size).toMatchObject({ page: 1, pageSize: 20, filters: { status: 1 } });
    });

    test("Search khi đang ở trang 2 thì quay về trang 1", async ({ page }) => {
      test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
      await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      const { body } = await search(page);
      expect(body).toMatchObject({ page: 1 });
    });
  });

  // ===== 6. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    test("Sort cột ID: mặc định giảm dần, bấm lần lượt -> (bỏ sort) -> tăng dần -> giảm dần", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
      // Cột ID đang ở trạng thái giảm dần (mặc định): lần bấm đầu về "không sort" nên không gọi lại API
      await th(page, "ID").click();

      const asc = await reloadBy(page, () => th(page, "ID").click());
      expect(asc).toMatchObject({ sortBy: "id", sortDirection: "asc", page: 1 });
      await expect
        .poll(async () => {
          const a = (await columnValues(page, "ID")).map(Number);
          return JSON.stringify(a) === JSON.stringify([...a].sort((x, y) => x - y));
        })
        .toBe(true);

      const desc = await reloadBy(page, () => th(page, "ID").click());
      expect(desc).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      await expect
        .poll(async () => {
          const d = (await columnValues(page, "ID")).map(Number);
          return JSON.stringify(d) === JSON.stringify([...d].sort((x, y) => y - x));
        })
        .toBe(true);
    });

    for (const [column, sortBy] of Object.entries(SORTABLE)) {
      test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định (id giảm dần)`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
        // Cột chữ phụ thuộc collation của server nên chỉ kiểm tra request; cột Status là 0 / 1 nên kiểm tra được thứ tự
        const key = (v) => (v === "Active" ? 1 : 0);
        const checkOrder = column === "Status";

        const asc = await reloadBy(page, () => th(page, column).click());
        expect(asc).toMatchObject({ sortBy, sortDirection: "asc", page: 1, pageSize: 10 });
        if (checkOrder) {
          await expect
            .poll(async () => {
              const v = (await columnValues(page, column)).map(key);
              return JSON.stringify(v) === JSON.stringify([...v].sort((a, b) => a - b));
            }, { message: "thứ tự tăng dần" })
            .toBe(true);
        }

        const desc = await reloadBy(page, () => th(page, column).click());
        expect(desc).toMatchObject({ sortBy, sortDirection: "desc" });
        if (checkOrder) {
          await expect
            .poll(async () => {
              const v = (await columnValues(page, column)).map(key);
              return JSON.stringify(v) === JSON.stringify([...v].sort((a, b) => b - a));
            }, { message: "thứ tự giảm dần" })
            .toBe(true);
        }

        const none = await reloadBy(page, () => th(page, column).click());
        expect(none).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      });
    }

    test("Sort giữ nguyên khi Search với filter", async ({ page }) => {
      await reloadBy(page, () => th(page, "Master Agent").click());
      await selectFilter(page, "status", "Active");
      const { body } = await search(page);
      expect(body).toMatchObject({ sortBy: "name", sortDirection: "asc", filters: { status: 1 } });
    });

    test("Chỉ ID, Master Agent, Code, House, Status sort được; Login Code / Game Category / Currency / Action không sort", async ({ page }) => {
      for (const c of COLUMNS) {
        if (c === "ID" || c in SORTABLE) await expect(th(page, c), c).toHaveClass(/ant-table-column-has-sorters/);
        else await expect(th(page, c), c).not.toHaveClass(/ant-table-column-has-sorters/);
      }
    });
  });

  // ===== 7. Chọn dòng và thao tác hàng loạt =====
  test.describe("Thao tác hàng loạt (Cancel, hoặc xác nhận bằng response GIẢ)", () => {
    test("Chưa chọn dòng nào thì 2 nút Activate / Deactivate hàng loạt bị vô hiệu", async ({ page }) => {
      await expect(bulkBtns(page).nth(0)).toBeDisabled();
      await expect(bulkBtns(page).nth(1)).toBeDisabled();
    });

    test("Chọn 1 dòng thì 2 nút được bật, bỏ chọn thì tắt lại", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      await checkboxOf(page, 0).check();
      await expect(bulkBtns(page).nth(0)).toBeEnabled();
      await expect(bulkBtns(page).nth(1)).toBeEnabled();
      await checkboxOf(page, 0).uncheck();
      await expect(bulkBtns(page).nth(0)).toBeDisabled();
      await expect(bulkBtns(page).nth(1)).toBeDisabled();
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
      await hoverTip(page, bulkBtns(page).nth(0), "Bulk Activate");
      await hoverTip(page, bulkBtns(page).nth(1), "Bulk Deactivate");
    });

    for (const [i, action] of ["Activate", "Deactivate"].entries()) {
      test(`${action} hàng loạt 1 master agent: hộp thoại '${action} <tên>' + câu hỏi xác nhận, đóng bằng Cancel`, async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await checkboxOf(page, 0).check();
        await bulkBtns(page).nth(i).click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toContainText(`${action} ${norm(json.data.list[0].name)}`);
        await expect(dialog(page)).toContainText(`Are you sure you want to ${action.toLowerCase()} this Master Agent?`);
        await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
        await expect(dialog(page).getByRole("button", { name: new RegExp(`${action}$`) })).toBeVisible();
        await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
        await expect(dialog(page)).toBeHidden();
        await expect(checkboxOf(page, 0)).toBeChecked(); // dòng vẫn đang được chọn
      });

      // Quan sát khi khám phá: tiêu đề hộp thoại đúng "Activate 2 Master Agents" nhưng câu hỏi bên dưới của nút Activate lại
      // nói "Are you sure you want to deactivate these 2 Master Agents?" (nhầm hành động). Test kiểm tra đúng hành vi mong đợi
      // (câu hỏi phải khớp hành động) nên test Activate sẽ FAIL cho tới khi sửa; Deactivate đúng.
      test(`${action} hàng loạt nhiều master agent: hộp thoại ghi rõ số lượng và câu hỏi đúng hành động '${action.toLowerCase()}', đóng bằng Cancel`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Cần ít nhất 2 master agent");
        await checkboxOf(page, 0).check();
        await checkboxOf(page, 1).check();
        await bulkBtns(page).nth(i).click();
        await expect(dialog(page)).toContainText(`${action} 2 Master Agents`);
        await expect(dialog(page)).toContainText(`Are you sure you want to ${action.toLowerCase()} these 2 Master Agents?`);
        await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
        await expect(dialog(page)).toBeHidden();
      });

      test(`${action} hàng loạt 2 master agent (xác nhận, response GIẢ): gửi masteragent/update-status {ids,status}, có toast, tải lại danh sách`, async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length < 2, "Cần ít nhất 2 master agent");
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
        allowedWrites.push({ url: "masteragent/update-status", body: { ids, status } });
        await expect(toasts(page).first()).toBeVisible();
        await expect(dialog(page)).toBeHidden();
      });
    }
  });

  // ===== 8. Thao tác trên từng dòng (menu "...") =====
  test.describe("Menu '...' của dòng: Activate / Deactivate (response GIẢ)", () => {
    test("Activate / Deactivate từng dòng: hộp thoại xác nhận đúng tiêu đề + nút, đóng bằng Cancel", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      const action = x.status === 1 ? "Deactivate" : "Activate";
      await openRowMenu(page, 0);
      await menuItems(page).filter({ hasText: exact(action) }).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText(`${action} ${norm(x.name)}`);
      // Quan sát: nội dung hiện là "Are you sure you want to ${action} these <tên> Master Agents?" (số nhiều dù chỉ 1 dòng) -> chỉ kiểm tra phần chắc chắn
      await expect(dialog(page)).toContainText(`Are you sure you want to ${action.toLowerCase()}`);
      await expect(dialog(page)).toContainText(norm(x.name));
      await expect(dialog(page).getByRole("button", { name: new RegExp(`${action}$`) })).toBeVisible();
      await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
      await expect(dialog(page)).toBeHidden();
    });

    test("Xác nhận (response GIẢ): gửi masteragent/update-status {ids:[id], status đảo}, có toast, tải lại danh sách", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await mockWrites(page, MOCK_OK);
      const x = json.data.list[0];
      const action = x.status === 1 ? "Deactivate" : "Activate";
      await openRowMenu(page, 0);
      await menuItems(page).filter({ hasText: exact(action) }).click();
      const [req] = await Promise.all([
        page.waitForRequest(isUpdateStatus),
        page.waitForRequest(isList),
        dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click(),
      ]);
      expect(bodyOf(req)).toEqual({ ids: [x.id], status: 1 - x.status });
      allowedWrites.push({ url: "masteragent/update-status", body: { ids: [x.id], status: 1 - x.status } });
      await expect(toasts(page).first()).toBeVisible();
      await expect(dialog(page)).toBeHidden();
    });

    test("Backend báo lỗi (response GIẢ): hiện toast lỗi, không có toast thành công", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await mockWrites(page, { status: "fail", messageCode: "QA_MOCK_ERROR", message: "QA mock error", data: null });
      const x = json.data.list[0];
      const action = x.status === 1 ? "Deactivate" : "Activate";
      await openRowMenu(page, 0);
      await menuItems(page).filter({ hasText: exact(action) }).click();
      await Promise.all([
        page.waitForRequest(isUpdateStatus),
        dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click(),
      ]);
      allowedWrites.push({ url: "masteragent/update-status", body: { ids: [x.id], status: 1 - x.status } });
      await expect(toasts(page).first()).toBeVisible();
      await expect(toasts(page).filter({ hasText: /Success/ })).toHaveCount(0);
    });
  });

  // ===== 9. Điều hướng từ danh sách =====
  test.describe("Điều hướng từ danh sách", () => {
    test("Bấm tên Master Agent -> /agent/entity với danh sách Agent đã lọc theo master agent (và house) đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      const [req] = await Promise.all([page.waitForRequest(endsWith("/agent/list")), cellAt(page, 0, COL.name).locator("a").click()]);
      await expect(page).toHaveURL(/\/agent\/entity$/);
      expect(bodyOf(req).filters).toMatchObject({
        houseIds: [x.house.id],
        houseId: x.house.id,
        houseCode: x.house.code,
        houseName: x.house.name,
        masterAgentIds: [x.id],
        masterAgentId: x.id,
        masterAgentCode: x.code,
        masterAgentName: x.name,
      });
    });

    test("Icon View -> /master-agent/entity/view/{id} và gọi masteragent/view {id}", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      const [req] = await Promise.all([page.waitForRequest(isView), actionIcon(page, 0, 0).click()]);
      await expect(page).toHaveURL(new RegExp(`/master-agent/entity/view/${x.id}$`));
      expect(bodyOf(req)).toEqual({ id: String(x.id) });
    });

    test("Icon Update -> /master-agent/entity/update/{id} và gọi masteragent/view {id}", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      const [req] = await Promise.all([page.waitForRequest(isView), actionIcon(page, 0, 1).click()]);
      await expect(page).toHaveURL(new RegExp(`/master-agent/entity/update/${x.id}$`));
      expect(bodyOf(req)).toEqual({ id: String(x.id) });
    });

    test("Menu '...' > Create Master Agent User -> /master-agent/users/create", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      await openRowMenu(page, 0);
      await menuItems(page).filter({ hasText: exact("Create Master Agent User") }).click();
      await expect(page).toHaveURL(/\/master-agent\/users\/create$/);
    });

    test("Nút Add New -> /master-agent/entity/create", async ({ page }) => {
      await addBtn(page).click();
      await expect(page).toHaveURL(/\/master-agent\/entity\/create$/);
      await expect(breadcrumb(page)).toContainText("Create Master Agent");
    });
  });

  // ===== 10. Manage Columns =====
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
      await item(page, "Code").locator("label").click();
      expect(await headers(page)).not.toContain("Code");
      expect(await headers(page)).toHaveLength(HEADERS.length - 1);
      await item(page, "Code").locator("label").click();
      expect(await headers(page)).toEqual(HEADERS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      const before = await columnValues(page, "Master Agent");
      await columnBtn(page).click();
      await item(page, "Code").locator("label").click();
      expect(await columnValues(page, "Master Agent")).toEqual(before);
    });

    test("Cấu hình cột không được lưu: tải lại trang thì hiện đủ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Code").locator("label").click();
      expect(await headers(page)).not.toContain("Code");
      await openPage(page); // reload
      expect(await headers(page)).toEqual(HEADERS);
    });
  });

  // ===== 11. Export =====
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

    test("Export tạo job tải xuống (module MASTER_AGENT, section MASTER_AGENT_LIST) gồm toàn bộ cột", async ({ page }) => {
      const { body, payload } = await exportAndCheck(page);
      expect(body.module).toBe("MASTER_AGENT");
      expect(body.section).toBe("MASTER_AGENT_LIST");
      expect(body.timezoneId).toEqual(expect.any(Number));
      expect(payload.filters.fields).toEqual(COLUMNS);
    });

    test("Export đi kèm đúng filter hiện tại", async ({ page }) => {
      await selectFilter(page, "status", "Inactive");
      await search(page);
      const { payload } = await exportAndCheck(page);
      expect(payload.filters.status).toBe(0);
    });

    test("Export chỉ chứa các cột đang hiển thị", async ({ page }) => {
      await columnBtn(page).click();
      await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items", { hasText: exact("Login Code") })
        .locator("label")
        .click();
      const [req] = await Promise.all([page.waitForRequest(isDownload), exportBtn(page).click()]);
      const payload = JSON.parse(bodyOf(req).payload);
      expect(payload.filters.fields).not.toContain("Login Code");
      expect(payload.filters.fields).toContain("Master Agent");
      await page.keyboard.press("Escape");
    });
  });

  // ===== 12. Ghi nhớ filter =====
  test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
    await selectFilter(page, "status", "Active");
    await search(page);
    await pageSizeSelect(page).click();
    await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

    await openPage(page); // reload
    expect(await selectedFilter(page, "status")).toEqual(["Active"]);
    await expect(pageSizeSelect(page)).toContainText("20 / page");
  });
});

// ---------------------------------------------------------------------------
// Tests: màn hình View / Update / Create (chỉ đọc; request ghi bị chặn hoặc GIẢ)
// ---------------------------------------------------------------------------
test.describe("Master Agents > View / Update / Create (không ghi dữ liệu thật)", () => {
  let writes;
  let allowedWrites;

  // Ô thông tin của màn hình View / Review (antd Descriptions): theo nhãn
  const descValue = (page, label) =>
    page
      .locator(".ant-descriptions-item-container")
      .filter({ has: page.locator(".ant-descriptions-item-label", { hasText: exact(label) }) })
      .locator(".ant-descriptions-item-content");
  // Ô form của màn hình Create / Update: theo nhãn (có form-item lồng nhau nên lấy .first())
  const field = (page, label) =>
    page.locator(".ant-form-item").filter({ has: page.locator(".ant-form-item-label label", { hasText: label }) }).first();
  const fieldErrors = (page, label) => field(page, label).locator(".ant-form-item-explain-error:visible");
  const nextBtn = (page) => page.getByRole("button", { name: "Next", exact: true });
  const prevBtn = (page) => page.getByRole("button", { name: "Previous", exact: true });
  const cancelBtn = (page) => page.getByRole("button", { name: "Cancel", exact: true });
  const submitBtn = (page) => page.getByRole("button", { name: "Submit", exact: true });
  const stepClasses = (page) =>
    page.locator(".ant-steps-item").evaluateAll((els) => els.map((e) => (e.className.match(/ant-steps-item-(wait|process|finish)/) || [])[1]));
  const nameInput = (page) => page.getByPlaceholder("Enter the master agent name");
  const codeInput = (page) => page.getByPlaceholder("Enter master agent code");
  const houseSelect = (page) => field(page, "House").locator(".ant-select").first();
  const currencySelect = (page) => field(page, "Currencies").locator(".ant-select").first();
  const categorySelect = (page) => field(page, "Game Category").locator(".ant-select").first();
  const words = (s) => norm(s).split(" ").filter(Boolean);

  test.beforeEach(async ({ page }) => {
    await clearSavedState()(page);
    writes = watchWrites(page);
    allowedWrites = [];
    await blockWrites(page);
  });
  test.afterEach(async () => {
    expect(writes, "Request ghi dữ liệu bắt được phải đúng danh sách được phép").toEqual(allowedWrites);
  });

  // Mở danh sách rồi bấm icon ở dòng đầu để vào màn hình con (id lấy từ dòng, không hard-code). Trả về MA của dòng đầu + response masteragent/view.
  async function openChild(page, iconIndex) {
    const listPromise = page.waitForResponse(isList, { timeout: 60000 });
    listPromise.catch(() => {});
    await openPage(page);
    const json = await (await listPromise).json();
    test.skip(json.data.list.length === 0, "Không có dữ liệu");
    const x = json.data.list[0];
    const [viewRes] = await Promise.all([page.waitForResponse(isView), actionIcon(page, 0, iconIndex).click()]);
    return { x, view: (await viewRes.json()).data };
  }

  // ===== View =====
  test.describe("View Master Agent", () => {
    test("Có tiêu đề 'Master Agent Details', 2 mục Basic Information / Backoffice Geofencing và bảng IP Address / Country / Remark", async ({ page }) => {
      await openChild(page, 0);
      await expect(breadcrumb(page)).toContainText("Master Agent Details");
      await expect(page.locator("a.scroll-progress-anchor")).toHaveText(["Basic Information", "Backoffice Geofencing"]);
      await expect(page.locator("th", { hasText: exact("IP Address") })).toBeVisible();
      await expect(page.locator("th", { hasText: exact("Country") })).toBeVisible();
      await expect(page.locator("th", { hasText: exact("Remark") })).toBeVisible();
    });

    test("Thông tin hiển thị khớp response masteragent/view và dòng trong danh sách", async ({ page }) => {
      const { x, view } = await openChild(page, 0);
      expect(view.id).toBe(x.id);
      await expect(descValue(page, "House Name")).toHaveText(norm(x.house.name));
      await expect(descValue(page, "Master Agent Name")).toHaveText(norm(x.name));
      await expect(descValue(page, "Master Agent Code")).toHaveText(norm(x.code));
      await expect(descValue(page, "Status")).toHaveText(statusOf(x));
      const tz = view.timezone;
      await expect(descValue(page, "Timezone")).toHaveText(`(${tz.gmtOffset}) ${tz.timezone}, ${tz.countryName}`);
    });

    test("Currency / Game Category khớp response masteragent/view", async ({ page }) => {
      const { view } = await openChild(page, 0);
      await expect(descValue(page, "Currency")).toBeVisible();
      const cur = words(await descValue(page, "Currency").innerText());
      expect([...cur].sort()).toEqual(view.currencies.map((c) => c.code).sort());
      // View hiển thị code của category (vd SLOTS), danh sách / Review hiển thị tên
      const cat = norm(await descValue(page, "Game Category").innerText()).toLowerCase();
      for (const c of view.gameCategoryList) expect(cat).toContain(c.code.toLowerCase());
    });

    test("Chỉ đọc: màn hình View không có nút lưu", async ({ page }) => {
      await openChild(page, 0);
      await expect(submitBtn(page)).toHaveCount(0);
      await expect(nextBtn(page)).toHaveCount(0);
    });
  });

  // ===== Update =====
  test.describe("Update Master Agent (không bấm Submit thật)", () => {
    test("Có tiêu đề 'Update Master Agent', wizard 3 bước, bước 1 đang chọn", async ({ page }) => {
      await openChild(page, 1);
      await expect(breadcrumb(page)).toContainText("Update Master Agent");
      await expect(page.locator(".ant-steps-item-title")).toHaveText(["Basic Information", "Backoffice Geofencing", "Review & Submit"]);
      expect(await stepClasses(page)).toEqual(["process", "wait", "wait"]);
      await expect(cancelBtn(page)).toBeVisible();
      await expect(nextBtn(page)).toBeVisible();
    });

    test("Form hiển thị đúng dữ liệu master agent (house, tên, code, Backoffice URL, timezone, status)", async ({ page }) => {
      const { x, view } = await openChild(page, 1);
      await expect(nameInput(page)).toHaveValue(x.name);
      await expect(page.locator("#entityCode")).toHaveValue(x.code);
      await expect(page.locator("#subDomain")).toHaveValue(x.backofficeUrl);
      await expect(field(page, "House").locator(".ant-select-selection-item")).toHaveText(`${x.house.code} - ${x.house.name}`);
      const tz = view.timezone;
      await expect(field(page, "Timezone").locator(".ant-select-selection-item")).toHaveText(`(${tz.gmtOffset}) ${tz.timezone}, ${tz.countryName}`);
      await expect(page.locator(`input[type="radio"][value="${x.status}"]`)).toBeChecked();
    });

    test("House, Code và Backoffice URL bị khoá (không sửa được), Name sửa được", async ({ page }) => {
      await openChild(page, 1);
      await expect(page.locator("#houseId")).toBeDisabled();
      await expect(page.locator("#entityCode")).toBeDisabled();
      await expect(page.locator("#subDomain")).toBeDisabled();
      await expect(nameInput(page)).toBeEnabled();
    });

    test("Name bắt buộc: xoá trống rồi Next thì báo lỗi và ở lại bước 1", async ({ page }) => {
      await openChild(page, 1);
      await nameInput(page).fill("");
      await nextBtn(page).click();
      await expect(fieldErrors(page, "Name")).toHaveText([MSG.required]);
      expect(await stepClasses(page)).toEqual(["process", "wait", "wait"]);
    });

    test("Đi qua 3 bước bằng Next / Previous, bước Review hiển thị dữ liệu rồi Cancel về danh sách", async ({ page }) => {
      const { x, view } = await openChild(page, 1);
      await nextBtn(page).click();
      await expect(page.getByText("Geofencing Settings")).toBeVisible();
      expect(await stepClasses(page)).toEqual(["finish", "process", "wait"]);
      await nextBtn(page).click();
      expect(await stepClasses(page)).toEqual(["finish", "finish", "process"]);
      await expect(descValue(page, "Master Agent Name")).toHaveText(norm(x.name));
      await expect(descValue(page, "Master Agent Code")).toHaveText(norm(x.code));
      await expect(descValue(page, "Status")).toHaveText(statusOf(x));
      const cur = words(await descValue(page, "Currency").innerText());
      expect([...cur].sort()).toEqual(view.currencies.map((c) => c.code).sort());
      await expect(submitBtn(page)).toBeVisible(); // KHÔNG bấm Submit thật
      await prevBtn(page).click();
      expect(await stepClasses(page)).toEqual(["finish", "process", "wait"]);
      await prevBtn(page).click();
      await expect(nameInput(page)).toHaveValue(x.name);
      await cancelBtn(page).click();
      await expect(page).toHaveURL(/\/master-agent\/entity$/);
    });

    test("Submit ở bước Review (response GIẢ): gửi masteragent/update đúng dữ liệu hiện có rồi quay về danh sách", async ({ page }) => {
      const { x, view } = await openChild(page, 1);
      await mockWrites(page, MOCK_OK);
      await nextBtn(page).click();
      await nextBtn(page).click();
      const [req] = await Promise.all([page.waitForRequest(isUpdate), submitBtn(page).click()]);
      const body = bodyOf(req);
      allowedWrites.push({ url: "masteragent/update", body });
      expect(body).toMatchObject({
        id: String(x.id),
        name: x.name,
        entityCode: x.code,
        status: x.status,
        timezoneId: view.timezone.id,
        sasEntityHierarchyId: expect.any(Number),
      });
      expect([...body.currencyIds].sort((a, b) => a - b)).toEqual(view.currencies.map((c) => c.id).sort((a, b) => a - b));
      expect([...body.gameCategoryIds].sort((a, b) => a - b)).toEqual(view.gameCategoryList.map((c) => c.id).sort((a, b) => a - b));
      await expect(toasts(page).first()).toBeVisible();
      await expect(page).toHaveURL(/\/master-agent\/entity$/);
    });
  });

  // ===== Create =====
  test.describe("Create Master Agent (không ghi dữ liệu thật)", () => {
    const CREATE_URL = "/master-agent/entity/create";
    const heading = (page) => page.getByText("Create Master Agent", { exact: true });
    // Chọn house trong form: text = "code - tên" (không truyền -> option đầu tiên). Trả về text house đã chọn.
    async function pickHouse(page, text) {
      await houseSelect(page).click();
      const opt = text ? openOptions(page).filter({ hasText: exact(text) }).first() : openOptions(page).first();
      await opt.waitFor();
      const picked = norm((await opt.getAttribute("title")) ?? (await opt.innerText()));
      await opt.click();
      await expect(field(page, "House").locator(".ant-select-selection-item")).toHaveText(picked);
      return picked;
    }
    // Điền bước 1 hợp lệ: house, name, code, 1 currency, 1 category. Trả về { house, name, code, currency, category }
    async function fillStep1(page, tag = "QA-AUTO") {
      const stamp = Date.now();
      const name = `${tag}-${stamp}`;
      const code = `qaauto${stamp}`;
      const house = await pickHouse(page);
      await expect(nameInput(page)).toBeEnabled();
      await nameInput(page).fill(name);
      await codeInput(page).fill(code);
      await currencySelect(page).click();
      const cur = openOptions(page).filter({ hasNotText: exact("Select All") }).first();
      await cur.waitFor();
      const currency = norm(await cur.innerText());
      await cur.click();
      await heading(page).click(); // click ra ngoài để đóng dropdown
      await expect(openOptions(page)).toHaveCount(0);
      await categorySelect(page).click();
      const cat = openOptions(page).filter({ hasNotText: exact("Select All") }).first();
      await cat.waitFor();
      const category = norm(await cat.innerText());
      await cat.click();
      await heading(page).click();
      await expect(openOptions(page)).toHaveCount(0);
      return { house, name, code, currency, category };
    }

    test.beforeEach(async ({ page }) => {
      await page.goto(CREATE_URL);
      await expect(breadcrumb(page)).toContainText("Create Master Agent");
      await expect(houseSelect(page)).toBeVisible();
    });

    test("Wizard 3 bước, bước 1 đang chọn; có nút Cancel / Next", async ({ page }) => {
      await expect(page.locator(".ant-steps-item-title")).toHaveText(["Basic Information", "Backoffice Geofencing", "Review & Submit"]);
      expect(await stepClasses(page)).toEqual(["process", "wait", "wait"]);
      await expect(cancelBtn(page)).toBeVisible();
      await expect(nextBtn(page)).toBeVisible();
    });

    test("Giá trị mặc định: House / Name / Code trống, Status Active; Name / Code / Backoffice URL bị khoá tới khi chọn House", async ({ page }) => {
      await expect(field(page, "House").locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(nameInput(page)).toHaveValue("");
      await expect(codeInput(page)).toHaveValue("");
      await expect(nameInput(page)).toBeDisabled();
      await expect(codeInput(page)).toBeDisabled();
      await expect(page.locator("#subDomain")).toBeDisabled();
      await expect(page.locator('input[type="radio"][value="1"]')).toBeChecked();
    });

    test("Chọn House: gọi house/supportedcurrency + house/supportedcategories theo houseId và mở khoá Name / Code", async ({ page }) => {
      const [curReq, catReq] = await Promise.all([
        page.waitForRequest(endsWith("/house/supportedcurrency")),
        page.waitForRequest(endsWith("/house/supportedcategories")),
        pickHouse(page),
      ]);
      expect(bodyOf(curReq)).toEqual({ houseId: expect.any(Number) });
      expect(bodyOf(catReq)).toEqual(bodyOf(curReq));
      await expect(nameInput(page)).toBeEnabled();
      await expect(codeInput(page)).toBeEnabled();
      await expect(field(page, "House").locator(".ant-select-selection-item")).toHaveText(/^\S+ - .+/);
    });

    test("Timezone mặc định Singapore", async ({ page }) => {
      await expect(field(page, "Timezone").locator(".ant-select-selection-item")).toHaveText("(GMT +08:00) Asia/Singapore, Singapore");
    });

    test("Để trống rồi Next: báo lỗi từng trường bắt buộc và ở lại bước 1", async ({ page }) => {
      await nextBtn(page).click();
      await expect(fieldErrors(page, "House").first()).toHaveText(MSG.house);
      await expect(fieldErrors(page, "Name").first()).toHaveText(MSG.required);
      await expect(fieldErrors(page, "Code").first()).toHaveText(MSG.required);
      await expect(fieldErrors(page, "Currencies").first()).toHaveText(MSG.currencies);
      await expect(fieldErrors(page, "Game Category").first()).toHaveText(MSG.category);
      expect(await stepClasses(page)).toEqual(["process", "wait", "wait"]);
    });

    test("Backoffice URL tự cập nhật theo Code đang gõ", async ({ page }) => {
      await pickHouse(page);
      await codeInput(page).fill("qaautourlcheck");
      await expect(page.locator("#subDomain")).toHaveValue(/\/qaautourlcheck$/);
    });

    test("Nhập Name / Code trùng master agent có sẵn trong cùng house: gọi validate và báo lỗi trùng", async ({ page }) => {
      // Lấy name / code / house của 1 master agent có sẵn từ danh sách (không hard-code)
      const listRes = page.waitForResponse(isList, { timeout: 60000 });
      await page.goto(URL);
      const list = (await (await listRes).json()).data.list;
      test.skip(list.length === 0, "Không có master agent nào");
      const x = list[0];
      await page.goto(CREATE_URL);
      await houseSelect(page).click();
      const opt = openOptions(page).filter({ hasText: exact(`${x.house.code} - ${x.house.name}`) }).first();
      test.skip((await opt.count()) === 0, "House của master agent đầu không nằm trong các option đầu của dropdown");
      await opt.click();
      await nameInput(page).fill(x.name);
      await codeInput(page).fill(x.code);
      const [nameRes, codeRes] = await Promise.all([
        page.waitForResponse(endsWith("/validate/entityname")),
        page.waitForResponse(endsWith("/validate/entitycode")),
        nextBtn(page).click(),
      ]);
      expect((await nameRes.json()).messageCode).toBe("DUPLICATE_NAME");
      expect((await codeRes.json()).messageCode).toBe("DUPLICATE_ENTITY_CODE");
      await expect(fieldErrors(page, "Name").first()).toHaveText(MSG.dupName);
      await expect(fieldErrors(page, "Code").first()).toHaveText(MSG.dupCode);
    });

    test("Dropdown Currencies có 'Select All' và các currency; chọn 1 currency được", async ({ page }) => {
      await pickHouse(page);
      await currencySelect(page).click();
      await openOptions(page).first().waitFor();
      const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      expect(titles[0]).toBe("Select All");
      expect(titles.length).toBeGreaterThan(1);
      await openOptions(page).filter({ hasNotText: exact("Select All") }).first().click();
      await heading(page).click();
      await expect(fieldErrors(page, "Currencies")).toHaveCount(0);
    });

    test("Dropdown Game Category có 'Select All' và các category", async ({ page }) => {
      await pickHouse(page);
      await categorySelect(page).click();
      await openOptions(page).first().waitFor();
      const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      expect(titles[0]).toBe("Select All");
      expect(titles.length).toBeGreaterThan(1);
      await heading(page).click();
    });

    test("Bước 2 Backoffice Geofencing: có Whitelist; hộp thoại 'Add Whitelist' đóng được bằng Cancel", async ({ page }) => {
      await fillStep1(page);
      await nextBtn(page).click();
      await expect(page.getByText("Geofencing Settings")).toBeVisible();
      expect(await stepClasses(page)).toEqual(["finish", "process", "wait"]);
      await page.getByRole("button", { name: "Whitelist" }).click();
      await expect(dialog(page)).toContainText("Add Whitelist");
      await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
      await expect(dialog(page)).toBeHidden();
    });

    test("Bước 3 Review hiển thị đúng dữ liệu đã nhập; Previous quay lại giữ nguyên dữ liệu", async ({ page }) => {
      const v = await fillStep1(page);
      await nextBtn(page).click();
      await nextBtn(page).click();
      expect(await stepClasses(page)).toEqual(["finish", "finish", "process"]);
      await expect(descValue(page, "House Name")).toHaveText(v.house);
      await expect(descValue(page, "Master Agent Name")).toHaveText(v.name);
      await expect(descValue(page, "Master Agent Code")).toHaveText(v.code);
      await expect(descValue(page, "Status")).toHaveText("Active");
      await expect(descValue(page, "Currency")).toContainText(v.currency);
      await expect(descValue(page, "Game Category")).toContainText(v.category);
      await prevBtn(page).click();
      await prevBtn(page).click();
      await expect(nameInput(page)).toHaveValue(v.name);
      await expect(codeInput(page)).toHaveValue(v.code);
    });

    test("Submit (response GIẢ): gửi masteragent/create đúng payload, có toast và quay về danh sách", async ({ page }) => {
      await mockWrites(page, MOCK_OK);
      const v = await fillStep1(page);
      await nextBtn(page).click();
      await nextBtn(page).click();
      const [req] = await Promise.all([page.waitForRequest(isCreate), submitBtn(page).click()]);
      const body = bodyOf(req);
      allowedWrites.push({ url: "masteragent/create", body });
      expect(body).toMatchObject({
        name: v.name,
        entityCode: v.code,
        status: 1,
        timezoneId: expect.any(Number),
        parentId: expect.any(Number),
        sasEntityHierarchyId: expect.any(Number),
        geofencing: { country: [], geofencingDelete: [], ipv4: [], ipv6: [] },
      });
      expect(body.subDomain).toMatch(new RegExp(`/${v.code}$`));
      expect(body.currencyIds).toHaveLength(1);
      expect(body.gameCategoryIds).toHaveLength(1);
      await expect(toasts(page).first()).toBeVisible();
      await expect(page).toHaveURL(/\/master-agent\/entity$/);
    });

    test("Cancel ở bước 1 quay về danh sách và không gửi request ghi", async ({ page }) => {
      await cancelBtn(page).click();
      await expect(page).toHaveURL(/\/master-agent\/entity$/);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: ghi dữ liệu THẬT (tạo master agent QA-AUTO, rồi dọn bằng Deactivate)
// ---------------------------------------------------------------------------
test.describe("Master Agents > Create Master Agent (ghi dữ liệu thật)", () => {
  test.describe.configure({ mode: "serial" });

  let writes;
  let created; // { id, name, code } của master agent QA-AUTO đã tạo

  test.beforeEach(async ({ page }) => {
    await clearSavedState()(page);
    writes = watchWrites(page);
  });

  // Mọi request ghi chỉ được là masteragent/create của MA QA-AUTO hoặc masteragent/update-status nhắm đúng MA QA-AUTO vừa tạo
  test.afterEach(async () => {
    for (const w of writes) {
      if (w.url === "masteragent/create") {
        expect(w.body.name, "masteragent/create chỉ được tạo master agent QA-AUTO").toMatch(/^QA-AUTO-\d+$/);
      } else {
        expect(w.url).toBe("masteragent/update-status");
        expect(created, "masteragent/update-status chỉ được nhắm vào master agent QA-AUTO đã tạo").toBeTruthy();
        expect(w.body.ids).toEqual([created.id]);
      }
    }
  });

  // Dọn: nếu master agent QA-AUTO còn Active thì Deactivate bằng UI (màn hình không có Delete)
  test.afterAll(async ({ browser }) => {
    if (!created) return;
    const ctx = await browser.newContext({ viewport: VIEWPORT, storageState: buildStorageState() });
    const page = await ctx.newPage();
    try {
      const first = page.waitForResponse(isList, { timeout: 60000 });
      await page.goto(URL);
      const json = await (await first).json();
      const x = json.data.list.find((r) => r.id === created.id);
      if (x && x.status === 1) {
        await openRowMenu(page, json.data.list.indexOf(x));
        await menuItems(page).filter({ hasText: exact("Deactivate") }).click();
        await Promise.all([
          page.waitForRequest(isUpdateStatus),
          dialog(page).getByRole("button", { name: /Deactivate$/ }).click(),
        ]);
      }
    } finally {
      await ctx.close();
    }
  });

  test("Tạo master agent QA-AUTO bằng UI: masteragent/create thành công, toast, xuất hiện đầu danh sách (Active) rồi dọn bằng Deactivate", async ({ page }) => {
    test.setTimeout(120000);
    const stamp = Date.now();
    const name = `QA-AUTO-${stamp}`;
    const code = `qaauto${stamp}`;
    const field = (label) =>
      page.locator(".ant-form-item").filter({ has: page.locator(".ant-form-item-label label", { hasText: label }) }).first();
    const heading = page.getByText("Create Master Agent", { exact: true });
    await page.goto("/master-agent/entity/create");
    // House: option đầu tiên của dropdown
    await field("House").locator(".ant-select").first().click();
    const houseOpt = openOptions(page).first();
    await houseOpt.waitFor();
    const houseTitle = norm(await houseOpt.getAttribute("title"));
    await houseOpt.click();
    await page.getByPlaceholder("Enter the master agent name").fill(name);
    await page.getByPlaceholder("Enter master agent code").fill(code);
    await field("Currencies").locator(".ant-select").first().click();
    const curOpt = openOptions(page).filter({ hasNotText: exact("Select All") }).first();
    await curOpt.waitFor();
    const currency = norm(await curOpt.innerText());
    await curOpt.click();
    await heading.click();
    await field("Game Category").locator(".ant-select").first().click();
    const catOpt = openOptions(page).filter({ hasNotText: exact("Select All") }).first();
    await catOpt.waitFor();
    const category = norm(await catOpt.innerText());
    await catOpt.click();
    await heading.click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    const [req, res] = await Promise.all([
      page.waitForRequest(isCreate),
      page.waitForResponse(isCreate),
      page.getByRole("button", { name: "Submit", exact: true }).click(),
    ]);
    expect(bodyOf(req)).toMatchObject({ name, entityCode: code, status: 1 });
    const json = await res.json();
    expect(json.status, `masteragent/create trả ${json.messageCode}: ${json.message}`).toBe("success");
    await expect(page).toHaveURL(/\/master-agent\/entity$/);
    await expect(toasts(page).filter({ hasText: /Success/ }).first()).toBeVisible();

    // MA mới nằm đầu danh sách (sort id giảm dần), Active, đúng house / currency / category
    await expect(table(page).locator("tbody tr.ant-table-row").first()).toContainText(name);
    created = { id: Number(norm(await cellAt(page, 0, COL.id).innerText())), name, code };
    await expect(cellAt(page, 0, COL.code)).toHaveText(code);
    await expect(cellAt(page, 0, COL.status)).toHaveText("Active");
    await expect(cellAt(page, 0, COL.house)).toHaveText(houseTitle.replace(/^.*? - /, ""));
    expect(await chipsOf(page, 0, COL.currency)).toEqual([currency]);
    expect(await chipsOf(page, 0, COL.category)).toEqual([category]);

    // Dọn: Deactivate master agent QA-AUTO vừa tạo (ghi thật nhưng chỉ lên MA do test tạo)
    await openRowMenu(page, 0);
    await menuItems(page).filter({ hasText: exact("Deactivate") }).click();
    await expect(dialog(page)).toContainText(`Deactivate ${name}`);
    const [upd] = await Promise.all([
      page.waitForRequest(isUpdateStatus),
      dialog(page).getByRole("button", { name: /Deactivate$/ }).click(),
    ]);
    expect(bodyOf(upd)).toEqual({ ids: [created.id], status: 0 });
    await expect(toasts(page).first()).toBeVisible();
    await expect(cellAt(page, 0, COL.status)).toHaveText("Inactive");
  });
});
