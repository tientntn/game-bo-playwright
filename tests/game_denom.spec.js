// Games > Denominations  (https://dev-bo.royaledge.io/game/denom)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/game_denom.spec.js --project=setup --project=chromium
//
// Màn hình quản lý Denomination (mệnh giá cược) theo từng loại game. Cấu trúc:
//   - 4 tab Denom Type (Slot game / Mini game / Crash game / Card game);
//   - mỗi tab có 1 dãy nút radio Game Sub Category (lấy từ game_sub_category/list_by_denom_type), mặc định chọn nút đầu;
//   - bảng liệt kê TẤT CẢ Currency (có phân trang 10/20/50/100/200 dòng) kèm số Denom và Denom mặc định của
//     Game Sub Category đang chọn: cột Currencies / No. of Denom List / Default Denom Name (cả 3 cột đều sort được);
//   - filter Currencies (chọn nhiều) + Name (khớp Default Denom Name); nút Upload (nhập CSV) và Manage Columns.
// Không có checkbox chọn dòng, không có Export. Bấm vào tên Currency mở màn hình chi tiết
// /game/denom/view/{gameSubCategoryId}/{currencyId} (danh sách denom của Currency đó, có Add New / Edit / Delete / Submit).
//
// Màn hình có các thao tác GHI dữ liệu thật: Upload > Confirm (nhập CSV tạo / cập nhật denom), Add New / Edit / Delete / Submit
// ở màn hình chi tiết. Test KHÔNG bấm Confirm / Submit / Delete / Add New / Edit: chỉ mở hộp thoại Upload, kiểm tra nội dung
// và validation phía client (file sai định dạng -> báo lỗi, Confirm bị khoá), rồi bấm Cancel / Close. Ở màn hình chi tiết chỉ
// đọc dữ liệu, mở hộp thoại xem (icon con mắt) và bấm Cancel. Mọi test đều có watchWrites + blockWrites (chặn thêm 1 lớp bảo hiểm)
// và kiểm tra không có request ghi dữ liệu nào được gửi đi.
// "Download file" trong hộp thoại Upload tạo file mẫu CSV ngay trên trình duyệt (blob, không gọi API, không tạo bản ghi).
// Không hard-code dữ liệu - mọi giá trị lấy từ chính dòng đầu tiên của danh sách / response dropdown.
const fs = require("fs");
const { test, expect } = require("@playwright/test");

test.use({ viewport: { width: 1920, height: 1080 } });

const URL = "/game/denom";

// Đúng thứ tự hiển thị (không có cột checkbox / Action)
const COLUMNS = ["Currencies", "No. of Denom List", "Default Denom Name"];

// Các cột đều sort được -> tên field gửi lên API (mặc định sort theo currency tăng dần)
const SORTABLE = {
  Currencies: "currency",
  "No. of Denom List": "noOfDenomList",
  "Default Denom Name": "defaultDenom",
};

// Tab Denom Type theo đúng thứ tự: mã gửi lên list_by_denom_type, tiền tố tên file mẫu / tiêu đề hộp thoại Upload, số cột "Level n" của file mẫu
const TABS = [
  { name: "Slot game", code: "1", prefix: "Slot", levels: 6 },
  { name: "Mini game", code: "2", prefix: "Mini", levels: 6 },
  { name: "Crash game", code: "3", prefix: "Crash", levels: 4 },
  { name: "Card game", code: "4", prefix: "Card", levels: 5 },
];

// Request đọc dữ liệu (mọi POST còn lại coi là ghi)
const READ = /\/(list|list_by_[a-z_]+|details|download|view|dropdown|validate_[a-z_]+)$|\/dropdown\/|\/user\/details$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const isList = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/denomination/list");
// Request list đã có gameSubCategoryId. Khi mở trang lần đầu (chưa có gì được ghi nhớ) hoặc khi đổi tab, app gửi thêm 1 request list
// "mồ côi" chưa có gameSubCategoryId trước khi nạp danh sách Game Sub Category -> chỉ chờ request có gameSubCategoryId.
const isListSub = (r) => isList(r) && /"gameSubCategoryId"/.test(reqOf(r).postData() || "");
// Request list theo điều kiện trên body (dùng khi cần loại request list "thừa" gửi lặp lại của thao tác trước)
const isListWhere = (pred) => (r) => isList(r) && pred(JSON.parse(reqOf(r).postData() || "{}"));
const isSubCategories = (r) =>
  reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/game/game_sub_category/list_by_denom_type");
const isCurrencyDropdown = (r) => reqOf(r).url().endsWith("/dropdown/currency");
const isDetail = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/denomination/view/list");

const rows = (page) => page.locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const currencyLink = (page, i) => rowAt(page, i).locator("td").first().locator("a");

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const uploadBtn = (page) => page.getByRole("button", { name: /Upload$/ });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const exportBtn = (page) => page.locator("button.NextGen-export-button");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const dialog = (page) => page.getByRole("dialog");
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");

// Tab Denom Type và dãy nút radio Game Sub Category
const tabEl = (page, name) => page.getByRole("tab", { name });
const activeTab = (page) => page.locator(".ant-tabs-tab-active");
const radios = (page) => page.locator(".ant-radio-button-wrapper");
const radioAt = (page, name) => radios(page).filter({ hasText: exact(name) });
const checkedRadio = (page) => page.locator(".ant-radio-button-wrapper-checked");

// Phần tử bao 1 filter (theo id của input bên trong)
const filterEl = (page, id) =>
  page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
}

// Chờ bảng render xong và mạng yên (networkidle).
// LƯU Ý (UI, khám phá bằng MCP): khi mới mở trang / đổi tab / đổi filter, app đôi khi gửi thêm request list thừa (không có
// gameSubCategoryId hoặc giống hệt nhau) cách nhau vài trăm ms. Request thừa có thể bị nhầm là request của thao tác kế tiếp
// (sort / đổi trang / search) -> chờ mạng yên sau mỗi lần gọi để loại request thừa này.
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
}

