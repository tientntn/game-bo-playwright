// Game Recommendation > Settings  (https://dev-bo.royaledge.io/game-recommendation/setting)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/game_recommendation_setting.spec.js --project=setup --project=chromium
//
// Màn hình "Settings - Agent": cấu hình THEO AGENT cho 2 tính năng Recommended Games và Event Announcement.
// Mặc định mọi agent đều BẬT cả 2 ("Default: Recommended Games - Enabled ; Event Announcement - Enabled") nên bảng CHỈ liệt kê agent
// có cấu hình tuỳ biến (ít nhất 1 công tắc đang tắt).
//  - Filter: Master Agent (chọn 1, API key "masterAgentIds" = [id]) và Agent (chọn 1, API key "agentIds" = [id]);
//    danh sách Agent của filter phụ thuộc Master Agent đang chọn (report/agent_dropdown {masterAgentIds:[id]});
//    đổi Master Agent sau khi đã chọn Agent thì Agent bị xoá khỏi ô filter.
//  - Chỉ 2 cột Master Agent (sortBy "masterAgentName") và Agent (sortBy "agentName") sort được (asc -> desc -> về mặc định id desc).
//  - Cột Recommended Games / Event Announcement là công tắc: bật / tắt gọi NGAY game-recommendation/setting/update
//    {agentId, recommendedGamesStatus | eventAnnouncementStatus}; khi cả 2 cùng bật (= mặc định) bản ghi tự bị gỡ khỏi danh sách
//    (response data.isRevertedToDefault = true, toast "... updated to Default and removed from the list.").
//  - Add New (hộp thoại "Add Agent"): Master Agent -> Agent (bắt buộc cả 2, Agent bị khoá tới khi chọn Master Agent),
//    Save gọi game-recommendation/setting/add {agentId}; agent mới được thêm với CẢ 2 công tắc TẮT. Thêm trùng -> lỗi ALREADY_EXIST.
//  - Không có Export, checkbox chọn dòng, cột Action / Delete (cách "xoá" bản ghi duy nhất = bật lại cả 2 công tắc).
//
// AN TOÀN DỮ LIỆU:
//  - Nhóm "chỉ đọc" (mọi describe trừ cuối): KHÔNG ghi dữ liệu thật. Mọi request ghi (setting/add, setting/update) bị chặn ở tầng mạng
//    (route.abort); test kiểm tra payload của Save / công tắc dùng route.fulfill trả về kết quả GIẢ (request KHÔNG tới server). Test khai báo rõ
//    request ghi được phép (allowedWrites) và afterEach so sánh chính xác với danh sách request ghi bắt được (watchWrites).
//    Bản ghi có sẵn của team (vd dòng "ZZ Audit Agent Upd") chỉ bị thao tác bằng request GIẢ, không bao giờ bị ghi thật.
//  - Nhóm "CRUD (ghi dữ liệu thật)" (describe cuối, chạy tuần tự): màn hình không cho tạo agent nên KHÔNG gắn được tiền tố QA-AUTO;
//    test dùng 1 agent QA do các lần chạy QA trước tạo sẵn (code "QATESTAG<timestamp>", label "QA Test Agent <timestamp>") và CHƯA có
//    cấu hình trong bảng. Test thêm cấu hình cho agent đó, bật / tắt công tắc, rồi GỠ cấu hình bằng cách bật lại cả 2 công tắc
//    (tự gỡ khỏi bảng). afterAll luôn dọn lại (nếu bản ghi còn sót thì bật cả 2 công tắc). afterEach kiểm tra mọi request ghi đều
//    chỉ nhắm vào agentId của agent QA này - KHÔNG bao giờ sửa dòng có sẵn của team. Nếu không có agent QA trống thì test tự skip.
//  - Không hard-code dữ liệu: master agent / agent / dòng đều lấy từ response list và dropdown.
//  - Chưa kiểm chứng được bằng UI thật: nội dung toast khi server lỗi lúc bật / tắt công tắc (chỉ kiểm tra toast "Error" bằng response giả).
const { test, expect } = require("@playwright/test");
const { randomUUID } = require("crypto");
const { buildStorageState } = require("./helpers/session");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/game-recommendation/setting";
const ORIGIN = "https://dev-bo.royaledge.io";

// Đúng thứ tự hiển thị (không có cột checkbox / Action)
const COLUMNS = ["Master Agent", "Agent", "Recommended Games", "Event Announcement"];
const COL = { master: 0, agent: 1, rec: 2, event: 3 };
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
const DEFAULT_BODY = { page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: {} };
const SORTABLE = { "Master Agent": "masterAgentName", Agent: "agentName" };

// Thông báo của form / toast (đọc từ màn hình thật)
const MSG = {
  master: "Please select master agent",
  agent: "Please select agent",
  added: "Agent game recommendation setting successfully added",
  exists: "Agent already has a customized game recommendation setting",
  noEntries: "There are no entries found",
  note: "Note: New agent will be added with all settings turned off",
  intro: "All agents with default settings will not be shown here. Only agents with customised settings will be shown in the table.",
  defaults: "Default: Recommended Games - Enabled ; Event Announcement - Enabled",
};
const updatedMsg = (agentName) => `${agentName} recommendation settings updated successfully.`;
const revertedMsg = (agentName) => `${agentName} recommendation settings updated to Default and removed from the list.`;

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI
// (dropdown của màn hình này là report/master_agent_dropdown và report/agent_dropdown)
const READ = /\/(list|details|download|view)(\?|$)|\/dropdown\/|_dropdown(\?|$)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/game-recommendation/setting/list");
const isAdd = endsWith("/game-recommendation/setting/add");
const isUpdate = endsWith("/game-recommendation/setting/update");
const isMasterDropdown = endsWith("/report/master_agent_dropdown");
const isAgentDropdown = endsWith("/report/agent_dropdown");

const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};

// Bảng chính (luôn là .ant-table đầu tiên trong DOM)
const table = (page) => page.locator(".ant-table").first();
const rows = (page) => table(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
const th = (page, name) => table(page).locator("thead th").filter({ hasText: exact(name) });
// Dòng theo đúng tên Agent (khớp chính xác ô Agent)
const rowOfAgent = (page, agentName) =>
  rows(page).filter({ has: page.locator("td:nth-child(2)").filter({ hasText: exact(agentName) }) });
const switchOf = (row, col) => row.locator("td").nth(col).getByRole("switch");

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const addBtn = (page) => page.getByRole("button", { name: /Add New/ });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const pageSizeSelect = (page) => page.locator(".ant-pagination-options .ant-select");
const toasts = (page) => page.locator(".Toastify__toast");
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
const filterEl = (page, id) => page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });

// Hộp thoại "Add Agent". Lưu ý: id #masterAgentId / #agentId của hộp thoại TRÙNG với id của 2 filter phía sau
// (label for=... sẽ focus nhầm filter) -> thao tác bằng .ant-select trong hộp thoại, KHÔNG click label.
const dialog = (page) => page.getByRole("dialog");
const dialogTitle = (page) => dialog(page).locator("[id^=':r']").first();
const modalSelect = (page, i) => dialog(page).locator(".ant-select").nth(i); // 0 = Master Agent, 1 = Agent
const modalErrors = (page) => dialog(page).locator(".ant-form-item-explain-error");
const saveBtn = (page) => dialog(page).getByRole("button", { name: "Save" });
const cancelBtn = (page) => dialog(page).getByRole("button", { name: /Cancel$/ });

// Text option của master agent / agent: "code - tên"
const optionText = (x) => `${x.code} - ${x.label}`;

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
}

// Khi filter vừa đổi, Search đôi khi gửi 2 request list GIỐNG HỆT nhau cách nhau ~200ms: chờ mạng yên sau mỗi lần gọi
// để request thừa không bị nhầm là request của thao tác kế tiếp.
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

