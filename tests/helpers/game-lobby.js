// Lấy URL chơi game (kèm ?data=<phiên>) qua trang chủ GridPlay Playsite (LOBBY_URL), thay cho việc dán GAME_URL bằng tay.
//
// Cách trang chủ hoạt động (đã quan sát):
//  - Bấm 1 game khi CHƯA đăng nhập -> hộp thoại "Login GridPlay" (input name=username / name=password, nút Login, Play as Guest).
//  - Đăng nhập là Next.js Server Action (POST / dạng text/plain, không phải REST ổn định) -> dùng UI để đăng nhập.
//  - Sau đăng nhập trang gọi POST {LOBBY_URL}/api/game/openGame  {gameCode, language, currency}
//    -> {"status":"success","messageCode":"OPEN_GAME_SUCCESS","data":{"gameUrl":"https://dev-play.../<gameCode>/index.html?data=..."}}
//    (một số bản có thể trả data.url / endpoint /api/game/play -> hàm chấp nhận cả hai). Trang mở gameUrl ở tab mới.
//  - Đăng nhập xong có cookie `token` (JWT) -> gọi THẲNG openGame cho game khác bằng header Authorization: Bearer <token>
//    (không cần tìm ảnh game trên trang, vì ảnh các nhóm như "MK - MERIT KING" chỉ có alt sau khi cuộn / lazy-load).
//
// BẢO MẬT: mật khẩu và token chỉ sống trong bộ nhớ; mọi thông báo lỗi được che (mask) mật khẩu / token trước khi ném ra.
// Không ghi mật khẩu / token / URL game ra log hay annotation. Token game sống khoảng 20-30 phút nên KHÔNG cache giữa các lần chạy.
//
// Dùng:  const url = await getGameUrl({ browser, lobbyUrl, username, password, gameCode });

const DEFAULT_LOBBY_URL = "https://dev.royaledge.io";

function makeMask(secrets) {
  const list = secrets.filter((s) => typeof s === "string" && s.length >= 4);
  return (text) => list.reduce((t, s) => String(t).split(s).join("***"), String(text));
}

/**
 * @param {object} o
 * @param {import('@playwright/test').Browser} o.browser
 * @param {string} o.username
 * @param {string} o.password
 * @param {string} o.gameCode  mã game viết HOA như alt ảnh trên trang chủ (vd SL_33_FORTUNE_PIGCOOL, SL_33_FORTUNE_PIGCOOL_MK)
 * @param {string} [o.lobbyUrl]
 * @param {string} [o.language]
 * @param {string} [o.currency]
 * @returns {Promise<string>} URL game đầy đủ (có ?data=)
 */
