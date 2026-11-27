// Báo cáo HTML đầy đủ cho spec game client (tests/game_*.spec.js). Spec thu thập dữ liệu vào 1 "model" (xem buildModel trong
// tests/game_fortune_pig.spec.js), file này phân tích + dựng HTML. Không phụ thuộc Playwright nên chạy được bằng node thuần.
//
// Báo cáo gồm: kết luận + chỉ số chính; giao diện (từng nút / popup đạt - lỗi - lưu ý); tổng hợp theo mức cược; đối chiếu RULE
// (đúng / sai từng loại kiểm tra); đối chiếu LỊCH SỬ (đúng / sai từng trường); RTP thực tế so với RTP lý thuyết (kèm khoảng tin cậy);
// độ phủ tổ hợp đã gặp; Free Spin / gia hạn phiên / điểm nghi vấn; bảng chi tiết từng lượt quay.
//
// Ghi ra: test-results/game-report-<MÃ GAME>.html (+ .json) và bản lưu lâu dài test-history/game-reports/<ngày_giờ>_<MÃ GAME>.html
// (test-results/ bị xoá mỗi lần chạy `playwright test`, test-history/ thì không).
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------------------------------------------------
// Định dạng
// ---------------------------------------------------------------------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v, d = 2) => (isNum(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "-");
const pct = (v, d = 2) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : "-");
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const fmtDur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} phút ${s % 60} giây` : `${s} giây`;
};
const fmtTime = (ms) => new Date(ms).toLocaleString("vi-VN", { hour12: false });

// Nhãn tiếng Việt của từng loại kiểm tra rule (đúng thứ tự hiển thị). Khoá = `loại` trong mismatches / ruleTally của spec.
const RULE_LABELS = {
  status: "Response bet: status = 1, code = 0",
  stake: "Stake = mức cược đã chọn",
  baseStake: "baseStake = stake",
  betLines: "Số dòng cược (betLines) = 5",
  coinMultiplier: "Hệ số nhân thuộc x1 / x2 / x5 / x10",
  "symbol lạ": "Mọi symbol trên lưới đều có trong paytable (hoặc là BONUS)",
  "dòng thắng": "Dòng thắng (payline + rate) = tính lại từ lưới 3x3, 5 payline, WILD thay thế",
  "symbols dòng thắng": "Symbol của dòng thắng khớp lưới",
  winType: "winType đúng định dạng",
  payout: "Payout = Σ rate × (bet / số dòng) × hệ số nhân",
  rawPayout: "rawPayout = payout",
  winlose: "winlose = payout − stake",
  maxPayout: "Không vượt maxPayout; chạm trần thì payout = maxPayout",
  "dòng scatter": "Dòng scatter (payline -1, winType FreeSpin) có mặt khi và chỉ khi BONUS đủ 3 cột",
  "free spin": "Số Free Spin = 10 khi BONUS đủ 3 cột, ngược lại 0",
  accumulatedWinAmount: "accumulatedWinAmount = payout (vòng thường)",
  balance: "Balance sau = trước − bet + win (Free Spin: không trừ cược)",
  HUD: "HUD (BALANCE / WIN) khớp response",
  "Info bảng thưởng": "Bảng thưởng trong Info = rate × bet/line (mỗi ô symbol, mỗi mức cược)",
  "balance tổng": "Tổng: balance cuối = đầu − Σ bet + Σ win",
};
// `loại` của mismatches KHÔNG tính là lệch công thức rule của 1 lượt (đã có cột riêng hoặc không gắn với lượt)
const NON_RULE = new Set(["HUD", "lịch sử", "ngoại lệ", "Info bảng thưởng", "balance tổng"]);

// ---------------------------------------------------------------------------------------------------------------------
// Độ phủ: những công thức / tổ hợp đã thực sự gặp trong các lượt đã quay (rows = các phần tử game.report của spec)
// ---------------------------------------------------------------------------------------------------------------------
function buildCoverage(rows) {
  const base = rows.filter((r) => !r.fs);
  const cov = {
    lượtQuay: base.length,
    lượtThắng: base.filter((r) => r.winResponse > 0).length,
    lượtFreeSpinĐãChơi: rows.filter((r) => r.fs).length,
    lượtRespin: rows.filter((r) => r.respin).length,
    kíchHoạtFreeSpin: base.filter((r) => r.kíchHoạtFreeSpin).length,
    symbolTrongDòngThắng: Object.fromEntries(["Q", "K", "A", "Lantern", "Bag", "Ingot", "PigCool", "WILD"].map((s) => [s, 0])),
    paylineThắng: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    hệSốNhân: { 1: 0, 2: 0, 5: 0, 10: 0 },
    wildThamGiaDòngThắng: 0,
    lượtTừ2DòngThắng: 0,
    bonusTrênSốCột: { 0: 0, 1: 0, 2: 0, 3: 0 },
  };
  for (const r of rows) {
    cov.hệSốNhân[r._cov.coin] = (cov.hệSốNhân[r._cov.coin] || 0) + 1;
    cov.bonusTrênSốCột[r._cov.bonusReels] = (cov.bonusTrênSốCột[r._cov.bonusReels] || 0) + 1;
    if (r._cov.lines.length >= 2) cov.lượtTừ2DòngThắng++;
    for (const l of r._cov.lines) {
      cov.symbolTrongDòngThắng[l.sym] = (cov.symbolTrongDòngThắng[l.sym] || 0) + 1;
      cov.paylineThắng[l.payline]++;
      if (l.wilds > 0) cov.wildThamGiaDòngThắng++;
    }
  }
  cov.chưaGặp = [
    ...Object.entries(cov.symbolTrongDòngThắng).filter(([, v]) => v === 0).map(([k]) => `symbol ${k} chưa thắng lần nào (rate của ${k} CHƯA được kiểm chứng bằng dữ liệu thật)`),
    ...Object.entries(cov.paylineThắng).filter(([, v]) => v === 0).map(([k]) => `payline ${k} chưa thắng lần nào`),
    ...Object.entries(cov.hệSốNhân).filter(([, v]) => v === 0).map(([k]) => `hệ số nhân x${k} chưa xuất hiện`),
    ...(cov.wildThamGiaDòngThắng === 0 ? ["WILD chưa tham gia dòng thắng nào (thay thế symbol chưa kiểm chứng)"] : []),
    ...(cov.lượtTừ2DòngThắng === 0 ? ["chưa có lượt nào thắng từ 2 dòng trở lên"] : []),
    ...(cov.bonusTrênSốCột[3] === 0 ? ["BONUS chưa xuất hiện đủ cả 3 cột"] : []),
    ...(cov.kíchHoạtFreeSpin === 0 ? ["Free Spin chưa kích hoạt lần nào (công thức payout, balance và lịch sử trong Free Spin CHƯA được kiểm chứng)"] : []),
    ...(cov.lượtRespin === 0 ? ["respin / PigCool Sure Win chưa gặp lần nào"] : []),
  ];
  return cov;
}
const fmtObj = (o) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(" ");
const covLines = (cov) => [
  `Số lượt quay ${cov.lượtQuay}, lượt thắng ${cov.lượtThắng}; Free Spin kích hoạt ${cov.kíchHoạtFreeSpin}, response Free Spin đã chơi ${cov.lượtFreeSpinĐãChơi}, respin ${cov.lượtRespin}`,
  `Symbol trong dòng thắng: ${fmtObj(cov.symbolTrongDòngThắng)}`,
  `Payline thắng: ${fmtObj(cov.paylineThắng)}`,
  `Hệ số nhân (số vòng): ${fmtObj(cov.hệSốNhân)}`,
  `WILD tham gia dòng thắng: ${cov.wildThamGiaDòngThắng} dòng; lượt từ 2 dòng thắng: ${cov.lượtTừ2DòngThắng}`,
  `BONUS trên số cột (số vòng): ${fmtObj(cov.bonusTrênSốCột)}`,
  `CHƯA GẶP / CHƯA KIỂM CHỨNG: ${cov.chưaGặp.length ? cov.chưaGặp.join(" | ") : "(không có)"}`,
];

// ---------------------------------------------------------------------------------------------------------------------
// RTP thực tế = Σ tiền thắng / Σ tiền cược. Đơn vị tính là "round" (1 lượt quay + mọi Free Spin / respin cùng roundId; Free Spin
// không trừ cược). Khoảng tin cậy 95% theo ước lượng tỉ số (ratio estimator): SE = sqrt(Σ(win − RTP × cược)² / (n − 1) / n) / cược trung bình.
// Đây là ước lượng THÔ: phân phối thắng của slot lệch rất mạnh (thắng lớn hiếm) nên với mẫu nhỏ khoảng này thường quá hẹp.
// ---------------------------------------------------------------------------------------------------------------------
const MIN_ROUNDS_CI = 30; // ít hơn số lượt này thì không đưa ra nhận định thống kê về RTP
function rtpStats(rows, theoPct = null) {
  const rounds = new Map();
  for (const r of rows) {
    let x = rounds.get(r.roundId);
    if (!x) rounds.set(r.roundId, (x = { stake: 0, win: 0, base: 0 }));
    if (!r.fs) {
      x.stake += Number(r.bet) || 0;
      x.base += Number(r.winResponse) || 0;
    }
    x.win += Number(r.winResponse) || 0;
  }
  // Free Spin tiếp tục từ lần chạy trước (không có vòng kích hoạt trong lần này) -> không có tiền cược, loại khỏi RTP
  const list = [...rounds.values()].filter((x) => x.stake > 0);
  const n = list.length;
  const bet = sum(list, (x) => x.stake);
  const win = sum(list, (x) => x.win);
  const base = sum(list, (x) => x.base);
  const out = {
    rounds: n,
    excluded: rounds.size - n,
    bet,
    win,
    base,
    rtp: bet > 0 ? win / bet : null,
    rtpBase: bet > 0 ? base / bet : null,
    winRounds: list.filter((x) => x.win > 0).length,
    hitRate: n ? list.filter((x) => x.win > 0).length / n : null,
    bestMultiple: n ? Math.max(...list.map((x) => x.win / x.stake)) : null,
    se: null,
    lo: null,
    hi: null,
    sdReturn: null,
    needForPm1: null,
    theo: isNum(theoPct) ? theoPct / 100 : null,
    diff: null,
    inCi: null,
  };
  // Dưới MIN_ROUNDS_CI lượt, hoặc mẫu không có biến thiên nào (vd chưa thắng lần nào -> SE = 0), khoảng tin cậy vô nghĩa nên không tính
  out.small = n < MIN_ROUNDS_CI;
  const s2 = out.rtp !== null && n >= 2 ? sum(list, (x) => (x.win - out.rtp * x.stake) ** 2) / (n - 1) : 0;
  if (!out.small && s2 > 0) {
    const R = out.rtp;
    out.se = Math.sqrt(s2 / n) / (bet / n);
    out.lo = R - 1.96 * out.se;
    out.hi = R + 1.96 * out.se;
    const rets = list.map((x) => x.win / x.stake);
    const mean = sum(rets, (v) => v) / n;
    out.sdReturn = Math.sqrt(sum(rets, (v) => (v - mean) ** 2) / (n - 1));
    out.needForPm1 = Math.ceil(((1.96 * out.sdReturn) / 0.01) ** 2);
  }
  if (out.theo !== null && out.rtp !== null) {
    out.diff = out.rtp - out.theo;
    if (out.lo !== null) out.inCi = out.theo >= out.lo && out.theo <= out.hi;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Phân tích model -> số liệu để hiển thị / để spec dùng làm điều kiện fail
// ---------------------------------------------------------------------------------------------------------------------
function analyze(model) {
  const rows = model.rows || [];
  const mism = model.mismatches || [];
  const byLabel = new Map();
  for (const m of mism) {
    const k = String(m.lượt);
    if (!byLabel.has(k)) byLabel.set(k, []);
    byLabel.get(k).push(m);
  }
  const detail = rows.map((r) => {
    const ms = byLabel.get(String(r.lượt)) || [];
    return { ...r, ruleBad: ms.filter((m) => !NON_RULE.has(m.loại)), hudBad: ms.filter((m) => m.loại === "HUD") };
  });
  const base = detail.filter((r) => !r.fs);
  const rule = { responses: detail.length, ok: detail.filter((r) => r.ruleBad.length === 0).length };
  const hud = { checked: base.length, ok: base.filter((r) => r.hudBad.length === 0).length };
  const hist = { rounds: 0, ok: 0, fail: 0, missing: 0, notCompared: 0 };
  for (const r of base) {
    if (!r.lsStatus) hist.notCompared++;
    else {
      hist.rounds++;
      if (r.lsStatus === "PASS") hist.ok++;
      else if (r.lsStatus === "MISSING") hist.missing++;
      else hist.fail++;
    }
  }

  const allLevels = model.levels || [];
  const skippedSlots = allLevels.filter((l) => l.skipReason && !l.done).length;
  const levels = allLevels
    .filter((l) => !(l.skipReason && !l.done))
    .map((l) => {
      const lr = rows.filter((r) => r.mức === l.key);
      const mine = mism.filter((m) => lr.some((r) => r.lượt === m.lượt) || String(m.lượt).startsWith(`Info ${l.shortTitle}`));
      // Mức chưa hề bắt đầu (test của mức đó bị skip vì test trước lỗi, hoặc chỉ chạy riêng mức khác): KHÔNG phải lỗi của mức đó
      const notRun = l.hasSpec && l.amount === null && l.done === 0 && !l.failure && !l.aborted;
      const status = notRun
        ? "CHƯA CHẠY (test trước đó lỗi nên bị bỏ qua, hoặc chưa chạy tới mức này)"
        : l.failure
        ? `LỖI: ${l.failure}`
        : l.aborted
          ? `DỪNG DỞ: ${l.aborted}`
          : l.done === l.planned && mine.length === 0
            ? "ĐẠT"
            : l.done === l.planned
              ? "ĐỦ LƯỢT, CÓ LỆCH"
              : `THIẾU LƯỢT ${l.done}/${l.planned}`;
      return { ...l, status, notRun, mismatchCount: mine.length, rtp: rtpStats(lr, model.theoRtp), cov: buildCoverage(lr) };
    });
  const incomplete = levels.filter((l) => /^(LỖI|DỪNG DỞ|THIẾU)/.test(l.status));

  // Hạng mục giao diện = các hạng mục chk() của spec + trạng thái nút SPIN suy ra từ kết quả quay
  const spinChecks = levels
    .filter((l) => l.hasSpec)
    .map((l) => ({
      section: "Quay thật (nút SPIN)",
      name: `Nút SPIN ở mức ${l.title}: quay được ${l.done}/${l.planned} lượt`,
      status: l.notRun ? "SKIP" : l.failure || l.aborted || l.done < l.planned ? "FAIL" : "PASS",
      detail: l.notRun ? "mức này chưa chạy" : l.failure || l.aborted || "",
    }));
  const uiChecks = [...(model.checks || []), ...spinChecks];
  const uiCount = { total: uiChecks.length, PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
  for (const c of uiChecks) uiCount[c.status] = (uiCount[c.status] || 0) + 1;

  const notRun = levels.filter((l) => l.notRun);
  const problems = uiCount.FAIL + mism.length + incomplete.length;
  let verdict = "ĐẠT";
  let vcls = "ok";
  if (problems) {
    verdict = "KHÔNG ĐẠT";
    vcls = "bad";
  } else if (!base.length || notRun.length) {
    verdict = !base.length ? "CHƯA HOÀN TẤT (chưa có lượt quay nào)" : `CHƯA HOÀN TẤT (${notRun.length} mức cược chưa chạy)`;
    vcls = "warn";
  } else if (uiCount.WARN || (model.notes || []).some((n) => n.type === "nghi vấn")) {
    verdict = "ĐẠT (CÓ LƯU Ý)";
    vcls = "warn";
  }
  return { rows: detail, base, rule, hud, hist, levels, skippedSlots, incomplete, notRun, uiChecks, uiCount, problems, verdict, vcls, rtp: rtpStats(rows, model.theoRtp), cov: buildCoverage(rows) };
}

// ---------------------------------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------------------------------
const CHIP = { PASS: ["ok", "ĐẠT"], FAIL: ["bad", "LỖI"], WARN: ["warn", "LƯU Ý"], SKIP: ["skip", "BỎ QUA"] };
const chip = (s, text) => {
  const [c, l] = CHIP[s] || ["skip", s];
  return `<span class="chip ${c}">${esc(text || l)}</span>`;
};
const okBad = (ok, okText = "ĐÚNG", badText = "SAI", tip = "") => `<span class="chip ${ok ? "ok" : "bad"}"${tip ? ` title="${esc(tip)}"` : ""}>${ok ? okText : badText}</span>`;
const th = (cols) => `<thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>`;
const tr = (cells, cls = "") => `<tr${cls ? ` class="${cls}"` : ""}>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const table = (cols, rows, cls = "") => `<div class="wrap"><table${cls ? ` class="${cls}"` : ""}>${th(cols)}<tbody>${rows.join("")}</tbody></table></div>`;
const section = (id, title, body) => `<section id="${id}"><h2>${title}</h2>${body}</section>`;
const kpi = (label, value, sub, cls = "") => `<div class="kpi ${cls}"><div class="kl">${label}</div><div class="kv">${value}</div><div class="ks">${sub || "&nbsp;"}</div></div>`;

