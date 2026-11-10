// Game Recommendation > Game Recommendation  (https://dev-bo.royaledge.io/game-recommendation/game-recommendation)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/game_recommendation.spec.js --project=setup --project=chromium
//
// Màn hình quản lý "game được đề xuất": mỗi dòng là 1 game (Game Name) kèm các nhóm đề xuất (Group Name, tối đa hiện 3 chip rồi
// "+ N ..." bấm để mở rộng / thu gọn) và tối đa 2 Priority Game. KHÁC màn hình "Recommendation Group" (tests/game_recommendation_group.spec.js).
//  - Filter: chỉ có Game Name (chọn 1 game; API nhận key "gameName" = TÊN game (label), khớp một phần, không phải id)
//  - Chỉ cột Game Name sort được (gameName asc -> gameName desc -> về mặc định id desc)
//  - Add New (modal "Add Game"): Game Name (bắt buộc, lấy từ dropdown/game-recommendation/available-games = game CHƯA có đề xuất),
//    Group Name (bắt buộc, chọn nhiều), Priority Game 1 / 2 (tuỳ chọn, không trùng game đang chọn và không trùng nhau)
//  - Update (modal "Edit Game <tên>"): Game Name bị khoá; Delete: hộp thoại xác nhận "Are you sure you want to delete the recommendation for <tên>?"
//  - Không có Export, không có checkbox chọn dòng / thao tác hàng loạt.
//
// AN TOÀN DỮ LIỆU:
//  - Nhóm test "chỉ đọc" (mọi describe trừ cuối): KHÔNG gửi request ghi. Có 2 lớp bảo hiểm: watchWrites (afterEach kiểm tra không có
//    request ghi) và route.abort mọi POST ghi. Chỉ mở modal, kiểm tra nội dung / validation (form lỗi nên bị chặn) rồi Cancel / X.
//  - Nhóm "CRUD (ghi dữ liệu thật)" (describe cuối, chạy tuần tự): mỗi test TỰ TẠO 1 bản ghi đề xuất cho 1 game mà hệ thống báo
//    chưa có đề xuất (game cuối cùng của available-games), thao tác sửa / xoá CHỈ trên bản ghi đó rồi XOÁ bằng UI trong finally / afterEach.
//    Bản ghi đề xuất không có trường tên nên không gắn được tiền tố QA-AUTO-; bản ghi được nhận diện bằng đúng gameId do test tạo ra
//    (so với id trả về ở response create). KHÔNG sửa / xoá bản ghi có sẵn của team. Group / Priority Game chỉ được tham chiếu (không đổi).
//  - Không hard-code dữ liệu: game, group, priority game đều lấy từ response dropdown / danh sách.
// Dữ liệu dev ít (~12 bản ghi) nên test phân trang dùng 10 dòng/trang; test nào cần dữ liệu mà không đủ sẽ tự skip.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");

test.use({
  viewport: { width: 1920, height: 1080 },
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/game-recommendation/game-recommendation";
const COLUMNS = ["Game Name", "Group Name", "Priority Game", "Action"];
const COL = { game: 0, groups: 1, priority: 2, action: 3 };
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
const MAX_GROUP_CHIPS = 3; // cột Group Name chỉ hiện 3 chip, phần còn lại gom vào "+ N ..."
const MAX_PRIORITY = 2;
const DEFAULT_BODY = { page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: {} };

// Thông báo của form / toast (đọc từ màn hình thật)
const MSG = {
  game: "Please select a game",
  groups: "Please select at least 1 group",
  created: "Game recommendation created successfully",
  updated: "Game recommendation updated successfully",
  deleted: "Game recommendation deleted successfully",
};

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI
const READ = /\/(list|details|view|download)(\?|$)|\/dropdown\//;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/game-recommendation/list");
const isView = endsWith("/game-recommendation/view");
const isGameDropdown = (r) => reqOf(r).url().endsWith("/dropdown/game");
const isAvailable = (r) => reqOf(r).url().endsWith("/dropdown/game-recommendation/available-games");
const isGroupDropdown = (r) => reqOf(r).url().endsWith("/dropdown/recommendation-group");

const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};
const sortedAsc = (a) => [...a].sort();

const table = (page) => page.locator(".ant-table").first();
const rows = (page) => table(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
// Dòng theo đúng Game Name (khớp chính xác, không nhầm "Money Tree" với "Mr King - Money Tree")
const rowOf = (page, name) => rows(page).filter({ has: page.locator("td").first().filter({ hasText: exact(name) }) });
const editIcon = (row) => row.locator('svg[data-icon="pen-to-square"]');
const deleteIcon = (row) => row.locator('svg[data-icon="trash"]');
const th = (page, name) => table(page).locator("thead th").filter({ hasText: exact(name) });
const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const addBtn = (page) => page.getByRole("button", { name: /Add New/ });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const tooltip = (page) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");
const toast = (page, text) => page.locator(".Toastify__toast").filter({ hasText: text });
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
const filterEl = (page, id) => page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
const pageSizeSelect = (page) => page.locator(".ant-pagination-options .ant-select");

// Hộp thoại Add / Edit / Delete
const modal = (page) => page.locator(".ant-modal-content");
const field = (page, id) => modal(page).locator(".ant-form-item").filter({ has: page.locator(`#${id}`) });
const fieldErrors = (page) => modal(page).locator(".ant-form-item-explain-error");
const submitBtn = (page) => modal(page).getByRole("button", { name: /Submit$/ });
const cancelBtn = (page) => modal(page).getByRole("button", { name: /Cancel$/ });
const modalTitle = (page) => modal(page).locator(".ant-modal-title");

// Text option của game: "CODE - Tên"
const optionText = (g) => `${g.code} - ${g.label ?? g.name}`;

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
}

// Khi filter vừa đổi, Search đôi khi gửi 2 request list giống hệt nhau cách nhau ~200ms:
// chờ mạng yên sau mỗi lần gọi để request thừa không bị nhầm là request của thao tác kế tiếp.
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
}

