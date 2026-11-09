// Báo cáo > Failed Operator Request  (https://dev-bo.royaledge.io/report/failed-operator-request)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/report_failed_operator_request.spec.js --project=setup --project=chromium
//
// Màn hình liệt kê các request gửi sang Operator bị lỗi (CancelBetNSettle...) với 2 trạng thái:
// Pending (chờ xử lý) và Cancelled (đã huỷ). Có thể huỷ từng request (icon bút) hoặc huỷ hàng loạt (checkbox + icon trên bảng).
//
// QUAN TRỌNG: các test KHÔNG BAO GIỜ bấm "Confirm" ở hộp thoại huỷ request - hành động đó làm thay đổi
// dữ liệu thật (Pending -> Cancelled). Test chỉ mở hộp thoại, kiểm tra nội dung rồi bấm "Cancel".
// Test Export sẽ tạo bản ghi ở Download History (nếu file cùng filter đã export trước đó thì hệ thống hỏi
// "Download Now / Download New"; test KHÔNG bấm Download New).
//
// Mặc định màn hình lọc Bet Time = hôm nay và Operator = operator đầu tiên của danh sách nên thường trống.
// Các test cần dữ liệu sẽ chọn "Last 90 Days" + bỏ chọn Operator (xem loadData).
// Không hard-code dữ liệu - mọi giá trị đều lấy từ chính dòng đầu tiên của báo cáo.
const { test, expect } = require("@playwright/test");

const URL = "/report/failed-operator-request";

// Cột đầu tiên là checkbox (header rỗng)
const COLUMNS = [
  "Round ID",
  "Bet ID",
  "Operator",
  "Player Name",
  "Game Code",
  "Bet Time",
  "Processed Time",
  "Bet Type",
  "Bet Amount",
  "Win Amount",
  "Currency",
  "Status",
  "Type",
  "Retry",
  "IP Address",
  "Token",
  "Action",
];
const ALL_HEADERS = ["", ...COLUMNS];

// status gửi/nhận từ API: 0 = Pending, 1 = Cancelled
const STATUS_TEXT = { 0: "Pending", 1: "Cancelled" };
const STATUS_CODE = { Pending: 0, Cancelled: 1 };

const DATETIME = /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/;
const BET_AMOUNT = /^[\d,]+\.\d{4}$/;
const WIN_AMOUNT = /^[+-]?[\d,]+\.\d{4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const post = (r) => (typeof r.request === "function" ? r.request() : r).method() === "POST";
const isList = (r) => post(r) && r.url().endsWith("/operator_request/list");
const isDownload = (r) => post(r) && r.url().endsWith("/download");

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
const bulkBtn = (page) => page.locator('button[class*="icon-bulkAction"]');
const modal = (page) => page.locator(".ant-modal-content");
const dialogButton = (page, name) =>
  page.locator(".ant-modal button").filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) });

// Phần tử bao 1 filter (theo id của input bên trong)
const filterEl = (page, id) =>
  page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
const dateRangeInput = (page) => page.locator("#betTime_dateRange");

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

// Toàn bộ các dòng của bảng dạng { "Round ID": "...", ... }
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
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
// "23-10-2026 17:43:34" -> "2026-10-23 17:43:34" (so sánh chuỗi được theo thứ tự thời gian)
const toIso = (s) => s.replace(/^(\d{2})-(\d{2})-(\d{4})/, "$3-$2-$1");
// "09-11-2026 ..." -> Date (UTC, chỉ lấy phần ngày)
function parseDay(s) {
  const [d, m, y] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const diffDays = (a, b) => Math.round((a - b) / 86400000);

// Chọn option (theo tên) của filter dạng dropdown rồi đóng dropdown.
// Gõ tên vào ô tìm kiếm trước để option chắc chắn nằm trong danh sách hiển thị.
// `matcher` mặc định: khớp chính xác tên option (không phân biệt hoa/thường)
async function selectOption(page, id, title, matcher = exact(title, "i")) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control").click();
  await page.keyboard.type(title);
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
    .filter({ hasText: matcher })
    .first()
    .click();
  await page.keyboard.press("Escape");
}

