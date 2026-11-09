// Báo cáo > Game Recommendation  (https://dev-bo.royaledge.io/report/game-recommendation)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/report_game_recommendation.spec.js --project=setup --project=chromium
//
// Báo cáo thống kê hiệu quả của tính năng "gợi ý game": mỗi dòng là 1 game được mở (launched game) trong 1 ngày / 1 tháng:
//  - Lobby Launches  : số lần game được mở từ lobby
//  - In-Game Launches: số lần game được mở từ 1 game khác (Source Game) - xem chi tiết ở nút "View Details"
//  - Source Game Count: số game nguồn đã chuyển người chơi sang game này
// Bên dưới bảng chính có bảng tổng (Total Unique Source Games / In-game Launches / Lobby Launches / Bet Counts / Unique Player).
//
// Các test chỉ ĐỌC dữ liệu, riêng test Export sẽ tạo bản ghi ở Download History
// (nếu file cùng filter đã export trước đó thì hệ thống hỏi "Download Now / Download New";
// test KHÔNG bấm Download New để tránh xoá file cũ).
// Không hard-code dữ liệu (game, house, agent...) - mọi giá trị đều lấy từ chính dòng đầu tiên của báo cáo.
const { test, expect } = require("@playwright/test");

const URL = "/report/game-recommendation";

// Các cột của bảng chính (đúng thứ tự hiển thị)
const COLUMNS = [
  "Date",
  "Game Name",
  "Game Code",
  "Game Category",
  "Source Game Count",
  "In-Game Launches",
  "Lobby Launches",
  "Total Bet Counts",
  "Total Unique Player Counts",
  "Details",
  "House",
  "Master Agent",
  "Agent",
];

// Các cột có thể sort -> tên field gửi lên API (mặc định sort theo date giảm dần)
const SORTABLE = {
  Date: "date",
  "Game Name": "gameName",
  "Game Code": "gameCode",
  "Game Category": "gameCategory",
  "Source Game Count": "sourceGameCount",
  "In-Game Launches": "inGameLaunches",
  "Lobby Launches": "lobbyLaunches",
  "Total Bet Counts": "totalBetCount",
  "Total Unique Player Counts": "totalUniquePlayerCount",
};
// Cột kiểm tra được thứ tự dữ liệu sau khi sort (cột chữ phụ thuộc collation của server nên chỉ kiểm tra request)
const NUMERIC_SORT = [
  "Source Game Count",
  "In-Game Launches",
  "Lobby Launches",
  "Total Bet Counts",
  "Total Unique Player Counts",
];

const TOTAL_COLUMNS = [
  "Total Unique Source Games",
  "Total In-game Launches",
  "Total Lobby Launches",
  "Total Bet Counts",
  "Total Unique Player",
];

const DAY = /^\d{2}-\d{2}-\d{4}$/;
const MONTH = /^\d{2}-\d{4}$/;
const COUNT = /^\d+$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const isList = (r) => post(r) && reqOf(r).url().endsWith("/summary/game-recommendation");
const isDetails = (r) => post(r) && reqOf(r).url().endsWith("/summary/game-recommendation/details");
const isDownload = (r) => post(r) && reqOf(r).url().endsWith("/download");

// Bảng chính (bảng đầu tiên); bảng tổng nằm bên dưới
const mainTable = (page) => page.locator(".ant-table").first();
const rows = (page) => mainTable(page).locator("tbody tr.ant-table-row");
const totalsTable = (page) =>
  page.locator(".ant-table").filter({ hasText: "Total Unique Source Games" });

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const pageTitle = (page) => page.getByRole("navigation").getByText("Game Recommendation Report");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const exportBtn = (page) => page.locator("button.NextGen-export-button");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const modal = (page) => page.locator(".ant-modal-content");

// Phần tử bao 1 filter (theo id của input bên trong)
const filterEl = (page, id) =>
  page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
// Ô "Filter Type" (Day / Month) nằm ngoài thanh filter
const filterTypeEl = (page) =>
  page.locator(".ant-select").filter({ has: page.locator("#filterType") });