// Mở màn hình, chờ lần load đầu; trả về { body, json } của request mặc định
async function openPage(page) {
  test.setTimeout(90000);
  const firstRes = page.waitForResponse(isList, { timeout: 60000 });
  firstRes.catch(() => {}); // tránh unhandled rejection khi test kết thúc sớm
  await page.goto(URL);
  // Session hết hạn -> app chuyển về /login và không bao giờ gọi API: báo lỗi rõ ràng thay vì chờ timeout
  const redirectedToLogin = page
    .waitForURL(/\/login/, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (await Promise.race([firstRes.then(() => false), redirectedToLogin])) {
    throw new Error(
      "Bị chuyển về /login: session trong playwright/.auth/session.txt đã hết hạn (backend chỉ cho 1 session/tài khoản - đăng nhập ở nơi khác sẽ làm session này mất hiệu lực; token chỉ sống khoảng 1 giờ). Copy lại localStorage từ DevTools.",
    );
  }
  const res = await firstRes;
  await settle(page);
  await expect(page.locator(".NextGen-filter-bar")).toBeVisible();
  return { body: bodyOf(reqOf(res)), json: await res.json() };
}

// Thực hiện 1 hành động làm bảng gọi lại API (Search, sort, đổi trang, Reset...) -> { body, status, json }
async function callList(page, action) {
  const [req] = await Promise.all([page.waitForRequest(isList), action()]);
  const res = await req.response();
  const json = await res.json();
  await settle(page);
  return { body: bodyOf(req), status: res.status(), json };
}
const search = (page) => callList(page, () => searchBtn(page).click());
const reloadBy = callList;

// Thực hiện 1 hành động GHI (Submit / Delete) -> { body, status, json } của request ghi có URL kết thúc bằng `suffix`
async function writeCall(page, suffix, action) {
  const [req] = await Promise.all([page.waitForRequest(endsWith(suffix)), action()]);
  const res = await req.response();
  const json = await res.json();
  await settle(page);
  return { body: bodyOf(req), status: res.status(), json };
}

const headers = async (page) => (await table(page).locator("thead th").allInnerTexts()).map((t) => t.trim());

// Toàn bộ giá trị của 1 cột (theo tên header) ở trang hiện tại
async function columnValues(page, name) {
  await expect.poll(() => headers(page), { message: `Không thấy cột "${name}"` }).toContain(name);
  const idx = (await headers(page)).indexOf(name);
  return rows(page).evaluateAll((trs, i) => trs.map((tr) => tr.children[i].innerText.replace(/\s+/g, " ").trim()), idx);
}

// Chip của 1 ô (Group Name / Priority Game): tên các chip + chip bấm được "+ N ..." (có style cursor)
async function chipInfo(page, i, col) {
  const cell = cellAt(page, i, col);
  const names = (await cell.locator('.ant-tag:not([style*="cursor"])').allInnerTexts()).map(norm);
  const toggle = cell.locator('.ant-tag[style*="cursor"]');
  const hasToggle = (await toggle.count()) > 0;
  return { names, hasToggle, more: hasToggle ? norm(await toggle.first().innerText()) : null };
}

// Chọn 1 game ở filter Game Name (single select: mở bằng label, gõ code để thu hẹp, click đúng option "CODE - Tên")
async function pickFilterGame(page, game) {
  await filterEl(page, "gameName").locator("label").click();
  await page.locator("#gameName").fill(game.code);
  await openOptions(page).filter({ hasText: exact(optionText(game)) }).first().click();
  await expect(openOptions(page)).toHaveCount(0);
}
const pickedFilterGame = (page) =>
  filterEl(page, "gameName").locator(".ant-select-selection-item[title]").evaluateAll((els) => els.map((e) => e.title));

// ----- Thao tác trong hộp thoại Add / Edit -----
// Chọn 1 game ở ô single select (Game Name / Priority Game): gõ code rồi click đúng option
async function pickOne(page, id, game) {
  await modal(page).locator(`#${id}`).click({ force: true });
  await modal(page).locator(`#${id}`).fill(game.code);
  await openOptions(page).filter({ hasText: exact(optionText(game)) }).first().click();
  await expect(openOptions(page)).toHaveCount(0);
}
// Chọn nhiều group (ô multiple không tự đóng, Esc không đóng -> click ra ngoài bằng tiêu đề hộp thoại)
async function pickGroups(page, labels) {
  await modal(page).locator("#recommendationGroupIds").click({ force: true });
  for (const label of labels) await openOptions(page).filter({ hasText: exact(label) }).first().click();
  await modalTitle(page).click();
  await expect(openOptions(page)).toHaveCount(0);
}
// Giá trị đang chọn (title) của 1 ô trong hộp thoại, bỏ chip gom "+ N ..."
const selectedOf = (page, id) =>
  field(page, id)
    .locator(".ant-select-selection-item")
    .evaluateAll((els) => els.map((e) => e.title).filter((t) => t && !t.startsWith("+")));
async function clearSelect(page, id) {
  await field(page, id).locator(".ant-select").hover();
  await field(page, id).locator(".ant-select-clear").click({ force: true });
}
async function removeGroupChip(page, label) {
  await field(page, "recommendationGroupIds")
    .locator(".ant-select-selection-item")
    .filter({ hasText: exact(label) })
    .locator(".ant-select-selection-item-remove")
    .click();
}

// Ghi lại mọi POST ghi dữ liệu (không thuộc nhóm đọc) + tuỳ chọn chặn thật không cho tới server
async function guardWrites(page, { block }) {
  const writes = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /boapi/.test(r.url()) && !READ.test(r.url())) writes.push(r.url().replace(/^https?:\/\/[^/]+/, ""));
  });
  if (block) {
    await page.route(/boapi/, (route) => {
      const r = route.request();
      return r.method() === "POST" && !READ.test(r.url()) ? route.abort() : route.continue();
    });
  }
  return writes;
}

// Bộ lọc, số dòng/trang và cách sắp xếp được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
// (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
async function clearSavedState(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("__game_recommendation_spec_cleared")) return;
    for (const k of Object.keys(localStorage)) {
      if (/game-recommendation_game-recommendation_(filter|page_size)$|^sorter__game-recommendation_game-recommendation$/.test(k)) {
        localStorage.removeItem(k);
      }
    }
    sessionStorage.setItem("__game_recommendation_spec_cleared", "1");
  });
}

// Mở hộp thoại Add New; trả về dữ liệu dropdown của hộp thoại { avail, groups }
async function openAdd(page) {
  const av = page.waitForResponse(isAvailable, { timeout: 30000 });
  const gr = page.waitForResponse(isGroupDropdown, { timeout: 30000 });
  av.catch(() => {});
  gr.catch(() => {});
  await addBtn(page).click();
  await expect(modalTitle(page)).toHaveText("Add Game");
  return { avail: (await (await av).json()).data, groups: (await (await gr).json()).data };
}

// Mở hộp thoại Update của 1 dòng, chờ response view; trả về data của bản ghi
async function openEdit(page, row) {
  const [res] = await Promise.all([page.waitForResponse(isView), editIcon(row).click()]);
  await expect(modalTitle(page)).toContainText("Edit Game");
  const data = (await res.json()).data;
  await expect(field(page, "gameId")).toBeVisible();
  return { data, body: bodyOf(res.request()) };
}

// Đóng dropdown đang mở trong hộp thoại bằng cách click tiêu đề (Esc không đóng được dropdown)
async function closeDropdown(page) {
  await modalTitle(page).click();
  await expect(openOptions(page)).toHaveCount(0);
}

