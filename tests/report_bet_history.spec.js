// Báo cáo > Bet History  (https://dev-bo.royaledge.io/report/bet-history)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/report_bet_history.spec.js --project=setup --project=chromium
//
// Các test chỉ ĐỌC dữ liệu, riêng test Export sẽ tạo 1 bản ghi ở Download History.
// Không hard-code dữ liệu (player, game, round...) - mọi giá trị đều lấy từ chính dòng đầu tiên
// của báo cáo để test không phụ thuộc vào data trên môi trường dev.
const { test, expect } = require("@playwright/test");

const URL = "/report/bet-history";
const SETTLED_API = "bet_history/settled";
const DETAILS_API = "bet_history/details-report";

const ALL_COLUMNS = [
  "Round ID",
  "Feature Instance ID",
  "Bet ID",
  "Parent Bet ID",
  "Player Name",
  "Game Name",
  "Game Code",
  "Game Category",
  "Bet Time",
  "Settled Time",
  "Record Type",
  "Operator Status",
  "Bet Type",
  "Sweepstake",
  "Misc",
  "Bet Amount",
  "Win Amount",
  "Win/Loss",
  "Jackpot Amount",
  "Turnover",
  "Effective Turnover",
  "Currency",
  "Details",
  "House",
  "Master Agent",
  "Agent",
];

// Label (đúng như hiển thị) -> id của input trong filter bar
const FILTER_IDS = {
  "Timezone*": "timezoneId",
  "Record Scope*": "recordScope",
  "Settled Time": "settledTime_0",
  "Bet Time": "betTime_0",
  House: "houseIds",
  "Master Agent": "masterAgentIds",
  Agent: "agentIds",
  "Player Name": "playerName",
  "Game Category": "gameCategoryIds",
  Game: "gameIds",
  "Round ID": "roundId",
  "Bet ID": "betId",
  Currency: "currencyIds",
  "Record Type": "statuses",
  "Operator Status": "operatorStatuses",
  "Bet Type": "resultTypes",
  Misc: "subTypes",
  Sweepstake: "isSweeps",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const isSettled = (r) => r.url().includes(SETTLED_API);
const isDetails = (r) => r.url().includes(DETAILS_API);

const rows = (page) => page.locator(".ant-table-tbody tr.ant-table-row");
const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const pageTitle = (page) =>
  page.getByRole("navigation").getByText("Bet History Report");
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const filterToggle = (page) =>
  page.locator(".NextGen-list-layout__filter-control__filter-btn");
const exportBtn = (page) => page.locator("button.NextGen-export-button");
const columnBtn = (page) =>
  page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");

// Phần tử bao 1 filter (theo id của input bên trong)
const filterEl = (page, id) =>
  page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
}

// Mở màn hình và chờ lần load đầu tiên (default filter) xong
async function openPage(page) {
  const firstLoad = page.waitForResponse(isSettled);
  await page.goto(URL);
  if (page.url().includes("/login")) {
    throw new Error(
      "Bị chuyển về /login: session trong playwright/.auth/session.txt đã hết hạn - copy lại localStorage từ DevTools.",
    );
  }
  await firstLoad;
  await waitTableIdle(page);
  await expect(page.locator(".NextGen-filter-bar")).toBeVisible();
}

// Bấm Search, trả về { body: request body (object), status } của lần gọi bet_history/settled
async function search(page) {
  const [req, res] = await Promise.all([
    page.waitForRequest(isSettled),
    page.waitForResponse(isSettled),
    searchBtn(page).click(),
  ]);
  await waitTableIdle(page);
  return { body: JSON.parse(req.postData()), status: res.status() };
}

// Thực hiện 1 hành động làm bảng gọi lại API (đổi trang, sort...) rồi trả về request body
async function reloadBy(page, action) {
  const [req] = await Promise.all([
    page.waitForRequest(isSettled),
    page.waitForResponse(isSettled),
    action(),
  ]);
  await waitTableIdle(page);
  return JSON.parse(req.postData());
}

async function headers(page) {
  return (await page.locator(".ant-table-thead th").allInnerTexts()).map((t) =>
    t.trim(),
  );
}

// Lấy toàn bộ giá trị của 1 cột (theo tên header) ở trang hiện tại
async function columnValues(page, name) {
  const idx = (await headers(page)).indexOf(name);
  expect(idx, `Không thấy cột "${name}"`).toBeGreaterThanOrEqual(0);
  return rows(page).evaluateAll(
    (trs, i) => trs.map((tr) => tr.children[i].innerText.trim()),
    idx,
  );
}

