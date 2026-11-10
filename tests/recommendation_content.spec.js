// Game Recommendation > Recommendation Content  (https://dev-bo.royaledge.io/game-recommendation/recommendation-content)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/recommendation_content.spec.js --project=setup --project=chromium
//
// Màn hình quản lý nội dung đề xuất theo GAME: mỗi game có đúng 1 dòng (Game Name) kèm "Recommendation Game Title" (tối đa 12 ký tự)
// và "Recommendation Description" (tối đa 40 ký tự), 2 trường này sửa TRỰC TIẾP trên dòng (icon Update -> 2 ô nhập + icon Save / Cancel).
// Cột "Translated Content" có nút "View Content" mở hộp thoại "View Translated Content <game>": bảng bản dịch theo ngôn ngữ (Language Code,
// Translated Recommendation Game Title, Translated Recommendation Description), filter Code (chọn nhiều ngôn ngữ), dòng "en" là nguồn (không sửa được),
// các dòng còn lại sửa trực tiếp bằng icon Update.
//  - Filter: chỉ có Game Name (chọn 1 game; API nhận key "gameIds" = MẢNG id game, vd [285])
//  - Chỉ cột Game Name sort được (name asc -> name desc -> về mặc định id desc)
//  - KHÔNG có Add New / Delete / Export / checkbox chọn dòng: số dòng = số game của hệ thống (dropdown/game), không tạo / xoá được bản ghi.
//
// AN TOÀN DỮ LIỆU:
//  - Màn hình không có thao tác tạo mới nên KHÔNG có bản ghi "QA-AUTO-" tự tạo để sửa / xoá; mọi dòng đều là dữ liệu thật của team và
//    ô Title / Description bắt buộc nhập (không thể xoá trống để khôi phục dòng chưa có nội dung), vì vậy test TUYỆT ĐỐI KHÔNG ghi dữ liệu thật:
//      + Mọi request ghi (game-recommendation/content/update, content/translation/update) đều bị chặn ở tầng mạng (route.abort).
//      + Các test kiểm tra payload của nút Save dùng route.fulfill trả về "success" GIẢ, request KHÔNG tới server; test khai báo rõ
//        request ghi được phép (allowedWrites) và afterEach so sánh chính xác với danh sách request ghi bắt được (watchWrites).
//      + Test chỉ đọc: afterEach kiểm tra không có request ghi nào.
//  - Dòng nào được sửa thử đều được kiểm tra Game Name của dòng khớp response trước khi thao tác (không thao tác "dòng đầu tiên" một cách mù quáng).
//  - Không hard-code dữ liệu (game, id, nội dung): mọi giá trị lấy từ response list / dropdown/game / dropdown/language / translation/view.
//  - Chưa kiểm chứng được bằng UI thật: toast / hành vi sau khi Save thành công và lỗi từ server (vì không được ghi dữ liệu thật).
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");

test.use({
  viewport: { width: 1920, height: 1080 },
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/game-recommendation/recommendation-content";
const ORIGIN = "https://dev-bo.royaledge.io";

// Đúng thứ tự hiển thị (không có cột checkbox)
const COLUMNS = ["Game Name", "Recommendation Game Title", "Recommendation Description", "Translated Content", "Actions"];
const COL = { game: 0, title: 1, desc: 2, translated: 3, action: 4 };
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
const DEFAULT_BODY = { page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: {} };
// Cột duy nhất có thể sort -> tên field gửi lên API
const SORTABLE = { "Game Name": "name" };
const MAX_TITLE = 12;
const MAX_DESC = 40;

// Thông báo lỗi của form (đọc từ màn hình thật)
const MSG = {
  title: "Recommendation game title is required",
  desc: "Recommendation description is required",
};

// Request đọc dữ liệu (mọi POST còn lại tới boapi coi là GHI)
const READ = /\/(list|details|download|view)(\?|$)|\/dropdown\//;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/game-recommendation/content/list");
const isTranslationView = endsWith("/game-recommendation/content/translation/view");
const isGameDropdown = (r) => reqOf(r).url().endsWith("/dropdown/game");
const isLanguageDropdown = (r) => reqOf(r).url().endsWith("/dropdown/language");

const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};

// Bảng chính (luôn là .ant-table đầu tiên trong DOM; bảng trong hộp thoại được append sau)
const table = (page) => page.locator(".ant-table").first();
const rows = (page) => table(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
const th = (page, name) => table(page).locator("thead th").filter({ hasText: exact(name) });
const updateIcon = (row) => row.locator('svg[data-icon="pen-to-square"]');
const saveIcon = (row) => row.locator('svg[data-icon="circle-check"]');
const cancelIcon = (row) => row.locator('svg[data-icon="circle-xmark"]');
const viewBtn = (row) => row.getByRole("button", { name: "View Content" });

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const pageSizeSelect = (page) => page.locator(".ant-pagination-options .ant-select");
const tooltip = (page) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
const filterEl = (page, id) => page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });

// Ô nhập sửa trực tiếp trên dòng
const titleInput = (row) => row.locator("#recommendationGameTitle");
const descInput = (row) => row.locator("#recommendationDescription");
const rowErrors = (row) => row.locator(".ant-form-item-explain-error");

// Hộp thoại "View Translated Content"
const dialog = (page) => page.getByRole("dialog");
const tRows = (page) => dialog(page).locator("tbody tr.ant-table-row");
const tRowAt = (page, i) => tRows(page).nth(i);
const tTitleInput = (row) => row.locator("#title");
const tDescInput = (row) => row.locator("#description");
const dialogCodeSelect = (page) => dialog(page).locator(".ant-select").first();

// Text option của game / ngôn ngữ: "code - tên"
const optionText = (g) => `${g.code} - ${g.label}`;

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
}

// Khi filter vừa đổi, Search đôi khi gửi 2 request list GIỐNG HỆT nhau cách nhau ~200ms (khám phá bằng script):
// chờ mạng yên sau mỗi lần gọi để request thừa không bị nhầm là request của thao tác kế tiếp.
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
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
  await settle(page);
  await expect(page.locator(".NextGen-filter-bar")).toBeVisible();
}

// Bấm Search, trả về { body, status, json }. Lấy response từ chính request vừa gửi.
async function search(page) {
  const [req] = await Promise.all([page.waitForRequest(isList), searchBtn(page).click()]);
  const res = await req.response();
  const json = await res.json();
  await settle(page);
  return { body: bodyOf(req), status: res.status(), json };
}