// Mở màn hình và chờ lần load đầu tiên (đã có gameSubCategoryId) xong
async function openPage(page) {
  test.setTimeout(90000);
  const firstLoad = page.waitForResponse(isListSub, { timeout: 60000 });
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
  await expect(page.locator(".NextGen-filter-bar")).toBeVisible();
  await expect(checkedRadio(page)).toHaveCount(1);
  await settle(page);
}

// Thực hiện 1 hành động làm bảng gọi lại API (search, đổi trang, sort...) rồi trả về { body, json, status }.
// Lấy response từ chính request vừa gửi (không dùng waitForResponse riêng) để không bị lệch khi search liên tiếp.
async function reloadFull(page, action, match = isList) {
  const [req] = await Promise.all([page.waitForRequest(match), action()]);
  const res = await req.response();
  const json = await res.json();
  await settle(page);
  return { body: JSON.parse(req.postData()), json, status: res.status() };
}
// Như reloadFull nhưng chỉ trả về request body
const reloadBy = async (page, action) => (await reloadFull(page, action)).body;
// Bấm Search, trả về { body, status, json }
const search = (page) => reloadFull(page, () => searchBtn(page).click());

// Đổi tab Denom Type: app gửi list_by_denom_type rồi list của Game Sub Category đầu tiên.
// Trả về { body, json } của request list + { subs, subsBody } của list_by_denom_type
async function switchTab(page, name) {
  const subsRes = page.waitForResponse(isSubCategories);
  subsRes.catch(() => {});
  const full = await reloadFull(page, () => tabEl(page, name).click(), isListSub);
  const res = await subsRes;
  const subs = (await res.json()).data;
  await expect(radios(page)).toHaveCount(subs.length);
  await expect(activeTab(page)).toHaveText(name);
  await settle(page);
  return { ...full, subs, subsBody: JSON.parse(res.request().postData()) };
}

// Chọn 1 Game Sub Category (nút radio) theo tên
const pickSub = (page, name) => reloadFull(page, () => radioAt(page, name).click(), isListSub);

const headers = async (page) =>
  (await page.locator(".ant-table-thead th").allInnerTexts()).map((t) => t.trim());

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
const exact = (name, flags = "") =>
  new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, flags);
const totalOf = async (page) => num((await summary(page).innerText()).match(/of ([\d,]+) records/)[1]);

// Lấy toàn bộ giá trị của 1 cột (theo tên header) ở trang hiện tại
async function columnValues(page, name) {
  await expect.poll(() => headers(page), { message: `Không thấy cột "${name}"` }).toContain(name);
  const idx = (await headers(page)).indexOf(name);
  return rows(page).evaluateAll(
    (trs, i) => trs.map((tr) => tr.children[i].innerText.replace(/\s+/g, " ").trim()),
    idx,
  );
}

// Toàn bộ các dòng của bảng dạng { Currencies: "...", "No. of Denom List": "...", ... }
async function tableRecords(page) {
  const heads = await headers(page);
  const cells = await rows(page).evaluateAll((trs) =>
    trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim())),
  );
  return cells.map((r) => Object.fromEntries(heads.map((h, i) => [h, r[i]])));
}

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

// Ghi lại mọi request POST KHÔNG phải đọc dữ liệu để chắc chắn test không làm đổi dữ liệu thật
function watchWrites(page) {
  const writes = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /boapi/.test(r.url()) && !READ.test(r.url())) writes.push(r.url());
  });
  return writes;
}

// Lớp bảo hiểm: chặn không cho request ghi dữ liệu thật tới server (request vẫn được watchWrites ghi nhận)
async function blockWrites(page) {
  await page.route(/boapi/, (route) => {
    const r = route.request();
    if (r.method() === "POST" && !READ.test(r.url())) return route.abort();
    return route.continue();
  });
}

// Đóng hộp thoại bằng Cancel (không bao giờ bấm Confirm)
async function closeDialog(page) {
  await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
  await expect(dialog(page)).toBeHidden();
}