async function closeModal(page) {
  await cancelBtn(page).click();
  await expect(modal(page)).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Tests chỉ đọc
// ---------------------------------------------------------------------------
test.describe("Game Recommendation > Game Recommendation (chỉ đọc)", () => {
  let writes;
  let initial; // { body, json } của lần load đầu (mặc định)
  let gamesLoaded; // promise response dropdown/game (toàn bộ game của hệ thống)
  const list = () => initial.json.data.list;
  const total = () => initial.json.data.totalCount;
  const games = async () => (await (await gamesLoaded).json()).data; // [{ value, code, label }]
  const needData = () => test.skip(list().length === 0, "Không có bản ghi nào");

  test.beforeEach(async ({ page }) => {
    await clearSavedState(page);
    writes = await guardWrites(page, { block: true });
    gamesLoaded = page.waitForResponse(isGameDropdown, { timeout: 60000 });
    gamesLoaded.catch(() => {});
    initial = await openPage(page);
  });

  test.afterEach(() => {
    expect(writes, "Không được gửi request ghi dữ liệu").toEqual([]);
  });

  // ===== 1. Hiển thị mặc định =====
  test.describe("Hiển thị mặc định", () => {
    test("Có tiêu đề, filter Game Name và nút Search / Reset", async ({ page }) => {
      await expect(breadcrumb(page)).toHaveText("Game Recommendation");
      await expect(filterEl(page, "gameName")).toContainText("Game Name");
      await expect(filterEl(page, "gameName")).toBeVisible();
      await expect(page.locator(".NextGen-filter-element")).toHaveCount(1);
      await expect(searchBtn(page)).toBeVisible();
      await expect(resetBtn(page)).toBeVisible();
    });

    test("Giá trị filter mặc định: để trống", async ({ page }) => {
      await expect(filterEl(page, "gameName").locator(".ant-select-selection-item")).toHaveCount(0);
    });

    test("Game Name là dropdown chọn 1 giá trị có tìm kiếm", async ({ page }) => {
      const sel = filterEl(page, "gameName");
      await expect(sel.locator(".ant-select-single.ant-select-show-search")).toHaveCount(1);
      await expect(sel.locator(".ant-select-multiple")).toHaveCount(0);
    });

    test("Có Add New và Manage Columns; không có Export, checkbox chọn dòng", async ({ page }) => {
      await expect(addBtn(page)).toBeVisible();
      await expect(page.locator("button.NextGen-popover-manage-column__buton")).toBeVisible();
      await expect(page.locator("button.NextGen-export-button")).toHaveCount(0);
      await expect(table(page).locator('input[type="checkbox"]')).toHaveCount(0);
    });

    test("Bảng có đủ cột đúng thứ tự", async ({ page }) => {
      expect(await headers(page)).toEqual(COLUMNS);
    });

    test("Lần load đầu gửi body mặc định (page 1, 10 dòng, sort id giảm dần, không filter)", async () => {
      expect(initial.body).toEqual(DEFAULT_BODY);
      const ids = list().map((g) => g.id);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
      expect(ids.length).toBeLessThanOrEqual(10);
    });

    test("Dòng 'Showing 1 - n of N records' khớp totalCount và số dòng hiển thị", async ({ page }) => {
      needData();
      const shown = Math.min(10, total());
      await expect(summary(page)).toHaveText(`Showing 1 - ${shown} of ${total()} records`);
      await expect(rows(page)).toHaveCount(shown);
    });

    test("Nút Filter thu gọn / mở rộng thanh filter", async ({ page }) => {
      const bar = page.locator(".NextGen-filter-bar__items");
      const btn = page.locator(".NextGen-list-layout__filter-control__filter-btn");
      await expect(bar).toBeVisible();
      await btn.click();
      await expect(bar).toBeHidden();
      await btn.click();
      await expect(bar).toBeVisible();
    });
  });

  // ===== 2. Dữ liệu bảng =====
  test.describe("Dữ liệu bảng", () => {
    test("Mỗi dòng khớp response API (Game Name, chip Group, chip Priority Game)", async ({ page }) => {
      needData();
      await expect(rows(page)).toHaveCount(list().length);
      for (const [i, r] of list().entries()) {
        const at = `dòng ${i + 1} (id ${r.id})`;
        expect(norm(await cellAt(page, i, COL.game).innerText()), at).toBe(norm(r.gameName));
        expect((await chipInfo(page, i, COL.groups)).names, at).toEqual(r.groups.slice(0, MAX_GROUP_CHIPS).map((x) => norm(x.name)));
        expect((await chipInfo(page, i, COL.priority)).names, at).toEqual(r.priorityGames.map((x) => norm(x.name)));
      }
    });

    test("Game Name không rỗng và mỗi game chỉ xuất hiện 1 lần", async ({ page }) => {
      needData();
      const names = await columnValues(page, "Game Name");
      for (const v of names) expect(v).not.toBe("");
      expect(new Set(list().map((r) => r.gameId)).size).toBe(list().length);
      expect(new Set(names).size).toBe(names.length);
    });

    test("Game của mỗi bản ghi có trong dropdown/game (gameName = label, gameCode = code)", async () => {
      needData();
      const byId = new Map((await games()).map((g) => [g.value, g]));
      for (const r of list()) {
        const g = byId.get(r.gameId);
        expect(g, `game ${r.gameId} của bản ghi ${r.id}`).toBeTruthy();
        expect(r.gameName, `bản ghi ${r.id}`).toBe(g.label);
        expect(r.gameCode, `bản ghi ${r.id}`).toBe(g.code);
      }
    });

    test("Priority Game: tối đa 2, không trùng nhau và không trùng chính game đó", async () => {
      needData();
      for (const r of list()) {
        const ids = r.priorityGames.map((p) => p.id);
        expect(ids.length, `bản ghi ${r.id}`).toBeLessThanOrEqual(MAX_PRIORITY);
        expect(new Set(ids).size, `bản ghi ${r.id}`).toBe(ids.length);
        expect(ids, `bản ghi ${r.id}`).not.toContain(r.gameId);
      }
    });

    test("Priority Game là game có trong dropdown/game", async () => {
      needData();
      const ids = new Set((await games()).map((g) => g.value));
      for (const r of list()) for (const p of r.priorityGames) expect(ids.has(p.id), `priority ${p.id} của bản ghi ${r.id}`).toBe(true);
    });

    test("Group Name chỉ hiện tối đa 3 chip + chip '+ N ...'; bản ghi ≤ 3 group không có chip này", async ({ page }) => {
      needData();
      for (const [i, r] of list().entries()) {
        const at = `dòng ${i + 1} (id ${r.id}, ${r.groups.length} group)`;
        const { names, more } = await chipInfo(page, i, COL.groups);
        expect(names.length, at).toBe(Math.min(r.groups.length, MAX_GROUP_CHIPS));
        if (r.groups.length > MAX_GROUP_CHIPS) expect(more, at).toBe(`+ ${r.groups.length - MAX_GROUP_CHIPS} ...`);
        else expect(more, at).toBeNull();
      }
    });

    test("Priority Game không có chip gom '+ N ...' (tối đa 2 chip)", async ({ page }) => {
      needData();
      for (const [i] of list().entries()) expect((await chipInfo(page, i, COL.priority)).hasToggle).toBe(false);
    });

    test("Bấm chip '+ N ...' hiện đủ group theo đúng thứ tự, bấm lại thì thu gọn", async ({ page }) => {
      const i = list().findIndex((r) => r.groups.length > MAX_GROUP_CHIPS);
      test.skip(i < 0, `Không có bản ghi nào có hơn ${MAX_GROUP_CHIPS} group`);
      const r = list()[i];
      await cellAt(page, i, COL.groups).locator('.ant-tag[style*="cursor"]').click();
      await expect.poll(async () => (await chipInfo(page, i, COL.groups)).names).toEqual(r.groups.map((x) => norm(x.name)));
      await cellAt(page, i, COL.groups).locator('.ant-tag[style*="cursor"]').click();
      await expect.poll(async () => (await chipInfo(page, i, COL.groups)).names).toEqual(r.groups.slice(0, MAX_GROUP_CHIPS).map((x) => norm(x.name)));
      expect((await chipInfo(page, i, COL.groups)).more).toBe(`+ ${r.groups.length - MAX_GROUP_CHIPS} ...`);
    });

    test("Mỗi dòng có icon Update / Delete kèm tooltip (chỉ hover, không bấm)", async ({ page }) => {
      needData();
      const n = Math.min(5, await rows(page).count());
      for (let i = 0; i < n; i++) {
        await expect(cellAt(page, i, COL.action).locator("svg")).toHaveCount(2);
        await editIcon(rowAt(page, i)).hover();
        await expect(tooltip(page).filter({ hasText: "Update" })).toBeVisible();
        await deleteIcon(rowAt(page, i)).hover();
        await expect(tooltip(page).filter({ hasText: "Delete" })).toBeVisible();
      }
    });
  });

  // ===== 3. Search / Filter =====
  test.describe("Search / Filter", () => {
    test("Option của Game Name lấy từ API dropdown/game, hiển thị dạng 'CODE - Tên'", async ({ page }) => {
      const data = await games();
      test.skip(data.length === 0, "Không có game nào");
      await filterEl(page, "gameName").locator("label").click();
      await openOptions(page).first().waitFor();
      const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      expect(sortedAsc(titles)).toEqual(sortedAsc(data.map(optionText)));
      await breadcrumb(page).click(); // Esc không đóng được khi chưa gõ tìm kiếm
      await expect(openOptions(page)).toHaveCount(0);
    });

    test("Game Name: gửi key gameName = TÊN game (không phải id), mọi dòng kết quả khớp tên đó", async ({ page }) => {
      needData();
      const r0 = list()[0];
      await pickFilterGame(page, { code: r0.gameCode, label: r0.gameName });
      expect(await pickedFilterGame(page)).toEqual([optionText({ code: r0.gameCode, label: r0.gameName })]);
      const r = await search(page);
      expect(r.status).toBe(200);
      expect(r.body.filters).toEqual({ gameName: r0.gameName });
      expect(r.json.data.list.map((x) => x.id)).toContain(r0.id);
      // Khớp một phần (vd "Money Tree" còn ra "Mr King - Money Tree") nên chỉ kiểm tra tên chứa giá trị lọc
      for (const x of r.json.data.list) expect(x.gameName.toLowerCase(), `bản ghi ${x.id}`).toContain(r0.gameName.toLowerCase());
      await expect(rows(page)).toHaveCount(r.json.data.list.length);
      await expect(summary(page)).toContainText(`of ${r.json.data.totalCount} records`);
    });

    test("Dữ liệu dòng sau khi lọc vẫn đủ group / priority game", async ({ page }) => {
      needData();
      const r0 = list()[0];
      await pickFilterGame(page, { code: r0.gameCode, label: r0.gameName });
      const r = await search(page);
      const i = r.json.data.list.findIndex((x) => x.id === r0.id);
      expect(i).toBeGreaterThanOrEqual(0);
      expect((await chipInfo(page, i, COL.groups)).names).toEqual(r0.groups.slice(0, MAX_GROUP_CHIPS).map((x) => norm(x.name)));
      expect((await chipInfo(page, i, COL.priority)).names).toEqual(r0.priorityGames.map((x) => norm(x.name)));
    });

    test("Game Name chỉ chọn được 1 giá trị: chọn game khác thay thế game cũ", async ({ page }) => {
      const data = await games();
      test.skip(data.length < 2, "Cần ít nhất 2 game");
      await pickFilterGame(page, data[0]);
      await pickFilterGame(page, data[1]);
      expect(await pickedFilterGame(page)).toEqual([optionText(data[1])]);
      const r = await search(page);
      expect(r.body.filters).toEqual({ gameName: data[1].label });
    });

    test("Xoá game đã chọn bằng (x) rồi Search thì không gửi gameName", async ({ page }) => {
      const data = await games();
      test.skip(data.length === 0, "Không có game nào");
      await pickFilterGame(page, data[0]);
      await filterEl(page, "gameName").locator(".ant-select").hover();
      await filterEl(page, "gameName").locator(".ant-select-clear").click({ force: true });
      await expect(filterEl(page, "gameName").locator(".ant-select-selection-item")).toHaveCount(0);
      const r = await search(page);
      expect(r.body.filters).toEqual({});
    });

    test("Không có kết quả -> 'There are no entries found', không còn dòng / phân trang", async ({ page }) => {
      // Cần 1 game chưa có đề xuất: lấy toàn bộ bản ghi (200 dòng/trang) rồi tìm game có label không nằm trong tên nào
      await pageSizeSelect(page).click();
      const all = await reloadBy(page, () => openOptions(page).filter({ hasText: exact("200 / page") }).click());
      const names = all.json.data.list.map((x) => x.gameName.toLowerCase());
      const free = (await games()).find((g) => !names.some((n) => n.includes(g.label.toLowerCase())));
      test.skip(!free, "Mọi game đều đã có đề xuất");
      await pickFilterGame(page, free);
      const r = await search(page);
      expect(r.body.filters).toEqual({ gameName: free.label });
      expect(r.json.data.totalCount).toBe(0);
      await expect(rows(page)).toHaveCount(0);
      await expect(page.getByText("There are no entries found").first()).toBeVisible();
      await expect(page.locator(".ant-pagination")).toHaveCount(0);
    });

    test("Search khi đang ở trang 2 thì quay về trang 1", async ({ page }) => {
      test.skip(total() <= 10, "Chỉ có 1 trang");
      await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
      const r = await search(page);
      expect(r.body.page).toBe(1);
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
    });
  });

  // ===== 4. Reset =====
  test.describe("Reset", () => {
    test("Reset xoá game đã chọn, gửi lại request mặc định", async ({ page }) => {
      needData();
      const r0 = list()[0];
      await pickFilterGame(page, { code: r0.gameCode, label: r0.gameName });
      await search(page);
      const r = await reloadBy(page, () => resetBtn(page).click());
      expect(r.body).toEqual(DEFAULT_BODY);
      await expect(filterEl(page, "gameName").locator(".ant-select-selection-item")).toHaveCount(0);
      expect(r.json.data.totalCount).toBe(total());
    });
  });

  // ===== 5. Phân trang =====
  test.describe("Phân trang", () => {
    test("Có đủ 5 lựa chọn số dòng/trang: 10 / 20 / 50 / 100 / 200", async ({ page }) => {
      await pageSizeSelect(page).click();
      await openOptions(page).first().waitFor();
      expect(await openOptions(page).allInnerTexts()).toEqual(PAGE_SIZES);
    });

    test("Đổi sang 20 dòng/trang: gửi pageSize=20, trang 1, số dòng hiển thị đúng", async ({ page }) => {
      await pageSizeSelect(page).click();
      const r = await reloadBy(page, () => openOptions(page).filter({ hasText: exact("20 / page") }).click());
      expect(r.body).toMatchObject({ page: 1, pageSize: 20 });
      const shown = Math.min(20, total());
      expect(r.json.data.list).toHaveLength(shown);
      await expect(rows(page)).toHaveCount(shown);
      await expect(pageSizeSelect(page).locator(".ant-select-selection-item")).toHaveText("20 / page");
    });

    test("Chỉ có 1 trang: trang hiện tại là 1, nút Previous / Next bị khoá", async ({ page }) => {
      test.skip(total() === 0 || total() > 10, "Không phải trường hợp chỉ có 1 trang");
      await expect(page.locator(".ant-pagination-item")).toHaveCount(1);
      await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
      await expect(page.locator(".ant-pagination-prev")).toHaveClass(/ant-pagination-disabled/);
      await expect(page.locator(".ant-pagination-next")).toHaveClass(/ant-pagination-disabled/);
    });

    test.describe("Khi có nhiều hơn 10 bản ghi", () => {
      test.beforeEach(() => {
        test.skip(total() <= 10, `Chỉ có ${total()} bản ghi, không đủ để test nhiều trang`);
      });

      test("Chuyển sang trang 2 rồi quay lại trang 1", async ({ page }) => {
        const page1 = await rows(page).allInnerTexts();
        const r2 = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        expect(r2.body.page).toBe(2);
        await expect(summary(page)).toHaveText(new RegExp(`^Showing 11 - ${Math.min(20, total())} of `));
        expect(await rows(page).allInnerTexts()).not.toEqual(page1);
        const r1 = await reloadBy(page, () => page.locator(".ant-pagination-item-1").click());
        expect(r1.body.page).toBe(1);
        await expect(summary(page)).toHaveText(/^Showing 1 - 10 of /);
      });

      test("Nút Next / Previous", async ({ page }) => {
        await expect(page.locator(".ant-pagination-prev")).toHaveClass(/ant-pagination-disabled/);
        const next = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
        expect(next.body.page).toBe(2);
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
        const prev = await reloadBy(page, () => page.locator(".ant-pagination-prev").click());
        expect(prev.body.page).toBe(1);
      });

      test("Trang cuối hiển thị phần dư của danh sách và khoá nút Next", async ({ page }) => {
        const last = Math.ceil(total() / 10);
        const r = await reloadBy(page, () => page.locator(`.ant-pagination-item-${last}`).click());
        const shown = total() - (last - 1) * 10;
        expect(r.body.page).toBe(last);
        expect(r.json.data.list).toHaveLength(shown);
        await expect(rows(page)).toHaveCount(shown);
        await expect(summary(page)).toHaveText(`Showing ${(last - 1) * 10 + 1} - ${total()} of ${total()} records`);
        await expect(page.locator(".ant-pagination-next")).toHaveClass(/ant-pagination-disabled/);
      });

      test("Các trang không trùng dòng nhau (trang 1 và trang 2)", async ({ page }) => {
        const names1 = await columnValues(page, "Game Name");
        await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        for (const n of await columnValues(page, "Game Name")) expect(names1).not.toContain(n);
      });

      test("Giữ nguyên sắp xếp khi chuyển trang", async ({ page }) => {
        const sorted = await reloadBy(page, () => th(page, "Game Name").click());
        expect(sorted.body).toMatchObject({ sortBy: "gameName", sortDirection: "asc" });
        const r = await reloadBy(page, () => page.locator(".ant-pagination-next").click());
        expect(r.body).toMatchObject({ page: 2, sortBy: "gameName", sortDirection: "asc" });
      });

      test("Giữ nguyên filter khi đổi số dòng/trang", async ({ page }) => {
        const r0 = list()[0];
        await pickFilterGame(page, { code: r0.gameCode, label: r0.gameName });
        const filtered = await search(page);
        await pageSizeSelect(page).click();
        const r = await reloadBy(page, () => openOptions(page).filter({ hasText: exact("20 / page") }).click());
        expect(r.body.filters).toEqual(filtered.body.filters);
      });
    });
  });

  // ===== 6. Sắp xếp =====
  test.describe("Sắp xếp", () => {
    test("Game Name: tăng dần -> giảm dần -> về mặc định; bảng đúng thứ tự response", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
      const asc = await reloadBy(page, () => th(page, "Game Name").click());
      expect(asc.body).toMatchObject({ sortBy: "gameName", sortDirection: "asc" });
      // Cột chữ phụ thuộc collation server -> chỉ kiểm tra bảng hiển thị đúng thứ tự backend trả về
      await expect.poll(() => columnValues(page, "Game Name")).toEqual(asc.json.data.list.map((r) => norm(r.gameName)));

      const desc = await reloadBy(page, () => th(page, "Game Name").click());
      expect(desc.body).toMatchObject({ sortBy: "gameName", sortDirection: "desc" });
      await expect.poll(() => columnValues(page, "Game Name")).toEqual(desc.json.data.list.map((r) => norm(r.gameName)));

      const none = await reloadBy(page, () => th(page, "Game Name").click());
      expect(none.body).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      const ids = none.json.data.list.map((r) => r.id);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
    });

    test("Sort giảm dần là đảo ngược của tăng dần (tên không trùng, gom về 1 trang 20 dòng)", async ({ page }) => {
      test.skip(total() > 20 || total() < 2, "Cần 2-20 bản ghi để gom về 1 trang");
      await pageSizeSelect(page).click();
      await reloadBy(page, () => openOptions(page).filter({ hasText: exact("20 / page") }).click());
      const asc = await reloadBy(page, () => th(page, "Game Name").click());
      const desc = await reloadBy(page, () => th(page, "Game Name").click());
      expect(desc.json.data.list.map((r) => r.id)).toEqual(asc.json.data.list.map((r) => r.id).reverse());
    });

    test("Sort giữ nguyên filter đang áp dụng", async ({ page }) => {
      needData();
      const r0 = list()[0];
      await pickFilterGame(page, { code: r0.gameCode, label: r0.gameName });
      const filtered = await search(page);
      const r = await reloadBy(page, () => th(page, "Game Name").click());
      expect(r.body).toMatchObject({ sortBy: "gameName", sortDirection: "asc" });
      expect(r.body.filters).toEqual(filtered.body.filters);
      expect(r.json.data.list).toHaveLength(filtered.json.data.list.length);
    });

    test("Cách sắp xếp được ghi nhớ sau reload; bỏ sort thì về mặc định", async ({ page }) => {
      test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu");
      await reloadBy(page, () => th(page, "Game Name").click());
      const [req] = await Promise.all([page.waitForRequest(isList), page.reload()]);
      expect(bodyOf(req)).toMatchObject({ sortBy: "gameName", sortDirection: "asc" });
      await settle(page);

      await reloadBy(page, () => th(page, "Game Name").click()); // desc
      await reloadBy(page, () => th(page, "Game Name").click()); // bỏ sort
      const [req2] = await Promise.all([page.waitForRequest(isList), page.reload()]);
      expect(bodyOf(req2)).toMatchObject({ sortBy: "id", sortDirection: "desc" });
    });

    test("Các cột Group Name, Priority Game, Action không sort được; chỉ Game Name sort được", async ({ page }) => {
      for (const name of ["Group Name", "Priority Game", "Action"]) {
        await expect(th(page, name), name).not.toHaveClass(/ant-table-column-has-sorters/);
      }
      await expect(th(page, "Game Name")).toHaveClass(/ant-table-column-has-sorters/);
    });
  });

  // ===== 7. Hộp thoại Add (không bấm Submit khi form hợp lệ) =====
  test.describe("Hộp thoại Add Game (không bấm Submit khi hợp lệ)", () => {
    test("Add New mở hộp thoại 'Add Game' với form trống, có Cancel / Submit / X", async ({ page }) => {
      await openAdd(page);
      await expect(field(page, "gameId")).toContainText("Game Name");
      await expect(field(page, "gameId").locator("label")).toHaveClass(/ant-form-item-required/);
      await expect(field(page, "recommendationGroupIds")).toContainText("Group Name");
      await expect(field(page, "recommendationGroupIds").locator("label")).toHaveClass(/ant-form-item-required/);
      await expect(field(page, "priorityGameId1")).toContainText("Priority Game");
      await expect(field(page, "priorityGameId1").locator("label")).not.toHaveClass(/ant-form-item-required/);
      await expect(modal(page).locator("#priorityGameId2")).toHaveCount(1);
      await expect(modal(page).locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(fieldErrors(page)).toHaveCount(0);
      await expect(cancelBtn(page)).toBeVisible();
      await expect(submitBtn(page)).toBeVisible();
      await expect(modal(page).locator(".ant-modal-close")).toBeVisible();
      await closeModal(page);
    });

    test("Game Name là select 1 giá trị, Group Name chọn nhiều, Priority Game 1 / 2 là select 1 giá trị", async ({ page }) => {
      await openAdd(page);
      await expect(field(page, "gameId").locator(".ant-select-single")).toHaveCount(1);
      await expect(field(page, "recommendationGroupIds").locator(".ant-select-multiple")).toHaveCount(1);
      await expect(field(page, "priorityGameId1").locator(".ant-select-single")).toHaveCount(1);
      await expect(field(page, "priorityGameId2").locator(".ant-select-single")).toHaveCount(1);
      await closeModal(page);
    });

    test("Option Game Name lấy từ available-games: game ĐÃ có đề xuất không chọn được", async ({ page }) => {
      needData();
      const { avail } = await openAdd(page);
      test.skip(avail.length === 0, "Mọi game đều đã có đề xuất");
      const used = list()[0];
      // game đã có đề xuất không nằm trong available-games
      expect(avail.map((g) => g.value)).not.toContain(used.gameId);
      await modal(page).locator("#gameId").click({ force: true });
      await modal(page).locator("#gameId").fill(used.gameCode);
      await expect(openOptions(page).filter({ hasText: exact(optionText({ code: used.gameCode, label: used.gameName })) })).toHaveCount(0);
      // game còn trống thì có option
      await modal(page).locator("#gameId").fill(avail[0].code);
      await expect(openOptions(page).filter({ hasText: exact(optionText(avail[0])) })).toHaveCount(1);
      await closeModal(page);
    });

    test("Available-games không chứa game đã có đề xuất; số game trống + số bản ghi không vượt tổng game", async ({ page }) => {
      const { avail } = await openAdd(page);
      const all = await games();
      const availIds = new Set(avail.map((g) => g.value));
      const allIds = new Set(all.map((g) => g.value));
      for (const r of list()) expect(availIds.has(r.gameId), `game ${r.gameId} đã có đề xuất`).toBe(false);
      for (const g of avail) expect(allIds.has(g.value), `game ${g.value} của available-games`).toBe(true);
      expect(avail.length + total()).toBeLessThanOrEqual(all.length);
      await closeModal(page);
    });

    test("Option Group Name lấy từ dropdown/recommendation-group", async ({ page }) => {
      const { groups } = await openAdd(page);
      test.skip(groups.length === 0, "Không có group nào");
      await modal(page).locator("#recommendationGroupIds").click({ force: true });
      await openOptions(page).first().waitFor();
      const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      expect(sortedAsc(titles)).toEqual(sortedAsc(groups.map((g) => g.label)));
      await modalTitle(page).click();
      await expect(openOptions(page)).toHaveCount(0);
      await closeModal(page);
    });

    test("Option Priority Game lấy từ dropdown/game, dạng 'CODE - Tên'", async ({ page }) => {
      await openAdd(page);
      const data = await games();
      test.skip(data.length === 0, "Không có game nào");
      await modal(page).locator("#priorityGameId1").click({ force: true });
      await openOptions(page).first().waitFor();
      const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      expect(titles.length).toBeGreaterThan(0);
      for (const t of titles) expect(data.map(optionText)).toContain(t);
      await closeDropdown(page);
      await closeModal(page);
    });

    test("Priority Game không cho chọn lại chính game đang chọn", async ({ page }) => {
      const { avail } = await openAdd(page);
      test.skip(avail.length < 1, "Không có game trống");
      const g = avail[0];
      await pickOne(page, "gameId", g);
      await modal(page).locator("#priorityGameId1").click({ force: true });
      await modal(page).locator("#priorityGameId1").fill(g.code);
      await expect(openOptions(page).filter({ hasText: exact(optionText(g)) })).toHaveCount(0);
      await closeDropdown(page);
      await closeModal(page);
    });

    test("Priority Game 2 không cho chọn lại game đã chọn ở Priority Game 1", async ({ page }) => {
      const { avail } = await openAdd(page);
      const data = await games();
      const p = data.find((x) => x.value !== avail[0]?.value);
      test.skip(!avail.length || !p, "Không đủ game");
      await pickOne(page, "priorityGameId1", p);
      await expect.poll(() => selectedOf(page, "priorityGameId1")).toEqual([optionText(p)]);
      await modal(page).locator("#priorityGameId2").click({ force: true });
      await modal(page).locator("#priorityGameId2").fill(p.code);
      await expect(openOptions(page).filter({ hasText: exact(optionText(p)) })).toHaveCount(0);
      await closeDropdown(page);
      await closeModal(page);
    });

    test("Để trống rồi Submit: báo 2 lỗi (game, group), form bị chặn", async ({ page }) => {
      await openAdd(page);
      await submitBtn(page).click(); // form lỗi nên bị chặn, không gửi request
      await expect(fieldErrors(page)).toHaveText([MSG.game, MSG.groups]);
      await expect(modal(page)).toBeVisible();
      await closeModal(page);
    });

    test("Sau khi Submit lỗi: chọn game hết lỗi game; chọn group hết lỗi group", async ({ page }) => {
      const { avail, groups } = await openAdd(page);
      test.skip(!avail.length || !groups.length, "Thiếu game trống hoặc group");
      await submitBtn(page).click();
      await expect(fieldErrors(page)).toHaveText([MSG.game, MSG.groups]);

      await pickOne(page, "gameId", avail[0]);
      await expect(fieldErrors(page)).toHaveText([MSG.groups]);
      await pickGroups(page, [groups[0].label]);
      await expect(fieldErrors(page)).toHaveCount(0);
      await closeModal(page); // KHÔNG Submit
    });

    test("Chỉ chọn game (chưa chọn group) rồi Submit: chỉ báo lỗi group", async ({ page }) => {
      const { avail } = await openAdd(page);
      test.skip(!avail.length, "Không có game trống");
      await pickOne(page, "gameId", avail[0]);
      await submitBtn(page).click();
      await expect(fieldErrors(page)).toHaveText([MSG.groups]);
      await closeModal(page);
    });

    test("Chỉ chọn group (chưa chọn game) rồi Submit: chỉ báo lỗi game", async ({ page }) => {
      const { groups } = await openAdd(page);
      test.skip(!groups.length, "Không có group");
      await pickGroups(page, [groups[0].label]);
      await submitBtn(page).click();
      await expect(fieldErrors(page)).toHaveText([MSG.game]);
      await closeModal(page);
    });

    test("Chọn nhiều group: hiển thị đủ chip đã chọn; bỏ (x) hết thì báo lại lỗi group", async ({ page }) => {
      const { groups } = await openAdd(page);
      test.skip(groups.length < 2, "Cần ít nhất 2 group");
      const picked = groups.slice(0, 2).map((g) => g.label);
      await pickGroups(page, picked);
      await expect.poll(() => selectedOf(page, "recommendationGroupIds")).toEqual(picked);
      for (const label of picked) await removeGroupChip(page, label);
      await expect.poll(() => selectedOf(page, "recommendationGroupIds")).toEqual([]);
      await expect(fieldErrors(page)).toHaveText([MSG.groups]);
      await closeModal(page);
    });

    test("Priority Game có thể xoá bằng (x) sau khi chọn", async ({ page }) => {
      const { avail } = await openAdd(page);
      const data = await games();
      const p = data.find((x) => x.value !== avail[0]?.value);
      test.skip(!avail.length || !p, "Không đủ game");
      await pickOne(page, "priorityGameId1", p);
      await expect.poll(() => selectedOf(page, "priorityGameId1")).toEqual([optionText(p)]);
      await clearSelect(page, "priorityGameId1");
      await expect.poll(() => selectedOf(page, "priorityGameId1")).toEqual([]);
      await expect(fieldErrors(page)).toHaveCount(0); // Priority Game không bắt buộc
      await closeModal(page);
    });

    test("Cancel đóng hộp thoại, mở lại form được reset", async ({ page }) => {
      const { avail, groups } = await openAdd(page);
      test.skip(!avail.length || !groups.length, "Thiếu game trống hoặc group");
      await pickOne(page, "gameId", avail[0]);
      await pickGroups(page, [groups[0].label]);
      await closeModal(page);
      await openAdd(page);
      await expect(modal(page).locator(".ant-select-selection-item")).toHaveCount(0);
      await expect(fieldErrors(page)).toHaveCount(0);
      await closeModal(page);
    });

    test("Đóng hộp thoại bằng nút X", async ({ page }) => {
      await openAdd(page);
      await modal(page).locator(".ant-modal-close").click();
      await expect(modal(page)).toHaveCount(0);
    });
  });

  // ===== 8. Hộp thoại Update (không bấm Submit khi hợp lệ) =====
  test.describe("Hộp thoại Update (không bấm Submit khi hợp lệ)", () => {
    test("Icon Update gọi game-recommendation/view đúng id, tiêu đề 'Edit Game <tên>'", async ({ page }) => {
      needData();
      const r0 = list()[0];
      const { data, body } = await openEdit(page, rowAt(page, 0));
      expect(body).toEqual({ id: r0.id });
      expect(data.id).toBe(r0.id);
      await expect(modalTitle(page)).toHaveText(`Edit Game ${r0.gameName}`);
      await closeModal(page);
    });

    test("Điền sẵn đúng game, group, priority game của bản ghi; ô Game Name bị khoá", async ({ page }) => {
      needData();
      const r0 = list()[0];
      await openEdit(page, rowAt(page, 0));
      await expect.poll(() => selectedOf(page, "gameId")).toEqual([optionText({ code: r0.gameCode, label: r0.gameName })]);
      await expect(field(page, "gameId").locator(".ant-select")).toHaveClass(/ant-select-disabled/);
      await expect.poll(() => selectedOf(page, "recommendationGroupIds")).toEqual(r0.groups.map((g) => g.name));
      await expect.poll(() => selectedOf(page, "priorityGameId1")).toEqual(r0.priorityGames.slice(0, 1).map((p) => optionText(p)));
      await expect.poll(() => selectedOf(page, "priorityGameId2")).toEqual(r0.priorityGames.slice(1, 2).map((p) => optionText(p)));
      await closeModal(page);
    });

    test("Mở Update của nhiều dòng: mỗi lần hiện đúng dữ liệu của dòng đó", async ({ page }) => {
      test.skip(list().length < 2, "Cần ít nhất 2 bản ghi");
      for (const i of [0, 1]) {
        const r = list()[i];
        await openEdit(page, rowAt(page, i));
        await expect(modalTitle(page)).toHaveText(`Edit Game ${r.gameName}`);
        await expect.poll(() => selectedOf(page, "recommendationGroupIds")).toEqual(r.groups.map((g) => g.name));
        await closeModal(page);
      }
    });

    test("Bỏ hết group rồi Submit: báo lỗi group, form bị chặn", async ({ page }) => {
      const i = list().findIndex((r) => r.groups.length > 0);
      test.skip(i < 0, "Không có bản ghi nào có group");
      const r = list()[i];
      await openEdit(page, rowAt(page, i));
      await expect.poll(() => selectedOf(page, "recommendationGroupIds")).toEqual(r.groups.map((g) => g.name));
      for (const g of r.groups) await removeGroupChip(page, g.name);
      await expect.poll(() => selectedOf(page, "recommendationGroupIds")).toEqual([]);
      await submitBtn(page).click();
      await expect(fieldErrors(page)).toHaveText([MSG.groups]);
      await expect(modal(page)).toBeVisible();
      await closeModal(page);
    });

    test("Priority Game không cho chọn lại chính game của bản ghi / game đã chọn ở ô còn lại", async ({ page }) => {
      const i = list().findIndex((r) => r.priorityGames.length > 0);
      test.skip(i < 0, "Không có bản ghi nào có Priority Game");
      const r = list()[i];
      await openEdit(page, rowAt(page, i));
      const self = { code: r.gameCode, label: r.gameName };
      await modal(page).locator("#priorityGameId2").click({ force: true });
      await modal(page).locator("#priorityGameId2").fill(self.code);
      await expect(openOptions(page).filter({ hasText: exact(optionText(self)) })).toHaveCount(0);
      // game đang là Priority Game 1 cũng không còn ở ô 2
      const p1 = r.priorityGames[0];
      await modal(page).locator("#priorityGameId2").fill(p1.code);
      await expect(openOptions(page).filter({ hasText: exact(optionText(p1)) })).toHaveCount(0);
      await closeDropdown(page);
      await closeModal(page);
    });

    test("Sửa group + priority rồi Cancel: danh sách không đổi, mở lại vẫn thấy dữ liệu gốc", async ({ page }) => {
      const i = list().findIndex((r) => r.groups.length > 0);
      test.skip(i < 0, "Không có bản ghi nào có group");
      const r = list()[i];
      const before = await rows(page).allInnerTexts();
      await openEdit(page, rowAt(page, i));
      await removeGroupChip(page, r.groups[0].name);
      await closeModal(page);
      expect(await rows(page).allInnerTexts()).toEqual(before);
      await openEdit(page, rowAt(page, i));
      await expect.poll(() => selectedOf(page, "recommendationGroupIds")).toEqual(r.groups.map((g) => g.name));
      await closeModal(page);
    });

    test("Đóng hộp thoại Update bằng nút X", async ({ page }) => {
      needData();
      await openEdit(page, rowAt(page, 0));
      await modal(page).locator(".ant-modal-close").click();
      await expect(modal(page)).toHaveCount(0);
    });
  });

  // ===== 9. Hộp thoại Delete (không bấm nút Delete xác nhận) =====
  test.describe("Hộp thoại Delete (không bấm nút Delete xác nhận)", () => {
    test("Icon Delete hiện hộp thoại xác nhận đúng tên game, có Cancel / Delete", async ({ page }) => {
      needData();
      const r0 = list()[0];
      await deleteIcon(rowAt(page, 0)).click();
      await expect(modal(page)).toContainText(`Are you sure you want to delete the recommendation for ${r0.gameName}?`);
      await expect(modal(page)).toContainText("Delete");
      await expect(cancelBtn(page)).toBeVisible();
      await expect(modal(page).getByRole("button", { name: "Delete", exact: true })).toBeVisible();
      await closeModal(page);
    });

    test("Mỗi dòng mở hộp thoại Delete với đúng tên game của dòng đó", async ({ page }) => {
      const n = Math.min(3, list().length);
      test.skip(n === 0, "Không có bản ghi nào");
      for (let i = 0; i < n; i++) {
        await deleteIcon(rowAt(page, i)).click();
        await expect(modal(page)).toContainText(`delete the recommendation for ${list()[i].gameName}?`);
        await closeModal(page);
      }
    });

    test("Cancel đóng hộp thoại và danh sách không thay đổi", async ({ page }) => {
      needData();
      const before = await rows(page).allInnerTexts();
      await deleteIcon(rowAt(page, 0)).click();
      await closeModal(page);
      expect(await rows(page).allInnerTexts()).toEqual(before);
      await expect(summary(page)).toContainText(`of ${total()} records`);
    });
  });

  // ===== 10. Manage Columns =====
  test.describe("Manage Columns", () => {
    const popover = (page) => page.locator(".NextGen-popover-manage-column");
    const item = (page, name) => popover(page).locator(".NextGen-popover-manage-column__list__items").filter({ hasText: exact(name) });
    const openPopover = (page) => page.locator("button.NextGen-popover-manage-column__buton").click();

    test("Popover liệt kê đủ cột", async ({ page }) => {
      await openPopover(page);
      const names = await popover(page).locator(".NextGen-popover-manage-column__list__items").allInnerTexts();
      expect(names.map((n) => n.trim())).toEqual(COLUMNS);
    });

    test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
      await openPopover(page);
      await item(page, "Priority Game").locator("label").click();
      await expect.poll(() => headers(page)).toEqual(COLUMNS.filter((c) => c !== "Priority Game"));
      await item(page, "Priority Game").locator("label").click();
      await expect.poll(() => headers(page)).toEqual(COLUMNS);
    });

    test("Dữ liệu các cột còn lại vẫn đúng khi ẩn bớt cột", async ({ page }) => {
      needData();
      const names = await columnValues(page, "Game Name");
      const groups = await columnValues(page, "Group Name");
      await openPopover(page);
      await item(page, "Priority Game").locator("label").click();
      await expect.poll(() => headers(page)).not.toContain("Priority Game");
      expect(await columnValues(page, "Game Name")).toEqual(names);
      expect(await columnValues(page, "Group Name")).toEqual(groups);
    });

    test("Cấu hình cột không được lưu: tải lại trang thì hiện đủ cột", async ({ page }) => {
      await openPopover(page);
      await item(page, "Priority Game").locator("label").click();
      await expect.poll(() => headers(page)).not.toContain("Priority Game");
      await page.reload();
      await settle(page);
      await expect.poll(() => headers(page)).toEqual(COLUMNS);
    });
  });

  // ===== 11. Ghi nhớ filter / page size =====
  test.describe("Ghi nhớ sau khi reload", () => {
    test("Filter và số dòng/trang được giữ lại", async ({ page }) => {
      needData();
      const r0 = list()[0];
      await pickFilterGame(page, { code: r0.gameCode, label: r0.gameName });
      await search(page);
      await pageSizeSelect(page).click();
      await reloadBy(page, () => openOptions(page).filter({ hasText: exact("20 / page") }).click());

      const [req] = await Promise.all([page.waitForRequest(isList), page.reload()]);
      expect(bodyOf(req)).toMatchObject({ pageSize: 20, filters: { gameName: r0.gameName } });
      await settle(page);
      expect(await pickedFilterGame(page)).toEqual([optionText({ code: r0.gameCode, label: r0.gameName })]);
      await expect(pageSizeSelect(page).locator(".ant-select-selection-item")).toHaveText("20 / page");
    });

    test("Reset xoá filter đã nhớ: reload lại không còn filter", async ({ page }) => {
      needData();
      const r0 = list()[0];
      await pickFilterGame(page, { code: r0.gameCode, label: r0.gameName });
      await search(page);
      await reloadBy(page, () => resetBtn(page).click());
      const [req] = await Promise.all([page.waitForRequest(isList), page.reload()]);
      expect(bodyOf(req).filters).toEqual({});
      await settle(page);
      await expect(filterEl(page, "gameName").locator(".ant-select-selection-item")).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests CRUD - GHI dữ liệu thật trên bản ghi do chính test tạo ra (chạy tuần tự, dọn lại bằng UI)
// ---------------------------------------------------------------------------
test.describe("Game Recommendation > Game Recommendation (CRUD - ghi dữ liệu thật)", () => {
  test.describe.configure({ mode: "serial" });

  let writes;
  let gamesLoaded;
  let tracked; // bản ghi test đã tạo mà chưa xoá: { gameId, label }
  const games = async () => (await (await gamesLoaded).json()).data;

  test.beforeEach(async ({ page }) => {
    tracked = [];
    await clearSavedState(page);
    writes = await guardWrites(page, { block: false });
    gamesLoaded = page.waitForResponse(isGameDropdown, { timeout: 60000 });
    gamesLoaded.catch(() => {});
    await openPage(page);
  });

  // Dọn rác: xoá bằng UI mọi bản ghi test đã tạo mà chưa xoá (test fail giữa chừng vẫn dọn được)
  test.afterEach(async ({ page }) => {
    if (!tracked.length) return;
    await openPage(page); // tải lại trang (đóng luôn hộp thoại đang mở nếu test fail giữa chừng)
    for (const rec of tracked) {
      const row = rowOf(page, rec.label);
      if ((await row.count()) !== 1) continue; // đã bị xoá
      await deleteIcon(row).click();
      await writeCall(page, "/game-recommendation/delete", () => modal(page).getByRole("button", { name: "Delete", exact: true }).click());
      await expect(rowOf(page, rec.label)).toHaveCount(0);
    }
    tracked = [];
  });

  // Tạo 1 bản ghi bằng UI cho game trống cuối cùng của available-games
  // -> { game, groups (đã chọn), priority (đã chọn), create: { body, status, json }, id }
  async function createRecord(page, { groupCount = 2, withPriority = true } = {}) {
    const { avail, groups } = await openAdd(page);
    test.skip(avail.length === 0, "Mọi game đều đã có đề xuất");
    test.skip(groups.length < groupCount, `Cần ít nhất ${groupCount} group`);
    const game = avail[avail.length - 1];
    const chosenGroups = groups.slice(0, groupCount);
    const priority = (await games()).find((g) => g.value !== game.value);

    await pickOne(page, "gameId", game);
    await pickGroups(page, chosenGroups.map((g) => g.label));
    if (withPriority) await pickOne(page, "priorityGameId1", priority);

    const create = await writeCall(page, "/game-recommendation/create", () => submitBtn(page).click());
    tracked.push({ gameId: game.value, label: game.label, id: create.json?.data?.id });
    return { game, groups: chosenGroups, priority: withPriority ? priority : null, create, id: create.json?.data?.id };
  }

  test("Tạo mới đủ thông tin: gửi đúng request, toast Success, bản ghi hiện ở đầu danh sách", async ({ page }) => {
    const before = Number((await summary(page).innerText()).match(/of ([\d,]+) records/)[1].replace(/,/g, ""));
    const rec = await createRecord(page);
    expect(rec.create.status).toBe(200);
    expect(rec.create.body).toEqual({
      gameId: rec.game.value,
      recommendationGroupIds: rec.groups.map((g) => g.value),
      priorityGameIds: [rec.priority.value],
    });
    expect(rec.create.json).toMatchObject({ status: "success", message: MSG.created });
    expect(rec.id).toBeGreaterThan(0);
    await expect(toast(page, MSG.created)).toBeVisible();
    await expect(modal(page)).toHaveCount(0);

    // Danh sách tải lại: bản ghi mới (id lớn nhất) nằm ở dòng đầu, đúng dữ liệu
    await expect(rowOf(page, rec.game.label)).toHaveCount(1);
    await expect(summary(page)).toContainText(`of ${before + 1} records`);
    expect(norm(await cellAt(page, 0, COL.game).innerText())).toBe(rec.game.label);
    expect((await chipInfo(page, 0, COL.groups)).names).toEqual(rec.groups.slice(0, MAX_GROUP_CHIPS).map((g) => g.label));
    expect((await chipInfo(page, 0, COL.priority)).names).toEqual([rec.priority.label]);

    // Game vừa tạo không còn trong available-games
    const { avail } = await openAdd(page);
    expect(avail.map((g) => g.value)).not.toContain(rec.game.value);
    await closeModal(page);
    expect(writes).toEqual(["/sas-web/net/api/v1/game-recommendation/create"]);
  });

  test("Tạo mới chỉ có Game + Group (Priority Game để trống): thành công, cột Priority Game rỗng", async ({ page }) => {
    const rec = await createRecord(page, { groupCount: 1, withPriority: false });
    expect(rec.create.status).toBe(200);
    expect(rec.create.json).toMatchObject({ status: "success", message: MSG.created });
    expect(rec.create.body.gameId).toBe(rec.game.value);
    expect(rec.create.body.recommendationGroupIds).toEqual([rec.groups[0].value]);
    expect(rec.create.body.priorityGameIds ?? []).toEqual([]);
    await expect(toast(page, MSG.created)).toBeVisible();
    await expect(rowOf(page, rec.game.label)).toHaveCount(1);
    expect((await chipInfo(page, 0, COL.priority)).names).toEqual([]);
  });

  test("Sửa: bỏ bớt group, thêm Priority Game 2 -> request update đúng, toast Success, dòng cập nhật", async ({ page }) => {
    const rec = await createRecord(page, { groupCount: 2 });
    const second = (await games()).find((g) => g.value !== rec.game.value && g.value !== rec.priority.value);
    test.skip(!second, "Không đủ game để chọn Priority Game 2");

    const { data, body } = await openEdit(page, rowOf(page, rec.game.label));
    expect(body).toEqual({ id: rec.id });
    expect(data.gameId).toBe(rec.game.value);
    await expect(field(page, "gameId").locator(".ant-select")).toHaveClass(/ant-select-disabled/);
    await expect.poll(() => selectedOf(page, "recommendationGroupIds")).toEqual(rec.groups.map((g) => g.label));

    await removeGroupChip(page, rec.groups[1].label);
    await pickOne(page, "priorityGameId2", second);
    await expect.poll(() => selectedOf(page, "recommendationGroupIds")).toEqual([rec.groups[0].label]);
    const upd = await writeCall(page, "/game-recommendation/update", () => submitBtn(page).click());
    expect(upd.status).toBe(200);
    expect(upd.body).toEqual({
      id: rec.id,
      recommendationGroupIds: [rec.groups[0].value],
      priorityGameIds: [rec.priority.value, second.value],
    });
    expect(upd.json).toMatchObject({ status: "success", message: MSG.updated });
    await expect(toast(page, MSG.updated)).toBeVisible();
    await expect(modal(page)).toHaveCount(0);

    const row = rowOf(page, rec.game.label);
    await expect(row).toHaveCount(1);
    await expect.poll(async () => (await chipInfo(page, 0, COL.groups)).names).toEqual([rec.groups[0].label]);
    await expect.poll(async () => (await chipInfo(page, 0, COL.priority)).names).toEqual([rec.priority.label, second.label]);
    expect(writes).toEqual([
      "/sas-web/net/api/v1/game-recommendation/create",
      "/sas-web/net/api/v1/game-recommendation/update",
    ]);
  });

  test("Sửa: xoá Priority Game đã chọn -> bản ghi không còn Priority Game", async ({ page }) => {
    const rec = await createRecord(page, { groupCount: 1 });
    await openEdit(page, rowOf(page, rec.game.label));
    await expect.poll(() => selectedOf(page, "priorityGameId1")).toEqual([optionText(rec.priority)]);
    await clearSelect(page, "priorityGameId1");
    await expect.poll(() => selectedOf(page, "priorityGameId1")).toEqual([]);
    const upd = await writeCall(page, "/game-recommendation/update", () => submitBtn(page).click());
    expect(upd.status).toBe(200);
    expect(upd.json).toMatchObject({ status: "success", message: MSG.updated });
    expect(upd.body.id).toBe(rec.id);
    expect(upd.body.priorityGameIds ?? []).toEqual([]);
    await expect(toast(page, MSG.updated)).toBeVisible();
    await expect.poll(async () => (await chipInfo(page, 0, COL.priority)).names).toEqual([]);
  });

  test("Xoá: Cancel không xoá; Delete xoá -> request delete đúng id, toast Success, dòng biến mất", async ({ page }) => {
    const countBefore = Number((await summary(page).innerText()).match(/of ([\d,]+) records/)[1].replace(/,/g, ""));
    const rec = await createRecord(page, { groupCount: 1 });

    // Cancel: không gửi request xoá
    await deleteIcon(rowOf(page, rec.game.label)).click();
    await expect(modal(page)).toContainText(`Are you sure you want to delete the recommendation for ${rec.game.label}?`);
    await closeModal(page);
    await expect(rowOf(page, rec.game.label)).toHaveCount(1);
    expect(writes.filter((w) => w.endsWith("/delete"))).toEqual([]);

    // Delete thật
    await deleteIcon(rowOf(page, rec.game.label)).click();
    const del = await writeCall(page, "/game-recommendation/delete", () => modal(page).getByRole("button", { name: "Delete", exact: true }).click());
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ id: rec.id });
    expect(del.json).toMatchObject({ status: "success", message: MSG.deleted });
    tracked = []; // đã xoá xong, không cần dọn
    await expect(toast(page, MSG.deleted)).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    await expect(rowOf(page, rec.game.label)).toHaveCount(0);
    await expect(summary(page)).toContainText(`of ${countBefore} records`);

    // Game được trả về available-games
    const { avail } = await openAdd(page);
    expect(avail.map((g) => g.value)).toContain(rec.game.value);
    await closeModal(page);
  });
});