function uiSection(a) {
  const c = a.uiCount;
  let html = `<p class="lead">${c.total} hạng mục: ${chip("PASS", `${c.PASS} đạt`)} ${chip("FAIL", `${c.FAIL} lỗi`)} ${chip("WARN", `${c.WARN} lưu ý`)} ${chip("SKIP", `${c.SKIP} bỏ qua`)}</p>`;
  const groups = new Map();
  for (const x of a.uiChecks) {
    if (!groups.has(x.section)) groups.set(x.section, []);
    groups.get(x.section).push(x);
  }
  for (const [name, list] of groups) {
    const ok = list.filter((x) => x.status === "PASS").length;
    html += `<h3>${esc(name)} <small>${ok}/${list.length} đạt</small></h3>`;
    html += table(["Hạng mục", "Kết quả", "Chi tiết"], list.map((x) => tr([esc(x.name), chip(x.status), `<span class="detail">${esc(x.detail)}</span>`], x.status === "FAIL" ? "rowbad" : "")), "ui");
  }
  return html || "<p>Chưa có hạng mục giao diện nào được chạy.</p>";
}

function levelsSection(a, m) {
  if (!a.levels.length) return "<p>Chưa có mức cược nào được chạy.</p>";
  const rows = a.levels.map((l) => {
    const x = l.rtp;
    const cls = /^(LỖI|DỪNG DỞ|THIẾU|ĐỦ LƯỢT)/.test(l.status) ? "rowbad" : "";
    return tr(
      [
        esc(l.title) + (l.hasSpec ? "" : " <small>(Free Spin còn dở từ lần trước)</small>"),
        `${l.done}/${l.planned}`,
        num(l.paid),
        num(l.won),
        `<b>${pct(x.rtp)}</b>`,
        pct(x.hitRate, 1),
        x.bestMultiple != null ? `x${num(x.bestMultiple, 1)}` : "-",
        l.maxWinHits,
        l.mismatchCount,
        l.notRun ? chip("SKIP", "CHƯA CHẠY") : l.status === "ĐẠT" ? chip("PASS") : chip("FAIL", l.status.slice(0, 70)),
      ],
      cls,
    );
  });
  let html = table(["Mức cược", "Đã quay / kế hoạch", "Tổng cược", "Tổng thắng", "RTP mức này", "Lượt thắng", "Thắng lớn nhất", "Chạm trần", "Số lệch", "Trạng thái"], rows);
  if (a.skippedSlots) html += `<p class="note">${a.skippedSlots} ô mức cược bị bỏ qua (GAME_BETS=all tạo sẵn ô vượt quá số mệnh giá thật của bản này).</p>`;
  for (const l of a.levels.filter((x) => x.infoNotes && x.infoNotes.length)) html += `<p class="note">Info ở mức ${esc(l.title)}: ${esc(l.infoNotes.join(" | "))}</p>`;
  return html;
}

