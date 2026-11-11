// Menu người dùng ở góc trên bên phải của Back Office (https://dev-bo.royaledge.io/): bấm vào tên user (vd "tienadmin") ở header.
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   $env:Path = "C:\laragon\bin\nodejs\node-v22;" + $env:Path
//   npx playwright test tests/user_menu.spec.js --project=setup --project=chromium --reporter=line
//
// Menu gồm: thẻ user (tên + username), "Languages : <ngôn ngữ>" (submenu English (UK) / 中文 (简体) / Vietnamese (VI), mục đang chọn có dấu check),
// "Change Password", "Logout". Chỉ test 3 chức năng: đổi ngôn ngữ, Change Password, Logout (không test phần khác của màn hình).
//
// Quan sát khi khám phá:
//  - Ngôn ngữ: đổi KHÔNG gọi API nào, chỉ ghi localStorage "DEV-appLang" = "en" | "zh" | "vi" (mặc định chưa có key = English); chữ trên menu / sidebar / hộp thoại /
//    màn hình khác đổi ngay (không cần reload); ghi nhớ sau reload; mọi request API sau đó gửi header "lang" = mã ngôn ngữ. <html lang> luôn là "en".
//  - Change Password: hộp thoại "Edit Password Details" (Old Password #oldPassword / New Password #password / Confirm New Password #confirmPassword, nút Cancel / Save Changes),
//    Save gọi POST user/change-password { oldPassword, newPassword, confirmPassword }. Thành công: toast Success, đóng hộp thoại, KHÔNG bị logout.
//  - Logout: hộp thoại xác nhận "Log Out" (Cancel / Log out); xác nhận gọi POST auth/logout (body rỗng, kèm Bearer token), rồi xoá mọi key DEV-* và "region" khỏi localStorage
//    (giữ device-unique-signature và các key sorter__*) và chuyển về /login. Không có cookie nào (token ở localStorage).
//
// AN TOÀN DỮ LIỆU / TÀI KHOẢN (rất quan trọng - tài khoản dùng chung của team, backend chỉ cho 1 session):
//  - KHÔNG BAO GIỜ gửi request đổi mật khẩu hoặc logout THẬT tới server. beforeEach chặn mọi POST ghi tới API (route.abort); test nào cần bấm Save / Log out thì
//    đăng ký thêm route.fulfill trả response GIẢ (status success / fail do test tự dựng) cho đúng URL đó -> request không bao giờ tới server.
//    Mật khẩu dùng trong test là chuỗi giả (không phải mật khẩu thật). afterEach so sánh chính xác request ghi bắt được với danh sách được phép (allowedWrites).
//  - Logout phía client chỉ xoá localStorage của context trình duyệt của chính test đó (mỗi test có context riêng), không đụng tới session.txt / token trên server.
//  - Mỗi test đổi ngôn ngữ đều khôi phục English (UK) bằng UI trong finally (ngoài ra ngôn ngữ chỉ nằm trong localStorage của context của test nên không ảnh hưởng test khác).
//
// CÁC HÀNH VI SAU ĐÃ ĐƯỢC USER XÁC NHẬN LÀ ĐÚNG (không phải lỗi; test assert đúng hành vi hiện tại):
//  1. Sửa Old Password cho trùng New Password sau khi đã nhập: ô New Password không báo lỗi "same as old" (chỉ báo khi sửa chính ô New / Save).
//  2. Toast lỗi của Change Password hiện messageCode ("QA_MOCK_FAIL") chứ không phải message của server.
//  3. Logout: server trả fail vẫn xoá token và về /login; lỗi mạng thì ở lại trang với toast "TypeError: Failed to fetch".
//  4. Logout xoá luôn ngôn ngữ đã chọn (DEV-appLang bị xoá) nên trang login quay về mặc định.
//  5. Mã ngôn ngữ không được đặt vào <html lang> (luôn "en").
//  6. Khi ô New Password đang focus, khung "Password Requirements" che nút Cancel / Save Changes -> test bấm tiêu đề để bỏ focus trước.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");

test.use({
  viewport: { width: 1920, height: 1080 },
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

// Màn hình nền để mở menu (nhẹ hơn Dashboard); menu user có ở mọi màn hình sau khi đăng nhập
const BASE_PAGE = "/download-history";
const LANG_KEY = "DEV-appLang";

// Chuỗi hiển thị theo từng ngôn ngữ (đọc từ màn hình thật; tên ngôn ngữ trong submenu luôn giữ nguyên ở mọi ngôn ngữ)
const LANGS = [
  {
    code: "en",
    name: "English (UK)",
    label: "Languages",
    changePassword: "Change Password",
    logout: "Logout",
    dashboard: "Dashboard",
    history: "Download History",
    cp: {
      title: "Edit Password Details",
      fields: ["Old Password", "New Password", "Confirm New Password"],
      cancel: "Cancel",
      save: "Save Changes",
      required: "This field is required",
      invalid: "Please enter a valid password",
      popoverTitle: "Password Requirements",
    },
  },
  {
    code: "zh",
    name: "中文 (简体)",
    label: "语言",
    changePassword: "更改密码",
    logout: "退出",
    dashboard: "仪表板",
    history: "下载历史记录",
    cp: {
      title: "编辑密码",
      fields: ["旧密码", "新密码", "确认新密码"],
      cancel: "取消",
      save: "保存更改",
      required: "这是必填项目",
      invalid: "请输入有效密码",
      popoverTitle: "密码需求",
    },
  },
  {
    code: "vi",
    name: "Vietnamese (VI)",
    label: "Ngôn ngữ",
    changePassword: "Thay đổi mật khẩu",
    logout: "Đăng xuất",
    dashboard: "Bảng điều khiển",
    history: "Lịch sử tải xuống",
    cp: {
      title: "Chỉnh sửa chi tiết mật khẩu",
      fields: ["Mật khẩu cũ", "Mật khẩu mới", "Xác nhận mật khẩu mới"],
      cancel: "Hủy bỏ",
      save: "Lưu các thay đổi",
      required: "Trường này được yêu cầu",
      invalid: "Vui lòng nhập mật khẩu hợp lệ",
      popoverTitle: "Yêu cầu mật khẩu",
    },
  },
];
const EN = LANGS[0];
const ZH = LANGS[1];
const VI = LANGS[2];
const NON_EN = [ZH, VI];

const CP_FIELDS = ["oldPassword", "password", "confirmPassword"]; // id các ô, đúng thứ tự hiển thị
const POPOVER_RULES_EN = [
  "Minimum 8 characters in length",
  "Contain at least 1 lowercase letter",
  "Contain at least 1 uppercase letter",
  "Contain at least 1 number",
  "Contain at least 1 symbol (@#$%^&+!=.></~*{})",
];
const MSG_EN = {
  mismatch: "Passwords do not match",
  sameAsOld: "New password cannot be the same as old password",
};
// Mật khẩu GIẢ dùng cho test (không phải mật khẩu thật của tài khoản nào)
const FAKE_OLD = "QaFakeOld#1234";
const FAKE_NEW = "QaFakeNew#5678";

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI (user/change-password, auth/logout...)
const READ = /\/(list|details|download|view|summary)(\?|$)|\/dropdown|ggr-trend|top-/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isDetails = endsWith("/user/details");
const isChangePassword = endsWith("/user/change-password");
const isLogout = endsWith("/auth/logout");
const isApi = (r) => /boapi/.test(reqOf(r).url());

const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData() || "{}");
  return rest;
};

