// Administration > Geofencing  (https://dev-bo.royaledge.io/admin/geofencing)
//
// Chạy (project "chromium"; session nạp từ playwright/.auth/session.txt qua tests/helpers/session.js):
//   npx playwright test tests/admin_geofencing.spec.js --project=setup --project=chromium
//
// Màn hình "Geofencing Settings" CHỈ có 1 danh sách "Whitelist (N)" các IP được phép vào BackOffice (API geofencing/ip-restrict-list, body {}, trả mảng data):
//  - KHÔNG có filter, sort, phân trang, Manage Columns, Export, chọn dòng. Cột: IP Address / Country / Remark / Action (Country luôn trống vì chỉ có whitelist theo IP).
//    Danh sách trả về theo id GIẢM dần (bản ghi mới tạo nằm đầu); data-row-key của dòng = id.
//  - Cột Action có 2 icon: Update (tooltip "Update", mở modal "Edit whitelist") và Delete (icon thùng rác đỏ, không tooltip, mở hộp thoại "Delete").
//  - Nút "+ Whitelist" mở modal "Add Whitelist": Whitelist Type (chỉ có "By IP IPV4"), bảng IP Address / Remarks (placeholder "IP Address" / "Enter the remarks"),
//    "Add New IP Address" (chỉ thêm dòng khi các dòng đang có hợp lệ; dòng thứ 2 trở đi có nút (x) xoá, dòng duy nhất thì không), Cancel / Confirm.
//    Validate phía client: IP bắt buộc ("This field is required"), đúng IPv4 ("Please enter a valid IP Address for IP4"), không trùng IP đã có / trùng trong modal ("IP address already existed"),
//    Remarks không bắt buộc, chỉ chữ + số + khoảng trắng ("Please enter only alphanumeric characters").
//    Confirm gọi geofencing/ip-restrict-create {geofencing: {ipv4: [{id: "temp-N", value, remark}]}} -> CREATE_IP_RESTRICT_SUCCESS rồi gọi lại ip-restrict-list và đóng modal. Tạo / sửa KHÔNG có toast.
//  - Modal "Edit whitelist": form nạp sẵn IP + Remarks của dòng; đổi IP sẽ gọi validate/ip {value, sasEntityId} (đọc), trùng IP khác -> "IP address is already existed" (lưu ý: khác chữ "is" so với modal Add);
//    giữ nguyên IP gốc thì không báo lỗi. Confirm gọi geofencing/ip-restrict-update {geofencing: {ipv4: [{id, value, remark}]}} -> UPDATE_IP_RESTRICT_SUCCESS.
//  - Delete: hộp thoại "Are you sure to delete this whitelist? ..." (Cancel / Delete) -> geofencing/ip-restrict-delete {id} -> DELETE_IP_RESTRICT_SUCCESS, hiện 2 toast Success.
//
// AN TOÀN DỮ LIỆU:
//  - Mọi describe trừ cuối là "chỉ đọc": request ghi (ip-restrict-create / update / delete) bị chặn ở tầng mạng (route.abort); test kiểm tra payload / thông báo dùng
//    route.fulfill trả response GIẢ (request KHÔNG tới server). afterEach so sánh chính xác request ghi bắt được (watchWrites) với danh sách được phép (allowedWrites).
//    IP có sẵn của team (vd 0.0.0.0, 10.1.204.204...) chỉ bị thao tác bằng request GIẢ, không bao giờ bị ghi thật.
//  - Describe cuối "CRUD (ghi dữ liệu thật)" được gắn cờ RUN_FULL_TESTS (tests/helpers/flags.js, xem RUN_FULL_TESTS.md):
//    RUN_FULL_TESTS=false (mặc định) -> cả nhóm bị skip, KHÔNG gửi request ghi nào; =true -> mới chạy.
//    Nhóm này chạy tuần tự, CHỈ thao tác trên IP QA do chính test tạo: IP ngẫu nhiên 10.<200-249>.x.x, remark "QAAUTO <timestamp>".
//    Màn hình CÓ chức năng xoá nên mỗi test tự tạo IP QA rồi xoá bằng UI trong finally; afterAll quét thêm 1 lần các IP QA còn sót (chỉ các IP do chính lần chạy này tạo).
//    afterEach kiểm tra mọi request ghi chỉ nhắm vào IP / id của bản ghi QA đã tạo.
//  - Không hard-code dữ liệu: IP dùng cho test lấy từ response list.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");
const { RUN_FULL_TESTS, SKIP_WRITE_REASON } = require("./helpers/flags");

const VIEWPORT = { width: 1920, height: 1080 };
test.use({
  viewport: VIEWPORT,
  // Session gọn: chỉ các key đăng nhập, không cookie (token gửi qua header Bearer từ localStorage)
  storageState: buildStorageState(),
});

const URL = "/admin/geofencing";
const ORIGIN = "https://dev-bo.royaledge.io";

// Đúng thứ tự hiển thị
const COLUMNS = ["IP Address", "Country", "Remark", "Action"];
const COL = { ip: 0, country: 1, remark: 2, action: 3 };
const QA_REMARK_PREFIX = "QAAUTO";

// Thông báo của form / hộp thoại (đọc từ màn hình thật)
const MSG = {
  required: "This field is required",
  invalidIp: "Please enter a valid IP Address for IP4",
  dupAdd: "IP address already existed", // modal Add (kiểm tra phía client)
  dupEdit: "IP address is already existed", // modal Edit (theo validate/ip của server)
  remark: "Please enter only alphanumeric characters",
  deleteTitle: "Delete",
  deleteText: "Are you sure to delete this whitelist? All information associated with this whitelist will be permanently deleted",
};
const INVALID_IPS = ["abc", "1.2.3", "256.1.1.1", "1.2.3.4.5", "10.1.1.1/24", "::1"];
// IP có khoảng trắng thừa: lỗi hiện ngay khi gõ NHƯNG Confirm lại gửi bản đã trim (xem test riêng) nên các giá trị này không kiểm tra Confirm
const PADDED_IPS = [" 1.2.3.4", "1.2.3.4 "];
const VALID_REMARKS = ["QAAUTO123", "QA AUTO", "1"];
const INVALID_REMARKS = ["QA-AUTO", "QA_AUTO", "abc.d", "tiếng"];

// Request đọc dữ liệu - mọi POST tới boapi còn lại coi là GHI (ip-restrict-create / update / delete)
const READ = /\/(list|details|download|view)(\?|$)|\/dropdown\/|_dropdown(\?|$)|\/ip-restrict-list(\?|$)|\/validate\//;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const post = (r) => reqOf(r).method() === "POST";
const endsWith = (s) => (r) => post(r) && reqOf(r).url().endsWith(s);
const isList = endsWith("/geofencing/ip-restrict-list");
const isCreate = endsWith("/geofencing/ip-restrict-create");
const isUpdate = endsWith("/geofencing/ip-restrict-update");
const isDelete = endsWith("/geofencing/ip-restrict-delete");
const isValidate = endsWith("/validate/ip");

