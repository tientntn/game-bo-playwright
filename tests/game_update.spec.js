// Games > Update Game  (https://dev-bo.royaledge.io/game/update/{id})
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npx playwright test tests/game_update.spec.js --project=setup --project=chromium
//
// Id game KHÔNG hard-code: test mở danh sách game (/game) rồi bấm icon Update (cây bút) ở dòng đầu tiên để vào màn hình
// cập nhật, id lấy từ response của danh sách. Dữ liệu hiển thị được so với response của API game/view.
//
// Màn hình cập nhật game gồm 5 bước (wizard): Basic Information -> Currency -> Agent Assignment -> Paytable ->
// Review & Submit. Bước cuối có nút Submit LƯU thật dữ liệu game. Test KHÔNG BAO GIỜ bấm Submit, không bấm OK / Confirm
// ở các hộp thoại, không bấm Delete / Add New: chỉ đi qua các bước bằng Next / Previous, sửa thử trên form rồi
// rời trang (Cancel) và kiểm tra không có request ghi dữ liệu nào được gửi đi.
// Test chạy với màn hình RỘNG (1920x1080).
const { test, expect } = require("@playwright/test");

test.use({ viewport: { width: 1920, height: 1080 } });

const STEPS = ["Basic Information", "Currency", "Agent Assignment", "Paytable", "Review & Submit"];
const HIT_RATE_ERROR = "Please enter valid hit rate value greater than 0 and hit rate value less than 100";
const VOLATILITY = ["High", "High-Med", "Medium", "Low-Med", "Low"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const reqOf = (r) => (typeof r.request === "function" ? r.request() : r);
const isPost = (r, suffix) => reqOf(r).method() === "POST" && reqOf(r).url().endsWith(suffix);
const isList = (r) => isPost(r, "/game/list/v2");
const isView = (r) => isPost(r, "/game/view");

const breadcrumb = (page) => page.locator("nav.ant-breadcrumb");
const dialog = (page) => page.getByRole("dialog");
const tooltip = (page) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");
// Tooltip antd mở / đóng có độ trễ: tooltip cũ còn đang mờ dần thì có 2 tooltip cùng lúc (strict mode violation).
// Đưa chuột ra ngoài, đợi tooltip cũ ẩn hết rồi hover lại, thử lại tới khi tooltip có đúng nội dung.
const hoverTip = async (page, target, text) => {
  await expect(async () => {
    await page.mouse.move(0, 0);
    await expect(tooltip(page)).toHaveCount(0, { timeout: 2000 });
    await target.hover();
    await expect(tooltip(page).filter({ hasText: text })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
};
const nextBtn = (page) => page.getByRole("button", { name: "Next", exact: true });
const prevBtn = (page) => page.getByRole("button", { name: "Previous", exact: true });
const cancelBtn = (page) => page.getByRole("button", { name: "Cancel", exact: true });
const submitBtn = (page) => page.getByRole("button", { name: "Submit", exact: true });
const rows = (page) => page.locator("tbody tr.ant-table-row");
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const exact = (name, flags = "") =>
  new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, flags);

// Ô form theo nhãn (vd "Game Category")
const field = (page, label) =>
  page
    .locator(".ant-form-item")
    .filter({ has: page.locator(".ant-form-item-label label", { hasText: exact(label) }) })
    .first();
const fieldErrors = (page, label) => field(page, label).locator(".ant-form-item-explain-error");

// Bước đang active (1..5)
async function activeStep(page) {
  const names = await page.locator(".ant-steps-item").evaluateAll((els) =>
    els.map((e) => [e.classList.contains("ant-steps-item-active"), e.innerText.replace(/\s+/g, " ").trim()]),
  );
  return names.findIndex(([active]) => active) + 1;
}

// Chọn thẻ title chip đang chọn của 1 ô select
const chips = (page, label) =>
  field(page, label)
    .locator(".ant-select-selection-item[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));

// Click ra ngoài (vào chữ "Update Game" ở breadcrumb) để đóng dropdown. Không click vào "Games" vì đó là link về danh sách.
const clickOutside = (page) => breadcrumb(page).getByText("Update Game").click();

// Mở dropdown của 1 ô, đọc danh sách option rồi đóng lại
async function dropdownOptions(page, label) {
  await field(page, label).locator(".ant-select-selector").click();
  const opts = page.locator(
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
  );
  await opts.first().waitFor();
  const titles = await opts.evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? e.innerText.trim()));
  await clickOutside(page);
  await expect(opts).toHaveCount(0);
  return titles;
}

// Ghi lại mọi request POST KHÔNG phải đọc dữ liệu để chắc chắn test không làm đổi dữ liệu thật
function watchWrites(page) {
  const writes = [];
  const READ =
    /\/(list|list\/v2|details|download|view|dropdown|by-currency-category)$|\/dropdown\/|\/user\/details$/;
  page.on("request", (r) => {
    if (r.method() === "POST" && /boapi/.test(r.url()) && !READ.test(r.url())) writes.push(r.url());
  });
  return writes;
}

// Đóng hộp thoại bằng Cancel (không bao giờ bấm OK / Confirm)
async function closeDialog(page) {
  await dialog(page).getByRole("button", { name: /Cancel$/ }).click();
  await expect(dialog(page)).toBeHidden();
}

// Mở danh sách game rồi bấm icon Update của dòng đầu tiên -> vào màn hình cập nhật.
// Trả về { id, listGame, view (data của game/view), viewBody (request body của game/view) }
async function openUpdate(page) {
  test.setTimeout(120000);
  const listRes = page.waitForResponse(isList, { timeout: 60000 });
  listRes.catch(() => {});
  await page.goto("/game");
  const redirectedToLogin = page
    .waitForURL(/\/login/, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (await Promise.race([listRes.then(() => false), redirectedToLogin])) {
    throw new Error(
      "Bị chuyển về /login: session trong playwright/.auth/session.txt đã hết hạn (backend chỉ cho 1 session/tài khoản - đăng nhập ở nơi khác sẽ làm session này mất hiệu lực; token chỉ sống khoảng 1 giờ). Copy lại localStorage từ DevTools.",
    );
  }
  const list = (await (await listRes).json()).data.list;
  expect(list.length, "Danh sách game trống").toBeGreaterThan(0);
  await expect(rows(page).first()).toBeVisible();

  const [viewReq, viewRes] = await Promise.all([
    page.waitForRequest(isView),
    page.waitForResponse(isView),
    rows(page).first().locator("td").last().locator("svg").nth(1).click(),
  ]);
  const listGame = list[0];
  await expect(page).toHaveURL(new RegExp(`/game/update/${listGame.id}$`));
  await expect(page.locator("#name")).toBeVisible();
  return {
    id: listGame.id,
    listGame,
    view: (await viewRes.json()).data,
    viewBody: JSON.parse(viewReq.postData()),
  };
}

// Đi tới bước n (1..5) bằng nút Next
async function goToStep(page, n) {
  for (let s = await activeStep(page); s < n; s++) {
    await nextBtn(page).click();
    await expect.poll(() => activeStep(page)).toBe(s + 1);
    // Bước 2, 3, 4 hiển thị bảng được render sau khi chuyển bước -> chờ có dòng đầu tiên
    if (s + 1 >= 2 && s + 1 <= 4) await expect(rows(page).first()).toBeVisible();
  }
}

const headers = async (page) =>
  (await page.locator(".ant-table-thead th").allInnerTexts()).map((t) => t.trim());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Games > Update Game", () => {
  let ctx; // { id, listGame, view, viewBody }
  let writes;

  test.beforeEach(async ({ page }) => {
    writes = watchWrites(page);
    ctx = await openUpdate(page);
  });

  // Mọi test đều không được gửi request ghi dữ liệu
  test.afterEach(async () => {
    expect(writes, "Không được gửi request ghi dữ liệu").toEqual([]);
  });

  // ===== 1. Vào màn hình từ danh sách game =====
  test.describe("Vào màn hình và điều hướng", () => {
    test("Bấm icon Update ở danh sách mở đúng /game/update/{id} và gọi API game/view với id đó", async ({ page }) => {
      await expect(page).toHaveURL(new RegExp(`/game/update/${ctx.id}$`));
      expect(ctx.viewBody.gameId).toBe(ctx.id);
      expect(ctx.viewBody.sasEntityId).toEqual(expect.any(Number));
      expect(ctx.view.id).toBe(ctx.id);
    });

    test("Có tiêu đề 'Games > Update Game', thanh 5 bước và 2 nút Cancel / Next", async ({ page }) => {
      await expect(breadcrumb(page)).toContainText("Games");
      await expect(breadcrumb(page)).toContainText("Update Game");
      const steps = (await page.locator(".ant-steps-item").allInnerTexts()).map(norm);
      expect(steps).toHaveLength(5);
      STEPS.forEach((name, i) => expect(steps[i]).toContain(name));
      expect(await activeStep(page)).toBe(1);
      await expect(cancelBtn(page)).toBeVisible();
      await expect(nextBtn(page)).toBeVisible();
      await expect(prevBtn(page)).toHaveCount(0);
    });

    test("Màn hình rộng: khối Game Information và Game Image nằm cạnh nhau", async ({ page }) => {
      const info = await page.getByText("Game Information", { exact: true }).boundingBox();
      const image = await page.getByText("Game Image", { exact: true }).boundingBox();
      expect(Math.round(info.y)).toBe(Math.round(image.y)); // cùng hàng
      expect(image.x).toBeGreaterThan(info.x + 600); // Game Image nằm ở cột bên phải
    });

    test("Cancel quay về danh sách game, không cần xác nhận", async ({ page }) => {
      await cancelBtn(page).click();
      await expect(page).toHaveURL(/\/game$/);
      await expect(breadcrumb(page)).toHaveText("Games");
    });

    test("Sửa dữ liệu rồi Cancel thì danh sách vẫn giữ nguyên tên game", async ({ page }) => {
      await page.locator("#name").fill(`${ctx.listGame.name} (sửa thử)`);
      const listRes = page.waitForResponse(isList);
      await cancelBtn(page).click();
      const list = (await (await listRes).json()).data.list;
      expect(list.find((g) => g.id === ctx.id).name).toBe(ctx.listGame.name);
      await expect(rows(page).first().locator("td").nth(2)).toHaveText(norm(ctx.listGame.name));
    });

    test("Link 'Games' trên breadcrumb quay về danh sách", async ({ page }) => {
      await breadcrumb(page).getByText("Games", { exact: true }).click();
      await expect(page).toHaveURL(/\/game$/);
    });

    test("Tải lại trang vẫn hiển thị đúng game", async ({ page }) => {
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`/game/update/${ctx.id}$`));
      await expect(page.locator("#name")).toHaveValue(ctx.view.name);
      await expect(page.locator("#code")).toHaveValue(ctx.view.code);
    });
  });

  // ===== 2. Bước 1: Basic Information =====
  test.describe("Bước 1 - Basic Information", () => {
    test("Có đủ các trường, trường bắt buộc có dấu *", async ({ page }) => {
      for (const label of [
        "Name",
        "Code",
        "Game Category",
        "Game Sub Category",
        "Engine",
        "Win Formula",
        "Hit Rate",
        "Volatility",
        "Language",
        "Features",
        "Themes",
        "Labels",
        "Tags",
        "Status",
        "Landscape Image",
        "Square Image",
      ]) {
        await expect(field(page, label), `thiếu trường ${label}`).toBeVisible();
      }
      for (const label of ["Name", "Code", "Game Category", "Game Sub Category", "Engine", "Win Formula"]) {
        await expect(
          field(page, label).locator(".ant-form-item-required"),
          `${label} phải bắt buộc`,
        ).toHaveCount(1);
      }
      for (const label of ["Hit Rate", "Volatility", "Language", "Features", "Themes", "Labels", "Tags"]) {
        await expect(field(page, label).locator(".ant-form-item-required"), `${label} không bắt buộc`).toHaveCount(0);
      }
    });

    test("Giá trị khớp response game/view", async ({ page }) => {
      const g = ctx.view;
      await expect(page.locator("#name")).toHaveValue(g.name);
      await expect(page.locator("#code")).toHaveValue(g.code);
      expect(await chips(page, "Game Category")).toEqual([g.gameCategory.label]);
      expect(await chips(page, "Game Sub Category")).toEqual([g.gameSubCategory.label]);
      await expect(page.locator("#hitrate")).toHaveValue(g.hitrate == null ? "" : String(g.hitrate));
      // Các ô nhiều giá trị: số lượng giá trị đang chọn bằng số phần tử API trả về (null = trống)
      const count = (v) => (Array.isArray(v) ? v.length : v ? 1 : 0);
      expect((await chips(page, "Volatility")).length).toBe(count(g.volatility));
      for (const [label, key] of [
        ["Language", "languages"],
        ["Features", "feature"],
        ["Themes", "theme"],
        ["Labels", "labels"],
        ["Tags", "tags"],
      ]) {
        const shown = await field(page, label)
          .locator('.ant-select-selection-overflow-item:not([aria-hidden="true"]) .ant-select-selection-item[title]')
          .count();
        const rest = (await field(page, label).locator(".ant-select-selection-overflow-item-rest").allInnerTexts()).reduce(
          (sum, t) => sum + Number(t.match(/\+\s*(\d+)/)?.[1] ?? 0),
          0,
        );
        expect(shown + rest, label).toBe(count(g[key]));
      }
      await expect(page.locator('input[type="radio"][value="1"]')).toBeChecked({ checked: g.status === 1 });
      await expect(page.locator('input[type="radio"][value="0"]')).toBeChecked({ checked: g.status !== 1 });
    });

    test("Code và Engine chỉ đọc (không sửa được), Name sửa được", async ({ page }) => {
      await expect(page.locator("#code")).toBeDisabled();
      await expect(page.locator("#engine")).toBeDisabled();
      await expect(page.locator("#name")).toBeEnabled();
      await expect(page.locator("#hitrate")).toBeEnabled();
    });

    test("Name bắt buộc: để trống rồi Next thì báo lỗi và ở lại bước 1", async ({ page }) => {
      await page.locator("#name").fill("");
      await nextBtn(page).click();
      await expect(fieldErrors(page, "Name")).toHaveText("Please enter Name");
      expect(await activeStep(page)).toBe(1);
    });

    test("Hit Rate hợp lệ (lớn hơn 0 và nhỏ hơn 100) không báo lỗi", async ({ page }) => {
      for (const v of ["0.001", "12.345", "50", "99.99"]) {
        await page.locator("#hitrate").fill(v);
        await page.locator("#hitrate").blur();
        await expect(fieldErrors(page, "Hit Rate"), v).toHaveCount(0);
      }
    });

    test("Hit Rate ngoài khoảng cho phép báo lỗi (100, 101, -1)", async ({ page }) => {
      for (const v of ["100", "101", "-1"]) {
        await page.locator("#hitrate").fill(v);
        await page.locator("#hitrate").blur();
        await expect(fieldErrors(page, "Hit Rate").filter({ hasText: HIT_RATE_ERROR }), v).toHaveCount(1);
      }
    });

    test("Hit Rate không phải số báo 'Please enter a valid number'", async ({ page }) => {
      await page.locator("#hitrate").fill("abc");
      await page.locator("#hitrate").blur();
      await expect(fieldErrors(page, "Hit Rate")).toHaveText("Please enter a valid number");
    });

    test("Hit Rate lỗi thì Next không chuyển bước", async ({ page }) => {
      await page.locator("#hitrate").fill("101");
      await page.locator("#hitrate").blur();
      await nextBtn(page).click();
      await expect(fieldErrors(page, "Hit Rate").first()).toBeVisible();
      expect(await activeStep(page)).toBe(1);
    });

    test("Option cố định của Volatility", async ({ page }) => {
      expect(await dropdownOptions(page, "Volatility")).toEqual(VOLATILITY);
    });

    test("Dropdown Game Category / Game Sub Category có chứa giá trị hiện tại", async ({ page }) => {
      const cats = await dropdownOptions(page, "Game Category");
      expect(cats.length).toBeGreaterThan(1);
      expect(cats).toContain(ctx.view.gameCategory.label);
      const subs = await dropdownOptions(page, "Game Sub Category");
      expect(subs).toContain(ctx.view.gameSubCategory.label);
    });

    for (const label of ["Language", "Features", "Themes", "Labels", "Tags"]) {
      test(`Dropdown ${label} có option 'Select All' và các giá trị chọn nhiều`, async ({ page }) => {
        const options = await dropdownOptions(page, label);
        expect(options[0]).toBe("Select All");
        expect(options.length).toBeGreaterThan(1);
      });
    }

    test("Đổi Game Category thì tải lại danh sách Game Sub Category theo category mới", async ({ page }) => {
      const cats = await dropdownOptions(page, "Game Category");
      const other = cats.find((c) => c !== ctx.view.gameCategory.label);
      test.skip(!other, "Chỉ có 1 category");

      const subReq = page.waitForRequest(
        (r) =>
          isPost(r, "/game/game_sub_category/list") &&
          JSON.parse(r.postData()).filters?.gameCategoryIds?.[0] !== ctx.view.gameCategory.id,
      );
      await field(page, "Game Category").locator(".ant-select-selector").click();
      // Gõ tên để option chắc chắn nằm trong danh sách hiển thị (danh sách ảo, option có thể bị cuộn / render lại)
      await page.keyboard.type(other);
      await page
        .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
        .filter({ hasText: exact(other) })
        .first()
        .click();
      const body = JSON.parse((await subReq).postData());
      expect(body.filters.gameCategoryIds).toHaveLength(1);
      expect(await chips(page, "Game Category")).toEqual([other]);
    });

    test("Status có 2 lựa chọn Active / Inactive, chọn lại thì đổi trạng thái trên form", async ({ page }) => {
      await expect(field(page, "Status")).toContainText("Active");
      await expect(field(page, "Status")).toContainText("Inactive");
      const target = ctx.view.status === 1 ? "0" : "1";
      await page.locator(`input[type="radio"][value="${target}"]`).check();
      await expect(page.locator(`input[type="radio"][value="${target}"]`)).toBeChecked();
    });

    test("Landscape / Square Image nhập được đường dẫn ảnh", async ({ page }) => {
      for (const id of ["imageLandScape", "imageSquare"]) {
        await page.locator(`#${id}`).fill("https://example.com/a.png");
        await expect(page.locator(`#${id}`)).toHaveValue("https://example.com/a.png");
      }
      await expect(page.getByText("Game Image", { exact: true })).toBeVisible();
    });

    test("Rê chuột vào icon ở tiêu đề hiện tooltip Notify Update / Settings", async ({ page }) => {
      await hoverTip(page, page.locator('svg[data-icon="tower-broadcast"]'), "Notify Update");
      await hoverTip(page, page.locator('svg[data-icon="setting"]'), "Settings");
    });

    test("Icon Settings mở hộp thoại Game Settings, đóng bằng Cancel", async ({ page }) => {
      await page.locator(".anticon-setting").click();
      await expect(dialog(page)).toContainText("Game Settings");
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /OK$/ })).toBeVisible();
      await closeDialog(page); // chỉ Cancel, KHÔNG bấm OK
    });

    test("Win Formula: hộp thoại hiển thị đúng các mức (tier) của game", async ({ page }) => {
      const tiers = JSON.parse(ctx.view.winFormula).tiers;
      await page.locator('svg[data-icon="eye"]').first().locator("xpath=..").click();
      await expect(dialog(page)).toContainText("Win Formula");
      for (const t of tiers) {
        const name = t.name.charAt(0) + t.name.slice(1).toLowerCase(); // SLIM -> Slim
        await expect(dialog(page).locator(`#wf${name}Min`), `${t.name} min`).toHaveValue(String(t.min));
        if (t.max != null) {
          await expect(dialog(page).locator(`#wf${name}Max`), `${t.name} max`).toHaveValue(String(t.max));
        }
      }
      await closeDialog(page);
    });
  });

  // ===== 3. Bước 2: Currency =====
  test.describe("Bước 2 - Currency", () => {
    test.beforeEach(async ({ page }) => {
      await goToStep(page, 2);
    });

    test("Chuyển sang bước 2: bước 1 hoàn thành, hiện nút Previous / Next và Add New", async ({ page }) => {
      expect(await activeStep(page)).toBe(2);
      await expect(page.locator(".ant-steps-item").first()).toHaveClass(/ant-steps-item-finish/);
      await expect(prevBtn(page)).toBeVisible();
      await expect(nextBtn(page)).toBeVisible();
      await expect(page.getByRole("button", { name: /Add New/ })).toBeVisible();
    });

    test("Bảng có đủ cột Currency / Denom name / Min Bet / Max Bet / Action", async ({ page }) => {
      expect(await headers(page)).toEqual(["", "Currency", "Denom name", "Min Bet", "Max Bet", "Action"]);
    });

    test("Các dòng khớp danh sách currency của game (currencyInfoList)", async ({ page }) => {
      const list = ctx.view.currencyInfoList;
      expect(await rows(page).count()).toBe(Math.min(10, list.length));
      const heads = await headers(page);
      const cells = await rows(page).evaluateAll((trs) =>
        trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim())),
      );
      cells.forEach((r, i) => {
        const c = list[i];
        const at = `dòng ${i + 1} (${c.code})`;
        expect(r[heads.indexOf("Currency")], at).toBe(c.code);
        expect(r[heads.indexOf("Denom name")], at).toContain(c.denomName);
        if (c.isDefault) expect(r[heads.indexOf("Denom name")], at).toContain("(Default)");
        expect(parseFloat(r[heads.indexOf("Min Bet")].replace(/,/g, "")), at).toBeCloseTo(c.minBet, 4);
        expect(parseFloat(r[heads.indexOf("Max Bet")].replace(/,/g, "")), at).toBeCloseTo(c.maxBet, 4);
      });
    });

    test("Phân trang 10 dòng / trang theo số currency của game", async ({ page }) => {
      const n = ctx.view.currencyInfoList.length;
      test.skip(n <= 10, "Game có không quá 10 currency");
      await expect(page.locator(".ant-pagination-options")).toContainText("10 / page");
      await expect(page.locator(".ant-pagination-item").last()).toHaveText(String(Math.ceil(n / 10)));
      await page.locator(".ant-pagination-item-2").click();
      await expect(rows(page).first().locator("td").nth(1)).toHaveText(ctx.view.currencyInfoList[10].code);
    });

    test("Rê chuột vào icon thùng rác hiện tooltip Delete (không bấm xoá)", async ({ page }) => {
      await rows(page).first().locator('svg[data-icon="trash"]').hover();
      await expect(tooltip(page).filter({ hasText: "Delete" })).toBeVisible();
    });

    test("Add New mở hộp thoại chọn thêm currency, đóng bằng Cancel (không Confirm)", async ({ page }) => {
      await page.getByRole("button", { name: /Add New/ }).click();
      await expect(dialog(page)).toContainText("Add new");
      // Tổng số currency có thể thêm = số dòng trong danh sách của hộp thoại
      await expect(dialog(page).locator("tr.ant-table-row").first()).toBeVisible();
      const available = await dialog(page).locator("tr.ant-table-row").count();
      await expect(dialog(page)).toContainText(`0 of ${available} selected`);
      await expect(dialog(page).locator("#searchInput")).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Cancel$/ })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: /Confirm$/ })).toBeVisible();
      await closeDialog(page);
      // Không thêm gì: số dòng của bảng không đổi
      expect(await rows(page).count()).toBe(Math.min(10, ctx.view.currencyInfoList.length));
    });

    test("Tìm kiếm trong hộp thoại Add New chỉ giữ lại currency khớp", async ({ page }) => {
      await page.getByRole("button", { name: /Add New/ }).click();
      const items = dialog(page).locator("tr.ant-table-row");
      await expect(items.first()).toBeVisible();
      const first = norm(await items.first().innerText());
      test.skip(!first, "Không có currency nào để thêm");
      await dialog(page).locator("#searchInput").fill(first);
      await expect(items.first()).toContainText(first);
      // Danh sách lọc lại bất đồng bộ sau khi gõ -> poll cho tới khi mọi dòng còn lại đều khớp
      await expect
        .poll(async () =>
          (await items.allInnerTexts()).map(norm).every((t) => t.toLowerCase().includes(first.toLowerCase())),
        )
        .toBe(true);
      await closeDialog(page);
    });

    test("Previous quay lại bước 1 và giữ nguyên dữ liệu", async ({ page }) => {
      await prevBtn(page).click();
      expect(await activeStep(page)).toBe(1);
      await expect(page.locator("#name")).toHaveValue(ctx.view.name);
    });
  });

  // ===== 4. Bước 3: Agent Assignment =====
  test.describe("Bước 3 - Agent Assignment", () => {
    test("Bảng Currency / Active Agents / Action, mỗi currency của game 1 dòng", async ({ page }) => {
      const agentReq = page.waitForRequest((r) => isPost(r, "/agent/by-currency-category"));
      await goToStep(page, 3);
      const body = JSON.parse((await agentReq).postData());
      expect(body.currencyIds).toEqual(ctx.view.currencyInfoList.map((c) => c.id));

      expect(await headers(page)).toEqual(["Currency", "Active Agents", "Action"]);
      const list = ctx.view.currencyInfoList;
      expect(await rows(page).count()).toBe(Math.min(10, list.length));
      const cells = await rows(page).evaluateAll((trs) =>
        trs.map((tr) => [...tr.children].map((c) => c.innerText.trim())),
      );
      cells.forEach((r, i) => {
        expect(r[0], `dòng ${i + 1}`).toBe(list[i].code);
        expect(r[1], `Active Agents ${list[i].code}`).toMatch(/^\d+$/);
      });
    });

    test("Icon Update mở hộp thoại Edit Agent Game Status của currency, đóng bằng Cancel", async ({ page }) => {
      await goToStep(page, 3);
      const code = ctx.view.currencyInfoList[0].code;
      await rows(page).first().locator('svg[data-icon="pen-to-square"]').click();
      await expect(dialog(page)).toContainText(`Edit Agent Game Status - ${code}`);
      const heads = (await dialog(page).locator("th").allInnerTexts()).map((t) => t.trim());
      expect(heads).toEqual(expect.arrayContaining(["Agent Code", "Agent Name"]));
      await expect(dialog(page).getByRole("button", { name: /OK$/ })).toBeVisible();
      await closeDialog(page); // chỉ Cancel, KHÔNG bấm OK
    });

    test("Rê chuột vào icon Update hiện tooltip Update", async ({ page }) => {
      await goToStep(page, 3);
      await rows(page).first().locator('svg[data-icon="pen-to-square"]').hover();
      await expect(tooltip(page).filter({ hasText: "Update" })).toBeVisible();
    });
  });

  // ===== 5. Bước 4: Paytable =====
  test.describe("Bước 4 - Paytable", () => {
    test.beforeEach(async ({ page }) => {
      await goToStep(page, 4);
    });

    test("Bảng có đủ cột RTP Level / Paytable Name / Edit Paytable / Edit Help Page / Default", async ({ page }) => {
      expect(await headers(page)).toEqual(
        expect.arrayContaining(["RTP Level", "Paytable Name", "Edit Paytable", "Edit Help Page", "Default"]),
      );
      await expect(page.getByRole("button", { name: /Add New/ })).toBeVisible();
    });

    test("Mỗi paytable của game 1 dòng: RTP Level, tên và paytable mặc định khớp API", async ({ page }) => {
      const list = ctx.view.payTableInfoList;
      await expect(rows(page)).toHaveCount(list.length);
      for (const [i, p] of list.entries()) {
        const row = rows(page).nth(i);
        await expect(row.locator(".ant-select-selection-item"), `RTP Level dòng ${i + 1}`).toHaveText(
          new RegExp(`^${p.rtp}$`, "i"),
        );
        await expect(row.getByRole("textbox"), `Paytable Name dòng ${i + 1}`).toHaveValue(p.code);
      }
      await expect(page.locator('tbody input[type="radio"]:checked')).toHaveCount(1);
    });

    test("Edit Paytable mở hộp thoại Paytable của game, đóng bằng Cancel", async ({ page }) => {
      const p = ctx.view.payTableInfoList[0];
      await rows(page).first().locator('svg[data-icon="pen-to-square"]').first().click();
      await expect(dialog(page)).toContainText(`Paytable - ${p.code}`);
      await expect(dialog(page).getByRole("button", { name: /OK$/ })).toBeVisible();
      await closeDialog(page); // chỉ Cancel, KHÔNG bấm OK
    });

    test("Edit Help Page mở hộp thoại Help Page của paytable, đóng bằng Cancel", async ({ page }) => {
      const p = ctx.view.payTableInfoList[0];
      await rows(page).first().locator('svg[data-icon="pen-to-square"]').nth(1).click();
      await expect(dialog(page)).toContainText(`Edit Help Page - ${p.code}`);
      await closeDialog(page); // chỉ Cancel, KHÔNG bấm OK
    });
  });

  // ===== 6. Bước 5: Review & Submit =====
  test.describe("Bước 5 - Review & Submit", () => {
    test.beforeEach(async ({ page }) => {
      await goToStep(page, 5);
    });

    test("Hiển thị tóm tắt game đúng dữ liệu, có nút Previous / Submit", async ({ page }) => {
      const g = ctx.view;
      const main = page.locator("main");
      await expect(main).toContainText("Game Details");
      await expect(main).toContainText("Bet Details");
      for (const text of [g.name, g.code, g.gameCategory.label, g.gameSubCategory.label]) {
        await expect(main, text).toContainText(text);
      }
      await expect(main).toContainText(g.status === 1 ? "Active" : "Inactive");
      await expect(prevBtn(page)).toBeVisible();
      await expect(submitBtn(page)).toBeVisible();
      await expect(nextBtn(page)).toHaveCount(0);
    });

    test("Bet Details liệt kê currency của game kèm Denom / Min Bet / Max Bet", async ({ page }) => {
      const first = ctx.view.currencyInfoList[0];
      const row = page.locator("main").getByText(first.code, { exact: true }).first();
      await expect(row).toBeVisible();
      await expect(page.locator("main")).toContainText(first.denomName);
    });

    test("Tên game sửa ở bước 1 được thể hiện ở bước Review (chưa lưu)", async ({ page }) => {
      await prevBtn(page).click();
      await prevBtn(page).click();
      await prevBtn(page).click();
      await prevBtn(page).click();
      expect(await activeStep(page)).toBe(1);
      await page.locator("#name").fill(`${ctx.view.name} - sửa thử`);
      await goToStep(page, 5);
      await expect(page.locator("main")).toContainText(`${ctx.view.name} - sửa thử`);
      // KHÔNG bấm Submit
    });

    test("Previous đi lần lượt ngược lại 4 -> 3 -> 2 -> 1", async ({ page }) => {
      for (const expected of [4, 3, 2, 1]) {
        await prevBtn(page).click();
        await expect.poll(() => activeStep(page)).toBe(expected);
      }
    });
  });

  // ===== 7. Thanh các bước =====
  test.describe("Thanh các bước", () => {
    test("Đi hết 4 lần Next qua đủ 5 bước, bước đã qua đánh dấu hoàn thành", async ({ page }) => {
      for (let step = 2; step <= 5; step++) {
        await nextBtn(page).click().catch(() => {});
        if (step < 5) await expect.poll(() => activeStep(page)).toBe(step);
      }
      expect(await activeStep(page)).toBe(5);
      const done = await page.locator(".ant-steps-item-finish").count();
      expect(done).toBe(4);
    });

    test("Bấm vào bước đã đi qua trên thanh các bước thì quay lại bước đó", async ({ page }) => {
      await goToStep(page, 3);
      await page.locator(".ant-steps-item").first().click();
      await expect.poll(() => activeStep(page)).toBe(1);
      await expect(page.locator("#name")).toHaveValue(ctx.view.name);
    });
  });
});