// Bấm Reset và gom MỌI request list gửi đi cho tới khi mạng yên; trả về danh sách body (request cuối = trạng thái bảng cuối cùng).
// Lưu ý: Reset CHỈ gọi lại API khi filter đang áp dụng khác mặc định (Reset khi bảng đang ở mặc định thì không gửi request nào).
async function resetBodies(page) {
  const bodies = [];
  const onRequest = (r) => {
    if (isList(r)) bodies.push(bodyOf(r));
  };
  page.on("request", onRequest);
  try {
    const first = page.waitForRequest(isList);
    await resetBtn(page).click();
    await first;
    await settle(page);
  } finally {
    page.off("request", onRequest);
  }
  return bodies;
}

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

// Chọn 1 giá trị ở filter (dropdown chọn 1, tự đóng sau khi chọn). Gõ code vào ô tìm kiếm để option chắc chắn có trong danh sách.
async function selectFilter(page, id, item) {
  await openDropdown(page, id);
  await page.keyboard.type(item.code);
  await openOptions(page).filter({ hasText: exact(optionText(item)) }).first().click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Giá trị đang được chọn của 1 filter (title = "code - tên")
const selectedFilter = (page, id) =>
  filterEl(page, id)
    .locator(".ant-select-selection-item[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));

// Chọn giá trị ở ô select của hộp thoại Add Agent (i: 0 = Master Agent, 1 = Agent)
async function pickInModal(page, i, item) {
  await expect(modalSelect(page, i)).not.toHaveClass(/ant-select-disabled/);
  await modalSelect(page, i).click();
  await page.keyboard.type(item.code);
  await openOptions(page).filter({ hasText: exact(optionText(item)) }).first().click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Chọn Master Agent trong hộp thoại, trả về danh sách agent mà report/agent_dropdown trả về cho master đó
async function pickMasterInModal(page, master) {
  // Bỏ qua response của request lúc mở hộp thoại (masterAgentIds rỗng) - chỉ nhận response theo master đã chọn
  const byMaster = (r) => isAgentDropdown(r) && JSON.parse(reqOf(r).postData() || "{}").masterAgentIds?.length > 0;
  const [res] = await Promise.all([page.waitForResponse(byMaster), pickInModal(page, 0, master)]);
  return (await res.json()).data;
}

// Mở hộp thoại Add Agent
async function openAddDialog(page) {
  await addBtn(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialogTitle(page)).toHaveText("Add Agent");
  // Chờ hết hiệu ứng mở (click lớp phủ / Esc khi đang chạy hiệu ứng sẽ không đóng được hộp thoại)
  await expect(dialog(page)).not.toHaveClass(/ant-zoom-appear/);
}

// Đóng hộp thoại bằng Cancel
async function closeDialog(page) {
  await cancelBtn(page).click();
  await expect(dialog(page)).toBeHidden();
}

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

// Dùng cho test kiểm tra payload / thông báo: request ghi vẫn KHÔNG tới server, được trả về response GIẢ
// (route đăng ký sau được ưu tiên hơn route chặn ở beforeEach)
async function mockWrites(page, response) {
  await page.route(/boapi/, (route) => {
    const r = route.request();
    if (r.method() === "POST" && !READ.test(r.url())) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": ORIGIN, "access-control-allow-credentials": "true" },
        body: JSON.stringify(response),
      });
    }
    return route.continue();
  });
}

