// Games > Game Sub Categories  (https://dev-bo.royaledge.io/game/game-sub-category)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/game_sub_category.spec.js --project=setup --project=chromium
//
// Màn hình quản lý danh mục con của game (Game Sub Category). Danh sách CÓ phân trang (10/20/50/100/200 dòng / trang),
// không có checkbox chọn dòng và không có thao tác hàng loạt. Mỗi dòng chỉ có 1 icon Update (bút chì).
// Export tải thẳng file CSV về trình duyệt (chỉ chứa các dòng của TRANG hiện tại, không tạo bản ghi ở Download History).
//
// Màn hình có các thao tác GHI dữ liệu thật: Create / Update (nút Confirm trong hộp thoại).
// Test KHÔNG bấm Confirm khi form hợp lệ: chỉ mở hộp thoại, kiểm tra nội dung, kiểm tra validation khi để trống
// trường bắt buộc (form bị chặn nên không gửi request) rồi bấm Cancel / Close, và kiểm tra không có request ghi dữ liệu
// nào được gửi đi. validate_name chỉ kiểm tra trùng tên (không lưu gì) nên được coi là request đọc.
// Không hard-code dữ liệu - mọi giá trị lấy từ chính dòng đầu tiên của danh sách / response dropdown.
const fs = require("fs");
const { test, expect } = require("@playwright/test");

test.use({ viewport: { width: 1920, height: 1080 } });

const URL = "/game/game-sub-category";

// Đúng thứ tự hiển thị (không có cột checkbox)
const COLUMNS = ["ID", "Game Sub Category Name", "Denom Type", "Game Category", "Action"];

// Các cột có thể sort (trừ ID) -> tên field gửi lên API (mặc định sort theo id giảm dần)
const SORTABLE = {
  "Game Sub Category Name": "name",
  "Denom Type": "denomType",
  "Game Category": "gameCategory",
};

// denomType gửi/nhận từ API -> chữ hiển thị
const DENOM_TEXT = { 1: "Slot game", 2: "Mini game", 3: "Crash game", 4: "Card game" };
const DENOM_CODE = Object.fromEntries(Object.entries(DENOM_TEXT).map(([k, v]) => [v, Number(k)]));
// Thứ tự option của filter Denom Type (sắp theo tên) và của ô Denom Type trong hộp thoại Create
const DENOM_FILTER_OPTIONS = ["Card game", "Crash game", "Mini game", "Slot game"];
const DENOM_FORM_OPTIONS = ["Slot game", "Mini game", "Crash game", "Card game"];

// Thông báo lỗi của form
const MSG = {
  name: "Please enter Game Sub Category",
  denom: "Please select Denom Type",
  category: "Please select Game Category",
  duplicate: "Game Sub Category Name already exist",
  format: /^Please enter 3.50 characters using only letters, numbers, single spaces, and the symbols/,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const isList = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/game/game_sub_category/list");
const isView = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/game/game_sub_category/view");
const isValidateName = (r) =>
  reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/game/game_sub_category/validate_name");
const isCategoryDropdown = (r) => reqOf(r).url().endsWith("/dropdown/gamecategory");

const rows = (page) => page.locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const editIcon = (page, i) => rowAt(page, i).locator('svg[data-icon="pen-to-square"]');

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

// Bấm Search, trả về { body: request body, status, json: response body }.
// Lấy response từ chính request vừa gửi (không dùng waitForResponse riêng) để không bị lệch khi search liên tiếp.
async function search(page) {
  const [req] = await Promise.all([page.waitForRequest(isList), searchBtn(page).click()]);
  const res = await req.response();
  await waitTableIdle(page);
  return { body: JSON.parse(req.postData()), status: res.status(), json: await res.json() };
}

// Thực hiện 1 hành động làm bảng gọi lại API (đổi trang, sort...) rồi trả về { body, json }
async function reloadFull(page, action) {
  const [req] = await Promise.all([page.waitForRequest(isList), action()]);
  const res = await req.response();
  await waitTableIdle(page);
  return { body: JSON.parse(req.postData()), json: await res.json() };
}
// Như reloadFull nhưng chỉ trả về request body
const reloadBy = async (page, action) => (await reloadFull(page, action)).body;

const headers = async (page) =>
  (await page.locator(".ant-table-thead th").allInnerTexts()).map((t) => t.trim());

// Lấy toàn bộ giá trị của 1 cột (theo tên header) ở trang hiện tại
async function columnValues(page, name) {
  await expect.poll(() => headers(page), { message: `Không thấy cột "${name}"` }).toContain(name);
  const idx = (await headers(page)).indexOf(name);
  return rows(page).evaluateAll(
    (trs, i) => trs.map((tr) => tr.children[i].innerText.replace(/\s+/g, " ").trim()),
    idx,
  );
}

// Toàn bộ các dòng của bảng dạng { ID: "...", "Game Sub Category Name": "...", ... }
async function tableRecords(page) {
  const heads = await headers(page);
  const cells = await rows(page).evaluateAll((trs) =>
    trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim())),
  );
  return cells.map((r) => Object.fromEntries(heads.map((h, i) => [h, r[i]])));
}

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
const exact = (name, flags = "") =>
  new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, flags);
const totalOf = async (page) => num((await summary(page).innerText()).match(/of ([\d,]+) records/)[1]);

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

