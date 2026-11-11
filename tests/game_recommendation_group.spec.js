// Game Recommendation > Recommendation Group  (https://dev-bo.royaledge.io/game-recommendation/recommendation-group)
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/game_recommendation_group.spec.js --project=setup --project=chromium
//
// Màn hình quản lý nhóm game được đề xuất (Recommendation Group). Mỗi nhóm có tên + danh sách game.
// Danh sách CÓ phân trang (10/20/50/100/200 dòng / trang) nhưng dữ liệu thường rất ít (vài nhóm) nên các test phân trang
// tự skip khi tổng số bản ghi <= 10. Không có checkbox chọn dòng / thao tác hàng loạt, KHÔNG có nút Export.
// Cột "Game Name" hiển thị tối đa 4 chip game, phần còn lại gom thành chip "+ N ..." (bấm để mở rộng / thu gọn).
//
// Màn hình có các thao tác GHI dữ liệu thật: Add New (Submit), Update (Submit), Delete (Delete).
// Các describe trong "Game Recommendation > Recommendation Group" (nhóm 1-11) KHÔNG bấm Submit khi form hợp lệ, KHÔNG bấm
// nút Delete trong hộp thoại xác nhận: chỉ mở hộp thoại, kiểm tra nội dung, kiểm tra validation khi để trống (form bị chặn
// nên không gửi request) rồi bấm Cancel / Close, và kiểm tra không có request ghi dữ liệu nào được gửi đi (watchWrites +
// route chặn thêm 1 lớp bảo hiểm - request ghi nếu có vẫn bị ghi nhận vào `writes` nên test sẽ fail nhưng dữ liệu thật
// không bị đổi). Các test đó chạy ở mọi chế độ.
// Không hard-code dữ liệu - mọi giá trị lấy từ chính danh sách / response dropdown/game.
//
// RIÊNG describe cuối file "Tạo / sửa / xoá nhóm QA thật (cần RUN_FULL_TESTS=true)" GHI DỮ LIỆU THẬT:
//  - Gắn cờ RUN_FULL_TESTS (tests/helpers/flags.js, xem RUN_FULL_TESTS.md): cờ false/không khai báo -> cả nhóm bị skip, không
//    gửi request ghi nào; chỉ chạy khi RUN_FULL_TESTS=true. Lệnh ví dụ (PowerShell):
//      $env:RUN_FULL_TESTS="true"; npx playwright test tests/game_recommendation_group.spec.js --project=setup --project=chromium -g "nhóm QA thật"
//  - Chỉ thao tác trên nhóm do chính test tạo ra, tên "QA Group <Date.now()>" (isQaGroup kiểm tra tiền tố + dãy số trước khi xoá).
//    Không đụng nhóm có sẵn của team. Luồng (serial): tạo (recommendation-group/create) -> sửa (/update: đổi tên + bỏ 1 game)
//    -> xoá bằng icon Delete + xác nhận (/delete).
//  - Dọn dẹp: test cuối xoá nhóm QA qua UI và kiểm tra nhóm biến mất; afterAll xoá nốt mọi nhóm QA còn sót (kể cả của lần
//    chạy trước bị dừng giữa chừng) nếu test giữa chừng fail. Nhóm được xoá hẳn nên không để lại rác.
const { test, expect } = require("@playwright/test");
const { RUN_FULL_TESTS, SKIP_WRITE_REASON } = require("./helpers/flags");
const { buildStorageState } = require("./helpers/session");

test.use({ viewport: { width: 1920, height: 1080 } });

const URL = "/game-recommendation/recommendation-group";

// Đúng thứ tự hiển thị (không có cột checkbox)
const COLUMNS = ["Group Name", "No. of Game", "Game Name", "Action"];
const COL = { name: 0, total: 1, games: 2, action: 3 };

// Cột duy nhất có thể sort -> tên field gửi lên API (mặc định sort theo id giảm dần)
const SORTABLE = { "Group Name": "name" };

// Số chip game tối đa hiển thị khi chưa mở rộng
const MAX_CHIPS = 4;

// Thông báo lỗi của form
const MSG = {
  name: "Group name is required",
  length: "Group name must be between 3 and 50 characters",
  format: "Group name can only contain letters, numbers and . , ' -",
  games: "Please select at least 1 game",
};

// Request đọc dữ liệu (mọi POST còn lại coi là ghi)
const READ = /\/(list|details|download|view|dropdown|validate_[a-z_]+)$|\/dropdown\//;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const isList = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/recommendation-group/list");
const isView = (r) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith("/recommendation-group/view");
const isGameDropdown = (r) => reqOf(r).url().endsWith("/dropdown/game");

const rows = (page) => page.locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const editIcon = (page, i) => rowAt(page, i).locator('svg[data-icon="pen-to-square"]');
const deleteIcon = (page, i) => rowAt(page, i).locator('svg[data-icon="trash"]');
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
// Các chip game của 1 dòng (kể cả chip "+ N ..." / chip thu gọn)
const chipsAt = (page, i) => cellAt(page, i, COL.games).locator(".ant-tag");
// Chip bấm được (mở rộng / thu gọn): có style cursor: pointer
const toggleChip = (page, i) => cellAt(page, i, COL.games).locator('.ant-tag[style*="cursor"]');

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const addBtn = (page) => page.getByRole("button", { name: "plus Add New" });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const exportBtn = (page) => page.locator("button.NextGen-export-button");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const dialog = (page) => page.getByRole("dialog");
const tooltip = (page) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");

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
// LƯU Ý (UI, khám phá bằng MCP): khi filter vừa thay đổi, Search đôi khi gửi 2 request list GIỐNG HỆT nhau cách nhau ~200ms.
// Request thứ 2 có thể bị nhầm là request của thao tác kế tiếp (sort / đổi trang / search) -> chờ mạng yên (networkidle)
// sau mỗi lần gọi để loại request thừa này.
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
}

async function search(page) {
  const [req] = await Promise.all([page.waitForRequest(isList), searchBtn(page).click()]);
  const res = await req.response();
  const json = await res.json();
  await settle(page);
  return { body: JSON.parse(req.postData()), status: res.status(), json };
}

// Thực hiện 1 hành động làm bảng gọi lại API (đổi trang, sort...) rồi trả về { body, json }
async function reloadFull(page, action) {
  const [req] = await Promise.all([page.waitForRequest(isList), action()]);
  const res = await req.response();
  const json = await res.json();
  await settle(page);
  return { body: JSON.parse(req.postData()), json };
}
// Như reloadFull nhưng chỉ trả về request body
const reloadBy = async (page, action) => (await reloadFull(page, action)).body;

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

// Tên các game đang hiển thị (chip) của 1 dòng và chip "+ N ..." (nếu có)
async function chipInfo(page, i) {
  const texts = (await chipsAt(page, i).allInnerTexts()).map(norm);
  const toggle = await toggleChip(page, i).count();
  const more = toggle ? texts[texts.length - 1] : null;
  return { games: toggle ? texts.slice(0, -1) : texts, more };
}

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Text option của filter Game Name: "<code> - <label>"
const optionText = (g) => `${g.code} - ${g.label}`;