const profileBtn = (page) => page.locator("button.NextGen-popover-profile");
const userMenu = (page) =>
  page.locator(".ant-dropdown:not(.ant-dropdown-hidden)").filter({ has: page.locator('[data-menu-id$="-changePassword"]') });
// id: profile | languages | changePassword | logout
const menuItem = (page, id) => userMenu(page).locator(`[data-menu-id$="-${id}"]`);
const langPopup = (page) => page.locator(".ant-dropdown-menu-submenu-popup:not(.ant-dropdown-menu-submenu-hidden)");
const langItem = (page, code) => langPopup(page).locator(`li[data-menu-id$="-${code}"]`);
const sidebar = (page) => page.locator(".ant-layout-sider");
const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const toasts = (page) => page.locator(".Toastify__toast");

// Hộp thoại Change Password
const cpModal = (page) => page.locator(".NextGen-modal-change-password");
const cpField = (page, id) => cpModal(page).locator(".ant-form-item").filter({ has: page.locator(`#${id}`) });
const cpInput = (page, id) => cpModal(page).locator(`#${id}`);
// Không tính lỗi đang chạy hiệu ứng biến mất (class ...-leave) để tránh đếm trùng khi lỗi đổi nội dung
const cpErrors = (page, id) => cpField(page, id).locator(".ant-form-item-explain-error:not(.ant-form-show-help-item-leave)");
const cpSave = (page) => cpModal(page).locator("button.NextGen-button-confirmation__submit");
const cpCancel = (page) => cpModal(page).locator("button.NextGen-button-confirmation__cancel");
const cpClose = (page) => cpModal(page).locator(".ant-modal-close");
const cpTitle = (page) => cpModal(page).locator(".ant-modal-title");
const popover = (page) => page.locator(".ant-popover:not(.ant-popover-hidden)");
const popoverRules = (page) => popover(page).locator('div[class*="_className__"]:not([class*="__title_"])');

// Hộp thoại Logout
const logoutDialog = (page) => page.locator(".ant-modal").filter({ has: page.locator(".NextGen-modal-logout__description") });
const logoutCancel = (page) => logoutDialog(page).locator(".ant-modal-footer .ant-btn-default");
const logoutConfirm = (page) => logoutDialog(page).locator(".ant-modal-footer .ant-btn-primary");

const storedLang = (page) => page.evaluate((k) => localStorage.getItem(k), LANG_KEY);
// Bỏ key iconify* (cache icon do thư viện icon tự ghi thêm khi render, không liên quan đăng nhập)
const localKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => !/^iconify/i.test(k)));
const sidebarLines = async (page) =>
  (await sidebar(page).innerText()).split("\n").map(norm).filter(Boolean);

// Ghi lại mọi request API đã gửi (kể cả request bị chặn / trả giả)
function watchApi(page) {
  const reqs = [];
  page.on("request", (r) => {
    if (/boapi/.test(r.url())) reqs.push({ method: r.method(), url: r.url().replace(/^.*\/v1\//, ""), headers: r.headers(), req: r });
  });
  return reqs;
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

// Lớp bảo hiểm: chặn mọi request ghi tới server thật (request vẫn được watchWrites ghi nhận).
// Test cần Save / Log out sẽ đăng ký thêm route.fulfill (đăng ký sau -> được ưu tiên) với response GIẢ.
async function blockWrites(page) {
  await page.route(/royaledge\.io/, (route) => {
    const r = route.request();
    const isPost = r.method() === "POST";
    if (isPost && /boapi/.test(r.url()) && !READ.test(r.url())) return route.abort();
    if (isPost && !/boapi|cdn-cgi/.test(r.url())) return route.abort();
    return route.fallback();
  });
}

const FAKE_SUCCESS = { status: "success", messageCode: "SUCCESS", message: "SUCCESS" };
const FAKE_FAIL = { status: "fail", messageCode: "QA_MOCK_FAIL", message: "QA mock fail" };
// Trả response GIẢ cho 1 API ghi: request KHÔNG tới server
async function mockWrite(page, suffix, response) {
  await page.route(
    (url) => url.pathname.endsWith(suffix),
    (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ traceId: "qa-mock", ...response }) });
    },
  );
}