// Đọc toàn bộ option đang có của 1 dropdown
async function dropdownOptions(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control").click();
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

// Nhập text vào filter dạng input (input bị ẩn cho tới khi click vào label)
async function fillFilter(page, id, value) {
  await filterEl(page, id).locator("label").first().click();
  await page.locator(`#${id}`).fill(value);
}

// Chọn preset ngày (Today / Yesterday / Last 7 Days ...) cho Bet Time
async function pickDatePreset(page, preset) {
  await filterEl(page, "betTime_0").locator("label").first().click();
  // Popup của picker đang mở luôn được append SAU cùng trong DOM -> .last()
  await page.locator(".NextGen-datetime-preset__item").filter({ hasText: preset }).last().click();
  // Popup không tự đóng: click ra ngoài (tiêu đề trang) để đóng
  await breadcrumb(page).click();
}

// Xoá Bet Time bằng nút (x) (chỉ render khi rê chuột vào ô ngày)
async function clearDate(page) {
  await filterEl(page, "betTime_0").hover();
  await filterEl(page, "betTime_0").locator('[aria-label="close-circle"]').click({ force: true });
}

// Bỏ chọn Operator (filter dạng chọn 1; không làm gì nếu chưa chọn)
async function clearOperator(page) {
  if ((await filterEl(page, "agentId").locator(".ant-select-selection-item").count()) === 0) return;
  const select = filterEl(page, "agentId").locator(".ant-select").first();
  await select.hover(); // icon (x) chỉ render khi rê chuột
  await select.locator('[aria-label="close-circle"]').click({ force: true });
  await breadcrumb(page).click();
  await expect(filterEl(page, "agentId").locator(".ant-select-selection-item")).toHaveCount(0);
}

// Mặc định (Bet Time = hôm nay) thường không có dữ liệu.
// Mở rộng: Last 90 Days + bỏ chọn Operator nếu có (+ Status nếu cần) rồi Search; không có dữ liệu thì skip.
async function loadData(page, test, { status } = {}) {
  await pickDatePreset(page, "Last 90 Days");
  await clearOperator(page);
  if (status) await selectOption(page, "statuses", status);
  const result = await search(page);
  if ((await rows(page).count()) === 0) {
    test.skip(true, `Không có request lỗi nào trong 90 ngày gần nhất${status ? ` (status ${status})` : ""}`);
  }
  return result;
}

// Bấm Export rồi kiểm tra kết quả. Trả về body của request /download (payload đã parse).
// 2 kết quả hợp lệ tuỳ việc file cùng filter đã được export trước đó hay chưa:
//  - Lần đầu: toast "Download is processing. Please check ID:xxx in download history"
//  - Đã có file cũ: hộp thoại "already exist in download history ... Download Now / Download New".
//    KHÔNG bấm Download New (sẽ xoá file cũ trong Download History), chỉ kiểm tra rồi đóng.
async function exportAndCheck(page) {
  const [req] = await Promise.all([page.waitForRequest(isDownload), exportBtn(page).click()]);
  const body = JSON.parse(req.postData());
  const payload = JSON.parse(body.payload);

  const processing = page
    .getByText(/Download is processing\. Please check ID:\d+ in download history/)
    .first();
  const duplicate = page.getByText(/already exist in download history with id \d+/);
  await expect(processing.or(duplicate)).toBeVisible();
  if (await duplicate.isVisible()) {
    await expect(page.getByRole("button", { name: "Download Now" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download New" })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  return { body, payload };
}

// Ghi lại mọi request POST có dạng "ghi dữ liệu" (huỷ / cập nhật / xoá) để chắc chắn test không làm đổi dữ liệu
function watchWrites(page) {
  const writes = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /boapi/.test(r.url()) && /cancel|bulk|update|delete|retry/i.test(r.url())) {
      writes.push(r.url());
    }
  });
  return writes;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Report > Failed Operator Request", () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, đủ filter và 2 nút Search/Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Failed Operator Request");
      for (const [label, id] of [
        ["Timezone", "timezoneId"],
        ["Bet Time", "betTime_0"],
        ["Operator", "agentId"],
        ["Player Name", "playerName"],
        ["Game", "gameId"],
        ["Round ID", "roundId"],
        ["Bet ID", "betId"],
        ["Currency", "currencyId"],
        ["Bet Type", "betTypes"],
        ["Status", "statuses"],
      ]) {
        await expect(filterEl(page, id), `thiếu filter ${label}`).toContainText(label);
        await expect(filterEl(page, id)).toBeVisible();
      }
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: Timezone, Bet Time = hôm nay, còn lại để trống", async ({ page }) => {
      await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toContainText(
        /^\(GMT [+-]\d{2}:\d{2}\)/,
      );

      // Bet Time mặc định = 1 ngày (hôm nay), từ 00:00:00 đến 23:59:59
      const [from, to] = (await dateRangeInput(page).inputValue()).split(" - ");
      expect(from).toMatch(DATETIME);
      expect(to).toMatch(DATETIME);
      expect(from.slice(11)).toBe("00:00:00");
      expect(to.slice(11)).toBe("23:59:59");
      expect(diffDays(parseDay(to), parseDay(from))).toBe(0);

      for (const id of ["agentId", "gameId", "currencyId", "betTypes", "statuses"]) {
        await expect(
          filterEl(page, id).locator(".ant-select-selection-item"),
          `#${id} phải trống`,
        ).toHaveCount(0);
      }
      for (const id of ["playerName", "roundId", "betId"]) {
        await expect(page.locator(`#${id}`)).toHaveValue("");
      }
    });

    test(`Bảng có đủ ${COLUMNS.length} cột (cột checkbox + các cột dữ liệu) đúng thứ tự`, async ({ page }) => {
      expect(await headers(page)).toEqual(ALL_HEADERS);
      await expect(exportBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
      await expect(bulkBtn(page)).toBeVisible();
    });

    test("Mặc định sắp xếp Bet Time giảm dần, 10 dòng / trang", async ({ page }) => {
      const { body } = await loadData(page, test);
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "betTime", sortDirection: "desc" });
      expect(await rows(page).count()).toBeLessThanOrEqual(10);

      const dates = (await columnValues(page, "Bet Time")).map(toIso);
      expect(dates.length).toBeGreaterThan(0);
      expect(dates).toEqual([...dates].sort().reverse());
    });

    test("Tooltip (i) cạnh nút Filter giải thích điều kiện tìm kiếm", async ({ page }) => {
      await page.locator(".tooltip-remark__icon").hover();
      const tip = page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");
      await expect(tip).toBeVisible();
      await expect(tip).toContainText("Timezone is a mandatory field");
    });

    test("Nút Filter thu gọn / mở rộng thanh filter", async ({ page }) => {
      const bar = page.locator(".NextGen-filter-bar__items");
      await expect(bar).toBeVisible();
      await filterToggle(page).click();
      await expect(bar).toBeHidden();
      await filterToggle(page).click();
      await expect(bar).toBeVisible();
    });

    test("Nút huỷ hàng loạt bị khoá khi chưa chọn dòng nào", async ({ page }) => {
      await expect(bulkBtn(page)).toBeDisabled();
    });
  });

  // ===== 2. Dữ liệu bảng =====
  test.describe("Dữ liệu bảng", () => {
    test("Mỗi dòng khớp response API (định dạng hiển thị)", async ({ page }) => {
      const { json } = await loadData(page, test);
      const list = json.data.list;
      const records = await tableRecords(page);
      expect(records).toHaveLength(list.length);

      records.forEach((r, i) => {
        const a = list[i];
        const at = `dòng ${i + 1} (round ${a.roundId})`;
        expect(r["Round ID"], at).toBe(a.roundId);
        expect(r["Bet ID"], at).toBe(a.betId);
        expect(r["Operator"], at).toBe(a.operator);
        expect(r["Player Name"], at).toBe(a.playerName);
        expect(r["Game Code"], at).toBe(a.gameCode);
        expect(r["Bet Time"], at).toBe(a.betTime);
        expect(r["Processed Time"], at).toBe(a.processedTime);
        expect(r["Bet Type"], at).toBe(a.betType);
        expect(num(r["Bet Amount"]), at).toBeCloseTo(num(a.betAmount), 4);
        expect(num(r["Win Amount"]), at).toBeCloseTo(num(a.winAmount), 4);
        expect(r["Currency"], at).toBe(a.currency);
        expect(r["Status"], at).toBe(STATUS_TEXT[a.status]);
        expect(r["Type"], at).toBe(a.type);
        expect(num(r["Retry"]), at).toBe(a.retry);
        expect(r["IP Address"], at).toBe(a.ip);
        expect(r["Token"], at).toBe(a.token);
      });
    });

    test("Định dạng: ngày giờ, tiền, Token, Bet Type / Currency / Status dạng tag", async ({ page }) => {
      await loadData(page, test);
      for (const col of ["Bet Time", "Processed Time"]) {
        for (const v of await columnValues(page, col)) expect(v, col).toMatch(DATETIME);
      }
      for (const v of await columnValues(page, "Bet Amount")) expect(v).toMatch(BET_AMOUNT);
      for (const v of await columnValues(page, "Win Amount")) expect(v).toMatch(WIN_AMOUNT);
      for (const v of await columnValues(page, "Token")) expect(v).toMatch(UUID);
      for (const v of await columnValues(page, "Retry")) expect(v).toMatch(/^\d+$/);
      for (const v of await columnValues(page, "Bet Type")) expect(["Normal", "Promo"]).toContain(v);
      for (const v of await columnValues(page, "Status")) expect(["Pending", "Cancelled"]).toContain(v);
      for (const v of await columnValues(page, "Type")) expect(v).not.toBe("");

      const first = rowAt(page, 0);
      const heads = await headers(page);
      for (const col of ["Bet Type", "Currency", "Status"]) {
        await expect(first.locator("td").nth(heads.indexOf(col)).locator(".ant-tag"), col).toBeVisible();
      }
    });

    test("Ràng buộc dữ liệu: Processed Time >= Bet Time, Win Amount dương có dấu +", async ({ page }) => {
      await loadData(page, test);
      for (const r of await tableRecords(page)) {
        const at = r["Round ID"];
        expect(toIso(r["Processed Time"]) >= toIso(r["Bet Time"]), `${at}: Processed Time phải >= Bet Time`).toBe(true);
        expect(num(r["Bet Amount"])).toBeGreaterThanOrEqual(0);
        if (num(r["Win Amount"]) > 0) expect(r["Win Amount"], at).toMatch(/^\+/);
      }
    });
  });

  // ===== 3. Popup chi tiết (icon mắt) =====
  test.describe("Popup Failed Operator Details", () => {
    test("Icon mắt mở popup hiển thị nội dung jsonData của request", async ({ page }) => {
      const { json } = await loadData(page, test);
      const a = json.data.list[0];

      await rowAt(page, 0).locator('svg[data-icon="eye"]').click();
      await expect(modal(page)).toBeVisible();
      await expect(modal(page).locator(".ant-modal-title")).toHaveText("Failed Operator Details");

      // Mỗi cặp key/value (kiểu số / chuỗi, bỏ qua null và object) trong jsonData phải hiển thị.
      // Tên key được tách chữ cho dễ đọc (LineValue -> "Line Value") nên so sánh bỏ khoảng trắng, không phân biệt hoa/thường.
      const text = await modal(page).locator(".ant-modal-body").innerText();
      const shown = Object.fromEntries(
        text
          .split("\n")
          .map((l) => l.split("\t"))
          .filter((p) => p.length >= 2)
          .map(([k, v]) => [k.replace(/\s/g, "").toLowerCase(), v.trim()]),
      );
      const data = JSON.parse(a.jsonData);
      const entries = Object.entries(data).filter(([, v]) => v !== null && typeof v !== "object");
      expect(entries.length).toBeGreaterThan(0);
      for (const [k, v] of entries) {
        expect(shown[k.toLowerCase()], `thiếu "${k}" trong popup`).toBe(String(v));
      }
    });

    test("Popup đóng được bằng nút X và phím Esc", async ({ page }) => {
      await loadData(page, test);
      await rowAt(page, 0).locator('svg[data-icon="eye"]').click();
      await expect(modal(page)).toBeVisible();
      await modal(page).locator(".ant-modal-close").click();
      await expect(modal(page)).toBeHidden();

      await rowAt(page, 0).locator('svg[data-icon="eye"]').click();
      await expect(modal(page)).toBeVisible();
      await modal(page).locator(".ant-modal-title").click(); // đưa focus vào popup
      await page.keyboard.press("Escape");
      await expect(modal(page)).toBeHidden();
    });
  });

  // ===== 4. Huỷ request (chỉ mở hộp thoại, KHÔNG bấm Confirm) =====
  test.describe("Huỷ request / Huỷ hàng loạt", () => {
    test("Pending: có checkbox và icon huỷ; Cancelled: checkbox bị khoá và không có icon huỷ", async ({ page }) => {
      await loadData(page, test, { status: "Pending" });
      const pending = rowAt(page, 0);
      await expect(pending.locator(".ant-checkbox-input")).toBeEnabled();
      await expect(pending.locator('svg[data-icon="pen-to-square"]')).toBeVisible();

      await selectOption(page, "statuses", "Pending"); // bỏ chọn Pending
      await selectOption(page, "statuses", "Cancelled");
      await search(page);
      test.skip((await rows(page).count()) === 0, "Không có request nào ở trạng thái Cancelled");
      const cancelled = rowAt(page, 0);
      await expect(cancelled.locator(".ant-checkbox-input")).toBeDisabled();
      await expect(cancelled.locator('svg[data-icon="pen-to-square"]')).toBeHidden();
      await expect(cancelled.locator('svg[data-icon="eye"]')).toBeVisible(); // vẫn xem được chi tiết
    });

    test("Icon huỷ mở hộp thoại xác nhận; bấm Cancel thì đóng và không gọi API huỷ", async ({ page }) => {
      await loadData(page, test, { status: "Pending" });
      const writes = watchWrites(page);

      await rowAt(page, 0).locator('svg[data-icon="pen-to-square"]').click();
      await expect(modal(page)).toBeVisible();
      await expect(modal(page)).toContainText("Cancel Request");
      await expect(modal(page)).toContainText("Are you sure you want to cancel this request?");
      await expect(dialogButton(page, "Confirm")).toBeVisible();

      await dialogButton(page, "Cancel").click(); // KHÔNG bấm Confirm
      await expect(modal(page)).toBeHidden();
      expect(writes, "không được gọi API huỷ khi bấm Cancel").toEqual([]);
      await expect(rowAt(page, 0).locator("td").nth(ALL_HEADERS.indexOf("Status"))).toHaveText("Pending");
    });

    test("Chọn dòng bằng checkbox thì mở khoá nút huỷ hàng loạt; bỏ chọn thì khoá lại", async ({ page }) => {
      await loadData(page, test, { status: "Pending" });
      await expect(bulkBtn(page)).toBeDisabled();
      await rowAt(page, 0).locator(".ant-checkbox-input").check();
      await expect(bulkBtn(page)).toBeEnabled();
      await rowAt(page, 0).locator(".ant-checkbox-input").uncheck();
      await expect(bulkBtn(page)).toBeDisabled();
    });

    test("Checkbox ở header chọn / bỏ chọn tất cả các dòng của trang", async ({ page }) => {
      await loadData(page, test, { status: "Pending" });
      const total = await rows(page).count();
      const header = mainTable(page).locator("thead .ant-checkbox-input");

      await header.check();
      await expect(rows(page).locator(".ant-checkbox-input:checked")).toHaveCount(total);
      await expect(bulkBtn(page)).toBeEnabled();

      await header.uncheck();
      await expect(rows(page).locator(".ant-checkbox-input:checked")).toHaveCount(0);
      await expect(bulkBtn(page)).toBeDisabled();
    });

    test("Huỷ hàng loạt: hộp thoại ghi đúng số request đã chọn; bấm Cancel thì không gọi API huỷ", async ({ page }) => {
      await loadData(page, test, { status: "Pending" });
      test.skip((await rows(page).count()) < 2, "Cần ít nhất 2 request Pending");
      const writes = watchWrites(page);

      await rowAt(page, 0).locator(".ant-checkbox-input").check();
      await rowAt(page, 1).locator(".ant-checkbox-input").check();
      await bulkBtn(page).click();
      await expect(modal(page)).toBeVisible();
      await expect(modal(page)).toContainText("Bulk Cancel Request");
      await expect(modal(page)).toContainText("Are you sure you want to cancel 2 selected request(s)?");

      await dialogButton(page, "Cancel").click(); // KHÔNG bấm Confirm
      await expect(modal(page)).toBeHidden();
      expect(writes, "không được gọi API huỷ khi bấm Cancel").toEqual([]);
    });
  });

  // ===== 5. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Search mặc định gửi đúng request (timezone, Bet Time, phân trang, sort) và không có filter nào khác", async ({
      page,
    }) => {
      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "betTime", sortDirection: "desc" });
      expect(Object.keys(body.filters).sort()).toEqual(["betTime", "timezoneId"]);
      expect(body.filters.timezoneId).toEqual(expect.any(Number));
      expect(body.filters.betTime).toHaveLength(2);
      expect(body.filters.betTime[0]).toMatch(DATETIME);
    });

    for (const [label, id] of [
      ["Operator", "agentId"],
      ["Game", "gameId"],
      ["Currency", "currencyId"],
      ["Bet Type", "betTypes"],
      ["Status", "statuses"],
    ]) {
      test(`Dropdown ${label} load được danh sách option`, async ({ page }) => {
        expect((await dropdownOptions(page, id)).length).toBeGreaterThan(0);
      });
    }

    test("Option cố định của Bet Type và Status", async ({ page }) => {
      expect(await dropdownOptions(page, "betTypes")).toEqual(["Normal", "Promo"]);
      expect(await dropdownOptions(page, "statuses")).toEqual(["Pending", "Cancelled"]);
    });

    test("Operator chỉ chọn được 1 giá trị; bỏ chọn thì request không còn agentId", async ({ page }) => {
      const options = await dropdownOptions(page, "agentId");
      expect(options.length).toBeGreaterThan(1);

      await selectOption(page, "agentId", options[0]);
      expect(await selectedTitles(page, "agentId")).toEqual([options[0]]);
      await selectOption(page, "agentId", options[1]);
      expect(await selectedTitles(page, "agentId")).toEqual([options[1]]); // thay thế, không cộng dồn
      const changed = await search(page);
      expect(changed.body.filters.agentId).toEqual(expect.any(Number));

      await clearOperator(page);
      const cleared = await search(page);
      expect(cleared.body.filters.agentId).toBeUndefined();
    });

    test("Lọc theo Operator -> mọi dòng thuộc operator đã chọn", async ({ page }) => {
      await loadData(page, test);
      const operator = (await columnValues(page, "Operator"))[0];
      await selectOption(page, "agentId", operator, new RegExp(`^${escapeRx(operator)} - `, "i"));
      const { body } = await search(page);

      expect(body.filters.agentId).toEqual(expect.any(Number));
      const values = await columnValues(page, "Operator");
      expect(values.length, `không có dòng nào của operator ${operator}`).toBeGreaterThan(0);
      for (const v of values) expect(v).toBe(operator);
    });

    for (const { label, id, column } of [
      { label: "Player Name", id: "playerName", column: "Player Name" },
      { label: "Round ID", id: "roundId", column: "Round ID" },
      { label: "Bet ID", id: "betId", column: "Bet ID" },
    ]) {
      test(`Tìm theo ${label} -> mọi dòng khớp giá trị đã nhập`, async ({ page }) => {
        await loadData(page, test);
        const value = (await columnValues(page, column))[0];
        await fillFilter(page, id, value);
        const { body, status } = await search(page);

        expect(status).toBe(200);
        expect(body.filters[id]).toBe(value);
        const values = await columnValues(page, column);
        expect(values.length).toBeGreaterThan(0);
        for (const v of values) expect(v).toBe(value);
      });
    }

    test("Tìm theo Bet ID trả về đúng 1 bản ghi", async ({ page }) => {
      await loadData(page, test);
      const betId = (await columnValues(page, "Bet ID"))[0];
      await fillFilter(page, "betId", betId);
      await search(page);
      expect(await columnValues(page, "Bet ID")).toEqual([betId]);
      await expect(summary(page)).toHaveText(/of 1 records$/);
    });

    test("Lọc theo Game -> mọi dòng có Game Code đã chọn", async ({ page }) => {
      await loadData(page, test);
      const gameCode = (await columnValues(page, "Game Code"))[0];
      // Option của dropdown có dạng "GAME_CODE - Game Name" (mã game viết HOA, trong bảng viết thường)
      await selectOption(page, "gameId", gameCode, new RegExp(`^${escapeRx(gameCode)} - `, "i"));
      const { body } = await search(page);

      expect(body.filters.gameId).toEqual(expect.any(Number));
      const values = await columnValues(page, "Game Code");
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(v.toLowerCase()).toBe(gameCode.toLowerCase());
    });

    test("Lọc theo Currency -> mọi dòng khớp (filter chọn 1 giá trị)", async ({ page }) => {
      await loadData(page, test);
      const currency = (await columnValues(page, "Currency"))[0];
      await selectOption(page, "currencyId", currency);
      const { body } = await search(page);

      expect(body.filters.currencyId).toEqual(expect.any(Number));
      const values = await columnValues(page, "Currency");
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(v).toBe(currency);
    });

    for (const [label, code] of Object.entries(STATUS_CODE)) {
      test(`Lọc theo Status = ${label} gửi statuses=[${code}] và mọi dòng khớp`, async ({ page }) => {
        const { body } = await loadData(page, test, { status: label });
        expect(body.filters.statuses).toEqual([code]);
        for (const v of await columnValues(page, "Status")) expect(v).toBe(label);
      });
    }

    test("Lọc theo Bet Type -> mọi dòng khớp, chọn cả 2 thì gửi 2 giá trị", async ({ page }) => {
      await loadData(page, test);
      const betType = (await columnValues(page, "Bet Type"))[0];
      await selectOption(page, "betTypes", betType);
      const one = await search(page);
      expect(one.body.filters.betTypes).toHaveLength(1);
      for (const v of await columnValues(page, "Bet Type")) expect(v).toBe(betType);

      await selectOption(page, "betTypes", betType === "Normal" ? "Promo" : "Normal");
      const both = await search(page);
      expect(both.body.filters.betTypes).toHaveLength(2);
    });

    test("Chọn cả Pending và Cancelled gửi 2 giá trị status", async ({ page }) => {
      await pickDatePreset(page, "Last 90 Days");
      await clearOperator(page);
      await selectOption(page, "statuses", "Pending");
      await selectOption(page, "statuses", "Cancelled");
      const { body } = await search(page);
      expect([...body.filters.statuses].sort()).toEqual([0, 1]);
      for (const v of await columnValues(page, "Status")) expect(["Pending", "Cancelled"]).toContain(v);
    });

    test("Kết hợp nhiều filter cùng lúc (AND)", async ({ page }) => {
      await loadData(page, test);
      const [currency, status, betType] = await Promise.all(
        ["Currency", "Status", "Bet Type"].map((c) => columnValues(page, c).then((v) => v[0])),
      );
      await selectOption(page, "currencyId", currency);
      await selectOption(page, "statuses", status);
      await selectOption(page, "betTypes", betType);
      const { body } = await search(page);
      expect(body.filters.currencyId).toEqual(expect.any(Number));
      expect(body.filters.statuses).toHaveLength(1);
      expect(body.filters.betTypes).toHaveLength(1);

      for (const v of await columnValues(page, "Currency")) expect(v).toBe(currency);
      for (const v of await columnValues(page, "Status")) expect(v).toBe(status);
      for (const v of await columnValues(page, "Bet Type")) expect(v).toBe(betType);
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

    test("Thiếu Bet Time -> báo lỗi, không gọi API", async ({ page }) => {
      await clearDate(page);
      await expect(dateRangeInput(page)).toHaveValue("");

      let called = false;
      page.on("request", (r) => {
        if (isList(r)) called = true;
      });
      await searchBtn(page).click();

      await expect(page.getByText("Please start a search with bet time")).toBeVisible();
      expect(called).toBe(false);
    });

    for (const [label, id] of [
      ["Round ID", "roundId"],
      ["Bet ID", "betId"],
    ]) {
      test(`Chỉ nhập ${label} (không có Bet Time) -> báo lỗi, không gọi API`, async ({ page }) => {
        await clearDate(page);
        await fillFilter(page, id, "123456789");

        let called = false;
        page.on("request", (r) => {
          if (isList(r)) called = true;
        });
        await searchBtn(page).click();

        await expect(page.getByText("Please start a search with bet time")).toBeVisible();
        expect(called).toBe(false);
      });
    }
  });

  // ===== 6. Bộ lọc thời gian =====
  test.describe("Bet Time", () => {
    test("Bet Time có đủ các preset", async ({ page }) => {
      await filterEl(page, "betTime_0").locator("label").first().click();
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

    test("Các preset cho khoảng ngày đúng và gửi đúng request betTime", async ({ page }) => {
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
        expect(body.filters.betTime, preset).toEqual([from, to]);
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

    test("Mọi dòng có Bet Time nằm trong khoảng đã chọn", async ({ page }) => {
      const { body } = await loadData(page, test);
      const [from, to] = body.filters.betTime.map(toIso);
      for (const d of await columnValues(page, "Bet Time")) {
        expect(toIso(d) >= from, `${d} phải >= ${from}`).toBe(true);
        expect(toIso(d) <= to, `${d} phải <= ${to}`).toBe(true);
      }
    });

    test("Thu hẹp khoảng ngày thì số bản ghi không tăng", async ({ page }) => {
      await pickDatePreset(page, "Last 90 Days");
      await clearOperator(page);
      const wide = (await search(page)).json.data.totalCount;
      await pickDatePreset(page, "Last 7 Days");
      const narrow = (await search(page)).json.data.totalCount;
      expect(narrow).toBeLessThanOrEqual(wide);
    });
  });

  // ===== 7. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá các filter đã nhập, đưa Bet Time về hôm nay và giữ Timezone", async ({ page }) => {
      await loadData(page, test);
      const currency = (await columnValues(page, "Currency"))[0];
      const timezone = await filterEl(page, "timezoneId")
        .locator(".ant-select-selection-item")
        .getAttribute("title");
      await selectOption(page, "currencyId", currency);
      await selectOption(page, "statuses", "Pending");
      await fillFilter(page, "playerName", "abc");
      await search(page);

      await resetBtn(page).click();
      for (const id of ["currencyId", "statuses", "betTypes", "gameId"]) {
        await expect(filterEl(page, id).locator(".ant-select-selection-item")).toHaveCount(0);
      }
      for (const id of ["playerName", "roundId", "betId"]) {
        await expect(page.locator(`#${id}`)).toHaveValue("");
      }
      await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toHaveAttribute(
        "title",
        timezone,
      );

      // Bet Time về mặc định = hôm nay
      const [from, to] = (await dateRangeInput(page).inputValue()).split(" - ");
      expect(from.slice(11)).toBe("00:00:00");
      expect(diffDays(parseDay(to), parseDay(from))).toBe(0);
    });
  });

  // ===== 8. Phân trang =====
  test.describe("Phân trang", () => {
    test.beforeEach(async ({ page }) => {
      await loadData(page, test);
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
      const first = await search(page);
      const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(body.filters).toEqual(first.body.filters);
    });
  });

  // ===== 9. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    test("Sort cột Bet Amount: tăng dần -> giảm dần -> về mặc định", async ({ page }) => {
      await loadData(page, test);
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
      const th = mainTable(page).locator("thead th", { hasText: exact("Bet Amount") });
      const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

      const asc = await reloadBy(page, () => th.click());
      expect(asc.sortBy.toLowerCase()).toBe("betamount");
      expect(asc.sortDirection).toBe("asc");
      const ascValues = (await columnValues(page, "Bet Amount")).map(num);
      expect(ascValues).toEqual([...ascValues].sort(cmp));

      const desc = await reloadBy(page, () => th.click());
      expect(desc.sortBy.toLowerCase()).toBe("betamount");
      expect(desc.sortDirection).toBe("desc");
      const descValues = (await columnValues(page, "Bet Amount")).map(num);
      expect(descValues).toEqual([...descValues].sort((a, b) => cmp(b, a)));

      // Click lần 3: bỏ sort -> quay về mặc định Bet Time giảm dần
      const none = await reloadBy(page, () => th.click());
      expect(none).toMatchObject({ sortBy: "betTime", sortDirection: "desc" });
    });

    test("Sort cột Win Amount: lần click đầu sắp xếp giảm dần, click tiếp thì về mặc định", async ({ page }) => {
      await loadData(page, test);
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
      const th = mainTable(page).locator("thead th", { hasText: exact("Win Amount") });

      const first = await reloadBy(page, () => th.click());
      expect(first.sortBy.toLowerCase()).toBe("winamount");
      expect(first.sortDirection).toBe("desc");
      const values = (await columnValues(page, "Win Amount")).map(num);
      expect(values).toEqual([...values].sort((a, b) => b - a));

      const second = await reloadBy(page, () => th.click());
      expect(second).toMatchObject({ sortBy: "betTime", sortDirection: "desc" });
    });

    test("Các cột còn lại không có chức năng sort", async ({ page }) => {
      for (const column of COLUMNS.filter((c) => !["Bet Amount", "Win Amount"].includes(c))) {
        await expect(
          mainTable(page).locator("thead th", { hasText: exact(column) }),
          column,
        ).not.toHaveClass(/ant-table-column-has-sorters/);
      }
    });
  });

  // ===== 10. Manage Columns =====
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
      await item(page, "Retry").locator("label").click();
      expect(await headers(page)).not.toContain("Retry");
      expect(await headers(page)).toHaveLength(ALL_HEADERS.length - 1);

      await item(page, "Retry").locator("label").click();
      expect(await headers(page)).toEqual(ALL_HEADERS);
    });

    test("Save đóng popover và lưu cấu hình cột (giữ nguyên sau khi reload)", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "IP Address").locator("label").click();
      await columnPopover(page).getByRole("button", { name: "Save" }).click();
      await expect(columnPopover(page)).toBeHidden();

      await openPage(page); // reload
      expect(await headers(page)).not.toContain("IP Address");
      expect(await headers(page)).toHaveLength(ALL_HEADERS.length - 1);
    });

    test("Reset to Default khôi phục toàn bộ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Retry").locator("label").click();
      await item(page, "Token").locator("label").click();
      expect(await headers(page)).toHaveLength(ALL_HEADERS.length - 2);

      await columnPopover(page).getByRole("button", { name: "Reset to Default" }).click();
      expect(await headers(page)).toEqual(ALL_HEADERS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      await loadData(page, test);
      const before = await columnValues(page, "Round ID");
      await columnBtn(page).click();
      await item(page, "Retry").locator("label").click();
      expect(await columnValues(page, "Round ID")).toEqual(before);
    });
  });

  // ===== 11. Export =====
  test.describe("Export", () => {
    test("Export tạo job tải xuống (section OPERATOR_REQUEST_DOWNLOAD) gồm toàn bộ cột", async ({ page }) => {
      const { body, payload } = await exportAndCheck(page);
      expect(body.module).toBe("REPORTS");
      expect(body.section).toBe("OPERATOR_REQUEST_DOWNLOAD");
      expect(payload.filters.timezoneId).toEqual(expect.any(Number));
      expect(payload.filters.betTime).toHaveLength(2);
      expect(payload.filters.fields).toEqual(COLUMNS);
    });

    test("Export đi kèm đúng filter hiện tại", async ({ page }) => {
      await loadData(page, test);
      const player = (await columnValues(page, "Player Name"))[0];
      await fillFilter(page, "playerName", player);
      await search(page);

      const { payload } = await exportAndCheck(page);
      expect(payload.filters.playerName).toBe(player);
    });

    test("Export chỉ chứa các cột đang hiển thị", async ({ page }) => {
      await columnBtn(page).click();
      await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items", { hasText: exact("Retry") })
        .locator("label")
        .click();

      const [req] = await Promise.all([page.waitForRequest(isDownload), exportBtn(page).click()]);
      const payload = JSON.parse(JSON.parse(req.postData()).payload);
      expect(payload.filters.fields).not.toContain("Retry");
      expect(payload.filters.fields).toContain("Round ID");
    });
  });

  // ===== 12. Ghi nhớ filter =====
  test("Filter được ghi nhớ sau khi reload trang", async ({ page }) => {
    await loadData(page, test);
    const currency = (await columnValues(page, "Currency"))[0];
    await selectOption(page, "currencyId", currency);
    await selectOption(page, "statuses", "Pending");
    const { body } = await search(page);

    await openPage(page); // reload
    expect(await selectedTitles(page, "currencyId")).toEqual([currency]);
    expect(await selectedTitles(page, "statuses")).toEqual(["Pending"]);
    await expect(dateRangeInput(page)).toHaveValue(body.filters.betTime.join(" - "));
  });
});
