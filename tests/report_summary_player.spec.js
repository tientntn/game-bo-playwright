// Báo cáo > Player Summary  (https://dev-bo.royaledge.io/report/summary-player)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/report_summary_player.spec.js --project=setup --project=chromium
//
// Màn hình có 2 tab: "General" và "Free Spin or Buy Bonus".
// Các test chỉ ĐỌC dữ liệu, riêng test Export sẽ tạo 1 bản ghi ở Download History
// (nếu file cùng filter đã export trước đó thì hệ thống hỏi "Download Now / Download New";
// test KHÔNG bấm Download New để tránh xoá file cũ).
// Không hard-code dữ liệu (player, game, currency...) - mọi giá trị đều lấy từ chính dòng đầu tiên
// của báo cáo để test không phụ thuộc vào data trên môi trường dev.
const { test, expect } = require("@playwright/test");

const URL = "/report/summary-player";
const FREE_SPIN_TAB = "Free Spin or Buy Bonus";

// Các cột của tab General (đúng thứ tự hiển thị)
const GENERAL_COLUMNS = [
  "Date",
  "Player ID",
  "Player Name",
  "Game Name",
  "Game Code",
  "Game Category",
  "Currency",
  "Sweepstake",
  "Total Bet",
  "Total ETO",
  "Total Win",
  "Total Win/Loss",
  "Total GGR",
  "Win Rate",
  "Total Bet Count",
  "Avg Bet Amount",
  "Total Active Sessions",
  "Sum Duration",
  "Average Duration",
  "Average Bets Per Session",
  "House",
  "Master Agent",
  "Agent",
];
// Tab Free Spin có thêm cột Summary ID ở đầu
const FREE_SPIN_COLUMNS = ["Summary ID", ...GENERAL_COLUMNS];

// Các cột có thể sort -> tên field gửi lên API
const SORTABLE = {
  Date: "day",
  "Total Bet": "totalBet",
  "Total Win": "totalWin",
  "Total GGR": "totalGgr",
  "Win Rate": "winRate",
  "Total Bet Count": "totalBetCount",
};

const MONEY = /^[+-]?[\d,]+\.\d{4}$/;
const PERCENT = /^[+-]?[\d,]+\.\d{4}%$/;
const COUNT = /^[\d,]+$/;
// Average Bets Per Session hiển thị số thường (tối đa 4 chữ số thập phân), vd: 47 / 8.3333
const DECIMAL = /^[+-]?[\d,]+(\.\d{1,4})?$/;
const DURATION = /^\d{2,}:\d{2}:\d{2}\.\d{3}$/;
const DAY = /^\d{2}-\d{2}-\d{4}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const post = (r) => (typeof r.request === "function" ? r.request() : r).method() === "POST";
const isSummary = (r) => post(r) && r.url().endsWith("/summary/player");
const isFreeSpin = (r) => post(r) && r.url().endsWith("/summary/player/free-spin");
const isSummation = (r) => post(r) && r.url().endsWith("/currency-summation");
const isDownload = (r) => post(r) && r.url().endsWith("/download");

// Bảng chính (bảng đầu tiên); 2 bảng Summation nằm bên dưới
const mainTable = (page) => page.locator(".ant-table").first();
const rows = (page) => mainTable(page).locator("tbody tr.ant-table-row");
const summationTable = (page) =>
  page.locator(".ant-table").filter({ hasText: "Summation By Currency" });
const conversionTable = (page) => page.locator(".ant-table").filter({ hasText: "Conversion" });

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const pageTitle = (page) =>
  page.getByRole("navigation").getByText("Player Summary Report");
const filterToggle = (page) =>
  page.locator(".NextGen-list-layout__filter-control__filter-btn");
const exportBtn = (page) => page.locator("button.NextGen-export-button");
const columnBtn = (page) =>
  page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const tab = (page, name) => page.getByRole("tab", { name });

// Phần tử bao 1 filter (theo id của input bên trong)
const filterEl = (page, id) =>
  page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
// Ô "Filter Type" (Day / Month) nằm ngoài thanh filter
const filterTypeEl = (page) =>
  page.locator(".ant-select").filter({ has: page.locator("#filterType") });

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
}

