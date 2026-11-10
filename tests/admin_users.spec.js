// Administration > Users  (https://dev-bo.royaledge.io/admin/users)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/admin_users.spec.js --project=setup --project=chromium
//
// Màn hình danh sách "Users" của nhóm Administration: user cấp ADMIN (không thuộc House / Master Agent / Agent nào). API user/list,
// filters.sasEntityId luôn = [1] (khác các màn hình House / Master Agent Users dùng user/listhierarchy + sasEntityHierarchyId).
//  - Filter: Username ("usernameIds", chọn NHIỀU, id USER, nạp bằng user/dropdown_user_list {sortBy:"username"}: tìm phía server qua filters.username),
//    Real Name ("nameIds", chọn NHIỀU, id USER, nạp bằng user/dropdown_user_list {sortBy:"name"}: tìm qua filters.name) và Status ("status", chọn 1 giá trị,
//    gửi số 1 | 0, bỏ trống thì không gửi key này).
//  - Bảng KHÔNG có cột ID: Username / Real Name / Roles / Status / Action. Sort được: Username, Real Name, Status (sortBy username | name | status;
//    asc -> desc -> về mặc định id desc). Mặc định sortBy = id desc nhưng không có header nào hiện trạng thái đang sort. Roles / Action không sort.
//    Cột Roles hiện mỗi role 1 tag (tên role), KHÔNG có hộp thoại Roles như House / Master Agent Users.
//  - Cột Action: View (/admin/users/view/{id}), Update (/admin/users/update/{id}) và menu "..." gồm Activate | Deactivate, Reset Password, Reset 2FA.
//    Có checkbox chọn dòng + 2 nút Bulk Activate / Bulk Deactivate (user/update-user-status {ids,status}; từng dòng gửi {id,status}). Không có Export.
//  - Add New -> /admin/users/create: wizard 2 bước (Basic Information -> Password). Bước 1: Username (bắt buộc, 5-15 ký tự chữ thường + số, kiểm tra trùng qua
//    user/validate/username {sasEntityId:1, username}), Real Name (bắt buộc, 3-20 chữ / số / khoảng trắng), Roles (bắt buộc, nhiều, nạp bằng dropdown/role
//    {sasEntityId:1}), Status (Active / Inactive), liên hệ không bắt buộc (Email, Phone, Whatsapp, Wechat, Telegram, Skype). KHÔNG có ô House / Master Agent.
//    Bước 2: tự sinh mật khẩu hoặc "Create Password" (>=8 ký tự có chữ hoa + thường + số + ký tự đặc biệt) + "Force user to change password".
//    Submit gọi user/create. Update (/admin/users/update/{id}) là form 1 bước (Username bị khoá), Save gọi user/update.
//  - Reset Password gọi user/reset-password, Reset 2FA gọi user/reset-two-factory.
//
// AN TOÀN DỮ LIỆU:
//  - Mọi describe trừ describe cuối là "chỉ đọc": request ghi (user/create, user/update, user/update-user-status, reset-...) bị chặn ở tầng mạng (route.abort)
//    hoặc được trả về response GIẢ (route.fulfill, request KHÔNG tới server) để kiểm tra payload / toast. afterEach so sánh chính xác request ghi bắt
//    được (watchWrites) với danh sách được phép (allowedWrites). User có sẵn của team chỉ bị thao tác bằng request GIẢ, KHÔNG bao giờ bị ghi thật.
//  - Describe cuối "CRUD (ghi dữ liệu thật trên user QA)" chạy tuần tự, CHỈ thao tác trên 1 user QA (username "qaauto<6 số>", Real Name "QA AUTO <6 số>"):
//      * Màn hình KHÔNG có chức năng xoá user -> user QA KHÔNG dọn được bằng UI, nên test chỉ TẠO user QA khi chưa có user nào (tối đa 1 lần trong
//        vòng đời, tạo ở trạng thái Inactive, gắn role KHÔNG phải ADMIN_1 để không cấp quyền quản trị cao nhất), các lần chạy sau dùng lại user đó.
//        Sửa tên / bật tắt trạng thái xong luôn khôi phục (finally + afterAll).
//      * Test tạo trùng Username: bị chặn ngay ở bước validate (user/validate/username là request ĐỌC) nên không ghi gì.
//      * afterEach kiểm tra mọi request ghi chỉ nhắm vào user QA (id / ids / entityUserId = id user QA; user/create chỉ với username "qaauto..." + name "QA AUTO ...").
//  - Không hard-code dữ liệu: user / role đều lấy từ response list và dropdown; id màn hình con lấy từ icon ở dòng.
//  - Toast của Create / Reset (nhánh response GIẢ) không phản ánh server thật; luồng "tạo user QA lần đầu" chỉ kiểm chứng khi chạy thật.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/admin/users";
const ORIGIN = "https://dev-bo.royaledge.io";

// Đúng thứ tự hiển thị (cột đầu tiên là checkbox chọn dòng, không có tên). Không có cột ID.
const COLUMNS = ["Username", "Real Name", "Roles", "Status", "Action"];
const HEADERS = ["", ...COLUMNS];
const COL = { check: 0, username: 1, name: 2, roles: 3, status: 4, action: 5 };
const PAGE_SIZES = ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"];
const DEFAULT_BODY = {
  page: 1,
  pageSize: 10,
  sortBy: "id",
  sortDirection: "desc",
  filters: { sasEntityId: [1] },
};
// Cột sort được -> sortBy gửi lên API
const SORTABLE = { Username: "username", "Real Name": "name", Status: "status" };
const STATUS_TEXT = { 0: "Inactive", 1: "Active" };
const QA_USER_PREFIX = "qaauto"; // username của user QA: qaauto<6 số>
const QA_NAME_PREFIX = "QA AUTO"; // Real Name của user QA: "QA AUTO <6 số>"

// Thông báo của form / toast (đọc từ màn hình thật)
const MSG = {
  required: "This field is required",
  username: "Please enter only 5-15 characters, lowercase letters, and numbers only.",
  realName: "Please enter only 3-20 Characters, Letters, Numbers, or Spaces Only.",
  email: "Please enter a valid email.",
  whatsapp: "Please enter a valid whatsapp",
  telegram: "Please enter a valid telegram",
  password: "Please enter a valid password",
  usernameExist: "Username already exists",
  updated: "Successfully Updated",
  success: "Success",
  noEntries: "There are no entries found",
};

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI (user/create, user/update, user/update-user-status, user/reset-...)
// (user/validate/username chỉ kiểm tra trùng, không lưu gì)
const READ =
  /\/(list|listhierarchy|details|details_by_id|download|view)(\?|$)|\/dropdown\/|_dropdown(\?|$)|dropdown_user_list(\?|$)|dropdown_user_by_hierarchy(\?|$)|\/validate\//;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/user/list");
const isDetails = endsWith("/user/details_by_id");
const isCreate = endsWith("/user/create");
const isUpdate = endsWith("/user/update");
const isUpdateStatus = endsWith("/user/update-user-status");
const isReset2fa = endsWith("/user/reset-two-factory");
const isResetPassword = endsWith("/user/reset-password");
const isValidateUsername = endsWith("/user/validate/username");
const isUserDropdown = endsWith("/user/dropdown_user_list"); // dropdown của 2 filter Username / Real Name
const isFormRoles = endsWith("/dropdown/role"); // dropdown Roles của form ({sasEntityId})

const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};
// Request nạp sẵn của dropdown lúc mở màn hình (chưa gõ gì): filters chỉ có sasEntityId
const isInitialDropdown = (sortBy) => (r) => {
  if (!isUserDropdown(r)) return false;
  const b = bodyOf(reqOf(r));
  return b.sortBy === sortBy && b.filters?.username === undefined && b.filters?.name === undefined;
};
const asc = (a, b) => a - b;
const statusOf = (x) => STATUS_TEXT[x.status];
const six = () => String(Date.now()).slice(-6);
// Username "bình thường" (chữ + số): username có "_" bị server tìm như ký tự đại diện của LIKE nên không dùng làm dữ liệu mẫu để gõ tìm
const plainUser = (list) => list.find((r) => /^[a-z0-9]{5,15}$/.test(r.username));

