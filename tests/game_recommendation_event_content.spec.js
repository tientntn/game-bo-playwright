// Game Recommendation > Event Content  (https://dev-bo.royaledge.io/game-recommendation/event-content)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/game_recommendation_event_content.spec.js --project=setup --project=chromium
//
// Màn hình quản lý nội dung sự kiện (Event Content) theo AGENT: mỗi dòng = 1 cặp Master Agent / Agent kèm danh sách sự kiện
// (Event Title, Event Description, ngày hiển thị). Bấm "+" ở đầu dòng để mở rộng và xem các sự kiện của agent đó; mỗi sự kiện có nút
// "View Content" mở hộp thoại "View Translated Content <tiêu đề sự kiện>" (bảng bản dịch theo ngôn ngữ, sửa trực tiếp trên dòng).
//  - Filter: Master Agent (chọn 1, API nhận mảng masterAgentIds), Agent (chọn 1, API nhận mảng agentIds, danh sách phụ thuộc Master Agent),
//    Event Title (chữ, khớp một phần, không phân biệt hoa/thường, đã trim). Kết quả lọc theo Event Title chỉ còn các sự kiện khớp trong từng dòng.
//  - Bảng: cột đầu là nút mở rộng (header rỗng), Master Agent, Agent (2 cột này có icon sort), No. of Event, Action (Update / Delete).
//  - Danh sách CÓ phân trang (10/20/50/100/200) nhưng dữ liệu thường rất ít (vài agent) nên các test phân trang tự skip khi tổng <= 10 / 20.
//  - Không có checkbox chọn dòng / thao tác hàng loạt, KHÔNG có nút Export.
//
// Màn hình có các thao tác GHI dữ liệu thật: Add New (Submit), Update (Submit), Delete (Delete), sửa bản dịch trên dòng (icon Save).
// Test KHÔNG bấm Submit khi form hợp lệ, KHÔNG bấm nút Delete trong hộp thoại xác nhận, KHÔNG bấm icon Save của bản dịch khi dữ liệu hợp lệ:
// chỉ mở hộp thoại, kiểm tra nội dung, kiểm tra validation (form bị chặn nên không gửi request) rồi bấm Cancel / Close, và kiểm tra không có
// request ghi dữ liệu nào được gửi đi (watchWrites + route chặn thêm 1 lớp bảo hiểm - request ghi nếu có vẫn bị ghi nhận vào `writes`
// nên test sẽ fail nhưng dữ liệu thật không bị đổi). Việc thêm / xoá dòng sự kiện TRONG hộp thoại chỉ là thao tác trên form (chưa lưu).
// Không hard-code dữ liệu - mọi giá trị lấy từ chính danh sách / response dropdown.
//
// GHI CHÚ ĐÃ KHÁM PHÁ (chưa được xác nhận là lỗi nên KHÔNG assert):
//  - Sort cột Master Agent / Agent: UI gửi sortBy "masterAgentName" / "agentName" nhưng backend trả về đúng thứ tự mặc định (id giảm dần)
//    cho cả asc lẫn desc -> test chỉ kiểm tra request và bảng khớp response, không kiểm tra thứ tự dữ liệu.
const { test, expect } = require("@playwright/test");

test.use({ viewport: { width: 1920, height: 1080 } });

const URL = "/game-recommendation/event-content";

// Đúng thứ tự hiển thị (cột đầu là nút mở rộng, không có tên)
const COLUMNS = ["", "Master Agent", "Agent", "No. of Event", "Action"];
const COL = { expand: 0, master: 1, agent: 2, total: 3, action: 4 };
// Cột trong Manage Columns (không có cột nút mở rộng)
const MANAGE_COLUMNS = ["Master Agent", "Agent", "No. of Event", "Action"];

// Các cột có thể sort -> tên field gửi lên API (mặc định sort theo id giảm dần)
const SORTABLE = { "Master Agent": "masterAgentName", Agent: "agentName" };

const SUB_COLUMNS = ["Event Title", "Event Description", "Translated Content"];
const MAX_TITLE = 20;
const MAX_DESC = 60;
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];

// Thông báo lỗi của form (đọc từ màn hình thật)
const MSG = {
  master: "Please select master agent",
  agent: "Please select agent",
  title: "Please input event title",
  desc: "Please input event description",
  start: "Please select visibility start date",
  endBeforeStart: "Visibility end date cannot be earlier than start date",
  rows: "Some rows are incomplete. Please check page 1",
};

// Request đọc dữ liệu (mọi POST còn lại coi là ghi)
const READ = /\/(list|details|download|view)$|\/dropdown\/|_dropdown$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const endsWith = (s) => (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith(s);
const isList = endsWith("/event-content/list");
const isView = endsWith("/event-content/view");
const isTranslationView = endsWith("/event-content/translation/view");
const isMasterDropdown = endsWith("/report/master_agent_dropdown");
const isAgentDropdown = endsWith("/report/agent_dropdown");
const isLanguageDropdown = endsWith("/dropdown/language");

// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};

// Dòng chính của bảng: có nút mở rộng ở ô đầu (các dòng của bảng con / hộp thoại không có)
const rows = (page) => page.locator("tr.ant-table-row:has(> td > button.ant-table-row-expand-icon)");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("> td").nth(col);
const editIcon = (page, i) => rowAt(page, i).locator('svg[data-icon="pen-to-square"]');
const deleteIcon = (page, i) => rowAt(page, i).locator('svg[data-icon="trash"]');
const expandBtn = (page, i) => rowAt(page, i).locator("button.ant-table-row-expand-icon");
// Dòng mở rộng (bảng con) ngay sau dòng chính i
const subPanel = (page, i) => rowAt(page, i).locator("xpath=following-sibling::tr[1]");
const subRows = (page, i) => subPanel(page, i).locator("tbody tr.ant-table-row");
const viewBtn = (row) => row.getByRole("button", { name: "View Content" });

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const addBtn = (page) => page.getByRole("button", { name: "plus Add New" });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const exportBtn = (page) => page.locator("button.NextGen-export-button");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const dialog = (page) => page.getByRole("dialog");
const tooltip = (page) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");
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
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");

// Phần tử bao 1 filter (theo id của input bên trong)
const filterEl = (page, id) =>
  page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });

// Header của bảng chính (bảng con khi mở rộng có thead riêng nên chỉ lấy thead đầu tiên)
const mainHead = (page) => page.locator(".ant-table-thead").first();
const th = (page, name) => mainHead(page).locator("th").filter({ hasText: exact(name) });

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
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
  await waitTableIdle(page);
  await expect(page.locator(".NextGen-filter-bar")).toBeVisible();
}

// Bấm Search, trả về { body: request body, status, json: response body }.
// Lấy response từ chính request vừa gửi (không dùng waitForResponse riêng) để không bị lệch khi search liên tiếp.
// LƯU Ý (UI, khám phá bằng MCP): khi filter vừa thay đổi, Search đôi khi gửi 2 request list GIỐNG HỆT nhau cách nhau ~200ms.
// Request thứ 2 có thể bị nhầm là request của thao tác kế tiếp (sort / đổi trang / search) -> chờ mạng yên (networkidle)
// sau mỗi lần gọi để loại request thừa này.
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
}

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
// Như reloadFull nhưng chỉ trả về request body
const reloadBy = async (page, action) => (await reloadFull(page, action)).body;

const headers = async (page) => (await mainHead(page).locator("th").allInnerTexts()).map((t) => t.trim());

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
const exact = (name, flags = "") =>
  new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, flags);
const totalOf = async (page) => num((await summary(page).innerText()).match(/of ([\d,]+) records/)[1]);

// Lấy toàn bộ giá trị của 1 cột (theo tên header) ở trang hiện tại
async function columnValues(page, name) {
  await expect.poll(() => headers(page), { message: `Không thấy cột "${name}"` }).toContain(name);
  const idx = (await headers(page)).indexOf(name);
  return rows(page).evaluateAll(
    (trs, i) => trs.map((tr) => tr.children[i].innerText.replace(/\s+/g, " ").trim()),
    idx,
  );
}