const exact = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// Body gửi API luôn kèm traceId ngẫu nhiên -> bỏ đi trước khi so sánh
const bodyOf = (req) => {
  const { traceId, ...rest } = JSON.parse(req.postData());
  return rest;
};
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Bảng (header + body nằm trong cùng .NextGen-table)
const table = (page) => page.locator(".NextGen-table").first();
const rows = (page) => table(page).locator("tbody tr.ant-table-row");
const rowAt = (page, i) => rows(page).nth(i);
const cellAt = (page, i, col) => rowAt(page, i).locator("td").nth(col);
const rowOfIp = (page, ip) => rows(page).filter({ has: page.locator("td:first-child").filter({ hasText: exact(ip) }) });
const rowId = async (row) => Number(await row.getAttribute("data-row-key"));
// 2 icon của cột Action: 0 = Update, 1 = Delete
const updateIcon = (row) => row.locator(".column-actions svg").nth(0);
const deleteIcon = (row) => row.locator(".column-actions svg").nth(1);

const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const heading = (page) => page.locator("h5.NextGen-label-form-title");
const tabTitle = (page) => page.locator(".NextGen-list-tab-layout__tab");
const remark = (page) => page.locator(".NextGen-list-tab-layout__remark");
const addBtn = (page) => page.locator("button.NextGen-list-tab-layout__create-btn");
const toasts = (page) => page.locator(".Toastify__toast");
const tooltip = (page, text) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)").filter({ hasText: exact(text) });

// Modal Add / Edit whitelist
const modal = (page) => page.locator(".NextGen-modal-whitelist");
const modalTitle = (page) => modal(page).locator(".ant-modal-title");
const modalRows = (page) => modal(page).locator("tbody tr.ant-table-row");
const ipInput = (page, i = 0) => modal(page).locator(`#list_${i}_value`);
const remarkInput = (page, i = 0) => modal(page).locator(`#list_${i}_remark`);
const modalErrors = (page) => modal(page).locator(".ant-form-item-explain-error");
const confirmBtn = (page) => modal(page).getByRole("button", { name: "Confirm", exact: true });
const cancelBtn = (page) => modal(page).getByRole("button", { name: /Cancel$/ });
const closeX = (page) => modal(page).locator("button.ant-modal-close");
const addRowBtn = (page) => modal(page).getByRole("button", { name: /Add New IP Address/ });
const removeRowBtns = (page) => modalRows(page).locator("button");
// Hộp thoại Delete
const delDialog = (page) => page.locator(".NextGen-modal-delete");
const delConfirmBtn = (page) => delDialog(page).getByRole("button", { name: "Delete", exact: true });
const delCancelBtn = (page) => delDialog(page).getByRole("button", { name: "Cancel", exact: true });