const dateRangeInput = (page) => page.locator("#datePeriod_dateRange");

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

// Toàn bộ các dòng của bảng dạng { "Date": "...", ... }
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

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
// KHÔNG click giữa ô: với dropdown chọn nhiều, vị trí đó có thể rơi vào nút (x) của chip đã chọn
// (vị trí chip còn đổi theo lúc antd đo lại) -> bấm vào sẽ XOÁ giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (theo tên, KHÔNG phân biệt hoa/thường) của filter dạng dropdown rồi đóng dropdown.
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
  await pageTitle(page).click();
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
  await pageTitle(page).click();
  await expect(
    page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option"),
  ).toHaveCount(0);
  return titles;
}

// Các giá trị đang được chọn của 1 filter (chip)
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
  await page.locator(".NextGen-datetime-preset__item").filter({ hasText: preset }).last().click();
  // Popup không tự đóng: click ra ngoài (tiêu đề trang) để đóng
  await pageTitle(page).click();
}

// Xoá Date Period bằng nút (x) (chỉ hiện khi hover nên dùng force)
async function clearDate(page) {
  await filterEl(page, "datePeriod_0").hover();
  await filterEl(page, "datePeriod_0").locator('[aria-label="close-circle"]').click({ force: true });
}

// Mặc định Date Period = hôm nay nên có thể trống. Khi đó mở rộng sang "Last 30 Days"; nếu vẫn trống thì skip.
async function ensureData(page, test) {
  if ((await rows(page).count()) > 0) return;
  await pickDatePreset(page, "Last 30 Days");
  await search(page);
  if ((await rows(page).count()) === 0) {
    test.skip(true, "Không có bản ghi nào trong 30 ngày gần nhất để test");
  }
}

// Đặt số dòng / trang
async function setPageSize(page, size) {
  await page.locator(".ant-pagination-options .ant-select").click();
  return reloadBy(page, () =>
    page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option", {
        hasText: `${size} / page`,
      })
      .click(),
  );
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

// Mở popup "Game Recommendation Details" của dòng thứ `index`
// Trả về { req: body request /details, json: response, fields: { label: giá trị }, sourceRows: [[tên game, launches, players, bets]] }
async function openDetails(page, index = 0) {
  const [req, res] = await Promise.all([
    page.waitForRequest(isDetails),
    page.waitForResponse(isDetails),
    rows(page).nth(index).getByRole("button", { name: "View Details" }).click(),
  ]);
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).locator(".ant-modal-title")).toHaveText("Game Recommendation Details");
  const json = (await res.json()).data;

  // Các dòng "nhãn : giá trị" ở phần trên của popup (bảng mô tả) và bảng Source Games ở dưới
  const fields = await modal(page)
    .locator("tr.ant-descriptions-row")
    .evaluateAll((trs) =>
      Object.fromEntries(
        trs.map((tr) => [
          tr.querySelector("th").innerText.trim(),
          tr.querySelector("td").innerText.trim(),
        ]),
      ),
    );
  const sourceRows = await modal(page)
    .locator(".ant-table tbody tr.ant-table-row")
    .evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.innerText.trim())));
  return { req: JSON.parse(req.postData()), json, fields, sourceRows };
}