// Mở màn hình và chờ user/details (đã đăng nhập). Trả về { username, sidebar } (sidebar tiếng Anh ban đầu)
async function openPage(page) {
  test.setTimeout(90000);
  const details = page.waitForResponse(isDetails, { timeout: 60000 });
  details.catch(() => {}); // tránh unhandled rejection khi test kết thúc sớm
  await page.goto(BASE_PAGE);
  // Session hết hạn -> app chuyển về /login (hoặc API trả UNAUTHORIZED_USER): báo lỗi rõ ràng thay vì chờ timeout
  const redirectedToLogin = page
    .waitForURL(/\/login/, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (await Promise.race([details.then(() => false), redirectedToLogin])) throw new Error(SESSION_MSG);
  let json = await (await details).json();
  if (json.status !== "success") throw new Error(`${SESSION_MSG} (user/details: ${json.messageCode})`);
  await expect(profileBtn(page)).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
  // Mặc định test chạy ở English: nếu session.txt có sẵn DEV-appLang khác "en" thì đặt lại rồi nạp lại trang
  const stored = await storedLang(page);
  if (stored && stored !== "en") {
    await page.evaluate((k) => localStorage.setItem(k, "en"), LANG_KEY);
    const again = page.waitForResponse(isDetails, { timeout: 60000 });
    await page.reload();
    json = await (await again).json();
    await expect(profileBtn(page)).toBeVisible();
  }
  const lines = await sidebarLines(page);
  expect(lines.length, "Sidebar phải có menu (user/details thành công)").toBeGreaterThan(1);
  return { username: json.data.username, sidebar: lines };
}
const SESSION_MSG =
  "Bị chuyển về /login: session trong playwright/.auth/session.txt đã hết hạn (backend chỉ cho 1 session/tài khoản - đăng nhập ở nơi khác sẽ làm session này mất hiệu lực; token chỉ sống khoảng 1 giờ). Copy lại localStorage từ DevTools.";

// Mở menu user (bấm tên ở header)
async function openMenu(page) {
  if (!(await userMenu(page).isVisible())) await profileBtn(page).click();
  await expect(userMenu(page)).toBeVisible();
}

// Đóng menu bằng cách bấm ra ngoài (vùng nội dung)
async function closeMenu(page) {
  await page.mouse.click(1000, 700);
  await expect(userMenu(page)).toHaveCount(0);
}

// Mở submenu Languages (rê chuột vào mục Languages)
async function openLanguages(page) {
  await openMenu(page);
  await menuItem(page, "languages").hover();
  await expect(langPopup(page)).toBeVisible();
}

// Chọn 1 ngôn ngữ trong submenu (menu tự đóng sau khi chọn)
async function selectLanguage(page, code) {
  await openLanguages(page);
  await langItem(page, code).click();
  await expect(userMenu(page)).toHaveCount(0);
}

// Đọc nhãn "Languages : ..." của menu (mở rồi đóng menu)
async function languageLabel(page) {
  await openMenu(page);
  const text = norm(await menuItem(page, "languages").innerText());
  await closeMenu(page);
  return text;
}

// Chờ giao diện đổi sang ngôn ngữ L (nhãn trên menu + sidebar)
async function expectLanguage(page, L) {
  await expect.poll(() => storedLang(page)).toBe(L.code);
  await expect.poll(async () => (await sidebarLines(page))[0], { message: `Sidebar chưa đổi sang ${L.code}` }).toBe(L.dashboard);
  await expect.poll(() => languageLabel(page)).toBe(`${L.label} : ${L.name}`);
}

// Khôi phục English (UK) bằng UI; luôn chạy trong finally
async function restoreEnglish(page) {
  try {
    if (await cpModal(page).isVisible()) {
      await cpClose(page).click();
      await expect(cpModal(page)).toBeHidden();
    }
    if (await logoutDialog(page).isVisible()) {
      await logoutCancel(page).click();
      await expect(logoutDialog(page)).toBeHidden();
    }
    if (await userMenu(page).isVisible()) await closeMenu(page);
    const code = await storedLang(page);
    if (code && code !== "en") await selectLanguage(page, "en");
  } catch (e) {
    // Dự phòng: ít nhất đưa localStorage của context về en
    await page.evaluate((k) => localStorage.setItem(k, "en"), LANG_KEY).catch(() => {});
  }
}

// Mở hộp thoại Change Password từ menu
async function openChangePassword(page) {
  await openMenu(page);
  await menuItem(page, "changePassword").click();
  await expect(userMenu(page)).toHaveCount(0); // chờ menu đóng hẳn (hiệu ứng) trước khi thao tác tiếp
  await expect(cpModal(page)).toBeVisible();
  await expect(cpInput(page, "oldPassword")).toBeVisible();
}

// Điền form (giá trị undefined = bỏ qua ô) rồi bấm tiêu đề để bỏ focus (khung Password Requirements che nút Save khi ô New Password còn focus)
async function fillCp(page, { old, pw, confirm }) {
  if (old !== undefined) await cpInput(page, "oldPassword").fill(old);
  if (pw !== undefined) await cpInput(page, "password").fill(pw);
  if (confirm !== undefined) await cpInput(page, "confirmPassword").fill(confirm);
  await cpTitle(page).click();
}

async function openLogoutDialog(page) {
  await openMenu(page);
  await menuItem(page, "logout").click();
  await expect(userMenu(page)).toHaveCount(0); // chờ menu đóng hẳn (hiệu ứng) trước khi thao tác tiếp
  await expect(logoutDialog(page)).toBeVisible();
}

// ---------------------------------------------------------------------------
// Chung: chặn request ghi, afterEach kiểm tra đúng request ghi
// ---------------------------------------------------------------------------
let writes; // request ghi bắt được trong test hiện tại
let allowedWrites; // URL request ghi được phép (mặc định: không có)
let apiReqs; // mọi request API của test hiện tại

test.beforeEach(async ({ page }) => {
  writes = watchWrites(page);
  apiReqs = watchApi(page);
  allowedWrites = [];
  await blockWrites(page);
});

test.afterEach(async () => {
  expect(
    writes.map((w) => w.url),
    "Chỉ được gửi các request ghi nằm trong danh sách cho phép (và chúng đều bị chặn / trả giả, không tới server)",
  ).toEqual(allowedWrites);
});

// ===========================================================================
// 1. Menu người dùng
// ===========================================================================
test.describe("Menu người dùng", () => {
  test("Nút user ở header hiện đúng username của tài khoản đang đăng nhập (user/details)", async ({ page }) => {
    const { username } = await openPage(page);
    expect(username).toBeTruthy();
    await expect(profileBtn(page)).toHaveText(exact(username));
  });

  test("Bấm tên user mở menu: thẻ user + 3 mục Languages / Change Password / Logout đúng thứ tự, không gọi API", async ({ page }) => {
    const { username } = await openPage(page);
    apiReqs.length = 0;
    await profileBtn(page).click();
    await expect(userMenu(page)).toBeVisible();
    await expect(menuItem(page, "profile")).toContainText(username);
    // 6 phần tử: thẻ user, đường kẻ, Languages, Change Password, đường kẻ, Logout
    await expect(userMenu(page).locator("ul[role=menu] > li")).toHaveCount(6);
    await expect(userMenu(page).locator("ul[role=menu] > li").nth(1)).toHaveAttribute("role", "separator");
    await expect(userMenu(page).locator("ul[role=menu] > li").nth(4)).toHaveAttribute("role", "separator");
    await expect(
      userMenu(page).locator('[data-menu-id$="-languages"], [data-menu-id$="-changePassword"], [data-menu-id$="-logout"]'),
    ).toHaveText([`${EN.label} : ${EN.name}`, EN.changePassword, EN.logout]);
    // Mỗi mục hành động có icon
    for (const id of ["languages", "changePassword", "logout"]) {
      await expect(menuItem(page, id).locator("svg").first()).toBeVisible();
    }
    expect(apiReqs.map((r) => r.url), "Mở menu không được gọi API").toEqual([]);
  });

  test("Bấm lại vào tên user hoặc bấm ra ngoài thì menu đóng", async ({ page }) => {
    await openPage(page);
    await openMenu(page);
    await profileBtn(page).click();
    await expect(userMenu(page)).toHaveCount(0);
    await openMenu(page);
    await closeMenu(page);
  });

  test("Rê chuột vào Languages mở submenu 3 mục; bấm ra ngoài đóng cả menu lẫn submenu", async ({ page }) => {
    await openPage(page);
    await openLanguages(page);
    await expect(langPopup(page).locator("li")).toHaveCount(3);
    await closeMenu(page);
    await expect(langPopup(page)).toHaveCount(0);
  });
});

// ===========================================================================
// 2. Đổi ngôn ngữ (Languages)
// ===========================================================================
test.describe("Đổi ngôn ngữ (Languages)", () => {
  test("Mặc định: nhãn 'Languages : English (UK)', chưa có key DEV-appLang (hoặc = en)", async ({ page }) => {
    await openPage(page);
    expect(["en", null]).toContain(await storedLang(page));
    expect(await languageLabel(page)).toBe(`${EN.label} : ${EN.name}`);
  });

  test("Submenu có đúng 3 lựa chọn: English (UK) / 中文 (简体) / Vietnamese (VI)", async ({ page }) => {
    await openPage(page);
    await openLanguages(page);
    await expect(langPopup(page).locator("li")).toHaveText(LANGS.map((l) => l.name));
    for (const L of LANGS) await expect(langItem(page, L.code)).toBeVisible();
    await closeMenu(page);
  });

  test("Mặc định: chỉ English (UK) có dấu check và được tô chọn (selected)", async ({ page }) => {
    await openPage(page);
    await openLanguages(page);
    await expect(langItem(page, "en").locator(".anticon-check")).toHaveCount(1);
    await expect(langItem(page, "en")).toHaveClass(/ant-dropdown-menu-item-selected/);
    for (const L of NON_EN) {
      await expect(langItem(page, L.code).locator(".anticon-check")).toHaveCount(0);
      await expect(langItem(page, L.code)).not.toHaveClass(/ant-dropdown-menu-item-selected/);
    }
    await expect(langPopup(page).locator(".anticon-check")).toHaveCount(1);
    await closeMenu(page);
  });

  for (const L of NON_EN) {
    test(`Đổi sang ${L.name}: nhãn Languages, menu, sidebar đổi theo; localStorage DEV-appLang = ${L.code}; không gọi API`, async ({ page }) => {
      const { sidebar: before } = await openPage(page);
      try {
        apiReqs.length = 0;
        await selectLanguage(page, L.code);
        await expectLanguage(page, L);
        // Các mục menu đổi theo ngôn ngữ
        await openMenu(page);
        await expect(
          userMenu(page).locator('[data-menu-id$="-languages"], [data-menu-id$="-changePassword"], [data-menu-id$="-logout"]'),
        ).toHaveText([`${L.label} : ${L.name}`, L.changePassword, L.logout]);
        await closeMenu(page);
        // Sidebar: cùng số mục, mọi mục đều khác chữ tiếng Anh, mục cuối là Download History đã dịch
        const after = await sidebarLines(page);
        expect(after.length).toBe(before.length);
        after.forEach((t, i) => expect(t, `Mục sidebar #${i} chưa dịch`).not.toBe(before[i]));
        expect(after.at(-1)).toBe(L.history);
        // Tên user ở header không đổi, đổi ngôn ngữ không gọi API nào (chỉ client)
        expect(apiReqs.map((r) => r.url), "Đổi ngôn ngữ không được gọi API").toEqual([]);
      } finally {
        await restoreEnglish(page);
      }
    });

    test(`Đổi sang ${L.name}: dấu check chuyển sang đúng ngôn ngữ đó`, async ({ page }) => {
      await openPage(page);
      try {
        await selectLanguage(page, L.code);
        await expectLanguage(page, L);
        await openLanguages(page);
        await expect(langPopup(page).locator("li")).toHaveText(LANGS.map((l) => l.name)); // tên ngôn ngữ giữ nguyên ở mọi ngôn ngữ
        await expect(langPopup(page).locator(".anticon-check")).toHaveCount(1);
        await expect(langItem(page, L.code).locator(".anticon-check")).toHaveCount(1);
        await expect(langItem(page, L.code)).toHaveClass(/ant-dropdown-menu-item-selected/);
        for (const other of LANGS.filter((x) => x.code !== L.code)) {
          await expect(langItem(page, other.code).locator(".anticon-check")).toHaveCount(0);
        }
        await closeMenu(page);
      } finally {
        await restoreEnglish(page);
      }
    });
  }

  test("Đổi lần lượt English -> 中文 -> Vietnamese -> English: mỗi bước giao diện đúng, cuối cùng về nguyên trạng ban đầu", async ({ page }) => {
    const { sidebar: initial } = await openPage(page);
    try {
      for (const L of [ZH, VI, EN]) {
        await selectLanguage(page, L.code);
        await expectLanguage(page, L);
      }
      expect(await languageLabel(page)).toBe(`${EN.label} : ${EN.name}`);
      expect(await sidebarLines(page)).toEqual(initial);
      expect(await storedLang(page)).toBe("en");
      await openLanguages(page);
      await expect(langItem(page, "en").locator(".anticon-check")).toHaveCount(1);
      await expect(langPopup(page).locator(".anticon-check")).toHaveCount(1);
      await closeMenu(page);
    } finally {
      await restoreEnglish(page);
    }
  });

  test("Chọn lại ngôn ngữ đang dùng (English) giữ nguyên giao diện, menu đóng, không gọi API", async ({ page }) => {
    const { sidebar: initial } = await openPage(page);
    apiReqs.length = 0;
    await selectLanguage(page, "en");
    expect(await sidebarLines(page)).toEqual(initial);
    expect(await languageLabel(page)).toBe(`${EN.label} : ${EN.name}`);
    expect(apiReqs.map((r) => r.url)).toEqual([]);
  });

  for (const L of NON_EN) {
    test(`Ghi nhớ sau khi tải lại trang: ${L.name} (menu, sidebar, dấu check)`, async ({ page }) => {
      await openPage(page);
      try {
        await selectLanguage(page, L.code);
        await expectLanguage(page, L);
        const details = page.waitForResponse(isDetails);
        await page.reload();
        await details;
        await expect(profileBtn(page)).toBeVisible();
        await expectLanguage(page, L);
        expect(await storedLang(page)).toBe(L.code);
        await openLanguages(page);
        await expect(langItem(page, L.code).locator(".anticon-check")).toHaveCount(1);
        await closeMenu(page);
      } finally {
        await restoreEnglish(page);
      }
    });

    test(`Sang màn hình khác (Download History) vẫn là ${L.name}: breadcrumb + nút dịch, request API gửi header lang = ${L.code}`, async ({ page }) => {
      await openPage(page);
      try {
        await selectLanguage(page, L.code);
        await expectLanguage(page, L);
        // Nạp lại 1 màn hình khác: request API đầu tiên phải mang header lang = mã ngôn ngữ đã chọn
        const [req] = await Promise.all([page.waitForRequest(isApi), page.goto("/download-history")]);
        expect(req.headers()["lang"]).toBe(L.code);
        await expect(breadcrumb(page)).toHaveText(exact(L.history));
        await expect(page.getByRole("button", { name: "search Search" })).toHaveCount(0); // nút Search tiếng Anh không còn
        await expectLanguage(page, L);
      } finally {
        await restoreEnglish(page);
      }
    });
  }

  test("English: mọi request API gửi header lang = en", async ({ page }) => {
    await openPage(page);
    const [req] = await Promise.all([page.waitForRequest(isApi), page.reload()]);
    expect(req.headers()["lang"]).toBe("en");
  });

  test("Ngôn ngữ đã chọn thuộc về localStorage: xoá key DEV-appLang rồi tải lại thì về English", async ({ page }) => {
    await openPage(page);
    try {
      await selectLanguage(page, "zh");
      await expectLanguage(page, ZH);
      await page.evaluate((k) => localStorage.removeItem(k), LANG_KEY);
      const details = page.waitForResponse(isDetails);
      await page.reload();
      await details;
      await expect(profileBtn(page)).toBeVisible();
      await expect.poll(async () => (await sidebarLines(page))[0]).toBe(EN.dashboard);
      expect(await languageLabel(page)).toBe(`${EN.label} : ${EN.name}`);
    } finally {
      await restoreEnglish(page);
    }
  });

  test("Mã ngôn ngữ không được đặt vào <html lang> (luôn 'en' kể cả khi chọn 中文) - đúng thiết kế (đã được user xác nhận)", async ({ page }) => {
    await openPage(page);
    try {
      expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
      await selectLanguage(page, "zh");
      await expectLanguage(page, ZH);
      // Ghi nhận hành vi HIỆN TẠI (chưa biết đúng thiết kế hay lỗi): <html lang> không đổi theo ngôn ngữ
      expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    } finally {
      await restoreEnglish(page);
    }
  });

  test("Đổi ngôn ngữ không làm mất đăng nhập: token trong localStorage còn nguyên, không bị chuyển về /login", async ({ page }) => {
    await openPage(page);
    const before = (await localKeys(page)).filter((k) => /^DEV-/.test(k) && k !== LANG_KEY).sort();
    expect(before.length).toBeGreaterThan(0);
    try {
      await selectLanguage(page, "vi");
      await expectLanguage(page, VI);
      const after = (await localKeys(page)).filter((k) => /^DEV-/.test(k) && k !== LANG_KEY).sort();
      expect(after).toEqual(before);
      expect(page.url()).not.toMatch(/\/login/);
    } finally {
      await restoreEnglish(page);
    }
  });
});

// ===========================================================================
// 3. Change Password (KHÔNG BAO GIỜ gửi request thật: Save dùng response GIẢ)
// ===========================================================================
test.describe("Change Password - hiển thị", () => {
  test("Bấm Change Password mở hộp thoại 'Edit Password Details', không gọi API, URL giữ nguyên", async ({ page }) => {
    await openPage(page);
    apiReqs.length = 0;
    const url = page.url();
    await openChangePassword(page);
    await expect(cpTitle(page)).toHaveText(EN.cp.title);
    expect(page.url()).toBe(url);
    expect(apiReqs.map((r) => r.url)).toEqual([]);
    await expect(userMenu(page)).toHaveCount(0); // menu đóng sau khi chọn
  });

  test("3 ô theo đúng thứ tự Old / New / Confirm New Password, ô nào cũng bắt buộc (dấu *), kiểu password, đang trống", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await expect(cpModal(page).locator(".ant-form-item-label label")).toHaveText(EN.cp.fields);
    await expect(cpModal(page).locator("input")).toHaveCount(3);
    for (const id of CP_FIELDS) {
      await expect(cpInput(page, id)).toHaveAttribute("type", "password");
      await expect(cpInput(page, id)).toHaveValue("");
      await expect(cpField(page, id).locator("label")).toHaveClass(/ant-form-item-required/);
    }
    await expect(cpModal(page).locator("input")).toHaveCount(3);
    expect(await cpModal(page).locator("input").evaluateAll((els) => els.map((e) => e.id))).toEqual(CP_FIELDS);
  });

  test("Chân hộp thoại có nút Cancel và Save Changes; góc trên có nút đóng (x)", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await expect(cpModal(page).locator(".ant-modal-footer button")).toHaveText([EN.cp.cancel, EN.cp.save]);
    await expect(cpSave(page)).toBeEnabled();
    await expect(cpClose(page)).toBeVisible();
  });

  test("Mỗi ô có icon con mắt: bấm để hiện / ẩn mật khẩu", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    for (const id of CP_FIELDS) {
      const eye = cpField(page, id).locator(".ant-input-password-icon");
      await expect(cpInput(page, id)).toHaveAttribute("type", "password");
      await eye.click();
      await expect(cpInput(page, id)).toHaveAttribute("type", "text");
      await eye.click();
      await expect(cpInput(page, id)).toHaveAttribute("type", "password");
    }
  });

  test("Khung 'Password Requirements' hiện khi focus ô New Password với 5 điều kiện", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await expect(popover(page)).toHaveCount(0);
    await cpInput(page, "password").click();
    await expect(popover(page)).toBeVisible();
    await expect(popover(page).locator('div[class*="__title_"]')).toHaveText(EN.cp.popoverTitle);
    await expect(popoverRules(page)).toHaveText(POPOVER_RULES_EN);
    // Chưa nhập gì: không điều kiện nào đạt
    for (let i = 0; i < 5; i++) await expect(popoverRules(page).nth(i)).toHaveClass(/__unchecked_/);
  });

  const RULES = [
    { value: "a", ok: [false, true, false, false, false], note: "chữ thường" },
    { value: "A", ok: [false, false, true, false, false], note: "chữ hoa" },
    { value: "1", ok: [false, false, false, true, false], note: "chữ số" },
    { value: "!", ok: [false, false, false, false, true], note: "ký hiệu" },
    { value: "Abcd1!x", ok: [false, true, true, true, true], note: "7 ký tự (thiếu độ dài)" },
    { value: "Abcd1!xy", ok: [true, true, true, true, true], note: "đủ 8 ký tự và đủ 4 loại" },
  ];
  for (const rule of RULES) {
    test(`Điều kiện mật khẩu đổi trạng thái khi gõ "${rule.value}" (${rule.note})`, async ({ page }) => {
      await openPage(page);
      await openChangePassword(page);
      await cpInput(page, "password").fill(rule.value);
      await expect(popoverRules(page)).toHaveCount(5);
      for (let i = 0; i < 5; i++) {
        await expect(popoverRules(page).nth(i), `Điều kiện #${i + 1} (${POPOVER_RULES_EN[i]})`).toHaveClass(
          rule.ok[i] ? /__checked_/ : /__unchecked_/,
        );
      }
    });
  }
});

