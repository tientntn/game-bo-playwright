// Houses > Houses  (https://dev-bo.royaledge.io/house/entity)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/house_entity.spec.js --project=setup --project=chromium
//
// Màn hình quản lý House (đơn vị cao nhất dưới Admin): danh sách có phân trang + Export + Manage Columns.
//  - API list: house/list {page,pageSize,sortBy,sortDirection,filters:{houseIds,currencyIds,gameCategoryIds,status}}
//    (filter Status chọn 1 giá trị gửi số 1 / 0; 3 filter còn lại chọn nhiều, gửi mảng id).
//  - Cột Currency chỉ hiện 6 mã đầu + chip "+ N ..." (N = số còn lại); Login Code / Currency / Game Category không sort được.
//  - Cột Action: View (/house/entity/view/{id}), Update (/house/entity/update/{id}) và menu "..." gồm Activate / Deactivate,
//    Create House User (/house/users/create), Create House Role (/house/roles/create). Bấm tên House -> /master-agent/entity
//    (danh sách Master Agent đã lọc theo House).
//  - Add New -> /house/entity/create: wizard 3 bước (Basic Information -> Backoffice Geofencing -> Review & Submit),
//    Submit gọi house/create; Update là wizard tương tự (house/update).
//  - Activate / Deactivate (từng dòng + hàng loạt) gọi house/update-status {ids,status}.
//
// AN TOÀN DỮ LIỆU:
//  - Mọi describe trừ describe cuối là CHỈ ĐỌC: request ghi (house/create, house/update, house/update-status...) bị chặn ở tầng mạng
//    (route.abort) hoặc được trả về response GIẢ (route.fulfill, request KHÔNG tới server) để kiểm tra payload / toast. Mỗi test khai báo
//    request ghi được phép (allowedWrites) và afterEach so sánh chính xác với request ghi bắt được (watchWrites). House có sẵn của team
//    (vd "ZZ Audit House Upd") chỉ bị thao tác bằng request GIẢ, KHÔNG bao giờ bị ghi thật. Không bao giờ bấm Submit ở màn hình Update.
//  - Describe cuối "Create House (ghi dữ liệu thật)": tạo 1 house tên "QA-AUTO-<timestamp>" bằng UI rồi DỌN bằng cách Deactivate
//    (màn hình không có Delete nên không xoá được; house QA-AUTO để lại ở trạng thái Inactive). afterEach kiểm tra mọi request ghi chỉ là
//    house/create đúng payload và house/update-status chỉ nhắm vào id house QA-AUTO vừa tạo.
//    Test kiểm tra house/create trả success (hành vi đúng mong đợi).
//    Describe này gắn cờ RUN_FULL_TESTS (xem RUN_FULL_TESTS.md): RUN_FULL_TESTS=false (mặc định) -> skipped, KHÔNG tạo house nào;
//    RUN_FULL_TESTS=true trong .env -> mới tạo house QA-AUTO thật.
//  - Export tạo bản ghi ở Download History; nếu file cùng filter đã tồn tại thì hộp thoại "Download Now / Download New" hiện ra và
//    test KHÔNG bấm Download New (tránh xoá file cũ).
//  - Không hard-code dữ liệu: house / currency / game category / id đều lấy từ response list và dropdown; id màn hình con lấy từ icon ở dòng.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");
const { RUN_FULL_TESTS, SKIP_WRITE_REASON } = require("./helpers/flags");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/house/entity";
const ORIGIN = "https://dev-bo.royaledge.io";

// Đúng thứ tự hiển thị (cột đầu tiên là checkbox chọn dòng, không có tên)
const COLUMNS = ["ID", "House", "Code", "Login Code", "Currency", "Game Category", "Status", "Action"];
const HEADERS = ["", ...COLUMNS];
const COL = { check: 0, id: 1, name: 2, code: 3, login: 4, currency: 5, category: 6, status: 7, action: 8 };
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
const DEFAULT_BODY = { page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: {} };
// Cột sort được -> sortBy gửi lên API (mặc định id giảm dần)
const SORTABLE = { House: "name", Code: "code", Status: "status" };
const STATUS_TEXT = { 0: "Inactive", 1: "Active" };
const MAX_CURRENCY_CHIPS = 6; // số mã currency hiện trong ô; phần còn lại gom thành "+ N ..."

const MSG = {
  noEntries: "There are no entries found",
  statusUpdated: "Status Updated",
  required: "This field is required",
  currencies: "Please select at least 1 currencies",
  category: "Please select at least 1 Game Category",
  dupName: "Name is already existed",
  dupCode: "Entity code is already existed",
};

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI
// (validate/entityname, validate/entitycode chỉ kiểm tra trùng, không lưu gì)
const READ = /\/(list|details|download|view)(\?|$)|\/dropdown\/|_dropdown(\?|$)|\/validate\//;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/house/list");
const isView = endsWith("/house/view");
const isDownload = endsWith("/download");
const isUpdateStatus = endsWith("/house/update-status");
const isCreate = endsWith("/house/create");
const isHouseDropdown = endsWith("/dropdown/house");
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

// Bấm Reset và gom MỌI request list gửi đi cho tới khi mạng yên (request cuối = trạng thái bảng cuối cùng)
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

// Chip (ant-tag) của 1 ô trong bảng
const chipsOf = (page, i, col) => cellAt(page, i, col).locator(".ant-tag").allInnerTexts().then((a) => a.map(norm));

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

// Bản ghi trả về của dòng i trong response list (theo thứ tự hiển thị)
const statusOf = (x) => STATUS_TEXT[x.status];