async function closeDetails(page) {
  await modal(page).locator(".ant-modal-close").click();
  await expect(modal(page)).toBeHidden();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Report > Game Recommendation", () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, tab General, Filter Type, đủ filter và 2 nút Search/Reset", async ({ page }) => {
      await expect(pageTitle(page)).toBeVisible();
      await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");

      await expect(filterTypeEl(page)).toBeVisible();
      for (const [label, id] of [
        ["Timezone", "timezoneId"],
        ["Date Period", "datePeriod_0"],
        ["Game Name", "gameName"],
        ["Game Code", "gameCode"],
        ["Game Category", "gameCategoryIds"],
        ["House", "houseIds"],
        ["Master Agent", "masterAgentIds"],
        ["Agent", "agentIds"],
      ]) {
        await expect(filterEl(page, id), `thiếu filter ${label}`).toContainText(label);
        await expect(filterEl(page, id)).toBeVisible();
      }
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: Filter Type = Day, Date Period = hôm nay, còn lại để trống", async ({ page }) => {
      await expect(filterTypeEl(page).locator(".ant-select-selection-item")).toHaveText("Day");
      await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toContainText(
        /^\(GMT [+-]\d{2}:\d{2}\)/,
      );

      const value = await dateRangeInput(page).inputValue();
      expect(value).toMatch(/^\d{2}-\d{2}-\d{4} - \d{2}-\d{2}-\d{4}$/);
      const { from, to } = parseRange(value);
      expect(diffDays(to, from)).toBe(0); // mặc định 1 ngày (hôm nay)

      for (const id of ["gameName", "gameCode", "gameCategoryIds", "houseIds", "masterAgentIds", "agentIds"]) {
        await expect(
          filterEl(page, id).locator(".ant-select-selection-item"),
          `#${id} phải trống`,
        ).toHaveCount(0);
      }
    });

    test(`Bảng chính có đủ ${COLUMNS.length} cột đúng thứ tự và các nút Export / Manage Columns`, async ({ page }) => {
      expect(await headers(page)).toEqual(COLUMNS);
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

    test("Nút Filter thu gọn / mở rộng thanh filter", async ({ page }) => {
      const bar = page.locator(".NextGen-filter-bar__items");
      await expect(bar).toBeVisible();
      await filterToggle(page).click();
      await expect(bar).toBeHidden();
      await filterToggle(page).click();
      await expect(bar).toBeVisible();
    });

    test("Có bảng tổng với 5 cột", async ({ page }) => {
      await expect(totalsTable(page)).toBeVisible();
      const heads = (await totalsTable(page).locator("thead th").allInnerTexts())
        .map((t) => t.trim())
        .filter(Boolean);
      expect(heads).toEqual(TOTAL_COLUMNS);
    });
  });

  // ===== 2. Dữ liệu bảng =====
  test.describe("Dữ liệu bảng", () => {
    test("Mỗi dòng khớp response API (định dạng hiển thị)", async ({ page }) => {
      await ensureData(page, test);
      const { json } = await search(page);
      const list = json.data.list;
      const records = await tableRecords(page);
      expect(records).toHaveLength(list.length);

      records.forEach((r, i) => {
        const a = list[i];
        const at = `dòng ${i + 1} (${a.gameName} ${a.date})`;
        expect(r["Date"], at).toBe(a.date);
        expect(r["Game Name"], at).toBe(a.gameName);
        expect(r["Game Code"], at).toBe(a.gameCode);
        expect(r["Game Category"], at).toBe(a.gameCategory);
        expect(num(r["Source Game Count"]), at).toBe(a.sourceGameCount);
        expect(num(r["In-Game Launches"]), at).toBe(a.inGameLaunches);
        expect(num(r["Lobby Launches"]), at).toBe(a.lobbyLaunches);
        expect(num(r["Total Bet Counts"]), at).toBe(a.totalBetCount);
        expect(num(r["Total Unique Player Counts"]), at).toBe(a.totalUniquePlayerCount);
        expect(r["House"], at).toBe(a.houseName);
        expect(r["Master Agent"], at).toBe(a.masterAgentName);
        expect(r["Agent"], at).toBe(a.agentName);
      });
    });

    test("Định dạng: ngày dd-MM-yyyy, các cột đếm là số nguyên không âm, mỗi dòng có nút View Details", async ({
      page,
    }) => {
      await ensureData(page, test);
      for (const v of await columnValues(page, "Date")) expect(v).toMatch(DAY);
      for (const col of [
        "Source Game Count",
        "In-Game Launches",
        "Lobby Launches",
        "Total Bet Counts",
        "Total Unique Player Counts",
      ]) {
        for (const v of await columnValues(page, col)) expect(v, col).toMatch(COUNT);
      }
      const n = await rows(page).count();
      await expect(mainTable(page).getByRole("button", { name: "View Details" })).toHaveCount(n);
    });

    test("Bảng tổng khớp response API; khi chỉ có 1 trang thì tổng lượt mở / bet = tổng các dòng", async ({ page }) => {
      await ensureData(page, test);
      const { json } = await search(page);
      const { totals, list, totalCount } = json.data;

      const cells = await totalsTable(page)
        .locator("tbody tr.ant-table-row")
        .first()
        .evaluate((tr) => [...tr.children].map((c) => c.innerText.trim()));
      expect(cells.map(num)).toEqual([
        totals.totalUniqueSourceGames,
        totals.totalInGameLaunches,
        totals.totalLobbyLaunches,
        totals.totalBetCount,
        totals.totalUniquePlayerCount,
      ]);

      if (totalCount <= list.length) {
        const sum = (k) => list.reduce((a, b) => a + b[k], 0);
        expect(totals.totalInGameLaunches).toBe(sum("inGameLaunches"));
        expect(totals.totalLobbyLaunches).toBe(sum("lobbyLaunches"));
        expect(totals.totalBetCount).toBe(sum("totalBetCount"));
        // Unique Player được đếm không trùng giữa các game nên nằm giữa max và tổng các dòng
        const players = list.map((x) => x.totalUniquePlayerCount);
        expect(totals.totalUniquePlayerCount).toBeGreaterThanOrEqual(Math.max(...players));
        expect(totals.totalUniquePlayerCount).toBeLessThanOrEqual(players.reduce((a, b) => a + b, 0));
      }
    });
  });

  // ===== 3. Popup View Details =====
  test.describe("Popup View Details", () => {
    test("Popup hiển thị đúng thông tin của game / ngày và gọi API details với đúng tham số của dòng", async ({
      page,
    }) => {
      await ensureData(page, test);
      const { json } = await search(page);
      const a = json.data.list[0];

      const { req, json: d, fields } = await openDetails(page, 0);
      expect(req).toMatchObject({
        gameId: a.gameId,
        date: a.date,
        houseIds: [a.houseId],
        masterAgentIds: [a.masterAgentId],
        agentIds: [a.agentId],
      });
      expect(req.timeZoneId).toEqual(expect.any(Number));

      expect(fields["Launched Game Name"]).toBe(a.gameName);
      expect(fields["Date"]).toBe(a.date);
      expect(num(fields["Lobby Launches"])).toBe(d.lobbyLaunches);
      expect(num(fields["Lobby Unique Player"])).toBe(d.lobbyUniquePlayerCount);
      expect(num(fields["Lobby Bet Count"])).toBe(d.lobbyBetCount);
      // Lượt mở từ lobby trong popup phải bằng cột Lobby Launches của dòng
      expect(d.lobbyLaunches).toBe(a.lobbyLaunches);

      await expect(modal(page)).toContainText(
        "The following activities are attributed to the game launched above, not to the Source Games from which it was launched.",
      );
      await expect(modal(page)).toContainText("Source Game Name");
      await expect(modal(page)).toContainText("In-Game Launches");
    });

    test("Dòng có In-Game Launches: bảng Source Games khớp API và cộng đúng với cột của dòng", async ({ page }) => {
      await ensureData(page, test);
      // Tìm dòng có In-Game Launches > 0: mở rộng sang 90 ngày, 200 dòng / trang
      await pickDatePreset(page, "Last 90 Days");
      await search(page);
      const body = await setPageSize(page, 200);
      expect(body.pageSize).toBe(200);
      const records = await tableRecords(page);
      const index = records.findIndex((r) => num(r["In-Game Launches"]) > 0);
      test.skip(index < 0, "Không có dòng nào có In-Game Launches trong 90 ngày gần nhất");
      const row = records[index];

      const { json: d, sourceRows } = await openDetails(page, index);
      expect(d.sourceGames.length).toBeGreaterThan(0);
      expect(sourceRows).toHaveLength(d.sourceGames.length);
      d.sourceGames.forEach((s, i) => {
        expect(sourceRows[i][0]).toBe(s.sourceGameName);
        expect(num(sourceRows[i][1])).toBe(s.inGameLaunches);
        expect(num(sourceRows[i][2])).toBe(s.uniquePlayerCount);
        expect(num(sourceRows[i][3])).toBe(s.betCount);
      });
      // Tổng lượt mở từ các game nguồn = cột In-Game Launches; số game nguồn = cột Source Game Count
      expect(d.sourceGames.reduce((a, s) => a + s.inGameLaunches, 0)).toBe(num(row["In-Game Launches"]));
      expect(d.sourceGames).toHaveLength(num(row["Source Game Count"]));
    });

    test("Dòng không có Source Game: bảng nguồn hiển thị 'No data'", async ({ page }) => {
      await ensureData(page, test);
      const records = await tableRecords(page);
      const index = records.findIndex((r) => num(r["Source Game Count"]) === 0);
      test.skip(index < 0, "Trang đầu không có dòng nào không có Source Game");

      const { sourceRows } = await openDetails(page, index);
      expect(sourceRows).toEqual([]);
      await expect(modal(page).getByText("No data")).toBeVisible();
    });

    test("Popup đóng được bằng nút X và phím Esc", async ({ page }) => {
      await ensureData(page, test);
      await openDetails(page, 0);
      await closeDetails(page);

      await openDetails(page, 0);
      await modal(page).locator(".ant-modal-title").click(); // đưa focus vào popup
      await page.keyboard.press("Escape");
      await expect(modal(page)).toBeHidden();
    });
  });

  // ===== 4. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Search mặc định gửi đúng request (timezone, datePeriod, phân trang, sort)", async ({ page }) => {
      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "date", sortDirection: "desc" });
      expect(body.filters.timezoneId).toEqual(expect.any(Number));
      expect(body.filters.dateType).toBe("Day");
      expect(body.filters.datePeriod).toHaveLength(2);
      expect(body.filters.datePeriod[0]).toBe(body.filters.datePeriod[1]); // mặc định 1 ngày
      expect(body.filters.datePeriod[0]).toMatch(DAY);
      expect(Object.keys(body.filters).sort()).toEqual(["dateType", "datePeriod", "timezoneId"]);
    });

    // Lọc theo từng dropdown (lấy giá trị từ dòng đầu tiên) -> mọi dòng trả về phải khớp.
    // Game Code trong dropdown viết HOA - so sánh không phân biệt hoa/thường cho chắc chắn.
    const DROPDOWN_CASES = [
      { label: "Game Name", id: "gameName", column: "Game Name", field: "gameIds" },
      { label: "Game Code", id: "gameCode", column: "Game Code", field: "gameIds" },
      { label: "Game Category", id: "gameCategoryIds", column: "Game Category", field: "gameCategoryIds" },
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
        for (const v of values) expect(v.toLowerCase()).toBe(value.toLowerCase());
      });
    }

    test("Dropdown cho phép chọn nhiều giá trị (Game Name)", async ({ page }) => {
      const options = await dropdownOptions(page, "gameName");
      expect(options.length).toBeGreaterThan(1);
      await selectOption(page, "gameName", options[0]);
      await selectOption(page, "gameName", options[1]);
      // Ô filter chỉ hiện 1 chip, phần còn lại gom thành "+ N ..." nên đếm tổng số giá trị đã chọn
      // antd đo lại chip bất đồng bộ sau khi chọn nên dùng poll thay vì đọc 1 lần
      await expect.poll(() => selectedCount(page, "gameName"), { timeout: 10_000 }).toBe(2);
      const { body } = await search(page);
      expect(body.filters.gameIds).toHaveLength(2);
    });

    test("Kết hợp nhiều filter cùng lúc (AND)", async ({ page }) => {
      await ensureData(page, test);
      const [game, category, agent] = await Promise.all(
        ["Game Name", "Game Category", "Agent"].map((c) => columnValues(page, c).then((v) => v[0])),
      );
      await selectOption(page, "gameName", game);
      await selectOption(page, "gameCategoryIds", category);
      await selectOption(page, "agentIds", agent);
      const { body } = await search(page);
      expect(body.filters.gameIds).toHaveLength(1);
      expect(body.filters.gameCategoryIds).toHaveLength(1);
      expect(body.filters.agentIds).toHaveLength(1);

      for (const v of await columnValues(page, "Game Name")) expect(v).toBe(game);
      for (const v of await columnValues(page, "Game Category")) expect(v).toBe(category);
      for (const v of await columnValues(page, "Agent")) expect(v).toBe(agent);
    });

    test("Không có kết quả -> hiển thị 'There are no entries found'", async ({ page }) => {
      // Chọn 1 game KHÔNG có trong kết quả hiện tại (cùng Date Period) -> chắc chắn không có dòng nào
      await ensureData(page, test);
      const present = (await columnValues(page, "Game Name")).map((g) => g.toLowerCase());
      const options = await dropdownOptions(page, "gameName");
      const absent = options.find((o) => !present.includes(o.toLowerCase()));
      test.skip(!absent, "Mọi game đều đã có trong kết quả hiện tại");

      await selectOption(page, "gameName", absent);
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

    test("Thiếu Date Period -> báo lỗi, không gọi API", async ({ page }) => {
      await clearDate(page);
      await expect(dateRangeInput(page)).toHaveValue("");

      let called = false;
      page.on("request", (r) => {
        if (isList(r)) called = true;
      });
      await searchBtn(page).click();

      await expect(page.getByText("Please start a search with Datetime")).toBeVisible();
      expect(called).toBe(false);
    });
  });

  // ===== 5. Bộ lọc thời gian =====
  test.describe("Filter Type & Date Period", () => {
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

    test("Date Period = Last 7 Days: request đúng và dữ liệu nằm trong khoảng đã chọn", async ({ page }) => {
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

    test("Filter Type = Month: nhãn Month Period, request dateType Month, cột Date theo tháng (MM-yyyy)", async ({
      page,
    }) => {
      await selectFilterType(page, "Month");
      await expect(filterEl(page, "datePeriod_0")).toContainText("Month Period");
      await expect(dateRangeInput(page)).toHaveValue(/^\d{4} [A-Z][a-z]{2} - \d{4} [A-Z][a-z]{2}$/);

      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body.filters.dateType).toBe("Month");
      expect(body.filters.datePeriod).toHaveLength(2);
      for (const p of body.filters.datePeriod) expect(p).toMatch(MONTH);

      for (const d of await columnValues(page, "Date")) expect(d).toMatch(MONTH);
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

  // ===== 6. Reset =====
  test("Reset đưa toàn bộ filter về mặc định", async ({ page }) => {
    // Ngày mặc định = giá trị Date Period lúc mở màn hình (trước khi ensureData đổi sang Last 30 Days)
    const todayText = await dateRangeInput(page).inputValue();
    await ensureData(page, test);

    const [game, category, agent] = await Promise.all(
      ["Game Name", "Game Category", "Agent"].map((c) => columnValues(page, c).then((v) => v[0])),
    );
    // Đổi nhiều loại filter khác nhau
    await pickDatePreset(page, "Last 7 Days");
    await selectOption(page, "gameName", game);
    await selectOption(page, "gameCategoryIds", category);
    await selectOption(page, "agentIds", agent);

    await resetBtn(page).click();
    await waitTableIdle(page);

    await expect(dateRangeInput(page)).toHaveValue(todayText);
    await expect(filterTypeEl(page).locator(".ant-select-selection-item")).toHaveText("Day");
    for (const id of ["gameName", "gameCode", "gameCategoryIds", "houseIds", "masterAgentIds", "agentIds"]) {
      await expect(
        filterEl(page, id).locator(".ant-select-selection-item"),
        `#${id} chưa được reset`,
      ).toHaveCount(0);
    }
  });

  // ===== 7. Phân trang =====
  test.describe("Phân trang", () => {
    test.beforeEach(async ({ page }) => {
      // Cần > 20 bản ghi để test phân trang: mặc định chỉ có dữ liệu của 1 ngày nên mở rộng sang 90 ngày
      await pickDatePreset(page, "Last 90 Days");
      await search(page);
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
      expect(body.page).toBe(2);
      expect(body.filters).toEqual(first.body.filters);
    });
  });

  // ===== 8. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    for (const [column, sortBy] of Object.entries(SORTABLE)) {
      test(`Sort cột ${column}`, async ({ page }) => {
        // Mở rộng 7 ngày để có nhiều dòng; nếu không đủ dòng thì chỉ kiểm tra request
        await pickDatePreset(page, "Last 7 Days");
        await search(page);
        const th = mainTable(page).locator("thead th", { hasText: exact(column) });
        const key = (v) => (column === "Date" ? v.split("-").reverse().join("-") : num(v));
        const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
        const checkOrder = (column === "Date" || NUMERIC_SORT.includes(column)) && (await rows(page).count()) >= 2;

        // Click lần 1: mặc định đang là Date giảm dần -> cột Date chuyển sang tăng dần; các cột khác sắp xếp tăng dần
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

        // Click lần 3: các cột khác Date bỏ sort -> quay về mặc định Date giảm dần; riêng Date quay lại tăng dần
        const third = await reloadBy(page, () => th.click());
        if (column === "Date") {
          expect(third).toMatchObject({ sortBy: "date", sortDirection: "asc" });
        } else {
          expect(third).toMatchObject({ sortBy: "date", sortDirection: "desc" });
        }
      });
    }

    test("Cột Details và House / Master Agent / Agent không có chức năng sort", async ({ page }) => {
      for (const column of ["Details", "House", "Master Agent", "Agent"]) {
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
      await item(page, "Game Code").locator("label").click();
      expect(await headers(page)).not.toContain("Game Code");
      expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

      await item(page, "Game Code").locator("label").click();
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Save đóng popover và lưu cấu hình cột (giữ nguyên sau khi reload)", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Source Game Count").locator("label").click();
      await columnPopover(page).getByRole("button", { name: "Save" }).click();
      await expect(columnPopover(page)).toBeHidden();

      await openPage(page); // reload
      expect(await headers(page)).not.toContain("Source Game Count");
      expect(await headers(page)).toHaveLength(COLUMNS.length - 1);
    });

    test("Reset to Default khôi phục toàn bộ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Game Code").locator("label").click();
      await item(page, "Game Category").locator("label").click();
      expect(await headers(page)).toHaveLength(COLUMNS.length - 2);

      await columnPopover(page).getByRole("button", { name: "Reset to Default" }).click();
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      await ensureData(page, test);
      const before = await columnValues(page, "Game Name");
      await columnBtn(page).click();
      await item(page, "Game Code").locator("label").click();
      expect(await columnValues(page, "Game Name")).toEqual(before);
    });
  });

  // ===== 10. Export =====
  test.describe("Export", () => {
    test("Export tạo job tải xuống (section REPORTS_GAME_RECOMMENDATION) gồm toàn bộ cột", async ({ page }) => {
      const { body, payload } = await exportAndCheck(page);
      expect(body.module).toBe("REPORTS");
      expect(body.section).toBe("REPORTS_GAME_RECOMMENDATION");
      expect(payload.filters.timezoneId).toEqual(expect.any(Number));
      expect(payload.filters.dateType).toBe("Day");
      expect(payload.filters.datePeriod).toHaveLength(2);
      expect(payload.filters.fields).toEqual(COLUMNS);
    });

    test("Export đi kèm đúng filter hiện tại", async ({ page }) => {
      await ensureData(page, test);
      const game = (await columnValues(page, "Game Name"))[0];
      await selectOption(page, "gameName", game);
      await search(page);

      const { payload } = await exportAndCheck(page);
      expect(payload.filters.gameIds).toHaveLength(1);
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
    });
  });

  // ===== 11. Ghi nhớ filter =====
  test("Filter được ghi nhớ sau khi reload trang", async ({ page }) => {
    await ensureData(page, test);
    const game = (await columnValues(page, "Game Name"))[0];
    await pickDatePreset(page, "Last 7 Days");
    const range = await dateRangeInput(page).inputValue();
    await selectOption(page, "gameName", game);
    await search(page);

    await openPage(page); // reload
    expect(await selectedTitles(page, "gameName")).toEqual([game]);
    await expect(dateRangeInput(page)).toHaveValue(range);
  });
});
