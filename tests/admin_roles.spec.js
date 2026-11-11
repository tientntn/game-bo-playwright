// Administration > Roles  (https://dev-bo.royaledge.io/admin/roles)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/admin_roles.spec.js --project=setup --project=chromium
//
// Màn hình danh sách "Roles" của cấp Super Admin (API role/list, filters.sasEntityId luôn = [1]; role không thuộc house / master agent / agent nào).
//  - Filter (cả 2 đều chọn NHIỀU giá trị): Role Name ("nameIds") và Role Code ("codeIds") là id ROLE, nạp bằng user/dropdown_role_list
//    (10 option đầu sắp theo name / code tăng dần; gõ chữ thì tìm phía server qua filters.name / filters.code).
//  - Bảng chỉ có 3 cột: Role Name / Role Code / Action (KHÔNG có cột ID). Role Name và Role Code sort được (sortBy name | code);
//    sort mặc định là id giảm dần (không hiện trên cột nào): click 1 = asc, click 2 = desc, click 3 = về mặc định (id desc).
//  - Cột Action có 2 icon: View (/admin/roles/view/{id}, chỉ xem) và Update (/admin/roles/update/{id}). KHÔNG có nút xoá role,
//    không có Export / checkbox chọn dòng.
//  - Add New -> /admin/roles/create: Role Name (3-50 ký tự), Role Code (3-50 ký tự), Permission (cây checkbox từ permission/list {sasEntityHierarchyIds:[1]};
//    bắt buộc chọn ít nhất 1 quyền; có "Access all", checkbox từng nhóm, checkbox từng quyền). Save gọi role/create.
//    Sau khi lưu / Cancel app quay lại bằng lịch sử trình duyệt (history back) nên phải đi vào form từ màn hình danh sách (bấm Add New / icon), không goto thẳng URL.
//  - Update: sửa được Name / Code / Permission; Save gọi role/edit {sasEntityId, name, code, id, permissionIds}.
//
// AN TOÀN DỮ LIỆU:
//  - Mọi describe trừ cuối là "chỉ đọc": request ghi (role/create, role/edit) bị chặn ở tầng mạng (route.abort); test kiểm tra payload / thông báo
//    dùng route.fulfill trả response GIẢ (request KHÔNG tới server). afterEach so sánh chính xác request ghi bắt được (watchWrites) với danh sách
//    được phép (allowedWrites). Bản ghi có sẵn của team chỉ bị thao tác bằng request GIẢ, không bao giờ bị ghi thật.
//  - Describe cuối "CRUD (ghi dữ liệu thật)" được gắn cờ RUN_FULL_TESTS (tests/helpers/flags.js, xem RUN_FULL_TESTS.md):
//    RUN_FULL_TESTS=false (mặc định) -> cả nhóm bị skip, KHÔNG gửi request ghi nào; =true -> mới chạy.
//    Nhóm này chạy tuần tự, CHỈ thao tác trên 1 role QA (code bắt đầu bằng "QAAUTO", name "QA-AUTO-..."):
//      * Màn hình KHÔNG có chức năng xoá role -> role QA KHÔNG dọn được bằng UI, nên test chỉ TẠO role QA khi chưa có role nào (tối đa 1 lần trong cả vòng đời),
//        các lần chạy sau dùng lại role đó. Sửa tên / quyền xong luôn KHÔNG để lại thay đổi (khôi phục trong finally + afterAll).
//        (Các role "QA_AUTO_..." / "ZZ_AUDIT_ROLE" có sẵn trong danh sách là của bộ test API, KHÔNG bị test này đụng tới ngoài việc đọc.)
//      * Test tạo trùng Name / Code với role có sẵn: server từ chối (ROLE_NAME_EXIST / ROLE_CODE_EXIST) nên không ghi gì.
//      * afterEach kiểm tra mọi request ghi chỉ nhắm vào role QA này (role/edit có id = id role QA; role/create chỉ với name / code của role QA).
//  - Không hard-code dữ liệu: role / quyền đều lấy từ response list và dropdown.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");
const { RUN_FULL_TESTS, SKIP_WRITE_REASON } = require("./helpers/flags");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/admin/roles";
const ORIGIN = "https://dev-bo.royaledge.io";

// Đúng thứ tự hiển thị
const COLUMNS = ["Role Name", "Role Code", "Action"];
const COL = { name: 0, code: 1, action: 2 };
const FILTERS = [
  ["nameIds", "Role Name"],
  ["codeIds", "Role Code"],
];
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
const DEFAULT_BODY = {
  page: 1,
  pageSize: 10,
  sortBy: "id",
  sortDirection: "desc",
  filters: { sasEntityId: [1] },
};
const SORTABLE = { "Role Name": "name", "Role Code": "code" };
const QA_PREFIX = "QAAUTO"; // code của role QA (name: "QA-AUTO-<timestamp>")

// Thông báo của form / toast (đọc từ màn hình thật)
const MSG = {
  required: "This field is required",
  nameRule: "Please enter only 3-50 Characters, Letters, Numbers, Spaces, or Spaces Only.",
  codeRule: "Please enter only 3-50 Characters, Letters, Numbers or Underscores Only.",
  nameExist: "Role name already exists",
  codeExist: "Role code already exists",
  updated: "Successfully Updated",
  noEntries: "There are no entries found",
};

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI (role/create, role/edit)
const READ = /\/(list|details|download|view)(\?|$)|\/dropdown\/|_dropdown(\?|$)|dropdown_role_list(\?|$)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/role/list");
const isView = endsWith("/role/view");
const isCreate = endsWith("/role/create");
const isEdit = endsWith("/role/edit");
const isRoleDropdown = endsWith("/user/dropdown_role_list"); // dropdown của filter Name / Code
const isPermissionList = endsWith("/permission/list");

const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};
const asc = (a, b) => a - b;

