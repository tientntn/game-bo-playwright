// Báo cáo > Player Segmentation  (https://dev-bo.royaledge.io/report/segmentation-player)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/report_segmentation_player.spec.js --project=setup --project=chromium
//
// Màn hình KHÁC các báo cáo khác: không có bảng phân trang mà là 3 tab dạng "ma trận phân khúc người chơi":
//  - Spending Power    : Bet Size (Low / Medium / High / VIP-Whale)  x  Bet Frequency (Low / Medium / High)
//  - Spending Behavior : CPN (số game người chơi chơi) x Bet Frequency
//  - Profile Category  : 7 nhóm hồ sơ người chơi + số lượng
// Mỗi ô của ma trận là tỷ lệ % người chơi. Ngưỡng của các nhóm do người dùng tự đặt ở hộp thoại "Customize Table".
//
// Quy trình tìm kiếm: chọn đủ filter bắt buộc (Settled Time, Currency, Agent) + điền "Customize Table" (Bet Size bắt buộc)
// rồi bấm Search / Save. API chỉ được gọi khi đủ điều kiện và chỉ gọi API của tab đang mở.
//
// Các test chỉ ĐỌC dữ liệu. "Save" ở Customize Table chỉ lưu ngưỡng trên trình duyệt (không ghi lên server).
//
// Dữ liệu mẫu (Currency + Agent có người chơi) cấu hình được bằng biến môi trường:
//   SEG_CURRENCY (mặc định "TKN"), SEG_AGENT (mặc định "Royal Edge TKN")
// Nếu tổ hợp này không có dữ liệu thì các test cần dữ liệu sẽ bị skip.
const { test, expect } = require("@playwright/test");

const URL = "/report/segmentation-player";
const CURRENCY = process.env.SEG_CURRENCY || "TKN";
const AGENT = process.env.SEG_AGENT || "Royal Edge TKN";

// Ngưỡng mặc định dùng trong test (Bet Size mặc định của màn hình là TRỐNG nên phải tự điền)
const DEFAULT_CUSTOM = {
  betSizeMediumMin: "10",
  betSizeHighMin: "100",
  betSizeVipMin: "1000",
  betFreqMediumMin: "100",
  betFreqHighMin: "500",
  cpnMediumMin: "1",
  cpnHighMin: "4",
};
// Giá trị mặc định có sẵn trong modal (Bet Size để trống)
const MODAL_DEFAULTS = {
  betSizeLowMax: "",
  betSizeMediumMin: "",
  betSizeHighMin: "",
  betSizeVipMin: "",
  betFreqLowMax: "100",
  betFreqMediumMin: "100",
  betFreqHighMin: "500",
  cpnLowMax: "1",
  cpnMediumMin: "1",
  cpnHighMin: "4",
};

const TABS = ["Spending Power", "Spending Behavior", "Profile Category"];

// Thứ tự hàng / cột của ma trận (khớp với tên field API)
const BET_SIZES = ["low", "medium", "high", "vip-whale"];
const FREQUENCIES = ["low", "medium", "high"];
const CPNS = ["low", "medium", "high"];

// 7 nhóm Profile Category theo thứ tự hiển thị: [key API, tên hiển thị]
const PROFILE_CATEGORIES = [
  ["core_loyalist", "Core Loyalist"],
  ["loyalist_with_variety", "Loyalist with Variety"],
  ["balanced_explorer", "Balanced Explorer"],
  ["dual_specialist", "Dual Specialist"],
  ["emerging_shifter", "Emerging Shifter"],
  ["mixed_opportunist", "Mixed Opportunist"],
  ["unclassified_edge", "Unclassified/Edge"],
];

// Mô tả cố định của từng ô ma trận [hàng][cột]
const POWER_TEXT = [
  [
    "Casuals - Small bets, occasional play",
    "Light Regulars - Steady but small spend",
    "Grinders - Low bets, high volume",
  ],
  [
    "Occasional Regulars - Mid bets, infrequent",
    "Regulars - Steady backbone of play",
    "Core Actives - Mid bets, very engaged",
  ],
  [
    "Snipers - Big bets, few sessions",
    "High Regulars - Strong, reliable spenders",
    "Heavy Hitters - High bets, very engaged",
  ],
  [
    "Snipers+ - Very high stakes, rare play",
    "VIPs - High stakes, regular play",
    "Whales - Top revenue drivers, constant high stakes",
  ],
];
const BEHAVIOR_TEXT = [
  [
    "Occasional Dippers - Try one game, very low engagement",
    "Loyal Regulars - Player one favourite consistently",
    "Grinders - High-volume play on one game (risk of overexposure)",
  ],
  [
    "Samplers - Try 2-3 games rarely",
    "Multi Game Regulars - Healthy engagement, moderate retention",
    "Focused Enthusiasts - Cycle between 2-3 games often, strong retention",
  ],
  [
    "Explorers - Browse widely, but rarely commit",
    "Cross-Players - Balanced play across multiple games",
    "Super Engages - Heavy play across many games (VIP candidates, resilient spenders)",
  ],
];

