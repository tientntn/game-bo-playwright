// Reporter tự viết: lưu kết quả MỖI NGÀY vào thư mục test-history/ (khác test-results/ bị ghi đè mỗi lần chạy và nằm trong .gitignore)
// để đối chiếu giữa các ngày: số test, đạt / chập chờn / lỗi / skip, test nào mới, test nào mất, test nào đổi trạng thái.
//
// File được tạo (chỉ khi lần chạy có test chạy thật; `playwright test --list` KHÔNG ghi gì):
//   test-history/summary.csv       mỗi lần chạy 1 dòng: ngày, giờ, số phút, full/một phần, tổng, đạt, chập chờn, lỗi, skip
//   test-history/YYYY-MM-DD.json   chi tiết lần chạy FULL gần nhất trong ngày: trạng thái từng test + lý do lỗi (dùng để so với ngày khác)
//
// Lần chạy "một phần" (vd npm run test:ui:dashboard, tổng test < 90% lần full lớn nhất) chỉ ghi dòng summary.csv,
// không ghi đè file chi tiết của ngày đó.
//
// Cấu hình trong playwright.config.js:  reporter: [..., ["./tests/helpers/history-reporter.js"]]
// So sánh hai ngày bất kỳ:  node tests/helpers/history-reporter.js [ngày cũ] [ngày mới]   (mặc định: 2 file ngày gần nhất)
const fs = require("fs");
const path = require("path");

const DIR = path.resolve(process.cwd(), "test-history");
const SUMMARY = path.join(DIR, "summary.csv");
const SUMMARY_HEADER = "date,start,minutes,scope,total,passed,flaky,failed,skipped";
const FULL_RATIO = 0.9; // tổng test >= 90% lần full lớn nhất đã lưu thì coi là lần chạy full

// Mã trạng thái ngắn cho file JSON gọn: p = đạt ngay lần đầu, f = chập chờn (fail rồi đạt khi retry), x = lỗi, s = skip
const CODE = { expected: "p", flaky: "f", unexpected: "x", skipped: "s" };
const LABEL = { p: "đạt", f: "chập chờn", x: "lỗi", s: "skip" };