test.describe("Change Password - validate", () => {
  test("Bấm Save khi để trống cả 3 ô: 3 lỗi 'This field is required', không gửi request", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await cpSave(page).click();
    for (const id of CP_FIELDS) await expect(cpErrors(page, id)).toHaveText(EN.cp.required);
    await expect(cpModal(page)).toBeVisible();
    expect(writes).toEqual([]);
  });

  for (const [missing, id] of [
    ["Old Password", "oldPassword"],
    ["New Password", "password"],
    ["Confirm New Password", "confirmPassword"],
  ]) {
    test(`Chỉ bỏ trống ${missing}: ô đó báo bắt buộc (không ô nào khác báo lỗi, trừ Confirm báo không khớp khi New trống), không gửi request`, async ({ page }) => {
      await openPage(page);
      await openChangePassword(page);
      await fillCp(page, {
        old: id === "oldPassword" ? "" : FAKE_OLD,
        pw: id === "password" ? "" : FAKE_NEW,
        confirm: id === "confirmPassword" ? "" : FAKE_NEW,
      });
      await cpSave(page).click();
      for (const f of CP_FIELDS) {
        if (f === id) await expect(cpErrors(page, f)).toHaveText(EN.cp.required);
        // New Password trống mà Confirm có giá trị thì ô Confirm báo thêm "không khớp"
        else if (id === "password" && f === "confirmPassword") await expect(cpErrors(page, f)).toHaveText(MSG_EN.mismatch);
        else await expect(cpErrors(page, f)).toHaveCount(0);
      }
      expect(writes).toEqual([]);
    });
  }

  test("Mật khẩu mới không đạt quy tắc: báo 'Please enter a valid password' (ngắn, thiếu chữ hoa / thường / số / ký hiệu, có khoảng trắng)", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    const invalid = {
      "ngắn (4 ký tự)": "Ab1!",
      "thiếu chữ hoa": "abcdefg1!x",
      "thiếu chữ thường": "ABCDEFG1!X",
      "thiếu chữ số": "Abcdefgh!x",
      "thiếu ký hiệu": "Abcdefgh1x",
      "có khoảng trắng": "Abcdef 1!x",
    };
    for (const [name, value] of Object.entries(invalid)) {
      await fillCp(page, { old: FAKE_OLD, pw: value, confirm: value });
      await expect(cpErrors(page, "password"), `Mật khẩu ${name}: "${value}"`).toHaveText(EN.cp.invalid);
    }
    expect(writes).toEqual([]);
  });

  test("Mật khẩu mới hợp lệ (đúng 8 ký tự, 16 ký tự, có nhiều ký hiệu): không báo lỗi", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    for (const value of ["Abcd1!xy", "Abcd1!xyAbcd1!xy", "Zz9@#$%^&+!=.", FAKE_NEW]) {
      await fillCp(page, { old: FAKE_OLD, pw: value, confirm: value });
      await expect(cpErrors(page, "password"), `Mật khẩu hợp lệ: "${value}"`).toHaveCount(0);
      await expect(cpErrors(page, "confirmPassword")).toHaveCount(0);
    }
  });

  test("Xác nhận không khớp: báo 'Passwords do not match' ở ô Confirm; sửa lại cho khớp thì hết lỗi", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await fillCp(page, { old: FAKE_OLD, pw: FAKE_NEW, confirm: FAKE_NEW + "x" });
    await expect(cpErrors(page, "confirmPassword")).toHaveText(MSG_EN.mismatch);
    await expect(cpErrors(page, "password")).toHaveCount(0);
    await fillCp(page, { confirm: FAKE_NEW });
    await expect(cpErrors(page, "confirmPassword")).toHaveCount(0);
  });

  test("Xác nhận không khớp thì Save không gửi request", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await fillCp(page, { old: FAKE_OLD, pw: FAKE_NEW, confirm: FAKE_NEW + "x" });
    await cpSave(page).click();
    await expect(cpErrors(page, "confirmPassword")).toHaveText(MSG_EN.mismatch);
    await expect(cpModal(page)).toBeVisible();
    expect(writes).toEqual([]);
  });

  test("Sửa ô New Password sau khi đã nhập Confirm: lỗi 'không khớp' của Confirm cập nhật theo", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await fillCp(page, { old: FAKE_OLD, pw: FAKE_NEW, confirm: FAKE_NEW });
    await expect(cpErrors(page, "confirmPassword")).toHaveCount(0);
    await fillCp(page, { pw: FAKE_NEW + "x" });
    await expect(cpErrors(page, "confirmPassword")).toHaveText(MSG_EN.mismatch);
    await fillCp(page, { pw: FAKE_NEW });
    await expect(cpErrors(page, "confirmPassword")).toHaveCount(0);
  });

  test("Mật khẩu mới trùng mật khẩu cũ: báo 'New password cannot be the same as old password' ở ô New, không gửi request", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await fillCp(page, { old: FAKE_NEW, pw: FAKE_NEW, confirm: FAKE_NEW });
    await expect(cpErrors(page, "password")).toHaveText(MSG_EN.sameAsOld);
    await expect(cpErrors(page, "oldPassword")).toHaveCount(0);
    await cpSave(page).click();
    await expect(cpModal(page)).toBeVisible();
    expect(writes).toEqual([]);
    // Sửa New khác Old thì hết lỗi
    await fillCp(page, { pw: FAKE_NEW + "x", confirm: FAKE_NEW + "x" });
    await expect(cpErrors(page, "password")).toHaveCount(0);
  });

  test("Sửa Old Password cho trùng New Password sau khi đã nhập New thì ô New KHÔNG báo lỗi 'same as old' - đúng thiết kế (đã được user xác nhận)", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await fillCp(page, { old: FAKE_OLD, pw: FAKE_NEW, confirm: FAKE_NEW });
    await expect(cpErrors(page, "password")).toHaveCount(0);
    await fillCp(page, { old: FAKE_NEW });
    // Ghi nhận hành vi HIỆN TẠI (không assert hành vi mong đợi): ô New vẫn không có lỗi
    await expect(cpErrors(page, "password")).toHaveCount(0);
    await expect(cpErrors(page, "oldPassword")).toHaveCount(0);
    // (Không bấm Save ở đây: nếu form vẫn gửi request thì cũng chỉ bị chặn bởi afterEach/route, nhưng không thuộc phạm vi test này)
  });
});

