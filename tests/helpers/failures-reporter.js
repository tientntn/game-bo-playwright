// Reporter tự viết: gom mọi test FAIL của lần chạy vào 1 file Markdown dễ đọc cho QA: test-results/failures.md
//
// Khác error-context.md (mỗi test 1 file, kèm cây ARIA dài, viết cho AI), file này:
//   - Gom theo LOẠI lỗi để QA biết cần làm gì: lỗi app đã biết / sai kết quả (nghi bug) / timeout / mạng rớt.
//   - Mỗi lỗi có: màn hình, test kiểm tra gì, kết quả mong đợi vs thực tế, CÁC BƯỚC đã thực hiện (tự dịch từ log của
//     Playwright), ảnh chụp lúc fail, và lệnh chạy lại đúng test đó.
//
// Cấu hình trong playwright.config.js:  reporter: [..., ["./tests/helpers/failures-reporter.js"]]
const fs = require("fs");
const path = require("path");

const OUTPUT = path.resolve(process.cwd(), "test-results", "failures.md");
const MAX_STEPS = 18; // số bước gần nhất (trước chỗ lỗi) hiển thị cho mỗi test
const MAX_ERROR_LINES = 14;

const stripAnsi = (s) => String(s || "").replace(/\u001b\[[0-9;]*m/g, "");
const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, "/");

// ---------------------------------------------------------------------------
// Phân loại lỗi
// ---------------------------------------------------------------------------
const CATEGORIES = {
  known: {
    title: "Lỗi app đã biết (chờ dev sửa)",
    note: "Test được viết để FAIL cho tới khi app sửa (có chú thích \"LỖI ỨNG DỤNG\" trong spec). Không cần điều tra thêm, chỉ cần báo / theo dõi bug.",
  },
  assertion: {
    title: "Sai kết quả - cần xem (nghi bug hoặc test cần cập nhật)",
    note: "Màn hình trả về khác với mong đợi. Làm theo \"Các bước\" bên dưới trên BO để tự kiểm tra: nếu BO đúng thì sửa test, nếu BO sai thì là bug.",
  },
  timeout: {
    title: "Timeout - server hoặc trang phản hồi chậm",
    note: "Thường do server dev quá tải (nhất là khi chạy nhiều worker) chứ chưa chắc là bug. Chạy lại đúng test bằng lệnh bên dưới; nếu chạy riêng vẫn fail thì kiểm tra thủ công bằng các bước.",
  },
  network: {
    title: "Mạng / môi trường (rớt mạng, đổi mạng, không phân giải được domain)",
    note: "Không phải lỗi test. Kiểm tra mạng / VPN rồi chạy lại.",
  },
};