const DATETIME = /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const apiIs = (name) => (r) =>
  reqOf(r).method() === "POST" && reqOf(r).url().endsWith(`/summary/player-segment/${name}`);
const isPower = apiIs("spending-power");
const isBehavior = apiIs("spending-behavior");
const isProfile = apiIs("profile-category");
const isAnySegment = (r) =>
  reqOf(r).method() === "POST" && /\/summary\/player-segment\//.test(reqOf(r).url());
const API_BY_TAB = {
  "Spending Power": isPower,
  "Spending Behavior": isBehavior,
  "Profile Category": isProfile,
};

const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const customizeBtn = (page) => page.getByRole("button", { name: /Customize Table/ });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const tabBtn = (page, name) =>
  page.locator("label.ant-radio-button-wrapper").filter({ hasText: exact(name) });
const mainTable = (page) => page.locator(".ant-table").first();
const toast = (page, text) => page.locator(".Toastify__toast").filter({ hasText: text }).first();

// Hộp thoại Customize Table (có các input #betSize...) và hộp thoại nhắc điền Customize Table
const customizeModal = (page) =>
  page.locator(".ant-modal-content").filter({ has: page.locator("#betSizeMediumMin") });
const requiredDialog = (page) =>
  page.locator(".ant-modal-content").filter({ hasText: "Please fill in all required fields in Customize Table" });

// Phần tử bao 1 filter (theo id của input bên trong)
const filterEl = (page, id) =>
  page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
const dateRangeInput = (page) => page.locator("#settledTime_dateRange");

const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
const exact = (name, flags = "") =>
  new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, flags);
// "09-11-2026 ..." -> Date (UTC, chỉ lấy phần ngày)
function parseDay(s) {
  const [d, m, y] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const diffDays = (a, b) => Math.round((a - b) / 86400000);
// Date -> "dd-MM-yyyy 00:00:00"
function dayStart(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(date.getUTCDate())}-${p(date.getUTCMonth() + 1)}-${date.getUTCFullYear()} 00:00:00`;
}
const nextDayStart = (s) => dayStart(new Date(parseDay(s).getTime() + 86400000));

// Chờ spinner của antd biến mất
async function waitIdle(page) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
}

// Mở màn hình. Màn hình KHÔNG gọi API báo cáo khi mở (chỉ khi đã đủ filter) nên chờ thanh filter và các dropdown
async function openPage(page) {
  test.setTimeout(90000);
  await page.goto(URL);
  // Session hết hạn -> app chuyển về /login: báo lỗi rõ ràng thay vì chờ timeout
  const redirectedToLogin = page
    .waitForURL(/\/login/, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  const ready = expect(page.locator(".NextGen-filter-bar")).toBeVisible({ timeout: 60000 }).then(() => false);
  if (await Promise.race([ready, redirectedToLogin])) {
    throw new Error(
      "Bị chuyển về /login: session trong playwright/.auth/session.txt đã hết hạn (backend chỉ cho 1 session/tài khoản - đăng nhập ở nơi khác sẽ làm session này mất hiệu lực; token chỉ sống khoảng 1 giờ). Copy lại localStorage từ DevTools.",
    );
  }
  await expect(filterEl(page, "currencyId")).toBeVisible();
}

// Chọn option (theo tên) của filter dạng dropdown rồi đóng dropdown.
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

// Chọn preset ngày (Today / Yesterday / Last 7 Days ...) cho Settled Time
async function pickDatePreset(page, preset) {
  await filterEl(page, "settledTime_0").locator("label").first().click();
  // Popup của picker đang mở luôn được append SAU cùng trong DOM -> .last()
  await page.locator(".NextGen-datetime-preset__item").filter({ hasText: preset }).last().click();
  // Popup không tự đóng: click ra ngoài (tiêu đề trang) để đóng
  await breadcrumb(page).click();
}

// Xoá Settled Time bằng nút (x) (chỉ render khi rê chuột vào ô ngày)
async function clearDate(page) {
  await filterEl(page, "settledTime_0").hover();
  await filterEl(page, "settledTime_0").locator('[aria-label="close-circle"]').click({ force: true });
}

// Chọn đủ các filter bắt buộc: Settled Time (Last 90 Days) + Currency + Agent
async function fillRequiredFilters(page, { preset = "Last 90 Days" } = {}) {
  await pickDatePreset(page, preset);
  await selectOption(page, "currencyId", CURRENCY);
  await selectOption(page, "agentIds", AGENT);
}

// Điền các ô ngưỡng trong modal Customize Table (chỉ điền các ô được truyền vào)
async function fillCustomize(page, values) {
  const modal = customizeModal(page);
  for (const [id, value] of Object.entries(values)) {
    await modal.locator(`#${id}`).fill(value);
  }
}

