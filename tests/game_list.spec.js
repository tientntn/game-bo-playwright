// Games > Games  (https://dev-bo.royaledge.io/game)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/game_list.spec.js --project=setup --project=chromium
//
// Màn hình quản lý danh sách game. Test chạy với màn hình RỘNG (1920x1080) để hiện đủ cột và toàn bộ filter.
//
// Màn hình có nhiều thao tác GHI dữ liệu thật (Activate / Deactivate / Set to Maintenance / End Maintenance /
// Notify Update, sửa Game Setting, tạo / sửa game). QUY TẮC:
//  - Thao tác trên game CÓ SẴN (của team): test KHÔNG bấm xác nhận. Chỉ mở hộp thoại, kiểm tra nội dung rồi bấm
//    Cancel / Close (không bao giờ bấm Deactivate, OK, Set to Maintenance... trên game có sẵn) và kiểm tra không có
//    request ghi dữ liệu nào được gửi đi.
//  - Riêng describe "Tạo game": được phép Submit tạo game thật và thao tác (xem, Deactivate) trên CHÍNH game QA do
//    test tạo ra (Name `QA-<timestamp>`, Code `QA_<timestamp>`). Màn hình không có chức năng xoá game nên dọn dẹp
//    bằng cách Deactivate game QA đó (qua UI, có kiểm tra tên / code là QA trước khi bấm) - chạy ở test "Dọn dẹp"
//    và lặp lại trong afterAll nếu test trước đó fail. Game QA ở lại với trạng thái Inactive.
//  - CỜ RUN_FULL_TESTS (xem tests/helpers/flags.js, đặt trong .env, ghi đè nhanh bằng biến môi trường):
//      RUN_FULL_TESTS=true  -> chạy cả các test Submit tạo game thật + dọn dẹp.
//      RUN_FULL_TESTS=false -> (mặc định) các test đó bị SKIP, không gửi bất kỳ request ghi nào.
//    Các test validate form tạo game (submit rỗng, Code trùng, Hit Rate...) không tạo dữ liệu nên luôn chạy.
// Riêng test Export sẽ tạo thêm 1 bản ghi ở Download History.
// Không hard-code dữ liệu (code, tên game...) - mọi giá trị lấy từ chính dòng đầu tiên của danh sách; dữ liệu
// tham chiếu khi tạo game (category, sub category, engine, currency + denom) lấy từ option / response API thật.
const { test, expect } = require("@playwright/test");
const { RUN_FULL_TESTS, SKIP_WRITE_REASON } = require("./helpers/flags");
const { buildStorageState } = require("./helpers/session");

test.use({ viewport: { width: 1920, height: 1080 } });

const URL = "/game";

// Đúng thứ tự hiển thị (cột đầu tiên là checkbox chọn dòng, không có tên)
const COLUMNS = [
  "ID",
  "Name",
  "Code",
  "Game Category",
  "Game Sub Category",
  "Currency",
  "Languages",
  "Volatility",
  "Labels",
  "Features",
  "Themes",
  "Tags",
  "Maintenance",
  "Status",
  "Action",
];
const HEADERS = ["", ...COLUMNS];

// Các cột có thể sort -> tên field gửi lên API (mặc định sort theo id giảm dần)
const SORTABLE = {
  Name: "name",
  Code: "code",
  "Game Category": "gameCategory",
  "Game Sub Category": "gameSubCategory",
  Languages: "languages",
  Volatility: "volatility",
  Labels: "labels",
  Features: "features",
  Themes: "theme",
  Tags: "tags",
  Maintenance: "maintenance",
  Status: "status",
};

// Dữ liệu API -> chữ hiển thị
const STATUS_TEXT = { 0: "Inactive", 1: "Active" };
const MAINTENANCE_TEXT = { 0: "Normal Operation", 1: "Under Maintenance" };
// Cột Currency chỉ hiện tối đa 6 chip, phần còn lại gom thành "+ N ..."
const MAX_CURRENCY_CHIPS = 6;

