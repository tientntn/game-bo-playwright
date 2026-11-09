// Báo cáo > Promotion Summary  (https://dev-bo.royaledge.io/report/summary-promotion)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/report_summary_promotion.spec.js --project=setup --project=chromium
//
// Màn hình gồm:
//  - Bảng Promotion Summary (filter, sort, phân trang, Manage Columns, Export)
//  - Bấm Promo Code      -> popup "Promotion Details"
//  - Bấm Total Invited Player / No of Participants -> màn hình con "Promotion Summary Report - Promo"
// Các test chỉ ĐỌC dữ liệu, riêng test Export sẽ tạo bản ghi ở Download History
// (nếu file cùng filter đã export trước đó thì hệ thống hỏi "Download Now / Download New";
// test KHÔNG bấm Download New để tránh xoá file cũ).
// Không hard-code dữ liệu (promo, game, currency...) - mọi giá trị đều lấy từ chính bảng
// nên test không phụ thuộc vào data trên môi trường dev.
const { test, expect } = require("@playwright/test");

const URL = "/report/summary-promotion";
const PROMO_URL = (promoId, type, playerOption) =>
  `/report/summary-promotion/report-promo/${promoId}/${type}/${playerOption}`;

// Đúng thứ tự hiển thị
const COLUMNS = [
  "Promo Code",
  "Promo Name",
  "Operators",
  "Game Type",
  "Free Game Type",
  "Game Names",
  "Currency",
  "Visibility Date",
  "Start Date",
  "End Date",
  "Creation Date",
  "Status",
  "Total Invited Player",
  "No of Participants",
  "Total Bet Amount",
  "Total Win Amount",
  "Total Max Promo Win",
];

// Các cột có thể sort -> tên field gửi lên API
const SORTABLE = {
  "Promo Code": "promoCode",
  "Promo Name": "promoName",
  Operators: "operators",
  "Game Type": "gameType",
  "Free Game Type": "freeGameType",
  Status: "status", // API nhận "Status" (viết hoa chữ đầu) -> so sánh không phân biệt hoa/thường
  "Total Invited Player": "totalInvitedPlayer",
  "No of Participants": "noOfParticipants",
  "Total Bet Amount": "totalBetAmount",
  "Total Win Amount": "totalWinAmount",
  "Total Max Promo Win": "totalMaxWin",
};
// Cột số -> kiểm tra được thứ tự dữ liệu sau khi sort
const NUMERIC_SORT = [
  "Total Invited Player",
  "No of Participants",
  "Total Bet Amount",
  "Total Win Amount",
  "Total Max Promo Win",
];

const DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const INPUT_DATETIME = /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/;
const NUMBER = /^\d+(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const post = (r) => (typeof r.request === "function" ? r.request() : r).method() === "POST";
const isList = (r) => post(r) && r.url().endsWith("/report/promotion-summary-report");
const isPromo = (r) => post(r) && r.url().endsWith("/report/promotion-summary-promo-report");
const isDownload = (r) => post(r) && r.url().endsWith("/download");

const mainTable = (page) => page.locator(".ant-table").first();
const rows = (page) => mainTable(page).locator("tbody tr.ant-table-row");

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const exportBtn = (page) => page.locator("button.NextGen-export-button");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const modal = (page) => page.locator(".ant-modal-content");

// Phần tử bao 1 filter (theo id của input bên trong)
const filterEl = (page, id) =>
  page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
const dateRangeInput = (page, id) => page.locator(`#${id}_dateRange`);

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page, timeout = 5000) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0, { timeout });
}

// Mở màn hình và chờ lần load đầu tiên xong
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
      "Bị chuyển về /login: session trong playwright/.auth/session.txt đã hết hạn (backend chỉ cho 1 session/tài khoản - đăng nhập ở nơi khác sẽ làm session này mất hiệu lực). Copy lại localStorage từ DevTools.",
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

// Lấy toàn bộ các dòng của bảng dạng { "Promo Code": "...", ... } (các dòng của "Game Names" nối bằng "\n")
async function tableRecords(page) {
  const heads = await headers(page);
  const cells = await rows(page).evaluateAll((trs) =>
    trs.map((tr) => [...tr.children].map((c) => c.innerText.trim())),
  );
  return cells.map((r) => Object.fromEntries(heads.map((h, i) => [h, r[i]])));
}

// "... of 18383 records" (hiện tại không có dấu phẩy ngăn cách hàng nghìn, nhưng chấp nhận cả hai)
const recordsOf = (n) => new RegExp(`of (${n}|${n.toLocaleString("en-US")}) records$`);
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
const exact = (name, flags = "") =>
  new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, flags);
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
// "• A\n• B" -> "A, B"
const bulletsToNames = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/^\s*•\s*/, "").trim())
    .filter(Boolean)
    .join(", ");