const num = (s) => parseFloat(String(s).replace(/,/g, ""));

// Nhập text vào filter dạng input (input bị ẩn cho tới khi click vào label)
async function fillFilter(page, id, label, value) {
  await filterEl(page, id).locator("label").first().click();
  await page.locator(`#${id}`).fill(value);
}

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
// KHÔNG click giữa ô: với dropdown chọn nhiều, vị trí đó có thể rơi vào nút (x) của chip đã chọn
// -> bấm vào sẽ XOÁ giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (theo title) của filter dạng dropdown, rồi đóng dropdown
async function selectOption(page, id, title) {
  await openDropdown(page, id);
  await page
    .locator(
      `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${title}"]`,
    )
    .click();
  // Click ra ngoài để đóng dropdown (Esc không đóng được dropdown chọn nhiều; để mở thì lần click sau sẽ mất giá trị đang chọn)
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
  const titles = await opts.evaluateAll((els) =>
    els.map((e) => e.getAttribute("title")),
  );
  // Click ra ngoài để đóng dropdown (Esc không đóng được dropdown chọn nhiều; để mở thì lần click sau sẽ mất giá trị đang chọn)
  await pageTitle(page).click();
  await expect(
    page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option"),
  ).toHaveCount(0);
  return titles;
}

// Chọn preset ngày (Today / Yesterday / Last 7 Days ...) cho Settled Time hoặc Bet Time
async function pickDatePreset(page, id, preset) {
  await filterEl(page, id).locator("label").first().click();
  // Popup của picker đang mở luôn được append SAU cùng trong DOM -> .last()
  await page
    .locator(".NextGen-datetime-preset__item")
    .filter({ hasText: preset })
    .last()
    .click();
  // Popup không tự đóng: click ra ngoài (tiêu đề trang) để đóng
  await pageTitle(page).click();
}

const dateInput = (page, id) =>
  filterEl(page, id).locator(".NextGen-filter-datetime-picker__control input").first();

// "05-11-2026 00:00:00 - 05-11-2026 23:59:59" -> { from: "2026-11-05 00:00:00", to: "2026-11-05 23:59:59" }
function parseRange(text) {
  const conv = (s) => {
    const m = s.trim().match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}:\d{2}:\d{2})$/);
    return `${m[3]}-${m[2]}-${m[1]} ${m[4]}`;
  };
  const [from, to] = text.split(" - ");
  return { from: conv(from), to: conv(to) };
}

// Đảm bảo bảng có dữ liệu để test: mặc định Settled Time = Today nên có thể trống
// (không có bet nào trong ngày). Khi đó mở rộng sang "Last 30 Days"; nếu vẫn trống thì skip.
async function ensureData(page, test) {
  if ((await rows(page).count()) > 0) return;
  await pickDatePreset(page, "settledTime_0", "Last 30 Days");
  await search(page);
  if ((await rows(page).count()) === 0) {
    test.skip(true, "Không có bản ghi nào trong 30 ngày gần nhất để test");
  }
}

