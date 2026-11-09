// Games > Game Categories  (https://dev-bo.royaledge.io/game/game-category)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/game_category.spec.js --project=setup --project=chromium
//
// Màn hình quản lý danh mục game (Game Category). Danh sách KHÔNG phân trang (API nhận pageSize 100000 và trả hết),
// Export tải thẳng file CSV về trình duyệt (không tạo bản ghi ở Download History).
//
// Màn hình có các thao tác GHI dữ liệu thật: Create / Update (nút Save), Activate / Deactivate (từng dòng và hàng loạt).
// Test KHÔNG bấm Save, KHÔNG bấm Activate / Deactivate / icon toggle ở từng dòng: chỉ mở hộp thoại, kiểm tra nội dung,
// kiểm tra validation khi để trống (form bị chặn nên không gửi request) rồi bấm Cancel, và kiểm tra không có
// request ghi dữ liệu nào được gửi đi.
// Không hard-code dữ liệu - mọi giá trị lấy từ chính dòng đầu tiên của danh sách.
const fs = require("fs");
const { test, expect } = require("@playwright/test");

test.use({ viewport: { width: 1920, height: 1080 } });

const URL = "/game/game-category";

// Đúng thứ tự hiển thị (cột đầu tiên là checkbox chọn dòng, không có tên)
const COLUMNS = ["ID", "Name", "Code", "Effective Turnover Rate", "Status", "Action"];
const HEADERS = ["", ...COLUMNS];

// Các cột có thể sort -> tên field gửi lên API (mặc định sort theo id giảm dần)
const SORTABLE = {
  Name: "name",
  Code: "code",
  "Effective Turnover Rate": "effectiveTurnoverRate",
  Status: "status",
};

// status gửi/nhận từ API: 1 = Active, 0 = Inactive
const STATUS_TEXT = { 0: "Inactive", 1: "Active" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const isList = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/game/game_category/list");

const rows = (page) => page.locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);

const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const addBtn = (page) => page.getByRole("button", { name: "plus Add New" });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const exportBtn = (page) => page.locator("button.NextGen-export-button");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const bulkBtns = (page) => page.locator("button.NextGen-button-more-action__update");
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

// Thực hiện 1 hành động làm bảng gọi lại API (sort...) rồi trả về request body
async function reloadBy(page, action) {
  const [req] = await Promise.all([page.waitForRequest(isList), action()]);
  await req.response();
  await waitTableIdle(page);
  return JSON.parse(req.postData());
}

const headers = async (page) =>
  (await page.locator(".ant-table-thead th").allInnerTexts()).map((t) => t.trim());

// Lấy toàn bộ giá trị của 1 cột (theo tên header) của mọi dòng
async function columnValues(page, name) {
  await expect.poll(() => headers(page), { message: `Không thấy cột "${name}"` }).toContain(name);
  const idx = (await headers(page)).indexOf(name);
  return rows(page).evaluateAll(
    (trs, i) => trs.map((tr) => tr.children[i].innerText.replace(/\s+/g, " ").trim()),
    idx,
  );
}

// Toàn bộ các dòng của bảng dạng { ID: "...", Name: "...", ... }
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

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
// KHÔNG click giữa ô: với dropdown có chip đã chọn, vị trí đó có thể rơi vào nút (x) -> xoá giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (theo tên) của filter dạng dropdown rồi đóng dropdown
async function selectOption(page, id, title, matcher = exact(title, "i")) {
  await openDropdown(page, id);
  await page.keyboard.type(title);
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
    .filter({ hasText: matcher })
    .first()
    .click();
  // Dropdown không tự đóng và Esc không đóng được -> click ra ngoài
  await breadcrumb(page).click();
  await expect(
    page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option"),
  ).toHaveCount(0);
}

// Đọc toàn bộ option đang có của 1 dropdown
async function dropdownOptions(page, id) {
  await openDropdown(page, id);
  const opts = page.locator(
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
  );
  await opts.first().waitFor();
  const titles = await opts.evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  await breadcrumb(page).click();
  await expect(opts).toHaveCount(0);
  return titles;
}