function ruleSection(a, m) {
  const t = m.ruleTally || {};
  const keys = [...Object.keys(RULE_LABELS).filter((k) => t[k]), ...Object.keys(t).filter((k) => !(k in RULE_LABELS))];
  let html = `<p class="lead">${a.rule.responses ? `<b>${a.rule.ok}/${a.rule.responses}</b> response bet đúng toàn bộ công thức rule` : "Chưa có response bet nào."}${a.rule.responses > a.base.length ? ` (gồm ${a.rule.responses - a.base.length} response Free Spin / respin)` : ""}.</p>`;
  if (keys.length) {
    html += table(
      ["Kiểm tra", "Số lần kiểm", "Đúng", "Sai", "Kết quả"],
      keys.map((k) => {
        const x = t[k];
        return tr([esc(RULE_LABELS[k] || k), x.checked, x.checked - x.failed, x.failed, okBad(x.failed === 0)], x.failed ? "rowbad" : "");
      }),
    );
  }
  return html;
}

function historySection(a, m) {
  const t = m.histTally || {};
  const h = a.hist;
  const hi = m.historyInfo || {};
  let html = `<p class="lead">${h.rounds ? `<b>${h.ok}/${h.rounds}</b> round khớp hoàn toàn với bản ghi lịch sử` : "Chưa đối chiếu được round nào với lịch sử."}${h.fail ? `, <b>${h.fail}</b> round lệch` : ""}${h.missing ? `, <b>${h.missing}</b> round không có bản ghi` : ""}${h.notCompared ? `, ${h.notCompared} lượt chưa đối chiếu` : ""}.${hi.recordsToday != null ? ` API lịch sử trả ${hi.recordsToday} bản ghi trong ngày; so thêm dòng hiển thị trong popup cho ${hi.uiChecked || 0} round.` : ""}</p>`;
  const keys = Object.keys(t);
  if (keys.length) {
    html += table(
      ["Trường đối chiếu (bản ghi lịch sử = response bet)", "Số lần kiểm", "Đúng", "Sai", "Kết quả"],
      keys.map((k) => {
        const x = t[k];
        return tr([esc(k), x.checked, x.checked - x.failed, x.failed, okBad(x.failed === 0)], x.failed ? "rowbad" : "");
      }),
    );
  }
  return html;
}