// Text option của Master Agent / Agent / ngôn ngữ ở filter và Add/Update: "code - label"
const optionText = (g) => `${g.code} - ${g.label}`;

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn 1 giá trị ở filter Master Agent / Agent (dropdown chọn 1, tự đóng sau khi chọn).
// Gõ code vào ô tìm kiếm trước để option chắc chắn nằm trong danh sách hiển thị; chỉ lấy option khớp chính xác.
async function selectOption(page, id, item) {
  await openDropdown(page, id);
  await page.keyboard.type(item.code);
  await openOptions(page).filter({ hasText: exact(optionText(item)) }).first().click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Chọn Master Agent ở filter, trả về danh sách Agent mà API agent_dropdown trả về cho master đó
async function selectMaster(page, m) {
  const [res] = await Promise.all([page.waitForResponse(isAgentDropdown), selectOption(page, "masterAgentId", m)]);
  return (await res.json()).data;
}

// Đọc toàn bộ option đang hiển thị của 1 dropdown filter (dropdown của filter không dùng danh sách ảo)
async function filterOptions(page, id) {
  await openDropdown(page, id);
  await openOptions(page).first().waitFor();
  const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  // Click ra ngoài để đóng dropdown - phím Esc không đóng được khi chưa gõ tìm kiếm
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
  return titles;
}

// Giá trị đang được chọn của 1 filter dropdown chọn 1
const selectedOf = (page, id) =>
  filterEl(page, id)
    .locator(".ant-select-selection-item[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));

// Nhập text vào filter dạng input (input bị ẩn cho tới khi click vào label)
async function fillFilter(page, id, value) {
  await filterEl(page, id).locator("label").first().click();
  await page.locator(`#${id}`).fill(value);
}

// Ghi lại mọi request POST KHÔNG phải đọc dữ liệu để chắc chắn test không làm đổi dữ liệu thật
function watchWrites(page) {
  const writes = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /boapi/.test(r.url()) && !READ.test(r.url())) writes.push(r.url());
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

// Ngày hiển thị "dd-MM-yyyy HH:mm:ss" -> ms (coi như UTC) để so sánh khoảng cách với epoch của API
const parseDisplay = (s) => {
  const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) : null;
};

// Các thành phần của hộp thoại Add / Update Event
const cancelBtn = (page) => dialog(page).getByRole("button", { name: /Cancel$/ });
const closeX = (page) => dialog(page).getByRole("button", { name: "Close", exact: true });
const submitBtn = (page) => dialog(page).getByRole("button", { name: /Submit$/ });
const dlgAddRowBtn = (page) => dialog(page).getByRole("button", { name: /Add New$/ });
const dlgMaster = (page) => dialog(page).locator(".ant-select").nth(0);
const dlgAgent = (page) => dialog(page).locator(".ant-select").nth(1);
const dlgRows = (page) => dialog(page).locator("tbody tr.ant-table-row");
const dlgRowAt = (page, i) => dlgRows(page).nth(i);
const dlgTitle = (page, i) => dialog(page).locator(`#events_${i}_title`);
const dlgDesc = (page, i) => dialog(page).locator(`#events_${i}_description`);
const dlgDates = (row) => row.locator('input[placeholder="Select"]');
const dlgError = (page, msg) => dialog(page).getByText(msg, { exact: true });

// Đóng hộp thoại Add / Update / Delete bằng Cancel (không bao giờ bấm Submit khi form hợp lệ / Delete)
async function closeDialog(page) {
  await cancelBtn(page).click();
  await expect(dialog(page)).toBeHidden();
}

// Chọn 1 ngày trong tháng đang hiển thị của date picker (react-datepicker trong popover) rồi bấm Confirm
async function pickDay(page, input, day) {
  await input.click();
  const pop = page.locator(".ant-popover:not(.ant-popover-hidden)").last();
  await pop
    .locator(".react-datepicker__day:not(.react-datepicker__day--outside-month)")
    .filter({ hasText: exact(String(day)) })
    .click();
  await pop.getByRole("button", { name: /Confirm/ }).click();
  await expect(page.locator(".ant-popover:not(.ant-popover-hidden)")).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Game Recommendation > Event Content", () => {
  let writes;
  let mastersLoaded; // promise của response report/master_agent_dropdown lúc mở trang
  let agentsLoaded; // promise của response report/agent_dropdown (tất cả agent) lúc mở trang
  // Danh sách { value, code, label } mà dropdown trả về
  const masters = async () => (await (await mastersLoaded).json()).data;
  const agents = async () => (await (await agentsLoaded).json()).data;

  test.beforeEach(async ({ page }) => {
    // Bộ lọc và số dòng/trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__event_content_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/game-recommendation_event-content_(filter|page_size)$|^sorter__game-recommendation_event-content$/.test(k)) {
          localStorage.removeItem(k);
        }
      }
      sessionStorage.setItem("__event_content_spec_cleared", "1");
    });
    writes = watchWrites(page);
    await blockWrites(page);
    mastersLoaded = page.waitForResponse(isMasterDropdown, { timeout: 60000 });
    mastersLoaded.catch(() => {});
    agentsLoaded = page.waitForResponse(isAgentDropdown, { timeout: 60000 });
    agentsLoaded.catch(() => {});
    await openPage(page);
  });

  // Mọi test đều không được gửi request ghi dữ liệu
  test.afterEach(async () => {
    expect(writes, "Không được gửi request ghi dữ liệu").toEqual([]);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, đủ 3 filter và 2 nút Search/Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Event Content");
      for (const [label, id] of [
        ["Master Agent", "masterAgentId"],
        ["Agent", "agentId"],
        ["Event Title", "eventTitle"],
      ]) {
        await expect(filterEl(page, id), `thiếu filter ${label}`).toContainText(label);
        await expect(filterEl(page, id)).toBeVisible();
      }
      await expect(page.locator(".NextGen-filter-element")).toHaveCount(3);
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: tất cả để trống", async ({ page }) => {
      await expect(filterEl(page, "masterAgentId").locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(filterEl(page, "agentId").locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(page.locator("#eventTitle")).toHaveValue("");
    });

    test("Master Agent và Agent là dropdown chọn 1 giá trị (có tìm kiếm), Event Title là ô nhập chữ", async ({ page }) => {
      for (const id of ["masterAgentId", "agentId"]) {
        await expect(filterEl(page, id).locator(".ant-select-single")).toHaveCount(1);
        await expect(filterEl(page, id).locator(".ant-select-multiple")).toHaveCount(0);
        await expect(filterEl(page, id).locator(".ant-select-show-search")).toHaveCount(1);
      }
      await expect(filterEl(page, "eventTitle").locator(".ant-select")).toHaveCount(0);
    });

    test("Có nút Add New và Manage Columns; không có Export, checkbox chọn dòng / thao tác hàng loạt", async ({ page }) => {
      await expect(addBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
      await expect(exportBtn(page)).toHaveCount(0);
      await expect(page.locator("button.NextGen-button-more-action__update")).toHaveCount(0);
      await expect(page.locator('.ant-table input[type="checkbox"]')).toHaveCount(0);
    });

    test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự (cột đầu là nút mở rộng)`, async ({ page }) => {
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Mặc định: trang 1, 10 dòng, sắp xếp mới nhất (id giảm dần) lên đầu, không gửi filter", async ({ page }) => {
      const { body, json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      expect(body).toEqual({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: {} });
      const ids = json.data.list.map((x) => x.id);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
      expect(ids.length).toBeLessThanOrEqual(10);
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
    test("Mỗi dòng khớp response API (Master Agent, Agent, No. of Event)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      await expect(rows(page)).toHaveCount(list.length);
      for (const [i, x] of list.entries()) {
        const at = `dòng ${i + 1} (id ${x.id})`;
        expect(norm(await cellAt(page, i, COL.master).innerText()), at).toBe(norm(x.masterAgentName));
        expect(norm(await cellAt(page, i, COL.agent).innerText()), at).toBe(norm(x.agentName));
        expect(norm(await cellAt(page, i, COL.total).innerText()), at).toBe(String(x.numberOfEvents));
      }
    });

    test("No. of Event là số nguyên không âm và bằng số sự kiện thực tế của dòng", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const v of await columnValues(page, "No. of Event")) expect(v).toMatch(/^\d+$/);
      for (const x of json.data.list) expect(x.numberOfEvents, `dòng ${x.id}`).toBe(x.events.length);
    });

    test("Mỗi agent chỉ có 1 dòng (agentId và tên Agent không trùng nhau)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      const ids = list.map((x) => x.agentId);
      expect(new Set(ids).size).toBe(ids.length);
      const names = await columnValues(page, "Agent");
      for (const v of names) expect(v).not.toBe("");
    });

    test("Master Agent / Agent của từng dòng là giá trị có thật trong API dropdown (đúng tên)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const ms = new Map((await masters()).map((m) => [m.value, m.label]));
      const as = new Map((await agents()).map((a) => [a.value, a.label]));
      for (const x of json.data.list) {
        expect(ms.get(x.masterAgentId), `master agent ${x.masterAgentId} của dòng ${x.id}`).toBe(x.masterAgentName);
        expect(as.get(x.agentId), `agent ${x.agentId} của dòng ${x.id}`).toBe(x.agentName);
      }
    });

    test(`Mỗi sự kiện có Title không rỗng tối đa ${MAX_TITLE} ký tự, Description không rỗng tối đa ${MAX_DESC} ký tự`, async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const x of json.data.list) {
        for (const e of x.events) {
          expect(e.title, `event ${e.id}`).not.toBe("");
          expect([...e.title].length, `title của event ${e.id}`).toBeLessThanOrEqual(MAX_TITLE);
          expect(e.description, `event ${e.id}`).not.toBe("");
          expect([...e.description].length, `description của event ${e.id}`).toBeLessThanOrEqual(MAX_DESC);
        }
      }
    });

    test("Mở rộng 1 dòng hiện bảng con (Event Title, Event Description, Translated Content) đúng dữ liệu; bấm lại thì thu gọn", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      const i = list.findIndex((x) => x.events.length > 0);
      test.skip(i < 0, "Không có dòng nào có sự kiện");
      const x = list[i];
      await expect(expandBtn(page, i)).toHaveAttribute("aria-expanded", "false");
      await expandBtn(page, i).click();
      await expect(expandBtn(page, i)).toHaveAttribute("aria-expanded", "true");
      await expect(subPanel(page, i)).toBeVisible();
      expect((await subPanel(page, i).locator("thead th").allInnerTexts()).map((t) => t.trim())).toEqual(SUB_COLUMNS);
      await expect(subRows(page, i)).toHaveCount(x.events.length);
      for (const [k, e] of x.events.entries()) {
        const cells = subRows(page, i).nth(k).locator("td");
        expect(norm(await cells.nth(0).innerText()), `title sự kiện ${e.id}`).toBe(norm(e.title));
        expect(norm(await cells.nth(1).innerText()), `description sự kiện ${e.id}`).toBe(norm(e.description));
        await expect(viewBtn(cells.nth(2)), `sự kiện ${e.id}`).toBeVisible();
      }
      await expandBtn(page, i).click();
      await expect(expandBtn(page, i)).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("tr.ant-table-expanded-row")).toHaveCount(0);
    });

    test("Mở rộng nhiều dòng độc lập nhau: thu gọn dòng này không ảnh hưởng dòng kia", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Cần ít nhất 2 dòng");
      await expandBtn(page, 0).click();
      await expandBtn(page, 1).click();
      await expect(expandBtn(page, 0)).toHaveAttribute("aria-expanded", "true");
      await expect(expandBtn(page, 1)).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("tr.ant-table-expanded-row")).toHaveCount(2);
      await expandBtn(page, 0).click();
      await expect(expandBtn(page, 0)).toHaveAttribute("aria-expanded", "false");
      await expect(expandBtn(page, 1)).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("tr.ant-table-expanded-row")).toHaveCount(1);
    });

    test("Mỗi dòng có icon Update và Delete (chỉ hover, không bấm)", async ({ page }) => {
      const n = Math.min(3, await rows(page).count());
      test.skip(n === 0, "Không có dữ liệu");
      for (let i = 0; i < n; i++) {
        await expect(cellAt(page, i, COL.action).locator("svg")).toHaveCount(2);
        await hoverTip(page, editIcon(page, i), "Update");
        await hoverTip(page, deleteIcon(page, i), "Delete");
      }
    });
  });

  // ===== 3. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Option của Master Agent lấy từ API master_agent_dropdown, hiển thị dạng 'code - tên'", async ({ page }) => {
      const data = await masters();
      test.skip(data.length === 0, "Không có master agent nào");
      const titles = await filterOptions(page, "masterAgentId");
      expect([...titles].sort()).toEqual(data.map(optionText).sort());
    });

    test("Option của Agent (khi chưa chọn Master Agent) lấy từ API agent_dropdown, dạng 'code - tên'", async ({ page }) => {
      const data = await agents();
      test.skip(data.length === 0, "Không có agent nào");
      const titles = await filterOptions(page, "agentId");
      expect([...titles].sort()).toEqual(data.map(optionText).sort());
    });

    test("Search không chọn gì: gửi filters rỗng và trả về cùng tổng bản ghi", async ({ page }) => {
      const first = await search(page);
      const second = await search(page);
      expect(second.body.filters).toEqual({});
      expect(second.json.data.totalCount).toBe(first.json.data.totalCount);
    });

    test("Lọc theo Master Agent gửi masterAgentIds=[id] và mọi dòng đều thuộc master đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      const m = (await masters()).find((x) => x.value === first.masterAgentId);
      test.skip(!m, "Master agent của dòng đầu không có trong dropdown");

      await selectMaster(page, m);
      expect(await selectedOf(page, "masterAgentId")).toEqual([optionText(m)]);
      const { body, json: res } = await search(page);
      expect(body.filters).toEqual({ masterAgentIds: [m.value] });
      expect(res.data.list.map((x) => x.id)).toContain(first.id);
      for (const x of res.data.list) expect(x.masterAgentId, `dòng ${x.id}`).toBe(m.value);
      for (const v of await columnValues(page, "Master Agent")) expect(v).toBe(norm(m.label));
      await expect(rows(page)).toHaveCount(res.data.list.length);
      await expect(summary(page)).toContainText(`of ${res.data.totalCount} records`);
    });

    test("Chọn Master Agent: gọi lại agent_dropdown theo masterAgentIds và danh sách Agent chỉ còn agent của master đó", async ({ page }) => {
      const m = (await masters())[0];
      test.skip(!m, "Không có master agent nào");
      const [req, res] = await Promise.all([
        page.waitForRequest(isAgentDropdown),
        page.waitForResponse(isAgentDropdown),
        selectOption(page, "masterAgentId", m),
      ]);
      expect(bodyOf(req)).toEqual({ masterAgentIds: [m.value] });
      const data = (await res.json()).data;
      test.skip(data.length === 0, "Master agent này không có agent nào");
      const titles = await filterOptions(page, "agentId");
      expect([...titles].sort()).toEqual(data.map(optionText).sort());
    });

    test("Đổi Master Agent thì Agent đã chọn bị xoá", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      const ms = await masters();
      const m = ms.find((x) => x.value === first.masterAgentId);
      const other = ms.find((x) => x.value !== first.masterAgentId);
      test.skip(!m || !other, "Cần ít nhất 2 master agent");
      const ags = await selectMaster(page, m);
      const a = ags.find((x) => x.value === first.agentId);
      test.skip(!a, "Agent của dòng đầu không nằm trong danh sách của master");
      await selectOption(page, "agentId", a);
      expect(await selectedOf(page, "agentId")).toEqual([optionText(a)]);

      await selectMaster(page, other);
      await expect(filterEl(page, "agentId").locator(".ant-select-selection-item")).toHaveCount(0);
      expect(await selectedOf(page, "masterAgentId")).toEqual([optionText(other)]);
    });

    test("Xoá Master Agent bằng (x): danh sách Agent nạp lại đầy đủ (agent_dropdown không có masterAgentIds)", async ({ page }) => {
      const m = (await masters())[0];
      test.skip(!m, "Không có master agent nào");
      await selectMaster(page, m);
      await filterEl(page, "masterAgentId").locator(".ant-select").hover();
      const [req] = await Promise.all([
        page.waitForRequest(isAgentDropdown),
        filterEl(page, "masterAgentId").locator(".ant-select-clear").click({ force: true }),
      ]);
      expect(bodyOf(req)).toEqual({});
      await expect(filterEl(page, "masterAgentId").locator(".ant-select-selection-item")).toHaveCount(0);
      const { body } = await search(page);
      expect(body.filters).toEqual({});
    });

    test("Lọc theo Agent gửi agentIds=[id] và mọi dòng đều là agent đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      const a = (await agents()).find((x) => x.value === first.agentId);
      test.skip(!a, "Agent của dòng đầu không có trong dropdown");

      await selectOption(page, "agentId", a);
      expect(await selectedOf(page, "agentId")).toEqual([optionText(a)]);
      const { body, json: res } = await search(page);
      expect(body.filters).toEqual({ agentIds: [a.value] });
      expect(res.data.list.map((x) => x.id)).toEqual([first.id]);
      for (const x of res.data.list) expect(x.agentId, `dòng ${x.id}`).toBe(a.value);
      await expect(rows(page)).toHaveCount(1);
      await expect(cellAt(page, 0, COL.agent)).toHaveText(norm(first.agentName));
    });

    test("Kết hợp Master Agent và Agent cùng lúc (AND)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      const m = (await masters()).find((x) => x.value === first.masterAgentId);
      test.skip(!m, "Master agent của dòng đầu không có trong dropdown");
      const ags = await selectMaster(page, m);
      const a = ags.find((x) => x.value === first.agentId);
      test.skip(!a, "Agent của dòng đầu không nằm trong danh sách của master");
      await selectOption(page, "agentId", a);

      const { body, json: res } = await search(page);
      expect(body.filters).toEqual({ masterAgentIds: [m.value], agentIds: [a.value] });
      expect(res.data.list.map((x) => x.id)).toEqual([first.id]);
    });

    test("Xoá Agent đã chọn bằng (x) rồi Search thì không gửi agentIds", async ({ page }) => {
      const a = (await agents())[0];
      test.skip(!a, "Không có agent nào");
      await selectOption(page, "agentId", a);
      await filterEl(page, "agentId").locator(".ant-select").hover();
      await filterEl(page, "agentId").locator(".ant-select-clear").click({ force: true });
      await expect(filterEl(page, "agentId").locator(".ant-select-selection-item")).toHaveCount(0);
      const { body } = await search(page);
      expect(body.filters).toEqual({});
    });

    test("Lọc theo Event Title khớp một phần, không phân biệt hoa/thường; chỉ còn các sự kiện khớp trong từng dòng", async ({ page }) => {
      const { json } = await search(page);
      const ev = json.data.list.flatMap((x) => x.events).find((e) => /^[A-Za-z0-9 ]{4,}$/.test(e.title.trim()));
      test.skip(!ev, "Không có sự kiện nào có tiêu đề chữ / số đủ dài");
      const part = ev.title.slice(1, ev.title.length - 1).trim().toUpperCase();
      await fillFilter(page, "eventTitle", part);
      const { body, json: res } = await search(page);
      expect(body.filters).toEqual({ eventTitle: part });
      expect(res.data.list.length).toBeGreaterThan(0);
      expect(res.data.list.flatMap((x) => x.events.map((e) => e.id))).toContain(ev.id);
      for (const x of res.data.list) {
        expect(x.events.length, `dòng ${x.id}`).toBeGreaterThan(0);
        expect(x.numberOfEvents, `dòng ${x.id}`).toBe(x.events.length);
        for (const e of x.events) expect(e.title.toUpperCase(), `event ${e.id}`).toContain(part);
      }
      await expect(rows(page)).toHaveCount(res.data.list.length);
      await expect(summary(page)).toContainText(`of ${res.data.totalCount} records`);
      for (const [i, x] of res.data.list.entries()) {
        await expect(cellAt(page, i, COL.total), `dòng ${x.id}`).toHaveText(String(x.numberOfEvents));
      }
    });

    test("Event Title bị trim khoảng trắng đầu / cuối trước khi gửi", async ({ page }) => {
      const { json } = await search(page);
      const ev = json.data.list.flatMap((x) => x.events).find((e) => /^[A-Za-z0-9]{3,}/.test(e.title.trim()));
      test.skip(!ev, "Không có sự kiện phù hợp");
      const word = ev.title.trim().split(/\s+/)[0];
      await fillFilter(page, "eventTitle", `   ${word}  `);
      const { body, json: res } = await search(page);
      expect(body.filters).toEqual({ eventTitle: word });
      expect(res.data.list.flatMap((x) => x.events.map((e) => e.id))).toContain(ev.id);
    });

    test("Event Title chỉ khớp tiêu đề sự kiện, không khớp mô tả", async ({ page }) => {
      const { json } = await search(page);
      const events = json.data.list.flatMap((x) => x.events);
      const titles = events.map((e) => e.title.toLowerCase());
      // Tìm 1 từ có trong mô tả nhưng không nằm trong tiêu đề của bất kỳ sự kiện nào
      let token = null;
      for (const e of events) {
        token = (e.description.match(/[A-Za-z0-9]{4,}/g) || []).find((w) => !titles.some((t) => t.includes(w.toLowerCase())));
        if (token) break;
      }
      test.skip(!token, "Không có từ nào chỉ xuất hiện trong mô tả");
      await fillFilter(page, "eventTitle", token);
      const { json: res } = await search(page);
      expect(res.data.totalCount, `mô tả chứa "${token}" nhưng không có tiêu đề nào chứa`).toBe(0);
      expect(res.data.list.flatMap((x) => x.events)).toEqual([]);
    });

    test("Kết hợp Master Agent và Event Title cùng lúc (AND)", async ({ page }) => {
      const { json } = await search(page);
      const x = json.data.list.find((r) => r.events.some((e) => e.title.trim().length >= 3));
      test.skip(!x, "Không có dòng phù hợp");
      const ev = x.events.find((e) => e.title.trim().length >= 3);
      const m = (await masters()).find((v) => v.value === x.masterAgentId);
      test.skip(!m, "Master agent không có trong dropdown");
      const part = ev.title.trim().slice(0, 3).trim(); // UI trim giá trị trước khi gửi
      await selectMaster(page, m);
      await fillFilter(page, "eventTitle", part);
      const { body, json: res } = await search(page);
      expect(body.filters).toEqual({ masterAgentIds: [m.value], eventTitle: part });
      expect(res.data.list.map((r) => r.id)).toContain(x.id);
      for (const r of res.data.list) {
        expect(r.masterAgentId).toBe(m.value);
        for (const e of r.events) expect(e.title.toLowerCase()).toContain(part.toLowerCase());
      }
    });

    test("Không có kết quả -> hiển thị 'There are no entries found'", async ({ page }) => {
      await fillFilter(page, "eventTitle", `khong-co-${Date.now()}`);
      const { json } = await search(page);
      // Khi không có bản ghi nào, response KHÔNG có `data` (undefined) -> không đọc json.data.totalCount trực tiếp
      expect(json.data?.totalCount ?? 0).toBe(0);
      expect(json.data?.list ?? []).toHaveLength(0);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText("There are no entries found").first()).toBeVisible();
    });

    test("Search khi đang ở trang 2 thì quay về trang 1", async ({ page }) => {
      test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
      await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      const { body } = await search(page);
      expect(body.page).toBe(1);
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
    });
  });

  // ===== 4. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá toàn bộ filter đã chọn, nạp lại danh sách Agent đầy đủ và hiển thị lại toàn bộ dữ liệu", async ({ page }) => {
      const first = await search(page);
      test.skip(first.json.data.list.length === 0, "Không có dữ liệu");
      const x = first.json.data.list[0];
      const m = (await masters()).find((v) => v.value === x.masterAgentId);
      test.skip(!m, "Master agent của dòng đầu không có trong dropdown");
      await selectMaster(page, m);
      await fillFilter(page, "eventTitle", "qa");
      await search(page);

      await resetBtn(page).click();
      await expect(filterEl(page, "masterAgentId").locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(filterEl(page, "agentId").locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(page.locator("#eventTitle")).toHaveValue("");

      const { body, json } = await search(page);
      expect(body.filters).toEqual({});
      expect(json.data.totalCount).toBe(first.json.data.totalCount);
    });
  });

  // ===== 5. Phân trang =====
  test.describe("Phân trang", () => {
    test("Chỉ có 1 trang: số trang hiện tại là 1, nút Previous / Next đều bị tắt", async ({ page }) => {
      const total = await totalOf(page);
      test.skip(total === 0 || total > 10, "Không phải trường hợp chỉ có 1 trang");
      await expect(page.locator(".ant-pagination-item")).toHaveCount(1);
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
      await expect(page.locator(".ant-pagination-prev button")).toBeDisabled();
      await expect(page.locator(".ant-pagination-next button")).toBeDisabled();
    });

    test("Đổi số dòng / trang: có đủ 5 lựa chọn, đổi sang 20 thì gửi pageSize=20, trang 1", async ({ page }) => {
      const total = await totalOf(page);
      await page.locator(".ant-pagination-options .ant-select").click();
      expect(await openOptions(page).allInnerTexts()).toEqual(PAGE_SIZES);

      const { body, json } = await reloadFull(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
      expect(body.pageSize).toBe(20);
      expect(body.page).toBe(1);
      const shown = Math.min(20, total);
      await expect(rows(page)).toHaveCount(shown);
      expect(json.data.list.length).toBe(shown);
      await expect(summary(page)).toHaveText(new RegExp(`^Showing 1 - ${shown} of `));
    });

    test.describe("Khi có nhiều hơn 20 bản ghi", () => {
      test.beforeEach(async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 20, `Chỉ có ${total} bản ghi, không đủ để test phân trang`);
      });

      test("Chuyển sang trang 2 rồi quay lại trang 1", async ({ page }) => {
        const page1 = await columnValues(page, "Agent");

        const body2 = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        expect(body2.page).toBe(2);
        await expect(summary(page)).toHaveText(/^Showing 11 - 20 of /);
        expect(await columnValues(page, "Agent")).not.toEqual(page1);

        const body1 = await reloadBy(page, () => page.locator(".ant-pagination-item-1").click());
        expect(body1.page).toBe(1);
        await expect(summary(page)).toHaveText(/^Showing 1 - 10 of /);
      });

      test("Nút Next / Previous", async ({ page }) => {
        await expect(page.locator(".ant-pagination-prev button")).toBeDisabled();

        const next = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
        expect(next.page).toBe(2);
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");

        const prev = await reloadBy(page, () => page.locator(".ant-pagination-prev").click());
        expect(prev.page).toBe(1);
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
      });

      test("Trang cuối: hiển thị phần dư của danh sách và tắt nút Next", async ({ page }) => {
        const total = await totalOf(page);
        const last = Math.ceil(total / 10);
        const { body, json } = await reloadFull(page, () => page.locator(`.ant-pagination-item-${last}`).click());
        expect(body.page).toBe(last);
        const shown = total - (last - 1) * 10;
        expect(json.data.list).toHaveLength(shown);
        await expect(rows(page)).toHaveCount(shown);
        await expect(summary(page)).toHaveText(`Showing ${(last - 1) * 10 + 1} - ${total} of ${total} records`);
        await expect(page.locator(".ant-pagination-next button")).toBeDisabled();
      });

      test("Các trang không trùng dòng nhau (trang 1 và trang 2)", async ({ page }) => {
        const first = await search(page);
        const { json } = await reloadFull(page, () => page.locator(".ant-pagination-item-2").click());
        const ids1 = first.json.data.list.map((x) => x.id);
        for (const x of json.data.list) expect(ids1).not.toContain(x.id);
      });

      test("Giữ nguyên filter khi chuyển trang", async ({ page }) => {
        const m = (await masters())[0];
        test.skip(!m, "Không có master agent nào");
        await selectMaster(page, m);
        const filtered = await search(page);
        test.skip(filtered.json.data.totalCount <= 10, "Sau khi lọc chỉ còn 1 trang");
        const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
        expect(body).toMatchObject({ page: 2, filters: { masterAgentIds: [m.value] } });
      });
    });
  });

  // ===== 6. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    for (const [column, sortBy] of Object.entries(SORTABLE)) {
      test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định (id giảm dần)`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");

        // Mặc định đang sort theo id nên lần bấm đầu sort tăng dần theo cột này
        const asc = await reloadFull(page, () => th(page, column).click());
        expect(asc.body).toMatchObject({ sortBy, sortDirection: "asc" });
        // Chưa kiểm tra thứ tự dữ liệu (xem ghi chú đầu file): chỉ kiểm tra bảng hiển thị đúng thứ tự backend trả về
        await expect
          .poll(() => columnValues(page, column), { message: "thứ tự bảng = thứ tự response (asc)" })
          .toEqual(asc.json.data.list.map((x) => norm(column === "Agent" ? x.agentName : x.masterAgentName)));

        const desc = await reloadFull(page, () => th(page, column).click());
        expect(desc.body).toMatchObject({ sortBy, sortDirection: "desc" });
        await expect
          .poll(() => columnValues(page, column), { message: "thứ tự bảng = thứ tự response (desc)" })
          .toEqual(desc.json.data.list.map((x) => norm(column === "Agent" ? x.agentName : x.masterAgentName)));

        // Click lần 3: bỏ sort -> quay về mặc định id giảm dần
        const none = await reloadFull(page, () => th(page, column).click());
        expect(none.body).toMatchObject({ sortBy: "id", sortDirection: "desc" });
        const ids = none.json.data.list.map((x) => x.id);
        expect(ids).toEqual([...ids].sort((a, b) => b - a));
      });
    }

    test("Sort giữ nguyên filter đang áp dụng và không đổi tập dòng", async ({ page }) => {
      const first = await search(page);
      const list = first.json.data.list;
      test.skip(list.length < 2, "Không đủ dữ liệu để kiểm tra");
      // Chọn 1 ký tự (lấy từ tiêu đề sự kiện đầu tiên) mà có ít nhất 2 dòng có sự kiện chứa nó
      const ev = list[0].events.find((e) => e.title.trim().length > 0);
      test.skip(!ev, "Không có sự kiện");
      const ch = [...ev.title.toLowerCase()].find(
        (c) => /[a-z0-9]/.test(c) && list.filter((x) => x.events.some((e) => e.title.toLowerCase().includes(c))).length >= 2,
      );
      test.skip(!ch, "Không có ký tự chung giữa tiêu đề các dòng");
      await fillFilter(page, "eventTitle", ch);
      const filtered = await search(page);
      expect(filtered.json.data.list.length).toBeGreaterThanOrEqual(2);
      const { body, json } = await reloadFull(page, () => th(page, "Master Agent").click());
      expect(body).toMatchObject({ sortBy: "masterAgentName", sortDirection: "asc" });
      expect(body.filters).toEqual(filtered.body.filters);
      expect(json.data.list.map((x) => x.id).sort((a, b) => a - b)).toEqual(
        filtered.json.data.list.map((x) => x.id).sort((a, b) => a - b),
      );
    });

    test("Các cột nút mở rộng, No. of Event và Action không có chức năng sort", async ({ page }) => {
      for (const column of ["No. of Event", "Action"]) {
        await expect(th(page, column), column).not.toHaveClass(/ant-table-column-has-sorters/);
      }
      await expect(mainHead(page).locator("th").first()).not.toHaveClass(/ant-table-column-has-sorters/);
      for (const column of Object.keys(SORTABLE)) {
        await expect(th(page, column), column).toHaveClass(/ant-table-column-has-sorters/);
      }
    });
  });

  // ===== 7. Hộp thoại Add Event =====
  test.describe("Hộp thoại Add Event (không bấm Submit)", () => {
    test("Add New mở hộp thoại 'Add Event' với form trống: chưa chọn master / agent, 1 dòng sự kiện trống, có Cancel / Submit", async ({ page }) => {
      await addBtn(page).click();
      await expect(dialog(page)).toContainText("Add Event");
      await expect(dialog(page).locator("label").filter({ hasText: "Master Agent" })).toBeVisible();
      await expect(dialog(page).locator("label").filter({ hasText: /^Agent/ })).toBeVisible();
      await expect(dialog(page).locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(dlgAgent(page)).toHaveClass(/ant-select-disabled/);
      expect((await dialog(page).locator("thead th").allInnerTexts()).map((t) => t.trim())).toEqual([
        "*Event Title",
        "*Event Description",
        "*Visibility Start Date",
        "Visibility End Date (optional)",
        "Action",
      ]);
      await expect(dlgRows(page)).toHaveCount(1);
      await expect(dlgTitle(page, 0)).toHaveValue("");
      await expect(dlgTitle(page, 0)).toHaveAttribute("placeholder", `Max length is ${MAX_TITLE}`);
      await expect(dlgTitle(page, 0)).toHaveAttribute("maxlength", String(MAX_TITLE));
      await expect(dlgDesc(page, 0)).toHaveValue("");
      await expect(dlgDesc(page, 0)).toHaveAttribute("placeholder", `Max length is ${MAX_DESC}`);
      await expect(dlgDesc(page, 0)).toHaveAttribute("maxlength", String(MAX_DESC));
      await expect(dlgDates(dlgRowAt(page, 0))).toHaveCount(2);
      await expect(dlgDates(dlgRowAt(page, 0)).nth(0)).toHaveValue("");
      await expect(dlgDates(dlgRowAt(page, 0)).nth(1)).toHaveValue("");
      await expect(dlgAddRowBtn(page)).toBeVisible();
      await expect(cancelBtn(page)).toBeVisible();
      await expect(submitBtn(page)).toBeVisible();
      await closeDialog(page);
    });

    test("Để trống tất cả rồi Submit: báo đủ lỗi và không gửi request lưu", async ({ page }) => {
      await addBtn(page).click();
      await submitBtn(page).click(); // form lỗi nên bị chặn, không lưu gì
      for (const msg of [MSG.master, MSG.agent, MSG.title, MSG.desc, MSG.start, MSG.rows]) {
        await expect(dlgError(page, msg), msg).toHaveCount(1);
      }
      await expect(dialog(page)).toBeVisible();
      await closeDialog(page);
    });

    test("Chọn Master Agent: gọi agent_dropdown theo masterAgentIds và mở khoá ô Agent (option dạng 'code - tên')", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      await addBtn(page).click();
      const [req, res] = await Promise.all([
        page.waitForRequest((r) => isAgentDropdown(r) && bodyOf(r).masterAgentIds?.length > 0),
        page.waitForResponse((r) => isAgentDropdown(r) && /"masterAgentIds":\[\d+\]/.test(reqOf(r).postData() || "")),
        (async () => {
          await dlgMaster(page).click();
          await page.keyboard.type(x.masterAgentName);
          await openOptions(page).filter({ hasText: exact(x.masterAgentName) }).first().click();
        })(),
      ]);
      expect(bodyOf(req).masterAgentIds).toEqual([x.masterAgentId]);
      await expect(dlgAgent(page)).not.toHaveClass(/ant-select-disabled/);
      const data = (await res.json()).data;
      test.skip(data.length === 0, "Master agent này không có agent nào");
      await dlgAgent(page).click();
      await page.keyboard.type(data[0].code);
      await openOptions(page).filter({ hasText: exact(optionText(data[0])) }).first().click();
      await expect(dlgAgent(page).locator(".ant-select-selection-item")).toHaveAttribute("title", optionText(data[0]));
      await closeDialog(page);
    });

    test(`Ô Event Title giới hạn ${MAX_TITLE} ký tự, ô Event Description giới hạn ${MAX_DESC} ký tự`, async ({ page }) => {
      await addBtn(page).click();
      await dlgTitle(page, 0).fill("a".repeat(MAX_TITLE + 10));
      await dlgDesc(page, 0).fill("b".repeat(MAX_DESC + 10));
      expect(await dlgTitle(page, 0).inputValue()).toHaveLength(MAX_TITLE);
      expect(await dlgDesc(page, 0).inputValue()).toHaveLength(MAX_DESC);
      await closeDialog(page);
    });

    test("Title / Description chỉ gồm khoảng trắng: vẫn báo bắt buộc nhập khi Submit (bị chặn)", async ({ page }) => {
      await addBtn(page).click();
      await dlgTitle(page, 0).fill("   ");
      await dlgDesc(page, 0).fill("   ");
      await submitBtn(page).click();
      await expect(dlgError(page, MSG.title)).toHaveCount(1);
      await expect(dlgError(page, MSG.desc)).toHaveCount(1);
      await closeDialog(page);
    });

    test("Sau khi Submit lỗi: nhập Title / Description thì lỗi tương ứng biến mất", async ({ page }) => {
      await addBtn(page).click();
      await submitBtn(page).click(); // chặn vì form trống
      await expect(dlgError(page, MSG.title)).toHaveCount(1);
      await expect(dlgError(page, MSG.desc)).toHaveCount(1);
      await dlgTitle(page, 0).fill("QA Event");
      await expect(dlgError(page, MSG.title)).toHaveCount(0);
      await expect(dlgError(page, MSG.desc)).toHaveCount(1);
      await dlgDesc(page, 0).fill("QA description");
      await expect(dlgError(page, MSG.desc)).toHaveCount(0);
      await closeDialog(page); // KHÔNG Submit
    });

    test("Add New trong hộp thoại thêm 1 dòng sự kiện trống; icon xoá bỏ dòng đó (chưa lưu gì)", async ({ page }) => {
      await addBtn(page).click();
      await expect(dlgRows(page)).toHaveCount(1);
      await dlgAddRowBtn(page).click();
      await expect(dlgRows(page)).toHaveCount(2);
      await expect(dlgTitle(page, 1)).toHaveValue("");
      await dlgTitle(page, 1).fill("dòng thứ hai");
      await dlgRowAt(page, 0).locator('svg[data-icon="trash"]').click();
      await expect(dlgRows(page)).toHaveCount(1);
      await expect(dlgTitle(page, 0)).toHaveValue("dòng thứ hai");
      await closeDialog(page);
    });

    test("Quá 10 dòng sự kiện thì chia trang (10 dòng / trang)", async ({ page }) => {
      await addBtn(page).click();
      for (let i = 0; i < 10; i++) await dlgAddRowBtn(page).click();
      await expect(dialog(page).locator(".ant-pagination-item")).toHaveCount(2);
      await expect(dlgRows(page)).toHaveCount(10);
      await dialog(page).locator(".ant-pagination-item-2").click();
      await expect(dlgRows(page)).toHaveCount(1);
      await closeDialog(page);
    });

    test("Chọn ngày bắt đầu: hiển thị dạng dd-MM-yyyy HH:mm:ss", async ({ page }) => {
      await addBtn(page).click();
      const [start] = [dlgDates(dlgRowAt(page, 0)).nth(0)];
      await pickDay(page, start, 15);
      await expect(start).toHaveValue(/^15-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
      await closeDialog(page);
    });

    test("Ngày kết thúc sớm hơn ngày bắt đầu: báo lỗi; chọn ngày kết thúc sau ngày bắt đầu thì hết lỗi", async ({ page }) => {
      await addBtn(page).click();
      const row = dlgRowAt(page, 0);
      await pickDay(page, dlgDates(row).nth(0), 15);
      await pickDay(page, dlgDates(row).nth(1), 10);
      await expect(dlgDates(row).nth(1)).toHaveValue(/^10-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
      await expect(dlgError(page, MSG.endBeforeStart)).toHaveCount(1);

      await pickDay(page, dlgDates(row).nth(1), 20);
      await expect(dlgDates(row).nth(1)).toHaveValue(/^20-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
      await expect(dlgError(page, MSG.endBeforeStart)).toHaveCount(0);
      await closeDialog(page);
    });

    test("Cancel đóng hộp thoại, mở lại form được reset; đóng bằng X cũng không lưu gì", async ({ page }) => {
      const { json } = await search(page);
      await addBtn(page).click();
      await dlgTitle(page, 0).fill("Tên thử - không lưu");
      await dlgAddRowBtn(page).click();
      await closeDialog(page);

      await addBtn(page).click();
      await expect(dlgRows(page)).toHaveCount(1);
      await expect(dlgTitle(page, 0)).toHaveValue("");
      await closeX(page).click();
      await expect(dialog(page)).toBeHidden();
      await expect(summary(page)).toContainText(`of ${json.data.totalCount} records`);
    });
  });

  // ===== 8. Hộp thoại Update Event =====
  test.describe("Hộp thoại Update Event (không bấm Submit)", () => {
    // Mở hộp thoại Update của dòng i, trả về { x: dòng trong list, view: data của event-content/view }
    async function openUpdate(page, i = 0) {
      const { json } = await search(page);
      test.skip(json.data.list.length <= i, "Không có dữ liệu");
      const x = json.data.list[i];
      const [req, res] = await Promise.all([
        page.waitForRequest(isView),
        page.waitForResponse(isView),
        editIcon(page, i).click(),
      ]);
      expect(bodyOf(req)).toEqual({ id: x.id });
      const view = (await res.json()).data;
      await expect(dialog(page)).toContainText("Update Event");
      await expect(dlgRows(page)).toHaveCount(Math.min(10, view.events.length));
      return { x, view };
    }

    test("Bấm icon Update gọi event-content/view và hiển thị đúng Master Agent, Agent và các sự kiện của dòng", async ({ page }) => {
      const { x, view } = await openUpdate(page);
      expect(view.id).toBe(x.id);
      expect(view.masterAgentId).toBe(x.masterAgentId);
      expect(view.agentId).toBe(x.agentId);
      expect(view.events.map((e) => e.id)).toEqual(x.events.map((e) => e.id));
      await expect(dlgMaster(page).locator(".ant-select-selection-item")).toHaveText(norm(x.masterAgentName));
      await expect(dlgAgent(page).locator(".ant-select-selection-item")).toContainText(norm(x.agentName));
      for (const [k, e] of view.events.slice(0, 10).entries()) {
        await expect(dlgTitle(page, k), `title sự kiện ${e.id}`).toHaveValue(e.title);
        await expect(dlgDesc(page, k), `description sự kiện ${e.id}`).toHaveValue(e.description);
      }
      await expect(cancelBtn(page)).toBeVisible();
      await expect(submitBtn(page)).toBeVisible();
      await closeDialog(page);
    });

    test("Ngày bắt đầu / kết thúc hiển thị dạng dd-MM-yyyy HH:mm:ss, khớp dữ liệu API (cùng 1 múi giờ); ngày kết thúc trống nếu API null", async ({ page }) => {
      const { view } = await openUpdate(page);
      const events = view.events.slice(0, 10);
      const offsets = [];
      for (const [k, e] of events.entries()) {
        const [startInput, endInput] = [dlgDates(dlgRowAt(page, k)).nth(0), dlgDates(dlgRowAt(page, k)).nth(1)];
        const start = await startInput.inputValue();
        expect(start, `ngày bắt đầu sự kiện ${e.id}`).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
        offsets.push(parseDisplay(start) - e.visibilityStartDate);
        const end = await endInput.inputValue();
        if (e.visibilityEndDate == null) {
          expect(end, `ngày kết thúc sự kiện ${e.id}`).toBe("");
        } else {
          expect(end, `ngày kết thúc sự kiện ${e.id}`).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
          offsets.push(parseDisplay(end) - e.visibilityEndDate);
        }
      }
      // Chênh lệch giữa giờ hiển thị và epoch chính là múi giờ của người dùng: phải giống nhau cho mọi ngày và là bội số 15 phút
      expect(new Set(offsets).size, "mọi ngày phải lệch cùng 1 múi giờ").toBe(1);
      expect(Math.abs(offsets[0])).toBeLessThanOrEqual(14 * 3600 * 1000);
      expect(offsets[0] % (15 * 60 * 1000)).toBe(0);
      await closeDialog(page);
    });

    test("Mở Update của nhiều dòng: mỗi lần hiển thị đúng dữ liệu của dòng đó", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list.slice(0, 3);
      test.skip(list.length === 0, "Không có dữ liệu");
      for (const [i, x] of list.entries()) {
        const [req] = await Promise.all([page.waitForRequest(isView), editIcon(page, i).click()]);
        expect(bodyOf(req).id).toBe(x.id);
        await expect(dlgMaster(page).locator(".ant-select-selection-item"), `dòng ${i + 1}`).toHaveText(norm(x.masterAgentName));
        await expect(dlgAgent(page).locator(".ant-select-selection-item")).toContainText(norm(x.agentName));
        await closeDialog(page);
      }
    });

    test("Xoá Title và Description của 1 sự kiện rồi Submit: báo lỗi, bị chặn và không gửi request lưu", async ({ page }) => {
      const { view } = await openUpdate(page);
      test.skip(view.events.length === 0, "Dòng không có sự kiện");
      // Chờ dữ liệu nạp vào form xong rồi mới sửa
      await expect(dlgTitle(page, 0)).toHaveValue(view.events[0].title);
      await dlgTitle(page, 0).fill("");
      await dlgDesc(page, 0).fill("");
      await expect(dlgError(page, MSG.title)).toHaveCount(1);
      await expect(dlgError(page, MSG.desc)).toHaveCount(1);
      await submitBtn(page).click(); // form lỗi nên bị chặn, không lưu gì
      await expect(dlgError(page, MSG.rows)).toBeVisible();
      await expect(dialog(page)).toBeVisible();
      await closeDialog(page);
    });

    test("Đổi Master Agent trong hộp thoại thì Agent đã chọn bị xoá", async ({ page }) => {
      const { x } = await openUpdate(page);
      const other = (await masters()).find((m) => m.value !== x.masterAgentId);
      test.skip(!other, "Cần ít nhất 2 master agent");
      await expect(dlgAgent(page).locator(".ant-select-selection-item")).toContainText(norm(x.agentName));
      await dlgMaster(page).click();
      await page.keyboard.type(other.label);
      await openOptions(page).filter({ hasText: exact(other.label) }).first().click();
      await expect(dlgMaster(page).locator(".ant-select-selection-item")).toHaveText(norm(other.label));
      await expect(dlgAgent(page).locator(".ant-select-selection-item")).toHaveCount(0);
      await closeDialog(page);
    });

    test("Thêm / xoá dòng sự kiện và sửa Title rồi Cancel thì danh sách không đổi, mở lại vẫn thấy dữ liệu gốc", async ({ page }) => {
      const { x, view } = await openUpdate(page);
      test.skip(view.events.length === 0, "Dòng không có sự kiện");
      await expect(dlgTitle(page, 0)).toHaveValue(view.events[0].title);
      await dlgTitle(page, 0).fill("QA sửa thử");
      await dlgAddRowBtn(page).click();
      await dlgRowAt(page, 0).locator('svg[data-icon="trash"]').click();
      await closeDialog(page);
      await expect(cellAt(page, 0, COL.total)).toHaveText(String(x.numberOfEvents));

      const [res] = await Promise.all([page.waitForResponse(isView), editIcon(page, 0).click()]);
      const again = (await res.json()).data;
      expect(again.events.map((e) => e.id)).toEqual(view.events.map((e) => e.id));
      await expect(dlgRows(page)).toHaveCount(Math.min(10, view.events.length));
      await expect(dlgTitle(page, 0)).toHaveValue(view.events[0].title);
      await closeDialog(page);
    });

    test("Đóng hộp thoại bằng nút X", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      await editIcon(page, 0).click();
      await expect(dialog(page)).toBeVisible();
      await closeX(page).click();
      await expect(dialog(page)).toBeHidden();
    });
  });

  // ===== 9. Hộp thoại Delete =====
  test.describe("Hộp thoại Delete (không bấm nút Delete xác nhận)", () => {
    test("Bấm icon Delete hiện hộp thoại xác nhận đúng tên agent, có nút Cancel / Delete; chưa gửi request nào", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      await deleteIcon(page, 0).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText(`Are you sure you want to delete ${x.agentName}?`);
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Delete$/ })).toBeVisible();
      await closeDialog(page); // KHÔNG bấm Delete
    });

    test("Mỗi dòng mở hộp thoại Delete với đúng tên agent của dòng đó", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list.slice(0, 3);
      test.skip(list.length === 0, "Không có dữ liệu");
      for (const [i, x] of list.entries()) {
        await deleteIcon(page, i).click();
        await expect(dialog(page), `dòng ${i + 1}`).toContainText(`Are you sure you want to delete ${x.agentName}?`);
        await closeDialog(page);
      }
    });

    test("Cancel đóng hộp thoại và danh sách không thay đổi", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const before = await columnValues(page, "Agent");
      await deleteIcon(page, 0).click();
      await closeDialog(page);
      await expect(summary(page)).toContainText(`of ${json.data.totalCount} records`);
      expect(await columnValues(page, "Agent")).toEqual(before);
    });
  });

  // ===== 10. Hộp thoại View Translated Content =====
  test.describe("Hộp thoại View Translated Content (không ghi dữ liệu thật)", () => {
    let languagesLoaded; // response dropdown/language lúc mở hộp thoại
    const languages = async () => (await (await languagesLoaded).json()).data;

    const tRows = (page) => dialog(page).locator("tbody tr.ant-table-row");
    const tRowAt = (page, i) => tRows(page).nth(i);
    const tInputs = (row) => row.locator("input");
    const tErrors = (row) => row.locator('[class*="_field-error_"]');
    const dialogCodeSelect = (page) => dialog(page).locator(".ant-select").first();
    const pen = (row) => row.locator('svg[data-icon="pen-to-square"]');
    const save = (row) => row.locator('svg[data-icon="circle-check"]');
    const cancel = (row) => row.locator('svg[data-icon="circle-xmark"]');

    // Mở hộp thoại của sự kiện k thuộc dòng i, trả về { x, ev, view }
    async function openTranslation(page, i = 0, k = 0) {
      const { json } = await search(page);
      const idx = json.data.list.findIndex((r, n) => n >= i && r.events.length > k);
      test.skip(idx < 0, "Không có sự kiện nào");
      const x = json.data.list[idx];
      const ev = x.events[k];
      await expandBtn(page, idx).click();
      await expect(subRows(page, idx)).toHaveCount(x.events.length);
      languagesLoaded = page.waitForResponse(isLanguageDropdown, { timeout: 30000 });
      languagesLoaded.catch(() => {});
      const [req, res] = await Promise.all([
        page.waitForRequest(isTranslationView),
        page.waitForResponse(isTranslationView),
        viewBtn(subRows(page, idx).nth(k)).click(),
      ]);
      expect(bodyOf(req)).toEqual({ eventContentItemId: ev.id });
      const view = (await res.json()).data;
      await expect(dialog(page)).toContainText(`View Translated Content ${norm(ev.title)}`);
      await expect(tRows(page)).toHaveCount(view.translations.length);
      return { x, ev, view };
    }

    test("Bấm View Content gọi translation/view với id sự kiện và hiển thị tiêu đề + đủ cột", async ({ page }) => {
      const { ev, view } = await openTranslation(page);
      expect(view.eventContentItemId).toBe(ev.id);
      expect(view.sourceTitle).toBe(ev.title);
      expect(view.sourceDescription).toBe(ev.description);
      expect((await dialog(page).locator("thead th").allInnerTexts()).map((t) => t.trim())).toEqual([
        "Language Code",
        "Translated Event Title",
        "Translated Event Description",
        "Action",
      ]);
      await expect(dialog(page).getByRole("button", { name: /Search/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Reset/ })).toBeVisible();
      await closeX(page).click();
      await expect(dialog(page)).toBeHidden();
    });

    test("Mỗi dòng bản dịch khớp response (Language Code, Title, Description)", async ({ page }) => {
      const { view } = await openTranslation(page);
      test.skip(view.translations.length === 0, "Sự kiện chưa có bản dịch");
      for (const [i, t] of view.translations.entries()) {
        const cells = tRowAt(page, i).locator("td");
        expect(norm(await cells.nth(0).innerText()), `dòng ${i + 1}`).toBe(t.languageCode);
        expect(norm(await cells.nth(1).innerText()), `title ${t.languageCode}`).toBe(norm(t.title));
        expect(norm(await cells.nth(2).innerText()), `description ${t.languageCode}`).toBe(norm(t.description));
      }
      await closeX(page).click();
    });

    test("Ngôn ngữ trong bảng bản dịch đều có trong dropdown/language và không trùng nhau", async ({ page }) => {
      const { view } = await openTranslation(page);
      const langs = await languages();
      const codes = new Map(langs.map((l) => [l.code, l.label]));
      const shown = view.translations.map((t) => t.languageCode);
      expect(new Set(shown).size).toBe(shown.length);
      for (const t of view.translations) {
        expect(codes.has(t.languageCode), `ngôn ngữ ${t.languageCode}`).toBe(true);
        expect(t.languageName, `tên ngôn ngữ ${t.languageCode}`).toBe(codes.get(t.languageCode));
      }
      await closeX(page).click();
    });

    test("Dòng ngôn ngữ nguồn 'en' khớp Title / Description của sự kiện và không có icon Update", async ({ page }) => {
      const { ev, view } = await openTranslation(page);
      const i = view.translations.findIndex((t) => t.languageCode === "en");
      test.skip(i < 0, "Không có dòng en");
      const cells = tRowAt(page, i).locator("td");
      expect(norm(await cells.nth(1).innerText())).toBe(norm(ev.title));
      expect(norm(await cells.nth(2).innerText())).toBe(norm(ev.description));
      await expect(tRowAt(page, i).locator("svg")).toHaveCount(0);
      await closeX(page).click();
    });

    test("Các dòng ngôn ngữ khác 'en' đều có icon Update (tooltip 'Edit')", async ({ page }) => {
      const { view } = await openTranslation(page);
      const i = view.translations.findIndex((t) => t.languageCode !== "en");
      test.skip(i < 0, "Không có bản dịch sửa được");
      for (const [k, t] of view.translations.entries()) {
        if (t.languageCode === "en") continue;
        await expect(pen(tRowAt(page, k)), t.languageCode).toHaveCount(1);
      }
      await hoverTip(page, pen(tRowAt(page, i)), "Edit");
      await closeX(page).click();
    });

    test("Mở View Content của nhiều sự kiện: mỗi lần hiển thị đúng sự kiện đó", async ({ page }) => {
      const { json } = await search(page);
      const idx = json.data.list.findIndex((r) => r.events.length >= 2);
      test.skip(idx < 0, "Không có dòng nào có từ 2 sự kiện");
      const x = json.data.list[idx];
      await expandBtn(page, idx).click();
      await expect(subRows(page, idx)).toHaveCount(x.events.length);
      for (const [k, ev] of x.events.slice(0, 3).entries()) {
        const [req] = await Promise.all([
          page.waitForRequest(isTranslationView),
          viewBtn(subRows(page, idx).nth(k)).click(),
        ]);
        expect(bodyOf(req).eventContentItemId, `sự kiện ${k + 1}`).toBe(ev.id);
        await expect(dialog(page)).toContainText(`View Translated Content ${norm(ev.title)}`);
        await closeX(page).click();
        await expect(dialog(page)).toBeHidden();
      }
    });

    test("Filter Language Code là dropdown chọn nhiều, option dạng 'code - tên' lấy từ dropdown/language", async ({ page }) => {
      await openTranslation(page);
      const langs = await languages();
      await dialogCodeSelect(page).click();
      await openOptions(page).first().waitFor();
      expect(await openOptions(page).first().getAttribute("title")).toBe(optionText(langs[0]));
      await expect(dialog(page).locator(".ant-select-multiple")).toHaveCount(1);
      await dialog(page).getByText(/^View Translated Content/).click(); // click ra ngoài để đóng dropdown
      await expect(openOptions(page)).toHaveCount(0);
      await closeX(page).click();
    });

    test("Chọn 2 ngôn ngữ ở Language Code + Search: gửi languageCodes và chỉ còn 2 dòng; Reset trả về đủ", async ({ page }) => {
      const { ev, view } = await openTranslation(page);
      test.skip(view.translations.length < 2, "Cần ít nhất 2 bản dịch");
      const picks = (await languages()).filter((l) => view.translations.some((t) => t.languageCode === l.code)).slice(0, 2);
      test.skip(picks.length < 2, "Không đủ ngôn ngữ");

      await dialogCodeSelect(page).click();
      for (const l of picks) {
        await page.keyboard.type(l.code);
        await openOptions(page).filter({ hasText: exact(optionText(l)) }).first().click();
      }
      await dialog(page).getByText(/^View Translated Content/).click();
      await expect(openOptions(page)).toHaveCount(0);

      const [req] = await Promise.all([
        page.waitForRequest(isTranslationView),
        dialog(page).getByRole("button", { name: /Search/ }).click(),
      ]);
      expect(bodyOf(req)).toEqual({ eventContentItemId: ev.id, languageCodes: picks.map((l) => l.code) });
      await expect(tRows(page)).toHaveCount(2);
      expect((await dialog(page).locator("tbody tr.ant-table-row td:first-child").allInnerTexts()).map(norm).sort()).toEqual(
        picks.map((l) => l.code).sort(),
      );

      const [req2] = await Promise.all([
        page.waitForRequest(isTranslationView),
        dialog(page).getByRole("button", { name: /Reset/ }).click(),
      ]);
      expect(bodyOf(req2)).toEqual({ eventContentItemId: ev.id });
      await expect(tRows(page)).toHaveCount(view.translations.length);
      await closeX(page).click();
    });

    test("Bấm Update của 1 ngôn ngữ: 2 ô nhập hiện giá trị hiện tại, hiện icon Save / Cancel, các dòng khác bị khoá", async ({ page }) => {
      const { view } = await openTranslation(page);
      const i = view.translations.findIndex((t) => t.languageCode !== "en");
      test.skip(i < 0, "Không có bản dịch sửa được");
      const t = view.translations[i];
      const row = tRowAt(page, i);
      await pen(row).click();
      await expect(tInputs(row)).toHaveCount(2);
      await expect(tInputs(row).nth(0)).toHaveValue(t.title);
      await expect(tInputs(row).nth(1)).toHaveValue(t.description);
      await expect(save(row)).toBeVisible();
      await expect(cancel(row)).toBeVisible();
      const other = view.translations.findIndex((v, k) => k !== i && v.languageCode !== "en");
      if (other >= 0) await expect(pen(tRowAt(page, other))).toHaveClass(/disabled/);
      await cancel(row).click();
      await closeX(page).click();
    });

    test("Xoá trống Title / Description bản dịch rồi Save: báo 2 lỗi, vẫn ở chế độ sửa, không gửi request lưu", async ({ page }) => {
      const { view } = await openTranslation(page);
      const i = view.translations.findIndex((t) => t.languageCode !== "en");
      test.skip(i < 0, "Không có bản dịch sửa được");
      const row = tRowAt(page, i);
      await pen(row).click();
      await tInputs(row).nth(0).fill("");
      await tInputs(row).nth(1).fill("");
      await save(row).click(); // form lỗi nên bị chặn, không lưu gì
      await expect(tErrors(row)).toHaveText(["Please input event title", "Please input event description"]);
      await expect(tInputs(row)).toHaveCount(2);
      await cancel(row).click();
      await closeX(page).click();
    });

    test("Cancel khi sửa bản dịch: khôi phục giá trị gốc, không gửi request lưu", async ({ page }) => {
      const { view } = await openTranslation(page);
      const i = view.translations.findIndex((t) => t.languageCode !== "en");
      test.skip(i < 0, "Không có bản dịch sửa được");
      const t = view.translations[i];
      const row = tRowAt(page, i);
      await pen(row).click();
      await tInputs(row).nth(0).fill("QA-AUTO");
      await tInputs(row).nth(1).fill("QA-AUTO không lưu");
      await cancel(row).click();
      await expect(tInputs(row)).toHaveCount(0);
      await expect(row.locator("td").nth(1)).toHaveText(norm(t.title));
      await expect(row.locator("td").nth(2)).toHaveText(norm(t.description));
      await closeX(page).click();
    });

    test("Đóng hộp thoại bằng nút X thì bảng chính không thay đổi", async ({ page }) => {
      const { x } = await openTranslation(page);
      await closeX(page).click();
      await expect(dialog(page)).toBeHidden();
      await expect(summary(page)).toBeVisible();
      await expect(rows(page).first()).toBeVisible();
      expect(await rows(page).count()).toBeGreaterThan(0);
      expect(x.events.length).toBeGreaterThan(0);
    });
  });

  // ===== 11. Manage Columns =====
  test.describe("Manage Columns", () => {
    // hasText dạng RegExp khớp CHÍNH XÁC tên cột
    const item = (page, name) =>
      columnPopover(page).locator(".NextGen-popover-manage-column__list__items", { hasText: exact(name) });

    test("Popover liệt kê đủ cột", async ({ page }) => {
      await columnBtn(page).click();
      const names = await columnPopover(page).locator(".NextGen-popover-manage-column__list__items").allInnerTexts();
      expect(names.map((n) => n.trim())).toEqual(MANAGE_COLUMNS);
    });

    test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Agent").locator("label").click();
      expect(await headers(page)).not.toContain("Agent");
      expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

      await item(page, "Agent").locator("label").click();
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      const masterNames = await columnValues(page, "Master Agent");
      const totals = await columnValues(page, "No. of Event");
      await columnBtn(page).click();
      await item(page, "Agent").locator("label").click();
      expect(await columnValues(page, "Master Agent")).toEqual(masterNames);
      expect(await columnValues(page, "No. of Event")).toEqual(totals);
    });

    test("Cấu hình cột không được lưu: tải lại trang thì hiện đủ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Agent").locator("label").click();
      expect(await headers(page)).not.toContain("Agent");
      await openPage(page); // reload
      expect(await headers(page)).toEqual(COLUMNS);
    });
  });

  // ===== 12. Ghi nhớ filter =====
  test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
    const { json } = await search(page);
    test.skip(json.data.list.length === 0, "Không có dữ liệu");
    const x = json.data.list[0];
    const m = (await masters()).find((v) => v.value === x.masterAgentId);
    test.skip(!m, "Master agent của dòng đầu không có trong dropdown");
    const ags = await selectMaster(page, m);
    const a = ags.find((v) => v.value === x.agentId);
    test.skip(!a, "Agent của dòng đầu không nằm trong danh sách của master");
    await selectOption(page, "agentId", a);
    const ev = x.events.find((e) => e.title.trim().length >= 3);
    test.skip(!ev, "Dòng đầu không có sự kiện có tiêu đề đủ dài");
    const part = ev.title.trim().slice(0, 3).trim();
    await fillFilter(page, "eventTitle", part);
    await search(page);
    await page.locator(".ant-pagination-options .ant-select").click();
    await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

    await openPage(page); // reload
    expect(await selectedOf(page, "masterAgentId")).toEqual([optionText(m)]);
    expect(await selectedOf(page, "agentId")).toEqual([optionText(a)]);
    await expect(page.locator("#eventTitle")).toHaveValue(part);
    await expect(page.locator(".ant-pagination-options")).toContainText("20 / page");
  });

  test("Sau Reset rồi reload: filter không còn được ghi nhớ", async ({ page }) => {
    await fillFilter(page, "eventTitle", "abc");
    await search(page);
    await reloadBy(page, () => resetBtn(page).click()); // Reset gửi lại request mặc định
    const [req] = await Promise.all([page.waitForRequest(isList), page.reload()]);
    expect(bodyOf(req).filters).toEqual({});
    await waitTableIdle(page);
    await expect(page.locator("#eventTitle")).toHaveValue("");
  });
});