const MOCK_FAIL = { status: "fail", messageCode: "QA_MOCK_ERROR", message: "QA mock error", data: null };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Game Recommendation > Settings", () => {
  let writes;
  let allowedWrites; // request ghi được phép (chỉ các test dùng response giả; request KHÔNG tới server thật)
  let mastersLoaded; // promise của response report/master_agent_dropdown lúc mở trang
  let agentsLoaded; // promise của response report/agent_dropdown đầu tiên (chưa lọc theo master)
  let agentReq; // url + headers của request agent_dropdown (để gọi lại API đọc cho từng master agent)
  // Danh sách { value, code, label } mà dropdown trả về
  const masters = async () => (await (await mastersLoaded).json()).data;
  const agents = async () => (await (await agentsLoaded).json()).data;

  // Tìm 1 agent QA (code "QATESTAG...") CHƯA có cấu hình trong bảng, cùng master agent của nó (chỉ gọi API đọc).
  async function findQaTarget(page, listedCodes) {
    const ms = await masters();
    const headers = { ...agentReq.headers };
    delete headers["content-length"];
    const found = await Promise.all(
      ms.map(async (m) => {
        const res = await page.request.post(agentReq.url, {
          headers,
          data: { masterAgentIds: [m.value], traceId: randomUUID() },
        });
        const json = await res.json().catch(() => null);
        return { master: m, agents: json?.data ?? [] };
      }),
    );
    for (const r of found) {
      const free = r.agents.filter((a) => /^QATESTAG/i.test(a.code) && !listedCodes.includes(a.code));
      if (free.length) return { master: r.master, agent: free[free.length - 1] };
    }
    return null;
  }

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, số dòng/trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__game_recommendation_setting_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/game-recommendation_setting_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__game_recommendation_setting_spec_cleared", "1");
    });
    writes = watchWrites(page);
    allowedWrites = [];
    agentReq = null;
    page.on("request", (r) => {
      if (!agentReq && r.method() === "POST" && isAgentDropdown(r)) agentReq = { url: r.url(), headers: r.headers() };
    });
    mastersLoaded = page.waitForResponse(isMasterDropdown, { timeout: 60000 });
    agentsLoaded = page.waitForResponse(isAgentDropdown, { timeout: 60000 });
    mastersLoaded.catch(() => {});
    agentsLoaded.catch(() => {});
  });

  // ===== NHÓM CHỈ ĐỌC (không ghi dữ liệu thật) =====
  test.describe("Chỉ đọc (không ghi dữ liệu thật)", () => {
    test.beforeEach(async ({ page }) => {
      await blockWrites(page);
      await openPage(page);
    });

    // Mọi test không được gửi request ghi nào ngoài danh sách được phép (và request được phép cũng không tới server thật)
    test.afterEach(async () => {
      expect(writes, "Request ghi dữ liệu bắt được phải đúng danh sách được phép").toEqual(allowedWrites);
    });

    // ===== 1. Hiển thị màn hình =====
    test.describe("Hiển thị mặc định", () => {
      test("Có tiêu đề 'Settings - Agent' và 2 dòng mô tả mặc định", async ({ page }) => {
        await expect(breadcrumb(page)).toHaveText("Settings - Agent");
        await expect(page.getByText(MSG.intro)).toBeVisible();
        await expect(page.getByText(MSG.defaults)).toBeVisible();
      });

      test("Có đủ filter Master Agent, Agent và 2 nút Search/Reset", async ({ page }) => {
        await expect(page.locator(".NextGen-filter-element")).toHaveCount(2);
        await expect(filterEl(page, "masterAgentId")).toContainText("Master Agent");
        await expect(filterEl(page, "agentId")).toContainText("Agent");
        await expect(searchBtn(page)).toBeVisible();
        await expect(resetBtn(page)).toBeVisible();
      });

      test("Giá trị filter mặc định: để trống", async ({ page }) => {
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
      });

      test("Master Agent và Agent là dropdown chọn 1 giá trị, có tìm kiếm và nút xoá (x)", async ({ page }) => {
        for (const id of ["masterAgentId", "agentId"]) {
          await expect(filterEl(page, id).locator(".ant-select-single"), id).toHaveCount(1);
          await expect(filterEl(page, id).locator(".ant-select-multiple"), id).toHaveCount(0);
          await expect(filterEl(page, id).locator(".ant-select-show-search"), id).toHaveCount(1);
          await expect(filterEl(page, id).locator(".ant-select-allow-clear"), id).toHaveCount(1);
        }
      });

      test("Có Add New + Manage Columns; không có Export, checkbox chọn dòng / thao tác hàng loạt", async ({ page }) => {
        await expect(addBtn(page)).toBeVisible();
        await expect(columnBtn(page)).toBeVisible();
        await expect(page.locator("button.NextGen-export-button")).toHaveCount(0);
        await expect(page.locator("button.NextGen-button-more-action__update")).toHaveCount(0);
        await expect(page.locator('.ant-table input[type="checkbox"]')).toHaveCount(0);
      });

      test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự`, async ({ page }) => {
        expect(await headers(page)).toEqual(COLUMNS);
      });

      test("Mặc định: trang 1, 10 dòng, sort id giảm dần, không gửi filter", async ({ page }) => {
        const { body, status, json } = await search(page);
        expect(status).toBe(200);
        expect(body).toEqual(DEFAULT_BODY);
        expect(json.status).toBe("success");
        expect(json.data.list.length).toBeLessThanOrEqual(10);
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
      test("Mỗi dòng khớp response API (Master Agent, Agent, trạng thái 2 công tắc)", async ({ page }) => {
        const { json } = await search(page);
        const list = json.data.list;
        test.skip(list.length === 0, "Không có dữ liệu");
        await expect(rows(page)).toHaveCount(list.length);
        for (const [i, x] of list.entries()) {
          const at = `dòng ${i + 1} (agent ${x.agentId})`;
          expect(norm(await cellAt(page, i, COL.master).innerText()), at).toBe(norm(x.masterAgentName));
          expect(norm(await cellAt(page, i, COL.agent).innerText()), at).toBe(norm(x.agentName));
          await expect(switchOf(rowAt(page, i), COL.rec), at).toHaveAttribute("aria-checked", String(x.recommendedGamesStatus));
          await expect(switchOf(rowAt(page, i), COL.event), at).toHaveAttribute("aria-checked", String(x.eventAnnouncementStatus));
        }
      });

      test("Mỗi dòng có đúng 2 công tắc (Recommended Games, Event Announcement)", async ({ page }) => {
        const n = await rows(page).count();
        test.skip(n === 0, "Không có dữ liệu");
        for (let i = 0; i < n; i++) {
          await expect(rowAt(page, i).getByRole("switch")).toHaveCount(2);
          await expect(switchOf(rowAt(page, i), COL.rec)).toBeVisible();
          await expect(switchOf(rowAt(page, i), COL.event)).toBeVisible();
        }
      });

      test("Bảng chỉ liệt kê agent có cấu hình tuỳ biến: không dòng nào bật cả 2 công tắc (= mặc định)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        for (const x of json.data.list) {
          expect(
            x.recommendedGamesStatus && x.eventAnnouncementStatus,
            `agent ${x.agentId} (${x.agentName}) đang ở cấu hình mặc định nhưng vẫn nằm trong danh sách`,
          ).toBe(false);
        }
      });

      test("Mỗi agent chỉ có 1 dòng (agentId không trùng) và mã / tên không để trống", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const ids = json.data.list.map((x) => x.agentId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const x of json.data.list) {
          expect(x.masterAgentName, `master của agent ${x.agentId}`).toBeTruthy();
          expect(x.agentName, `tên agent ${x.agentId}`).toBeTruthy();
          expect(x.masterAgentCode).toBeTruthy();
          expect(x.agentCode).toBeTruthy();
        }
      });

      test("Master Agent và Agent của từng dòng là dữ liệu có thật trong dropdown (đúng code / tên)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const ms = new Map((await masters()).map((m) => [m.value, m]));
        const as = new Map((await agents()).map((a) => [a.value, a]));
        for (const x of json.data.list) {
          const m = ms.get(x.masterAgentId);
          expect(m, `master ${x.masterAgentId} không có trong master_agent_dropdown`).toBeTruthy();
          expect(m.code).toBe(x.masterAgentCode);
          expect(norm(m.label)).toBe(norm(x.masterAgentName));
          const a = as.get(x.agentId);
          expect(a, `agent ${x.agentId} (${x.agentName}) không có trong agent_dropdown`).toBeTruthy();
          expect(a.code).toBe(x.agentCode);
          expect(norm(a.label)).toBe(norm(x.agentName));
        }
      });

      test("Agent của dòng thuộc đúng Master Agent của dòng đó (agent_dropdown theo master có chứa agent)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await addBtn(page).click();
        await expect(dialog(page)).toBeVisible();
        const data = await pickMasterInModal(page, { code: x.masterAgentCode, label: x.masterAgentName });
        expect(data.map((a) => a.value), `agent ${x.agentId} không thuộc master ${x.masterAgentName}`).toContain(x.agentId);
        await closeDialog(page);
      });
    });

    // ===== 3. Search / Filter =====
    test.describe("Search / Filter", () => {
      test("Dropdown Master Agent liệt kê đủ master agent của master_agent_dropdown (dạng 'code - tên')", async ({ page }) => {
        const data = await masters();
        test.skip(data.length === 0, "Không có master agent nào");
        await openDropdown(page, "masterAgentId");
        await expect(openOptions(page)).toHaveCount(data.length);
        const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
        expect([...titles].sort()).toEqual(data.map(optionText).sort());
        await breadcrumb(page).click();
      });

      test("Dropdown Agent (chưa chọn master) liệt kê đủ agent của agent_dropdown (dạng 'code - tên')", async ({ page }) => {
        const data = await agents();
        test.skip(data.length === 0, "Không có agent nào");
        await openDropdown(page, "agentId");
        await expect(openOptions(page)).toHaveCount(data.length);
        const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
        expect([...titles].sort()).toEqual(data.map(optionText).sort());
        await breadcrumb(page).click();
      });

      test("Gõ vào ô tìm kiếm của filter Agent chỉ còn option khớp", async ({ page }) => {
        const data = await agents();
        test.skip(data.length === 0, "Không có agent nào");
        const a = data[data.length - 1];
        await openDropdown(page, "agentId");
        await page.keyboard.type(a.code);
        const expected = data.filter((v) => optionText(v).toLowerCase().includes(a.code.toLowerCase())).map(optionText);
        await expect(openOptions(page)).toHaveCount(expected.length);
        expect(await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")))).toEqual(expected);
        await breadcrumb(page).click();
      });

      test("Search không chọn gì: gửi filters rỗng và trả về cùng tổng bản ghi", async ({ page }) => {
        const first = await search(page);
        const second = await search(page);
        expect(second.body).toEqual(DEFAULT_BODY);
        expect(second.json.data.totalCount).toBe(first.json.data.totalCount);
      });

      test("Chọn Master Agent: gửi filters.masterAgentIds = [id] và mọi dòng thuộc master đó", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length === 0, "Không có dữ liệu");
        const x = all.data.list[0];
        const m = (await masters()).find((v) => v.value === x.masterAgentId);
        test.skip(!m, "Master agent của dòng đầu không có trong dropdown");

        await selectFilter(page, "masterAgentId", m);
        expect(await selectedFilter(page, "masterAgentId")).toEqual([optionText(m)]);
        const { body, json } = await search(page);
        expect(body).toMatchObject({ page: 1, pageSize: 10, filters: { masterAgentIds: [m.value] } });
        expect(body.filters).toEqual({ masterAgentIds: [m.value] });
        expect(json.data.list.length).toBeGreaterThan(0);
        for (const r of json.data.list) expect(r.masterAgentId).toBe(m.value);
        await expect(rows(page)).toHaveCount(json.data.list.length);
        for (const [i, r] of json.data.list.entries()) {
          await expect(cellAt(page, i, COL.master)).toHaveText(norm(r.masterAgentName));
        }
        // Mọi dòng của master này đều còn trong kết quả (lọc không làm mất dòng)
        expect(json.data.totalCount).toBe(all.data.list.filter((r) => r.masterAgentId === m.value).length);
      });

      test("Chọn Master Agent: dropdown Agent đổi sang agent của master đó (agent_dropdown {masterAgentIds:[id]})", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const m = (await masters()).find((v) => v.value === json.data.list[0].masterAgentId);
        test.skip(!m, "Master agent của dòng đầu không có trong dropdown");

        const [req, res] = await Promise.all([
          page.waitForRequest(isAgentDropdown),
          page.waitForResponse(isAgentDropdown),
          selectFilter(page, "masterAgentId", m),
        ]);
        expect(bodyOf(req)).toEqual({ masterAgentIds: [m.value] });
        const data = (await res.json()).data;
        expect(data.length).toBeLessThanOrEqual((await agents()).length);
        await openDropdown(page, "agentId");
        await expect(openOptions(page)).toHaveCount(data.length);
        const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
        expect([...titles].sort()).toEqual(data.map(optionText).sort());
        await breadcrumb(page).click();
      });

      test("Chọn Agent của dòng đầu: gửi filters.agentIds = [id] và chỉ còn đúng agent đó", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length === 0, "Không có dữ liệu");
        const x = all.data.list[0];
        const a = (await agents()).find((v) => v.value === x.agentId);
        test.skip(!a, "Agent của dòng đầu không có trong dropdown");

        await selectFilter(page, "agentId", a);
        expect(await selectedFilter(page, "agentId")).toEqual([optionText(a)]);
        const { body, json } = await search(page);
        expect(body).toMatchObject({ page: 1, pageSize: 10, filters: { agentIds: [a.value] } });
        expect(body.filters).toEqual({ agentIds: [a.value] });
        expect(json.data.totalCount).toBe(1);
        expect(json.data.list).toEqual([x]);
        await expect(rows(page)).toHaveCount(1);
        await expect(cellAt(page, 0, COL.agent)).toHaveText(norm(x.agentName));
        await expect(summary(page)).toHaveText("Showing 1 - 1 of 1 records");
      });

      test("Kết hợp Master Agent + Agent: gửi cả masterAgentIds và agentIds (AND)", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length === 0, "Không có dữ liệu");
        const x = all.data.list[0];
        const m = (await masters()).find((v) => v.value === x.masterAgentId);
        const a = (await agents()).find((v) => v.value === x.agentId);
        test.skip(!m || !a, "Master / agent của dòng đầu không có trong dropdown");

        await Promise.all([page.waitForResponse(isAgentDropdown), selectFilter(page, "masterAgentId", m)]);
        await selectFilter(page, "agentId", a);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ masterAgentIds: [m.value], agentIds: [a.value] });
        expect(json.data.list).toEqual([x]);
      });

      test("Đổi Master Agent sau khi đã chọn Agent: Agent bị xoá khỏi filter và chỉ còn filter Master Agent", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length === 0, "Không có dữ liệu");
        const x = all.data.list[0];
        const a = (await agents()).find((v) => v.value === x.agentId);
        const other = (await masters()).find((v) => v.value !== x.masterAgentId);
        test.skip(!a || !other, "Không đủ master agent / agent để đổi");

        await selectFilter(page, "agentId", a);
        expect(await selectedFilter(page, "agentId")).toEqual([optionText(a)]);
        await Promise.all([page.waitForResponse(isAgentDropdown), selectFilter(page, "masterAgentId", other)]);
        expect(await selectedFilter(page, "masterAgentId")).toEqual([optionText(other)]);
        expect(await selectedFilter(page, "agentId")).toEqual([]);
        const { body } = await search(page);
        expect(body.filters).toEqual({ masterAgentIds: [other.value] });
      });

      test("Master Agent chưa có cấu hình nào: hiện 'There are no entries found'", async ({ page }) => {
        const { json: all } = await search(page);
        const used = new Set(all.data.list.map((x) => x.masterAgentId));
        const empty = (await masters()).find((m) => !used.has(m.value));
        test.skip(!empty, "Mọi master agent đều có cấu hình");

        await Promise.all([page.waitForResponse(isAgentDropdown), selectFilter(page, "masterAgentId", empty)]);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ masterAgentIds: [empty.value] });
        expect(json.data.totalCount).toBe(0);
        expect(json.data.list).toEqual([]);
        await expect(page.getByText(MSG.noEntries)).toBeVisible();
        await expect(rows(page)).toHaveCount(0);
      });

      test("Xoá giá trị đã chọn bằng nút (x) rồi Search: không còn gửi filter đó", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length === 0, "Không có dữ liệu");
        const a = (await agents()).find((v) => v.value === all.data.list[0].agentId);
        test.skip(!a, "Agent của dòng đầu không có trong dropdown");

        await selectFilter(page, "agentId", a);
        await filterEl(page, "agentId").hover();
        await filterEl(page, "agentId").locator(".ant-select-clear").click({ force: true });
        expect(await selectedFilter(page, "agentId")).toEqual([]);
        const { body } = await search(page);
        expect(body).toEqual(DEFAULT_BODY);
      });
    });

    // ===== 4. Reset =====
    test.describe("Reset", () => {
      test("Reset xoá Master Agent + Agent đã chọn và gửi lại request mặc định", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const m = (await masters()).find((v) => v.value === x.masterAgentId);
        const a = (await agents()).find((v) => v.value === x.agentId);
        test.skip(!m || !a, "Master / agent của dòng đầu không có trong dropdown");
        await Promise.all([page.waitForResponse(isAgentDropdown), selectFilter(page, "masterAgentId", m)]);
        await selectFilter(page, "agentId", a);
        await search(page);

        const bodies = await resetBodies(page);
        expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual(DEFAULT_BODY);
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
        await expect(summary(page)).toHaveText(new RegExp(`of ${json.data.totalCount} records$`));
        await expect(rows(page)).toHaveCount(Math.min(10, json.data.totalCount));
      });

      test("Reset trả dropdown Agent về đầy đủ agent (không còn lọc theo master)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const m = (await masters()).find((v) => v.value === json.data.list[0].masterAgentId);
        test.skip(!m, "Master agent của dòng đầu không có trong dropdown");
        const full = (await agents()).length;
        const [res] = await Promise.all([page.waitForResponse(isAgentDropdown), selectFilter(page, "masterAgentId", m)]);
        const filtered = (await res.json()).data.length;
        test.skip(filtered === full, "Master này có đủ mọi agent nên không phân biệt được");

        const [req] = await Promise.all([page.waitForRequest(isAgentDropdown), resetBtn(page).click()]);
        expect(bodyOf(req)).toEqual({});
        await settle(page);
        await openDropdown(page, "agentId");
        await expect(openOptions(page)).toHaveCount(full);
        await breadcrumb(page).click();
      });

      test("Reset đưa sort về mặc định (id giảm dần) và gửi lại request mặc định", async ({ page }) => {
        await search(page);
        await reloadBy(page, () => th(page, "Agent").click());
        const body = await reloadBy(page, () => resetBtn(page).click());
        expect(body).toEqual(DEFAULT_BODY);
      });
    });

    // ===== 5. Phân trang =====
    test.describe("Phân trang", () => {
      test("Ít bản ghi (1 trang): chỉ có trang 1, Previous / Next đều bị khoá", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total > 10, "Có nhiều hơn 1 trang");
        await expect(page.locator(".ant-pagination-item")).toHaveCount(1);
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
        await expect(page.locator(".ant-pagination-prev")).toHaveClass(/ant-pagination-disabled/);
        await expect(page.locator(".ant-pagination-next")).toHaveClass(/ant-pagination-disabled/);
      });

      test("Trang 2 gọi API page=2 và dòng tóm tắt đúng (khi có > 10 bản ghi)", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 10, "Chỉ có 1 trang");
        const { body, json } = await reloadFull(page, () => page.locator(".ant-pagination-item-2").click());
        expect(body).toMatchObject({ page: 2, pageSize: 10 });
        await expect(summary(page)).toHaveText(`Showing 11 - ${Math.min(20, total)} of ${total} records`);
        await expect(rows(page)).toHaveCount(json.data.list.length);
      });

      test("Dropdown số dòng / trang có đủ 10/20/50/100/200", async ({ page }) => {
        await pageSizeSelect(page).click();
        await expect(openOptions(page)).toHaveText(PAGE_SIZES);
        await page.keyboard.press("Escape");
      });

      for (const size of [20, 50, 100, 200]) {
        test(`Đổi sang ${size} dòng / trang gửi pageSize=${size} và hiển thị đúng số dòng`, async ({ page }) => {
          const total = await totalOf(page);
          await pageSizeSelect(page).click();
          const { body, json } = await reloadFull(page, () =>
            openOptions(page).filter({ hasText: `${size} / page` }).click(),
          );
          expect(body).toMatchObject({ page: 1, pageSize: size });
          const shown = Math.min(size, total);
          expect(json.data.list).toHaveLength(shown);
          await expect(rows(page)).toHaveCount(shown);
          await expect(pageSizeSelect(page)).toContainText(`${size} / page`);
          if (shown > 0) await expect(summary(page)).toHaveText(`Showing 1 - ${shown} of ${total} records`);
        });
      }

      test("Giữ filter đang chọn khi đổi số dòng / trang", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const m = (await masters()).find((v) => v.value === json.data.list[0].masterAgentId);
        test.skip(!m, "Master agent của dòng đầu không có trong dropdown");
        await Promise.all([page.waitForResponse(isAgentDropdown), selectFilter(page, "masterAgentId", m)]);
        await search(page);
        await pageSizeSelect(page).click();
        const body = await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
        expect(body).toMatchObject({ pageSize: 20, filters: { masterAgentIds: [m.value] } });
      });

      // Quan sát thực tế (khám phá bằng script): Reset KHÔNG đưa số dòng / trang về 10 mà giữ giá trị đã chọn
      test("Reset giữ nguyên số dòng / trang đã chọn (chỉ xoá filter + sort)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const m = (await masters()).find((v) => v.value === json.data.list[0].masterAgentId);
        test.skip(!m, "Master agent của dòng đầu không có trong dropdown");
        await pageSizeSelect(page).click();
        await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
        await Promise.all([page.waitForResponse(isAgentDropdown), selectFilter(page, "masterAgentId", m)]);
        await search(page);
        const bodies = await resetBodies(page);
        expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual({ ...DEFAULT_BODY, pageSize: 20 });
        await expect(pageSizeSelect(page)).toContainText("20 / page");
      });
    });

    // ===== 6. Sắp xếp =====
    test.describe("Sắp xếp", () => {
      for (const [name, key] of Object.entries(SORTABLE)) {
        test(`Sort cột "${name}": asc -> desc -> về mặc định (id desc)`, async ({ page }) => {
          await search(page);
          const b1 = await reloadBy(page, () => th(page, name).click());
          expect(b1).toMatchObject({ sortBy: key, sortDirection: "asc", page: 1, pageSize: 10 });
          const b2 = await reloadBy(page, () => th(page, name).click());
          expect(b2).toMatchObject({ sortBy: key, sortDirection: "desc" });
          const b3 = await reloadBy(page, () => th(page, name).click());
          expect(b3).toMatchObject({ sortBy: "id", sortDirection: "desc" });
        });

        test(`Sort cột "${name}": bảng hiển thị đúng thứ tự response và là hoán vị của cùng tập agent`, async ({ page }) => {
          const { json: base } = await search(page);
          test.skip(base.data.totalCount > 10 || base.data.list.length === 0, "Chỉ so sánh tập dòng khi tất cả nằm trong 1 trang");
          const { json } = await reloadFull(page, () => th(page, name).click());
          expect(json.data.list.map((x) => x.agentId).sort((a, b) => a - b)).toEqual(
            base.data.list.map((x) => x.agentId).sort((a, b) => a - b),
          );
          // Thứ tự chữ phụ thuộc collation của server nên chỉ kiểm tra bảng hiển thị đúng thứ tự response
          const field = name === "Agent" ? "agentName" : "masterAgentName";
          expect(await columnValues(page, name)).toEqual(json.data.list.map((x) => norm(x[field])));
        });
      }

      test("Giữ sort khi tìm kiếm với filter (Search không làm mất sort)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const m = (await masters()).find((v) => v.value === json.data.list[0].masterAgentId);
        test.skip(!m, "Master agent của dòng đầu không có trong dropdown");
        await reloadBy(page, () => th(page, "Agent").click());
        await Promise.all([page.waitForResponse(isAgentDropdown), selectFilter(page, "masterAgentId", m)]);
        const { body } = await search(page);
        expect(body).toMatchObject({ sortBy: "agentName", sortDirection: "asc", filters: { masterAgentIds: [m.value] } });
      });

      test("Chỉ 2 cột Master Agent và Agent sort được; 2 cột công tắc không sort", async ({ page }) => {
        for (const c of COLUMNS) {
          if (c in SORTABLE) await expect(th(page, c), c).toHaveClass(/ant-table-column-has-sorters/);
          else await expect(th(page, c), c).not.toHaveClass(/ant-table-column-has-sorters/);
        }
      });
    });

    // ===== 7. Hộp thoại Add Agent (không ghi dữ liệu thật) =====
    test.describe("Hộp thoại Add Agent (không ghi dữ liệu thật)", () => {
      test("Bấm Add New: hiện hộp thoại 'Add Agent' với 2 ô bắt buộc, ghi chú và nút Cancel / Save", async ({ page }) => {
        const [req] = await Promise.all([page.waitForRequest(isAgentDropdown), openAddDialog(page)]);
        expect(bodyOf(req)).toEqual({ masterAgentIds: [] });
        await expect(dialog(page).locator("label")).toHaveText(["Master Agent", "Agent"]);
        await expect(dialog(page).locator(".ant-select")).toHaveCount(2);
        await expect(modalSelect(page, 0).locator(".ant-select-selection-placeholder")).toHaveText("Select master agent");
        await expect(modalSelect(page, 1).locator(".ant-select-selection-placeholder")).toHaveText("Select agent");
        await expect(dialog(page)).toContainText(MSG.note);
        await expect(cancelBtn(page)).toBeVisible();
        await expect(saveBtn(page)).toBeVisible();
        await expect(modalErrors(page)).toHaveCount(0);
        await closeDialog(page);
      });

      test("Chưa chọn Master Agent thì ô Agent bị khoá", async ({ page }) => {
        await openAddDialog(page);
        await expect(modalSelect(page, 0)).not.toHaveClass(/ant-select-disabled/);
        await expect(modalSelect(page, 1)).toHaveClass(/ant-select-disabled/);
        await closeDialog(page);
      });

      test("Dropdown Master Agent trong hộp thoại liệt kê đủ master agent (dạng 'code - tên')", async ({ page }) => {
        const data = await masters();
        test.skip(data.length === 0, "Không có master agent nào");
        await openAddDialog(page);
        await modalSelect(page, 0).click();
        // Danh sách trong hộp thoại là danh sách ảo (chỉ render ~10 option đang thấy) -> kiểm tra option nào hiện ra cũng có trong response,
        // rồi gõ code của master cuối danh sách để chắc chắn danh sách đủ
        await expect.poll(() => openOptions(page).count()).toBeGreaterThan(0);
        const known = new Set(data.map(optionText));
        for (const t of await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")))) {
          expect(known.has(t), `option "${t}" không có trong master_agent_dropdown`).toBe(true);
        }
        const last = data[data.length - 1];
        await page.keyboard.type(last.code);
        await expect(openOptions(page).filter({ hasText: exact(optionText(last)) })).toHaveCount(1);
        await dialogTitle(page).click();
        await expect(openOptions(page)).toHaveCount(0);
        await closeDialog(page);
      });

      test("Save khi để trống: báo 2 lỗi 'Please select master agent / agent', không gửi request thêm", async ({ page }) => {
        await openAddDialog(page);
        await saveBtn(page).click();
        await expect(modalErrors(page)).toHaveText([MSG.master, MSG.agent]);
        await expect(dialog(page)).toBeVisible();
      });

      test("Chọn Master Agent: mở khoá ô Agent, gọi agent_dropdown theo master, xoá lỗi đang hiện; Save lại chỉ báo lỗi Agent", async ({ page }) => {
        const ms = await masters();
        test.skip(ms.length === 0, "Không có master agent nào");
        const m = ms[0];
        await openAddDialog(page);
        await saveBtn(page).click();
        await expect(modalErrors(page)).toHaveCount(2);

        const [req] = await Promise.all([page.waitForRequest((r) => isAgentDropdown(r) && bodyOf(r).masterAgentIds?.length), pickInModal(page, 0, m)]);
        expect(bodyOf(req)).toEqual({ masterAgentIds: [m.value] });
        await expect(modalSelect(page, 1)).not.toHaveClass(/ant-select-disabled/);
        // Quan sát thực tế: chọn Master Agent xoá cả 2 lỗi đang hiện; Save lần nữa chỉ báo lỗi Agent
        await expect(modalErrors(page)).toHaveCount(0);
        await saveBtn(page).click();
        await expect(modalErrors(page)).toHaveText([MSG.agent]);
        await expect(dialog(page)).toBeVisible();
      });

      test("Dropdown Agent trong hộp thoại chỉ liệt kê agent của Master Agent đã chọn", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await openAddDialog(page);
        const data = await pickMasterInModal(page, { code: x.masterAgentCode, label: x.masterAgentName });
        await expect(modalSelect(page, 1)).not.toHaveClass(/ant-select-disabled/);
        await modalSelect(page, 1).click();
        // Danh sách ảo: option hiện ra phải thuộc master đã chọn; agent của master khác gõ vào thì không có option nào
        await expect.poll(() => openOptions(page).count()).toBeGreaterThan(0);
        const known = new Set(data.map(optionText));
        for (const t of await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")))) {
          expect(known.has(t), `option "${t}" không thuộc master ${x.masterAgentName}`).toBe(true);
        }
        const outsider = (await agents()).find((a) => !data.some((d) => d.value === a.value));
        if (outsider) {
          await page.keyboard.type(outsider.code);
          await expect(openOptions(page)).toHaveCount(0);
        }
        await dialogTitle(page).click();
        await closeDialog(page);
      });

      test("Đổi Master Agent sau khi đã chọn Agent: ô Agent bị xoá", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const other = (await masters()).find((v) => v.value !== x.masterAgentId);
        test.skip(!other, "Chỉ có 1 master agent");
        await openAddDialog(page);
        const data = await pickMasterInModal(page, { code: x.masterAgentCode, label: x.masterAgentName });
        await pickInModal(page, 1, data[0]);
        expect(await dialog(page).locator(".ant-select-selection-item[title]").evaluateAll((e) => e.map((v) => v.title))).toEqual([
          optionText({ code: x.masterAgentCode, label: x.masterAgentName }),
          optionText(data[0]),
        ]);

        await pickMasterInModal(page, other);
        expect(await dialog(page).locator(".ant-select-selection-item[title]").evaluateAll((e) => e.map((v) => v.title))).toEqual([
          optionText(other),
        ]);
        await closeDialog(page);
      });

      test("Cancel / nút X / click ra ngoài / Esc đều đóng hộp thoại; mở lại thì form trống, không còn lỗi", async ({ page }) => {
        await openAddDialog(page);
        await saveBtn(page).click();
        await expect(modalErrors(page)).toHaveCount(2);
        await cancelBtn(page).click();
        await expect(dialog(page)).toBeHidden();

        await openAddDialog(page);
        await expect(modalErrors(page)).toHaveCount(0);
        await expect(dialog(page).locator(".ant-select-selection-item")).toHaveCount(0);
        await dialog(page).getByRole("button", { name: "Close" }).first().click();
        await expect(dialog(page)).toBeHidden();

        await openAddDialog(page);
        await page.mouse.click(1700, 900); // click lớp phủ ngoài hộp thoại
        await expect(dialog(page)).toBeHidden();

        await openAddDialog(page);
        await dialogTitle(page).click(); // Esc chỉ đóng khi hộp thoại đang có focus
        await page.keyboard.press("Escape");
        await expect(dialog(page)).toBeHidden();
      });

      test("Save hợp lệ gửi đúng request setting/add {agentId}; thành công thì đóng hộp thoại + toast (response GIẢ, không ghi dữ liệu thật)", async ({ page }) => {
        const { json } = await search(page);
        const target = await findQaTarget(page, json.data.list.map((x) => x.agentCode));
        test.skip(!target, "Không có agent QA trống để chọn");
        await mockWrites(page, {
          status: "success",
          messageCode: "GAME_RECOMMENDATION_SETTING_ADD_SUCCESS",
          message: MSG.added,
          data: { agentId: target.agent.value, recommendedGamesStatus: false, eventAnnouncementStatus: false },
        });
        await openAddDialog(page);
        await pickMasterInModal(page, target.master);
        await pickInModal(page, 1, target.agent);
        const [req] = await Promise.all([page.waitForRequest(isAdd), saveBtn(page).click()]);
        expect(bodyOf(req)).toEqual({ agentId: target.agent.value });
        allowedWrites = [{ url: "game-recommendation/setting/add", body: { agentId: target.agent.value } }];
        await expect(dialog(page)).toBeHidden();
        await expect(toasts(page).filter({ hasText: MSG.added })).toBeVisible();
      });

      test("Server báo lỗi khi Add (response GIẢ 'đã tồn tại'): hiện toast Error, hộp thoại vẫn mở", async ({ page }) => {
        const { json } = await search(page);
        const target = await findQaTarget(page, json.data.list.map((x) => x.agentCode));
        test.skip(!target, "Không có agent QA trống để chọn");
        await mockWrites(page, {
          status: "fail",
          messageCode: "GAME_RECOMMENDATION_SETTING_ALREADY_EXIST",
          message: MSG.exists,
        });
        await openAddDialog(page);
        await pickMasterInModal(page, target.master);
        await pickInModal(page, 1, target.agent);
        const [req] = await Promise.all([page.waitForRequest(isAdd), saveBtn(page).click()]);
        allowedWrites = [{ url: "game-recommendation/setting/add", body: bodyOf(req) }];
        await expect(toasts(page).filter({ hasText: "Error" }).filter({ hasText: MSG.exists })).toBeVisible();
        await expect(dialog(page)).toBeVisible();
        await closeDialog(page);
      });
    });

    // ===== 8. Công tắc (response GIẢ - không ghi dữ liệu thật) =====
    test.describe("Công tắc Recommended Games / Event Announcement (response GIẢ, không ghi dữ liệu thật)", () => {
      const OK = { status: "success", messageCode: "GAME_RECOMMENDATION_SETTING_UPDATE_SUCCESS", message: "OK", data: null };

      for (const [label, col, key] of [
        ["Recommended Games", COL.rec, "recommendedGamesStatus"],
        ["Event Announcement", COL.event, "eventAnnouncementStatus"],
      ]) {
        test(`Bấm công tắc ${label} của dòng đầu: gửi đúng setting/update {agentId, ${key}: <ngược trạng thái hiện tại>}`, async ({ page }) => {
          const { json } = await search(page);
          test.skip(json.data.list.length === 0, "Không có dữ liệu");
          const x = json.data.list[0];
          await expect(cellAt(page, 0, COL.agent)).toHaveText(norm(x.agentName));
          await mockWrites(page, { ...OK, data: { agentId: x.agentId, isRevertedToDefault: false } });

          const [req] = await Promise.all([page.waitForRequest(isUpdate), switchOf(rowAt(page, 0), col).click()]);
          const body = { agentId: x.agentId, [key]: !x[key] };
          expect(bodyOf(req)).toEqual(body);
          allowedWrites = [{ url: "game-recommendation/setting/update", body }];
          // Chỉ gửi 1 trường trạng thái (không gửi công tắc còn lại)
          expect(Object.keys(bodyOf(req)).sort()).toEqual(["agentId", key].sort());
        });

        test(`Server báo lỗi khi bật / tắt ${label} (response GIẢ): hiện toast Error, công tắc giữ nguyên trạng thái cũ`, async ({ page }) => {
          const { json } = await search(page);
          test.skip(json.data.list.length === 0, "Không có dữ liệu");
          const x = json.data.list[0];
          await mockWrites(page, MOCK_FAIL);

          const sw = switchOf(rowAt(page, 0), col);
          const before = await sw.getAttribute("aria-checked");
          expect(before).toBe(String(x[key]));
          const [req] = await Promise.all([page.waitForRequest(isUpdate), sw.click()]);
          allowedWrites = [{ url: "game-recommendation/setting/update", body: bodyOf(req) }];
          await expect(toasts(page).filter({ hasText: "Error" })).toBeVisible();
          await expect(sw).toHaveAttribute("aria-checked", before);
          await expect(cellAt(page, 0, COL.agent)).toHaveText(norm(x.agentName));
        });
      }
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
        await item(page, "Event Announcement").locator("label").click();
        expect(await headers(page)).not.toContain("Event Announcement");
        expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

        await item(page, "Event Announcement").locator("label").click();
        expect(await headers(page)).toEqual(COLUMNS);
      });

      test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        const masters_ = await columnValues(page, "Master Agent");
        const agents_ = await columnValues(page, "Agent");
        await columnBtn(page).click();
        await item(page, "Recommended Games").locator("label").click();
        expect(await columnValues(page, "Master Agent")).toEqual(masters_);
        expect(await columnValues(page, "Agent")).toEqual(agents_);
        expect(await headers(page)).not.toContain("Recommended Games");
      });
    });

    // ===== 10. Ghi nhớ filter =====
    test.describe("Ghi nhớ filter", () => {
      test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const m = (await masters()).find((v) => v.value === x.masterAgentId);
        const a = (await agents()).find((v) => v.value === x.agentId);
        test.skip(!m || !a, "Master / agent của dòng đầu không có trong dropdown");

        await Promise.all([page.waitForResponse(isAgentDropdown), selectFilter(page, "masterAgentId", m)]);
        await selectFilter(page, "agentId", a);
        await search(page);
        await pageSizeSelect(page).click();
        await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

        const [req] = await Promise.all([page.waitForRequest(isList), openPage(page)]); // reload
        expect(bodyOf(req)).toMatchObject({ pageSize: 20, filters: { masterAgentIds: [m.value], agentIds: [a.value] } });
        expect(await selectedFilter(page, "masterAgentId")).toEqual([optionText(m)]);
        expect(await selectedFilter(page, "agentId")).toEqual([optionText(a)]);
        await expect(pageSizeSelect(page)).toContainText("20 / page");
      });

      test("Sau Reset rồi reload: filter không còn được ghi nhớ", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const m = (await masters()).find((v) => v.value === json.data.list[0].masterAgentId);
        test.skip(!m, "Master agent của dòng đầu không có trong dropdown");
        await Promise.all([page.waitForResponse(isAgentDropdown), selectFilter(page, "masterAgentId", m)]);
        await search(page);
        await reloadBy(page, () => resetBtn(page).click());

        await openPage(page); // reload
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
        await expect(rows(page)).toHaveCount(Math.min(10, json.data.totalCount));
      });
    });
  });

  // ===== NHÓM CRUD (GHI DỮ LIỆU THẬT trên agent QA) =====
  test.describe("CRUD (ghi dữ liệu thật trên agent QA, tự dọn lại)", () => {
    test.describe.configure({ mode: "serial" });

    let target; // { master, agent } - agent QA được thêm cấu hình (chọn ở test đầu tiên)
    let agentId; // id agent QA (lấy từ request add)

    // Dọn lại: nếu agent QA còn cấu hình trong bảng thì bật cả 2 công tắc (bản ghi tự bị gỡ)
    test.afterAll(async ({ browser }) => {
      test.setTimeout(120000);
      if (!target) return;
      const ctx = await browser.newContext({ storageState: buildStorageState(), viewport: VIEWPORT });
      const page = await ctx.newPage();
      try {
        // Lọc theo đúng agent QA để chắc chắn chỉ thao tác trên bản ghi này
        await page.addInitScript(() => {
          for (const k of Object.keys(localStorage)) if (/game-recommendation_setting_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
        });
        await openPage(page);
        const row = rowOfAgent(page, target.agent.label);
        for (let guard = 0; guard < 3 && (await row.count()) > 0; guard++) {
          for (const col of [COL.rec, COL.event]) {
            if ((await row.count()) === 0) break;
            const sw = switchOf(row, col);
            if ((await sw.getAttribute("aria-checked")) === "false") {
              await Promise.all([page.waitForResponse(isUpdate), sw.click()]);
              await settle(page);
            }
          }
        }
        await expect(row, `Không dọn được cấu hình của agent QA ${target.agent.label}`).toHaveCount(0);
      } finally {
        await ctx.close();
      }
    });

    test.beforeEach(async ({ page }) => {
      await openPage(page);
    });

    // Mọi request ghi của nhóm này chỉ được nhắm vào agent QA (không bao giờ sửa dòng có sẵn của team)
    test.afterEach(async () => {
      for (const w of writes) {
        expect(["game-recommendation/setting/add", "game-recommendation/setting/update"], "URL ghi không nằm trong danh sách").toContain(w.url);
        expect(w.body.agentId, "Request ghi phải nhắm đúng agent QA").toBe(target.agent.value);
      }
    });

    // Bật / tắt 1 công tắc của dòng agent QA, trả về { body, json } của request update (chờ list tải lại)
    async function toggle(page, col) {
      const row = rowOfAgent(page, target.agent.label);
      const [req, res] = await Promise.all([
        page.waitForRequest(isUpdate),
        page.waitForResponse(isUpdate),
        switchOf(row, col).click(),
      ]);
      const json = await res.json();
      await settle(page);
      return { body: bodyOf(req), json };
    }

    test("Add New: chọn Master Agent + agent QA, Save gửi {agentId}, toast thành công, dòng mới tắt cả 2 công tắc", async ({ page }) => {
      const { json } = await search(page);
      target = await findQaTarget(page, json.data.list.map((x) => x.agentCode));
      test.skip(!target, "Không có agent QA trống (chưa có cấu hình) để thêm");
      const before = json.data.totalCount;

      await openAddDialog(page);
      await pickMasterInModal(page, target.master);
      await pickInModal(page, 1, target.agent);
      const [req, res] = await Promise.all([
        page.waitForRequest(isAdd),
        page.waitForResponse(isAdd),
        saveBtn(page).click(),
      ]);
      agentId = target.agent.value;
      const body = bodyOf(req);
      expect(body).toEqual({ agentId: target.agent.value });
      expect(res.status()).toBe(200);
      const added = await res.json();
      expect(added.status).toBe("success");
      expect(added.messageCode).toBe("GAME_RECOMMENDATION_SETTING_ADD_SUCCESS");
      expect(added.data).toEqual({ agentId: target.agent.value, recommendedGamesStatus: false, eventAnnouncementStatus: false });

      await expect(dialog(page)).toBeHidden();
      await expect(toasts(page).filter({ hasText: MSG.added })).toBeVisible();
      await settle(page);
      const row = rowOfAgent(page, target.agent.label);
      await expect(row).toHaveCount(1);
      await expect(row.locator("td").nth(COL.master)).toHaveText(norm(target.master.label));
      await expect(switchOf(row, COL.rec)).toHaveAttribute("aria-checked", "false");
      await expect(switchOf(row, COL.event)).toHaveAttribute("aria-checked", "false");
      expect(await totalOf(page)).toBe(before + 1);
    });

    test("Dòng mới thêm có trong response list (cả 2 trạng thái false) và lọc theo Agent QA ra đúng 1 dòng", async ({ page }) => {
      test.skip(!target, "Chưa có agent QA được thêm");
      await selectFilter(page, "agentId", target.agent);
      const { body, json } = await search(page);
      expect(body.filters).toEqual({ agentIds: [target.agent.value] });
      expect(json.data.list).toEqual([
        {
          masterAgentId: target.master.value,
          masterAgentCode: target.master.code,
          masterAgentName: target.master.label,
          agentId: target.agent.value,
          agentCode: target.agent.code,
          agentName: target.agent.label,
          recommendedGamesStatus: false,
          eventAnnouncementStatus: false,
        },
      ]);
    });

    test("Thêm lại đúng agent đã có cấu hình: server báo lỗi, hộp thoại vẫn mở, không thêm dòng", async ({ page }) => {
      test.skip(!target, "Chưa có agent QA được thêm");
      const total = await totalOf(page);
      await openAddDialog(page);
      await pickMasterInModal(page, target.master);
      await pickInModal(page, 1, target.agent);
      const [req, res] = await Promise.all([
        page.waitForRequest(isAdd),
        page.waitForResponse(isAdd),
        saveBtn(page).click(),
      ]);
      expect(bodyOf(req)).toEqual({ agentId: target.agent.value });
      const json = await res.json();
      expect(json.status).toBe("fail");
      expect(json.messageCode).toBe("GAME_RECOMMENDATION_SETTING_ALREADY_EXIST");
      await expect(toasts(page).filter({ hasText: "Error" }).filter({ hasText: MSG.exists })).toBeVisible();
      await expect(dialog(page)).toBeVisible();
      await closeDialog(page);
      expect(await totalOf(page)).toBe(total);
      await expect(rowOfAgent(page, target.agent.label)).toHaveCount(1);
    });

    test("Bật rồi tắt Recommended Games: gửi đúng update, toast, trạng thái được lưu (reload vẫn đúng), Event giữ nguyên", async ({ page }) => {
      test.skip(!target, "Chưa có agent QA được thêm");
      const row = rowOfAgent(page, target.agent.label);

      const on = await toggle(page, COL.rec);
      expect(on.body).toEqual({ agentId, recommendedGamesStatus: true });
      expect(on.json.status).toBe("success");
      expect(on.json.messageCode).toBe("GAME_RECOMMENDATION_SETTING_UPDATE_SUCCESS");
      expect(on.json.data).toEqual({ agentId, recommendedGamesStatus: true, eventAnnouncementStatus: false, isRevertedToDefault: false });
      await expect(toasts(page).filter({ hasText: updatedMsg(target.agent.label) })).toBeVisible();
      await expect(switchOf(row, COL.rec)).toHaveAttribute("aria-checked", "true");
      await expect(switchOf(row, COL.event)).toHaveAttribute("aria-checked", "false");

      await openPage(page); // reload: trạng thái đã lưu thật ở server
      await expect(switchOf(rowOfAgent(page, target.agent.label), COL.rec)).toHaveAttribute("aria-checked", "true");

      const off = await toggle(page, COL.rec);
      expect(off.body).toEqual({ agentId, recommendedGamesStatus: false });
      expect(off.json.data).toEqual({ agentId, recommendedGamesStatus: false, eventAnnouncementStatus: false, isRevertedToDefault: false });
      await expect(switchOf(rowOfAgent(page, target.agent.label), COL.rec)).toHaveAttribute("aria-checked", "false");
      await expect(switchOf(rowOfAgent(page, target.agent.label), COL.event)).toHaveAttribute("aria-checked", "false");
    });

    test("Bật rồi tắt Event Announcement: gửi đúng update, toast, trạng thái được lưu, Recommended giữ nguyên", async ({ page }) => {
      test.skip(!target, "Chưa có agent QA được thêm");
      const row = rowOfAgent(page, target.agent.label);

      const on = await toggle(page, COL.event);
      expect(on.body).toEqual({ agentId, eventAnnouncementStatus: true });
      expect(on.json.status).toBe("success");
      expect(on.json.data).toEqual({ agentId, recommendedGamesStatus: false, eventAnnouncementStatus: true, isRevertedToDefault: false });
      await expect(toasts(page).filter({ hasText: updatedMsg(target.agent.label) })).toBeVisible();
      await expect(switchOf(row, COL.event)).toHaveAttribute("aria-checked", "true");
      await expect(switchOf(row, COL.rec)).toHaveAttribute("aria-checked", "false");

      const off = await toggle(page, COL.event);
      expect(off.body).toEqual({ agentId, eventAnnouncementStatus: false });
      expect(off.json.data).toEqual({ agentId, recommendedGamesStatus: false, eventAnnouncementStatus: false, isRevertedToDefault: false });
      await expect(switchOf(row, COL.event)).toHaveAttribute("aria-checked", "false");
    });

    test("Bật cả 2 công tắc (= mặc định): isRevertedToDefault, toast 'removed from the list', dòng biến mất và không còn sau reload", async ({ page }) => {
      test.skip(!target, "Chưa có agent QA được thêm");
      const total = await totalOf(page);

      const first = await toggle(page, COL.rec);
      expect(first.json.data.isRevertedToDefault).toBe(false);
      await expect(rowOfAgent(page, target.agent.label)).toHaveCount(1);

      const second = await toggle(page, COL.event);
      expect(second.body).toEqual({ agentId, eventAnnouncementStatus: true });
      expect(second.json.data).toEqual({ agentId, recommendedGamesStatus: true, eventAnnouncementStatus: true, isRevertedToDefault: true });
      await expect(toasts(page).filter({ hasText: revertedMsg(target.agent.label) })).toBeVisible();
      await expect(rowOfAgent(page, target.agent.label)).toHaveCount(0);
      expect(await totalOf(page)).toBe(total - 1);

      await openPage(page); // reload
      await expect(rowOfAgent(page, target.agent.label)).toHaveCount(0);
      await selectFilter(page, "agentId", target.agent);
      const { json } = await search(page);
      expect(json.data.totalCount).toBe(0);
      await expect(page.getByText(MSG.noEntries)).toBeVisible();
    });

    test("Sau khi bị gỡ về mặc định, thêm lại agent đó vẫn được (cả 2 công tắc tắt) rồi gỡ lại bằng cách bật cả 2", async ({ page }) => {
      test.skip(!target, "Chưa có agent QA được thêm");
      await expect(rowOfAgent(page, target.agent.label)).toHaveCount(0);

      await openAddDialog(page);
      await pickMasterInModal(page, target.master);
      await pickInModal(page, 1, target.agent);
      const [res] = await Promise.all([page.waitForResponse(isAdd), saveBtn(page).click()]);
      expect((await res.json()).status).toBe("success");
      await expect(dialog(page)).toBeHidden();
      await settle(page);
      const row = rowOfAgent(page, target.agent.label);
      await expect(row).toHaveCount(1);
      await expect(switchOf(row, COL.rec)).toHaveAttribute("aria-checked", "false");
      await expect(switchOf(row, COL.event)).toHaveAttribute("aria-checked", "false");

      // Dọn lại ngay: bật cả 2 công tắc
      await toggle(page, COL.rec);
      const last = await toggle(page, COL.event);
      expect(last.json.data.isRevertedToDefault).toBe(true);
      await expect(rowOfAgent(page, target.agent.label)).toHaveCount(0);
    });
  });
});