async function getGameUrl({ browser, username, password, gameCode, lobbyUrl = DEFAULT_LOBBY_URL, language = "en", currency = "TKN" }) {
  if (!username || !password) throw new Error("Thiếu LOBBY_USERNAME / LOBBY_PASSWORD để đăng nhập trang chủ lấy URL game");
  if (!gameCode) throw new Error("Thiếu GAME_CODE");
  const secrets = [password];
  const mask = () => makeMask(secrets);
  const origin = new URL(lobbyUrl).origin;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  try {
    // Trang chủ mở game ở tab mới -> chặn tải game (tránh mở thêm phiên chơi không cần thiết) và đóng tab đó
    await ctx.route(/\/\/[^/]*-play\./, (route) => route.abort());
    const page = await ctx.newPage();
    ctx.on("page", (p) => {
      if (p !== page) p.close().catch(() => {});
    });

    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 45_000 });

    // Bấm đúng game cần lấy nếu thấy ảnh của nó, nếu không thì bấm game đầu tiên (chỉ để mở hộp thoại đăng nhập)
    const exact = page.locator(`img[alt="${gameCode}"]`).first();
    const anyCard = page.locator('img[alt^="SL_"]').first();
    await anyCard.waitFor({ state: "visible", timeout: 45_000 }).catch(() => {
      throw new Error(`Trang chủ ${origin} không hiện danh sách game (không thấy ảnh có alt bắt đầu bằng "SL_")`);
    });
    const card = (await exact.count()) > 0 ? exact : anyCard;

    const openRespP = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/game\/(openGame|play)\b/.test(r.url()), { timeout: 45_000 });
    openRespP.catch(() => {}); // tránh unhandled rejection nếu đăng nhập sai (xử lý ở dưới)
    // Next.js cần hydrate xong thì bấm mới có tác dụng -> chờ mạng yên rồi bấm, chưa thấy hộp thoại thì bấm lại (tối đa 5 lần)
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const user = page.locator('input[name="username"]');
    for (let i = 0; i < 5 && !(await user.isVisible().catch(() => false)); i++) {
      await card.click({ timeout: 10_000 }).catch(() => {});
      await user.waitFor({ state: "visible", timeout: 4_000 }).catch(() => {});
    }
    if (!(await user.isVisible().catch(() => false))) {
      throw new Error("Không hiện hộp thoại đăng nhập sau khi bấm game trên trang chủ (đã thử 5 lần)");
    }
    await user.fill(username);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Login", exact: true }).click();

    // Đăng nhập thành công <=> có cookie `token`. Không có sau 30 giây -> sai tài khoản / mật khẩu.
    let token;
    for (const deadline = Date.now() + 30_000; !(token = (await ctx.cookies()).find((c) => c.name === "token")) && Date.now() < deadline; ) {
      await page.waitForTimeout(500);
    }
    if (!token) {
      const stillOpen = await user.isVisible().catch(() => false);
      const toast = (await page.locator('[role="alert"], [role="status"], [data-sonner-toast], .Toastify__toast').allInnerTexts().catch(() => [])).join(" | ").slice(0, 200);
      throw new Error(
        `Đăng nhập trang chủ không thành công${stillOpen ? " (hộp thoại vẫn mở)" : ""}. Kiểm tra LOBBY_USERNAME / LOBBY_PASSWORD trong .env.${toast ? ` Thông báo: ${toast}` : ""}`,
      );
    }
    secrets.push(token.value);

    // Ưu tiên response openGame do chính trang gọi (chờ ngắn); không có / không đúng game -> gọi THẲNG API bằng Bearer token
    const uiResp = await Promise.race([openRespP.catch(() => null), new Promise((resolve) => setTimeout(() => resolve(null), 12_000))]);
    let body = uiResp ? await uiResp.json().catch(() => null) : null;
    let url = body && body.data && (body.data.gameUrl || body.data.url);
    let status = uiResp ? uiResp.status() : 0;
    const wanted = `/${gameCode.toLowerCase()}/`;
    if (!(status === 200 && body && body.status === "success" && url && String(url).toLowerCase().includes(wanted))) {
      const r = await ctx.request.post(`${origin}/api/game/openGame`, {
        data: { gameCode, language, currency },
        headers: { Authorization: `Bearer ${token.value}` },
      });
      status = r.status();
      body = await r.json().catch(() => null);
      url = body && body.data && (body.data.gameUrl || body.data.url);
    }
    if (status !== 200 || !body || body.status !== "success" || !url) {
      throw new Error(`openGame cho ${gameCode} thất bại: HTTP ${status}, status=${body && body.status}, messageCode=${body && body.messageCode}, message=${body && body.message} (không có data.gameUrl)`);
    }
    if (!/^https:\/\/.+\?data=.+/.test(url)) throw new Error("URL game trả về không có tham số ?data=");
    if (!String(url).toLowerCase().includes(wanted)) {
      throw new Error(`URL game trả về không thuộc ${gameCode} (path ${new URL(url).pathname.split("/")[1]})`);
    }
    return url;
  } catch (e) {
    // Ném lỗi MỚI (không kèm stack / call log gốc) để chắc chắn không lộ mật khẩu hoặc token
    throw new Error(mask()(e && e.message ? e.message : e).split("\n")[0].slice(0, 500));
  } finally {
    await ctx.close().catch(() => {});
  }
}

module.exports = { getGameUrl, DEFAULT_LOBBY_URL };
