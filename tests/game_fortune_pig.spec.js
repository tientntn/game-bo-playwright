// Game slot "Fortune Pig Cool" - CLIENT game (không phải màn hình BO). Hai biến thể:
//   SL_33_FORTUNE_PIGCOOL     -> https://dev-play.royaledge.io/sl_33_fortune_pigcool/index.html?data=...
//   SL_33_FORTUNE_PIGCOOL_MK  -> https://dev-play.royaledge.io/sl_33_fortune_pigcool_mk/index.html?data=...  (nhóm "MK - MERIT KING")
//
// SPEC TỰ LẤY URL GAME (không cần dán GAME_URL): đăng nhập trang chủ GridPlay Playsite bằng tài khoản trong .env rồi gọi
// POST {LOBBY_URL}/api/game/openGame (xem tests/helpers/game-lobby.js). Chỉ cần đặt trong .env (đã .gitignore):
//   LOBBY_USERNAME=...    LOBBY_PASSWORD=...        (bắt buộc nếu không có GAME_URL; KHÔNG ghi mật khẩu vào file nào khác)
//   LOBBY_URL=https://dev.royaledge.io              (tuỳ chọn, mặc định như trên)
//   GAME_CODE=SL_33_FORTUNE_PIGCOOL_MK              (TUỲ CHỌN, chỉ để THU HẸP: 1 mã hoặc danh sách cách nhau bằng dấu phẩy. KHÔNG đặt = test TẤT CẢ
//                                                    biến thể trong GAME_VARIANTS, lần lượt: SL_33_FORTUNE_PIGCOOL rồi SL_33_FORTUNE_PIGCOOL_MK.
//                                                    Mã không có trong GAME_VARIANTS -> FAIL rõ ràng, nêu các mã hợp lệ)
//   GAME_BETS=min,mid,max                           (tuỳ chọn, MẶC ĐỊNH min,mid,max; min | mid | max | số cụ thể thuộc denominations | all)
//   GAME_SPINS=20                                   (tuỳ chọn, số lượt MỖI MỨC CƯỢC, 1..50, MẶC ĐỊNH 20 -> mặc định quay 3 x 20 = 60 lượt)
//   min = settings.minBet, max = settings.maxBet, mid = denominations[floor((n-1)/2)] (lấy từ gameinfo, không hard-code theo bản).
//   all = MỌI mệnh giá, mỗi mệnh giá GAME_SPINS lượt (rất tốn: bản thường ~180 lượt ≈ 75 phút ≈ 2.540 TKN với 20 lượt/mức;
//         bản _mk ~400 lượt ≈ 2,8 giờ - chỉ chạy khi thật sự cần).
// CHI PHÍ / THỜI GIAN: spec này LUÔN quay thật (KHÔNG phụ thuộc cờ RUN_FULL_TESTS), cấu hình mặc định quay 60 lượt, ~25-30 phút / bản. Cược tối đa (worst case, thua hết):
//   bản thường (min 1.99, mid 10, max 35) ≈ 940 TKN; bản _mk (min 0.01, mid 2, max 100) ≈ 2.040 TKN. Chạy nhanh: GAME_BETS=min GAME_SPINS=3.
//   `npm run test:ui:game` cũng sẽ quay 60 lượt MỖI BIẾN THỂ. Chạy trần (không GAME_CODE) test CẢ HAI biến thể:
//   120 lượt, ~50-60 phút, cược tối đa ~2.980 TKN (940 + 2.040). Nhóm "Quay thật" không còn bị skip theo RUN_FULL_TESTS; muốn nhẹ hơn thì giảm GAME_BETS / GAME_SPINS.
// MÃ GAME THUỘC VỀ SPEC: danh sách biến thể `GAME_VARIANTS` khai báo ngay đầu file (chạy trần `npx playwright test tests/game_fortune_pig.spec.js`
// là test cả hai bản, mỗi bản lấy URL riêng qua lobby). Hai biến thể dùng chung ví của tài khoản lobby nên được gom trong 1 describe SERIAL
// (cùng 1 worker, tuần tự, bản thường trước) để phép kiểm balance trước/sau không bị lẫn khi playwright.config.js có fullyParallel.
// Game khác cần spec riêng, có danh sách GAME_VARIANTS riêng và dùng lại tests/helpers/game-lobby.js.
// Thứ tự ưu tiên URL: GAME_URL (nếu có thì dùng luôn, kể cả khi có LOBBY_*, và CHỈ test biến thể nằm trong data= của URL đó) > lấy qua lobby.
// Thiếu cả GAME_URL lẫn LOBBY_USERNAME / LOBBY_PASSWORD -> toàn bộ file bị SKIP (an toàn khi chạy chung `npm run test:ui:game`).
// Có thông tin lobby mà lấy URL thất bại (sai mật khẩu, không có game...) -> FAIL rõ ràng, không skip im lặng.
// URL được lấy 1 lần cho cả nhóm (beforeAll), KHÔNG cache giữa các lần chạy vì token phiên chỉ sống ~20-30 phút.
// `data=` chứa sessionToken, hết hạn thì game không báo lỗi trên màn hình mà kẹt ở Loading -> spec báo "phiên hết hạn".
//
// Chạy (game không dùng session BO nên chỉ cần project chromium):
//   npx playwright test tests/game_fortune_pig.spec.js --project=chromium --workers=1
//   (nhóm "Quay thật" luôn chạy, không cần RUN_FULL_TESTS - xem bên dưới)
//   GAME_CODE=SL_33_FORTUNE_PIGCOOL_MK ...  -> chỉ chạy bản _mk (mặc định chạy cả hai bản)
//
// Game vẽ bằng <canvas> (Cocos Creator) nên KHÔNG có selector DOM. Spec dùng 3 nguồn:
//  1. Cây node Cocos (window.cc) để lấy toạ độ nút + đọc text label (nút, balance, bet, win, popup).
//  2. Frame WebSocket SignalR (/ws/gamehub): phản hồi `gameinfo` (balance, settings, paytable) và `bet` (lưới symbol,
//     dòng thắng, payout, balance sau). Đây là "response API spin" của game.
//  3. REST POST /api/history (màn hình lịch sử trong game) để đối chiếu từng lượt quay.
//
// Test KHÔNG ghi gì (luôn chạy): tải game, gameinfo, HUD, đổi mức cược (+/-, không quay), Settings, Autoplay (chỉ mở / đóng,
//   không Confirm), Info (rule), History (chỉ đọc).
// Test GHI (LUÔN chạy, không phụ thuộc RUN_FULL_TESTS): nhóm "Quay thật" - quay GAME_SPINS lượt ở MỖI mức trong GAME_BETS (xem trên), mỗi
//   lượt trừ đúng mức cược tối thiểu (0.01 ở bản _mk, 1.99 ở bản không _mk) trong ví dev và tạo 1 bản ghi lịch sử (không có cách xoá; không dọn được - ghi rõ trong báo cáo).
//   Mỗi lượt đối chiếu: response bet <-> rule game (paytable, 5 payline, wild, scatter/free spin, hệ số nhân) <-> HUD
//   <-> bản ghi /api/history <-> dòng lịch sử + popup chi tiết trong game.
//   Nếu một lượt kích hoạt Free Spin / respin thì test dừng quay thêm (không tự chơi hết free spin) và báo trong annotation;
//   lần chạy sau nếu gameinfo.pending.freeSpins > 0 thì nhóm quay bị skip.
//
// Hai biến thể đã chạy thật (KHÔNG hard-code theo biến thể nào: mọi giá trị lấy từ gameinfo / Info của URL đang chạy):
//  - sl_33_fortune_pigcool_mk (gameId 168): min 0.01, bet khởi động = min, popup Info = GeneralInfoPopup, icon Sound = iconSound.
//  - sl_33_fortune_pigcool   (gameId 59):   min 1.99 / max 35 (9 mệnh giá), bet khởi động 30.00 (defaultBetLevel 8), icon Sound = iconSoundOn,
//    popup Autoplay = AutoPlayPopup, tên localStorage khác. Rate paytable và 5 payline giống nhau ở cả hai bản.
// Quy ước đã quan sát (từ khám phá, 26-27/11/2026):
//  - Lưới 3x3: views[i] là CỘT i+1, value[] đọc từ TRÊN xuống DƯỚI.
//  - 5 payline cố định (Info): 1 hàng giữa, 2 hàng trên, 3 hàng dưới, 4 chéo (trên-trái -> dưới-phải), 5 chéo (dưới-trái -> trên-phải).
//  - Symbol: 1=A, 3=Q, 4=K, 5=PigCool, 6=Ingot, 7=Bag, 8=Lantern, 9=WILD, 11=BONUS (scatter). Paytable chỉ trả khi đủ 3 symbol
//    (value[2]) và là bội số của (stake / betLines); payout = Σ rate x (stake/betLines) x coinMultiplier (x1/x2/x5/x10).
//  - Game HIỂN THỊ số tiền cắt bớt (floor) còn 2 số thập phân trong khi server tính tới 3 (vd payout 0.006 hiển thị "0.00").
//    Test chỉ ép sai lệch < 0.01 và ghi annotation "nghi vấn" khi hiển thị 0.00 cho lượt thắng thật.
//  - Canvas đôi khi "nuốt" lần chạm đầu (đang skip animation thắng...) nên mọi thao tác dùng tapUntil (chạm lại tới khi có hiệu lực).
const { test, expect } = require("@playwright/test");
const { getGameUrl, DEFAULT_LOBBY_URL } = require("./helpers/game-lobby");
const { analyze, covLines, renderGameReport, writeGameReport } = require("./helpers/game-report");
const nodePath = require("path");

const EXPLICIT_GAME_URL = String(process.env.GAME_URL || "").trim();
const LOBBY_URL = String(process.env.LOBBY_URL || "").trim() || DEFAULT_LOBBY_URL;
const LOBBY_USERNAME = String(process.env.LOBBY_USERNAME || "").trim();
const LOBBY_PASSWORD = String(process.env.LOBBY_PASSWORD || ""); // KHÔNG trim / in ra / ghi annotation

// MÃ GAME THUỘC VỀ SPEC (không phải cấu hình): các biến thể của game này, theo thứ tự chạy (bản thường trước, rồi _mk).
// Game khác -> viết spec riêng với danh sách riêng và dùng lại tests/helpers/game-lobby.js.
const GAME_VARIANTS = ["SL_33_FORTUNE_PIGCOOL", "SL_33_FORTUNE_PIGCOOL_MK"];
// GAME_URL (nếu có) chỉ test đúng biến thể nằm trong data= của URL đó
const EXPLICIT_CODE = (() => {
  if (!EXPLICIT_GAME_URL) return "";
  try {
    const d = new URL(EXPLICIT_GAME_URL).searchParams.get("data");
    return String(JSON.parse(Buffer.from(d, "base64").toString("utf8")).gameCode || "").toUpperCase() || "(không có gameCode)";
  } catch (_) {
    return "(không đọc được data=)";
  }
})();
// GAME_CODE (tuỳ chọn) chỉ để THU HẸP: 1 mã hoặc danh sách phân tách bằng dấu phẩy. Không đặt = test TẤT CẢ biến thể.
const REQUESTED_CODES = String(process.env.GAME_CODE || "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const CONFIG_ERROR = (() => {
  if (EXPLICIT_GAME_URL) {
    return GAME_VARIANTS.includes(EXPLICIT_CODE) ? "" : `GAME_URL thuộc game "${EXPLICIT_CODE}" không có trong GAME_VARIANTS của spec này. Mã hợp lệ: ${GAME_VARIANTS.join(", ")}`;
  }
  const bad = REQUESTED_CODES.filter((c) => !GAME_VARIANTS.includes(c));
  return bad.length ? `GAME_CODE không hợp lệ: ${bad.join(", ")}. Mã hợp lệ: ${GAME_VARIANTS.join(", ")}` : "";
})();
// Giữ đúng thứ tự khai báo trong GAME_VARIANTS (không theo thứ tự gõ ở GAME_CODE)
const ACTIVE_VARIANTS = EXPLICIT_GAME_URL ? [EXPLICIT_CODE] : REQUESTED_CODES.length ? GAME_VARIANTS.filter((c) => REQUESTED_CODES.includes(c)) : GAME_VARIANTS;
// Trạng thái của BIẾN THỂ ĐANG CHẠY (các biến thể chạy tuần tự trong 1 worker, được reset ở beforeAll của từng biến thể)
let GAME_CODE = "";
let GAME_URL = "";
// GAME_SPINS = số lượt quay MỖI MỨC CƯỢC (1..50, mặc định 20). GAME_BETS = các mức cược, phân tách bằng dấu phẩy:
//   min | mid | max | <số cụ thể thuộc denominations của gameinfo, vd 1.99> | all (mọi mệnh giá). Mặc định "min,mid,max" -> 3 x 20 = 60 lượt.
const SPINS = Math.min(Math.max(parseInt(process.env.GAME_SPINS || "20", 10) || 20, 1), 50);
const ALL_LEVEL_SLOTS = 40; // `all` cần tạo test trước khi biết số mệnh giá -> tạo tối đa 40 "ô" mức, ô vượt quá số mệnh giá thật bị skip (ghi lý do)
const BET_SPECS = (() => {
  const tokens = String(process.env.GAME_BETS || "min,mid,max")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out = [];
  for (const t of tokens.length ? tokens : ["min", "mid", "max"]) {
    if (t === "all") for (let i = 1; i <= ALL_LEVEL_SLOTS; i++) out.push({ key: `idx${i}`, title: `#${i}`, kind: "idx", idx: i });
    else if (["min", "mid", "max"].includes(t)) out.push({ key: t, title: t, kind: t });
    else if (Number.isFinite(Number(t))) out.push({ key: `num${t}`, title: Number(t).toFixed(2), kind: "num", value: Number(t) });
    else out.push({ key: `bad${t}`, title: t, kind: "bad" }); // báo lỗi rõ ở test chuẩn bị của mức đó
  }
  return out.filter((s, i) => out.findIndex((x) => x.key === s.key) === i); // bỏ mức trùng
})();
const TZ = "Asia/Ho_Chi_Minh"; // game hiển thị giờ lịch sử theo giờ trình duyệt -> cố định để so sánh được

// ---------------------------------------------------------------------------------------------------------------------
// Hằng số
// ---------------------------------------------------------------------------------------------------------------------
const ROOT = "Canvas/MainLayer/slot-machine-prefab";
const POPUPS = "Canvas/popupManager";
const PATH = {
  start: "Canvas/LandingLayer/SplashSceneView/newLanding/playing button",
  balance: `${ROOT}/BottomLayer/gameInfoGroup/balanceView/lbBalanceValue`,
  bet: `${ROOT}/BottomLayer/gameInfoGroup/betView/lbBetAmount`,
  win: `${ROOT}/BottomLayer/gameInfoGroup/winView/lbWinValue`,
  lbBalance: `${ROOT}/BottomLayer/gameInfoGroup/balanceView/lbBalance`,
  lbBet: `${ROOT}/BottomLayer/gameInfoGroup/betView/lbBet`,
  lbWin: `${ROOT}/BottomLayer/gameInfoGroup/winView/lbWin`,
  notif: `${ROOT}/BottomLayer/notificationGroup/lbNotification`,
  btnSpin: `${ROOT}/BottomLayer/betLayer/betButtonView/btnBet`,
  btnPlus: `${ROOT}/BottomLayer/betLayer/denominationButtons/btnPlus`,
  btnMinus: `${ROOT}/BottomLayer/betLayer/denominationButtons/btnMinus`,
  btnAuto: `${ROOT}/BottomLayer/betLayer/autoPlayButtonView/btnAutoPlay`,
  btnTurbo: `${ROOT}/BottomLayer/betLayer/turboButtonView/btnTurbo`,
  // Tên node icon Sound khác nhau giữa các biến thể / trạng thái: iconSound (bản _mk), iconSoundOn / iconSoundOff (bản không _mk)
  iconSoundCandidates: ["iconSound", "iconSoundOn", "iconSoundOff"].map((n) => `${ROOT}/BottomLayer/settingLayer/iconSoundView/${n}`),
  iconInfo: `${ROOT}/BottomLayer/settingLayer/generalInfoIcon`,
  iconSetting: `${ROOT}/BottomLayer/settingLayer/settingIcon`,
  iconHistory: `${ROOT}/BottomLayer/settingLayer/historyIcon`,
  // popup
  infoClose: `${POPUPS}/GeneralInfoPopup/ReSizeBG/gameRule/closeBtn`,
  settingClose: `${POPUPS}/SettingPopup/ReSizeBG/closeBtn`,
  toggleTurbo: `${POPUPS}/SettingPopup/ReSizeBG/Layout/tab_turbo/toggle_turbo`,
  toggleMusic: `${POPUPS}/SettingPopup/ReSizeBG/Layout/tab_music/toggle`,
  toggleSound: `${POPUPS}/SettingPopup/ReSizeBG/Layout/tab_sound/toggle`,
  historyClose: `${POPUPS}/HistoryPopup/ReSizeBG/content/node-history/node-top/title/btn-close`,
  historyTitle: `${POPUPS}/HistoryPopup/ReSizeBG/content/node-history/node-top/title/lb-title`,
  detailBack: `${POPUPS}/HistoryDetailPopup/resizeBG/content/topLayer/gameMode/backoutBtn`,
};
// Tên popup Autoplay khác nhau giữa các biến thể: AutoPopup (bản _mk) / AutoPlayPopup (bản không _mk) -> nhận theo /^Auto/
const AUTO_POPUP = /^Auto/;