// Các hộp thoại của nút thao tác hàng loạt (đúng thứ tự nút trên toolbar). KHÔNG bao giờ bấm nút xác nhận.
const BULK = [
  {
    label: "Activate",
    tip: "Bulk Activate",
    title: (n) => `Activate ${n} game`,
    text: () => "All selected games are already in this state. There is nothing to update.",
    buttons: ["Close"],
  },
  {
    label: "Deactivate",
    tip: "Bulk Deactivate",
    title: (n) => `Deactivate ${n} game`,
    text: () => "Are you sure you want to deactivate this game?",
    buttons: ["Cancel", "Deactivate"],
  },
  {
    label: "Notify Update",
    tip: "Bulk Notify Update",
    title: (n) => `Update notification game ${n}`,
    text: (n) => `Are you sure want to send the update notification for game ${n}?`,
    buttons: ["Cancel", "OK"],
  },
  {
    label: "Set to Maintenance",
    tip: "Bulk Set to Maintenance",
    title: () => "Set 1 game to maintenance?",
    text: (n) => `Are you sure you want to set ${n} to maintenance?`,
    buttons: ["Cancel", "Set to Maintenance"],
  },
  {
    label: "End Maintenance",
    tip: "Bulk End Maintenance",
    title: () => "Remove 1 game from maintenance?",
    text: () => "All selected games are already in this state. There is nothing to update.",
    buttons: ["Close"],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const isList = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/game/list/v2");
const isDownload = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/download");

const mainTable = (page) => page.locator(".ant-table").first();
const rows = (page) => page.locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
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
  test.setTimeout(Math.max(90000, test.info().timeout)); // không làm ngắn timeout đã nới của test / hook dọn dẹp
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
// Chữ hiển thị của cột Currency: tối đa 6 chip rồi "+ N ..."
const currencyText = (list) =>
  list.slice(0, MAX_CURRENCY_CHIPS).join("") +
  (list.length > MAX_CURRENCY_CHIPS ? `+ ${list.length - MAX_CURRENCY_CHIPS} ...` : "");

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
// KHÔNG click giữa ô: với dropdown chọn nhiều, vị trí đó có thể rơi vào nút (x) của chip đã chọn
// -> bấm vào sẽ XOÁ giá trị đang chọn.
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

// Danh sách luôn có dữ liệu; nếu trống thì skip
async function ensureData(page, test) {
  if ((await rows(page).count()) === 0) test.skip(true, "Danh sách game trống");
}

// Chọn / bỏ chọn checkbox của dòng thứ i
const checkRow = (page, i) => rowAt(page, i).locator('input[type="checkbox"]').check();

// Ghi lại mọi request POST KHÔNG phải đọc dữ liệu để chắc chắn test không làm đổi dữ liệu thật
function watchWrites(page) {
  const writes = [];
  const READ =
    /\/(list|list\/v2|details|download|view|dropdown|by-currency-category)$|\/dropdown\/|\/validate\/|\/user\/details$/;
  page.on("request", (r) => {
    if (r.method() === "POST" && /boapi/.test(r.url()) && !READ.test(r.url())) writes.push(r.url());
  });
  return writes;
}

// Mở menu "..." của dòng thứ i, trả về locator của menu
async function openRowMenu(page, i) {
  await rowAt(page, i).locator("td").last().locator("button").click();
  const menu = page.locator(".ant-dropdown:not(.ant-dropdown-hidden)");
  await expect(menu).toBeVisible();
  return menu;
}
// Chữ của các mục menu (bỏ ký tự "x" của icon ở mục End Maintenance)
const menuItems = async (menu) =>
  (await menu.locator('[role="menuitem"]').allInnerTexts()).map((t) => norm(t).replace(/^x /, ""));

// Đóng hộp thoại bằng nút Cancel / Close (KHÔNG bao giờ bấm nút xác nhận)
async function closeDialog(page) {
  await dialog(page)
    .getByRole("button", { name: /(Cancel|Close)$/ })
    .first()
    .click();
  await expect(dialog(page)).toBeHidden();
}

// Tìm dòng đầu tiên ở trang hiện tại thoả điều kiện (trả về { index, game } hoặc null)
const findGame = (json, pred) => {
  const index = json.data.list.findIndex(pred);
  return index < 0 ? null : { index, game: json.data.list[index] };
};

// ---------------------------------------------------------------------------
// Helpers cho trang tạo game (/game/create-game) - wizard 5 bước
// ---------------------------------------------------------------------------
const CREATE_STEPS = ["Basic Information", "Currency", "Agent Assignment", "Paytable", "Review & Submit"];
const HIT_RATE_ERROR = "Please enter valid hit rate value greater than 0 and hit rate value less than 100";
// Các mức Win Formula nhập vào hộp thoại (tên mức -> [min, max]; Ultra không có max)
const WIN_TIERS = { Slim: [0, 10], Small: [10, 20], Medium: [20, 50], Big: [50, 100], Mega: [100, 500], Ultra: [500] };
const isCreate = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/game/create/v2");
const isStatusUpdate = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/game/update-status/v2");
const isView = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/game/view");
const nextBtn = (page) => page.getByRole("button", { name: "Next", exact: true });
const prevBtn = (page) => page.getByRole("button", { name: "Previous", exact: true });
const cancelBtn = (page) => page.getByRole("button", { name: "Cancel", exact: true });
const submitBtn = (page) => page.getByRole("button", { name: "Submit", exact: true });
const toast = (page) => page.locator(".Toastify__toast");

// Ô form theo nhãn (vd "Game Category") và các lỗi validate của ô đó
const formItem = (page, label) =>
  page
    .locator(".ant-form-item")
    .filter({ has: page.locator(".ant-form-item-label label", { hasText: exact(label) }) })
    .first();
const formErrors = (page, label) => formItem(page, label).locator(".ant-form-item-explain-error");

// Bước đang active (1..5)
async function activeStep(page) {
  const items = await page
    .locator(".ant-steps-item")
    .evaluateAll((els) => els.map((e) => e.classList.contains("ant-steps-item-active")));
  return items.findIndex(Boolean) + 1;
}

// Danh sách option đang mở của dropdown antd
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");

// Click vào chữ "Create Game" ở breadcrumb để đóng dropdown (không click link "Games")
const clickOutside = async (page) => {
  await breadcrumb(page).getByText("Create Game").click();
  await expect(openOptions(page)).toHaveCount(0);
};

// Từ danh sách /game bấm Add New -> trang tạo game
async function startCreate(page) {
  await addBtn(page).click();
  await expect(page).toHaveURL(/\/game\/create-game$/);
  await expect(breadcrumb(page)).toContainText("Create Game");
  await expect(page.locator("#name")).toBeVisible();
}

// Chọn option thứ n của ô select 1 giá trị, trả về tên option đã chọn
async function pickOption(page, label, n = 0) {
  const f = formItem(page, label);
  await f.locator(".ant-select-selector").click();
  const opt = openOptions(page).nth(n);
  await expect(opt).toBeVisible();
  const title = (await opt.getAttribute("title")) ?? norm(await opt.innerText());
  await opt.click();
  await expect(f.locator(".ant-select-selection-item[title]")).toHaveAttribute("title", title);
  // Chờ dropdown đóng hẳn (còn đang mờ dần thì lần mở dropdown kế tiếp sẽ lấy nhầm option của dropdown cũ)
  await expect(openOptions(page)).toHaveCount(0);
  return title;
}

// Chọn 1 option đầu tiên (không phải "Select All") của ô chọn nhiều, trả về tên option
async function pickMulti(page, label) {
  const f = formItem(page, label);
  await f.locator(".ant-select-selector").click();
  const opt = openOptions(page).filter({ hasNotText: /^\s*Select All\s*$/ }).first();
  await expect(opt).toBeVisible();
  const title = (await opt.getAttribute("title")) ?? norm(await opt.innerText());
  await opt.click();
  await clickOutside(page); // dropdown chọn nhiều không tự đóng
  // Chip của ô chọn nhiều ở form tạo game không có class / title chuẩn của antd -> kiểm tra theo chữ trong ô
  await expect(f.locator(".ant-select-selector")).toContainText(title);
  return title;
}

// Mở hộp thoại Win Formula (bấm vào ô chỉ đọc) và nhập đủ các mức rồi Save
async function fillWinFormula(page) {
  await page.locator("#winFormula").click();
  await expect(dialog(page)).toContainText("Win Formula");
  for (const [tier, [min, max]] of Object.entries(WIN_TIERS)) {
    await dialog(page).locator(`#wf${tier}Min`).fill(String(min));
    if (max != null) await dialog(page).locator(`#wf${tier}Max`).fill(String(max));
  }
  await dialog(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator("#winFormula")).toHaveValue("View Details");
}

// Bước 1: điền Name / Code + các field bắt buộc (+ field tuỳ chọn nếu full). Ghi giá trị đã chọn vào qa.
async function fillBasic(
  page,
  qa,
  { name = qa.name ?? `QA-${Date.now()}`, code = qa.code ?? `QA_${Date.now()}`, optional = true } = {},
) {
  await page.locator("#name").fill(name);
  await page.locator("#code").fill(code);
  // Sub Category nạp lại theo Category đã chọn -> chờ response có gameCategoryIds trước khi mở dropdown
  const subRes = page.waitForResponse(
    (r) => reqOf(r).url().endsWith("/game/game_sub_category/list") && /"gameCategoryIds":\[\d/.test(reqOf(r).postData() || ""),
  );
  qa.category = await pickOption(page, "Game Category");
  await subRes;
  qa.subCategory = await pickOption(page, "Game Sub Category");
  qa.engine = await pickOption(page, "Engine");
  await fillWinFormula(page);
  if (optional) {
    await page.locator("#hitrate").fill(qa.hitRate);
    qa.volatility = await pickOption(page, "Volatility");
    qa.language = await pickMulti(page, "Language");
  }
}

// Bước 1 -> 2. Trả về response của denomination/dropdown và dropdown/currency (dùng để chọn currency có denom)
async function goToCurrencyStep(page) {
  const denomRes = page.waitForResponse((r) => reqOf(r).url().endsWith("/denomination/dropdown"), { timeout: 30000 });
  const curRes = page.waitForResponse((r) => reqOf(r).url().endsWith("/dropdown/currency"), { timeout: 30000 });
  denomRes.catch(() => {});
  curRes.catch(() => {});
  await nextBtn(page).click();
  await expect.poll(() => activeStep(page)).toBe(2);
  return {
    denoms: (await (await denomRes).json()).data ?? [],
    currencies: (await (await curRes).json()).data ?? [],
  };
}

// Bước 2: bấm Add New, tick currency (theo tên hiển thị) rồi Confirm
async function addCurrency(page, label) {
  await page.getByRole("button", { name: /Add New/ }).click();
  await expect(dialog(page)).toContainText("Add new");
  const row = dialog(page).locator("tr.ant-table-row").filter({ hasText: exact(label) });
  await expect(row).toHaveCount(1);
  await row.locator("input").check();
  await dialog(page).getByRole("button", { name: /Confirm$/ }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
}

// Bước 2: sau khi thêm currency có denom thì app tự chọn sẵn denom mặc định (hiện "<tên> (Default)").
// Nếu chưa có denom nào được chọn thì chọn option đầu tiên. Trả về denom đã chọn (phần tử của denominationList).
async function ensureDenom(page, denomList) {
  const selected = rows(page).first().locator(".ant-select-selection-item[title]");
  let title = await selected.getAttribute("title", { timeout: 3000 }).catch(() => null);
  if (!title) {
    await page
      .locator("#currencyInfoList_0_denom")
      .locator("xpath=ancestor::div[contains(@class,'ant-select-selector')]")
      .click();
    const opt = openOptions(page).first();
    await expect(opt).toBeVisible();
    await opt.click();
    title = await selected.getAttribute("title");
  }
  const denom = denomList.find((d) => title === d.name || title === `${d.name} (Default)`);
  expect(denom, `Denom đã chọn "${title}" không có trong response denomination/dropdown`).toBeTruthy();
  return denom;
}

// Chọn currency + denom thật: lấy currency đầu tiên trong response denomination/dropdown có danh sách denom
// (và có trong danh sách currency để biết tên hiển thị). Trả về null nếu server không trả denom nào.
// (Quan sát: denomination/dropdown thỉnh thoảng trả mảng rỗng dù cùng sub category - khi đó không tạo game được)
async function addCurrencyWithDenom(page, ctx) {
  const labelOf = new Map(ctx.currencies.map((c) => [c.value, c.label]));
  const pick = ctx.denoms.find((d) => d.denominationList?.length && labelOf.has(d.currencyId));
  if (!pick) return null;
  const label = labelOf.get(pick.currencyId);
  await addCurrency(page, label);
  const denom = await ensureDenom(page, pick.denominationList);
  return { currency: label, currencyId: pick.currencyId, denom, denomName: denom.name };
}

// Đi tới bước n bằng nút Next (các bước 2 -> 3 -> 4 -> 5 sau khi đã hợp lệ)
async function goToStep(page, n) {
  for (let s = await activeStep(page); s < n; s++) {
    await nextBtn(page).click();
    await expect.poll(() => activeStep(page)).toBe(s + 1);
  }
}

// Điền JSON vào hộp thoại soạn thảo (Paytable / Help Page) rồi OK
async function fillJsonDialog(page, titlePart, obj) {
  await expect(dialog(page)).toContainText(titlePart);
  await dialog(page).locator("textarea").fill(JSON.stringify(obj));
  await dialog(page).getByRole("button", { name: /OK$/ }).click();
  await expect(dialog(page)).toBeHidden();
}

// Bước 4: thêm 1 paytable (Name + nội dung Paytable + Help Page). help = false để bỏ trống Help Page.
async function addPaytable(page, qa, { help = true } = {}) {
  await page.getByRole("button", { name: /Add New/ }).click();
  await expect(rows(page)).toHaveCount(1);
  qa.paytable = `PT_${qa.code}`;
  await page.locator("#payTableInfoList_0_code").fill(qa.paytable);
  const icons = rows(page).first().locator('svg[data-icon="pen-to-square"]');
  await icons.nth(0).click();
  await fillJsonDialog(page, "Paytable -", { BaseGame: { Name: "BaseGame", Cols: 5 } });
  if (help) {
    await icons.nth(1).click();
    await fillJsonDialog(page, "Edit Help Page", { title: "QA help" });
  }
}

// Đi từ trang danh sách tới bước Review & Submit với dữ liệu hợp lệ. Trả về thông tin currency / denom đã chọn,
// hoặc null nếu server không trả denom nào (khi đó test nên skip).
async function reachReview(page, qa, opts = {}) {
  await startCreate(page);
  await fillBasic(page, qa, opts);
  const ctx = await goToCurrencyStep(page);
  const cur = await addCurrencyWithDenom(page, ctx);
  if (!cur) return null;
  qa.currencyInfo = cur;
  await goToStep(page, 4); // bước 3 (Agent Assignment) không bắt buộc gì
  if (opts.paytable !== false) await addPaytable(page, qa);
  await goToStep(page, 5);
  await expect(submitBtn(page)).toBeVisible();
  return cur;
}

// Chỉ thao tác trên game do chính test tạo: Name `QA-<số>` và Code `QA_<số>`
const isQaGame = (g) => /^QA-\d+$/.test(g.name) && /^QA_\d+$/.test(g.code);

// Mở danh sách, lọc theo Code (hoặc Name) của game QA. Trả về { json, found: { index, game } | null }
async function findQaGame(page, qa, by = "code") {
  await openPage(page);
  await selectOption(page, by, by === "code" ? qa.code : qa.name);
  const { body, json } = await search(page);
  return { body, json, found: findGame(json, (g) => g.code === qa.code) };
}

// Deactivate game QA qua UI (menu "..." -> Deactivate -> xác nhận). Trả về true nếu đã bấm Deactivate.
// Từ chối thao tác nếu game không phải game QA do test tạo.
async function deactivateQaGame(page, qa) {
  const { found } = await findQaGame(page, qa);
  if (!found) return false;
  expect(isQaGame(found.game), `Không phải game QA: ${found.game.name} / ${found.game.code}`).toBe(true);
  if (found.game.status !== 1) return false;
  // Menu "..." có thể bị đóng khi bảng render lại ngay sau khi tải -> mở lại tới khi bấm được Deactivate
  await expect(async () => {
    const menu = await openRowMenu(page, found.index);
    await menu.getByText("Deactivate", { exact: true }).click({ timeout: 5000 });
  }).toPass({ timeout: 40000 });
  await expect(dialog(page)).toContainText(`Deactivate ${found.game.name}`);
  const [req, res] = await Promise.all([
    page.waitForRequest(isStatusUpdate),
    page.waitForResponse(isStatusUpdate),
    dialog(page).getByRole("button", { name: /Deactivate$/ }).click(),
  ]);
  const body = JSON.parse(req.postData());
  expect(body.gameIds, "Chỉ được Deactivate đúng game QA").toEqual([found.game.id]);
  expect(body.status).toBe(0);
  expect((await res.json()).status).toBe("success");
  await expect(dialog(page)).toBeHidden();
  return { id: found.game.id, body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Games > Games", () => {
  test.beforeEach(async ({ page }) => {
    // Bộ lọc và số dòng/trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__game_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/^[A-Za-z]+-game_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__game_spec_cleared", "1");
    });
    await openPage(page);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, đủ 7 filter và 2 nút Search/Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Games");
      for (const [label, id] of [
        ["Code", "code"],
        ["Name", "name"],
        ["Game Category", "gameCategoryId"],
        ["Game Sub Category", "gameSubCategoryIds"],
        ["Currency", "currencyIds"],
        ["Maintenance", "maintenance"],
        ["Status", "status"],
      ]) {
        await expect(filterEl(page, id), `thiếu filter ${label}`).toContainText(label);
        await expect(filterEl(page, id)).toBeVisible();
      }
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: tất cả để trống", async ({ page }) => {
      for (const id of [
        "code",
        "name",
        "gameCategoryId",
        "gameSubCategoryIds",
        "currencyIds",
        "maintenance",
        "status",
      ]) {
        await expect(
          filterEl(page, id).locator(".ant-select-selection-item"),
          `#${id} phải trống`,
        ).toHaveCount(0);
      }
    });

    test("Màn hình rộng: thanh filter và bảng hiển thị đầy đủ trong khung nhìn", async ({ page }) => {
      expect(page.viewportSize()).toEqual({ width: 1920, height: 1080 });
      // 6 filter đầu nằm trên cùng 1 hàng (cùng toạ độ y), không bị xuống dòng
      const ys = [];
      for (const id of ["code", "name", "gameCategoryId", "gameSubCategoryIds", "currencyIds", "maintenance"]) {
        ys.push(Math.round((await filterEl(page, id).boundingBox()).y));
      }
      expect(new Set(ys).size, `toạ độ y của 6 filter đầu: ${ys}`).toBe(1);
      // Các cột chính nhìn thấy được mà không cần cuộn ngang
      for (const col of ["ID", "Name", "Code", "Game Category", "Game Sub Category", "Currency", "Languages"]) {
        await expect(page.locator(".ant-table-thead th", { hasText: exact(col) }), col).toBeInViewport();
      }
    });

    test("Có nút Add New, 5 nút thao tác hàng loạt, Export và Manage Columns", async ({ page }) => {
      await expect(addBtn(page)).toBeVisible();
      await expect(bulkBtns(page)).toHaveCount(5);
      await expect(exportBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
    });

    test(`Bảng có đủ ${COLUMNS.length} cột (+ cột checkbox) đúng thứ tự`, async ({ page }) => {
      expect(await headers(page)).toEqual(HEADERS);
    });

    test("Mặc định 10 dòng / trang, sắp xếp mới nhất (id giảm dần) lên đầu", async ({ page }) => {
      const { body, json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc" });
      expect(body.filters).toEqual({ sasEntityId: [expect.any(Number)] });
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
        const g = list[i];
        const at = `dòng ${i + 1} (game ${g.id})`;
        expect(r["ID"], at).toBe(String(g.id));
        expect(r["Name"], at).toBe(norm(g.name));
        expect(r["Code"], at).toBe(norm(g.code));
        expect(r["Game Category"], at).toBe(norm(g.gameCategory));
        expect(r["Game Sub Category"], at).toBe(norm(g.gameSubCategory));
        expect(r["Currency"].replace(/\s+/g, ""), at).toBe(currencyText(g.currencies ?? []).replace(/\s+/g, ""));
        expect(r["Maintenance"], at).toBe(MAINTENANCE_TEXT[g.maintenance]);
        expect(r["Status"], at).toBe(STATUS_TEXT[g.status]);
      });
    });

    test("Cột Currency chỉ hiện tối đa 6 chip, phần còn lại gom thành '+ N ...'", async ({ page }) => {
      const { json } = await search(page);
      const i = json.data.list.findIndex((g) => (g.currencies ?? []).length > MAX_CURRENCY_CHIPS);
      test.skip(i < 0, "Không có game nào có hơn 6 currency ở trang đầu");
      const g = json.data.list[i];
      const cell = rowAt(page, i).locator("td").nth(HEADERS.indexOf("Currency"));
      await expect(cell).toContainText(`+ ${g.currencies.length - MAX_CURRENCY_CHIPS} ...`);
      for (const code of g.currencies.slice(0, MAX_CURRENCY_CHIPS)) await expect(cell).toContainText(code);
      // Currency thứ 7 trở đi không hiển thị
      await expect(cell).not.toContainText(g.currencies[MAX_CURRENCY_CHIPS]);
    });

    test("Định dạng: ID là số, Maintenance / Status hợp lệ, Game Category không trống", async ({ page }) => {
      await ensureData(page, test);
      for (const v of await columnValues(page, "ID")) expect(v).toMatch(/^\d+$/);
      for (const v of await columnValues(page, "Maintenance")) {
        expect(["Normal Operation", "Under Maintenance"]).toContain(v);
      }
      for (const v of await columnValues(page, "Status")) expect(["Active", "Inactive"]).toContain(v);
      for (const col of ["Name", "Code", "Game Category", "Game Sub Category"]) {
        for (const v of await columnValues(page, col)) expect(v, col).not.toBe("");
      }
      await expect(rowAt(page, 0).locator("td").nth(HEADERS.indexOf("Status")).locator(".ant-tag")).toBeVisible();
    });

    test("Mỗi dòng có 2 icon View / Update và nút '...'", async ({ page }) => {
      await ensureData(page, test);
      const action = rowAt(page, 0).locator("td").last();
      await expect(action.locator("svg")).toHaveCount(3); // View, Update và dấu "..." (trong nút)
      await expect(action.locator("button")).toHaveCount(1);
    });

    test("Rê chuột vào icon hiện tooltip View / Update", async ({ page }) => {
      await ensureData(page, test);
      const icons = rowAt(page, 0).locator("td").last().locator("svg");
      await hoverTip(page, icons.nth(0), "View");
      await hoverTip(page, icons.nth(1), "Update");
    });
  });

  // ===== 3. Search / Filter =====
  test.describe("Search / Filter", () => {
    for (const [label, id] of [
      ["Code", "code"],
      ["Name", "name"],
      ["Game Category", "gameCategoryId"],
      ["Game Sub Category", "gameSubCategoryIds"],
      ["Currency", "currencyIds"],
      ["Maintenance", "maintenance"],
      ["Status", "status"],
    ]) {
      test(`Dropdown ${label} load được danh sách option`, async ({ page }) => {
        expect((await dropdownOptions(page, id)).length).toBeGreaterThan(0);
      });
    }

    test("Option cố định của Maintenance và Status", async ({ page }) => {
      expect(await dropdownOptions(page, "maintenance")).toEqual(["Active", "Maintenance"]);
      expect(await dropdownOptions(page, "status")).toEqual(["Active", "Inactive"]);
    });

    test("Dropdown Code / Name có đủ option bằng số game của danh sách", async ({ page }) => {
      const { json } = await search(page);
      const total = json.data.totalCount;
      expect((await dropdownOptions(page, "code")).length).toBe(total);
      expect((await dropdownOptions(page, "name")).length).toBe(total);
    });

    test("Lọc theo Code gửi filters.ids và chỉ trả về game đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const g = json.data.list[0];
      await selectOption(page, "code", g.code);
      const { body, json: res } = await search(page);
      expect(body.filters.ids).toEqual([g.id]);
      expect(res.data.totalCount).toBe(1);
      await expect(rows(page)).toHaveCount(1);
      expect((await columnValues(page, "Code"))[0]).toBe(norm(g.code));
    });

    test("Lọc theo Name gửi filters.ids và chỉ trả về game đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const g = json.data.list[0];
      await selectOption(page, "name", g.name);
      const { body, json: res } = await search(page);
      expect(body.filters.ids).toEqual([g.id]);
      expect(res.data.totalCount).toBe(1);
      expect((await columnValues(page, "Name"))[0]).toBe(norm(g.name));
    });

    test("Lọc theo Game Category gửi gameCategoryId và mọi dòng khớp", async ({ page }) => {
      await ensureData(page, test);
      const category = (await columnValues(page, "Game Category"))[0];
      await selectOption(page, "gameCategoryId", category);
      const { body, json } = await search(page);
      expect(body.filters.gameCategoryId).toEqual([expect.any(Number)]);
      test.skip(json.data.list.length === 0, "Không có game nào thuộc category này");
      for (const v of await columnValues(page, "Game Category")) expect(v).toBe(category);
    });

    test("Lọc theo Game Sub Category gửi gameSubCategoryIds và mọi dòng khớp", async ({ page }) => {
      await ensureData(page, test);
      // Tên sub category có thể trùng nhau (vd có 2 option "4x5" khác id) -> chỉ chọn tên xuất hiện 1 lần trong danh sách
      // để chắc chắn option được chọn đúng là sub category của game trong bảng
      const options = await dropdownOptions(page, "gameSubCategoryIds");
      const sub = (await columnValues(page, "Game Sub Category")).find(
        (v) => options.filter((o) => norm(o) === v).length === 1,
      );
      test.skip(!sub, "Các game ở trang đầu đều thuộc sub category trùng tên");
      await selectOption(page, "gameSubCategoryIds", sub);
      const { body, json } = await search(page);
      expect(body.filters.gameSubCategoryIds).toHaveLength(1);
      expect(json.data.list.length).toBeGreaterThan(0);
      for (const v of await columnValues(page, "Game Sub Category")) expect(v).toBe(sub);
    });

    test("Lọc theo Currency gửi currencyIds và mọi game đều hỗ trợ currency đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const currency = json.data.list[0].currencies?.[0];
      test.skip(!currency, "Game đầu tiên chưa có currency");
      await selectOption(page, "currencyIds", currency);
      const { body, json: res } = await search(page);
      expect(body.filters.currencyIds).toHaveLength(1);
      expect(res.data.list.length).toBeGreaterThan(0);
      expect(res.data.totalCount).toBeLessThanOrEqual(json.data.totalCount);
      // LỖI BACKEND ĐÃ XÁC NHẬN: lọc theo Currency đang trả cả những game không có currency đó trong cột Currency
      // (vd lọc AFN trả 59 game nhưng 27 game không có AFN). Test này kiểm tra đúng hành vi mong đợi nên sẽ FAIL
      // cho tới khi backend sửa.
      for (const g of res.data.list) expect(g.currencies, `game ${g.id}`).toContain(currency);
    });

    for (const [label, code, text] of [
      ["Active", 0, "Normal Operation"],
      ["Maintenance", 1, "Under Maintenance"],
    ]) {
      test(`Lọc theo Maintenance = ${label} gửi maintenance=${code} và mọi dòng khớp`, async ({ page }) => {
        await selectOption(page, "maintenance", label);
        const { body, json } = await search(page);
        expect(body.filters.maintenance).toBe(code);
        test.skip(json.data.list.length === 0, `Không có game nào ở trạng thái ${label}`);
        for (const g of json.data.list) expect(g.maintenance).toBe(code);
        for (const v of await columnValues(page, "Maintenance")) expect(v).toBe(text);
      });
    }

    for (const [label, code] of [
      ["Active", 1],
      ["Inactive", 0],
    ]) {
      test(`Lọc theo Status = ${label} gửi status=${code} và mọi dòng khớp`, async ({ page }) => {
        await selectOption(page, "status", label);
        const { body, json } = await search(page);
        expect(body.filters.status).toBe(code);
        test.skip(json.data.list.length === 0, `Không có game nào ở trạng thái ${label}`);
        for (const g of json.data.list) expect(g.status).toBe(code);
        for (const v of await columnValues(page, "Status")) expect(v).toBe(label);
      });
    }

    test("Maintenance và Status chỉ chọn được 1 giá trị (chọn giá trị mới thì thay thế)", async ({ page }) => {
      await selectOption(page, "status", "Active");
      await selectOption(page, "status", "Inactive");
      expect(await selectedTitles(page, "status")).toEqual(["Inactive"]);
      await selectOption(page, "maintenance", "Active");
      await selectOption(page, "maintenance", "Maintenance");
      expect(await selectedTitles(page, "maintenance")).toEqual(["Maintenance"]);
    });

    test("Dropdown cho phép chọn nhiều giá trị (Code, Game Category, Currency)", async ({ page }) => {
      for (const [id, field] of [
        ["code", "ids"],
        ["gameCategoryId", "gameCategoryId"],
        ["currencyIds", "currencyIds"],
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
      const [category, status] = await Promise.all(
        ["Game Category", "Status"].map((c) => columnValues(page, c).then((v) => v[0])),
      );
      await selectOption(page, "gameCategoryId", category);
      await selectOption(page, "status", status);
      const { body, json } = await search(page);
      expect(body.filters).toMatchObject({
        gameCategoryId: [expect.any(Number)],
        status: status === "Active" ? 1 : 0,
      });
      test.skip(json.data.list.length === 0, "Không có kết quả cho tổ hợp filter");
      for (const r of await tableRecords(page)) {
        expect(r["Game Category"]).toBe(category);
        expect(r["Status"]).toBe(status);
      }
    });

    test("Không có kết quả -> hiển thị 'There are no entries found'", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const g = json.data.list[0];
      // Chọn đúng 1 game kèm 1 category KHÁC category của game đó -> chắc chắn không có kết quả
      const other = (await dropdownOptions(page, "gameCategoryId")).find((o) => o !== g.gameCategory);
      await selectOption(page, "name", g.name);
      await selectOption(page, "gameCategoryId", other);
      const { json: res } = await search(page);
      expect(res.data.totalCount).toBe(0);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText("There are no entries found").first()).toBeVisible();
      await expect(summary(page)).toHaveCount(0);
    });
  });

  // ===== 4. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá toàn bộ filter đã chọn và hiển thị lại toàn bộ dữ liệu", async ({ page }) => {
      await ensureData(page, test);
      const total = (await search(page)).json.data.totalCount;
      const [category, status] = await Promise.all(
        ["Game Category", "Status"].map((c) => columnValues(page, c).then((v) => v[0])),
      );
      await selectOption(page, "gameCategoryId", category);
      await selectOption(page, "status", status);
      await selectOption(page, "maintenance", "Active");
      await search(page);

      await resetBtn(page).click();
      for (const id of ["code", "name", "gameCategoryId", "gameSubCategoryIds", "currencyIds", "maintenance", "status"]) {
        await expect(filterEl(page, id).locator(".ant-select-selection-item")).toHaveCount(0);
      }

      const { body, json } = await search(page);
      expect(body.filters).toEqual({ sasEntityId: [expect.any(Number)] });
      expect(json.data.totalCount).toBe(total);
    });
  });

  // ===== 5. Phân trang =====
  test.describe("Phân trang", () => {
    test.beforeEach(async ({ page }) => {
      const total = num((await summary(page).innerText()).match(/of ([\d,]+) records/)[1]);
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
      await selectOption(page, "maintenance", "Active");
      const first = await search(page);
      test.skip(first.json.data.totalCount <= 10, "Filter chỉ có 1 trang");

      const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(body.page).toBe(2);
      expect(body.filters).toEqual(first.body.filters);
      for (const v of await columnValues(page, "Maintenance")) expect(v).toBe("Normal Operation");
    });
  });

  // ===== 6. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    const th = (page, column) => page.locator(".ant-table-thead th", { hasText: exact(column) });

    test("Sort cột ID: mặc định giảm dần, bấm lần lượt -> tăng dần -> giảm dần", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
      // Cột ID đang ở trạng thái giảm dần (mặc định): lần bấm đầu về "không sort" nên không gọi lại API
      await th(page, "ID").click();

      const asc = await reloadBy(page, () => th(page, "ID").click());
      expect(asc).toMatchObject({ sortBy: "id", sortDirection: "asc" });
      const a = (await columnValues(page, "ID")).map(Number);
      expect(a).toEqual([...a].sort((x, y) => x - y));

      const desc = await reloadBy(page, () => th(page, "ID").click());
      expect(desc).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      const d = (await columnValues(page, "ID")).map(Number);
      expect(d).toEqual([...d].sort((x, y) => y - x));
    });

    for (const [column, sortBy] of Object.entries(SORTABLE)) {
      test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");

        const asc = await reloadBy(page, () => th(page, column).click());
        expect(asc).toMatchObject({ sortBy, sortDirection: "asc" });

        const desc = await reloadBy(page, () => th(page, column).click());
        expect(desc).toMatchObject({ sortBy, sortDirection: "desc" });

        // Click lần 3: bỏ sort -> quay về mặc định id giảm dần
        const none = await reloadBy(page, () => th(page, column).click());
        expect(none).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      });
    }

    test("Cột Currency và Action không có chức năng sort", async ({ page }) => {
      for (const column of ["Currency", "Action"]) {
        await expect(th(page, column), column).not.toHaveClass(/ant-table-column-has-sorters/);
      }
    });
  });

  // ===== 7. Chọn dòng và thao tác hàng loạt =====
  test.describe("Thao tác hàng loạt (chỉ mở hộp thoại rồi đóng, không xác nhận)", () => {
    test("Chưa chọn dòng nào thì 5 nút thao tác hàng loạt bị vô hiệu", async ({ page }) => {
      for (let i = 0; i < 5; i++) await expect(bulkBtns(page).nth(i)).toBeDisabled();
    });

    test("Chọn 1 dòng thì 5 nút được bật, bỏ chọn thì tắt lại", async ({ page }) => {
      await ensureData(page, test);
      await checkRow(page, 0);
      for (let i = 0; i < 5; i++) await expect(bulkBtns(page).nth(i)).toBeEnabled();
      await rowAt(page, 0).locator('input[type="checkbox"]').uncheck();
      for (let i = 0; i < 5; i++) await expect(bulkBtns(page).nth(i)).toBeDisabled();
    });

    test("Checkbox ở tiêu đề chọn / bỏ chọn tất cả dòng của trang", async ({ page }) => {
      await ensureData(page, test);
      const all = page.getByRole("checkbox", { name: "Select all" });
      await all.check();
      const n = await rows(page).count();
      await expect(page.locator('tbody tr.ant-table-row input[type="checkbox"]:checked')).toHaveCount(n);
      await expect(bulkBtns(page).first()).toBeEnabled();
      await all.uncheck();
      await expect(page.locator('tbody tr.ant-table-row input[type="checkbox"]:checked')).toHaveCount(0);
    });

    test("Tooltip của 5 nút thao tác hàng loạt", async ({ page }) => {
      await ensureData(page, test);
      await checkRow(page, 0);
      for (const [i, b] of BULK.entries()) {
        await hoverTip(page, bulkBtns(page).nth(i), b.tip);
      }
    });

    for (const [i, b] of BULK.entries()) {
      test(`Nút ${b.label}: hộp thoại đúng nội dung, đóng bằng ${b.buttons[0]} và không gửi request ghi`, async ({
        page,
      }) => {
        const { json } = await search(page);
        // Dùng game đang Active + Normal Operation để nội dung hộp thoại xác định được
        const found = findGame(json, (g) => g.status === 1 && g.maintenance === 0);
        test.skip(!found, "Không có game Active / Normal Operation ở trang đầu");
        const writes = watchWrites(page);

        await checkRow(page, found.index);
        await bulkBtns(page).nth(i).click();

        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toContainText(b.title(found.game.name));
        await expect(dialog(page)).toContainText(b.text(found.game.name));
        for (const label of b.buttons) {
          await expect(
            dialog(page).getByRole("button", { name: new RegExp(`${label}$`) }).first(),
            label,
          ).toBeVisible();
        }

        await closeDialog(page); // chỉ Cancel / Close
        expect(writes, "Không được gửi request ghi dữ liệu").toEqual([]);
        // Dòng vẫn đang được chọn sau khi đóng hộp thoại
        await expect(rowAt(page, found.index).locator('input[type="checkbox"]')).toBeChecked();
      });
    }
  });

  // ===== 8. Menu "..." của từng dòng =====
  test.describe("Menu '...' của dòng", () => {
    test("Game Active / Normal Operation có đủ 6 mục", async ({ page }) => {
      const { json } = await search(page);
      const found = findGame(json, (g) => g.status === 1 && g.maintenance === 0);
      test.skip(!found, "Không có game Active / Normal Operation ở trang đầu");
      const menu = await openRowMenu(page, found.index);
      expect(await menuItems(menu)).toEqual([
        "Download",
        "Set to Maintenance",
        "Deactivate",
        "Update Game Setting",
        "Notify Update",
        "Agent-Level Game Status",
      ]);
    });

    test("Game đang Maintenance có mục End Maintenance thay cho Set to Maintenance", async ({ page }) => {
      await selectOption(page, "maintenance", "Maintenance");
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có game nào đang Maintenance");
      const items = await menuItems(await openRowMenu(page, 0));
      expect(items).toContain("End Maintenance");
      expect(items).not.toContain("Set to Maintenance");
    });

    test("Game Inactive có mục Activate thay cho Deactivate", async ({ page }) => {
      await selectOption(page, "status", "Inactive");
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có game nào Inactive");
      const items = await menuItems(await openRowMenu(page, 0));
      expect(items).toContain("Activate");
      expect(items).not.toContain("Deactivate");
    });

    test("Update Game Setting mở hộp thoại Game Settings, đóng bằng Cancel và không gửi request ghi", async ({
      page,
    }) => {
      await ensureData(page, test);
      const writes = watchWrites(page);
      const menu = await openRowMenu(page, 0);
      await menu.getByText("Update Game Setting", { exact: true }).click();

      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText("Game Settings");
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /OK$/ })).toBeVisible();

      await closeDialog(page); // chỉ Cancel, KHÔNG bấm OK
      expect(writes, "Không được gửi request ghi dữ liệu").toEqual([]);
    });

    test("Agent-Level Game Status mở hộp thoại cấu hình theo Agent, có bảng Agent Name / Currency", async ({
      page,
    }) => {
      await ensureData(page, test);
      const menu = await openRowMenu(page, 0);
      await menu.getByText("Agent-Level Game Status", { exact: true }).click();

      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText("Agent-Level Game Status Configuration");
      const heads = (await dialog(page).locator("th").allInnerTexts()).map((t) => t.trim());
      expect(heads).toEqual(expect.arrayContaining(["Agent Name", "Currency"]));
      expect(await dialog(page).locator("tbody tr").count()).toBeGreaterThan(0);

      await page.locator(".ant-modal-close").last().click(); // đóng bằng nút X, không lưu gì
      await expect(dialog(page)).toBeHidden();
    });
  });

  // ===== 9. Điều hướng sang màn hình con =====
  test.describe("Điều hướng", () => {
    test("Icon View mở trang chi tiết game", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const g = json.data.list[0];
      await rowAt(page, 0).locator("td").last().locator("svg").nth(0).click();
      await expect(page).toHaveURL(new RegExp(`/vendors/game/view/${g.id}$`));
      await expect(breadcrumb(page)).toContainText("Game Details");
      await expect(page.getByText(g.name, { exact: true }).first()).toBeVisible();
    });

    test("Icon Update mở trang cập nhật game", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const g = json.data.list[0];
      await rowAt(page, 0).locator("td").last().locator("svg").nth(1).click();
      await expect(page).toHaveURL(new RegExp(`/game/update/${g.id}$`));
      await expect(breadcrumb(page)).toContainText("Update Game");
    });

    test("Nút Add New mở trang tạo game", async ({ page }) => {
      await addBtn(page).click();
      await expect(page).toHaveURL(/\/game\/create-game$/);
      await expect(breadcrumb(page)).toContainText("Create Game");
    });
  });

  // ===== 9b. Tạo game =====
  // Trang /game/create-game: wizard 5 bước (Basic Information -> Currency -> Agent Assignment -> Paytable -> Review & Submit).
  // Backend (quan sát khi khám phá): Name chỉ chấp nhận chữ + số và các ký tự . , - ' (KHÔNG có "_" và khoảng trắng) nhưng form không
  // kiểm tra; Code 3-50 ký tự chữ + số + "_"; game phải có >= 1 paytable (form cho Next khi chưa có) kèm Help Page.
  test.describe("Tạo game", () => {
    // Giá trị QA dùng chung cho các test tạo game thật (mỗi worker 1 bộ giá trị)
    const stamp = Date.now();
    const qa = { name: `QA-${stamp}`, code: `QA_${stamp}`, hitRate: "12.5" };
    // Mọi game QA thực sự được tạo ra (kể cả khi server vô tình chấp nhận dữ liệu sai) để dọn dẹp ở afterAll
    const qaGames = [];

    // ---------- Validate form: KHÔNG tạo dữ liệu, luôn chạy ----------
    test.describe("Validate form tạo game (không ghi dữ liệu)", () => {
      let writes;
      test.beforeEach(async ({ page }) => {
        writes = watchWrites(page);
        await startCreate(page);
      });
      test.afterEach(async () => {
        expect(writes, "Không được gửi request ghi dữ liệu").toEqual([]);
      });

      test("Có tiêu đề 'Games > Create Game', thanh 5 bước và 2 nút Cancel / Next", async ({ page }) => {
        await expect(breadcrumb(page)).toContainText("Games");
        await expect(breadcrumb(page)).toContainText("Create Game");
        const steps = (await page.locator(".ant-steps-item").allInnerTexts()).map(norm);
        expect(steps).toHaveLength(5);
        CREATE_STEPS.forEach((name, i) => expect(steps[i]).toContain(name));
        expect(await activeStep(page)).toBe(1);
        await expect(cancelBtn(page)).toBeVisible();
        await expect(nextBtn(page)).toBeVisible();
        await expect(prevBtn(page)).toHaveCount(0);
      });

      test("Có đủ các trường, trường bắt buộc có dấu *, Status mặc định Active", async ({ page }) => {
        for (const label of [
          "Name",
          "Code",
          "Game Category",
          "Game Sub Category",
          "Engine",
          "Win Formula",
          "Hit Rate",
          "Volatility",
          "Language",
          "Features",
          "Themes",
          "Labels",
          "Tags",
          "Status",
          "Landscape Image",
          "Square Image",
        ]) {
          await expect(formItem(page, label), `thiếu trường ${label}`).toBeVisible();
        }
        for (const label of ["Name", "Code", "Game Category", "Game Sub Category", "Engine", "Win Formula", "Status"]) {
          await expect(formItem(page, label).locator(".ant-form-item-required"), `${label} phải bắt buộc`).toHaveCount(1);
        }
        for (const label of ["Hit Rate", "Volatility", "Language", "Features", "Themes", "Labels", "Tags"]) {
          await expect(formItem(page, label).locator(".ant-form-item-required"), `${label} không bắt buộc`).toHaveCount(0);
        }
        await expect(page.locator('input[type="radio"][value="1"]')).toBeChecked();
        await expect(page.locator('input[type="radio"][value="0"]')).not.toBeChecked();
        // Code và Engine sửa được khi tạo mới (khác màn hình Update)
        await expect(page.locator("#code")).toBeEnabled();
        await expect(page.locator("#engine")).toBeEnabled();
      });

      test("Submit rỗng (Next khi để trống): báo lỗi từng trường bắt buộc và ở lại bước 1", async ({ page }) => {
        await nextBtn(page).click();
        await expect(formErrors(page, "Name")).toHaveText("Please enter Name");
        await expect(formErrors(page, "Code")).toHaveText("Please enter Code");
        await expect(formErrors(page, "Game Category")).toHaveText("Please enter Game Category");
        await expect(formErrors(page, "Game Sub Category")).toHaveText("Please enter Game Sub Category");
        await expect(formErrors(page, "Engine")).toHaveText("Please enter Engine");
        await expect(formErrors(page, "Win Formula")).toHaveText("This field is required");
        // Các trường không bắt buộc không báo lỗi
        for (const label of ["Hit Rate", "Volatility", "Language", "Features", "Themes", "Labels", "Tags"]) {
          await expect(formErrors(page, label), label).toHaveCount(0);
        }
        expect(await activeStep(page)).toBe(1);
      });

      test("Mỗi trường bắt buộc để trống riêng lẻ vẫn chặn Next (điền các trường còn lại)", async ({ page }) => {
        const filled = {};
        await fillBasic(page, filled, { optional: false });
        // Xoá Name -> lỗi Name, không sang được bước 2
        await page.locator("#name").fill("");
        await nextBtn(page).click();
        await expect(formErrors(page, "Name")).toHaveText("Please enter Name");
        expect(await activeStep(page)).toBe(1);
        await page.locator("#name").fill(`QA-${stamp}`);
        // Xoá Code -> lỗi Code
        await page.locator("#code").fill("");
        await nextBtn(page).click();
        // Khi xoá Code đã nhập, ô báo cả "Please enter Code" lẫn lỗi định dạng "entity code must be alphanumeric..."
        await expect(formErrors(page, "Code").filter({ hasText: "Please enter Code" })).toHaveCount(1);
        expect(await activeStep(page)).toBe(1);
      });

      test("Win Formula: Save khi chưa nhập báo 'This field is required' ở cả 11 ô, nhập đủ rồi Save thì ô hiện View Details", async ({
        page,
      }) => {
        await page.locator("#winFormula").click();
        await expect(dialog(page)).toContainText("Win Formula");
        await expect(dialog(page).locator("input[id^='wf']")).toHaveCount(11); // 5 mức có min + max, Ultra chỉ có min
        await dialog(page).getByRole("button", { name: "Save", exact: true }).click();
        await expect(dialog(page).locator(".ant-form-item-explain-error")).toHaveCount(11);
        await expect(dialog(page)).toBeVisible(); // không đóng khi còn lỗi
        for (const [tier, [min, max]] of Object.entries(WIN_TIERS)) {
          await dialog(page).locator(`#wf${tier}Min`).fill(String(min));
          if (max != null) await dialog(page).locator(`#wf${tier}Max`).fill(String(max));
        }
        await expect(dialog(page).locator(".ant-form-item-explain-error")).toHaveCount(0);
        await dialog(page).getByRole("button", { name: "Save", exact: true }).click();
        await expect(dialog(page)).toBeHidden();
        await expect(page.locator("#winFormula")).toHaveValue("View Details");
        await expect(formErrors(page, "Win Formula")).toHaveCount(0);
      });

      test("Code: chỉ chữ + số + '_' (khoảng trắng, '-' bị từ chối), 'A_b1' hợp lệ", async ({ page }) => {
        for (const v of ["has space", "ab-cd"]) {
          await page.locator("#code").fill(v);
          await page.locator("#code").blur();
          await expect(formErrors(page, "Code"), v).toHaveText(
            "The entity code must be alphanumeric or contain the '_' character",
          );
        }
        await page.locator("#code").fill("A_b1");
        await page.locator("#code").blur();
        await expect(formErrors(page, "Code")).toHaveCount(0);
      });

      test("Code trùng với game có sẵn báo 'Game code is already existed' (validate/game/code)", async ({ page }) => {
        // Code lấy từ chính danh sách game (dòng đầu tiên) - chỉ ĐỌC, không sửa gì
        await cancelBtn(page).click();
        await expect(page).toHaveURL(/\/game$/);
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const existing = json.data.list[0].code;
        await startCreate(page);
        const [res] = await Promise.all([
          page.waitForResponse((r) => reqOf(r).url().endsWith("/validate/game/code")),
          page.locator("#code").fill(existing).then(() => page.locator("#code").blur()),
        ]);
        expect((await res.json()).messageCode).toBe("DUPLICATE_GAME_CODE");
        await expect(formErrors(page, "Code")).toHaveText("Game code is already existed");
      });

      test("Hit Rate: 0.001 / 12.5 hợp lệ; 100, 101, -1 báo lỗi khoảng giá trị", async ({ page }) => {
        for (const v of ["0.001", "12.5", "99.99"]) {
          await page.locator("#hitrate").fill(v);
          await page.locator("#hitrate").blur();
          await expect(formErrors(page, "Hit Rate"), v).toHaveCount(0);
        }
        for (const v of ["100", "101", "-1"]) {
          await page.locator("#hitrate").fill(v);
          await page.locator("#hitrate").blur();
          await expect(formErrors(page, "Hit Rate").filter({ hasText: HIT_RATE_ERROR }), v).toHaveCount(1);
        }
      });

      test("Status chọn lại Inactive thì đổi trên form", async ({ page }) => {
        await page.locator('input[type="radio"][value="0"]').check();
        await expect(page.locator('input[type="radio"][value="0"]')).toBeChecked();
        await expect(page.locator('input[type="radio"][value="1"]')).not.toBeChecked();
      });

      test("Chọn Game Category thì Game Sub Category chỉ liệt kê sub category của category đó", async ({ page }) => {
        const [res] = await Promise.all([
          page.waitForResponse(
            (r) => reqOf(r).url().endsWith("/game/game_sub_category/list") && /"gameCategoryIds":\[\d/.test(reqOf(r).postData() || ""),
          ),
          pickOption(page, "Game Category"),
        ]);
        const subs = (await res.json()).data.list;
        expect(subs.length).toBeGreaterThan(0);
        const category = JSON.parse(reqOf(res).postData()).filters.gameCategoryIds[0];
        for (const s of subs) expect(s.gameCategoryId).toBe(category);
        await formItem(page, "Game Sub Category").locator(".ant-select-selector").click();
        await expect(openOptions(page).first()).toBeVisible();
        const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
        // Danh sách ảo: chỉ kiểm tra các option đang render đều thuộc sub category của category đã chọn
        for (const t of titles) expect(subs.map((s) => s.name)).toContain(t);
        await clickOutside(page);
      });

      test("Bước Currency: Next khi chưa thêm currency báo 'Please ensure at least 1 currency is added'", async ({ page }) => {
        await fillBasic(page, {}, { optional: false });
        await goToCurrencyStep(page);
        await nextBtn(page).click();
        await expect(
          page.locator(".ant-form-item-explain-error").filter({ hasText: "Please ensure at least 1 currency is added" }),
        ).toHaveCount(1);
        expect(await activeStep(page)).toBe(2);
      });

      test("Bước Currency: thêm currency có denom thì denom mặc định được chọn sẵn, Min / Max Bet khớp, Next sang bước 3", async ({
        page,
      }) => {
        await fillBasic(page, {}, { optional: false });
        const ctx = await goToCurrencyStep(page);
        const cur = await addCurrencyWithDenom(page, ctx);
        test.skip(!cur, "Server không trả denom nào cho sub category đã chọn (denomination/dropdown trả mảng rỗng)");
        const heads = await headers(page);
        const cells = (await rows(page).first().locator("td").allInnerTexts()).map(norm);
        expect(cells[heads.indexOf("Currency")]).toBe(cur.currency);
        expect(cells[heads.indexOf("Denom name")]).toContain(cur.denom.name);
        expect(num(cells[heads.indexOf("Min Bet")])).toBeCloseTo(cur.denom.minBet, 4);
        expect(num(cells[heads.indexOf("Max Bet")])).toBeCloseTo(cur.denom.maxBet, 4);
        await goToStep(page, 3);
        await expect(rows(page).filter({ hasText: cur.currency })).toHaveCount(1);
      });

      test("Bước Paytable: thiếu Help Page thì báo 'Please enter help page content' và không sang bước 5", async ({ page }) => {
        const qaLocal = { code: `QA_${Date.now()}` };
        await fillBasic(page, qaLocal, { optional: false });
        const ctx = await goToCurrencyStep(page);
        const cur = await addCurrencyWithDenom(page, ctx);
        test.skip(!cur, "Server không trả denom nào cho sub category đã chọn");
        await goToStep(page, 4);
        await addPaytable(page, qaLocal, { help: false });
        await nextBtn(page).click();
        await expect(page.getByText("Please enter help page content")).toBeVisible();
        expect(await activeStep(page)).toBe(4);
      });

      test("Cancel quay về danh sách game, không cần xác nhận", async ({ page }) => {
        await page.locator("#name").fill(`QA-${stamp}`); // đã nhập dở vẫn thoát được
        await cancelBtn(page).click();
        await expect(page).toHaveURL(/\/game$/);
        await expect(breadcrumb(page)).toHaveText("Games");
      });
    });

    // ---------- Tạo game thật (ghi dữ liệu): chỉ chạy khi RUN_FULL_TESTS=true ----------
    test.describe("Tạo game thật và dọn dẹp (cần RUN_FULL_TESTS=true)", () => {
      test.skip(!RUN_FULL_TESTS, SKIP_WRITE_REASON);
      // Các test phụ thuộc nhau (tạo -> tìm -> xem -> Deactivate)
      test.describe.configure({ mode: "serial" });

      test("Điền đủ field bắt buộc + tuỳ chọn rồi Submit: tạo game thành công (toast, request / response, về /game)", async ({
        page,
      }) => {
        test.setTimeout(240000);
        const cur = await reachReview(page, qa);
        test.skip(!cur, "Server không trả denom nào cho sub category đã chọn (denomination/dropdown trả mảng rỗng)");

        // Trang Review hiển thị đúng dữ liệu đã nhập
        const main = page.locator("main");
        for (const text of [qa.name, qa.code, qa.category, qa.subCategory, qa.engine, cur.currency, cur.denomName, qa.paytable]) {
          await expect(main, text).toContainText(text);
        }
        await expect(main).toContainText("Active");

        const [req, res] = await Promise.all([
          page.waitForRequest(isCreate),
          page.waitForResponse(isCreate),
          submitBtn(page).click(),
        ]);
        const json = await res.json();
        if (json.status === "success") qaGames.push(qa); // để dọn dẹp dù các test sau fail

        // Request: đúng dữ liệu đã nhập
        const body = JSON.parse(req.postData());
        expect(body.name).toBe(qa.name);
        expect(body.code).toBe(qa.code);
        expect(body.categoryId).toEqual(expect.any(Number));
        expect(body.subCategoryId).toEqual(expect.any(Number));
        expect(body.engine).toEqual(expect.any(Number));
        expect(body.status).toBe(1);
        expect(Number(body.hitrate)).toBe(Number(qa.hitRate));
        const tiers = JSON.parse(body.winFormula).tiers;
        expect(tiers.map((t) => [t.name, t.min, t.max ?? null])).toEqual(
          Object.entries(WIN_TIERS).map(([n, [min, max]]) => [n.toUpperCase(), min, max ?? null]),
        );
        expect(body.currencyInfoList).toHaveLength(1);
        expect(body.currencyInfoList[0]).toMatchObject({ id: cur.currencyId, denominationId: cur.denom.id });
        expect(body.payTableInfoList).toHaveLength(1);
        expect(body.payTableInfoList[0]).toMatchObject({ code: qa.paytable, isDefault: 1, rtp: "MEDIUM" });

        // Response: thành công
        expect(res.status()).toBe(200);
        expect(json.status).toBe("success");
        expect(json.messageCode).toBe("CREATE_GAME_SUCCESS");
        // Toast thành công và chuyển về danh sách game
        await expect(toast(page).filter({ hasText: "Game created successfully" })).toBeVisible();
        await expect(page).toHaveURL(/\/game$/);
        await expect(breadcrumb(page)).toHaveText("Games");
      });

      test("Game QA mới có trong danh sách khi lọc theo Code và theo Name, đúng dữ liệu đã nhập", async ({ page }) => {
        test.setTimeout(180000);
        test.skip(!qaGames.includes(qa), "Chưa tạo được game QA ở test trước");

        // Lọc theo Code
        const byCode = await findQaGame(page, qa, "code");
        expect(byCode.found, `Không thấy game ${qa.code} trong danh sách`).not.toBeNull();
        expect(byCode.body.filters.ids).toEqual([byCode.found.game.id]);
        expect(byCode.json.data.totalCount).toBe(1);
        const g = byCode.found.game;
        qa.id = g.id;
        expect(g).toMatchObject({ name: qa.name, code: qa.code, status: 1, maintenance: 0 });
        await expect(rows(page)).toHaveCount(1);
        const rec = (await tableRecords(page))[0];
        expect(rec.ID).toBe(String(g.id));
        expect(rec.Name).toBe(qa.name);
        expect(rec.Code).toBe(qa.code);
        expect(rec["Game Category"]).toBe(qa.category);
        expect(rec["Game Sub Category"]).toBe(qa.subCategory);
        expect(rec.Currency).toBe(qa.currencyInfo.currency);
        expect(rec.Volatility).toBe(qa.volatility);
        // Cột Languages hiện mã ngôn ngữ viết HOA (vd "AM" cho "Amharic"), response gửi mã thường (["am"])
        expect(g.languages).toHaveLength(1);
        expect(rec.Languages).toBe(g.languages[0].toUpperCase());
        expect(rec.Maintenance).toBe(MAINTENANCE_TEXT[0]);
        expect(rec.Status).toBe(STATUS_TEXT[1]);
        for (const empty of ["Labels", "Features", "Themes", "Tags"]) expect(rec[empty], empty).toBe("");

        // Lọc theo Name (tải lại trang để dropdown Name nạp game mới)
        const byName = await findQaGame(page, qa, "name");
        expect(byName.found, `Không thấy game ${qa.name} khi lọc theo Name`).not.toBeNull();
        expect(byName.body.filters.ids).toEqual([g.id]);
        expect(byName.json.data.totalCount).toBe(1);
        expect((await columnValues(page, "Name"))[0]).toBe(qa.name);
      });

      test("Code của game QA đã tạo không dùng lại được (form báo trùng, không sang bước 2)", async ({ page }) => {
        test.skip(!qaGames.includes(qa), "Chưa tạo được game QA ở test trước");
        // Tạo lần 2 với cùng Code: form báo trùng (validate/game/code) và không cho sang bước 2
        await startCreate(page);
        await page.locator("#name").fill(`QA-${stamp}-dup`);
        const [res] = await Promise.all([
          page.waitForResponse((r) => reqOf(r).url().endsWith("/validate/game/code")),
          page.locator("#code").fill(qa.code).then(() => page.locator("#code").blur()),
        ]);
        expect((await res.json()).messageCode).toBe("DUPLICATE_GAME_CODE");
        await expect(formErrors(page, "Code")).toHaveText("Game code is already existed");
        await nextBtn(page).click();
        expect(await activeStep(page)).toBe(1);
      });

      test("Màn hình Update của game QA hiển thị đúng dữ liệu đã tạo (game/view)", async ({ page }) => {
        test.setTimeout(180000);
        test.skip(!qaGames.includes(qa), "Chưa tạo được game QA ở test trước");
        const { found } = await findQaGame(page, qa);
        expect(found).not.toBeNull();
        const [viewRes] = await Promise.all([
          page.waitForResponse(isView),
          rowAt(page, found.index).locator("td").last().locator("svg").nth(1).click(),
        ]);
        await expect(page).toHaveURL(new RegExp(`/game/update/${found.game.id}$`));
        const v = (await viewRes.json()).data;
        expect(v).toMatchObject({ id: found.game.id, name: qa.name, code: qa.code, status: 1 });
        expect(v.gameCategory.label).toBe(qa.category);
        expect(v.gameSubCategory.label).toBe(qa.subCategory);
        expect(Number(v.hitrate)).toBe(Number(qa.hitRate));
        expect(JSON.parse(v.winFormula).tiers).toHaveLength(Object.keys(WIN_TIERS).length);
        expect(v.currencyInfoList).toHaveLength(1);
        expect(v.currencyInfoList[0]).toMatchObject({
          code: qa.currencyInfo.currency,
          denomName: qa.currencyInfo.denom.name,
        });
        expect(v.payTableInfoList).toHaveLength(1);
        expect(v.payTableInfoList[0].code).toBe(qa.paytable);
        // Form hiển thị đúng giá trị
        await expect(page.locator("#name")).toHaveValue(qa.name);
        await expect(page.locator("#code")).toHaveValue(qa.code);
        await expect(page.locator("#hitrate")).toHaveValue(qa.hitRate);
        await expect(formItem(page, "Engine").locator(".ant-select-selection-item[title]")).toHaveAttribute("title", qa.engine);
        await cancelBtn(page).click(); // không sửa gì
        await expect(page).toHaveURL(/\/game$/);
      });

      test("Dọn dẹp: Deactivate game QA vừa tạo (màn hình không có Delete) và game chuyển Inactive", async ({ page }) => {
        test.setTimeout(180000);
        test.skip(!qaGames.includes(qa), "Chưa tạo được game QA ở test trước");
        const done = await deactivateQaGame(page, qa);
        expect(done, "Game QA phải đang Active để Deactivate").toBeTruthy();
        await expect(toast(page).filter({ hasText: "Game status successfully updated" })).toBeVisible();
        // Tải lại danh sách: game QA đã Inactive
        const { found } = await findQaGame(page, qa);
        expect(found.game.status).toBe(0);
        expect((await tableRecords(page))[0].Status).toBe(STATUS_TEXT[0]);
        // Menu của game Inactive có Activate thay cho Deactivate
        const items = await menuItems(await openRowMenu(page, found.index));
        expect(items).toContain("Activate");
        expect(items).not.toContain("Deactivate");
        qa.cleaned = true;
        qaGames.splice(qaGames.indexOf(qa), 1); // đã dọn xong, afterAll không cần làm gì
      });
    });

    // ---------- Server từ chối dữ liệu sai: có gửi request tạo nhưng KHÔNG tạo game ----------
    test.describe("Server từ chối dữ liệu sai khi Submit (cần RUN_FULL_TESTS=true)", () => {
      test.skip(!RUN_FULL_TESTS, SKIP_WRITE_REASON);

      test("Name có ký tự '_' bị server từ chối (VALIDATION_FAILED), ở lại trang tạo game và hiện toast lỗi", async ({
        page,
      }) => {
        test.setTimeout(240000);
        const bad = { name: `QA_${stamp}_n`, code: `QA_${stamp}01`, hitRate: "12.5" };
        const cur = await reachReview(page, bad, { optional: false });
        test.skip(!cur, "Server không trả denom nào cho sub category đã chọn");
        const [res] = await Promise.all([page.waitForResponse(isCreate), submitBtn(page).click()]);
        const json = await res.json();
        if (json.status === "success") qaGames.push(bad); // phòng khi server vô tình chấp nhận: dọn ở afterAll của nhóm kia
        expect(json.status).toBe("fail");
        expect(json.messageCode).toBe("VALIDATION_FAILED");
        expect(json.validation.Name).toEqual(["Name must be alphanumeric or contain the symbols . , - ' character"]);
        await expect(toast(page).filter({ hasText: "Validation failed" })).toBeVisible();
        await expect(page).toHaveURL(/\/game\/create-game$/);
        expect(await activeStep(page)).toBe(5);
      });

      test("Không có paytable nào bị server từ chối ('PayTableInfoList cannot be empty') dù form cho Next", async ({ page }) => {
        test.setTimeout(240000);
        const bad = { name: `QA-${stamp}-p`, code: `QA_${stamp}02`, hitRate: "12.5" };
        const cur = await reachReview(page, bad, { optional: false, paytable: false });
        test.skip(!cur, "Server không trả denom nào cho sub category đã chọn");
        const [res] = await Promise.all([page.waitForResponse(isCreate), submitBtn(page).click()]);
        const json = await res.json();
        if (json.status === "success") qaGames.push(bad);
        expect(json.status).toBe("fail");
        expect(json.validation.PayTableInfoList).toEqual(["PayTableInfoList cannot be empty"]);
        await expect(toast(page).filter({ hasText: "Validation failed" })).toBeVisible();
        await expect(page).toHaveURL(/\/game\/create-game$/);
      });
    });

    // Dọn nốt mọi game QA còn Active (vd khi 1 test phía trước fail trước bước "Dọn dẹp", hoặc server vô tình chấp
    // nhận dữ liệu sai ở nhóm "Server từ chối"). Game đã dọn xong được bỏ khỏi qaGames nên thường không làm gì.
    test.afterAll(async ({ browser, baseURL }) => {
      if (!qaGames.length) return;
      test.setTimeout(180000);
      const context = await browser.newContext({ baseURL, storageState: buildStorageState(), viewport: { width: 1920, height: 1080 } });
      try {
        for (const g of [...qaGames]) {
          const page = await context.newPage();
          await deactivateQaGame(page, g);
          await page.close();
        }
      } finally {
        await context.close();
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

    test("Popover liệt kê đủ cột", async ({ page }) => {
      await columnBtn(page).click();
      const names = await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items")
        .allInnerTexts();
      expect(names.map((n) => n.trim())).toEqual(COLUMNS);
    });

    test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Tags").locator("label").click();
      expect(await headers(page)).not.toContain("Tags");
      expect(await headers(page)).toHaveLength(HEADERS.length - 1);

      await item(page, "Tags").locator("label").click();
      expect(await headers(page)).toEqual(HEADERS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      await ensureData(page, test);
      const before = await columnValues(page, "Name");
      await columnBtn(page).click();
      await item(page, "Tags").locator("label").click();
      expect(await columnValues(page, "Name")).toEqual(before);
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

    test("Export tạo job tải xuống (module GAMES, section GAME_LIST) gồm toàn bộ cột", async ({ page }) => {
      const { body, payload } = await exportAndCheck(page);
      expect(body.module).toBe("GAMES");
      expect(body.section).toBe("GAME_LIST");
      expect(body.timezoneId).toEqual(expect.any(Number));
      expect(payload.filters.sasEntityId).toEqual([expect.any(Number)]);
      expect(payload.filters.fields).toEqual(COLUMNS);
    });

    test("Export đi kèm đúng filter hiện tại", async ({ page }) => {
      await selectOption(page, "status", "Inactive");
      await search(page);
      const { payload } = await exportAndCheck(page);
      expect(payload.filters.status).toBe(0);
    });

    test("Export chỉ chứa các cột đang hiển thị", async ({ page }) => {
      await columnBtn(page).click();
      await columnPopover(page)
        .locator(".NextGen-popover-manage-column__list__items", { hasText: exact("Tags") })
        .locator("label")
        .click();

      const [req] = await Promise.all([page.waitForRequest(isDownload), exportBtn(page).click()]);
      const payload = JSON.parse(JSON.parse(req.postData()).payload);
      expect(payload.filters.fields).not.toContain("Tags");
      expect(payload.filters.fields).toContain("Name");
    });
  });

  // ===== 12. Ghi nhớ filter =====
  test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
    await ensureData(page, test);
    const category = (await columnValues(page, "Game Category"))[0];
    await selectOption(page, "gameCategoryId", category);
    await selectOption(page, "status", "Active");
    await search(page);
    await page.locator(".ant-pagination-options .ant-select").click();
    await reloadBy(page, () =>
      page
        .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option", {
          hasText: "20 / page",
        })
        .click(),
    );

    await openPage(page); // reload
    expect(await selectedTitles(page, "gameCategoryId")).toEqual([category]);
    expect(await selectedTitles(page, "status")).toEqual(["Active"]);
    await expect(page.locator(".ant-pagination-options")).toContainText("20 / page");
  });
});
