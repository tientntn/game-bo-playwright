// Báo cáo > Alert Report  (https://dev-bo.royaledge.io/report/alert)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/report_alert.spec.js --project=setup --project=chromium
//
// Màn hình liệt kê các cảnh báo (alert) do hệ thống sinh ra theo Rule (vd High Win Rate): người chơi nào, game nào,
// trong khung giờ nào, Win Rate bao nhiêu, mức độ Severity...
//
// Các test chỉ ĐỌC dữ liệu. Màn hình còn 2 thao tác GHI dữ liệu mà test KHÔNG kiểm tra bằng cách bấm:
//  - bấm icon Flag ở cột Flag (đánh dấu / bỏ đánh dấu cảnh báo)
//  - bấm icon toggle ở cột Action (Deactivate / Activate cảnh báo)
// Test chỉ kiểm tra hiển thị (icon, tooltip) để không làm thay đổi dữ liệu thật.
// Màn hình không có nút Export.
// Không hard-code dữ liệu (người chơi, game, rule...) - mọi giá trị lấy từ chính dòng đầu tiên của báo cáo.
const { test, expect } = require("@playwright/test");

const URL = "/report/alert";

// Đúng thứ tự hiển thị
const COLUMNS = [
  "From Time",
  "To Time",
  "Player Name",
  "Game",
  "Currency",
  "Win Rate",
  "Rule Name",
  "Severity",
  "Flag",
  "Status",
  "Action",
];

// Các cột có thể sort -> tên field gửi lên API (mặc định sort theo id giảm dần)
const SORTABLE = {
  "From Time": "fromTime",
  "To Time": "toTime",
  "Player Name": "playerName",
  Game: "gameName",
  "Win Rate": "winRate",
  Severity: "severity",
};
// Cột kiểm tra được thứ tự dữ liệu sau khi sort (cột chữ phụ thuộc collation của server nên chỉ kiểm tra request)
const ORDER_CHECK = ["From Time", "To Time", "Win Rate"];

// status gửi/nhận từ API: 1 = Active, 0 = Inactive; flag: 1 = Flag, 0 = Un-Flag
const STATUS_TEXT = { 0: "Inactive", 1: "Active" };

const DATETIME = /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/;
const WIN_RATE = /^-?[\d,]+\.\d{4}%$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
// Chuông thông báo ở header cũng gọi /alertreport/list (filters rỗng) nên phân biệt bằng timezoneId của màn hình này
const isList = (r) =>
  reqOf(r).method() === "POST" &&
  reqOf(r).url().endsWith("/alertreport/list") &&
  (reqOf(r).postData() || "").includes('"timezoneId"');
const isBetHistory = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/bet_history/settled");

const mainTable = (page) => page.locator(".ant-table").first();
const rows = (page) => mainTable(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const exportBtn = (page) => page.locator("button.NextGen-export-button");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");

// Phần tử bao 1 filter (theo id của input bên trong)
const filterEl = (page, id) =>
  page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
const dateRangeInput = (page) => page.locator("#fromTime_dateRange");

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
}

// Mở màn hình và chờ lần load đầu tiên (default filter) xong
async function openPage(page) {
  // Truy vấn báo cáo trên dev đôi khi chậm -> cho 60s cho lần load đầu
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

// Bấm Search, trả về { body: request body, status, json: response body }
async function search(page) {
  const [req, res] = await Promise.all([
    page.waitForRequest(isList),
    page.waitForResponse(isList),
    searchBtn(page).click(),
  ]);
  await waitTableIdle(page);
  return { body: JSON.parse(req.postData()), status: res.status(), json: await res.json() };
}

// Thực hiện 1 hành động làm bảng gọi lại API (đổi trang, sort...) rồi trả về request body
async function reloadBy(page, action) {
  const [req] = await Promise.all([
    page.waitForRequest(isList),
    page.waitForResponse(isList),
    action(),
  ]);
  await waitTableIdle(page);
  return JSON.parse(req.postData());
}

async function headers(page) {
  return (await mainTable(page).locator("thead th").allInnerTexts()).map((t) => t.trim());
}

// Lấy toàn bộ giá trị của 1 cột (theo tên header) ở trang hiện tại
async function columnValues(page, name) {
  await expect.poll(() => headers(page), { message: `Không thấy cột "${name}"` }).toContain(name);
  const idx = (await headers(page)).indexOf(name);
  return rows(page).evaluateAll(
    (trs, i) => trs.map((tr) => tr.children[i].innerText.trim()),
    idx,
  );
}

// Toàn bộ các dòng của bảng dạng { "From Time": "...", ... }
async function tableRecords(page) {
  const heads = await headers(page);
  const cells = await rows(page).evaluateAll((trs) =>
    trs.map((tr) => [...tr.children].map((c) => c.innerText.trim())),
  );
  return cells.map((r) => Object.fromEntries(heads.map((h, i) => [h, r[i]])));
}

const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
const exact = (name, flags = "") =>
  new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, flags);