// Thực hiện 1 hành động làm bảng gọi lại API (đổi trang, sort...) rồi trả về { body, json }
async function reloadFull(page, action) {
  const [req] = await Promise.all([page.waitForRequest(isList), action()]);
  const res = await req.response();
  const json = await res.json();
  await settle(page);
  return { body: bodyOf(req), json };
}
const reloadBy = async (page, action) => (await reloadFull(page, action)).body;

const headers = async (page) => (await table(page).locator("thead th").allInnerTexts()).map((t) => t.trim());
const totalOf = async (page) => num((await summary(page).innerText()).match(/of ([\d,]+) records/)[1]);

// Lấy toàn bộ giá trị của 1 cột (theo tên header) ở trang hiện tại
async function columnValues(page, name) {
  await expect.poll(() => headers(page), { message: `Không thấy cột "${name}"` }).toContain(name);
  const idx = (await headers(page)).indexOf(name);
  return rows(page).evaluateAll((trs, i) => trs.map((tr) => tr.children[i].innerText.replace(/\s+/g, " ").trim()), idx);
}

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn game ở filter Game Name (dropdown chọn 1 giá trị, tự đóng sau khi chọn).
// Gõ code vào ô tìm kiếm trước để option chắc chắn nằm trong danh sách ảo; code là duy nhất nên option khớp đúng 1.
async function selectGame(page, g) {
  await openDropdown(page, "gameId");
  await page.keyboard.type(g.code);
  await openOptions(page).filter({ hasText: exact(optionText(g)) }).first().click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Giá trị đang được chọn của filter Game Name
const selectedGame = (page) =>
  filterEl(page, "gameId")
    .locator(".ant-select-selection-item[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));

// Ghi lại mọi request POST KHÔNG phải đọc dữ liệu (url + body đã bỏ traceId)
function watchWrites(page) {
  const writes = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /boapi/.test(r.url()) && !READ.test(r.url())) {
      writes.push({ url: r.url().replace(/^.*\/v1\//, ""), body: bodyOf(r) });
    }
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

// Dùng cho test kiểm tra payload của nút Save: request ghi vẫn KHÔNG tới server, được trả về "success" giả
// (route đăng ký sau được ưu tiên hơn route chặn ở beforeEach)
async function mockWrites(page) {
  await page.route(/boapi/, (route) => {
    const r = route.request();
    if (r.method() === "POST" && !READ.test(r.url())) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": ORIGIN, "access-control-allow-credentials": "true" },
        body: JSON.stringify({ status: "success", messageCode: "SUCCESS", message: "SUCCESS", data: null }),
      });
    }
    return route.continue();
  });
}

// Đóng hộp thoại View Translated Content bằng nút X
async function closeDialog(page) {
  await dialog(page).getByRole("button", { name: "Close" }).first().click();
  await expect(dialog(page)).toBeHidden();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Game Recommendation > Recommendation Content", () => {
  let writes;
  let allowedWrites; // request ghi được phép (chỉ các test kiểm tra payload của Save, và vẫn không tới server)
  let gamesLoaded; // promise của response dropdown/game lúc mở trang
  // Danh sách game { value, code, label } mà dropdown/game trả về
  const games = async () => (await (await gamesLoaded).json()).data;

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, số dòng/trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__recommendation_content_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/recommendation-content_(filter|page_size)$|^sorter__game-recommendation_recommendation-content$/.test(k)) {
          localStorage.removeItem(k);
        }
      }
      sessionStorage.setItem("__recommendation_content_spec_cleared", "1");
    });
    writes = watchWrites(page);
    allowedWrites = [];
    await blockWrites(page);
    gamesLoaded = page.waitForResponse(isGameDropdown, { timeout: 60000 });
    gamesLoaded.catch(() => {});
    await openPage(page);
  });

  // Mọi test không được gửi request ghi nào ngoài danh sách được phép (và request được phép cũng không tới server thật)
  test.afterEach(async () => {
    expect(writes, "Request ghi dữ liệu bắt được phải đúng danh sách được phép").toEqual(allowedWrites);
  });

  // ===== 1. Hiển thị màn hình =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, filter Game Name và 2 nút Search/Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Recommendation Content");
      await expect(filterEl(page, "gameId")).toContainText("Game Name");
      await expect(filterEl(page, "gameId")).toBeVisible();
      await expect(page.locator(".NextGen-filter-element")).toHaveCount(1);
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: để trống", async ({ page }) => {
      await expect(filterEl(page, "gameId").locator(".ant-select-selection-item")).toHaveCount(0);
    });

    test("Game Name là dropdown chọn 1 giá trị (có tìm kiếm)", async ({ page }) => {
      await expect(filterEl(page, "gameId").locator(".ant-select-single")).toHaveCount(1);
      await expect(filterEl(page, "gameId").locator(".ant-select-multiple")).toHaveCount(0);
      await expect(filterEl(page, "gameId").locator(".ant-select-show-search")).toHaveCount(1);
    });

    test("Có Manage Columns; không có Add New, Export, checkbox chọn dòng / thao tác hàng loạt", async ({ page }) => {
      await expect(columnBtn(page)).toBeVisible();
      await expect(page.getByRole("button", { name: /Add New/ })).toHaveCount(0);
      await expect(page.locator("button.NextGen-export-button")).toHaveCount(0);
      await expect(page.locator("button.NextGen-button-more-action__update")).toHaveCount(0);
      await expect(page.locator('.ant-table input[type="checkbox"]')).toHaveCount(0);
    });

    test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự`, async ({ page }) => {
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Mặc định: trang 1, 10 dòng, sort id giảm dần, không gửi filter", async ({ page }) => {
      const { body, json } = await search(page);
      expect(body).toEqual(DEFAULT_BODY);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const ids = json.data.list.map((x) => x.gameId);
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
    test("Mỗi dòng khớp response API (Game Name, Title, Description)", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list;
      test.skip(list.length === 0, "Không có dữ liệu");
      await expect(rows(page)).toHaveCount(list.length);
      for (const [i, g] of list.entries()) {
        const at = `dòng ${i + 1} (game ${g.gameId})`;
        expect(norm(await cellAt(page, i, COL.game).innerText()), at).toBe(norm(g.gameName));
        expect(norm(await cellAt(page, i, COL.title).innerText()), at).toBe(norm(g.recommendationGameTitle));
        expect(norm(await cellAt(page, i, COL.desc).innerText()), at).toBe(norm(g.recommendationDescription));
      }
    });

    test("Mỗi game chỉ có 1 dòng: gameId và Game Name không trùng nhau", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const ids = json.data.list.map((x) => x.gameId);
      expect(new Set(ids).size).toBe(ids.length);
      const names = await columnValues(page, "Game Name");
      for (const v of names) expect(v).not.toBe("");
      expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    });

    test("Game của từng dòng là game có thật trong dropdown/game (đúng tên)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const byId = new Map((await games()).map((g) => [g.value, g]));
      for (const x of json.data.list) {
        const g = byId.get(x.gameId);
        expect(g, `game ${x.gameId} (${x.gameName}) không có trong dropdown/game`).toBeTruthy();
        expect(norm(g.label), `tên game ${x.gameId}`).toBe(norm(x.gameName));
      }
    });

    test("Tổng số bản ghi bằng số game của dropdown/game (mỗi game đúng 1 dòng)", async ({ page }) => {
      const { json } = await search(page);
      expect(json.data.totalCount).toBe((await games()).length);
    });

    test(`Title tối đa ${MAX_TITLE} ký tự, Description tối đa ${MAX_DESC} ký tự`, async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const x of json.data.list) {
        expect(x.recommendationGameTitle.length, `title game ${x.gameId}`).toBeLessThanOrEqual(MAX_TITLE);
        expect(x.recommendationDescription.length, `description game ${x.gameId}`).toBeLessThanOrEqual(MAX_DESC);
      }
    });

    test("Title và Description cùng có nội dung hoặc cùng để trống (form bắt buộc nhập cả 2)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      for (const x of json.data.list) {
        expect(x.recommendationGameTitle === "", `game ${x.gameId} (${x.gameName})`).toBe(x.recommendationDescription === "");
      }
    });

    test("Mỗi dòng có nút 'View Content' và icon Update (tooltip 'Update')", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      const n = await rows(page).count();
      await expect(table(page).getByRole("button", { name: "View Content" })).toHaveCount(n);
      await expect(updateIcon(table(page))).toHaveCount(n);
      await updateIcon(rowAt(page, 0)).hover();
      await expect(tooltip(page).filter({ hasText: exact("Update") })).toBeVisible();
    });
  });

  // ===== 3. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Dropdown Game Name liệt kê đúng game của dropdown/game (dạng 'code - tên')", async ({ page }) => {
      const data = await games();
      test.skip(data.length === 0, "Không có game nào");
      await openDropdown(page, "gameId");
      await openOptions(page).first().waitFor();
      // Thứ tự option của filter khác thứ tự response dropdown/game (UI tự sắp xếp) nên chỉ kiểm tra mỗi option đều có trong response
      const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      expect(titles.length).toBeGreaterThan(0);
      const known = new Set(data.map(optionText));
      for (const t of titles) expect(known.has(t), `option "${t}" không có trong dropdown/game`).toBe(true);
      // Xác nhận danh sách đủ: gõ code của 1 game cuối danh sách thì option đó xuất hiện
      const last = data[data.length - 1];
      await page.keyboard.type(last.code);
      await expect(openOptions(page).filter({ hasText: exact(optionText(last)) })).toHaveCount(1);
      await page.locator("nav.ant-breadcrumb").click();
    });

    test("Search không chọn gì: gửi filters rỗng và trả về cùng tổng bản ghi", async ({ page }) => {
      const first = await search(page);
      const second = await search(page);
      expect(second.body).toEqual(DEFAULT_BODY);
      expect(second.json.data.totalCount).toBe(first.json.data.totalCount);
    });

    test("Chọn 1 game: gửi filters.gameIds = [id game] và chỉ còn đúng game đó", async ({ page }) => {
      const { json: all } = await search(page);
      test.skip(all.data.list.length === 0, "Không có dữ liệu");
      const x = all.data.list[0];
      const g = (await games()).find((v) => v.value === x.gameId);
      test.skip(!g, "Game đầu tiên không có trong dropdown/game");

      await selectGame(page, g);
      expect(await selectedGame(page)).toEqual([optionText(g)]);
      const { body, json } = await search(page);
      expect(body).toMatchObject({ page: 1, pageSize: 10, filters: { gameIds: [g.value] } });
      expect(json.data.totalCount).toBe(1);
      expect(json.data.list).toEqual([x]);
      await expect(rows(page)).toHaveCount(1);
      await expect(cellAt(page, 0, COL.game)).toHaveText(norm(x.gameName));
      await expect(summary(page)).toHaveText("Showing 1 - 1 of 1 records");
    });

    test("Gõ code game vào ô tìm kiếm của filter chỉ còn option khớp", async ({ page }) => {
      const data = await games();
      test.skip(data.length === 0, "Không có game nào");
      const g = data[data.length - 1];
      await openDropdown(page, "gameId");
      await page.keyboard.type(g.code);
      const expected = data.filter((v) => optionText(v).toLowerCase().includes(g.code.toLowerCase())).map(optionText);
      await expect(openOptions(page)).toHaveCount(expected.length);
      expect(await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")))).toEqual(expected);
      await page.locator("nav.ant-breadcrumb").click();
    });

    test("Chọn game ở dòng bất kỳ của trang 2: dòng kết quả đúng game đó", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.totalCount <= 10, "Chỉ có 1 trang");
      const { json: p2 } = await reloadFull(page, () => page.locator(".ant-pagination-item-2").click());
      const x = p2.data.list[p2.data.list.length - 1];
      const g = (await games()).find((v) => v.value === x.gameId);
      test.skip(!g, "Game không có trong dropdown/game");
      await selectGame(page, g);
      const res = await search(page);
      expect(res.body.filters).toEqual({ gameIds: [g.value] });
      expect(res.body.page, "Search phải về trang 1").toBe(1);
      expect(res.json.data.list.map((v) => v.gameId)).toEqual([g.value]);
    });
  });

  // ===== 4. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá game đã chọn và gửi lại request mặc định", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const g = (await games()).find((v) => v.value === json.data.list[0].gameId);
      test.skip(!g, "Game không có trong dropdown/game");
      await selectGame(page, g);
      await search(page);

      const { body, json: after } = await reloadFull(page, () => resetBtn(page).click());
      expect(body).toEqual(DEFAULT_BODY);
      expect(after.data.totalCount).toBe(json.data.totalCount);
      await expect(filterEl(page, "gameId").locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(rows(page)).toHaveCount(Math.min(10, json.data.totalCount));
    });

    test("Reset đưa sort về mặc định (id giảm dần) và gửi lại request mặc định", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      await reloadBy(page, () => th(page, "Game Name").click());
      const body = await reloadBy(page, () => resetBtn(page).click());
      expect(body).toEqual(DEFAULT_BODY);
    });

    // NGHI LÀ BUG UI (khám phá bằng script, chưa được user xác nhận nên KHÔNG assert hành vi mong đợi):
    // đang ở trang 2, không có filter, bấm Reset -> KHÔNG gửi request nào và vẫn ở trang 2 ("Showing 11 - 20 of N records");
    // trong khi Search ở trang 2 thì về trang 1. Test chỉ kiểm tra phần chắc chắn: game đang chọn dở bị xoá khỏi ô filter.
    test("Reset khi đang ở trang 2: xoá game đang chọn dở khỏi ô filter", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.totalCount <= 10, "Chỉ có 1 trang");
      await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      const g = (await games())[0];
      await selectGame(page, g);
      expect(await selectedGame(page)).toEqual([optionText(g)]);
      await resetBtn(page).click();
      await expect(filterEl(page, "gameId").locator(".ant-select-selection-item")).toHaveCount(0);
    });
  });

  // ===== 5. Phân trang =====
  test.describe("Phân trang", () => {
    test("Trang 2 gọi API page=2, dữ liệu khác trang 1 và dòng tóm tắt đúng", async ({ page }) => {
      const { json: p1 } = await search(page);
      const total = p1.data.totalCount;
      test.skip(total <= 10, "Chỉ có 1 trang");
      const { body, json: p2 } = await reloadFull(page, () => page.locator(".ant-pagination-item-2").click());
      expect(body).toMatchObject({ page: 2, pageSize: 10 });
      const ids1 = p1.data.list.map((x) => x.gameId);
      for (const x of p2.data.list) expect(ids1).not.toContain(x.gameId);
      await expect(summary(page)).toHaveText(`Showing 11 - ${Math.min(20, total)} of ${total} records`);
      await expect(rows(page)).toHaveCount(p2.data.list.length);
      await expect(cellAt(page, 0, COL.game)).toHaveText(norm(p2.data.list[0].gameName));
    });

    test("Dữ liệu qua các trang liên tục theo id giảm dần", async ({ page }) => {
      const { json: p1 } = await search(page);
      test.skip(p1.data.totalCount <= 10, "Chỉ có 1 trang");
      const { json: p2 } = await reloadFull(page, () => page.locator(".ant-pagination-item-2").click());
      const ids = [...p1.data.list, ...p2.data.list].map((x) => x.gameId);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
    });

    test("Nút Next / Previous chuyển trang; trang 1 thì Previous bị khoá", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.totalCount <= 10, "Chỉ có 1 trang");
      await expect(page.locator(".ant-pagination-prev")).toHaveClass(/ant-pagination-disabled/);
      expect((await reloadBy(page, () => page.locator(".ant-pagination-next").click())).page).toBe(2);
      expect((await reloadBy(page, () => page.locator(".ant-pagination-prev button").click())).page).toBe(1);
    });

    test("Trang cuối chỉ hiện phần dư và khoá nút Next", async ({ page }) => {
      const { json } = await search(page);
      const total = json.data.totalCount;
      test.skip(total <= 10, "Chỉ có 1 trang");
      const last = Math.ceil(total / 10);
      const { body, json: res } = await reloadFull(page, () => page.locator(`.ant-pagination-item-${last}`).click());
      expect(body.page).toBe(last);
      expect(res.data.list).toHaveLength(total - (last - 1) * 10);
      await expect(page.locator(".ant-pagination-next")).toHaveClass(/ant-pagination-disabled/);
      await expect(summary(page)).toHaveText(`Showing ${(last - 1) * 10 + 1} - ${total} of ${total} records`);
    });

    test("Dropdown số dòng / trang có đủ 10/20/50/100/200", async ({ page }) => {
      await pageSizeSelect(page).click();
      await expect(openOptions(page)).toHaveText(PAGE_SIZES);
      await page.keyboard.press("Escape");
    });

    for (const size of [20, 50, 100]) {
      test(`Đổi sang ${size} dòng / trang gửi pageSize=${size} và hiển thị đúng số dòng`, async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.totalCount <= 10, "Không đủ dữ liệu để phân biệt số dòng / trang");
        await pageSizeSelect(page).click();
        const { body, json: res } = await reloadFull(page, () =>
          openOptions(page).filter({ hasText: `${size} / page` }).click(),
        );
        expect(body.pageSize).toBe(size);
        const shown = Math.min(size, json.data.totalCount);
        expect(res.data.list).toHaveLength(shown);
        await expect(rows(page)).toHaveCount(shown);
        await expect(summary(page)).toHaveText(`Showing 1 - ${shown} of ${json.data.totalCount} records`);
      });
    }

    test("Giữ filter đang chọn khi đổi số dòng / trang", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const g = (await games()).find((v) => v.value === json.data.list[0].gameId);
      test.skip(!g, "Game không có trong dropdown/game");
      await selectGame(page, g);
      await search(page);
      await pageSizeSelect(page).click();
      const body = await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
      expect(body).toMatchObject({ pageSize: 20, filters: { gameIds: [g.value] } });
    });
  });

  // ===== 6. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    for (const [name, key] of Object.entries(SORTABLE)) {
      test(`Sort cột "${name}": asc -> desc -> về mặc định`, async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const b1 = await reloadBy(page, () => th(page, name).click());
        expect(b1).toMatchObject({ sortBy: key, sortDirection: "asc", page: 1 });
        const b2 = await reloadBy(page, () => th(page, name).click());
        expect(b2).toMatchObject({ sortBy: key, sortDirection: "desc" });
        const b3 = await reloadBy(page, () => th(page, name).click());
        expect(b3).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      });

      test(`Sort cột "${name}": dữ liệu trả về khớp bảng và là hoán vị của cùng tập game`, async ({ page }) => {
        const { json: base } = await search(page);
        test.skip(base.data.totalCount > 10 || base.data.list.length === 0, "Chỉ so sánh tập game khi tất cả nằm trong 1 trang");
        const { json } = await reloadFull(page, () => th(page, name).click());
        expect(json.data.list.map((x) => x.gameId).sort((a, b) => a - b)).toEqual(
          base.data.list.map((x) => x.gameId).sort((a, b) => a - b),
        );
        // Thứ tự chữ phụ thuộc collation của server nên chỉ kiểm tra bảng hiển thị đúng thứ tự response
        expect(await columnValues(page, name)).toEqual(json.data.list.map((x) => norm(x.gameName)));
      });
    }

    test("Cột Game Name đang sort asc: dòng đầu của bảng khớp response (không sort sai nguồn)", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const { json: res } = await reloadFull(page, () => th(page, "Game Name").click());
      await expect(cellAt(page, 0, COL.game)).toHaveText(norm(res.data.list[0].gameName));
      expect(res.data.totalCount).toBe(json.data.totalCount);
    });

    test("Giữ sort khi chuyển sang trang 2", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.totalCount <= 10, "Chỉ có 1 trang");
      await reloadBy(page, () => th(page, "Game Name").click());
      const body = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      expect(body).toMatchObject({ page: 2, sortBy: "name", sortDirection: "asc" });
    });

    test("Các cột khác không sort được", async ({ page }) => {
      for (const c of COLUMNS.filter((c) => !(c in SORTABLE))) {
        await expect(th(page, c), c).not.toHaveClass(/ant-table-column-has-sorters/);
      }
      await expect(th(page, "Game Name")).toHaveClass(/ant-table-column-has-sorters/);
    });
  });

  // ===== 7. Sửa trực tiếp trên dòng (Update) - KHÔNG ghi dữ liệu thật =====
  test.describe("Sửa Title / Description trực tiếp trên dòng (không ghi dữ liệu thật)", () => {
    // Lấy dòng đầu tiên của danh sách và kiểm tra Game Name trên bảng khớp response trước khi thao tác
    async function firstRecord(page) {
      const { json } = await search(page);
      test.skip(json.data.list.length === 0, "Không có dữ liệu");
      const x = json.data.list[0];
      await expect(cellAt(page, 0, COL.game)).toHaveText(norm(x.gameName));
      return x;
    }

    test("Bấm Update: 2 ô nhập hiện giá trị hiện tại, đúng placeholder / maxlength; Game Name giữ nguyên", async ({ page }) => {
      const x = await firstRecord(page);
      const row = rowAt(page, 0);
      await updateIcon(row).click();
      await expect(titleInput(row)).toHaveValue(x.recommendationGameTitle);
      await expect(descInput(row)).toHaveValue(x.recommendationDescription);
      await expect(titleInput(row)).toHaveAttribute("placeholder", `Max length is ${MAX_TITLE}`);
      await expect(titleInput(row)).toHaveAttribute("maxlength", String(MAX_TITLE));
      await expect(descInput(row)).toHaveAttribute("placeholder", `Max length is ${MAX_DESC}`);
      await expect(descInput(row)).toHaveAttribute("maxlength", String(MAX_DESC));
      await expect(cellAt(page, 0, COL.game)).toHaveText(norm(x.gameName));
      await expect(viewBtn(row)).toBeVisible();
      await expect(rowErrors(row)).toHaveCount(0);
    });

    test("Khi sửa: icon Update đổi thành Save / Cancel (có tooltip), các dòng khác bị khoá icon Update", async ({ page }) => {
      await firstRecord(page);
      test.skip((await rows(page).count()) < 2, "Cần ít nhất 2 dòng");
      const row = rowAt(page, 0);
      await updateIcon(row).click();
      await expect(saveIcon(row)).toBeVisible();
      await expect(cancelIcon(row)).toBeVisible();
      await expect(updateIcon(row)).toHaveCount(0);
      await saveIcon(row).hover();
      await expect(tooltip(page).filter({ hasText: exact("Save") })).toBeVisible();
      await cancelIcon(row).hover();
      await expect(tooltip(page).filter({ hasText: exact("Cancel") })).toBeVisible();

      // Dòng khác: icon Update bị disable, bấm không mở chế độ sửa
      await expect(updateIcon(rowAt(page, 1))).toHaveClass(/disabled/);
      await updateIcon(rowAt(page, 1)).click({ force: true });
      await expect(rowAt(page, 1).locator("input")).toHaveCount(0);
      await expect(row.locator("input")).toHaveCount(2);
    });

    test("Cancel sau khi sửa: dòng hiển thị lại dữ liệu gốc, không gửi request lưu", async ({ page }) => {
      const x = await firstRecord(page);
      const row = rowAt(page, 0);
      await updateIcon(row).click();
      await titleInput(row).fill("QA-AUTO");
      await descInput(row).fill("QA-AUTO không lưu");
      await cancelIcon(row).click();
      await expect(row.locator("input")).toHaveCount(0);
      await expect(cellAt(page, 0, COL.title)).toHaveText(norm(x.recommendationGameTitle));
      await expect(cellAt(page, 0, COL.desc)).toHaveText(norm(x.recommendationDescription));
      await expect(updateIcon(row)).toBeVisible();
      // Sửa lại lần nữa vẫn thấy dữ liệu gốc (form không giữ giá trị đã nhập dở)
      await updateIcon(row).click();
      await expect(titleInput(row)).toHaveValue(x.recommendationGameTitle);
      await expect(descInput(row)).toHaveValue(x.recommendationDescription);
    });

    test("Cancel xong, dòng khác sửa được trở lại (icon Update hết bị khoá)", async ({ page }) => {
      await firstRecord(page);
      test.skip((await rows(page).count()) < 2, "Cần ít nhất 2 dòng");
      await updateIcon(rowAt(page, 0)).click();
      await cancelIcon(rowAt(page, 0)).click();
      await expect(updateIcon(rowAt(page, 1))).not.toHaveClass(/disabled/);
      await updateIcon(rowAt(page, 1)).click();
      await expect(rowAt(page, 1).locator("input")).toHaveCount(2);
      await cancelIcon(rowAt(page, 1)).click();
    });

    test("Tải lại trang sau khi sửa dở: dữ liệu vẫn là bản gốc", async ({ page }) => {
      const x = await firstRecord(page);
      const row = rowAt(page, 0);
      await updateIcon(row).click();
      await titleInput(row).fill("QA-AUTO");
      await openPage(page); // reload
      await expect(cellAt(page, 0, COL.game)).toHaveText(norm(x.gameName));
      await expect(cellAt(page, 0, COL.title)).toHaveText(norm(x.recommendationGameTitle));
    });

    test("Để trống cả Title và Description rồi Save: báo 2 lỗi, vẫn ở chế độ sửa, không gửi request lưu", async ({ page }) => {
      await firstRecord(page);
      const row = rowAt(page, 0);
      await updateIcon(row).click();
      await titleInput(row).fill("");
      await descInput(row).fill("");
      await saveIcon(row).click();
      await expect(rowErrors(row)).toHaveText([MSG.title, MSG.desc]);
      await expect(row.locator("input")).toHaveCount(2);
    });

    test("Chỉ nhập khoảng trắng: báo 'is required' ở cả 2 ô", async ({ page }) => {
      await firstRecord(page);
      const row = rowAt(page, 0);
      await updateIcon(row).click();
      await titleInput(row).fill("   ");
      await descInput(row).fill("   ");
      await saveIcon(row).click();
      await expect(rowErrors(row)).toHaveText([MSG.title, MSG.desc]);
    });

    test("Chỉ nhập Title (Description trống): chỉ báo lỗi Description", async ({ page }) => {
      await firstRecord(page);
      const row = rowAt(page, 0);
      await updateIcon(row).click();
      await titleInput(row).fill("QA-AUTO");
      await descInput(row).fill("");
      await saveIcon(row).click();
      await expect(rowErrors(row)).toHaveText([MSG.desc]);
    });

    test("Chỉ nhập Description (Title trống): chỉ báo lỗi Title", async ({ page }) => {
      await firstRecord(page);
      const row = rowAt(page, 0);
      await updateIcon(row).click();
      await titleInput(row).fill("");
      await descInput(row).fill("QA-AUTO");
      await saveIcon(row).click();
      await expect(rowErrors(row)).toHaveText([MSG.title]);
    });

    test("Sau lỗi: nhập đủ 2 ô thì thông báo lỗi biến mất (chưa bấm Save)", async ({ page }) => {
      await firstRecord(page);
      const row = rowAt(page, 0);
      await updateIcon(row).click();
      await titleInput(row).fill("");
      await descInput(row).fill("");
      await saveIcon(row).click();
      await expect(rowErrors(row)).toHaveCount(2);
      await titleInput(row).fill("QA-AUTO");
      await expect(rowErrors(row)).toHaveText([MSG.desc]);
      await descInput(row).fill("QA-AUTO");
      await expect(rowErrors(row)).toHaveCount(0);
      await cancelIcon(row).click(); // KHÔNG Save
    });

    test(`Ô Title giới hạn ${MAX_TITLE} ký tự, ô Description giới hạn ${MAX_DESC} ký tự (nhập dài hơn chỉ giữ phần đầu)`, async ({ page }) => {
      await firstRecord(page);
      const row = rowAt(page, 0);
      await updateIcon(row).click();
      await titleInput(row).fill("a".repeat(MAX_TITLE + 20));
      await descInput(row).fill("b".repeat(MAX_DESC + 40));
      expect(await titleInput(row).inputValue()).toHaveLength(MAX_TITLE);
      expect(await descInput(row).inputValue()).toHaveLength(MAX_DESC);
      await expect(rowErrors(row)).toHaveCount(0);
      await cancelIcon(row).click();
    });

    test("Save hợp lệ gửi đúng request content/update {gameId, recommendationGameTitle, recommendationDescription} (request bị chặn, không ghi dữ liệu thật)", async ({ page }) => {
      const x = await firstRecord(page);
      await mockWrites(page);
      const title = `QA-AUTO-${String(Date.now()).slice(-4)}`;
      const desc = `QA-AUTO mô tả ${Date.now()}`.slice(0, MAX_DESC);
      expect(title.length).toBeLessThanOrEqual(MAX_TITLE);
      const row = rowAt(page, 0);
      await updateIcon(row).click();
      await titleInput(row).fill(title);
      await descInput(row).fill(desc);

      const [req] = await Promise.all([
        page.waitForRequest((r) => post(r) && /\/game-recommendation\/content\/update$/.test(r.url())),
        saveIcon(row).click(),
      ]);
      expect(bodyOf(req)).toEqual({ gameId: x.gameId, recommendationGameTitle: title, recommendationDescription: desc });
      allowedWrites = [
        {
          url: "game-recommendation/content/update",
          body: { gameId: x.gameId, recommendationGameTitle: title, recommendationDescription: desc },
        },
      ];
    });

    test("Save dùng đúng gameId của dòng đang sửa khi sửa dòng không phải dòng đầu", async ({ page }) => {
      const { json } = await search(page);
      test.skip(json.data.list.length < 2, "Cần ít nhất 2 dòng");
      const x = json.data.list[1];
      await expect(cellAt(page, 1, COL.game)).toHaveText(norm(x.gameName));
      await mockWrites(page);
      const row = rowAt(page, 1);
      await updateIcon(row).click();
      await titleInput(row).fill("QA-AUTO");
      await descInput(row).fill("QA-AUTO");
      const [req] = await Promise.all([
        page.waitForRequest((r) => post(r) && /\/game-recommendation\/content\/update$/.test(r.url())),
        saveIcon(row).click(),
      ]);
      expect(bodyOf(req).gameId).toBe(x.gameId);
      allowedWrites = [
        {
          url: "game-recommendation/content/update",
          body: { gameId: x.gameId, recommendationGameTitle: "QA-AUTO", recommendationDescription: "QA-AUTO" },
        },
      ];
    });
  });

  // ===== 8. Hộp thoại View Translated Content =====
  test.describe("Hộp thoại View Translated Content (không ghi dữ liệu thật)", () => {
    let languagesLoaded; // response dropdown/language lúc mở hộp thoại

    // Mở hộp thoại của dòng i (đã kiểm tra Game Name khớp response), trả về { x, view } với view = response translation/view
    // pick (tuỳ chọn): điều kiện chọn dòng trong danh sách (vd chỉ lấy game đã có nội dung đề xuất)
    async function openTranslation(page, pick) {
      const { json } = await search(page);
      const i = pick ? json.data.list.findIndex(pick) : 0;
      test.skip(i < 0 || json.data.list.length <= i, "Không có dữ liệu phù hợp");
      const x = json.data.list[i];
      await expect(cellAt(page, i, COL.game)).toHaveText(norm(x.gameName));
      languagesLoaded = page.waitForResponse(isLanguageDropdown, { timeout: 30000 });
      languagesLoaded.catch(() => {});
      const [req, res] = await Promise.all([
        page.waitForRequest(isTranslationView),
        page.waitForResponse(isTranslationView),
        viewBtn(rowAt(page, i)).click(),
      ]);
      expect(bodyOf(req)).toEqual({ gameId: x.gameId });
      const view = (await res.json()).data;
      // UI luôn đưa dòng ngôn ngữ nguồn "en" lên đầu bảng, các dòng còn lại giữ thứ tự response (en nằm giữa trong response)
      view.translations = [
        ...view.translations.filter((t) => t.languageCode === "en"),
        ...view.translations.filter((t) => t.languageCode !== "en"),
      ];
      await expect(dialog(page)).toContainText(`View Translated Content ${x.gameName}`);
      await expect(tRows(page)).toHaveCount(view.translations.length);
      return { x, view };
    }
    const languages = async () => (await (await languagesLoaded).json()).data;

    test("Bấm View Content gọi translation/view với gameId của dòng và hiển thị tiêu đề + đủ cột", async ({ page }) => {
      const { x, view } = await openTranslation(page);
      expect(view.gameId).toBe(x.gameId);
      expect(view.sourceTitle).toBe(x.recommendationGameTitle);
      expect(view.sourceDescription).toBe(x.recommendationDescription);
      expect((await dialog(page).locator("thead th").allInnerTexts()).map((t) => t.trim())).toEqual([
        "Language Code",
        "Translated Recommendation Game Title",
        "Translated Recommendation Description",
        "Action",
      ]);
      await expect(dialog(page).getByRole("button", { name: /Search/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Reset/ })).toBeVisible();
      await closeDialog(page);
    });

    test("Mỗi dòng bản dịch khớp response (Language Code, Title, Description)", async ({ page }) => {
      const { view } = await openTranslation(page, (v) => v.recommendationGameTitle !== "");
      test.skip(view.translations.length === 0, "Game chưa có bản dịch");
      for (const [i, t] of view.translations.entries()) {
        const cells = tRowAt(page, i).locator("td");
        expect(norm(await cells.nth(0).innerText()), `dòng ${i + 1}`).toBe(t.languageCode);
        expect(norm(await cells.nth(1).innerText()), `title ${t.languageCode}`).toBe(norm(t.title));
        expect(norm(await cells.nth(2).innerText()), `description ${t.languageCode}`).toBe(norm(t.description));
      }
      await closeDialog(page);
    });

    test("Ngôn ngữ trong bảng bản dịch đều có trong dropdown/language và không trùng nhau", async ({ page }) => {
      const { view } = await openTranslation(page);
      const codes = new Set((await languages()).map((l) => l.code));
      const shown = view.translations.map((t) => t.languageCode);
      expect(new Set(shown).size).toBe(shown.length);
      for (const c of shown) expect(codes.has(c), `ngôn ngữ ${c}`).toBe(true);
      await closeDialog(page);
    });

    test("Dòng ngôn ngữ nguồn 'en' luôn nằm đầu bảng, khớp Title / Description của game và không có icon Update", async ({ page }) => {
      const { x, view } = await openTranslation(page, (v) => v.recommendationGameTitle !== "");
      const i = view.translations.findIndex((t) => t.languageCode === "en");
      test.skip(i < 0, "Không có dòng en");
      expect(i, "dòng en phải ở đầu bảng").toBe(0);
      const cells = tRowAt(page, i).locator("td");
      expect(norm(await cells.nth(1).innerText())).toBe(norm(x.recommendationGameTitle));
      expect(norm(await cells.nth(2).innerText())).toBe(norm(x.recommendationDescription));
      await expect(tRowAt(page, i).locator("svg")).toHaveCount(0);
      await closeDialog(page);
    });

    test("Các dòng ngôn ngữ khác 'en' đều có icon Update", async ({ page }) => {
      const { view } = await openTranslation(page);
      for (const [i, t] of view.translations.entries()) {
        if (t.languageCode === "en") continue;
        await expect(tRowAt(page, i).locator('svg[data-icon="pen-to-square"]'), t.languageCode).toHaveCount(1);
      }
      await closeDialog(page);
    });

    test("Mở View Content của nhiều dòng: mỗi lần hiển thị đúng game của dòng đó", async ({ page }) => {
      const { json } = await search(page);
      const list = json.data.list.slice(0, 3);
      test.skip(list.length === 0, "Không có dữ liệu");
      for (const [i, x] of list.entries()) {
        const [req] = await Promise.all([page.waitForRequest(isTranslationView), viewBtn(rowAt(page, i)).click()]);
        expect(bodyOf(req).gameId, `dòng ${i + 1}`).toBe(x.gameId);
        await expect(dialog(page)).toContainText(`View Translated Content ${x.gameName}`);
        await closeDialog(page);
      }
    });

    test("Filter Code liệt kê đúng ngôn ngữ của dropdown/language (dạng 'code - tên')", async ({ page }) => {
      await openTranslation(page);
      const langs = await languages();
      await dialogCodeSelect(page).click();
      await openOptions(page).first().waitFor();
      expect(await openOptions(page).first().getAttribute("title")).toBe(optionText(langs[0]));
      await expect(dialog(page).locator(".ant-select-multiple")).toHaveCount(1);
      await dialog(page).locator("[id^=':r']").first().click(); // click ra ngoài để đóng dropdown
      await expect(openOptions(page)).toHaveCount(0);
      await closeDialog(page);
    });

    test("Chọn 2 ngôn ngữ ở Code + Search: gửi languageCodes và chỉ còn 2 dòng; Reset trả về đủ", async ({ page }) => {
      const { x, view } = await openTranslation(page);
      test.skip(view.translations.length < 2, "Cần ít nhất 2 bản dịch");
      const picks = (await languages()).filter((l) => view.translations.some((t) => t.languageCode === l.code)).slice(0, 2);
      test.skip(picks.length < 2, "Không đủ ngôn ngữ");

      await dialogCodeSelect(page).click();
      for (const l of picks) {
        await page.keyboard.type(l.code);
        await openOptions(page).filter({ hasText: exact(optionText(l)) }).first().click();
      }
      await dialog(page).locator("[id^=':r']").first().click();
      await expect(openOptions(page)).toHaveCount(0);

      const [req] = await Promise.all([
        page.waitForRequest(isTranslationView),
        dialog(page).getByRole("button", { name: /Search/ }).click(),
      ]);
      expect(bodyOf(req)).toEqual({ gameId: x.gameId, languageCodes: picks.map((l) => l.code) });
      await expect(tRows(page)).toHaveCount(2);
      expect(await dialog(page).locator("tbody tr.ant-table-row td:first-child").allInnerTexts()).toEqual(
        picks.map((l) => l.code),
      );

      const [req2] = await Promise.all([
        page.waitForRequest(isTranslationView),
        dialog(page).getByRole("button", { name: /Reset/ }).click(),
      ]);
      expect(bodyOf(req2)).toEqual({ gameId: x.gameId });
      await expect(tRows(page)).toHaveCount(view.translations.length);
      await closeDialog(page);
    });

    test("Bấm Update của 1 ngôn ngữ: 2 ô nhập (tối đa 500 ký tự) hiện giá trị hiện tại, các dòng khác bị khoá", async ({ page }) => {
      const { view } = await openTranslation(page);
      const i = view.translations.findIndex((t) => t.languageCode !== "en");
      test.skip(i < 0, "Không có bản dịch sửa được");
      const t = view.translations[i];
      const row = tRowAt(page, i);
      await row.locator('svg[data-icon="pen-to-square"]').click();
      await expect(tTitleInput(row)).toHaveValue(t.title);
      await expect(tDescInput(row)).toHaveValue(t.description);
      await expect(tTitleInput(row)).toHaveAttribute("maxlength", "500");
      await expect(tDescInput(row)).toHaveAttribute("maxlength", "500");
      await expect(row.locator('svg[data-icon="circle-check"]')).toBeVisible();
      await expect(row.locator('svg[data-icon="circle-xmark"]')).toBeVisible();
      const other = view.translations.findIndex((v, k) => k !== i && v.languageCode !== "en");
      if (other >= 0) {
        await expect(tRowAt(page, other).locator('svg[data-icon="pen-to-square"]')).toHaveClass(/disabled/);
      }
      await row.locator('svg[data-icon="circle-xmark"]').click();
      await closeDialog(page);
    });

    test("Xoá trống Title / Description bản dịch rồi Save: báo 2 lỗi, không gửi request lưu", async ({ page }) => {
      const { view } = await openTranslation(page);
      const i = view.translations.findIndex((t) => t.languageCode !== "en");
      test.skip(i < 0, "Không có bản dịch sửa được");
      const row = tRowAt(page, i);
      await row.locator('svg[data-icon="pen-to-square"]').click();
      await tTitleInput(row).fill("");
      await tDescInput(row).fill("");
      await row.locator('svg[data-icon="circle-check"]').click();
      await expect(row.locator(".ant-form-item-explain-error")).toHaveText([MSG.title, MSG.desc]);
      await row.locator('svg[data-icon="circle-xmark"]').click();
      await closeDialog(page);
    });

    test("Cancel khi sửa bản dịch: khôi phục giá trị gốc, không gửi request lưu", async ({ page }) => {
      const { view } = await openTranslation(page);
      const i = view.translations.findIndex((t) => t.languageCode !== "en");
      test.skip(i < 0, "Không có bản dịch sửa được");
      const t = view.translations[i];
      const row = tRowAt(page, i);
      await row.locator('svg[data-icon="pen-to-square"]').click();
      await tTitleInput(row).fill("QA-AUTO");
      await tDescInput(row).fill("QA-AUTO không lưu");
      await row.locator('svg[data-icon="circle-xmark"]').click();
      await expect(row.locator("input")).toHaveCount(0);
      await expect(row.locator("td").nth(1)).toHaveText(norm(t.title));
      await expect(row.locator("td").nth(2)).toHaveText(norm(t.description));
      await closeDialog(page);
    });

    test("Save bản dịch hợp lệ gửi đúng request translation/update {gameId, languageCode, title, description} (request bị chặn, không ghi dữ liệu thật)", async ({ page }) => {
      const { x, view } = await openTranslation(page);
      const i = view.translations.findIndex((t) => t.languageCode !== "en");
      test.skip(i < 0, "Không có bản dịch sửa được");
      const t = view.translations[i];
      await mockWrites(page);
      const row = tRowAt(page, i);
      await row.locator('svg[data-icon="pen-to-square"]').click();
      await tTitleInput(row).fill("QA-AUTO-T");
      await tDescInput(row).fill("QA-AUTO-D");
      const [req] = await Promise.all([
        page.waitForRequest((r) => post(r) && /\/content\/translation\/update$/.test(r.url())),
        row.locator('svg[data-icon="circle-check"]').click(),
      ]);
      const expected = { gameId: x.gameId, languageCode: t.languageCode, title: "QA-AUTO-T", description: "QA-AUTO-D" };
      expect(bodyOf(req)).toEqual(expected);
      allowedWrites = [{ url: "game-recommendation/content/translation/update", body: expected }];
    });

    test("Đóng hộp thoại bằng nút X và bảng chính không thay đổi", async ({ page }) => {
      const { x } = await openTranslation(page);
      await closeDialog(page);
      await expect(cellAt(page, 0, COL.game)).toHaveText(norm(x.gameName));
      await expect(cellAt(page, 0, COL.title)).toHaveText(norm(x.recommendationGameTitle));
    });

    test("Esc đóng hộp thoại (sau khi click tiêu đề để có focus)", async ({ page }) => {
      await openTranslation(page);
      await dialog(page).locator("[id^=':r']").first().click();
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toBeHidden();
    });
  });

  // ===== 9. Manage Columns =====
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
      await item(page, "Recommendation Description").locator("label").click();
      expect(await headers(page)).not.toContain("Recommendation Description");
      expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

      await item(page, "Recommendation Description").locator("label").click();
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
      test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
      const names = await columnValues(page, "Game Name");
      const titles = await columnValues(page, "Recommendation Game Title");
      await columnBtn(page).click();
      await item(page, "Recommendation Description").locator("label").click();
      expect(await columnValues(page, "Game Name")).toEqual(names);
      expect(await columnValues(page, "Recommendation Game Title")).toEqual(titles);
    });
  });

  // ===== 10. Ghi nhớ filter =====
  test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
    const { json } = await search(page);
    test.skip(json.data.list.length === 0, "Không có dữ liệu");
    const g = (await games()).find((v) => v.value === json.data.list[0].gameId);
    test.skip(!g, "Game đầu tiên không có trong dropdown/game");

    await selectGame(page, g);
    await search(page);
    await pageSizeSelect(page).click();
    await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

    await openPage(page); // reload
    expect(await selectedGame(page)).toEqual([optionText(g)]);
    await expect(page.locator(".ant-pagination-options")).toContainText("20 / page");
  });

  test("Sau Reset rồi reload: filter không còn được ghi nhớ", async ({ page }) => {
    const { json } = await search(page);
    test.skip(json.data.list.length === 0, "Không có dữ liệu");
    const g = (await games()).find((v) => v.value === json.data.list[0].gameId);
    test.skip(!g, "Game đầu tiên không có trong dropdown/game");
    await selectGame(page, g);
    await search(page);
    await reloadBy(page, () => resetBtn(page).click());

    await openPage(page); // reload
    await expect(filterEl(page, "gameId").locator(".ant-select-selection-item")).toHaveCount(0);
    await expect(rows(page)).toHaveCount(Math.min(10, json.data.totalCount));
  });
});