// Xoá giá trị Settled Time / Bet Time bằng nút (x) (chỉ hiện khi hover nên dùng force)
async function clearDate(page, id) {
  await filterEl(page, id).locator('[aria-label="close-circle"]').click({ force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Report > Bet History", () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, đủ 18 filter và 2 nút Search/Reset", async ({ page }) => {
      await expect(pageTitle(page)).toBeVisible();

      const labels = await page
        .locator(".NextGen-filter-bar__items > .NextGen-filter-element label")
        .allInnerTexts();
      expect(labels.map((l) => l.trim())).toEqual(Object.keys(FILTER_IDS));

      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định đúng", async ({ page }) => {
      // Timezone, Record Scope là field bắt buộc nên luôn có giá trị mặc định
      await expect(
        filterEl(page, "timezoneId").locator(".ant-select-selection-item"),
      ).toHaveCount(1);
      await expect(
        filterEl(page, "recordScope").locator(".ant-select-selection-item"),
      ).toHaveText("All Record");

      // Settled Time mặc định = cả ngày hôm nay, Bet Time rỗng
      const { from, to } = parseRange(await dateInput(page, "settledTime_0").inputValue());
      expect(from.slice(0, 10)).toBe(to.slice(0, 10));
      expect(from.slice(11)).toBe("00:00:00");
      expect(to.slice(11)).toBe("23:59:59");
      await expect(dateInput(page, "betTime_0")).toHaveValue("");

      // Các filter còn lại phải rỗng
      for (const id of [
        "houseIds",
        "masterAgentIds",
        "agentIds",
        "gameCategoryIds",
        "gameIds",
        "currencyIds",
        "statuses",
        "operatorStatuses",
        "resultTypes",
        "subTypes",
        "isSweeps",
      ]) {
        await expect(
          filterEl(page, id).locator(".ant-select-selection-item"),
          `filter #${id} phải rỗng`,
        ).toHaveCount(0);
      }
      for (const id of ["playerName", "roundId", "betId"]) {
        await expect(page.locator(`#${id}`)).toHaveValue("");
      }
    });

    test("Bảng có đủ 26 cột đúng thứ tự và các nút Export / Manage Columns", async ({
      page,
    }) => {
      expect(await headers(page)).toEqual(ALL_COLUMNS);
      await expect(exportBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
    });

    test("Mặc định sắp xếp Settled Time giảm dần, 10 dòng / trang", async ({ page }) => {
      await ensureData(page, test);
      await expect(summary(page)).toHaveText(/^Showing 1 - (10|\d) of /);
      expect(await rows(page).count()).toBeLessThanOrEqual(10);

      const settled = await columnValues(page, "Settled Time");
      expect(settled.length).toBeGreaterThan(0);
      expect(settled).toEqual([...settled].sort().reverse());
    });

    test("Icon (i) hiển thị hướng dẫn sử dụng filter", async ({ page }) => {
      await page.locator(".tooltip-remark__icon").first().hover();
      const tip = page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");
      await expect(tip).toContainText("Timezone is a mandatory field");
      await expect(tip).toContainText("Bet Time/Settled Time or Round ID/Bet ID");
    });

    test("Tooltip của cột Effective Turnover giải thích công thức", async ({ page }) => {
      await page
        .locator(".ant-table-thead th", { hasText: "Effective Turnover" })
        .locator('[aria-label="info-circle"]')
        .hover();
      await expect(page.locator(".ant-tooltip:not(.ant-tooltip-hidden)")).toContainText(
        "Effective Turnover = Turnover * Effective Turnover Rate (%)",
      );
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
    test("Định dạng và tính nhất quán số liệu từng dòng", async ({ page }) => {
      await ensureData(page, test);
      const get = async (c) => columnValues(page, c);
      const [bet, win, winLoss, jackpot, turnover, betTime, settledTime, currency, details] =
        await Promise.all(
          [
            "Bet Amount",
            "Win Amount",
            "Win/Loss",
            "Jackpot Amount",
            "Turnover",
            "Bet Time",
            "Settled Time",
            "Currency",
            "Details",
          ].map(get),
        );

      expect(bet.length).toBeGreaterThan(0);
      for (let i = 0; i < bet.length; i++) {
        // Số tiền hiển thị 4 chữ số thập phân (win/win-loss có thể kèm dấu +/-)
        for (const v of [bet[i], win[i], jackpot[i], turnover[i]]) {
          expect(v, `dòng ${i + 1}: "${v}"`).toMatch(/^[+-]?[\d,]+\.\d{4}$/);
        }
        expect(winLoss[i]).toMatch(/^[+-]?[\d,]+\.\d{4}$/);

        // Win/Loss = Win Amount - Bet Amount
        expect(num(winLoss[i])).toBeCloseTo(num(win[i]) - num(bet[i]), 3);

        // Thời gian có dạng yyyy-MM-dd HH:mm:ss.SSS và settled >= bet
        expect(betTime[i]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
        expect(settledTime[i]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
        expect(settledTime[i] >= betTime[i]).toBe(true);

        expect(currency[i]).not.toBe("");
        expect(details[i]).toBe("View Details");
      }
    });

    test("Mỗi dòng có đủ House / Master Agent / Agent", async ({ page }) => {
      await ensureData(page, test);
      for (const col of ["House", "Master Agent", "Agent", "Player Name", "Game Name"]) {
        const values = await columnValues(page, col);
        for (const v of values) expect(v, `cột ${col} bị rỗng`).not.toBe("");
      }
    });
  });

  // ===== 3. Search & các filter =====
  test.describe("Search / Filter", () => {
    test("Search mặc định gửi đúng request (timezone, settledTime, phân trang, sort)", async ({
      page,
    }) => {
      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "SettledTime", sortDirection: "desc" });
      expect(body.filters.timezoneId).toEqual(expect.any(Number));
      expect(body.filters.settledTime).toHaveLength(2);
      expect(body.filters.betTime).toBeUndefined();
    });

    test("Tìm theo Player Name", async ({ page }) => {
      await ensureData(page, test);
      const player = (await columnValues(page, "Player Name"))[0];
      await fillFilter(page, "playerName", "Player Name", player);
      const { body } = await search(page);
      expect(body.filters.playerName).toBe(player);

      const players = await columnValues(page, "Player Name");
      expect(players.length).toBeGreaterThan(0);
      for (const p of players) expect(p.toLowerCase()).toContain(player.toLowerCase());
    });

    test("Tìm theo Round ID", async ({ page }) => {
      await ensureData(page, test);
      const roundId = (await columnValues(page, "Round ID"))[0];
      await fillFilter(page, "roundId", "Round ID", roundId);
      const { body } = await search(page);
      expect(body.filters.roundId).toBe(roundId);

      const ids = await columnValues(page, "Round ID");
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(id).toBe(roundId);
    });

    test("Tìm theo Bet ID trả về đúng 1 bản ghi", async ({ page }) => {
      await ensureData(page, test);
      const betId = (await columnValues(page, "Bet ID"))[0];
      await fillFilter(page, "betId", "Bet ID", betId);
      const { body } = await search(page);
      expect(body.filters.betId).toBe(betId);

      expect(await columnValues(page, "Bet ID")).toEqual([betId]);
      await expect(summary(page)).toHaveText(/of 1 records$/);
    });

    test("Không có kết quả -> hiển thị 'There are no entries found'", async ({ page }) => {
      await fillFilter(page, "playerName", "Player Name", "no_such_player_zzz_999");
      await search(page);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText("There are no entries found")).toBeVisible();
      await expect(summary(page)).toHaveText("Showing 0 - 0 of 0 records");
    });

    test("Thiếu cả Settled Time và Bet Time -> báo lỗi, không gọi API", async ({ page }) => {
      await clearDate(page, "settledTime_0");
      await expect(dateInput(page, "settledTime_0")).toHaveValue("");

      let called = false;
      page.on("request", (r) => {
        if (isSettled(r)) called = true;
      });
      await searchBtn(page).click();

      await expect(
        page.getByText("Please select either Bet Time or Settle Time to proceed."),
      ).toBeVisible();
      expect(called).toBe(false);
    });

    // Bắt buộc phải có Settled Time hoặc Bet Time: chỉ nhập Round ID / Bet ID mà không có ngày
    // thì phải bị chặn bằng toast và KHÔNG gọi API.
    for (const [label, id] of [
      ["Round ID", "roundId"],
      ["Bet ID", "betId"],
    ]) {
      test(`Chỉ nhập ${label} (không có ngày) -> báo lỗi, không gọi API`, async ({ page }) => {
        await clearDate(page, "settledTime_0");
        await expect(dateInput(page, "settledTime_0")).toHaveValue("");
        await fillFilter(page, id, label, "123456789");

        let called = false;
        page.on("request", (r) => {
          if (isSettled(r)) called = true;
        });
        await searchBtn(page).click();

        await expect(
          page.getByText("Please select either Bet Time or Settle Time to proceed."),
        ).toBeVisible();
        expect(called).toBe(false);
      });
    }

    test("Record Scope = External Party Only", async ({ page }) => {
      await selectOption(page, "recordScope", "External Party Only");
      await expect(
        filterEl(page, "recordScope").locator(".ant-select-selection-item"),
      ).toHaveText("External Party Only");
      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body.filters.recordScope).not.toBe(-1); // -1 = All Record
    });

    test("Đổi Timezone gửi timezoneId mới", async ({ page }) => {
      const before = (await search(page)).body.filters.timezoneId;
      await openDropdown(page, "timezoneId");
      const opts = page.locator(
        ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
      );
      await opts.first().waitFor();
      const count = await opts.count();
      expect(count).toBeGreaterThan(1);
      // Chọn option đầu tiên khác option đang chọn
      await opts.filter({ hasNot: page.locator(".ant-select-item-option-selected") }).first().click();

      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body.filters.timezoneId).not.toBe(before);
    });

    // Các filter dropdown tĩnh: option phải đúng và mỗi option lọc ra đúng dữ liệu
    const STATIC_DROPDOWNS = [
      { label: "Record Scope", id: "recordScope", options: ["All Record", "External Party Only"] },
      { label: "Record Type", id: "statuses", options: ["Bet", "Settled", "Cancelled", "Refunded"] },
      {
        label: "Operator Status",
        id: "operatorStatuses",
        options: [
          "Success",
          "Game Under Maintenance",
          "Fail",
          "Invalid token",
          "Invalid Request",
          "Game does not exist",
          "Invalid Player",
          "Player is inactive",
          "HTTP Request Exception",
          "Bet Failed",
          "Insufficient balance",
          "General Failure",
        ],
      },
      {
        label: "Bet Type",
        id: "resultTypes",
        options: [
          "Freespin",
          "Normal",
          "Progressive",
          "Bonus",
          "Bonus A",
          "Bonus B",
          "Ante Bet",
          "Premium Reel",
          "Normal FS Ext",
          "Bonus A FS Ext",
          "Ante Bet FS Ext",
          "Premium Reel FS Ext",
          "Unknown Result Type",
        ],
      },
      {
        label: "Misc",
        id: "subTypes",
        options: [
          "N/A",
          "Won Free Spin",
          "ReSpin",
          "Hold and Spin",
          "Lucky Spin",
          "Buy Bonus A",
          "Buy Bonus B",
          "FreeSpin",
          "Premium Reel",
          "Normal Free Spin Extension",
          "Bonus Extension",
          "Ante Extension",
          "Premium Reel Extension",
          "Buy Extension",
          "Decline Extension",
          "Free Spin Won Free Spin",
          "Won Free Spin and Respin",
        ],
      },
      { label: "Sweepstake", id: "isSweeps", options: ["Yes", "No"] },
    ];
    for (const { label, id, options } of STATIC_DROPDOWNS) {
      test(`Dropdown ${label} có đủ option`, async ({ page }) => {
        expect(await dropdownOptions(page, id)).toEqual(options);
      });
    }

    // Các dropdown lấy option từ API: chỉ cần có dữ liệu
    for (const [label, id] of [
      ["House", "houseIds"],
      ["Master Agent", "masterAgentIds"],
      ["Agent", "agentIds"],
      ["Game Category", "gameCategoryIds"],
      ["Game", "gameIds"],
      ["Currency", "currencyIds"],
    ]) {
      test(`Dropdown ${label} load được danh sách option`, async ({ page }) => {
        expect((await dropdownOptions(page, id)).length).toBeGreaterThan(0);
      });
    }

    // Lọc theo từng dropdown -> mọi dòng trả về phải khớp giá trị đã chọn.
    // Lấy khoảng "Last 30 Days" để chắc chắn có dữ liệu.
    const FILTER_CASES = [
      { id: "statuses", option: "Settled", column: "Record Type" },
      { id: "resultTypes", option: "Normal", column: "Bet Type" },
      { id: "isSweeps", option: "No", column: "Sweepstake" },
      { id: "operatorStatuses", option: "Success", column: "Operator Status" },
      { id: "gameCategoryIds", option: "Slots", column: "Game Category" },
    ];
    for (const { id, option, column } of FILTER_CASES) {
      test(`Lọc ${column} = ${option}`, async ({ page }) => {
        await pickDatePreset(page, "settledTime_0", "Last 30 Days");
        await selectOption(page, id, option);
        const { body, status } = await search(page);

        expect(status).toBe(200);
        expect(body.filters[id]).toHaveLength(1);
        const values = await columnValues(page, column);
        expect(values.length, `không có dòng nào với ${column}=${option}`).toBeGreaterThan(0);
        for (const v of values) expect(v).toBe(option);
      });
    }

    test("Dropdown cho phép chọn nhiều giá trị (Record Type = Bet + Settled)", async ({ page }) => {
      await pickDatePreset(page, "settledTime_0", "Last 30 Days");
      await selectOption(page, "statuses", "Settled");
      await selectOption(page, "statuses", "Bet");
      const { body } = await search(page);
      expect(body.filters.statuses).toHaveLength(2);
      for (const v of await columnValues(page, "Record Type")) {
        expect(["Bet", "Settled"]).toContain(v);
      }
    });

    test("Kết hợp nhiều filter cùng lúc (AND)", async ({ page }) => {
      await pickDatePreset(page, "settledTime_0", "Last 30 Days");
      await selectOption(page, "statuses", "Settled");
      await selectOption(page, "isSweeps", "No");
      const { body } = await search(page);
      expect(body.filters.statuses).toHaveLength(1);
      expect(body.filters.isSweeps).toHaveLength(1);

      for (const v of await columnValues(page, "Record Type")) expect(v).toBe("Settled");
      for (const v of await columnValues(page, "Sweepstake")) expect(v).toBe("No");
    });

    test("Nút (x) của Settled Time xoá giá trị", async ({ page }) => {
      await expect(dateInput(page, "settledTime_0")).not.toHaveValue("");
      await clearDate(page, "settledTime_0");
      await expect(dateInput(page, "settledTime_0")).toHaveValue("");
    });
  });

  // ===== 4. Bộ lọc thời gian =====
  test.describe("Settled Time / Bet Time", () => {
    test("Bet Time có đủ các preset", async ({ page }) => {
      await filterEl(page, "betTime_0").locator("label").first().click();
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

    test("Bet Time = Yesterday: input, request và dữ liệu đều trong khoảng đã chọn", async ({
      page,
    }) => {
      await clearDate(page, "settledTime_0");
      await pickDatePreset(page, "betTime_0", "Yesterday");

      const value = await dateInput(page, "betTime_0").inputValue();
      const { from, to } = parseRange(value);
      expect(from.slice(0, 10)).toBe(to.slice(0, 10));
      expect(from.slice(11)).toBe("00:00:00");
      expect(to.slice(11)).toBe("23:59:59");

      const { body } = await search(page);
      expect(body.filters.betTime).toHaveLength(2);
      expect(body.filters.settledTime).toBeUndefined();

      const betTimes = await columnValues(page, "Bet Time");
      for (const t of betTimes) {
        expect(t >= from, `${t} < ${from}`).toBe(true);
        expect(t <= `${to}.999`, `${t} > ${to}`).toBe(true);
      }
    });

    test("Settled Time = Last 7 Days: dữ liệu nằm trong khoảng đã chọn", async ({ page }) => {
      await pickDatePreset(page, "settledTime_0", "Last 7 Days");
      const { from, to } = parseRange(await dateInput(page, "settledTime_0").inputValue());
      expect(from < to).toBe(true);

      await search(page);
      const settled = await columnValues(page, "Settled Time");
      expect(settled.length).toBeGreaterThan(0);
      for (const t of settled) {
        expect(t >= from, `${t} < ${from}`).toBe(true);
        expect(t <= `${to}.999`, `${t} > ${to}`).toBe(true);
      }
    });
  });

  // ===== 5. Reset =====
  test("Reset đưa toàn bộ filter về mặc định", async ({ page }) => {
    // Đổi nhiều loại filter khác nhau
    await pickDatePreset(page, "settledTime_0", "Last 7 Days");
    await pickDatePreset(page, "betTime_0", "Today");
    await selectOption(page, "recordScope", "External Party Only");
    await selectOption(page, "statuses", "Settled");
    await selectOption(page, "resultTypes", "Normal");
    await selectOption(page, "isSweeps", "No");
    await fillFilter(page, "playerName", "Player Name", "abc");
    await fillFilter(page, "roundId", "Round ID", "11");
    await fillFilter(page, "betId", "Bet ID", "12");

    await resetBtn(page).click();
    await waitTableIdle(page);

    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    // Settled Time mặc định = ngày hiện tại (cả ngày) - lấy ngày từ chính input để khỏi lệch múi giờ
    const { from, to } = parseRange(await dateInput(page, "settledTime_0").inputValue());
    expect(from.slice(0, 10)).toBe(to.slice(0, 10));
    expect(from.slice(11)).toBe("00:00:00");
    expect(to.slice(11)).toBe("23:59:59");
    // (chỉ kiểm tra là ngày hợp lệ gần hôm nay, tránh lệch múi giờ giữa máy chạy test và timezone BO)
    const diffDays = Math.abs(
      (new Date(from.slice(0, 10)) - new Date(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`)) /
        86400000,
    );
    expect(diffDays).toBeLessThanOrEqual(1);

    await expect(dateInput(page, "betTime_0")).toHaveValue("");
    await expect(
      filterEl(page, "recordScope").locator(".ant-select-selection-item"),
    ).toHaveText("All Record");
    for (const id of ["statuses", "resultTypes", "isSweeps", "houseIds", "gameIds", "currencyIds"]) {
      await expect(
        filterEl(page, id).locator(".ant-select-selection-item"),
        `#${id} chưa được reset`,
      ).toHaveCount(0);
    }
    for (const id of ["playerName", "roundId", "betId"]) {
      await expect(page.locator(`#${id}`), `#${id} chưa được reset`).toHaveValue("");
    }
  });

  // ===== 6. Phân trang =====
  test.describe("Phân trang", () => {
    test.beforeEach(async ({ page }) => {
      // Cần > 20 bản ghi để test phân trang
      await pickDatePreset(page, "settledTime_0", "Last 30 Days");
      await search(page);
      const total = num(
        (await summary(page).innerText()).match(/of ([\d,]+) records/)[1],
      );
      test.skip(total <= 20, `Chỉ có ${total} bản ghi, không đủ để test phân trang`);
    });

    test("Chuyển sang trang 2 rồi quay lại trang 1", async ({ page }) => {
      const page1 = await columnValues(page, "Bet ID");

      const body2 = await reloadBy(page, () =>
        page.getByRole("button", { name: "2", exact: true }).click(),
      );
      expect(body2.page).toBe(2);
      await expect(summary(page)).toHaveText(/^Showing 11 - 20 of /);
      const page2 = await columnValues(page, "Bet ID");
      expect(page2).not.toEqual(page1);

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
  test.describe("Sắp xếp", () => {
    for (const column of ["Bet Amount", "Win Amount", "Win/Loss"]) {
      test(`Sort cột ${column} tăng dần rồi giảm dần`, async ({ page }) => {
        await pickDatePreset(page, "settledTime_0", "Last 7 Days");
        await search(page);
        const th = page.locator(".ant-table-thead th", { hasText: column });

        const asc = await reloadBy(page, () => th.click());
        expect(asc.sortDirection).toBe("asc");
        expect(asc.sortBy).not.toBe("SettledTime");
        const ascValues = (await columnValues(page, column)).map(num);
        expect(ascValues).toEqual([...ascValues].sort((a, b) => a - b));

        const desc = await reloadBy(page, () => th.click());
        expect(desc.sortDirection).toBe("desc");
        expect(desc.sortBy).toBe(asc.sortBy);
        const descValues = (await columnValues(page, column)).map(num);
        expect(descValues).toEqual([...descValues].sort((a, b) => b - a));
      });
    }
  });

  // ===== 8. Manage Columns =====
  test.describe("Manage Columns", () => {
    // hasText dạng RegExp khớp CHÍNH XÁC tên cột (tránh "Bet ID" khớp luôn "Parent Bet ID")
    const item = (page, name) =>
      columnPopover(page).locator(".NextGen-popover-manage-column__list__items", {
        hasText: new RegExp(`^\s*${name}\s*$`),
      });

    test("Popover liệt kê đủ cột cùng nút Reset to Default / Save", async ({ page }) => {
      await columnBtn(page).click();
      await expect(columnPopover(page)).toContainText("Column Display");
      await expect(columnPopover(page).getByRole("button", { name: "Reset to Default" })).toBeVisible();
      await expect(columnPopover(page).getByRole("button", { name: "Save" })).toBeVisible();

      const names = await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items .ant-typography")
        .allInnerTexts();
      expect(names.map((n) => n.trim())).toEqual(ALL_COLUMNS);
    });

    test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Round ID").locator("label").click();
      expect(await headers(page)).not.toContain("Round ID");
      expect(await headers(page)).toHaveLength(ALL_COLUMNS.length - 1);

      await item(page, "Round ID").locator("label").click();
      expect(await headers(page)).toEqual(ALL_COLUMNS);
    });

    test("Save đóng popover và lưu cấu hình cột (giữ nguyên sau khi reload)", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Feature Instance ID").locator("label").click();
      await columnPopover(page).getByRole("button", { name: "Save" }).click();
      await expect(columnPopover(page)).toBeHidden();

      await openPage(page); // reload
      expect(await headers(page)).not.toContain("Feature Instance ID");
      expect(await headers(page)).toHaveLength(ALL_COLUMNS.length - 1);
    });

    test("Reset to Default khôi phục toàn bộ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Round ID").locator("label").click();
      await item(page, "Bet ID").locator("label").click();
      expect(await headers(page)).toHaveLength(ALL_COLUMNS.length - 2);

      await columnPopover(page).getByRole("button", { name: "Reset to Default" }).click();
      expect(await headers(page)).toEqual(ALL_COLUMNS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      const before = await columnValues(page, "Bet ID");
      await columnBtn(page).click();
      await item(page, "Round ID").locator("label").click();
      expect(await columnValues(page, "Bet ID")).toEqual(before);
    });
  });

  // ===== 9. View Details =====
  test.describe("View Details", () => {
    test("Mở modal Bet History Details và gọi API details-report đúng round", async ({
      page,
    }) => {
      await ensureData(page, test);
      const roundId = (await columnValues(page, "Round ID"))[0];

      const [req, res] = await Promise.all([
        page.waitForRequest(isDetails),
        page.waitForResponse(isDetails),
        rows(page).first().getByRole("button", { name: "View Details" }).click(),
      ]);
      expect(res.status()).toBe(200);
      expect(JSON.parse(req.postData()).round_id).toBe(roundId);

      const modal = page.locator(".ant-modal").last();
      await expect(modal).toContainText("Bet History Details");

      await modal.locator(".ant-modal-close").click();
      await expect(page.locator(".ant-modal:visible")).toHaveCount(0);
    });

    // Chỉ bản ghi có lịch sử chơi (game result) thì modal mới có nội dung; bản ghi game chưa có người chơi / chưa có lịch sử
    // thì thân modal rỗng (API vẫn trả 200) -> KHÔNG phải lỗi. Vì vậy test không cố định dòng đầu mà thử mỗi game 1 dòng
    // (100 dòng / trang) cho tới khi gặp dòng modal có nội dung; không có dòng nào thì skip.
    test("Modal hiển thị nội dung chi tiết của round (bản ghi có lịch sử chơi)", async ({ page }) => {
      test.setTimeout(120000);
      await ensureData(page, test);
      await page.locator(".ant-pagination-options .ant-select").click();
      await reloadBy(page, () =>
        page
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option", { hasText: "100 / page" })
          .click(),
      );
      const roundIds = await columnValues(page, "Round ID");
      const games = await columnValues(page, "Game Name");
      const body = page.locator(".ant-modal").last().locator(".ant-modal-body");
      const tried = new Set();
      for (let i = 0; i < roundIds.length && tried.size < 8; i++) {
        if (tried.has(games[i])) continue;
        tried.add(games[i]);
        await rows(page).nth(i).getByRole("button", { name: "View Details" }).click();
        const hasContent = await expect(body).not.toBeEmpty({ timeout: 4000 }).then(() => true, () => false);
        if (hasContent) {
          await expect(body).toContainText(roundIds[i]);
          return;
        }
        await page.locator(".ant-modal").last().locator(".ant-modal-close").click();
        await expect(page.locator(".ant-modal:visible")).toHaveCount(0);
      }
      test.skip(true, `Không có bản ghi có lịch sử chơi trong ${tried.size} game đầu của trang (modal rỗng với mọi game đã thử)`);
    });
  });

  // ===== 10. Export =====
  test.describe("Export", () => {
    test("Export tạo job tải xuống với đúng filter hiện tại", async ({ page }) => {
      await ensureData(page, test);
      const player = (await columnValues(page, "Player Name"))[0];
      await fillFilter(page, "playerName", "Player Name", player);
      await search(page);

      const [req] = await Promise.all([
        page.waitForRequest((r) => r.url().endsWith("/download") && r.method() === "POST"),
        exportBtn(page).click(),
      ]);
      const body = JSON.parse(req.postData());
      expect(body.module).toBe("REPORTS");
      expect(body.section).toBe("REPORTS_BET_HISTORY");

      const payload = JSON.parse(body.payload);
      expect(payload.filters.playerName).toBe(player);

      // 2 kết quả hợp lệ tuỳ việc file cùng filter đã được export trước đó hay chưa:
      //  - Lần đầu: toast "Download is processing. Please check ID:xxx in download history"
      //  - Đã có file cũ: hộp thoại "already exist in download history ... Download Now / Download New".
      //    Test KHÔNG bấm Download New (sẽ xoá file cũ trong Download History), chỉ kiểm tra rồi đóng.
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
    });

    test("Export chỉ chứa các cột đang hiển thị", async ({ page }) => {
      await columnBtn(page).click();
      await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items", { hasText: "Round ID" })
        .locator("label")
        .click();

      const [req] = await Promise.all([
        page.waitForRequest((r) => r.url().endsWith("/download") && r.method() === "POST"),
        exportBtn(page).click(),
      ]);
      const payload = JSON.parse(JSON.parse(req.postData()).payload);
      expect(payload.filters.fields).not.toContain("Round ID");
      expect(payload.filters.fields).toContain("Bet ID");
    });
  });

  // ===== 11. Ghi nhớ filter =====
  test("Filter được ghi nhớ sau khi reload trang", async ({ page }) => {
    await ensureData(page, test);
    const player = (await columnValues(page, "Player Name"))[0];
    await fillFilter(page, "playerName", "Player Name", player);
    await selectOption(page, "statuses", "Settled");
    await search(page);

    await openPage(page); // reload
    await expect(page.locator("#playerName")).toHaveValue(player);
    await expect(
      filterEl(page, "statuses").locator(".ant-select-selection-item").first(),
    ).toHaveText("Settled");
  });
});