// "09-11-2026 00:00:00" -> "2026-11-09 00:00:00" (cùng định dạng với dữ liệu trong bảng)
const inputToTable = (s) => s.replace(/^(\d{2})-(\d{2})-(\d{4})/, "$3-$2-$1");
// "09-11-2026 ..." -> Date (UTC, chỉ lấy phần ngày)
function parseDay(s) {
  const [d, m, y] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const diffDays = (a, b) => Math.round((a - b) / 86400000);

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
// KHÔNG click giữa ô: với dropdown chọn nhiều, vị trí đó có thể rơi vào nút (x) của chip đã chọn
// -> bấm vào sẽ XOÁ giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (theo tên) của filter dạng dropdown rồi đóng dropdown.
// Gõ tên vào ô tìm kiếm trước để option chắc chắn nằm trong danh sách hiển thị.
// `matcher` mặc định: khớp chính xác tên option (không phân biệt hoa/thường)
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
  // Click ra ngoài (tiêu đề trang) để đóng dropdown - phím Esc không đóng được khi chưa gõ tìm kiếm
  await breadcrumb(page).click();
  // Chờ dropdown đóng hẳn để lần mở dropdown tiếp theo không đọc nhầm danh sách cũ
  await expect(
    page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option"),
  ).toHaveCount(0);
  return titles;
}

// Các giá trị đang được chọn của 1 filter dạng multi-select (chip)
const selectedTitles = (page, id) =>
  filterEl(page, id).locator(".ant-select-selection-item[title]").evaluateAll((els) =>
    els.map((e) => e.getAttribute("title")),
  );

// Chọn preset ngày (Today / Yesterday / Last 7 Days ...) cho Date Period hoặc Creation Date
// (id = "datePeriod" | "createDate")
async function pickDatePreset(page, id, preset) {
  await filterEl(page, `${id}_0`).locator("label").first().click();
  // Popup của picker đang mở luôn được append SAU cùng trong DOM -> .last()
  await page.locator(".NextGen-datetime-preset__item").filter({ hasText: preset }).last().click();
  // Popup không tự đóng: click ra ngoài (tiêu đề trang) để đóng
  await breadcrumb(page).click();
}

// Xoá khoảng ngày bằng nút (x) (chỉ hiện khi hover nên dùng force)
async function clearDate(page, id) {
  // Icon (x) chỉ được render khi rê chuột vào ô ngày
  await filterEl(page, `${id}_0`).hover();
  await filterEl(page, `${id}_0`).locator('[aria-label="close-circle"]').click({ force: true });
}

// Màn hình luôn có dữ liệu (không lọc ngày mặc định); nếu trống thì skip
async function ensureData(page, test) {
  if ((await rows(page).count()) === 0) test.skip(true, "Báo cáo không có bản ghi nào để test");
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

// Mở popup Promotion Details của dòng thứ `index`, trả về { label: giá trị }
async function openDetails(page, index = 0) {
  await rows(page).nth(index).locator("td a").first().click();
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).locator(".ant-modal-title")).toHaveText("Promotion Details");
  return modal(page)
    .locator("tr.ant-descriptions-row")
    .evaluateAll((trs) =>
      Object.fromEntries(
        trs.map((tr) => [
          tr.querySelector("th").innerText.trim(),
          tr.querySelector("td").innerText.trim(),
        ]),
      ),
    );
}