// Chọn game ở filter Game Name (dropdown chọn 1 giá trị, tự đóng sau khi chọn).
// Gõ code vào ô tìm kiếm trước để option chắc chắn nằm trong danh sách hiển thị; code là duy nhất nên option khớp đúng 1.
async function selectGame(page, g) {
  await openDropdown(page, "gameId");
  await page.keyboard.type(g.code);
  await openOptions(page).filter({ hasText: exact(optionText(g)) }).first().click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Đọc toàn bộ option của dropdown Game Name
async function gameFilterOptions(page) {
  await openDropdown(page, "gameId");
  await openOptions(page).first().waitFor();
  const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  // Click ra ngoài để đóng dropdown - phím Esc không đóng được khi chưa gõ tìm kiếm
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
  return titles;
}

// Giá trị đang được chọn của filter Game Name (dropdown chọn 1)
const selectedGame = (page) =>
  filterEl(page, "gameId")
    .locator(".ant-select-selection-item[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));

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

// Đóng hộp thoại bằng Cancel (không bao giờ bấm Submit khi form hợp lệ / Delete)
async function closeDialog(page) {
  await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
  await expect(dialog(page)).toBeHidden();
}

// Các thành phần của hộp thoại Add / Edit
const nameInput = (page) => dialog(page).locator("#name");
const nameErrors = (page) => dialog(page).locator(".ant-form-item-explain-error");
const gameError = (page) => dialog(page).locator('[class*="_field-error_"]');
const gameSearch = (page) => dialog(page).locator('input[placeholder="Search game"]');
const gameRows = (page) => dialog(page).locator(".ant-table-body tbody tr.ant-table-row");
const selectedCountText = (page) => dialog(page).locator('[class*="_selected-count_"]');
const selectAll = (page) => dialog(page).locator('thead input[type="checkbox"]');
const submitBtn = (page) => dialog(page).getByRole("button", { name: /Submit$/ });
const checkedKeys = (page) =>
  gameRows(page).evaluateAll((trs) => trs.filter((t) => t.querySelector("input").checked).map((t) => t.dataset.rowKey));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Game Recommendation > Recommendation Group", () => {
  let writes;
  let gamesLoaded; // promise của response dropdown/game (danh sách game) lúc mở trang
  // Danh sách game { value, code, label } mà dropdown/game trả về
  const games = async () => (await (await gamesLoaded).json()).data;

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, số dòng/trang và cách sắp xếp được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__recommendation_group_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/recommendation-group_(filter|page_size)$|^sorter__game-recommendation_recommendation-group$/.test(k)) {
          localStorage.removeItem(k);
        }
      }
      sessionStorage.setItem("__recommendation_group_spec_cleared", "1");
    });
    writes = watchWrites(page);
    await blockWrites(page);
    gamesLoaded = page.waitForResponse(isGameDropdown, { timeout: 60000 });
    gamesLoaded.catch(() => {});
    await openPage(page);
  });

  // Mọi test đều không được gửi request ghi dữ liệu
  test.afterEach(async () => {
    expect(writes, "Không được gửi request ghi dữ liệu").toEqual([]);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, đủ 2 filter và 2 nút Search/Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Recommendation Group");
      for (const [label, id] of [
        ["Group Name", "name"],
        ["Game Name", "gameId"],
      ]) {
        await expect(filterEl(page, id), `thiếu filter ${label}`).toContainText(label);
        await expect(filterEl(page, id)).toBeVisible();
      }
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: tất cả để trống", async ({ page }) => {
      await expect(page.locator("#name")).toHaveValue("");
      await expect(filterEl(page, "gameId").locator(".ant-select-selection-item")).toHaveCount(0);
    });

    test("Game Name là dropdown chọn 1 giá trị (có tìm kiếm), Group Name là ô nhập chữ", async ({ page }) => {
      await expect(filterEl(page, "gameId").locator(".ant-select-single")).toHaveCount(1);
      await expect(filterEl(page, "gameId").locator(".ant-select-multiple")).toHaveCount(0);
      await expect(filterEl(page, "gameId").locator(".ant-select-show-search")).toHaveCount(1);
      await expect(filterEl(page, "name").locator(".ant-select")).toHaveCount(0);
    });

    test("Có nút Add New và Manage Columns; không có Export, checkbox chọn dòng / thao tác hàng loạt", async ({ page }) => {
      await expect(addBtn(page)).toBeVisible();
      await expect(columnBtn(page)).toBeVisible();
      await expect(exportBtn(page)).toHaveCount(0);
      await expect(page.locator("button.NextGen-button-more-action__update")).toHaveCount(0);
      await expect(page.locator('.ant-table input[type="checkbox"]')).toHaveCount(0);
    });

    test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự`, async ({ page }) => {
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Mặc định: trang 1, 10 dòng, sắp xếp mới nhất (id giảm dần) lên đầu, không gửi filter", async ({ page }) => {
      const { body, json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc" });
      expect(body.filters).toEqual({});
      const ids = json.data.list.map((x) => x.id);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
      expect(ids.length).toBeLessThanOrEqual(10);
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

  // ===== 2. Dữ liệu bảng =====
  test.describe("Dữ liệu bảng", () => {
    test("Mỗi dòng khớp response API (Group Name, No. of Game, các chip game)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      await expect(rows(page)).toHaveCount(list.length);

      for (const [i, g] of list.entries()) {
        const at = `dòng ${i + 1} (group ${g.id})`;
        expect(norm(await cellAt(page, i, COL.name).innerText()), at).toBe(norm(g.name));
        expect(norm(await cellAt(page, i, COL.total).innerText()), at).toBe(String(g.totalGame));
        const { games: shown } = await chipInfo(page, i);
        expect(shown, at).toEqual(g.games.slice(0, MAX_CHIPS).map((x) => norm(x.name)));
      }
    });

    test("No. of Game là số nguyên không âm và bằng số game thực tế của nhóm", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const v of await columnValues(page, "No. of Game")) expect(v).toMatch(/^\d+$/);
      for (const g of json.data.list) expect(g.totalGame, `group ${g.id}`).toBe(g.games.length);
    });

    test("Group Name không rỗng và không trùng nhau giữa các dòng", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      const names = await columnValues(page, "Group Name");
      for (const v of names) expect(v).not.toBe("");
      expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    });

    test("Mỗi nhóm có ít nhất 1 game và game trong nhóm là game có thật trong dropdown/game", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const ids = new Set((await games()).map((g) => g.value));
      for (const g of json.data.list) {
        expect(g.games.length, `group ${g.id}`).toBeGreaterThan(0);
        for (const x of g.games) expect(ids.has(x.id), `game ${x.id} của group ${g.id}`).toBe(true);
      }
    });

    test("Chỉ hiển thị tối đa 4 chip game + chip '+ N ...' (N = số game còn lại); nhóm ≤ 4 game không có chip này", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      for (const [i, g] of list.entries()) {
        const at = `dòng ${i + 1} (group ${g.id}, ${g.totalGame} game)`;
        const { games: shown, more } = await chipInfo(page, i);
        expect(shown.length, at).toBe(Math.min(g.totalGame, MAX_CHIPS));
        if (g.totalGame > MAX_CHIPS) expect(more, at).toBe(`+ ${g.totalGame - MAX_CHIPS} ...`);
        else expect(more, at).toBeNull();
      }
    });

    test("Bấm chip '+ N ...' hiện đủ game của nhóm theo đúng thứ tự, bấm lại thì thu gọn", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      const i = list.findIndex((g) => g.totalGame > MAX_CHIPS);
      test.skip(i < 0, `Không có nhóm nào có hơn ${MAX_CHIPS} game`);
      const g = list[i];

      await toggleChip(page, i).click();
      await expect
        .poll(async () => (await chipInfo(page, i)).games, { message: "chưa hiện đủ game" })
        .toEqual(g.games.map((x) => norm(x.name)));
      // Chip bấm được vẫn còn (dùng để thu gọn) nhưng không còn chữ "+ N ..."
      await expect(toggleChip(page, i)).toHaveCount(1);

      await toggleChip(page, i).click();
      await expect
        .poll(async () => (await chipInfo(page, i)).games, { message: "chưa thu gọn" })
        .toEqual(g.games.slice(0, MAX_CHIPS).map((x) => norm(x.name)));
      expect((await chipInfo(page, i)).more).toBe(`+ ${g.totalGame - MAX_CHIPS} ...`);
    });

    test("Mở rộng 1 dòng không ảnh hưởng các dòng khác", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      const big = list.map((g, i) => i).filter((i) => list[i].totalGame > MAX_CHIPS);
      test.skip(big.length < 2, `Cần ít nhất 2 nhóm có hơn ${MAX_CHIPS} game`);
      await toggleChip(page, big[0]).click();
      await expect
        .poll(async () => (await chipInfo(page, big[0])).games.length)
        .toBe(list[big[0]].totalGame);
      const other = await chipInfo(page, big[1]);
      expect(other.games.length).toBe(MAX_CHIPS);
      expect(other.more).toBe(`+ ${list[big[1]].totalGame - MAX_CHIPS} ...`);
    });

    test("Mỗi dòng có icon Update và Delete (chỉ hover, không bấm)", async ({ page }) => {
      const n = Math.min(5, await rows(page).count());
      test.skip(n === 0, "Không có dữ liệu");
      for (let i = 0; i < n; i++) {
        await expect(cellAt(page, i, COL.action).locator("svg")).toHaveCount(2);
        // Tooltip antd có độ trễ khi mở / đóng và có thể lỡ nếu chuột đã đứng sẵn ở icon:
        // đưa chuột ra ngoài, đợi tooltip cũ ẩn rồi hover lại, thử lại tới khi tooltip hiện.
        for (const [icon, text] of [
          [editIcon(page, i), "Update"],
          [deleteIcon(page, i), "Delete"],
        ]) {
          await expect(async () => {
            await page.mouse.move(0, 0);
            await expect(tooltip(page)).toHaveCount(0, { timeout: 2000 });
            await icon.hover();
            await expect(tooltip(page).filter({ hasText: text })).toBeVisible({ timeout: 2000 });
          }).toPass({ timeout: 15000 });
        }
      }
    });
  });

  // ===== 3. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Option của Game Name lấy từ API dropdown/game, hiển thị dạng 'code - tên game'", async ({ page }) => {
      const data = await games();
      test.skip(data.length === 0, "Không có game nào");
      const titles = await gameFilterOptions(page);
      expect([...titles].sort()).toEqual(data.map(optionText).sort());
    });

    test("Lọc theo Group Name khớp một phần, không phân biệt hoa/thường", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const name = json.data.list[0].name;
      const part = name.slice(1, Math.max(3, name.length - 1)).trim().toUpperCase();
      await fillFilter(page, "name", part);
      const { body, json: res } = await search(page);
      expect(body.filters.name).toBe(part);
      expect(res.data.list.length).toBeGreaterThan(0);
      expect(res.data.list.map((g) => g.name)).toContain(name);
      for (const g of res.data.list) expect(g.name.toUpperCase()).toContain(part);
      for (const v of await columnValues(page, "Group Name")) expect(v.toUpperCase()).toContain(norm(part));
      await expect(summary(page)).toContainText(`of ${res.data.totalCount} records`);
    });

    test("Lọc theo Group Name đầy đủ trả về đúng nhóm đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const g = json.data.list[0];
      await fillFilter(page, "name", g.name);
      const { body, json: res } = await search(page);
      expect(body.filters.name).toBe(g.name);
      expect(res.data.list.map((x) => x.id)).toContain(g.id);
      for (const v of await columnValues(page, "Group Name")) expect(v.toLowerCase()).toContain(norm(g.name).toLowerCase());
    });

    test("Lọc theo Game Name của game đầu tiên trong nhóm đầu tiên gửi gameId và mọi nhóm đều chứa game đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list[0];
      const game = (await games()).find((g) => g.value === first.games[0].id);
      test.skip(!game, "Game đầu tiên của nhóm không có trong dropdown/game");

      await selectGame(page, game);
      expect(await selectedGame(page)).toEqual([optionText(game)]);
      const { body, json: res } = await search(page);
      expect(body.filters).toEqual({ gameId: game.value });
      expect(res.data.list.map((x) => x.id)).toContain(first.id);
      for (const g of res.data.list) {
        expect(g.games.map((x) => x.id), `group ${g.id} phải chứa game ${game.value}`).toContain(game.value);
      }
      await expect(rows(page)).toHaveCount(res.data.list.length);
      await expect(summary(page)).toContainText(`of ${res.data.totalCount} records`);
    });

    test("Lọc theo Game Name vẫn hiển thị đủ game của nhóm (không chỉ game đã chọn)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const first = json.data.list.find((g) => g.totalGame >= 2);
      test.skip(!first, "Không có nhóm nào có từ 2 game");
      const game = (await games()).find((g) => g.value === first.games[0].id);
      test.skip(!game, "Game đầu tiên của nhóm không có trong dropdown/game");
      await selectGame(page, game);
      const { json: res } = await search(page);
      const i = res.data.list.findIndex((g) => g.id === first.id);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(norm(await cellAt(page, i, COL.total).innerText())).toBe(String(first.totalGame));
      expect((await chipInfo(page, i)).games).toEqual(first.games.slice(0, MAX_CHIPS).map((x) => norm(x.name)));
    });

    test("Game Name chỉ chọn được 1 giá trị: chọn game khác sẽ thay thế game cũ", async ({ page }) => {
      const data = await games();
      test.skip(data.length < 2, "Cần ít nhất 2 game");
      await selectGame(page, data[0]);
      await selectGame(page, data[1]);
      expect(await selectedGame(page)).toEqual([optionText(data[1])]);
      const { body } = await search(page);
      expect(body.filters).toEqual({ gameId: data[1].value });
    });

    test("Xoá game đã chọn bằng (x) rồi Search thì không gửi gameId", async ({ page }) => {
      const data = await games();
      test.skip(data.length === 0, "Không có game nào");
      await selectGame(page, data[0]);
      await filterEl(page, "gameId").locator(".ant-select").hover();
      await filterEl(page, "gameId").locator(".ant-select-clear").click({ force: true });
      await expect(filterEl(page, "gameId").locator(".ant-select-selection-item")).toHaveCount(0);
      const { body } = await search(page);
      expect(body.filters).toEqual({});
    });

    test("Kết hợp Group Name và Game Name cùng lúc (AND)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      const game = (await games()).find((g) => g.value === c.games[0].id);
      test.skip(!game, "Game đầu tiên của nhóm không có trong dropdown/game");

      await fillFilter(page, "name", c.name);
      await selectGame(page, game);
      const { body, json: res } = await search(page);
      expect(body.filters).toMatchObject({ name: c.name, gameId: game.value });
      expect(res.data.list.map((x) => x.id)).toContain(c.id);
      for (const g of res.data.list) {
        expect(g.name.toLowerCase()).toContain(c.name.toLowerCase());
        expect(g.games.map((x) => x.id)).toContain(game.value);
      }
    });

    test("Group Name + Game Name không khớp nhau -> nhóm đó không nằm trong kết quả", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      const inGroup = new Set(c.games.map((x) => x.id));
      const other = (await games()).find((g) => !inGroup.has(g.value));
      test.skip(!other, "Nhóm đầu tiên đã chứa mọi game");

      await fillFilter(page, "name", c.name);
      await selectGame(page, other);
      const { json: res } = await search(page);
      expect(res.data.list.map((x) => x.id)).not.toContain(c.id);
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

  // ===== 4. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá toàn bộ filter đã chọn và hiển thị lại toàn bộ dữ liệu", async ({ page }) => {
      const first = await search(page);
      test.skip(first.json.data.list.length === 0, "Không có dữ liệu");
      const game = (await games()).find((g) => g.value === first.json.data.list[0].games[0].id);
      test.skip(!game, "Game đầu tiên của nhóm không có trong dropdown/game");
      await fillFilter(page, "name", "qa");
      await selectGame(page, game);
      await search(page);

      await resetBtn(page).click();
      await expect(page.locator("#name")).toHaveValue("");
      await expect(filterEl(page, "gameId").locator(".ant-select-selection-item")).toHaveCount(0);

      const { body, json } = await search(page);
      expect(body.filters).toEqual({});
      expect(json.data.totalCount).toBe(first.json.data.totalCount);
    });
  });

  // ===== 5. Phân trang =====
  test.describe("Phân trang", () => {
    test("Chỉ có 1 trang: số trang hiện tại là 1, nút Previous / Next đều bị tắt", async ({ page }) => {
      const total = await totalOf(page);
      test.skip(total === 0 || total > 10, "Không phải trường hợp chỉ có 1 trang");
      await expect(page.locator(".ant-pagination-item")).toHaveCount(1);
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
      await expect(page.locator(".ant-pagination-prev button")).toBeDisabled();
      await expect(page.locator(".ant-pagination-next button")).toBeDisabled();
    });

    test("Đổi số dòng / trang: có đủ 5 lựa chọn, đổi sang 20 thì gửi pageSize=20, trang 1", async ({ page }) => {
      const total = await totalOf(page);
      await page.locator(".ant-pagination-options .ant-select").click();
      const sizes = await openOptions(page).allInnerTexts();
      expect(sizes).toEqual(["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"]);

      const { body, json } = await reloadFull(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
      expect(body.pageSize).toBe(20);
      expect(body.page).toBe(1);
      const shown = Math.min(20, total);
      await expect(rows(page)).toHaveCount(shown);
      expect(json.data.list.length).toBe(shown);
      await expect(summary(page)).toHaveText(new RegExp(`^Showing 1 - ${shown} of `));
    });

    test.describe("Khi có nhiều hơn 20 bản ghi", () => {
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
        const names1 = await columnValues(page, "Group Name");
        await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        const names2 = await columnValues(page, "Group Name");
        for (const n of names2) expect(names1).not.toContain(n);
      });

      test("Giữ nguyên sắp xếp khi chuyển trang", async ({ page }) => {
        const sorted = await reloadBy(page, () =>
          page.locator(".ant-table-thead th", { hasText: exact("Group Name") }).click(),
        );
        expect(sorted).toMatchObject({ sortBy: "name", sortDirection: "asc" });
        const body = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
        expect(body).toMatchObject({ page: 2, sortBy: "name", sortDirection: "asc" });
      });
    });
  });

  // ===== 6. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    const th = (page, column) => page.locator(".ant-table-thead th", { hasText: exact(column) });

    for (const [column, sortBy] of Object.entries(SORTABLE)) {
      test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định (id giảm dần)`, async ({ page }) => {
        test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");

        // Mặc định đang sort theo id nên lần bấm đầu sort tăng dần theo cột này
        const asc = await reloadFull(page, () => th(page, column).click());
        expect(asc.body).toMatchObject({ sortBy, sortDirection: "asc" });
        // Cột chữ phụ thuộc collation của server -> chỉ kiểm tra bảng hiển thị đúng thứ tự backend trả về
        await expect
          .poll(() => columnValues(page, column), { message: "thứ tự bảng = thứ tự response (asc)" })
          .toEqual(asc.json.data.list.map((g) => norm(g.name)));

        const desc = await reloadFull(page, () => th(page, column).click());
        expect(desc.body).toMatchObject({ sortBy, sortDirection: "desc" });
        await expect
          .poll(() => columnValues(page, column), { message: "thứ tự bảng = thứ tự response (desc)" })
          .toEqual(desc.json.data.list.map((g) => norm(g.name)));

        // Click lần 3: bỏ sort -> quay về mặc định id giảm dần
        const none = await reloadFull(page, () => th(page, column).click());
        expect(none.body).toMatchObject({ sortBy: "id", sortDirection: "desc" });
        const ids = none.json.data.list.map((g) => g.id);
        expect(ids).toEqual([...ids].sort((a, b) => b - a));
      });
    }

    test("Sort giảm dần là đảo ngược của tăng dần (khi tên các nhóm không trùng nhau và chỉ có 1 trang)", async ({ page }) => {
      const { json } = await search(page);
      const names = json.data.list.map((g) => g.name.toLowerCase());
      test.skip(json.data.totalCount > 10 || names.length < 2, "Cần 2+ nhóm và chỉ có 1 trang");
      test.skip(new Set(names).size !== names.length, "Có tên nhóm trùng nhau (không phân biệt hoa/thường)");
      const asc = await reloadFull(page, () => th(page, "Group Name").click());
      const desc = await reloadFull(page, () => th(page, "Group Name").click());
      expect(desc.json.data.list.map((g) => g.id)).toEqual(asc.json.data.list.map((g) => g.id).reverse());
    });

    test("Sort giữ nguyên filter đang áp dụng", async ({ page }) => {
      const first = await search(page);
      const list = first.json.data.list;
      test.skip(list.length < 2, "Không đủ dữ liệu để kiểm tra");
      // Chọn 1 ký tự (lấy từ tên nhóm đầu tiên) mà có ít nhất 2 nhóm chứa nó
      const ch = [...list[0].name.toLowerCase()].find(
        (c) => /[a-z0-9]/.test(c) && list.filter((g) => g.name.toLowerCase().includes(c)).length >= 2,
      );
      test.skip(!ch, "Không có ký tự chung giữa 2 tên nhóm");
      await fillFilter(page, "name", ch);
      const filtered = await search(page);
      expect(filtered.json.data.list.length).toBeGreaterThanOrEqual(2);
      const { body, json } = await reloadFull(page, () => th(page, "Group Name").click());
      expect(body).toMatchObject({ sortBy: "name", sortDirection: "asc" });
      expect(body.filters).toEqual(filtered.body.filters);
      expect(json.data.list.length).toBe(filtered.json.data.list.length);
      for (const g of json.data.list) expect(g.name.toLowerCase()).toContain(ch);
    });

    // Cách sắp xếp được app lưu ở localStorage (sorter__game-recommendation_recommendation-group) -> reload vẫn giữ
    test("Cách sắp xếp được ghi nhớ sau khi tải lại trang; bỏ sort thì về mặc định id giảm dần", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu");
      await reloadBy(page, () => th(page, "Group Name").click());
      const [req] = await Promise.all([page.waitForRequest(isList), page.reload()]);
      expect(JSON.parse(req.postData())).toMatchObject({ sortBy: "name", sortDirection: "asc" });
      await waitTableIdle(page);

      // Bấm 2 lần nữa (asc -> desc -> bỏ sort) rồi reload: về mặc định
      await reloadBy(page, () => th(page, "Group Name").click());
      await reloadBy(page, () => th(page, "Group Name").click());
      const [req2] = await Promise.all([page.waitForRequest(isList), page.reload()]);
      expect(JSON.parse(req2.postData())).toMatchObject({ sortBy: "id", sortDirection: "desc" });
    });

    test("Các cột No. of Game, Game Name và Action không có chức năng sort", async ({ page }) => {
      for (const column of ["No. of Game", "Game Name", "Action"]) {
        await expect(th(page, column), column).not.toHaveClass(/ant-table-column-has-sorters/);
      }
      await expect(th(page, "Group Name")).toHaveClass(/ant-table-column-has-sorters/);
    });
  });

  // ===== 7. Hộp thoại Add =====
  test.describe("Hộp thoại Add Recommendation Group (không bấm Submit)", () => {
    test("Add New mở hộp thoại với form trống: chưa nhập tên, chưa chọn game, có Cancel / Submit", async ({ page }) => {
      const data = await games();
      await addBtn(page).click();
      await expect(dialog(page)).toContainText("Add Recommendation Group");
      await expect(nameInput(page)).toHaveValue("");
      await expect(nameInput(page)).toHaveAttribute("placeholder", "Enter Group Name");
      await expect(nameInput(page)).toHaveAttribute("maxlength", "50");
      await expect(selectedCountText(page)).toHaveText(`0 of ${data.length} selected`);
      await expect(gameSearch(page)).toHaveValue("");
      expect(await checkedKeys(page)).toEqual([]);
      await expect(nameErrors(page)).toHaveCount(0);
      await expect(gameError(page)).toHaveCount(0);
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(submitBtn(page)).toBeVisible();
      await closeDialog(page);
    });

    test("Danh sách game trong hộp thoại lấy từ API dropdown/game (đúng thứ tự, dạng 'code - tên game')", async ({ page }) => {
      const data = await games();
      test.skip(data.length === 0, "Không có game nào");
      await addBtn(page).click();
      await expect(gameRows(page)).toHaveCount(data.length);
      expect(await gameRows(page).evaluateAll((trs) => trs.map((t) => t.dataset.rowKey))).toEqual(
        data.map((g) => String(g.value)),
      );
      expect(await gameRows(page).evaluateAll((trs) => trs.map((t) => t.innerText.trim()))).toEqual(
        data.map(optionText),
      );
      await closeDialog(page);
    });

    test("Chọn / bỏ chọn 1 game: bộ đếm 'x of N selected' thay đổi tương ứng", async ({ page }) => {
      const data = await games();
      test.skip(data.length === 0, "Không có game nào");
      await addBtn(page).click();
      await gameRows(page).first().locator("input").click();
      await expect(selectedCountText(page)).toHaveText(`1 of ${data.length} selected`);
      expect(await checkedKeys(page)).toEqual([String(data[0].value)]);
      await gameRows(page).first().locator("input").click();
      await expect(selectedCountText(page)).toHaveText(`0 of ${data.length} selected`);
      await closeDialog(page);
    });

    test("Checkbox tiêu đề chọn / bỏ chọn tất cả game", async ({ page }) => {
      const data = await games();
      test.skip(data.length === 0, "Không có game nào");
      await addBtn(page).click();
      await selectAll(page).click();
      await expect(selectedCountText(page)).toHaveText(`${data.length} of ${data.length} selected`);
      expect(await checkedKeys(page)).toHaveLength(data.length);
      await selectAll(page).click();
      await expect(selectedCountText(page)).toHaveText(`0 of ${data.length} selected`);
      expect(await checkedKeys(page)).toEqual([]);
      await closeDialog(page);
    });

    test("Ô Search game lọc theo code hoặc tên game, không phân biệt hoa/thường", async ({ page }) => {
      const data = await games();
      test.skip(data.length < 2, "Cần ít nhất 2 game");
      const term = data[1].label;
      const expected = data.filter(
        (g) => g.label.toLowerCase().includes(term.toLowerCase()) || g.code.toLowerCase().includes(term.toLowerCase()),
      );
      await addBtn(page).click();
      await gameSearch(page).fill(term.toUpperCase());
      await expect(gameRows(page)).toHaveCount(expected.length);
      expect(await gameRows(page).evaluateAll((trs) => trs.map((t) => t.dataset.rowKey))).toEqual(
        expected.map((g) => String(g.value)),
      );

      // Tìm theo code
      await gameSearch(page).fill(data[0].code.toLowerCase());
      const byCode = data.filter(
        (g) =>
          g.code.toLowerCase().includes(data[0].code.toLowerCase()) ||
          g.label.toLowerCase().includes(data[0].code.toLowerCase()),
      );
      await expect(gameRows(page)).toHaveCount(byCode.length);
      await closeDialog(page);
    });

    test("Search game không có kết quả -> hiển thị 'No data'", async ({ page }) => {
      await addBtn(page).click();
      await gameSearch(page).fill(`khong-co-${Date.now()}`);
      await expect(gameRows(page)).toHaveCount(0);
      await expect(dialog(page).locator(".ant-table-body")).toContainText("No data");
      await closeDialog(page);
    });

    test("Chọn tất cả khi đang tìm kiếm chỉ chọn các game đã lọc; xoá ô tìm kiếm vẫn giữ lựa chọn", async ({ page }) => {
      const data = await games();
      test.skip(data.length < 2, "Cần ít nhất 2 game");
      const term = data[0].code.slice(0, 3).toLowerCase();
      const expected = data.filter((g) => g.label.toLowerCase().includes(term) || g.code.toLowerCase().includes(term));
      test.skip(expected.length === data.length, "Từ khoá khớp mọi game, không phân biệt được lọc / không lọc");
      await addBtn(page).click();
      await gameSearch(page).fill(term);
      await expect(gameRows(page)).toHaveCount(expected.length);
      await selectAll(page).click();
      await expect(selectedCountText(page)).toHaveText(`${expected.length} of ${data.length} selected`);

      await gameSearch(page).fill("");
      await expect(gameRows(page)).toHaveCount(data.length);
      await expect(selectedCountText(page)).toHaveText(`${expected.length} of ${data.length} selected`);
      expect((await checkedKeys(page)).sort()).toEqual(expected.map((g) => String(g.value)).sort());
      await closeDialog(page);
    });

    test("Để trống cả tên và game rồi Submit: báo 2 lỗi và không gửi request lưu", async ({ page }) => {
      await addBtn(page).click();
      await submitBtn(page).click(); // form lỗi nên bị chặn, không lưu gì
      await expect(nameErrors(page)).toHaveText([MSG.name]);
      await expect(gameError(page)).toHaveText(MSG.games);
      await expect(dialog(page)).toBeVisible();
      await closeDialog(page);
    });

    test("Sau khi Submit lỗi: nhập tên hợp lệ thì lỗi tên biến mất, chọn 1 game thì lỗi game biến mất", async ({ page }) => {
      const data = await games();
      test.skip(data.length === 0, "Không có game nào");
      await addBtn(page).click();
      await submitBtn(page).click(); // chặn vì form trống
      await expect(nameErrors(page)).toHaveText([MSG.name]);
      await expect(gameError(page)).toHaveText(MSG.games);

      await nameInput(page).fill("QA Check Create");
      await expect(nameErrors(page)).toHaveCount(0);
      await expect(gameError(page)).toHaveText(MSG.games);

      await gameRows(page).first().locator("input").click();
      await expect(gameError(page)).toHaveCount(0);
      await closeDialog(page); // KHÔNG Submit
    });

    test("Xoá hết nội dung ô tên: báo 'Group name is required'", async ({ page }) => {
      await addBtn(page).click();
      await nameInput(page).fill("abc");
      await expect(nameErrors(page)).toHaveCount(0);
      await nameInput(page).fill("");
      await expect(nameErrors(page)).toHaveText([MSG.name]);
      await closeDialog(page);
    });

    test("Tên chỉ gồm khoảng trắng: báo 'Group name is required'", async ({ page }) => {
      await addBtn(page).click();
      await nameInput(page).fill("   ");
      await expect(nameErrors(page)).toHaveText([MSG.name]);
      await closeDialog(page);
    });

    test("Tên quá ngắn (dưới 3 ký tự): báo lỗi độ dài 3-50 ký tự", async ({ page }) => {
      await addBtn(page).click();
      await nameInput(page).fill("ab");
      await expect(nameErrors(page)).toHaveText([MSG.length]);
      await closeDialog(page);
    });

    for (const value of ["Name_x", "Name@#", "Name/1"]) {
      test(`Tên chứa ký tự không cho phép "${value}": báo lỗi định dạng`, async ({ page }) => {
        await addBtn(page).click();
        await nameInput(page).fill(value);
        await expect(nameErrors(page)).toHaveText([MSG.format]);
        await closeDialog(page);
      });
    }

    test("Tên hợp lệ (chữ, số, khoảng trắng và các ký tự . , ' -) không báo lỗi", async ({ page }) => {
      await addBtn(page).click();
      await nameInput(page).fill("QA Group 1.2, it's-ok");
      await expect(nameErrors(page)).toHaveCount(0);
      await closeDialog(page);
    });

    test("Ô tên giới hạn 50 ký tự (nhập 60 ký tự chỉ giữ 50)", async ({ page }) => {
      await addBtn(page).click();
      await nameInput(page).fill("a".repeat(60));
      expect(await nameInput(page).inputValue()).toHaveLength(50);
      await expect(nameErrors(page)).toHaveCount(0);
      await closeDialog(page);
    });

    test("Cancel đóng hộp thoại, mở lại form được reset; đóng bằng X cũng không lưu gì", async ({ page }) => {
      const data = await games();
      const { json } = await search(page);
      await addBtn(page).click();
      await nameInput(page).fill("Tên thử - không lưu");
      await gameSearch(page).fill("a");
      await closeDialog(page);

      await addBtn(page).click();
      await expect(nameInput(page)).toHaveValue("");
      await expect(gameSearch(page)).toHaveValue("");
      await expect(selectedCountText(page)).toHaveText(`0 of ${data.length} selected`);
      await dialog(page).getByRole("button", { name: "Close" }).first().click();
      await expect(dialog(page)).toBeHidden();
      await expect(summary(page)).toContainText(`of ${json.data.totalCount} records`);
    });
  });

  // ===== 8. Hộp thoại Update =====
  test.describe("Hộp thoại Update Recommendation Group (không bấm Submit)", () => {
    test("Bấm icon Update gọi recommendation-group/view và hiển thị đúng tên + game đã chọn của nhóm", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      const data = await games();
      const all = new Set(data.map((g) => g.value));
      test.skip(!c.games.every((g) => all.has(g.id)), "Nhóm có game không còn trong dropdown/game");

      const [req] = await Promise.all([page.waitForRequest(isView), editIcon(page, 0).click()]);
      expect(JSON.parse(req.postData()).id).toBe(c.id);

      await expect(dialog(page)).toContainText(`Edit Recommendation Group ${c.name}`);
      await expect(nameInput(page)).toHaveValue(c.name);
      await expect(selectedCountText(page)).toHaveText(`${c.totalGame} of ${data.length} selected`);
      await expect
        .poll(async () => (await checkedKeys(page)).sort(), { message: "game được tích sẵn phải là game của nhóm" })
        .toEqual(c.games.map((g) => String(g.id)).sort());
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(submitBtn(page)).toBeVisible();
      await closeDialog(page);
    });

    test("Mở Update của nhiều dòng: mỗi lần hiển thị đúng dữ liệu của dòng đó", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list.slice(0, 3);
      test.skip(list.length === 0, "Không có dữ liệu");
      for (const [i, c] of list.entries()) {
        const [req] = await Promise.all([page.waitForRequest(isView), editIcon(page, i).click()]);
        expect(JSON.parse(req.postData()).id).toBe(c.id);
        await expect(nameInput(page), `dòng ${i + 1}`).toHaveValue(c.name);
        await expect(dialog(page)).toContainText(`Edit Recommendation Group ${c.name}`);
        await closeDialog(page);
      }
    });

    test("Xoá tên rồi Submit: báo lỗi, bị chặn và không gửi request lưu", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      await editIcon(page, 0).click();
      // Chờ dữ liệu (API view) nạp vào form xong rồi mới sửa, nếu không giá trị nạp muộn sẽ ghi đè lên chỗ đã xoá
      await expect(nameInput(page)).toHaveValue(c.name);
      await nameInput(page).fill("");
      await expect(nameErrors(page)).toHaveText([MSG.name]);
      await submitBtn(page).click(); // tên trống nên bị chặn, không lưu gì
      await expect(nameErrors(page)).toHaveText([MSG.name]);
      await expect(dialog(page)).toBeVisible();
      await closeDialog(page);
    });

    test("Xoá tên và bỏ chọn hết game rồi Submit: báo cả 2 lỗi, không gửi request lưu", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      await editIcon(page, 0).click();
      await expect(nameInput(page)).toHaveValue(c.name);
      await expect(selectedCountText(page)).not.toHaveText(/^0 of /);
      await nameInput(page).fill("");
      // Bấm 1-2 lần checkbox tiêu đề để về trạng thái không chọn game nào
      if ((await checkedKeys(page)).length > 0) {
        await selectAll(page).click();
        if ((await checkedKeys(page)).length > 0) await selectAll(page).click();
      }
      await expect(selectedCountText(page)).toHaveText(/^0 of /);
      await submitBtn(page).click(); // tên trống nên bị chặn, không lưu gì
      await expect(nameErrors(page)).toHaveText([MSG.name]);
      await expect(gameError(page)).toHaveText(MSG.games);
      await closeDialog(page);
    });

    test("Tên sai định dạng / quá ngắn trong hộp thoại Update báo lỗi giống hộp thoại Add", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await editIcon(page, 0).click();
      await expect(nameInput(page)).toHaveValue(json.data.list[0].name);
      await nameInput(page).fill("ab");
      await expect(nameErrors(page)).toHaveText([MSG.length]);
      await nameInput(page).fill("Name_x");
      await expect(nameErrors(page)).toHaveText([MSG.format]);
      await closeDialog(page);
    });

    test("Sửa tên và bỏ chọn game rồi Cancel thì danh sách không đổi, mở lại vẫn thấy dữ liệu gốc", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      await editIcon(page, 0).click();
      await expect(nameInput(page)).toHaveValue(c.name);
      await nameInput(page).fill(`${c.name} sửa thử`);
      await selectAll(page).click();
      await closeDialog(page);
      await expect(cellAt(page, 0, COL.name)).toHaveText(norm(c.name));
      await expect(cellAt(page, 0, COL.total)).toHaveText(String(c.totalGame));

      await editIcon(page, 0).click();
      await expect(nameInput(page)).toHaveValue(c.name);
      await expect(selectedCountText(page)).toContainText(`${c.totalGame} of`);
      await closeDialog(page);
    });

    test("Đóng hộp thoại bằng nút X", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      await editIcon(page, 0).click();
      await expect(dialog(page)).toBeVisible();
      await dialog(page).getByRole("button", { name: "Close" }).first().click();
      await expect(dialog(page)).toBeHidden();
    });
  });

  // ===== 9. Hộp thoại Delete =====
  test.describe("Hộp thoại Delete (không bấm nút Delete xác nhận)", () => {
    test("Bấm icon Delete hiện hộp thoại xác nhận đúng tên nhóm, có nút Cancel / Delete; chưa gửi request nào", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const c = json.data.list[0];
      await deleteIcon(page, 0).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText("Delete");
      await expect(dialog(page)).toContainText(`Are you sure you want to delete group ${c.name}?`);
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Delete$/ })).toBeVisible();
      await closeDialog(page); // KHÔNG bấm Delete
    });

    test("Mỗi dòng mở hộp thoại Delete với đúng tên nhóm của dòng đó", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list.slice(0, 3);
      test.skip(list.length === 0, "Không có dữ liệu");
      for (const [i, c] of list.entries()) {
        await deleteIcon(page, i).click();
        await expect(dialog(page), `dòng ${i + 1}`).toContainText(`Are you sure you want to delete group ${c.name}?`);
        await closeDialog(page);
      }
    });

    test("Cancel / X đóng hộp thoại và danh sách không thay đổi", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const before = await columnValues(page, "Group Name");

      await deleteIcon(page, 0).click();
      await closeDialog(page);
      await expect(summary(page)).toContainText(`of ${json.data.totalCount} records`);
      expect(await columnValues(page, "Group Name")).toEqual(before);

      await deleteIcon(page, 0).click();
      await dialog(page).getByRole("button", { name: "Close" }).first().click();
      await expect(dialog(page)).toBeHidden();
      await expect(summary(page)).toContainText(`of ${json.data.totalCount} records`);
      expect(await columnValues(page, "Group Name")).toEqual(before);
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
      await item(page, "Game Name").locator("label").click();
      expect(await headers(page)).not.toContain("Game Name");
      expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

      await item(page, "Game Name").locator("label").click();
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      const before = await columnValues(page, "Group Name");
      const totals = await columnValues(page, "No. of Game");
      await columnBtn(page).click();
      await item(page, "Game Name").locator("label").click();
      expect(await columnValues(page, "Group Name")).toEqual(before);
      expect(await columnValues(page, "No. of Game")).toEqual(totals);
    });

    test("Cấu hình cột không được lưu: tải lại trang thì hiện đủ cột", async ({ page }) => {
      await columnBtn(page).click();
      await item(page, "Game Name").locator("label").click();
      expect(await headers(page)).not.toContain("Game Name");
      await openPage(page); // reload
      expect(await headers(page)).toEqual(COLUMNS);
    });
  });

  // ===== 11. Ghi nhớ filter =====
  test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
    const { json } = await search(page);
    test.skip(json.data.list.length === 0, "Không có dữ liệu");
    const c = json.data.list[0];
    const game = (await games()).find((g) => g.value === c.games[0].id);
    test.skip(!game, "Game đầu tiên của nhóm không có trong dropdown/game");

    const part = norm(c.name).slice(0, 3).trim(); // đầu tên của nhóm đầu -> chắc chắn còn kết quả
    await fillFilter(page, "name", part);
    await selectGame(page, game);
    await search(page);
    await page.locator(".ant-pagination-options .ant-select").click();
    await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

    await openPage(page); // reload
    await expect(page.locator("#name")).toHaveValue(part);
    expect(await selectedGame(page)).toEqual([optionText(game)]);
    await expect(page.locator(".ant-pagination-options")).toContainText("20 / page");
  });
});