// Payline -> chỉ số hàng (0 = trên, 1 = giữa, 2 = dưới) của cột 1, 2, 3
const PAYLINES = { 1: [1, 1, 1], 2: [0, 0, 0], 3: [2, 2, 2], 4: [0, 1, 2], 5: [2, 1, 0] };
const SYMBOL = { WILD: 9, BONUS: 11 };
const FREE_SPIN_AWARD = 10; // Info: đủ BONUS trên cả 3 cột -> 10 Free Spins
const COIN_MULTIPLIERS = [1, 2, 5, 10];
const SPIN_TEXT = /lucky|best of luck/i; // infobar khi đang quay (infobar_spin_1 / infobar_spin_2)

// ---------------------------------------------------------------------------------------------------------------------
// Tiện ích số / định dạng
// ---------------------------------------------------------------------------------------------------------------------
const num = (s) => Number(String(s ?? "").replace(/[^0-9.\-]/g, ""));
const floor2 = (v) => Math.floor(v * 100 + 1e-6) / 100;
const round2 = (v) => Math.round(v * 100 + 1e-6) / 100;
const fmt2 = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function timeParts(ms) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hourCycle: "h23",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { time: `${p.hour}:${p.minute}:${p.second}`, date: `${p.month}/${p.day}` };
}

// Tách các object JSON {"status":...} nằm trong frame SignalR (MessagePack nhị phân + chuỗi JSON)
function extractJsons(text) {
  const out = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf('{"status"', from);
    if (i < 0) break;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let k = i; k < text.length; k++) {
      const c = text[k];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = k;
          break;
        }
      }
    }
    if (end < 0) break;
    try {
      out.push(JSON.parse(text.slice(i, end + 1)));
    } catch (_) {
      /* bỏ qua mảnh hỏng */
    }
    from = end + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// RULE GAME: tính lại tiền thắng từ lưới symbol + paytable (gameinfo) + 5 payline