// ---------------------------------------------------------------------------
// Tests: danh sách (chỉ đọc)
// ---------------------------------------------------------------------------
test.describe("Houses > Houses (danh sách)", () => {
  let writes;
  let allowedWrites; // request ghi được phép (chỉ các test dùng response giả; request KHÔNG tới server thật)
  let housesLoaded; // promise của response dropdown/house lúc mở trang
  let currenciesLoaded;
  let categoriesLoaded;
  const houses = async () => (await (await housesLoaded).json()).data; // [{ value, code, label, sasEntityId }]
  const currencies = async () => (await (await currenciesLoaded).json()).data; // [{ value, code, label }]
  const categories = async () => (await (await categoriesLoaded).json()).data; // [{ value, code, label }]
  const houseText = (h) => `${h.code} - ${h.label}`;

  test.beforeEach(async ({ page }) => {
    // Bộ lọc / số dòng mỗi trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__house_entity_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/house_entity_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__house_entity_spec_cleared", "1");
    });
    writes = watchWrites(page);
    allowedWrites = [];
    housesLoaded = page.waitForResponse(isHouseDropdown, { timeout: 60000 });
    currenciesLoaded = page.waitForResponse(isCurrencyDropdown, { timeout: 60000 });
    categoriesLoaded = page.waitForResponse(isCategoryDropdown, { timeout: 60000 });
    for (const p of [housesLoaded, currenciesLoaded, categoriesLoaded]) p.catch(() => {});
    await blockWrites(page);
    await openPage(page);
  });

  // Mọi test không được gửi request ghi nào ngoài danh sách được phép (và request được phép cũng không tới server thật)
  test.afterEach(async () => {
    expect(writes, "Request ghi dữ liệu bắt được phải đúng danh sách được phép").toEqual(allowedWrites);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề 'Houses', đủ 4 filter House / Currency / Game Category / Status và 2 nút Search/Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Houses");
      await expect(page.locator(".NextGen-filter-element")).toHaveCount(4);
      await expect(filterEl(page, "houseIds")).toContainText("House");
      await expect(filterEl(page, "currencyIds")).toContainText("Currency");
      await expect(filterEl(page, "gameCategoryIds")).toContainText("Game Category");
      await expect(filterEl(page, "status")).toContainText("Status");
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: tất cả để trống", async ({ page }) => {
      await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
    });

    test("House / Currency / Game Category chọn nhiều, Status chọn 1 giá trị", async ({ page }) => {
      for (const id of ["houseIds", "currencyIds", "gameCategoryIds"]) {
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
    test("Mỗi dòng khớp response API (ID, House, Code, Login Code, Status)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      await expect(rows(page)).toHaveCount(list.length);
      for (const [i, x] of list.entries()) {
        const at = `dòng ${i + 1} (house ${x.id})`;
        expect(norm(await cellAt(page, i, COL.id).innerText()), at).toBe(String(x.id));
        expect(norm(await cellAt(page, i, COL.name).innerText()), at).toBe(norm(x.name));
        expect(norm(await cellAt(page, i, COL.code).innerText()), at).toBe(norm(x.code));
        expect(norm(await cellAt(page, i, COL.login).innerText()), at).toBe(norm(x.loginCode));
        expect(norm(await cellAt(page, i, COL.status).innerText()), at).toBe(statusOf(x));
      }
    });

    test("Cột Currency hiện tối đa 6 mã đầu, phần còn lại gom thành chip '+ N ...'", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const [i, x] of json.data.list.entries()) {
        const at = `dòng ${i + 1} (house ${x.id}, ${x.currencies.length} currency)`;
        const chips = await chipsOf(page, i, COL.currency);
        const shown = x.currencies.slice(0, MAX_CURRENCY_CHIPS).map((c) => c.code);
        if (x.currencies.length > MAX_CURRENCY_CHIPS) {
          expect(chips, at).toEqual([...shown, `+ ${x.currencies.length - MAX_CURRENCY_CHIPS} ...`]);
        } else {
          expect(chips, at).toEqual(shown);
        }
      }
    });

    test("Cột Game Category hiện đúng danh sách category của house", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const [i, x] of json.data.list.entries()) {
        expect(await chipsOf(page, i, COL.category), `dòng ${i + 1} (house ${x.id})`).toEqual(x.gameCategories.map(norm));
      }
    });

    test("Tên House là link; ID / Code duy nhất; Status chỉ Active hoặc Inactive", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (let i = 0; i < json.data.list.length; i++) await expect(cellAt(page, i, COL.name).locator("a")).toHaveCount(1);
      const ids = json.data.list.map((x) => x.id);
      const codes = json.data.list.map((x) => x.code);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(codes).size).toBe(codes.length);
      for (const x of json.data.list) expect([0, 1]).toContain(x.status);
    });

    test("Mỗi dòng có icon View, Update (tooltip) và menu '...'", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await expect(rowAt(page, 0).locator(".column-actions svg")).toHaveCount(3);
      await hoverTip(page, actionIcon(page, 0, 0), "View");
      await hoverTip(page, actionIcon(page, 0, 1), "Update");
    });

    test("Menu '...' của dòng: Activate (đang Inactive) hoặc Deactivate (đang Active) + Create House User + Create House Role", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const i of [...new Set([0, json.data.list.findIndex((x) => x.status !== json.data.list[0].status)])].filter((v) => v >= 0)) {
        await openRowMenu(page, i);
        const toggle = json.data.list[i].status === 1 ? "Deactivate" : "Activate";
        expect((await menuItems(page).allInnerTexts()).map(norm), `dòng ${i + 1}`).toEqual([
          toggle,
          "Create House User",
          "Create House Role",
        ]);
        await closeRowMenu(page);
      }
    });
  });

  // ===== 3. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Dropdown House liệt kê đủ house của dropdown/house (dạng 'code - tên')", async ({ page }) => {
      const data = await houses();
      test.skip(data.length === 0, "Không có house nào");
      const titles = await dropdownTitles(page, "houseIds");
      expect([...titles].sort()).toEqual(data.map(houseText).sort());
    });

    test("Dropdown Currency liệt kê đủ currency của dropdown/currency", async ({ page }) => {
      const data = await currencies();
      test.skip(data.length === 0, "Không có currency nào");
      const titles = await dropdownTitles(page, "currencyIds");
      expect([...titles].sort()).toEqual(data.map((c) => c.label).sort());
    });

    test("Dropdown Game Category liệt kê đủ category của dropdown/gamecategory", async ({ page }) => {
      const data = await categories();
      test.skip(data.length === 0, "Không có category nào");
      const titles = await dropdownTitles(page, "gameCategoryIds");
      expect([...titles].sort()).toEqual(data.map((c) => c.label).sort());
    });

    test("Option cố định của Status: Active, Inactive", async ({ page }) => {
      expect(await dropdownTitles(page, "status")).toEqual(["Active", "Inactive"]);
    });

    test("Gõ vào ô tìm kiếm của filter House chỉ còn option khớp", async ({ page }) => {
      const data = await houses();
      test.skip(data.length === 0, "Không có house nào");
      const h = data[data.length - 1];
      await openDropdown(page, "houseIds");
      await page.keyboard.type(h.code);
      const expected = data.filter((v) => houseText(v).toLowerCase().includes(h.code.toLowerCase())).map(houseText);
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

    test("Chọn House: gửi filters.houseIds = [id] và chỉ còn đúng house đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const h = (await houses()).find((v) => v.code === x.code);
      test.skip(!h, "House của dòng đầu không có trong dropdown");

      await selectFilter(page, "houseIds", houseText(h));
      expect(await selectedFilter(page, "houseIds")).toEqual([houseText(h)]);
      const { body, json } = await search(page);
      expect(body).toMatchObject({ page: 1, pageSize: 10 });
      expect(body.filters).toEqual({ houseIds: [h.value] });
      expect(json.data.totalCount).toBe(1);
      expect(json.data.list.map((r) => r.id)).toEqual([x.id]);
      await expect(rows(page)).toHaveCount(1);
      await expect(cellAt(page, 0, COL.name)).toHaveText(norm(x.name));
      await expect(summary(page)).toHaveText("Showing 1 - 1 of 1 records");
    });

    test("Chọn nhiều House: gửi houseIds theo thứ tự chọn và chỉ còn các house đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length < 2, "Cần ít nhất 2 house");
      const dd = await houses();
      const picks = all.data.list.slice(0, 2).map((x) => dd.find((v) => v.code === x.code));
      test.skip(picks.some((p) => !p), "House không có trong dropdown");

      for (const h of picks) await selectFilter(page, "houseIds", houseText(h));
      expect(await selectedFilter(page, "houseIds")).toEqual(picks.map(houseText));
      const { body, json } = await search(page);
      expect(body.filters).toEqual({ houseIds: picks.map((h) => h.value) });
      expect(json.data.totalCount).toBe(2);
      expect(json.data.list.map((r) => r.id).sort((a, b) => a - b)).toEqual(all.data.list.slice(0, 2).map((r) => r.id).sort((a, b) => a - b));
    });

    test("Chọn Currency: gửi filters.currencyIds = [id] và mọi house đều hỗ trợ currency đó", async ({ page }) => {
      const { json: all } = await search(page);
      const withCur = all.data.list.find((x) => x.currencies.length > 0);
      test.skip(!withCur, "Không có house nào có currency");
      const dd = await currencies();
      const code = withCur.currencies[0].code;
      const cur = dd.filter((c) => c.label === code);
      test.skip(cur.length !== 1, "Tên currency không xác định duy nhất trong dropdown");

      await selectFilter(page, "currencyIds", code);
      expect(await selectedFilter(page, "currencyIds")).toEqual([code]);
      const { body, json } = await search(page);
      expect(body.filters).toEqual({ currencyIds: [cur[0].value] });
      expect(json.data.totalCount).toBeGreaterThan(0);
      expect(json.data.list.map((r) => r.id)).toContain(withCur.id);
      for (const r of json.data.list) {
        expect(r.currencies.map((c) => c.code), `house ${r.id} (${r.name}) không có currency ${code}`).toContain(code);
      }
    });

    // LỖI BACKEND ĐÃ XÁC NHẬN (user xác nhận): house/list với filters.gameCategoryIds=[id] trả cả house KHÔNG có category đó
    // (vd chọn "Slots" trả về house "house name abc" chỉ có Poker / Test 06 / Test 073 name). Test kiểm tra đúng hành vi mong đợi
    // (mọi house trả về phải có category đã chọn) nên sẽ FAIL cho tới khi backend sửa.
    test("Chọn Game Category: gửi filters.gameCategoryIds = [id] và mọi house đều có category đó", async ({ page }) => {
      const { json: all } = await search(page);
      const withCat = all.data.list.find((x) => x.gameCategories.length > 0);
      test.skip(!withCat, "Không có house nào có game category");
      const name = withCat.gameCategories[0];
      const cat = (await categories()).filter((c) => c.label === name);
      test.skip(cat.length !== 1, "Tên category không xác định duy nhất trong dropdown");

      await selectFilter(page, "gameCategoryIds", name);
      expect(await selectedFilter(page, "gameCategoryIds")).toEqual([name]);
      const { body, json } = await search(page);
      expect(body.filters).toEqual({ gameCategoryIds: [cat[0].value] });
      expect(json.data.list.map((r) => r.id)).toContain(withCat.id);
      for (const r of json.data.list) expect(r.gameCategories, `house ${r.id} (${r.name})`).toContain(name);
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

    test("Số house Active + Inactive bằng tổng số house", async ({ page }) => {
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

    test("Kết hợp House + Status khớp nhau (AND)", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const h = (await houses()).find((v) => v.code === x.code);
      test.skip(!h, "House của dòng đầu không có trong dropdown");
      await selectFilter(page, "houseIds", houseText(h));
      await selectFilter(page, "status", statusOf(x));
      const { body, json } = await search(page);
      expect(body.filters).toEqual({ houseIds: [h.value], status: x.status });
      expect(json.data.list.map((r) => r.id)).toEqual([x.id]);
    });

    test("House + Status không khớp nhau -> 'There are no entries found'", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const h = (await houses()).find((v) => v.code === x.code);
      test.skip(!h, "House của dòng đầu không có trong dropdown");
      const other = x.status === 1 ? "Inactive" : "Active";
      await selectFilter(page, "houseIds", houseText(h));
      await selectFilter(page, "status", other);
      const { body, json } = await search(page);
      expect(body.filters).toEqual({ houseIds: [h.value], status: 1 - x.status });
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
      const h = (await houses()).find((v) => v.code === all.data.list[0].code);
      test.skip(!h, "House của dòng đầu không có trong dropdown");
      await selectFilter(page, "houseIds", houseText(h));
      await selectFilter(page, "status", statusOf(all.data.list[0]));
      await search(page);

      const bodies = await resetBodies(page);
      expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual(DEFAULT_BODY);
      await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
      await expect(summary(page)).toHaveText(new RegExp(`of ${all.data.totalCount} records$`));
    });

    test("Reset đưa sort về mặc định (id giảm dần)", async ({ page }) => {
      await reloadBy(page, () => th(page, "House").click());
      const bodies = await resetBodies(page);
      expect(bodies.at(-1)).toEqual(DEFAULT_BODY);
    });

    // HÀNH VI ĐÚNG (đã được user xác nhận): Reset xoá filter nhưng giữ nguyên trang đang xem (request list gửi page=2).
    test("Reset khi đang ở trang 2: xoá filter nhưng giữ nguyên trang đang xem", async ({ page }) => {
      test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
      // Reset chỉ gọi lại API khi filter đang áp dụng khác mặc định -> áp dụng filter Active (Search) rồi sang trang 2 rồi mới Reset
      await selectFilter(page, "status", "Active");
      const { json } = await search(page);
      test.skip(json.data.totalCount <= 10, "Không đủ dữ liệu để sang trang 2");
      await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      const bodies = await resetBodies(page);
      expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toMatchObject({ page: 2, pageSize: 10, filters: {} });
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
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
      // Quan sát thực tế: đổi số dòng / trang giữ nguyên trang đang xem (vẫn page 2), chỉ đổi pageSize
      expect(size).toMatchObject({ page: 2, pageSize: 20, filters: { status: 1 } });
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
      await reloadBy(page, () => th(page, "House").click());
      await selectFilter(page, "status", "Active");
      const { body } = await search(page);
      expect(body).toMatchObject({ sortBy: "name", sortDirection: "asc", filters: { status: 1 } });
    });

    test("Chỉ ID, House, Code, Status sort được; Login Code / Currency / Game Category / Action không sort", async ({ page }) => {
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
      test(`${action} hàng loạt 1 house: hộp thoại tiêu đề '${action} <tên house>', đóng bằng Cancel`, async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await checkboxOf(page, 0).check();
        await bulkBtns(page).nth(i).click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toContainText(`${action} ${norm(json.data.list[0].name)}`);
        await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
        await expect(dialog(page).getByRole("button", { name: new RegExp(`${action}$`) })).toBeVisible();
        await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
        await expect(dialog(page)).toBeHidden();
        await expect(checkboxOf(page, 0)).toBeChecked(); // dòng vẫn đang được chọn
      });

      // Chỉ áp dụng cho flow BULK (tick checkbox rồi bấm nút Activate / Deactivate trên toolbar) khi chọn đúng 1 house.
      // Flow từng dòng (menu "...") đã đúng: "Are you sure you want to activate this <tên house> house?" (có test riêng bên dưới).
      // Quan sát khi khám phá (chưa kiểm chứng lại bằng spec): bulk Deactivate đúng ("deactivate this house?") nhưng bulk Activate hiện
      // "Are you sure you want to activate this user?" (nhầm "user"). Nếu bulk Activate cũng nói "house" thì test này pass và có thể bỏ ghi chú.
      test(`${action} hàng loạt 1 house: câu hỏi xác nhận nói đúng về 'house'`, async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        await checkboxOf(page, 0).check();
        await bulkBtns(page).nth(i).click();
        await expect(dialog(page)).toContainText(`Are you sure you want to ${action.toLowerCase()} this house?`);
        await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
      });

      test(`${action} hàng loạt nhiều house: hộp thoại ghi rõ số lượng, đóng bằng Cancel`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Cần ít nhất 2 house");
        await checkboxOf(page, 0).check();
        await checkboxOf(page, 1).check();
        await bulkBtns(page).nth(i).click();
        await expect(dialog(page)).toContainText(`${action} 2 houses`);
        await expect(dialog(page)).toContainText(`Are you sure you want to ${action.toLowerCase()} these 2 houses?`);
        await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
        await expect(dialog(page)).toBeHidden();
      });

      test(`${action} hàng loạt 2 house (xác nhận, response GIẢ): gửi house/update-status {ids,status}, toast '${MSG.statusUpdated}', tải lại danh sách`, async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length < 2, "Cần ít nhất 2 house");
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
        allowedWrites.push({ url: "house/update-status", body: { ids, status } });
        await expect(toasts(page).filter({ hasText: MSG.statusUpdated })).toBeVisible();
        await expect(dialog(page)).toBeHidden();
      });
    }
  });

  // ===== 8. Thao tác trên từng dòng (menu "...") =====
  test.describe("Menu '...' của dòng: Activate / Deactivate (response GIẢ)", () => {
    test("Activate / Deactivate từng dòng: hộp thoại xác nhận đúng nội dung, đóng bằng Cancel", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      const action = x.status === 1 ? "Deactivate" : "Activate";
      await openRowMenu(page, 0);
      await menuItems(page).filter({ hasText: exact(action) }).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText(`${action} ${norm(x.name)}`);
      await expect(dialog(page)).toContainText(`Are you sure you want to ${action.toLowerCase()} this ${norm(x.name)} house?`);
      await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
      await expect(dialog(page)).toBeHidden();
    });

    test("Xác nhận (response GIẢ): gửi house/update-status {ids:[id], status đảo}, toast '" + MSG.statusUpdated + "', tải lại danh sách", async ({ page }) => {
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
      allowedWrites.push({ url: "house/update-status", body: { ids: [x.id], status: 1 - x.status } });
      await expect(toasts(page).filter({ hasText: MSG.statusUpdated })).toBeVisible();
    });

    test("Backend báo lỗi (response GIẢ): có toast phản hồi và hộp thoại đóng", async ({ page }) => {
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
      allowedWrites.push({ url: "house/update-status", body: { ids: [x.id], status: 1 - x.status } });
      // Theo thiết kế (đã xác nhận): màn hình luôn hiện toast thành công "Status Updated" sau thao tác, kể cả khi
      // backend trả {status:"fail"} (HTTP 200). Không phải bug.
      await expect(toasts(page).filter({ hasText: MSG.statusUpdated })).toBeVisible();
      await expect(dialog(page)).toBeHidden();
    });
  });

  // ===== 9. Điều hướng từ danh sách =====
  test.describe("Điều hướng từ danh sách", () => {
    test("Bấm tên House -> /master-agent/entity với danh sách Master Agent đã lọc theo house đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      const [req] = await Promise.all([
        page.waitForRequest(endsWith("/masteragent/list")),
        cellAt(page, 0, COL.name).locator("a").click(),
      ]);
      await expect(page).toHaveURL(/\/master-agent\/entity$/);
      expect(bodyOf(req).filters).toMatchObject({ houseIds: [x.id], houseId: x.id, houseCode: x.code, houseName: x.name });
    });

    test("Icon View -> /house/entity/view/{id} và gọi house/view {id}", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      const [req] = await Promise.all([page.waitForRequest(isView), actionIcon(page, 0, 0).click()]);
      await expect(page).toHaveURL(new RegExp(`/house/entity/view/${x.id}$`));
      expect(bodyOf(req)).toEqual({ id: String(x.id) });
    });

    test("Icon Update -> /house/entity/update/{id} và gọi house/view {id}", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      const [req] = await Promise.all([page.waitForRequest(isView), actionIcon(page, 0, 1).click()]);
      await expect(page).toHaveURL(new RegExp(`/house/entity/update/${x.id}$`));
      expect(bodyOf(req)).toEqual({ id: String(x.id) });
    });

    test("Menu '...' > Create House User -> /house/users/create", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      await openRowMenu(page, 0);
      await menuItems(page).filter({ hasText: exact("Create House User") }).click();
      await expect(page).toHaveURL(/\/house\/users\/create$/);
    });

    test("Menu '...' > Create House Role -> /house/roles/create", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      await openRowMenu(page, 0);
      await menuItems(page).filter({ hasText: exact("Create House Role") }).click();
      await expect(page).toHaveURL(/\/house\/roles\/create$/);
    });

    test("Nút Add New -> /house/entity/create", async ({ page }) => {
      await addBtn(page).click();
      await expect(page).toHaveURL(/\/house\/entity\/create$/);
      await expect(breadcrumb(page)).toContainText("Create House");
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
      const before = await columnValues(page, "House");
      await columnBtn(page).click();
      await item(page, "Code").locator("label").click();
      expect(await columnValues(page, "House")).toEqual(before);
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

    test("Export tạo job tải xuống (module HOUSE, section HOUSE_LIST) gồm toàn bộ cột", async ({ page }) => {
      const { body, payload } = await exportAndCheck(page);
      expect(body.module).toBe("HOUSE");
      expect(body.section).toBe("HOUSE_LIST");
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
      expect(payload.filters.fields).toContain("House");
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
test.describe("Houses > View / Update / Create (không ghi dữ liệu thật)", () => {
  let writes;
  let allowedWrites;

  // Ô thông tin của màn hình View (antd Descriptions): theo nhãn
  const descValue = (page, label) =>
    page
      .locator(".ant-descriptions-item-container")
      .filter({ has: page.locator(".ant-descriptions-item-label", { hasText: exact(label) }) })
      .locator(".ant-descriptions-item-content");
  // Ô form của màn hình Create / Update: theo nhãn
  const field = (page, label) =>
    page.locator(".ant-form-item").filter({ has: page.locator(".ant-form-item-label label", { hasText: label }) }).first();
  const fieldErrors = (page, label) => field(page, label).locator(".ant-form-item-explain-error:visible");
  const nextBtn = (page) => page.getByRole("button", { name: "Next", exact: true });
  const prevBtn = (page) => page.getByRole("button", { name: "Previous", exact: true });
  const cancelBtn = (page) => page.getByRole("button", { name: "Cancel", exact: true });
  const submitBtn = (page) => page.getByRole("button", { name: "Submit", exact: true });
  const stepClasses = (page) =>
    page.locator(".ant-steps-item").evaluateAll((els) => els.map((e) => (e.className.match(/ant-steps-item-(wait|process|finish)/) || [])[1]));
  // Bấm Next rồi CHỜ wizard sang bước mới (Next ở bước 1 gọi validate name / code bất đồng bộ; bấm Next lần nữa quá sớm sẽ bị bỏ qua)
  const STEP2 = ["finish", "process", "wait"];
  const STEP3 = ["finish", "finish", "process"];
  async function goNext(page, expected) {
    await nextBtn(page).click();
    await expect.poll(() => stepClasses(page), { message: "wizard chưa sang bước mới" }).toEqual(expected);
  }
  const nameInput = (page) => page.getByPlaceholder("Enter the house name");
  const codeInput = (page) => page.getByPlaceholder("Enter the house code");
  const currencySelect = (page) => page.locator(".ant-select").filter({ has: page.locator("#currencyIds") });
  const categorySelect = (page) => field(page, "Game Category").locator(".ant-select");
  const dropdownChips = (page) => page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-tag");

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__house_entity_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/house_entity_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__house_entity_spec_cleared", "1");
    });
    writes = watchWrites(page);
    allowedWrites = [];
    await blockWrites(page);
  });
  test.afterEach(async () => {
    expect(writes, "Request ghi dữ liệu bắt được phải đúng danh sách được phép").toEqual(allowedWrites);
  });

  // Mở danh sách rồi bấm icon ở dòng đầu để vào màn hình con (id lấy từ dòng, không hard-code). Trả về house của dòng đầu + response house/view.
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
  test.describe("View House", () => {
    test("Có tiêu đề 'House Details', 2 mục Basic Information / Backoffice Geofencing và bảng IP Address / Country / Remark", async ({ page }) => {
      await openChild(page, 0);
      await expect(breadcrumb(page)).toContainText("House Details");
      await expect(page.locator("a.scroll-progress-anchor")).toHaveText(["Basic Information", "Backoffice Geofencing"]);
      await expect(page.getByText("BackOffice Geofencing Settings")).toBeVisible();
      await expect(page.locator("th", { hasText: exact("IP Address") })).toBeVisible();
      await expect(page.locator("th", { hasText: exact("Country") })).toBeVisible();
      await expect(page.locator("th", { hasText: exact("Remark") })).toBeVisible();
    });

    test("Thông tin hiển thị khớp response house/view và dòng trong danh sách", async ({ page }) => {
      const { x, view } = await openChild(page, 0);
      expect(view.id).toBe(x.id);
      await expect(descValue(page, "House Name")).toHaveText(norm(x.name));
      await expect(descValue(page, "House Code")).toHaveText(norm(x.code));
      await expect(descValue(page, "Login Code")).toHaveText(norm(x.loginCode));
      await expect(descValue(page, "Status")).toHaveText(statusOf(x));
      const tz = view.timezone;
      await expect(descValue(page, "Timezone")).toHaveText(`(${tz.gmtOffset}) ${tz.timezone}, ${tz.countryName}`);
    });

    test("Supported Currencies / Game Category khớp response house/view", async ({ page }) => {
      const { view } = await openChild(page, 0);
      const cur = (await descValue(page, "Supported Currencies").locator(".ant-tag").allInnerTexts()).map(norm);
      expect([...cur].sort()).toEqual(view.currencies.map((c) => c.code).sort());
      const cat = (await descValue(page, "Game Category").locator(".ant-tag").allInnerTexts()).map(norm);
      expect(cat.map((s) => s.toLowerCase()).sort()).toEqual(view.gameCategoryList.map((c) => c.code.toLowerCase()).sort());
    });

    test("Chỉ đọc: màn hình View không có nút lưu", async ({ page }) => {
      await openChild(page, 0);
      await expect(submitBtn(page)).toHaveCount(0);
      await expect(nextBtn(page)).toHaveCount(0);
    });
  });

  // ===== Update =====
  test.describe("Update House (không bấm Submit)", () => {
    test("Có tiêu đề 'Update House', wizard 3 bước, bước 1 đang chọn", async ({ page }) => {
      await openChild(page, 1);
      await expect(breadcrumb(page)).toContainText("Update House");
      await expect(page.locator(".ant-steps-item-title")).toHaveText(["Basic Information", "Backoffice Geofencing", "Review & Submit"]);
      expect(await stepClasses(page)).toEqual(["process", "wait", "wait"]);
      await expect(cancelBtn(page)).toBeVisible();
      await expect(nextBtn(page)).toBeVisible();
    });

    test("Form hiển thị đúng dữ liệu house (tên, code, Backoffice URL, status, currency, category)", async ({ page }) => {
      const { x, view } = await openChild(page, 1);
      await expect(nameInput(page)).toHaveValue(x.name);
      await expect(page.locator("#entityCode")).toHaveValue(x.code);
      await expect(page.locator("#subDomain")).toHaveValue(x.backofficeUrl);
      await expect(page.locator(`input[type="radio"][value="${x.status}"]`)).toBeChecked();
      // Chip hiện id số cho tới khi dropdown currency / category tải xong -> poll tới khi đổi thành mã / tên
      await expect
        .poll(async () => (await currencySelect(page).locator(".ant-select-selection-item").allInnerTexts()).map(norm).sort())
        .toEqual(view.currencies.map((c) => c.code).sort());
      await expect
        .poll(async () => (await categorySelect(page).locator(".ant-select-selection-overflow .ant-tag").allInnerTexts()).map(norm).sort())
        .toEqual(view.gameCategoryList.map((c) => c.name).sort());
    });

    test("Code và Backoffice URL bị khoá (không sửa được), Name sửa được", async ({ page }) => {
      await openChild(page, 1);
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
      const { x } = await openChild(page, 1);
      await goNext(page, STEP2);
      await expect(page.getByText("Geofencing Settings")).toBeVisible();
      await goNext(page, STEP3);
      await expect(descValue(page, "House Name")).toHaveText(norm(x.name));
      await expect(descValue(page, "House Code")).toHaveText(norm(x.code));
      await expect(submitBtn(page)).toBeVisible(); // KHÔNG bấm Submit
      await prevBtn(page).click();
      expect(await stepClasses(page)).toEqual(["finish", "process", "wait"]);
      await prevBtn(page).click();
      await expect(nameInput(page)).toHaveValue(x.name);
      await cancelBtn(page).click();
      await expect(page).toHaveURL(/\/house\/entity$/);
    });

    test("Submit ở bước Review (response GIẢ): gửi house/update đúng dữ liệu hiện có rồi quay về danh sách", async ({ page }) => {
      const { x, view } = await openChild(page, 1);
      await mockWrites(page, MOCK_OK);
      await goNext(page, STEP2);
      await goNext(page, STEP3);
      const [req] = await Promise.all([page.waitForRequest(endsWith("/house/update")), submitBtn(page).click()]);
      const body = bodyOf(req);
      allowedWrites.push({ url: "house/update", body });
      expect(body).toMatchObject({ name: x.name, status: x.status });
      expect([...body.currencyIds].sort((a, b) => a - b)).toEqual(view.currencies.map((c) => c.id).sort((a, b) => a - b));
      expect([...body.gameCategoryIds].sort((a, b) => a - b)).toEqual(view.gameCategoryList.map((c) => c.id).sort((a, b) => a - b));
      await expect(toasts(page).first()).toBeVisible();
      await expect(page).toHaveURL(/\/house\/entity$/);
    });
  });

  // ===== Create =====
  test.describe("Create House (không ghi dữ liệu thật)", () => {
    const CREATE_URL = "/house/entity/create";
    // Điền bước 1 hợp lệ: name, code, 1 currency, 1 category. Trả về { name, code, currency, category }
    async function fillStep1(page, tag = "QA-AUTO") {
      const stamp = Date.now();
      const name = `${tag}-${stamp}`;
      const code = `qaauto${stamp}`;
      await nameInput(page).fill(name);
      await codeInput(page).fill(code);
      await currencySelect(page).click();
      const chip = dropdownChips(page).filter({ hasNotText: exact("Select All") }).first();
      const currency = norm(await chip.innerText());
      await chip.click();
      await page.getByText("Create House", { exact: true }).click(); // click ra ngoài để đóng dropdown
      await categorySelect(page).click();
      const opt = openOptions(page).filter({ hasNotText: exact("Select All") }).first();
      const category = norm(await opt.innerText());
      await opt.click();
      await page.getByText("Create House", { exact: true }).click();
      await expect(openOptions(page)).toHaveCount(0);
      return { name, code, currency, category };
    }

    test.beforeEach(async ({ page }) => {
      await page.goto(CREATE_URL);
      await expect(breadcrumb(page)).toContainText("Create House");
      await expect(nameInput(page)).toBeVisible();
    });

    test("Wizard 3 bước, bước 1 đang chọn; có nút Cancel / Next", async ({ page }) => {
      await expect(page.locator(".ant-steps-item-title")).toHaveText(["Basic Information", "Backoffice Geofencing", "Review & Submit"]);
      expect(await stepClasses(page)).toEqual(["process", "wait", "wait"]);
      await expect(cancelBtn(page)).toBeVisible();
      await expect(nextBtn(page)).toBeVisible();
    });

    test("Giá trị mặc định: Name / Code trống, Timezone Singapore, Currencies / Game Category trống, Status Active", async ({ page }) => {
      await expect(nameInput(page)).toHaveValue("");
      await expect(codeInput(page)).toHaveValue("");
      await expect(page.locator(".ant-select").filter({ has: page.locator("#timezoneId") })).toContainText(
        "(GMT +08:00) Asia/Singapore, Singapore",
      );
      await expect(currencySelect(page).locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(categorySelect(page).locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(page.locator('input[type="radio"][value="1"]')).toBeChecked();
      await expect(page.locator("#subDomain")).toBeDisabled();
    });

    test("Để trống rồi Next: báo lỗi từng trường bắt buộc và ở lại bước 1", async ({ page }) => {
      await nextBtn(page).click();
      await expect(fieldErrors(page, "Name")).toHaveText([MSG.required]);
      await expect(fieldErrors(page, "Code")).toHaveText([MSG.required]);
      await expect(fieldErrors(page, "Currencies")).toHaveText([MSG.currencies]);
      await expect(fieldErrors(page, "Game Category")).toHaveText([MSG.category]);
      expect(await stepClasses(page)).toEqual(["process", "wait", "wait"]);
    });

    test("Backoffice URL tự cập nhật theo Code đang gõ", async ({ page }) => {
      await codeInput(page).fill("qaautourlcheck");
      await expect(page.locator("#subDomain")).toHaveValue(/\/qaautourlcheck$/);
    });

    test("Nhập Name / Code trùng house có sẵn: gọi validate và báo lỗi trùng", async ({ page }) => {
      // Lấy name / code của 1 house có sẵn từ dropdown (không hard-code)
      const ddRes = page.waitForResponse(isHouseDropdown, { timeout: 30000 });
      await page.goto(URL);
      const data = (await (await ddRes).json()).data;
      test.skip(data.length === 0, "Không có house nào");
      await page.goto(CREATE_URL);
      await nameInput(page).fill(data[0].label);
      await codeInput(page).fill(data[0].code);
      const [nameRes, codeRes] = await Promise.all([
        page.waitForResponse(endsWith("/validate/entityname")),
        page.waitForResponse(endsWith("/validate/entitycode")),
        nextBtn(page).click(),
      ]);
      expect((await nameRes.json()).messageCode).toBe("DUPLICATE_NAME");
      expect((await codeRes.json()).messageCode).toBe("DUPLICATE_ENTITY_CODE");
      await expect(fieldErrors(page, "Name")).toHaveText([MSG.dupName]);
      await expect(fieldErrors(page, "Code")).toHaveText([MSG.dupCode]);
    });

    test("Dropdown Currencies có 'Select All' và chọn được từng currency (chip)", async ({ page }) => {
      await currencySelect(page).click();
      await expect(dropdownChips(page).first()).toHaveText("Select All");
      const second = dropdownChips(page).nth(1);
      const label = norm(await second.innerText());
      await second.click();
      await page.getByText("Create House", { exact: true }).click();
      await expect(currencySelect(page).locator(".ant-select-selection-item")).toHaveText([label]);
    });

    test("Dropdown Game Category có 'Select All' và các category", async ({ page }) => {
      await categorySelect(page).click();
      await openOptions(page).first().waitFor();
      const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      expect(titles[0]).toBe("Select All");
      expect(titles.length).toBeGreaterThan(1);
      await page.getByText("Create House", { exact: true }).click();
    });

    test("Bước 2 Backoffice Geofencing: có Whitelist; hộp thoại 'Add Whitelist' đóng được bằng Cancel", async ({ page }) => {
      await fillStep1(page);
      await goNext(page, STEP2);
      await expect(page.getByText("Geofencing Settings")).toBeVisible();
      await page.getByRole("button", { name: "Whitelist" }).click();
      await expect(dialog(page)).toContainText("Add Whitelist");
      await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
      await expect(dialog(page)).toBeHidden();
    });

    test("Bước 3 Review hiển thị đúng dữ liệu đã nhập; Previous quay lại giữ nguyên dữ liệu", async ({ page }) => {
      const v = await fillStep1(page);
      await goNext(page, STEP2);
      await goNext(page, STEP3);
      await expect(descValue(page, "House Name")).toHaveText(v.name);
      await expect(descValue(page, "House Code")).toHaveText(v.code);
      await expect(descValue(page, "Status")).toHaveText("Active");
      await expect(descValue(page, "Supported Currencies")).toContainText(v.currency);
      await expect(descValue(page, "Game Category")).toContainText(v.category);
      await prevBtn(page).click();
      await prevBtn(page).click();
      await expect(nameInput(page)).toHaveValue(v.name);
      await expect(codeInput(page)).toHaveValue(v.code);
    });

    test("Submit (response GIẢ): gửi house/create đúng payload, toast thành công và quay về danh sách", async ({ page }) => {
      await mockWrites(page, MOCK_OK);
      const v = await fillStep1(page);
      await goNext(page, STEP2);
      await goNext(page, STEP3);
      const [req] = await Promise.all([page.waitForRequest(isCreate), submitBtn(page).click()]);
      const body = bodyOf(req);
      allowedWrites.push({ url: "house/create", body });
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
      await expect(page).toHaveURL(/\/house\/entity$/);
    });

    test("Cancel ở bước 1 quay về danh sách và không gửi request ghi", async ({ page }) => {
      // Cancel = quay lại trang trước: vào Create từ danh sách (nút Add New) để trang trước là danh sách
      await openPage(page);
      await addBtn(page).click();
      await expect(page).toHaveURL(/\/house\/entity\/create$/);
      await cancelBtn(page).click();
      await expect(page).toHaveURL(/\/house\/entity$/);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: ghi dữ liệu THẬT (tạo house QA-AUTO, rồi dọn bằng Deactivate)
// ---------------------------------------------------------------------------
test.describe("Houses > Create House (ghi dữ liệu thật)", () => {
  test.skip(!RUN_FULL_TESTS, SKIP_WRITE_REASON);
  test.describe.configure({ mode: "serial" });

  let writes;
  let created; // { id, name, code } của house QA-AUTO đã tạo

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__house_entity_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/house_entity_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__house_entity_spec_cleared", "1");
    });
    writes = watchWrites(page);
  });

  // Mọi request ghi chỉ được là house/create của house QA-AUTO hoặc house/update-status nhắm đúng house QA-AUTO vừa tạo
  test.afterEach(async () => {
    for (const w of writes) {
      if (w.url === "house/create") {
        expect(w.body.name, "house/create chỉ được tạo house QA-AUTO").toMatch(/^QA-AUTO-\d+$/);
      } else {
        expect(w.url).toBe("house/update-status");
        expect(created, "house/update-status chỉ được nhắm vào house QA-AUTO đã tạo").toBeTruthy();
        expect(w.body.ids).toEqual([created.id]);
      }
    }
  });

  // Dọn: nếu house QA-AUTO còn Active thì Deactivate bằng UI (màn hình không có Delete)
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

  test("Tạo house QA-AUTO bằng UI: house/create thành công, toast, house xuất hiện đầu danh sách (Active) rồi dọn bằng Deactivate", async ({ page }) => {
    test.setTimeout(120000);
    const stamp = Date.now();
    const name = `QA-AUTO-${stamp}`;
    const code = `qaauto${stamp}`;
    await page.goto("/house/entity/create");
    await page.getByPlaceholder("Enter the house name").fill(name);
    await page.getByPlaceholder("Enter the house code").fill(code);
    await page.locator(".ant-select").filter({ has: page.locator("#currencyIds") }).click();
    const chip = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-tag").filter({ hasNotText: exact("Select All") }).first();
    const currency = norm(await chip.innerText());
    await chip.click();
    await page.getByText("Create House", { exact: true }).click();
    await page.locator(".ant-form-item").filter({ has: page.locator(".ant-form-item-label label", { hasText: "Game Category" }) }).locator(".ant-select").click();
    const opt = openOptions(page).filter({ hasNotText: exact("Select All") }).first();
    const category = norm(await opt.innerText());
    await opt.click();
    await page.getByText("Create House", { exact: true }).click();
    const next = page.getByRole("button", { name: "Next", exact: true });
    const steps = () => page.locator(".ant-steps-item").evaluateAll((els) => els.map((e) => (e.className.match(/ant-steps-item-(wait|process|finish)/) || [])[1]));
    await next.click();
    await expect.poll(steps).toEqual(["finish", "process", "wait"]);
    await next.click();
    await expect.poll(steps).toEqual(["finish", "finish", "process"]);

    const [req, res] = await Promise.all([
      page.waitForRequest(isCreate),
      page.waitForResponse(isCreate),
      page.getByRole("button", { name: "Submit", exact: true }).click(),
    ]);
    expect(bodyOf(req)).toMatchObject({ name, entityCode: code, status: 1 });
    const json = await res.json();
    expect(json.status, `house/create trả ${json.messageCode}: ${json.message}`).toBe("success");
    await expect(page).toHaveURL(/\/house\/entity$/);
    await expect(toasts(page).filter({ hasText: /Success/ })).toBeVisible();

    // House mới nằm đầu danh sách (sort id giảm dần), Active, đúng currency / category
    await expect(table(page).locator("tbody tr.ant-table-row").first()).toContainText(name);
    created = { id: Number(norm(await cellAt(page, 0, COL.id).innerText())), name, code };
    await expect(cellAt(page, 0, COL.code)).toHaveText(code);
    await expect(cellAt(page, 0, COL.status)).toHaveText("Active");
    expect(await chipsOf(page, 0, COL.currency)).toEqual([currency]);
    expect(await chipsOf(page, 0, COL.category)).toEqual([category]);

    // Dọn: Deactivate house QA-AUTO vừa tạo (ghi thật nhưng chỉ lên house do test tạo)
    await openRowMenu(page, 0);
    await menuItems(page).filter({ hasText: exact("Deactivate") }).click();
    await expect(dialog(page)).toContainText(`Deactivate ${name}`);
    const [upd] = await Promise.all([
      page.waitForRequest(isUpdateStatus),
      dialog(page).getByRole("button", { name: /Deactivate$/ }).click(),
    ]);
    expect(bodyOf(upd)).toEqual({ ids: [created.id], status: 0 });
    await expect(toasts(page).filter({ hasText: MSG.statusUpdated })).toBeVisible();
    await expect(cellAt(page, 0, COL.status)).toHaveText("Inactive");
  });
});