const pad = (n) => String(n).padStart(2, "0");
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const stripAnsi = (s) => String(s || "").replace(/\u001b\[[0-9;]*m/g, "");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Các ngày đã có file chi tiết, tăng dần: ["2026-11-19", "2026-11-20", ...]
function listDays() {
  try {
    return fs.readdirSync(DIR).map((f) => (f.match(/^(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]).filter(Boolean).sort();
  } catch {
    return [];
  }
}

// Làm phẳng { file: { title: code } } thành Map("file › title" -> code)
function flatten(record) {
  const m = new Map();
  for (const [file, tests] of Object.entries(record.files || {})) {
    for (const [title, code] of Object.entries(tests)) m.set(`${file} › ${title}`, code);
  }
  return m;
}

// JSON gọn: phần tóm tắt xuống dòng dễ đọc, mỗi file spec chiếm 1 dòng (đỡ dung lượng và diff git gọn hơn indent từng test)
function serialize(r) {
  const NL = "\n";
  const files = Object.entries(r.files).map(([f, tests]) => `  ${JSON.stringify(f)}: ${JSON.stringify(tests)}`);
  const failures = Object.entries(r.failures).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return [
    "{",
    ` "date": ${JSON.stringify(r.date)}, "start": ${JSON.stringify(r.start)}, "minutes": ${r.minutes},`,
    ` "summary": ${JSON.stringify(r.summary)},`,
    ` "failures": {${failures.length ? NL + failures.join("," + NL) + NL + " " : ""}},`,
    ` "files": {${NL}${files.join("," + NL)}${NL} }`,
    "}",
    "",
  ].join(NL);
}

// Đối chiếu 2 bản ghi, trả về mảng dòng Markdown/text để in ra
function compare(oldRec, newRec) {
  const a = flatten(oldRec);
  const b = flatten(newRec);
  const added = [...b.keys()].filter((k) => !a.has(k));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const nowFailing = [...b.keys()].filter((k) => a.has(k) && b.get(k) === "x" && a.get(k) !== "x");
  const fixed = [...b.keys()].filter((k) => a.has(k) && a.get(k) === "x" && b.get(k) !== "x");
  const nowSkipped = [...b.keys()].filter((k) => a.has(k) && b.get(k) === "s" && a.get(k) !== "s");
  const noLongerSkipped = [...b.keys()].filter((k) => a.has(k) && a.get(k) === "s" && b.get(k) !== "s");
  const s = (r) => r.summary;
  const out = [];
  out.push(`So sánh ${oldRec.date} -> ${newRec.date}`);
  out.push(`  Tổng test: ${s(oldRec).total} -> ${s(newRec).total} (${s(newRec).total - s(oldRec).total >= 0 ? "+" : ""}${s(newRec).total - s(oldRec).total})`);
  out.push(`  Đạt ${s(oldRec).passed} -> ${s(newRec).passed} | Chập chờn ${s(oldRec).flaky} -> ${s(newRec).flaky} | Lỗi ${s(oldRec).failed} -> ${s(newRec).failed} | Skip ${s(oldRec).skipped} -> ${s(newRec).skipped}`);
  const list = (title, arr) => {
    out.push(`  ${title}: ${arr.length}`);
    arr.slice(0, 40).forEach((k) => out.push(`    - ${k}`));
    if (arr.length > 40) out.push(`    ... và ${arr.length - 40} test nữa`);
  };
  list("Test MỚI (hôm nay có, lần trước không có)", added);
  list("Test MẤT / đổi tên (lần trước có, hôm nay không có)", removed);
  list("Test mới LỖI (lần trước không lỗi)", nowFailing);
  list("Test hết lỗi (lần trước lỗi)", fixed);
  if (nowSkipped.length) list("Test mới bị skip", nowSkipped);
  if (noLongerSkipped.length) list("Test hết bị skip", noLongerSkipped);
  return out;
}

class HistoryReporter {
  onBegin(config, suite) {
    this.suite = suite;
  }

  onEnd(result) {
    try {
      this.write(result);
    } catch (e) {
      // Không để lỗi ghi lịch sử làm hỏng kết quả chạy test
      console.warn(`[history-reporter] Không ghi được test-history: ${e.message}`);
    }
  }

  write(result) {
    const all = this.suite.allTests();
    // `playwright test --list`: không test nào có kết quả -> không ghi gì để khỏi làm bẩn lịch sử
    if (!all.some((t) => t.results.length > 0)) return;

    const files = {};
    const failures = {};
    const counts = { expected: 0, flaky: 0, unexpected: 0, skipped: 0 };
    for (const t of all) {
      const tp = t.titlePath(); // ["", project, file, ...describe, title]
      const project = tp[1];
      const file = (!project || project === "chromium" ? "" : `[${project}] `) + tp[2].split("\\").join("/");
      let title = tp.slice(3).join(" › ");
      const outcome = t.outcome();
      counts[outcome] = (counts[outcome] || 0) + 1;
      files[file] = files[file] || {};
      for (let i = 2; files[file][title]; i++) title = `${tp.slice(3).join(" › ")} #${i}`; // trùng tên trong cùng file
      files[file][title] = CODE[outcome] || "x";
      if (outcome === "unexpected") {
        const err = [...t.results].reverse().flatMap((r) => r.errors || [])[0];
        failures[`${file} › ${title}`] = stripAnsi(err && err.message).split("\n")[0].slice(0, 240);
      }
    }

    const start = result.startTime ? new Date(result.startTime) : new Date();
    const total = all.length;
    const summary = {
      total,
      passed: counts.expected,
      flaky: counts.flaky,
      failed: counts.unexpected,
      skipped: counts.skipped,
    };

    fs.mkdirSync(DIR, { recursive: true });

    // Lần chạy full = tổng test >= 90% tổng test lớn nhất đã lưu (chưa có lịch sử -> coi là full)
    const maxTotal = Math.max(0, ...listDays().map((d) => (readJson(path.join(DIR, `${d}.json`)) || { summary: {} }).summary.total || 0));
    const isFull = total >= maxTotal * FULL_RATIO;
    const date = localDate(start);
    const minutes = Math.round((result.duration || 0) / 60000);

    if (!fs.existsSync(SUMMARY)) fs.writeFileSync(SUMMARY, SUMMARY_HEADER + "\n");
    fs.appendFileSync(SUMMARY, [date, localTime(start), minutes, isFull ? "full" : "partial", total, summary.passed, summary.flaky, summary.failed, summary.skipped].join(",") + "\n");

    if (!isFull) {
      console.log(`\n[history-reporter] Lần chạy một phần (${total} test) - chỉ ghi dòng vào test-history/summary.csv, không ghi file chi tiết ngày ${date}.`);
      return;
    }

    const previousDays = listDays().filter((d) => d < date);
    const record = { date, start: start.toISOString(), minutes, summary, files, failures };
    fs.writeFileSync(path.join(DIR, `${date}.json`), JSON.stringify(record, null, 1) + "\n");
    console.log(`\n[history-reporter] Đã lưu test-history/${date}.json (${total} test: ${summary.passed} đạt, ${summary.flaky} chập chờn, ${summary.failed} lỗi, ${summary.skipped} skip)`);

    const prevDay = previousDays[previousDays.length - 1];
    const prev = prevDay && readJson(path.join(DIR, `${prevDay}.json`));
    if (prev) console.log(compare(prev, record).join("\n"));
  }

  printsToStdio() {
    return false;
  }
}

module.exports = HistoryReporter;
module.exports.serialize = serialize;

// CLI: node tests/helpers/history-reporter.js [ngày cũ] [ngày mới]   (định dạng YYYY-MM-DD)
if (require.main === module) {
  const days = listDays();
  const [from, to] = process.argv.length >= 4 ? [process.argv[2], process.argv[3]] : days.slice(-2);
  const a = from && readJson(path.join(DIR, `${from}.json`));
  const b = to && readJson(path.join(DIR, `${to}.json`));
  if (!a || !b) {
    console.error(`Cần 2 file ngày trong test-history/ (đang có: ${days.join(", ") || "không có"}).`);
    process.exit(1);
  }
  console.log(compare(a, b).join("\n"));
}