// Bảng chính (luôn là .ant-table đầu tiên trong DOM)
const table = (page) => page.locator(".ant-table").first();
const rows = (page) => table(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
const th = (page, name) => table(page).locator("thead th").filter({ hasText: exact(name) });
// Icon hành động của 1 dòng: 0 = View, 1 = Update
const actionIcon = (row, i) => row.locator(".column-actions svg").nth(i);

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
const codeInput = (page) => page.locator("#code");
const formErrors = (page) => page.locator(".ant-form-item-explain-error");
const accessAll = (page) => page.locator(".ant-card-head input[type=checkbox]");
const group = (page, key) => page.locator(`#permissions_${key}`);
const childBoxes = (page, key) => group(page, key).locator("input[type=checkbox]");
// Checkbox của cả nhóm (nằm ở cột bên trái của cùng hàng với #permissions_<KEY>)
const groupBox = (page, key) =>
  group(page, key).locator("xpath=ancestor::div[contains(@class,'ant-col-sm-12')][1]/preceding-sibling::div[1]//input[@type='checkbox']");
const allBoxes = (page) => page.locator(".ant-card").nth(1).locator("input[type=checkbox]");
const permBox = (page, id) => page.locator(`input[type=checkbox][value="${id}"]`);

// Danh sách phẳng { key, action, id } từ response permission/list (hoặc role/view.permissions)
const flatPerms = (data) =>
  Object.entries(data).flatMap(([key, acts]) => Object.entries(acts).map(([action, v]) => ({ key, action, id: v.id, value: v.value })));

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
// Chỉ tính spinner của bảng: các ô filter Name / Code (tìm phía server) cũng có thể hiện spinner khi đang nạp option
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
// Lưu ý: Reset CHỈ gọi lại API khi filter đang áp dụng khác mặc định.
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
// KHÔNG click giữa ô: với dropdown chọn nhiều, vị trí đó có thể rơi vào nút (x) của chip đã chọn -> xoá mất giá trị đang chọn.
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (theo text) của filter dạng dropdown chọn nhiều rồi đóng dropdown.
// Gõ text vào ô tìm kiếm trước để option chắc chắn nằm trong danh sách hiển thị (danh sách tìm phía server).
async function selectOption(page, id, text) {
  await openDropdown(page, id);
  await page.keyboard.type(text);
  await openOptions(page).filter({ hasText: exact(text) }).first().click();
  // Dropdown chọn nhiều không tự đóng và Esc cũng không đóng được -> click ra ngoài
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Giá trị đang chọn (chip) của 1 filter
const selectedTitles = (page, id) =>
  filterEl(page, id)
    .locator(".ant-select-selection-item[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));

// Tổng số giá trị đang chọn của 1 filter chọn nhiều: ô chỉ hiện 1 chip + chip "+ N ..." (không có title) nên cộng cả hai.
async function selectedCount(page, id) {
  const shown = await filterEl(page, id)
    .locator('.ant-select-selection-overflow-item:not([aria-hidden="true"]) .ant-select-selection-item[title]')
    .count();
  const rest = await filterEl(page, id).locator(".ant-select-selection-overflow-item-rest").allInnerTexts();
  const hidden = rest.reduce((sum, t) => sum + Number(t.match(/\+\s*(\d+)/)?.[1] ?? 0), 0);
  return shown + hidden;
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

const MOCK_OK = { status: "success", messageCode: "SUCCESS", message: "OK", data: {} };
const MOCK_NAME_EXIST = { status: "fail", messageCode: "ROLE_NAME_EXIST", message: "ROLE_NAME_EXIST" };
const MOCK_CODE_EXIST = { status: "fail", messageCode: "ROLE_CODE_EXIST", message: "ROLE_CODE_EXIST" };

// --- Form Create / Update ---
// Đi từ danh sách vào form Create (bấm Add New), chờ cây quyền tải xong. Trả về { perms } (data của permission/list)
async function openCreate(page) {
  const permsRes = page.waitForResponse(isPermissionList);
  await addBtn(page).click();
  await expect(page).toHaveURL(/\/admin\/roles\/create$/);
  const perms = (await (await permsRes).json()).data;
  await expect(nameInput(page)).toBeVisible();
  await expect(allBoxes(page).first()).toBeVisible();
  return { perms };
}

// Từ danh sách vào màn hình View / Update của dòng i. Trả về role/view response (data)
// Lưu ý: permission/list chỉ được gọi LẦN ĐẦU sau mỗi lần tải trang (app cache lại, mở form lần 2 trong cùng trang không gọi nữa)
// -> truyền { perms: false } khi đã mở form 1 lần trong trang này.
async function openRowAction(page, i, icon, { perms = icon === 1 } = {}) {
  const viewRes = page.waitForResponse(isView);
  const permsRes = perms ? page.waitForResponse(isPermissionList) : null;
  await actionIcon(rowAt(page, i), icon).click();
  await expect(page).toHaveURL(icon === 0 ? /\/admin\/roles\/view\/\d+$/ : /\/admin\/roles\/update\/\d+$/);
  const data = (await (await viewRes).json()).data;
  // Màn hình Update còn gọi permission/list (toàn bộ quyền có thể gán) -> trả về kèm theo ở data.allPerms
  const allPerms = permsRes ? (await (await permsRes).json()).data : null;
  await expect(breadcrumb(page)).toContainText(icon === 0 ? "Role View" : "Role Update");
  return Object.assign(data, { allPerms });
}

// Điền form hợp lệ (name + code + 1 quyền) - chỉ dùng với request GIẢ / bị chặn / role QA
async function fillValidForm(page, { name, code, permId } = {}) {
  await nameInput(page).fill(name ?? `QA-AUTO-${Date.now()}`);
  await codeInput(page).fill(code ?? `${QA_PREFIX}${Date.now()}`);
  if (permId) await permBox(page, permId).click();
}

// Payload role/create mong đợi của form đã điền (sasEntityId = cấp Super Admin = 1)
const createBody = ({ name, code, permissionIds }) => ({ sasEntityId: 1, name, code, permissionIds });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Administration > Roles", () => {
  let writes;
  let allowedWrites; // request ghi được phép (chỉ các test dùng response giả; request KHÔNG tới server thật)
  let roleOptions; // { name, code }: promise của response user/dropdown_role_list (sortBy name / code) lúc mở trang

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, số dòng/trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__admin_roles_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/admin_roles_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__admin_roles_spec_cleared", "1");
    });
    writes = watchWrites(page);
    allowedWrites = [];
    roleOptions = {};
    for (const key of ["name", "code"]) {
      roleOptions[key] = page.waitForResponse((r) => isRoleDropdown(r) && bodyOf(reqOf(r)).sortBy === key, { timeout: 60000 });
      roleOptions[key].catch(() => {});
    }
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
      test("Có tiêu đề 'Roles'", async ({ page }) => {
        await expect(breadcrumb(page)).toHaveText("Roles");
      });

      test("Có đủ 2 filter Role Name, Role Code và 2 nút Search/Reset", async ({ page }) => {
        await expect(page.locator(".NextGen-filter-element")).toHaveCount(FILTERS.length);
        for (const [id, label] of FILTERS) await expect(filterEl(page, id), id).toContainText(label);
        await expect(searchBtn(page)).toBeVisible();
        await expect(resetBtn(page)).toBeVisible();
      });

      test("Giá trị filter mặc định: để trống", async ({ page }) => {
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
      });

      test("Cả 2 filter là dropdown chọn nhiều giá trị, có tìm kiếm và nút xoá (x)", async ({ page }) => {
        for (const [id] of FILTERS) {
          await expect(filterEl(page, id).locator(".ant-select-multiple"), id).toHaveCount(1);
          await expect(filterEl(page, id).locator(".ant-select-show-search"), id).toHaveCount(1);
          await expect(filterEl(page, id).locator(".ant-select-allow-clear"), id).toHaveCount(1);
        }
      });

      test("Có nút Add New + Manage Columns; không có Export, checkbox chọn dòng / thao tác hàng loạt", async ({ page }) => {
        await expect(addBtn(page)).toBeVisible();
        await expect(columnBtn(page)).toBeVisible();
        await expect(page.locator("button.NextGen-export-button")).toHaveCount(0);
        await expect(page.locator("button.NextGen-button-more-action__update")).toHaveCount(0);
        await expect(page.locator('.ant-table input[type="checkbox"]')).toHaveCount(0);
      });

      test(`Bảng có đủ ${COLUMNS.length} cột đúng thứ tự (không có cột ID)`, async ({ page }) => {
        expect(await headers(page)).toEqual(COLUMNS);
      });

      test("Mặc định: trang 1, 10 dòng, sort id giảm dần, filters chỉ có sasEntityId = [1]", async ({ page }) => {
        const { body, status, json } = await search(page);
        expect(status).toBe(200);
        expect(body).toEqual(DEFAULT_BODY);
        expect(json.status).toBe("success");
        expect(json.data.list.length).toBeLessThanOrEqual(10);
      });

      test("Lúc mở màn hình gọi dropdown Name / Code (user/dropdown_role_list, sasEntityId = 1, sort tăng dần)", async ({ page }) => {
        for (const key of ["name", "code"]) {
          const res = await roleOptions[key];
          expect(res.status()).toBe(200);
          expect(bodyOf(reqOf(res))).toEqual({
            page: 1,
            pageSize: 10,
            sortBy: key,
            sortDirection: "asc",
            filters: { sasEntityId: 1 },
          });
        }
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
      test("Mỗi dòng khớp response API (Role Name, Role Code)", async ({ page }) => {
        const { json } = await search(page);
        const list = json.data.list;
        test.skip(list.length === 0, "Không có dữ liệu");
        await expect(rows(page)).toHaveCount(list.length);
        for (const [i, x] of list.entries()) {
          const at = `dòng ${i + 1} (role ${x.id})`;
          expect(norm(await cellAt(page, i, COL.name).innerText()), at).toBe(norm(x.name));
          expect(norm(await cellAt(page, i, COL.code).innerText()), at).toBe(norm(x.code));
        }
      });

      test("Mặc định sắp xếp id giảm dần và id / code không trùng nhau", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length < 2, "Không đủ dữ liệu");
        const ids = json.data.list.map((x) => x.id);
        expect(ids).toEqual([...ids].sort((a, b) => b - a));
        expect(new Set(ids).size).toBe(ids.length);
        const codes = json.data.list.map((x) => x.code);
        expect(new Set(codes).size).toBe(codes.length);
      });

      test("Mỗi role có Name và Code không để trống; chỉ có 3 field id / name / code", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        for (const x of json.data.list) {
          expect(x.name, `name của role ${x.id}`).toBeTruthy();
          expect(x.code, `code của role ${x.id}`).toBeTruthy();
          expect(Object.keys(x).sort(), `role ${x.id}`).toEqual(["code", "id", "name"]);
        }
      });

      test("Mỗi dòng có đúng 2 icon hành động View và Update (không có icon xoá)", async ({ page }) => {
        const n = await rows(page).count();
        test.skip(n === 0, "Không có dữ liệu");
        for (let i = 0; i < n; i++) {
          await expect(rowAt(page, i).locator(".column-actions svg")).toHaveCount(2);
        }
        await actionIcon(rowAt(page, 0), 0).hover();
        await expect(tooltip(page, "View")).toBeVisible();
        await actionIcon(rowAt(page, 0), 1).hover();
        await expect(tooltip(page, "Update")).toBeVisible();
      });
    });

    // ===== 3. Search / Filter =====
    test.describe("Search / Filter", () => {
      test("Mở dropdown Name / Code: option lấy từ user/dropdown_role_list (10 option, sort theo name / code tăng dần)", async ({ page }) => {
        for (const [id, key] of [
          ["nameIds", "name"],
          ["codeIds", "code"],
        ]) {
          // 2 request này được gửi ngay khi mở màn hình (không gửi lại khi mở dropdown)
          const res = await roleOptions[key];
          const data = (await res.json()).data;
          test.skip(data.length === 0, "Không có role nào");
          await openDropdown(page, id);
          await expect(openOptions(page)).toHaveCount(data.length);
          const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
          expect(titles, id).toEqual(data.map((r) => r[key]));
          await breadcrumb(page).click();
          await expect(openOptions(page)).toHaveCount(0);
        }
      });

      test("Gõ vào filter Name / Code: gửi filters.name / filters.code lên server và chỉ còn option khớp", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        for (const [id, key] of [
          ["nameIds", "name"],
          ["codeIds", "code"],
        ]) {
          // Lấy đoạn chữ + số đầu tiên (tránh ký tự "_" bị server hiểu như ký tự đại diện)
          const text = x[key].match(/[A-Za-z0-9]{2,}/)?.[0];
          test.skip(!text, `Không có đoạn chữ / số để gõ trong ${key} "${x[key]}"`);
          await openDropdown(page, id);
          const [res] = await Promise.all([
            page.waitForResponse((r) => isRoleDropdown(r) && bodyOf(reqOf(r)).filters?.[key] === text),
            page.keyboard.type(text),
          ]);
          expect(bodyOf(reqOf(res)).filters, id).toEqual({ sasEntityId: 1, [key]: text });
          const data = (await res.json()).data;
          expect(data.length, `không có role nào chứa "${text}"`).toBeGreaterThan(0);
          for (const r of data) expect(r[key].toLowerCase(), id).toContain(text.toLowerCase());
          await expect.poll(() => openOptions(page).count()).toBe(data.length);
          await breadcrumb(page).click();
          await expect(openOptions(page)).toHaveCount(0);
        }
      });

      test("Gõ chuỗi không có role nào khớp: dropdown trống (không có option)", async ({ page }) => {
        await openDropdown(page, "nameIds");
        const [res] = await Promise.all([
          page.waitForResponse((r) => isRoleDropdown(r) && bodyOf(reqOf(r)).filters?.name === "zzqqxx9999nomatch"),
          page.keyboard.type("zzqqxx9999nomatch"),
        ]);
        expect((await res.json()).data).toEqual([]);
        await expect(openOptions(page)).toHaveCount(0);
        await breadcrumb(page).click();
      });

      test("Search không chọn gì: gửi filters mặc định và trả về cùng tổng bản ghi", async ({ page }) => {
        const first = await search(page);
        const second = await search(page);
        expect(second.body).toEqual(DEFAULT_BODY);
        expect(second.json.data.totalCount).toBe(first.json.data.totalCount);
      });

      test("Chọn Name của dòng đầu: gửi filters.nameIds = [id] và chỉ còn đúng role đó", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length === 0, "Không có dữ liệu");
        const x = all.data.list[0];

        await selectOption(page, "nameIds", x.name);
        expect(await selectedTitles(page, "nameIds")).toEqual([x.name]);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ nameIds: [x.id], sasEntityId: [1] });
        expect(json.data.totalCount).toBe(1);
        expect(json.data.list).toEqual([x]);
        await expect(rows(page)).toHaveCount(1);
        await expect(cellAt(page, 0, COL.name)).toHaveText(norm(x.name));
        await expect(summary(page)).toHaveText("Showing 1 - 1 of 1 records");
      });

      test("Chọn Code của dòng đầu: gửi filters.codeIds = [id] và chỉ còn đúng role đó", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length === 0, "Không có dữ liệu");
        const x = all.data.list[0];

        await selectOption(page, "codeIds", x.code);
        expect(await selectedTitles(page, "codeIds")).toEqual([x.code]);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ codeIds: [x.id], sasEntityId: [1] });
        expect(json.data.totalCount).toBe(1);
        expect(json.data.list).toEqual([x]);
        await expect(cellAt(page, 0, COL.code)).toHaveText(norm(x.code));
      });

      test("Chọn nhiều Name: gửi nameIds có đủ các id và trả về đủ các role đã chọn", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length < 2, "Không đủ role để chọn nhiều");
        const [a, b] = all.data.list;
        await selectOption(page, "nameIds", a.name);
        await selectOption(page, "nameIds", b.name);
        await expect.poll(() => selectedCount(page, "nameIds")).toBe(2);
        const { body, json } = await search(page);
        expect([...body.filters.nameIds].sort(asc)).toEqual([a.id, b.id].sort(asc));
        expect(json.data.totalCount).toBe(2);
        expect(json.data.list.map((r) => r.id).sort(asc)).toEqual([a.id, b.id].sort(asc));
        await expect(rows(page)).toHaveCount(2);
      });

      test("Chọn nhiều Code: gửi codeIds có đủ các id và trả về đủ các role đã chọn", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length < 2, "Không đủ role để chọn nhiều");
        const [a, b] = all.data.list;
        await selectOption(page, "codeIds", a.code);
        await selectOption(page, "codeIds", b.code);
        await expect.poll(() => selectedCount(page, "codeIds")).toBe(2);
        const { body, json } = await search(page);
        expect([...body.filters.codeIds].sort(asc)).toEqual([a.id, b.id].sort(asc));
        expect(json.data.list.map((r) => r.id).sort(asc)).toEqual([a.id, b.id].sort(asc));
      });

      test("Kết hợp Name + Code của cùng 1 role: gửi cả nameIds và codeIds (AND) và ra đúng role đó", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length === 0, "Không có dữ liệu");
        const x = all.data.list[0];
        await selectOption(page, "nameIds", x.name);
        await selectOption(page, "codeIds", x.code);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ nameIds: [x.id], codeIds: [x.id], sasEntityId: [1] });
        expect(json.data.list).toEqual([x]);
      });

      test("Kết hợp Name + Code của 2 role khác nhau: không có kết quả, hiện 'There are no entries found'", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length < 2, "Không đủ role");
        const [a, b] = all.data.list;
        await selectOption(page, "nameIds", a.name);
        await selectOption(page, "codeIds", b.code);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ nameIds: [a.id], codeIds: [b.id], sasEntityId: [1] });
        expect(json.data.totalCount).toBe(0);
        expect(json.data.list).toEqual([]);
        await expect(page.getByText(MSG.noEntries)).toBeVisible();
        await expect(rows(page)).toHaveCount(0);
      });

      test("Xoá giá trị đã chọn bằng nút (x) rồi Search: không còn lọc theo filter đó", async ({ page }) => {
        const { json: all } = await search(page);
        test.skip(all.data.list.length === 0, "Không có dữ liệu");
        await selectOption(page, "nameIds", all.data.list[0].name);
        await filterEl(page, "nameIds").hover();
        await filterEl(page, "nameIds").locator(".ant-select-clear").click({ force: true });
        expect(await selectedTitles(page, "nameIds")).toEqual([]);
        const { body, json } = await search(page);
        // Quan sát thực tế (giống Agent / House Roles): sau khi xoá, app vẫn gửi "nameIds": [] (mảng rỗng) - tương đương không lọc
        expect(body).toEqual({ ...DEFAULT_BODY, filters: { ...DEFAULT_BODY.filters, nameIds: [] } });
        expect(json.data.totalCount).toBe(all.data.totalCount);
      });
    });

    // ===== 4. Reset =====
    test.describe("Reset", () => {
      test("Reset xoá Name + Code đã chọn và gửi lại request mặc định", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await selectOption(page, "nameIds", x.name);
        await selectOption(page, "codeIds", x.code);
        await search(page);

        const bodies = await resetBodies(page);
        expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual(DEFAULT_BODY);
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
        await expect(summary(page)).toHaveText(new RegExp(`of ${json.data.totalCount} records$`));
        await expect(rows(page)).toHaveCount(Math.min(10, json.data.totalCount));
      });

      test("Reset đưa sort về mặc định (id giảm dần) và gửi lại request mặc định", async ({ page }) => {
        await search(page);
        await reloadBy(page, () => th(page, "Role Name").click());
        const body = await reloadBy(page, () => resetBtn(page).click());
        expect(body).toEqual(DEFAULT_BODY);
      });

      // HÀNH VI ĐÚNG (đã được user xác nhận): bấm Reset khi đang ở trang 2 thì filter bị xoá nhưng giữ nguyên trang đang xem (request list gửi page=2).
      // Search thì về trang 1.
      // Để có filter cho > 10 kết quả: chọn 11 Role Name (10 dòng đầu của trang 1 + dòng đầu trang 2 ở 20 dòng / trang) rồi đổi lại 10 dòng / trang.
      test("Reset khi đang ở trang 2 (có filter): xoá filter nhưng giữ nguyên trang 2", async ({ page }) => {
        test.setTimeout(240000);
        test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
        await pageSizeSelect(page).click();
        const big = await reloadFull(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
        const names = big.json.data.list.slice(0, 11).map((r) => r.name);
        test.skip(names.length < 11, "Không đủ 11 role");
        for (const n of names) await selectOption(page, "nameIds", n);
        await pageSizeSelect(page).click();
        await reloadBy(page, () => openOptions(page).filter({ hasText: "10 / page" }).click());
        const { json } = await search(page);
        test.skip(json.data.totalCount <= 10, "Filter không cho > 10 kết quả");
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
        const p1 = await columnValues(page, "Role Code");
        const next = await reloadFull(page, () => page.locator(".ant-pagination-next").click());
        expect(next.body).toMatchObject({ page: 2 });
        const p2 = await columnValues(page, "Role Code");
        expect(p2.filter((c) => p1.includes(c))).toEqual([]);
        const prev = await reloadBy(page, () => page.locator(".ant-pagination-prev button").click());
        expect(prev).toMatchObject({ page: 1 });
        expect(await columnValues(page, "Role Code")).toEqual(p1);
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

      test("Giữ filter đang chọn khi đổi số dòng", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await selectOption(page, "nameIds", x.name);
        await search(page);
        await pageSizeSelect(page).click();
        const body = await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
        expect(body).toMatchObject({ pageSize: 20, filters: { nameIds: [x.id] } });
      });

      test("Giữ sort khi chuyển trang", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 10, "Chỉ có 1 trang");
        await reloadBy(page, () => th(page, "Role Name").click());
        const body = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        expect(body).toMatchObject({ page: 2, sortBy: "name", sortDirection: "asc" });
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

        test(`Sort cột "${name}": bảng hiển thị đúng thứ tự response (asc và desc)`, async ({ page }) => {
          await search(page);
          // Thứ tự chữ phụ thuộc collation của server nên chỉ kiểm tra bảng hiển thị đúng thứ tự response
          const up = await reloadFull(page, () => th(page, name).click());
          test.skip(up.json.data.list.length === 0, "Không có dữ liệu");
          expect(await columnValues(page, name)).toEqual(up.json.data.list.map((x) => norm(x[key])));
          const down = await reloadFull(page, () => th(page, name).click());
          expect(await columnValues(page, name)).toEqual(down.json.data.list.map((x) => norm(x[key])));
        });
      }

      test("Sort 2 cột liên tiếp: bấm Role Code sau Role Name thì chỉ sort theo Role Code (asc)", async ({ page }) => {
        await search(page);
        await reloadBy(page, () => th(page, "Role Name").click());
        const body = await reloadBy(page, () => th(page, "Role Code").click());
        expect(body).toMatchObject({ sortBy: "code", sortDirection: "asc" });
      });

      test("Giữ sort khi tìm kiếm với filter (Search không làm mất sort)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await reloadBy(page, () => th(page, "Role Code").click());
        await selectOption(page, "nameIds", json.data.list[0].name);
        const { body } = await search(page);
        expect(body).toMatchObject({ sortBy: "code", sortDirection: "asc", filters: { nameIds: [json.data.list[0].id] } });
      });

      test("2 cột Role Name, Role Code sort được; cột Action không sort", async ({ page }) => {
        for (const c of COLUMNS) {
          if (c in SORTABLE) await expect(th(page, c), c).toHaveClass(/ant-table-column-has-sorters/);
          else await expect(th(page, c), c).not.toHaveClass(/ant-table-column-has-sorters/);
        }
      });
    });

    // ===== 7. Màn hình View (chỉ xem) =====
    test.describe("Màn hình View", () => {
      test("Icon View của dòng đầu mở /admin/roles/view/{id}, gọi role/view {id} và hiển thị Name / Code đúng", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const [req] = await Promise.all([page.waitForRequest(isView), actionIcon(rowAt(page, 0), 0).click()]);
        expect(bodyOf(req)).toEqual({ id: String(x.id) });
        await expect(page).toHaveURL(new RegExp(`/admin/roles/view/${x.id}$`));
        await expect(breadcrumb(page)).toContainText("Role View");
        const info = page.locator(".ant-descriptions-item");
        await expect(info).toHaveCount(2);
        await expect(info.locator(".ant-descriptions-item-label")).toHaveText(["Role Name", "Role Code"]);
        await expect(info.locator(".ant-descriptions-item-content")).toHaveText([x.name, x.code].map(norm));
      });

      test("View: role/view trả về đúng role (id, name, code) và thuộc cấp Super Admin (entity id 1)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const data = await openRowAction(page, 0, 0);
        expect(data).toMatchObject({ id: x.id, name: x.name, code: x.code });
        expect(data.entity).toMatchObject({ id: 1, entityCode: "SUPERADMIN" });
      });

      test("View: chỉ đọc - mọi checkbox bị khoá, không có nút Save / Cancel, có mục General và Permission", async ({ page }) => {
        await openRowAction(page, 0, 0);
        await expect(page.getByRole("link", { name: "General" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Permission", exact: true })).toBeVisible(); // (menu trái còn link "Permissions")
        const n = await page.locator("input[type=checkbox]").count();
        expect(n).toBeGreaterThan(0);
        expect(await page.locator("input[type=checkbox]:enabled").count()).toBe(0);
        await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /Cancel$/ })).toHaveCount(0);
        await expect(page.locator("input#name, input#code")).toHaveCount(0);
      });

      test("View: trạng thái từng checkbox quyền khớp permissions của role/view", async ({ page }) => {
        const data = await openRowAction(page, 0, 0);
        const perms = flatPerms(data.permissions);
        test.skip(perms.length === 0, "Role không có quyền nào");
        for (const p of perms) {
          const box = permBox(page, p.id);
          if ((await box.count()) === 0) continue; // quyền không còn hiển thị trên form
          if (p.value) await expect(box, `${p.key}.${p.action}`).toBeChecked();
          else await expect(box, `${p.key}.${p.action}`).not.toBeChecked();
        }
      });

      test("View: gọi permission/list {sasEntityHierarchyIds: [1]} để dựng cây quyền", async ({ page }) => {
        const [req] = await Promise.all([page.waitForRequest(isPermissionList), actionIcon(rowAt(page, 0), 0).click()]);
        expect(bodyOf(req)).toEqual({ sasEntityHierarchyIds: [1] });
      });

      // Quan sát: breadcrumb ở màn hình View ghi "Role", còn ở danh sách / Create / Update ghi "Roles"
      test("View: breadcrumb 'Role' quay về danh sách", async ({ page }) => {
        await openRowAction(page, 0, 0);
        await breadcrumb(page).getByText(/^Roles?$/).first().click();
        await expect(page).toHaveURL(/\/admin\/roles$/);
        await expect(rows(page).first()).toBeVisible();
      });
    });

    // ===== 8. Form Add New (không ghi dữ liệu thật) =====
    test.describe("Form Add New (không ghi dữ liệu thật)", () => {
      test("Add New mở /admin/roles/create với tiêu đề 'Create Role', 2 ô bắt buộc, cây Permission và nút Cancel / Save", async ({ page }) => {
        await openCreate(page);
        await expect(breadcrumb(page)).toContainText("Roles");
        await expect(breadcrumb(page)).toContainText("Create Role");
        await expect(page.getByText("General Details", { exact: true })).toBeVisible();
        await expect(page.getByText("Permission", { exact: true }).first()).toBeVisible();
        await expect(page.locator(".ant-form-item-required")).toHaveText(["Role Name", "Role Code"]);
        await expect(nameInput(page)).toHaveAttribute("placeholder", "Enter the role name");
        await expect(codeInput(page)).toHaveAttribute("placeholder", "Enter the role code");
        await expect(nameInput(page)).toHaveValue("");
        await expect(codeInput(page)).toHaveValue("");
        await expect(accessAll(page)).toBeVisible();
        await expect(cancelBtn(page)).toBeVisible();
        await expect(saveBtn(page)).toBeVisible();
        await expect(formErrors(page)).toHaveCount(0);
      });

      test("Cây Permission: đủ nhóm và đủ quyền theo permission/list, mặc định không chọn gì", async ({ page }) => {
        const { perms } = await openCreate(page);
        const keys = Object.keys(perms);
        test.skip(keys.length === 0, "Không có quyền nào");
        const groupIds = await page.locator("[id^='permissions_']").evaluateAll((els) => els.map((e) => e.id));
        expect(groupIds).toEqual(keys.map((k) => `permissions_${k}`));
        const flat = flatPerms(perms);
        for (const k of keys) {
          const ids = await childBoxes(page, k).evaluateAll((els) => els.map((e) => Number(e.value)));
          expect(ids.sort(asc), `nhóm ${k}`).toEqual(flat.filter((p) => p.key === k).map((p) => p.id).sort(asc));
        }
        expect(await allBoxes(page).count()).toBe(1 + keys.length + flat.length); // + ô 'Access all'
        expect(await page.locator(".ant-card input[type=checkbox]:checked").count()).toBe(0);
      });

      test("Permission/list được gọi với sasEntityHierarchyIds = [1] (cấp Super Admin)", async ({ page }) => {
        const [req] = await Promise.all([page.waitForRequest(isPermissionList), addBtn(page).click()]);
        expect(bodyOf(req)).toEqual({ sasEntityHierarchyIds: [1] });
      });

      test("Save khi để trống: báo lỗi Name / Code bắt buộc + lỗi Permission, không gửi request ghi", async ({ page }) => {
        await openCreate(page);
        await saveBtn(page).click();
        // 2 lỗi 'This field is required' + 1 lỗi của Permission (thông báo để TRỐNG - xem báo cáo)
        await expect(formErrors(page)).toHaveText([MSG.required, MSG.required, ""]);
        await expect(page).toHaveURL(/\/admin\/roles\/create$/);
      });

      test("Điền đủ Name / Code nhưng không chọn quyền nào: chặn Save (lỗi Permission), không gửi request", async ({ page }) => {
        await openCreate(page);
        await fillValidForm(page);
        await saveBtn(page).click();
        await expect(formErrors(page)).toHaveCount(1);
        await expect(formErrors(page)).toHaveText("");
        await expect(page).toHaveURL(/\/admin\/roles\/create$/);
      });

      test("Name: chấp nhận 3-50 ký tự (chữ, số, khoảng trắng, _), từ chối <3, >50 và ký tự đặc biệt / có dấu", async ({ page }) => {
        await openCreate(page);
        const ok = ["abc", "A_b 1", "a".repeat(50)];
        const bad = ["ab", "a".repeat(51), "name @#$%", "名字abc"];
        for (const v of ok) {
          await nameInput(page).fill(v);
          await nameInput(page).blur();
          await expect(formErrors(page), `name "${v}"`).toHaveCount(0);
        }
        for (const v of bad) {
          await nameInput(page).fill(v);
          await nameInput(page).blur();
          await expect(formErrors(page), `name "${v}"`).toHaveText([MSG.nameRule]);
        }
        await nameInput(page).fill("");
        await expect(formErrors(page)).toHaveText([MSG.required]);
      });

      test("Code: chấp nhận 3-50 ký tự (chữ, số, _), từ chối <3, >50, khoảng trắng và ký tự có dấu", async ({ page }) => {
        await openCreate(page);
        const ok = ["abc", "Abc_123", "b".repeat(50)];
        const bad = ["ab", "b".repeat(51), "a b c", "códigoé", "code@#"];
        for (const v of ok) {
          await codeInput(page).fill(v);
          await codeInput(page).blur();
          await expect(formErrors(page), `code "${v}"`).toHaveCount(0);
        }
        for (const v of bad) {
          await codeInput(page).fill(v);
          await codeInput(page).blur();
          await expect(formErrors(page), `code "${v}"`).toHaveText([MSG.codeRule]);
        }
        await codeInput(page).fill("");
        await expect(formErrors(page)).toHaveText([MSG.required]);
      });

      // LỖI UI (CHƯA được user xác nhận): thông báo của Code ghi "Letters, Numbers or Underscores Only" nhưng ký tự gạch ngang "-" vẫn được chấp nhận
      // (Role Name cũng chấp nhận "-" dù thông báo không nhắc tới). Test kiểm tra đúng theo thông báo nên sẽ FAIL cho tới khi xác nhận / sửa.
      test("Code: ký tự gạch ngang '-' bị từ chối (thông báo chỉ cho phép chữ, số, gạch dưới)", async ({ page }) => {
        await openCreate(page);
        await codeInput(page).fill("abc-def");
        await codeInput(page).blur();
        await expect(formErrors(page)).toHaveText([MSG.codeRule]);
      });

      test("Name / Code sai định dạng chặn Save kể cả khi đã chọn quyền", async ({ page }) => {
        const { perms } = await openCreate(page);
        const flat = flatPerms(perms);
        test.skip(flat.length === 0, "Không có quyền nào");
        await permBox(page, flat[0].id).click();
        await nameInput(page).fill("ab");
        await codeInput(page).fill("c d");
        await saveBtn(page).click();
        await expect(formErrors(page)).toHaveText([MSG.nameRule, MSG.codeRule]);
        await expect(page).toHaveURL(/\/admin\/roles\/create$/);
      });

      test("Permission: 'Access all' chọn / bỏ chọn toàn bộ nhóm và quyền", async ({ page }) => {
        await openCreate(page);
        const total = await allBoxes(page).count();
        await accessAll(page).click();
        await expect(page.locator(".ant-card").nth(1).locator("input[type=checkbox]:checked")).toHaveCount(total);
        await expect(accessAll(page)).toBeChecked();
        await accessAll(page).click();
        await expect(page.locator(".ant-card input[type=checkbox]:checked")).toHaveCount(0);
        await expect(accessAll(page)).not.toBeChecked();
      });

      test("Permission: checkbox nhóm chọn / bỏ chọn mọi quyền của nhóm; chọn 1 quyền đưa nhóm và 'Access all' về trạng thái 'mixed'", async ({ page }) => {
        const { perms } = await openCreate(page);
        const key = Object.keys(perms).find((k) => Object.keys(perms[k]).length >= 2);
        test.skip(!key, "Không có nhóm nào từ 2 quyền trở lên");
        await groupBox(page, key).click();
        await expect(groupBox(page, key)).toBeChecked();
        const n = await childBoxes(page, key).count();
        await expect(group(page, key).locator("input[type=checkbox]:checked")).toHaveCount(n);
        await expect(accessAll(page)).toHaveAttribute("aria-checked", "mixed");

        // Bỏ 1 quyền con: nhóm chuyển sang 'mixed'
        await childBoxes(page, key).first().click();
        await expect(groupBox(page, key)).toHaveAttribute("aria-checked", "mixed");
        await expect(group(page, key).locator("input[type=checkbox]:checked")).toHaveCount(n - 1);

        // Chọn lại quyền con: nhóm được chọn đầy đủ trở lại
        await childBoxes(page, key).first().click();
        await expect(groupBox(page, key)).toBeChecked();

        // Bỏ nhóm: mọi quyền con của nhóm bị bỏ
        await groupBox(page, key).click();
        await expect(group(page, key).locator("input[type=checkbox]:checked")).toHaveCount(0);
        await expect(groupBox(page, key)).not.toBeChecked();
        await expect(accessAll(page)).not.toBeChecked();
      });

      test("Permission: chọn đủ quyền của mọi nhóm bằng tay thì 'Access all' tự được chọn", async ({ page }) => {
        const { perms } = await openCreate(page);
        for (const k of Object.keys(perms)) await groupBox(page, k).click();
        await expect(accessAll(page)).toBeChecked();
      });

      test("Cancel quay về danh sách, không gửi request ghi", async ({ page }) => {
        await openCreate(page);
        await nameInput(page).fill("QA-AUTO-cancel");
        await cancelBtn(page).click();
        await expect(page).toHaveURL(/\/admin\/roles$/);
        await expect(rows(page).first()).toBeVisible();
      });

      test("Breadcrumb 'Roles' quay về danh sách", async ({ page }) => {
        await openCreate(page);
        await breadcrumb(page).getByText("Roles", { exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/roles$/);
      });

      test("Save hợp lệ gửi đúng role/create {sasEntityId, name, code, permissionIds}; thành công thì về danh sách (response GIẢ, không ghi thật)", async ({ page }) => {
        await mockWrites(page, { ...MOCK_OK, messageCode: "CREATE_ROLE_SUCCESS", message: "Role created successfully" });
        const { perms } = await openCreate(page);
        const flat = flatPerms(perms);
        test.skip(flat.length === 0, "Không có quyền nào");
        const name = `QA-AUTO-${Date.now()}`;
        const code = `${QA_PREFIX}${Date.now()}`;
        await fillValidForm(page, { name, code, permId: flat[0].id });

        const [req] = await Promise.all([page.waitForRequest(isCreate), saveBtn(page).click()]);
        const body = bodyOf(req);
        expect(body).toEqual(createBody({ name, code, permissionIds: [flat[0].id] }));
        allowedWrites = [{ url: "role/create", body }];
        await expect(page).toHaveURL(/\/admin\/roles$/);
        await expect(toasts(page).filter({ hasText: "Success" })).toBeVisible();
      });

      test("Chọn 'Access all' rồi Save: permissionIds gồm TẤT CẢ id quyền của permission/list (response GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        const { perms } = await openCreate(page);
        const flat = flatPerms(perms);
        test.skip(flat.length === 0, "Không có quyền nào");
        await fillValidForm(page);
        await accessAll(page).click();
        const [req] = await Promise.all([page.waitForRequest(isCreate), saveBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "role/create", body }];
        expect([...body.permissionIds].sort(asc)).toEqual(flat.map((p) => p.id).sort(asc));
      });

      test("Chọn nhóm + 1 quyền lẻ: permissionIds đúng các quyền đã chọn, không gửi quyền chưa chọn (response GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        const { perms } = await openCreate(page);
        const keys = Object.keys(perms);
        test.skip(keys.length < 2, "Không đủ nhóm quyền");
        await fillValidForm(page);
        await groupBox(page, keys[1]).click();
        const single = flatPerms(perms).find((p) => p.key === keys[0]);
        await permBox(page, single.id).click();
        const expected = [...flatPerms(perms).filter((p) => p.key === keys[1]).map((p) => p.id), single.id].sort(asc);
        const [req] = await Promise.all([page.waitForRequest(isCreate), saveBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "role/create", body }];
        expect([...body.permissionIds].sort(asc)).toEqual(expected);
      });

      test("Server báo trùng Name (response GIẢ ROLE_NAME_EXIST): toast Error, ở lại form", async ({ page }) => {
        await mockWrites(page, MOCK_NAME_EXIST);
        const { perms } = await openCreate(page);
        const flat = flatPerms(perms);
        test.skip(flat.length === 0, "Không có quyền nào");
        await fillValidForm(page, { permId: flat[0].id });
        const [req] = await Promise.all([page.waitForRequest(isCreate), saveBtn(page).click()]);
        allowedWrites = [{ url: "role/create", body: bodyOf(req) }];
        await expect(toasts(page).filter({ hasText: "Error" }).filter({ hasText: MSG.nameExist })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/roles\/create$/);
        await expect(nameInput(page)).toHaveValue(bodyOf(req).name);
      });

      test("Server báo trùng Code (response GIẢ ROLE_CODE_EXIST): toast Error, ở lại form", async ({ page }) => {
        await mockWrites(page, MOCK_CODE_EXIST);
        const { perms } = await openCreate(page);
        const flat = flatPerms(perms);
        test.skip(flat.length === 0, "Không có quyền nào");
        await fillValidForm(page, { permId: flat[0].id });
        const [req] = await Promise.all([page.waitForRequest(isCreate), saveBtn(page).click()]);
        allowedWrites = [{ url: "role/create", body: bodyOf(req) }];
        await expect(toasts(page).filter({ hasText: "Error" }).filter({ hasText: MSG.codeExist })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/roles\/create$/);
      });
    });

    // ===== 9. Form Update (không ghi dữ liệu thật) =====
    test.describe("Form Update (không ghi dữ liệu thật)", () => {
      test("Icon Update của dòng đầu mở /admin/roles/update/{id}, gọi role/view {id}, tiêu đề 'Role Update'", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const [req] = await Promise.all([page.waitForRequest(isView), actionIcon(rowAt(page, 0), 1).click()]);
        expect(bodyOf(req)).toEqual({ id: String(x.id) });
        await expect(page).toHaveURL(new RegExp(`/admin/roles/update/${x.id}$`));
        await expect(breadcrumb(page)).toContainText("Roles");
        await expect(breadcrumb(page)).toContainText("Role Update");
        await expect(saveBtn(page)).toBeVisible();
        await expect(cancelBtn(page)).toBeVisible();
      });

      test("Update điền sẵn Name / Code của role", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await openRowAction(page, 0, 1);
        await expect(page.locator(".ant-form-item-required")).toHaveText(["Role Name", "Role Code"]);
        await expect(nameInput(page)).toHaveValue(x.name);
        await expect(codeInput(page)).toHaveValue(x.code);
        await expect(nameInput(page)).toBeEnabled();
        await expect(codeInput(page)).toBeEnabled();
        await expect(formErrors(page)).toHaveCount(0);
      });

      test("Update: checkbox quyền được tích sẵn đúng theo permissions của role/view", async ({ page }) => {
        const data = await openRowAction(page, 0, 1);
        const perms = flatPerms(data.permissions);
        test.skip(perms.length === 0, "Role không có quyền nào");
        await expect(allBoxes(page).first()).toBeVisible();
        for (const p of perms) {
          const box = permBox(page, p.id);
          if ((await box.count()) === 0) continue;
          if (p.value) await expect(box, `${p.key}.${p.action}`).toBeChecked();
          else await expect(box, `${p.key}.${p.action}`).not.toBeChecked();
        }
        await expect(allBoxes(page).first()).toBeEnabled();
      });

      test("Update: xoá Name / Code báo 'This field is required'; Name / Code sai định dạng báo lỗi và chặn Save", async ({ page }) => {
        await openRowAction(page, 0, 1);
        await nameInput(page).fill("");
        await codeInput(page).fill("");
        await expect(formErrors(page)).toHaveText([MSG.required, MSG.required]);
        await nameInput(page).fill("a");
        await codeInput(page).fill("b c");
        await expect(formErrors(page)).toHaveText([MSG.nameRule, MSG.codeRule]);
        await saveBtn(page).click();
        await expect(page).toHaveURL(/\/admin\/roles\/update\/\d+$/);
      });

      test("Update: bỏ hết quyền thì chặn Save (lỗi Permission, không gửi request)", async ({ page }) => {
        const data = await openRowAction(page, 0, 1);
        test.skip(flatPerms(data.permissions).every((p) => !p.value), "Role chưa có quyền nào");
        await accessAll(page).click(); // nếu đang 'mixed' sẽ chọn hết
        if (await accessAll(page).isChecked()) await accessAll(page).click(); // bỏ hết
        await expect(page.locator(".ant-card input[type=checkbox]:checked")).toHaveCount(0);
        await saveBtn(page).click();
        await expect(formErrors(page)).toHaveCount(1);
        await expect(formErrors(page)).toHaveText("");
        await expect(page).toHaveURL(/\/admin\/roles\/update\/\d+$/);
      });

      test("Cancel (từ Update) quay về danh sách, không gửi request ghi", async ({ page }) => {
        await openRowAction(page, 0, 1);
        await nameInput(page).fill("QA-AUTO-cancel");
        await cancelBtn(page).click();
        await expect(page).toHaveURL(/\/admin\/roles$/);
        await expect(rows(page).first()).toBeVisible();
      });

      test("Save không đổi gì gửi đúng role/edit {sasEntityId, name, code, id, permissionIds}; thành công: toast 'Successfully Updated' + về danh sách (response GIẢ, không ghi thật)", async ({ page }) => {
        await mockWrites(page, { ...MOCK_OK, messageCode: "EDIT_ROLE_SUCCESS", message: "Role updated successfully" });
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const data = await openRowAction(page, 0, 1);
        const checked = flatPerms(data.permissions).filter((p) => p.value);
        test.skip(checked.length === 0, "Role chưa có quyền nào");
        await expect(nameInput(page)).toHaveValue(x.name);

        const [req] = await Promise.all([page.waitForRequest(isEdit), saveBtn(page).click()]);
        const body = bodyOf(req);
        // Quan sát: form Update gửi id là CHUỖI (lấy từ URL, vd "603") chứ không phải số như role/edit của Agent Roles
        expect(body).toMatchObject({ name: x.name, code: x.code, sasEntityId: data.entity.id });
        expect(String(body.id)).toBe(String(x.id));
        expect(Object.keys(body).sort()).toEqual(["code", "id", "name", "permissionIds", "sasEntityId"]);
        expect([...body.permissionIds].sort(asc)).toEqual(checked.map((p) => p.id).sort(asc));
        allowedWrites = [{ url: "role/edit", body }];
        await expect(page).toHaveURL(/\/admin\/roles$/);
        await expect(toasts(page).filter({ hasText: MSG.updated })).toBeVisible();
      });

      test("Sửa Name + bỏ 1 quyền rồi Save: payload role/edit phản ánh đúng thay đổi (response GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        // Tìm 1 role có ít nhất 2 quyền trong 10 dòng đầu (role của bộ test API có thể chỉ có 1 quyền)
        let found = null;
        for (let i = 0; i < json.data.list.length && !found; i++) {
          const data = await openRowAction(page, i, 1, { perms: i === 0 }); // permission/list chỉ gọi ở lần mở form đầu tiên
          const checked = flatPerms(data.permissions).filter((p) => p.value).map((p) => p.id);
          if (checked.length >= 2) found = { i, x: json.data.list[i], checked };
          else {
            await cancelBtn(page).click();
            await expect(page).toHaveURL(/\/admin\/roles$/);
            await settle(page);
          }
        }
        test.skip(!found, "Không có role nào có từ 2 quyền trở lên trong 10 dòng đầu");
        const newName = `QA-AUTO-${Date.now()}`;
        await expect(allBoxes(page).first()).toBeVisible();
        await nameInput(page).fill(newName);
        await permBox(page, found.checked[0]).click(); // bỏ 1 quyền
        const [req] = await Promise.all([page.waitForRequest(isEdit), saveBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "role/edit", body }];
        expect(body).toMatchObject({ name: newName, code: found.x.code });
        expect(String(body.id)).toBe(String(found.x.id));
        expect([...body.permissionIds].sort(asc)).toEqual(found.checked.slice(1).sort(asc));
      });

      test("Server báo trùng Name khi sửa (response GIẢ): toast Error, ở lại form", async ({ page }) => {
        await mockWrites(page, MOCK_NAME_EXIST);
        await search(page);
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        const data = await openRowAction(page, 0, 1);
        test.skip(flatPerms(data.permissions).every((p) => !p.value), "Role chưa có quyền nào");
        const [req] = await Promise.all([page.waitForRequest(isEdit), saveBtn(page).click()]);
        allowedWrites = [{ url: "role/edit", body: bodyOf(req) }];
        await expect(toasts(page).filter({ hasText: "Error" }).filter({ hasText: MSG.nameExist })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/roles\/update\/\d+$/);
      });

      test("Server báo trùng Code khi sửa (response GIẢ): toast Error, ở lại form", async ({ page }) => {
        await mockWrites(page, MOCK_CODE_EXIST);
        await search(page);
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        const data = await openRowAction(page, 0, 1);
        test.skip(flatPerms(data.permissions).every((p) => !p.value), "Role chưa có quyền nào");
        const [req] = await Promise.all([page.waitForRequest(isEdit), saveBtn(page).click()]);
        allowedWrites = [{ url: "role/edit", body: bodyOf(req) }];
        await expect(toasts(page).filter({ hasText: "Error" }).filter({ hasText: MSG.codeExist })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/roles\/update\/\d+$/);
      });
    });

    // ===== 9b. Manage Columns =====
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

      test("Bỏ chọn 1 cột -> cột ẩn khỏi bảng, chọn lại -> hiện lại", async ({ page }) => {
        await columnBtn(page).click();
        await item(page, "Role Code").locator("label").click();
        expect(await headers(page)).not.toContain("Role Code");
        expect(await headers(page)).toHaveLength(COLUMNS.length - 1);

        await item(page, "Role Code").locator("label").click();
        expect(await headers(page)).toEqual(COLUMNS);
      });

      test("Dữ liệu cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        const names = await columnValues(page, "Role Name");
        await columnBtn(page).click();
        await item(page, "Role Code").locator("label").click();
        expect(await columnValues(page, "Role Name")).toEqual(names);
        expect(await headers(page)).not.toContain("Role Code");
      });
    });

    // ===== 10. Ghi nhớ filter =====
    test.describe("Ghi nhớ filter", () => {
      test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await selectOption(page, "nameIds", x.name);
        await search(page);
        await pageSizeSelect(page).click();
        await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

        const [req] = await Promise.all([page.waitForRequest(isList), openPage(page)]); // reload
        expect(bodyOf(req)).toMatchObject({ pageSize: 20, filters: { nameIds: [x.id] } });
        expect(await selectedTitles(page, "nameIds")).toEqual([x.name]);
        await expect(pageSizeSelect(page)).toContainText("20 / page");
      });

      test("Sau Reset rồi reload: filter không còn được ghi nhớ", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await selectOption(page, "codeIds", json.data.list[0].code);
        await search(page);
        await reloadBy(page, () => resetBtn(page).click());

        await openPage(page); // reload
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
        await expect(rows(page)).toHaveCount(Math.min(10, json.data.totalCount));
      });
    });
  });

  // ===== NHÓM CRUD (GHI DỮ LIỆU THẬT trên role QA) =====
  test.describe("CRUD (ghi dữ liệu thật trên role QA, luôn khôi phục lại)", () => {
    test.skip(!RUN_FULL_TESTS, SKIP_WRITE_REASON);
    test.describe.configure({ mode: "serial" });

    let qa; // { id, name, code } - role QA (code bắt đầu bằng QAAUTO)
    let other; // 1 role có sẵn của team (chỉ dùng tên / code của nó để thử SỬA trùng - server từ chối, không ghi gì)

    // Lọc danh sách theo Code của role QA (bỏ qua bước chọn nếu filter đã được app ghi nhớ sau lần Search / quay về danh sách)
    // rồi Search. Trả về { body, json }
    async function filterQa(page, code) {
      if (!(await selectedTitles(page, "codeIds")).includes(code)) await selectOption(page, "codeIds", code);
      return search(page);
    }

    // Tìm role QA qua dropdown Code (tìm phía server) rồi Search để lấy đủ dữ liệu của dòng. Trả về null nếu chưa có
    async function findQaRole(page) {
      await openDropdown(page, "codeIds");
      const [res] = await Promise.all([
        page.waitForResponse((r) => isRoleDropdown(r) && bodyOf(reqOf(r)).filters?.code === QA_PREFIX),
        page.keyboard.type(QA_PREFIX),
      ]);
      const found = (await res.json()).data.find((r) => r.code.startsWith(QA_PREFIX) && /^QA-AUTO-/.test(r.name));
      await breadcrumb(page).click();
      await expect(openOptions(page)).toHaveCount(0);
      if (!found) return null;
      const { json } = await filterQa(page, found.code);
      const x = json.data.list.find((r) => r.id === found.id);
      return x ? { id: x.id, name: x.name, code: x.code } : null;
    }

    // Mở lại danh sách (reload), lọc theo role QA và mở màn hình Update của nó. Trả về role/view (data)
    async function openQaUpdate(page) {
      await openPage(page);
      await filterQa(page, qa.code);
      return openRowAction(page, 0, 1);
    }

    // Lưu form Update và kiểm tra request / response role/edit. Chỉ gửi lên đúng role QA
    async function saveUpdate(page, expected) {
      const [req, res] = await Promise.all([page.waitForRequest(isEdit), page.waitForResponse(isEdit), saveBtn(page).click()]);
      const body = bodyOf(req);
      expect(body).toMatchObject(expected.fields);
      expect(String(body.id), "role/edit phải nhắm đúng role QA").toBe(String(qa.id)); // id gửi dạng chuỗi
      if (expected.permissionIds) expect([...body.permissionIds].sort(asc)).toEqual([...expected.permissionIds].sort(asc));
      const json = await res.json();
      expect(json.status, `response: ${JSON.stringify(json)}`).toBe("success");
      expect(json.messageCode).toBe("EDIT_ROLE_SUCCESS");
      // Chờ app điều hướng xong về danh sách, tránh page.goto kế tiếp bị ERR_ABORTED giữa chừng
      await expect(page).toHaveURL(/\/admin\/roles$/);
      await settle(page);
      return body;
    }

    // Đưa role QA về tên gốc (nếu bị đổi). Dùng trong finally / afterAll; chỉ ghi lên đúng role QA
    async function restoreName(page) {
      await openPage(page);
      const cur = await findQaRole(page);
      if (!cur || cur.name === qa.name) return;
      await openRowAction(page, 0, 1);
      await nameInput(page).fill(qa.name);
      await saveUpdate(page, { fields: { name: qa.name } });
    }

    test.afterAll(async ({ browser }) => {
      test.setTimeout(120000);
      if (!qa) return;
      const ctx = await browser.newContext({ storageState: buildStorageState(), viewport: VIEWPORT });
      const page = await ctx.newPage();
      try {
        await page.addInitScript(() => {
          for (const k of Object.keys(localStorage)) if (/admin_roles_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
        });
        await restoreName(page);
      } finally {
        await ctx.close();
      }
    });

    test.beforeEach(async ({ page }) => {
      await openPage(page);
    });

    // Mọi request ghi của nhóm này chỉ được nhắm vào role QA (không bao giờ sửa role có sẵn của team)
    test.afterEach(async () => {
      for (const w of writes) {
        expect(["role/edit", "role/create"], "URL ghi không nằm trong danh sách").toContain(w.url);
        if (w.url === "role/edit") expect(String(w.body.id), "role/edit phải nhắm đúng role QA").toBe(String(qa.id));
        if (w.url === "role/create") {
          expect(w.body.name, "role/create chỉ dùng name QA-AUTO-...").toMatch(/^QA-AUTO-/);
          expect(w.body.code, "role/create chỉ dùng code QAAUTO...").toMatch(new RegExp(`^${QA_PREFIX}`));
        }
      }
    });

    test("Tạo role QA (chỉ khi CHƯA có role QAAUTO nào - role không xoá được bằng UI): Save gửi role/create, về danh sách, dòng mới ở đầu danh sách", async ({ page }) => {
      qa = await findQaRole(page);
      test.skip(!!qa, `Đã có role QA ${qa?.code} (do lần chạy trước tạo) - không tạo thêm vì màn hình không có chức năng xoá`);

      const { perms } = await openCreate(page);
      const flat = flatPerms(perms);
      const ts = Date.now();
      const name = `QA-AUTO-${ts}`;
      const code = `${QA_PREFIX}${ts}`;
      await fillValidForm(page, { name, code, permId: flat[0].id });
      const [req, res] = await Promise.all([page.waitForRequest(isCreate), page.waitForResponse(isCreate), saveBtn(page).click()]);
      expect(bodyOf(req)).toEqual(createBody({ name, code, permissionIds: [flat[0].id] }));
      const json = await res.json();
      expect(json.status, `response: ${JSON.stringify(json)}`).toBe("success");
      expect(json.messageCode).toBe("CREATE_ROLE_SUCCESS");
      await expect(page).toHaveURL(/\/admin\/roles$/);
      await settle(page);
      await expect(cellAt(page, 0, COL.code)).toHaveText(code);
      await expect(cellAt(page, 0, COL.name)).toHaveText(name);
      // id của role mới: dòng đầu của danh sách sort id giảm dần
      const { json: list } = await search(page);
      expect(list.data.list[0]).toMatchObject({ name, code });
      qa = { id: list.data.list[0].id, name, code };
    });

    test("Tìm được role QA trong danh sách (lọc theo Code) và lấy 1 role có sẵn của team để thử trùng", async ({ page }) => {
      qa = qa ?? (await findQaRole(page));
      test.skip(!qa, "Chưa có role QA");
      const { json: filtered } = await filterQa(page, qa.code);
      expect(filtered.data.list.map((r) => r.id)).toEqual([qa.id]);
      await expect(rows(page)).toHaveCount(1);
      await resetBodies(page);
      const { json } = await search(page);
      other = json.data.list.find((r) => r.id !== qa.id);
      test.skip(!other, "Không có role nào khác để thử trùng");
    });

    test("View role QA: hiển thị đúng Name / Code và quyền đã gán", async ({ page }) => {
      test.skip(!qa, "Chưa có role QA");
      await filterQa(page, qa.code);
      const data = await openRowAction(page, 0, 0);
      expect(data).toMatchObject({ id: qa.id, name: qa.name, code: qa.code });
      await expect(page.locator(".ant-descriptions-item-content")).toHaveText([qa.name, qa.code]);
      expect(flatPerms(data.permissions).filter((p) => p.value).length).toBeGreaterThan(0);
    });

    test("Sửa tên role QA: Save gửi role/edit, toast 'Successfully Updated', về danh sách, dòng đổi tên, View hiển thị tên mới; rồi khôi phục tên gốc", async ({ page }) => {
      test.skip(!qa, "Chưa có role QA");
      const newName = `${qa.name}-E`.slice(0, 50);
      try {
        await filterQa(page, qa.code);
        const data = await openRowAction(page, 0, 1);
        const checked = flatPerms(data.permissions).filter((p) => p.value).map((p) => p.id);
        await expect(nameInput(page)).toHaveValue(qa.name);
        await nameInput(page).fill(newName);
        await saveUpdate(page, { fields: { name: newName, code: qa.code }, permissionIds: checked });
        await expect(toasts(page).filter({ hasText: MSG.updated })).toBeVisible();

        const { json: after } = await filterQa(page, qa.code);
        expect(after.data.list[0]).toMatchObject({ id: qa.id, name: newName, code: qa.code });
        await expect(cellAt(page, 0, COL.name)).toHaveText(newName);
        await openRowAction(page, 0, 0);
        await expect(page.locator(".ant-descriptions-item").filter({ hasText: "Role Name" })).toContainText(newName);
      } finally {
        await restoreName(page);
      }
      await filterQa(page, qa.code);
      await expect(cellAt(page, 0, COL.name)).toHaveText(qa.name);
    });

    test("Thêm 1 quyền cho role QA rồi Save: View hiển thị quyền mới; sau đó bỏ lại quyền đó (khôi phục)", async ({ page }) => {
      test.skip(!qa, "Chưa có role QA");
      await filterQa(page, qa.code);
      const data = await openRowAction(page, 0, 1);
      const before = flatPerms(data.permissions).filter((p) => p.value).map((p) => p.id);
      const free = flatPerms(data.allPerms).find((p) => !before.includes(p.id));
      test.skip(!free, "Role QA đã có mọi quyền");

      let added = false;
      try {
        await permBox(page, free.id).click();
        await expect(permBox(page, free.id)).toBeChecked();
        await saveUpdate(page, { fields: { name: qa.name, code: qa.code }, permissionIds: [...before, free.id] });
        added = true;
        await filterQa(page, qa.code);
        const view = await openRowAction(page, 0, 0);
        expect(flatPerms(view.permissions).find((p) => p.id === free.id)?.value).toBe(true);
        await expect(permBox(page, free.id)).toBeChecked();
      } finally {
        // Khôi phục: mở lại Update, bỏ quyền vừa thêm
        if (added) {
          const cur = await openQaUpdate(page);
          if (flatPerms(cur.permissions).find((p) => p.id === free.id)?.value) {
            await expect(allBoxes(page).first()).toBeVisible();
            await permBox(page, free.id).click();
            await saveUpdate(page, { fields: { name: qa.name, code: qa.code }, permissionIds: before });
          }
        }
      }
    });

    test("Tạo role mới trùng Name với role QA: server từ chối ROLE_NAME_EXIST, toast Error, ở lại form (không tạo role)", async ({ page }) => {
      test.skip(!qa, "Chưa có role QA");
      const { perms } = await openCreate(page);
      const flat = flatPerms(perms);
      await fillValidForm(page, { name: qa.name, code: `${QA_PREFIX}DUP${Date.now()}`, permId: flat[0].id });
      const [res] = await Promise.all([page.waitForResponse(isCreate), saveBtn(page).click()]);
      const json = await res.json();
      expect(json.status).toBe("fail");
      expect(json.messageCode).toBe("ROLE_NAME_EXIST");
      await expect(toasts(page).filter({ hasText: "Error" }).filter({ hasText: MSG.nameExist })).toBeVisible();
      await expect(page).toHaveURL(/\/admin\/roles\/create$/);
    });

    test("Tạo role mới trùng Code với role QA: server từ chối ROLE_CODE_EXIST, toast Error, ở lại form (không tạo role)", async ({ page }) => {
      test.skip(!qa, "Chưa có role QA");
      const { perms } = await openCreate(page);
      const flat = flatPerms(perms);
      await fillValidForm(page, { name: `QA-AUTO-DUP-${Date.now()}`, code: qa.code, permId: flat[0].id });
      const [res] = await Promise.all([page.waitForResponse(isCreate), saveBtn(page).click()]);
      const json = await res.json();
      expect(json.status).toBe("fail");
      expect(json.messageCode).toBe("ROLE_CODE_EXIST");
      await expect(toasts(page).filter({ hasText: "Error" }).filter({ hasText: MSG.codeExist })).toBeVisible();
      await expect(page).toHaveURL(/\/admin\/roles\/create$/);
    });

    test("Sửa role QA thành Name / Code của role khác: server từ chối, role QA không đổi", async ({ page }) => {
      test.skip(!qa || !other, "Chưa có role QA / role khác");
      for (const [field, value, msg, messageCode] of [
        ["name", other.name, MSG.nameExist, "ROLE_NAME_EXIST"],
        ["code", other.code, MSG.codeExist, "ROLE_CODE_EXIST"],
      ]) {
        await openQaUpdate(page);
        await (field === "name" ? nameInput(page) : codeInput(page)).fill(value);
        const [res] = await Promise.all([page.waitForResponse(isEdit), saveBtn(page).click()]);
        const json = await res.json();
        expect(json.status, field).toBe("fail");
        expect(json.messageCode, field).toBe(messageCode);
        await expect(toasts(page).filter({ hasText: "Error" }).filter({ hasText: msg })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/roles\/update\/\d+$/);
      }
      await openPage(page);
      const { json } = await filterQa(page, qa.code);
      expect(json.data.list[0]).toMatchObject({ id: qa.id, name: qa.name, code: qa.code });
    });
  });
});
