// Administration > Permissions  (https://dev-bo.royaledge.io/admin/permission)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/admin_permission.spec.js --project=setup --project=chromium
//
// Màn hình danh sách "Permissions": danh sách TOÀN BỘ quyền (permission) của hệ thống (API permission/manage/list, filters.sasEntityId luôn = [1]).
//  - Filter: Name ("name", input, không phân biệt hoa thường, khớp 1 phần), URL ("url", input), Category ("category", input),
//    Type ("types", dropdown chọn NHIỀU: BYPASS CREATE DELETE EDIT EXECUTE EXPORT IMPORT LIST VIEW), Public ("public", dropdown chọn 1: False / True, gửi boolean).
//    Filter rỗng thì KHÔNG gửi key đó lên API.
//  - Cột ID / Name / URL / Type / Category sort được (sortBy id | name | url | type | category); Public và Roles không sort. Cột ID đang là mặc định (id desc):
//    click đầu tiên về "không sort" và KHÔNG gọi API, click 2 = asc, click 3 = desc. 4 cột còn lại: asc -> desc -> về mặc định (id desc).
//  - Cột Public là tag True / False; cột Roles là các tag cấp (Admin / House / Master Agent / Agent) suy ra từ hierarchyMap [1..4] của quyền
//    (quyền Public = true có hierarchyMap null nên Roles trống). Cột Action chỉ có 1 icon Update (/admin/permission/update/{id}); KHÔNG có View, xoá, Export, chọn dòng.
//  - Add New -> /admin/permission/create: Permission Name, API Url, Type (dropdown View/Create/Edit/Delete/Export/Bypass/Execute/Import/List), Category, Public (True / False).
//    Chọn Public = False thì hiện thêm "Roles" (checkbox Admin / House / Master Agent / Agent, bắt buộc chọn ít nhất 1). Tất cả đều bắt buộc, KHÔNG có kiểm tra định dạng / độ dài.
//    Save gọi permission/create {name, url, type, category, isPublic, hierarchyMap (chỉ khi Public = False)}; thành công thì toast Success và quay về danh sách.
//  - Update: permission/view {id} nạp form giống Create; Save gọi permission/update {id, name, url, type, category, isPublic, hierarchyMap}.
//
// AN TOÀN DỮ LIỆU:
//  - Mọi describe trừ cuối là "chỉ đọc": request ghi (permission/create, permission/update) bị chặn ở tầng mạng (route.abort); test kiểm tra payload / thông báo
//    dùng route.fulfill trả response GIẢ (request KHÔNG tới server). afterEach so sánh chính xác request ghi bắt được (watchWrites) với danh sách được phép (allowedWrites).
//    Quyền có sẵn của team chỉ bị thao tác bằng request GIẢ, không bao giờ bị ghi thật.
//  - Describe cuối "CRUD (ghi dữ liệu thật)" được gắn cờ RUN_FULL_TESTS (tests/helpers/flags.js, xem RUN_FULL_TESTS.md):
//    RUN_FULL_TESTS=false (mặc định) -> cả nhóm bị skip, KHÔNG gửi request ghi nào; =true -> mới chạy.
//    Nhóm này chạy tuần tự, CHỈ thao tác trên 1 quyền QA (name "QA_UI_PERM_<timestamp>", category "QA_UI_CATEGORY", Public = False, Roles = Admin):
//      * Màn hình KHÔNG có chức năng xoá quyền -> quyền QA KHÔNG dọn được bằng UI, nên test chỉ TẠO khi chưa có quyền QA_UI_PERM_ nào (tối đa 1 lần trong cả vòng đời),
//        các lần chạy sau dùng lại quyền đó. Mọi test sửa (name / url / category / Roles / Public) đều khôi phục về giá trị gốc trong finally + afterAll.
//      * Không có test "tạo trùng": dữ liệu hiện tại có sẵn quyền trùng tên (server có vẻ không chặn trùng) nên tạo trùng thật sẽ sinh thêm bản ghi rác không xoá được.
//      * afterEach kiểm tra mọi request ghi chỉ nhắm vào quyền QA này (permission/update có id = id quyền QA; permission/create chỉ với name QA_UI_PERM_...).
//  - Không hard-code dữ liệu: quyền dùng cho test đều lấy từ response list.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");
const { RUN_FULL_TESTS, SKIP_WRITE_REASON } = require("./helpers/flags");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/admin/permission";
const ORIGIN = "https://dev-bo.royaledge.io";

// Đúng thứ tự hiển thị
const COLUMNS = ["ID", "Name", "URL", "Type", "Public", "Category", "Roles", "Action"];
const COL = { id: 0, name: 1, url: 2, type: 3, public: 4, category: 5, roles: 6, action: 7 };
const FILTERS = [
  ["name", "Name"],
  ["url", "URL"],
  ["category", "Category"],
  ["types", "Type"],
  ["public", "Public"],
];
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
const DEFAULT_BODY = {
  page: 1,
  pageSize: 10,
  sortBy: "id",
  sortDirection: "desc",
  filters: { sasEntityId: [1] },
};
const SORTABLE = { ID: "id", Name: "name", URL: "url", Type: "type", Category: "category" };
const TYPE_FILTER_OPTIONS = ["BYPASS", "CREATE", "DELETE", "EDIT", "EXECUTE", "EXPORT", "IMPORT", "LIST", "VIEW"];
const TYPE_FORM_OPTIONS = ["View", "Create", "Edit", "Delete", "Export", "Bypass", "Execute", "Import", "List"];
const HIERARCHY = { 1: "Admin", 2: "House", 3: "Master Agent", 4: "Agent" }; // hierarchyMap -> tên cấp (checkbox Roles value 1..4)
const QA_PREFIX = "QA_UI_PERM_"; // name của quyền QA: QA_UI_PERM_<timestamp>
const QA_CATEGORY = "QA_UI_CATEGORY";

// Thông báo của form / toast (đọc từ màn hình thật)
const MSG = {
  name: "Please enter Permission Name",
  url: "Please enter API Url",
  type: "Please enter Type",
  category: "Please enter Category",
  status: "Please select status", // lỗi của ô Public (chưa chọn) và cả của ô Roles (Public = False nhưng chưa chọn cấp nào)
  noEntries: "There are no entries found",
};

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI (permission/create, permission/update)
const READ = /\/(list|details|download|view)(\?|$)|\/dropdown\/|_dropdown(\?|$)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/permission/manage/list");
const isView = endsWith("/permission/view");
const isCreate = endsWith("/permission/create");
const isUpdate = endsWith("/permission/update");

const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};
const asc = (a, b) => a - b;
const typeLabel = (t) => t.charAt(0) + t.slice(1).toLowerCase(); // "CREATE" -> "Create" (nhãn trong form)
const rolesOf = (x) => (x.hierarchyMap ?? []).map((h) => HIERARCHY[h]); // tag Roles mong đợi của 1 quyền

// Bảng chính (luôn là .ant-table đầu tiên trong DOM)
const table = (page) => page.locator(".ant-table").first();
const rows = (page) => table(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
const th = (page, name) => table(page).locator("thead th").filter({ hasText: exact(name) });
const rowOfId = (page, id) => rows(page).filter({ has: page.locator("td:first-child").filter({ hasText: exact(String(id)) }) });
// Icon hành động của 1 dòng (chỉ có 1: Update)
const actionIcon = (row) => row.locator(".column-actions svg").first();

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const addBtn = (page) => page.getByRole("button", { name: /Add New/ });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const pageSizeSelect = (page) => page.locator(".ant-pagination-options .ant-select");
const toasts = (page) => page.locator(".Toastify__toast");
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
const filterEl = (page, id) => page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
const tooltip = (page, text) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: exact(text) });
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");