// Chờ bảng render xong sau 1 lần gọi API (spinner của antd biến mất)
async function waitTableIdle(page) {
  await expect(page.locator(".ant-table-wrapper .ant-spin-spinning")).toHaveCount(0);
}
async function settle(page) {
  await waitTableIdle(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitTableIdle(page);
}

// Mở màn hình và chờ lần load đầu tiên xong. Trả về mảng data của geofencing/ip-restrict-list
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
  const res = await firstLoad;
  const json = await res.json();
  await settle(page);
  await expect(heading(page)).toBeVisible();
  return json.data;
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

// Toàn bộ ô của bảng ở trang hiện tại: [{ id, cells: [text...] }]
const tableMatrix = (page) =>
  rows(page).evaluateAll((trs) =>
    trs.map((tr) => ({
      id: Number(tr.getAttribute("data-row-key")),
      cells: [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()),
    })),
  );

// IP v4 ngẫu nhiên chưa có trong danh sách (dải 10.200-249.x.x để không đụng IP của team)
function freshIp(existing = []) {
  for (;;) {
    const o = () => 1 + Math.floor(Math.random() * 253);
    const ip = `10.${200 + Math.floor(Math.random() * 50)}.${o()}.${o()}`;
    if (!existing.includes(ip)) return ip;
  }
}

// --- Modal Add / Edit ---
async function openAdd(page) {
  await addBtn(page).click();
  await expect(modal(page)).toBeVisible();
  await expect(modalTitle(page)).toHaveText("Add Whitelist");
}

// Mở modal Update của dòng i
async function openEdit(page, i) {
  await updateIcon(rowAt(page, i)).click();
  await expect(modal(page)).toBeVisible();
  await expect(modalTitle(page)).toHaveText("Edit whitelist");
}

// Điền 1 dòng của modal rồi blur (bấm tiêu đề modal) để validate chạy
async function fillRow(page, i, ip, rm = "") {
  await ipInput(page, i).fill(ip);
  await remarkInput(page, i).fill(rm);
  await modalTitle(page).click();
}

// Điền nhiều dòng (dùng nút "Add New IP Address" cho dòng thứ 2 trở đi)
async function fillRows(page, entries) {
  for (let i = 0; i < entries.length; i++) {
    if (i > 0) {
      await addRowBtn(page).click();
      await expect(modalRows(page)).toHaveCount(i + 1);
    }
    await fillRow(page, i, entries[i].ip, entries[i].remark ?? "");
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Administration > Geofencing", () => {
  let writes;
  let allowedWrites; // request ghi được phép (chỉ các test dùng response giả; request KHÔNG tới server thật)

  test.beforeEach(async ({ page }) => {
    writes = watchWrites(page);
    allowedWrites = [];
  });

  // ===== NHÓM CHỈ ĐỌC (không ghi dữ liệu thật) =====
  test.describe("Chỉ đọc (không ghi dữ liệu thật)", () => {
    let initial; // data của lần load đầu

    test.beforeEach(async ({ page }) => {
      await blockWrites(page);
      initial = await openPage(page);
    });

    // Mọi test không được gửi request ghi nào ngoài danh sách được phép (và request được phép cũng không tới server thật)
    test.afterEach(async () => {
      expect(writes, "Request ghi dữ liệu bắt được phải đúng danh sách được phép").toEqual(allowedWrites);
    });

    // ===== 1. Hiển thị màn hình =====
    test.describe("Hiển thị mặc định", () => {
      test("Có tiêu đề 'Geofencing' (breadcrumb) và 'Geofencing Settings'", async ({ page }) => {
        await expect(breadcrumb(page)).toHaveText("Geofencing");
        await expect(heading(page)).toHaveText("Geofencing Settings");
      });

      test("Có tab 'Whitelist (N)' với N = số IP trong response và dòng mô tả", async ({ page }) => {
        await expect(tabTitle(page)).toHaveText(`Whitelist (${initial.length})`);
        await expect(remark(page)).toHaveText(
          "Allow whitelisted IP addresses or IP addresses from whitelisted countries to have access to BackOffice",
        );
      });

      test("Có nút '+ Whitelist'", async ({ page }) => {
        await expect(addBtn(page)).toBeVisible();
        await expect(addBtn(page)).toHaveText("Whitelist");
        await expect(addBtn(page)).toBeEnabled();
      });

      test("Có đủ 4 cột IP Address, Country, Remark, Action đúng thứ tự", async ({ page }) => {
        await expect(table(page).locator("thead th")).toHaveText(COLUMNS);
      });

      test("Request danh sách khi mở màn hình: POST geofencing/ip-restrict-list với body rỗng {}", async ({ page }) => {
        const [req] = await Promise.all([page.waitForRequest(isList), page.reload()]);
        expect(bodyOf(req)).toEqual({});
        const res = await req.response();
        expect(res.status()).toBe(200);
        const json = await res.json();
        expect(json.status).toBe("success");
        expect(Array.isArray(json.data)).toBe(true);
      });

      test("Không có filter, nút Search / Reset, phân trang hay Manage Columns", async ({ page }) => {
        await expect(page.locator(".NextGen-filter-bar")).toHaveCount(0);
        await expect(page.locator(".NextGen-filter-element")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "search Search" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "close Reset" })).toHaveCount(0);
        await expect(page.locator(".ant-pagination")).toHaveCount(0);
        await expect(page.locator("button.NextGen-popover-manage-column__buton")).toHaveCount(0);
      });

      test("Không có cột chọn dòng (checkbox)", async ({ page }) => {
        await expect(table(page).locator("input[type=checkbox]")).toHaveCount(0);
      });

      test("Điều hướng bằng menu: sang Permissions rồi quay lại Geofencing vẫn hiện đủ danh sách", async ({ page }) => {
        // Lưu ý: khi quay lại trong cùng phiên SPA app có thể dùng cache nên không chờ request list
        await page.locator("a[href='/admin/permission']").click();
        await expect(page).toHaveURL(/\/admin\/permission$/);
        await page.locator("a[href='/admin/geofencing']").click();
        await expect(page).toHaveURL(/\/admin\/geofencing$/);
        await expect(heading(page)).toBeVisible();
        await expect(rows(page)).toHaveCount(initial.length);
      });
    });

    // ===== 2. Dữ liệu bảng =====
    test.describe("Dữ liệu bảng", () => {
      test("Số dòng bằng số bản ghi trong response và bằng N ở 'Whitelist (N)'", async ({ page }) => {
        await expect(rows(page)).toHaveCount(initial.length);
        await expect(tabTitle(page)).toContainText(`(${initial.length})`);
      });

      test("Từng dòng khớp response API (IP Address / Country / Remark) theo đúng thứ tự", async ({ page }) => {
        const m = await tableMatrix(page);
        expect(m).toHaveLength(initial.length);
        initial.forEach((x, i) => {
          expect(m[i].id, `data-row-key dòng ${i + 1}`).toBe(x.id);
          expect(m[i].cells[COL.ip], `IP dòng ${i + 1}`).toBe(x.ip);
          expect(m[i].cells[COL.country], `Country dòng ${i + 1}`).toBe(norm(x.country));
          expect(m[i].cells[COL.remark], `Remark dòng ${i + 1}`).toBe(norm(x.remark));
        });
      });

      test("Danh sách sắp theo id giảm dần (bản ghi mới nhất ở đầu)", async ({ page }) => {
        const ids = (await tableMatrix(page)).map((r) => r.id);
        expect(ids).toEqual([...ids].sort((a, b) => b - a));
      });

      test("Mọi IP đều là IPv4 hợp lệ (4 nhóm số 0-255) và không có IP trùng nhau", async ({ page }) => {
        const ips = (await tableMatrix(page)).map((r) => r.cells[COL.ip]);
        for (const ip of ips) {
          const m = ip.match(IPV4);
          expect(m, `IP "${ip}" không đúng định dạng IPv4`).not.toBeNull();
          for (const g of m.slice(1)) expect(Number(g), `IP "${ip}"`).toBeLessThanOrEqual(255);
        }
        expect(new Set(ips).size, "IP trùng nhau trong danh sách").toBe(ips.length);
      });

      test("Mọi bản ghi là whitelist theo IP của BackOffice (restrictBy IP_ADDRESS, type BACKOFFICE, whiteList true)", async () => {
        for (const x of initial) {
          expect(x.restrictBy, `id ${x.id}`).toBe("IP_ADDRESS");
          expect(x.type, `id ${x.id}`).toBe("BACKOFFICE");
          expect(x.whiteList, `id ${x.id}`).toBe(true);
        }
      });

      test("Cột Country trống ở mọi dòng (whitelist theo IP không có quốc gia)", async ({ page }) => {
        for (const r of await tableMatrix(page)) expect(r.cells[COL.country]).toBe("");
        for (const x of initial) expect(x.country).toBeNull();
      });

      test("Mỗi dòng có đúng 2 icon hành động (Update, Delete)", async ({ page }) => {
        const n = await rows(page).count();
        for (let i = 0; i < n; i++) await expect(rowAt(page, i).locator(".column-actions svg"), `dòng ${i + 1}`).toHaveCount(2);
      });

      test("Hover icon đầu tiên hiện tooltip 'Update'", async ({ page }) => {
        test.skip((await rows(page).count()) === 0, "Không có bản ghi");
        await updateIcon(rowAt(page, 0)).hover();
        await expect(tooltip(page, "Update")).toBeVisible();
      });

      test("Tải lại trang cho cùng danh sách (không có dữ liệu nào được lưu ở trình duyệt)", async ({ page }) => {
        const data = await openPage(page);
        expect(data.map((x) => x.id)).toEqual(initial.map((x) => x.id));
        expect((await tableMatrix(page)).map((r) => r.id)).toEqual(initial.map((x) => x.id));
      });
    });

    // ===== 3. Modal Add Whitelist =====
    test.describe("Modal Add Whitelist (không ghi dữ liệu thật)", () => {
      test("Nút '+ Whitelist' mở modal 'Add Whitelist' có Whitelist Type = By IP IPV4 (duy nhất, đã chọn)", async ({ page }) => {
        await openAdd(page);
        await expect(modal(page).locator("label[title='Whitelist Type']")).toBeVisible();
        const radios = modal(page).locator("label.ant-radio-wrapper");
        await expect(radios).toHaveCount(1);
        await expect(radios).toHaveText("By IP IPV4");
        await expect(radios).toHaveClass(/ant-radio-wrapper-checked/);
        await expect(modal(page).locator("input.ant-radio-input")).toHaveValue("ipv4");
      });

      test("Bảng trong modal có cột IP Address, Remarks, 1 dòng trống với placeholder đúng", async ({ page }) => {
        await openAdd(page);
        await expect(modal(page).locator("thead th").filter({ hasText: /\S/ })).toHaveText(["IP Address", "Remarks"]);
        await expect(modalRows(page)).toHaveCount(1);
        await expect(ipInput(page)).toHaveValue("");
        await expect(ipInput(page)).toHaveAttribute("placeholder", "IP Address");
        await expect(remarkInput(page)).toHaveValue("");
        await expect(remarkInput(page)).toHaveAttribute("placeholder", "Enter the remarks");
      });

      test("Modal có nút 'Add New IP Address', Cancel, Confirm và nút đóng (x)", async ({ page }) => {
        await openAdd(page);
        await expect(addRowBtn(page)).toBeVisible();
        await expect(cancelBtn(page)).toBeVisible();
        await expect(confirmBtn(page)).toBeVisible();
        await expect(closeX(page)).toBeVisible();
      });

      test("Dòng duy nhất không có nút xoá (x)", async ({ page }) => {
        await openAdd(page);
        await expect(removeRowBtns(page)).toHaveCount(0);
      });

      test("Confirm khi để trống: báo 'This field is required' ở ô IP và KHÔNG gửi request create", async ({ page }) => {
        await openAdd(page);
        await confirmBtn(page).click();
        await expect(modalErrors(page)).toHaveText([MSG.required]);
        await expect(modal(page)).toBeVisible();
      });

      for (const bad of INVALID_IPS) {
        test(`IP không hợp lệ ${JSON.stringify(bad)}: báo lỗi định dạng IPv4 và Confirm không gửi request`, async ({ page }) => {
          await openAdd(page);
          await fillRow(page, 0, bad);
          await expect(modalErrors(page)).toHaveText([MSG.invalidIp]);
          await confirmBtn(page).click();
          await expect(modal(page)).toBeVisible();
        });
      }

      for (const padded of PADDED_IPS) {
        test(`IP có khoảng trắng thừa ${JSON.stringify(padded)}: báo lỗi định dạng IPv4 ngay khi gõ`, async ({ page }) => {
          await openAdd(page);
          await fillRow(page, 0, padded);
          await expect(modalErrors(page)).toHaveText([MSG.invalidIp]);
        });
      }

      // Quan sát: lỗi ở trên chỉ là kiểm tra khi gõ; khi Confirm app tự trim giá trị rồi gửi (IP "1.2.3.4" / remark "") và đóng modal.
      // Chưa xác nhận là lỗi hay đúng thiết kế, test ghi nhận hành vi hiện tại bằng request GIẢ.
      test("Confirm với IP / Remarks chỉ khác ở khoảng trắng thừa: app trim giá trị rồi vẫn gửi create (request GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        await openAdd(page);
        const ip = freshIp(initial.map((x) => x.ip));
        await fillRow(page, 0, ` ${ip} `, "   ");
        await expect(modalErrors(page)).toHaveCount(2);
        const [req] = await Promise.all([page.waitForRequest(isCreate), confirmBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "geofencing/ip-restrict-create", body }];
        expect(body.geofencing.ipv4[0]).toMatchObject({ value: ip, remark: "" });
      });

      test("IP hợp lệ chưa có trong danh sách: không báo lỗi", async ({ page }) => {
        await openAdd(page);
        await fillRow(page, 0, freshIp(initial.map((x) => x.ip)));
        await expect(modalErrors(page)).toHaveCount(0);
      });

      test("IP đã có trong danh sách (lấy từ response): báo 'IP address already existed'", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        await openAdd(page);
        await fillRow(page, 0, initial[0].ip);
        await expect(modalErrors(page)).toHaveText([MSG.dupAdd]);
        await confirmBtn(page).click();
        await expect(modal(page)).toBeVisible();
      });

      test("Remarks để trống là hợp lệ (không bắt buộc)", async ({ page }) => {
        await openAdd(page);
        await fillRow(page, 0, freshIp(initial.map((x) => x.ip)), "");
        await expect(modalErrors(page)).toHaveCount(0);
      });

      for (const ok of VALID_REMARKS) {
        test(`Remarks ${JSON.stringify(ok)} (chữ / số / khoảng trắng) hợp lệ`, async ({ page }) => {
          await openAdd(page);
          await fillRow(page, 0, freshIp(initial.map((x) => x.ip)), ok);
          await expect(modalErrors(page)).toHaveCount(0);
        });
      }

      for (const bad of INVALID_REMARKS) {
        test(`Remarks ${JSON.stringify(bad)} (ký tự đặc biệt / có dấu / toàn khoảng trắng): báo 'Please enter only alphanumeric characters'`, async ({ page }) => {
          await openAdd(page);
          await fillRow(page, 0, freshIp(initial.map((x) => x.ip)), bad);
          await expect(modalErrors(page)).toHaveText([MSG.remark]);
          await confirmBtn(page).click();
          await expect(modal(page)).toBeVisible();
        });
      }

      test("Add New IP Address khi dòng đầu còn trống: báo lỗi bắt buộc và KHÔNG thêm dòng", async ({ page }) => {
        await openAdd(page);
        await addRowBtn(page).click();
        await expect(modalErrors(page)).toHaveText([MSG.required]);
        await expect(modalRows(page)).toHaveCount(1);
      });

      test("Add New IP Address khi dòng đầu hợp lệ: thêm dòng thứ 2 (trống) và cả 2 dòng đều có nút xoá (x)", async ({ page }) => {
        await openAdd(page);
        await fillRow(page, 0, freshIp(initial.map((x) => x.ip)), "QAAUTO one");
        await addRowBtn(page).click();
        await expect(modalRows(page)).toHaveCount(2);
        await expect(ipInput(page, 1)).toHaveValue("");
        await expect(ipInput(page, 1)).toHaveAttribute("placeholder", "IP Address");
        await expect(removeRowBtns(page)).toHaveCount(2);
      });

      test("Dòng thứ 2 để trống thì Add New IP Address tiếp theo bị chặn (vẫn 2 dòng)", async ({ page }) => {
        await openAdd(page);
        await fillRow(page, 0, freshIp(initial.map((x) => x.ip)));
        await addRowBtn(page).click();
        await expect(modalRows(page)).toHaveCount(2);
        await addRowBtn(page).click();
        await expect(modalErrors(page)).toHaveText([MSG.required]);
        await expect(modalRows(page)).toHaveCount(2);
      });

      test("Nút (x) xoá dòng thứ 2, quay về 1 dòng và dòng đó không còn nút xoá", async ({ page }) => {
        await openAdd(page);
        const ip = freshIp(initial.map((x) => x.ip));
        await fillRow(page, 0, ip, "QAAUTO one");
        await addRowBtn(page).click();
        await expect(modalRows(page)).toHaveCount(2);
        await removeRowBtns(page).last().click();
        await expect(modalRows(page)).toHaveCount(1);
        await expect(removeRowBtns(page)).toHaveCount(0);
        await expect(ipInput(page, 0)).toHaveValue(ip);
      });

      test("2 dòng trùng IP trong cùng modal: dòng sau báo 'IP address already existed'", async ({ page }) => {
        await openAdd(page);
        const ip = freshIp(initial.map((x) => x.ip));
        await fillRow(page, 0, ip);
        await addRowBtn(page).click();
        await expect(modalRows(page)).toHaveCount(2);
        await fillRow(page, 1, ip);
        await expect(modalErrors(page)).toHaveText([MSG.dupAdd]);
        // Sửa lại thành IP khác thì hết lỗi
        await fillRow(page, 1, freshIp([...initial.map((x) => x.ip), ip]));
        await expect(modalErrors(page)).toHaveCount(0);
      });

      test("Cancel đóng modal, không gửi request ghi; mở lại modal thì form trống", async ({ page }) => {
        await openAdd(page);
        await fillRow(page, 0, freshIp(initial.map((x) => x.ip)), "QAAUTO abc");
        await cancelBtn(page).click();
        await expect(modal(page)).toBeHidden();
        await expect(rows(page)).toHaveCount(initial.length);
        await openAdd(page);
        await expect(ipInput(page)).toHaveValue("");
        await expect(remarkInput(page)).toHaveValue("");
        await expect(modalRows(page)).toHaveCount(1);
      });

      test("Nút (x) ở góc modal đóng modal, không gửi request ghi", async ({ page }) => {
        await openAdd(page);
        await fillRow(page, 0, freshIp(initial.map((x) => x.ip)));
        await closeX(page).click();
        await expect(modal(page)).toBeHidden();
        await expect(rows(page)).toHaveCount(initial.length);
      });

      test("Confirm 1 IP gửi geofencing/ip-restrict-create đúng payload, đóng modal rồi nạp lại danh sách (request GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        await openAdd(page);
        const ip = freshIp(initial.map((x) => x.ip));
        await fillRow(page, 0, ip, "QAFAKE one");
        const [req] = await Promise.all([page.waitForRequest(isCreate), page.waitForRequest(isList), confirmBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "geofencing/ip-restrict-create", body }];
        expect(body.geofencing.ipv4).toHaveLength(1);
        expect(body.geofencing.ipv4[0].id).toMatch(/^temp-\d+$/);
        expect(body.geofencing.ipv4[0]).toMatchObject({ value: ip, remark: "QAFAKE one" });
        expect(Object.keys(body)).toEqual(["geofencing"]);
        await expect(modal(page)).toBeHidden();
      });

      test("Confirm 2 IP cùng lúc: payload có 2 phần tử ipv4 với id tạm khác nhau (request GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        await openAdd(page);
        const ip1 = freshIp(initial.map((x) => x.ip));
        const ip2 = freshIp([...initial.map((x) => x.ip), ip1]);
        await fillRows(page, [
          { ip: ip1, remark: "QAFAKE one" },
          { ip: ip2, remark: "QAFAKE two" },
        ]);
        const [req] = await Promise.all([page.waitForRequest(isCreate), confirmBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "geofencing/ip-restrict-create", body }];
        const list = body.geofencing.ipv4;
        expect(list.map((x) => [x.value, x.remark])).toEqual([
          [ip1, "QAFAKE one"],
          [ip2, "QAFAKE two"],
        ]);
        expect(new Set(list.map((x) => x.id)).size).toBe(2);
        for (const x of list) expect(x.id).toMatch(/^temp-\d+$/);
      });

      test("Remarks để trống: payload gửi remark rỗng (request GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        await openAdd(page);
        const ip = freshIp(initial.map((x) => x.ip));
        await fillRow(page, 0, ip, "");
        const [req] = await Promise.all([page.waitForRequest(isCreate), confirmBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "geofencing/ip-restrict-create", body }];
        expect(body.geofencing.ipv4[0]).toMatchObject({ value: ip, remark: "" });
      });

      test("Remarks đúng 255 ký tự: được gửi lên (giới hạn của server là 255) (request GIẢ)", async ({ page }) => {
        await mockWrites(page, MOCK_OK);
        await openAdd(page);
        const ip = freshIp(initial.map((x) => x.ip));
        await fillRow(page, 0, ip, "a".repeat(255));
        await expect(modalErrors(page)).toHaveCount(0);
        const [req] = await Promise.all([page.waitForRequest(isCreate), confirmBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "geofencing/ip-restrict-create", body }];
        expect(body.geofencing.ipv4[0].remark).toHaveLength(255);
      });

      // LỖI ỨNG DỤNG CHƯA XÁC NHẬN: server giới hạn Remark tối đa 255 ký tự (VALIDATION_FAILED "Remark max length is 255") nhưng form không chặn,
      // modal đóng ngay (không chờ response) và KHÔNG hiện bất kỳ thông báo lỗi nào -> người dùng tưởng đã thêm thành công. Test FAIL cho tới khi xác nhận / sửa.
      test("Remarks 256 ký tự: form phải báo lỗi và không gửi request create (hiện tại form cho gửi, server từ chối)", async ({ page }) => {
        await openAdd(page);
        await fillRow(page, 0, freshIp(initial.map((x) => x.ip)), "a".repeat(256));
        await confirmBtn(page).click();
        await expect(modalErrors(page)).not.toHaveCount(0);
      });

      // LỖI ỨNG DỤNG CHƯA XÁC NHẬN: khi server trả fail (VALIDATION_FAILED) app vẫn đóng modal và không hiện toast lỗi (khác các màn khác có toast Error).
      // Test FAIL cho tới khi xác nhận / sửa.
      test("Server từ chối khi tạo (response GIẢ fail): phải hiện toast Error (hiện tại modal đóng im lặng)", async ({ page }) => {
        await mockWrites(page, {
          status: "fail",
          messageCode: "VALIDATION_FAILED",
          message: "One or more validation errors occurred.",
          validation: { "GeoFencing.Ipv4[0].Remark": ["Remark max length is 255"] },
        });
        await openAdd(page);
        await fillRow(page, 0, freshIp(initial.map((x) => x.ip)), "QAFAKE fail");
        const [req] = await Promise.all([page.waitForRequest(isCreate), confirmBtn(page).click()]);
        allowedWrites = [{ url: "geofencing/ip-restrict-create", body: bodyOf(req) }];
        await expect(toasts(page).filter({ hasText: "Error" })).toBeVisible();
      });
    });

    // ===== 4. Modal Edit whitelist =====
    test.describe("Modal Edit whitelist (không ghi dữ liệu thật)", () => {
      test("Icon Update mở modal 'Edit whitelist' nạp sẵn IP + Remarks của dòng (3 dòng đầu), không có nút xoá dòng", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        for (let i = 0; i < Math.min(3, initial.length); i++) {
          await openEdit(page, i);
          await expect(ipInput(page)).toHaveValue(initial[i].ip);
          await expect(remarkInput(page)).toHaveValue(norm(initial[i].remark));
          await expect(modalRows(page)).toHaveCount(1);
          await expect(removeRowBtns(page)).toHaveCount(0);
          await expect(modal(page).locator("label.ant-radio-wrapper")).toHaveText("By IP IPV4");
          await cancelBtn(page).click();
          await expect(modal(page)).toBeHidden();
        }
      });

      test("Edit có nút Confirm / Cancel / (x); Cancel đóng modal và dòng không đổi", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        await openEdit(page, 0);
        await expect(confirmBtn(page)).toBeVisible();
        await expect(closeX(page)).toBeVisible();
        await fillRow(page, 0, freshIp(initial.map((x) => x.ip)), "QAAUTO changed");
        await cancelBtn(page).click();
        await expect(modal(page)).toBeHidden();
        await expect(cellAt(page, 0, COL.ip)).toHaveText(initial[0].ip);
        await expect(cellAt(page, 0, COL.remark)).toHaveText(norm(initial[0].remark));
      });

      test("Xoá trống ô IP: báo 'This field is required'", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        await openEdit(page, 0);
        await ipInput(page).fill("");
        await modalTitle(page).click();
        await expect(modalErrors(page)).toHaveText([MSG.required]);
        await confirmBtn(page).click();
        await expect(modal(page)).toBeVisible();
      });

      test("Nhập IP sai định dạng: báo lỗi IPv4 và Confirm không gửi request", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        await openEdit(page, 0);
        await ipInput(page).fill("999.1.1.1");
        await modalTitle(page).click();
        await expect(modalErrors(page)).toHaveText([MSG.invalidIp]);
        await confirmBtn(page).click();
        await expect(modal(page)).toBeVisible();
      });

      test("Đổi IP sang IP của dòng khác: gọi validate/ip {value, sasEntityId} và báo 'IP address is already existed'", async ({ page }) => {
        test.skip(initial.length < 2, "Cần ít nhất 2 bản ghi");
        await openEdit(page, 0);
        const [req] = await Promise.all([page.waitForRequest(isValidate), ipInput(page).fill(initial[1].ip)]);
        const body = bodyOf(req);
        expect(body.value).toBe(initial[1].ip);
        expect(typeof body.sasEntityId).toBe("number");
        await expect(modalErrors(page)).toHaveText([MSG.dupEdit]);
        await confirmBtn(page).click();
        await expect(modal(page)).toBeVisible();
      });

      test("Giữ nguyên IP gốc (gõ lại đúng IP cũ): không báo lỗi trùng", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        await openEdit(page, 0);
        await ipInput(page).fill("");
        await ipInput(page).fill(initial[0].ip);
        await modalTitle(page).click();
        await expect(modalErrors(page)).toHaveCount(0);
      });

      test("Đổi sang IP mới chưa có: không báo lỗi", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        await openEdit(page, 0);
        await fillRow(page, 0, freshIp(initial.map((x) => x.ip)), norm(initial[0].remark));
        await expect(modalErrors(page)).toHaveCount(0);
      });

      test("Remarks không hợp lệ ở modal Edit: báo 'Please enter only alphanumeric characters'", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        await openEdit(page, 0);
        await remarkInput(page).fill("QA-AUTO");
        await modalTitle(page).click();
        await expect(modalErrors(page)).toHaveText([MSG.remark]);
      });

      test("Confirm gửi geofencing/ip-restrict-update đúng payload (id của dòng, IP, remark mới), đóng modal rồi nạp lại danh sách (request GIẢ)", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        await mockWrites(page, MOCK_OK);
        const last = initial.length - 1;
        const id = await rowId(rowAt(page, last));
        await openEdit(page, last);
        await remarkInput(page).fill("QAFAKE edit");
        const [req] = await Promise.all([page.waitForRequest(isUpdate), page.waitForRequest(isList), confirmBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "geofencing/ip-restrict-update", body }];
        expect(body).toEqual({ geofencing: { ipv4: [{ id, value: initial[last].ip, remark: "QAFAKE edit" }] } });
        expect(typeof body.geofencing.ipv4[0].id).toBe("number");
        await expect(modal(page)).toBeHidden();
      });

      test("Đổi IP ở modal Edit: payload update mang IP mới và vẫn giữ id cũ (request GIẢ)", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        await mockWrites(page, MOCK_OK);
        const id = await rowId(rowAt(page, 0));
        await openEdit(page, 0);
        const ip = freshIp(initial.map((x) => x.ip));
        await fillRow(page, 0, ip, "QAFAKE ip");
        await expect(modalErrors(page)).toHaveCount(0);
        const [req] = await Promise.all([page.waitForRequest(isUpdate), confirmBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "geofencing/ip-restrict-update", body }];
        expect(body.geofencing.ipv4).toEqual([{ id, value: ip, remark: "QAFAKE ip" }]);
      });
    });

    // ===== 5. Hộp thoại Delete =====
    test.describe("Hộp thoại Delete (không ghi dữ liệu thật)", () => {
      test("Icon thùng rác mở hộp thoại 'Delete' với câu hỏi xác nhận và 2 nút Cancel / Delete", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        await deleteIcon(rowAt(page, 0)).click();
        await expect(delDialog(page)).toBeVisible();
        await expect(delDialog(page).locator("h4")).toHaveText(MSG.deleteTitle);
        await expect(delDialog(page)).toContainText(MSG.deleteText);
        await expect(delCancelBtn(page)).toBeVisible();
        await expect(delConfirmBtn(page)).toBeVisible();
      });

      test("Cancel đóng hộp thoại, không gửi request xoá, danh sách không đổi", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        await deleteIcon(rowAt(page, 0)).click();
        await delCancelBtn(page).click();
        await expect(delDialog(page)).toBeHidden();
        await expect(rows(page)).toHaveCount(initial.length);
        await expect(cellAt(page, 0, COL.ip)).toHaveText(initial[0].ip);
      });

      test("Delete gửi geofencing/ip-restrict-delete {id} của đúng dòng, hiện toast Success, nạp lại danh sách (request GIẢ)", async ({ page }) => {
        test.skip(initial.length === 0, "Không có bản ghi");
        await mockWrites(page, MOCK_OK);
        const last = initial.length - 1;
        const id = await rowId(rowAt(page, last));
        await deleteIcon(rowAt(page, last)).click();
        const [req] = await Promise.all([page.waitForRequest(isDelete), page.waitForRequest(isList), delConfirmBtn(page).click()]);
        const body = bodyOf(req);
        allowedWrites = [{ url: "geofencing/ip-restrict-delete", body }];
        expect(body).toEqual({ id });
        await expect(delDialog(page)).toBeHidden();
        await expect(toasts(page).filter({ hasText: "Success" }).first()).toBeVisible();
        // Request xoá chỉ là GIẢ nên bản ghi vẫn còn sau khi nạp lại danh sách
        await settle(page);
        await expect(rows(page)).toHaveCount(initial.length);
      });
    });
  });

  // ===== NHÓM GHI DỮ LIỆU THẬT (chỉ trên IP QA do chính test tạo, luôn xoá lại) =====
  test.describe("CRUD (ghi dữ liệu thật trên IP QA, luôn xoá lại)", () => {
    test.skip(!RUN_FULL_TESTS, SKIP_WRITE_REASON);
    test.describe.configure({ mode: "serial" });

    const trackedIps = new Set(); // mọi IP QA do lần chạy này tạo (để afterAll quét nốt nếu test dừng giữa chừng)
    const trackedIds = new Set(); // id các bản ghi QA (afterEach chỉ cho phép update / delete các id này)

    // Tạo IP QA ngẫu nhiên và nhớ lại để dọn
    const qaIp = (existing) => {
      const ip = freshIp(existing);
      trackedIps.add(ip);
      return ip;
    };
    const qaRemark = (suffix = "") => `${QA_REMARK_PREFIX} ${Date.now()}${suffix}`;

    const ipsOf = async (page) => (await tableMatrix(page)).map((r) => r.cells[COL.ip]);

    // Tạo (qua UI) các IP QA: entries = [{ip, remark}]. Kiểm tra request / response create, rồi trả về { body, ids }
    async function createEntries(page, entries) {
      await openAdd(page);
      await fillRows(page, entries);
      await expect(modalErrors(page)).toHaveCount(0);
      const [req, res, listRes] = await Promise.all([
        page.waitForRequest(isCreate),
        page.waitForResponse(isCreate),
        page.waitForResponse(isList),
        confirmBtn(page).click(),
      ]);
      const json = await res.json();
      expect(json.status, JSON.stringify(json)).toBe("success");
      expect(json.messageCode).toBe("CREATE_IP_RESTRICT_SUCCESS");
      const list = (await listRes.json()).data;
      const ids = entries.map((e) => {
        const x = list.find((r) => r.ip === e.ip);
        expect(x, `IP ${e.ip} phải có trong danh sách sau khi tạo`).toBeTruthy();
        trackedIds.add(x.id);
        return x.id;
      });
      await expect(modal(page)).toBeHidden();
      await settle(page);
      return { body: bodyOf(req), ids };
    }

    // Xoá (qua UI) 1 IP QA. Trả về false nếu IP không còn trong danh sách
    async function deleteEntry(page, ip) {
      const row = rowOfIp(page, ip);
      if ((await row.count()) === 0) return false;
      const id = await rowId(row.first());
      trackedIds.add(id);
      await deleteIcon(row.first()).click();
      await expect(delDialog(page)).toBeVisible();
      const [req, res] = await Promise.all([page.waitForRequest(isDelete), page.waitForResponse(isDelete), delConfirmBtn(page).click()]);
      expect(bodyOf(req)).toEqual({ id });
      const json = await res.json();
      expect(json.status, JSON.stringify(json)).toBe("success");
      await expect(delDialog(page)).toBeHidden();
      await expect(rowOfIp(page, ip)).toHaveCount(0);
      await settle(page);
      return true;
    }

    // Xoá nhiều IP QA trong finally (không làm hỏng lỗi gốc của test nếu dọn dẹp cũng lỗi)
    async function cleanup(page, ips) {
      for (const ip of ips) await deleteEntry(page, ip).catch(() => {});
    }

    test.afterAll(async ({ browser }) => {
      test.setTimeout(120000);
      if (trackedIps.size === 0) return;
      const ctx = await browser.newContext({ storageState: buildStorageState(), viewport: VIEWPORT });
      const page = await ctx.newPage();
      try {
        await openPage(page);
        for (const ip of trackedIps) await deleteEntry(page, ip).catch(() => {});
      } catch {
        /* session hết hạn: không dọn được, test chính đã báo lỗi */
      } finally {
        await ctx.close();
      }
    });

    test.beforeEach(async ({ page }) => {
      await openPage(page);
      test.setTimeout(120000); // mỗi test gồm tạo + sửa / xoá + dọn trong finally
    });

    // Mọi request ghi của nhóm này chỉ được nhắm vào IP / id của bản ghi QA (không bao giờ đụng IP có sẵn của team)
    test.afterEach(async () => {
      for (const w of writes) {
        expect(["geofencing/ip-restrict-create", "geofencing/ip-restrict-update", "geofencing/ip-restrict-delete"], "URL ghi không nằm trong danh sách").toContain(w.url);
        if (w.url.endsWith("create")) {
          for (const x of w.body.geofencing.ipv4) {
            expect(trackedIps.has(x.value), `create chỉ dùng IP QA, gặp ${x.value}`).toBe(true);
            expect(x.remark === "" || x.remark.startsWith(QA_REMARK_PREFIX), `remark QA, gặp "${x.remark}"`).toBe(true);
          }
        } else if (w.url.endsWith("update")) {
          for (const x of w.body.geofencing.ipv4) expect(trackedIds.has(x.id), `update phải nhắm bản ghi QA, gặp id ${x.id}`).toBe(true);
        } else {
          expect(trackedIds.has(w.body.id), `delete phải nhắm bản ghi QA, gặp id ${w.body.id}`).toBe(true);
        }
      }
    });

    test("Tạo 1 IP QA: gửi ip-restrict-create đúng payload, modal đóng, dòng mới ở ĐẦU danh sách với IP / Remark đúng, 'Whitelist (N)' tăng 1", async ({ page }) => {
      const before = await ipsOf(page);
      const ip = qaIp(before);
      const rm = qaRemark();
      try {
        const { body, ids } = await createEntries(page, [{ ip, remark: rm }]);
        expect(body.geofencing.ipv4).toHaveLength(1);
        expect(body.geofencing.ipv4[0]).toMatchObject({ value: ip, remark: rm });
        // Danh sách theo id giảm dần: bản ghi mới có id lớn nhất nên ở đầu
        await expect(cellAt(page, 0, COL.ip)).toHaveText(ip);
        await expect(cellAt(page, 0, COL.remark)).toHaveText(rm);
        await expect(cellAt(page, 0, COL.country)).toHaveText("");
        expect(await rowId(rowAt(page, 0))).toBe(ids[0]);
        await expect(rows(page)).toHaveCount(before.length + 1);
        await expect(tabTitle(page)).toHaveText(`Whitelist (${before.length + 1})`);
      } finally {
        await cleanup(page, [ip]);
      }
    });

    test("Tạo 2 IP QA trong 1 lần Confirm: cả 2 dòng xuất hiện (IP thêm sau có id lớn hơn nên ở trên)", async ({ page }) => {
      const before = await ipsOf(page);
      const ip1 = qaIp(before);
      const ip2 = qaIp([...before, ip1]);
      try {
        const { body, ids } = await createEntries(page, [
          { ip: ip1, remark: qaRemark(" one") },
          { ip: ip2, remark: qaRemark(" two") },
        ]);
        expect(body.geofencing.ipv4.map((x) => x.value)).toEqual([ip1, ip2]);
        expect(new Set(ids).size).toBe(2);
        await expect(rows(page)).toHaveCount(before.length + 2);
        await expect(rowOfIp(page, ip1)).toHaveCount(1);
        await expect(rowOfIp(page, ip2)).toHaveCount(1);
        const order = await ipsOf(page);
        expect(order.indexOf(ip2), "id lớn hơn thì ở trên").toBeLessThan(order.indexOf(ip1));
      } finally {
        await cleanup(page, [ip1, ip2]);
      }
    });

    test("Tạo IP QA không có Remarks: thành công, dòng mới có cột Remark trống", async ({ page }) => {
      const before = await ipsOf(page);
      const ip = qaIp(before);
      try {
        await createEntries(page, [{ ip, remark: "" }]);
        await expect(cellAt(page, 0, COL.ip)).toHaveText(ip);
        await expect(cellAt(page, 0, COL.remark)).toHaveText("");
      } finally {
        await cleanup(page, [ip]);
      }
    });

    test("Dữ liệu vừa tạo còn nguyên sau khi tải lại trang (đã lưu ở server)", async ({ page }) => {
      const before = await ipsOf(page);
      const ip = qaIp(before);
      const rm = qaRemark();
      try {
        await createEntries(page, [{ ip, remark: rm }]);
        const data = await openPage(page);
        const x = data.find((r) => r.ip === ip);
        expect(x).toMatchObject({ ip, remark: rm, restrictBy: "IP_ADDRESS", type: "BACKOFFICE", whiteList: true });
        await expect(rowOfIp(page, ip).locator("td").nth(COL.remark)).toHaveText(rm);
      } finally {
        await cleanup(page, [ip]);
      }
    });

    test("Tạo IP đã tồn tại (IP QA vừa tạo): modal báo 'IP address already existed' và Confirm không gửi request create", async ({ page }) => {
      const before = await ipsOf(page);
      const ip = qaIp(before);
      try {
        await createEntries(page, [{ ip, remark: qaRemark() }]);
        const writesBefore = writes.length;
        await openAdd(page);
        await fillRow(page, 0, ip, qaRemark(" dup"));
        await expect(modalErrors(page)).toHaveText([MSG.dupAdd]);
        await confirmBtn(page).click();
        await expect(modal(page)).toBeVisible();
        expect(writes.length, "Không được gửi thêm request ghi").toBe(writesBefore);
        await cancelBtn(page).click();
        await expect(rows(page)).toHaveCount(before.length + 1);
      } finally {
        await cleanup(page, [ip]);
      }
    });

    test("Sửa Remarks của IP QA: gửi ip-restrict-update đúng payload, danh sách hiện remark mới, IP giữ nguyên", async ({ page }) => {
      const before = await ipsOf(page);
      const ip = qaIp(before);
      try {
        const { ids } = await createEntries(page, [{ ip, remark: qaRemark() }]);
        const newRemark = `${QA_REMARK_PREFIX} edited ${Date.now()}`;
        await openEdit(page, 0);
        await expect(ipInput(page)).toHaveValue(ip);
        await remarkInput(page).fill(newRemark);
        const [req, res] = await Promise.all([page.waitForRequest(isUpdate), page.waitForResponse(isUpdate), confirmBtn(page).click()]);
        expect(bodyOf(req)).toEqual({ geofencing: { ipv4: [{ id: ids[0], value: ip, remark: newRemark }] } });
        const json = await res.json();
        expect(json.status, JSON.stringify(json)).toBe("success");
        expect(json.messageCode).toBe("UPDATE_IP_RESTRICT_SUCCESS");
        await expect(modal(page)).toBeHidden();
        await settle(page);
        await expect(cellAt(page, 0, COL.ip)).toHaveText(ip);
        await expect(cellAt(page, 0, COL.remark)).toHaveText(newRemark);
        await expect(rows(page)).toHaveCount(before.length + 1);
      } finally {
        await cleanup(page, [ip]);
      }
    });

    test("Sửa IP của IP QA sang IP mới: danh sách hiện IP mới, IP cũ biến mất, id không đổi", async ({ page }) => {
      const before = await ipsOf(page);
      const ip = qaIp(before);
      const ip2 = qaIp([...before, ip]);
      try {
        const { ids } = await createEntries(page, [{ ip, remark: qaRemark() }]);
        await openEdit(page, 0);
        const [vreq] = await Promise.all([page.waitForRequest(isValidate), ipInput(page).fill(ip2)]);
        expect(bodyOf(vreq).value).toBe(ip2);
        await expect(modalErrors(page)).toHaveCount(0);
        const [req, res] = await Promise.all([page.waitForRequest(isUpdate), page.waitForResponse(isUpdate), confirmBtn(page).click()]);
        expect(bodyOf(req).geofencing.ipv4).toMatchObject([{ id: ids[0], value: ip2 }]);
        expect((await res.json()).status).toBe("success");
        await expect(modal(page)).toBeHidden();
        await settle(page);
        await expect(rowOfIp(page, ip2)).toHaveCount(1);
        await expect(rowOfIp(page, ip)).toHaveCount(0);
        expect(await rowId(rowOfIp(page, ip2).first())).toBe(ids[0]);
      } finally {
        await cleanup(page, [ip, ip2]);
      }
    });

    test("Sửa IP QA sang IP có sẵn của dòng khác: modal Edit báo 'IP address is already existed' và Confirm không gửi update", async ({ page }) => {
      const before = await ipsOf(page);
      test.skip(before.length === 0, "Không có IP có sẵn để làm IP trùng");
      const ip = qaIp(before);
      try {
        await createEntries(page, [{ ip, remark: qaRemark() }]);
        const writesBefore = writes.length;
        await openEdit(page, 0);
        await ipInput(page).fill(before[0]);
        await expect(modalErrors(page)).toHaveText([MSG.dupEdit]);
        await confirmBtn(page).click();
        await expect(modal(page)).toBeVisible();
        expect(writes.length, "Không được gửi thêm request ghi").toBe(writesBefore);
        await cancelBtn(page).click();
        await expect(cellAt(page, 0, COL.ip)).toHaveText(ip);
      } finally {
        await cleanup(page, [ip]);
      }
    });

    test("Sửa rồi Cancel: dữ liệu IP QA không đổi", async ({ page }) => {
      const before = await ipsOf(page);
      const ip = qaIp(before);
      const rm = qaRemark();
      try {
        await createEntries(page, [{ ip, remark: rm }]);
        await openEdit(page, 0);
        await remarkInput(page).fill(`${QA_REMARK_PREFIX} cancelled`);
        await cancelBtn(page).click();
        await expect(modal(page)).toBeHidden();
        await expect(cellAt(page, 0, COL.remark)).toHaveText(rm);
      } finally {
        await cleanup(page, [ip]);
      }
    });

    test("Xoá IP QA: Cancel không xoá; Delete gửi ip-restrict-delete {id}, hiện toast Success, dòng biến mất, 'Whitelist (N)' giảm 1", async ({ page }) => {
      const before = await ipsOf(page);
      const ip = qaIp(before);
      try {
        const { ids } = await createEntries(page, [{ ip, remark: qaRemark() }]);

        // Cancel: không xoá
        await deleteIcon(rowOfIp(page, ip).first()).click();
        await expect(delDialog(page)).toBeVisible();
        await delCancelBtn(page).click();
        await expect(delDialog(page)).toBeHidden();
        await expect(rowOfIp(page, ip)).toHaveCount(1);

        // Delete: xoá thật
        await deleteIcon(rowOfIp(page, ip).first()).click();
        const [req, res] = await Promise.all([page.waitForRequest(isDelete), page.waitForResponse(isDelete), delConfirmBtn(page).click()]);
        expect(bodyOf(req)).toEqual({ id: ids[0] });
        const json = await res.json();
        expect(json.status, JSON.stringify(json)).toBe("success");
        expect(json.messageCode).toBe("DELETE_IP_RESTRICT_SUCCESS");
        await expect(toasts(page).filter({ hasText: "Success" }).first()).toBeVisible();
        await expect(delDialog(page)).toBeHidden();
        await expect(rowOfIp(page, ip)).toHaveCount(0);
        await settle(page);
        await expect(rows(page)).toHaveCount(before.length);
        await expect(tabTitle(page)).toHaveText(`Whitelist (${before.length})`);

        // Đã xoá ở server: tải lại vẫn không còn
        const data = await openPage(page);
        expect(data.some((x) => x.ip === ip)).toBe(false);
      } finally {
        await cleanup(page, [ip]);
      }
    });

    test("Sau khi xoá, có thể tạo lại đúng IP đó (IP được giải phóng)", async ({ page }) => {
      const before = await ipsOf(page);
      const ip = qaIp(before);
      try {
        await createEntries(page, [{ ip, remark: qaRemark() }]);
        expect(await deleteEntry(page, ip)).toBe(true);
        await createEntries(page, [{ ip, remark: qaRemark(" again") }]);
        await expect(rowOfIp(page, ip)).toHaveCount(1);
      } finally {
        await cleanup(page, [ip]);
      }
    });
  });
});