// Bấm "Download file" trong hộp thoại Upload, trả về { filename, header: [...], records: [[...]] } của file CSV mẫu
async function downloadTemplate(page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog(page).getByRole("button", { name: /Download file$/ }).click(),
  ]);
  const text = fs.readFileSync(await download.path(), "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l !== "");
  return {
    filename: download.suggestedFilename(),
    header: lines[0].split(","),
    records: lines.slice(1).map((l) => l.split(",")),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Games > Denominations", () => {
  let writes;
  let currenciesLoaded; // promise của response dropdown/currency (danh sách Currency) lúc mở trang
  let subsLoaded; // promise của response game_sub_category/list_by_denom_type của tab mặc định (Slot game)
  // Danh sách Currency { value, code, label } mà dropdown/currency trả về
  const currencies = async () => (await (await currenciesLoaded).json()).data;
  // Danh sách Game Sub Category { id, name } của tab Slot game
  const subs = async () => (await (await subsLoaded).json()).data;

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, tab / sub category đang chọn, số dòng/trang và cách sắp xếp được app lưu ở localStorage: xoá 1 lần đầu mỗi test
    // để luôn bắt đầu từ mặc định (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__game_denom_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/game_denom_(filter|page_size)$|game_denom_denom_type_game_sub_category_filter$|^sorter__game_denom$/.test(k)) {
          localStorage.removeItem(k);
        }
      }
      sessionStorage.setItem("__game_denom_spec_cleared", "1");
    });
    writes = watchWrites(page);
    await blockWrites(page);
    currenciesLoaded = page.waitForResponse(isCurrencyDropdown, { timeout: 60000 });
    currenciesLoaded.catch(() => {});
    subsLoaded = page.waitForResponse(isSubCategories, { timeout: 60000 });
    subsLoaded.catch(() => {});
    await openPage(page);
  });

  // Mọi test đều không được gửi request ghi dữ liệu
  test.afterEach(async () => {
    expect(writes, "Không được gửi request ghi dữ liệu").toEqual([]);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, đủ 2 filter và 2 nút Search/Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Denomination");
      for (const [label, id] of [
        ["Currencies", "currencyIds"],
        ["Name", "name"],
      ]) {
        await expect(filterEl(page, id), `thiếu filter ${label}`).toContainText(label);
        await expect(filterEl(page, id)).toBeVisible();
      }
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: tất cả để trống", async ({ page }) => {
      await expect(page.locator("#name")).toHaveValue("");
      await expect(filterEl(page, "currencyIds").locator(".ant-select-selection-item")).toHaveCount(0);
    });

    test("Currencies là dropdown chọn nhiều, Name là ô nhập chữ", async ({ page }) => {
      await expect(filterEl(page, "currencyIds").locator(".ant-select-multiple")).toHaveCount(1);
      await expect(filterEl(page, "name").locator(".ant-select")).toHaveCount(0);
    });

    test("Có nút Upload và Manage Columns; không có Export, Add New, checkbox chọn dòng / thao tác hàng loạt", async ({ page }) => {
      await expect(uploadBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
      await expect(exportBtn(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Add New$/ })).toHaveCount(0);
      await expect(page.locator("button.NextGen-button-more-action__update")).toHaveCount(0);
      await expect(page.locator('.ant-table input[type="checkbox"]')).toHaveCount(0);
    });

    test("Có 4 tab Denom Type đúng thứ tự, mặc định chọn Slot game", async ({ page }) => {
      expect(await page.getByRole("tab").allInnerTexts()).toEqual(TABS.map((t) => t.name));
      await expect(activeTab(page)).toHaveText("Slot game");
    });

    test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự`, async ({ page }) => {
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Mặc định: trang 1, 10 dòng, sort Currencies tăng dần, Game Sub Category đầu tiên, không có filter", async ({ page }) => {
      const { body, json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = (await subs())[0];
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "currency", sortDirection: "asc" });
      expect(body.filters).toEqual({});
      expect(body.gameSubCategoryId).toBe(first.id);
      expect(json.data.list.length).toBeLessThanOrEqual(10);
      await expect(page.locator(".ant-table-thead th", { hasText: exact("Currencies") })).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
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

  // ===== 2. Tab Denom Type và Game Sub Category =====
  test.describe("Tab Denom Type / Game Sub Category", () => {
    test("Các nút radio Game Sub Category của tab mặc định khớp list_by_denom_type, nút đầu được chọn", async ({ page }) => {
      const list = await subs();
      test.skip(list.length === 0, "Slot game chưa có Game Sub Category nào");
      expect(await radios(page).allInnerTexts()).toEqual(list.map((s) => norm(s.name)));
      await expect(checkedRadio(page)).toHaveText(norm(list[0].name));
    });

    for (const tab of TABS.slice(1)) {
      test(`Bấm tab ${tab.name}: gọi list_by_denom_type denomType=${tab.code}, hiển thị đúng các Game Sub Category và tải dữ liệu của sub category đầu`, async ({ page }) => {
        const { body, json, subs: list, subsBody } = await switchTab(page, tab.name);
        expect(subsBody.denomType).toBe(tab.code);
        test.skip(list.length === 0, `${tab.name} chưa có Game Sub Category nào`);
        expect(await radios(page).allInnerTexts()).toEqual(list.map((s) => norm(s.name)));
        await expect(checkedRadio(page)).toHaveText(norm(list[0].name));
        expect(body.gameSubCategoryId).toBe(list[0].id);
        expect(body.page).toBe(1);
        await expect(summary(page)).toContainText(`of ${json.data.totalCount} records`);
      });
    }

    test("Bấm Game Sub Category thứ 2: gửi đúng gameSubCategoryId, nút đó được chọn và bảng khớp response", async ({ page }) => {
      const list = await subs();
      test.skip(list.length < 2, "Slot game có dưới 2 Game Sub Category");
      const { body, json } = await pickSub(page, list[1].name);
      expect(body.gameSubCategoryId).toBe(list[1].id);
      await expect(checkedRadio(page)).toHaveText(norm(list[1].name));
      expect(await radios(page).filter({ has: page.locator(".ant-radio-button-checked") }).count()).toBe(1);
      expect(await columnValues(page, "Currencies")).toEqual(json.data.list.map((x) => norm(x.currency)));
    });

    test("Đổi tab hoặc sub category vẫn giữ filter đang áp dụng (Name)", async ({ page }) => {
      const { json } = await search(page);
      const r = json.data.list.find((x) => x.defaultDenom);
      test.skip(!r, "Không có dòng nào có Default Denom Name");
      const part = norm(r.defaultDenom).slice(0, 3);
      await fillFilter(page, "name", part);
      await search(page);

      const t = await switchTab(page, "Mini game");
      expect(t.body.filters).toEqual({ name: part });
      await expect(page.locator("#name")).toHaveValue(part);

      test.skip(t.subs.length < 2, "Mini game có dưới 2 Game Sub Category");
      const s = await pickSub(page, t.subs[1].name);
      expect(s.body.filters).toEqual({ name: part });
      expect(s.body.gameSubCategoryId).toBe(t.subs[1].id);
    });

    test("Đổi sub category vẫn giữ nguyên cách sắp xếp và số dòng / trang", async ({ page }) => {
      const list = await subs();
      test.skip(list.length < 2, "Slot game có dưới 2 Game Sub Category");
      await reloadBy(page, () => page.locator(".ant-table-thead th", { hasText: exact("No. of Denom List") }).click());
      const { body } = await pickSub(page, list[1].name);
      expect(body).toMatchObject({ sortBy: "noOfDenomList", sortDirection: "asc", pageSize: 10 });
    });
  });

  // ===== 3. Dữ liệu bảng =====
  test.describe("Dữ liệu bảng", () => {
    test("Mỗi dòng khớp response API (định dạng hiển thị)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      const records = await tableRecords(page);
      expect(records).toHaveLength(list.length);

      records.forEach((r, i) => {
        const c = list[i];
        const at = `dòng ${i + 1} (currency ${c.currency})`;
        expect(r["Currencies"], at).toBe(norm(c.currency));
        expect(r["No. of Denom List"], at).toBe(String(c.noOfDenomList));
        expect(r["Default Denom Name"], at).toBe(norm(c.defaultDenom));
      });
    });

    test("Định dạng: Currencies không rỗng và không trùng nhau, No. of Denom List là số nguyên không âm", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      const names = await columnValues(page, "Currencies");
      for (const v of names) expect(v).not.toBe("");
      expect(new Set(names).size).toBe(names.length);
      for (const v of await columnValues(page, "No. of Denom List")) expect(v).toMatch(/^\d+$/);
    });

    test("Dòng chưa có denom nào (No. of Denom List = 0) thì Default Denom Name để trống và ngược lại", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const c of json.data.list) {
        const at = `currency ${c.currency}`;
        if (c.noOfDenomList === 0) expect(norm(c.defaultDenom), at).toBe("");
        else expect(norm(c.defaultDenom), at).not.toBe("");
      }
    });

    test("Currency của mỗi dòng là currency có thật trong dropdown/currency (id và tên khớp)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const all = await currencies();
      for (const c of json.data.list) {
        const found = all.find((x) => x.value === c.currencyId);
        expect(found, `currencyId ${c.currencyId}`).toBeTruthy();
        expect(norm(found.label), `currencyId ${c.currencyId}`).toBe(norm(c.currency));
      }
    });

    test("Bảng liệt kê tất cả Currency: totalCount bằng số Currency trong dropdown/currency", async ({ page }) => {
      const { json } = await search(page);
      expect(json.data.totalCount).toBe((await currencies()).length);
    });

    test("Mỗi tên Currency là 1 link bấm được dẫn tới màn hình chi tiết", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      const n = await rows(page).count();
      for (let i = 0; i < n; i++) await expect(currencyLink(page, i)).toHaveCount(1);
    });
  });

  // ===== 4. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Option của Currencies lấy từ API dropdown/currency (đúng thứ tự)", async ({ page }) => {
      const labels = (await currencies()).map((c) => c.label);
      test.skip(labels.length === 0, "Không có Currency nào");
      const titles = await dropdownOptions(page, "currencyIds");
      expect(titles.length).toBeGreaterThan(0);
      // Danh sách ảo có thể chỉ render các option đầu tiên -> so với phần đầu của response
      expect(titles).toEqual(labels.slice(0, titles.length));
    });

    test("Lọc theo Currency của dòng đầu tiên gửi currencyIds=[id] và chỉ còn đúng currency đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      await selectOption(page, "currencyIds", first.currency);
      expect(await selectedTitles(page, "currencyIds")).toEqual([first.currency]);
      const { body, json: res } = await search(page);
      expect(body.filters.currencyIds).toEqual([first.currencyId]);
      expect(res.data.totalCount).toBe(1);
      expect(res.data.list.map((x) => x.currencyId)).toEqual([first.currencyId]);
      expect(await columnValues(page, "Currencies")).toEqual([norm(first.currency)]);
    });

    test("Currencies chọn được nhiều giá trị: gửi đủ currencyIds và mọi dòng thuộc các currency đã chọn", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Cần ít nhất 2 currency");
      const [a, b] = json.data.list;
      await selectOption(page, "currencyIds", a.currency);
      await selectOption(page, "currencyIds", b.currency);
      await expect.poll(() => selectedCount(page, "currencyIds")).toBe(2);
      const { body, json: res } = await search(page);
      expect([...body.filters.currencyIds].sort()).toEqual([a.currencyId, b.currencyId].sort());
      expect(res.data.totalCount).toBe(2);
      expect(res.data.list.map((x) => x.currencyId).sort()).toEqual([a.currencyId, b.currencyId].sort());
    });

    // Quan sát khi khám phá: filter Name khớp theo Default Denom Name (không khớp tên Currency, cũng không khớp các denom
    // khác không phải mặc định của currency) - xem phần "cần xác nhận" ở báo cáo.
    test("Lọc theo Name khớp một phần Default Denom Name, không phân biệt hoa/thường", async ({ page }) => {
      const { json } = await search(page);
      const r = json.data.list.find((x) => x.defaultDenom);
      test.skip(!r, "Không có dòng nào có Default Denom Name");
      const part = norm(r.defaultDenom).slice(1, Math.max(4, r.defaultDenom.length - 1)).trim().toUpperCase();
      await fillFilter(page, "name", part);
      const { body, json: res } = await search(page);
      expect(body.filters.name).toBe(part);
      expect(res.data.list.length).toBeGreaterThan(0);
      expect(res.data.list.map((x) => x.currencyId)).toContain(r.currencyId);
      for (const v of await columnValues(page, "Default Denom Name")) expect(v.toUpperCase()).toContain(part);
      await expect(summary(page)).toContainText(`of ${res.data.totalCount} records`);
    });

    test("Lọc theo Name đầy đủ trả về dòng có Default Denom Name đó", async ({ page }) => {
      const { json } = await search(page);
      const r = json.data.list.find((x) => x.defaultDenom);
      test.skip(!r, "Không có dòng nào có Default Denom Name");
      await fillFilter(page, "name", r.defaultDenom);
      const { body, json: res } = await search(page);
      expect(body.filters.name).toBe(r.defaultDenom);
      expect(res.data.list.map((x) => x.currencyId)).toContain(r.currencyId);
      for (const v of await columnValues(page, "Default Denom Name")) {
        expect(v.toLowerCase()).toContain(norm(r.defaultDenom).toLowerCase());
      }
    });

    test("Kết hợp Currencies và Name cùng lúc (AND)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      const r = list.find((x) => x.defaultDenom);
      test.skip(!r, "Không có dòng nào có Default Denom Name");
      await fillFilter(page, "name", r.defaultDenom);
      await selectOption(page, "currencyIds", r.currency);
      const { body, json: res } = await search(page);
      expect(body.filters).toMatchObject({ name: r.defaultDenom, currencyIds: [r.currencyId] });
      expect(res.data.list.map((x) => x.currencyId)).toEqual([r.currencyId]);
    });

    test("Name + Currency không khớp nhau -> currency đó không nằm trong kết quả", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      const r = list.find((x) => x.defaultDenom);
      test.skip(!r, "Không có dòng nào có Default Denom Name");
      const other = list.find(
        (x) => x.currencyId !== r.currencyId && !norm(x.defaultDenom).toLowerCase().includes(norm(r.defaultDenom).toLowerCase()),
      );
      test.skip(!other, "Không có currency khác có Default Denom Name khác để so sánh");
      await fillFilter(page, "name", r.defaultDenom);
      await selectOption(page, "currencyIds", other.currency);
      const { json: res } = await search(page);
      expect(res.data.list.map((x) => x.currencyId)).not.toContain(other.currencyId);
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

  // ===== 5. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá toàn bộ filter đã chọn và hiển thị lại toàn bộ dữ liệu", async ({ page }) => {
      const first = await search(page);
      test.skip(first.json.data.list.length === 0, "Không có dữ liệu");
      await fillFilter(page, "name", "qa");
      await selectOption(page, "currencyIds", first.json.data.list[0].currency);
      await search(page);

      // Chỉ nhận request đã không còn filter (loại request search lặp lại của thao tác trước)
      const { body, json } = await reloadFull(
        page,
        () => resetBtn(page).click(),
        isListWhere((b) => Object.keys(b.filters).length === 0),
      );
      await expect(page.locator("#name")).toHaveValue("");
      await expect(filterEl(page, "currencyIds").locator(".ant-select-selection-item")).toHaveCount(0);
      expect(body.filters).toEqual({});
      expect(json.data.totalCount).toBe(first.json.data.totalCount);
    });

    test("Reset không đổi tab Denom Type, Game Sub Category và số dòng / trang đang chọn", async ({ page }) => {
      const t = await switchTab(page, "Mini game");
      test.skip(t.subs.length < 2, "Mini game có dưới 2 Game Sub Category");
      await pickSub(page, t.subs[1].name);
      await page.locator(".ant-pagination-options .ant-select").click();
      await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
      // Phải áp dụng filter (Search) trước: Reset khi chưa có filter nào đang áp dụng thì không gọi lại API
      await fillFilter(page, "name", "qa");
      await search(page);

      const { body } = await reloadFull(
        page,
        () => resetBtn(page).click(),
        isListWhere((b) => Object.keys(b.filters).length === 0),
      );
      expect(body).toMatchObject({ pageSize: 20, gameSubCategoryId: t.subs[1].id });
      expect(body.filters).toEqual({});
      await expect(activeTab(page)).toHaveText("Mini game");
      await expect(checkedRadio(page)).toHaveText(norm(t.subs[1].name));
    });

    test("Reset đưa cách sắp xếp về mặc định (Currencies tăng dần)", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu");
      await reloadBy(page, () => page.locator(".ant-table-thead th", { hasText: exact("No. of Denom List") }).click());
      const { body } = await reloadFull(page, () => resetBtn(page).click());
      expect(body).toMatchObject({ sortBy: "currency", sortDirection: "asc" });
      await expect(page.locator(".ant-table-thead th", { hasText: exact("Currencies") })).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
    });
  });

  // ===== 6. Phân trang =====
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
      const first = await columnValues(page, "Currencies");
      await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      const second = await columnValues(page, "Currencies");
      for (const v of second) expect(first).not.toContain(v);
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
      const r = json.data.list.find((x) => x.defaultDenom);
      test.skip(!r, "Không có dòng nào có Default Denom Name");
      await fillFilter(page, "name", norm(r.defaultDenom).slice(0, 3));
      const first = await search(page);
      test.skip(first.json.data.totalCount <= 10, "Filter chỉ có 1 trang");

      const { body } = await reloadFull(
        page,
        () => page.locator(".ant-pagination-next").click(),
        isListWhere((b) => b.page === 2),
      );
      expect(body.page).toBe(2);
      expect(body.filters).toEqual(first.body.filters);
    });

    test("Giữ nguyên Game Sub Category khi chuyển trang", async ({ page }) => {
      const list = await subs();
      test.skip(list.length < 2, "Slot game có dưới 2 Game Sub Category");
      const picked = await pickSub(page, list[1].name);
      const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(body.page).toBe(2);
      expect(body.gameSubCategoryId).toBe(picked.body.gameSubCategoryId);
    });

    test("Giữ nguyên sắp xếp khi chuyển trang", async ({ page }) => {
      const sorted = await reloadBy(page, () =>
        page.locator(".ant-table-thead th", { hasText: exact("Default Denom Name") }).click(),
      );
      expect(sorted).toMatchObject({ sortBy: "defaultDenom", sortDirection: "asc" });
      const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
      expect(body).toMatchObject({ page: 2, sortBy: "defaultDenom", sortDirection: "asc" });
    });
  });

  // ===== 7. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    const th = (page, column) => page.locator(".ant-table-thead th", { hasText: exact(column) });

    // Currencies là cột sort mặc định (tăng dần): bấm lần lượt chỉ đảo giữa giảm dần <-> tăng dần (không có trạng thái "bỏ sort")
    test("Sort cột Currencies: mặc định tăng dần, bấm lần lượt -> giảm dần -> tăng dần -> giảm dần", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
      // Cột chữ phụ thuộc collation của server nên chỉ kiểm tra request
      const desc = await reloadBy(page, () => th(page, "Currencies").click());
      expect(desc).toMatchObject({ sortBy: "currency", sortDirection: "desc" });
      await expect(th(page, "Currencies")).toHaveAttribute("aria-sort", "descending");

      const asc = await reloadBy(page, () => th(page, "Currencies").click());
      expect(asc).toMatchObject({ sortBy: "currency", sortDirection: "asc" });
      await expect(th(page, "Currencies")).toHaveAttribute("aria-sort", "ascending");

      const desc2 = await reloadBy(page, () => th(page, "Currencies").click());
      expect(desc2).toMatchObject({ sortBy: "currency", sortDirection: "desc" });
    });

    for (const [column, sortBy] of Object.entries(SORTABLE).filter(([c]) => c !== "Currencies")) {
      test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định (Currencies tăng dần)`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
        // No. of Denom List kiểm tra được thứ tự dữ liệu (số); cột chữ phụ thuộc collation của server nên chỉ kiểm tra request
        const checkOrder = column === "No. of Denom List";

        const asc = await reloadBy(page, () => th(page, column).click());
        expect(asc).toMatchObject({ sortBy, sortDirection: "asc" });
        if (checkOrder) {
          await expect
            .poll(async () => {
              const v = (await columnValues(page, column)).map(Number);
              return JSON.stringify(v) === JSON.stringify([...v].sort((a, b) => a - b));
            }, { message: "thứ tự tăng dần" })
            .toBe(true);
        }

        const desc = await reloadBy(page, () => th(page, column).click());
        expect(desc).toMatchObject({ sortBy, sortDirection: "desc" });
        if (checkOrder) {
          await expect
            .poll(async () => {
              const v = (await columnValues(page, column)).map(Number);
              return JSON.stringify(v) === JSON.stringify([...v].sort((a, b) => b - a));
            }, { message: "thứ tự giảm dần" })
            .toBe(true);
        }

        // Click lần 3: bỏ sort -> quay về mặc định Currencies tăng dần
        const none = await reloadBy(page, () => th(page, column).click());
        expect(none).toMatchObject({ sortBy: "currency", sortDirection: "asc" });
        await expect(th(page, "Currencies")).toHaveAttribute("aria-sort", "ascending");
      });
    }

    test("Sort giữ nguyên filter và Game Sub Category đang áp dụng", async ({ page }) => {
      const { json } = await search(page);
      const r = json.data.list.find((x) => x.defaultDenom);
      test.skip(!r, "Không có dòng nào có Default Denom Name");
      await fillFilter(page, "name", norm(r.defaultDenom).slice(0, 3));
      const first = await search(page);
      test.skip(first.json.data.list.length < 2, "Không đủ dữ liệu để kiểm tra");
      const body = await reloadBy(page, () => th(page, "No. of Denom List").click());
      expect(body).toMatchObject({ sortBy: "noOfDenomList", sortDirection: "asc" });
      expect(body.filters).toEqual(first.body.filters);
      expect(body.gameSubCategoryId).toBe(first.body.gameSubCategoryId);
    });

    // Cách sắp xếp được app lưu ở localStorage (sorter__game_denom) -> reload vẫn giữ
    test("Cách sắp xếp được ghi nhớ sau khi tải lại trang; bỏ sort thì về mặc định Currencies tăng dần", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu");
      await reloadBy(page, () => th(page, "Default Denom Name").click());
      const [req] = await Promise.all([page.waitForRequest(isListSub), page.reload()]);
      expect(JSON.parse(req.postData())).toMatchObject({ sortBy: "defaultDenom", sortDirection: "asc" });
      await settle(page);
      await expect(th(page, "Default Denom Name")).toHaveAttribute("aria-sort", "ascending");

      // Bấm 2 lần nữa (asc -> desc -> bỏ sort) rồi reload: về mặc định
      await reloadBy(page, () => th(page, "Default Denom Name").click());
      await reloadBy(page, () => th(page, "Default Denom Name").click());
      const [req2] = await Promise.all([page.waitForRequest(isListSub), page.reload()]);
      expect(JSON.parse(req2.postData())).toMatchObject({ sortBy: "currency", sortDirection: "asc" });
    });
  });

  // ===== 8. Hộp thoại Upload =====
  test.describe("Hộp thoại Upload (không bấm Confirm)", () => {
    for (const tab of TABS) {
      test(`Tab ${tab.name}: Upload mở hộp thoại "Upload ${tab.prefix}", file mẫu ${tab.prefix}Template.csv có ${tab.levels} cột Level`, async ({ page }) => {
        if (tab.name !== "Slot game") await switchTab(page, tab.name);
        await uploadBtn(page).click();
        await expect(dialog(page).locator(".ant-modal-title")).toHaveText(`Upload ${tab.prefix}`);

        const { filename, header, records } = await downloadTemplate(page);
        expect(filename).toBe(`${tab.prefix}Template.csv`);
        expect(header).toEqual([
          "Currency",
          "Game Sub Category",
          "Denom Name",
          "Default Bet Level",
          ...Array.from({ length: tab.levels }, (_, i) => `Level ${i + 1}`),
        ]);
        expect(records.length).toBeGreaterThan(0);
        for (const r of records) expect(r).toHaveLength(header.length);
        await closeDialog(page); // KHÔNG Confirm
      });
    }

    test("Nội dung hộp thoại: hướng dẫn, Type mặc định 'Create New Denom', vùng chọn file CSV, Cancel / Confirm (Confirm bị khoá)", async ({ page }) => {
      await uploadBtn(page).click();
      const d = dialog(page);
      await expect(d).toContainText("Ensure all field are completed accurately and in the required format");
      await expect(d.locator(".ant-radio-wrapper")).toHaveText(["Create New Denom", "Update Existing Denom"]);
      await expect(d.locator(".ant-radio-wrapper-checked")).toHaveText("Create New Denom");
      await expect(d).toContainText("Upload a CSV format following this template");
      await expect(d).toContainText("Format: CSV | Max. Size: 5MB");
      await expect(d.locator("input[type=file]")).toHaveAttribute("accept", ".csv");
      await expect(d.getByRole("button", { name: /Download file$/ })).toBeVisible();
      await expect(d.getByRole("button", { name: /Cancel$/ })).toBeEnabled();
      await expect(d.getByRole("button", { name: /Confirm$/ })).toBeDisabled(); // chưa chọn file nên không bấm được
      await closeDialog(page);
    });

    test("Hộp thoại Upload gọi dropdown/currency (API đọc), không gọi API ghi", async ({ page }) => {
      const [req] = await Promise.all([page.waitForRequest(isCurrencyDropdown), uploadBtn(page).click()]);
      expect(req.method()).toBe("POST");
      await closeDialog(page);
    });

    test("Chọn Type 'Update Existing Denom': radio đổi, Confirm vẫn bị khoá khi chưa chọn file", async ({ page }) => {
      await uploadBtn(page).click();
      await dialog(page).locator(".ant-radio-wrapper", { hasText: "Update Existing Denom" }).click();
      await expect(dialog(page).locator(".ant-radio-wrapper-checked")).toHaveText("Update Existing Denom");
      await expect(dialog(page).getByRole("button", { name: /Confirm$/ })).toBeDisabled();
      await closeDialog(page);
    });

    test("Chọn file không phải CSV: báo 'Format is incorrect' và Confirm vẫn bị khoá", async ({ page }) => {
      await uploadBtn(page).click();
      await dialog(page)
        .locator("input[type=file]")
        .setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
      await expect(page.locator(".ant-message-notice").filter({ hasText: "File bad.txt Format is incorrect" })).toBeVisible();
      await expect(dialog(page)).toContainText("bad.txt");
      await expect(dialog(page)).toContainText("Format is incorrect");
      await expect(dialog(page).getByRole("button", { name: /Confirm$/ })).toBeDisabled();
      await closeDialog(page); // KHÔNG Confirm
    });

    test("Chọn file CSV sai tiêu đề cột: báo 'Format is incorrect' và Confirm vẫn bị khoá", async ({ page }) => {
      await uploadBtn(page).click();
      await dialog(page)
        .locator("input[type=file]")
        .setInputFiles({ name: "wrong.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2") });
      await expect(dialog(page)).toContainText("wrong.csv");
      await expect(dialog(page)).toContainText("Format is incorrect");
      await expect(dialog(page).getByRole("button", { name: /Confirm$/ })).toBeDisabled();
      await closeDialog(page); // KHÔNG Confirm
    });

    test("Đóng bằng Cancel hoặc nút X rồi mở lại: form trở về trạng thái ban đầu (chưa chọn file, Type = Create New Denom)", async ({ page }) => {
      await uploadBtn(page).click();
      await dialog(page).locator(".ant-radio-wrapper", { hasText: "Update Existing Denom" }).click();
      await dialog(page)
        .locator("input[type=file]")
        .setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
      await closeDialog(page);

      await uploadBtn(page).click();
      await expect(dialog(page).locator(".ant-radio-wrapper-checked")).toHaveText("Create New Denom");
      await expect(dialog(page).locator(".ant-upload-list-item")).toHaveCount(0);
      await expect(dialog(page).getByRole("button", { name: /Confirm$/ })).toBeDisabled();
      await dialog(page).getByRole("button", { name: "Close" }).first().click();
      await expect(dialog(page)).toBeHidden();
    });
  });

  // ===== 9. Màn hình chi tiết (/game/denom/view/{gameSubCategoryId}/{currencyId}) =====
  test.describe("Màn hình chi tiết Denomination (chỉ đọc, không bấm Add New / Edit / Delete / Submit)", () => {
    // Bấm tên Currency của dòng đầu tiên có denom, trả về thông tin dòng + request / response view/list
    async function openDetail(page) {
      const { json, body } = await search(page);
      const index = json.data.list.findIndex((x) => x.noOfDenomList > 0);
      test.skip(index < 0, "Không có Currency nào có denom ở Game Sub Category đầu tiên");
      const row = json.data.list[index];
      const [req] = await Promise.all([page.waitForRequest(isDetail), currencyLink(page, index).click()]);
      const detail = await (await req.response()).json();
      await expect(page).toHaveURL(new RegExp(`/game/denom/view/${body.gameSubCategoryId}/${row.currencyId}$`));
      await expect(rows(page)).toHaveCount(detail.data.denominations.length);
      await waitTableIdle(page);
      return { row, body, req: JSON.parse(req.postData()), detail: detail.data };
    }
    const detailCells = (page) =>
      rows(page).evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim())));

    test("Bấm tên Currency mở /game/denom/view/{subId}/{currencyId} và gọi denomination/view/list đúng id", async ({ page }) => {
      const { row, body, req } = await openDetail(page);
      expect(req.gameSubCategoryId).toBe(String(body.gameSubCategoryId));
      expect(req.currencyId).toBe(String(row.currencyId));
    });

    test("Breadcrumb 'Denomination > Denomination detail' và phần Basic Information khớp dữ liệu", async ({ page }) => {
      const { row, detail } = await openDetail(page);
      await expect(breadcrumb(page)).toHaveText(/Denomination\s*>\s*Denomination detail/);
      const text = norm(await page.locator("main").innerText());
      expect(text).toContain("Basic Information");
      expect(text).toContain(`Currency ${norm(row.currency)}`);
      expect(text).toContain(`Game Sub Category ${norm(detail.gameSubCategory)}`);
      expect(text).toContain("Denom Type Slots"); // tab mặc định là Slot game (API trả "SLOTS")
      expect(norm(detail.currency)).toBe(norm(row.currency));
      expect(detail.denomType).toBe("SLOTS");
    });

    test("Bảng denom có đủ cột đúng thứ tự và số dòng bằng No. of Denom List ở màn hình danh sách", async ({ page }) => {
      const { row, detail } = await openDetail(page);
      expect(await headers(page)).toEqual([
        "Default",
        "Denom name",
        "Default bet level",
        "Total level",
        "Min Bet",
        "Max Bet",
        "Remark",
        "Last updated",
        "Action",
      ]);
      expect(detail.denominations).toHaveLength(row.noOfDenomList);
    });

    test("Mỗi dòng khớp response (tên, bet level mặc định, tổng level, min / max bet, remark, ngày cập nhật)", async ({ page }) => {
      const { detail } = await openDetail(page);
      const cells = await detailCells(page);
      detail.denominations.forEach((d, i) => {
        const at = `dòng ${i + 1} (denom ${d.id})`;
        expect(cells[i][1], at).toBe(norm(d.name));
        expect(cells[i][2], at).toBe(String(d.defaultBetLevel));
        expect(cells[i][3], at).toBe(String(d.totalLevel));
        expect(cells[i][4], at).toBe(String(d.minBet));
        expect(cells[i][5], at).toBe(String(d.maxBet));
        expect(cells[i][6], at).toBe(norm(d.remarks));
        expect(cells[i][7], at).toBe(d.lastUpdated);
        expect(d.lastUpdated, at).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
      });
    });

    test("Ràng buộc dữ liệu: Total level = số bet level, Min / Max Bet = nhỏ nhất / lớn nhất, bet level mặc định hợp lệ", async ({ page }) => {
      const { detail } = await openDetail(page);
      for (const d of detail.denominations) {
        const at = `denom ${d.id}`;
        expect(d.totalLevel, at).toBe(d.betLevels.length);
        expect(d.minBet, at).toBe(Math.min(...d.betLevels));
        expect(d.maxBet, at).toBe(Math.max(...d.betLevels));
        expect(d.defaultBetLevel, at).toBeGreaterThanOrEqual(1);
        expect(d.defaultBetLevel, at).toBeLessThanOrEqual(d.totalLevel);
      }
    });

    test("Chỉ có đúng 1 denom mặc định (radio) và trùng Default Denom Name ở màn hình danh sách", async ({ page }) => {
      const { row, detail } = await openDetail(page);
      const defaults = detail.denominations.filter((d) => d.isDefault === 1);
      expect(defaults).toHaveLength(1);
      expect(norm(defaults[0].name)).toBe(norm(row.defaultDenom));
      for (const [i, d] of detail.denominations.entries()) {
        const radio = rowAt(page, i).locator("input[type=radio]");
        if (d.isDefault === 1) await expect(radio).toBeChecked();
        else await expect(radio).not.toBeChecked();
      }
    });

    test("Mỗi dòng có 3 icon Xem / Sửa / Xoá, màn hình có nút Add New, Cancel, Submit (chỉ kiểm tra hiển thị, không bấm)", async ({ page }) => {
      await openDetail(page);
      const n = await rows(page).count();
      for (let i = 0; i < n; i++) {
        const icons = await rowAt(page, i).locator("svg").evaluateAll((els) => els.map((e) => e.dataset.icon));
        expect(icons, `dòng ${i + 1}`).toEqual(["eye", "pen-to-square", "trash"]);
      }
      await expect(page.getByRole("button", { name: /Add New$/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Submit$/ })).toBeVisible();
    });

    test("Icon con mắt mở hộp thoại 'Denom list' liệt kê đúng các Level (không gọi API), đóng bằng nút X", async ({ page }) => {
      const { detail } = await openDetail(page);
      const d = detail.denominations[0];
      await rowAt(page, 0).locator('svg[data-icon="eye"]').click();
      await expect(dialog(page)).toContainText("Denom list");
      await expect(dialog(page)).toContainText(norm(d.name));
      await expect(dialog(page).locator("tr.ant-table-row")).toHaveCount(d.betLevels.length);
      const levels = await dialog(page)
        .locator("tr.ant-table-row")
        .evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim())));
      levels.forEach((c, i) => {
        expect(c[0].replace(/Default$/, "").trim(), `level ${i + 1}`).toBe(`Level ${i + 1}`);
        expect(c[1], `level ${i + 1}`).toBe(String(d.betLevels[i]));
      });
      // Level là bet level mặc định được đánh dấu "Default"
      expect(levels[d.defaultBetLevel - 1][0]).toContain("Default");
      await dialog(page).getByRole("button", { name: "Close" }).first().click();
      await expect(dialog(page)).toBeHidden();
    });

    test("Nút Cancel quay về màn hình danh sách, giữ nguyên tab và Game Sub Category đang chọn", async ({ page }) => {
      const { body } = await openDetail(page);
      const [req] = await Promise.all([
        page.waitForRequest(isListSub),
        page.getByRole("button", { name: /Cancel$/ }).click(),
      ]);
      await expect(page).toHaveURL(/\/game\/denom$/);
      expect(JSON.parse(req.postData()).gameSubCategoryId).toBe(body.gameSubCategoryId);
      await settle(page);
      await expect(activeTab(page)).toHaveText("Slot game");
      await expect(checkedRadio(page)).toHaveText(norm((await subs()).find((s) => s.id === body.gameSubCategoryId).name));
    });
  });

  // ===== 10. Manage Columns =====
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
      await item(page, "Default Denom Name").locator("label").click();
      expect(await headers(page)).not.toContain("Default Denom Name");
      expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

      await item(page, "Default Denom Name").locator("label").click();
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      const before = await columnValues(page, "Currencies");
      await columnBtn(page).click();
      await item(page, "Default Denom Name").locator("label").click();
      expect(await columnValues(page, "Currencies")).toEqual(before);
    });
  });

  // ===== 11. Ghi nhớ filter =====
  test("Tab, Game Sub Category, filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
    const first = await search(page);
    test.skip(first.json.data.list.length === 0, "Không có dữ liệu");
    const label = first.json.data.list[0].currency;
    const t = await switchTab(page, "Mini game");
    test.skip(t.subs.length < 2, "Mini game có dưới 2 Game Sub Category");
    await pickSub(page, t.subs[1].name);

    // Đặt số dòng / trang trước khi lọc (lọc ra ít dòng thì thanh phân trang biến mất)
    await page.locator(".ant-pagination-options .ant-select").click();
    await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
    await fillFilter(page, "name", "qa");
    await selectOption(page, "currencyIds", label);
    await search(page);

    const [req] = await Promise.all([page.waitForRequest(isListSub), page.reload()]);
    expect(JSON.parse(req.postData())).toMatchObject({ page: 1, pageSize: 20, gameSubCategoryId: t.subs[1].id });
    expect(JSON.parse(req.postData()).filters).toMatchObject({ name: "qa", currencyIds: [first.json.data.list[0].currencyId] });
    await settle(page);
    await expect(activeTab(page)).toHaveText("Mini game");
    await expect(checkedRadio(page)).toHaveText(norm(t.subs[1].name));
    await expect(page.locator("#name")).toHaveValue("qa");
    expect(await selectedTitles(page, "currencyIds")).toEqual([label]);
  });

  test("Số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
    test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
    await page.locator(".ant-pagination-options .ant-select").click();
    await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
    await openPage(page); // reload
    await expect(page.locator(".ant-pagination-options")).toContainText("20 / page");
    await expect(rows(page)).toHaveCount(20);
  });
});