// Nhập text vào filter dạng input (input bị ẩn cho tới khi click vào label)
async function fillFilter(page, id, value) {
  await filterEl(page, id).locator("label").first().click();
  await page.locator(`#${id}`).fill(value);
}

// Danh sách luôn có dữ liệu; nếu trống thì skip
async function ensureData(page, test) {
  if ((await rows(page).count()) === 0) test.skip(true, "Danh sách trống");
}

// Ghi lại mọi request POST KHÔNG phải đọc dữ liệu để chắc chắn test không làm đổi dữ liệu thật
function watchWrites(page) {
  const writes = [];
  // validate_name chỉ kiểm tra trùng tên (không lưu gì)
  const READ = /\/(list|details|download|view|dropdown|validate_name)$|\/dropdown\/|\/user\/details$/;
  page.on("request", (r) => {
    if (r.method() === "POST" && /boapi/.test(r.url()) && !READ.test(r.url())) writes.push(r.url());
  });
  return writes;
}

// Đóng hộp thoại bằng Cancel (không bao giờ bấm Confirm khi form hợp lệ)
async function closeDialog(page) {
  await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
  await expect(dialog(page)).toBeHidden();
}

// Các thông báo lỗi đang hiển thị trong hộp thoại
const formErrors = (page) => dialog(page).locator(".ant-form-item-explain-error").allInnerTexts();

// Ô select (Denom Type / Game Category) trong hộp thoại
const formSelect = (page, id) =>
  dialog(page).locator(".ant-form-item").filter({ has: page.locator(`#${id}`) }).locator(".ant-select-selector");

// Chọn 1 option của ô select đơn trong hộp thoại (danh sách ngắn nên không cần gõ tìm kiếm)
async function pickFormOption(page, id, title) {
  await formSelect(page, id).click();
  await openOptions(page).filter({ hasText: exact(title) }).first().click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Tách 1 dòng CSV dạng "a","b","c" thành mảng giá trị
const csvLine = (line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));