function rtpSection(a, m) {
  const t = a.rtp;
  const theo = m.theoRtp;
  const ci = (x) => (x.lo != null ? `${pct(x.lo)} – ${pct(x.hi)}` : "-");
  const row = (name, x) => tr([esc(name), x.rounds, num(x.bet), num(x.win), `<b>${pct(x.rtp)}</b>`, pct(x.rtpBase), ci(x), pct(x.hitRate, 1), x.bestMultiple != null ? `x${num(x.bestMultiple, 1)}` : "-"]);
  const body = [row("TỔNG (gồm Free Spin)", t), ...a.levels.filter((l) => l.hasSpec && l.rtp.rounds).map((l) => row(`Mức ${l.title}`, l.rtp))];
  let html = "";
  let verdict;
  let vcls = "note";
  if (!isNum(theo)) verdict = "Không đọc được RTP lý thuyết từ màn Info (test Info chưa chạy hoặc lỗi) - chỉ báo RTP thực tế.";
  else if (t.rtp === null) verdict = `RTP lý thuyết (màn Info): ${theo}%. Chưa có lượt quay nào để tính RTP thực tế.`;
  else if (t.small) verdict = `RTP lý thuyết (màn Info): <b>${theo}%</b>. RTP thực tế sau <b>${t.rounds}</b> lượt: <b>${pct(t.rtp)}</b>. Mẫu quá nhỏ (dưới ${MIN_ROUNDS_CI} lượt) nên KHÔNG đủ để so sánh thống kê với RTP lý thuyết; tăng GAME_SPINS để có số liệu có ý nghĩa.`;
  else {
    const d = (t.rtp - theo / 100) * 100;
    verdict =
      `RTP lý thuyết (màn Info): <b>${theo}%</b>. RTP thực tế sau <b>${t.rounds}</b> lượt: <b>${pct(t.rtp)}</b> (${d >= 0 ? "+" : ""}${d.toFixed(2)} điểm %). ` +
      (t.inCi === true
        ? "RTP lý thuyết nằm TRONG khoảng tin cậy 95% của mẫu: chưa có dấu hiệu lệch so với RTP công bố."
        : t.inCi === false
          ? "RTP lý thuyết nằm NGOÀI khoảng tin cậy 95% của mẫu (ước lượng thô): chênh lệch đáng chú ý, cần quay thêm (tăng GAME_SPINS) trước khi kết luận."
          : "Mẫu chưa có biến thiên (vd chưa thắng lần nào) nên chưa tính được khoảng tin cậy.");
    vcls = t.inCi === false ? "note warnbox" : "note okbox";
  }
  html += `<p class="${vcls}">${verdict}</p>`;
  html += table(["Phạm vi", "Số lượt (round)", "Tổng cược", "Tổng thắng", "RTP thực tế", "RTP chưa tính Free Spin", "Khoảng tin cậy 95%", "Tỉ lệ lượt thắng", "Thắng lớn nhất"], body);
  html += `<p class="note">RTP = Σ tiền thắng / Σ tiền cược; 1 lượt = 1 round (vòng quay + mọi Free Spin / respin cùng roundId, Free Spin không trừ cược).${t.excluded ? ` Loại ${t.excluded} round Free Spin tiếp tục từ lần chạy trước (không có tiền cược trong lần này).` : ""}</p>`;
  html += `<p class="note">Lưu ý thống kê: RTP là kỳ vọng DÀI HẠN. Phân phối thắng của slot lệch mạnh (thắng lớn và Free Spin hiếm) nên với vài chục lượt, RTP thực tế có thể lệch rất xa RTP công bố mà game vẫn đúng, và khoảng tin cậy ở trên là ước lượng thô thường quá hẹp khi mẫu chưa gặp thắng lớn.${t.needForPm1 ? ` Để sai số ±1 điểm % cần cỡ ${t.needForPm1.toLocaleString("en-US")} lượt (ước lượng từ độ lệch chuẩn mẫu, thường thấp hơn thực tế).` : ""} Vì vậy RTP chỉ để THAM KHẢO, không dùng làm điều kiện đạt / lỗi của test; tính đúng của từng lượt được kiểm ở mục "Đối chiếu rule".</p>`;
  return html;
}