test.describe("Change Password - đóng hộp thoại", () => {
  test("Cancel đóng hộp thoại, không gửi request; mở lại thì các ô trống và không còn lỗi", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await fillCp(page, { old: "a", pw: "b", confirm: "c" });
    await expect(cpErrors(page, "password")).toHaveCount(1);
    await cpCancel(page).click();
    await expect(cpModal(page)).toBeHidden();
    await openChangePassword(page);
    for (const id of CP_FIELDS) {
      await expect(cpInput(page, id)).toHaveValue("");
      await expect(cpErrors(page, id)).toHaveCount(0);
    }
    expect(writes).toEqual([]);
  });

  test("Nút (x) đóng hộp thoại và xoá dữ liệu đã nhập", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await fillCp(page, { old: FAKE_OLD, pw: FAKE_NEW, confirm: FAKE_NEW });
    await cpClose(page).click();
    await expect(cpModal(page)).toBeHidden();
    await openChangePassword(page);
    for (const id of CP_FIELDS) await expect(cpInput(page, id)).toHaveValue("");
    expect(writes).toEqual([]);
  });

  test("Esc đóng hộp thoại (khi hộp thoại đang có focus)", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await cpTitle(page).click();
    await page.keyboard.press("Escape");
    await expect(cpModal(page)).toBeHidden();
    expect(writes).toEqual([]);
  });

  test("Bấm vào nền mờ bên ngoài KHÔNG đóng hộp thoại (ghi nhận hành vi hiện tại)", async ({ page }) => {
    await openPage(page);
    await openChangePassword(page);
    await page.mouse.click(30, 500);
    await expect(cpModal(page)).toBeVisible();
    await cpCancel(page).click();
    await expect(cpModal(page)).toBeHidden();
  });
});