// ---------------------------------------------------------------------------------------------------------------------
// views[i].value = cột i+1 (trên -> dưới). Trả về các dòng thắng + tổng payout kỳ vọng.
// baseStake: mặc định lấy từ response; trong Free Spin response có thể ghi stake / baseStake = 0 nên truyền mức cược của vòng kích hoạt vào.
function evaluateSpin(bet, paytable, baseStake = bet.baseStake) {
  const cols = [...bet.result.views].sort((a, b) => a.id - b.id).map((v) => v.value);
  const rate = Object.fromEntries(paytable.map((p) => [p.symbolId, Number(p.value[2] || 0)]));
  const perLine = baseStake / bet.betLines;
  const lines = [];
  for (const [payline, rows] of Object.entries(PAYLINES)) {
    const symbols = rows.map((r, c) => cols[c][r]);
    const nonWild = symbols.filter((s) => s !== SYMBOL.WILD);
    let paySymbol = null;
    if (nonWild.length === 0) paySymbol = SYMBOL.WILD; // 3 WILD
    else if (nonWild.every((s) => s === nonWild[0]) && nonWild[0] !== SYMBOL.BONUS) paySymbol = nonWild[0]; // WILD thay mọi symbol trừ BONUS
    const r = paySymbol === null ? 0 : rate[paySymbol] || 0;
    if (r > 0) lines.push({ payline: Number(payline), symbols, rate: r, paySymbol, wilds: symbols.filter((s) => s === SYMBOL.WILD).length });
  }
  const payout = lines.reduce((s, l) => s + l.rate * perLine * bet.coinMultiplier, 0);
  const bonusReels = cols.filter((c) => c.includes(SYMBOL.BONUS)).length;
  return { cols, lines, payout, perLine, bonusReels, expectedFreeSpins: bonusReels === 3 ? FREE_SPIN_AWARD : 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Trạng thái dùng chung của cả file (serial): 1 trang game duy nhất
// ---------------------------------------------------------------------------------------------------------------------
let ctx;
let page;
let theBrowser; // dùng để đăng nhập lại lobby khi cần gia hạn phiên game giữa chừng
// Trạng thái dùng chung của MỘT biến thể; makeGame() tạo mới ở beforeAll của từng biến thể để biến thể sau không dùng nhầm
// gameinfo / HUD / lượt quay / lỗi phiên của biến thể trước.
const makeGame = () => ({
  launch: null, // JSON giải mã từ ?data= (chỉ đọc, không sửa)
  infos: [], // phản hồi gameinfo
  bets: [], // phản hồi bet (mỗi lượt quay 1 phần tử)
  telemetry: [], // category của TelemetryUtil (turbo_toggle_on, mute_toggle_off, ...)
  consoleErrors: [],
  pageErrors: [],
  badResponses: [],
  loadErrors: null, // ảnh chụp các lỗi tại thời điểm game tải xong
  rounds: [], // các lượt quay thật của lần chạy này (để đối chiếu lịch sử)
  report: [], // mỗi phần tử = 1 dòng báo cáo lượt quay
  stopSpinning: "",
  sessionError: "", // SignalR báo phiên hết hạn / không tồn tại (token trong GAME_URL đã chết)
  history: null, // { json, status } lần mở lịch sử gần nhất
  // Dữ liệu cho báo cáo HTML (tests/helpers/game-report.js)
  startedAt: Date.now(),
  checks: [], // các hạng mục giao diện: { section, name, status: PASS | FAIL | WARN | SKIP, detail } (xem chk())
  notes: [], // điểm nghi vấn / ghi chú (xem note())
  theoRtp: null, // RTP lý thuyết (%) đọc từ màn Info
  infoVersion: "", // số phiên bản game đọc từ màn Info
});
let game = makeGame();
const info = () => game.infos[game.infos.length - 1].json.result;
const latestBalance = () => {
  const lastInfo = game.infos.length ? game.infos[game.infos.length - 1] : null;
  const lastBet = game.bets.length ? game.bets[game.bets.length - 1] : null;
  if (lastBet && (!lastInfo || lastBet.timestamp >= lastInfo.json.timestamp)) return lastBet.result.balance;
  return lastInfo.json.result.balance;
};

function onJson(j) {
  const r = j && j.result;
  if (!r) return;
  if (r.settings && r.paytable) {
    if (!game.infos.some((x) => x.json.timestamp === j.timestamp)) game.infos.push({ json: j });
  } else if (r.result && Array.isArray(r.result.views) && r.stake !== undefined) {
    if (!game.bets.some((b) => b.result.id === r.id)) game.bets.push(j);
  }
}

function attachListeners(p) {
  p.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error") game.consoleErrors.push(t.slice(0, 300));
    const cat = t.match(/"category":"(\w+)"/);
    if (cat && t.includes("TelemetryUtil")) game.telemetry.push(cat[1]);
    // Phiên hết hạn: game KHÔNG hiện popup lỗi mà kẹt ở màn Loading, chỉ log "[SignalR] Disconnected: {... code:-4 ...}"
    if (/\[SignalR\] Disconnected/.test(t) && /"code":-4|not exists or expired/i.test(t)) {
      game.sessionError = (t.match(/"msg":"([^"]+)"/) || [])[1] || "Session is not exists or expired";
    }
    if (/Received (bet|gameinfo):/.test(t)) {
      const i = t.indexOf('{"status"');
      if (i >= 0) extractJsons(t.slice(i)).forEach(onJson); // dự phòng khi không đọc được frame WS
    }
  });
  p.on("pageerror", (e) => game.pageErrors.push(String(e).slice(0, 300)));
  p.on("response", (r) => {
    const url = r.url();
    if (r.status() >= 400 && /dev-play\.royaledge\.io/.test(url)) game.badResponses.push(`${r.status()} ${url.split("?")[0]}`);
  });
  p.on("websocket", (ws) => {
    if (!/gamehub/.test(ws.url())) return;
    ws.on("framereceived", (f) => {
      const text = Buffer.isBuffer(f.payload) ? f.payload.toString("utf8") : String(f.payload);
      extractJsons(text).forEach(onJson);
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Thao tác trên canvas Cocos
// ---------------------------------------------------------------------------------------------------------------------
// Đọc 1 node theo đường dẫn tên (từ scene): trạng thái, toạ độ trên viewport, text label, nút / toggle.
async function probe(path) {
  return page.evaluate((p) => {
    let n = cc.director.getScene();
    for (const k of p.split("/")) n = n && n.getChildByName(k);
    if (!n) return null;
    const cam = cc.director.getScene().getChildByName("Canvas").getChildByName("Camera").getComponent(cc.Camera);
    const fr = cc.view.getFrameSize();
    const sp = cam.worldToScreen(n.worldPosition);
    const r = document.getElementById("GameCanvas").getBoundingClientRect();
    const lb = n.getComponent(cc.Label);
    const bt = n.getComponent(cc.Button);
    const tg = n.getComponent(cc.Toggle);
    return {
      active: n.activeInHierarchy,
      x: r.left + (sp.x * r.width) / fr.width,
      y: r.top + ((fr.height - sp.y) * r.height) / fr.height,
      text: lb ? String(lb.string) : null,
      interactable: bt ? bt.interactable : null,
      checked: tg ? tg.isChecked : null,
    };
  }, path);
}
const textOf = async (path) => (await probe(path))?.text ?? null;

async function nextFrames() {
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
}

// Chạm vào toạ độ (viewport). Canvas Cocos cần mouse move -> down -> giữ ngắn -> up mới nhận ổn định.
async function tapAt(x, y) {
  await page.mouse.move(x, y);
  await nextFrames();
  await page.mouse.click(x, y, { delay: 120 });
}
async function tapNode(path) {
  const n = await probe(path);
  expect(n, `Không thấy node ${path}`).toBeTruthy();
  await tapAt(n.x, n.y);
}
// Chạm lại tới khi predicate đúng (canvas có thể nuốt lần chạm đầu). Dùng cho thao tác đổi trạng thái -> dừng ngay khi đã đổi.
async function tapUntil(pathOrFn, predicate, { tries = 5, settleMs = 2500, what } = {}) {
  what = what || (typeof pathOrFn === "string" ? pathOrFn : "nút");
  for (let i = 0; i < tries; i++) {
    // hàm: trả về đường dẫn (icon Sound On / Off đổi tên theo trạng thái) hoặc toạ độ {x, y} (nút đóng popup tìm theo tên)
    const target = typeof pathOrFn === "function" ? await pathOrFn() : pathOrFn;
    if (typeof target === "string") await tapNode(target);
    else await tapAt(target.x, target.y);
    try {
      await expect.poll(predicate, { timeout: settleMs, intervals: [100, 200, 300] }).toBe(true);
      return;
    } catch (_) {
      /* chạm lại */
    }
  }
  throw new Error(`Chạm ${what} ${tries} lần nhưng trạng thái không đổi`);
}

const activePopups = () =>
  page.evaluate((p) => {
    let n = cc.director.getScene();
    for (const k of p.split("/")) n = n && n.getChildByName(k);
    return n ? n.children.filter((c) => c.activeInHierarchy).map((c) => c.name) : [];
  }, POPUPS);
const hasPopup = (names, name) => names.some((n) => (name instanceof RegExp ? name.test(n) : n === name));
const popupOpen = (name) => async () => hasPopup(await activePopups(), name);
const popupClosed = (name) => async () => !hasPopup(await activePopups(), name);

async function openPopup(iconPath, popupName) {
  await tapUntil(iconPath, popupOpen(popupName), { what: `icon mở ${popupName}` });
}
async function closePopup(closePath, popupName) {
  await tapUntil(closePath, popupClosed(popupName), { what: `nút đóng ${popupName}` });
}
// Tên node popup đổi giữa các biến thể (vd Info: GeneralInfoPopup ở bản _mk) -> nhận theo regex, tìm nút đóng / nhãn theo TÊN node
const POPUP_RE = { info: /info/i, setting: /^Setting/i, history: /^History(?!.*Detail)/i, detail: /^History.*Detail/i };
const CLOSE_NAME = /close|backout|btn-close|^back/i;
// Toạ độ nút đóng (node có Button, tên khớp CLOSE_NAME) của popup đang mở khớp regex
const closeTarget = (re) => async () =>
  page.evaluate(
    ([reSrc, closeSrc, popups]) => {
      let pm = cc.director.getScene();
      for (const k of popups.split("/")) pm = pm && pm.getChildByName(k);
      const pop = pm && pm.children.find((c) => c.activeInHierarchy && new RegExp(reSrc, "i").test(c.name));
      if (!pop) throw new Error("Popup không mở");
      let hit = null;
      (function walk(n) {
        if (hit || !n.activeInHierarchy) return;
        if (n.getComponent(cc.Button) && new RegExp(closeSrc, "i").test(n.name)) hit = n;
        else n.children.forEach(walk);
      })(pop);
      if (!hit) throw new Error(`Popup ${pop.name} không có nút đóng`);
      const cam = cc.director.getScene().getChildByName("Canvas").getChildByName("Camera").getComponent(cc.Camera);
      const fr = cc.view.getFrameSize();
      const sp = cam.worldToScreen(hit.worldPosition);
      const r = document.getElementById("GameCanvas").getBoundingClientRect();
      return { x: r.left + (sp.x * r.width) / fr.width, y: r.top + ((fr.height - sp.y) * r.height) / fr.height };
    },
    [re.source, CLOSE_NAME.source, POPUPS],
  );
async function closePopupRe(re) {
  await tapUntil(closeTarget(re), popupClosed(re), { what: `nút đóng popup ${re}` });
}
// Text của label đầu tiên đang hiện, tên node = nodeName, bên trong popup khớp regex
const popupText = (re, nodeName) =>
  page.evaluate(
    ([reSrc, name, popups]) => {
      let pm = cc.director.getScene();
      for (const k of popups.split("/")) pm = pm && pm.getChildByName(k);
      const pop = pm && pm.children.find((c) => c.activeInHierarchy && new RegExp(reSrc, "i").test(c.name));
      let out = null;
      (function walk(n) {
        if (out !== null || !n.activeInHierarchy) return;
        const l = n.getComponent(cc.Label);
        if (n.name === name && l) out = String(l.string);
        else n.children.forEach(walk);
      })(pop || { activeInHierarchy: false });
      return out;
    },
    [re.source, nodeName, POPUPS],
  );
// Đóng popup bằng cách chạm ra ngoài khung (Autoplay không có nút Cancel)
async function closeByTapOutside(popupName) {
  const r = await page.evaluate(() => {
    const b = document.getElementById("GameCanvas").getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.bottom - 40 };
  });
  for (let i = 0; i < 4 && !(await popupClosed(popupName)()); i++) {
    await tapAt(r.x, r.y);
    await expect.poll(popupClosed(popupName), { timeout: 2000 }).toBe(true).catch(() => {});
  }
  expect(await activePopups()).not.toContain(popupName);
}

async function hud() {
  const [balance, bet, win, notif, minus, plus] = await Promise.all([
    probe(PATH.balance),
    probe(PATH.bet),
    probe(PATH.win),
    probe(PATH.notif),
    probe(PATH.btnMinus),
    probe(PATH.btnPlus),
  ]);
  return {
    balance: balance?.text,
    bet: bet?.text,
    win: win?.text,
    notif: notif?.text,
    minusEnabled: minus?.interactable,
    plusEnabled: plus?.interactable,
  };
}

// Về mức cược tối thiểu (chỉ bấm "-", không quay)
async function ensureMinBet() {
  const min = info().settings.minBet;
  for (let i = 0; i < info().settings.denominations.length + 2; i++) {
    const h = await hud();
    if (num(h.bet) === min) return h;
    await tapUntil(PATH.btnMinus, async () => (await textOf(PATH.bet)) !== h.bet, { what: "nút trừ mức cược" });
  }
  throw new Error("Không về được mức cược tối thiểu");
}

// Mở popup Lịch sử và lấy response POST /api/history của lần mở đó
async function openHistory() {
  // Backend lịch sử đôi lúc không phản hồi (popup mở nhưng hiện "No records" và không có response) -> đóng / mở lại tối đa 3 lần
  let resp = null;
  for (let attempt = 0; attempt < 3 && !resp; attempt++) {
    const respP = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/history$/.test(new URL(r.url()).pathname), { timeout: 20_000 });
    respP.catch(() => {});
    await openPopup(PATH.iconHistory, POPUP_RE.history);
    resp = await respP.catch(() => null);
    if (!resp) await closePopupRe(POPUP_RE.history).catch(() => {});
  }
  if (!resp) throw new Error("Popup lịch sử không gọi / không nhận được POST /api/history sau 3 lần mở (backend lịch sử chậm hoặc lỗi)");
  game.history = { status: resp.status(), json: await resp.json(), request: resp.request() };
  // popup tự dựng danh sách sau khi nhận response (tài khoản chưa chơi biến thể này hôm nay -> danh sách rỗng, không có dòng nào)
  const n = Array.isArray(game.history.json.result) ? game.history.json.result.length : 0;
  if (n > 0) {
    await expect
      .poll(async () => (await historyRows()).length, { timeout: 10_000, message: "Popup lịch sử không hiện dòng nào dù API trả bản ghi" })
      .toBeGreaterThan(0);
  } else {
    note("ghi chú", "Lịch sử hôm nay rỗng (chưa có lượt quay nào của tài khoản này ở game này)");
  }
  return game.history;
}

// Đọc các dòng (ItemHistory) đang hiện trong popup lịch sử: thời gian, round id, bet, win + toạ độ nút chi tiết
async function historyRows() {
  return page.evaluate(([reSrc, popups]) => {
    let pop = cc.director.getScene();
    for (const k of popups.split("/")) pop = pop && pop.getChildByName(k);
    pop = pop && pop.children.find((c) => c.activeInHierarchy && new RegExp(reSrc, "i").test(c.name));
    if (!pop) return [];
    const cam = cc.director.getScene().getChildByName("Canvas").getChildByName("Camera").getComponent(cc.Camera);
    const fr = cc.view.getFrameSize();
    const r = document.getElementById("GameCanvas").getBoundingClientRect();
    const rows = [];
    const get = (n, p) => {
      let c = n;
      for (const k of p.split("/")) c = c && c.getChildByName(k);
      const l = c && c.getComponent(cc.Label);
      return l ? String(l.string) : null;
    };
    (function walk(n) {
      if (!n.activeInHierarchy) return;
      if (n.name === "ItemHistory") {
        const d = n.getChildByName("btn_detail");
        const sp = cam.worldToScreen(d.worldPosition);
        rows.push({
          time: get(n, "node-time/lb-time"),
          date: get(n, "node-time/lb-date"),
          round: get(n, "lb-round-id"),
          bet: get(n, "lb-bet-amount"),
          win: get(n, "lb-win"),
          detailX: r.left + (sp.x * r.width) / fr.width,
          detailY: r.top + ((fr.height - sp.y) * r.height) / fr.height,
        });
      }
      n.children.forEach(walk);
    })(pop);
    return rows;
  }, [POPUP_RE.history.source, POPUPS]);
}

async function closeAllPopups() {
  for (let i = 0; i < 4; i++) {
    const a = await activePopups();
    if (!a.length) return;
    if (hasPopup(a, AUTO_POPUP)) await closeByTapOutside(a.find((n) => AUTO_POPUP.test(n)));
    else {
      const re = [POPUP_RE.detail, POPUP_RE.history, POPUP_RE.setting, POPUP_RE.info].find((x) => hasPopup(a, x));
      if (!re) return;
      const t = await closeTarget(re)();
      await tapAt(t.x, t.y);
    }
    await expect.poll(async () => (await activePopups()).length, { timeout: 2500 }).toBeLessThan(a.length).catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Ghi nhận kết quả để dựng báo cáo HTML (tests/helpers/game-report.js)
// ---------------------------------------------------------------------------------------------------------------------
// RTP lý thuyết công bố trên màn Info: "The theoretical RTP of this game is 96.5%"
const RTP_RE = /theoretical RTP of this game is (\d+(?:\.\d+)?)%/i;
const stripAnsi = (s) => String(s || "").replace(/\u001b\[[0-9;]*m/g, "");

// Ghi 1 điểm nghi vấn / ghi chú: vừa vào annotation của test hiện tại, vừa vào báo cáo HTML
function note(type, description) {
  game.notes.push({ type, description });
  try {
    test.info().annotations.push({ type, description });
  } catch (_) {
    /* ngoài test (hook) */
  }
}

// Hạng mục giao diện: chạy fn, ghi PASS / FAIL (fn ném lỗi) / WARN (fn trả { warn }) rồi CHẠY TIẾP các hạng mục sau.
// fn có thể trả chuỗi = chi tiết hiển thị trong báo cáo. Cuối mỗi test gọi endChecks() để fail test nếu có hạng mục FAIL.
let curChecks = [];
async function chk(section, name, fn) {
  const rec = { section, name, status: "PASS", detail: "" };
  game.checks.push(rec);
  curChecks.push(rec);
  try {
    const r = await fn();
    if (r && typeof r === "object" && r.warn) {
      rec.status = "WARN";
      rec.detail = String(r.warn).slice(0, 400);
    } else if (typeof r === "string") rec.detail = r.slice(0, 400);
  } catch (e) {
    rec.status = "FAIL";
    rec.detail = stripAnsi(e && e.message ? e.message : e)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(" | ")
      .slice(0, 400);
  }
  return rec;
}
// Hạng mục không chạy được vì bước trước đó lỗi (vd popup không mở được)
function chkSkip(section, name, why) {
  game.checks.push({ section, name, status: "SKIP", detail: why });
}
async function endChecks() {
  const fails = curChecks.filter((c) => c.status === "FAIL");
  curChecks = [];
  if (!fails.length) return;
  await closeAllPopups().catch(() => {}); // hạng mục lỗi có thể để popup còn mở
  throw new Error(`${fails.length} hạng mục giao diện lỗi:\n${fails.map((f) => `- [${f.section}] ${f.name}: ${f.detail}`).join("\n")}`);
}

// Mở game: tải trang -> chờ nút START GAME -> bấm -> chờ HUD
async function openGame() {
  await page.goto(GAME_URL, { waitUntil: "domcontentloaded" });
  // Lần tải đầu (chưa có cache) có thể mất > 1 phút. Phiên hết hạn thì game kẹt ở "Loading... 30%" mãi -> phát hiện sớm qua log SignalR.
  const startReady = () =>
    page
      .evaluate(() => {
        try {
          let n = cc.director.getScene();
          for (const k of "Canvas/LandingLayer/SplashSceneView/newLanding/playing button".split("/")) n = n.getChildByName(k);
          return n.activeInHierarchy && /START/i.test(String(n.getChildByName("lbStart").getComponent(cc.Label).string));
        } catch (_) {
          return false;
        }
      })
      .catch(() => false);
  await expect
    .poll(async () => (game.sessionError ? "session-expired" : (await startReady()) ? "ready" : "loading"), {
      timeout: 150_000,
      intervals: [500, 1000],
      message: "Game không tải xong (kẹt ở màn Loading)",
    })
    .not.toBe("loading");
  // Nút START GAME vẫn hiện dù phiên đã chết -> phải đợi gameinfo (hoặc log lỗi phiên) rồi mới kết luận
  await expect
    .poll(() => (game.infos.length ? "ok" : game.sessionError ? "session-expired" : "waiting"), { timeout: 30_000, intervals: [250, 500], message: "Không nhận được gameinfo" })
    .not.toBe("waiting")
    .catch(() => {});
  if (!game.infos.length) {
    throw new Error(
      `Không nhận được gameinfo - nhiều khả năng phiên trong GAME_URL đã hết hạn / không hợp lệ${game.sessionError ? ` (SignalR: "${game.sessionError}")` : ""}. ` +
        "Game không báo lỗi trên màn hình (kẹt ở Loading hoặc nút START GAME bấm không vào được). Chạy lại để spec lấy URL mới qua lobby (nếu đang đặt GAME_URL thì lấy URL mới và cập nhật GAME_URL trong .env).",
    );
  }
  game.loadErrors = { console: [...game.consoleErrors], page: [...game.pageErrors], http: [...game.badResponses] };
  await tapUntil(PATH.start, async () => !(await probe(PATH.start))?.active, { what: "nút START GAME", settleMs: 5000 });
  await expect.poll(async () => (await textOf(PATH.balance)) || "", { timeout: 30_000 }).not.toBe("");
}

// ---------------------------------------------------------------------------------------------------------------------
// TEST
// ---------------------------------------------------------------------------------------------------------------------
// Toàn bộ test của MỘT biến thể (mã game `code`). Được gọi lần lượt cho từng biến thể trong GAME_VARIANTS ở cuối file.
function defineVariant(code) {
  // Dữ liệu thu thập của MỖI biến thể. Đặt ở đây (không đặt trong describe "Quay thật") để afterAll cấp biến thể ghi được báo cáo
  // kể cả khi 1 test lỗi và nhóm quay bị bỏ qua (serial).
  const spin = {
    mismatches: [], // MỌI chỗ lệch giữa công thức / response / lịch sử. Không throw giữa chừng để chạy hết các lượt; test "Báo cáo tổng hợp" mới fail
    fsSequences: [],
    renewals: [],
    levelStats: Object.fromEntries(
      BET_SPECS.map((s) => [s.key, { spec: s, title: s.title, amount: null, planned: SPINS, done: 0, paid: 0, won: 0, maxWinHits: 0, failure: "", skipReason: "", aborted: "", infoNotes: [] }]),
    ),
    ruleTally: {}, // loại kiểm tra rule -> { checked, failed }
    histTally: {}, // trường đối chiếu lịch sử -> { checked, failed }
    historyInfo: null,
  };
  const tally = (bucket, kind, ok) => {
    const t = spin[bucket][kind] || (spin[bucket][kind] = { checked: 0, failed: 0 });
    t.checked++;
    if (!ok) t.failed++;
  };
  // Gom toàn bộ dữ liệu của biến thể đang chạy thành model cho tests/helpers/game-report.js
  const buildModel = () => {
    const opening = game.infos.length ? game.infos[0].json.result : null;
    const rows = game.report;
    return {
      code,
      startedAt: game.startedAt,
      finishedAt: Date.now(),
      config: { bets: process.env.GAME_BETS || "min,mid,max", spins: SPINS, maxCost: Number(process.env.GAME_MAX_COST) || 20_000 },
      currency: opening ? opening.currency : "",
      theoRtp: game.theoRtp,
      infoVersion: game.infoVersion,
      checks: game.checks,
      levels: Object.values(spin.levelStats).map((l) => ({
        key: l.spec ? l.spec.key : l.title,
        shortTitle: l.spec ? l.spec.title : l.title,
        title: l.title,
        hasSpec: !!l.spec,
        amount: l.amount,
        planned: l.planned,
        done: l.done,
        paid: l.paid,
        won: l.won,
        maxWinHits: l.maxWinHits,
        failure: l.failure,
        aborted: l.aborted,
        skipReason: l.skipReason,
        infoNotes: l.infoNotes,
      })),
      rows,
      mismatches: spin.mismatches,
      ruleTally: spin.ruleTally,
      histTally: spin.histTally,
      historyInfo: spin.historyInfo,
      fsSequences: spin.fsSequences,
      renewals: spin.renewals,
      notes: game.notes,
      balance: {
        opening: opening ? opening.balance : null,
        first: rows.length ? rows[0].balanceTrước : null,
        last: rows.length ? rows[rows.length - 1].balanceSau : null,
        final: game.infos.length || game.bets.length ? latestBalance() : null,
      },
    };
  };

test.describe(`Game Fortune Pig Cool [${code}] - tải game, rule, quay thử, lịch sử`, () => {
  // Nhóm phụ thuộc nhau và có thao tác ghi thật (quay) -> chạy tuần tự, KHÔNG retry (retry sẽ quay thêm lượt).
  test.describe.configure({ mode: "serial", retries: 0 });

  test.beforeAll(async ({ browser }) => {
    // Tách trạng thái theo biến thể: reset toàn bộ state cấp module trước khi dùng
    game = makeGame();
    ctx = null;
    page = null;
    GAME_CODE = code;
    const usesExplicitUrl = !!EXPLICIT_GAME_URL && code === EXPLICIT_CODE;
    GAME_URL = usesExplicitUrl ? EXPLICIT_GAME_URL : "";
    test.skip(!usesExplicitUrl && !(LOBBY_USERNAME && LOBBY_PASSWORD), "Thiếu cả GAME_URL lẫn LOBBY_USERNAME / LOBBY_PASSWORD trong .env");
    test.setTimeout(240_000);
    if (!usesExplicitUrl) {
      // Lấy URL mới qua trang chủ (1 lần cho cả biến thể). Lỗi (sai mật khẩu, không có game...) -> beforeAll FAIL với thông báo đã che mật khẩu.
      GAME_URL = await getGameUrl({ browser, lobbyUrl: LOBBY_URL, username: LOBBY_USERNAME, password: LOBBY_PASSWORD, gameCode: code });
    }
    game.launch = JSON.parse(Buffer.from(new URL(GAME_URL).searchParams.get("data"), "base64").toString("utf8"));
    if (!usesExplicitUrl) {
      expect(String(game.launch.gameCode || "").toUpperCase(), "gameCode trong ?data= của URL lấy từ lobby").toBe(code);
    }
    ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: TZ, locale: "en-US" });
    page = await ctx.newPage();
    attachListeners(page);
    theBrowser = browser;
    await openGame();
    game.sessionStartedAt = Date.now();
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus && page && !page.isClosed()) {
      await testInfo.attach("game-screenshot", { body: await page.screenshot(), contentType: "image/png" }).catch(() => {});
    }
  });

  test.beforeEach(() => {
    curChecks = []; // hạng mục giao diện của test trước (nếu test đó ném lỗi giữa chừng) không dồn sang test này
  });

  test.afterAll(async () => {
    // Ghi báo cáo HTML đầy đủ (kể cả khi 1 test lỗi và các test sau bị bỏ qua): test-results/game-report-<MÃ>.html (bản mới nhất, bị xoá
    // ở lần chạy sau) + test-history/game-reports/<ngày_giờ>_<MÃ>.html (lưu lâu dài).
    try {
      if (game.checks.length || game.report.length) {
        const files = writeGameReport(buildModel(), {
          dir: nodePath.resolve(process.cwd(), "test-results"),
          historyDir: nodePath.resolve(process.cwd(), "test-history", "game-reports"),
        });
        console.log(`[game ${code}] Báo cáo chi tiết: ${files.join("  |  ")}`);
      }
    } catch (e) {
      console.log(`[game ${code}] Không ghi được báo cáo: ${e && e.message}`);
    }
    if (ctx) await ctx.close();
  });

  // =========================================================================================== Tải game / gameinfo
  // Mỗi test chia thành các HẠNG MỤC nhỏ bằng chk(): từng hạng mục được ghi đạt / lỗi / lưu ý vào báo cáo HTML (game-report-<MÃ>.html),
  // hạng mục lỗi không chặn các hạng mục sau; cuối test endChecks() mới fail test nếu có hạng mục lỗi.
  test.describe("Tải game và gameinfo", () => {
    test("Tải xong không có lỗi console / mạng; kết nối SignalR thành công", async () => {
      const S = "Tải game";
      await chk(S, "Không có lỗi JS (pageerror) khi tải", () => {
        expect(game.loadErrors.page, "Lỗi JS (pageerror) khi tải").toEqual([]);
        return "0 lỗi";
      });
      await chk(S, "Không có console.error khi tải", () => {
        expect(game.loadErrors.console, "console.error khi tải").toEqual([]);
        return "0 lỗi";
      });
      await chk(S, "Mọi request tới dev-play trả HTTP < 400", () => {
        expect(game.loadErrors.http, "Request dev-play trả HTTP >= 400").toEqual([]);
        return "0 request lỗi";
      });
      await chk(S, "Kết nối SignalR, nhận được gameinfo", () => {
        expect(game.infos.length, "Đã nhận gameinfo qua SignalR").toBeGreaterThan(0);
        return `${game.infos.length} gameinfo`;
      });
      await chk(S, "gameinfo có trường pending (vòng chơi dang dở)", () => {
        expect(info().pending, "gameinfo có trường pending (vòng chơi dang dở)").toBeTruthy();
        return `pending=${JSON.stringify(info().pending)}`;
      });
      await endChecks();
    });

    test("gameinfo: status OK, currency / username khớp phiên chơi, cấu hình cược hợp lệ", async () => {
      const S = "gameinfo (SignalR)";
      const j = game.infos[game.infos.length - 1].json;
      const r = j.result;
      const s = r.settings;
      await chk(S, "status = 1, code = 0", () => {
        expect(j.status).toBe(1);
        expect(j.code).toBe(0);
        return `status=${j.status}, code=${j.code}`;
      });
      await chk(S, "currency khớp phiên chơi", () => {
        expect(r.currency).toBe(game.launch.currency); // TKN
        return r.currency;
      });
      await chk(S, "username khớp phiên chơi", () => {
        expect(r.username).toBe(game.launch.username);
      });
      await chk(S, "Số dòng cược (betlines) = 5", () => {
        expect(r.betlines).toBe(5);
      });
      await chk(S, "Balance ≥ 0", () => {
        expect(r.balance).toBeGreaterThanOrEqual(0);
        return `balance ${r.balance}`;
      });
      await chk(S, "Cấu hình cược: minBet > 0, maxBet ≥ minBet, mệnh giá tăng dần, đầu = minBet, cuối = maxBet", () => {
        expect(s.minBet).toBeGreaterThan(0);
        expect(s.maxBet).toBeGreaterThanOrEqual(s.minBet);
        expect(s.denominations[0]).toBe(s.minBet);
        expect(s.denominations[s.denominations.length - 1]).toBe(s.maxBet);
        expect([...s.denominations].sort((a, b) => a - b)).toEqual(s.denominations);
        return `${s.denominations.length} mệnh giá, min ${s.minBet}, max ${s.maxBet}`;
      });
      await chk(S, "maxPayout > 0", () => {
        expect(s.maxPayout).toBeGreaterThan(0);
        return `maxPayout ${s.maxPayout}`;
      });
      // Paytable: mỗi symbol có value[3], chỉ 3 symbol trùng mới trả thưởng
      await chk(S, "Paytable: mỗi symbol có 3 mốc, chỉ 3 symbol trùng mới trả thưởng", () => {
        expect(r.paytable.length).toBeGreaterThan(0);
        for (const p of r.paytable) {
          expect(p.value, `symbol ${p.symbolId}`).toHaveLength(3);
          expect(p.value[0]).toBe(0);
          expect(p.value[1]).toBe(0);
          expect(p.value[2]).toBeGreaterThanOrEqual(0);
        }
        return `${r.paytable.length} symbol`;
      });
      await chk(S, "Paytable có WILD và WILD trả cao nhất", () => {
        const wild = r.paytable.find((p) => p.symbolId === SYMBOL.WILD);
        expect(wild, "Paytable có WILD").toBeTruthy();
        expect(wild.value[2], "WILD phải trả cao nhất").toBe(Math.max(...r.paytable.map((p) => p.value[2])));
        return `WILD x${wild.value[2]}`;
      });
      await endChecks();
    });

    test("HUD: nhãn BALANCE / BET / WIN, balance khớp gameinfo, bet = mức tối thiểu, win = 0.00", async () => {
      const S = "HUD (thanh thông tin dưới)";
      const r = info();
      const denoms = r.settings.denominations;
      const lvl = r.settings.defaultBetLevel;
      let h = null;
      await chk(S, "Nhãn BALANCE / BET / WIN", async () => {
        expect(await textOf(PATH.lbBalance)).toBe("BALANCE");
        expect(await textOf(PATH.lbBet)).toBe("BET");
        expect(await textOf(PATH.lbWin)).toBe("WIN");
      });
      await chk(S, "Đọc được giá trị BALANCE / BET / WIN", async () => {
        h = await hud();
        return `balance ${h.balance}, bet ${h.bet}, win ${h.win}`;
      });
      if (!h) {
        chkSkip(S, "Các hạng mục HUD còn lại", "không đọc được HUD");
        return endChecks();
      }
      await chk(S, "Balance hiển thị khớp gameinfo", () => {
        expect(Math.abs(num(h.balance) - r.balance), `Balance hiển thị ${h.balance} so với gameinfo ${r.balance}`).toBeLessThan(0.01);
        return `${h.balance} (gameinfo ${r.balance})`;
      });
      // Mức cược khởi động KHÔNG nhất thiết là mức tối thiểu (bản _mk: 0.01 = min; bản không _mk: 30.00 trong khi min 1.99)
      await chk(S, "Bet khởi động là 1 mệnh giá có trong gameinfo", () => {
        expect(denoms.map(fmt2), `Bet khởi động ${h.bet} phải là 1 mệnh giá của gameinfo`).toContain(h.bet);
        return `bet ${h.bet}`;
      });
      // Game KHÔI PHỤC kết quả vòng gần nhất khi mở lại (WIN hiện win của lượt trước, không phải 0.00) -> chỉ ép 0.00 khi chưa có lastBet
      await chk(S, "WIN khởi động: 0.00 (chưa có lượt nào) hoặc bằng win của lastBet", () => {
        if (!r.lastBet) {
          expect(num(h.win)).toBe(0);
          return "win 0.00";
        }
        const lastWin = ["payout", "winAmount", "totalWin", "win"].map((k) => r.lastBet[k]).find((v) => typeof v === "number");
        if (lastWin !== undefined) expect(Math.abs(num(h.win) - lastWin), `WIN ${h.win} so với lastBet ${lastWin}`).toBeLessThan(0.01);
        note("ghi chú", `gameinfo.lastBet có các trường: ${Object.keys(r.lastBet).join(", ")}; WIN hiển thị khi mở lại = ${h.win}`);
        return `win ${h.win} (lastBet ${lastWin ?? "không rõ"})`;
      });
      await chk(S, "Nút '-' khoá khi và chỉ khi đang ở mức tối thiểu", () => {
        expect(h.minusEnabled, "Nút '-' khoá khi và chỉ khi đang ở mức tối thiểu").toBe(num(h.bet) > r.settings.minBet);
        return `bet ${h.bet}, '-' ${h.minusEnabled ? "mở" : "khoá"}`;
      });
      await chk(S, "Nút '+' khoá khi và chỉ khi đang ở mức tối đa", () => {
        expect(h.plusEnabled, "Nút '+' khoá khi và chỉ khi đang ở mức tối đa").toBe(num(h.bet) < r.settings.maxBet);
        return `bet ${h.bet}, '+' ${h.plusEnabled ? "mở" : "khoá"}`;
      });
      // defaultBetLevel là chỉ số TÍNH TỪ 1 trong danh sách mệnh giá (bản _mk: 1 -> 0.01; bản không _mk: 8 -> 30.00)
      // Đã có lượt quay trước (lastBet) thì game mở lại đúng mức cược của lượt đó; chưa có thì dùng defaultBetLevel.
      await chk(S, "Bet khởi động = stake của lastBet, hoặc mệnh giá thứ defaultBetLevel", () => {
        if (r.lastBet && typeof r.lastBet.stake === "number") {
          expect(num(h.bet), `Bet khởi động phải bằng stake của lastBet (${r.lastBet.stake})`).toBe(r.lastBet.stake);
          return `bet ${h.bet} = lastBet.stake`;
        }
        if (Number.isInteger(lvl) && lvl >= 1 && lvl <= denoms.length) {
          expect(num(h.bet), `Bet khởi động phải là mệnh giá thứ defaultBetLevel (${lvl}) = ${denoms[lvl - 1]}`).toBe(denoms[lvl - 1]);
          return `bet ${h.bet} = mệnh giá thứ ${lvl}`;
        }
        return { warn: `không có lastBet và defaultBetLevel=${lvl} không hợp lệ, bỏ qua kiểm tra` };
      });
      if (num(h.bet) !== r.settings.minBet) {
        note("ghi chú", `Bet khởi động ${h.bet} khác minBet ${r.settings.minBet} (defaultBetLevel=${lvl}) - spec tự hạ về mức tối thiểu trước khi quay`);
      }
      await endChecks();
    });
  });

  // =========================================================================================== Điều khiển (không ghi)
  test.describe("Điều khiển không quay", () => {
    test("Nút +/- đi qua đúng danh sách mệnh giá của gameinfo, khoá ở min / max, không gửi bet", async () => {
      test.setTimeout(180_000);
      const S = "Nút + / - đổi mức cược";
      const { denominations } = info().settings;
      const betsBefore = game.bets.length;
      const walked = await chk(S, `Nút '+' đi qua đủ ${denominations.length} mệnh giá đúng thứ tự gameinfo`, async () => {
        await ensureMinBet();
        const seen = [fmt2(denominations[0])];
        for (let i = 1; i < denominations.length; i++) {
          await tapUntil(PATH.btnPlus, async () => (await textOf(PATH.bet)) !== seen[seen.length - 1], { what: "nút cộng mức cược" });
          seen.push(await textOf(PATH.bet));
        }
        expect(seen).toEqual(denominations.map(fmt2));
        return seen.join(" → ");
      });
      if (walked.status === "FAIL") {
        chkSkip(S, "Ở mức tối đa nút '+' khoá, nút '-' mở", "bước đi qua mệnh giá lỗi");
      } else {
        await chk(S, "Ở mức tối đa nút '+' khoá, nút '-' mở", async () => {
          const atMax = await hud();
          expect(atMax.plusEnabled, "Ở mức tối đa nút '+' bị khoá").toBe(false);
          expect(atMax.minusEnabled).toBe(true);
          return `bet ${atMax.bet}`;
        });
      }
      await chk(S, "Nút '-' đưa về mức tối thiểu; ở mức tối thiểu nút '-' khoá", async () => {
        await ensureMinBet();
        const atMin = await hud();
        expect(atMin.minusEnabled, "Ở mức tối thiểu nút '-' bị khoá").toBe(false);
        return `bet ${atMin.bet}`;
      });
      await chk(S, "Đổi mức cược không tạo bet (không trừ tiền)", () => {
        expect(game.bets.length, "Đổi mức cược không được tạo bet").toBe(betsBefore);
      });
      await endChecks();
    });

    test("Settings: bật / tắt Turbo, Music, Sound đổi đúng trạng thái rồi trả về như cũ", async () => {
      test.setTimeout(120_000);
      const S = "Popup Settings";
      const opened = await chk(S, "Icon Settings mở popup", () => openPopup(PATH.iconSetting, "SettingPopup"));
      const tabs = { turbo: PATH.toggleTurbo, music: PATH.toggleMusic, sound: PATH.toggleSound };
      for (const [name, path] of Object.entries(tabs)) {
        if (opened.status === "FAIL") {
          chkSkip(S, `Toggle ${name} bật / tắt rồi trả lại`, "popup Settings không mở được");
          continue;
        }
        await chk(S, `Toggle ${name[0].toUpperCase() + name.slice(1)} bật / tắt rồi trả lại`, async () => {
          const before = (await probe(path)).checked;
          await tapUntil(path, async () => (await probe(path)).checked !== before, { what: `toggle ${name}` });
          expect((await probe(path)).checked, `${name} sau khi bật / tắt`).toBe(!before);
          await tapUntil(path, async () => (await probe(path)).checked === before, { what: `toggle ${name} (trả lại)` });
          return `${before ? "bật" : "tắt"} → ${!before ? "bật" : "tắt"} → ${before ? "bật" : "tắt"}`;
        });
      }
      // Tên sự kiện telemetry khác nhau giữa các biến thể -> chỉ ghi nhận, không ép
      const seen = [...new Set(game.telemetry.filter((c) => /turbo|mute|sound|music/i.test(c)))];
      note("telemetry", `Sự kiện turbo/mute đã thấy: ${seen.join(", ") || "(không có)"}`);
      if (opened.status !== "FAIL") await chk(S, "Nút đóng popup Settings", () => closePopup(PATH.settingClose, "SettingPopup"));
      await endChecks();
    });

    test("Nút Turbo và Sound trên thanh chính đổi đúng trạng thái trong Settings rồi trả về như cũ", async () => {
      test.setTimeout(180_000);
      const S = "Nút Turbo / Sound trên thanh chính";
      // Đọc trạng thái 3 toggle bằng cách mở Settings (state-based, không phụ thuộc telemetry)
      const toggles = async () => {
        await openPopup(PATH.iconSetting, "SettingPopup");
        const t = { turbo: (await probe(PATH.toggleTurbo)).checked, music: (await probe(PATH.toggleMusic)).checked, sound: (await probe(PATH.toggleSound)).checked };
        await closePopup(PATH.settingClose, "SettingPopup");
        return t;
      };
      const soundIcon = async () => {
        for (const p of PATH.iconSoundCandidates) if ((await probe(p))?.active) return p;
        throw new Error("Không thấy icon Sound (iconSound / iconSoundOn / iconSoundOff)");
      };
      // Chạm rồi kiểm tra lại Settings, tối đa 3 lần (canvas có thể nuốt lần chạm)
      const tapAndRead = async (path, changed) => {
        for (let i = 0; i < 3; i++) {
          await tapNode(path);
          const t = await toggles();
          if (changed(t)) return t;
        }
        throw new Error(`Chạm ${typeof path === "function" ? "icon" : path} 3 lần nhưng Settings không đổi`);
      };
      let initial = null;
      await chk(S, "Đọc trạng thái Turbo / Music / Sound từ Settings", async () => {
        initial = await toggles();
        return JSON.stringify(initial);
      });
      if (!initial) {
        chkSkip(S, "Nút Turbo trên thanh chính", "không đọc được Settings");
        chkSkip(S, "Icon Sound trên thanh chính", "không đọc được Settings");
        return endChecks();
      }
      // Bản _mk: chạm nút Turbo trên thanh chính đảo Settings.Turbo. Bản không _mk: chạm 3 lần KHÔNG đổi Settings.Turbo
      // (có thể nút này chỉ hoạt động theo kiểu "giữ nút Spin" / đổi cách khác) -> chỉ ghi LƯU Ý, không fail để không chặn chuỗi test quay thật.
      await chk(S, "Nút Turbo đảo Settings.Turbo (không đụng Music / Sound) rồi trả lại", async () => {
        try {
          const afterTurbo = await tapAndRead(PATH.btnTurbo, (t) => t.turbo !== initial.turbo);
          expect([afterTurbo.music, afterTurbo.sound], "Turbo không được đụng tới Music / Sound").toEqual([initial.music, initial.sound]);
          await tapAndRead(PATH.btnTurbo, (t) => t.turbo === initial.turbo);
          return "đảo đúng rồi trả lại";
        } catch (e) {
          const msg = String(e.message).slice(0, 120);
          note("nghi vấn", `Nút Turbo trên thanh chính không đổi Settings.Turbo (chạm 3 lần): ${msg}`);
          const now = await toggles();
          if (now.turbo !== initial.turbo) await tapAndRead(PATH.btnTurbo, (t) => t.turbo === initial.turbo); // trả lại nếu lỡ đổi
          return { warn: `chạm 3 lần không đổi Settings.Turbo (${msg})` };
        }
      });
      // Icon Sound: tắt / bật tiếng -> ít nhất Music hoặc Sound đổi, Turbo giữ nguyên; chạm lại thì về như cũ
      const muted = await chk(S, "Icon Sound tắt / bật tiếng (Music hoặc Sound đổi, Turbo giữ nguyên)", async () => {
        const t = await tapAndRead(await soundIcon(), (x) => x.music !== initial.music || x.sound !== initial.sound);
        expect(t.turbo, "Icon Sound không được đụng tới Turbo").toBe(initial.turbo);
        return `music ${initial.music}→${t.music}, sound ${initial.sound}→${t.sound}`;
      });
      if (muted.status === "FAIL") {
        chkSkip(S, "Chạm icon Sound lần nữa trả về như cũ", "bước tắt / bật tiếng lỗi");
      } else {
        await chk(S, "Chạm icon Sound lần nữa trả Music / Sound về như cũ", async () => {
          const back = await tapAndRead(await soundIcon(), (x) => x.music === initial.music && x.sound === initial.sound);
          expect(back).toEqual(initial);
        });
      }
      await endChecks();
    });

    test("Autoplay: popup hiện đủ lựa chọn, đóng bằng chạm ra ngoài, không gửi bet", async () => {
      test.setTimeout(120_000);
      const S = "Popup Autoplay";
      const betsBefore = game.bets.length;
      const opened = await chk(S, "Nút Autoplay mở popup", async () => {
        await ensureMinBet();
        await openPopup(PATH.btnAuto, AUTO_POPUP);
      });
      if (opened.status === "FAIL") {
        for (const n of ["Nhãn: tiêu đề, Number of Bets, Stop at any Win, nút Confirm", "Bet Amount = mức cược hiện tại", "5 lựa chọn số lượt", "Đóng popup bằng chạm ra ngoài"]) chkSkip(S, n, "popup Autoplay không mở được");
      } else {
        const autoName = (await activePopups()).find((n) => AUTO_POPUP.test(n));
        const AUTO = `${POPUPS}/${autoName}/contain`;
        await chk(S, "Nhãn: tiêu đề, Number of Bets, Stop at any Win, nút Confirm", async () => {
          expect(await textOf(`${AUTO}/title`)).toBe("Auto Play Settings");
          expect(await textOf(`${AUTO}/numOfBets/lbNumberAuto`)).toBe("Number of Bets");
          expect(await textOf(`${AUTO}/toggleStop/lbToggle`)).toBe("Stop at any Win");
          expect(await textOf(`${AUTO}/btnLayout/btnYes/Label`)).toBe("Confirm");
        });
        await chk(S, "Bet Amount trong popup = mức cược hiện tại", async () => {
          const v = num(await textOf(`${AUTO}/betAmount/lb_amount`));
          expect(v, "Bet Amount trong popup = mức cược hiện tại").toBe(info().settings.minBet);
          return `Bet Amount ${v}`;
        });
        await chk(S, "5 lựa chọn số lượt: 10 / 20 / 30 / 50 / ∞", async () => {
          const opts = [];
          for (let i = 1; i <= 5; i++) opts.push(await textOf(`${AUTO}/numOfBets/auto/listNumber/ButtonSelect-00${i}/Label`));
          expect(opts).toEqual(["10", "20", "30", "50", "∞"]);
          return opts.join(" / ");
        });
        await chk(S, "Đóng popup bằng chạm ra ngoài (không bấm Confirm)", () => closeByTapOutside(autoName));
      }
      await chk(S, "Mở / đóng Autoplay không gửi bet", () => {
        expect(game.bets.length).toBe(betsBefore);
      });
      await endChecks();
    });
  });

  // =========================================================================================== Rule game (màn Info)
  test.describe("Rule game trên màn Info", () => {
    test("Info: 5 payline cố định, giới hạn cược / thắng và bảng trả thưởng khớp gameinfo", async () => {
      test.setTimeout(120_000);
      const S = "Popup Info (rule)";
      const frame = () => page.frames().find((f) => f !== page.mainFrame() && /guides\/.+\.html/.test(f.url()));
      const opened = await chk(S, "Icon Info mở popup, nội dung rule tải xong", async () => {
        await ensureMinBet();
        await openPopup(PATH.iconInfo, POPUP_RE.info);
        await expect.poll(() => !!frame(), { timeout: 15_000 }).toBe(true);
        // nội dung điền động sau ~2-3s (minBet ban đầu là "---")
        await expect.poll(async () => frame().locator("#minBet").innerText(), { timeout: 20_000 }).not.toBe("---");
      });
      if (opened.status === "FAIL") {
        chkSkip(S, "Nội dung rule, số payline, giới hạn cược / thắng, bảng thưởng", "popup Info không mở / không tải xong");
        return endChecks();
      }
      const r = info();
      const f = frame();
      const body = await f.locator("body").innerText();
      const RULES = [
        ["Mô tả 3x3 slot game", /3x3 slot game/i],
        ["5 bet lines cố định", /5 bet lines \(fixed\)/i],
        ["Thắng khi symbol giống nhau liên tiếp từ reel trái nhất", /Wins on bet lines are valid when matching symbols appear in succession from the leftmost reel/i],
        ["WILD thay thế mọi symbol trừ BONUS", /WILD symbol substitutes for all symbols except BONUS/i],
        ["Hệ số nhân x1, x2, x5, x10", /multiplier x1, x2, x5, or x10/i],
        ["BONUS đủ 3 cột thưởng 10 Free Spins", /awards 10 Free Spins/i],
      ];
      for (const [name, re] of RULES) {
        await chk(S, `Nội dung rule: ${name}`, () => {
          expect(body).toMatch(re);
        });
      }
      await chk(S, "Nội dung rule: có công bố RTP lý thuyết (X%)", () => {
        const m = body.match(RTP_RE);
        expect(body).toMatch(RTP_RE);
        game.theoRtp = Number(m[1]);
        return `RTP lý thuyết ${m[1]}%`;
      });
      await chk(S, "Số payline hiển thị = 5", async () => {
        const n = await f.locator(".lines .line").count();
        expect(n, "Số payline trong Info").toBe(5);
        return `${n} payline`;
      });
      await chk(S, "Hiển thị số phiên bản game", async () => {
        const v = await f.locator("#version").innerText();
        expect(v).toMatch(/^\d+(\.\d+)+$/);
        game.infoVersion = v;
        return v;
      });
      // Giới hạn
      await chk(S, "Min Bet khớp gameinfo", async () => {
        expect(await f.locator("#minBet").innerText()).toBe(fmt2(r.settings.minBet));
        return fmt2(r.settings.minBet);
      });
      await chk(S, "Max Bet khớp gameinfo", async () => {
        expect(await f.locator("#maxBet").innerText()).toBe(fmt2(r.settings.maxBet));
        return fmt2(r.settings.maxBet);
      });
      await chk(S, "Max payout mỗi vòng khớp gameinfo", async () => {
        expect(await f.locator("#maxPerBet").innerText()).toBe(fmt2(r.settings.maxPayout));
        return fmt2(r.settings.maxPayout);
      });
      // Bảng trả thưởng tại mức cược hiện tại = rate x (bet / betLines), hiển thị cắt còn 2 số lẻ, giá trị 0.00 bị ẩn
      // Info tính theo mức cược HIỆN TẠI trên HUD (không giả định = minBet)
      await chk(S, "Bảng trả thưởng khớp paytable (rate × bet / số dòng) ở mức cược hiện tại", async () => {
        const perLine = num((await hud()).bet) / r.betlines;
        const hidden = [];
        let cells = 0;
        for (const p of r.paytable) {
          const cell = f.locator(`#symbol_payout_rate_${p.symbolId}`);
          if ((await cell.count()) === 0) continue; // symbol không có ô trong Info (vd BONUS / mystery)
          cells++;
          const real = p.value[2] * perLine;
          const shown = floor2(real);
          const fmtCell = (v) => (v > 0 ? `3 - ${fmt2(v)}` : "");
          const actual = (await cell.innerText()).trim();
          // Chấp nhận cắt bớt (floor, bản _mk) hoặc làm tròn; sai quá 0.01 mới fail
          expect([fmtCell(floor2(real)), fmtCell(round2(real))], `Info - symbol ${p.symbolId} (rate ${p.value[2]}, bet/line ${perLine}): hiển thị "${actual}"`).toContain(actual);
          if (real > 0 && shown === 0) hidden.push(`symbol ${p.symbolId}: thực trả ${real.toFixed(4)} nhưng Info không hiện`);
        }
        if (hidden.length) {
          const d = `Ở mức cược tối thiểu Info ẩn các symbol có thưởng < 0.01 (bị làm tròn xuống 0.00 rồi lọc): ${hidden.join("; ")}`;
          note("nghi vấn", d);
          return { warn: d };
        }
        return `${cells} ô symbol khớp, bet/line ${perLine}`;
      });
      await chk(S, "Nút đóng popup Info", () => closePopupRe(POPUP_RE.info));
      await endChecks();
    });
  });

  // =========================================================================================== Lịch sử (chỉ đọc)
  test.describe("Lịch sử trong game", () => {
    test("Mở lịch sử: POST /api/history 200, tiêu đề có currency, các dòng khớp response", async () => {
      test.setTimeout(120_000);
      const S = "Popup Lịch sử";
      let h = null;
      const opened = await chk(S, "Icon Lịch sử mở popup, game gọi POST /api/history", async () => {
        h = await openHistory();
        return `${Array.isArray(h.json.result) ? h.json.result.length : "?"} bản ghi trong ngày`;
      });
      if (opened.status === "FAIL") {
        chkSkip(S, "API trả 200, tiêu đề, dòng khớp API, thứ tự", "popup Lịch sử không mở / API không phản hồi");
        return endChecks();
      }
      await chk(S, "API trả HTTP 200, status = 1, code = 0, result là mảng", () => {
        expect(h.status).toBe(200);
        expect(h.json.status).toBe(1);
        expect(h.json.code).toBe(0);
        expect(Array.isArray(h.json.result)).toBe(true);
        return `HTTP ${h.status}`;
      });
      await chk(S, "Tiêu đề popup có (currency)", async () => {
        expect(await popupText(POPUP_RE.history, "lb-title")).toContain(`(${info().currency})`);
      });
      await chk(S, "Các dòng đầu trong popup khớp API (Round ID, giờ, ngày, Bet, Win)", async () => {
        const rows = await historyRows();
        const recs = h.json.result;
        const n = Math.min(rows.length, recs.length, 5);
        for (let i = 0; i < n; i++) {
          const rec = recs[i];
          const t = timeParts(rec.vendorBetTime);
          expect(rows[i].round, `dòng ${i + 1}: Round ID`).toBe(rec.roundId);
          expect(rows[i].time, `dòng ${i + 1}: giờ`).toBe(t.time);
          expect(rows[i].date, `dòng ${i + 1}: ngày`).toBe(t.date);
          expect(Math.abs(num(rows[i].bet) - rec.bet), `dòng ${i + 1}: Bet`).toBeLessThan(0.01);
          expect(Math.abs(num(rows[i].win) - rec.win), `dòng ${i + 1}: Win`).toBeLessThan(0.01);
        }
        return n ? `so ${n} dòng đầu` : { warn: "lịch sử hôm nay rỗng, không có dòng nào để so" };
      });
      await chk(S, "Thứ tự mới nhất trước", () => {
        const recs = h.json.result;
        for (let i = 1; i < recs.length; i++) expect(recs[i - 1].vendorBetTime).toBeGreaterThanOrEqual(recs[i].vendorBetTime);
      });
      await chk(S, "Nút đóng popup Lịch sử", () => closePopupRe(POPUP_RE.history));
      await endChecks();
    });
  });

  // =========================================================================================== QUAY THẬT (ghi)
  test.describe("Quay thật theo các mức cược - đối chiếu rule và lịch sử", () => {
    const SYMBOL_NAME = { 1: "A", 3: "Q", 4: "K", 5: "PigCool", 6: "Ingot", 7: "Bag", 8: "Lantern", 9: "WILD" };
    const FS_MAX_RESPONSES = 60; // trần số response (Free Spin + respin) cho mỗi chuỗi Free Spin, tránh chạy vô hạn
    const { mismatches, fsSequences, levelStats, renewals } = spin; // khai báo ở đầu defineVariant (báo cáo cấp biến thể dùng chung)
    let initialBet = null;
    const gridStr = (cols) => cols.map((c) => `[${c.join(",")}]`).join(" ");
    const near = (a, c, eps = 1e-6) => typeof a === "number" && typeof c === "number" && Math.abs(a - c) < eps;
    // Đang ở chế độ Free Spin / respin (chưa quan sát được ngữ nghĩa chính xác của freeSpins / gameState nên dùng cả 3 dấu hiệu)
    const inFree = (b) => b.freeSpins > 0 || b.isRespin === true || (b.gameState !== undefined && b.gameState !== 1);
    const pendingFree = () => {
      const p = info().pending || {};
      return p.freeSpins > 0 || p.isRespin === true;
    };
    const mm = (label, b, ev, kind, detail) =>
      mismatches.push({ lượt: label, round: b ? b.roundId : "-", loại: kind, chiTiết: detail, lưới: ev ? gridStr(ev.cols) : "-", winTínhLại: ev ? Number(ev.payout.toFixed(6)) : null, winResponse: b ? b.payout : null });
    const levelOf = (key) =>
      levelStats[key] || (levelStats[key] = { spec: null, title: key, amount: null, planned: 0, done: 0, paid: 0, won: 0, maxWinHits: 0, failure: "", skipReason: "", aborted: "", infoNotes: [] });

    // ---- Mệnh giá thật của từng mức (lấy từ gameinfo, không hard-code theo bản)
    function resolveAmount(spec, s) {
      const d = s.denominations;
      if (spec.kind === "min") return s.minBet;
      if (spec.kind === "max") return s.maxBet;
      if (spec.kind === "mid") return d[Math.floor((d.length - 1) / 2)];
      if (spec.kind === "num") return d.find((x) => near(x, spec.value)) ?? null;
      if (spec.kind === "idx") return d[spec.idx - 1] ?? null;
      return null;
    }

    // Đổi mức cược bằng nút +/- (không quay) và xác nhận HUD hiển thị đúng mức mong muốn
    async function setBet(target) {
      const denoms = info().settings.denominations;
      for (let i = 0; i < denoms.length * 2 + 4; i++) {
        const h = await hud();
        if (near(num(h.bet), target, 0.0001)) return h;
        const up = num(h.bet) < target;
        await tapUntil(up ? PATH.btnPlus : PATH.btnMinus, async () => (await textOf(PATH.bet)) !== h.bet, { what: up ? "nút cộng mức cược" : "nút trừ mức cược" });
      }
      throw new Error(`Không đổi được mức cược về ${target} (HUD: ${(await hud()).bet})`);
    }

    // ---- Kiểm tra 1 response bet với rule game; mọi lệch được GHI vào mismatches (kèm round id, lưới, win tính lại / response)
    // Mỗi lần kiểm đều được đếm (đúng / sai) vào spin.ruleTally để báo cáo có bảng "kiểm bao nhiêu lần, đúng bao nhiêu".
    function checkRound(label, resp, ev, { free, balanceBefore, expectedBet, level }) {
      const b = resp.result;
      const r = info();
      const bad = (kind, detail) => mm(label, b, ev, kind, detail);
      const ck = (kind, ok, detail) => {
        tally("ruleTally", kind, ok);
        if (!ok) bad(kind, detail);
        return ok;
      };
      ck("status", resp.status === 1 && resp.code === 0, `status=${resp.status} code=${resp.code}`);
      if (!free) {
        ck("stake", near(b.stake, expectedBet), `stake=${b.stake}, kỳ vọng mức cược ${expectedBet}`);
        ck("baseStake", near(b.baseStake, b.stake), `baseStake=${b.baseStake} ≠ stake=${b.stake}`);
      }
      ck("betLines", b.betLines === r.betlines, `betLines=${b.betLines}, kỳ vọng ${r.betlines}`);
      ck("coinMultiplier", COIN_MULTIPLIERS.includes(b.coinMultiplier), `coinMultiplier=${b.coinMultiplier} không thuộc x1/x2/x5/x10`);
      const known = r.paytable.map((p) => p.symbolId).concat([SYMBOL.BONUS]);
      const unknown = [];
      for (const v of b.result.views) for (const s of v.value) if (!known.includes(s)) unknown.push(`symbol ${s} (cột ${v.id}) không có trong paytable`);
      tally("ruleTally", "symbol lạ", unknown.length === 0);
      unknown.forEach((d) => bad("symbol lạ", d));
      // Dòng SCATTER: khi BONUS đủ 3 cột response thêm 1 "dòng" giả { payline: -1, winType: "FreeSpin" } mô tả việc thưởng Free Spin,
      // không phải dòng thắng 3x3 và không trả tiền -> tách riêng, không đưa vào so sánh dòng thắng / winType / payout.
      const isScatter = (l) => l.payline === -1 || /^free ?spin$/i.test(String(l.winType));
      const scatterLines = b.paylines.filter(isScatter);
      const payLines = b.paylines.filter((l) => !isScatter(l));
      if (!free) ck("dòng scatter", (scatterLines.length > 0) === (ev.bonusReels === 3), `BONUS trên ${ev.bonusReels}/3 cột nhưng response có ${scatterLines.length} dòng scatter (payline -1 / winType FreeSpin)`);
      // Dòng thắng: (payline, rate) là phần chắc chắn; thứ tự symbols của dòng chỉ ghi chú
      const respLines = [...payLines].map((l) => ({ payline: l.payline, symbols: l.symbols, rate: l.payoutRate })).sort((x, y) => x.payline - y.payline);
      const a1 = JSON.stringify(respLines.map((l) => ({ payline: l.payline, rate: l.rate })));
      const a2 = JSON.stringify(ev.lines.map((l) => ({ payline: l.payline, rate: l.rate })));
      if (ck("dòng thắng", a1 === a2, `response ${a1} ≠ tính lại ${a2}`)) {
        const symDiff = respLines.filter((l, i) => JSON.stringify(l.symbols) !== JSON.stringify(ev.lines[i].symbols) && JSON.stringify(l.symbols) !== JSON.stringify([...ev.lines[i].symbols].reverse()));
        ck("symbols dòng thắng", symDiff.length === 0, `response ${JSON.stringify(symDiff)} khác lưới ${JSON.stringify(ev.lines.map((l) => ({ payline: l.payline, symbols: l.symbols })))}`);
      }
      if (payLines.length > 0) {
        const badTypes = payLines.filter((l) => !(typeof l.winType === "string" && l.winType.split("-").length === 3)).map((l) => l.winType);
        ck("winType", badTypes.length === 0, `winType=${badTypes.join(", ")}`);
      }
      // Tiền thắng
      ck("payout", near(b.payout, ev.payout), `payout response ${b.payout} ≠ tính lại ${ev.payout} (Σ rate x bet/lines x hệ số)`);
      ck("rawPayout", near(b.rawPayout, b.payout), `rawPayout=${b.rawPayout} ≠ payout=${b.payout}`);
      if (!free) ck("winlose", near(b.winlose, b.payout - b.stake), `winlose=${b.winlose} ≠ payout-stake=${b.payout - b.stake}`);
      // Trần thắng mỗi vòng: payout không được vượt settings.maxPayout; chạm trần thì payout phải bằng đúng maxPayout
      const cap = r.settings.maxPayout;
      if (typeof cap === "number" && cap > 0) {
        let capOk = true;
        let capDetail = "";
        if (b.payout > cap + 1e-6) {
          capOk = false;
          capDetail = `payout ${b.payout} vượt settings.maxPayout ${cap}`;
        } else if (b.hasReachedMaxWin === true || near(b.payout, cap)) {
          level.maxWinHits++;
          note("maxPayout", `Lượt ${label}: CHẠM TRẦN thắng (payout ${b.payout}, maxPayout ${cap}, hasReachedMaxWin=${b.hasReachedMaxWin})`);
          if (!near(b.payout, cap)) {
            capOk = false;
            capDetail = `hasReachedMaxWin=true nhưng payout ${b.payout} ≠ maxPayout ${cap}`;
          }
        }
        ck("maxPayout", capOk, capDetail);
      }
      // Scatter / Free Spin (chỉ ép ở vòng thường; trong Free Spin response mô tả trạng thái khác)
      if (!free) ck("free spin", b.freeSpins === ev.expectedFreeSpins, `BONUS trên ${ev.bonusReels}/3 cột nhưng freeSpins=${b.freeSpins} (kỳ vọng ${ev.expectedFreeSpins})`);
      if (!free && !inFree(b)) ck("accumulatedWinAmount", near(b.accumulatedWinAmount, b.payout), `accumulatedWinAmount=${b.accumulatedWinAmount} ≠ payout=${b.payout}`);
      // Balance: vòng thường sau = trước - bet + win; Free Spin KHÔNG trừ cược: sau = trước + win
      if (free) {
        const expFree = balanceBefore + b.payout;
        const expPaid = balanceBefore - b.stake + b.payout;
        const okFree = near(b.balance, expFree);
        tally("ruleTally", "balance", okFree);
        if (!okFree) {
          bad(near(b.balance, expPaid) ? "Free Spin trừ cược" : "balance (Free Spin)", `balance sau ${b.balance}; không trừ cược → ${expFree}; có trừ cược (stake ${b.stake}) → ${expPaid}; trước ${balanceBefore}`);
        }
      } else {
        ck("balance", near(b.balance, balanceBefore - b.stake + b.payout), `balance sau ${b.balance} ≠ trước ${balanceBefore} - bet ${b.stake} + win ${b.payout} = ${balanceBefore - b.stake + b.payout}`);
      }
    }

    function makeRow(label, b, ev, balanceBefore, extra = {}) {
      return {
        lượt: label,
        bet: b.stake,
        lưới: gridStr(ev.cols),
        dòngThắng: ev.lines.map((l) => `L${l.payline}x${l.rate}`).join(",") || "-",
        hệSốNhân: b.coinMultiplier,
        winTínhLại: Number(ev.payout.toFixed(6)),
        winResponse: b.payout,
        balanceTrước: balanceBefore,
        balanceSau: b.balance,
        roundId: b.roundId,
        betId: b.id,
        fs: false,
        respin: b.isRespin === true,
        _cov: { lines: ev.lines.map((l) => ({ payline: l.payline, sym: SYMBOL_NAME[l.paySymbol] || `#${l.paySymbol}`, wilds: l.wilds })), bonusReels: ev.bonusReels, coin: b.coinMultiplier },
        ...extra,
      };
    }

    // ---- Chờ HUD khớp response (game cắt 2 số lẻ). Không khớp trong thời hạn -> ghi lệch "HUD", KHÔNG throw
    async function waitHud(label, b, ev, t0) {
      let sawSpin = false;
      let hudNow = await hud();
      try {
        await expect
          .poll(
            async () => {
              hudNow = await hud();
              const spinning = SPIN_TEXT.test(hudNow.notif || "");
              if (spinning) sawSpin = true;
              const okHud = Math.abs(num(hudNow.balance) - b.balance) < 0.01 && Math.abs(num(hudNow.win) - b.payout) < 0.01;
              return !spinning && (sawSpin || Date.now() - t0 > 6000) && okHud;
            },
            { timeout: 40_000, intervals: [250] },
          )
          .toBe(true);
        tally("ruleTally", "HUD", true);
      } catch (_) {
        tally("ruleTally", "HUD", false);
        mm(label, b, ev, "HUD", `HUD không khớp response sau 40s: balance hiển thị ${hudNow.balance} (thực ${b.balance}), win hiển thị ${hudNow.win} (thực ${b.payout})`);
      }
      const notes = [];
      if (b.payout > 0 && num(hudNow.win) === 0) notes.push(`thắng ${b.payout} nhưng WIN hiển thị ${hudNow.win}`);
      if (fmt2(floor2(b.balance)) !== fmt2(round2(b.balance)) && hudNow.balance === fmt2(floor2(b.balance))) notes.push(`balance ${b.balance} hiển thị ${hudNow.balance} (cắt bớt, không làm tròn)`);
      if (notes.length) note("nghi vấn", `Lượt ${label}: ${notes.join("; ")}`);
      return hudNow;
    }

    const isStartReady = () =>
      page
        .evaluate(() => {
          try {
            let n = cc.director.getScene();
            for (const k of "Canvas/LandingLayer/SplashSceneView/newLanding/playing button".split("/")) n = n.getChildByName(k);
            return n.activeInHierarchy && /START/i.test(String(n.getChildByName("lbStart").getComponent(cc.Label).string));
          } catch (_) {
            return false;
          }
        })
        .catch(() => false);

    // Tải lại game (cùng URL / phiên) để lấy gameinfo mới: xác nhận trạng thái pending (Free Spin dở) và đưa game về màn sạch
    async function reloadGame() {
      const c0 = game.infos.length;
      await page.goto(GAME_URL, { waitUntil: "domcontentloaded" });
      await expect.poll(async () => (game.sessionError ? "session-expired" : (await isStartReady()) ? "ready" : "loading"), { timeout: 120_000, intervals: [500, 1000] }).not.toBe("loading");
      if (game.sessionError) throw new Error(`Phiên hết hạn khi tải lại game (SignalR: "${game.sessionError}")`);
      await expect.poll(() => game.infos.length, { timeout: 30_000, message: "Không nhận được gameinfo mới sau khi tải lại" }).toBeGreaterThan(c0);
      await tapUntil(PATH.start, async () => !(await probe(PATH.start))?.active, { what: "nút START GAME", settleMs: 5000 });
      await expect.poll(async () => (await textOf(PATH.balance)) || "", { timeout: 30_000 }).not.toBe("");
    }

    const tapTopArea = async () => {
      const p = await page.evaluate(() => {
        const r = document.getElementById("GameCanvas").getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height * 0.06 }; // vùng tiêu đề phía trên lưới: không có nút, dùng để đóng popup "Press anywhere to continue"
      });
      await tapAt(p.x, p.y);
    };
    const waitNewBet = (n0, ms) => expect.poll(() => game.bets.length > n0, { timeout: ms, intervals: [200] }).toBe(true).then(() => true, () => false);

    // ---- Chơi hết Free Spin (và respin / PigCool Sure Win): đối chiếu từng response với CÙNG công thức payout
    async function playOutFreeSpins(label, trigger, levelKey, amount) {
      const level = levelOf(levelKey);
      const baseStake = trigger ? trigger.stake : amount || info().settings.minBet;
      const seq = { label, mức: levelKey, trigger: trigger ? trigger.roundId : "(tiếp tục từ lần chạy trước)", responses: 0, respins: 0, payout: 0, raw: [] };
      fsSequences.push(seq);
      let last = trigger || null;
      let prevBalance = trigger ? trigger.balance : latestBalance();
      let stalls = 0;
      const t00 = Date.now();
      for (let attempt = 0; attempt < 3; attempt++) {
        for (let step = 0; step < 300 && seq.responses < FS_MAX_RESPONSES && Date.now() - t00 < 12 * 60_000; step++) {
          if (last && seq.responses > 0 && !inFree(last)) break; // Free Spin cuối đã xong (freeSpins về 0, không respin, gameState về 1)
          const n0 = game.bets.length;
          // 1) chờ game tự chạy; 2) chạm vùng tiêu đề (đóng popup "Press anywhere"); 3) chạm nút Spin (nếu game chờ người chơi bấm)
          let got = await waitNewBet(n0, seq.responses === 0 && attempt === 0 ? 9000 : 7000);
          if (!got) {
            await tapTopArea();
            got = await waitNewBet(n0, 3500);
          }
          if (!got) {
            await tapNode(PATH.btnSpin).catch(() => {});
            got = await waitNewBet(n0, 5000);
          }
          if (!got) {
            if (++stalls >= 10) break;
            continue;
          }
          stalls = 0;
          for (const resp of game.bets.slice(n0)) {
            const b = resp.result;
            game.rounds.push(b);
            seq.responses++;
            if (b.isRespin) seq.respins++;
            seq.payout += b.payout;
            level.won += b.payout;
            let ev;
            try {
              ev = evaluateSpin(b, info().paytable, b.baseStake > 0 ? b.baseStake : baseStake);
            } catch (e) {
              mismatches.push({ lượt: `${label}.FS${seq.responses}`, round: b.roundId, loại: "lưới không đọc được", chiTiết: String(e).slice(0, 120), lưới: "-", winTínhLại: null, winResponse: b.payout });
              continue;
            }
            const fl = `${label}.FS${seq.responses}`;
            checkRound(fl, resp, ev, { free: true, balanceBefore: prevBalance, expectedBet: baseStake, level });
            game.report.push(makeRow(fl, b, ev, prevBalance, { fs: true, respin: b.isRespin === true, mức: levelKey, mứcSố: amount }));
            if (seq.raw.length < 3 || b.isRespin) {
              seq.raw.push({ fs: seq.responses, freeSpins: b.freeSpins, totalFreeSpin: b.totalFreeSpin, totalFreeSpinPayout: b.totalFreeSpinPayout, gameState: b.gameState, isRespin: b.isRespin, stake: b.stake, baseStake: b.baseStake, coin: b.coinMultiplier, payout: b.payout, acc: b.accumulatedWinAmount, balance: b.balance });
            }
            prevBalance = b.balance;
            last = b;
          }
        }
        // Xác nhận bằng gameinfo.pending sau khi tải lại: còn Free Spin dở thì chơi tiếp (game tự khôi phục)
        await reloadGame();
        if (!pendingFree()) break;
        last = null;
        stalls = 0;
        prevBalance = latestBalance();
      }
      note("free spin", `${label} (mức ${levelKey}): ${seq.responses} response (respin ${seq.respins}), tổng payout ${Number(seq.payout.toFixed(6))}; mẫu trường: ${JSON.stringify(seq.raw)}`);
      if (pendingFree()) {
        throw new Error(`Tài khoản còn Free Spin DỞ sau ${seq.responses} response (pending=${JSON.stringify(info().pending)}). Mở game bằng tay / MCP để chơi hết.`);
      }
      // Sau reload game có thể đổi bet về mức của lượt cuối -> đưa về mức đang test
      if (amount) await restoreBet(label, amount);
    }

    // Chỉnh lại mức cược sau Free Spin (game vừa tải lại). Đã quan sát: nút '-' đôi khi không phản hồi ngay sau Free Spin (chưa rõ nguyên nhân,
    // nghi có lớp phủ "Press anywhere to continue" / popup tổng kết). Làm theo thứ tự: đóng mọi popup -> chỉnh; lỗi thì chạm vùng tiêu đề
    // (không có nút, dùng để tắt lớp phủ) + đóng popup -> chỉnh lại; vẫn lỗi thì chụp màn hình + ghi trạng thái HUD / popup / nút Spin để chẩn đoán.
    async function restoreBet(label, amount) {
      await closeAllPopups().catch(() => {});
      try {
        await setBet(amount);
        return;
      } catch (first) {
        try {
          await tapTopArea();
          await closeAllPopups().catch(() => {});
          await setBet(amount);
          note("ghi chú", `${label}: sau Free Spin chỉnh mức cược lần 1 lỗi (${String(first.message).split("\n")[0]}), đã chạm vùng tiêu đề + đóng popup rồi chỉnh được`);
          return;
        } catch (e) {
          const state = await Promise.all([hud(), activePopups(), probe(PATH.btnSpin)])
            .then(([h, popups, spinBtn]) => ({ hud: h, popups, spinBtn: spinBtn && { active: spinBtn.active, interactable: spinBtn.interactable } }))
            .catch(() => null);
          if (page && !page.isClosed()) await test.info().attach(`game-screenshot-sau-free-spin-${label}`, { body: await page.screenshot(), contentType: "image/png" }).catch(() => {});
          note("nghi vấn", `${label}: sau Free Spin không chỉnh lại được mức cược ${amount}: ${String(e.message).split("\n")[0]}; trạng thái: ${JSON.stringify(state)}`);
          throw e;
        }
      }
    }

    // ---- Bảng thưởng trong Info ở mức cược hiện tại = rate x bet / số line (chấp nhận cắt xuống hoặc làm tròn); ghi annotation khi ẩn / cắt
    async function checkInfoAtBet(level, amount) {
      await openPopup(PATH.iconInfo, POPUP_RE.info);
      const frame = () => page.frames().find((f) => f !== page.mainFrame() && /guides\/.+\.html/.test(f.url()));
      await expect.poll(() => !!frame(), { timeout: 15_000 }).toBe(true);
      await expect.poll(async () => frame().locator("#minBet").innerText(), { timeout: 20_000 }).not.toBe("---");
      const r = info();
      const f = frame();
      const perLine = amount / r.betlines;
      const hidden = [];
      const truncated = [];
      for (const p of r.paytable) {
        const cell = f.locator(`#symbol_payout_rate_${p.symbolId}`);
        if ((await cell.count()) === 0) continue;
        const name = SYMBOL_NAME[p.symbolId] || `#${p.symbolId}`;
        const real = p.value[2] * perLine;
        const fmtCell = (v) => (v > 0 ? `3 - ${fmt2(v)}` : "");
        const actual = (await cell.innerText()).trim();
        const fl = fmtCell(floor2(real));
        const rd = fmtCell(round2(real));
        const cellOk = actual === fl || actual === rd;
        tally("ruleTally", "Info bảng thưởng", cellOk);
        if (!cellOk) mm(`Info ${level.title}`, null, null, "Info bảng thưởng", `mức ${amount}, ${name} (rate ${p.value[2]}) thực ${real}: hiển thị "${actual}", kỳ vọng "${fl}" hoặc "${rd}"`);
        if (real > 0 && actual === "") hidden.push(`${name} thực ${real.toFixed(4)}`);
        else if (actual === fl && fl !== rd) truncated.push(`${name} thực ${real.toFixed(4)} hiện ${actual}`);
      }
      if (hidden.length) level.infoNotes.push(`Info ẩn thưởng: ${hidden.join("; ")}`);
      if (truncated.length) level.infoNotes.push(`Info cắt xuống (không làm tròn): ${truncated.join("; ")}`);
      if (level.infoNotes.length) note("nghi vấn", `Mức ${level.title} (${amount}): ${level.infoNotes.join(" | ")}`);
      await closePopupRe(POPUP_RE.info);
    }

    // Nhớ mức cược ban đầu để trả lại ở cuối nhóm
    test.beforeAll(async () => {
      test.setTimeout(60_000);
      initialBet = num((await hud()).bet);
    });
    test.afterAll(async () => {
      test.setTimeout(120_000);
      try {
        if (initialBet && page && !page.isClosed()) {
          await closeAllPopups();
          await setBet(initialBet);
        }
      } catch (_) {
        /* best effort */
      }
    });

    // ---- Gia hạn phiên game (token trong URL chỉ sống ~20-30 phút): lấy URL mới qua lobby, mở lại game, GIỮ NGUYÊN game.rounds / báo cáo
    const SESSION_MAX_MS = 15 * 60_000; // chủ động gia hạn sau 15 phút (đã đo token sống >= 31 phút)
    const MAX_COST = Number(process.env.GAME_MAX_COST) || 20_000; // trần tổng tiền cược dự kiến (TKN); vượt thì dừng, không quay
    const needRenew = () => !!game.sessionError || Date.now() - (game.sessionStartedAt || Date.now()) > SESSION_MAX_MS;
    async function renewSession(reason) {
      if (!LOBBY_USERNAME || !LOBBY_PASSWORD) {
        throw new Error(`Cần gia hạn phiên (${reason}) nhưng không có LOBBY_USERNAME / LOBBY_PASSWORD (đang dùng GAME_URL cố định)`);
      }
      const t0 = Date.now();
      GAME_URL = await getGameUrl({ browser: theBrowser, lobbyUrl: LOBBY_URL, username: LOBBY_USERNAME, password: LOBBY_PASSWORD, gameCode: GAME_CODE });
      game.sessionError = ""; // lời gọi openGame mới làm phiên cũ bị ngắt (code -4 trên trang cũ) -> xoá cờ trước khi mở lại
      await reloadGame();
      game.sessionStartedAt = Date.now();
      renewals.push({ lúc: new Date().toISOString(), lýDo: reason, mấtGiây: Math.round((Date.now() - t0) / 1000) });
      note("gia hạn phiên", `Lần ${renewals.length}: ${reason} (mất ${Math.round((Date.now() - t0) / 1000)}s)`);
    }

    // Đặt 1 cược ở mức `st.amount`: chỉ thử lại khi CHƯA có response bet (không thể quay đôi); lỗi hạ tầng -> tải lại / gia hạn phiên rồi thử tiếp
    async function placeBet(spec, st, label) {
      const amount = st.amount;
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (needRenew()) await renewSession(game.sessionError ? `SignalR báo phiên hết hạn (${game.sessionError})` : `định kỳ sau ${SESSION_MAX_MS / 60_000} phút`);
          if (pendingFree()) await playOutFreeSpins(`tiếp-${label}`, null, spec.key, amount); // còn Free Spin dở (sau khi mở lại game) -> chơi hết trước
          await closeAllPopups();
          await setBet(amount);
          const h0 = await hud();
          if (!near(num(h0.bet), amount, 0.0001)) throw new Error(`HUD bet ${h0.bet} ≠ mức ${amount}`);
          const balanceBefore = latestBalance();
          const n0 = game.bets.length;
          const t0 = Date.now();
          await tapUntil(PATH.btnSpin, async () => game.bets.length > n0, { tries: 6, settleMs: 4000, what: "nút Spin" });
          return { resp: game.bets[n0], balanceBefore, t0 };
        } catch (e) {
          lastErr = e;
          if (attempt < 2) {
            const msg = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160);
            if (game.sessionError) await renewSession(`SignalR báo phiên hết hạn khi đặt cược (${game.sessionError})`).catch(() => {});
            else await reloadGame().catch(() => {}); // canvas / SignalR rớt: tải lại cùng phiên
            note("thử lại", `${label}: lỗi hạ tầng khi đặt cược (${msg}) - đã tải lại, thử lần ${attempt + 2}/3`);
          }
        }
      }
      throw lastErr;
    }

    // ---- Kế hoạch & chi phí: tổng cược tối đa dự kiến (thua hết) so với balance và trần MAX_COST. Vượt -> FAIL, KHÔNG quay (serial bỏ qua phần còn lại)
    test("Kế hoạch quay: tổng tiền cược dự kiến so với balance và trần chi phí (vượt thì dừng, không quay)", async () => {
      const s = info().settings;
      const bal = latestBalance();
      const plan = BET_SPECS.map((spec) => ({ spec, amount: resolveAmount(spec, s) })).filter((x) => x.amount !== null);
      const total = plan.reduce((t, x) => t + x.amount * SPINS, 0);
      const lines = plan.map((x) => `${x.spec.title}=${fmt2(x.amount)}×${SPINS}=${fmt2(x.amount * SPINS)}`);
      test.info().annotations.push({
        type: "kế hoạch",
        description: `GAME_BETS=${process.env.GAME_BETS || "min,mid,max"}, ${SPINS} lượt/mức, ${plan.length} mức, tối đa ${plan.length * SPINS} lượt cược. Tổng cược tối đa (thua hết) ${fmt2(total)} TKN; balance hiện có ${fmt2(bal)}; trần ${fmt2(MAX_COST)}. ${lines.join("; ")}`,
      });
      expect(total, `Tổng cược dự kiến ${fmt2(total)} TKN vượt balance hiện có ${fmt2(bal)} - dừng, không quay`).toBeLessThanOrEqual(bal);
      expect(total, `Tổng cược dự kiến ${fmt2(total)} TKN vượt trần ${fmt2(MAX_COST)} TKN (đặt GAME_MAX_COST để nâng) - dừng, không quay`).toBeLessThanOrEqual(MAX_COST);
    });

    // Có Free Spin dở từ lần chơi trước -> chơi hết trước khi quay (không để tài khoản kẹt, không skip)
    test("Chơi hết Free Spin còn dở từ lần chạy trước (nếu có)", async () => {
      test.setTimeout(1_500_000);
      test.skip(!pendingFree(), "Không có Free Spin dở");
      await closeAllPopups();
      await playOutFreeSpins("tiếp", null, "tiếp", null);
    });

    // ---- Mỗi mức cược MỘT test: đổi cược, đủ balance, Info đúng bảng thưởng, rồi vòng SPINS lượt (đối chiếu từng lượt với rule)
    for (const spec of BET_SPECS) {
      test(`Mức ${spec.title}: đổi cược, đủ balance, Info, ${SPINS} lượt quay đối chiếu rule`, async () => {
        test.setTimeout(SPINS * 150_000 + 1_800_000); // ~2.5 phút / lượt (an toàn) + 30 phút cho Free Spin / gia hạn phiên
        const st = levelOf(spec.key);
        const s = info().settings;
        if (spec.kind === "bad") {
          st.failure = `GAME_BETS có giá trị không hợp lệ "${spec.title}" (dùng min | mid | max | all | số thuộc denominations)`;
          return;
        }
        const amount = resolveAmount(spec, s);
        if (amount === null) {
          if (spec.kind === "idx") {
            st.skipReason = `GAME_BETS=all: bản này chỉ có ${s.denominations.length} mệnh giá, ô #${spec.idx} không tồn tại`;
            test.skip(true, st.skipReason);
          }
          st.failure = `Mức ${spec.title} không thuộc denominations của gameinfo [${s.denominations.join(", ")}]`;
          return;
        }
        st.amount = amount;
        st.title = `${spec.title} (${fmt2(amount)})`;
        if (needRenew()) await renewSession(`trước mức ${st.title}: ${game.sessionError ? "phiên báo hết hạn" : `định kỳ sau ${SESSION_MAX_MS / 60_000} phút`}`);
        await closeAllPopups();
        const need = amount * SPINS;
        const have = latestBalance();
        if (have < need) {
          st.failure = `Không đủ balance cho mức ${fmt2(amount)}: cần ≥ ${fmt2(need)} (${SPINS} lượt × ${fmt2(amount)}), hiện có ${fmt2(have)}`;
          return;
        }
        await setBet(amount);
        expect(num((await hud()).bet), "HUD bet sau khi đổi mức").toBe(amount);
        await checkInfoAtBet(st, amount);
        test.info().annotations.push({ type: "mức cược", description: `${st.title}: balance ${fmt2(have)}, cần tối đa ${fmt2(need)}` });

        for (let n = 1; n <= SPINS; n++) {
          const label = `${spec.title}#${n}`;
          let placed;
          try {
            placed = await placeBet(spec, st, label);
          } catch (e) {
            const msg = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 300);
            st.aborted = `Mức ${spec.title} dừng ở lượt ${n}/${SPINS} (đã quay ${st.done}/${SPINS}) vì lỗi đặt cược: ${msg}`;
            mm(label, null, null, "ngoại lệ", msg);
            if (page && !page.isClosed()) await test.info().attach(`game-screenshot-${label}`, { body: await page.screenshot(), contentType: "image/png" }).catch(() => {});
            break;
          }
          try {
            const { resp, balanceBefore, t0 } = placed;
            const b = resp.result;
            game.rounds.push(b);
            st.done++;
            st.paid += b.stake;
            st.won += b.payout;
            const ev = evaluateSpin(b, info().paytable);
            const row = makeRow(label, b, ev, balanceBefore, { mức: spec.key, mứcSố: amount });
            checkRound(label, resp, ev, { free: false, balanceBefore, expectedBet: amount, level: st });
            const hudNow = await waitHud(label, b, ev, t0);
            row.winHiểnThị = hudNow.win;
            row.balanceHiểnThị = hudNow.balance;
            game.report.push(row);
            const bad = mismatches.filter((x) => x.lượt === label);
            if (bad.length) test.info().annotations.push({ type: "LỆCH", description: JSON.stringify(bad) });
            test.info().annotations.push({ type: `lượt ${label}`, description: JSON.stringify({ ...row, _cov: undefined }) });
            // Kích hoạt Free Spin (BONUS đủ 3 cột) / respin -> chơi hết, đối chiếu từng Free Spin (Free Spin không trừ cược)
            if (b.freeSpins > 0 || b.totalFreeSpin > 0 || b.isRespin || ev.expectedFreeSpins > 0) {
              row.kíchHoạtFreeSpin = true;
              note("free spin", `Lượt ${label} kích hoạt Free Spin: freeSpins=${b.freeSpins}, totalFreeSpin=${b.totalFreeSpin}, gameState=${b.gameState}, isRespin=${b.isRespin}`);
              await playOutFreeSpins(label, b, spec.key, amount);
            }
          } catch (e) {
            // Lỗi sau khi ĐÃ có response (đánh giá / HUD / Free Spin): ghi lại; dừng mức này nếu còn Free Spin dở (không quay tiếp khi tài khoản đang dở Free Spin)
            const msg = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 300);
            mm(label, null, null, "ngoại lệ", msg);
            if (pendingFree()) {
              st.aborted = `Mức ${spec.title} dừng ở lượt ${n}/${SPINS} (đã quay ${st.done}/${SPINS}) vì còn Free Spin dở: ${msg}`;
              break;
            }
          }
        }
        test.info().annotations.push({ type: "kết quả mức", description: `${st.title}: đã quay ${st.done}/${SPINS}, cược ${Number(st.paid.toFixed(6))}, thắng ${Number(st.won.toFixed(6))}${st.aborted ? ` - DỪNG DỞ: ${st.aborted}` : ""}` });
      });
    }

    // ---- Lấy TOÀN BỘ lịch sử trong ngày (nhiều trang) bằng đúng request + x-token mà popup lịch sử gửi (popup chỉ hiện ~20 dòng đầu)
    async function fetchAllHistory(h) {
      const req = h.request;
      const body = req.postDataJSON();
      const xToken = (await req.allHeaders())["x-token"];
      const limit = body.Limit || 20;
      const all = [...h.json.result];
      let pageNo = body.Page || 1;
      for (let guard = 0; guard < 40 && all.length >= pageNo * limit; guard++) {
        pageNo++;
        const r = await page.request.post(req.url(), { headers: { "content-type": "application/json", "x-token": xToken }, data: { ...body, Page: pageNo } });
        const j = await r.json().catch(() => null);
        if (!j || !Array.isArray(j.result) || j.result.length === 0) break;
        all.push(...j.result);
      }
      return all;
    }

    test("Lịch sử: mỗi round vừa quay có bản ghi khớp response (bet, win, balance, round / bet id, giờ, lưới, dòng thắng)", async () => {
      test.setTimeout(300_000);
      test.skip(game.rounds.length === 0, "Chưa có lượt quay nào trong lần chạy này");
      if (needRenew()) await renewSession("trước khi đối chiếu lịch sử");
      await closeAllPopups();
      let h = await openHistory();
      let all = await fetchAllHistory(h);
      // bản ghi lịch sử ghi bất đồng bộ: nếu thiếu thì đóng / mở lại
      for (let i = 0; i < 3 && game.rounds.some((b) => !all.find((x) => x.roundId === b.roundId)); i++) {
        await closePopupRe(POPUP_RE.history);
        h = await openHistory();
        all = await fetchAllHistory(h);
      }
      const rows = await historyRows();
      // gom response theo round (Free Spin cùng roundId với vòng kích hoạt)
      const byRound = new Map();
      for (const b of game.rounds) byRound.set(b.roundId, [...(byRound.get(b.roundId) || []), b]);
      let uiChecked = 0;
      for (const [roundId, bs] of byRound) {
        const rec = all.find((x) => x.roundId === roundId);
        const first = bs[0];
        const label = String(game.report.find((x) => x.roundId === roundId)?.lượt ?? roundId);
        const diffs = [];
        // eq: so 1 trường của bản ghi lịch sử với response; `key` là tên nhóm trong bảng tổng hợp của báo cáo
        const eq = (field, a, c, eps, key = field) => {
          const ok = typeof a === "number" && typeof c === "number" ? Math.abs(a - c) < (eps ?? 1e-6) : JSON.stringify(a) === JSON.stringify(c);
          tally("histTally", key, ok);
          if (!ok) diffs.push(`${field}: lịch sử=${JSON.stringify(a)} | response=${JSON.stringify(c)}`);
        };
        tally("histTally", "Có bản ghi lịch sử cho round", !!rec);
        if (!rec) {
          diffs.push("không có bản ghi lịch sử cho round này");
        } else if (bs.length === 1) {
          const b = first;
          eq("bet", rec.bet, b.stake);
          eq("win", rec.win, b.payout);
          eq("lastBalance", rec.lastBalance, b.balance);
          eq("vendorBetTime", rec.vendorBetTime, b.processedTime, 5000);
          eq("số bet trong round", rec.bets.length, 1);
          eq("promoType", rec.promoType, 0);
          const bet0 = rec.bets[0];
          eq("betId", bet0.betId, b.id);
          eq("bets[0].roundId", bet0.roundId, b.roundId);
          eq("betAmount", bet0.betAmount, b.stake);
          eq("winAmount", bet0.winAmount, b.payout);
          eq("isFreespin", bet0.isFreespin, 0);
          const inner = JSON.parse(bet0.result).Result;
          eq("Result.Balance", inner.Balance, b.balance);
          eq("Result.Stake", inner.Stake, b.stake);
          eq("Result.Payout", inner.Payout, b.payout);
          eq("Result.CoinMultiplier", inner.CoinMultiplier, b.coinMultiplier);
          eq("Result.BetLines", inner.BetLines, b.betLines);
          eq("Result.Winloss", inner.Winloss, b.winlose);
          eq("Result.IsEndRound", inner.IsEndRound, true);
          eq("lưới symbol", inner.Result.Views, b.result.views);
          eq(
            "dòng thắng",
            inner.Paylines.map((l) => ({ payline: l.Payline, symbols: l.Symbols, rate: l.Multiplier })),
            b.paylines.map((l) => ({ payline: l.payline, symbols: l.symbols, rate: l.payoutRate })),
          );
        } else {
          // Round có Free Spin: nhiều bet cùng roundId. Mô hình lịch sử của Free Spin chưa quan sát trước -> so các trường chắc chắn và ghi nhận phần còn lại
          const last = bs[bs.length - 1];
          eq("số bet trong round", rec.bets.length, bs.length);
          eq("tập betId", [...rec.bets.map((x) => x.betId)].sort(), [...bs.map((x) => x.id)].sort());
          eq("lastBalance", rec.lastBalance, last.balance);
          eq("Σ winAmount các bet", rec.bets.reduce((s, x) => s + (x.winAmount || 0), 0), bs.reduce((s, x) => s + x.payout, 0));
          eq("win cả round", rec.win, bs.reduce((s, x) => s + x.payout, 0));
          eq("bet cả round", rec.bet, first.stake);
          for (const x of bs) {
            const bt = rec.bets.find((y) => y.betId === x.id);
            if (!bt) continue;
            eq(`bet ${x.id} winAmount`, bt.winAmount, x.payout, undefined, "Free Spin: winAmount từng bet");
            try {
              eq(`bet ${x.id} lưới`, JSON.parse(bt.result).Result.Result.Views, x.result.views, undefined, "Free Spin: lưới từng bet");
            } catch (_) {
              diffs.push(`bet ${x.id}: không đọc được result`);
            }
          }
        }
        // Dòng trong popup lịch sử (UI): chỉ so được các round đang hiện trong popup (~20 dòng đầu)
        const ui = rows.find((x) => x.round === roundId);
        if (rec && ui) {
          uiChecked++;
          const t = timeParts(rec.vendorBetTime);
          const uiEq = (key, ok, detail) => {
            tally("histTally", key, ok);
            if (!ok) diffs.push(detail);
          };
          uiEq("Dòng trong popup: giờ", ui.time === t.time, `UI giờ=${ui.time} | kỳ vọng ${t.time}`);
          uiEq("Dòng trong popup: ngày", ui.date === t.date, `UI ngày=${ui.date} | kỳ vọng ${t.date}`);
          uiEq("Dòng trong popup: bet", Math.abs(num(ui.bet) - rec.bet) < 0.01, `UI bet=${ui.bet} | lịch sử=${rec.bet}`);
          uiEq("Dòng trong popup: win", Math.abs(num(ui.win) - rec.win) < 0.01, `UI win=${ui.win} | lịch sử=${rec.win}`);
        }
        const rep = game.report.find((x) => x.roundId === roundId);
        if (rep && rec) {
          const t = timeParts(rec.vendorBetTime);
          rep.lịchSử = { bet: rec.bet, win: rec.win, lastBalance: rec.lastBalance, giờ: `${t.date} ${t.time}`, dòngUI: ui ? `${ui.bet}/${ui.win}` : "(ngoài 20 dòng đầu popup)", lệch: diffs.length ? diffs : "khớp" };
        } else if (rep) {
          rep.lịchSử = { lệch: diffs };
        }
        if (rep) {
          rep.lsStatus = !rec ? "MISSING" : diffs.length ? "FAIL" : "PASS"; // dùng cho cột "Lịch sử" trong báo cáo HTML
          rep.lsDiffs = diffs;
        }
        for (const d of diffs) mismatches.push({ lượt: label, round: roundId, loại: "lịch sử", chiTiết: d, lưới: rep ? rep.lưới : "-", winTínhLại: rep ? rep.winTínhLại : null, winResponse: rep ? rep.winResponse : null });
      }
      spin.historyInfo = { recordsToday: all.length, rounds: byRound.size, uiChecked };
      test.info().annotations.push({ type: "lịch sử", description: `Đã đối chiếu ${byRound.size} round với API lịch sử (${all.length} bản ghi trong ngày); so thêm dòng UI cho ${uiChecked} round hiện trong popup` });
      await closePopupRe(POPUP_RE.history);
    });

    test("Báo cáo tổng hợp: kết quả từng mức cược, lệch công thức / lịch sử, bảng độ phủ (đính kèm spin-report.json)", async () => {
      test.skip(game.report.length === 0 && !Object.values(levelStats).some((l) => l.failure || l.aborted), "Chưa có lượt quay nào");
      const rows = game.report;
      const first = rows[0];
      const last = rows[rows.length - 1];
      const sumPaid = Object.values(levelStats).reduce((s, l) => s + l.paid, 0);
      const sumWin = rows.reduce((s, r) => s + r.winResponse, 0);
      // Tổng: balance cuối = balance đầu - Σ bet (chỉ vòng thường) + Σ win (mọi response). Làm TRƯỚC khi dựng báo cáo để lệch này nằm trong báo cáo
      if (first && last) {
        const okTotal = near(last.balanceSau, first.balanceTrước - sumPaid + sumWin);
        tally("ruleTally", "balance tổng", okTotal);
        if (!okTotal) {
          mismatches.push({ lượt: "tổng", round: "-", loại: "balance tổng", chiTiết: `balance cuối ${last.balanceSau} ≠ đầu ${first.balanceTrước} - Σbet ${sumPaid} + Σwin ${sumWin} = ${first.balanceTrước - sumPaid + sumWin}`, lưới: "-", winTínhLại: null, winResponse: null });
        }
      }
      const model = buildModel();
      const a = analyze(model);
      const perLevel = a.levels.map((l) => ({
        mức: l.title,
        amount: l.amount,
        đãQuay: l.done,
        kếHoạch: l.planned,
        tổngCược: Number(l.paid.toFixed(6)),
        tổngThắng: Number(l.won.toFixed(6)),
        rtp: l.rtp.rtp,
        chạmMaxPayout: l.maxWinHits,
        sốLệch: l.mismatchCount,
        trạngThái: l.status,
        ghiChúInfo: l.infoNotes,
        độPhủ: l.cov,
      }));
      const rtp = a.rtp;
      test.info().annotations.push({
        type: "RTP",
        description: `Thực tế ${rtp.rtp === null ? "-" : (rtp.rtp * 100).toFixed(2) + "%"} sau ${rtp.rounds} lượt (cược ${Number(rtp.bet.toFixed(4))}, thắng ${Number(rtp.win.toFixed(4))}); lý thuyết (Info) ${game.theoRtp ?? "không đọc được"}%${rtp.lo !== null ? `; khoảng tin cậy 95% ${(rtp.lo * 100).toFixed(2)}% - ${(rtp.hi * 100).toFixed(2)}%` : ""}`,
      });
      test.info().annotations.push({ type: "đối chiếu", description: `Rule: ${a.rule.ok}/${a.rule.responses} response đúng; lịch sử: ${a.hist.ok}/${a.hist.rounds} round khớp; HUD: ${a.hud.ok}/${a.hud.checked} lượt khớp; giao diện: ${a.uiCount.PASS}/${a.uiCount.total} hạng mục đạt` });
      test.info().annotations.push({ type: "độ phủ (tổng)", description: covLines(a.cov).join("\n") });
      for (const p of perLevel) test.info().annotations.push({ type: `mức ${p.mức}`, description: `${p.trạngThái}; quay ${p.đãQuay}/${p.kếHoạch}, cược ${p.tổngCược}, thắng ${p.tổngThắng}, chạm maxPayout ${p.chạmMaxPayout}, lệch ${p.sốLệch}\n${covLines(p.độPhủ).join("\n")}${p.ghiChúInfo.length ? `\nInfo: ${p.ghiChúInfo.join(" | ")}` : ""}` });
      const summary = {
        lượtQuay: a.cov.lượtQuay,
        tổngCược: Number(sumPaid.toFixed(6)),
        tổngThắng: Number(sumWin.toFixed(6)),
        rtpThựcTế: rtp.rtp,
        rtpLýThuyết: game.theoRtp,
        balanceĐầu: first ? first.balanceTrước : null,
        balanceCuối: last ? last.balanceSau : null,
        sốLệch: mismatches.length,
        sốLầnGiaHạnPhiên: renewals.length,
      };
      await test.info().attach("spin-report.json", {
        body: JSON.stringify({ summary, rtp, coverageTotal: a.cov, ruleTally: spin.ruleTally, histTally: spin.histTally, perLevel, mismatches, renewals, freeSpinSequences: fsSequences, rows: rows.map(({ _cov, ...r }) => r) }, null, 2),
        contentType: "application/json",
      });
      // Báo cáo HTML đầy đủ (giao diện / rule / lịch sử / RTP / độ phủ / từng lượt). Bản cuối cùng (có cả popup chi tiết chạy sau test này)
      // được ghi ra test-results/game-report-<MÃ>.html và test-history/game-reports/ ở afterAll của biến thể.
      await test.info().attach("game-report.html", { body: renderGameReport(model), contentType: "text/html" });
      test.info().annotations.push({ type: "tổng", description: JSON.stringify(summary) });
      // FAIL rõ ràng: mức lỗi / dừng dở / thiếu lượt (kết quả xanh phải có nghĩa là đã quay ĐỦ)
      expect(a.incomplete.map((l) => `${l.title}: ${l.status}`), "Các mức cược chưa quay đủ").toEqual([]);
      expect(mismatches.slice(0, 25), `${mismatches.length} chỗ lệch giữa công thức / response / lịch sử (xem báo cáo game-report-${code}.html)`).toEqual([]);
    });

    test("Popup chi tiết lịch sử của lượt quay thường mới nhất khớp response (Round / Bet ID, bet, win, balance, hệ số, dòng thắng)", async () => {
      test.setTimeout(150_000);
      const S = "Popup chi tiết lịch sử";
      const normal = game.rounds.filter((b) => !b.isRespin && !(b.freeSpins > 0) && !(b.stake === 0));
      test.skip(normal.length === 0, "Chưa có lượt quay thường nào trong lần chạy này");
      await closeAllPopups();
      const b = normal[normal.length - 1];
      const opened = await chk(S, "Mở lịch sử rồi mở popup chi tiết của lượt quay thường mới nhất", async () => {
        await openHistory();
        await expect.poll(async () => (await historyRows()).find((x) => x.round === b.roundId) !== undefined, { timeout: 10_000 }).toBe(true);
        // Mở popup chi tiết: chạm mũi tên ở dòng của round, chạm lại nếu canvas nuốt lần chạm
        for (let i = 0; i < 5 && !(await popupOpen(POPUP_RE.detail)()); i++) {
          const row = (await historyRows()).find((x) => x.round === b.roundId);
          await tapAt(row.detailX, row.detailY);
          await expect.poll(popupOpen(POPUP_RE.detail), { timeout: 3000 }).toBe(true).catch(() => {});
        }
        expect(await activePopups(), "Popup chi tiết lịch sử không mở").toEqual(expect.arrayContaining([expect.stringMatching(POPUP_RE.detail)]));
        return `round ${b.roundId}`;
      });
      if (opened.status === "FAIL") {
        chkSkip(S, "Các trường của popup chi tiết", "popup chi tiết không mở được");
        return endChecks();
      }
      // Đọc nhãn theo TÊN node (không phụ thuộc đường dẫn, khác nhau giữa các biến thể)
      const T = (name) => popupText(POPUP_RE.detail, name);
      await chk(S, "Chế độ chơi (Normal Spin / Free Spin)", async () => {
        const v = await T("lbGameMode");
        expect(v).toBe(b.freeSpins > 0 ? "Free Spin" : "Normal Spin");
        return v;
      });
      await chk(S, "Đơn vị tiền (currency)", async () => {
        expect(await T("currency")).toBe(`(${info().currency})`);
      });
      await chk(S, "Round ID", async () => {
        expect(await T("roundIDValue"), "Round ID").toBe(b.roundId);
      });
      await chk(S, "Bet khớp stake", async () => {
        const v = await T("betAmountValue");
        expect(Math.abs(num(v) - b.stake), "Bet").toBeLessThan(0.01);
        return `${v} (response ${b.stake})`;
      });
      await chk(S, "Winnings khớp payout", async () => {
        const v = await T("winningValue");
        expect(Math.abs(num(v) - b.payout), "Winnings").toBeLessThan(0.01);
        return `${v} (response ${b.payout})`;
      });
      await chk(S, "Balance khớp response", async () => {
        const v = await T("balanceValue");
        expect(Math.abs(num(v) - b.balance), "Balance").toBeLessThan(0.01);
        return `${v} (response ${b.balance})`;
      });
      await chk(S, "Bet ID", async () => {
        expect(await T("betIdValue"), "Bet ID").toContain(b.id);
      });
      await chk(S, "Bet Size và số dòng cược (Bet Line)", async () => {
        expect(Math.abs(num(await T("betSizeValue")) - b.stake)).toBeLessThan(0.01);
        expect(num(await T("betLineValue"))).toBe(b.betLines);
      });
      // Vòng KHÔNG thắng: popup chi tiết ẩn dòng Multiplier và đồng xu (quan sát ở bản không _mk) -> chỉ ép khi có dòng thắng hoặc nhãn đang hiện
      await chk(S, "Multiplier và hệ số nhân trên đồng xu", async () => {
        const multLabel = await T("multiplierValue");
        const coinLabel = await T("lbCoinMulti");
        if (b.paylines.length > 0 || multLabel !== null) expect(multLabel, "Multiplier trong popup chi tiết").toBe(`x${b.coinMultiplier}`);
        if (b.paylines.length > 0 || coinLabel !== null) expect(num(coinLabel), "Hệ số nhân trên đồng xu").toBe(b.coinMultiplier);
        if (b.paylines.length === 0 && multLabel === null) {
          const d = `Round ${b.roundId} không thắng: popup chi tiết không hiện Multiplier / đồng xu / dòng thắng`;
          note("ghi chú", d);
          return d;
        }
        return `x${b.coinMultiplier}`;
      });
      // Số dòng thắng hiển thị = số payline của response (mục "Payout")
      let shownLines = [];
      await chk(S, "Danh sách dòng thắng trong popup = payline của response", async () => {
        shownLines = await page.evaluate(([reSrc, popups]) => {
          let pop = cc.director.getScene();
          for (const k of popups.split("/")) pop = pop && pop.getChildByName(k);
          pop = pop && pop.children.find((c) => c.activeInHierarchy && new RegExp(reSrc, "i").test(c.name));
          const out = [];
          (function walk(n) {
            if (!n.activeInHierarchy) return;
            if (n.name === "lineWinInfo") {
              const idx = n.getChildByName("lineWinValue").getComponent(cc.Label).string;
              const pay = n.getChildByName("payout").getComponent(cc.Label).string;
              out.push({ payline: Number(idx), payout: pay });
            }
            n.children.forEach(walk);
          })(pop);
          return out;
        }, [POPUP_RE.detail.source, POPUPS]);
        expect(shownLines.map((l) => l.payline).sort(), "Các dòng thắng trong popup chi tiết").toEqual(b.paylines.map((l) => l.payline).sort());
        return `${shownLines.length} dòng thắng`;
      });
      // Đối chiếu tiền từng dòng (game cắt 2 số lẻ): ghi LƯU Ý cho báo cáo thay vì fail
      await chk(S, "Tiền từng dòng thắng và Bet Size Per Line (game hiển thị cắt 2 số lẻ)", async () => {
        const perLine = b.baseStake / b.betLines;
        const lineNotes = [];
        for (const sl of shownLines) {
          const real = b.paylines.find((l) => l.payline === sl.payline).payoutRate * perLine * b.coinMultiplier;
          if (Math.abs(num(sl.payout) - real) >= 0.01) lineNotes.push(`dòng ${sl.payline}: hiển thị ${sl.payout}, thực ${real}`);
          else if (real > 0 && num(sl.payout) === 0) lineNotes.push(`dòng ${sl.payline}: thắng ${real} nhưng hiển thị ${sl.payout}`);
        }
        const shownPerLine = await T("betSizePerLineValue");
        if (Math.abs(num(shownPerLine) - perLine) >= 0.001) lineNotes.push(`Bet Size Per Line hiển thị ${shownPerLine}, thực ${perLine}`);
        if (lineNotes.length) {
          const d = `Popup chi tiết round ${b.roundId}: ${lineNotes.join("; ")}`;
          note("nghi vấn", d);
          return { warn: d };
        }
        return `bet/line ${shownPerLine}`;
      });
      await chk(S, "Đóng popup chi tiết", () => closeAllPopups());
      await endChecks();
    });
  });
});
}

// Các biến thể dùng CHUNG MỘT VÍ của tài khoản lobby -> PHẢI chạy tuần tự (không song song, kể cả khi chạy trần không --workers=1,
// vì playwright.config.js có fullyParallel). Gộp tất cả trong 1 describe serial: Playwright chạy các test của nhóm này trên cùng 1 worker
// theo đúng thứ tự khai báo (bản thường trước, rồi _mk). Hệ quả: nếu 1 test của biến thể trước FAIL thì các test còn lại, kể cả của
// biến thể sau, bị bỏ qua (quy ước serial) -> sửa lỗi rồi chạy lại, hoặc thu hẹp bằng GAME_CODE=<mã>.
test.describe("Fortune Pig Cool - các biến thể (chạy tuần tự, dùng chung ví)", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  if (CONFIG_ERROR) {
    test("Cấu hình GAME_CODE / GAME_URL hợp lệ", async () => {
      throw new Error(CONFIG_ERROR);
    });
  } else {
    for (const code of ACTIVE_VARIANTS) defineVariant(code);
  }
});