// Mở màn hình và chờ lần load đầu tiên (default filter) xong
async function openPage(page) {
  const firstLoad = page.waitForResponse(isSummary);
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

// Chuyển sang tab Free Spin or Buy Bonus và chờ dữ liệu
async function openFreeSpinTab(page) {
  await Promise.all([page.waitForResponse(isFreeSpin), tab(page, FREE_SPIN_TAB).click()]);
  await waitTableIdle(page);
}

// Bấm Search, trả về { body: request body (object), status } của API danh sách (mặc định tab General)
async function search(page, api = isSummary) {
  const [req, res] = await Promise.all([
    page.waitForRequest(api),
    page.waitForResponse(api),
    searchBtn(page).click(),
  ]);
  await waitTableIdle(page);
  return { body: JSON.parse(req.postData()), status: res.status() };
}

// Thực hiện 1 hành động làm bảng gọi lại API (đổi trang, sort...) rồi trả về request body
async function reloadBy(page, action, api = isSummary) {
  const [req] = await Promise.all([
    page.waitForRequest(api),
    page.waitForResponse(api),
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
  // Header có thể đang render lại ngay sau khi đổi tab / search -> chờ tới khi cột xuất hiện
  await expect.poll(() => headers(page), { message: `Không thấy cột "${name}"` }).toContain(name);
  const idx = (await headers(page)).indexOf(name);
  return rows(page).evaluateAll(
    (trs, i) => trs.map((tr) => tr.children[i].innerText.trim()),
    idx,
  );
}

const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
const exact = (name) => new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);

// Nhập text vào filter dạng input (input bị ẩn cho tới khi click vào label)
async function fillFilter(page, id, value) {
  await filterEl(page, id).locator("label").first().click();
  await page.locator(`#${id}`).fill(value);
}

// Chọn option (theo title) của filter dạng dropdown, rồi đóng dropdown.
// Gõ title vào ô tìm kiếm trước để option chắc chắn nằm trong danh sách hiển thị.
async function selectOption(page, id, title) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control").click();
  await page.keyboard.type(title);
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
    .and(page.locator(`[title="${title}"]`))
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
  await page.keyboard.press("Escape");
  return titles;
}

// Đổi Filter Type (Day / Month)
async function selectFilterType(page, type) {
  await filterTypeEl(page).click();
  await page
    .locator(
      `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${type}"]`,
    )
    .click();
}

// Chọn preset ngày (Today / Yesterday / Last 7 Days ...) cho Date Period (chế độ Day)
async function pickDatePreset(page, preset) {
  await filterEl(page, "datePeriod_0").locator("label").first().click();
  // Popup của picker đang mở luôn được append SAU cùng trong DOM -> .last()
  await page
    .locator(".NextGen-datetime-preset__item")
    .filter({ hasText: preset })
    .last()
    .click();
  // Popup không tự đóng: click ra ngoài (tiêu đề trang) để đóng
  await pageTitle(page).click();
}

const dateRangeInput = (page) => page.locator("#datePeriod_dateRange");

// "09-11-2026" -> Date (UTC)
function parseDay(s) {
  const [d, m, y] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
// "09-11-2026 - 09-11-2026" -> { from: Date, to: Date }
function parseRange(text) {
  const [from, to] = text.split(" - ");
  return { from: parseDay(from), to: parseDay(to) };
}
const diffDays = (a, b) => Math.round((a - b) / 86400000);

// Xoá Date Period bằng nút (x) (chỉ hiện khi hover nên dùng force)
async function clearDate(page) {
  await filterEl(page, "datePeriod_0").locator('[aria-label="close-circle"]').click({ force: true });
}

// Đảm bảo bảng có dữ liệu để test: mặc định Date Period = Today nên có thể trống.
// Khi đó mở rộng sang "Last 30 Days"; nếu vẫn trống thì skip.
async function ensureData(page, test, api = isSummary) {
  if ((await rows(page).count()) > 0) return;
  await pickDatePreset(page, "Last 30 Days");
  await search(page, api);
  if ((await rows(page).count()) === 0) {
    test.skip(true, "Không có bản ghi nào trong 30 ngày gần nhất để test");
  }
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Report > Player Summary", () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
  });

  // ===== 1. Hiển thị màn hình (tab General) =====
  test.describe("General - Hiển thị mặc định", () => {
    test("Có tiêu đề, 2 tab, Filter Type, đủ filter và 2 nút Search/Reset", async ({ page }) => {
      await expect(pageTitle(page)).toBeVisible();
      await expect(tab(page, "General")).toHaveAttribute("aria-selected", "true");
      await expect(tab(page, FREE_SPIN_TAB)).toHaveAttribute("aria-selected", "false");

      await expect(filterTypeEl(page)).toBeVisible();
      for (const [label, id] of [
        ["Timezone", "timezoneId"],
        ["Date Period", "datePeriod_0"],
        ["Player Name", "playerName"],
        ["Game Name", "gameName"],
        ["Game Code", "gameCode"],
        ["Game Category", "gameCategoryIds"],
        ["Currency", "currencyIds"],
        ["Sweepstake", "isSweep"],
        ["House", "houseIds"],
        ["Master Agent", "masterAgentIds"],
        ["Agent", "agentIds"],
      ]) {
        await expect(filterEl(page, id), `thiếu filter ${label}`).toContainText(label);
        await expect(filterEl(page, id)).toBeVisible();
      }
      // Bet Type chỉ có ở tab Free Spin or Buy Bonus
      await expect(filterEl(page, "betTypes")).toBeHidden();

      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định đúng", async ({ page }) => {
      await expect(filterTypeEl(page).locator(".ant-select-selection-item")).toHaveText("Day");
      await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toContainText(
        /^\(GMT [+-]\d{2}:\d{2}\)/,
      );
      await expect(filterEl(page, "isSweep").locator(".ant-select-selection-item")).toHaveText("No");

      // Date Period mặc định = 1 ngày (hôm nay)
      const value = await dateRangeInput(page).inputValue();
      expect(value).toMatch(/^\d{2}-\d{2}-\d{4} - \d{2}-\d{2}-\d{4}$/);
      const { from, to } = parseRange(value);
      expect(diffDays(to, from)).toBe(0);

      for (const id of [
        "gameName",
        "gameCode",
        "gameCategoryIds",
        "currencyIds",
        "houseIds",
        "masterAgentIds",
        "agentIds",
      ]) {
        await expect(
          filterEl(page, id).locator(".ant-select-selection-item"),
          `#${id} phải trống`,
        ).toHaveCount(0);
      }
      await expect(page.locator("#playerName")).toHaveValue("");
    });

    test("Bảng có đủ 23 cột đúng thứ tự và các nút Export / Manage Columns", async ({ page }) => {
      expect(await headers(page)).toEqual(GENERAL_COLUMNS);
      await expect(exportBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
    });

    test("Mặc định sắp xếp Date giảm dần, 10 dòng / trang", async ({ page }) => {
      await ensureData(page, test);
      await expect(summary(page)).toHaveText(/^Showing 1 - \d+ of /);
      expect(await rows(page).count()).toBeLessThanOrEqual(10);

      const dates = (await columnValues(page, "Date")).map((d) => d.split("-").reverse().join("-"));
      expect(dates.length).toBeGreaterThan(0);
      expect(dates).toEqual([...dates].sort().reverse());
    });

    test("Tooltip (i) của các cột giải thích công thức", async ({ page }) => {
      const TIPS = {
        "Total Win/Loss": "Total Win/Loss = Total Win - Total Bet",
        "Total GGR": "Total GGR = Total Bet - Total Win",
        "Win Rate": "Win Rate = (Total GGR / Total Bet) * 100",
        "Avg Bet Amount": "Avg Bet Amount = Total Bet / Total Bet Count",
        "Average Duration": "Average Duration = Sum Duration / Total Sessions",
        "Average Bets Per Session": "Average Bets Per Session = Total Bet Count / Total Active Sessions",
      };
      for (const [column, text] of Object.entries(TIPS)) {
        await mainTable(page)
          .locator("thead th", { hasText: exact(column) })
          .locator('[aria-label="info-circle"]')
          .hover();
        await expect(
          page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: text }),
          `tooltip của cột ${column}`,
        ).toBeVisible();
        await page.mouse.move(0, 0);
      }
    });

    test("Nút Filter thu gọn / mở rộng thanh filter", async ({ page }) => {
      const bar = page.locator(".NextGen-filter-bar__items");
      await expect(bar).toBeVisible();
      await filterToggle(page).click();
      await expect(bar).toBeHidden();
      await filterToggle(page).click();
      await expect(bar).toBeVisible();
    });

    test("Có 2 bảng tổng: Summation By Currency và Conversion", async ({ page }) => {
      const sum = summationTable(page);
      const conv = conversionTable(page);
      await expect(sum).toBeVisible();
      await expect(conv).toBeVisible();

      const sumHeaders = (await sum.locator("thead th").allInnerTexts()).map((t) => t.trim());
      expect(sumHeaders).toEqual([
        "Summation By Currency",
        "Total Bet",
        "Total ETO",
        "Total Win",
        "Total Win/Loss",
        "Total GGR",
        "Win Rate",
        "Total Bet Count",
        "Avg Bet Amount",
      ]);
      const convHeaders = (await conv.locator("thead th").allInnerTexts()).map((t) => t.trim());
      expect(convHeaders).toEqual([
        "Conversion",
        "Total Bet",
        "Total ETO",
        "Total Win",
        "Total Win/Loss",
        "Total GGR",
        "Avg Bet Amount",
      ]);
      // Mỗi bảng có 1 dropdown chọn currency, đã có giá trị mặc định
      await expect(sum.locator(".ant-select-selection-item").first()).not.toBeEmpty();
      await expect(conv.locator(".ant-select-selection-item").first()).not.toBeEmpty();
    });
  });

  // ===== 2. Dữ liệu bảng =====
  test.describe("General - Dữ liệu bảng", () => {
    test("Định dạng và công thức số liệu từng dòng", async ({ page }) => {
      await ensureData(page, test);
      const col = async (name) => (await columnValues(page, name));
      const [
        date, playerId, player, gameName, gameCode, category, currency, sweep, bet, eto, win,
        winLoss, ggr, winRate, betCount, avgBet, sessions, sumDur, avgDur, avgPerSession,
      ] = await Promise.all(GENERAL_COLUMNS.slice(0, 20).map(col));

      expect(bet.length).toBeGreaterThan(0);
      for (let i = 0; i < bet.length; i++) {
        const at = `dòng ${i + 1}`;
        expect(date[i], at).toMatch(DAY);
        expect(playerId[i], at).toMatch(/^\d+$/);
        for (const v of [player[i], gameName[i], gameCode[i], category[i], currency[i]]) {
          expect(v, at).not.toBe("");
        }
        expect(["Yes", "No"], at).toContain(sweep[i]);

        for (const v of [bet[i], eto[i], win[i], winLoss[i], ggr[i], avgBet[i]]) {
          expect(v, `${at}: "${v}"`).toMatch(MONEY);
        }
        expect(winRate[i], at).toMatch(PERCENT);
        expect(avgPerSession[i], at).toMatch(DECIMAL);
        expect(betCount[i], at).toMatch(COUNT);
        expect(sessions[i], at).toMatch(COUNT);
        expect(sumDur[i], at).toMatch(DURATION);
        expect(avgDur[i], at).toMatch(DURATION);

        // Công thức (đúng như tooltip (i))
        expect(num(winLoss[i]), `${at}: Win/Loss = Win - Bet`).toBeCloseTo(num(win[i]) - num(bet[i]), 3);
        expect(num(ggr[i]), `${at}: GGR = Bet - Win`).toBeCloseTo(num(bet[i]) - num(win[i]), 3);
        if (num(bet[i]) >= 1) {
          expect(num(winRate[i]), `${at}: Win Rate = GGR / Bet * 100`).toBeCloseTo(
            (num(ggr[i]) / num(bet[i])) * 100,
            1,
          );
        }
        if (num(betCount[i]) > 0) {
          expect(num(avgBet[i]), `${at}: Avg Bet = Bet / Bet Count`).toBeCloseTo(
            num(bet[i]) / num(betCount[i]),
            3,
          );
        }
        if (num(sessions[i]) > 0) {
          expect(num(avgPerSession[i]), `${at}: Avg Bets/Session`).toBeCloseTo(
            num(betCount[i]) / num(sessions[i]),
            3,
          );
        }
      }
    });

    test("Mỗi dòng có đủ House / Master Agent / Agent", async ({ page }) => {
      await ensureData(page, test);
      for (const column of ["House", "Master Agent", "Agent"]) {
        const values = await columnValues(page, column);
        for (const v of values) expect(v, `cột ${column} bị rỗng`).not.toBe("");
      }
    });

    test("Click Player Name chuyển sang Bet History với đúng Player Name", async ({ page }) => {
      await ensureData(page, test);
      const player = (await columnValues(page, "Player Name"))[0];

      const betHistoryReq = page.waitForRequest(
        (r) => r.url().includes("bet_history/settled") && r.method() === "POST",
      );
      await rows(page).first().getByText(player, { exact: true }).click();
      await page.waitForURL(/\/report\/bet-history/);

      const body = JSON.parse((await betHistoryReq).postData());
      expect(body.filters.playerName).toBe(player);
      expect(body.filters.currencyIds).toHaveLength(1);
      await expect(page.locator("#playerName")).toHaveValue(player);
    });
  });

  // ===== 3. Search & các filter =====
  test.describe("General - Search / Filter", () => {
    test("Search mặc định gửi đúng request (timezone, datePeriod, phân trang, sort)", async ({
      page,
    }) => {
      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "day", sortDirection: "desc" });
      expect(body.filters.timezoneId).toEqual(expect.any(Number));
      expect(body.filters.dateType).toBe("Day");
      expect(body.filters.isSweep).toBe(0);
      expect(body.filters.datePeriod).toHaveLength(2);
      expect(body.filters.datePeriod[0]).toBe(body.filters.datePeriod[1]); // mặc định 1 ngày
      expect(body.filters.datePeriod[0]).toMatch(DAY);
    });

    test("Tìm theo Player Name", async ({ page }) => {
      await ensureData(page, test);
      const player = (await columnValues(page, "Player Name"))[0];
      await fillFilter(page, "playerName", player);
      const { body } = await search(page);
      expect(body.filters.playerName).toBe(player);

      const players = await columnValues(page, "Player Name");
      expect(players.length).toBeGreaterThan(0);
      for (const p of players) expect(p.toLowerCase()).toContain(player.toLowerCase());
    });

    // Lọc theo từng dropdown (lấy giá trị từ dòng đầu tiên) -> mọi dòng trả về phải khớp.
    const DROPDOWN_CASES = [
      { label: "Game Name", id: "gameName", column: "Game Name", field: "gameIds" },
      { label: "Game Code", id: "gameCode", column: "Game Code", field: "gameIds" },
      { label: "Game Category", id: "gameCategoryIds", column: "Game Category", field: "gameCategoryIds" },
      { label: "Currency", id: "currencyIds", column: "Currency", field: "currencyIds" },
      { label: "House", id: "houseIds", column: "House", field: "houseIds" },
      { label: "Master Agent", id: "masterAgentIds", column: "Master Agent", field: "masterAgentIds" },
      { label: "Agent", id: "agentIds", column: "Agent", field: "agentIds" },
    ];
    for (const { label, id, column, field } of DROPDOWN_CASES) {
      test(`Dropdown ${label} load được danh sách option`, async ({ page }) => {
        expect((await dropdownOptions(page, id)).length).toBeGreaterThan(0);
      });

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

    test("Dropdown Sweepstake có đủ option All / Yes / No", async ({ page }) => {
      expect(await dropdownOptions(page, "isSweep")).toEqual(["All", "Yes", "No"]);
    });

    test("Sweepstake: Yes / All / No gửi đúng isSweep", async ({ page }) => {
      await pickDatePreset(page, "Last 30 Days");

      await selectOption(page, "isSweep", "Yes");
      const yes = await search(page);
      expect(yes.body.filters.isSweep).toBe(1);
      for (const v of await columnValues(page, "Sweepstake")) expect(v).toBe("Yes");

      await selectOption(page, "isSweep", "All");
      const all = await search(page);
      expect(all.body.filters.isSweep).toBeUndefined(); // All = không lọc

      await selectOption(page, "isSweep", "No");
      const no = await search(page);
      expect(no.body.filters.isSweep).toBe(0);
      for (const v of await columnValues(page, "Sweepstake")) expect(v).toBe("No");
    });

    test("Dropdown cho phép chọn nhiều giá trị (Game Category)", async ({ page }) => {
      await pickDatePreset(page, "Last 30 Days");
      const options = await dropdownOptions(page, "gameCategoryIds");
      expect(options.length).toBeGreaterThan(1);
      await selectOption(page, "gameCategoryIds", options[0]);
      await selectOption(page, "gameCategoryIds", options[1]);
      const { body } = await search(page);
      expect(body.filters.gameCategoryIds).toHaveLength(2);
      for (const v of await columnValues(page, "Game Category")) {
        expect([options[0], options[1]]).toContain(v);
      }
    });

    test("Kết hợp nhiều filter cùng lúc (AND)", async ({ page }) => {
      await ensureData(page, test);
      const [player, currency, category] = await Promise.all(
        ["Player Name", "Currency", "Game Category"].map((c) => columnValues(page, c).then((v) => v[0])),
      );
      await fillFilter(page, "playerName", player);
      await selectOption(page, "currencyIds", currency);
      await selectOption(page, "gameCategoryIds", category);
      const { body } = await search(page);
      expect(body.filters.playerName).toBe(player);
      expect(body.filters.currencyIds).toHaveLength(1);
      expect(body.filters.gameCategoryIds).toHaveLength(1);

      for (const v of await columnValues(page, "Player Name")) expect(v).toBe(player);
      for (const v of await columnValues(page, "Currency")) expect(v).toBe(currency);
      for (const v of await columnValues(page, "Game Category")) expect(v).toBe(category);
    });

    test("Không có kết quả -> hiển thị 'There are no entries found'", async ({ page }) => {
      await fillFilter(page, "playerName", "no_such_player_zzz_999");
      await search(page);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText("There are no entries found")).toBeVisible();
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

    test("Thiếu Date Period -> báo lỗi, không gọi API", async ({ page }) => {
      await clearDate(page);
      await expect(dateRangeInput(page)).toHaveValue("");

      let called = false;
      page.on("request", (r) => {
        if (isSummary(r)) called = true;
      });
      await searchBtn(page).click();

      await expect(page.getByText("Please start a search with Datetime")).toBeVisible();
      expect(called).toBe(false);
    });
  });

  // ===== 4. Bộ lọc thời gian =====
  test.describe("General - Filter Type & Date Period", () => {
    test("Filter Type có 2 lựa chọn Day / Month", async ({ page }) => {
      await filterTypeEl(page).click();
      const options = await page
        .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
        .evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      expect(options).toEqual(["Day", "Month"]);
    });

    test("Date Period có đủ các preset", async ({ page }) => {
      await filterEl(page, "datePeriod_0").locator("label").first().click();
      await expect(page.locator(".NextGen-datetime-preset__item").last()).toBeVisible();
      const presets = await page.locator(".NextGen-datetime-preset__item").allInnerTexts();
      expect(presets.map((p) => p.trim())).toEqual([
        "Today",
        "Yesterday",
        "Last 7 Days",
        "Last 14 Days",
        "Last 30 Days",
        "Last 90 Days",
      ]);
    });

    test("Preset Yesterday / Last 7 / 14 / 30 / 90 Days cho đúng khoảng ngày", async ({ page }) => {
      const today = parseRange(await dateRangeInput(page).inputValue()).to;

      await pickDatePreset(page, "Yesterday");
      let range = parseRange(await dateRangeInput(page).inputValue());
      expect(diffDays(today, range.from)).toBe(1);
      expect(diffDays(range.to, range.from)).toBe(0);

      for (const n of [7, 14, 30, 90]) {
        await pickDatePreset(page, `Last ${n} Days`);
        range = parseRange(await dateRangeInput(page).inputValue());
        expect(diffDays(range.to, range.from), `Last ${n} Days`).toBe(n - 1);
        expect(diffDays(today, range.to), `Last ${n} Days kết thúc hôm nay`).toBe(0);
      }
    });

    test("Date Period = Last 7 Days: request đúng và dữ liệu nằm trong khoảng đã chọn", async ({
      page,
    }) => {
      await pickDatePreset(page, "Last 7 Days");
      const { from, to } = parseRange(await dateRangeInput(page).inputValue());

      const { body } = await search(page);
      expect(body.filters.dateType).toBe("Day");
      expect(body.filters.datePeriod).toHaveLength(2);
      expect(parseDay(body.filters.datePeriod[0]).getTime()).toBe(from.getTime());
      expect(parseDay(body.filters.datePeriod[1]).getTime()).toBe(to.getTime());

      for (const d of await columnValues(page, "Date")) {
        const t = parseDay(d).getTime();
        expect(t >= from.getTime() && t <= to.getTime(), `${d} nằm ngoài khoảng`).toBe(true);
      }
    });

    test("Nút (x) của Date Period xoá giá trị", async ({ page }) => {
      await expect(dateRangeInput(page)).not.toHaveValue("");
      await clearDate(page);
      await expect(dateRangeInput(page)).toHaveValue("");
    });

    test("Filter Type = Month: nhãn Month Period, request dateType Month, cột Date theo tháng", async ({
      page,
    }) => {
      await selectFilterType(page, "Month");
      await expect(filterEl(page, "datePeriod_0")).toContainText("Month Period");
      await expect(dateRangeInput(page)).toHaveValue(/^\d{4} [A-Z][a-z]{2} - \d{4} [A-Z][a-z]{2}$/);

      const { body, status } = await search(page, isSummary);
      expect(status).toBe(200);
      expect(body.filters.dateType).toBe("Month");
      expect(body.filters.datePeriod).toHaveLength(2);
      for (const p of body.filters.datePeriod) expect(p).toMatch(/^\d{2}-\d{4}$/);

      for (const d of await columnValues(page, "Date")) {
        expect(d).toMatch(/^\d{4} [A-Z][a-z]+$/); // vd: 2026 November
      }
    });

    test("Filter Type = Month: chọn khoảng tháng (Jan -> tháng hiện tại)", async ({ page }) => {
      await selectFilterType(page, "Month");
      const [year, current] = (await dateRangeInput(page).inputValue()).split(" - ")[0].split(" ");
      const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      test.skip(current === "Jan", "Tháng hiện tại là Jan, không chọn được khoảng");

      await dateRangeInput(page).click({ force: true });
      const picker = page.locator(".react-datepicker__month-container");
      await picker.getByText("Jan", { exact: true }).click();
      await picker.getByText(current, { exact: true }).click();
      await pageTitle(page).click();

      await expect(dateRangeInput(page)).toHaveValue(`${year} Jan - ${year} ${current}`);
      const { body } = await search(page);
      const mm = String(MONTHS.indexOf(current) + 1).padStart(2, "0");
      expect(body.filters.datePeriod).toEqual([`01-${year}`, `${mm}-${year}`]);
    });
  });

  // ===== 5. Reset =====
  test("Reset đưa toàn bộ filter về mặc định", async ({ page }) => {
    // Ngày mặc định = giá trị Date Period lúc mở màn hình (trước khi ensureData đổi sang Last 30 Days)
    const todayText = await dateRangeInput(page).inputValue();
    await ensureData(page, test);

    const [player, currency, category] = await Promise.all(
      ["Player Name", "Currency", "Game Category"].map((c) => columnValues(page, c).then((v) => v[0])),
    );
    // Đổi nhiều loại filter khác nhau
    await pickDatePreset(page, "Last 7 Days");
    await fillFilter(page, "playerName", player);
    await selectOption(page, "currencyIds", currency);
    await selectOption(page, "gameCategoryIds", category);
    await selectOption(page, "isSweep", "Yes");

    await resetBtn(page).click();
    await waitTableIdle(page);

    await expect(dateRangeInput(page)).toHaveValue(todayText);
    await expect(filterEl(page, "isSweep").locator(".ant-select-selection-item")).toHaveText("No");
    for (const id of ["gameName", "gameCode", "gameCategoryIds", "currencyIds", "houseIds", "masterAgentIds", "agentIds"]) {
      await expect(
        filterEl(page, id).locator(".ant-select-selection-item"),
        `#${id} chưa được reset`,
      ).toHaveCount(0);
    }
    await expect(page.locator("#playerName")).toHaveValue("");
  });

  // ===== 6. Phân trang =====
  test.describe("General - Phân trang", () => {
    test.beforeEach(async ({ page }) => {
      // Cần > 20 bản ghi để test phân trang
      await pickDatePreset(page, "Last 30 Days");
      await search(page);
      const total = num((await summary(page).innerText()).match(/of ([\d,]+) records/)[1]);
      test.skip(total <= 20, `Chỉ có ${total} bản ghi, không đủ để test phân trang`);
    });

    test("Chuyển sang trang 2 rồi quay lại trang 1", async ({ page }) => {
      const page1 = await columnValues(page, "Player ID");

      const body2 = await reloadBy(page, () =>
        page.getByRole("button", { name: "2", exact: true }).click(),
      );
      expect(body2.page).toBe(2);
      await expect(summary(page)).toHaveText(/^Showing 11 - 20 of /);
      expect(await columnValues(page, "Player ID")).not.toEqual(page1);

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
  });

  // ===== 7. Sắp xếp =====
  test.describe("General - Sắp xếp", () => {
    for (const [column, sortBy] of Object.entries(SORTABLE)) {
      test(`Sort cột ${column} tăng dần rồi giảm dần`, async ({ page }) => {
        await pickDatePreset(page, "Last 7 Days");
        await search(page);
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
        const th = mainTable(page).locator("thead th", { hasText: exact(column) });
        const key = (v) => (column === "Date" ? v.split("-").reverse().join("-") : num(v));
        const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

        const asc = await reloadBy(page, () => th.click());
        expect(asc.sortBy).toBe(sortBy);
        expect(asc.sortDirection).toBe("asc");
        const ascValues = (await columnValues(page, column)).map(key);
        expect(ascValues).toEqual([...ascValues].sort(cmp));

        const desc = await reloadBy(page, () => th.click());
        expect(desc.sortBy).toBe(sortBy);
        expect(desc.sortDirection).toBe("desc");
        const descValues = (await columnValues(page, column)).map(key);
        expect(descValues).toEqual([...descValues].sort((a, b) => cmp(b, a)));
      });
    }
  });

  // ===== 8. Bảng tổng (Summation By Currency / Conversion) =====
  test.describe("General - Summation By Currency", () => {
    // Đọc 1 dòng của bảng tổng thành object theo header
    async function readTotals(table) {
      const cells = await table
        .locator("tbody tr.ant-table-row")
        .first()
        .evaluate((tr) => [...tr.children].map((c) => c.innerText.trim()));
      const heads = (await table.locator("thead th").allInnerTexts()).map((t) => t.trim());
      return Object.fromEntries(heads.map((h, i) => [h, cells[i]]));
    }

    test("Đổi currency của Summation gửi summaryCurrencyId mới và hiển thị đúng currency", async ({
      page,
    }) => {
      const select = summationTable(page).locator(".ant-select").first();
      await select.click();
      const options = page.locator(
        ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
      );
      await options.first().waitFor();
      const titles = await options.evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      const current = await select.locator(".ant-select-selection-item").getAttribute("title");
      const other = titles.find((t) => t !== current);

      const [req] = await Promise.all([
        page.waitForRequest(isSummation),
        options.and(page.locator(`[title="${other}"]`)).first().click(),
      ]);
      expect(JSON.parse(req.postData()).summaryCurrencyId).toEqual(expect.any(Number));
      await waitTableIdle(page);
      await expect(select.locator(".ant-select-selection-item")).toHaveAttribute("title", other);
    });

    test("Tổng của Summation khớp tổng các dòng trong bảng (cùng filter)", async ({ page }) => {
      await ensureData(page, test);
      const [player, currency] = await Promise.all(
        ["Player Name", "Currency"].map((c) => columnValues(page, c).then((v) => v[0])),
      );
      await fillFilter(page, "playerName", player);
      await selectOption(page, "currencyIds", currency);
      await search(page);

      // Gom toàn bộ dòng vào 1 trang (tối đa 200) để cộng tay
      const total = num((await summary(page).innerText()).match(/of ([\d,]+) records/)[1]);
      test.skip(total > 200, `Có ${total} dòng, nhiều hơn 1 trang tối đa (200)`);
      if (total > 10) {
        await page.locator(".ant-pagination-options .ant-select").click();
        await reloadBy(page, () =>
          page
            .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option", {
              hasText: "200 / page",
            })
            .click(),
        );
      }
      const sumColumn = async (name) =>
        (await columnValues(page, name)).map(num).reduce((a, b) => a + b, 0);
      const expected = {
        "Total Bet": await sumColumn("Total Bet"),
        "Total Win": await sumColumn("Total Win"),
        "Total Win/Loss": await sumColumn("Total Win/Loss"),
        "Total Bet Count": await sumColumn("Total Bet Count"),
      };

      // Chọn currency của Summation = currency của player rồi đọc tổng
      const select = summationTable(page).locator(".ant-select").first();
      await select.click();
      await page.keyboard.type(currency);
      await Promise.all([
        page.waitForResponse(isSummation),
        page
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
          .and(page.locator(`[title="${currency}"]`))
          .first()
          .click(),
      ]);
      await waitTableIdle(page);
      await expect(select.locator(".ant-select-selection-item")).toHaveAttribute("title", currency);

      const totals = await readTotals(summationTable(page));
      for (const [name, value] of Object.entries(expected)) {
        expect(num(totals[name]), `Summation "${name}"`).toBeCloseTo(value, 1);
      }
    });
  });

  // ===== 9. Manage Columns =====
  test.describe("General - Manage Columns", () => {
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
      expect(names.map((n) => n.trim())).toEqual(GENERAL_COLUMNS);
    });

    test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Game Code").locator("label").click();
      expect(await headers(page)).not.toContain("Game Code");
      expect(await headers(page)).toHaveLength(GENERAL_COLUMNS.length - 1);

      await item(page, "Game Code").locator("label").click();
      expect(await headers(page)).toEqual(GENERAL_COLUMNS);
    });

    test("Save đóng popover và lưu cấu hình cột (giữ nguyên sau khi reload)", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Sum Duration").locator("label").click();
      await columnPopover(page).getByRole("button", { name: "Save" }).click();
      await expect(columnPopover(page)).toBeHidden();

      await openPage(page); // reload
      expect(await headers(page)).not.toContain("Sum Duration");
      expect(await headers(page)).toHaveLength(GENERAL_COLUMNS.length - 1);
    });

    test("Reset to Default khôi phục toàn bộ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Game Code").locator("label").click();
      await item(page, "Player ID").locator("label").click();
      expect(await headers(page)).toHaveLength(GENERAL_COLUMNS.length - 2);

      await columnPopover(page).getByRole("button", { name: "Reset to Default" }).click();
      expect(await headers(page)).toEqual(GENERAL_COLUMNS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      await ensureData(page, test);
      const before = await columnValues(page, "Player ID");
      await columnBtn(page).click();
      await item(page, "Game Code").locator("label").click();
      expect(await columnValues(page, "Player ID")).toEqual(before);
    });
  });

  // ===== 10. Export =====
  test.describe("General - Export", () => {
    test("Export tạo job tải xuống với đúng filter hiện tại", async ({ page }) => {
      await ensureData(page, test);
      const player = (await columnValues(page, "Player Name"))[0];
      await fillFilter(page, "playerName", player);
      await search(page);

      const { body, payload } = await exportAndCheck(page);
      expect(body.module).toBe("REPORTS");
      expect(body.section).toBe("REPORTS_PLAYER_SUMMARY");
      expect(payload.filters.playerName).toBe(player);
      expect(payload.filters.dateType).toBe("Day");
      expect(payload.filters.fields).toEqual(GENERAL_COLUMNS);
    });

    test("Export chỉ chứa các cột đang hiển thị", async ({ page }) => {
      await columnBtn(page).click();
      await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items", { hasText: exact("Player ID") })
        .locator("label")
        .click();

      const [req] = await Promise.all([page.waitForRequest(isDownload), exportBtn(page).click()]);
      const payload = JSON.parse(JSON.parse(req.postData()).payload);
      expect(payload.filters.fields).not.toContain("Player ID");
      expect(payload.filters.fields).toContain("Player Name");
    });
  });

  // ===== 11. Ghi nhớ filter =====
  test("Filter được ghi nhớ sau khi reload trang", async ({ page }) => {
    await ensureData(page, test);
    const player = (await columnValues(page, "Player Name"))[0];
    await fillFilter(page, "playerName", player);
    await selectOption(page, "isSweep", "All");
    await search(page);

    await openPage(page); // reload
    await expect(page.locator("#playerName")).toHaveValue(player);
    await expect(filterEl(page, "isSweep").locator(".ant-select-selection-item")).toHaveText("All");
  });

  // ===== 12. Tab Free Spin or Buy Bonus =====
  test.describe("Tab Free Spin or Buy Bonus", () => {
    test.beforeEach(async ({ page }) => {
      await openFreeSpinTab(page);
    });

    test("Hiển thị đúng: tab được chọn, có filter Bet Type và cột Summary ID", async ({ page }) => {
      await expect(tab(page, FREE_SPIN_TAB)).toHaveAttribute("aria-selected", "true");
      await expect(filterEl(page, "betTypes")).toBeVisible();
      await expect(filterEl(page, "betTypes")).toContainText("Bet Type");

      // Cột đầu là cột nút mở rộng (+), không có tiêu đề
      const heads = await headers(page);
      expect(heads[0]).toBe("");
      expect(heads.slice(1)).toEqual(FREE_SPIN_COLUMNS);
    });

    test("Dropdown Bet Type có đủ các loại cược", async ({ page }) => {
      const options = await dropdownOptions(page, "betTypes");
      for (const expected of ["Normal", "Freespin", "Bonus", "Buy Bonus A", "Buy Bonus B"]) {
        expect(options, `thiếu Bet Type ${expected}`).toContain(expected);
      }
    });

    test("Search gọi API free-spin với request mặc định đúng", async ({ page }) => {
      const { body, status } = await search(page, isFreeSpin);
      expect(status).toBe(200);
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "day", sortDirection: "desc" });
      expect(body.filters.dateType).toBe("Day");
      expect(body.filters.isSweep).toBe(0);
      expect(body.filters.betTypes).toBeUndefined();
    });

    test("Dữ liệu: Summary ID, ngày và các số liệu đúng định dạng", async ({ page }) => {
      await ensureData(page, test, isFreeSpin);
      const [summaryId, date, bet, winLoss, ggr, winRate] = await Promise.all(
        ["Summary ID", "Date", "Total Bet", "Total Win/Loss", "Total GGR", "Win Rate"].map((c) =>
          columnValues(page, c),
        ),
      );
      expect(summaryId.length).toBeGreaterThan(0);
      for (let i = 0; i < summaryId.length; i++) {
        expect(summaryId[i]).toMatch(/^\d+_\d+_\S+$/);
        expect(date[i]).toMatch(DAY);
        expect(bet[i]).toMatch(MONEY);
        expect(winLoss[i]).toMatch(MONEY);
        expect(ggr[i]).toMatch(MONEY);
        expect(winRate[i]).toMatch(PERCENT);
        expect(num(ggr[i])).toBeCloseTo(-num(winLoss[i]), 3);
      }
    });

    test("Lọc theo Bet Type = Normal gửi đúng betTypes", async ({ page }) => {
      await selectOption(page, "betTypes", "Normal");
      const { body, status } = await search(page, isFreeSpin);
      expect(status).toBe(200);
      expect(body.filters.betTypes).toHaveLength(1);
    });

    test("Mở rộng dòng (+) hiển thị chi tiết theo Bet Type, bấm lại để thu gọn", async ({ page }) => {
      await ensureData(page, test, isFreeSpin);
      const totalBet = num((await columnValues(page, "Total Bet"))[0]);
      const first = rows(page).first();
      const expandIcon = first.locator(".ant-table-row-expand-icon");

      await expandIcon.click();
      const expanded = mainTable(page).locator("tr.ant-table-expanded-row").first();
      await expect(expanded).toBeVisible();

      const detailHeads = (await expanded.locator("thead th").allInnerTexts())
        .map((t) => t.trim())
        .filter(Boolean);
      expect(detailHeads).toEqual([
        "Bet Type",
        "Bet Amount",
        "Win Amt (Excl. FS)",
        "FS Win Amt",
        "Win/Loss",
        "GGR",
        "Win Rate",
        "Spin Count (Excl. FS)",
        "FS Count",
        "Buy Count",
      ]);

      // Tổng Bet Amount theo từng Bet Type = Total Bet của dòng
      const detailBets = await expanded
        .locator("tbody tr.ant-table-row")
        .evaluateAll((trs) => trs.map((tr) => tr.children[1].innerText.trim()));
      expect(detailBets.length).toBeGreaterThan(0);
      for (const v of detailBets) expect(v).toMatch(MONEY);
      expect(detailBets.map(num).reduce((a, b) => a + b, 0)).toBeCloseTo(totalBet, 2);

      await expandIcon.click();
      await expect(expanded).toBeHidden();
    });

    test("Manage Columns liệt kê đủ cột (có Summary ID)", async ({ page }) => {
      await columnBtn(page).click();
      const names = await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items .ant-typography")
        .allInnerTexts();
      expect(names.map((n) => n.trim())).toEqual(FREE_SPIN_COLUMNS);
    });

    test("Export dùng section REPORTS_PLAYER_FS_SUMMARY và gồm cột Summary ID", async ({ page }) => {
      await ensureData(page, test, isFreeSpin);
      const { body, payload } = await exportAndCheck(page);
      expect(body.module).toBe("REPORTS");
      expect(body.section).toBe("REPORTS_PLAYER_FS_SUMMARY");
      expect(payload.filters.fields[0]).toBe("Summary ID");
      expect(payload.filters.fields).toEqual(FREE_SPIN_COLUMNS);
    });

    test("Quay lại tab General hiển thị lại đúng cột của General", async ({ page }) => {
      await Promise.all([page.waitForResponse(isSummary), tab(page, "General").click()]);
      await waitTableIdle(page);
      await expect(tab(page, "General")).toHaveAttribute("aria-selected", "true");
      await expect(filterEl(page, "betTypes")).toBeHidden();
      expect(await headers(page)).toEqual(GENERAL_COLUMNS);
    });
  });
});