// Các giá trị đang được chọn của 1 filter
const selectedTitles = (page, id) =>
  filterEl(page, id)
    .locator(".ant-select-selection-item[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));

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
  // validate_code chỉ kiểm tra trùng mã (không lưu gì)
  const READ = /\/(list|details|download|view|dropdown|validate_code)$|\/dropdown\/|\/user\/details$/;
  page.on("request", (r) => {
    if (r.method() === "POST" && /boapi/.test(r.url()) && !READ.test(r.url())) writes.push(r.url());
  });
  return writes;
}

// Đóng hộp thoại bằng Cancel (không bao giờ bấm Save / Activate / Deactivate)
async function closeDialog(page) {
  await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
  await expect(dialog(page)).toBeHidden();
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
test.describe("Games > Game Categories", () => {
  let writes;

  test.beforeEach(async ({ page }) => {
    // Bộ lọc được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__game_category_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/game-category_filter$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__game_category_spec_cleared", "1");
    });
    writes = watchWrites(page);
    await openPage(page);
  });

  // Mọi test đều không được gửi request ghi dữ liệu
  test.afterEach(async () => {
    expect(writes, "Không được gửi request ghi dữ liệu").toEqual([]);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, đủ filter Name / Status và 2 nút Search/Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Game Categories");
      await expect(filterEl(page, "categoryName")).toContainText("Name");
      await expect(filterEl(page, "status")).toContainText("Status");
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: tất cả để trống", async ({ page }) => {
      await expect(page.locator("#categoryName")).toHaveValue("");
      await expect(filterEl(page, "status").locator(".ant-select-selection-item")).toHaveCount(0);
    });

    test("Có nút Add New, 2 nút thao tác hàng loạt, Export và Manage Columns", async ({ page }) => {
      await expect(addBtn(page)).toBeVisible();
      await expect(bulkBtns(page)).toHaveCount(2);
      await expect(exportBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
    });

    test(`Bảng có đủ ${COLUMNS.length} cột (+ cột checkbox) đúng thứ tự`, async ({ page }) => {
      expect(await headers(page)).toEqual(HEADERS);
    });

    test("Mặc định sắp xếp mới nhất (id giảm dần) lên đầu, tải toàn bộ danh sách trong 1 lần", async ({ page }) => {
      const { body, json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      expect(body).toMatchObject({ page: 1, pageSize: 100000, sortBy: "id", sortDirection: "desc" });
      expect(body.filters).toEqual({ sasEntityId: [expect.any(Number)] });
      const ids = json.data.list.map((x) => x.id);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
    });

    test("Không phân trang: hiển thị toàn bộ bản ghi (số dòng = totalCount)", async ({ page }) => {
      const { json } = await search(page);
      await expect(page.locator(".ant-pagination")).toHaveCount(0);
      await expect(rows(page)).toHaveCount(json.data.totalCount);
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
        const at = `dòng ${i + 1} (category ${c.id})`;
        expect(r["ID"], at).toBe(String(c.id));
        expect(r["Name"], at).toBe(norm(c.name));
        expect(r["Code"], at).toBe(norm(c.code));
        expect(r["Effective Turnover Rate"], at).toMatch(/^[\d.]+%$/);
        expect(num(r["Effective Turnover Rate"]), at).toBeCloseTo(c.effectiveTurnoverRate, 6);
        expect(r["Status"], at).toBe(STATUS_TEXT[c.status]);
      });
    });

    test("Định dạng: ID là số, Effective Turnover Rate dạng %, Status hợp lệ", async ({ page }) => {
      await ensureData(page, test);
      for (const v of await columnValues(page, "ID")) expect(v).toMatch(/^\d+$/);
      for (const v of await columnValues(page, "Effective Turnover Rate")) {
        expect(v).toMatch(/^[\d.]+%$/);
        expect(num(v)).toBeGreaterThanOrEqual(0);
        expect(num(v)).toBeLessThanOrEqual(100);
      }
      for (const v of await columnValues(page, "Status")) expect(["Active", "Inactive"]).toContain(v);
      for (const col of ["Name", "Code"]) {
        for (const v of await columnValues(page, col)) expect(v, col).not.toBe("");
      }
      await expect(rowAt(page, 0).locator("td").nth(HEADERS.indexOf("Status")).locator(".ant-tag")).toBeVisible();
    });

    test("Code là duy nhất giữa các dòng", async ({ page }) => {
      await ensureData(page, test);
      const codes = (await columnValues(page, "Code")).map((c) => c.toLowerCase());
      expect(new Set(codes).size).toBe(codes.length);
    });

    test("Mỗi dòng có icon Update và icon bật / tắt trạng thái (chỉ hover, không bấm)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const [i, c] of json.data.list.slice(0, 5).entries()) {
        const icons = rowAt(page, i).locator("td").last().locator("svg");
        await expect(icons).toHaveCount(2);
        await hoverTip(page, icons.nth(0), "Update");
        // chỉ hover, KHÔNG click (sẽ đổi trạng thái category)
        await hoverTip(page, icons.nth(1), exact(c.status === 1 ? "Deactivate" : "Activate"));
      }
    });
  });

  // ===== 3. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Option cố định của Status", async ({ page }) => {
      expect(await dropdownOptions(page, "status")).toEqual(["Active", "Inactive"]);
    });

    test("Lọc theo Name khớp một phần, không phân biệt hoa/thường", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const name = json.data.list[0].name;
      const part = name.slice(1, Math.max(4, name.length - 1)).toUpperCase();
      await fillFilter(page, "categoryName", part);
      const { body, json: res } = await search(page);
      expect(body.filters.categoryName).toBe(part);
      expect(res.data.list.length).toBeGreaterThan(0);
      expect(res.data.list.map((c) => c.name)).toContain(name);
      for (const v of await columnValues(page, "Name")) expect(v.toUpperCase()).toContain(part);
      await expect(rows(page)).toHaveCount(res.data.totalCount);
    });

    test("Lọc theo Name đầy đủ trả về đúng category đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      await fillFilter(page, "categoryName", c.name);
      const { body, json: res } = await search(page);
      expect(body.filters.categoryName).toBe(c.name);
      expect(res.data.list.map((x) => x.id)).toContain(c.id);
      for (const v of await columnValues(page, "Name")) expect(v.toLowerCase()).toContain(norm(c.name).toLowerCase());
    });

    for (const [label, code] of [
      ["Active", 1],
      ["Inactive", 0],
    ]) {
      test(`Lọc theo Status = ${label} gửi status=[${code}] và mọi dòng khớp`, async ({ page }) => {
        await selectOption(page, "status", label);
        const { body, json } = await search(page);
        expect(body.filters.status).toEqual([code]);
        test.skip(json.data.list.length === 0, `Không có category nào ở trạng thái ${label}`);
        for (const c of json.data.list) expect(c.status).toBe(code);
        for (const v of await columnValues(page, "Status")) expect(v).toBe(label);
      });
    }

    test("Số category Active + Inactive bằng tổng số category", async ({ page }) => {
      const total = (await search(page)).json.data.totalCount;
      await selectOption(page, "status", "Active");
      const active = (await search(page)).json.data.totalCount;
      await selectOption(page, "status", "Inactive");
      const inactive = (await search(page)).json.data.totalCount;
      expect(active + inactive).toBe(total);
    });

    test("Status chỉ chọn được 1 giá trị (chọn giá trị mới thì thay thế)", async ({ page }) => {
      await selectOption(page, "status", "Active");
      await selectOption(page, "status", "Inactive");
      expect(await selectedTitles(page, "status")).toEqual(["Inactive"]);
    });

    test("Kết hợp Name và Status cùng lúc (AND)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      await fillFilter(page, "categoryName", c.name);
      await selectOption(page, "status", STATUS_TEXT[c.status]);
      const { body, json: res } = await search(page);
      expect(body.filters).toMatchObject({ categoryName: c.name, status: [c.status] });
      expect(res.data.list.map((x) => x.id)).toContain(c.id);
      for (const r of await tableRecords(page)) expect(r["Status"]).toBe(STATUS_TEXT[c.status]);
    });

    test("Name + Status không khớp nhau -> không có kết quả", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      // Tên đầy đủ của 1 category kèm trạng thái ngược lại -> category đó không nằm trong kết quả
      await fillFilter(page, "categoryName", c.name);
      await selectOption(page, "status", STATUS_TEXT[1 - c.status]);
      const { json: res } = await search(page);
      expect(res.data.list.map((x) => x.id)).not.toContain(c.id);
    });

    test("Không có kết quả -> hiển thị 'There are no entries found'", async ({ page }) => {
      await fillFilter(page, "categoryName", `khong-co-${Date.now()}`);
      const { json } = await search(page);
      expect(json.data.totalCount).toBe(0);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText("There are no entries found").first()).toBeVisible();
    });
  });

  // ===== 4. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá toàn bộ filter đã chọn và hiển thị lại toàn bộ dữ liệu", async ({ page }) => {
      const total = (await search(page)).json.data.totalCount;
      await fillFilter(page, "categoryName", "qa");
      await selectOption(page, "status", "Active");
      await search(page);

      await resetBtn(page).click();
      await expect(page.locator("#categoryName")).toHaveValue("");
      await expect(filterEl(page, "status").locator(".ant-select-selection-item")).toHaveCount(0);

      const { body, json } = await search(page);
      expect(body.filters).toEqual({ sasEntityId: [expect.any(Number)] });
      expect(json.data.totalCount).toBe(total);
    });
  });

  // ===== 5. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    const th = (page, column) => page.locator(".ant-table-thead th", { hasText: exact(column) });

    // LỖI BACKEND ĐÃ XÁC NHẬN: API game_category/list với sortBy=id, sortDirection=asc vẫn trả dữ liệu
    // giảm dần; sortBy=effectiveTurnoverRate (asc / desc) không sắp xếp gì (luôn trả theo id giảm dần).
    // Các test sort 2 cột này kiểm tra đúng hành vi mong đợi nên sẽ FAIL cho tới khi backend sửa.
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
      test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
        // Cột số kiểm tra được thứ tự dữ liệu; cột chữ phụ thuộc collation của server nên chỉ kiểm tra request
        const key = (v) => (column === "Effective Turnover Rate" ? num(v) : column === "Status" ? (v === "Active" ? 1 : 0) : null);
        const checkOrder = key("0") !== null;
        const cmp = (a, b) => a - b;

        const asc = await reloadBy(page, () => th(page, column).click());
        expect(asc).toMatchObject({ sortBy, sortDirection: "asc" });
        if (checkOrder) {
          await expect
            .poll(async () => {
              const v = (await columnValues(page, column)).map(key);
              return JSON.stringify(v) === JSON.stringify([...v].sort(cmp));
            }, { message: "thứ tự tăng dần" })
            .toBe(true);
        }

        const desc = await reloadBy(page, () => th(page, column).click());
        expect(desc).toMatchObject({ sortBy, sortDirection: "desc" });
        if (checkOrder) {
          await expect
            .poll(async () => {
              const v = (await columnValues(page, column)).map(key);
              return JSON.stringify(v) === JSON.stringify([...v].sort((a, b) => cmp(b, a)));
            }, { message: "thứ tự giảm dần" })
            .toBe(true);
        }

        // Click lần 3: bỏ sort -> quay về mặc định id giảm dần
        const none = await reloadBy(page, () => th(page, column).click());
        expect(none).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      });
    }

    test("Cột Action không có chức năng sort", async ({ page }) => {
      await expect(th(page, "Action")).not.toHaveClass(/ant-table-column-has-sorters/);
    });
  });

  // ===== 6. Chọn dòng và thao tác hàng loạt =====
  test.describe("Thao tác hàng loạt (chỉ mở hộp thoại rồi Cancel, không xác nhận)", () => {
    test("Chưa chọn dòng nào thì 2 nút Activate / Deactivate hàng loạt bị vô hiệu", async ({ page }) => {
      await expect(bulkBtns(page).nth(0)).toBeDisabled();
      await expect(bulkBtns(page).nth(1)).toBeDisabled();
    });

    test("Chọn 1 dòng thì 2 nút được bật, bỏ chọn thì tắt lại", async ({ page }) => {
      await ensureData(page, test);
      await rowAt(page, 0).locator('input[type="checkbox"]').check();
      await expect(bulkBtns(page).nth(0)).toBeEnabled();
      await expect(bulkBtns(page).nth(1)).toBeEnabled();
      await rowAt(page, 0).locator('input[type="checkbox"]').uncheck();
      await expect(bulkBtns(page).nth(0)).toBeDisabled();
      await expect(bulkBtns(page).nth(1)).toBeDisabled();
    });

    test("Checkbox ở tiêu đề chọn / bỏ chọn tất cả dòng", async ({ page }) => {
      await ensureData(page, test);
      const all = page.getByRole("checkbox", { name: "Select all" });
      await all.check();
      const n = await rows(page).count();
      await expect(page.locator('tbody tr.ant-table-row input[type="checkbox"]:checked')).toHaveCount(n);
      await expect(bulkBtns(page).first()).toBeEnabled();
      await all.uncheck();
      await expect(page.locator('tbody tr.ant-table-row input[type="checkbox"]:checked')).toHaveCount(0);
    });

    test("Tooltip của 2 nút thao tác hàng loạt", async ({ page }) => {
      await ensureData(page, test);
      await rowAt(page, 0).locator('input[type="checkbox"]').check();
      await hoverTip(page, bulkBtns(page).nth(0), "Bulk Activate");
      await hoverTip(page, bulkBtns(page).nth(1), "Bulk Deactivate");
    });

    for (const [i, action] of ["Activate", "Deactivate"].entries()) {
      test(`${action} 1 category: hộp thoại xác nhận đúng nội dung, đóng bằng Cancel`, async ({ page }) => {
        await ensureData(page, test);
        await rowAt(page, 0).locator('input[type="checkbox"]').check();
        await bulkBtns(page).nth(i).click();

        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toContainText(`${action} this game category?`);
        await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
        await expect(dialog(page).getByRole("button", { name: new RegExp(`${action}$`) })).toBeVisible();

        await closeDialog(page); // chỉ Cancel
        // Dòng vẫn đang được chọn sau khi đóng hộp thoại
        await expect(rowAt(page, 0).locator('input[type="checkbox"]')).toBeChecked();
      });

      test(`${action} nhiều category: hộp thoại ghi rõ số lượng, đóng bằng Cancel`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Cần ít nhất 2 category");
        await rowAt(page, 0).locator('input[type="checkbox"]').check();
        await rowAt(page, 1).locator('input[type="checkbox"]').check();
        await bulkBtns(page).nth(i).click();

        await expect(dialog(page)).toContainText(`${action} 2 game categories`);
        await expect(dialog(page)).toContainText(`${action} selected game categories?`);
        await closeDialog(page); // chỉ Cancel
      });
    }
  });

  // ===== 7. Hộp thoại Update =====
  test.describe("Hộp thoại Update Game Category (không bấm Save)", () => {
    test("Bấm icon Update gọi game_category/view và hiển thị đúng dữ liệu của category", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];

      const [req] = await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/game/game_category/view")),
        rowAt(page, 0).locator('svg[data-icon="pen-to-square"]').click(),
      ]);
      expect(JSON.parse(req.postData()).id).toBe(c.id);

      await expect(dialog(page)).toContainText("Update Game Category");
      await expect(dialog(page).locator("#name")).toHaveValue(c.name);
      await expect(dialog(page).locator("#code")).toHaveValue(c.code);
      await expect(dialog(page).locator("#effectiveTurnoverRate")).toHaveValue(String(c.effectiveTurnoverRate));
      await expect(dialog(page).locator('input[type="radio"][value="1"]')).toBeChecked({ checked: c.status === 1 });
      await expect(dialog(page).locator('input[type="radio"][value="0"]')).toBeChecked({ checked: c.status !== 1 });
      await closeDialog(page);
    });

    test("Code không sửa được, các trường còn lại sửa được; có nút Cancel / Save", async ({ page }) => {
      await ensureData(page, test);
      await rowAt(page, 0).locator('svg[data-icon="pen-to-square"]').click();
      await expect(dialog(page).locator("#name")).toBeEnabled();
      await expect(dialog(page).locator("#code")).toBeDisabled();
      await expect(dialog(page).locator("#effectiveTurnoverRate")).toBeEnabled();
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Save$/ })).toBeVisible();
      await closeDialog(page);
    });

    test("Name bắt buộc: để trống rồi Save thì báo lỗi và không gửi request lưu", async ({ page }) => {
      await ensureData(page, test);
      await rowAt(page, 0).locator('svg[data-icon="pen-to-square"]').click();
      // Chờ dữ liệu category (API view) nạp vào form xong rồi mới sửa, nếu không giá trị nạp muộn sẽ ghi đè lên chỗ đã xoá
      await expect(dialog(page).locator("#name")).not.toHaveValue("");
      await dialog(page).locator("#name").fill("");
      await dialog(page).getByRole("button", { name: /Save$/ }).click(); // form lỗi nên bị chặn, không lưu gì
      await expect(dialog(page).locator(".ant-form-item-explain-error")).toHaveText("Please enter Name");
      await expect(dialog(page)).toBeVisible();
      await closeDialog(page);
    });

    test("Sửa dữ liệu rồi Cancel thì danh sách không thay đổi", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      await rowAt(page, 0).locator('svg[data-icon="pen-to-square"]').click();
      await expect(dialog(page).locator("#name")).toHaveValue(c.name);
      await dialog(page).locator("#name").fill(`${c.name} (sửa thử)`);
      await closeDialog(page);
      await expect(rowAt(page, 0).locator("td").nth(HEADERS.indexOf("Name"))).toHaveText(norm(c.name));
    });
  });

  // ===== 8. Hộp thoại Create =====
  test.describe("Hộp thoại Create Game Category (không bấm Save)", () => {
    test("Add New mở hộp thoại Create với giá trị mặc định: Status Active, Effective Turnover Rate 100", async ({
      page,
    }) => {
      await addBtn(page).click();
      await expect(dialog(page)).toContainText("Create Game Category");
      await expect(dialog(page).locator("#name")).toHaveValue("");
      await expect(dialog(page).locator("#code")).toHaveValue("");
      await expect(dialog(page).locator("#code")).toBeEnabled(); // khác màn hình Update: Code nhập được
      await expect(dialog(page).locator("#effectiveTurnoverRate")).toHaveValue("100");
      await expect(dialog(page).locator('input[type="radio"][value="1"]')).toBeChecked();
      await expect(dialog(page).locator('input[type="radio"][value="0"]')).not.toBeChecked();
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Save$/ })).toBeVisible();
      await closeDialog(page);
    });

    test("Để trống Name / Code rồi Save: báo lỗi từng trường và không gửi request lưu", async ({ page }) => {
      await addBtn(page).click();
      await dialog(page).getByRole("button", { name: /Save$/ }).click(); // form lỗi nên bị chặn, không lưu gì
      const errors = dialog(page).locator(".ant-form-item-explain-error");
      await expect(errors).toHaveText(["Please enter Name", "Please enter Code"]);
      await expect(dialog(page)).toBeVisible();
      await closeDialog(page);
    });

    test("Effective Turnover Rate bắt buộc: xoá trống rồi Save thì báo lỗi", async ({ page }) => {
      await addBtn(page).click();
      await dialog(page).locator("#effectiveTurnoverRate").fill("");
      // Name / Code vẫn trống nên form bị chặn, không lưu gì
      await dialog(page).getByRole("button", { name: /Save$/ }).click();
      await expect(dialog(page).locator(".ant-form-item-explain-error")).toContainText([
        "Please enter Name",
        "Please enter Code",
        "Please enter Effective Turnover Rate",
      ]);
      await closeDialog(page);
    });

    test("Nhập Code trùng: gọi validate_code và backend trả DUPLICATE_GAME_CATEGORY_CODE", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const code = json.data.list[0].code;
      await addBtn(page).click();

      const [req] = await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/game/game_category/validate_code")),
        (async () => {
          await dialog(page).locator("#code").fill(code);
          await dialog(page).locator("#code").blur();
        })(),
      ]);
      expect(JSON.parse(req.postData()).code).toBe(code);
      const res = await (await req.response()).json();
      expect(res.messageCode).toBe("DUPLICATE_GAME_CATEGORY_CODE");
      await closeDialog(page); // KHÔNG Save
    });

    test("Hộp thoại đóng bằng Cancel và danh sách không thay đổi", async ({ page }) => {
      const { json } = await search(page);
      await addBtn(page).click();
      await dialog(page).locator("#name").fill("Tên thử - không lưu");
      await closeDialog(page);
      await expect(rows(page)).toHaveCount(json.data.totalCount);
    });
  });

  // ===== 9. Manage Columns =====
  test.describe("Manage Columns", () => {
    // hasText dạng RegExp khớp CHÍNH XÁC tên cột
    const item = (page, name) =>
      columnPopover(page).locator(".NextGen-popover-manage-column__list__items", {
        hasText: exact(name),
      });

    test("Popover liệt kê đủ cột", async ({ page }) => {
      await columnBtn(page).click();
      const names = await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items")
        .allInnerTexts();
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
      await ensureData(page, test);
      const before = await columnValues(page, "Name");
      await columnBtn(page).click();
      await item(page, "Code").locator("label").click();
      expect(await columnValues(page, "Name")).toEqual(before);
    });

    test("Cấu hình cột không được lưu: tải lại trang thì hiện đủ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Code").locator("label").click();
      expect(await headers(page)).not.toContain("Code");
      await openPage(page); // reload
      expect(await headers(page)).toEqual(HEADERS);
    });
  });

  // ===== 10. Export (tải file CSV) =====
  test.describe("Export", () => {
    test("Export tải về file CSV đặt tên Game_Category_List_page1_{thời gian}.csv", async ({ page }) => {
      const { filename } = await exportCsv(page);
      expect(filename).toMatch(/^Game_Category_List_page1_\d+\.csv$/);
    });

    test("File CSV có tiêu đề các cột (trừ Action) và đủ số dòng của danh sách", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const { header, records } = await exportCsv(page);
      expect(header).toEqual(COLUMNS.filter((c) => c !== "Action"));
      expect(records).toHaveLength(json.data.totalCount);
    });

    test("Nội dung CSV khớp dữ liệu API (Effective Turnover Rate là số, không có dấu %)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const { header, records } = await exportCsv(page);
      const col = (name) => header.indexOf(name);
      records.forEach((r, i) => {
        const c = json.data.list[i];
        const at = `dòng ${i + 1} (category ${c.id})`;
        expect(r[col("ID")], at).toBe(String(c.id));
        expect(r[col("Name")], at).toBe(c.name);
        expect(r[col("Code")], at).toBe(c.code);
        expect(parseFloat(r[col("Effective Turnover Rate")]), at).toBeCloseTo(c.effectiveTurnoverRate, 6);
        expect(r[col("Status")], at).toBe(STATUS_TEXT[c.status]);
      });
    });

    test("Export chỉ chứa các cột đang hiển thị", async ({ page }) => {
      await columnBtn(page).click();
      await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items", { hasText: exact("Code") })
        .locator("label")
        .click();
      const { header } = await exportCsv(page);
      expect(header).not.toContain("Code");
      expect(header).toContain("Name");
    });

    test("Export đi kèm đúng filter hiện tại (chỉ các category đang hiển thị)", async ({ page }) => {
      await selectOption(page, "status", "Inactive");
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có category Inactive");
      const { header, records } = await exportCsv(page);
      expect(records).toHaveLength(json.data.totalCount);
      for (const r of records) expect(r[header.indexOf("Status")]).toBe("Inactive");
    });
  });

  // ===== 11. Ghi nhớ filter =====
  test("Filter được ghi nhớ sau khi reload trang", async ({ page }) => {
    await ensureData(page, test);
    await fillFilter(page, "categoryName", "qa");
    await selectOption(page, "status", "Active");
    await search(page);

    await openPage(page); // reload
    await expect(page.locator("#categoryName")).toHaveValue("qa");
    expect(await selectedTitles(page, "status")).toEqual(["Active"]);
  });
});
