// Games > Effective Turnover Exclusion  (https://dev-bo.royaledge.io/game/effective-turnover-exclusion)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/game_effective_turnover_exclusion.spec.js --project=setup --project=chromium
//
// Màn hình (breadcrumb "Turnover Exclusion") quản lý danh sách game bị loại khỏi tính effective turnover.
// Mỗi dòng = 1 game (Game Name / Game Code / Game Category). Danh sách CÓ phân trang (10/20/50/100/200 dòng / trang)
// nhưng dữ liệu thường rất ít (vài game) nên các test phân trang tự skip khi tổng số bản ghi <= 20.
// Có checkbox chọn dòng + nút Bulk Delete, mỗi dòng có 1 icon Delete (thùng rác). Cột Action không sort, chỉ Game Name sort được.
// Filter Code / Name đều là dropdown chọn nhiều (lấy từ dropdown/game) và cùng gửi lên API key `ids` (id game);
// nếu chọn cả 2 mà không cùng 1 game thì UI gửi ids=[-1] (không có kết quả).
//
// Màn hình có các thao tác GHI dữ liệu thật: Add New (Submit), Upload CSV rồi Submit, Delete 1 dòng, Bulk Delete.
// Test KHÔNG bấm Submit, KHÔNG bấm Delete trong hộp thoại xác nhận: chỉ mở hộp thoại, kiểm tra nội dung, thao tác phía
// trình duyệt (chọn game rồi Add vào bảng tạm, upload file CSV - UI đọc file tại chỗ, không gửi request) rồi bấm Cancel / Close.
// Mọi test đều kiểm tra không có request ghi dữ liệu nào được gửi đi (watchWrites + route chặn thêm 1 lớp bảo hiểm - request
// ghi nếu có vẫn bị ghi nhận vào `writes` nên test sẽ fail nhưng dữ liệu thật không bị đổi).
// Export tạo job ở Download History (toast "Download is processing..."); nếu file cùng filter đã tồn tại thì hộp thoại
// "already exist in download history" hiện ra - test KHÔNG bấm Download New, chỉ đóng hộp thoại.
// Không hard-code dữ liệu - mọi giá trị lấy từ chính danh sách / response dropdown.
const fs = require("fs");
const { test, expect } = require("@playwright/test");

test.use({ viewport: { width: 1920, height: 1080 } });

const URL = "/game/effective-turnover-exclusion";

// Đúng thứ tự hiển thị (cột đầu là checkbox chọn dòng nên header rỗng)
const HEADERS = ["", "Game Name", "Game Code", "Game Category", "Action"];
// Các cột trong Manage Columns / trong payload Export (không có cột checkbox)
const COLUMNS = ["Game Name", "Game Code", "Game Category", "Action"];
const COL = { check: 0, name: 1, code: 2, category: 3, action: 4 };

// Cột duy nhất có thể sort -> tên field gửi lên API (mặc định sort theo id giảm dần)
const SORTABLE = { "Game Name": "gameName" };

// Request đọc dữ liệu (mọi POST còn lại coi là ghi)
const READ = /\/(list|details|download|view|dropdown|validate_[a-z_]+)$|\/dropdown\//;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const isList = (r) =>
  reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/game/effective-turnover-exclusion/list");
const isDownload = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/download");
const isGameDropdown = (r) => reqOf(r).url().endsWith("/dropdown/game");
const isCategoryDropdown = (r) => reqOf(r).url().endsWith("/dropdown/gamecategory");
const isAvailable = (r) => reqOf(r).url().endsWith("/dropdown/game/effective-turnover-exclusion/available");

const rows = (page) => page.locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
const rowCheckbox = (page, i) => rowAt(page, i).locator('input[type="checkbox"]');
const deleteIcon = (page, i) => rowAt(page, i).locator('svg[data-icon="trash"]');
const bulkDeleteBtn = (page) => page.locator("button.icon-bulkAction");
const selectAllBox = (page) => page.getByRole("checkbox", { name: "Select all" });

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
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
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

// Phần tử bao 1 filter (theo id của input bên trong)
const filterEl = (page, id) =>
  page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });

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

// Chờ bảng ổn định sau khi gọi API.
// LƯU Ý (UI, khám phá bằng MCP): khi filter vừa thay đổi, Search đôi khi gửi 2 request list GIỐNG HỆT nhau cách nhau ~200ms.
// Request thứ 2 có thể bị nhầm là request của thao tác kế tiếp (sort / đổi trang / search) -> chờ mạng yên (networkidle)
// sau mỗi lần gọi để loại request thừa này.
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
}

// Bấm Search, trả về { body: request body, status, json: response body }.
// Lấy response từ chính request vừa gửi (không dùng waitForResponse riêng) để không bị lệch khi search liên tiếp.
async function search(page) {
  const [req] = await Promise.all([page.waitForRequest(isList), searchBtn(page).click()]);
  const res = await req.response();
  const json = await res.json();
  await settle(page);
  return { body: JSON.parse(req.postData()), status: res.status(), json };
}

// Thực hiện 1 hành động làm bảng gọi lại API (đổi trang, sort...) rồi trả về { body, json }
async function reloadFull(page, action) {
  const [req] = await Promise.all([page.waitForRequest(isList), action()]);
  const res = await req.response();
  const json = await res.json();
  await settle(page);
  return { body: JSON.parse(req.postData()), json };
}
// Như reloadFull nhưng chỉ trả về request body
const reloadBy = async (page, action) => (await reloadFull(page, action)).body;

const headers = async (page) =>
  (await page.locator(".ant-table-thead th").allInnerTexts()).map((t) => t.trim());

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