// "23-10-2026 17:43:34" -> "2026-10-23 17:43:34" (so sánh chuỗi được theo thứ tự thời gian)
const toIso = (s) => s.replace(/^(\d{2})-(\d{2})-(\d{4})/, "$3-$2-$1");
// "09-11-2026 ..." -> Date (UTC, chỉ lấy phần ngày)
function parseDay(s) {
  const [d, m, y] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const diffDays = (a, b) => Math.round((a - b) / 86400000);

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
// KHÔNG click giữa ô: với dropdown chọn nhiều, vị trí đó có thể rơi vào nút (x) của chip đã chọn
// (vị trí chip còn đổi theo lúc antd đo lại) -> bấm vào sẽ XOÁ giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (theo tên) của filter dạng dropdown rồi đóng dropdown.
// Gõ tên vào ô tìm kiếm trước để option chắc chắn nằm trong danh sách hiển thị.
async function selectOption(page, id, title, matcher = exact(title, "i")) {
  await openDropdown(page, id);
  await page.keyboard.type(title);
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
    .filter({ hasText: matcher })
    .first()
    .click();
  // Dropdown chọn nhiều không tự đóng và Esc cũng không đóng được -> click ra ngoài.
  // (Nếu để mở, lần click tiếp theo vào ô sẽ làm mất giá trị đang chọn)
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
  // Click ra ngoài để đóng dropdown - phím Esc không đóng được khi chưa gõ tìm kiếm
  await breadcrumb(page).click();
  await expect(
    page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option"),
  ).toHaveCount(0);
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
  const rest = await filterEl(page, id)
    .locator(".ant-select-selection-overflow-item-rest")
    .allInnerTexts();
  const hidden = rest.reduce((sum, t) => sum + Number(t.match(/\+\s*(\d+)/)?.[1] ?? 0), 0);
  return shown + hidden;
}

// Nhập text vào filter dạng input (input bị ẩn cho tới khi click vào label)
async function fillFilter(page, id, value) {
  await filterEl(page, id).locator("label").first().click();
  await page.locator(`#${id}`).fill(value);
}

// Chọn preset ngày (Today / Yesterday / Last 7 Days ...) cho Time Period
async function pickDatePreset(page, preset) {
  await filterEl(page, "fromTime_0").locator("label").first().click();
  // Popup của picker đang mở luôn được append SAU cùng trong DOM -> .last()
  await page.locator(".NextGen-datetime-preset__item").filter({ hasText: preset }).last().click();
  // Popup không tự đóng: click ra ngoài (tiêu đề trang) để đóng
  await breadcrumb(page).click();
}

// Xoá Time Period bằng nút (x) (chỉ render khi rê chuột vào ô ngày)
async function clearDate(page) {
  await filterEl(page, "fromTime_0").hover();
  await filterEl(page, "fromTime_0").locator('[aria-label="close-circle"]').click({ force: true });
}

// Màn hình không lọc ngày mặc định nên thường có dữ liệu; nếu trống thì skip
async function ensureData(page, test) {
  if ((await rows(page).count()) === 0) test.skip(true, "Báo cáo không có bản ghi nào để test");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Report > Alert Report", () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, đủ filter và 2 nút Search/Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Alert Report");
      for (const [label, id] of [
        ["Timezone", "timezoneId"],
        ["Time Period", "fromTime_0"],
        ["Player Name", "playerName"],
        ["Game", "gameIds"],
        ["Currency", "currencyIds"],
        ["Rule Name", "ruleSettingIds"],
        ["Severity", "severity"],
        ["Status", "status"],
        ["Flag", "flag"],
      ]) {
        await expect(filterEl(page, id), `thiếu filter ${label}`).toContainText(label);
        await expect(filterEl(page, id)).toBeVisible();
      }
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: chỉ có Timezone, còn lại để trống", async ({ page }) => {
      await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toContainText(
        /^\(GMT [+-]\d{2}:\d{2}\)/,
      );
      await expect(dateRangeInput(page)).toHaveValue("");
      await expect(page.locator("#playerName")).toHaveValue("");
      for (const id of ["gameIds", "currencyIds", "ruleSettingIds", "severity", "status", "flag"]) {
        await expect(
          filterEl(page, id).locator(".ant-select-selection-item"),
          `#${id} phải trống`,
        ).toHaveCount(0);
      }
    });

    test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự, có Manage Columns và không có Export`, async ({ page }) => {
      expect(await headers(page)).toEqual(COLUMNS);
      await expect(columnBtn(page)).toBeVisible();
      await expect(exportBtn(page)).toHaveCount(0);
    });

    test("Mặc định 10 dòng / trang, sắp xếp mới nhất (id giảm dần) lên đầu", async ({ page }) => {
      const { body, json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc" });
      expect(await rows(page).count()).toBeLessThanOrEqual(10);
      const ids = json.data.list.map((x) => x.id);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
      await expect(summary(page)).toHaveText(/^Showing 1 - \d+ of /);
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
        const a = list[i];
        const at = `dòng ${i + 1} (alert ${a.id})`;
        expect(r["From Time"], at).toBe(a.fromTime);
        expect(r["To Time"], at).toBe(a.toTime);
        expect(r["Player Name"], at).toBe(a.playerName);
        expect(r["Game"], at).toBe(a.gameName);
        expect(r["Currency"], at).toBe(a.currencyCode);
        expect(num(r["Win Rate"]), at).toBeCloseTo(a.winRate, 4);
        expect(r["Rule Name"], at).toBe(a.ruleName);
        expect(r["Severity"], at).toBe(a.severity);
        expect(r["Status"], at).toBe(STATUS_TEXT[a.status]);
      });
    });

    test("Định dạng: ngày giờ, Win Rate dạng %, Severity / Status hợp lệ", async ({ page }) => {
      await ensureData(page, test);
      for (const col of ["From Time", "To Time"]) {
        for (const v of await columnValues(page, col)) expect(v, col).toMatch(DATETIME);
      }
      for (const v of await columnValues(page, "Win Rate")) expect(v).toMatch(WIN_RATE);
      for (const v of await columnValues(page, "Severity")) {
        expect(["Info", "Warning", "Critical"]).toContain(v);
      }
      for (const v of await columnValues(page, "Status")) expect(["Active", "Inactive"]).toContain(v);
      for (const v of await columnValues(page, "Rule Name")) expect(v).not.toBe("");
      await expect(rowAt(page, 0).locator("td").nth(COLUMNS.indexOf("Status")).locator(".ant-tag")).toBeVisible();
    });

    test("Ràng buộc dữ liệu: From Time <= To Time", async ({ page }) => {
      await ensureData(page, test);
      for (const r of await tableRecords(page)) {
        expect(
          toIso(r["From Time"]) <= toIso(r["To Time"]),
          `${r["Player Name"]}: From Time phải <= To Time`,
        ).toBe(true);
      }
    });

    test("Cột Flag hiển thị icon cờ, cột Action hiển thị icon toggle (tooltip Deactivate với cảnh báo Active)", async ({
      page,
    }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const i = json.data.list.findIndex((x) => x.status === 1);
      test.skip(i < 0, "Không có cảnh báo Active ở trang đầu");

      const row = rowAt(page, i);
      await expect(row.locator("td").nth(COLUMNS.indexOf("Flag")).locator("svg")).toBeVisible();

      const toggle = row.locator("td").nth(COLUMNS.indexOf("Action")).locator("svg");
      await expect(toggle).toBeVisible();
      await toggle.hover(); // chỉ hover, KHÔNG click (sẽ đổi trạng thái cảnh báo)
      await expect(page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: "Deactivate" })).toBeVisible();
    });

    test("Player Name là link, bấm vào mở Bet History với filter của cảnh báo", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const a = json.data.list[0];

      const [req] = await Promise.all([
        page.waitForRequest(isBetHistory, { timeout: 30000 }),
        rowAt(page, 0).locator("td a").filter({ hasText: exact(a.playerName) }).click(),
      ]);
      await expect(page).toHaveURL(/\/report\/bet-history$/);
      await expect(breadcrumb(page)).toHaveText("Bet History Report");

      // Bet History được lọc đúng theo người chơi, game, currency và khung giờ của cảnh báo
      const { filters } = JSON.parse(req.postData());
      expect(filters.playerName).toBe(a.playerName);
      expect(filters.gameIds).toEqual([a.gameId]);
      expect(filters.currencyIds).toEqual([a.currencyId]);
      expect(filters.settledTime).toEqual([a.fromTime, a.toTime]);
      await expect(page.locator("#playerName")).toHaveValue(a.playerName);
    });
  });

  // ===== 3. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Search mặc định gửi đúng request (timezone, phân trang, sort) và không có filter nào khác", async ({
      page,
    }) => {
      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc" });
      expect(Object.keys(body.filters)).toEqual(["timezoneId"]);
      expect(body.filters.timezoneId).toEqual(expect.any(Number));
    });

    for (const [label, id] of [
      ["Game", "gameIds"],
      ["Currency", "currencyIds"],
      ["Rule Name", "ruleSettingIds"],
      ["Severity", "severity"],
      ["Status", "status"],
      ["Flag", "flag"],
    ]) {
      test(`Dropdown ${label} load được danh sách option`, async ({ page }) => {
        expect((await dropdownOptions(page, id)).length).toBeGreaterThan(0);
      });
    }

    test("Option cố định của Severity, Status và Flag", async ({ page }) => {
      expect(await dropdownOptions(page, "severity")).toEqual(["Critical", "Info", "Warning"]);
      expect(await dropdownOptions(page, "status")).toEqual(["Active", "Inactive"]);
      expect(await dropdownOptions(page, "flag")).toEqual(["Flag", "Un-Flag"]);
    });

    test("Tìm theo Player Name (không phân biệt hoa/thường, khớp một phần)", async ({ page }) => {
      await ensureData(page, test);
      const player = (await columnValues(page, "Player Name"))[0];
      const part = player.slice(0, Math.max(3, player.length - 2)).toUpperCase();
      await fillFilter(page, "playerName", part);
      const { body } = await search(page);

      expect(body.filters.playerName).toBe(part);
      const values = await columnValues(page, "Player Name");
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(v.toLowerCase()).toContain(part.toLowerCase());
    });

    // Lọc theo từng dropdown chọn nhiều giá trị (lấy giá trị từ dòng đầu tiên) -> mọi dòng phải khớp
    for (const { label, id, column, field } of [
      { label: "Game", id: "gameIds", column: "Game", field: "gameIds" },
      { label: "Currency", id: "currencyIds", column: "Currency", field: "currencyIds" },
      { label: "Rule Name", id: "ruleSettingIds", column: "Rule Name", field: "ruleSettingIds" },
    ]) {
      test(`Lọc theo ${label} -> mọi dòng khớp giá trị đã chọn`, async ({ page }) => {
        await ensureData(page, test);
        const value = (await columnValues(page, column))[0];
        await selectOption(page, id, value);
        const { body, status } = await search(page);

        expect(status).toBe(200);
        expect(body.filters[field], `request thiếu ${field}`).toHaveLength(1);
        const values = await columnValues(page, column);
        expect(values.length, `không có dòng nào với ${column}=${value}`).toBeGreaterThan(0);
        for (const v of values) expect(v).toBe(value);
      });
    }

    test("Lọc theo Severity (chọn 1 giá trị) -> mọi dòng khớp", async ({ page }) => {
      await ensureData(page, test);
      const severity = (await columnValues(page, "Severity"))[0];
      await selectOption(page, "severity", severity);
      const { body } = await search(page);

      expect(body.filters.severity).toBe(severity);
      for (const v of await columnValues(page, "Severity")) expect(v).toBe(severity);
    });

    test("Severity chỉ chọn được 1 giá trị (chọn giá trị mới thì thay thế)", async ({ page }) => {
      await selectOption(page, "severity", "Critical");
      await selectOption(page, "severity", "Info");
      expect(await selectedTitles(page, "severity")).toEqual(["Info"]);
      const { body } = await search(page);
      expect(body.filters.severity).toBe("Info");
    });

    for (const [label, code] of [
      ["Active", 1],
      ["Inactive", 0],
    ]) {
      test(`Lọc theo Status = ${label} gửi status=${code} và mọi dòng khớp`, async ({ page }) => {
        await selectOption(page, "status", label);
        const { body, status } = await search(page);
        expect(status).toBe(200);
        expect(body.filters.status).toBe(code);
        // Có thể không có cảnh báo nào ở trạng thái này -> khi đó chỉ kiểm tra hiển thị trống
        const values = await columnValues(page, "Status");
        for (const v of values) expect(v).toBe(label);
        if (values.length === 0) {
          await expect(page.getByText("There are no entries found").first()).toBeVisible();
        }
      });
    }

    for (const [label, code] of [
      ["Flag", 1],
      ["Un-Flag", 0],
    ]) {
      test(`Lọc theo Flag = ${label} gửi flag=${code} và mọi dòng khớp`, async ({ page }) => {
        await selectOption(page, "flag", label);
        const { body, json } = await search(page);
        expect(body.filters.flag).toBe(code);
        test.skip(json.data.list.length === 0, `Không có cảnh báo nào ở trạng thái ${label}`);
        for (const a of json.data.list) expect(a.flag).toBe(code);
      });
    }

    test("Dropdown cho phép chọn nhiều giá trị (Game, Currency, Rule Name)", async ({ page }) => {
      for (const [id, field] of [
        ["gameIds", "gameIds"],
        ["currencyIds", "currencyIds"],
        ["ruleSettingIds", "ruleSettingIds"],
      ]) {
        const options = await dropdownOptions(page, id);
        expect(options.length, id).toBeGreaterThan(1);
        await selectOption(page, id, options[0]);
        await selectOption(page, id, options[1]);
        // Ô filter chỉ hiện 1 chip, phần còn lại gom thành "+ N ..." nên đếm tổng số giá trị đã chọn
        // antd đo lại chip bất đồng bộ sau khi chọn nên dùng poll thay vì đọc 1 lần
        await expect.poll(() => selectedCount(page, id), { message: id, timeout: 10_000 }).toBe(2);
        const { body } = await search(page);
        expect(body.filters[field], id).toHaveLength(2);
      }
    });

    test("Kết hợp nhiều filter cùng lúc (AND)", async ({ page }) => {
      await ensureData(page, test);
      const [game, currency, severity] = await Promise.all(
        ["Game", "Currency", "Severity"].map((c) => columnValues(page, c).then((v) => v[0])),
      );
      await selectOption(page, "gameIds", game);
      await selectOption(page, "currencyIds", currency);
      await selectOption(page, "severity", severity);
      const { body } = await search(page);
      expect(body.filters.gameIds).toHaveLength(1);
      expect(body.filters.currencyIds).toHaveLength(1);
      expect(body.filters.severity).toBe(severity);

      for (const v of await columnValues(page, "Game")) expect(v).toBe(game);
      for (const v of await columnValues(page, "Currency")) expect(v).toBe(currency);
      for (const v of await columnValues(page, "Severity")) expect(v).toBe(severity);
    });

    test("Không có kết quả -> hiển thị 'There are no entries found'", async ({ page }) => {
      await fillFilter(page, "playerName", "no_such_player_zzz_999");
      await search(page);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText("There are no entries found").first()).toBeVisible();
      await expect(summary(page)).toHaveText("Showing 0 - 0 of 0 records");
    });

    test("Đổi Timezone gửi timezoneId mới", async ({ page }) => {
      const before = (await search(page)).body.filters.timezoneId;
      const current = await filterEl(page, "timezoneId")
        .locator(".ant-select-selection-item")
        .getAttribute("title");

      const options = await dropdownOptions(page, "timezoneId");
      const other = options.find((o) => o !== current);
      await selectOption(page, "timezoneId", other);
      await expect(
        filterEl(page, "timezoneId").locator(".ant-select-selection-item"),
      ).toHaveAttribute("title", other);

      const after = (await search(page)).body.filters.timezoneId;
      expect(after).not.toBe(before);
    });
  });

  // ===== 4. Bộ lọc thời gian =====
  test.describe("Time Period", () => {
    test("Time Period có đủ các preset", async ({ page }) => {
      await filterEl(page, "fromTime_0").locator("label").first().click();
      const presets = page.locator(".NextGen-datetime-preset__item");
      await expect(presets.first()).toBeVisible();
      expect((await presets.allInnerTexts()).map((t) => t.trim())).toEqual([
        "Today",
        "Yesterday",
        "Last 7 Days",
        "Last 14 Days",
        "Last 30 Days",
        "Last 90 Days",
      ]);
    });

    test("Các preset cho khoảng ngày đúng và gửi đúng request fromTime", async ({ page }) => {
      // [preset, số ngày tính cả hôm nay]
      const PRESETS = [
        ["Today", 1],
        ["Last 7 Days", 7],
        ["Last 14 Days", 14],
        ["Last 30 Days", 30],
        ["Last 90 Days", 90],
      ];
      let today;
      for (const [preset, days] of PRESETS) {
        await pickDatePreset(page, preset);
        const value = await dateRangeInput(page).inputValue();
        const [from, to] = value.split(" - ");
        expect(from.slice(11), preset).toBe("00:00:00");
        expect(to.slice(11), preset).toBe("23:59:59");
        if (preset === "Today") today = parseDay(to);
        expect(parseDay(to).getTime(), preset).toBe(today.getTime()); // luôn kết thúc ở hôm nay
        expect(diffDays(parseDay(to), parseDay(from)) + 1, preset).toBe(days);

        const { body } = await search(page);
        expect(body.filters.fromTime, preset).toEqual([from, to]);
      }
    });

    test("Preset Yesterday = hôm qua", async ({ page }) => {
      await pickDatePreset(page, "Today");
      const today = parseDay((await dateRangeInput(page).inputValue()).split(" - ")[1]);
      await pickDatePreset(page, "Yesterday");
      const [from, to] = (await dateRangeInput(page).inputValue()).split(" - ");
      expect(diffDays(today, parseDay(from))).toBe(1);
      expect(diffDays(today, parseDay(to))).toBe(1);
    });

    test("Xoá bằng nút (x) -> request không còn fromTime (Time Period không bắt buộc)", async ({ page }) => {
      await pickDatePreset(page, "Last 7 Days");
      await expect(dateRangeInput(page)).not.toHaveValue("");
      await clearDate(page);
      await expect(dateRangeInput(page)).toHaveValue("");

      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body.filters.fromTime).toBeUndefined();
    });

    test("Mọi dòng có From Time nằm trong khoảng đã chọn", async ({ page }) => {
      await pickDatePreset(page, "Last 90 Days");
      const { body } = await search(page);
      const [from, to] = body.filters.fromTime.map(toIso);

      const dates = await columnValues(page, "From Time");
      test.skip(dates.length === 0, "Không có cảnh báo nào trong 90 ngày gần nhất");
      for (const d of dates) {
        expect(toIso(d) >= from, `${d} phải >= ${from}`).toBe(true);
        expect(toIso(d) <= to, `${d} phải <= ${to}`).toBe(true);
      }
    });

    test("Thu hẹp khoảng ngày thì số bản ghi không tăng", async ({ page }) => {
      await pickDatePreset(page, "Last 90 Days");
      const wide = (await search(page)).json.data.totalCount;
      await pickDatePreset(page, "Last 7 Days");
      const narrow = (await search(page)).json.data.totalCount;
      expect(narrow).toBeLessThanOrEqual(wide);
    });
  });

  // ===== 5. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá toàn bộ filter đã chọn, giữ Timezone và hiển thị lại toàn bộ dữ liệu", async ({ page }) => {
      await ensureData(page, test);
      const total = (await search(page)).json.data.totalCount;
      const severity = (await columnValues(page, "Severity"))[0];
      const timezone = await filterEl(page, "timezoneId")
        .locator(".ant-select-selection-item")
        .getAttribute("title");

      await selectOption(page, "severity", severity);
      await selectOption(page, "status", "Active");
      await selectOption(page, "flag", "Flag");
      await fillFilter(page, "playerName", "abc");
      await pickDatePreset(page, "Last 7 Days");
      await search(page);

      await resetBtn(page).click();
      for (const id of ["gameIds", "currencyIds", "ruleSettingIds", "severity", "status", "flag"]) {
        await expect(filterEl(page, id).locator(".ant-select-selection-item")).toHaveCount(0);
      }
      await expect(page.locator("#playerName")).toHaveValue("");
      await expect(dateRangeInput(page)).toHaveValue("");
      await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toHaveAttribute(
        "title",
        timezone,
      );

      const { body, json } = await search(page);
      expect(Object.keys(body.filters)).toEqual(["timezoneId"]);
      expect(json.data.totalCount).toBe(total);
    });
  });

  // ===== 6. Phân trang =====
  test.describe("Phân trang", () => {
    test.beforeEach(async ({ page }) => {
      const total = num((await summary(page).innerText()).match(/of ([\d,]+) records/)[1]);
      test.skip(total <= 20, `Chỉ có ${total} bản ghi, không đủ để test phân trang`);
    });

    test("Chuyển sang trang 2 rồi quay lại trang 1", async ({ page }) => {
      const page1 = await rows(page).allInnerTexts();

      const body2 = await reloadBy(page, () =>
        page.getByRole("button", { name: "2", exact: true }).click(),
      );
      expect(body2.page).toBe(2);
      await expect(summary(page)).toHaveText(/^Showing 11 - 20 of /);
      expect(await rows(page).allInnerTexts()).not.toEqual(page1);

      const body1 = await reloadBy(page, () =>
        page.getByRole("button", { name: "1", exact: true }).click(),
      );
      expect(body1.page).toBe(1);
      await expect(summary(page)).toHaveText(/^Showing 1 - 10 of /);
    });

    test("Nút Next / Previous", async ({ page }) => {
      await expect(page.locator(".ant-pagination-prev")).toBeDisabled();

      const next = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(next.page).toBe(2);
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");

      const prev = await reloadBy(page, () => page.locator(".ant-pagination-prev").click());
      expect(prev.page).toBe(1);
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
    });

    test("Đổi số dòng / trang", async ({ page }) => {
      await page.locator(".ant-pagination-options .ant-select").click();
      const sizes = await page
        .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
        .allInnerTexts();
      expect(sizes).toEqual(["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"]);

      const body = await reloadBy(page, () =>
        page
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option", {
            hasText: "20 / page",
          })
          .click(),
      );
      expect(body.pageSize).toBe(20);
      expect(body.page).toBe(1);
      await expect(rows(page)).toHaveCount(20);
      await expect(summary(page)).toHaveText(/^Showing 1 - 20 of /);
    });

    test("Giữ nguyên filter khi chuyển trang", async ({ page }) => {
      await selectOption(page, "severity", "Critical");
      const first = await search(page);
      test.skip(first.json.data.totalCount <= 10, "Severity Critical chỉ có 1 trang");

      const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(body.page).toBe(2);
      expect(body.filters).toEqual(first.body.filters);
      for (const v of await columnValues(page, "Severity")) expect(v).toBe("Critical");
    });
  });

  // ===== 7. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    for (const [column, sortBy] of Object.entries(SORTABLE)) {
      test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
        const th = mainTable(page).locator("thead th", { hasText: exact(column) });
        const key = (v) => (column === "Win Rate" ? num(v) : toIso(v));
        const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
        const checkOrder = ORDER_CHECK.includes(column);

        const asc = await reloadBy(page, () => th.click());
        expect(asc.sortBy).toBe(sortBy);
        expect(asc.sortDirection).toBe("asc");
        if (checkOrder) {
          const v = (await columnValues(page, column)).map(key);
          expect(v).toEqual([...v].sort(cmp));
        }

        const desc = await reloadBy(page, () => th.click());
        expect(desc.sortBy).toBe(sortBy);
        expect(desc.sortDirection).toBe("desc");
        if (checkOrder) {
          const v = (await columnValues(page, column)).map(key);
          expect(v).toEqual([...v].sort((a, b) => cmp(b, a)));
        }

        // Click lần 3: bỏ sort -> quay về mặc định id giảm dần
        const none = await reloadBy(page, () => th.click());
        expect(none).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      });
    }

    test("Các cột còn lại không có chức năng sort", async ({ page }) => {
      for (const column of COLUMNS.filter((c) => !(c in SORTABLE))) {
        await expect(
          mainTable(page).locator("thead th", { hasText: exact(column) }),
          column,
        ).not.toHaveClass(/ant-table-column-has-sorters/);
      }
    });
  });

  // ===== 8. Manage Columns =====
  test.describe("Manage Columns", () => {
    // hasText dạng RegExp khớp CHÍNH XÁC tên cột
    const item = (page, name) =>
      columnPopover(page).locator(".NextGen-popover-manage-column__list__items", {
        hasText: exact(name),
      });

    test("Popover liệt kê đủ cột cùng nút Reset to Default / Save", async ({ page }) => {
      await columnBtn(page).click();
      await expect(columnPopover(page)).toContainText("Column Display");
      await expect(columnPopover(page).getByRole("button", { name: "Reset to Default" })).toBeVisible();
      await expect(columnPopover(page).getByRole("button", { name: "Save" })).toBeVisible();

      const names = await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items .ant-typography")
        .allInnerTexts();
      expect(names.map((n) => n.trim())).toEqual(COLUMNS);
    });

    test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Win Rate").locator("label").click();
      expect(await headers(page)).not.toContain("Win Rate");
      expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

      await item(page, "Win Rate").locator("label").click();
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Save đóng popover và lưu cấu hình cột (giữ nguyên sau khi reload)", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Rule Name").locator("label").click();
      await columnPopover(page).getByRole("button", { name: "Save" }).click();
      await expect(columnPopover(page)).toBeHidden();

      await openPage(page); // reload
      expect(await headers(page)).not.toContain("Rule Name");
      expect(await headers(page)).toHaveLength(COLUMNS.length - 1);
    });

    test("Reset to Default khôi phục toàn bộ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Win Rate").locator("label").click();
      await item(page, "Severity").locator("label").click();
      expect(await headers(page)).toHaveLength(COLUMNS.length - 2);

      await columnPopover(page).getByRole("button", { name: "Reset to Default" }).click();
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      await ensureData(page, test);
      const before = await columnValues(page, "Player Name");
      await columnBtn(page).click();
      await item(page, "Win Rate").locator("label").click();
      expect(await columnValues(page, "Player Name")).toEqual(before);
    });
  });

  // ===== 9. Ghi nhớ filter =====
  test("Filter được ghi nhớ sau khi reload trang", async ({ page }) => {
    await ensureData(page, test);
    const [game, severity] = await Promise.all(
      ["Game", "Severity"].map((c) => columnValues(page, c).then((v) => v[0])),
    );
    await selectOption(page, "gameIds", game);
    await selectOption(page, "severity", severity);
    await pickDatePreset(page, "Last 90 Days");
    const { body } = await search(page);

    await openPage(page); // reload
    expect(await selectedTitles(page, "gameIds")).toEqual([game]);
    expect(await selectedTitles(page, "severity")).toEqual([severity]);
    await expect(dateRangeInput(page)).toHaveValue(body.filters.fromTime.join(" - "));
  });
});