// Đọc giá trị của toàn bộ các ô trong modal Customize Table
async function readCustomize(page) {
  return customizeModal(page)
    .locator("input")
    .evaluateAll((els) => Object.fromEntries(els.map((e) => [e.id, e.value])));
}

async function openCustomize(page) {
  await customizeBtn(page).click();
  await expect(customizeModal(page)).toBeVisible();
}

// Đóng modal Customize Table bằng Save và chờ API của tab đang mở (chỉ gọi khi đã đủ filter bắt buộc)
async function saveCustomize(page, api = isPower) {
  const [req, res] = await Promise.all([
    page.waitForRequest(api),
    page.waitForResponse(api),
    customizeModal(page).getByRole("button", { name: "Save" }).click(),
  ]);
  await expect(customizeModal(page)).toBeHidden();
  await waitIdle(page);
  return { body: JSON.parse(req.postData()), status: res.status(), json: await res.json() };
}

// Điền đủ filter + Customize Table rồi Save -> tải xong tab Spending Power
async function loadData(page, custom = DEFAULT_CUSTOM) {
  await fillRequiredFilters(page);
  await openCustomize(page);
  await fillCustomize(page, custom);
  return saveCustomize(page);
}

// Bấm Search và chờ API của tab chỉ định (mặc định tab đang mở là Spending Power)
async function search(page, api = isPower) {
  const [req, res] = await Promise.all([
    page.waitForRequest(api),
    page.waitForResponse(api),
    searchBtn(page).click(),
  ]);
  await waitIdle(page);
  return { body: JSON.parse(req.postData()), status: res.status(), json: await res.json() };
}

// Chuyển tab và chờ API tương ứng
async function openTab(page, name) {
  const [req, res] = await Promise.all([
    page.waitForRequest(API_BY_TAB[name]),
    page.waitForResponse(API_BY_TAB[name]),
    tabBtn(page, name).click(),
  ]);
  await waitIdle(page);
  return { body: JSON.parse(req.postData()), status: res.status(), json: await res.json() };
}

async function headers(page) {
  return (await mainTable(page).locator("thead th").allInnerTexts()).map((t) => t.trim());
}