// Bấm Export, trả về { filename, header: [...], records: [[...]] } của file CSV tải về
async function exportCsv(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), exportBtn(page).click()]);
  const text = fs.readFileSync(await download.path(), "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l !== "");
  return {
    filename: download.suggestedFilename(),
    header: csvLine(lines[0]),
    records: lines.slice(1).map(csvLine),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Games > Game Sub Categories", () => {
  let writes;
  let categoriesLoaded; // promise của response dropdown/gamecategory (danh sách Game Category) lúc mở trang
  // Danh sách Game Category { value, code, label } mà dropdown/gamecategory trả về
  const categories = async () => (await (await categoriesLoaded).json()).data;
  // Category có tên xuất hiện đúng 1 lần (tên trùng nhau thì không phân biệt được option khi chọn bằng tên)
  const uniqueCategories = async () => {
    const all = await categories();
    return all.filter((c) => all.filter((x) => x.label === c.label).length === 1);
  };

  test.beforeEach(async ({ page }) => {
    // Bộ lọc và số dòng/trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__game_sub_category_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/game-sub-category_(filter|page_size)$|^sorter__game_game-sub-category$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__game_sub_category_spec_cleared", "1");
    });
    writes = watchWrites(page);
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
      await expect(breadcrumb(page)).toHaveText("Game Sub Categories");
      for (const [label, id] of [
        ["Game Sub Category Name", "name"],
        ["Denom Type", "denomTypes"],
        ["Game Category", "gameCategoryIds"],
      ]) {
        await expect(filterEl(page, id), `thiếu filter ${label}`).toContainText(label);
        await expect(filterEl(page, id)).toBeVisible();
      }
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: tất cả để trống", async ({ page }) => {
      await expect(page.locator("#name")).toHaveValue("");
      for (const id of ["denomTypes", "gameCategoryIds"]) {
        await expect(filterEl(page, id).locator(".ant-select-selection-item"), `#${id} phải trống`).toHaveCount(0);
      }
    });

    test("Denom Type và Game Category là dropdown chọn nhiều, Name là ô nhập chữ", async ({ page }) => {
      await expect(filterEl(page, "denomTypes").locator(".ant-select-multiple")).toHaveCount(1);
      await expect(filterEl(page, "gameCategoryIds").locator(".ant-select-multiple")).toHaveCount(1);
      await expect(filterEl(page, "name").locator(".ant-select")).toHaveCount(0);
    });

    test("Có nút Add New, Export và Manage Columns; không có checkbox chọn dòng / thao tác hàng loạt", async ({ page }) => {
      await expect(addBtn(page)).toBeVisible();
      await expect(exportBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
      await expect(page.locator("button.NextGen-button-more-action__update")).toHaveCount(0);
      await expect(page.locator('.ant-table input[type="checkbox"]')).toHaveCount(0);
    });

    test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự`, async ({ page }) => {
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Mặc định: trang 1, 10 dòng, sắp xếp mới nhất (id giảm dần) lên đầu", async ({ page }) => {
      const { body, json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc" });
      expect(body.filters).toEqual({ sasEntityId: [expect.any(Number)] });
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
    test("Mỗi dòng khớp response API (định dạng hiển thị)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      const records = await tableRecords(page);
      expect(records).toHaveLength(list.length);

      records.forEach((r, i) => {
        const c = list[i];
        const at = `dòng ${i + 1} (sub category ${c.id})`;
        expect(r["ID"], at).toBe(String(c.id));
        expect(r["Game Sub Category Name"], at).toBe(norm(c.name));
        expect(r["Denom Type"], at).toBe(DENOM_TEXT[c.denomType]);
        expect(r["Game Category"], at).toBe(norm(c.gameCategory));
      });
    });

    test("Định dạng: ID là số, Denom Type hợp lệ, Name / Game Category không rỗng", async ({ page }) => {
      await ensureData(page, test);
      for (const v of await columnValues(page, "ID")) expect(v).toMatch(/^\d+$/);
      for (const v of await columnValues(page, "Denom Type")) expect(Object.values(DENOM_TEXT)).toContain(v);
      for (const col of ["Game Sub Category Name", "Game Category"]) {
        for (const v of await columnValues(page, col)) expect(v, col).not.toBe("");
      }
    });

    test("ID là duy nhất giữa các dòng", async ({ page }) => {
      await ensureData(page, test);
      const ids = await columnValues(page, "ID");
      expect(new Set(ids).size).toBe(ids.length);
    });

    test("Game Category của mỗi dòng là category có thật trong dropdown/gamecategory", async ({ page }) => {
      await ensureData(page, test);
      const labels = (await categories()).map((c) => norm(c.label));
      for (const v of await columnValues(page, "Game Category")) expect(labels).toContain(v);
    });

    test("Mỗi dòng có 1 icon Update (chỉ hover, không bấm)", async ({ page }) => {
      const n = Math.min(5, await rows(page).count());
      test.skip(n === 0, "Không có dữ liệu");
      for (let i = 0; i < n; i++) {
        await expect(rowAt(page, i).locator("td").last().locator("svg")).toHaveCount(1);
        await editIcon(page, i).hover();
        await expect(tooltip(page).filter({ hasText: "Update" })).toBeVisible();
      }
    });
  });

  // ===== 3. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Option cố định của Denom Type", async ({ page }) => {
      expect(await dropdownOptions(page, "denomTypes")).toEqual(DENOM_FILTER_OPTIONS);
    });

    test("Option của Game Category lấy từ API dropdown/gamecategory", async ({ page }) => {
      const labels = (await categories()).map((c) => c.label);
      test.skip(labels.length === 0, "Không có Game Category nào");
      const titles = await dropdownOptions(page, "gameCategoryIds");
      expect(titles.length).toBeGreaterThan(0);
      for (const t of titles) expect(labels).toContain(t);
    });

    test("Lọc theo Name khớp một phần, không phân biệt hoa/thường", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const name = json.data.list[0].name;
      const part = name.slice(1, Math.max(4, name.length - 1)).trim().toUpperCase();
      await fillFilter(page, "name", part);
      const { body, json: res } = await search(page);
      expect(body.filters.name).toBe(part);
      expect(res.data.list.length).toBeGreaterThan(0);
      expect(res.data.list.map((c) => c.name)).toContain(name);
      for (const v of await columnValues(page, "Game Sub Category Name")) expect(v.toUpperCase()).toContain(norm(part));
      await expect(summary(page)).toContainText(`of ${res.data.totalCount} records`);
    });

    test("Lọc theo Name đầy đủ trả về đúng sub category đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      await fillFilter(page, "name", c.name);
      const { body, json: res } = await search(page);
      expect(body.filters.name).toBe(c.name);
      expect(res.data.list.map((x) => x.id)).toContain(c.id);
      for (const v of await columnValues(page, "Game Sub Category Name")) {
        expect(v.toLowerCase()).toContain(norm(c.name).toLowerCase());
      }
    });

    for (const [label, code] of Object.entries(DENOM_CODE)) {
      test(`Lọc theo Denom Type = ${label} gửi denomTypes=[${code}] và mọi dòng khớp`, async ({ page }) => {
        await selectOption(page, "denomTypes", label);
        const { body, json } = await search(page);
        expect(body.filters.denomTypes).toEqual([code]);
        test.skip(json.data.list.length === 0, `Không có sub category nào thuộc ${label}`);
        for (const c of json.data.list) expect(c.denomType).toBe(code);
        for (const v of await columnValues(page, "Denom Type")) expect(v).toBe(label);
      });
    }

    test("Số sub category của từng Denom Type cộng lại bằng tổng số sub category", async ({ page }) => {
      test.setTimeout(120000);
      const total = (await search(page)).json.data.totalCount;
      let sum = 0;
      for (const label of Object.keys(DENOM_CODE)) {
        await resetBtn(page).click();
        await selectOption(page, "denomTypes", label);
        sum += (await search(page)).json.data.totalCount;
      }
      expect(sum).toBe(total);
    });

    test("Denom Type chọn được nhiều giá trị: gửi đủ denomTypes và mọi dòng thuộc 1 trong các giá trị đã chọn", async ({ page }) => {
      await selectOption(page, "denomTypes", "Card game");
      await selectOption(page, "denomTypes", "Mini game");
      await expect.poll(() => selectedCount(page, "denomTypes")).toBe(2);
      const { body, json } = await search(page);
      expect([...body.filters.denomTypes].sort()).toEqual([DENOM_CODE["Mini game"], DENOM_CODE["Card game"]].sort());
      test.skip(json.data.list.length === 0, "Không có sub category nào thuộc Card game / Mini game");
      for (const v of await columnValues(page, "Denom Type")) expect(["Card game", "Mini game"]).toContain(v);
    });

    test("Lọc theo Game Category của dòng đầu tiên gửi gameCategoryIds=[id] và mọi dòng khớp", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      const cat = (await uniqueCategories()).find((c) => norm(c.label) === norm(first.gameCategory));
      test.skip(!cat, "Tên Game Category của dòng đầu bị trùng với category khác");

      await selectOption(page, "gameCategoryIds", cat.label);
      expect(await selectedTitles(page, "gameCategoryIds")).toEqual([cat.label]);
      const { body, json: res } = await search(page);
      expect(body.filters.gameCategoryIds).toEqual([cat.value]);
      expect(res.data.list.map((x) => x.id)).toContain(first.id);
      for (const c of res.data.list) expect(c.gameCategoryId).toBe(cat.value);
      for (const v of await columnValues(page, "Game Category")) expect(v).toBe(norm(cat.label));
    });

    test("Game Category chọn được nhiều giá trị: gửi đủ id, mọi dòng thuộc 1 trong các category, tổng = tổng từng category", async ({ page }) => {
      test.setTimeout(120000);
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const unique = await uniqueCategories();
      const c1 = unique.find((c) => norm(c.label) === norm(json.data.list[0].gameCategory));
      const c2 = unique.find((c) => c.value !== c1?.value);
      test.skip(!c1 || !c2, "Cần ít nhất 2 Game Category có tên không trùng nhau");

      await selectOption(page, "gameCategoryIds", c1.label);
      const t1 = (await search(page)).json.data.totalCount;
      await selectOption(page, "gameCategoryIds", c2.label);
      await expect.poll(() => selectedCount(page, "gameCategoryIds")).toBe(2);
      const both = await search(page);
      expect([...both.body.filters.gameCategoryIds].sort()).toEqual([c1.value, c2.value].sort());
      for (const c of both.json.data.list) expect([c1.value, c2.value]).toContain(c.gameCategoryId);

      await resetBtn(page).click();
      await selectOption(page, "gameCategoryIds", c2.label);
      const t2 = (await search(page)).json.data.totalCount;
      expect(both.json.data.totalCount).toBe(t1 + t2);
    });

    test("Kết hợp Name, Denom Type và Game Category cùng lúc (AND)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      const cat = (await uniqueCategories()).find((x) => norm(x.label) === norm(c.gameCategory));
      test.skip(!cat, "Tên Game Category của dòng đầu bị trùng với category khác");

      await fillFilter(page, "name", c.name);
      await selectOption(page, "denomTypes", DENOM_TEXT[c.denomType]);
      await selectOption(page, "gameCategoryIds", cat.label);
      const { body, json: res } = await search(page);
      expect(body.filters).toMatchObject({ name: c.name, denomTypes: [c.denomType], gameCategoryIds: [cat.value] });
      expect(res.data.list.map((x) => x.id)).toContain(c.id);
      for (const r of await tableRecords(page)) {
        expect(r["Denom Type"]).toBe(DENOM_TEXT[c.denomType]);
        expect(r["Game Category"]).toBe(norm(cat.label));
      }
    });

    test("Name + Game Category không khớp nhau -> sub category đó không nằm trong kết quả", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      const other = (await uniqueCategories()).find((x) => norm(x.label) !== norm(c.gameCategory));
      test.skip(!other, "Không có Game Category khác để so sánh");

      await fillFilter(page, "name", c.name);
      await selectOption(page, "gameCategoryIds", other.label);
      const { json: res } = await search(page);
      expect(res.data.list.map((x) => x.id)).not.toContain(c.id);
    });

    test("Không có kết quả -> hiển thị 'There are no entries found', không còn phân trang", async ({ page }) => {
      await fillFilter(page, "name", `khong-co-${Date.now()}`);
      const { json } = await search(page);
      expect(json.data.totalCount).toBe(0);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText("There are no entries found").first()).toBeVisible();
      await expect(page.locator(".ant-pagination")).toHaveCount(0);
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
      const total = (await search(page)).json.data.totalCount;
      await fillFilter(page, "name", "qa");
      await selectOption(page, "denomTypes", "Slot game");
      await search(page);

      await resetBtn(page).click();
      await expect(page.locator("#name")).toHaveValue("");
      await expect(filterEl(page, "denomTypes").locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(filterEl(page, "gameCategoryIds").locator(".ant-select-selection-item")).toHaveCount(0);

      const { body, json } = await search(page);
      expect(body.filters).toEqual({ sasEntityId: [expect.any(Number)] });
      expect(json.data.totalCount).toBe(total);
    });
  });

  // ===== 5. Phân trang =====
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
      const ids1 = await columnValues(page, "ID");
      await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      const ids2 = await columnValues(page, "ID");
      for (const id of ids2) expect(ids1).not.toContain(id);
    });

    test("Đổi số dòng / trang", async ({ page }) => {
      await page.locator(".ant-pagination-options .ant-select").click();
      const sizes = await openOptions(page).allInnerTexts();
      expect(sizes).toEqual(["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"]);

      const body = await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
      expect(body.pageSize).toBe(20);
      expect(body.page).toBe(1);
      await expect(rows(page)).toHaveCount(20);
      await expect(summary(page)).toHaveText(/^Showing 1 - 20 of /);
    });

    test("Giữ nguyên filter khi chuyển trang", async ({ page }) => {
      const { json } = await search(page);
      const cat = (await uniqueCategories()).find((c) => norm(c.label) === norm(json.data.list[0].gameCategory));
      test.skip(!cat, "Tên Game Category của dòng đầu bị trùng với category khác");
      await selectOption(page, "gameCategoryIds", cat.label);
      const first = await search(page);
      test.skip(first.json.data.totalCount <= 10, "Filter chỉ có 1 trang");

      const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(body.page).toBe(2);
      expect(body.filters).toEqual(first.body.filters);
      for (const v of await columnValues(page, "Game Category")) expect(v).toBe(norm(cat.label));
    });

    test("Giữ nguyên sắp xếp khi chuyển trang", async ({ page }) => {
      const sorted = await reloadBy(page, () =>
        page.locator(".ant-table-thead th", { hasText: exact("Game Sub Category Name") }).click(),
      );
      expect(sorted).toMatchObject({ sortBy: "name", sortDirection: "asc" });
      const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(body).toMatchObject({ page: 2, sortBy: "name", sortDirection: "asc" });
    });
  });

  // ===== 6. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    const th = (page, column) => page.locator(".ant-table-thead th", { hasText: exact(column) });

    // LỖI BACKEND (khám phá bằng MCP, chờ xác nhận): API game_sub_category/list với sortBy=id, sortDirection=asc vẫn trả dữ liệu
    // giảm dần (id 64, 63, 62...). Test này kiểm tra đúng hành vi mong đợi nên sẽ FAIL cho tới khi backend sửa.
    test("Sort cột ID: mặc định giảm dần, bấm lần lượt -> tăng dần -> giảm dần", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
      // Cột ID đang ở trạng thái giảm dần (mặc định): lần bấm đầu về "không sort" nên không gọi lại API
      await th(page, "ID").click();

      const asc = await reloadBy(page, () => th(page, "ID").click());
      expect(asc).toMatchObject({ sortBy: "id", sortDirection: "asc" });
      // Bảng render lại sau khi API trả về -> poll cho tới khi thứ tự đúng
      await expect
        .poll(async () => {
          const a = (await columnValues(page, "ID")).map(Number);
          return JSON.stringify(a) === JSON.stringify([...a].sort((x, y) => x - y));
        }, { message: "thứ tự tăng dần" })
        .toBe(true);

      const desc = await reloadBy(page, () => th(page, "ID").click());
      expect(desc).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      await expect
        .poll(async () => {
          const d = (await columnValues(page, "ID")).map(Number);
          return JSON.stringify(d) === JSON.stringify([...d].sort((x, y) => y - x));
        }, { message: "thứ tự giảm dần" })
        .toBe(true);
    });

    for (const [column, sortBy] of Object.entries(SORTABLE)) {
      test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
        // Denom Type kiểm tra được thứ tự dữ liệu (theo mã số); cột chữ phụ thuộc collation của server nên chỉ kiểm tra request
        const checkOrder = column === "Denom Type";
        const key = (v) => DENOM_CODE[v];

        const asc = await reloadBy(page, () => th(page, column).click());
        expect(asc).toMatchObject({ sortBy, sortDirection: "asc" });
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

        // Click lần 3: bỏ sort -> quay về mặc định id giảm dần
        const none = await reloadBy(page, () => th(page, column).click());
        expect(none).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      });
    }

    test("Sort giữ nguyên filter đang áp dụng", async ({ page }) => {
      await selectOption(page, "denomTypes", "Slot game");
      const first = await search(page);
      test.skip(first.json.data.list.length < 2, "Không đủ dữ liệu để kiểm tra");
      const body = await reloadBy(page, () => th(page, "Game Sub Category Name").click());
      expect(body).toMatchObject({ sortBy: "name", sortDirection: "asc" });
      expect(body.filters).toEqual(first.body.filters);
      for (const v of await columnValues(page, "Denom Type")) expect(v).toBe("Slot game");
    });

    // Cách sắp xếp được app lưu ở localStorage (sorter__game_game-sub-category) -> reload vẫn giữ
    test("Cách sắp xếp được ghi nhớ sau khi tải lại trang; bỏ sort thì về mặc định id giảm dần", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu");
      await reloadBy(page, () => th(page, "Game Sub Category Name").click());
      const [req] = await Promise.all([page.waitForRequest(isList), page.reload()]);
      expect(JSON.parse(req.postData())).toMatchObject({ sortBy: "name", sortDirection: "asc" });
      await waitTableIdle(page);

      // Bấm 2 lần nữa (asc -> desc -> bỏ sort) rồi reload: về mặc định
      await reloadBy(page, () => th(page, "Game Sub Category Name").click());
      await reloadBy(page, () => th(page, "Game Sub Category Name").click());
      const [req2] = await Promise.all([page.waitForRequest(isList), page.reload()]);
      expect(JSON.parse(req2.postData())).toMatchObject({ sortBy: "id", sortDirection: "desc" });
    });

    test("Cột Action không có chức năng sort", async ({ page }) => {
      await expect(th(page, "Action")).not.toHaveClass(/ant-table-column-has-sorters/);
    });
  });

  // ===== 7. Hộp thoại Update =====
  test.describe("Hộp thoại Update Game Sub Category (không bấm Confirm)", () => {
    test("Bấm icon Update gọi game_sub_category/view và hiển thị đúng dữ liệu của sub category", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];

      const [req] = await Promise.all([page.waitForRequest(isView), editIcon(page, 0).click()]);
      expect(JSON.parse(req.postData()).id).toBe(c.id);

      await expect(dialog(page)).toContainText("Update Game Sub Category");
      await expect(dialog(page).locator("#modalName")).toHaveValue(c.name);
      await expect(dialog(page).locator(".ant-select-selection-item")).toHaveText([
        DENOM_TEXT[c.denomType],
        norm(c.gameCategory),
      ]);
      await closeDialog(page);
    });

    test("Chỉ sửa được Name; Denom Type và Game Category bị khoá; có nút Cancel / Confirm", async ({ page }) => {
      await ensureData(page, test);
      await editIcon(page, 0).click();
      await expect(dialog(page).locator("#modalName")).toBeEnabled();
      await expect(dialog(page).locator("#denomTypeId")).toBeDisabled();
      await expect(dialog(page).locator("#gameCategoryId")).toBeDisabled();
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Confirm$/ })).toBeVisible();
      await closeDialog(page);
    });

    test("Name bắt buộc: để trống thì báo lỗi, bấm Confirm bị chặn và không gửi request lưu", async ({ page }) => {
      await ensureData(page, test);
      await editIcon(page, 0).click();
      // Chờ dữ liệu (API view) nạp vào form xong rồi mới sửa, nếu không giá trị nạp muộn sẽ ghi đè lên chỗ đã xoá
      await expect(dialog(page).locator("#modalName")).not.toHaveValue("");
      await dialog(page).locator("#modalName").fill("");
      await expect(dialog(page).locator(".ant-form-item-explain-error")).toHaveText(MSG.name);
      await dialog(page).getByRole("button", { name: /Confirm$/ }).click(); // form lỗi nên bị chặn, không lưu gì
      await expect(dialog(page).locator(".ant-form-item-explain-error")).toHaveText(MSG.name);
      await expect(dialog(page)).toBeVisible();
      await closeDialog(page);
    });

    for (const [label, value] of [
      ["quá ngắn (dưới 3 ký tự)", "ab"],
      ["chứa ký tự không cho phép", "Name_x"],
      ["dài quá 50 ký tự", "a".repeat(51)],
    ]) {
      test(`Name ${label}: báo lỗi định dạng 3-50 ký tự`, async ({ page }) => {
        await ensureData(page, test);
        await editIcon(page, 0).click();
        await expect(dialog(page).locator("#modalName")).not.toHaveValue("");
        await dialog(page).locator("#modalName").fill(value);
        await expect
          .poll(async () => (await formErrors(page)).some((t) => MSG.format.test(t)), { message: "thiếu lỗi định dạng" })
          .toBe(true);
        await closeDialog(page); // KHÔNG Confirm
      });
    }

    test("Name hợp lệ và chưa dùng: gọi validate_name với đúng name + denomType, backend trả SUCCESS và không báo lỗi", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      await editIcon(page, 0).click();
      await expect(dialog(page).locator("#modalName")).toHaveValue(c.name);

      const name = `QA Check ${Date.now()}`;
      const [req] = await Promise.all([page.waitForRequest(isValidateName), dialog(page).locator("#modalName").fill(name)]);
      expect(JSON.parse(req.postData())).toMatchObject({ name, denomType: c.denomType });
      expect((await (await req.response()).json()).messageCode).toBe("SUCCESS");
      await expect(dialog(page).locator(".ant-form-item-explain-error")).toHaveCount(0);
      await closeDialog(page); // KHÔNG Confirm
    });

    test("Nhập tên của sub category khác (cùng Denom Type): validate_name trả DUPLICATE_GAME_SUB_CATEGORY_NAME và báo lỗi", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      const c = list[0];
      const other = list.find((x) => x.denomType === c.denomType && norm(x.name) !== norm(c.name));
      test.skip(!other, "Không có sub category thứ 2 cùng Denom Type trong trang 1");
      await editIcon(page, 0).click();
      await expect(dialog(page).locator("#modalName")).toHaveValue(c.name);

      const [req] = await Promise.all([
        page.waitForRequest(isValidateName),
        dialog(page).locator("#modalName").fill(other.name),
      ]);
      expect(JSON.parse(req.postData())).toMatchObject({ name: other.name, denomType: c.denomType });
      expect((await (await req.response()).json()).messageCode).toBe("DUPLICATE_GAME_SUB_CATEGORY_NAME");
      await expect(dialog(page).locator(".ant-form-item-explain-error")).toContainText(MSG.duplicate);
      await closeDialog(page); // KHÔNG Confirm
    });

    test("Sửa dữ liệu rồi Cancel thì danh sách không thay đổi", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      await editIcon(page, 0).click();
      await expect(dialog(page).locator("#modalName")).toHaveValue(c.name);
      await dialog(page).locator("#modalName").fill(`${c.name} sửa thử`);
      await closeDialog(page);
      await expect(rowAt(page, 0).locator("td").nth(COLUMNS.indexOf("Game Sub Category Name"))).toHaveText(norm(c.name));
    });

    test("Đóng hộp thoại bằng nút X", async ({ page }) => {
      await ensureData(page, test);
      await editIcon(page, 0).click();
      await expect(dialog(page)).toBeVisible();
      await dialog(page).getByRole("button", { name: "Close" }).first().click();
      await expect(dialog(page)).toBeHidden();
    });
  });

  // ===== 8. Hộp thoại Create =====
  test.describe("Hộp thoại Create Game Sub Category (không bấm Confirm)", () => {
    test("Add New mở hộp thoại Create với form trống (chưa chọn Denom Type / Game Category)", async ({ page }) => {
      await addBtn(page).click();
      await expect(dialog(page)).toContainText("Create Game Sub Category");
      await expect(dialog(page).locator("#modalName")).toHaveValue("");
      await expect(dialog(page).locator("#modalName")).toHaveAttribute("placeholder", "Enter Game Sub Category Name");
      await expect(dialog(page).locator("#modalName")).toBeEnabled();
      await expect(dialog(page).locator("#denomTypeId")).toBeEnabled(); // khác màn hình Update: chọn được
      await expect(dialog(page).locator("#gameCategoryId")).toBeEnabled();
      await expect(dialog(page).locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Confirm$/ })).toBeVisible();
      await closeDialog(page);
    });

    test("Option của Denom Type", async ({ page }) => {
      await addBtn(page).click();
      await formSelect(page, "denomTypeId").click();
      await openOptions(page).first().waitFor();
      expect(await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")))).toEqual(
        DENOM_FORM_OPTIONS,
      );
      await dialog(page).getByText("Create Game Sub Category").click(); // click ra ngoài để đóng dropdown
      await expect(openOptions(page)).toHaveCount(0);
      await closeDialog(page);
    });

    test("Option của Game Category lấy từ API dropdown/gamecategory (đúng thứ tự)", async ({ page }) => {
      const labels = (await categories()).map((c) => c.label);
      test.skip(labels.length === 0, "Không có Game Category nào");
      await addBtn(page).click();
      await formSelect(page, "gameCategoryId").click();
      await openOptions(page).first().waitFor();
      const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      expect(titles.length).toBeGreaterThan(0);
      // Danh sách ảo chỉ render các option đầu tiên -> so với phần đầu của response
      expect(titles).toEqual(labels.slice(0, titles.length));
      await dialog(page).getByText("Create Game Sub Category").click();
      await expect(openOptions(page)).toHaveCount(0);
      await closeDialog(page);
    });

    test("Để trống cả 3 trường rồi Confirm: báo lỗi từng trường và không gửi request lưu", async ({ page }) => {
      await addBtn(page).click();
      await dialog(page).getByRole("button", { name: /Confirm$/ }).click(); // form lỗi nên bị chặn, không lưu gì
      await expect(dialog(page).locator(".ant-form-item-explain-error")).toHaveText([
        MSG.name,
        MSG.denom,
        MSG.category,
      ]);
      await expect(dialog(page)).toBeVisible();
      await closeDialog(page);
    });

    test("Chỉ nhập Name hợp lệ: Confirm vẫn bị chặn vì thiếu Denom Type và Game Category", async ({ page }) => {
      await addBtn(page).click();
      await dialog(page).locator("#modalName").fill("QA Check Create");
      await dialog(page).getByRole("button", { name: /Confirm$/ }).click(); // thiếu 2 trường bắt buộc nên bị chặn
      await expect(dialog(page).locator(".ant-form-item-explain-error")).toHaveText([MSG.denom, MSG.category]);
      await closeDialog(page);
    });

    test("Chọn Denom Type thì lỗi 'Please select Denom Type' biến mất và ô hiển thị giá trị đã chọn", async ({ page }) => {
      await addBtn(page).click();
      await dialog(page).getByRole("button", { name: /Confirm$/ }).click(); // chặn vì form trống
      await expect(dialog(page).locator(".ant-form-item-explain-error")).toContainText([MSG.name, MSG.denom, MSG.category]);
      await pickFormOption(page, "denomTypeId", "Card game");
      await expect(dialog(page).locator(".ant-select-selection-item")).toHaveText(["Card game"]);
      await expect.poll(() => formErrors(page)).not.toContain(MSG.denom);
      await expect.poll(() => formErrors(page)).toEqual(expect.arrayContaining([MSG.name, MSG.category]));
      await closeDialog(page);
    });

    test("Nhập Name trùng: gọi validate_name và backend trả DUPLICATE_GAME_SUB_CATEGORY_NAME", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      await addBtn(page).click();
      await pickFormOption(page, "denomTypeId", DENOM_TEXT[c.denomType]); // validate_name cần có Denom Type

      const [req] = await Promise.all([
        page.waitForRequest(isValidateName),
        dialog(page).locator("#modalName").fill(c.name),
      ]);
      expect(JSON.parse(req.postData())).toMatchObject({ name: c.name, denomType: c.denomType });
      expect((await (await req.response()).json()).messageCode).toBe("DUPLICATE_GAME_SUB_CATEGORY_NAME");
      await expect(dialog(page).locator(".ant-form-item-explain-error")).toContainText(MSG.duplicate);
      await closeDialog(page); // KHÔNG Confirm
    });

    test("Name sai định dạng (dưới 3 ký tự): báo lỗi 3-50 ký tự", async ({ page }) => {
      await addBtn(page).click();
      await dialog(page).locator("#modalName").fill("ab");
      await expect
        .poll(async () => (await formErrors(page)).some((t) => MSG.format.test(t)), { message: "thiếu lỗi định dạng" })
        .toBe(true);
      await closeDialog(page);
    });

    test("Hộp thoại đóng bằng Cancel / X và danh sách không thay đổi", async ({ page }) => {
      const { json } = await search(page);
      await addBtn(page).click();
      await dialog(page).locator("#modalName").fill("Tên thử - không lưu");
      await closeDialog(page);
      await expect(summary(page)).toContainText(`of ${json.data.totalCount} records`);

      await addBtn(page).click();
      await dialog(page).getByRole("button", { name: "Close" }).first().click();
      await expect(dialog(page)).toBeHidden();
      await expect(summary(page)).toContainText(`of ${json.data.totalCount} records`);
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
      await item(page, "Game Category").locator("label").click();
      expect(await headers(page)).not.toContain("Game Category");
      expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

      await item(page, "Game Category").locator("label").click();
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      await ensureData(page, test);
      const before = await columnValues(page, "Game Sub Category Name");
      await columnBtn(page).click();
      await item(page, "Game Category").locator("label").click();
      expect(await columnValues(page, "Game Sub Category Name")).toEqual(before);
    });

    test("Cấu hình cột không được lưu: tải lại trang thì hiện đủ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Game Category").locator("label").click();
      expect(await headers(page)).not.toContain("Game Category");
      await openPage(page); // reload
      expect(await headers(page)).toEqual(COLUMNS);
    });
  });

  // ===== 10. Export (tải file CSV) =====
  test.describe("Export", () => {
    test("Export tải về file CSV đặt tên Game_Sub_Category_List_page1_{thời gian}.csv", async ({ page }) => {
      const { filename } = await exportCsv(page);
      expect(filename).toMatch(/^Game_Sub_Category_List_page1_\d+\.csv$/);
    });

    test("File CSV có tiêu đề các cột (trừ Action) và đủ số dòng của trang hiện tại", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const { header, records } = await exportCsv(page);
      expect(header).toEqual(COLUMNS.filter((c) => c !== "Action"));
      expect(records).toHaveLength(json.data.list.length);
    });

    test("Nội dung CSV khớp dữ liệu API (Denom Type là chữ, không phải mã số)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const { header, records } = await exportCsv(page);
      const col = (name) => header.indexOf(name);
      records.forEach((r, i) => {
        const c = json.data.list[i];
        const at = `dòng ${i + 1} (sub category ${c.id})`;
        expect(r[col("ID")], at).toBe(String(c.id));
        expect(r[col("Game Sub Category Name")], at).toBe(c.name);
        expect(r[col("Denom Type")], at).toBe(DENOM_TEXT[c.denomType]);
        expect(r[col("Game Category")], at).toBe(c.gameCategory);
      });
    });

    test("Export chỉ chứa các dòng của trang đang xem (trang 2 -> page2)", async ({ page }) => {
      test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
      const { json } = await reloadFull(page, () => page.locator(".ant-pagination-item-2").click());
      const { filename, records, header } = await exportCsv(page);
      expect(filename).toMatch(/^Game_Sub_Category_List_page2_\d+\.csv$/);
      expect(records.map((r) => r[header.indexOf("ID")])).toEqual(json.data.list.map((c) => String(c.id)));
    });

    test("Export chỉ chứa các cột đang hiển thị", async ({ page }) => {
      await columnBtn(page).click();
      await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items", { hasText: exact("Game Category") })
        .locator("label")
        .click();
      const { header } = await exportCsv(page);
      expect(header).not.toContain("Game Category");
      expect(header).toContain("Game Sub Category Name");
    });

    test("Export đi kèm đúng filter hiện tại (chỉ các sub category đang hiển thị)", async ({ page }) => {
      await selectOption(page, "denomTypes", "Slot game");
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có sub category Slot game");
      const { header, records } = await exportCsv(page);
      expect(records).toHaveLength(json.data.list.length);
      for (const r of records) expect(r[header.indexOf("Denom Type")]).toBe("Slot game");
    });
  });

  // ===== 11. Ghi nhớ filter =====
  test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
    const { json } = await search(page);
    test.skip(json.data.list.length === 0, "Không có dữ liệu");
    const c = json.data.list[0];
    const cat = (await uniqueCategories()).find((x) => norm(x.label) === norm(c.gameCategory));
    test.skip(!cat, "Tên Game Category của dòng đầu bị trùng với category khác");

    const part = norm(c.name).slice(0, 3).trim(); // đầu tên của dòng đầu -> chắc chắn còn kết quả (còn phân trang)
    await fillFilter(page, "name", part);
    await selectOption(page, "denomTypes", DENOM_TEXT[c.denomType]);
    await selectOption(page, "gameCategoryIds", cat.label);
    await search(page);
    await page.locator(".ant-pagination-options .ant-select").click();
    await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

    await openPage(page); // reload
    await expect(page.locator("#name")).toHaveValue(part);
    expect(await selectedTitles(page, "denomTypes")).toEqual([DENOM_TEXT[c.denomType]]);
    expect(await selectedTitles(page, "gameCategoryIds")).toEqual([cat.label]);
    await expect(page.locator(".ant-pagination-options")).toContainText("20 / page");
  });
});