test.describe("Change Password - Save (response GIẢ, không tới server)", () => {
  test("Save hợp lệ (response GIẢ success): gửi đúng 1 request user/change-password với payload 3 trường, toast Success, đóng hộp thoại, KHÔNG bị logout", async ({ page }) => {
    await openPage(page);
    allowedWrites.push("user/change-password");
    await mockWrite(page, "/user/change-password", FAKE_SUCCESS);
    const keysBefore = (await localKeys(page)).filter((k) => /^DEV-/.test(k)).sort();
    await openChangePassword(page);
    await fillCp(page, { old: FAKE_OLD, pw: FAKE_NEW, confirm: FAKE_NEW });
    const [req] = await Promise.all([page.waitForRequest(isChangePassword), cpSave(page).click()]);
    expect(bodyOf(req)).toEqual({ oldPassword: FAKE_OLD, newPassword: FAKE_NEW, confirmPassword: FAKE_NEW });
    expect(req.headers()["authorization"]).toMatch(/^Bearer /);
    await expect(toasts(page).filter({ hasText: /Success/ }).first()).toBeVisible();
    await expect(cpModal(page)).toBeHidden();
    // Không bị đăng xuất: vẫn ở trang, token còn nguyên
    expect(page.url()).not.toMatch(/\/login/);
    expect((await localKeys(page)).filter((k) => /^DEV-/.test(k)).sort()).toEqual(keysBefore);
    expect(writes.map((w) => w.url)).toEqual(["user/change-password"]); // đúng 1 request
  });

  test("Save khi server từ chối (response GIẢ fail): toast Error, hộp thoại vẫn mở và giữ nguyên dữ liệu đã nhập", async ({ page }) => {
    await openPage(page);
    allowedWrites.push("user/change-password");
    await mockWrite(page, "/user/change-password", FAKE_FAIL);
    await openChangePassword(page);
    await fillCp(page, { old: FAKE_OLD, pw: FAKE_NEW, confirm: FAKE_NEW });
    const [req] = await Promise.all([page.waitForRequest(isChangePassword), cpSave(page).click()]);
    expect(bodyOf(req)).toEqual({ oldPassword: FAKE_OLD, newPassword: FAKE_NEW, confirmPassword: FAKE_NEW });
    // Đúng thiết kế (đã được user xác nhận): toast hiện messageCode ("QA_MOCK_FAIL") chứ không phải message của server ("QA mock fail")
    await expect(toasts(page).filter({ hasText: /Error/ }).first()).toContainText("QA_MOCK_FAIL");
    await expect(cpModal(page)).toBeVisible();
    await expect(cpInput(page, "oldPassword")).toHaveValue(FAKE_OLD);
    await expect(cpInput(page, "password")).toHaveValue(FAKE_NEW);
    await expect(cpInput(page, "confirmPassword")).toHaveValue(FAKE_NEW);
    expect(page.url()).not.toMatch(/\/login/);
  });

  test("Save khi mất mạng (request GIẢ bị abort): hộp thoại vẫn mở, vẫn đăng nhập", async ({ page }) => {
    await openPage(page);
    allowedWrites.push("user/change-password");
    // Không gọi server: request bị huỷ ngay ở tầng mạng (route.abort)
    await page.route((url) => url.pathname.endsWith("/user/change-password"), (route) => route.abort());
    await openChangePassword(page);
    await fillCp(page, { old: FAKE_OLD, pw: FAKE_NEW, confirm: FAKE_NEW });
    await Promise.all([page.waitForRequest(isChangePassword), cpSave(page).click()]);
    await expect(toasts(page).filter({ hasText: /Error/ }).first()).toBeVisible();
    await expect(cpModal(page)).toBeVisible();
    expect(page.url()).not.toMatch(/\/login/);
  });

  test("Mỗi lần bấm Save hợp lệ gửi 1 request (không gửi lặp)", async ({ page }) => {
    await openPage(page);
    allowedWrites.push("user/change-password");
    await mockWrite(page, "/user/change-password", FAKE_SUCCESS);
    await openChangePassword(page);
    await fillCp(page, { old: FAKE_OLD, pw: FAKE_NEW, confirm: FAKE_NEW });
    await Promise.all([page.waitForRequest(isChangePassword), cpSave(page).click()]);
    await expect(cpModal(page)).toBeHidden();
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(writes.length).toBe(1);
  });

  test("Sau khi Save thành công (giả) mở lại hộp thoại: các ô trống", async ({ page }) => {
    await openPage(page);
    allowedWrites.push("user/change-password");
    await mockWrite(page, "/user/change-password", FAKE_SUCCESS);
    await openChangePassword(page);
    await fillCp(page, { old: FAKE_OLD, pw: FAKE_NEW, confirm: FAKE_NEW });
    await Promise.all([page.waitForRequest(isChangePassword), cpSave(page).click()]);
    await expect(cpModal(page)).toBeHidden();
    await toasts(page).first().click().catch(() => {}); // đóng toast (toast che nút user ở header)
    await expect(toasts(page)).toHaveCount(0);
    await openChangePassword(page);
    for (const id of CP_FIELDS) await expect(cpInput(page, id)).toHaveValue("");
  });
});