// Form Create / Update
const saveBtn = (page) => page.getByRole("button", { name: "Save", exact: true });
const cancelBtn = (page) => page.getByRole("button", { name: /Cancel$/ });
const nameInput = (page) => page.locator("#name");
const urlInput = (page) => page.locator("#url");
const categoryInput = (page) => page.locator("#category");
const typeSelect = (page) => page.locator(".ant-select").filter({ has: page.locator("#type") });
const publicRadio = (page, value) => page.locator("label.ant-radio-wrapper").filter({ hasText: exact(value ? "True" : "False") });
const roleBox = (page, h) => page.locator("label.ant-checkbox-wrapper").filter({ has: page.locator(`input[value="${h}"]`) });
const roleChecked = (page) => page.locator("input[type=checkbox]:checked");
const formErrors = (page) => page.locator(".ant-form-item-explain-error");
const rolesItem = (page) => page.locator(".ant-form-item").filter({ has: page.locator("input[type=checkbox]") });

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-table-wrapper .ant-spin-spinning")).toHaveCount(0);
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
  test.setTimeout(Math.max(test.info().timeout, 90000)); // không hạ timeout đã nới ở các test CRUD khi openPage được gọi lại giữa test
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
// Lưu ý: Reset CHỈ gọi lại API khi filter đang áp dụng khác mặc định.
async function resetBodies(page) {
  const bodies = [];
  const onRequest = (r) => {
    if (isList(r)) bodies.push(bodyOf(r));
  };
  page.on("request", onRequest);
  try {
    // Filter đang là mặc định thì Reset không gọi API -> chờ ngắn rồi đi tiếp (không treo tới hết timeout)
    const first = page.waitForRequest(isList, { timeout: 5000 }).catch(() => null);
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

// Toàn bộ ô của bảng ở trang hiện tại: [{ cells: [text...], tags: [[tag...]...], publicClass }]
const tableMatrix = (page) =>
  rows(page).evaluateAll((trs) =>
    trs.map((tr) => ({
      cells: [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()),
      tags: [...tr.children].map((td) => [...td.querySelectorAll(".ant-tag")].map((t) => t.innerText.trim())),
      publicClass: tr.children[4]?.querySelector(".ant-tag")?.className ?? "",
    })),
  );

// Mở dropdown của 1 filter bằng cách click vào LABEL (tiêu đề nổi) của ô.
// KHÔNG click giữa ô: với dropdown chọn nhiều, vị trí đó có thể rơi vào nút (x) của chip đã chọn -> xoá mất giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (theo text) của filter dạng dropdown (Type: chọn nhiều, Public: chọn 1) rồi đóng dropdown.
async function selectOption(page, id, text) {
  await openDropdown(page, id);
  await openOptions(page).filter({ hasText: exact(text) }).first().click();
  // Dropdown chọn nhiều không tự đóng và Esc cũng không đóng được -> click ra ngoài
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Gõ vào filter dạng input (Name / URL / Category): input bị ẩn cho tới khi click label
async function typeFilter(page, id, value) {
  await filterEl(page, id).locator("label").first().click();
  await filterEl(page, id).locator("input").fill(value);
}

// Giá trị đang chọn (chip) của 1 filter dropdown
const selectedTitles = (page, id) =>
  filterEl(page, id)
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
const MOCK_OK = { status: "success", messageCode: "SUCCESS", message: "OK", data: {} };

// --- Form Create / Update ---
// Từ danh sách vào form Create (bấm Add New)
async function openCreate(page) {
  await addBtn(page).click();
  await expect(page).toHaveURL(/\/admin\/permission\/create$/);
  await expect(breadcrumb(page)).toContainText("Create Permissions");
  await expect(nameInput(page)).toBeVisible();
}

// Từ danh sách vào màn hình Update của dòng i. Trả về permission/view response (data)
async function openUpdate(page, i) {
  // Lưu ý: sau khi vừa Save form Update (cùng phiên SPA) rồi mở lại Update, app KHÔNG gọi lại permission/view -> không chờ vô hạn
  const viewRes = page.waitForResponse(isView, { timeout: 8000 }).catch(() => null);
  await actionIcon(rowAt(page, i)).click();
  await expect(page).toHaveURL(/\/admin\/permission\/update\/\d+$/);
  const res = await viewRes;
  await expect(breadcrumb(page)).toContainText("Update Permissions");
  if (res) {
    const data = (await res.json()).data;
    await expect(nameInput(page)).toHaveValue(data.name);
    return data;
  }
  await expect(nameInput(page)).not.toHaveValue("");
  const hierarchyMap = [];
  for (const h of [1, 2, 3, 4]) if (await roleBox(page, h).locator("input").isChecked().catch(() => false)) hierarchyMap.push(h);
  return {
    id: Number(page.url().match(/(\d+)$/)[1]),
    name: await nameInput(page).inputValue(),
    url: await urlInput(page).inputValue(),
    category: await categoryInput(page).inputValue(),
    isPublic: !(await roleBox(page, 1).count()), // chỉ hiện ô Roles khi Public = False
    hierarchyMap,
  };
}

// Chọn Type trong form (theo nhãn, vd "Edit")
async function pickType(page, label) {
  await typeSelect(page).click();
  await openOptions(page).filter({ hasText: exact(label) }).first().click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Điền form hợp lệ. roles: mảng hierarchy (1..4), chỉ dùng khi isPublic = false
async function fillForm(page, { name, url, type, category, isPublic, roles = [] }) {
  await nameInput(page).fill(name);
  await urlInput(page).fill(url);
  await pickType(page, typeLabel(type));
  await categoryInput(page).fill(category);
  await publicRadio(page, isPublic).click();
  if (!isPublic) for (const h of roles) await roleBox(page, h).click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Administration > Permissions", () => {
  let writes;
  let allowedWrites; // request ghi được phép (chỉ các test dùng response giả; request KHÔNG tới server thật)

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, số dòng/trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__admin_permission_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/admin_permission_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__admin_permission_spec_cleared", "1");
    });
    writes = watchWrites(page);
    allowedWrites = [];
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
      test("Có tiêu đề 'Permissions'", async ({ page }) => {
        await expect(breadcrumb(page)).toHaveText("Permissions");
      });

      test("Có đủ 5 filter Name, URL, Category, Type, Public và 2 nút Search/Reset", async ({ page }) => {
        await expect(page.locator(".NextGen-filter-element")).toHaveCount(FILTERS.length);
        for (const [id, label] of FILTERS) await expect(filterEl(page, id), id).toContainText(label);
        await expect(searchBtn(page)).toBeVisible();
        await expect(resetBtn(page)).toBeVisible();
      });

      test("Name / URL / Category là ô nhập chữ; Type chọn nhiều giá trị; Public chọn 1 giá trị", async ({ page }) => {
        for (const id of ["name", "url", "category"]) {
          await expect(filterEl(page, id).locator("input"), id).toHaveCount(1);
          await expect(filterEl(page, id).locator(".ant-select"), id).toHaveCount(0);
        }
        await expect(filterEl(page, "types").locator(".ant-select-multiple")).toHaveCount(1);
        await expect(filterEl(page, "public").locator(".ant-select")).toHaveCount(1);
        await expect(filterEl(page, "public").locator(".ant-select-multiple")).toHaveCount(0);
        await expect(filterEl(page, "public").locator(".ant-select-allow-clear")).toHaveCount(1);
      });

      test("Giá trị filter mặc định: để trống", async ({ page }) => {
        for (const id of ["name", "url", "category"]) await expect(filterEl(page, id).locator("input")).toHaveValue("");
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
      });

      test("Có nút Add New + Manage Columns; không có Export, checkbox chọn dòng / thao tác hàng loạt", async ({ page }) => {
        await expect(addBtn(page)).toBeVisible();
        await expect(columnBtn(page)).toBeVisible();
        await expect(page.locator("button.NextGen-export-button")).toHaveCount(0);
        await expect(page.locator("button.NextGen-button-more-action__update")).toHaveCount(0);
        await expect(page.locator('.ant-table input[type="checkbox"]')).toHaveCount(0);
      });

      test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự`, async ({ page }) => {
        expect(await headers(page)).toEqual(COLUMNS);
      });

      test("Mặc định: trang 1, 10 dòng, sort id giảm dần, filters chỉ có sasEntityId = [1]", async ({ page }) => {
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
      test("Mỗi dòng khớp response API (ID, Name, URL, Type, Public, Category, Roles)", async ({ page }) => {
        const { json } = await search(page);
        const list = json.data.list;
        test.skip(list.length === 0, "Không có dữ liệu");
        await expect(rows(page)).toHaveCount(list.length);
        const matrix = await tableMatrix(page);
        for (const [i, x] of list.entries()) {
          const at = `dòng ${i + 1} (quyền ${x.id})`;
          const c = matrix[i].cells;
          expect(c[COL.id], at).toBe(String(x.id));
          expect(c[COL.name], at).toBe(norm(x.name));
          expect(c[COL.url], at).toBe(norm(x.url));
          expect(c[COL.type], at).toBe(x.type);
          expect(c[COL.public], at).toBe(x.isPublic ? "True" : "False");
          expect(c[COL.category], at).toBe(norm(x.category));
          expect(matrix[i].tags[COL.roles], at).toEqual(rolesOf(x));
        }
      });

      test("Mặc định sắp xếp ID giảm dần và ID không trùng nhau", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length < 2, "Không đủ dữ liệu");
        const ids = json.data.list.map((x) => x.id);
        expect(ids).toEqual([...ids].sort((a, b) => b - a));
        expect(new Set(ids).size).toBe(ids.length);
      });

      test("Mỗi quyền có Name, URL, Category không để trống và Type thuộc 9 loại hợp lệ", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        for (const x of json.data.list) {
          expect(x.name, `name của quyền ${x.id}`).toBeTruthy();
          expect(x.url, `url của quyền ${x.id}`).toBeTruthy();
          expect(x.category, `category của quyền ${x.id}`).toBeTruthy();
          expect(TYPE_FILTER_OPTIONS, `type của quyền ${x.id}`).toContain(x.type);
          expect(typeof x.isPublic, `isPublic của quyền ${x.id}`).toBe("boolean");
        }
      });

      test("Cột Public là tag True (xanh) / False (đỏ) đúng theo isPublic", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const matrix = await tableMatrix(page);
        for (const [i, x] of json.data.list.entries()) {
          expect(matrix[i].publicClass, `quyền ${x.id}`).toContain(x.isPublic ? "tag-success" : "tag-error");
        }
      });

      test("Quyền Public = True không có Roles; quyền Public = False có ít nhất 1 cấp (xét 200 quyền đầu)", async ({ page }) => {
        await pageSizeSelect(page).click();
        const { json } = await reloadFull(page, () => openOptions(page).filter({ hasText: "200 / page" }).click());
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const matrix = await tableMatrix(page);
        expect(matrix).toHaveLength(json.data.list.length);
        for (const [i, x] of json.data.list.entries()) {
          if (x.isPublic) expect(matrix[i].tags[COL.roles], `quyền public ${x.id}`).toEqual([]);
          else expect(matrix[i].tags[COL.roles].length, `quyền ${x.id} (không public) phải có Roles`).toBeGreaterThan(0);
          for (const h of x.hierarchyMap ?? []) expect(Object.keys(HIERARCHY), `hierarchyMap của quyền ${x.id}`).toContain(String(h));
        }
      });

      test("Mỗi dòng chỉ có 1 icon hành động Update (tooltip 'Update'); không có View / xoá", async ({ page }) => {
        const n = await rows(page).count();
        test.skip(n === 0, "Không có dữ liệu");
        for (let i = 0; i < n; i++) {
          await expect(rowAt(page, i).locator(".column-actions svg")).toHaveCount(1);
        }
        await actionIcon(rowAt(page, 0)).hover();
        await expect(tooltip(page, "Update")).toBeVisible();
      });
    });

    // ===== 3. Search / Filter =====
    test.describe("Search / Filter", () => {
      // Lấy 1 quyền có sẵn làm mẫu (dòng đầu danh sách)
      const sample = async (page) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        return json.data.list[0];
      };

      test("Gõ Name: gửi filters.name và mọi dòng có Name chứa chuỗi đó", async ({ page }) => {
        const x = await sample(page);
        const term = x.name.slice(0, 5);
        await typeFilter(page, "name", term);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ name: term, sasEntityId: [1] });
        expect(json.data.list.map((r) => r.id)).toContain(x.id);
        for (const r of json.data.list) expect(r.name.toLowerCase(), `quyền ${r.id}`).toContain(term.toLowerCase());
        expect(await columnValues(page, "Name")).toEqual(json.data.list.map((r) => norm(r.name)));
      });

      test("Name khớp 1 phần (giữa chuỗi) và không phân biệt hoa thường", async ({ page }) => {
        const x = await sample(page);
        test.skip(x.name.length < 8, "Name quá ngắn");
        const term = x.name.slice(3, 8).toLowerCase();
        await typeFilter(page, "name", term);
        const { body, json } = await search(page);
        expect(body.filters.name).toBe(term);
        expect(json.data.list.map((r) => r.id)).toContain(x.id);
        for (const r of json.data.list) expect(r.name.toLowerCase(), `quyền ${r.id}`).toContain(term);
      });

      test("Gõ URL: gửi filters.url và mọi dòng có URL chứa chuỗi đó", async ({ page }) => {
        const x = await sample(page);
        const term = x.url.slice(0, 10);
        await typeFilter(page, "url", term);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ url: term, sasEntityId: [1] });
        expect(json.data.list.map((r) => r.id)).toContain(x.id);
        for (const r of json.data.list) expect(r.url.toLowerCase(), `quyền ${r.id}`).toContain(term.toLowerCase());
      });

      test("Gõ Category: gửi filters.category và mọi dòng có Category chứa chuỗi đó (không phân biệt hoa thường)", async ({ page }) => {
        const x = await sample(page);
        const term = x.category.slice(0, 6).toLowerCase();
        await typeFilter(page, "category", term);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ category: term, sasEntityId: [1] });
        expect(json.data.list.map((r) => r.id)).toContain(x.id);
        for (const r of json.data.list) expect(r.category.toLowerCase(), `quyền ${r.id}`).toContain(term);
      });

      test("Dropdown Type có đủ 9 loại, xếp theo thứ tự chữ cái", async ({ page }) => {
        await openDropdown(page, "types");
        await expect(openOptions(page)).toHaveText(TYPE_FILTER_OPTIONS);
        await breadcrumb(page).click();
        await expect(openOptions(page)).toHaveCount(0);
      });

      test("Dropdown Public có 2 giá trị False, True", async ({ page }) => {
        await openDropdown(page, "public");
        await expect(openOptions(page)).toHaveText(["False", "True"]);
        await breadcrumb(page).click();
        await expect(openOptions(page)).toHaveCount(0);
      });

      test("Chọn Type = CREATE: gửi filters.types = ['CREATE'] và mọi dòng có Type CREATE", async ({ page }) => {
        await selectOption(page, "types", "CREATE");
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ types: ["CREATE"], sasEntityId: [1] });
        expect(json.data.totalCount).toBeGreaterThan(0);
        for (const r of json.data.list) expect(r.type, `quyền ${r.id}`).toBe("CREATE");
        expect(await columnValues(page, "Type")).toEqual(json.data.list.map(() => "CREATE"));
      });

      test("Chọn nhiều Type (CREATE + EDIT): gửi cả 2 giá trị, kết quả chỉ gồm 2 loại này và nhiều hơn khi chỉ chọn 1", async ({ page }) => {
        await selectOption(page, "types", "CREATE");
        const one = await search(page);
        await selectOption(page, "types", "EDIT");
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ types: ["CREATE", "EDIT"], sasEntityId: [1] });
        expect(await selectedTitles(page, "types")).toEqual(["CREATE", "EDIT"]);
        expect(json.data.totalCount).toBeGreaterThan(one.json.data.totalCount);
        for (const r of json.data.list) expect(["CREATE", "EDIT"], `quyền ${r.id}`).toContain(r.type);
      });

      test("Chọn Public = True: gửi filters.public = true (boolean), mọi dòng là True và không có Roles", async ({ page }) => {
        await selectOption(page, "public", "True");
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ public: true, sasEntityId: [1] });
        expect(json.data.totalCount).toBeGreaterThan(0);
        for (const r of json.data.list) expect(r.isPublic, `quyền ${r.id}`).toBe(true);
        expect(await columnValues(page, "Public")).toEqual(json.data.list.map(() => "True"));
        expect(await columnValues(page, "Roles")).toEqual(json.data.list.map(() => ""));
      });

      test("Chọn Public = False: gửi filters.public = false (boolean) và mọi dòng là False", async ({ page }) => {
        await selectOption(page, "public", "False");
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ public: false, sasEntityId: [1] });
        expect(json.data.totalCount).toBeGreaterThan(0);
        for (const r of json.data.list) expect(r.isPublic, `quyền ${r.id}`).toBe(false);
        expect(await columnValues(page, "Public")).toEqual(json.data.list.map(() => "False"));
      });

      test("Tổng số bản ghi Public True + Public False = tổng khi không lọc", async ({ page }) => {
        const all = await search(page);
        await selectOption(page, "public", "True");
        const t = await search(page);
        await selectOption(page, "public", "False");
        const f = await search(page);
        expect(t.json.data.totalCount + f.json.data.totalCount).toBe(all.json.data.totalCount);
      });

      test("Xoá Public bằng nút (x): filters không còn key public và bảng về đủ bản ghi", async ({ page }) => {
        const all = await search(page);
        await selectOption(page, "public", "True");
        await search(page);
        await filterEl(page, "public").hover();
        await filterEl(page, "public").locator(".ant-select-clear").click({ force: true });
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ sasEntityId: [1] });
        expect(json.data.totalCount).toBe(all.json.data.totalCount);
      });

      test("Kết hợp Name + Type + Public (AND): request mang đủ 3 filter, mọi dòng thoả cả 3", async ({ page }) => {
        const { json: base } = await search(page);
        const x = base.data.list.find((r) => !r.isPublic);
        test.skip(!x, "Trang đầu không có quyền Public = False");
        const term = x.name.slice(0, 4);
        await typeFilter(page, "name", term);
        await selectOption(page, "types", x.type);
        await selectOption(page, "public", "False");
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ name: term, types: [x.type], public: false, sasEntityId: [1] });
        expect(json.data.list.map((r) => r.id)).toContain(x.id);
        for (const r of json.data.list) {
          expect(r.name.toLowerCase(), `quyền ${r.id}`).toContain(term.toLowerCase());
          expect(r.type, `quyền ${r.id}`).toBe(x.type);
          expect(r.isPublic, `quyền ${r.id}`).toBe(false);
        }
      });

      test("Kết hợp URL + Category (AND): kết quả là giao của 2 filter", async ({ page }) => {
        const x = await sample(page);
        await typeFilter(page, "url", x.url.slice(0, 8));
        await typeFilter(page, "category", x.category.slice(0, 5));
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ url: x.url.slice(0, 8), category: x.category.slice(0, 5), sasEntityId: [1] });
        expect(json.data.list.map((r) => r.id)).toContain(x.id);
        for (const r of json.data.list) {
          expect(r.url.toLowerCase(), `quyền ${r.id}`).toContain(x.url.slice(0, 8).toLowerCase());
          expect(r.category.toLowerCase(), `quyền ${r.id}`).toContain(x.category.slice(0, 5).toLowerCase());
        }
      });

      test("Filter không có kết quả: hiện 'There are no entries found' và không có dòng nào", async ({ page }) => {
        await typeFilter(page, "name", `ZZ-NO-SUCH-${Date.now()}`);
        const { json } = await search(page);
        expect(json.data.totalCount).toBe(0);
        expect(json.data.list).toEqual([]);
        await expect(page.getByText(MSG.noEntries)).toBeVisible();
        await expect(rows(page)).toHaveCount(0);
      });

      test("Search khi đang ở trang 2 thì quay về trang 1", async ({ page }) => {
        test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
        await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        await selectOption(page, "types", "EDIT");
        const { body } = await search(page);
        expect(body).toMatchObject({ page: 1, filters: { types: ["EDIT"] } });
      });
    });

    // ===== 4. Reset =====
    test.describe("Reset", () => {
      test("Reset xoá mọi filter đã nhập / chọn và gửi lại request mặc định", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await typeFilter(page, "name", x.name.slice(0, 4));
        await typeFilter(page, "url", x.url.slice(0, 6));
        await typeFilter(page, "category", x.category.slice(0, 4));
        await selectOption(page, "types", x.type);
        await selectOption(page, "public", x.isPublic ? "True" : "False");
        await search(page);

        const bodies = await resetBodies(page);
        expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual(DEFAULT_BODY);
        for (const id of ["name", "url", "category"]) await expect(filterEl(page, id).locator("input")).toHaveValue("");
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
        await expect(summary(page)).toHaveText(new RegExp(`of ${json.data.totalCount} records$`));
        await expect(rows(page)).toHaveCount(Math.min(10, json.data.totalCount));
      });

      test("Reset đưa sort về mặc định (id giảm dần) và gửi lại request mặc định", async ({ page }) => {
        await search(page);
        await reloadBy(page, () => th(page, "Name").click());
        const body = await reloadBy(page, () => resetBtn(page).click());
        expect(body).toEqual(DEFAULT_BODY);
      });

      // HÀNH VI ĐÚNG (đã được user xác nhận): bấm Reset khi đang ở trang 2 thì filter bị xoá nhưng giữ nguyên trang đang xem
      // (request list gửi page=2, thanh phân trang vẫn ở trang 2); còn Search thì về trang 1.
      test("Reset khi đang ở trang 2 (có filter): xoá filter nhưng giữ nguyên trang 2", async ({ page }) => {
        test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
        await selectOption(page, "types", "EDIT");
        const { json } = await search(page);
        test.skip(json.data.totalCount <= 10, "Filter Type = EDIT chỉ có 1 trang");
        await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        const bodies = await resetBodies(page);
        expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual({ ...DEFAULT_BODY, page: 2 });
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
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
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
      });

      test("Next / Previous chuyển trang 1 <-> 2 và trang 2 không trùng dòng nào của trang 1", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 10, "Chỉ có 1 trang");
        const p1 = await columnValues(page, "ID");
        const next = await reloadFull(page, () => page.locator(".ant-pagination-next").click());
        expect(next.body).toMatchObject({ page: 2 });
        const p2 = await columnValues(page, "ID");
        expect(p2.filter((id) => p1.includes(id))).toEqual([]);
        const prev = await reloadBy(page, () => page.locator(".ant-pagination-prev button").click());
        expect(prev).toMatchObject({ page: 1 });
        expect(await columnValues(page, "ID")).toEqual(p1);
      });

      test("Trang cuối: gửi đúng số trang, dòng tóm tắt 'Showing x - N of N' và số dòng còn lại", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 10, "Chỉ có 1 trang");
        const last = Math.ceil(total / 10);
        // Các trang ở giữa bị rút gọn bằng "•••" nhưng trang cuối luôn có nút
        const { body, json } = await reloadFull(page, () => page.locator(`.ant-pagination-item-${last}`).click());
        expect(body).toMatchObject({ page: last, pageSize: 10 });
        const shown = total - (last - 1) * 10;
        expect(json.data.list).toHaveLength(shown);
        await expect(rows(page)).toHaveCount(shown);
        await expect(summary(page)).toHaveText(`Showing ${(last - 1) * 10 + 1} - ${total} of ${total} records`);
        await expect(page.locator(".ant-pagination-next")).toHaveClass(/ant-pagination-disabled/);
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
          const { body, json } = await reloadFull(page, () => openOptions(page).filter({ hasText: `${size} / page` }).click());
          expect(body).toMatchObject({ page: 1, pageSize: size });
          const shown = Math.min(size, total);
          expect(json.data.list).toHaveLength(shown);
          await expect(rows(page)).toHaveCount(shown);
          await expect(pageSizeSelect(page)).toContainText(`${size} / page`);
          if (shown > 0) await expect(summary(page)).toHaveText(`Showing 1 - ${shown} of ${total} records`);
        });
      }

      test("Giữ filter đang chọn khi chuyển trang / đổi số dòng", async ({ page }) => {
        await selectOption(page, "types", "EDIT");
        const { json } = await search(page);
        test.skip(json.data.totalCount <= 10, "Filter Type = EDIT chỉ có 1 trang");
        const next = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        expect(next).toMatchObject({ page: 2, filters: { types: ["EDIT"] } });
        await pageSizeSelect(page).click();
        const body = await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
        expect(body).toMatchObject({ pageSize: 20, filters: { types: ["EDIT"] } });
      });

      test("Giữ sort khi chuyển trang", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 10, "Chỉ có 1 trang");
        await reloadBy(page, () => th(page, "Name").click());
        const body = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        expect(body).toMatchObject({ page: 2, sortBy: "name", sortDirection: "asc" });
      });
    });

    // ===== 6. Sắp xếp =====
    test.describe("Sắp xếp", () => {
      // Cột ID là sort mặc định (id desc): click 1 = bỏ sort (KHÔNG gọi API), click 2 = asc, click 3 = desc
      test('Sort cột "ID": click 1 không gọi API, click 2 = asc, click 3 = desc', async ({ page }) => {
        await search(page);
        let calls = 0;
        const onRequest = (r) => {
          if (isList(r)) calls++;
        };
        page.on("request", onRequest);
        await th(page, "ID").click();
        await settle(page);
        page.off("request", onRequest);
        expect(calls, "Click đầu tiên vào cột ID (đang sort mặc định) không được gọi API").toBe(0);
        await expect(th(page, "ID")).not.toHaveClass(/ant-table-column-sort/);

        const b2 = await reloadBy(page, () => th(page, "ID").click());
        expect(b2).toMatchObject({ sortBy: "id", sortDirection: "asc", page: 1, pageSize: 10 });
        const b3 = await reloadBy(page, () => th(page, "ID").click());
        expect(b3).toMatchObject({ sortBy: "id", sortDirection: "desc" });
      });

      test('Sort cột "ID" tăng dần: ID trong bảng tăng dần theo response; giảm dần: giảm dần', async ({ page }) => {
        const { json: base } = await search(page);
        test.skip(base.data.list.length < 2, "Không đủ dữ liệu");
        await th(page, "ID").click(); // bỏ sort mặc định (không gọi API)
        await settle(page);
        const up = await reloadFull(page, () => th(page, "ID").click());
        const idsUp = up.json.data.list.map((x) => x.id);
        expect(idsUp).toEqual([...idsUp].sort(asc));
        expect((await columnValues(page, "ID")).map(Number)).toEqual(idsUp);
        const down = await reloadFull(page, () => th(page, "ID").click());
        const idsDown = down.json.data.list.map((x) => x.id);
        expect(idsDown).toEqual([...idsDown].sort((a, b) => b - a));
        expect((await columnValues(page, "ID")).map(Number)).toEqual(idsDown);
      });

      for (const [name, key] of Object.entries(SORTABLE).filter(([n]) => n !== "ID")) {
        test(`Sort cột "${name}": asc -> desc -> về mặc định (id desc)`, async ({ page }) => {
          await search(page);
          const b1 = await reloadBy(page, () => th(page, name).click());
          expect(b1).toMatchObject({ sortBy: key, sortDirection: "asc", page: 1, pageSize: 10 });
          const b2 = await reloadBy(page, () => th(page, name).click());
          expect(b2).toMatchObject({ sortBy: key, sortDirection: "desc" });
          const b3 = await reloadBy(page, () => th(page, name).click());
          expect(b3).toMatchObject({ sortBy: "id", sortDirection: "desc" });
        });

        test(`Sort cột "${name}": bảng hiển thị đúng thứ tự response (asc)`, async ({ page }) => {
          await search(page);
          const { json } = await reloadFull(page, () => th(page, name).click());
          test.skip(json.data.list.length === 0, "Không có dữ liệu");
          // Thứ tự chữ phụ thuộc collation của server nên chỉ kiểm tra bảng hiển thị đúng thứ tự response
          expect(await columnValues(page, name)).toEqual(json.data.list.map((x) => norm(x[key])));
        });
      }

      test("Giữ sort khi tìm kiếm với filter (Search không làm mất sort)", async ({ page }) => {
        await search(page);
        await reloadBy(page, () => th(page, "URL").click());
        await selectOption(page, "types", "EDIT");
        const { body } = await search(page);
        expect(body).toMatchObject({ sortBy: "url", sortDirection: "asc", filters: { types: ["EDIT"] } });
      });

      test("5 cột ID, Name, URL, Type, Category sort được; Public, Roles, Action không sort", async ({ page }) => {
        for (const c of COLUMNS) {
          if (c in SORTABLE) await expect(th(page, c), c).toHaveClass(/ant-table-column-has-sorters/);
          else await expect(th(page, c), c).not.toHaveClass(/ant-table-column-has-sorters/);
        }
      });
    });

    // ===== 7. Màn hình Update (không ghi dữ liệu thật) =====
    test.describe("Form Update (không ghi dữ liệu thật)", () => {
      // 1 quyền Public = False và 1 quyền Public = True ở trang đầu (chỉ để đọc form / gửi request GIẢ)
      const pick = async (page, isPublic) => {
        const { json } = await search(page);
        const i = json.data.list.findIndex((r) => r.isPublic === isPublic);
        test.skip(i < 0, `Trang đầu không có quyền Public = ${isPublic ? "True" : "False"}`);
        return { i, x: json.data.list[i] };
      };

      test("Icon Update của dòng đầu mở /admin/permission/update/{id}, gọi permission/view {id} và điền đúng form", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const viewReq = page.waitForRequest(isView);
        const data = await openUpdate(page, 0);
        expect(bodyOf(await viewReq)).toEqual({ id: x.id });
        await expect(page).toHaveURL(new RegExp(`/admin/permission/update/${x.id}$`));
        expect(data).toMatchObject({ id: x.id, name: x.name, url: x.url, type: x.type, category: x.category, isPublic: x.isPublic });
        await expect(breadcrumb(page)).toHaveText(/Permissions\s*>\s*Update Permissions/);
        await expect(nameInput(page)).toHaveValue(x.name);
        await expect(urlInput(page)).toHaveValue(x.url);
        await expect(categoryInput(page)).toHaveValue(x.category);
        await expect(typeSelect(page)).toContainText(typeLabel(x.type));
        await expect(publicRadio(page, x.isPublic).locator("input")).toBeChecked();
        await expect(publicRadio(page, !x.isPublic).locator("input")).not.toBeChecked();
      });

      test("Quyền Public = False: hiện ô Roles và tick đúng các cấp theo hierarchyMap", async ({ page }) => {
        const { i, x } = await pick(page, false);
        await openUpdate(page, i);
        for (const h of [1, 2, 3, 4]) {
          const box = roleBox(page, h).locator("input");
          if ((x.hierarchyMap ?? []).includes(h)) await expect(box, HIERARCHY[h]).toBeChecked();
          else await expect(box, HIERARCHY[h]).not.toBeChecked();
        }
        await expect(rolesItem(page)).toContainText("Roles");
        for (const label of Object.values(HIERARCHY)) await expect(rolesItem(page), label).toContainText(label);
      });

      test("Quyền Public = True: không hiện ô Roles; chọn False thì hiện Roles với 4 checkbox chưa tick", async ({ page }) => {
        const { i } = await pick(page, true);
        await openUpdate(page, i);
        await expect(page.locator("input[type=checkbox]")).toHaveCount(0);
        await publicRadio(page, false).click();
        await expect(page.locator("input[type=checkbox]")).toHaveCount(4);
        await expect(roleChecked(page)).toHaveCount(0);
        await publicRadio(page, true).click();
        await expect(page.locator("input[type=checkbox]")).toHaveCount(0);
      });

      test("Dropdown Type trong form có 9 loại (View, Create, Edit, Delete, Export, Bypass, Execute, Import, List)", async ({ page }) => {
        await search(page);
        await openUpdate(page, 0);
        await typeSelect(page).click();
        await expect(openOptions(page)).toHaveText(TYPE_FORM_OPTIONS);
        await page.keyboard.press("Escape");
      });

      test("Xoá trống Name / URL / Category rồi Save: báo 3 lỗi bắt buộc và KHÔNG gửi request update", async ({ page }) => {
        await search(page);
        await openUpdate(page, 0);
        await nameInput(page).fill("");
        await urlInput(page).fill("");
        await categoryInput(page).fill("");
        await saveBtn(page).click();
        await expect(formErrors(page)).toHaveText([MSG.name, MSG.url, MSG.category]);
        await expect(page).toHaveURL(/\/admin\/permission\/update\/\d+$/);
      });

      test("Quyền Public = False bỏ tick hết Roles rồi Save: báo lỗi ở ô Roles và KHÔNG gửi request update", async ({ page }) => {
        const { i, x } = await pick(page, false);
        test.skip(!(x.hierarchyMap ?? []).length, "Quyền không có cấp nào");
        await openUpdate(page, i);
        for (const h of x.hierarchyMap) await roleBox(page, h).click();
        await expect(roleChecked(page)).toHaveCount(0);
        await saveBtn(page).click();
        await expect(rolesItem(page).locator(".ant-form-item-explain-error")).toHaveText(MSG.status);
        await expect(page).toHaveURL(/\/admin\/permission\/update\/\d+$/);
      });

      test("Save quyền Public = False (giữ nguyên): gửi permission/update đủ trường + id, toast Success, về danh sách (request GIẢ)", async ({ page }) => {
        const { i, x } = await pick(page, false);
        await mockWrites(page, MOCK_OK);
        await openUpdate(page, i);
        const [req] = await Promise.all([page.waitForRequest(isUpdate), saveBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "permission/update", body }];
        expect(body).toEqual({
          id: x.id,
          name: x.name,
          url: x.url,
          type: x.type,
          category: x.category,
          isPublic: false,
          hierarchyMap: x.hierarchyMap,
        });
        await expect(toasts(page).filter({ hasText: "Success" })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/permission$/);
      });

      test("Save quyền Public = True (giữ nguyên): isPublic = true và không kèm Roles (request GIẢ)", async ({ page }) => {
        const { i, x } = await pick(page, true);
        await mockWrites(page, MOCK_OK);
        await openUpdate(page, i);
        const [req] = await Promise.all([page.waitForRequest(isUpdate), saveBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "permission/update", body }];
        expect(body).toMatchObject({ id: x.id, name: x.name, url: x.url, type: x.type, category: x.category, isPublic: true });
        expect(body.hierarchyMap ?? [], "Quyền Public không được kèm Roles").toEqual([]);
        await expect(page).toHaveURL(/\/admin\/permission$/);
      });

      test("Đổi Name / URL / Category / Type + thêm 1 cấp Roles rồi Save: payload mang đúng giá trị mới (request GIẢ)", async ({ page }) => {
        const { i, x } = await pick(page, false);
        const free = [1, 2, 3, 4].find((h) => !(x.hierarchyMap ?? []).includes(h));
        test.skip(!free, "Quyền đã có đủ 4 cấp");
        await mockWrites(page, MOCK_OK);
        await openUpdate(page, i);
        const type = x.type === "LIST" ? "VIEW" : "LIST";
        await nameInput(page).fill("QA_UI_FAKE_NAME");
        await urlInput(page).fill("/api/v1/qa-ui/fake");
        await categoryInput(page).fill("QA_UI_FAKE_CATEGORY");
        await pickType(page, typeLabel(type));
        await roleBox(page, free).click();
        const [req] = await Promise.all([page.waitForRequest(isUpdate), saveBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "permission/update", body }];
        expect(body).toMatchObject({ id: x.id, name: "QA_UI_FAKE_NAME", url: "/api/v1/qa-ui/fake", type, category: "QA_UI_FAKE_CATEGORY", isPublic: false });
        expect([...body.hierarchyMap].sort(asc)).toEqual([...x.hierarchyMap, free].sort(asc));
      });

      test("Cancel ở form Update về danh sách, không gửi request ghi", async ({ page }) => {
        await search(page);
        await openUpdate(page, 0);
        await nameInput(page).fill("QA_UI_FAKE_NAME");
        await cancelBtn(page).click();
        await expect(page).toHaveURL(/\/admin\/permission$/);
        await expect(table(page)).toBeVisible();
      });
    });

    // ===== 8. Form Add New (không ghi dữ liệu thật) =====
    test.describe("Form Add New (không ghi dữ liệu thật)", () => {
      test("Add New mở /admin/permission/create với tiêu đề 'Create Permissions' và đủ 5 ô (Public chưa chọn, chưa có Roles)", async ({ page }) => {
        await openCreate(page);
        await expect(breadcrumb(page)).toHaveText(/Permissions\s*>\s*Create Permissions/);
        await expect(page.locator("label").filter({ hasText: /^(Permission Name|API Url|Type|Category|Public)$/ })).toHaveText([
          "Permission Name",
          "API Url",
          "Type",
          "Category",
          "Public",
        ]);
        await expect(nameInput(page)).toHaveValue("");
        await expect(nameInput(page)).toHaveAttribute("placeholder", /Enter Name Permission/);
        await expect(urlInput(page)).toHaveAttribute("placeholder", "Enter the API URL");
        await expect(typeSelect(page)).toContainText("Enter Type Permission");
        await expect(categoryInput(page)).toHaveAttribute("placeholder", "Enter Category Permission");
        await expect(page.locator("label.ant-radio-wrapper-checked")).toHaveCount(0);
        await expect(page.locator("input[type=checkbox]")).toHaveCount(0);
        await expect(saveBtn(page)).toBeVisible();
        await expect(cancelBtn(page)).toBeVisible();
      });

      test("Save form trống: báo đủ 5 lỗi bắt buộc và KHÔNG gửi request create", async ({ page }) => {
        await openCreate(page);
        await saveBtn(page).click();
        await expect(formErrors(page)).toHaveText([MSG.name, MSG.url, MSG.type, MSG.category, MSG.status]);
        await expect(page).toHaveURL(/\/admin\/permission\/create$/);
      });

      test("Dropdown Type có 9 loại (View, Create, Edit, Delete, Export, Bypass, Execute, Import, List)", async ({ page }) => {
        await openCreate(page);
        await typeSelect(page).click();
        await expect(openOptions(page)).toHaveText(TYPE_FORM_OPTIONS);
        await page.keyboard.press("Escape");
      });

      test("Chọn Public = False hiện ô Roles (4 cấp, chưa tick); chọn True thì ẩn", async ({ page }) => {
        await openCreate(page);
        await publicRadio(page, false).click();
        await expect(page.locator("input[type=checkbox]")).toHaveCount(4);
        for (const label of Object.values(HIERARCHY)) await expect(rolesItem(page), label).toContainText(label);
        await expect(roleChecked(page)).toHaveCount(0);
        await publicRadio(page, true).click();
        await expect(page.locator("input[type=checkbox]")).toHaveCount(0);
      });

      test("Public = False nhưng chưa tick Roles: Save báo lỗi ở ô Roles và KHÔNG gửi request create", async ({ page }) => {
        await openCreate(page);
        await fillForm(page, { name: "QA_UI_FAKE", url: "/api/v1/qa-ui/fake", type: "VIEW", category: QA_CATEGORY, isPublic: false });
        await saveBtn(page).click();
        await expect(rolesItem(page).locator(".ant-form-item-explain-error")).toHaveText(MSG.status);
        await expect(page).toHaveURL(/\/admin\/permission\/create$/);
      });

      test("Nhập đủ Name / URL / Type / Category / Public = False + Roles: Save gửi permission/create đúng payload, toast Success, về danh sách (request GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        await openCreate(page);
        await fillForm(page, { name: "QA_UI_FAKE_A", url: "/api/v1/qa-ui/fake-a", type: "EDIT", category: QA_CATEGORY, isPublic: false, roles: [1, 4] });
        const [req] = await Promise.all([page.waitForRequest(isCreate), saveBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "permission/create", body }];
        expect(body).toEqual({
          name: "QA_UI_FAKE_A",
          url: "/api/v1/qa-ui/fake-a",
          type: "EDIT",
          category: QA_CATEGORY,
          isPublic: false,
          hierarchyMap: [1, 4],
        });
        await expect(toasts(page).filter({ hasText: "Success" })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/permission$/);
      });

      test("Public = True: payload không có hierarchyMap (request GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        await openCreate(page);
        await fillForm(page, { name: "QA_UI_FAKE_B", url: "/api/v1/qa-ui/fake-b", type: "VIEW", category: QA_CATEGORY, isPublic: true });
        const [req] = await Promise.all([page.waitForRequest(isCreate), saveBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "permission/create", body }];
        expect(body).toEqual({ name: "QA_UI_FAKE_B", url: "/api/v1/qa-ui/fake-b", type: "VIEW", category: QA_CATEGORY, isPublic: true });
        await expect(page).toHaveURL(/\/admin\/permission$/);
      });

      test("Type được gửi lên dạng IN HOA (chọn Bypass -> BYPASS) (request GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        await openCreate(page);
        await fillForm(page, { name: "QA_UI_FAKE_C", url: "/api/v1/qa-ui/fake-c", type: "BYPASS", category: QA_CATEGORY, isPublic: true });
        const [req] = await Promise.all([page.waitForRequest(isCreate), saveBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "permission/create", body }];
        expect(body.type).toBe("BYPASS");
      });

      test("Server báo lỗi khi tạo (response GIẢ): toast Error, ở lại form, dữ liệu đã nhập còn nguyên", async ({ page }) => {
        await mockWrites(page, { status: "fail", messageCode: "PERMISSION_EXIST", message: "PERMISSION_EXIST" });
        await openCreate(page);
        await fillForm(page, { name: "QA_UI_FAKE_D", url: "/api/v1/qa-ui/fake-d", type: "LIST", category: QA_CATEGORY, isPublic: true });
        const [req] = await Promise.all([page.waitForRequest(isCreate), saveBtn(page).click()]);
        allowedWrites = [{ url: "permission/create", body: bodyOf(req) }];
        await expect(toasts(page).filter({ hasText: "Error" })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/permission\/create$/);
        await expect(nameInput(page)).toHaveValue("QA_UI_FAKE_D");
      });

      test("Cancel ở form Create về danh sách, không gửi request ghi", async ({ page }) => {
        await openCreate(page);
        await nameInput(page).fill("QA_UI_FAKE_E");
        await cancelBtn(page).click();
        await expect(page).toHaveURL(/\/admin\/permission$/);
        await expect(table(page)).toBeVisible();
      });
    });

    // ===== 9. Manage Columns =====
    test.describe("Manage Columns", () => {
      // hasText dạng RegExp khớp CHÍNH XÁC tên cột
      const item = (page, name) =>
        columnPopover(page).locator(".NextGen-popover-manage-column__list__items", { hasText: exact(name) });

      test("Popover liệt kê đủ cột, tất cả đang được chọn", async ({ page }) => {
        await columnBtn(page).click();
        const names = await columnPopover(page).locator(".NextGen-popover-manage-column__list__items").allInnerTexts();
        expect(names.map((n) => n.trim())).toEqual(COLUMNS);
        await expect(columnPopover(page).locator("input[type=checkbox]:checked")).toHaveCount(COLUMNS.length);
      });

      test("Tooltip của nút Manage Columns", async ({ page }) => {
        await columnBtn(page).hover();
        await expect(tooltip(page, "Manage Columns")).toBeVisible();
      });

      test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
        await columnBtn(page).click();
        await item(page, "Category").locator("label").click();
        expect(await headers(page)).not.toContain("Category");
        expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

        await item(page, "Category").locator("label").click();
        expect(await headers(page)).toEqual(COLUMNS);
      });

      test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        const names = await columnValues(page, "Name");
        const urls = await columnValues(page, "URL");
        await columnBtn(page).click();
        await item(page, "Category").locator("label").click();
        expect(await columnValues(page, "Name")).toEqual(names);
        expect(await columnValues(page, "URL")).toEqual(urls);
        expect(await headers(page)).not.toContain("Category");
      });

      test("Cấu hình cột không được lưu: tải lại trang thì hiện đủ cột", async ({ page }) => {
        await columnBtn(page).click();
        await item(page, "Category").locator("label").click();
        expect(await headers(page)).not.toContain("Category");
        await openPage(page); // reload
        expect(await headers(page)).toEqual(COLUMNS);
      });
    });

    // ===== 10. Ghi nhớ filter =====
    test.describe("Ghi nhớ filter", () => {
      test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const term = x.name.slice(0, 5);
        await typeFilter(page, "name", term);
        await selectOption(page, "types", x.type);
        await search(page);
        await pageSizeSelect(page).click();
        await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

        const [req] = await Promise.all([page.waitForRequest(isList), openPage(page)]); // reload
        expect(bodyOf(req)).toMatchObject({ pageSize: 20, filters: { name: term, types: [x.type] } });
        await expect(filterEl(page, "name").locator("input")).toHaveValue(term);
        expect(await selectedTitles(page, "types")).toEqual([x.type]);
        await expect(pageSizeSelect(page)).toContainText("20 / page");
      });

      test("Sau Reset rồi reload: filter không còn được ghi nhớ", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await selectOption(page, "public", json.data.list[0].isPublic ? "True" : "False");
        await search(page);
        await reloadBy(page, () => resetBtn(page).click());

        await openPage(page); // reload
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
        await expect(rows(page)).toHaveCount(Math.min(10, json.data.totalCount));
      });
    });
  });

  // ===== NHÓM CRUD (GHI DỮ LIỆU THẬT trên quyền QA) =====
  test.describe("CRUD (ghi dữ liệu thật trên quyền QA, luôn khôi phục lại)", () => {
    test.skip(!RUN_FULL_TESTS, SKIP_WRITE_REASON);
    test.describe.configure({ mode: "serial" });

    let qa; // { id, name, url, type, category, hierarchyMap } - quyền QA gốc (name QA_UI_PERM_<ts>, Public = False, Roles = Admin)

    // Lọc danh sách theo Name của quyền QA (bỏ qua bước gõ nếu filter đã được app ghi nhớ) rồi Search. Trả về { body, json }
    async function filterQa(page, name) {
      if ((await filterEl(page, "name").locator("input").inputValue().catch(() => "")) !== name) await typeFilter(page, "name", name);
      return search(page);
    }

    // Tìm quyền QA (QA_UI_PERM_<số>) trong danh sách. Trả về null nếu chưa có
    async function findQa(page) {
      const { json } = await filterQa(page, QA_PREFIX);
      const x = json.data.list.find((r) => new RegExp(`^${QA_PREFIX}\\d+$`).test(r.name));
      return x ? { id: x.id, name: x.name, url: x.url, type: x.type, category: x.category, isPublic: x.isPublic, hierarchyMap: x.hierarchyMap } : null;
    }

    // Mở lại danh sách (reload), lọc theo quyền QA (theo name hiện tại) và mở màn hình Update. Trả về permission/view (data)
    async function openQaUpdate(page, name = qa.name) {
      await openPage(page);
      await filterQa(page, name);
      const i = await rows(page).evaluateAll((trs, id) => trs.findIndex((tr) => tr.children[0].innerText.trim() === String(id)), qa.id);
      expect(i, `Không thấy quyền QA ${qa.id} trong danh sách`).toBeGreaterThanOrEqual(0);
      return openUpdate(page, i);
    }

    // Lưu form Update và kiểm tra request / response permission/update. Chỉ gửi lên đúng quyền QA
    async function saveUpdate(page, fields) {
      const [req, res] = await Promise.all([page.waitForRequest(isUpdate), page.waitForResponse(isUpdate), saveBtn(page).click()]);
      const body = bodyOf(req);
      expect(body).toMatchObject({ id: qa.id, ...fields });
      const json = await res.json();
      expect(json.status, JSON.stringify(json)).toBe("success");
      await expect(page).toHaveURL(/\/admin\/permission$/);
      return body;
    }

    // Đưa quyền QA về giá trị gốc (nếu bị đổi). Dùng trong finally / afterAll; chỉ ghi lên đúng quyền QA
    async function restoreQa(page) {
      await openPage(page);
      const cur = await findQaById(page);
      if (!cur) return;
      const same =
        cur.name === qa.name &&
        cur.url === qa.url &&
        cur.type === qa.type &&
        cur.category === qa.category &&
        cur.isPublic === qa.isPublic &&
        JSON.stringify([...(cur.hierarchyMap ?? [])].sort(asc)) === JSON.stringify([...(qa.hierarchyMap ?? [])].sort(asc));
      if (same) return;
      await openQaUpdate(page, cur.name);
      await nameInput(page).fill(qa.name);
      await urlInput(page).fill(qa.url);
      await categoryInput(page).fill(qa.category);
      if (cur.type !== qa.type) await pickType(page, typeLabel(qa.type));
      if (cur.isPublic !== qa.isPublic) await publicRadio(page, qa.isPublic).click();
      if (!qa.isPublic) {
        for (const h of [1, 2, 3, 4]) {
          const want = (qa.hierarchyMap ?? []).includes(h);
          if ((await roleBox(page, h).locator("input").isChecked()) !== want) await roleBox(page, h).click();
        }
      }
      await saveUpdate(page, { name: qa.name, url: qa.url, category: qa.category, isPublic: qa.isPublic });
    }

    // Tìm quyền QA theo id (kể cả khi đang bị đổi tên giữa chừng): lọc theo category QA_UI_CATEGORY hoặc theo tiền tố tên
    async function findQaById(page) {
      for (const [id, term] of [["name", QA_PREFIX], ["category", qa.category]]) {
        await typeFilter(page, id, term);
        const { json } = await search(page);
        const x = json.data.list.find((r) => r.id === qa.id);
        if (x) return x;
        await resetBodies(page).catch(() => {});
      }
      return null;
    }

    test.afterAll(async ({ browser }) => {
      test.setTimeout(120000);
      if (!qa) return;
      const ctx = await browser.newContext({ storageState: buildStorageState(), viewport: VIEWPORT });
      const page = await ctx.newPage();
      try {
        await page.addInitScript(() => {
          for (const k of Object.keys(localStorage)) if (/admin_permission_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
        });
        await restoreQa(page);
      } finally {
        await ctx.close();
      }
    });

    test.beforeEach(async ({ page }) => {
      await openPage(page);
      // Test CRUD gồm nhiều lần tải trang + khôi phục quyền QA trong finally -> cần timeout dài hơn mặc định
      test.setTimeout(240000);
    });

    // Mọi request ghi của nhóm này chỉ được nhắm vào quyền QA (không bao giờ sửa quyền có sẵn của team)
    test.afterEach(async () => {
      for (const w of writes) {
        expect(["permission/update", "permission/create"], "URL ghi không nằm trong danh sách").toContain(w.url);
        if (w.url === "permission/update") expect(w.body.id, "permission/update phải nhắm đúng quyền QA").toBe(qa.id);
        if (w.url === "permission/create") {
          expect(w.body.name, "permission/create chỉ dùng name QA_UI_PERM_...").toMatch(new RegExp(`^${QA_PREFIX}\\d+$`));
          expect(w.body.category, "permission/create chỉ dùng category QA").toBe(QA_CATEGORY);
        }
      }
    });

    test("Tạo quyền QA (chỉ khi CHƯA có quyền QA_UI_PERM_ nào - quyền không xoá được bằng UI): Save gửi permission/create, về danh sách, dòng mới có đủ giá trị", async ({ page }) => {
      qa = await findQa(page);
      test.skip(!!qa, `Đã có quyền QA ${qa?.name} (do lần chạy trước tạo) - không tạo thêm vì màn hình không có chức năng xoá`);

      await resetBodies(page);
      await openCreate(page);
      const name = `${QA_PREFIX}${Date.now()}`;
      const url = `/api/v1/qa-ui/${Date.now()}`;
      await fillForm(page, { name, url, type: "VIEW", category: QA_CATEGORY, isPublic: false, roles: [1] });
      const [req, res] = await Promise.all([page.waitForRequest(isCreate), page.waitForResponse(isCreate), saveBtn(page).click()]);
      expect(bodyOf(req)).toEqual({ name, url, type: "VIEW", category: QA_CATEGORY, isPublic: false, hierarchyMap: [1] });
      const json = await res.json();
      expect(json.status, JSON.stringify(json)).toBe("success");
      await expect(page).toHaveURL(/\/admin\/permission$/);
      await expect(toasts(page).filter({ hasText: "Success" })).toBeVisible();
      await settle(page);

      // Quyền mới có ID lớn nhất -> ở đầu danh sách mặc định (id desc)
      const row = rows(page).filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await expect(row.locator("td").nth(COL.url)).toHaveText(url);
      await expect(row.locator("td").nth(COL.type)).toHaveText("VIEW");
      await expect(row.locator("td").nth(COL.public)).toHaveText("False");
      await expect(row.locator("td").nth(COL.category)).toHaveText(QA_CATEGORY);
      await expect(row.locator("td").nth(COL.roles).locator(".ant-tag")).toHaveText(["Admin"]);
      qa = await findQa(page);
      expect(qa, "Không tìm thấy quyền QA vừa tạo qua filter Name").not.toBeNull();
      expect(qa.name).toBe(name);
    });

    test("Tìm được quyền QA bằng filter Name / Category / URL và form Update hiển thị đúng giá trị", async ({ page }) => {
      qa = qa ?? (await findQa(page));
      test.skip(!qa, "Chưa có quyền QA");
      await resetBodies(page);
      for (const [id, term] of [["category", qa.category], ["url", qa.url]]) {
        await typeFilter(page, id, term);
        const { json } = await search(page);
        expect(json.data.list.map((r) => r.id), id).toContain(qa.id);
        await resetBodies(page);
      }
      const data = await openQaUpdate(page);
      expect(data).toMatchObject({ id: qa.id, name: qa.name, url: qa.url, type: qa.type, category: qa.category, isPublic: false });
      await expect(typeSelect(page)).toContainText(typeLabel(qa.type));
      await expect(roleBox(page, 1).locator("input")).toBeChecked();
    });

    test("Sửa Name / URL / Category: Save gửi permission/update, toast Success, về danh sách, dòng đổi giá trị; rồi khôi phục", async ({ page }) => {
      test.skip(!qa, "Chưa có quyền QA");
      const edited = { name: `${qa.name}_E`, url: `${qa.url}/e`, category: `${QA_CATEGORY}_E` };
      try {
        await openQaUpdate(page);
        await nameInput(page).fill(edited.name);
        await urlInput(page).fill(edited.url);
        await categoryInput(page).fill(edited.category);
        await saveUpdate(page, { ...edited, type: qa.type, isPublic: false, hierarchyMap: [1] });
        await expect(toasts(page).filter({ hasText: "Success" })).toBeVisible();

        await settle(page);
        await resetBodies(page);
        await typeFilter(page, "name", edited.name);
        const { json } = await search(page);
        expect(json.data.list[0]).toMatchObject({ id: qa.id, ...edited });
        await expect(cellAt(page, 0, COL.name)).toHaveText(edited.name);
        await expect(cellAt(page, 0, COL.url)).toHaveText(edited.url);
        await expect(cellAt(page, 0, COL.category)).toHaveText(edited.category);
        // Mở lại form Update: hiển thị giá trị mới
        const data = await openUpdate(page, 0);
        expect(data).toMatchObject(edited);
      } finally {
        await restoreQa(page);
      }
      await openPage(page);
      await resetBodies(page).catch(() => {});
      const { json } = await filterQa(page, qa.name);
      expect(json.data.list.find((r) => r.id === qa.id)).toMatchObject({ name: qa.name, url: qa.url, category: qa.category });
    });

    test("Đổi Type: Save rồi cột Type đổi theo; khôi phục Type gốc", async ({ page }) => {
      test.skip(!qa, "Chưa có quyền QA");
      const newType = qa.type === "LIST" ? "VIEW" : "LIST";
      try {
        await openQaUpdate(page);
        await pickType(page, typeLabel(newType));
        await saveUpdate(page, { type: newType, name: qa.name });
        await settle(page);
        const { json } = await filterQa(page, qa.name);
        expect(json.data.list.find((r) => r.id === qa.id).type).toBe(newType);
        await expect(rowOfId(page, qa.id).locator("td").nth(COL.type)).toHaveText(newType);
      } finally {
        await restoreQa(page);
      }
    });

    test("Thêm cấp Agent vào Roles: Save, cột Roles hiện 'Admin' + 'Agent'; rồi bỏ lại (khôi phục)", async ({ page }) => {
      test.skip(!qa, "Chưa có quyền QA");
      try {
        await openQaUpdate(page);
        await roleBox(page, 4).click();
        await expect(roleBox(page, 4).locator("input")).toBeChecked();
        const body = await saveUpdate(page, { name: qa.name, isPublic: false });
        expect([...body.hierarchyMap].sort(asc)).toEqual([1, 4]);
        await settle(page);
        const { json } = await filterQa(page, qa.name);
        expect([...json.data.list.find((r) => r.id === qa.id).hierarchyMap].sort(asc)).toEqual([1, 4]);
        await expect(rowOfId(page, qa.id).locator("td").nth(COL.roles).locator(".ant-tag")).toHaveText(["Admin", "Agent"]);
        const view = await openUpdate(page, await rows(page).evaluateAll((trs, id) => trs.findIndex((tr) => tr.children[0].innerText.trim() === String(id)), qa.id));
        expect([...view.hierarchyMap].sort(asc)).toEqual([1, 4]);
        await expect(roleBox(page, 4).locator("input")).toBeChecked();
      } finally {
        await restoreQa(page);
      }
    });

    test("Đổi Public thành True: Save, dòng có Public = True và Roles trống; rồi trả về False + Admin (khôi phục)", async ({ page }) => {
      test.skip(!qa, "Chưa có quyền QA");
      try {
        await openQaUpdate(page);
        await publicRadio(page, true).click();
        await expect(page.locator("input[type=checkbox]")).toHaveCount(0);
        const body = await saveUpdate(page, { name: qa.name, isPublic: true });
        expect(body.hierarchyMap ?? [], "Quyền Public không được kèm Roles").toEqual([]);
        await settle(page);
        const { json } = await filterQa(page, qa.name);
        expect(json.data.list.find((r) => r.id === qa.id)).toMatchObject({ isPublic: true });
        await expect(rowOfId(page, qa.id).locator("td").nth(COL.public)).toHaveText("True");
        await expect(rowOfId(page, qa.id).locator("td").nth(COL.roles).locator(".ant-tag")).toHaveCount(0);
      } finally {
        await restoreQa(page);
      }
      await filterQa(page, qa.name);
      await expect(rowOfId(page, qa.id).locator("td").nth(COL.public)).toHaveText("False");
      await expect(rowOfId(page, qa.id).locator("td").nth(COL.roles).locator(".ant-tag")).toHaveText(["Admin"]);
    });
  });
});
