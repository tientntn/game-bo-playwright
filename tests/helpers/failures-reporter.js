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
// Dịch log của Playwright thành các bước người không biết lập trình đọc được
// Ví dụ: "Bấm vào ô lọc "House"" / "Chọn "Royal Edge House" trong danh sách đang mở" / "Bấm nút "Search""
// ---------------------------------------------------------------------------
// houseIds -> House ; masterAgentIds -> Master Agent ; gameCategoryId -> Game Category
function fieldName(id) {
  return id
    .replace(/_/g, " ")
    .replace(/Ids?$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

// Tên nút Ant Design hay có tên icon đứng trước: "search Search" -> "Search", "close Reset" -> "Reset"
const cleanButtonName = (n) => n.replace(/^[a-z-]+ (?=[A-Z])/, "").trim();

// Lấy chữ trong .filter({ hasText: ... }) / has-text của chuỗi locator
function textOf(r) {
  let m = r.match(/hasText: \/\^\\s\*(.*?)\\s\*\$\/\w*/) || r.match(/hasText: '([^']*)'/) || r.match(/hasText: "([^"]*)"/);
  if (m) return m[1];
  m = r.match(/getByText\('([^']*)'/);
  return m ? m[1] : null;
}

// Mô tả "cái gì" bằng tiếng Việt từ chuỗi locator; trả về { vi, known }
function describeTarget(raw) {
  const r = String(raw);
  const text = textOf(r);
  const which = /\.first\(\)\s*$/.test(r) ? " đầu tiên" : /\.last\(\)\s*$/.test(r) ? " cuối cùng" : "";
  let m;

  if ((m = r.match(/getByRole\('(\w+)', \{ name: (?:'([^']*)'|\/(.*?)\/\w*)/))) {
    const role = { button: "nút", link: "link", checkbox: "ô tích", tab: "tab", menuitem: "mục menu", columnheader: "tiêu đề cột", textbox: "ô nhập", combobox: "ô chọn", row: "dòng", dialog: "hộp thoại" }[m[1]] || m[1];
    return { vi: `${role} "${cleanButtonName(m[2] ?? m[3])}"`, known: true };
  }
  if ((m = r.match(/getByPlaceholder\('([^']*)'/))) return { vi: `ô nhập "${m[1]}"`, known: true };
  if ((m = r.match(/getByLabel\('([^']*)'/))) return { vi: `ô "${m[1]}"`, known: true };
  // Ô nhập tìm theo id ở cuối chuỗi: ...locator('#list_0_value')
  if ((m = r.match(/locator\('#(\w+)'\)(?:\.(?:first|last)\(\))?\s*$/))) return { vi: `ô "${fieldName(m[1])}"`, known: true };
  if ((m = r.match(/has: (?:page\.)?locator\('#(\w+)'\)/))) return { vi: `ô lọc "${fieldName(m[1])}"`, known: true };
  if (/\.ant-select-item-option/.test(r)) return { vi: text ? `mục "${text}" trong danh sách đang mở` : `một mục${which} trong danh sách đang mở`, known: true };
  if (/\.ant-select-dropdown/.test(r)) return { vi: "danh sách thả xuống", known: true };
  if (/ant-pagination-next/.test(r)) return { vi: 'nút phân trang "trang sau"', known: true };
  if (/ant-pagination-prev/.test(r)) return { vi: 'nút phân trang "trang trước"', known: true };
  if (/ant-pagination-options/.test(r)) return { vi: 'ô chọn "số dòng / trang"', known: true };
  if (/ant-pagination-item-active/.test(r)) return { vi: "số trang đang chọn", known: true };
  if (/ant-pagination-item/.test(r)) return { vi: `số trang${text ? ` "${text}"` : ""}`, known: true };
  if (/manage-column__bu/.test(r)) return { vi: 'nút "Manage Columns" (chọn cột hiển thị)', known: true };
  if (/manage-column__list__items/.test(r)) return { vi: text ? `cột "${text}" trong hộp Manage Columns` : "một cột trong hộp Manage Columns", known: true };
  if (/manage-column/.test(r)) return { vi: "hộp Manage Columns", known: true };
  if (/create-btn/.test(r)) return { vi: 'nút tạo mới (Create / Add)', known: true };
  if (/label-form-title/.test(r)) return { vi: "tiêu đề màn hình", known: true };
  if (/NextGen-filter-element|NextGen-filter-dropdown/.test(r)) return { vi: "một ô lọc", known: true };
  if (/NextGen-modal/.test(r)) return { vi: /modal-title/.test(r) ? "tiêu đề hộp thoại" : "hộp thoại", known: true };
  if (/ant-modal-close/.test(r)) return { vi: "nút (x) đóng hộp thoại", known: true };
  if (/ant-modal-title/.test(r)) return { vi: "tiêu đề hộp thoại", known: true };
  if (/ant-modal/.test(r)) return { vi: "hộp thoại", known: true };
  if (/thead th|ant-table-thead/.test(r)) return { vi: text ? `tiêu đề cột "${text}"` : "tiêu đề cột", known: true };
  if (/ant-table-tbody|tbody tr|ant-table-row/.test(r)) return { vi: `dòng${which} trong bảng${text ? ` có chữ "${text}"` : ""}`, known: true };
  if (/Toastify/.test(r)) return { vi: `thông báo (toast)${text ? ` có chữ "${text}"` : ""}`, known: true };
  if (/ant-tooltip/.test(r)) return { vi: `tooltip${text ? ` có chữ "${text}"` : ""}`, known: true };
  if (/ant-popover/.test(r)) return { vi: "hộp popover", known: true };
  if (/ant-tag/.test(r)) return { vi: "nhãn (tag)", known: true };
  if (/ant-spin/.test(r)) return { vi: "biểu tượng đang tải", known: true };
  if ((m = r.match(/locator\('#(\w+)'\)/))) return { vi: `ô "${fieldName(m[1])}"`, known: true };
  if (text) return { vi: `chữ "${text}"`, known: true };
  // Không nhận ra: giữ selector rút gọn trong ngoặc để dev tra
  const sel = r.length > 70 ? r.slice(0, 67) + "..." : r;
  return { vi: `một phần tử trên trang (${sel})`, known: false };
}

// Các bước thuần kỹ thuật, QA không cần thấy
function isNoise(t) {
  return (
    /^(Before Hooks|After Hooks|Worker Cleanup|Fixture|Attach|Create context|Create page|Launch browser|Close context|Evaluate|Wait for event|Request ghi dữ liệu)/i.test(t) ||
    /Expect "poll/i.test(t) ||
    /ant-spin|NextGen-filter-bar|breadcrumb|networkidle|load state|Wait for (?:navigation|URL)/i.test(t)
  );
}

// Trả về chuỗi tiếng Việt cho 1 step, hoặc null nếu step không đáng hiển thị
function humanizeStep(step) {
  const t = stripAnsi(step.title || "").trim();
  if (!t) return null;
  if (step.category === "hook" || step.category === "fixture") return null;
  if (isNoise(t)) return null;

  let m;
  if ((m = t.match(/^(?:Navigate to|page\.goto)\s+"?([^"]+)"?/i))) return `Mở màn hình \`${m[1]}\``;
  if (/^Reload/i.test(t)) return "Tải lại trang (F5)";
  if ((m = t.match(/^Click\s+(.*)/i))) return `Bấm vào ${describeTarget(m[1]).vi}`;
  if ((m = t.match(/^Fill\s+"(.*?)"\s+(.*)$/i))) return `Nhập "${m[1]}" vào ${describeTarget(m[2]).vi}`;
  if ((m = t.match(/^Fill\s+(.*)/i))) return `Xoá nội dung ${describeTarget(m[1]).vi}`;
  if ((m = t.match(/^Hover\s+(.*)/i))) return `Rê chuột vào ${describeTarget(m[1]).vi}`;
  if ((m = t.match(/^Press sequentially\s+"(.*?)"/i)) || (m = t.match(/^Type\s+"(.*?)"/i))) return `Gõ "${m[1]}"`;
  if ((m = t.match(/^Press\s+"?(.*?)"?\s*$/i))) return `Nhấn phím ${m[1]}`;
  if ((m = t.match(/^Check\s+(.*)/i))) return `Tích chọn ${describeTarget(m[1]).vi}`;
  if ((m = t.match(/^Uncheck\s+(.*)/i))) return `Bỏ tích ${describeTarget(m[1]).vi}`;
  if ((m = t.match(/^Select\s+(.*)/i))) return `Chọn ${describeTarget(m[1]).vi}`;
  if ((m = t.match(/^Wait for (?:response|request)/i))) return null; // nhiễu: bước kế tiếp đã nói rõ thao tác
  if ((m = t.match(/^Wait for (?:selector|locator)?\s*(.*)/i))) return `Chờ ${describeTarget(m[1]).vi} xuất hiện`;

  if ((m = t.match(/^Expect "(\w+)"(?:\s*(.*))?/))) {
    // Chỉ giữ các kiểm tra QA hiểu được; bước kiểm tra bị lỗi sẽ được thay bằng phần "Lỗi" bên trên
    const target = m[2] ? describeTarget(m[2]).vi : "";
    if (m[1] === "toBeVisible") return `Kiểm tra: thấy ${target}`;
    if (m[1] === "toBeHidden") return `Kiểm tra: không còn thấy ${target}`;
    if (m[1] === "toHaveText" || m[1] === "toContainText") return `Kiểm tra: ${target} có đúng chữ mong đợi`;
    if (m[1] === "toHaveURL") return "Kiểm tra: đúng địa chỉ màn hình mong đợi";
    if (m[1] === "toBeEnabled") return `Kiểm tra: ${target} bấm được`;
    if (m[1] === "toBeDisabled") return `Kiểm tra: ${target} bị khoá (không bấm được)`;
    return null; // toHaveCount, toEqual, toBe... quá kỹ thuật
  }
  if (step.category === "test.step") return `**${t}**`;
  return null;
}

// Duyệt cây step theo thứ tự thời gian. Mỗi phần tử: { text, err, placeholder }
//   err = bước thật (pw:api / expect) có lỗi; placeholder = bước lỗi nhưng không dịch được (vd expect(...).toEqual)
function flattenSteps(steps, out = []) {
  for (const s of steps || []) {
    const text = humanizeStep(s);
    const leaf = s.category === "pw:api" || s.category === "expect"; // bước thật; test.step / hook chỉ là khung bọc
    const err = !!s.error && leaf;
    if (text) out.push({ text, err });
    else if (err) out.push({ text: "Bước kiểm tra này bị lỗi (xem phần \"Lỗi\" ở trên: mong đợi khác thực tế)", err, placeholder: true });
    // bước con của pw:api (log nội bộ) không cần; chỉ đi sâu vào hook / test.step / hàm bọc
    if (s.steps && s.steps.length && !leaf) flattenSteps(s.steps, out);
  }
  return out;
}

function stepsOf(result) {
  const flat = flattenSteps(result.steps);
  // Bước gây fail test là bước lỗi CUỐI CÙNG; các bước lỗi ở giữa là lỗi đã được test bắt lại (catch) nên bỏ qua
  let lastErr = -1;
  flat.forEach((x, i) => { if (x.err) lastErr = i; });
  const kept = [];
  flat.forEach((x, i) => {
    if (lastErr >= 0 && i > lastErr) return; // bỏ các bước dọn dẹp sau chỗ lỗi
    if (x.placeholder && i !== lastErr) return; // bỏ bước lỗi đã bị bắt lại
    const last = kept[kept.length - 1];
    if (last && last.text === x.text) return; // bỏ trùng liên tiếp
    kept.push({ text: x.text, failed: i === lastErr });
  });
  return kept.slice(-MAX_STEPS);
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