// Toàn bộ các dòng của bảng dạng { "Game Name": "...", "Game Code": "...", ... }
async function tableRecords(page) {
  const heads = await headers(page);
  const cells = await rows(page).evaluateAll((trs) =>
    trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim())),
  );
  return cells.map((r) => Object.fromEntries(heads.map((h, i) => [h, r[i]])));
}

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
// KHÔNG click giữa ô: với dropdown chọn nhiều, vị trí đó có thể rơi vào nút (x) của chip đã chọn
// -> bấm vào sẽ XOÁ giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (theo tên) của filter dạng dropdown rồi đóng dropdown.
// Gõ tên vào ô tìm kiếm trước để option chắc chắn nằm trong danh sách hiển thị (danh sách ảo).
async function selectOption(page, id, title, matcher = exact(title, "i")) {
  await openDropdown(page, id);
  await page.keyboard.type(title);
  await openOptions(page).filter({ hasText: matcher }).first().click();
  // Dropdown chọn nhiều không tự đóng và Esc cũng không đóng được -> click ra ngoài.
  // (Nếu để mở, lần click tiếp theo vào ô sẽ làm mất giá trị đang chọn)
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Đọc toàn bộ option đang có (trong DOM) của 1 dropdown
async function dropdownOptions(page, id) {
  await openDropdown(page, id);
  await openOptions(page).first().waitFor();
  const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  // Click ra ngoài để đóng dropdown - phím Esc không đóng được khi chưa gõ tìm kiếm
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
  return titles;
}

// Các giá trị đang được chọn của 1 filter (chip / giá trị đơn)
const selectedTitles = (page, id) =>
  filterEl(page, id)
    .locator(".ant-select-selection-item[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));

// Tổng số giá trị đang chọn của 1 filter chọn nhiều giá trị. Khi chọn nhiều, ô filter chỉ hiện 1 chip và gom phần còn lại
// thành "+ N ..." (chip này không có title) nên phải cộng cả hai lại.
async function selectedCount(page, id) {
  // Bỏ qua các chip ẩn (aria-hidden) dùng để đo kích thước khi antd gom chip
  const shown = await filterEl(page, id)
    .locator('.ant-select-selection-overflow-item:not([aria-hidden="true"]) .ant-select-selection-item[title]')
    .count();
  const rest = await filterEl(page, id).locator(".ant-select-selection-overflow-item-rest").allInnerTexts();
  const hidden = rest.reduce((sum, t) => sum + Number(t.match(/\+\s*(\d+)/)?.[1] ?? 0), 0);
  return shown + hidden;
}

// Danh sách luôn có dữ liệu; nếu trống thì skip
async function ensureData(page, test) {
  if ((await rows(page).count()) === 0) test.skip(true, "Danh sách trống");
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

// Đóng hộp thoại bằng Cancel (không bao giờ bấm Submit / Delete)
async function closeDialog(page) {
  await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
  await expect(dialog(page)).toBeHidden();
}

// ----- Hộp thoại Add New Exclusion -----
const addSelect = (page) => dialog(page).locator(".ant-select").first();
const addChips = (page) => dialog(page).locator(".ant-select-selection-item[title]");
const gridRows = (page) => dialog(page).locator(".ant-table-body tbody tr.ant-table-row");
const gridCodes = (page) =>
  gridRows(page).evaluateAll((trs) => trs.map((t) => t.children[1].innerText.trim()));
const gridDeleteBtn = (page) => dialog(page).locator('button[title="Delete"]');
const gridSelectAll = (page) => dialog(page).locator('thead input[type="checkbox"]');
const submitBtn = (page) => dialog(page).getByRole("button", { name: /Submit$/ });
const modalTitle = (page) => dialog(page).locator(".ant-modal-title");

// Mở hộp thoại Add New và trả về danh sách game có thể thêm (response dropdown/game/effective-turnover-exclusion/available).
// API này chỉ được gọi ở LẦN MỞ ĐẦU TIÊN sau khi tải trang -> các lần mở sau không chờ response.
async function openAdd(page) {
  const [res] = await Promise.all([page.waitForResponse(isAvailable), addBtn(page).click()]);
  await expect(modalTitle(page)).toHaveText("Add New Exclusion");
  return (await res.json()).data;
}

// Chọn nhiều game trong ô "Game Code" của hộp thoại (gõ code để option chắc chắn có trong DOM) rồi đóng dropdown
async function pickAvailable(page, codes) {
  await addSelect(page).click();
  for (const code of codes) {
    await page.keyboard.type(code);
    await openOptions(page).filter({ hasText: exact(code) }).first().click();
  }
  await modalTitle(page).click(); // click ra ngoài để đóng dropdown (Esc không đóng được dropdown chọn nhiều)
  await expect(openOptions(page)).toHaveCount(0);
}

// Tên file / nội dung CSV tạm để upload (UI đọc file tại chỗ, không gửi request)
const csvFile = (name, lines) => ({ name, mimeType: "text/csv", buffer: Buffer.from(lines.join("\n") + "\n") });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Games > Effective Turnover Exclusion", () => {
  let writes;
  let gamesLoaded; // promise của response dropdown/game (danh sách game) lúc mở trang
  let categoriesLoaded; // promise của response dropdown/gamecategory
  // Danh sách game { value, code, label } mà dropdown/game trả về
  const games = async () => (await (await gamesLoaded).json()).data;
  const categories = async () => (await (await categoriesLoaded).json()).data;
  // Game có tên / code xuất hiện đúng 1 lần (tên trùng nhau thì không phân biệt được option khi chọn bằng tên)
  const uniqueGames = async () => {
    const all = await games();
    return all.filter(
      (g) => all.filter((x) => x.label === g.label).length === 1 && all.filter((x) => x.code === g.code).length === 1,
    );
  };
  // Category có tên xuất hiện đúng 1 lần
  const uniqueCategories = async () => {
    const all = await categories();
    return all.filter((c) => all.filter((x) => x.label === c.label).length === 1);
  };
  // Game (trong dropdown/game) của 1 dòng danh sách: tìm theo gameId
  const gameOf = async (row) => (await uniqueGames()).find((g) => g.value === row.gameId);

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, số dòng/trang và cách sắp xếp được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__effective_turnover_exclusion_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/game_effective-turnover-exclusion_(filter|page_size)$|^sorter__game_effective-turnover-exclusion$/.test(k)) {
          localStorage.removeItem(k);
        }
      }
      sessionStorage.setItem("__effective_turnover_exclusion_spec_cleared", "1");
    });
    writes = watchWrites(page);
    await blockWrites(page);
    gamesLoaded = page.waitForResponse(isGameDropdown, { timeout: 60000 });
    gamesLoaded.catch(() => {});
    categoriesLoaded = page.waitForResponse(isCategoryDropdown, { timeout: 60000 });
    categoriesLoaded.catch(() => {});
    await openPage(page);
  });

  // Mọi test đều không được gửi request ghi dữ liệu
  test.afterEach(async () => {
    expect(writes, "Không được gửi request ghi dữ liệu").toEqual([]);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, đủ 3 filter và 2 nút Search/Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Turnover Exclusion");
      for (const [label, id] of [
        ["Code", "code"],
        ["Name", "name"],
        ["Game Category", "gameCategoryId"],
      ]) {
        await expect(filterEl(page, id), `thiếu filter ${label}`).toContainText(label);
        await expect(filterEl(page, id)).toBeVisible();
      }
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: tất cả để trống", async ({ page }) => {
      for (const id of ["code", "name", "gameCategoryId"]) {
        await expect(filterEl(page, id).locator(".ant-select-selection-item"), `#${id} phải trống`).toHaveCount(0);
      }
    });

    test("Cả 3 filter đều là dropdown chọn nhiều giá trị, có tìm kiếm", async ({ page }) => {
      for (const id of ["code", "name", "gameCategoryId"]) {
        await expect(filterEl(page, id).locator(".ant-select-multiple"), id).toHaveCount(1);
        await expect(filterEl(page, id).locator(".ant-select-show-search"), id).toHaveCount(1);
      }
    });

    test("Có nút Add New, Export, Manage Columns, checkbox chọn dòng và Bulk Delete (tắt khi chưa chọn dòng)", async ({ page }) => {
      await expect(addBtn(page)).toBeVisible();
      await expect(exportBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
      await expect(bulkDeleteBtn(page)).toBeVisible();
      await expect(bulkDeleteBtn(page)).toBeDisabled();
      await expect(selectAllBox(page)).toBeVisible();
    });

    test(`Bảng có đủ ${HEADERS.length} cột (checkbox + 4 cột dữ liệu) đúng thứ tự`, async ({ page }) => {
      expect(await headers(page)).toEqual(HEADERS);
    });

    test("Mặc định: trang 1, 10 dòng, sắp xếp mới nhất (id giảm dần) lên đầu, không gửi filter", async ({ page }) => {
      const { body, json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc" });
      expect(body.filters).toEqual({});
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
    test("Mỗi dòng khớp response API (Game Name, Game Code, Game Category)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      const records = await tableRecords(page);
      expect(records).toHaveLength(list.length);

      records.forEach((r, i) => {
        const g = list[i];
        const at = `dòng ${i + 1} (exclusion ${g.id}, game ${g.gameId})`;
        expect(r["Game Name"], at).toBe(norm(g.gameName));
        expect(r["Game Code"], at).toBe(norm(g.gameCode));
        expect(r["Game Category"], at).toBe(norm(g.gameCategory));
      });
    });

    test("Định dạng: Name / Code / Category không rỗng; id và game không trùng nhau giữa các dòng", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const col of ["Game Name", "Game Code", "Game Category"]) {
        for (const v of await columnValues(page, col)) expect(v, col).not.toBe("");
      }
      const list = json.data.list;
      expect(new Set(list.map((g) => g.id)).size).toBe(list.length);
      expect(new Set(list.map((g) => g.gameId)).size).toBe(list.length);
      const codes = await columnValues(page, "Game Code");
      expect(new Set(codes).size).toBe(codes.length);
    });

    test("Game của mỗi dòng là game có thật trong dropdown/game (đúng code)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const all = await games();
      for (const g of json.data.list) {
        const found = all.find((x) => x.value === g.gameId);
        expect(found, `game ${g.gameId}`).toBeTruthy();
        expect(found.code, `game ${g.gameId}`).toBe(g.gameCode);
      }
    });

    test("Game Category của mỗi dòng là category có thật trong dropdown/gamecategory", async ({ page }) => {
      await ensureData(page, test);
      const labels = (await categories()).map((c) => norm(c.label));
      for (const v of await columnValues(page, "Game Category")) expect(labels).toContain(v);
    });

    test("Cột checkbox mỗi dòng có 1 ô chọn; cột Action mỗi dòng chỉ có 1 icon Delete (hover xem tooltip, không bấm)", async ({ page }) => {
      const n = Math.min(3, await rows(page).count());
      test.skip(n === 0, "Không có dữ liệu");
      for (let i = 0; i < n; i++) {
        await expect(rowCheckbox(page, i)).toHaveCount(1);
        await expect(cellAt(page, i, COL.action).locator("svg")).toHaveCount(1);
        await expect(deleteIcon(page, i)).toHaveCount(1);
        await hoverTip(page, deleteIcon(page, i), "Delete");
      }
    });
  });

  // ===== 3. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Option của Code là toàn bộ code lấy từ API dropdown/game", async ({ page }) => {
      const codes = (await games()).map((g) => g.code);
      test.skip(codes.length === 0, "Không có game nào");
      const titles = await dropdownOptions(page, "code");
      expect([...titles].sort()).toEqual([...codes].sort());
    });

    test("Option của Name là toàn bộ tên game lấy từ API dropdown/game", async ({ page }) => {
      const names = (await games()).map((g) => g.label);
      test.skip(names.length === 0, "Không có game nào");
      const titles = await dropdownOptions(page, "name");
      expect([...titles].sort()).toEqual([...names].sort());
    });

    test("Option của Game Category lấy từ API dropdown/gamecategory", async ({ page }) => {
      const labels = (await categories()).map((c) => c.label);
      test.skip(labels.length === 0, "Không có Game Category nào");
      const titles = await dropdownOptions(page, "gameCategoryId");
      expect([...titles].sort()).toEqual([...labels].sort());
    });

    test("Lọc theo Code của dòng đầu tiên gửi ids=[gameId] và chỉ còn đúng game đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      const game = await gameOf(first);
      test.skip(!game, "Game của dòng đầu bị trùng tên / code với game khác");

      await selectOption(page, "code", game.code);
      expect(await selectedTitles(page, "code")).toEqual([game.code]);
      const { body, json: res } = await search(page);
      expect(body.filters).toEqual({ ids: [first.gameId] });
      expect(res.data.list.map((x) => x.id)).toEqual([first.id]);
      await expect(rows(page)).toHaveCount(1);
      expect(await columnValues(page, "Game Code")).toEqual([norm(first.gameCode)]);
      await expect(summary(page)).toHaveText("Showing 1 - 1 of 1 records");
    });

    test("Lọc theo Name của dòng đầu tiên gửi ids=[gameId] và chỉ còn đúng game đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      const game = await gameOf(first);
      test.skip(!game, "Game của dòng đầu bị trùng tên / code với game khác");

      await selectOption(page, "name", game.label);
      expect(await selectedTitles(page, "name")).toEqual([game.label]);
      const { body, json: res } = await search(page);
      expect(body.filters).toEqual({ ids: [first.gameId] });
      expect(res.data.list.map((x) => x.id)).toEqual([first.id]);
      expect(await columnValues(page, "Game Name")).toEqual([norm(first.gameName)]);
    });

    test("Code và Name cùng 1 game: gửi ids=[gameId] và vẫn còn game đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      const game = await gameOf(first);
      test.skip(!game, "Game của dòng đầu bị trùng tên / code với game khác");

      await selectOption(page, "code", game.code);
      await selectOption(page, "name", game.label);
      const { body, json: res } = await search(page);
      expect(body.filters).toEqual({ ids: [first.gameId] });
      expect(res.data.list.map((x) => x.id)).toEqual([first.id]);
    });

    test("Code và Name là 2 game khác nhau: giao nhau rỗng nên không có kết quả (UI gửi ids=[-1])", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Cần ít nhất 2 game trong danh sách");
      const [a, b] = json.data.list;
      const ga = await gameOf(a);
      const gb = await gameOf(b);
      test.skip(!ga || !gb, "Tên / code game bị trùng với game khác");

      await selectOption(page, "code", ga.code);
      await selectOption(page, "name", gb.label);
      const { body, json: res } = await search(page);
      expect(body.filters.ids).toEqual([-1]);
      expect(res.data.totalCount).toBe(0);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText("There are no entries found").first()).toBeVisible();
    });

    // Chỉ kiểm tra request UI gửi đi. Kết quả backend khi ids có từ 2 giá trị trở lên chưa được xác nhận
    // (khám phá bằng MCP: API trả status=fail, messageCode=UNKNOWN_ERROR) nên KHÔNG assert response ở test này.
    test("Code chọn nhiều giá trị: gửi đủ các id game đã chọn", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Cần ít nhất 2 game trong danh sách");
      const [a, b] = json.data.list;
      const ga = await gameOf(a);
      const gb = await gameOf(b);
      test.skip(!ga || !gb, "Tên / code game bị trùng với game khác");

      await selectOption(page, "code", ga.code);
      await selectOption(page, "code", gb.code);
      await expect.poll(() => selectedCount(page, "code")).toBe(2);
      const { body } = await search(page);
      expect([...body.filters.ids].sort((x, y) => x - y)).toEqual([a.gameId, b.gameId].sort((x, y) => x - y));
    });

    test("Name chọn nhiều giá trị: gửi đủ các id game đã chọn", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Cần ít nhất 2 game trong danh sách");
      const [a, b] = json.data.list;
      const ga = await gameOf(a);
      const gb = await gameOf(b);
      test.skip(!ga || !gb, "Tên / code game bị trùng với game khác");

      await selectOption(page, "name", ga.label);
      await selectOption(page, "name", gb.label);
      await expect.poll(() => selectedCount(page, "name")).toBe(2);
      const { body } = await search(page);
      expect([...body.filters.ids].sort((x, y) => x - y)).toEqual([a.gameId, b.gameId].sort((x, y) => x - y));
    });

    test("Game chưa nằm trong danh sách loại trừ: lọc theo Code không có kết quả", async ({ page }) => {
      const { json } = await search(page);
      const inList = new Set(json.data.list.map((g) => g.gameId));
      test.skip(json.data.totalCount > json.data.list.length, "Danh sách nhiều hơn 1 trang, không xác định được game chưa bị loại trừ");
      const other = (await uniqueGames()).find((g) => !inList.has(g.value));
      test.skip(!other, "Mọi game đều đã nằm trong danh sách");

      await selectOption(page, "code", other.code);
      const { body, json: res } = await search(page);
      expect(body.filters.ids).toEqual([other.value]);
      expect(res.data.totalCount).toBe(0);
      await expect(page.getByText("There are no entries found").first()).toBeVisible();
    });

    test("Lọc theo Game Category của dòng đầu tiên gửi gameCategoryId=[id] và mọi dòng khớp", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      const cat = (await uniqueCategories()).find((c) => norm(c.label) === norm(first.gameCategory));
      test.skip(!cat, "Tên Game Category của dòng đầu bị trùng với category khác");

      await selectOption(page, "gameCategoryId", cat.label);
      expect(await selectedTitles(page, "gameCategoryId")).toEqual([cat.label]);
      const { body, json: res } = await search(page);
      expect(body.filters).toEqual({ gameCategoryId: [cat.value] });
      expect(res.data.list.map((x) => x.id)).toContain(first.id);
      for (const g of res.data.list) expect(norm(g.gameCategory)).toBe(norm(cat.label));
      for (const v of await columnValues(page, "Game Category")) expect(v).toBe(norm(cat.label));
      await expect(summary(page)).toContainText(`of ${res.data.totalCount} records`);
    });

    test("Game Category chọn được nhiều giá trị: gửi đủ id, mọi dòng thuộc 1 trong các category, tổng = tổng từng category", async ({ page }) => {
      test.setTimeout(120000);
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const unique = await uniqueCategories();
      const c1 = unique.find((c) => norm(c.label) === norm(json.data.list[0].gameCategory));
      const c2 = unique.find((c) => c.value !== c1?.value);
      test.skip(!c1 || !c2, "Cần ít nhất 2 Game Category có tên không trùng nhau");

      await selectOption(page, "gameCategoryId", c1.label);
      const t1 = (await search(page)).json.data.totalCount;
      await selectOption(page, "gameCategoryId", c2.label);
      await expect.poll(() => selectedCount(page, "gameCategoryId")).toBe(2);
      const both = await search(page);
      expect([...both.body.filters.gameCategoryId].sort((x, y) => x - y)).toEqual([c1.value, c2.value].sort((x, y) => x - y));
      for (const g of both.json.data.list) expect([norm(c1.label), norm(c2.label)]).toContain(norm(g.gameCategory));

      await resetBtn(page).click();
      await selectOption(page, "gameCategoryId", c2.label);
      const t2 = (await search(page)).json.data.totalCount;
      expect(both.json.data.totalCount).toBe(t1 + t2);
    });

    test("Số game theo từng Game Category (của các dòng đang có) cộng lại bằng tổng số dòng", async ({ page }) => {
      test.setTimeout(120000);
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      test.skip(json.data.totalCount > json.data.list.length, "Danh sách nhiều hơn 1 trang");
      const unique = await uniqueCategories();
      const labels = [...new Set(json.data.list.map((g) => norm(g.gameCategory)))];
      const cats = labels.map((l) => unique.find((c) => norm(c.label) === l));
      test.skip(cats.some((c) => !c), "Có Game Category bị trùng tên với category khác");

      let sum = 0;
      for (const c of cats) {
        await resetBtn(page).click();
        await selectOption(page, "gameCategoryId", c.label);
        sum += (await search(page)).json.data.totalCount;
      }
      expect(sum).toBe(json.data.totalCount);
    });

    test("Kết hợp Code và Game Category cùng lúc (AND): đúng category thì còn, sai category thì rỗng", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      const game = await gameOf(first);
      const unique = await uniqueCategories();
      const own = unique.find((c) => norm(c.label) === norm(first.gameCategory));
      const other = unique.find((c) => norm(c.label) !== norm(first.gameCategory));
      test.skip(!game || !own || !other, "Thiếu game / category không trùng tên để so sánh");

      await selectOption(page, "code", game.code);
      await selectOption(page, "gameCategoryId", own.label);
      const hit = await search(page);
      expect(hit.body.filters).toEqual({ ids: [first.gameId], gameCategoryId: [own.value] });
      expect(hit.json.data.list.map((x) => x.id)).toEqual([first.id]);

      await resetBtn(page).click();
      await selectOption(page, "code", game.code);
      await selectOption(page, "gameCategoryId", other.label);
      const miss = await search(page);
      expect(miss.body.filters).toEqual({ ids: [first.gameId], gameCategoryId: [other.value] });
      expect(miss.json.data.totalCount).toBe(0);
    });

    test("Không có kết quả -> hiển thị 'There are no entries found', không còn phân trang / dòng tóm tắt", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      const unique = await uniqueCategories();
      const other = unique.find((c) => norm(c.label) !== norm(first.gameCategory));
      const game = await gameOf(first);
      test.skip(!other || !game, "Thiếu game / category không trùng tên để so sánh");

      await selectOption(page, "code", game.code);
      await selectOption(page, "gameCategoryId", other.label);
      const res = await search(page);
      expect(res.json.data.totalCount).toBe(0);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText("There are no entries found").first()).toBeVisible();
      await expect(page.locator(".ant-pagination")).toHaveCount(0);
      await expect(summary(page)).toHaveCount(0);
    });

    test("Gõ từ khoá không có trong danh sách option -> dropdown hiển thị 'No data'", async ({ page }) => {
      await openDropdown(page, "code");
      await page.keyboard.type(`khong-co-${Date.now()}`);
      await expect(page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")).toContainText("No data");
      await expect(openOptions(page)).toHaveCount(0);
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
    test("Reset xoá toàn bộ filter đã chọn và hiển thị lại toàn bộ dữ liệu", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const total = json.data.totalCount;
      const first = json.data.list[0];
      const game = await gameOf(first);
      const cat = (await uniqueCategories()).find((c) => norm(c.label) === norm(first.gameCategory));
      test.skip(!game || !cat, "Tên / code game hoặc category của dòng đầu bị trùng");

      await selectOption(page, "code", game.code);
      await selectOption(page, "gameCategoryId", cat.label);
      await search(page);

      await resetBtn(page).click();
      for (const id of ["code", "name", "gameCategoryId"]) {
        await expect(filterEl(page, id).locator(".ant-select-selection-item"), id).toHaveCount(0);
      }

      const after = await search(page);
      expect(after.body.filters).toEqual({});
      expect(after.json.data.totalCount).toBe(total);
    });
  });

  // ===== 5. Phân trang =====
  test.describe("Phân trang", () => {
    test("Đổi số dòng / trang: có đủ 5 mức, chọn 20 thì gửi pageSize=20 và về trang 1", async ({ page }) => {
      await page.locator(".ant-pagination-options .ant-select").click();
      const sizes = await openOptions(page).allInnerTexts();
      expect(sizes).toEqual(["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"]);

      const { body, json } = await reloadFull(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
      expect(body.pageSize).toBe(20);
      expect(body.page).toBe(1);
      await expect(page.locator(".ant-pagination-options")).toContainText("20 / page");
      await expect(rows(page)).toHaveCount(Math.min(20, json.data.totalCount));
      await expect(summary(page)).toHaveText(
        new RegExp(`^Showing 1 - ${Math.min(20, json.data.totalCount)} of ${json.data.totalCount} records$`),
      );
    });

    test.describe("Nhiều trang (cần > 20 bản ghi)", () => {
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
        await expect(page.locator(".ant-pagination-prev button")).toBeDisabled();

        const next = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
        expect(next.page).toBe(2);
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");

        const prev = await reloadBy(page, () => page.locator(".ant-pagination-prev").click());
        expect(prev.page).toBe(1);
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
      });

      test("Giữ nguyên filter khi chuyển trang", async ({ page }) => {
        const { json } = await search(page);
        const cat = (await uniqueCategories()).find((c) => norm(c.label) === norm(json.data.list[0].gameCategory));
        test.skip(!cat, "Tên Game Category của dòng đầu bị trùng với category khác");
        await selectOption(page, "gameCategoryId", cat.label);
        const first = await search(page);
        test.skip(first.json.data.totalCount <= 10, "Filter chỉ có 1 trang");

        const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
        expect(body.page).toBe(2);
        expect(body.filters).toEqual(first.body.filters);
        for (const v of await columnValues(page, "Game Category")) expect(v).toBe(norm(cat.label));
      });

      test("Giữ nguyên sắp xếp khi chuyển trang", async ({ page }) => {
        const sorted = await reloadBy(page, () =>
          page.locator(".ant-table-thead th", { hasText: exact("Game Name") }).click(),
        );
        expect(sorted).toMatchObject({ sortBy: "gameName", sortDirection: "asc" });
        const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
        expect(body).toMatchObject({ page: 2, sortBy: "gameName", sortDirection: "asc" });
      });
    });
  });

  // ===== 6. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    const th = (page, column) => page.locator(".ant-table-thead th", { hasText: exact(column) });

    for (const [column, sortBy] of Object.entries(SORTABLE)) {
      test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
        // Cột chữ phụ thuộc collation của server nên chỉ kiểm tra request, không kiểm tra thứ tự dữ liệu
        const asc = await reloadBy(page, () => th(page, column).click());
        expect(asc).toMatchObject({ sortBy, sortDirection: "asc" });

        const desc = await reloadBy(page, () => th(page, column).click());
        expect(desc).toMatchObject({ sortBy, sortDirection: "desc" });

        // Click lần 3: bỏ sort -> quay về mặc định id giảm dần
        const none = await reloadBy(page, () => th(page, column).click());
        expect(none).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      });
    }

    test("Sort Game Name: dữ liệu vẫn đủ số dòng và đúng tập game", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Không đủ dữ liệu để kiểm tra");
      const ids = json.data.list.map((g) => g.id).sort((a, b) => a - b);
      const asc = await reloadFull(page, () => th(page, "Game Name").click());
      expect(asc.json.data.list.map((g) => g.id).sort((a, b) => a - b)).toEqual(ids);
      await expect(rows(page)).toHaveCount(json.data.list.length);
      expect(await columnValues(page, "Game Name")).toEqual(asc.json.data.list.map((g) => norm(g.gameName)));
    });

    test("Sort giữ nguyên filter đang áp dụng", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Không đủ dữ liệu để kiểm tra");
      const cat = (await uniqueCategories()).find((c) => norm(c.label) === norm(json.data.list[0].gameCategory));
      test.skip(!cat, "Tên Game Category của dòng đầu bị trùng với category khác");
      await selectOption(page, "gameCategoryId", cat.label);
      const first = await search(page);
      const body = await reloadBy(page, () => th(page, "Game Name").click());
      expect(body).toMatchObject({ sortBy: "gameName", sortDirection: "asc" });
      expect(body.filters).toEqual(first.body.filters);
      for (const v of await columnValues(page, "Game Category")) expect(v).toBe(norm(cat.label));
    });

    // Cách sắp xếp được app lưu ở localStorage (sorter__game_effective-turnover-exclusion) -> reload vẫn giữ
    test("Cách sắp xếp được ghi nhớ sau khi tải lại trang; bỏ sort thì về mặc định id giảm dần", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu");
      await reloadBy(page, () => th(page, "Game Name").click());
      const [req] = await Promise.all([page.waitForRequest(isList), page.reload()]);
      expect(JSON.parse(req.postData())).toMatchObject({ sortBy: "gameName", sortDirection: "asc" });
      await settle(page);

      // Bấm 2 lần nữa (asc -> desc -> bỏ sort) rồi reload: về mặc định
      await reloadBy(page, () => th(page, "Game Name").click());
      await reloadBy(page, () => th(page, "Game Name").click());
      const [req2] = await Promise.all([page.waitForRequest(isList), page.reload()]);
      expect(JSON.parse(req2.postData())).toMatchObject({ sortBy: "id", sortDirection: "desc" });
    });

    test("Các cột Game Code, Game Category, Action không có chức năng sort", async ({ page }) => {
      for (const column of ["Game Code", "Game Category", "Action"]) {
        await expect(th(page, column), column).not.toHaveClass(/ant-table-column-has-sorters/);
      }
      await expect(th(page, "Game Name")).toHaveClass(/ant-table-column-has-sorters/);
    });
  });

  // ===== 7. Chọn dòng và Delete (chỉ mở hộp thoại rồi Cancel) =====
  test.describe("Chọn dòng, Delete từng dòng và Bulk Delete (không bấm Delete)", () => {
    test("Chọn 1 dòng thì Bulk Delete được bật, bỏ chọn thì tắt lại", async ({ page }) => {
      await ensureData(page, test);
      await expect(bulkDeleteBtn(page)).toBeDisabled();
      await rowCheckbox(page, 0).check();
      await expect(bulkDeleteBtn(page)).toBeEnabled();
      await rowCheckbox(page, 0).uncheck();
      await expect(bulkDeleteBtn(page)).toBeDisabled();
    });

    test("Checkbox ở tiêu đề chọn / bỏ chọn tất cả dòng của trang", async ({ page }) => {
      await ensureData(page, test);
      await selectAllBox(page).check();
      const n = await rows(page).count();
      await expect(page.locator('tbody tr.ant-table-row input[type="checkbox"]:checked')).toHaveCount(n);
      await expect(bulkDeleteBtn(page)).toBeEnabled();
      await selectAllBox(page).uncheck();
      await expect(page.locator('tbody tr.ant-table-row input[type="checkbox"]:checked')).toHaveCount(0);
      await expect(bulkDeleteBtn(page)).toBeDisabled();
    });

    test("Tooltip của nút Bulk Delete (khi đã chọn dòng) và nút Export", async ({ page }) => {
      await ensureData(page, test);
      await rowCheckbox(page, 0).check();
      await hoverTip(page, bulkDeleteBtn(page), "Bulk Delete");
      await hoverTip(page, exportBtn(page), "Download as CSV");
    });

    test("Icon Delete của dòng mở hộp thoại xác nhận đúng tên game, đóng bằng Cancel và không gửi request ghi", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const g = json.data.list[0];

      await deleteIcon(page, 0).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText("Delete");
      await expect(dialog(page)).toContainText(`Are you sure you want to delete ${norm(g.gameName)}?`);
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Delete$/ })).toBeVisible();

      await closeDialog(page); // chỉ Cancel, KHÔNG bấm Delete
      await expect(summary(page)).toContainText(`of ${json.data.totalCount} records`);
      await expect(rows(page)).toHaveCount(json.data.list.length);
    });

    test("Bulk Delete 1 dòng: hộp thoại 'Delete 1 items' hỏi đúng tên game; Cancel vẫn giữ dòng đã chọn", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const g = json.data.list[0];

      await rowCheckbox(page, 0).check();
      await bulkDeleteBtn(page).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText("Delete 1 items");
      await expect(dialog(page)).toContainText(`Are you sure you want to delete ${norm(g.gameName)}?`);
      await expect(dialog(page).getByRole("button", { name: /Delete$/ })).toBeVisible();

      await closeDialog(page); // chỉ Cancel, KHÔNG bấm Delete
      await expect(rowCheckbox(page, 0)).toBeChecked();
      await expect(rows(page)).toHaveCount(json.data.list.length);
    });

    test("Bulk Delete nhiều dòng: hộp thoại 'Delete N items' hỏi số lượng", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Cần ít nhất 2 dòng");
      const n = json.data.list.length;

      await selectAllBox(page).check();
      await bulkDeleteBtn(page).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText(`Delete ${n} items`);
      await expect(dialog(page)).toContainText(`Are you sure you want to delete ${n} items?`);
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Delete$/ })).toBeVisible();

      await closeDialog(page); // chỉ Cancel, KHÔNG bấm Delete
      await expect(page.locator('tbody tr.ant-table-row input[type="checkbox"]:checked')).toHaveCount(n);
      await expect(rows(page)).toHaveCount(n);
    });
  });

  // ===== 8. Hộp thoại Add New Exclusion =====
  test.describe("Hộp thoại Add New Exclusion (không bấm Submit)", () => {
    test("Add New mở hộp thoại với ô Game Code trống, bảng trống, Submit bị tắt", async ({ page }) => {
      await openAdd(page);
      await expect(dialog(page)).toContainText("Game Code");
      await expect(dialog(page)).toContainText("Select game code");
      await expect(addChips(page)).toHaveCount(0);
      await expect(dialog(page).getByRole("button", { name: /Add$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Upload$/ })).toBeVisible();
      await expect(gridDeleteBtn(page)).toBeDisabled();
      await expect(gridSelectAll(page)).toBeDisabled();
      await expect(dialog(page).locator(".ant-table-thead th").filter({ hasText: "Game Code" })).toBeVisible();
      await expect(dialog(page).locator(".ant-table-thead th").filter({ hasText: "Action" })).toBeVisible();
      await expect(dialog(page).locator(".ant-empty-description")).toHaveText("No data");
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(submitBtn(page)).toBeDisabled();
      await closeDialog(page);
    });

    test("Option của Game Code: 'Select All' đứng đầu rồi tới các game lấy từ API .../available (đúng thứ tự)", async ({ page }) => {
      const available = await openAdd(page);
      test.skip(available.length === 0, "Không có game nào có thể thêm");
      await addSelect(page).click();
      await openOptions(page).first().waitFor();
      const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      expect(titles[0]).toBe("Select All");
      // Danh sách ảo chỉ render các option đầu tiên -> so với phần đầu của response
      const codes = available.map((g) => g.code);
      expect(titles.slice(1)).toEqual(codes.slice(0, titles.length - 1));
      await modalTitle(page).click();
      await expect(openOptions(page)).toHaveCount(0);
      await closeDialog(page);
    });

    test("Game có thể thêm là game có thật trong dropdown/game và chưa nằm trong danh sách loại trừ", async ({ page }) => {
      const { json } = await search(page);
      const available = await openAdd(page);
      const all = await games();
      const ids = new Set(all.map((g) => g.value));
      const inList = new Set(json.data.list.map((g) => g.gameId));
      for (const g of available) {
        expect(ids.has(g.value), `game ${g.code} có trong dropdown/game`).toBe(true);
        expect(inList.has(g.value), `game ${g.code} đã nằm trong danh sách loại trừ`).toBe(false);
      }
      await closeDialog(page);
    });

    test("Chọn 2 game rồi Add: 2 game vào bảng, ô chọn được xoá trống, Submit được bật (không bấm Submit)", async ({ page }) => {
      const available = await openAdd(page);
      test.skip(available.length < 2, "Cần ít nhất 2 game có thể thêm");
      const [a, b] = available;

      await pickAvailable(page, [a.code, b.code]);
      await expect(addChips(page).first()).toBeVisible();
      await expect(submitBtn(page)).toBeDisabled(); // chưa Add thì chưa có gì để Submit
      await dialog(page).getByRole("button", { name: /Add$/ }).click();

      await expect.poll(() => gridCodes(page)).toEqual([a.code, b.code]);
      await expect(addChips(page)).toHaveCount(0);
      await expect(submitBtn(page)).toBeEnabled();
      await closeDialog(page); // KHÔNG Submit
    });

    test("Bấm Add khi chưa chọn game nào: không thêm dòng, Submit vẫn tắt", async ({ page }) => {
      await openAdd(page);
      await dialog(page).getByRole("button", { name: /Add$/ }).click();
      await expect(gridRows(page)).toHaveCount(0);
      await expect(submitBtn(page)).toBeDisabled();
      await closeDialog(page);
    });

    test("Thêm lại game đã có trong bảng: không tạo dòng trùng", async ({ page }) => {
      const available = await openAdd(page);
      test.skip(available.length < 2, "Cần ít nhất 2 game có thể thêm");
      const [a, b] = available;

      await pickAvailable(page, [a.code, b.code]);
      await dialog(page).getByRole("button", { name: /Add$/ }).click();
      await expect.poll(() => gridCodes(page)).toEqual([a.code, b.code]);

      await pickAvailable(page, [a.code]);
      await dialog(page).getByRole("button", { name: /Add$/ }).click();
      await expect(addChips(page)).toHaveCount(0);
      expect(await gridCodes(page)).toEqual([a.code, b.code]);
      await closeDialog(page);
    });

    test("Chọn 'Select All' rồi Add: bảng có đủ mọi game có thể thêm", async ({ page }) => {
      test.setTimeout(120000);
      const available = await openAdd(page);
      test.skip(available.length === 0, "Không có game nào có thể thêm");

      await addSelect(page).click();
      await openOptions(page).filter({ hasText: exact("Select All") }).first().click();
      await modalTitle(page).click();
      await expect(openOptions(page)).toHaveCount(0);
      await dialog(page).getByRole("button", { name: /Add$/ }).click();

      await expect(gridRows(page)).toHaveCount(available.length);
      expect([...(await gridCodes(page))].sort()).toEqual(available.map((g) => g.code).sort());
      await closeDialog(page);
    });

    test("Xoá 1 dòng bằng icon (x) ở cột Action; xoá hết dòng thì Submit tắt lại", async ({ page }) => {
      const available = await openAdd(page);
      test.skip(available.length < 2, "Cần ít nhất 2 game có thể thêm");
      const [a, b] = available;
      await pickAvailable(page, [a.code, b.code]);
      await dialog(page).getByRole("button", { name: /Add$/ }).click();
      await expect.poll(() => gridCodes(page)).toEqual([a.code, b.code]);

      await gridRows(page).first().locator(".anticon-close").click();
      await expect.poll(() => gridCodes(page)).toEqual([b.code]);
      await expect(submitBtn(page)).toBeEnabled();

      await gridRows(page).first().locator(".anticon-close").click();
      await expect(gridRows(page)).toHaveCount(0);
      await expect(submitBtn(page)).toBeDisabled();
      await closeDialog(page);
    });

    test("Chọn dòng bằng checkbox rồi bấm nút Delete của bảng: xoá các dòng đã chọn (chỉ trong bảng tạm của hộp thoại)", async ({ page }) => {
      const available = await openAdd(page);
      test.skip(available.length < 2, "Cần ít nhất 2 game có thể thêm");
      const [a, b] = available;
      await pickAvailable(page, [a.code, b.code]);
      await dialog(page).getByRole("button", { name: /Add$/ }).click();
      await expect.poll(() => gridCodes(page)).toEqual([a.code, b.code]);

      await expect(gridDeleteBtn(page)).toBeDisabled();
      await gridRows(page).first().locator('input[type="checkbox"]').check();
      await expect(gridDeleteBtn(page)).toBeEnabled();
      await gridDeleteBtn(page).click();
      await expect.poll(() => gridCodes(page)).toEqual([b.code]);
      await expect(dialog(page)).toBeVisible(); // đây là xoá ở bảng tạm, không mở hộp thoại xác nhận nào khác
      await closeDialog(page);
    });

    test("Checkbox tiêu đề của bảng chọn tất cả dòng rồi Delete xoá hết", async ({ page }) => {
      const available = await openAdd(page);
      test.skip(available.length < 2, "Cần ít nhất 2 game có thể thêm");
      await pickAvailable(page, [available[0].code, available[1].code]);
      await dialog(page).getByRole("button", { name: /Add$/ }).click();
      await expect(gridRows(page)).toHaveCount(2);

      await gridSelectAll(page).check();
      await gridDeleteBtn(page).click();
      await expect(gridRows(page)).toHaveCount(0);
      await expect(submitBtn(page)).toBeDisabled();
      await closeDialog(page);
    });

    test("Bộ lọc theo Game Code (icon kính lúp ở tiêu đề cột): chỉ giữ game đã chọn, Reset hiện lại đủ", async ({ page }) => {
      const available = await openAdd(page);
      test.skip(available.length < 2, "Cần ít nhất 2 game có thể thêm");
      const [a, b] = available;
      await pickAvailable(page, [a.code, b.code]);
      await dialog(page).getByRole("button", { name: /Add$/ }).click();
      await expect.poll(() => gridCodes(page)).toEqual([a.code, b.code]);

      const popup = page.locator(".ant-table-filter-dropdown:visible");
      await dialog(page).locator(".ant-table-filter-trigger").click();
      await expect(popup).toBeVisible();
      await popup.locator(".ant-select").click();
      // Option của bộ lọc là các game đang có trong bảng
      await expect(openOptions(page)).toHaveText([a.code, b.code]);
      await openOptions(page).filter({ hasText: exact(b.code) }).click();
      await popup.locator(".ant-space").click({ position: { x: 2, y: 2 }, force: true }); // đóng dropdown chọn nhiều
      await expect(openOptions(page)).toHaveCount(0);
      await popup.getByRole("button", { name: "Search" }).click();
      await expect.poll(() => gridCodes(page)).toEqual([b.code]);

      await dialog(page).locator(".ant-table-filter-trigger").click();
      await expect(popup).toBeVisible();
      await popup.getByRole("button", { name: "Reset" }).click();
      await expect.poll(() => gridCodes(page)).toEqual([a.code, b.code]);
      await closeDialog(page);
    });

    test("Cancel bỏ các game vừa Add: mở lại hộp thoại thì bảng trống và danh sách ngoài không đổi", async ({ page }) => {
      const { json } = await search(page);
      const available = await openAdd(page);
      test.skip(available.length === 0, "Không có game nào có thể thêm");
      await pickAvailable(page, [available[0].code]);
      await dialog(page).getByRole("button", { name: /Add$/ }).click();
      await expect(gridRows(page)).toHaveCount(1);
      await closeDialog(page);
      await expect(summary(page)).toContainText(`of ${json.data.totalCount} records`);

      await addBtn(page).click();
      await expect(modalTitle(page)).toHaveText("Add New Exclusion");
      await expect(gridRows(page)).toHaveCount(0);
      await expect(submitBtn(page)).toBeDisabled();
      await closeDialog(page);
    });

    test("Đóng hộp thoại bằng nút X", async ({ page }) => {
      await openAdd(page);
      await dialog(page).getByRole("button", { name: "Close" }).first().click();
      await expect(dialog(page)).toBeHidden();
    });
  });

  // ===== 9. Upload CSV (trong hộp thoại Add New Exclusion) =====
  test.describe("Upload Game Exclusion (không bấm Submit)", () => {
    const uploadBtn = (page) => dialog(page).getByRole("button", { name: /Upload$/ });
    const backBtn = (page) => dialog(page).getByRole("button", { name: /Back$/ });
    const fileInput = (page) => dialog(page).locator('input[type="file"]');
    const uploadList = (page) => dialog(page).locator(".ant-upload-list");

    async function openUpload(page) {
      const available = await openAdd(page);
      await uploadBtn(page).click();
      await expect(modalTitle(page)).toHaveText("Upload Game Exclusion");
      return available;
    }

    test("Nút Upload chuyển sang màn Upload Game Exclusion: có Download Template, vùng kéo thả CSV và nút Back", async ({ page }) => {
      await openUpload(page);
      await expect(dialog(page)).toContainText("Game List");
      await expect(dialog(page)).toContainText("Download a sample template");
      await expect(dialog(page).getByRole("button", { name: /Download Template$/ })).toBeVisible();
      await expect(dialog(page)).toContainText("Click or drag file to this area to upload");
      await expect(dialog(page)).toContainText("Format: CSV | Max. Size: 5MB");
      await expect(fileInput(page)).toHaveAttribute("accept", ".csv");
      await expect(fileInput(page)).not.toHaveAttribute("multiple", /.*/);
      await expect(backBtn(page)).toBeVisible();
      await expect(submitBtn(page)).toHaveCount(0);
      await backBtn(page).click();
      await expect(modalTitle(page)).toHaveText("Add New Exclusion");
      await closeDialog(page);
    });

    test("Download Template tải về game_exclusion_template.csv có tiêu đề cột 'Game Code'", async ({ page }) => {
      await openUpload(page);
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        dialog(page).getByRole("button", { name: /Download Template$/ }).click(),
      ]);
      expect(download.suggestedFilename()).toBe("game_exclusion_template.csv");
      const lines = fs
        .readFileSync(await download.path(), "utf8")
        .replace(/^﻿/, "")
        .split(/\r?\n/)
        .filter((l) => l !== "");
      expect(lines[0]).toBe("Game Code");
      expect(lines.length).toBeGreaterThan(1);
      await backBtn(page).click();
      await closeDialog(page);
    });

    test("File CSV sai tiêu đề cột: báo 'Format is incorrect' và không gửi request", async ({ page }) => {
      await openUpload(page);
      await fileInput(page).setInputFiles(csvFile("sai_tieu_de.csv", ["Wrong Header", "abc"]));
      await expect(uploadList(page)).toContainText("sai_tieu_de.csv");
      await expect(uploadList(page)).toContainText("Format is incorrect");
      await backBtn(page).click();
      await expect(gridRows(page)).toHaveCount(0);
      await expect(submitBtn(page)).toBeDisabled();
      await closeDialog(page);
    });

    test("File CSV có game code không tồn tại: báo 'contains invalid game code(s)' và không thêm dòng nào", async ({ page }) => {
      await openUpload(page);
      await fileInput(page).setInputFiles(csvFile("khong_ton_tai.csv", ["Game Code", `KHONG_CO_${Date.now()}`]));
      await expect(uploadList(page)).toContainText("khong_ton_tai.csv");
      await expect(uploadList(page)).toContainText("contains invalid game code(s), please review before uploading");
      await backBtn(page).click();
      await expect(gridRows(page)).toHaveCount(0);
      await expect(submitBtn(page)).toBeDisabled();
      await closeDialog(page);
    });

    test("File CSV hợp lệ (game code lấy từ danh sách có thể thêm): không báo lỗi, Back thì các game nằm trong bảng và Submit được bật", async ({ page }) => {
      const available = await openUpload(page);
      test.skip(available.length < 2, "Cần ít nhất 2 game có thể thêm");
      const [a, b] = available;
      await fileInput(page).setInputFiles(csvFile("hop_le.csv", ["Game Code", a.code, b.code]));
      await expect(uploadList(page)).toContainText("hop_le.csv");
      await expect(uploadList(page)).not.toContainText("invalid");
      await expect(uploadList(page)).not.toContainText("Format is incorrect");

      await backBtn(page).click();
      await expect(modalTitle(page)).toHaveText("Add New Exclusion");
      await expect.poll(() => gridCodes(page)).toEqual([a.code, b.code]);
      await expect(submitBtn(page)).toBeEnabled();
      await closeDialog(page); // KHÔNG Submit
    });

    // Ở màn Upload, nút X chỉ quay về màn Add New Exclusion (giống nút Back); bấm X lần nữa mới đóng hộp thoại
    test("Nút X ở màn Upload quay về Add New Exclusion, bấm X lần nữa thì đóng hộp thoại", async ({ page }) => {
      await openUpload(page);
      await dialog(page).getByRole("button", { name: "Close" }).first().click();
      await expect(modalTitle(page)).toHaveText("Add New Exclusion");
      await dialog(page).getByRole("button", { name: "Close" }).first().click();
      await expect(dialog(page)).toBeHidden();
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
      await item(page, "Game Code").locator("label").click();
      expect(await headers(page)).not.toContain("Game Code");
      expect(await headers(page)).toHaveLength(HEADERS.length - 1);

      await item(page, "Game Code").locator("label").click();
      expect(await headers(page)).toEqual(HEADERS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      await ensureData(page, test);
      const before = await columnValues(page, "Game Name");
      await columnBtn(page).click();
      await item(page, "Game Code").locator("label").click();
      expect(await columnValues(page, "Game Name")).toEqual(before);
    });
  });

  // ===== 11. Export =====
  test.describe("Export", () => {
    // Bấm Export rồi kiểm tra kết quả. Trả về body của request /download (payload đã parse).
    // 2 kết quả hợp lệ tuỳ việc file cùng filter đã được export trước đó hay chưa:
    //  - Lần đầu: toast "Download is processing. Please check ID:xxx in download history"
    //  - Đã có file cũ: hộp thoại "already exist in download history ... Download Now / Download New".
    //    KHÔNG bấm Download New (sẽ xoá file cũ trong Download History), chỉ kiểm tra rồi đóng.
    async function exportAndCheck(page) {
      const [req] = await Promise.all([page.waitForRequest(isDownload), exportBtn(page).click()]);
      const body = JSON.parse(req.postData());
      const payload = JSON.parse(body.payload);

      const processing = page.getByText(/Download is processing\. Please check ID:\d+ in download history/).first();
      const duplicate = page.getByText(/already exist in download history with id \d+/);
      await expect(processing.or(duplicate)).toBeVisible();
      if (await duplicate.isVisible()) {
        await expect(page.getByRole("button", { name: "Download Now" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Download New" })).toBeVisible();
        await page.keyboard.press("Escape");
      }
      return { body, payload };
    }

    test("Export tạo job tải xuống (module GAMES, section EFFECTIVE_TURNOVER_EXCLUSION_LIST) gồm toàn bộ cột", async ({ page }) => {
      const { body, payload } = await exportAndCheck(page);
      expect(body.module).toBe("GAMES");
      expect(body.section).toBe("EFFECTIVE_TURNOVER_EXCLUSION_LIST");
      expect(body.timezoneId).toEqual(expect.any(Number));
      expect(payload.filters.fields).toEqual(COLUMNS);
    });

    test("Export đi kèm đúng filter hiện tại (Game Category)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const cat = (await uniqueCategories()).find((c) => norm(c.label) === norm(json.data.list[0].gameCategory));
      test.skip(!cat, "Tên Game Category của dòng đầu bị trùng với category khác");

      await selectOption(page, "gameCategoryId", cat.label);
      await search(page);
      const { payload } = await exportAndCheck(page);
      expect(payload.filters.gameCategoryId).toEqual([cat.value]);
      expect(payload.filters.fields).toEqual(COLUMNS);
    });

    test("Export chỉ chứa các cột đang hiển thị", async ({ page }) => {
      await columnBtn(page).click();
      await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items", { hasText: exact("Game Code") })
        .locator("label")
        .click();

      const [req] = await Promise.all([page.waitForRequest(isDownload), exportBtn(page).click()]);
      const payload = JSON.parse(JSON.parse(req.postData()).payload);
      expect(payload.filters.fields).not.toContain("Game Code");
      expect(payload.filters.fields).toContain("Game Name");
      // Dọn: đóng hộp thoại "already exist" nếu có (không bấm Download New)
      const duplicate = page.getByText(/already exist in download history with id \d+/);
      if (await duplicate.isVisible().catch(() => false)) await page.keyboard.press("Escape");
    });
  });

  // ===== 12. Ghi nhớ filter =====
  test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
    const { json } = await search(page);
    test.skip(json.data.list.length === 0, "Không có dữ liệu");
    const first = json.data.list[0];
    const game = await gameOf(first);
    const cat = (await uniqueCategories()).find((x) => norm(x.label) === norm(first.gameCategory));
    test.skip(!game || !cat, "Tên / code game hoặc category của dòng đầu bị trùng");

    await selectOption(page, "code", game.code);
    await selectOption(page, "gameCategoryId", cat.label);
    await search(page);
    await page.locator(".ant-pagination-options .ant-select").click();
    await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

    await openPage(page); // reload
    expect(await selectedTitles(page, "code")).toEqual([game.code]);
    expect(await selectedTitles(page, "gameCategoryId")).toEqual([cat.label]);
    await expect(filterEl(page, "name").locator(".ant-select-selection-item")).toHaveCount(0);
    await expect(page.locator(".ant-pagination-options")).toContainText("20 / page");
  });
});