// ===========================================================================
// GHI DỮ LIỆU THẬT: tạo -> sửa -> xoá 1 nhóm QA (cần RUN_FULL_TESTS=true). Nằm NGOÀI describe ở trên vì describe đó chặn
// (blockWrites) và kiểm tra không có request ghi nào.
// ===========================================================================
const isWriteTo = (action) => (r) =>
  reqOf(r).method() === "POST" && reqOf(r).url().endsWith(`/recommendation-group/${action}`);
const isCreate = isWriteTo("create");
const isUpdate = isWriteTo("update");
const isDelete = isWriteTo("delete");

// Tên nhóm QA do test tạo: chỉ chữ / số / khoảng trắng (form không cho dấu _), dài 3-50 ký tự
const QA_PREFIX = "QA Group";
const isQaGroup = (g) => typeof g?.name === "string" && new RegExp(`^${QA_PREFIX} \\d{10,}( upd)?$`).test(g.name);

// Xoá nhóm QA ở dòng i của danh sách đang hiển thị (g = phần tử response tương ứng). Từ chối xoá nhóm không phải QA.
async function deleteQaRow(page, g, i) {
  expect(isQaGroup(g), `Chỉ được xoá nhóm QA, không phải "${g.name}"`).toBe(true);
  await expect(cellAt(page, i, COL.name)).toHaveText(norm(g.name));
  await deleteIcon(page, i).click();
  await expect(dialog(page)).toContainText(`Are you sure you want to delete group ${g.name}?`);
  const [res] = await Promise.all([
    page.waitForResponse(isDelete),
    dialog(page).getByRole("button", { name: /Delete$/ }).click(),
  ]);
  expect(res.status()).toBe(200);
  expect(JSON.parse(res.request().postData()).id).toBe(g.id);
  const json = await res.json();
  expect(json).toMatchObject({ status: "success", message: "Recommendation group deleted successfully" });
  await expect(page.locator(".Toastify__toast").filter({ hasText: "Recommendation group deleted successfully" }).first()).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  await settle(page);
  return json;
}