test.describe("Change Password - đa ngôn ngữ", () => {
  for (const L of NON_EN) {
    test(`Hộp thoại dịch sang ${L.name}: tiêu đề, nhãn, nút, thông báo lỗi và khung điều kiện mật khẩu`, async ({ page }) => {
      await openPage(page);
      try {
        await selectLanguage(page, L.code);
        await expectLanguage(page, L);
        await openChangePassword(page);
        await expect(cpTitle(page)).toHaveText(L.cp.title);
        await expect(cpModal(page).locator(".ant-form-item-label label")).toHaveText(L.cp.fields);
        await expect(cpModal(page).locator(".ant-modal-footer button")).toHaveText([L.cp.cancel, L.cp.save]);
        await cpSave(page).click();
        for (const id of CP_FIELDS) await expect(cpErrors(page, id)).toHaveText(L.cp.required);
        await cpInput(page, "password").fill("abc");
        await expect(popover(page).locator('div[class*="__title_"]')).toHaveText(L.cp.popoverTitle);
        await expect(popoverRules(page)).toHaveCount(5);
        await cpTitle(page).click();
        await expect(cpErrors(page, "password")).toHaveText(L.cp.invalid);
        expect(writes).toEqual([]);
      } finally {
        await restoreEnglish(page);
      }
    });
  }
});

// ===========================================================================
// 4. Logout (KHÔNG BAO GIỜ logout thật: auth/logout luôn là response GIẢ hoặc bị abort)
// ===========================================================================
test.describe("Logout - hộp thoại xác nhận", () => {
  test("Bấm Logout hiện hộp thoại 'Log Out' xác nhận (Cancel / Log out), chưa gọi API, URL giữ nguyên, chưa mất token", async ({ page }) => {
    await openPage(page);
    apiReqs.length = 0;
    const url = page.url();
    const keys = await localKeys(page);
    await openLogoutDialog(page);
    await expect(logoutDialog(page).locator(".ant-modal-title")).toHaveText(/Log Out/);
    await expect(logoutDialog(page).locator(".NextGen-modal-logout__description")).toHaveText("You are about to log out from the backoffice.");
    await expect(logoutDialog(page).locator(".ant-modal-footer button")).toHaveText(["Cancel", "Log out"]);
    await expect(logoutDialog(page).locator(".ant-modal-close")).toBeVisible();
    expect(page.url()).toBe(url);
    expect(await localKeys(page)).toEqual(keys);
    expect(apiReqs.filter((r) => r.method === "POST" && !READ.test(r.url)).map((r) => r.url), "Chưa xác nhận thì không gọi auth/logout").toEqual([]);
  });

  test("Cancel đóng hộp thoại: không gọi API, vẫn ở trang, token còn nguyên", async ({ page }) => {
    await openPage(page);
    const url = page.url();
    const keys = await localKeys(page);
    await openLogoutDialog(page);
    await logoutCancel(page).click();
    await expect(logoutDialog(page)).toBeHidden();
    expect(page.url()).toBe(url);
    expect(await localKeys(page)).toEqual(keys);
    await expect(profileBtn(page)).toBeVisible();
    expect(writes).toEqual([]);
  });

  test("Nút (x) và Esc đóng hộp thoại mà không logout", async ({ page }) => {
    await openPage(page);
    const keys = await localKeys(page);
    await openLogoutDialog(page);
    await logoutDialog(page).locator(".ant-modal-close").click();
    await expect(logoutDialog(page)).toBeHidden();
    await openLogoutDialog(page);
    await logoutDialog(page).locator(".ant-modal-title").click();
    await page.keyboard.press("Escape");
    await expect(logoutDialog(page)).toBeHidden();
    expect(page.url()).not.toMatch(/\/login/);
    expect(await localKeys(page)).toEqual(keys);
    expect(writes).toEqual([]);
  });

  test("Bấm vào nền mờ bên ngoài KHÔNG đóng hộp thoại (ghi nhận hành vi hiện tại)", async ({ page }) => {
    await openPage(page);
    await openLogoutDialog(page);
    await page.mouse.click(30, 500);
    await expect(logoutDialog(page)).toBeVisible();
    await logoutCancel(page).click();
    await expect(logoutDialog(page)).toBeHidden();
    expect(writes).toEqual([]);
  });

  test("Hộp thoại Logout dịch theo ngôn ngữ (中文): tiêu đề, nội dung, nút", async ({ page }) => {
    await openPage(page);
    try {
      await selectLanguage(page, "zh");
      await expectLanguage(page, ZH);
      await openLogoutDialog(page);
      await expect(logoutDialog(page).locator(".ant-modal-title")).toContainText("退出");
      await expect(logoutDialog(page).locator(".NextGen-modal-logout__description")).toHaveText("您即将退出后台。");
      // antd tự chèn khoảng trắng giữa 2 chữ Hán của nút ("取 消" / "退 出") nên bỏ khoảng trắng khi so sánh
      const buttons = (await logoutDialog(page).locator(".ant-modal-footer button").allInnerTexts()).map((t) => t.replace(/\s+/g, ""));
      expect(buttons).toEqual(["取消", "退出"]);
      expect(writes).toEqual([]);
    } finally {
      await restoreEnglish(page);
    }
  });
});