async function closeDetails(page) {
  await modal(page).locator(".ant-modal-close").click();
  await expect(modal(page)).toBeHidden();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Report > Promotion Summary", () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, đủ filter và 2 nút Search/Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Promotion Summary Report");
      for (const [label, id] of [
        ["Timezone", "timezoneId"],
        ["Date Period", "datePeriod_0"],
        ["Creation Date", "createDate_0"],
        ["Promo Code", "code"],
        ["Promo Name", "name"],
        ["Game Type", "gameCategoryIds"],
        ["Free Game Type", "freeGameTypes"],
        ["Games", "gameIds"],
        ["Status", "status"],
        ["Currency", "currencyIds"],
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
      await expect(dateRangeInput(page, "datePeriod")).toHaveValue("");
      await expect(dateRangeInput(page, "createDate")).toHaveValue("");
      for (const id of ["code", "name", "gameCategoryIds", "freeGameTypes", "gameIds", "status", "currencyIds"]) {
        await expect(
          filterEl(page, id).locator(".ant-select-selection-item"),
          `#${id} phải trống`,
        ).toHaveCount(0);
      }
    });

    test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự và các nút Export / Manage Columns`, async ({
      page,
    }) => {
      expect(await headers(page)).toEqual(COLUMNS);
      await expect(exportBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
    });

    test("Mặc định sắp xếp Creation Date giảm dần, 10 dòng / trang", async ({ page }) => {
      await ensureData(page, test);
      await expect(summary(page)).toHaveText(/^Showing 1 - \d+ of /);
      expect(await rows(page).count()).toBeLessThanOrEqual(10);

      const dates = await columnValues(page, "Creation Date");
      expect(dates.length).toBeGreaterThan(0);
      for (const d of dates) expect(d).toMatch(DATETIME);
      expect(dates).toEqual([...dates].sort().reverse());
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
        const at = `dòng ${i + 1} (${a.promoCode})`;
        expect(r["Promo Code"], at).toBe(a.promoCode);
        expect(r["Promo Name"], at).toBe(a.promoName);
        expect(r["Operators"], at).toBe(a.operators);
        expect(r["Game Type"], at).toBe(a.gameType);
        expect(r["Free Game Type"], at).toBe(a.freeGameType);
        expect(bulletsToNames(r["Game Names"]), at).toBe(a.gameName);
        expect(r["Currency"], at).toBe(a.currency);
        expect(r["Visibility Date"], at).toBe(a.visibilityDate ?? "");
        expect(r["Start Date"], at).toBe(a.startDate);
        expect(r["End Date"], at).toBe(a.endDate);
        expect(r["Creation Date"], at).toBe(a.creationDate);
        expect(r["Status"], at).toBe(a.status);
        expect(num(r["Total Invited Player"]), at).toBe(a.totalInvitedPlayer);
        expect(num(r["No of Participants"]), at).toBe(a.noOfParticipants);
        expect(num(r["Total Bet Amount"]), at).toBeCloseTo(a.totalBetAmount, 4);
        expect(num(r["Total Win Amount"]), at).toBeCloseTo(a.totalWinAmount, 4);
        expect(num(r["Total Max Promo Win"]), at).toBeCloseTo(a.totalMaxWin, 4);
      });
    });

    test("Định dạng: ngày giờ, số, Currency dạng tag, Game Names dạng danh sách", async ({ page }) => {
      await ensureData(page, test);
      for (const col of ["Start Date", "End Date", "Creation Date"]) {
        for (const v of await columnValues(page, col)) expect(v, col).toMatch(DATETIME);
      }
      for (const v of await columnValues(page, "Visibility Date")) {
        expect(v === "" || DATETIME.test(v), `Visibility Date: "${v}"`).toBe(true);
      }
      for (const col of [
        "Total Invited Player",
        "No of Participants",
        "Total Bet Amount",
        "Total Win Amount",
        "Total Max Promo Win",
      ]) {
        for (const v of await columnValues(page, col)) expect(v, col).toMatch(NUMBER);
      }
      for (const v of await columnValues(page, "Game Names")) {
        for (const line of v.split("\n")) expect(line).toMatch(/^• .+/);
      }
      await expect(rows(page).first().locator(".ant-tag").first()).toHaveText(
        (await columnValues(page, "Currency"))[0],
      );
    });

    test("Ràng buộc dữ liệu: Start <= End, Creation <= Start, Participants <= Invited, Status hợp lệ", async ({
      page,
    }) => {
      await ensureData(page, test);
      for (const r of await tableRecords(page)) {
        const at = r["Promo Code"];
        expect(r["Start Date"] <= r["End Date"], `${at}: Start Date phải <= End Date`).toBe(true);
        expect(r["Creation Date"] <= r["Start Date"], `${at}: Creation Date phải <= Start Date`).toBe(true);
        expect(
          num(r["No of Participants"]) <= num(r["Total Invited Player"]),
          `${at}: No of Participants phải <= Total Invited Player`,
        ).toBe(true);
        expect(["Created", "In Progress", "Completed", "Cancelled"], at).toContain(r["Status"]);
        expect(num(r["Total Bet Amount"])).toBeGreaterThanOrEqual(0);
        expect(num(r["Total Win Amount"])).toBeGreaterThanOrEqual(0);
      }
    });

    test("Promo Code, Total Invited Player, No of Participants là link; các ô khác thì không", async ({
      page,
    }) => {
      await ensureData(page, test);
      const linkCols = ["Promo Code", "Total Invited Player", "No of Participants"].map((c) =>
        COLUMNS.indexOf(c),
      );
      const flags = await rows(page).evaluateAll((trs) =>
        trs.map((tr) => [...tr.children].map((c, i) => (c.querySelector("a") ? i : -1)).filter((i) => i >= 0)),
      );
      for (const f of flags) expect(f).toEqual(linkCols);
    });
  });

  // ===== 3. Popup Promotion Details =====
  test.describe("Popup Promotion Details", () => {
    test("Bấm Promo Code mở popup đúng thông tin, đóng được bằng nút X và phím Esc", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const a = json.data.list[0];
      const d = a.promotionDetails;

      const info = await openDetails(page, 0);
      expect(Object.keys(info)).toEqual([
        "Promo Code",
        "Promo Name",
        "Game Type",
        "Currency",
        "Game Names",
        "Free Game Type",
        "Free Game Count",
        "Bonus Type",
        "Countdown (Seconds)",
        "Allow Turbo Spin Mode",
        "Bet Type",
        "Bet Option",
        "Bet Amount",
        "Bet Amount Level",
        "Max Promo Win",
        "Visibility Date",
        "Start Date",
        "End Date",
        "Player Segmentation",
        "Players Processed",
        "Welcome Message",
        "Rules",
      ]);
      expect(info["Promo Code"]).toBe(a.promoCode);
      expect(info["Promo Name"]).toBe(a.promoName);
      expect(info["Game Type"]).toBe(a.gameType);
      expect(info["Currency"]).toBe(a.currency);
      expect(bulletsToNames(info["Game Names"])).toBe(a.gameName);
      expect(info["Free Game Type"]).toBe(a.freeGameType);
      expect(num(info["Max Promo Win"])).toBeCloseTo(d.maxPromoWin, 4);
      expect(info["Visibility Date"]).toBe(d.visibilityDate ?? "");
      expect(info["Start Date"]).toBe(d.startDate);
      expect(info["End Date"]).toBe(d.endDate);
      expect(info["Bet Type"]).toBe(d.betTypeDetail.betType);

      await closeDetails(page);
      await openDetails(page, 0);
      await modal(page).locator(".ant-modal-title").click(); // đưa focus vào popup
      await page.keyboard.press("Escape");
      await expect(modal(page)).toBeHidden();
    });

    test("Các trường chi tiết hiển thị theo Free Game Type và Bet Type (10 dòng đầu)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");

      for (const [i, a] of list.entries()) {
        const d = a.promotionDetails;
        const f = d.freeGameTypeDetail;
        const b = d.betTypeDetail;
        const at = `${a.promoCode} (${f.freeGameType}/${b.betType})`;
        const info = await openDetails(page, i);

        // Free Game Type = Simple -> chỉ hiện Free Game Count; = Variable -> hiện Bonus Type / Countdown / Turbo
        if (f.freeGameType === "Simple") {
          expect(info["Free Game Count"], at).toBe(String(f.freeGameCount));
          expect(info["Bonus Type"], at).toBe("");
          expect(info["Countdown (Seconds)"], at).toBe("");
          expect(info["Allow Turbo Spin Mode"], at).toBe("");
        } else {
          expect(info["Free Game Count"], at).toBe("");
          expect(info["Bonus Type"], at).toBe(f.bonusType);
          expect(info["Countdown (Seconds)"], at).toBe(String(f.countdown));
          expect(info["Allow Turbo Spin Mode"], at).toBe(f.allowTurboSpinMode ? "Yes" : "No");
        }
        // Bet Type = Fixed -> hiện Bet Option / Bet Amount; = Variable -> hiện Bet Amount Level
        if (b.betType === "Fixed") {
          expect(info["Bet Option"], at).toBe(b.betOption);
          expect(num(info["Bet Amount"]), at).toBeCloseTo(b.betAmount, 4);
          expect(info["Bet Amount Level"], at).toBe("");
        } else {
          expect(info["Bet Option"], at).toBe("");
          expect(info["Bet Amount"], at).toBe("");
          expect(info["Bet Amount Level"], at).toBe(`Level ${b.betAmountLevel}`);
        }
        await closeDetails(page);
      }
    });
  });

  // ===== 4. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Search mặc định gửi đúng request (timezone, phân trang, sort) và không có filter nào khác", async ({
      page,
    }) => {
      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "creationDate", sortDirection: "desc" });
      expect(Object.keys(body.filters)).toEqual(["timezoneId"]);
      expect(body.filters.timezoneId).toEqual(expect.any(Number));
    });

    for (const [label, id] of [
      ["Promo Code", "code"],
      ["Promo Name", "name"],
      ["Game Type", "gameCategoryIds"],
      ["Free Game Type", "freeGameTypes"],
      ["Games", "gameIds"],
      ["Status", "status"],
      ["Currency", "currencyIds"],
    ]) {
      test(`Dropdown ${label} load được danh sách option`, async ({ page }) => {
        expect((await dropdownOptions(page, id)).length).toBeGreaterThan(0);
      });
    }

    test("Option cố định của Free Game Type và Status", async ({ page }) => {
      expect(await dropdownOptions(page, "freeGameTypes")).toEqual(["Simple", "Variable"]);
      expect(await dropdownOptions(page, "status")).toEqual(["Created", "In Progress", "Completed", "Cancelled"]);
      expect(await dropdownOptions(page, "gameCategoryIds")).toContain("Slots");
    });

    // Lọc theo 1 giá trị lấy từ dòng đầu tiên -> mọi dòng trả về phải khớp
    for (const { label, id, column, field } of [
      { label: "Game Type", id: "gameCategoryIds", column: "Game Type", field: "gameCategoryIds" },
      { label: "Free Game Type", id: "freeGameTypes", column: "Free Game Type", field: "freeGameTypes" },
      { label: "Currency", id: "currencyIds", column: "Currency", field: "currencyIds" },
      { label: "Status", id: "status", column: "Status", field: "status" },
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

    test("Lọc theo Promo Code -> chỉ còn đúng 1 promo đó", async ({ page }) => {
      await ensureData(page, test);
      const code = (await columnValues(page, "Promo Code"))[0];
      await selectOption(page, "code", code);
      const { body } = await search(page);

      expect(body.filters.promoIds).toHaveLength(1);
      expect(body.filters.promoIds[0]).toEqual(expect.any(Number));
      expect(await columnValues(page, "Promo Code")).toEqual([code]);
      await expect(summary(page)).toHaveText("Showing 1 - 1 of 1 records");
    });

    test("Lọc theo Promo Name gửi promoIds (dropdown liệt kê theo từng promo)", async ({ page }) => {
      await ensureData(page, test);
      const name = (await columnValues(page, "Promo Name"))[0];
      await selectOption(page, "name", name);
      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body.filters.promoIds).toHaveLength(1);
      expect(body.filters.promoIds[0]).toEqual(expect.any(Number));
    });

    test("Lọc theo Games -> mọi dòng có game đã chọn", async ({ page }) => {
      await ensureData(page, test);
      const game = bulletsToNames((await columnValues(page, "Game Names"))[0]).split(", ")[0];
      // Option của dropdown có dạng "GAME_CODE - Game Name"
      await selectOption(page, "gameIds", game, new RegExp(`^\\S+ - ${escapeRx(game)}$`, "i"));
      const { body } = await search(page);

      expect(body.filters.gameIds).toHaveLength(1);
      const values = await columnValues(page, "Game Names");
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(bulletsToNames(v).split(", ")).toContain(game);
    });

    test("Dropdown cho phép chọn nhiều giá trị (Status)", async ({ page }) => {
      await selectOption(page, "status", "In Progress");
      await selectOption(page, "status", "Completed");
      const { body } = await search(page);
      expect(body.filters.status).toHaveLength(2);
      const values = await columnValues(page, "Status");
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(["In Progress", "Completed"]).toContain(v);
    });

    test("Kết hợp nhiều filter cùng lúc (AND)", async ({ page }) => {
      await ensureData(page, test);
      const [currency, freeType, status] = await Promise.all(
        ["Currency", "Free Game Type", "Status"].map((c) => columnValues(page, c).then((v) => v[0])),
      );
      await selectOption(page, "currencyIds", currency);
      await selectOption(page, "freeGameTypes", freeType);
      await selectOption(page, "status", status);
      const { body } = await search(page);
      expect(body.filters.currencyIds).toHaveLength(1);
      expect(body.filters.freeGameTypes).toHaveLength(1);
      expect(body.filters.status).toHaveLength(1);

      for (const v of await columnValues(page, "Currency")) expect(v).toBe(currency);
      for (const v of await columnValues(page, "Free Game Type")) expect(v).toBe(freeType);
      for (const v of await columnValues(page, "Status")) expect(v).toBe(status);
    });

    test("Không có kết quả -> hiển thị 'There are no entries found'", async ({ page }) => {
      await ensureData(page, test);
      // 1 promo chỉ có 1 trạng thái -> chọn Promo Code + 1 Status khác thì chắc chắn không có kết quả
      const [code, current] = await Promise.all(
        ["Promo Code", "Status"].map((c) => columnValues(page, c).then((v) => v[0])),
      );
      const other = ["Created", "In Progress", "Completed", "Cancelled"].find((s) => s !== current);
      await selectOption(page, "code", code);
      await selectOption(page, "status", other);
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

  // ===== 5. Bộ lọc thời gian =====
  test.describe("Date Period / Creation Date", () => {
    for (const [label, id] of [
      ["Date Period", "datePeriod"],
      ["Creation Date", "createDate"],
    ]) {
      test(`${label} có đủ các preset`, async ({ page }) => {
        await filterEl(page, `${id}_0`).locator("label").first().click();
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

      test(`${label}: các preset cho khoảng ngày đúng và gửi đúng request`, async ({ page }) => {
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
          await pickDatePreset(page, id, preset);
          const value = await dateRangeInput(page, id).inputValue();
          const [from, to] = value.split(" - ");
          expect(from, preset).toMatch(INPUT_DATETIME);
          expect(to, preset).toMatch(INPUT_DATETIME);
          expect(from.slice(11), preset).toBe("00:00:00");
          expect(to.slice(11), preset).toBe("23:59:59");
          if (preset === "Today") today = parseDay(to);
          expect(parseDay(to).getTime(), preset).toBe(today.getTime()); // luôn kết thúc ở hôm nay
          expect(diffDays(parseDay(to), parseDay(from)) + 1, preset).toBe(days);

          const { body } = await search(page);
          // Request: từ 00:00:00 ngày đầu đến 00:00:00 của ngày kế tiếp ngày cuối
          expect(body.filters[id], preset).toEqual([from, expect.stringMatching(INPUT_DATETIME)]);
          expect(diffDays(parseDay(body.filters[id][1]), parseDay(to)), preset).toBe(1);
          expect(body.filters[id][1].slice(11), preset).toBe("00:00:00");
        }
      });

      test(`${label}: preset Yesterday = hôm qua`, async ({ page }) => {
        await pickDatePreset(page, id, "Today");
        const today = parseDay((await dateRangeInput(page, id).inputValue()).split(" - ")[1]);
        await pickDatePreset(page, id, "Yesterday");
        const [from, to] = (await dateRangeInput(page, id).inputValue()).split(" - ");
        expect(diffDays(today, parseDay(from))).toBe(1);
        expect(diffDays(today, parseDay(to))).toBe(1);
      });

      test(`${label}: xoá bằng nút (x) -> request không còn ${id}`, async ({ page }) => {
        await pickDatePreset(page, id, "Last 7 Days");
        await expect(dateRangeInput(page, id)).not.toHaveValue("");
        await clearDate(page, id);
        await expect(dateRangeInput(page, id)).toHaveValue("");

        const { body, status } = await search(page);
        expect(status).toBe(200);
        expect(body.filters[id]).toBeUndefined();
      });
    }

    test("Creation Date: mọi dòng có Creation Date nằm trong khoảng đã chọn", async ({ page }) => {
      await pickDatePreset(page, "createDate", "Last 90 Days");
      const { body } = await search(page);
      const [from, to] = body.filters.createDate.map(inputToTable);

      const dates = await columnValues(page, "Creation Date");
      test.skip(dates.length === 0, "Không có promo nào được tạo trong 90 ngày gần nhất");
      for (const d of dates) {
        expect(d >= from, `${d} phải >= ${from}`).toBe(true);
        expect(d < to, `${d} phải < ${to}`).toBe(true);
      }
    });

    test("Date Period: chỉ lấy promo có thời gian chạy (Start -> End) nằm trọn trong khoảng đã chọn", async ({
      page,
    }) => {
      await pickDatePreset(page, "datePeriod", "Last 90 Days");
      const { body } = await search(page);
      const [from, to] = body.filters.datePeriod.map(inputToTable);

      const records = await tableRecords(page);
      test.skip(records.length === 0, "Không có promo nào chạy trong 90 ngày gần nhất");
      for (const r of records) {
        expect(r["Start Date"] >= from, `${r["Promo Code"]}: Start ${r["Start Date"]} phải >= ${from}`).toBe(true);
        expect(r["End Date"] < to, `${r["Promo Code"]}: End ${r["End Date"]} phải < ${to}`).toBe(true);
      }
    });

    test("Date Period thu hẹp khoảng ngày thì số bản ghi không tăng", async ({ page }) => {
      await pickDatePreset(page, "datePeriod", "Last 90 Days");
      const wide = (await search(page)).json.data.totalCount;
      await pickDatePreset(page, "datePeriod", "Last 7 Days");
      const narrow = (await search(page)).json.data.totalCount;
      expect(narrow).toBeLessThanOrEqual(wide);
    });
  });

  // ===== 6. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá toàn bộ filter đã chọn, giữ Timezone và hiển thị lại toàn bộ dữ liệu", async ({ page }) => {
      await ensureData(page, test);
      const total = (await search(page)).json.data.totalCount;
      const currency = (await columnValues(page, "Currency"))[0];
      const timezone = await filterEl(page, "timezoneId")
        .locator(".ant-select-selection-item")
        .getAttribute("title");

      await selectOption(page, "currencyIds", currency);
      await selectOption(page, "status", "Completed");
      await pickDatePreset(page, "createDate", "Last 90 Days");
      await search(page);

      await resetBtn(page).click();
      for (const id of ["code", "name", "gameCategoryIds", "freeGameTypes", "gameIds", "status", "currencyIds"]) {
        await expect(filterEl(page, id).locator(".ant-select-selection-item")).toHaveCount(0);
      }
      await expect(dateRangeInput(page, "datePeriod")).toHaveValue("");
      await expect(dateRangeInput(page, "createDate")).toHaveValue("");
      await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toHaveAttribute(
        "title",
        timezone,
      );

      const { body } = await search(page);
      expect(Object.keys(body.filters)).toEqual(["timezoneId"]);
      await expect(summary(page)).toHaveText(recordsOf(total));
    });
  });

  // ===== 7. Phân trang =====
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
      const status = (await columnValues(page, "Status"))[0];
      await selectOption(page, "status", status);
      const first = await search(page);
      test.skip(first.json.data.totalCount <= 10, `Status ${status} chỉ có 1 trang`);

      const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(body.page).toBe(2);
      expect(body.filters.status).toEqual(first.body.filters.status);
      for (const v of await columnValues(page, "Status")) expect(v).toBe(status);
    });
  });

  // ===== 8. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    for (const [column, sortBy] of Object.entries(SORTABLE)) {
      test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
        const th = mainTable(page).locator("thead th", { hasText: exact(column) });
        const key = (v) => (column === "Promo Code" ? v : num(v));
        const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
        const checkOrder = column === "Promo Code" || NUMERIC_SORT.includes(column);

        const asc = await reloadBy(page, () => th.click());
        expect(asc.sortBy.toLowerCase()).toBe(sortBy.toLowerCase());
        expect(asc.sortDirection).toBe("asc");
        if (checkOrder) {
          const v = (await columnValues(page, column)).map(key);
          expect(v).toEqual([...v].sort(cmp));
        }

        const desc = await reloadBy(page, () => th.click());
        expect(desc.sortBy.toLowerCase()).toBe(sortBy.toLowerCase());
        expect(desc.sortDirection).toBe("desc");
        if (checkOrder) {
          const v = (await columnValues(page, column)).map(key);
          expect(v).toEqual([...v].sort((a, b) => cmp(b, a)));
        }

        // Click lần 3: bỏ sort -> quay về mặc định Creation Date giảm dần
        const none = await reloadBy(page, () => th.click());
        expect(none).toMatchObject({ sortBy: "creationDate", sortDirection: "desc" });
      });
    }

    test("Các cột Game Names, Currency, Visibility/Start/End Date không có chức năng sort", async ({ page }) => {
      for (const column of ["Game Names", "Currency", "Visibility Date", "Start Date", "End Date"]) {
        await expect(
          mainTable(page).locator("thead th", { hasText: exact(column) }),
          column,
        ).not.toHaveClass(/ant-table-column-has-sorters/);
      }
    });
  });

  // ===== 9. Manage Columns =====
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
      await item(page, "Operators").locator("label").click();
      expect(await headers(page)).not.toContain("Operators");
      expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

      await item(page, "Operators").locator("label").click();
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Save đóng popover và lưu cấu hình cột (giữ nguyên sau khi reload)", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Visibility Date").locator("label").click();
      await columnPopover(page).getByRole("button", { name: "Save" }).click();
      await expect(columnPopover(page)).toBeHidden();

      await openPage(page); // reload
      expect(await headers(page)).not.toContain("Visibility Date");
      expect(await headers(page)).toHaveLength(COLUMNS.length - 1);
    });

    test("Reset to Default khôi phục toàn bộ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Operators").locator("label").click();
      await item(page, "Game Names").locator("label").click();
      expect(await headers(page)).toHaveLength(COLUMNS.length - 2);

      await columnPopover(page).getByRole("button", { name: "Reset to Default" }).click();
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      await ensureData(page, test);
      const before = await columnValues(page, "Promo Name");
      await columnBtn(page).click();
      await item(page, "Operators").locator("label").click();
      expect(await columnValues(page, "Promo Name")).toEqual(before);
    });
  });

  // ===== 10. Export =====
  test.describe("Export", () => {
    test("Export tạo job tải xuống (section PROMO_REPORT) gồm toàn bộ cột", async ({ page }) => {
      const { body, payload } = await exportAndCheck(page);
      expect(body.module).toBe("REPORTS");
      expect(body.section).toBe("PROMO_REPORT");
      expect(payload.filters.timezoneId).toEqual(expect.any(Number));
      expect(payload.filters.fields).toEqual(COLUMNS);
    });

    test("Export đi kèm đúng filter hiện tại", async ({ page }) => {
      await ensureData(page, test);
      const currency = (await columnValues(page, "Currency"))[0];
      await selectOption(page, "currencyIds", currency);
      await search(page);

      const { payload } = await exportAndCheck(page);
      expect(payload.filters.currencyIds).toHaveLength(1);
    });

    test("Export chỉ chứa các cột đang hiển thị", async ({ page }) => {
      await columnBtn(page).click();
      await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items", { hasText: exact("Operators") })
        .locator("label")
        .click();

      const [req] = await Promise.all([page.waitForRequest(isDownload), exportBtn(page).click()]);
      const payload = JSON.parse(JSON.parse(req.postData()).payload);
      expect(payload.filters.fields).not.toContain("Operators");
      expect(payload.filters.fields).toContain("Promo Code");
    });
  });

  // ===== 11. Ghi nhớ filter =====
  test("Filter được ghi nhớ sau khi reload trang", async ({ page }) => {
    await ensureData(page, test);
    const currency = (await columnValues(page, "Currency"))[0];
    await selectOption(page, "currencyIds", currency);
    await selectOption(page, "status", "Completed");
    await search(page);

    await openPage(page); // reload
    expect(await selectedTitles(page, "currencyIds")).toEqual([currency]);
    expect(await selectedTitles(page, "status")).toEqual(["Completed"]);
  });

  // ===== 12. Màn hình con: Promotion Summary Report - Promo =====
  test.describe("Màn hình con (Total Invited Player / No of Participants)", () => {
    // Mở danh sách chi tiết bằng cách bấm link ở dòng đầu tiên. API của màn hình này khá chậm -> chờ tối đa 60s
    async function openDrillDown(page, column) {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const a = json.data.list[0];
      const link = rows(page).first().locator("td a", {
        hasText: exact(String(column === "Total Invited Player" ? a.totalInvitedPlayer : a.noOfParticipants)),
      });
      const [req] = await Promise.all([
        page.waitForRequest(isPromo, { timeout: 60000 }),
        page.waitForResponse(isPromo, { timeout: 60000 }),
        link.first().click(),
      ]);
      await waitTableIdle(page, 60000);
      return { a, body: JSON.parse(req.postData()) };
    }

    test("Link Total Invited Player trỏ đúng URL và mở danh sách toàn bộ player được mời", async ({ page }) => {
      test.setTimeout(120000);
      const { a, body } = await openDrillDown(page, "Total Invited Player");

      await expect(page).toHaveURL(new RegExp(`${PROMO_URL(a.promoId, 1, a.playerOption)}$`));
      await expect(breadcrumb(page)).toContainText("Promotion Summary Report");
      expect(body.filters).toMatchObject({ promoId: a.promoId, playerOption: a.playerOption });
      expect(body.filters.status).toContain(0); // gồm cả trạng thái "Created"
      expect(await headers(page)).toEqual([
        "Promo Code",
        "Promo Name",
        "Player ID",
        "Player Name",
        "Rounds Awarded",
        "Rounds Played",
        "Free Spins",
        "Countdown Time",
        "Currency",
        "Game Names",
        "Total Bet Amount",
        "Total Win Amount",
        "Max Promo Win",
        "Freegame Start Date",
        "Status",
      ]);
      // Tổng số bản ghi = Total Invited Player ở màn hình danh sách
      await expect(summary(page)).toHaveText(
        recordsOf(a.totalInvitedPlayer),
      );
      for (const v of await columnValues(page, "Promo Code")) expect(v).toBe(a.promoCode);
    });

    test("Link No of Participants trỏ đúng URL và chỉ liệt kê player đã tham gia", async ({ page }) => {
      test.setTimeout(120000);
      const { a, body } = await openDrillDown(page, "No of Participants");

      await expect(page).toHaveURL(new RegExp(`${PROMO_URL(a.promoId, 2, a.playerOption)}$`));
      expect(body.filters.promoId).toBe(a.promoId);
      expect(body.filters.status).not.toContain(0); // không gồm "Created" (chưa tham gia)
      await expect(summary(page)).toHaveText(
        recordsOf(a.noOfParticipants),
      );
      for (const v of await columnValues(page, "Promo Code")) expect(v).toBe(a.promoCode);
      for (const v of await columnValues(page, "Status")) expect(v).not.toBe("Created");
    });

    test("Nút Previous quay lại màn hình Promotion Summary", async ({ page }) => {
      test.setTimeout(120000);
      await openDrillDown(page, "No of Participants");
      await page.getByRole("button", { name: "Previous" }).click();
      await expect(page).toHaveURL(/\/report\/summary-promotion$/);
      await expect(breadcrumb(page)).toHaveText("Promotion Summary Report");
      await expect(page.locator(".NextGen-filter-bar")).toBeVisible();
    });
  });
});