function coverageSection(a) {
  const c = a.cov;
  const cells = (o, zeroWarn = true) => Object.entries(o).map(([k, v]) => `<span class="pill${zeroWarn && v === 0 ? " zero" : ""}">${esc(k)}: ${v}</span>`).join(" ");
  let html = table(
    ["Hạng mục", "Số lần gặp"],
    [
      tr(["Lượt quay / lượt thắng", `${c.lượtQuay} / ${c.lượtThắng}`]),
      tr(["Symbol trong dòng thắng", cells(c.symbolTrongDòngThắng)]),
      tr(["Payline thắng (1 giữa, 2 trên, 3 dưới, 4 chéo ↘, 5 chéo ↗)", cells(c.paylineThắng)]),
      tr(["Hệ số nhân (số vòng)", cells(c.hệSốNhân)]),
      tr(["WILD tham gia dòng thắng", c.wildThamGiaDòngThắng]),
      tr(["Lượt thắng từ 2 dòng trở lên", c.lượtTừ2DòngThắng]),
      tr(["BONUS trên số cột (số vòng)", cells(c.bonusTrênSốCột, false)]),
      tr(["Free Spin kích hoạt / response Free Spin đã chơi / respin", `${c.kíchHoạtFreeSpin} / ${c.lượtFreeSpinĐãChơi} / ${c.lượtRespin}`]),
    ],
  );
  html += c.chưaGặp.length
    ? `<p class="note warnbox"><b>Chưa gặp / chưa được kiểm chứng bằng dữ liệu thật:</b></p><ul>${c.chưaGặp.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
    : `<p class="note okbox">Đã gặp đủ mọi tổ hợp theo dõi.</p>`;
  return html;
}

function miscSection(m) {
  let html = "";
  const fsq = m.fsSequences || [];
  html += `<h3>Free Spin / respin</h3>`;
  html += fsq.length
    ? table(["Lượt kích hoạt", "Mức", "Round kích hoạt", "Số response", "Respin", "Tổng payout"], fsq.map((s) => tr([esc(s.label), esc(s.mức), esc(s.trigger), s.responses, s.respins, num(s.payout, 4)])))
    : "<p>Không có Free Spin / respin nào được kích hoạt trong lần chạy này.</p>";
  const rn = m.renewals || [];
  html += `<h3>Gia hạn phiên game</h3>`;
  html += rn.length ? table(["Lúc", "Lý do", "Mất (giây)"], rn.map((r) => tr([esc(r.lúc), esc(r.lýDo), r.mấtGiây]))) : "<p>Không phải gia hạn phiên.</p>";
  const notes = m.notes || [];
  html += `<h3>Điểm nghi vấn / ghi chú</h3>`;
  if (!notes.length) html += "<p>Không có.</p>";
  else {
    const groups = new Map();
    for (const n of notes) {
      if (!groups.has(n.type)) groups.set(n.type, []);
      groups.get(n.type).push(n.description);
    }
    for (const [type, list] of groups) html += `<p class="gt"><b>${esc(type)}</b> (${list.length})</p><ul>${list.slice(0, 40).map((d) => `<li>${esc(d)}</li>`).join("")}${list.length > 40 ? `<li>... còn ${list.length - 40} mục (xem file .json)</li>` : ""}</ul>`;
  }
  return html;
}

function spinsSection(a, m) {
  if (!a.rows.length) return "<p>Chưa có lượt quay nào.</p>";
  const tip = (list) => list.map((x) => `${x.loại}: ${x.chiTiết}`).join("\n");
  const rows = a.rows.map((r, i) => {
    const ruleCell = okBad(r.ruleBad.length === 0, "ĐÚNG", "SAI", tip(r.ruleBad));
    const hudCell = r.fs ? "–" : okBad(r.hudBad.length === 0, "ĐÚNG", "SAI", tip(r.hudBad));
    let histCell = "–";
    if (!r.fs) {
      if (!r.lsStatus) histCell = '<span class="chip skip">CHƯA ĐỐI CHIẾU</span>';
      else if (r.lsStatus === "MISSING") histCell = '<span class="chip bad">KHÔNG CÓ BẢN GHI</span>';
      else histCell = okBad(r.lsStatus === "PASS", "KHỚP", "LỆCH", (r.lsDiffs || []).join("\n"));
    }
    const bad = r.ruleBad.length || r.hudBad.length || r.lsStatus === "FAIL" || r.lsStatus === "MISSING";
    return tr(
      [
        i + 1,
        esc(r.lượt) + (r.fs ? ' <span class="pill">FS</span>' : "") + (r.kíchHoạtFreeSpin ? ' <span class="pill">kích hoạt FS</span>' : ""),
        num(r.bet),
        `<code>${esc(r.lưới)}</code>`,
        esc(r.dòngThắng),
        `x${r.hệSốNhân}`,
        num(r.winResponse, 4),
        num(r.winTínhLại, 4),
        `${num(r.balanceTrước)} → ${num(r.balanceSau)}`,
        ruleCell,
        hudCell,
        histCell,
      ],
      bad ? "rowbad" : "",
    );
  });
  let html = `<p class="lead">Lưới 3x3: mỗi [..] là 1 cột (trên → dưới). "Win response" là tiền thắng game trả về, "Win tính lại" là Σ rate × bet/line × hệ số nhân theo rule.</p>`;
  html += table(["#", "Lượt", "Bet", "Lưới (cột 1 2 3)", "Dòng thắng", "Nhân", "Win response", "Win tính lại", "Balance trước → sau", "Rule", "HUD", "Lịch sử"], rows, "dense");
  const mm = m.mismatches || [];
  html += `<h3>Danh sách điểm lệch (${mm.length})</h3>`;
  html += mm.length
    ? table(["Lượt", "Round", "Loại", "Chi tiết", "Lưới", "Win tính lại", "Win response"], mm.slice(0, 300).map((x) => tr([esc(x.lượt), esc(x.round), esc(x.loại), esc(x.chiTiết), `<code>${esc(x.lưới)}</code>`, x.winTínhLại ?? "-", x.winResponse ?? "-"], "rowbad"))) + (mm.length > 300 ? `<p class="note">Chỉ hiện 300 / ${mm.length} điểm lệch đầu tiên (đủ trong file .json).</p>` : "")
    : '<p class="note okbox">Không có điểm lệch nào.</p>';
  return html;
}

const CSS = `
:root{--bg:#f5f6f8;--card:#fff;--text:#1d2330;--muted:#667085;--line:#e4e7ec;--ok:#067647;--okbg:#e7f6ee;--bad:#b42318;--badbg:#fdeceb;--warn:#a15c07;--warnbg:#fff4de;--skip:#475467;--skipbg:#eef0f4;--accent:#175cd3}
@media (prefers-color-scheme:dark){:root{--bg:#14171d;--card:#1c2028;--text:#e8ebf0;--muted:#9aa4b5;--line:#2c3340;--ok:#5bd49a;--okbg:#12301f;--bad:#ff8a80;--badbg:#3a1b19;--warn:#f0b35a;--warnbg:#3a2d12;--skip:#aab3c2;--skipbg:#262c36;--accent:#7cb0ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1280px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:34px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--line)}h3{font-size:15px;margin:22px 0 8px}h3 small{color:var(--muted);font-weight:400}
.meta{color:var(--muted);font-size:13px}.meta b{color:var(--text)}
.verdict{display:inline-block;margin:10px 0 4px;padding:6px 16px;border-radius:8px;font-weight:700;font-size:16px}
.verdict.ok{background:var(--okbg);color:var(--ok)}.verdict.bad{background:var(--badbg);color:var(--bad)}.verdict.warn{background:var(--warnbg);color:var(--warn)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:14px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px}.kpi .kl{color:var(--muted);font-size:12px}.kpi .kv{font-size:22px;font-weight:700}.kpi .ks{color:var(--muted);font-size:12px}
.kpi.ok .kv{color:var(--ok)}.kpi.bad .kv{color:var(--bad)}.kpi.warn .kv{color:var(--warn)}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%}th,td{padding:7px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
th{background:var(--skipbg);font-weight:600;font-size:12px;color:var(--muted);white-space:nowrap}tr:last-child td{border-bottom:0}
table.dense td,table.dense th{padding:5px 8px;font-size:12.5px}
table.ui{table-layout:fixed}table.ui th:nth-child(1){width:46%}table.ui th:nth-child(2){width:100px}
tr.rowbad td{background:var(--badbg)}code{font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:nowrap}
.chip{display:inline-block;padding:1px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.chip.ok{background:var(--okbg);color:var(--ok)}.chip.bad{background:var(--badbg);color:var(--bad)}.chip.warn{background:var(--warnbg);color:var(--warn)}.chip.skip{background:var(--skipbg);color:var(--skip)}
.pill{display:inline-block;padding:0 8px;border-radius:6px;background:var(--skipbg);font-size:12px;margin:1px 2px}.pill.zero{background:var(--warnbg);color:var(--warn)}
.detail{color:var(--muted);font-size:12.5px;word-break:break-word}.lead{margin:6px 0 10px}
.note{color:var(--muted);font-size:13px;margin:8px 0}.note.okbox,.note.warnbox{padding:8px 12px;border-radius:8px;color:var(--text)}.note.okbox{background:var(--okbg)}.note.warnbox{background:var(--warnbg)}
ul{margin:4px 0 10px 20px;padding:0}li{margin:2px 0;word-break:break-word}.gt{margin:10px 0 0}
nav{margin:10px 0}nav a{color:var(--accent);text-decoration:none;margin-right:14px;font-size:13px}
`;

function renderGameReport(model) {
  const m = model;
  const a = analyze(m);
  const c = a.uiCount;
  const t = a.rtp;
  const totalBet = t.bet;
  const theo = m.theoRtp;
  const cfg = m.config || {};
  const bal = m.balance || {};
  const kpis = [
    kpi("Giao diện", `${c.PASS}/${c.total}`, `${c.FAIL} lỗi, ${c.WARN} lưu ý, ${c.SKIP} bỏ qua`, c.FAIL ? "bad" : c.WARN ? "warn" : "ok"),
    kpi("Lượt quay thật", a.base.length, `cược ${num(totalBet)} ${esc(m.currency)}, thắng ${num(t.win)}`),
    kpi("Đối chiếu rule", a.rule.responses ? `${a.rule.ok}/${a.rule.responses}` : "-", "response đúng toàn bộ công thức", a.rule.responses ? (a.rule.ok === a.rule.responses ? "ok" : "bad") : ""),
    kpi("Đối chiếu lịch sử", a.hist.rounds ? `${a.hist.ok}/${a.hist.rounds}` : "-", "round khớp bản ghi lịch sử", a.hist.rounds ? (a.hist.ok === a.hist.rounds ? "ok" : "bad") : ""),
    kpi("HUD khớp response", a.hud.checked ? `${a.hud.ok}/${a.hud.checked}` : "-", "balance + win hiển thị", a.hud.checked ? (a.hud.ok === a.hud.checked ? "ok" : "bad") : ""),
    kpi("RTP thực tế", pct(t.rtp), isNum(theo) ? `lý thuyết ${theo}% (tham khảo, ${t.rounds} lượt)` : `${t.rounds} lượt`),
  ];
  const nav = [["ui", "1. Giao diện"], ["levels", "2. Theo mức cược"], ["rule", "3. Đối chiếu rule"], ["history", "4. Đối chiếu lịch sử"], ["rtp", "5. RTP"], ["cov", "6. Độ phủ"], ["misc", "7. Free Spin / lưu ý"], ["spins", "8. Từng lượt quay"]];
  const body = [
    `<h1>Báo cáo kiểm thử game Fortune Pig Cool - ${esc(m.code)}</h1>`,
    `<div class="meta">Chạy lúc <b>${fmtTime(m.startedAt)}</b>, kéo dài <b>${fmtDur((m.finishedAt || Date.now()) - m.startedAt)}</b>. Cấu hình: GAME_BETS=<b>${esc(cfg.bets)}</b>, GAME_SPINS=<b>${esc(cfg.spins)}</b> lượt / mức, trần chi phí ${num(cfg.maxCost, 0)} ${esc(m.currency)}. Balance: lúc mở game <b>${num(bal.opening)}</b> → cuối <b>${num(bal.final)}</b> ${esc(m.currency)}${isNum(bal.first) && isNum(bal.last) ? ` (lượt đầu trước khi quay ${num(bal.first)}, lượt cuối sau khi quay ${num(bal.last)})` : ""}.${m.infoVersion ? ` Phiên bản game (màn Info): <b>${esc(m.infoVersion)}</b>.` : ""}</div>`,
    `<div class="verdict ${a.vcls}">KẾT LUẬN: ${esc(a.verdict)}</div>`,
    a.problems ? `<div class="meta">${a.uiCount.FAIL} hạng mục giao diện lỗi, ${(m.mismatches || []).length} điểm lệch rule / lịch sử / HUD, ${a.incomplete.length} mức cược chưa quay đủ.</div>` : "",
    `<div class="kpis">${kpis.join("")}</div>`,
    `<nav>${nav.map(([id, l]) => `<a href="#${id}">${l}</a>`).join("")}</nav>`,
    section("ui", "1. Giao diện: nút / popup hoạt động tốt hay lỗi", uiSection(a)),
    section("levels", "2. Tổng hợp theo mức cược", levelsSection(a, m)),
    section("rule", "3. Đối chiếu kết quả quay với RULE game (đúng / sai)", ruleSection(a, m)),
    section("history", "4. Đối chiếu lượt quay với LỊCH SỬ (đúng / sai)", historySection(a, m)),
    section("rtp", "5. RTP thực tế so với RTP lý thuyết", rtpSection(a, m)),
    section("cov", "6. Độ phủ: tổ hợp đã thực sự gặp khi quay", coverageSection(a)),
    section("misc", "7. Free Spin, gia hạn phiên, điểm nghi vấn", miscSection(m)),
    section("spins", "8. Chi tiết từng lượt quay", spinsSection(a, m)),
  ];
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Báo cáo game ${esc(m.code)}</title><style>${CSS}</style></head><body><main>${body.join("\n")}</main></body></html>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ghi file: dir = nơi ghi bản mới nhất (ghi đè); historyDir = nơi lưu lâu dài (mỗi lần chạy 1 file theo ngày giờ)
// ---------------------------------------------------------------------------------------------------------------------
function stamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
function writeGameReport(model, { dir, historyDir }) {
  const html = renderGameReport(model);
  const json = JSON.stringify(model, null, 2);
  const out = [];
  const write = (d, base) => {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${base}.html`), html, "utf8");
    fs.writeFileSync(path.join(d, `${base}.json`), json, "utf8");
    out.push(path.join(d, `${base}.html`));
  };
  if (dir) write(dir, `game-report-${model.code}`);
  if (historyDir) write(historyDir, `${stamp(model.startedAt)}_${model.code}`);
  return out;
}

module.exports = { analyze, rtpStats, buildCoverage, covLines, renderGameReport, writeGameReport, RULE_LABELS };