test.describe("Logout - xác nhận (response GIẢ)", () => {
  test("Log out (response GIẢ success): gửi đúng 1 request auth/logout (body rỗng, kèm Bearer token), rồi chuyển về /login", async ({ page }) => {
    await openPage(page);
    allowedWrites.push("auth/logout");
    await mockWrite(page, "/auth/logout", FAKE_SUCCESS);
    await openLogoutDialog(page);
    const [req] = await Promise.all([page.waitForRequest(isLogout), logoutConfirm(page).click()]);
    expect(bodyOf(req)).toEqual({});
    expect(req.headers()["authorization"]).toMatch(/^Bearer /);
    await page.waitForURL(/\/login/);
    expect(new URL(page.url()).pathname).toBe("/login");
    expect(writes.map((w) => w.url)).toEqual(["auth/logout"]);
  });

  test("Sau Log out: xoá mọi key DEV-* (token, thông tin user) và key region khỏi localStorage, giữ device-unique-signature; không có cookie", async ({ page, context }) => {
    await openPage(page);
    allowedWrites.push("auth/logout");
    await mockWrite(page, "/auth/logout", FAKE_SUCCESS);
    const before = await localKeys(page);
    const loginKeys = before.filter((k) => /^DEV-|^region$/.test(k));
    expect(loginKeys).toContain("DEV-ctoken");
    expect(loginKeys).toContain("DEV-rtoken");
    expect(before).toContain("device-unique-signature");
    await openLogoutDialog(page);
    await Promise.all([page.waitForRequest(isLogout), logoutConfirm(page).click()]);
    await page.waitForURL(/\/login/);
    await expect.poll(async () => (await localKeys(page)).filter((k) => /^DEV-|^region$/.test(k))).toEqual([]);
    const after = await localKeys(page);
    expect(after).toContain("device-unique-signature"); // định danh thiết bị được giữ lại
    // Các key không thuộc đăng nhập (vd sorter__*) không bị xoá
    expect(after.filter((k) => !before.includes(k))).toEqual([]);
    for (const k of before.filter((x) => !/^DEV-|^region$/.test(x))) expect(after, `Key ${k} không được bị xoá`).toContain(k);
    expect(await context.cookies()).toEqual([]);
  });

  test("Trang /login hiển thị form đăng nhập sau khi Log out", async ({ page }) => {
    await openPage(page);
    allowedWrites.push("auth/logout");
    await mockWrite(page, "/auth/logout", FAKE_SUCCESS);
    await openLogoutDialog(page);
    await Promise.all([page.waitForRequest(isLogout), logoutConfirm(page).click()]);
    await page.waitForURL(/\/login/);
    await expect(page.getByText("Username", { exact: true })).toBeVisible();
    await expect(page.getByText("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Login/ })).toBeVisible();
  });

  test("Sau Log out vào lại các trang được bảo vệ (/, /download-history, /admin/roles) đều bị chuyển về /login và không gọi API nào", async ({ page }) => {
    await openPage(page);
    allowedWrites.push("auth/logout");
    await mockWrite(page, "/auth/logout", FAKE_SUCCESS);
    await openLogoutDialog(page);
    await Promise.all([page.waitForRequest(isLogout), logoutConfirm(page).click()]);
    await page.waitForURL(/\/login/);
    for (const path of ["/", "/download-history", "/admin/roles"]) {
      apiReqs.length = 0;
      await page.goto(path);
      await expect(page, `Vào ${path} sau khi logout`).toHaveURL(/\/login/);
      await page.waitForLoadState("networkidle").catch(() => {});
      expect(apiReqs.map((r) => r.url), `Vào ${path} không được gọi API`).toEqual([]);
    }
  });

  test("Sau Log out bấm Back của trình duyệt không vào lại được trang cũ (bị chuyển về /login)", async ({ page }) => {
    await openPage(page);
    allowedWrites.push("auth/logout");
    await mockWrite(page, "/auth/logout", FAKE_SUCCESS);
    await openLogoutDialog(page);
    await Promise.all([page.waitForRequest(isLogout), logoutConfirm(page).click()]);
    await page.waitForURL(/\/login/);
    await page.goBack();
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page).toHaveURL(/\/login/);
    await expect(profileBtn(page)).toHaveCount(0);
  });

  test("Server trả fail (response GIẢ) nhưng app vẫn xoá token và chuyển về /login - đúng thiết kế (đã được user xác nhận)", async ({ page }) => {
    await openPage(page);
    allowedWrites.push("auth/logout");
    await mockWrite(page, "/auth/logout", FAKE_FAIL);
    await openLogoutDialog(page);
    await Promise.all([page.waitForRequest(isLogout), logoutConfirm(page).click()]);
    // Ghi nhận hành vi HIỆN TẠI (không assert hành vi mong đợi)
    await page.waitForURL(/\/login/);
    await expect.poll(async () => (await localKeys(page)).filter((k) => /^DEV-/.test(k))).toEqual([]);
    expect(await logoutDialog(page).count()).toBe(0);
  });

  test("Mất mạng khi logout (request bị abort): ở lại trang, hiện toast Error, token còn nguyên, hộp thoại vẫn mở - đúng thiết kế (đã được user xác nhận)", async ({ page }) => {
    await openPage(page);
    allowedWrites.push("auth/logout");
    await page.route((url) => url.pathname.endsWith("/auth/logout"), (route) => route.abort());
    const keys = await localKeys(page);
    await openLogoutDialog(page);
    await Promise.all([page.waitForRequest(isLogout), logoutConfirm(page).click()]);
    await expect(toasts(page).filter({ hasText: /Error/ }).first()).toBeVisible();
    expect(page.url()).not.toMatch(/\/login/);
    expect(await localKeys(page)).toEqual(keys);
    await expect(logoutDialog(page)).toBeVisible();
  });

  test("Logout khi đang dùng 中文: hộp thoại dịch, logout vẫn về /login; ngôn ngữ đã chọn (DEV-appLang) bị xoá theo - đúng thiết kế (đã được user xác nhận)", async ({ page }) => {
    await openPage(page);
    allowedWrites.push("auth/logout");
    await mockWrite(page, "/auth/logout", FAKE_SUCCESS);
    try {
      await selectLanguage(page, "zh");
      await expectLanguage(page, ZH);
      expect(await localKeys(page)).toContain(LANG_KEY);
      await openLogoutDialog(page);
      await Promise.all([page.waitForRequest(isLogout), logoutConfirm(page).click()]);
      await page.waitForURL(/\/login/);
      // Ghi nhận hành vi HIỆN TẠI: mọi key DEV-* kể cả DEV-appLang bị xoá
      await expect.poll(async () => (await localKeys(page)).filter((k) => /^DEV-/.test(k))).toEqual([]);
      expect(await localKeys(page)).not.toContain(LANG_KEY);
    } finally {
      // Đã ở /login với localStorage của context riêng của test này: không cần (và không thể) khôi phục bằng menu
      await page.evaluate((k) => localStorage.setItem(k, "en"), LANG_KEY).catch(() => {});
    }
  });
});