// Bảng chính (luôn là .ant-table đầu tiên trong DOM)
const table = (page) => page.locator(".ant-table").first();
const rows = (page) => table(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
const th = (page, name) => table(page).locator("thead th").filter({ hasText: exact(name) });
const rowOfUsername = (page, username) =>
  rows(page).filter({ has: page.locator("td").nth(COL.username).filter({ hasText: exact(username) }) });
const checkboxOf = (page, i) => rowAt(page, i).locator('input[type="checkbox"]');
// Icon hành động của 1 dòng: 0 = View, 1 = Update, 2 = "..." (menu; chỉ phản hồi khi click phần tử cha của svg)
const actionIcon = (page, i, n) => rowAt(page, i).locator(".column-actions svg").nth(n);

const summary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const addBtn = (page) => page.getByRole("button", { name: /Add New/ });
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const filterToggle = (page) => page.locator(".NextGen-list-layout__filter-control__filter-btn");
const pageSizeSelect = (page) => page.locator(".ant-pagination-options .ant-select");
const toasts = (page) => page.locator(".Toastify__toast");
const bulkBtns = (page) => page.locator("button.NextGen-button-more-action__update");
const dialog = (page) => page.getByRole("dialog");
const openOptions = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
const filterEl = (page, id) => page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
const tooltip = (page) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");
const columnBtn = (page) => page.locator("button.NextGen-popover-manage-column__buton");
const columnPopover = (page) => page.locator(".NextGen-popover-manage-column");
const menuItems = (page) => page.locator(".ant-dropdown:not(.ant-dropdown-hidden) li");

// Form Create / Update
const nextBtn = (page) => page.getByRole("button", { name: "Next", exact: true });
const previousBtn = (page) => page.getByRole("button", { name: /Previous$/ });
const submitBtn = (page) => page.getByRole("button", { name: "Submit", exact: true });
const saveBtn = (page) => page.getByRole("button", { name: "Save", exact: true });
const cancelBtn = (page) => page.getByRole("button", { name: /Cancel$/ });
const field = (page, id) => page.locator(".ant-form-item").filter({ has: page.locator(`input#${id}`) });
const fieldError = (page, id) => field(page, id).locator(".ant-form-item-explain-error");
const formErrors = (page) => page.locator(".ant-form-item-explain-error");
const rolesSelect = (page) => field(page, "roleIds").locator(".ant-select");
const usernameInput = (page) => page.locator("input#username");
const nameInput = (page) => page.locator("input#name");
const emailInput = (page) => page.locator("input#email");
const passwordInput = (page) => page.locator("input#password");
const statusRadio = (page, label) => page.locator("label.ant-radio-wrapper").filter({ hasText: exact(label) });
// Màn hình View: mỗi thông tin là 1 .ant-descriptions-item
const infoItem = (page, label) =>
  page.locator(".ant-descriptions-item").filter({ has: page.locator(".ant-descriptions-item-label", { hasText: exact(label) }) });

// Tooltip antd mở / đóng có độ trễ: tooltip cũ còn đang mờ dần thì có 2 tooltip cùng lúc (strict mode violation).
// Đưa chuột ra ngoài, đợi tooltip cũ ẩn hết rồi hover lại, thử lại tới khi tooltip có đúng nội dung.
const hoverTip = async (page, target, text) => {
  await expect(async () => {
    await page.mouse.move(0, 0);
    await expect(tooltip(page)).toHaveCount(0, { timeout: 2000 });
    await target.hover();
    await expect(tooltip(page).filter({ hasText: exact(text) })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
};

async function openRowMenu(page, i) {
  await actionIcon(page, i, 2).locator("xpath=..").click();
  await expect(menuItems(page).first()).toBeVisible();
}
async function closeRowMenu(page) {
  await page.keyboard.press("Escape");
  await expect(menuItems(page)).toHaveCount(0);
}

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
// Chỉ tính spinner của bảng: các ô filter Username / Real Name (tìm phía server) cũng có thể hiện spinner khi đang nạp option
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

// Bấm Reset và gom MỌI request list gửi đi cho tới khi mạng yên (request cuối = trạng thái bảng cuối cùng).
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
// Gõ text vào ô tìm kiếm trước để option chắc chắn nằm trong danh sách hiển thị (tìm phía server).
// CHỈ dùng cho filter Username: ô Real Name tìm theo username chứ không theo tên (xem test "Gõ vào filter Real Name") nên dùng pickOption.
async function selectOption(page, id, text) {
  await openDropdown(page, id);
  await page.keyboard.type(text);
  await openOptions(page).filter({ hasText: exact(text) }).first().click();
  // Dropdown chọn nhiều không tự đóng và Esc cũng không đóng được -> click ra ngoài
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Chọn option thứ k trong danh sách nạp sẵn (không gõ gì) của filter chọn nhiều rồi đóng dropdown
async function pickOption(page, id, k) {
  await openDropdown(page, id);
  await expect.poll(() => openOptions(page).count()).toBeGreaterThan(k);
  await openOptions(page).nth(k).click();
  await breadcrumb(page).click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Chọn giá trị của filter Status (chọn 1, dropdown tự đóng)
async function selectStatus(page, label) {
  await openDropdown(page, "status");
  await openOptions(page).filter({ hasText: exact(label) }).click();
  await expect(openOptions(page)).toHaveCount(0);
  await expect(filterEl(page, "status").locator(".ant-select-selection-item")).toHaveText(label);
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

// Xoá giá trị của 1 filter bằng nút (x) (chỉ render khi hover)
async function clearFilter(page, id) {
  await filterEl(page, id).hover();
  await filterEl(page, id).locator(".ant-select-clear").click({ force: true });
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
const MOCK_OK = { status: "success", messageCode: "SUCCESS", message: "SUCCESS", data: null };

// --- Form Create / Update ---
// Đi từ danh sách vào form Create (bấm Add New), chờ danh sách Roles tải xong. Trả về dropdown/role (data).
async function openCreate(page) {
  const rolesRes = page.waitForResponse(isFormRoles);
  await addBtn(page).click();
  await expect(page).toHaveURL(/\/admin\/users\/create$/);
  const roles = (await (await rolesRes).json()).data; // [{ value, label (= code), name }]
  await expect(rolesSelect(page)).toBeVisible();
  return roles;
}

// Từ danh sách vào màn hình View / Update của dòng i. Trả về user/details_by_id (data)
async function openRowAction(page, i, icon) {
  const detailsRes = page.waitForResponse(isDetails);
  await actionIcon(page, i, icon).click();
  await expect(page).toHaveURL(icon === 0 ? /\/admin\/users\/view\/\d+$/ : /\/admin\/users\/update\/\d+$/);
  const data = (await (await detailsRes).json()).data;
  await expect(breadcrumb(page)).toContainText(icon === 0 ? "User Details" : "Update User");
  return data;
}

// Role dùng để điền form: ưu tiên role KHÔNG phải ADMIN_1 và có code chỉ gồm chữ / số (gõ tìm được), để user QA không có quyền quản trị cao nhất
const pickRole = (roles) => roles.find((r) => r.label !== "ADMIN_1" && /^[A-Za-z0-9_]+$/.test(r.label)) ?? roles[0];

// Chọn các role của form (theo label: gõ để lọc rồi chọn) rồi đóng dropdown (chọn nhiều không tự đóng -> click ra ngoài)
async function pickRoles(page, labels) {
  await rolesSelect(page).click();
  for (const l of labels) {
    await page.keyboard.type(l);
    await openOptions(page).filter({ hasText: exact(l) }).first().click();
  }
  await page.getByText("Basic Information", { exact: true }).first().click();
  await expect(openOptions(page)).toHaveCount(0);
}

// Điền bước 1 hợp lệ (Username + Real Name + 1 Role). Trả về { role, username, name } hoặc null nếu hệ thống chưa có role nào
async function fillStep1(page, roles, { username, name, status } = {}) {
  if (roles.length === 0) return null;
  const role = pickRole(roles);
  const u = username ?? `${QA_USER_PREFIX}${six()}`;
  const n = name ?? `${QA_NAME_PREFIX} ${six()}`;
  await usernameInput(page).fill(u);
  await nameInput(page).fill(n);
  await pickRoles(page, [role.label]);
  if (status) await statusRadio(page, status).click();
  return { role, username: u, name: n };
}

// Bấm Next và chờ sang bước Password (validate/username là request đọc)
async function goStep2(page) {
  await nextBtn(page).click();
  await expect(page.getByText("Password Settings")).toBeVisible();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Administration > Users", () => {
  let writes;
  let allowedWrites; // request ghi được phép (chỉ các test dùng response giả; request KHÔNG tới server thật)
  let usersLoaded; // promise của response user/dropdown_user_list (sortBy username) lúc mở trang
  let namesLoaded; // promise của response user/dropdown_user_list (sortBy name) lúc mở trang
  const usernameOptions = async () => (await (await usersLoaded).json()).data; // [{ id, name, username }]
  const nameOptions = async () => (await (await namesLoaded).json()).data;

  test.beforeEach(async ({ page }) => {
    // Bộ lọc, số dòng/trang được app lưu ở localStorage: xoá 1 lần đầu mỗi test để luôn bắt đầu từ mặc định
    // (dùng sessionStorage làm cờ để test "ghi nhớ sau reload" vẫn hoạt động)
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__admin_users_spec_cleared")) return;
      for (const k of Object.keys(localStorage)) {
        if (/admin_users_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
      }
      sessionStorage.setItem("__admin_users_spec_cleared", "1");
    });
    writes = watchWrites(page);
    allowedWrites = [];
    usersLoaded = page.waitForResponse(isInitialDropdown("username"), { timeout: 60000 });
    namesLoaded = page.waitForResponse(isInitialDropdown("name"), { timeout: 60000 });
    for (const p of [usersLoaded, namesLoaded]) p.catch(() => {});
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
      test("Có tiêu đề 'Users'", async ({ page }) => {
        await expect(breadcrumb(page)).toHaveText("Users");
      });

      test("Có đủ 3 filter Username, Real Name, Status và 2 nút Search/Reset", async ({ page }) => {
        await expect(page.locator(".NextGen-filter-element")).toHaveCount(3);
        await expect(filterEl(page, "usernameIds")).toContainText("Username");
        await expect(filterEl(page, "nameIds")).toContainText("Real Name");
        await expect(filterEl(page, "status")).toContainText("Status");
        await expect(searchBtn(page)).toBeVisible();
        await expect(resetBtn(page)).toBeVisible();
      });

      test("Giá trị filter mặc định: để trống", async ({ page }) => {
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
      });

      test("Username / Real Name là dropdown chọn nhiều có tìm kiếm và nút xoá (x); Status chọn 1 giá trị", async ({ page }) => {
        for (const id of ["usernameIds", "nameIds"]) {
          await expect(filterEl(page, id).locator(".ant-select-multiple"), id).toHaveCount(1);
          await expect(filterEl(page, id).locator(".ant-select-show-search"), id).toHaveCount(1);
          await expect(filterEl(page, id).locator(".ant-select-allow-clear"), id).toHaveCount(1);
        }
        await expect(filterEl(page, "status").locator(".ant-select-multiple")).toHaveCount(0);
        await expect(filterEl(page, "status").locator(".ant-select-allow-clear")).toHaveCount(1);
      });

      test("Có Add New, 2 nút thao tác hàng loạt, Manage Columns; không có Export", async ({ page }) => {
        await expect(addBtn(page)).toBeVisible();
        await expect(bulkBtns(page)).toHaveCount(2);
        await expect(columnBtn(page)).toBeVisible();
        await expect(page.locator("button.NextGen-export-button")).toHaveCount(0);
      });

      test(`Bảng có đủ ${COLUMNS.length} cột (+ cột checkbox) đúng thứ tự, không có cột ID`, async ({ page }) => {
        expect(await headers(page)).toEqual(HEADERS);
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
      test("Mỗi dòng khớp response API (Username, Real Name, Roles, Status)", async ({ page }) => {
        const { json } = await search(page);
        const list = json.data.list;
        test.skip(list.length === 0, "Không có dữ liệu");
        await expect(rows(page)).toHaveCount(list.length);
        for (const [i, x] of list.entries()) {
          const at = `dòng ${i + 1} (user ${x.id})`;
          expect(norm(await cellAt(page, i, COL.username).innerText()), at).toBe(norm(x.username));
          expect(norm(await cellAt(page, i, COL.name).innerText()), at).toBe(norm(x.name));
          expect(norm(await cellAt(page, i, COL.status).innerText()), at).toBe(statusOf(x));
          const tags = (await cellAt(page, i, COL.roles).locator(".ant-tag").allInnerTexts()).map(norm);
          expect(tags, `${at}: roles`).toEqual(x.roleList.map((r) => norm(r.name)));
        }
      });

      test("Mặc định sắp xếp id giảm dần; id và Username không trùng nhau; Status chỉ Active hoặc Inactive", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length < 2, "Không đủ dữ liệu");
        const ids = json.data.list.map((x) => x.id);
        expect(ids).toEqual([...ids].sort((a, b) => b - a));
        expect(new Set(ids).size).toBe(ids.length);
        const names = json.data.list.map((x) => x.username);
        expect(new Set(names).size).toBe(names.length);
        for (const x of json.data.list) expect([0, 1], `status của user ${x.id}`).toContain(x.status);
      });

      test("Mỗi user có Username, Real Name và ít nhất 1 role (id / mã / tên) không để trống; sasEntityId = 1", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        for (const x of json.data.list) {
          expect(x.username, `username của user ${x.id}`).toBeTruthy();
          expect(x.name, `name của user ${x.id}`).toBeTruthy();
          expect(x.sasEntityId, `sasEntityId của user ${x.id}`).toBe(1);
          expect(x.roleList.length, `số role của user ${x.id}`).toBeGreaterThan(0);
          for (const r of x.roleList) {
            expect(r.id, `id role của user ${x.id}`).toBeTruthy();
            expect(r.code, `mã role của user ${x.id}`).toBeTruthy();
            expect(r.name, `tên role của user ${x.id}`).toBeTruthy();
          }
        }
      });

      test("Cột Roles: mỗi role là 1 tag (tên role); không có nút / hộp thoại Roles", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const i = json.data.list.findIndex((x) => x.roleList.length > 1);
        const at = i >= 0 ? i : 0;
        await expect(cellAt(page, at, COL.roles).locator(".ant-tag")).toHaveCount(json.data.list[at].roleList.length);
        await expect(cellAt(page, at, COL.roles).locator("button")).toHaveCount(0);
      });

      test("Status hiển thị dạng tag: Active (xanh) / Inactive (đỏ)", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        for (const [i, x] of json.data.list.entries()) {
          await expect(cellAt(page, i, COL.status).locator(".ant-tag"), `dòng ${i + 1}`).toHaveClass(
            x.status === 1 ? /tag-success|ant-tag-success/ : /tag-error|ant-tag-error/,
          );
        }
      });

      test("Mỗi dòng có icon View, Update (tooltip) và menu '...'", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        for (let i = 0; i < json.data.list.length; i++) {
          await expect(rowAt(page, i).locator(".column-actions svg"), `dòng ${i + 1}`).toHaveCount(3);
        }
        await hoverTip(page, actionIcon(page, 0, 0), "View");
        await hoverTip(page, actionIcon(page, 0, 1), "Update");
      });

      test("Menu '...' của dòng: Activate (đang Inactive) hoặc Deactivate (đang Active) + Reset Password + Reset 2FA", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const other = json.data.list.findIndex((x) => x.status !== json.data.list[0].status);
        for (const i of [...new Set([0, other])].filter((v) => v >= 0)) {
          await openRowMenu(page, i);
          const toggle = json.data.list[i].status === 1 ? "Deactivate" : "Activate";
          expect((await menuItems(page).allInnerTexts()).map(norm), `dòng ${i + 1}`).toEqual([toggle, "Reset Password", "Reset 2FA"]);
          await closeRowMenu(page);
        }
      });
    });

    // ===== 3. Search / Filter =====
    test.describe("Search / Filter", () => {
      test("Dropdown Username: request nạp sẵn khi mở màn hình (10 option, sort username tăng dần) và liệt kê đúng username", async ({ page }) => {
        const res = await usersLoaded;
        expect(bodyOf(reqOf(res))).toMatchObject({
          page: 1,
          pageSize: 10,
          sortBy: "username",
          sortDirection: "asc",
          filters: { sasEntityId: 1 },
        });
        const data = (await res.json()).data;
        test.skip(data.length === 0, "Không có user nào");
        await openDropdown(page, "usernameIds");
        await expect(openOptions(page)).toHaveCount(data.length);
        const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
        expect(titles).toEqual(data.map((r) => r.username));
        await breadcrumb(page).click();
        await expect(openOptions(page)).toHaveCount(0);
      });

      test("Dropdown Real Name: request nạp sẵn khi mở màn hình (10 option, sort name tăng dần) và liệt kê đúng Real Name", async ({ page }) => {
        const res = await namesLoaded;
        expect(bodyOf(reqOf(res))).toMatchObject({
          page: 1,
          pageSize: 10,
          sortBy: "name",
          sortDirection: "asc",
          filters: { sasEntityId: 1 },
        });
        const data = (await res.json()).data;
        test.skip(data.length === 0, "Không có user nào");
        await openDropdown(page, "nameIds");
        await expect(openOptions(page)).toHaveCount(data.length);
        const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
        expect(titles).toEqual(data.map((r) => r.name));
        await breadcrumb(page).click();
        await expect(openOptions(page)).toHaveCount(0);
      });

      test("Dropdown Status chỉ có Active và Inactive", async ({ page }) => {
        await openDropdown(page, "status");
        await expect(openOptions(page)).toHaveText(["Active", "Inactive"]);
        await page.keyboard.press("Escape");
      });

      test("Gõ vào filter Username: gửi filters.username lên server và chỉ còn option khớp", async ({ page }) => {
        const { json } = await search(page);
        const x = plainUser(json.data.list);
        test.skip(!x, "Không có user nào có username hợp lệ để gõ tìm");
        const text = x.username.slice(0, 4);
        await openDropdown(page, "usernameIds");
        const [res] = await Promise.all([
          page.waitForResponse((r) => isUserDropdown(r) && bodyOf(reqOf(r)).filters?.username === text),
          page.keyboard.type(text),
        ]);
        expect(bodyOf(reqOf(res))).toMatchObject({ sortBy: "username", filters: { sasEntityId: 1, username: text } });
        const data = (await res.json()).data;
        expect(data.length, `không có user nào chứa "${text}"`).toBeGreaterThan(0);
        for (const r of data) expect(r.username.toLowerCase()).toContain(text.toLowerCase());
        await expect.poll(() => openOptions(page).count()).toBe(data.length);
        await breadcrumb(page).click();
        await expect(openOptions(page)).toHaveCount(0);
      });

      // LỖI BACKEND (quan sát khi khám phá, CHƯA được user xác nhận): ô tìm kiếm của filter Real Name gửi filters.name nhưng server lọc theo USERNAME
      // chứ không theo Real Name: gõ "Tien" trả về các user có username chứa "tien" (Real Name "nguyen"), không trả "Tien Admin"; gõ "nguy" chỉ trả
      // "Loc Nguyen" (username "locnguyen") mà không trả "Huy Nguyen" / các user tên "nguyen". Test kiểm tra đúng hành vi mong đợi nên sẽ FAIL cho tới khi sửa.
      test("Gõ vào filter Real Name: gửi filters.name lên server và chỉ còn option có Real Name chứa text đã gõ", async ({ page }) => {
        const { json } = await search(page);
        const x = json.data.list.find((r) => /^[A-Za-z0-9]{4,}/.test(r.name) && !r.username.toLowerCase().includes(r.name.slice(0, 4).toLowerCase()));
        test.skip(!x, "Không có user nào có Real Name khác phần đầu username để phân biệt");
        const text = x.name.slice(0, 4);
        await openDropdown(page, "nameIds");
        const [res] = await Promise.all([
          page.waitForResponse((r) => isUserDropdown(r) && bodyOf(reqOf(r)).filters?.name === text),
          page.keyboard.type(text),
        ]);
        expect(bodyOf(reqOf(res))).toMatchObject({ sortBy: "name", filters: { sasEntityId: 1, name: text } });
        const data = (await res.json()).data;
        expect(data.length, `không có user nào có Real Name chứa "${text}"`).toBeGreaterThan(0);
        for (const r of data) expect(r.name.toLowerCase(), `option "${r.name}" (username ${r.username})`).toContain(text.toLowerCase());
        // Phải có cả user mẫu (Real Name khớp text): nếu server lọc theo username thì user này bị bỏ sót
        expect(data.map((r) => r.name), `không thấy user "${x.username}" có Real Name "${x.name}" trong kết quả tìm "${text}"`).toContain(x.name);
        await breadcrumb(page).click();
      });

      test("Search không chọn gì: gửi filters mặc định và trả về cùng tổng bản ghi", async ({ page }) => {
        const first = await search(page);
        const second = await search(page);
        expect(second.body).toEqual(DEFAULT_BODY);
        expect(second.json.data.totalCount).toBe(first.json.data.totalCount);
      });

      test("Chọn Username của dòng đầu: gửi filters.usernameIds = [id] và chỉ còn đúng user đó", async ({ page }) => {
        const { json: all } = await search(page);
        const x = plainUser(all.data.list);
        test.skip(!x, "Không có user nào có username hợp lệ");

        await selectOption(page, "usernameIds", x.username);
        expect(await selectedTitles(page, "usernameIds")).toEqual([x.username]);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ usernameIds: [x.id], sasEntityId: [1] });
        expect(json.data.totalCount).toBe(1);
        expect(json.data.list).toEqual([x]);
        await expect(rows(page)).toHaveCount(1);
        await expect(cellAt(page, 0, COL.username)).toHaveText(norm(x.username));
        await expect(summary(page)).toHaveText("Showing 1 - 1 of 1 records");
      });

      test("Chọn nhiều Username: gửi usernameIds có đủ các id và trả về đủ các user đã chọn", async ({ page }) => {
        const { json: all } = await search(page);
        const [a, b] = all.data.list.filter((r) => /^[a-z0-9]{5,15}$/.test(r.username));
        test.skip(!a || !b, "Không đủ user để chọn nhiều");
        await selectOption(page, "usernameIds", a.username);
        await selectOption(page, "usernameIds", b.username);
        await expect.poll(() => selectedCount(page, "usernameIds")).toBe(2);
        const { body, json } = await search(page);
        expect([...body.filters.usernameIds].sort(asc)).toEqual([a.id, b.id].sort(asc));
        expect(json.data.totalCount).toBe(2);
        expect(json.data.list.map((r) => r.id).sort(asc)).toEqual([a.id, b.id].sort(asc));
      });

      test("Chọn Real Name (option nạp sẵn): gửi filters.nameIds = [id] và mọi dòng có đúng Real Name đó", async ({ page }) => {
        const data = await nameOptions();
        test.skip(data.length === 0, "Không có user nào");
        const k = 0;
        await pickOption(page, "nameIds", k);
        expect(await selectedTitles(page, "nameIds")).toEqual([data[k].name]);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ nameIds: [data[k].id], sasEntityId: [1] });
        expect(json.data.list.length).toBeGreaterThan(0);
        expect(json.data.list.map((r) => r.id)).toContain(data[k].id);
        for (const r of json.data.list) expect(norm(r.name)).toBe(norm(data[k].name));
        await expect(rows(page)).toHaveCount(json.data.list.length);
        for (const [i, r] of json.data.list.entries()) await expect(cellAt(page, i, COL.name)).toHaveText(norm(r.name));
      });

      test("Chọn nhiều Real Name: gửi nameIds có đủ các id và trả về đủ các user đã chọn", async ({ page }) => {
        const data = await nameOptions();
        test.skip(data.length < 2, "Không đủ user để chọn nhiều");
        await pickOption(page, "nameIds", 0);
        await pickOption(page, "nameIds", 1);
        await expect.poll(() => selectedCount(page, "nameIds")).toBe(2);
        const { body, json } = await search(page);
        expect([...body.filters.nameIds].sort(asc)).toEqual([data[0].id, data[1].id].sort(asc));
        const ids = json.data.list.map((r) => r.id);
        expect(ids).toContain(data[0].id);
        expect(ids).toContain(data[1].id);
      });

      for (const s of [1, 0]) {
        test(`Chọn Status = ${STATUS_TEXT[s]}: gửi filters.status = ${s} và mọi dòng đều ${STATUS_TEXT[s]}`, async ({ page }) => {
          await selectStatus(page, STATUS_TEXT[s]);
          const { body, json } = await search(page);
          expect(body.filters).toEqual({ status: s, sasEntityId: [1] });
          test.skip(json.data.list.length === 0, `Không có user ${STATUS_TEXT[s]}`);
          for (const r of json.data.list) expect(r.status, `user ${r.id}`).toBe(s);
          await expect(rows(page)).toHaveCount(json.data.list.length);
          for (const [i, r] of json.data.list.entries()) await expect(cellAt(page, i, COL.status)).toHaveText(STATUS_TEXT[s]);
        });
      }

      test("Tổng số Active + Inactive bằng tổng số user khi không lọc", async ({ page }) => {
        const all = await search(page);
        await selectStatus(page, "Active");
        const active = await search(page);
        await selectStatus(page, "Inactive");
        const inactive = await search(page);
        expect(active.json.data.totalCount + inactive.json.data.totalCount).toBe(all.json.data.totalCount);
      });

      test("Kết hợp Username + Real Name của cùng 1 user: gửi cả usernameIds và nameIds (AND) và ra đúng user đó", async ({ page }) => {
        const data = await nameOptions();
        const x = data.find((r) => /^[a-z0-9]{5,15}$/.test(r.username));
        test.skip(!x, "Không có user nào có username hợp lệ trong danh sách Real Name");
        await selectOption(page, "usernameIds", x.username);
        await pickOption(page, "nameIds", data.indexOf(x));
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ usernameIds: [x.id], nameIds: [x.id], sasEntityId: [1] });
        expect(json.data.list.map((r) => r.id)).toEqual([x.id]);
      });

      test("Kết hợp Username của user A + Real Name của user B (khác user): không có kết quả, hiện 'There are no entries found'", async ({ page }) => {
        const { json: all } = await search(page);
        const data = await nameOptions();
        const a = plainUser(all.data.list);
        const k = data.findIndex((r) => r.id !== a?.id);
        test.skip(!a || k < 0, "Cần 2 user khác nhau");
        await selectOption(page, "usernameIds", a.username);
        await pickOption(page, "nameIds", k);
        const { body, json } = await search(page);
        expect(body.filters).toEqual({ usernameIds: [a.id], nameIds: [data[k].id], sasEntityId: [1] });
        expect(json.data.totalCount).toBe(0);
        expect(json.data.list).toEqual([]);
        await expect(page.getByText(MSG.noEntries)).toBeVisible();
        await expect(rows(page)).toHaveCount(0);
      });

      test("Kết hợp Username + Status đúng của user đó: ra đúng user; Status ngược lại: không có kết quả", async ({ page }) => {
        const { json: all } = await search(page);
        const x = plainUser(all.data.list);
        test.skip(!x, "Không có user nào có username hợp lệ");
        await selectOption(page, "usernameIds", x.username);
        await selectStatus(page, statusOf(x));
        const same = await search(page);
        expect(same.body.filters).toEqual({ usernameIds: [x.id], status: x.status, sasEntityId: [1] });
        expect(same.json.data.list).toEqual([x]);

        await selectStatus(page, STATUS_TEXT[1 - x.status]);
        const diff = await search(page);
        expect(diff.body.filters).toEqual({ usernameIds: [x.id], status: 1 - x.status, sasEntityId: [1] });
        expect(diff.json.data.totalCount).toBe(0);
        await expect(page.getByText(MSG.noEntries)).toBeVisible();
      });

      test("Xoá Username đã chọn bằng nút (x) rồi Search: không còn lọc theo filter đó", async ({ page }) => {
        const { json: all } = await search(page);
        const x = plainUser(all.data.list);
        test.skip(!x, "Không có user nào có username hợp lệ");
        await selectOption(page, "usernameIds", x.username);
        await clearFilter(page, "usernameIds");
        expect(await selectedTitles(page, "usernameIds")).toEqual([]);
        const { body, json } = await search(page);
        // Quan sát thực tế: sau khi xoá, app có thể gửi "usernameIds": [] (mảng rỗng) - tương đương không lọc
        expect({ ...body, filters: { ...body.filters, usernameIds: undefined } }).toEqual({
          ...DEFAULT_BODY,
          filters: { ...DEFAULT_BODY.filters, usernameIds: undefined },
        });
        expect(body.filters.usernameIds ?? []).toEqual([]);
        expect(json.data.totalCount).toBe(all.data.totalCount);
      });

      test("Xoá Status đã chọn bằng nút (x) rồi Search: không gửi filters.status nữa", async ({ page }) => {
        const { json: all } = await search(page);
        await selectStatus(page, "Inactive");
        await search(page);
        await clearFilter(page, "status");
        await expect(filterEl(page, "status").locator(".ant-select-selection-item")).toHaveCount(0);
        const { body, json } = await search(page);
        expect(body).toEqual(DEFAULT_BODY);
        expect(json.data.totalCount).toBe(all.data.totalCount);
      });
    });

    // ===== 4. Reset =====
    test.describe("Reset", () => {
      test("Reset xoá Username + Real Name + Status đã chọn và gửi lại request mặc định", async ({ page }) => {
        const { json } = await search(page);
        const x = plainUser(json.data.list);
        test.skip(!x, "Không có user nào có username hợp lệ");
        await selectOption(page, "usernameIds", x.username);
        await pickOption(page, "nameIds", 0);
        await selectStatus(page, statusOf(x));
        await search(page);

        const bodies = await resetBodies(page);
        expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual(DEFAULT_BODY);
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
        await expect(summary(page)).toHaveText(new RegExp(`of ${json.data.totalCount} records$`));
        await expect(rows(page)).toHaveCount(Math.min(10, json.data.totalCount));
      });

      test("Reset đưa sort về mặc định (id giảm dần) và gửi lại request mặc định", async ({ page }) => {
        await reloadBy(page, () => th(page, "Username").click());
        const bodies = await resetBodies(page);
        expect(bodies.at(-1)).toEqual(DEFAULT_BODY);
      });

      // LỖI UI (đã tái hiện bằng script, CHƯA được user xác nhận): bấm Reset khi đang ở trang 2 thì filter bị xoá nhưng request list vẫn gửi page=2
      // (thanh phân trang vẫn ở trang 2, "Showing 11 - 20 of 121 records"); Search thì về trang 1 đúng. Test kiểm tra đúng hành vi mong đợi nên sẽ FAIL cho tới khi sửa.
      test("Reset khi đang ở trang 2 (có filter) thì quay về trang 1", async ({ page }) => {
        test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
        await selectStatus(page, "Active");
        const { json } = await search(page);
        test.skip(json.data.totalCount <= 10, "Filter Active chỉ có 1 trang");
        await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        const bodies = await resetBodies(page);
        expect(bodies.at(-1), `các request list sau Reset: ${JSON.stringify(bodies)}`).toEqual(DEFAULT_BODY);
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
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

      test("Số trang hiển thị khớp tổng bản ghi (totalCount / 10, làm tròn lên)", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 10, "Chỉ có 1 trang");
        const last = Math.ceil(total / 10);
        const items = await page.locator(".ant-pagination-item").evaluateAll((els) => els.map((e) => Number(e.textContent)));
        expect(Math.max(...items)).toBe(last);
      });

      test("Next / Previous chuyển trang 1 <-> 2 và trang 2 không trùng dòng nào của trang 1", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 10, "Chỉ có 1 trang");
        await expect(page.locator(".ant-pagination-prev")).toHaveClass(/ant-pagination-disabled/);
        const p1 = await columnValues(page, "Username");
        const next = await reloadFull(page, () => page.locator(".ant-pagination-next").click());
        expect(next.body).toMatchObject({ page: 2 });
        await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
        const p2 = await columnValues(page, "Username");
        expect(p2.filter((u) => p1.includes(u))).toEqual([]);
        const prev = await reloadBy(page, () => page.locator(".ant-pagination-prev button").click());
        expect(prev).toMatchObject({ page: 1 });
        expect(await columnValues(page, "Username")).toEqual(p1);
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
        test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
        await selectStatus(page, "Active");
        const { json: filtered } = await search(page);
        // Đổi số dòng khi đang ở trang 1 (đổi số dòng từ trang 2 thì app giữ nguyên page=2 nên không dùng làm mốc ở đây)
        await pageSizeSelect(page).click();
        const body = await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());
        expect(body).toMatchObject({ page: 1, pageSize: 20, filters: { status: 1 } });
        if (filtered.data.totalCount > 20) {
          const p2 = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
          expect(p2).toMatchObject({ page: 2, pageSize: 20, filters: { status: 1 } });
        }
      });

      test("Giữ sort khi chuyển trang", async ({ page }) => {
        const total = await totalOf(page);
        test.skip(total <= 10, "Chỉ có 1 trang");
        await reloadBy(page, () => th(page, "Username").click());
        const body = await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        expect(body).toMatchObject({ page: 2, sortBy: "username", sortDirection: "asc" });
      });

      test("Search khi đang ở trang 2 thì quay về trang 1", async ({ page }) => {
        test.skip((await totalOf(page)) <= 10, "Chỉ có 1 trang");
        await reloadBy(page, () => page.locator(".ant-pagination-item-2").click());
        const { body } = await search(page);
        expect(body).toMatchObject({ page: 1 });
      });
    });

    // ===== 6. Sắp xếp =====
    test.describe("Sắp xếp", () => {
      test("Mặc định (sortBy id desc) không có cột nào hiện trạng thái đang sort", async ({ page }) => {
        for (const c of COLUMNS) await expect(th(page, c), c).not.toHaveClass(/ant-table-column-sort/);
      });

      for (const [column, sortBy] of Object.entries(SORTABLE)) {
        test(`Sort cột ${column}: tăng dần -> giảm dần -> về mặc định (id giảm dần)`, async ({ page }) => {
          test.skip((await rows(page).count()) < 2, "Không đủ dữ liệu để kiểm tra thứ tự");
          // Cột chữ phụ thuộc collation của server nên chỉ kiểm tra request; cột Status là 0 / 1 nên kiểm tra được thứ tự
          const key = (v) => (v === "Active" ? 1 : 0);
          const checkOrder = column === "Status";

          const up = await reloadBy(page, () => th(page, column).click());
          expect(up).toMatchObject({ sortBy, sortDirection: "asc", page: 1, pageSize: 10 });
          if (checkOrder) {
            await expect
              .poll(async () => {
                const v = (await columnValues(page, column)).map(key);
                return JSON.stringify(v) === JSON.stringify([...v].sort(asc));
              }, { message: "thứ tự tăng dần" })
              .toBe(true);
          }

          const down = await reloadBy(page, () => th(page, column).click());
          expect(down).toMatchObject({ sortBy, sortDirection: "desc" });
          if (checkOrder) {
            await expect
              .poll(async () => {
                const v = (await columnValues(page, column)).map(key);
                return JSON.stringify(v) === JSON.stringify([...v].sort((a, b) => b - a));
              }, { message: "thứ tự giảm dần" })
              .toBe(true);
          }

          const none = await reloadBy(page, () => th(page, column).click());
          expect(none).toMatchObject({ sortBy: "id", sortDirection: "desc" });
        });
      }

      test("Sort giữ nguyên khi Search với filter", async ({ page }) => {
        await reloadBy(page, () => th(page, "Real Name").click());
        const { json } = await search(page);
        const x = plainUser(json.data.list);
        test.skip(!x, "Không có user nào có username hợp lệ");
        await selectOption(page, "usernameIds", x.username);
        const { body } = await search(page);
        expect(body).toMatchObject({ sortBy: "name", sortDirection: "asc", filters: { usernameIds: [x.id] } });
      });

      test("Chỉ Username, Real Name, Status sort được; Roles / Action không sort", async ({ page }) => {
        for (const c of COLUMNS) {
          if (c in SORTABLE) await expect(th(page, c), c).toHaveClass(/ant-table-column-has-sorters/);
          else await expect(th(page, c), c).not.toHaveClass(/ant-table-column-has-sorters/);
        }
      });
    });

    // ===== 7. Chọn dòng và thao tác hàng loạt =====
    test.describe("Thao tác hàng loạt (Cancel, hoặc xác nhận bằng response GIẢ)", () => {
      test("Chưa chọn dòng nào thì 2 nút Activate / Deactivate hàng loạt bị vô hiệu", async ({ page }) => {
        await expect(bulkBtns(page).nth(0)).toBeDisabled();
        await expect(bulkBtns(page).nth(1)).toBeDisabled();
      });

      test("Chọn 1 dòng thì 2 nút được bật, bỏ chọn thì tắt lại", async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        await checkboxOf(page, 0).check();
        await expect(bulkBtns(page).nth(0)).toBeEnabled();
        await expect(bulkBtns(page).nth(1)).toBeEnabled();
        await checkboxOf(page, 0).uncheck();
        await expect(bulkBtns(page).nth(0)).toBeDisabled();
        await expect(bulkBtns(page).nth(1)).toBeDisabled();
      });

      test("Checkbox ở tiêu đề chọn / bỏ chọn tất cả dòng", async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        const all = page.getByRole("checkbox", { name: "Select all" });
        await all.check();
        const n = await rows(page).count();
        await expect(page.locator('tbody tr.ant-table-row input[type="checkbox"]:checked')).toHaveCount(n);
        await all.uncheck();
        await expect(page.locator('tbody tr.ant-table-row input[type="checkbox"]:checked')).toHaveCount(0);
      });

      test("Tooltip của 2 nút thao tác hàng loạt", async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        await checkboxOf(page, 0).check();
        await hoverTip(page, bulkBtns(page).nth(0), "Bulk Activate");
        await hoverTip(page, bulkBtns(page).nth(1), "Bulk Deactivate");
      });

      for (const [i, action] of ["Activate", "Deactivate"].entries()) {
        test(`${action} hàng loạt 1 user: hộp thoại '${action} <Real Name> user' + câu hỏi xác nhận, đóng bằng Cancel`, async ({ page }) => {
          const { json } = await search(page);
          test.skip(json.data.list.length === 0, "Không có dữ liệu");
          await checkboxOf(page, 0).check();
          await bulkBtns(page).nth(i).click();
          await expect(dialog(page)).toBeVisible();
          await expect(dialog(page)).toContainText(`${action} ${norm(json.data.list[0].name)} user`);
          await expect(dialog(page)).toContainText(`Are you sure you want to ${action.toLowerCase()} this user?`);
          await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
          await expect(dialog(page).getByRole("button", { name: new RegExp(`${action}$`) })).toBeVisible();
          await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
          await expect(dialog(page)).toBeHidden();
          await expect(checkboxOf(page, 0)).toBeChecked(); // dòng vẫn đang được chọn
        });

        test(`${action} hàng loạt nhiều user: hộp thoại ghi rõ số lượng, đóng bằng Cancel`, async ({ page }) => {
          test.skip((await rows(page).count()) < 2, "Cần ít nhất 2 user");
          await checkboxOf(page, 0).check();
          await checkboxOf(page, 1).check();
          await bulkBtns(page).nth(i).click();
          await expect(dialog(page)).toContainText(`${action} 2 users`);
          await expect(dialog(page)).toContainText(`Are you sure you want to ${action.toLowerCase()} these 2 users?`);
          await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
          await expect(dialog(page)).toBeHidden();
        });

        test(`${action} hàng loạt 2 user (xác nhận, response GIẢ): gửi user/update-user-status {ids,status}, toast Success, tải lại danh sách`, async ({ page }) => {
          const { json } = await search(page);
          test.skip(json.data.list.length < 2, "Cần ít nhất 2 user");
          await mockWrites(page, MOCK_OK);
          const ids = json.data.list.slice(0, 2).map((x) => x.id);
          await checkboxOf(page, 0).check();
          await checkboxOf(page, 1).check();
          await bulkBtns(page).nth(i).click();
          const status = action === "Activate" ? 1 : 0;
          const [req] = await Promise.all([
            page.waitForRequest(isUpdateStatus),
            page.waitForRequest(isList),
            dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click(),
          ]);
          expect(bodyOf(req)).toEqual({ ids, status });
          allowedWrites.push({ url: "user/update-user-status", body: { ids, status } });
          await expect(toasts(page).filter({ hasText: MSG.success })).toBeVisible();
          await expect(dialog(page)).toBeHidden();
        });
      }
    });

    // ===== 8. Thao tác trên từng dòng (menu "...") =====
    test.describe("Menu '...' của dòng: Activate / Deactivate / Reset 2FA / Reset Password (response GIẢ)", () => {
      test("Activate / Deactivate từng dòng: hộp thoại xác nhận đúng nội dung, đóng bằng Cancel", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const action = x.status === 1 ? "Deactivate" : "Activate";
        await openRowMenu(page, 0);
        await menuItems(page).filter({ hasText: exact(action) }).click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toContainText(`${action} ${norm(x.name)}`);
        await expect(dialog(page)).toContainText(`Are you sure you want to ${action.toLowerCase()} this user?`);
        await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
        await expect(dialog(page)).toBeHidden();
      });

      test("Xác nhận Activate / Deactivate (response GIẢ): gửi user/update-user-status {id, status đảo}, toast Success, tải lại danh sách", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await mockWrites(page, MOCK_OK);
        const x = json.data.list[0];
        const action = x.status === 1 ? "Deactivate" : "Activate";
        await openRowMenu(page, 0);
        await menuItems(page).filter({ hasText: exact(action) }).click();
        const [req] = await Promise.all([
          page.waitForRequest(isUpdateStatus),
          page.waitForRequest(isList),
          dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click(),
        ]);
        expect(bodyOf(req)).toEqual({ id: x.id, status: 1 - x.status });
        allowedWrites.push({ url: "user/update-user-status", body: { id: x.id, status: 1 - x.status } });
        await expect(toasts(page).filter({ hasText: MSG.success })).toBeVisible();
        await expect(dialog(page)).toBeHidden();
      });

      test("Reset 2FA: hộp thoại 'Reset 2FA for <username>' + câu hỏi xác nhận, đóng bằng Cancel", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        await openRowMenu(page, 0);
        await menuItems(page).filter({ hasText: exact("Reset 2FA") }).click();
        await expect(dialog(page)).toContainText(`Reset 2FA for ${x.username}`);
        await expect(dialog(page)).toContainText("Would you like to proceed to reset this user's two-factor authentication?");
        await expect(dialog(page).getByRole("button", { name: "OK" })).toBeVisible();
        await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
        await expect(dialog(page)).toBeHidden();
      });

      test("Xác nhận Reset 2FA (response GIẢ): gửi user/reset-two-factory {id, sasEntityId} và toast Success", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await mockWrites(page, MOCK_OK);
        const x = json.data.list[0];
        await openRowMenu(page, 0);
        await menuItems(page).filter({ hasText: exact("Reset 2FA") }).click();
        const [req] = await Promise.all([page.waitForRequest(isReset2fa), dialog(page).getByRole("button", { name: "OK" }).click()]);
        expect(bodyOf(req)).toEqual({ id: x.id, sasEntityId: x.sasEntityId });
        allowedWrites.push({ url: "user/reset-two-factory", body: { id: x.id, sasEntityId: x.sasEntityId } });
        await expect(toasts(page).filter({ hasText: MSG.success })).toBeVisible();
      });

      test("Reset Password: hộp thoại 'Password Settings' có Force change, tự sinh mật khẩu / Create Password và nút Cancel / Save", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await openRowMenu(page, 0);
        await menuItems(page).filter({ hasText: exact("Reset Password") }).click();
        await expect(dialog(page)).toContainText("Password Settings");
        await expect(dialog(page)).toContainText("Force user to change their password on their next log in.");
        await expect(dialog(page).locator("input#forceUpdatePassword")).not.toBeChecked();
        await expect(dialog(page).locator("label.ant-radio-wrapper")).toHaveText(["Automatically generate a password", "Create Password"]);
        await expect(dialog(page).locator("label.ant-radio-wrapper-checked")).toHaveText("Automatically generate a password");
        await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
        await expect(dialog(page).getByRole("button", { name: "Save", exact: true })).toBeVisible();
        await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
        await expect(dialog(page)).toBeHidden();
      });

      test("Reset Password (tự sinh, response GIẢ): gửi user/reset-password {entityUserId, password = newPassword hợp lệ, forceUpdatePassword}", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await mockWrites(page, MOCK_OK);
        const x = json.data.list[0];
        await openRowMenu(page, 0);
        await menuItems(page).filter({ hasText: exact("Reset Password") }).click();
        await dialog(page).locator("label").filter({ hasText: "Force user to change their password" }).click();
        const [req] = await Promise.all([page.waitForRequest(isResetPassword), dialog(page).getByRole("button", { name: "Save", exact: true }).click()]);
        const body = bodyOf(req);
        expect(body).toMatchObject({ entityUserId: String(x.id), forceUpdatePassword: true });
        expect(body.password).toBe(body.newPassword);
        expect(body.password).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/);
        allowedWrites.push({ url: "user/reset-password", body });
        await expect(toasts(page).filter({ hasText: MSG.success })).toBeVisible();
      });

      test("Reset Password (Create Password): để trống / sai định dạng bị chặn, mật khẩu hợp lệ được gửi nguyên", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await mockWrites(page, MOCK_OK);
        const x = json.data.list[0];
        await openRowMenu(page, 0);
        await menuItems(page).filter({ hasText: exact("Reset Password") }).click();
        await dialog(page).locator("label.ant-radio-wrapper").filter({ hasText: "Create Password" }).click();
        await dialog(page).getByRole("button", { name: "Save", exact: true }).click();
        await expect(dialog(page).locator(".ant-form-item-explain-error")).toHaveText([MSG.required]);
        await dialog(page).locator("input#password").fill("abc");
        await expect(dialog(page).locator(".ant-form-item-explain-error")).toHaveText([MSG.password]);
        await dialog(page).locator("input#password").fill("Abcdef1!");
        await expect(dialog(page).locator(".ant-form-item-explain-error")).toHaveCount(0);
        // Khung "Password Requirements" phủ lên nút Save khi ô mật khẩu đang focus: bấm tiêu đề hộp thoại để bỏ focus trước khi Save
        await dialog(page).getByText("Password Settings").click();
        const [req] = await Promise.all([page.waitForRequest(isResetPassword), dialog(page).getByRole("button", { name: "Save", exact: true }).click()]);
        const expected = { forceUpdatePassword: false, password: "Abcdef1!", newPassword: "Abcdef1!", entityUserId: String(x.id) };
        expect(bodyOf(req)).toEqual(expected);
        allowedWrites.push({ url: "user/reset-password", body: expected });
      });
    });

    // ===== 9. Màn hình View (chỉ xem) =====
    test.describe("Màn hình View", () => {
      test("Icon View của dòng đầu mở /admin/users/view/{id}, gọi user/details_by_id {id} và hiển thị đúng thông tin", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const [req] = await Promise.all([page.waitForRequest(isDetails), actionIcon(page, 0, 0).click()]);
        expect(bodyOf(req)).toEqual({ id: String(x.id) });
        await expect(page).toHaveURL(new RegExp(`/admin/users/view/${x.id}$`));
        await expect(breadcrumb(page)).toContainText("Users");
        await expect(breadcrumb(page)).toContainText("User Details");
        await expect(infoItem(page, "Username")).toContainText(x.username);
        await expect(infoItem(page, "Real Name")).toContainText(norm(x.name));
        await expect(infoItem(page, "Status")).toContainText(statusOf(x));
        for (const r of x.roleList) await expect(infoItem(page, "Roles")).toContainText(norm(r.name));
      });

      test("View: chỉ đọc - đủ mục Basic Information / Contact Information, không có ô nhập, nút Save / Cancel / Next", async ({ page }) => {
        await openRowAction(page, 0, 0);
        await expect(page.locator(".ant-descriptions-item-label")).toHaveText([
          "Username",
          "Real Name",
          "Roles",
          "Status",
          "Email",
          "Contact Phone",
          "Whatsapp",
          "Wechat",
          "Telegram",
          "Skype",
        ]);
        await expect(page.getByRole("heading", { name: "Basic Information" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Contact Information (Optional)" })).toBeVisible();
        await expect(page.locator("main input, .ant-layout-content input")).toHaveCount(0);
        for (const n of ["Save", "Cancel", "Next", "Submit"]) {
          await expect(page.getByRole("button", { name: new RegExp(`${n}$`) }), n).toHaveCount(0);
        }
      });

      test("View: thông tin khớp user/details_by_id (username, tên, role, status, liên hệ)", async ({ page }) => {
        const d = await openRowAction(page, 0, 0);
        await expect(infoItem(page, "Username")).toContainText(d.username);
        await expect(infoItem(page, "Real Name")).toContainText(norm(d.name));
        await expect(infoItem(page, "Status")).toContainText(d.status === 1 ? "Active" : "Inactive");
        for (const r of d.roleList) await expect(infoItem(page, "Roles")).toContainText(norm(r.name));
        if (d.email) await expect(infoItem(page, "Email")).toContainText(d.email);
      });

      test("View của user có nhiều role: hiển thị đủ các role", async ({ page }) => {
        const { json } = await search(page);
        const i = json.data.list.findIndex((r) => r.roleList.length > 1);
        test.skip(i < 0, "Không có user nào có nhiều role trong trang đầu");
        const d = await openRowAction(page, i, 0);
        for (const r of d.roleList) await expect(infoItem(page, "Roles")).toContainText(norm(r.name));
      });

      test("View: breadcrumb 'Users' quay về danh sách", async ({ page }) => {
        await openRowAction(page, 0, 0);
        await breadcrumb(page).getByText("Users").first().click();
        await expect(page).toHaveURL(/\/admin\/users$/);
        await expect(rows(page).first()).toBeVisible();
      });
    });

    // ===== 10. Form Add New (không ghi dữ liệu thật) =====
    test.describe("Form Add New (không ghi dữ liệu thật)", () => {
      test("Add New mở /admin/users/create với tiêu đề 'Create User', 4 ô bắt buộc, 2 bước và nút Cancel / Next", async ({ page }) => {
        await openCreate(page);
        await expect(breadcrumb(page)).toContainText("Users");
        await expect(breadcrumb(page)).toContainText("Create User");
        await expect(page.locator(".ant-steps-item")).toHaveText(["1\nBasic Information", "2\nPassword"].map((t) => new RegExp(t.replace("\n", "\\s*"))));
        await expect(page.getByText("Basic Information", { exact: true }).first()).toBeVisible();
        await expect(page.getByText("Contact Information (Optional)")).toBeVisible();
        await expect(page.locator(".ant-form-item-required")).toHaveText(["Username", "Real Name", "Roles", "Status"]);
        await expect(page.locator(".ant-form-item-label")).toHaveText([
          "Username",
          "Real Name",
          "Roles",
          "Status",
          "Email",
          "Contact Phone",
          "Whatsapp",
          "Wechat",
          "Telegram",
          "Skype",
        ]);
        await expect(usernameInput(page)).toHaveAttribute("placeholder", "Enter username");
        await expect(nameInput(page)).toHaveAttribute("placeholder", "Enter real name");
        await expect(cancelBtn(page)).toBeVisible();
        await expect(nextBtn(page)).toBeVisible();
        await expect(formErrors(page)).toHaveCount(0);
      });

      test("Mặc định: Status = Active; không có ô House / Master Agent và Username, Roles dùng được ngay", async ({ page }) => {
        await openCreate(page);
        await expect(page.locator("label.ant-radio-wrapper-checked")).toHaveText("Active");
        await expect(statusRadio(page, "Inactive")).toBeVisible();
        await expect(page.locator("input#house")).toHaveCount(0);
        await expect(page.locator("input#masterAgent")).toHaveCount(0);
        await expect(usernameInput(page)).toBeEnabled();
        await expect(page.locator("input#roleIds")).toBeEnabled();
      });

      test("Roles của form: gọi dropdown/role {sasEntityId: 1} và liệt kê role của dropdown/role (theo code)", async ({ page }) => {
        const rolesReq = page.waitForRequest(isFormRoles);
        const roles = await openCreate(page);
        expect(bodyOf(await rolesReq)).toEqual({ sasEntityId: 1 });
        test.skip(roles.length === 0, "Hệ thống chưa có role");
        await rolesSelect(page).click();
        await expect.poll(() => openOptions(page).count()).toBeGreaterThan(0);
        const titles = await openOptions(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
        expect(titles).toEqual(roles.map((r) => r.label).slice(0, titles.length));
        await page.getByText("Basic Information", { exact: true }).first().click();
      });

      test("Roles chọn nhiều được: chọn 2 role thì hiện 2 chip", async ({ page }) => {
        const roles = await openCreate(page);
        const simple = roles.filter((r) => /^[A-Za-z0-9_]+$/.test(r.label));
        test.skip(simple.length < 2, "Cần ít nhất 2 role");
        await pickRoles(page, [simple[0].label, simple[1].label]);
        await expect(rolesSelect(page).locator(".ant-select-selection-item")).toHaveCount(2);
      });

      test("Next khi để trống: báo lỗi bắt buộc Username / Real Name / Roles, ở lại bước 1, không gửi request ghi", async ({ page }) => {
        await openCreate(page);
        await nextBtn(page).click();
        await expect(formErrors(page)).toHaveText([MSG.required, MSG.required, MSG.required]);
        await expect(fieldError(page, "username")).toHaveText(MSG.required);
        await expect(fieldError(page, "name")).toHaveText(MSG.required);
        await expect(fieldError(page, "roleIds")).toHaveText(MSG.required);
        await expect(page).toHaveURL(/\/admin\/users\/create$/);
        await expect(page.getByText("Password Settings")).toHaveCount(0);
      });

      test("Username: chấp nhận 5-15 ký tự chữ thường + số; từ chối <5, >15, chữ hoa, khoảng trắng, ký tự đặc biệt", async ({ page }) => {
        await openCreate(page);
        for (const bad of ["abcd", "a".repeat(16), "ABCDE", "abc 12", "abc_de", "abc@de", "ünïcode"]) {
          await usernameInput(page).fill(bad);
          await expect(fieldError(page, "username"), `"${bad}"`).toHaveText(MSG.username);
        }
        for (const ok of [`${QA_USER_PREFIX}${six()}`.slice(0, 15), "a".repeat(15), "12345"]) {
          await usernameInput(page).fill(ok);
          await expect(fieldError(page, "username"), `"${ok}"`).toHaveCount(0);
        }
      });

      test("Username đã tồn tại: gọi user/validate/username {sasEntityId, username}, báo 'Username already exists' và chặn Next", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = plainUser(json.data.list);
        test.skip(!x, "Không có user nào có username hợp lệ để thử trùng");
        await openCreate(page);
        const [res] = await Promise.all([page.waitForResponse(isValidateUsername), usernameInput(page).fill(x.username)]);
        expect(bodyOf(reqOf(res))).toEqual({ sasEntityId: 1, username: x.username });
        const json2 = await res.json();
        expect(json2.status).toBe("fail");
        expect(json2.messageCode).toBe("USERNAME_ALREADY_EXISTS");
        await expect(fieldError(page, "username")).toHaveText(MSG.usernameExist);
        await nameInput(page).fill("QA Dup Test");
        await expect(page.getByText("Password Settings")).toHaveCount(0);
        await nextBtn(page).click();
        await expect(page.getByText("Password Settings")).toHaveCount(0);
        await expect(page).toHaveURL(/\/admin\/users\/create$/);
      });

      test("Real Name: chấp nhận 3-20 ký tự chữ / số / khoảng trắng; từ chối <3, >20 và ký tự đặc biệt / có dấu", async ({ page }) => {
        await openCreate(page);
        for (const bad of ["ab", "a".repeat(21), "Ok-Name", "abc@", "Nguyễn"]) {
          await nameInput(page).fill(bad);
          await expect(fieldError(page, "name"), `"${bad}"`).toHaveText(MSG.realName);
        }
        for (const ok of ["abc", "A b 1", "a".repeat(20)]) {
          await nameInput(page).fill(ok);
          await expect(fieldError(page, "name"), `"${ok}"`).toHaveCount(0);
        }
      });

      test("Email: sai định dạng báo 'Please enter a valid email.'; hợp lệ hoặc để trống thì không lỗi", async ({ page }) => {
        await openCreate(page);
        for (const bad of ["abc", "a@b"]) {
          await emailInput(page).fill(bad);
          await expect(fieldError(page, "email"), bad).toHaveText(MSG.email);
        }
        for (const ok of ["a@b.com", ""]) {
          await emailInput(page).fill(ok);
          await expect(fieldError(page, "email"), `"${ok}"`).toHaveCount(0);
        }
      });

      test("Whatsapp / Telegram: sai định dạng báo lỗi, hợp lệ thì không lỗi; Wechat / Skype nhập tự do", async ({ page }) => {
        await openCreate(page);
        for (const [id, bad, ok, msg] of [
          ["whatsapp", "abc", "+84978122944", MSG.whatsapp],
          ["telegram", "abc", "@qatest12", MSG.telegram],
        ]) {
          await page.locator(`input#${id}`).fill(bad);
          await expect(fieldError(page, id), `${id} "${bad}"`).toHaveText(msg);
          await page.locator(`input#${id}`).fill(ok);
          await expect(fieldError(page, id), `${id} "${ok}"`).toHaveCount(0);
        }
        for (const id of ["wechat", "skype"]) {
          await page.locator(`input#${id}`).fill("abc");
          await expect(fieldError(page, id), id).toHaveCount(0);
        }
      });

      test("Contact Phone: dropdown mã vùng (+1, +20 ...) có tìm kiếm", async ({ page }) => {
        await openCreate(page);
        await page.locator("input#phoneCode").click({ force: true });
        await expect.poll(() => openOptions(page).count()).toBeGreaterThan(0);
        expect(await openOptions(page).first().getAttribute("title")).toMatch(/^\+\d+$/);
        await page.keyboard.type("+84");
        await expect(openOptions(page).filter({ hasText: exact("+84") })).toHaveCount(1);
        await page.keyboard.press("Escape");
      });

      test("Điền đủ bước 1 rồi Next: sang bước 2 'Password Settings' (tự sinh mật khẩu mặc định), Previous quay lại và giữ nguyên dữ liệu", async ({ page }) => {
        const roles = await openCreate(page);
        const f = await fillStep1(page, roles);
        test.skip(!f, "Hệ thống chưa có role");
        await goStep2(page);
        await expect(page.getByText("Password Settings")).toBeVisible();
        await expect(page.locator("label.ant-radio-wrapper-checked")).toHaveText("Automatically generate a password");
        await expect(page.locator("input#forceUpdatePassword")).not.toBeChecked();
        await expect(previousBtn(page)).toBeVisible();
        await expect(submitBtn(page)).toBeVisible();
        await previousBtn(page).click();
        await expect(usernameInput(page)).toHaveValue(f.username);
        await expect(nameInput(page)).toHaveValue(f.name);
        await expect(rolesSelect(page)).toContainText(f.role.label);
      });

      test("Bước 2: Create Password - để trống bị chặn, sai định dạng báo lỗi, mật khẩu hợp lệ (>=8, hoa + thường + số + ký tự đặc biệt) thì hết lỗi", async ({ page }) => {
        const roles = await openCreate(page);
        const f = await fillStep1(page, roles);
        test.skip(!f, "Hệ thống chưa có role");
        await goStep2(page);
        await page.locator("label.ant-radio-wrapper").filter({ hasText: "Create Password" }).click();
        await submitBtn(page).click();
        await expect(formErrors(page)).toHaveText([MSG.required]);
        for (const bad of ["abc", "Abcdef12", "abcdefgh1!", "ABCDEFGH1!", "Abcdefgh!!"]) {
          await passwordInput(page).fill(bad);
          await expect(formErrors(page), `"${bad}"`).toHaveText([MSG.password]);
        }
        await passwordInput(page).fill("Abcdef1!");
        await expect(formErrors(page)).toHaveCount(0);
      });

      test("Submit (response GIẢ, tự sinh mật khẩu): gửi user/create đúng payload (roleIds, status, password hợp lệ) và toast Success", async ({ page }) => {
        const roles = await openCreate(page);
        await mockWrites(page, MOCK_OK);
        const f = await fillStep1(page, roles, { status: "Inactive" });
        test.skip(!f, "Hệ thống chưa có role");
        await goStep2(page);
        const [req] = await Promise.all([page.waitForRequest(isCreate), submitBtn(page).click()]);
        const body = bodyOf(req);
        expect(body).toMatchObject({
          sasEntityId: 1,
          username: f.username,
          name: f.name,
          status: 0,
          roleIds: [f.role.value],
          forceUpdatePassword: false,
        });
        expect(body.password).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/);
        allowedWrites.push({ url: "user/create", body });
        await expect(toasts(page).filter({ hasText: MSG.success })).toBeVisible();
      });

      test("Submit (response GIẢ, Create Password + Force change + thông tin liên hệ): payload gửi đủ các trường đã nhập", async ({ page }) => {
        const roles = await openCreate(page);
        await mockWrites(page, MOCK_OK);
        const f = await fillStep1(page, roles);
        test.skip(!f, "Hệ thống chưa có role");
        await emailInput(page).fill("qa.auto@example.com");
        await page.locator("input#whatsapp").fill("+84978122944");
        await page.locator("input#telegram").fill("@qatest12");
        await page.locator("input#wechat").fill("qawechat");
        await page.locator("input#skype").fill("qaskype");
        await page.locator("input#phoneCode").click({ force: true });
        await page.keyboard.type("+84");
        await openOptions(page).filter({ hasText: exact("+84") }).first().click();
        await page.locator("input#phoneNumber").fill("978122944");
        await goStep2(page);
        await page.locator("label.ant-radio-wrapper").filter({ hasText: "Create Password" }).click();
        await passwordInput(page).fill("Abcdef1!");
        await page.locator("label").filter({ hasText: "Force user to change their password" }).click();
        // Khung "Password Requirements" phủ lên nút Submit khi ô mật khẩu đang focus: bấm tiêu đề để bỏ focus trước
        await page.getByText("Password Settings").click();
        const [req] = await Promise.all([page.waitForRequest(isCreate), submitBtn(page).click()]);
        const body = bodyOf(req);
        expect(body).toMatchObject({
          username: f.username,
          name: f.name,
          status: 1,
          email: "qa.auto@example.com",
          whatsapp: "+84978122944",
          telegram: "@qatest12",
          wechat: "qawechat",
          skype: "qaskype",
          phoneCode: "+84",
          phoneNumber: "978122944",
          password: "Abcdef1!",
          forceUpdatePassword: true,
        });
        allowedWrites.push({ url: "user/create", body });
      });

      test("Cancel ở form Create quay về danh sách, không gửi request ghi", async ({ page }) => {
        await openCreate(page);
        await cancelBtn(page).click();
        await expect(page).toHaveURL(/\/admin\/users$/);
        await expect(rows(page).first()).toBeVisible();
      });

      test("Breadcrumb 'Users' ở form Create quay về danh sách", async ({ page }) => {
        await openCreate(page);
        await breadcrumb(page).getByText("Users").first().click();
        await expect(page).toHaveURL(/\/admin\/users$/);
      });
    });

    // ===== 11. Form Update (không ghi dữ liệu thật) =====
    test.describe("Form Update (không ghi dữ liệu thật)", () => {
      test("Icon Update của dòng đầu mở /admin/users/update/{id}, gọi user/details_by_id {id}, tiêu đề 'Update User'", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const [req] = await Promise.all([page.waitForRequest(isDetails), actionIcon(page, 0, 1).click()]);
        expect(bodyOf(req)).toEqual({ id: String(x.id) });
        await expect(page).toHaveURL(new RegExp(`/admin/users/update/${x.id}$`));
        await expect(breadcrumb(page)).toContainText("Users");
        await expect(breadcrumb(page)).toContainText("Update User");
        await expect(saveBtn(page)).toBeVisible();
        await expect(cancelBtn(page)).toBeVisible();
        await expect(nextBtn(page)).toHaveCount(0); // form 1 bước
      });

      test("Update điền sẵn dữ liệu của user; Username bị khoá", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list[0];
        const d = await openRowAction(page, 0, 1);
        await expect(usernameInput(page)).toHaveValue(x.username);
        await expect(usernameInput(page)).toBeDisabled();
        await expect(nameInput(page)).toHaveValue(x.name);
        await expect(emailInput(page)).toHaveValue(d.email ?? "");
        await expect(statusRadio(page, statusOf(x))).toHaveClass(/ant-radio-wrapper-checked/);
      });

      test("Update: Roles đang chọn khớp roleList của user, danh sách Roles nạp theo dropdown/role {sasEntityId}", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        const x = json.data.list.find((r) => r.roleList.length > 1) ?? json.data.list[0];
        const rolesRes = page.waitForResponse((r) => isFormRoles(r) && bodyOf(reqOf(r)).sasEntityId === x.sasEntityId);
        await actionIcon(page, json.data.list.indexOf(x), 1).click();
        const roles = (await (await rolesRes).json()).data;
        await expect(rolesSelect(page).locator(".ant-select-selection-item")).toHaveCount(x.roleList.length);
        const chips = await rolesSelect(page).locator(".ant-select-selection-item").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
        expect(chips.sort()).toEqual(x.roleList.map((r) => r.code).sort());
        for (const r of x.roleList) expect(roles.map((o) => o.value), `role ${r.code}`).toContain(r.id);
      });

      test("Update: Real Name sai định dạng báo lỗi và chặn Save (không gửi request)", async ({ page }) => {
        await openRowAction(page, 0, 1);
        await nameInput(page).fill("a");
        await saveBtn(page).click();
        await expect(fieldError(page, "name")).toHaveText(MSG.realName);
        await expect(page).toHaveURL(/\/admin\/users\/update\/\d+$/);
        await nameInput(page).fill("");
        // Lỗi cũ còn đang mờ dần (animation) nên có thể có 2 lỗi cùng lúc: chỉ cần lỗi "bắt buộc" hiện ra
        await expect(fieldError(page, "name").filter({ hasText: MSG.required })).toBeVisible();
      });

      test("Update: bỏ hết Roles thì báo bắt buộc và chặn Save", async ({ page }) => {
        await openRowAction(page, 0, 1);
        await expect(rolesSelect(page).locator(".ant-select-selection-item").first()).toBeVisible();
        const n = await rolesSelect(page).locator(".ant-select-selection-item").count();
        for (let k = 0; k < n; k++) {
          await rolesSelect(page).locator(".ant-select-selection-item").first().hover();
          await rolesSelect(page).locator(".ant-select-selection-item-remove").first().click({ force: true });
        }
        await expect(rolesSelect(page).locator(".ant-select-selection-item")).toHaveCount(0);
        await saveBtn(page).click();
        await expect(fieldError(page, "roleIds")).toHaveText(MSG.required);
        await expect(page).toHaveURL(/\/admin\/users\/update\/\d+$/);
      });

      test("Save (response GIẢ): gửi user/update {id, username, name mới, roleIds, status...}, toast 'Successfully Updated' và về danh sách", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await mockWrites(page, MOCK_OK);
        const x = json.data.list[0];
        await openRowAction(page, 0, 1);
        const newName = "QA Upd Mock";
        await nameInput(page).fill(newName);
        const [req] = await Promise.all([page.waitForRequest(isUpdate), saveBtn(page).click()]);
        const body = bodyOf(req);
        expect(body).toMatchObject({
          id: x.id,
          sasEntityId: x.sasEntityId,
          username: x.username,
          name: newName,
          status: x.status,
        });
        expect([...body.roleIds].sort(asc)).toEqual(x.roleList.map((r) => r.id).sort(asc));
        allowedWrites.push({ url: "user/update", body });
        await expect(toasts(page).filter({ hasText: MSG.updated })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/users$/);
      });

      test("Đổi Status sang giá trị còn lại rồi Save (response GIẢ): payload gửi status đảo", async ({ page }) => {
        const { json } = await search(page);
        test.skip(json.data.list.length === 0, "Không có dữ liệu");
        await mockWrites(page, MOCK_OK);
        const x = json.data.list[0];
        await openRowAction(page, 0, 1);
        await statusRadio(page, STATUS_TEXT[1 - x.status]).click();
        const [req] = await Promise.all([page.waitForRequest(isUpdate), saveBtn(page).click()]);
        const body = bodyOf(req);
        expect(body).toMatchObject({ id: x.id, status: 1 - x.status });
        allowedWrites.push({ url: "user/update", body });
      });

      test("Cancel ở form Update quay về danh sách, không gửi request ghi", async ({ page }) => {
        await openRowAction(page, 0, 1);
        await nameInput(page).fill("QA Cancel");
        await cancelBtn(page).click();
        await expect(page).toHaveURL(/\/admin\/users$/);
        await expect(rows(page).first()).toBeVisible();
      });
    });

    // ===== 12. Manage Columns =====
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
        await item(page, "Roles").locator("label").click();
        expect(await headers(page)).not.toContain("Roles");
        expect(await headers(page)).toHaveLength(HEADERS.length - 1);

        await item(page, "Roles").locator("label").click();
        expect(await headers(page)).toEqual(HEADERS);
      });

      test("Dữ liệu các cột còn lại vẫn hiển thị đúng khi ẩn bớt cột", async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có dữ liệu");
        const names = await columnValues(page, "Username");
        const statuses = await columnValues(page, "Status");
        await columnBtn(page).click();
        await item(page, "Roles").locator("label").click();
        expect(await columnValues(page, "Username")).toEqual(names);
        expect(await columnValues(page, "Status")).toEqual(statuses);
        expect(await headers(page)).not.toContain("Roles");
      });
    });

    // ===== 13. Ghi nhớ filter =====
    test.describe("Ghi nhớ filter", () => {
      test("Filter và số dòng / trang được ghi nhớ sau khi reload trang", async ({ page }) => {
        const { json } = await search(page);
        const x = plainUser(json.data.list);
        test.skip(!x, "Không có user nào có username hợp lệ");
        await selectOption(page, "usernameIds", x.username);
        await selectStatus(page, statusOf(x));
        await search(page);
        await pageSizeSelect(page).click();
        await reloadBy(page, () => openOptions(page).filter({ hasText: "20 / page" }).click());

        const [req] = await Promise.all([page.waitForRequest(isList), openPage(page)]); // reload
        expect(bodyOf(req)).toMatchObject({ pageSize: 20, filters: { usernameIds: [x.id], status: x.status } });
        expect(await selectedTitles(page, "usernameIds")).toEqual([x.username]);
        await expect(filterEl(page, "status").locator(".ant-select-selection-item")).toHaveText(statusOf(x));
        await expect(pageSizeSelect(page)).toContainText("20 / page");
      });

      test("Sau Reset rồi reload: filter không còn được ghi nhớ", async ({ page }) => {
        const { json } = await search(page);
        const x = plainUser(json.data.list);
        test.skip(!x, "Không có user nào có username hợp lệ");
        await selectOption(page, "usernameIds", x.username);
        await search(page);
        await reloadBy(page, () => resetBtn(page).click());

        await openPage(page); // reload
        await expect(page.locator(".NextGen-filter-element .ant-select-selection-item")).toHaveCount(0);
        await expect(rows(page)).toHaveCount(Math.min(10, json.data.totalCount));
      });
    });
  });

  // ===== NHÓM CRUD (GHI DỮ LIỆU THẬT trên user QA) =====
  test.describe("CRUD (ghi dữ liệu thật trên user QA, luôn khôi phục lại)", () => {
    test.describe.configure({ mode: "serial" });

    let qa; // { id, username, name, sasEntityId, status } - user QA (username bắt đầu bằng qaauto, Real Name "QA AUTO ...")

    // Tìm user QA qua dropdown Username (tìm phía server) rồi lọc + Search. Trả về null nếu chưa có
    async function findQaUser(page) {
      await openDropdown(page, "usernameIds");
      const [res] = await Promise.all([
        page.waitForResponse((r) => isUserDropdown(r) && bodyOf(reqOf(r)).filters?.username === QA_USER_PREFIX),
        page.keyboard.type(QA_USER_PREFIX),
      ]);
      const found = (await res.json()).data.find((r) => r.username.startsWith(QA_USER_PREFIX) && norm(r.name).startsWith(QA_NAME_PREFIX));
      await breadcrumb(page).click();
      await expect(openOptions(page)).toHaveCount(0);
      if (!found) return null;
      const { json } = await filterQa(page, found.username);
      const x = json.data.list.find((r) => r.id === found.id);
      return x ? { id: x.id, username: x.username, name: x.name, sasEntityId: x.sasEntityId, status: x.status } : null;
    }

    // Lọc danh sách theo username của user QA (bỏ qua bước chọn nếu filter đã được app ghi nhớ) rồi Search. Trả về { body, json }
    async function filterQa(page, username) {
      if (!(await selectedTitles(page, "usernameIds")).includes(username)) await selectOption(page, "usernameIds", username);
      return search(page);
    }

    // Mở lại danh sách (reload) và lọc theo user QA
    async function openQa(page) {
      await openPage(page);
      return filterQa(page, qa.username);
    }

    async function confirmToggle(page, action) {
      await openRowMenu(page, 0);
      await menuItems(page).filter({ hasText: exact(action) }).click();
      const [req, res] = await Promise.all([
        page.waitForRequest(isUpdateStatus),
        page.waitForResponse(isUpdateStatus),
        dialog(page).getByRole("button", { name: new RegExp(`${action}$`) }).click(),
      ]);
      const json = await res.json();
      expect(json.status).toBe("success");
      await settle(page);
      return bodyOf(req);
    }

    // Đưa user QA về Real Name + trạng thái gốc (Inactive). Dùng trong finally / afterAll; chỉ ghi lên đúng user QA
    async function restore(page) {
      await openPage(page);
      const cur = await findQaUser(page);
      if (!cur) return;
      if (cur.status !== 0) await confirmToggle(page, "Deactivate");
      if (cur.name !== qa.name) {
        await openRowAction(page, 0, 1);
        await nameInput(page).fill(qa.name);
        await Promise.all([page.waitForResponse(isUpdate), saveBtn(page).click()]);
        // Chờ app điều hướng xong về danh sách, tránh page.goto kế tiếp bị ERR_ABORTED giữa chừng
        await expect(page).toHaveURL(/\/admin\/users$/);
        await settle(page);
      }
    }

    test.afterAll(async ({ browser }) => {
      test.setTimeout(120000);
      if (!qa) return;
      const ctx = await browser.newContext({ storageState: buildStorageState(), viewport: VIEWPORT });
      const page = await ctx.newPage();
      try {
        await page.addInitScript(() => {
          for (const k of Object.keys(localStorage)) if (/admin_users_(filter|page_size)$/.test(k)) localStorage.removeItem(k);
        });
        await restore(page);
      } finally {
        await ctx.close();
      }
    });

    test.beforeEach(async ({ page }) => {
      await openPage(page);
    });

    // Mọi request ghi của nhóm này chỉ được nhắm vào user QA (không bao giờ sửa user có sẵn của team)
    test.afterEach(async () => {
      for (const w of writes) {
        expect(
          ["user/create", "user/update", "user/update-user-status", "user/reset-two-factory", "user/reset-password"],
          "URL ghi không nằm trong danh sách",
        ).toContain(w.url);
        if (w.url === "user/create") {
          expect(w.body.username, "user/create chỉ dùng username qaauto...").toMatch(new RegExp(`^${QA_USER_PREFIX}`));
          expect(w.body.name, "user/create chỉ dùng name QA AUTO ...").toMatch(new RegExp(`^${QA_NAME_PREFIX}`));
          expect(w.body.status, "user QA luôn được tạo ở trạng thái Inactive").toBe(0);
        } else if (w.url === "user/update" || w.url === "user/reset-two-factory") {
          expect(w.body.id, `${w.url} phải nhắm đúng user QA`).toBe(qa.id);
        } else if (w.url === "user/update-user-status") {
          expect(w.body.ids ?? [w.body.id], "update-user-status phải nhắm đúng user QA").toEqual([qa.id]);
        } else if (w.url === "user/reset-password") {
          expect(w.body.entityUserId, "reset-password phải nhắm đúng user QA").toBe(String(qa.id));
        }
      }
    });

    test("Tạo user QA (chỉ khi CHƯA có user qaauto nào - user không xoá được bằng UI): Submit gửi user/create (Inactive), dòng mới có trong danh sách", async ({ page }) => {
      qa = await findQaUser(page);
      test.skip(!!qa, `Đã có user QA ${qa?.username} (do lần chạy trước tạo) - không tạo thêm vì màn hình không có chức năng xoá`);

      const roles = await openCreate(page);
      const f = await fillStep1(page, roles, { status: "Inactive" });
      test.skip(!f, "Hệ thống chưa có role để tạo user QA");
      await goStep2(page);
      const [req, res] = await Promise.all([page.waitForRequest(isCreate), page.waitForResponse(isCreate), submitBtn(page).click()]);
      const body = bodyOf(req);
      expect(body).toMatchObject({
        sasEntityId: 1,
        username: f.username,
        name: f.name,
        status: 0,
        roleIds: [f.role.value],
      });
      const json = await res.json();
      expect(json.status).toBe("success");
      await expect(toasts(page).filter({ hasText: MSG.success })).toBeVisible();

      // Mở lại danh sách và lọc theo username mới tạo
      await openPage(page);
      await selectOption(page, "usernameIds", f.username);
      const { json: after } = await search(page);
      expect(after.data.list).toHaveLength(1);
      const x = after.data.list[0];
      expect(x).toMatchObject({ username: f.username, name: f.name, status: 0, sasEntityId: 1 });
      expect(x.roleList.map((r) => r.id)).toEqual([f.role.value]);
      await expect(cellAt(page, 0, COL.username)).toHaveText(f.username);
      await expect(cellAt(page, 0, COL.name)).toHaveText(f.name);
      await expect(cellAt(page, 0, COL.status)).toHaveText("Inactive");
      qa = { id: x.id, username: x.username, name: x.name, sasEntityId: x.sasEntityId, status: x.status };
    });

    test("Tìm được user QA trong danh sách (lọc theo Username)", async ({ page }) => {
      qa = qa ?? (await findQaUser(page));
      test.skip(!qa, "Chưa có user QA");
      const { json } = await filterQa(page, qa.username);
      expect(json.data.list.map((r) => r.id)).toEqual([qa.id]);
      await expect(rowOfUsername(page, qa.username)).toHaveCount(1);
    });

    test("Tạo user mới trùng Username với user QA: validate báo 'Username already exists', chặn Next (không tạo user)", async ({ page }) => {
      test.skip(!qa, "Chưa có user QA");
      await openCreate(page);
      const [res] = await Promise.all([page.waitForResponse(isValidateUsername), usernameInput(page).fill(qa.username)]);
      const json = await res.json();
      expect(json.status).toBe("fail");
      expect(json.messageCode).toBe("USERNAME_ALREADY_EXISTS");
      await expect(fieldError(page, "username")).toHaveText(MSG.usernameExist);
      await nameInput(page).fill(`${QA_NAME_PREFIX} DUP`);
      await nextBtn(page).click();
      await expect(page.getByText("Password Settings")).toHaveCount(0);
    });

    test("Sửa Real Name user QA: Save gửi user/update, toast 'Successfully Updated', về danh sách, dòng đổi tên, View hiển thị tên mới; rồi khôi phục tên gốc", async ({ page }) => {
      test.skip(!qa, "Chưa có user QA");
      const newName = `${QA_NAME_PREFIX} E${String(Date.now()).slice(-4)}`;
      try {
        await filterQa(page, qa.username);
        const d = await openRowAction(page, 0, 1);
        await expect(nameInput(page)).toHaveValue(qa.name);
        await nameInput(page).fill(newName);
        const [req, res] = await Promise.all([page.waitForRequest(isUpdate), page.waitForResponse(isUpdate), saveBtn(page).click()]);
        expect(bodyOf(req)).toMatchObject({
          id: qa.id,
          username: qa.username,
          name: newName,
          sasEntityId: qa.sasEntityId,
          status: d.status,
          roleIds: d.roleList.map((r) => r.id),
        });
        expect((await res.json()).status).toBe("success");
        await expect(toasts(page).filter({ hasText: MSG.updated })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/users$/);

        await settle(page);
        const { json: after } = await filterQa(page, qa.username);
        expect(after.data.list[0]).toMatchObject({ id: qa.id, username: qa.username, name: newName });
        await expect(cellAt(page, 0, COL.name)).toHaveText(newName);
        await openRowAction(page, 0, 0);
        await expect(infoItem(page, "Real Name")).toContainText(newName);
      } finally {
        await restore(page);
      }
      await openQa(page);
      await expect(cellAt(page, 0, COL.name)).toHaveText(qa.name);
    });

    test("Activate user QA rồi Deactivate lại: gửi user/update-user-status {id,status}, dòng đổi Status tương ứng", async ({ page }) => {
      test.skip(!qa, "Chưa có user QA");
      try {
        await filterQa(page, qa.username);
        await expect(cellAt(page, 0, COL.status)).toHaveText("Inactive");
        const on = await confirmToggle(page, "Activate");
        expect(on).toEqual({ id: qa.id, status: 1 });
        await expect(toasts(page).filter({ hasText: MSG.success })).toBeVisible();
        const { json } = await filterQa(page, qa.username);
        expect(json.data.list[0]).toMatchObject({ id: qa.id, status: 1 });
        await expect(cellAt(page, 0, COL.status)).toHaveText("Active");
      } finally {
        await restore(page);
      }
      await openQa(page);
      await expect(cellAt(page, 0, COL.status)).toHaveText("Inactive");
    });

    test("Reset 2FA user QA (thật): gửi user/reset-two-factory {id, sasEntityId}, toast Success", async ({ page }) => {
      test.skip(!qa, "Chưa có user QA");
      await filterQa(page, qa.username);
      await openRowMenu(page, 0);
      await menuItems(page).filter({ hasText: exact("Reset 2FA") }).click();
      const [req, res] = await Promise.all([
        page.waitForRequest(isReset2fa),
        page.waitForResponse(isReset2fa),
        dialog(page).getByRole("button", { name: "OK" }).click(),
      ]);
      expect(bodyOf(req)).toEqual({ id: qa.id, sasEntityId: qa.sasEntityId });
      const json = await res.json();
      if (json.status === "success") {
        await expect(toasts(page).filter({ hasText: MSG.success })).toBeVisible();
      } else {
        // User QA chưa bind OTP nên backend không cho reset: fail + messageCode USER_OTP_UNBINDED (hành vi đúng, không phải bug)
        expect(json, `response: ${JSON.stringify(json)}`).toMatchObject({ status: "fail", messageCode: "USER_OTP_UNBINDED", message: "User OTP is not binded" });
        await expect(toasts(page).filter({ hasText: json.message })).toBeVisible();
      }
    });

    test("Reset Password user QA (thật, tự sinh): gửi user/reset-password {entityUserId, password}, toast Success", async ({ page }) => {
      test.skip(!qa, "Chưa có user QA");
      await filterQa(page, qa.username);
      await openRowMenu(page, 0);
      await menuItems(page).filter({ hasText: exact("Reset Password") }).click();
      const [req, res] = await Promise.all([
        page.waitForRequest(isResetPassword),
        page.waitForResponse(isResetPassword),
        dialog(page).getByRole("button", { name: "Save", exact: true }).click(),
      ]);
      const body = bodyOf(req);
      expect(body).toMatchObject({ entityUserId: String(qa.id), forceUpdatePassword: false });
      expect(body.password).toBe(body.newPassword);
      expect((await res.json()).status).toBe("success");
      await expect(toasts(page).filter({ hasText: MSG.success })).toBeVisible();
    });
  });
});