function classify(test, result, error) {
  const msg = stripAnsi(error && (error.message || error.value) || "");
  if (/ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_ABORTED|ERR_TIMED_OUT|ERR_PROXY/i.test(msg)) {
    return "network";
  }
  if (hasKnownBugMarker(test)) return "known";
  if (/Timeout \d+ms exceeded|Test timeout of \d+ms exceeded|waitForResponse|waitForRequest/i.test(msg) && !/expect\(/.test(msg.split("\n")[0])) {
    return "timeout";
  }
  // TypeError kiểu "Cannot read properties of undefined (reading 'list')": response không về -> dữ liệu rỗng
  if (/Cannot read properties of undefined/.test(msg)) return "timeout";
  return "assertion";
}

// Test được đánh dấu lỗi app đã biết bằng comment "LỖI ỨNG DỤNG" ngay phía trên test (tối đa ~8 dòng)
const sourceCache = new Map();
function hasKnownBugMarker(test) {
  try {
    const file = test.location.file;
    if (!sourceCache.has(file)) sourceCache.set(file, fs.readFileSync(file, "utf8").split(/\r?\n/));
    const lines = sourceCache.get(file);
    const from = Math.max(0, test.location.line - 9);
    return lines.slice(from, test.location.line).some((l) => /LỖI ỨNG DỤNG ĐÃ XÁC NHẬN|LỖI ỨNG DỤNG \(/.test(l));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Dịch log của Playwright thành các bước dễ đọc
// ---------------------------------------------------------------------------
// getByRole('button', { name: 'Next', exact: true }) -> nút "Next"
function humanLocator(s) {
  return String(s)
    .replace(/\.filter\(\{ hasText: \/\^\\s\*(.*?)\\s\*\$\/\w* \}\)/g, ' có chữ "$1"')
    .replace(/\.filter\(\{ hasText: '([^']*)' \}\)/g, ' có chữ "$1"')
    .replace(/getByRole\('(\w+)', \{ name: (?:'([^']*)'|\/(.*?)\/\w*)[^}]*\}\)/g, (_, role, name, re) => {
      const roleVi = { button: "nút", link: "link", checkbox: "checkbox", tab: "tab", menuitem: "menu", columnheader: "cột", textbox: "ô nhập", combobox: "ô chọn", row: "dòng", dialog: "hộp thoại" }[role] || role;
      return `${roleVi} "${name ?? re}"`;
    })
    .replace(/getByRole\('(\w+)'\)/g, "$1")
    .replace(/getByPlaceholder\('([^']*)'\)/g, 'ô có placeholder "$1"')
    .replace(/getByText\('([^']*)'(?:, \{[^}]*\})?\)/g, 'chữ "$1"')
    .replace(/getByLabel\('([^']*)'\)/g, 'ô "$1"')
    .replace(/getByTitle\('([^']*)'\)/g, 'icon "$1"')
    .replace(/getByTestId\('([^']*)'\)/g, 'phần tử "$1"');
}

// Trả về chuỗi tiếng Việt cho 1 step, hoặc null nếu step không đáng hiển thị
function humanizeStep(step) {
  const t = stripAnsi(step.title || "").trim();
  if (!t) return null;
  if (step.category === "hook" || step.category === "fixture") return null;
  if (/^(Before Hooks|After Hooks|Worker Cleanup|Fixture|Attach|Create context|Create page|Launch browser|Close context|Evaluate|Wait for event|Request ghi dữ liệu)/i.test(t)) return null;

  let m;
  if ((m = t.match(/^(?:Navigate to|page\.goto)\s+"?([^"]+)"?/i))) return `Mở trang \`${m[1]}\``;
  if ((m = t.match(/^Reload/i))) return "Tải lại trang (F5)";
  if ((m = t.match(/^Click\s+(.*)/i))) return `Bấm ${humanLocator(m[1])}`;
  if ((m = t.match(/^Fill\s+"(.*?)"\s+(.*)$/i))) return `Nhập "${m[1]}" vào ${humanLocator(m[2])}`;
  if ((m = t.match(/^Fill\s+(.*)/i))) return `Xoá / nhập ${humanLocator(m[1])}`;
  if ((m = t.match(/^Hover\s+(.*)/i))) return `Rê chuột vào ${humanLocator(m[1])}`;
  if ((m = t.match(/^(?:Press|Type)\s+(.*)/i))) return `Gõ phím / nhập ${humanLocator(m[1])}`;
  if ((m = t.match(/^Check\s+(.*)/i))) return `Tích chọn ${humanLocator(m[1])}`;
  if ((m = t.match(/^Select\s+(.*)/i))) return `Chọn ${humanLocator(m[1])}`;
  if ((m = t.match(/^Wait for (?:response|request)\s*(.*)/i))) return `Chờ API phản hồi ${m[1] ? "(" + m[1].slice(0, 80) + ")" : ""}`.trim();
  if ((m = t.match(/^Wait for (?:load state|navigation|URL)\s*(.*)/i))) return null; // nhiễu
  if ((m = t.match(/^Wait for (?:selector|locator)?\s*(.*)/i))) return `Chờ ${humanLocator(m[1])} xuất hiện`;
  if ((m = t.match(/^Expect "(\w+)"(?:\s*(.*))?/))) {
    const what = {
      toBeVisible: "hiển thị", toBeHidden: "ẩn", toHaveCount: "có đúng số lượng", toHaveText: "có đúng chữ",
      toContainText: "chứa chữ", toHaveValue: "có đúng giá trị", toBeEnabled: "bật (click được)", toBeDisabled: "bị khoá",
      toBeChecked: "được tích", toHaveURL: "đúng địa chỉ URL", toHaveAttribute: "có đúng thuộc tính", toBeEmpty: "rỗng",
      toHaveClass: "có đúng class", toBeAttached: "tồn tại trên trang",
      toEqual: "so sánh kết quả thực tế với mong đợi", toBe: "so sánh kết quả thực tế với mong đợi",
      toMatchObject: "so sánh kết quả thực tế với mong đợi", toContain: "kết quả có chứa giá trị mong đợi",
      toBeGreaterThan: "giá trị lớn hơn mong đợi", toMatch: "kết quả khớp mẫu mong đợi",
    }[m[1]] || m[1];
    return `Kiểm tra: ${what}${m[2] ? " " + humanLocator(m[2]) : ""}`;
  }
  if (step.category === "test.step") return `**${t}**`;
  if (step.category === "pw:api" || step.category === "expect") return t.length > 140 ? t.slice(0, 137) + "..." : t;
  return null;
}

// Duyệt cây step theo thứ tự thời gian, bỏ trùng liên tiếp
function flattenSteps(steps, out = []) {
  for (const s of steps || []) {
    const text = humanizeStep(s);
    if (text) out.push({ text, failed: !!s.error });
    // bước con của pw:api (log nội bộ) không cần; chỉ đi sâu vào hook / test.step / hàm bọc
    if (s.steps && s.steps.length && s.category !== "pw:api" && s.category !== "expect") flattenSteps(s.steps, out);
  }
  return out;
}

function stepsOf(result) {
  const flat = flattenSteps(result.steps);
  const dedup = [];
  for (const s of flat) {
    const last = dedup[dedup.length - 1];
    if (last && last.text === s.text) continue;
    dedup.push(s);
  }
  const failedAt = dedup.findIndex((x) => x.failed);
  const upToFail = failedAt >= 0 ? dedup.slice(0, failedAt + 1) : dedup; // bỏ các bước dọn dẹp sau chỗ lỗi
  return upToFail.slice(-MAX_STEPS);
}

// ---------------------------------------------------------------------------
// Trình bày lỗi
// ---------------------------------------------------------------------------
function shortError(error) {
  const lines = stripAnsi(error && (error.message || error.value) || "Không rõ lỗi").split("\n");
  // bỏ call log và code frame, chỉ giữ phần mô tả
  const out = [];
  for (const l of lines) {
    if (/^\s*Call log:/.test(l) || /^\s*at .*\(.*:\d+:\d+\)/.test(l) || /^\s+\d+ \|/.test(l) || /^\s*>\s*\d+ \|/.test(l)) break;
    out.push(l.trimEnd());
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.slice(0, MAX_ERROR_LINES).join("\n");
}

function screenshotOf(result, baseDir) {
  const a = (result.attachments || []).find((x) => x.name === "screenshot" && x.path);
  return a ? path.relative(baseDir, a.path).replace(/\\/g, "/") : null;
}

function screenOf(test) {
  // titlePath: ["", "chromium", "file.spec.js", "Describe 1", ..., "Tên test"] -> bỏ 3 phần đầu
  const parts = test.titlePath().filter(Boolean);
  const idx = parts.findIndex((p) => /\.spec\.js$/.test(p));
  const rest = idx >= 0 ? parts.slice(idx + 1) : parts;
  return { screen: rest[0] || "", group: rest.slice(1, -1).join(" > "), name: rest[rest.length - 1] || test.title };
}

class FailuresReporter {
  constructor() {
    this.failures = [];
    this.flaky = [];
    this.total = 0;
    this.passed = 0;
    this.skipped = 0;
    this.start = Date.now();
  }

  onBegin() {
    this.start = Date.now();
  }

  onTestEnd(test, result) {
    if (result.status === "skipped") return;
    if (result.status === "passed") {
      if (result.retry > 0) this.flaky.push({ test, result }); // fail lần đầu, pass khi chạy lại
      return;
    }
    // Khi có retry chỉ ghi lần chạy cuối của mỗi test, tránh ghi trùng
    if (result.retry < test.retries) return;
    this.failures.push({ test, result });
  }

  onEnd(fullResult) {
    const baseDir = path.dirname(OUTPUT);
    const duration = ((Date.now() - this.start) / 60000).toFixed(1);
    const byCat = { known: [], assertion: [], timeout: [], network: [] };
    for (const f of this.failures) {
      const error = (f.result.errors && f.result.errors[0]) || f.result.error;
      f.error = error;
      f.cat = classify(f.test, f.result, error);
      byCat[f.cat].push(f);
    }

    const L = [];
    L.push("# Báo cáo test lỗi");
    L.push("");
    L.push(`Chạy lúc: ${new Date().toLocaleString("vi-VN")} | Thời gian: ${duration} phút | Kết quả: **${this.failures.length} test lỗi**${this.flaky.length ? `, ${this.flaky.length} test chập chờn (pass sau khi chạy lại)` : ""}`);
    L.push("");
    if (!this.failures.length) {
      L.push("Không có test nào lỗi.");
    } else {
      L.push("| Loại | Số test | QA cần làm gì |");
      L.push("|---|---|---|");
      const todo = {
        known: "Chỉ theo dõi bug đã báo dev",
        assertion: "**Kiểm tra thủ công theo các bước** để biết là bug hay test cần sửa",
        timeout: "Chạy lại đúng test; nếu vẫn fail mới kiểm tra thủ công",
        network: "Kiểm tra mạng / VPN rồi chạy lại",
      };
      for (const k of ["assertion", "known", "timeout", "network"]) {
        L.push(`| ${CATEGORIES[k].title} | ${byCat[k].length} | ${todo[k]} |`);
      }
      L.push("");
      L.push("> Mỗi lỗi có: **kiểm tra gì**, **mong đợi vs thực tế**, **các bước đã thực hiện** (dịch từ log tự động), ảnh chụp lúc fail (nếu có) và lệnh chạy lại.");
      L.push("> Các bước chỉ là gợi ý để QA tái hiện trên BO; để biết đầy đủ hãy mở file spec ở dòng được ghi.");
      L.push("");

      for (const k of ["assertion", "known", "timeout", "network"]) {
        if (!byCat[k].length) continue;
        L.push(`## ${CATEGORIES[k].title} (${byCat[k].length})`);
        L.push("");
        L.push(`_${CATEGORIES[k].note}_`);
        L.push("");
        // gom theo file spec cho dễ tìm
        const files = {};
        for (const f of byCat[k]) (files[rel(f.test.location.file)] ||= []).push(f);
        for (const [file, list] of Object.entries(files)) {
          L.push(`### ${file} (${list.length})`);
          L.push("");
          for (const f of list) this.renderFailure(L, f, baseDir);
        }
      }
    }

    if (this.flaky.length) {
      L.push("## Test chập chờn (fail lần đầu, pass khi chạy lại)");
      L.push("");
      for (const { test } of this.flaky) {
        const { screen, name } = screenOf(test);
        L.push(`- ${rel(test.location.file)}:${test.location.line} - ${screen} > ${name}`);
      }
      L.push("");
    }

    try {
      fs.mkdirSync(baseDir, { recursive: true });
      fs.writeFileSync(OUTPUT, L.join("\n"), "utf8");
      if (this.failures.length) console.log(`\nChi tiết các test lỗi (dễ đọc cho QA): ${rel(OUTPUT)}`);
    } catch (e) {
      console.log("Không ghi được failures.md:", e.message);
    }
  }

  renderFailure(L, f, baseDir) {
    const { test, result, error } = f;
    const { screen, group, name } = screenOf(test);
    const file = rel(test.location.file);
    L.push(`#### ${screen}${group ? " > " + group : ""}`);
    L.push(`**Kiểm tra:** ${name}`);
    L.push("");
    L.push("**Lỗi:**");
    L.push("```");
    L.push(shortError(error));
    L.push("```");
    const steps = stepsOf(result);
    if (steps.length) {
      L.push("");
      L.push("**Các bước đã thực hiện (gần nhất):**");
      steps.forEach((s, i) => L.push(`${i + 1}. ${s.text}${s.failed ? "  ❌ <- lỗi ở bước này" : ""}`));
    }
    const shot = screenshotOf(result, baseDir);
    if (shot) {
      L.push("");
      L.push(`**Ảnh lúc lỗi:** [${shot}](${shot})`);
    }
    L.push("");
    L.push(`**Chạy lại:** \`npx playwright test ${file}:${test.location.line} --project=setup --project=chromium\``);
    L.push(`_Vị trí test: ${file}:${test.location.line} · ${(result.duration / 1000).toFixed(1)}s_`);
    L.push("");
  }
}

module.exports = FailuresReporter;