// Xoá (qua UI) mọi nhóm QA khớp `term` đang có trên danh sách; trả về các nhóm đã xoá. Trang phải đã mở xong (openPage).
async function deleteQaGroups(page, term) {
  const deleted = [];
  await fillFilter(page, "name", term);
  for (let n = 0; n < 20; n++) {
    const { json } = await search(page);
    const i = json.data.list.findIndex(isQaGroup);
    if (i < 0) break;
    await deleteQaRow(page, json.data.list[i], i);
    deleted.push(json.data.list[i]);
  }
  return deleted;
}

test.describe("Tạo / sửa / xoá nhóm QA thật (cần RUN_FULL_TESTS=true)", () => {
  test.skip(!RUN_FULL_TESTS, SKIP_WRITE_REASON);
  test.describe.configure({ mode: "serial" });

  const qaName = `${QA_PREFIX} ${Date.now()}`;
  const qaNameUpdated = `${qaName} upd`;
  let qaId = null; // id nhóm QA do request create trả về
  let needCleanup = false; // true từ lúc bấm Submit tạo tới khi test "Xoá" xác nhận đã xoá xong

  let writes;
  let gamesLoaded;
  const games = async () => (await (await gamesLoaded).json()).data;

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__recommendation_group_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/recommendation-group_(filter|page_size)$|^sorter__game-recommendation_recommendation-group$/.test(k)) {
          localStorage.removeItem(k);
        }
      }
      sessionStorage.setItem("__recommendation_group_spec_cleared", "1");
    });
    writes = watchWrites(page);
    gamesLoaded = page.waitForResponse(isGameDropdown, { timeout: 60000 });
    gamesLoaded.catch(() => {});
    await openPage(page);
  });

  // Dù test giữa chừng fail vẫn xoá nhóm QA còn sót (kể cả nhóm QA của lần chạy trước bị dừng giữa chừng)
  test.afterAll(async ({ browser, baseURL }) => {
    if (!needCleanup) return;
    test.setTimeout(180000);
    const context = await browser.newContext({ baseURL, storageState: buildStorageState(), viewport: { width: 1920, height: 1080 } });
    try {
      const page = await context.newPage();
      await openPage(page);
      await deleteQaGroups(page, QA_PREFIX);
      await page.close();
    } finally {
      await context.close();
    }
  });

  test("Tạo nhóm: Add New -> nhập tên QA + chọn 2 game đầu -> Submit gửi create thành công, nhóm xuất hiện đúng 1 dòng", async ({ page }) => {
    const data = await games();
    test.skip(data.length < 2, "Cần ít nhất 2 game");
    const [g1, g2] = data;
    const chosen = [g1.value, g2.value];

    await addBtn(page).click();
    await nameInput(page).fill(qaName);
    for (const id of chosen) await dialog(page).locator(`tr[data-row-key="${id}"] input`).click();
    await expect(selectedCountText(page)).toHaveText(`2 of ${data.length} selected`);
    await expect(nameErrors(page)).toHaveCount(0);
    await expect(gameError(page)).toHaveCount(0);

    needCleanup = true; // từ đây có thể đã tạo nhóm QA -> afterAll dọn nếu test sau fail
    const [res] = await Promise.all([page.waitForResponse(isCreate), submitBtn(page).click()]);
    expect(res.status()).toBe(200);
    const body = JSON.parse(res.request().postData());
    expect(body.name).toBe(qaName);
    expect([...body.gameIds].sort((a, b) => a - b)).toEqual([...chosen].sort((a, b) => a - b));
    const json = await res.json();
    expect(json).toMatchObject({
      status: "success",
      messageCode: "CREATE_RECOMMENDATION_GROUP_SUCCESS",
      message: "Recommendation group created successfully",
    });
    expect(typeof json.data.id).toBe("number");
    qaId = json.data.id;

    await expect(page.locator(".Toastify__toast").filter({ hasText: "Recommendation group created successfully" })).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    await settle(page);

    // Tìm lại theo Group Name: đúng 1 nhóm với No. of Game = 2 và đúng game đã chọn
    await fillFilter(page, "name", qaName);
    const found = await search(page);
    expect(found.body.filters.name).toBe(qaName);
    expect(found.json.data.totalCount).toBe(1);
    const g = found.json.data.list[0];
    expect(g).toMatchObject({ id: qaId, name: qaName, totalGame: 2 });
    expect(g.games.map((x) => x.id).sort((a, b) => a - b)).toEqual([...chosen].sort((a, b) => a - b));
    await expect(rows(page)).toHaveCount(1);
    await expect(cellAt(page, 0, COL.name)).toHaveText(qaName);
    await expect(cellAt(page, 0, COL.total)).toHaveText("2");
    expect((await chipInfo(page, 0)).games).toEqual(g.games.map((x) => norm(x.name)));
    await expect(summary(page)).toHaveText("Showing 1 - 1 of 1 records");

    // Chỉ gửi đúng 1 request ghi: create
    expect(writes.map((u) => u.replace(/^.*\/recommendation-group\//, ""))).toEqual(["create"]);
  });

  test("Sửa nhóm QA: đổi tên + bỏ chọn 1 game -> Submit gửi update thành công, danh sách cập nhật", async ({ page }) => {
    test.skip(qaId === null, "Chưa tạo được nhóm QA ở test trước");
    const data = await games();
    const [g1, g2] = data;

    await fillFilter(page, "name", qaName);
    const before = await search(page);
    expect(before.json.data.list.map((x) => x.id)).toEqual([qaId]);
    expect(isQaGroup(before.json.data.list[0])).toBe(true);

    const [viewRes] = await Promise.all([page.waitForResponse(isView), editIcon(page, 0).click()]);
    expect(JSON.parse(viewRes.request().postData()).id).toBe(qaId);
    await expect(dialog(page)).toContainText(`Edit Recommendation Group ${qaName}`);
    await expect(nameInput(page)).toHaveValue(qaName);
    await expect(selectedCountText(page)).toHaveText(`2 of ${data.length} selected`);
    await expect
      .poll(async () => (await checkedKeys(page)).sort(), { message: "game tích sẵn phải là 2 game đã tạo" })
      .toEqual([String(g1.value), String(g2.value)].sort());

    await nameInput(page).fill(qaNameUpdated);
    await dialog(page).locator(`tr[data-row-key="${g2.value}"] input`).click(); // bỏ game thứ 2
    await expect(selectedCountText(page)).toHaveText(`1 of ${data.length} selected`);

    const [res] = await Promise.all([page.waitForResponse(isUpdate), submitBtn(page).click()]);
    expect(res.status()).toBe(200);
    expect(JSON.parse(res.request().postData())).toMatchObject({ id: qaId, name: qaNameUpdated, gameIds: [g1.value] });
    expect(await res.json()).toMatchObject({
      status: "success",
      messageCode: "UPDATE_RECOMMENDATION_GROUP_SUCCESS",
      message: "Recommendation group updated successfully",
    });
    await expect(page.locator(".Toastify__toast").filter({ hasText: "Recommendation group updated successfully" })).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    await settle(page);

    // Bộ lọc vẫn là tên cũ (là chuỗi con của tên mới) -> nhóm vẫn nằm trong danh sách với tên mới + 1 game
    const after = await search(page);
    expect(after.json.data.list.map((x) => x.id)).toEqual([qaId]);
    expect(after.json.data.list[0]).toMatchObject({ name: qaNameUpdated, totalGame: 1 });
    expect(after.json.data.list[0].games.map((x) => x.id)).toEqual([g1.value]);
    await expect(cellAt(page, 0, COL.name)).toHaveText(qaNameUpdated);
    await expect(cellAt(page, 0, COL.total)).toHaveText("1");

    expect(writes.map((u) => u.replace(/^.*\/recommendation-group\//, ""))).toEqual(["update"]);
  });

  test("Xoá nhóm QA (dọn dẹp): icon Delete -> xác nhận đúng tên nhóm -> Delete gửi delete thành công, nhóm biến mất", async ({ page }) => {
    test.skip(qaId === null, "Chưa tạo được nhóm QA ở test trước");

    // Lọc theo tiền tố QA, xoá qua UI (kiểm tra tên trong hộp thoại xác nhận) -> xoá cả nhóm QA cũ còn sót (nếu có)
    const deleted = await deleteQaGroups(page, QA_PREFIX);
    expect(deleted.map((g) => g.id)).toContain(qaId);
    needCleanup = false;

    // Danh sách không còn nhóm nào khớp tên QA
    await fillFilter(page, "name", qaNameUpdated);
    const { json } = await search(page);
    expect(json.data.totalCount).toBe(0);
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText("There are no entries found").first()).toBeVisible();

    // Không còn nhóm QA nào sót
    await fillFilter(page, "name", QA_PREFIX);
    const left = (await search(page)).json.data.list.filter(isQaGroup);
    expect(left.map((g) => g.name), "Còn nhóm QA sót lại trên danh sách").toEqual([]);
    expect([...new Set(writes.map((u) => u.replace(/^.*\/recommendation-group\//, "")))]).toEqual(["delete"]);
  });
});