// Đọc ma trận: [{ label, cells: [{ pct (số), text (mô tả) }] }] (bỏ qua hàng đo kích thước ẩn của antd)
async function readGrid(page) {
  return mainTable(page)
    .locator("tbody tr:not(.ant-table-measure-row)")
    .evaluateAll((trs) =>
      trs.map((tr) => {
        const cells = [...tr.children].map((c) =>
          c.innerText
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        return { label: (cells[0] || []).join(" "), cells: cells.slice(1) };
      }),
    );
}

// Nhãn mong đợi theo ngưỡng đã nhập
const powerRowLabels = (c) => [
  `Low (≤${c.betSizeMediumMin})`,
  `Medium (>${c.betSizeMediumMin})`,
  `High (>${c.betSizeHighMin})`,
  `VIP/Whale (>${c.betSizeVipMin})`,
];
const powerHeaders = (c) => [
  "Bet Size",
  `Low Frequency (≤${c.betFreqMediumMin})`,
  `Medium Frequency (>${c.betFreqMediumMin})`,
  `High Frequency (>${c.betFreqHighMin})`,
];
const behaviorHeaders = (c) => [
  "CPN / Frequency",
  `Low Frequency (<${c.betFreqMediumMin} bets per Game/Player)`,
  `Medium Frequency (${c.betFreqMediumMin}-${c.betFreqHighMin} bets per Game/Player)`,
  `High Frequency (>${c.betFreqHighMin} bets per Game/Player)`,
];
const behaviorRowLabels = (c) => [
  `Low CPN (${c.cpnMediumMin} ${Number(c.cpnMediumMin) === 1 ? "game" : "games"})`,
  `Medium CPN (${Number(c.cpnMediumMin) + 1}-${c.cpnHighMin} games)`,
  `High CPN (>${c.cpnHighMin} games)`,
];

// segmentFilters mong đợi trong request theo ngưỡng đã nhập
function expectedSegmentFilters(c) {
  return [
    {
      field: "betSize",
      details: [
        { name: "low", max: Number(c.betSizeMediumMin) },
        { name: "medium", min: Number(c.betSizeMediumMin) },
        { name: "high", min: Number(c.betSizeHighMin) },
        { name: "vip-whale", min: Number(c.betSizeVipMin) },
      ],
    },
    {
      field: "betFrequency",
      details: [
        { name: "low", max: Number(c.betFreqMediumMin) },
        { name: "medium", min: Number(c.betFreqMediumMin) },
        { name: "high", min: Number(c.betFreqHighMin) },
      ],
    },
    {
      field: "cpn",
      details: [
        { name: "low", max: Number(c.cpnMediumMin) },
        { name: "medium", min: Number(c.cpnMediumMin) },
        { name: "high", min: Number(c.cpnHighMin) },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Report > Player Segmentation", () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, đủ filter bắt buộc (*) / tuỳ chọn, 2 nút Search/Reset và nút Customize Table", async ({
      page,
    }) => {
      await expect(breadcrumb(page)).toHaveText("Player Segmentation Report");
      for (const [label, id, required] of [
        ["Timezone", "timezoneId", true],
        ["Settled Time", "settledTime_0", true],
        ["Currency", "currencyId", true],
        ["Agent", "agentIds", true],
        ["House", "houseIds", false],
        ["Master Agent", "masterAgentIds", false],
      ]) {
        await expect(filterEl(page, id), `thiếu filter ${label}`).toBeVisible();
        const text = await filterEl(page, id).innerText();
        expect(text, label).toContain(label);
        if (required) expect(text, `${label} phải có dấu *`).toContain("*");
        else expect(text, `${label} là tuỳ chọn`).not.toContain("*");
      }
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
      await expect(customizeBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: Timezone, Settled Time = hôm nay, còn lại để trống", async ({ page }) => {
      await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toContainText(
        /^\(GMT [+-]\d{2}:\d{2}\)/,
      );
      const [from, to] = (await dateRangeInput(page).inputValue()).split(" - ");
      expect(from).toMatch(DATETIME);
      expect(from.slice(11)).toBe("00:00:00");
      expect(to.slice(11)).toBe("23:59:59");
      expect(diffDays(parseDay(to), parseDay(from))).toBe(0);

      for (const id of ["currencyId", "agentIds", "houseIds", "masterAgentIds"]) {
        await expect(
          filterEl(page, id).locator(".ant-select-selection-item"),
          `#${id} phải trống`,
        ).toHaveCount(0);
      }
    });

    test("Có 3 tab, mặc định là Spending Power", async ({ page }) => {
      const labels = (await page.locator("label.ant-radio-button-wrapper").allInnerTexts()).map((t) => t.trim());
      expect(labels).toEqual(TABS);
      await expect(tabBtn(page, "Spending Power")).toHaveClass(/ant-radio-button-wrapper-checked/);
      await expect(tabBtn(page, "Spending Behavior")).not.toHaveClass(/ant-radio-button-wrapper-checked/);
      await expect(tabBtn(page, "Profile Category")).not.toHaveClass(/ant-radio-button-wrapper-checked/);
    });

    test("Chưa tìm kiếm: bảng Spending Power hiển thị tiêu đề cột mặc định và trạng thái trống", async ({ page }) => {
      expect(await headers(page)).toEqual(powerHeaders(DEFAULT_CUSTOM));
      await expect(page.getByText("There are no entries found").first()).toBeVisible();
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

  // ===== 2. Kiểm tra điều kiện trước khi tìm kiếm (không gọi API) =====
  test.describe("Điều kiện bắt buộc trước khi Search", () => {
    let called;
    test.beforeEach(async ({ page }) => {
      called = false;
      page.on("request", (r) => {
        if (isAnySegment(r)) called = true;
      });
    });

    test("Thiếu Currency -> báo 'Please select at least 1 currencies', không gọi API", async ({ page }) => {
      await searchBtn(page).click();
      await expect(toast(page, "Please select at least 1 currencies")).toBeVisible();
      expect(called).toBe(false);
    });

    test("Có Currency nhưng thiếu Agent -> báo 'Please select agent', không gọi API", async ({ page }) => {
      await selectOption(page, "currencyId", CURRENCY);
      await searchBtn(page).click();
      await expect(toast(page, "Please select agent")).toBeVisible();
      expect(called).toBe(false);
    });

    test("Thiếu Settled Time -> báo 'Please start a search with Settled Time', không gọi API", async ({ page }) => {
      await clearDate(page);
      await expect(dateRangeInput(page)).toHaveValue("");
      await searchBtn(page).click();
      await expect(toast(page, "Please start a search with Settled Time")).toBeVisible();
      expect(called).toBe(false);
    });

    test("Đủ filter nhưng chưa điền Customize Table -> hộp thoại nhắc điền, không gọi API", async ({ page }) => {
      await fillRequiredFilters(page);
      await searchBtn(page).click();

      await expect(requiredDialog(page)).toBeVisible();
      await expect(requiredDialog(page)).toContainText("Customize Table");
      await expect(requiredDialog(page).getByRole("button", { name: "Open Modal" })).toBeVisible();
      await expect(requiredDialog(page).getByRole("button", { name: "Cancel" })).toBeVisible();
      expect(called).toBe(false);

      await requiredDialog(page).getByRole("button", { name: "Cancel" }).click();
      await expect(requiredDialog(page)).toBeHidden();
    });

    test("Nút Open Modal của hộp thoại nhắc mở modal Customize Table", async ({ page }) => {
      await fillRequiredFilters(page);
      await searchBtn(page).click();
      await requiredDialog(page).getByRole("button", { name: "Open Modal" }).click();
      await expect(customizeModal(page)).toBeVisible();
      expect(called).toBe(false);
    });
  });

  // ===== 3. Modal Customize Table =====
  test.describe("Customize Table", () => {
    test("Modal có đủ 10 ô ngưỡng với giá trị mặc định (Bet Size để trống), các ô Low bị khoá", async ({ page }) => {
      await openCustomize(page);
      await expect(customizeModal(page).locator(".ant-modal-title")).toHaveText("Customize Table");
      expect(await readCustomize(page)).toEqual(MODAL_DEFAULTS);
      for (const id of ["betSizeLowMax", "betFreqLowMax", "cpnLowMax"]) {
        await expect(customizeModal(page).locator(`#${id}`), id).toBeDisabled();
      }
      for (const id of [
        "betSizeMediumMin",
        "betSizeHighMin",
        "betSizeVipMin",
        "betFreqMediumMin",
        "betFreqHighMin",
        "cpnMediumMin",
        "cpnHighMin",
      ]) {
        await expect(customizeModal(page).locator(`#${id}`), id).toBeEnabled();
      }
      await expect(customizeModal(page).getByRole("button", { name: "Save" })).toBeVisible();
      await expect(customizeModal(page).getByRole("button", { name: "Cancel" })).toBeVisible();
    });

    test("Ô Low tự lấy giá trị của ô Medium (ngưỡng trên của Low = ngưỡng dưới của Medium)", async ({ page }) => {
      await openCustomize(page);
      await fillCustomize(page, { betSizeMediumMin: "25", betFreqMediumMin: "60", cpnMediumMin: "3" });
      const values = await readCustomize(page);
      expect(values.betSizeLowMax).toBe("25");
      expect(values.betFreqLowMax).toBe("60");
      expect(values.cpnLowMax).toBe("3");
    });

    test("Save khi để trống Bet Size -> báo 'This field is required' và modal vẫn mở", async ({ page }) => {
      await fillRequiredFilters(page);
      await openCustomize(page);
      let called = false;
      page.on("request", (r) => {
        if (isAnySegment(r)) called = true;
      });
      await customizeModal(page).getByRole("button", { name: "Save" }).click();

      await expect(page.locator(".ant-form-item-explain-error").filter({ hasText: "This field is required" })).toHaveCount(3);
      await expect(customizeModal(page)).toBeVisible();
      expect(called).toBe(false);
    });

    test("Giá trị không tăng dần -> báo 'Values must be in ascending order' và modal vẫn mở", async ({ page }) => {
      await fillRequiredFilters(page);
      await openCustomize(page);
      // High (5) <= Medium (10)
      await fillCustomize(page, { ...DEFAULT_CUSTOM, betSizeHighMin: "5" });
      await customizeModal(page).getByRole("button", { name: "Save" }).click();

      await expect(
        page.locator(".ant-form-item-explain-error").filter({ hasText: "Values must be in ascending order" }).first(),
      ).toBeVisible();
      await expect(customizeModal(page)).toBeVisible();
    });

    test("Cancel đóng modal và không lưu giá trị vừa nhập", async ({ page }) => {
      await openCustomize(page);
      await fillCustomize(page, { betSizeMediumMin: "7" });
      await customizeModal(page).getByRole("button", { name: "Cancel" }).click();
      await expect(customizeModal(page)).toBeHidden();

      await openCustomize(page);
      expect((await readCustomize(page)).betSizeMediumMin).toBe("");
    });

    test("Nút X đóng modal", async ({ page }) => {
      await openCustomize(page);
      await customizeModal(page).locator(".ant-modal-close").click();
      await expect(customizeModal(page)).toBeHidden();
    });

    test("Save hợp lệ: đóng modal, gọi API với segmentFilters đúng ngưỡng đã nhập", async ({ page }) => {
      const custom = {
        betSizeMediumMin: "20",
        betSizeHighMin: "200",
        betSizeVipMin: "2000",
        betFreqMediumMin: "50",
        betFreqHighMin: "200",
        cpnMediumMin: "2",
        cpnHighMin: "5",
      };
      const { body, status } = await loadData(page, custom);
      expect(status).toBe(200);
      expect(body.segmentFilters).toEqual(expectedSegmentFilters(custom));
    });

    test("Ngưỡng đã Save được giữ lại khi mở lại modal", async ({ page }) => {
      await loadData(page);
      await openCustomize(page);
      const values = await readCustomize(page);
      for (const [id, value] of Object.entries(DEFAULT_CUSTOM)) expect(values[id], id).toBe(value);
    });

    test("Ngưỡng thay đổi thì tiêu đề cột / nhãn hàng của Spending Power và Spending Behavior đổi theo", async ({
      page,
    }) => {
      const custom = {
        betSizeMediumMin: "20",
        betSizeHighMin: "200",
        betSizeVipMin: "2000",
        betFreqMediumMin: "50",
        betFreqHighMin: "200",
        cpnMediumMin: "2",
        cpnHighMin: "5",
      };
      await loadData(page, custom);
      expect(await headers(page)).toEqual(powerHeaders(custom));
      expect((await readGrid(page)).map((r) => r.label)).toEqual(powerRowLabels(custom));

      await openTab(page, "Spending Behavior");
      expect(await headers(page)).toEqual(behaviorHeaders(custom));
      expect((await readGrid(page)).map((r) => r.label)).toEqual(behaviorRowLabels(custom));
    });
  });

  // ===== 4. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Search gửi đúng request (phân trang, sort, filter bắt buộc, segmentFilters)", async ({ page }) => {
      await loadData(page);
      const { body, status } = await search(page);
      expect(status).toBe(200);
      expect(body).toMatchObject({ page: 1, pageSize: 100000, sortBy: "id", sortDirection: "desc" });
      expect(Object.keys(body.filters).sort()).toEqual(["agentIds", "currencyId", "settledTime", "timezoneId"]);
      expect(body.filters.timezoneId).toEqual(expect.any(Number));
      expect(body.filters.currencyId).toEqual(expect.any(Number)); // Currency chọn 1 giá trị -> gửi số
      expect(body.filters.agentIds).toEqual([expect.any(Number)]);
      expect(body.segmentFilters).toEqual(expectedSegmentFilters(DEFAULT_CUSTOM));
    });

    for (const [label, id] of [
      ["Currency", "currencyId"],
      ["Agent", "agentIds"],
      ["House", "houseIds"],
      ["Master Agent", "masterAgentIds"],
    ]) {
      test(`Dropdown ${label} load được danh sách option`, async ({ page }) => {
        expect((await dropdownOptions(page, id)).length).toBeGreaterThan(0);
      });
    }

    test("Currency chỉ chọn được 1 giá trị (chọn giá trị mới thì thay thế)", async ({ page }) => {
      const options = await dropdownOptions(page, "currencyId");
      expect(options.length).toBeGreaterThan(1);
      await selectOption(page, "currencyId", options[0]);
      await selectOption(page, "currencyId", options[1]);
      expect(await selectedTitles(page, "currencyId")).toEqual([options[1]]);
    });

    test("Agent cho phép chọn nhiều giá trị -> request gửi agentIds nhiều phần tử", async ({ page }) => {
      await fillRequiredFilters(page);
      const options = await dropdownOptions(page, "agentIds");
      const other = options.find((o) => o !== AGENT);
      await selectOption(page, "agentIds", other);
      expect((await selectedTitles(page, "agentIds")).sort()).toEqual([AGENT, other].sort());

      await openCustomize(page);
      await fillCustomize(page, DEFAULT_CUSTOM);
      const { body } = await saveCustomize(page);
      expect(body.filters.agentIds).toHaveLength(2);
    });

    test("Đổi Timezone gửi timezoneId mới", async ({ page }) => {
      const first = await loadData(page);
      const before = first.body.filters.timezoneId;
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
  test.describe("Settled Time", () => {
    test("Settled Time có đủ các preset", async ({ page }) => {
      await filterEl(page, "settledTime_0").locator("label").first().click();
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

    test("Các preset cho khoảng ngày đúng và request gửi settledTime = [đầu ngày đầu, 00:00:00 ngày kế tiếp ngày cuối]", async ({
      page,
    }) => {
      await loadData(page); // đã có đủ filter + Customize để có thể Search
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
        const [from, to] = (await dateRangeInput(page).inputValue()).split(" - ");
        expect(from.slice(11), preset).toBe("00:00:00");
        expect(to.slice(11), preset).toBe("23:59:59");
        if (preset === "Today") today = parseDay(to);
        expect(parseDay(to).getTime(), preset).toBe(today.getTime()); // luôn kết thúc ở hôm nay
        expect(diffDays(parseDay(to), parseDay(from)) + 1, preset).toBe(days);

        const { body } = await search(page);
        expect(body.filters.settledTime, preset).toEqual([from, nextDayStart(to)]);
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

    test("Xoá bằng nút (x) -> Settled Time trống (bắt buộc nên không Search được)", async ({ page }) => {
      await pickDatePreset(page, "Last 7 Days");
      await expect(dateRangeInput(page)).not.toHaveValue("");
      await clearDate(page);
      await expect(dateRangeInput(page)).toHaveValue("");
    });
  });

  // ===== 6. Tab Spending Power =====
  test.describe("Spending Power", () => {
    test("Ma trận 4 hàng Bet Size x 3 cột Bet Frequency với nhãn theo đúng ngưỡng", async ({ page }) => {
      await loadData(page);
      expect(await headers(page)).toEqual(powerHeaders(DEFAULT_CUSTOM));
      const grid = await readGrid(page);
      expect(grid.map((r) => r.label)).toEqual(powerRowLabels(DEFAULT_CUSTOM));
      for (const r of grid) expect(r.cells, r.label).toHaveLength(FREQUENCIES.length);
    });

    test("Mỗi ô hiển thị tỷ lệ % khớp response API", async ({ page }) => {
      const { json } = await loadData(page);
      const data = json.data;
      test.skip(!data.length, "Không có người chơi nào với filter này");
      const grid = await readGrid(page);

      for (const item of data) {
        const r = BET_SIZES.indexOf(item.betSize);
        const c = FREQUENCIES.indexOf(item.betFrequency);
        expect(r, `betSize ${item.betSize} không có trên bảng`).toBeGreaterThanOrEqual(0);
        expect(c, `betFrequency ${item.betFrequency} không có trên bảng`).toBeGreaterThanOrEqual(0);
        const [pct] = grid[r].cells[c];
        expect(pct, `ô [${item.betSize}][${item.betFrequency}]`).toMatch(/^[\d.]+%$/);
        expect(num(pct), `ô [${item.betSize}][${item.betFrequency}]`).toBeCloseTo(parseFloat(item.ratio), 2);
      }
    });

    test("Tổng tỷ lệ các ô xấp xỉ 100% (sai số do làm tròn)", async ({ page }) => {
      const { json } = await loadData(page);
      test.skip(!json.data.length, "Không có người chơi nào với filter này");
      const grid = await readGrid(page);
      const total = grid.flatMap((r) => r.cells.map(([pct]) => num(pct))).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(99);
      expect(total).toBeLessThan(101);
    });

    test("Mô tả cố định của từng ô", async ({ page }) => {
      const { json } = await loadData(page);
      test.skip(!json.data.length, "Không có người chơi nào với filter này");
      const grid = await readGrid(page);
      grid.forEach((r, i) => {
        expect(
          r.cells.map(([, text]) => text),
          r.label,
        ).toEqual(POWER_TEXT[i]);
      });
    });
  });

  // ===== 7. Tab Spending Behavior =====
  test.describe("Spending Behavior", () => {
    test("Chuyển tab gọi API spending-behavior với cùng filter và segmentFilters", async ({ page }) => {
      const power = await loadData(page);
      const { body, status } = await openTab(page, "Spending Behavior");
      expect(status).toBe(200);
      expect(body.filters).toEqual(power.body.filters);
      expect(body.segmentFilters).toEqual(power.body.segmentFilters);
      await expect(tabBtn(page, "Spending Behavior")).toHaveClass(/ant-radio-button-wrapper-checked/);
    });

    test("Ma trận 3 hàng CPN x 3 cột Bet Frequency với nhãn theo đúng ngưỡng", async ({ page }) => {
      await loadData(page);
      await openTab(page, "Spending Behavior");
      expect(await headers(page)).toEqual(behaviorHeaders(DEFAULT_CUSTOM));
      const grid = await readGrid(page);
      expect(grid.map((r) => r.label)).toEqual(behaviorRowLabels(DEFAULT_CUSTOM));
      for (const r of grid) expect(r.cells, r.label).toHaveLength(FREQUENCIES.length);
    });

    test("Mỗi ô hiển thị tỷ lệ % khớp response API và tổng xấp xỉ 100%", async ({ page }) => {
      await loadData(page);
      const { json } = await openTab(page, "Spending Behavior");
      test.skip(!json.data.length, "Không có người chơi nào với filter này");
      const grid = await readGrid(page);

      for (const item of json.data) {
        const r = CPNS.indexOf(item.cpn);
        const c = FREQUENCIES.indexOf(item.betFrequency);
        expect(r, `cpn ${item.cpn} không có trên bảng`).toBeGreaterThanOrEqual(0);
        expect(c, `betFrequency ${item.betFrequency} không có trên bảng`).toBeGreaterThanOrEqual(0);
        const [pct] = grid[r].cells[c];
        expect(num(pct), `ô [${item.cpn}][${item.betFrequency}]`).toBeCloseTo(parseFloat(item.ratio), 2);
      }
      const total = grid.flatMap((r) => r.cells.map(([pct]) => num(pct))).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(99);
      expect(total).toBeLessThan(101);
    });

    test("Mô tả cố định của từng ô", async ({ page }) => {
      await loadData(page);
      const { json } = await openTab(page, "Spending Behavior");
      test.skip(!json.data.length, "Không có người chơi nào với filter này");
      const grid = await readGrid(page);
      grid.forEach((r, i) => {
        expect(
          r.cells.map(([, text]) => text),
          r.label,
        ).toEqual(BEHAVIOR_TEXT[i]);
      });
    });

    test("Search khi đang ở tab này chỉ gọi API của tab này", async ({ page }) => {
      await loadData(page);
      await openTab(page, "Spending Behavior");

      const called = [];
      page.on("request", (r) => {
        if (isAnySegment(r)) called.push(reqOf(r).url().split("/").pop());
      });
      await search(page, isBehavior);
      expect(called).toEqual(["spending-behavior"]);
    });
  });

  // ===== 8. Tab Profile Category =====
  test.describe("Profile Category", () => {
    test("Chuyển tab gọi API profile-category với cùng filter và segmentFilters", async ({ page }) => {
      const power = await loadData(page);
      const { body, status } = await openTab(page, "Profile Category");
      expect(status).toBe(200);
      expect(body.filters).toEqual(power.body.filters);
      expect(body.segmentFilters).toEqual(power.body.segmentFilters);
    });

    test("Bảng có 4 cột và đủ 7 nhóm hồ sơ theo thứ tự cố định", async ({ page }) => {
      await loadData(page);
      await openTab(page, "Profile Category");
      expect(await headers(page)).toEqual([
        "Profile Category",
        "Condition to Profiling",
        "Profile Meaning",
        "Quantity",
      ]);
      const rows = await readGrid(page);
      expect(rows.map((r) => r.label)).toEqual(PROFILE_CATEGORIES.map(([, name]) => name));
      for (const r of rows) {
        expect(r.cells, r.label).toHaveLength(3);
        for (const [text] of r.cells.slice(0, 2)) expect(text, r.label).not.toBe("");
      }
    });

    test("Cột Quantity khớp response API (nhóm không có trong response hiển thị 0) và có dấu phẩy hàng nghìn", async ({
      page,
    }) => {
      await loadData(page);
      const { json } = await openTab(page, "Profile Category");
      const byKey = Object.fromEntries(json.data.map((d) => [d.category, d.quantity]));
      const rows = await readGrid(page);

      PROFILE_CATEGORIES.forEach(([key, name], i) => {
        const shown = rows[i].cells[2][0];
        const expected = byKey[key] ?? 0;
        expect(num(shown), name).toBe(expected);
        expect(shown, `${name}: định dạng số`).toBe(expected.toLocaleString("en-US"));
      });
    });

    test("API không trả về nhóm nào ngoài 7 nhóm đã biết", async ({ page }) => {
      await loadData(page);
      const { json } = await openTab(page, "Profile Category");
      const known = PROFILE_CATEGORIES.map(([key]) => key);
      for (const d of json.data) expect(known, `nhóm lạ: ${d.category}`).toContain(d.category);
    });
  });

  // ===== 9. Chuyển tab =====
  test("Mỗi lần chuyển tab đều gọi lại API của tab đó và quay về tab đầu hiển thị lại ma trận", async ({ page }) => {
    await loadData(page);
    await openTab(page, "Spending Behavior");
    await openTab(page, "Profile Category");
    await openTab(page, "Spending Power");
    expect(await headers(page)).toEqual(powerHeaders(DEFAULT_CUSTOM));
    await expect(tabBtn(page, "Spending Power")).toHaveClass(/ant-radio-button-wrapper-checked/);
  });

  // ===== 10. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá filter, đưa Settled Time về hôm nay, giữ Timezone, xoá kết quả và không gọi API", async ({ page }) => {
      await loadData(page);
      const timezone = await filterEl(page, "timezoneId")
        .locator(".ant-select-selection-item")
        .getAttribute("title");

      let called = false;
      page.on("request", (r) => {
        if (isAnySegment(r)) called = true;
      });
      await resetBtn(page).click();

      for (const id of ["currencyId", "agentIds", "houseIds", "masterAgentIds"]) {
        await expect(filterEl(page, id).locator(".ant-select-selection-item")).toHaveCount(0);
      }
      const [from, to] = (await dateRangeInput(page).inputValue()).split(" - ");
      expect(from.slice(11)).toBe("00:00:00");
      expect(diffDays(parseDay(to), parseDay(from))).toBe(0);
      await expect(filterEl(page, "timezoneId").locator(".ant-select-selection-item")).toHaveAttribute(
        "title",
        timezone,
      );
      await expect(page.getByText("There are no entries found").first()).toBeVisible();
      expect(called).toBe(false);
    });

    test("Reset đưa các ngưỡng Customize Table về mặc định (Bet Size để trống)", async ({ page }) => {
      await loadData(page);
      await resetBtn(page).click();
      await openCustomize(page);
      expect(await readCustomize(page)).toEqual(MODAL_DEFAULTS);
    });
  });

  // ===== 11. Ghi nhớ filter =====
  test("Filter được ghi nhớ sau khi reload trang", async ({ page }) => {
    const { body } = await loadData(page);

    await openPage(page); // reload
    expect(await selectedTitles(page, "currencyId")).toEqual([CURRENCY]);
    expect(await selectedTitles(page, "agentIds")).toEqual([AGENT]);
    const [from] = body.filters.settledTime;
    await expect(dateRangeInput(page)).toHaveValue(new RegExp(`^${from} - `));

    // Ngưỡng Customize Table cũng được ghi nhớ: tiêu đề cột / nhãn hàng vẫn theo ngưỡng đã Save
    expect(await headers(page)).toEqual(powerHeaders(DEFAULT_CUSTOM));
    await openCustomize(page);
    const values = await readCustomize(page);
    for (const [id, value] of Object.entries(DEFAULT_CUSTOM)) expect(values[id], id).toBe(value);
  });
});
