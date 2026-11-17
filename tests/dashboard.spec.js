// Dashboard  (https://dev-bo.royaledge.io/)  - so sánh số liệu CHART với Game Summary
//
// Chạy trong project "chromium" (dùng session từ playwright/.auth/session.txt):
//   npm run test:ui -- tests/dashboard.spec.js
//
// Màn hình gồm: khối ALERTS và 3 chart (canvas Chart.js):
//   1. Top 10 Games      : dropdown metric (Bet Count / Turnover / GGR) + dropdown currency
//                          API dashboard/top-performing-games { currencyId, performanceType: "1" | "2" | "3" }
//   2. Top 10 GGR by Currencies : không có dropdown. API dashboard/top-currencies
//   3. GGR (line chart)  : dropdown currency. API dashboard/ggr-trend { currencyId } -> 30 ngày gần nhất
//
// Khối ALERTS: 3 con số Info / Warning / Critical lấy từ API alertreport/summary ([{ severity: "INFO", quantity }, ...]).
// Bấm vào con số -> chuyển sang Alert Report (/report/alert) với filter Severity tương ứng; số trên Dashboard phải bằng
// tổng số bản ghi ("Showing 1 - 10 of N records") của Alert Report khi lọc Severity đó (và tổng 3 mức = tổng Alert Report không lọc).
//
// Chuông thông báo (header): khi mở trang gọi alertreport/list { page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: {} },
// bấm chuông mở popover "Notification" liệt kê 10 cảnh báo mới nhất (không gọi thêm API); nút "View All" chuyển sang Alert Report.
//
// Các test chỉ ĐỌC dữ liệu (không tạo / sửa / xoá gì, không Export).
//
// Mỗi phép so sánh với Game Summary được chạy 2 lớp ("double test"):
//   - THEO CHART  : lấy danh sách currency đang có dữ liệu trên chart "Top 10 GGR by Currencies" rồi test LẦN LƯỢT TỪNG currency đó
//                   (không hard-code; dữ liệu trên dev đổi thì danh sách tự đổi theo). Lỗi được gom theo currency trong 1 test (expect.soft).
//   - CỐ ĐỊNH     : currency TKN + game Samba Bonanza (đúng màn hình mẫu của QA) - mục "Đối chiếu cố định".
//                   Nếu TKN / Samba Bonanza không có trên chart thì test được SKIP kèm lý do.
//
// Cách so sánh với Game Summary (https://dev-bo.royaledge.io/report/summary-game):
//   - Date Period = preset "Last 30 Days" (khớp khoảng ngày ghi trên tiêu đề chart, test riêng kiểm tra điều này).
//   - Sweepstake = "All": Dashboard tính CẢ giao dịch Sweepstake (với ARS: Dashboard -346.5M = Game Summary "All",
//     còn Game Summary mặc định "No" chỉ là -7.5M). Nếu để mặc định "No" số liệu sẽ không khớp.
//   - Top 10 Games : mỗi cột = tổng cột tương ứng của game đó trên Game Summary (Bet Count -> Total Bet Count,
//     Turnover -> Total ETO, GGR -> Total GGR) và đúng là các game đứng đầu (GGR: cao nhất -> thấp nhất, kể cả khi âm).
//   - Top 10 GGR by Currencies : mỗi cột = Total GGR của "Summation By Currency" khi lọc đúng currency đó.
//   - GGR (line chart) : tổng các điểm = Total GGR của cả khoảng ngày; từng điểm = tổng GGR các dòng của ngày đó.
//
// Làm tròn: dữ liệu trong chart vẫn đủ 4 chữ số thập phân (khớp 100% response API), nhãn vẽ trên canvas thì làm tròn 3 chữ số
// (vd 3,722,512.6068 -> 3,722,512.607). Vì vậy so với Summation dùng dung sai 0.0005; so với tổng các dòng (mỗi dòng đã làm tròn
// 4 chữ số riêng lẻ) dùng dung sai 0.005.
//
// Cách đọc dữ liệu chart: chart vẽ bằng canvas nên không đọc được từ DOM. Test lấy instance Chart.js (react-chartjs-2 giữ trong
// hook ref của React) và đọc chart.data - đúng dữ liệu mà chart đang vẽ.
const { test, expect } = require("@playwright/test");
const { buildStorageState } = require("./helpers/session");

// buildStorageState bỏ các key filter / page size / sorter đã lưu trong session.txt -> mỗi test luôn mở với filter mặc định
test.use({ storageState: buildStorageState(), viewport: { width: 1920, height: 1080 } });
// Mặc định mỗi test 120s (thay vì 30s của config): thời gian khởi động browser / fixture cũng tính vào timeout, nên khi máy hoặc
// server dev đang tải nặng (vd chạy UI mode cùng lúc) test sẽ báo "Test timeout of 30000ms exceeded" trước khi kịp chạy dòng đầu tiên.
// Các test dài vẫn tự đặt timeout riêng bằng test.setTimeout() trong thân test.
test.describe.configure({ timeout: 120000 });

const DASHBOARD_URL = "/";
const SUMMARY_URL = "/report/summary-game";

// Dữ liệu cố định cho mục "Đối chiếu cố định" (theo yêu cầu của QA)
const FIXED_CURRENCY = "TKN";
const FIXED_GAME = "Samba Bonanza";

// Metric của Top 10 Games -> performanceType gửi lên API, cột tương ứng của Game Summary
const METRICS = [
  { name: "Bet Count", type: "1", rowKey: "totalBetCount", summation: "Total Bet Count", digits: 0 },
  { name: "Turnover", type: "2", rowKey: "totalETO", summation: "Total ETO", digits: 3 },
  { name: "GGR", type: "3", rowKey: "totalGgr", summation: "Total GGR", digits: 3 },
];

// Dung sai (xem mục "Làm tròn" ở đầu file)
const TOL_SUMMATION = 0.0005;
const TOL_ROWS = 0.005;
const TOL_TREND_SUM = 0.02; // 30 điểm, mỗi điểm làm tròn 3 chữ số

// ---------------------------------------------------------------------------
// Helpers chung
// ---------------------------------------------------------------------------
// Dùng được cho cả Request (waitForRequest) lẫn Response (waitForResponse)
const post = (r) => (typeof r.request === "function" ? r.request() : r).method() === "POST";
const isTopGames = (r) => post(r) && r.url().endsWith("/dashboard/top-performing-games");
const isTopCurrencies = (r) => post(r) && r.url().endsWith("/dashboard/top-currencies");
const isGgrTrend = (r) => post(r) && r.url().endsWith("/dashboard/ggr-trend");
const isSummary = (r) => post(r) && r.url().endsWith("/summary/game");
const isSummation = (r) => post(r) && r.url().endsWith("/summary/game/currency-summation");
const isAlertSummary = (r) => post(r) && r.url().endsWith("/alertreport/summary");
// Chuông thông báo ở header cũng gọi /alertreport/list (filters rỗng) nên phân biệt bằng timezoneId của Alert Report
const hasTimezone = (r) => ((typeof r.request === "function" ? r.request() : r).postData() || "").includes('"timezoneId"');
const isAlertList = (r) => post(r) && r.url().endsWith("/alertreport/list") && hasTimezone(r);
const isBellList = (r) => post(r) && r.url().endsWith("/alertreport/list") && !hasTimezone(r);

const num = (s) => parseFloat(String(s).replace(/[,%+]/g, ""));
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const round4 = (n) => Math.round(n * 1e4) / 1e4;
const exact = (name, flags = "") =>
  new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, flags);

// "09-11-2026" -> Date (UTC)
function parseDay(s) {
  const [d, m, y] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const diffDays = (a, b) => Math.round((a - b) / 86400000);

// So sánh số có dung sai; dùng expect.soft để test chạy hết các currency / game rồi mới báo toàn bộ chỗ lệch
function expectClose(actual, expected, tol, message) {
  expect.soft(Math.abs(actual - expected), `${message}: chart=${actual} game-summary=${expected}`).toBeLessThanOrEqual(tol);
}

const REDIRECT_MESSAGE =
  "Bị chuyển về /login: session trong playwright/.auth/session.txt đã hết hạn (backend chỉ cho 1 session/tài khoản - đăng nhập ở nơi khác sẽ làm session này mất hiệu lực). Copy lại localStorage từ DevTools.";

// Chờ response đầu tiên của trang; nếu bị chuyển về /login thì báo lỗi rõ ràng thay vì chờ timeout
async function gotoAndWait(page, url, firstLoad) {
  firstLoad.catch(() => {}); // tránh unhandled rejection khi test kết thúc sớm
  await page.goto(url);
  const redirectedToLogin = page
    .waitForURL(/\/login/, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (await Promise.race([firstLoad.then(() => false), redirectedToLogin])) {
    throw new Error(REDIRECT_MESSAGE);
  }
  await firstLoad;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
// Mở Dashboard, chờ 3 API chart. Trả về { topGames, ggrTrend, topCurrencies } = { body, json } của lần load đầu.
async function openDashboard(page) {
  const wait = (api) =>
    page.waitForResponse(api).then(async (res) => ({
      body: JSON.parse(res.request().postData() || "{}"),
      json: await res.json(),
    }));
  const topGames = wait(isTopGames);
  const ggrTrend = wait(isGgrTrend);
  const topCurrencies = wait(isTopCurrencies);
  for (const p of [topGames, ggrTrend, topCurrencies]) p.catch(() => {});

  await gotoAndWait(page, DASHBOARD_URL, Promise.all([topGames, ggrTrend, topCurrencies]));
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(3);
  // Chờ cả 3 chart được vẽ (có instance Chart.js)
  for (const i of [0, 1, 2]) {
    await expect.poll(() => readChart(page, i), { message: `Chưa đọc được chart #${i}` }).not.toBeNull();
  }
  return { topGames: await topGames, ggrTrend: await ggrTrend, topCurrencies: await topCurrencies };
}

// Khối ALERTS: thứ tự hiển thị trên Dashboard và tên mức trong response API
const ALERT_LEVELS = [
  { label: "Info", api: "INFO" },
  { label: "Warning", api: "WARNING" },
  { label: "Critical", api: "CRITICAL" },
];
// Cấu trúc mỗi thẻ: div(thẻ) > [div(nhãn) > [icon, span "Info"], div(số)]; khối bao ngoài: div > [div "ALERTS", div(các thẻ)]
const alertsBlock = (page) => page.getByText("ALERTS", { exact: true }).locator("xpath=..");
const alertLabel = (page, label) => alertsBlock(page).locator("span").filter({ hasText: exact(label) });
const alertNumber = (page, label) => alertLabel(page, label).locator("xpath=../../div[2]");

// Mở Dashboard và chờ API alertreport/summary. Trả về { body, json } của API đó.
async function openDashboardAlerts(page) {
  const summary = page.waitForResponse(isAlertSummary).then(async (res) => ({
    body: JSON.parse(res.request().postData() || "{}"),
    json: await res.json(),
  }));
  await gotoAndWait(page, DASHBOARD_URL, summary);
  await expect(alertsBlock(page)).toBeVisible();
  return summary;
}

// Currency đang có dữ liệu trên chart "Top 10 GGR by Currencies" (theo thứ tự trên chart)
function currenciesWithData(dash) {
  return [...new Set(dash.topCurrencies.json.data.map((c) => c.currencyCode))];
}

// Đọc dữ liệu chart thứ `index` (0: Top 10 Games, 1: Top 10 GGR by Currencies, 2: GGR) từ instance Chart.js
async function readChart(page, index) {
  return page.evaluate((i) => {
    const canvas = document.querySelectorAll("canvas")[i];
    const key = canvas && Object.keys(canvas).find((k) => k.startsWith("__reactFiber$"));
    if (!key) return null;
    const seen = new Set();
    // Fiber gắn trên DOM có thể là bản cũ -> thử cả alternate; hook ref `chartRef` giữ instance Chart.js
    for (const start of [canvas[key], canvas[key].alternate].filter(Boolean)) {
      for (let f = start, depth = 0; f && depth < 30; f = f.return, depth++) {
        if (seen.has(f)) continue;
        seen.add(f);
        for (let h = f.memoizedState, n = 0; h && n < 40; h = h.next, n++) {
          const chart = h.memoizedState && h.memoizedState.current;
          if (chart && chart.canvas === canvas && chart.data && chart.config) {
            return {
              type: chart.config.type,
              title: chart.options?.plugins?.title?.text,
              labels: [...chart.data.labels],
              datasets: chart.data.datasets.map((d) => ({ label: d.label, data: [...d.data] })),
            };
          }
        }
      }
    }
    return null;
  }, index);
}

// Chờ chart hiển thị đúng labels + values (có retry vì chart cập nhật bất đồng bộ sau response)
async function expectChartData(page, index, labels, values, message) {
  await expect
    .poll(
      async () => {
        const c = await readChart(page, index);
        return c ? { labels: c.labels, values: c.datasets[0].data } : null;
      },
      { message },
    )
    .toEqual({ labels, values });
}

const dashSelect = (page, index) => page.locator(".ant-select").nth(index); // 0: metric, 1: currency Top Games, 2: currency GGR
const optionsOpen = (page) =>
  page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");

// Chọn option của dropdown trên Dashboard. Trả về { body, json } của API vừa gọi,
// hoặc null nếu option đã được chọn sẵn (khi đó không có request nào).
async function pickDash(page, index, title, api) {
  const select = dashSelect(page, index);
  if ((await select.locator(".ant-select-selection-item").getAttribute("title")) === title) return null;
  await select.click();
  await page.keyboard.type(title); // dropdown currency có ô tìm kiếm; dropdown metric thì bỏ qua
  const [req, res] = await Promise.all([
    page.waitForRequest(api),
    page.waitForResponse(api),
    optionsOpen(page).filter({ hasText: exact(title) }).first().click(),
  ]);
  return { body: JSON.parse(req.postData()), json: await res.json() };
}

// Top 10 Games của 1 currency: chọn currency rồi lần lượt đủ 3 metric.
// `state.metric` = metric đang được chọn trên dropdown (Bet Count lúc mới mở trang) - dùng chung giữa các currency.
// Trả về { [tên metric]: { body, json, chart: { labels, values, datasetLabel } } }; chart đã được chờ khớp với response.
async function collectTopGames(page, dash, code, state) {
  const results = {};
  const record = async (metric, res) => {
    const games = res.json.data;
    await expectChartData(
      page,
      0,
      games.map((g) => g.gameName),
      games.map((g) => g.value),
      `Top 10 Games ${code} / ${metric.name}`,
    );
    const c = await readChart(page, 0);
    results[metric.name] = {
      body: res.body,
      json: res.json,
      chart: { labels: c.labels, values: c.datasets[0].data, datasetLabel: c.datasets[0].label },
    };
  };

  const start = state.metric;
  // Đổi currency: request mang metric đang chọn. Nếu currency đã được chọn sẵn từ đầu (USD, Bet Count) thì không có request -> dùng lần load đầu.
  await record(start, (await pickDash(page, 1, code, isTopGames)) ?? dash.topGames);
  for (const metric of METRICS) {
    if (metric === start) continue;
    await record(metric, await pickDash(page, 0, metric.name, isTopGames));
    state.metric = metric;
  }
  return results;
}

// GGR line chart của 1 currency: chọn currency, chờ chart khớp response. Trả về { body, json, title, labels, values }
async function collectTrend(page, dash, code) {
  const res = (await pickDash(page, 2, code, isGgrTrend)) ?? dash.ggrTrend;
  const trend = res.json.data;
  await expectChartData(page, 2, trend.map((t) => t.betDate), trend.map((t) => t.ggr), `GGR ${code}`);
  const c = await readChart(page, 2);
  return { body: res.body, json: res.json, title: c.title, labels: c.labels, values: c.datasets[0].data };
}

// ---------------------------------------------------------------------------
// Game Summary
// ---------------------------------------------------------------------------
const searchBtn = (page) => page.getByRole("button", { name: "search Search" });
const resetBtn = (page) => page.getByRole("button", { name: "close Reset" });
const pageTitle = (page) => page.getByRole("navigation").getByText("Game Summary Report");
const filterEl = (page, id) =>
  page.locator(".NextGen-filter-element").filter({ has: page.locator(`#${id}`) });
const dateRangeInput = (page) => page.locator("#datePeriod_dateRange");
const summationTable = (page) =>
  page.locator(".ant-table").filter({ hasText: "Summation By Currency" });

async function waitTableIdle(page) {
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
}

async function openGameSummary(page) {
  await gotoAndWait(page, SUMMARY_URL, page.waitForResponse(isSummary));
  await waitTableIdle(page);
  await expect(page.locator(".NextGen-filter-bar")).toBeVisible();
}

// Reset đưa filter về mặc định (Date = hôm nay, Sweepstake = No) và có thể gọi lại API -> chờ xong mới thao tác tiếp
async function resetGameSummary(page) {
  const afterReset = page.waitForRequest(isSummary, { timeout: 5000 }).catch(() => null);
  await resetBtn(page).click();
  await afterReset;
  await waitTableIdle(page);
}

// Mở dropdown bằng cách click vào LABEL (không click giữa ô: có thể trúng nút (x) của chip đã chọn)
async function openDropdown(page, id) {
  await filterEl(page, id).locator(".NextGen-filter-dropdown__control label").first().click();
}

// Chọn option (không phân biệt hoa/thường) của filter dạng dropdown rồi đóng dropdown
async function selectOption(page, id, title) {
  await openDropdown(page, id);
  await page.keyboard.type(title);
  await optionsOpen(page).filter({ hasText: exact(title, "i") }).first().click();
  // Dropdown chọn nhiều không tự đóng và Esc không đóng được -> click ra ngoài
  await pageTitle(page).click();
  await expect(optionsOpen(page)).toHaveCount(0);
}

async function pickDatePreset(page, preset) {
  await filterEl(page, "datePeriod_0").locator("label").first().click();
  // Popup của picker đang mở luôn được append SAU cùng trong DOM -> .last()
  await page.locator(".NextGen-datetime-preset__item").filter({ hasText: preset }).last().click();
  await pageTitle(page).click();
}

// Bấm Search, trả về { body, json, summation }: request body + response của danh sách và dòng tổng
async function search(page) {
  const [req, res, summationRes] = await Promise.all([
    page.waitForRequest(isSummary),
    page.waitForResponse(isSummary),
    page.waitForResponse(isSummation),
    searchBtn(page).click(),
  ]);
  await waitTableIdle(page);
  expect(res.status()).toBe(200);
  return {
    body: JSON.parse(req.postData()),
    json: await res.json(),
    summation: (await summationRes.json()).data?.[0],
  };
}

// Áp bộ lọc dùng để đối chiếu với Dashboard: Last 30 Days + Currency + Sweepstake All (+ Game) rồi Search
async function filterAndSearch(page, { currency, game }) {
  await pickDatePreset(page, "Last 30 Days");
  await selectOption(page, "currencyIds", currency);
  await selectOption(page, "isSweeps", "All");
  if (game) await selectOption(page, "gameName", game);
  return search(page);
}

// Lấy TOÀN BỘ dòng của kết quả (đổi 200 dòng/trang rồi lật trang) từ response API của bảng.
// `first` = kết quả của search() ngay trước đó.
async function fetchAllRows(page, first) {
  const total = first.json.data.totalCount;
  let rows = [...first.json.data.list];
  if (rows.length >= total) return rows;
  test.skip(total > 4000, `Có ${total} dòng Game Summary, quá nhiều để gom lại so sánh`);

  // Số dòng / trang có thể đã là 200 từ lần trước (Game Summary nhớ lại) -> khi đó không đổi nữa (đổi sẽ không có request)
  if (first.body.pageSize < 200) {
    await page.locator(".ant-pagination-options .ant-select").click();
    const [res] = await Promise.all([
      page.waitForResponse(isSummary),
      optionsOpen(page).filter({ hasText: "200 / page" }).click(),
    ]);
    rows = [...(await res.json()).data.list];
  }
  while (rows.length < total) {
    const [next] = await Promise.all([
      page.waitForResponse(isSummary),
      page.locator(".ant-pagination-next").click(),
    ]);
    const list = (await next.json()).data.list;
    expect(list.length, "trang tiếp theo trống nhưng chưa đủ dòng").toBeGreaterThan(0);
    rows.push(...list);
  }
  await waitTableIdle(page);
  expect(rows).toHaveLength(total);
  return rows;
}

// Đọc 1 dòng của bảng tổng (Summation / Conversion) thành object theo header
async function readTotals(table) {
  const heads = (await table.locator("thead th").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  const cells = await table
    .locator("tbody tr.ant-table-row")
    .first()
    .evaluate((tr) => [...tr.children].map((c) => c.innerText.trim()));
  return Object.fromEntries(heads.map((h, i) => [h, cells[i]]));
}

// Đọc bảng "Summation By Currency" sau khi Search: chờ bảng chuyển sang đúng currency rồi mới đọc
async function readSummationTotals(page, currency) {
  await expect
    .poll(async () => (await readTotals(summationTable(page)))["Summation By Currency"], {
      message: `Summation By Currency phải chuyển sang ${currency}`,
    })
    .toBe(currency);
  return readTotals(summationTable(page));
}

// Giá trị 1 cột của bảng Summation By Currency (dùng với expect.poll vì bảng cập nhật sau Search)
const summationValue = (page, column) => async () => num((await readTotals(summationTable(page)))[column]);

// Game Summary của 1 currency (30 ngày, Sweepstake All): toàn bộ dòng + bảng tổng.
// `reset`: true khi trước đó đã lọc currency khác trên cùng màn hình.
async function loadGameSummary(page, currency, { reset = false } = {}) {
  if (reset) await resetGameSummary(page);
  const first = await filterAndSearch(page, { currency });
  const rows = await fetchAllRows(page, first);
  const totals = await readSummationTotals(page, currency);
  return { rows, totals };
}

// Tổng `key` của các dòng Game Summary theo `groupBy` -> { [nhóm]: tổng }
function groupSum(rows, groupBy, key) {
  const out = {};
  for (const r of rows) out[r[groupBy]] = (out[r[groupBy]] || 0) + r[key];
  return out;
}

// Top 10 Games: mỗi cột = tổng của game đó trên Game Summary và đúng là các game đứng đầu
function compareTopGames(code, metric, chart, rows) {
  const at = `${code} / ${metric.name}`;
  const perGame = groupSum(rows, "gameName", metric.rowKey);

  // 1. Mỗi cột = tổng của game đó
  chart.labels.forEach((label, i) => {
    if (perGame[label] === undefined) {
      expect.soft(perGame[label], `[${at}] game "${label}" trên chart không có trong Game Summary`).toBeDefined();
      return;
    }
    expectClose(chart.values[i], perGame[label], TOL_ROWS, `[${at}] ${label}`);
  });
  // 2. Đúng là các game đứng đầu: so danh sách giá trị (không so tên để không bị lệ thuộc khi 2 game bằng điểm nhau)
  const expectedTop = Object.values(perGame)
    .sort((a, b) => b - a)
    .slice(0, 10);
  expect
    .soft(chart.values.length, `[${at}] số game trên chart (Game Summary có ${Object.keys(perGame).length} game)`)
    .toBe(expectedTop.length);
  chart.values.forEach((v, i) => {
    if (i < expectedTop.length) expectClose(v, expectedTop[i], TOL_ROWS, `[${at}] vị trí #${i + 1}`);
  });
}

// GGR từng ngày của line chart = tổng GGR các dòng Game Summary của ngày đó
function compareTrendPerDay(code, trend, rows) {
  const perDay = groupSum(rows, "date", "totalGgr");
  // Mọi ngày có dữ liệu trên Game Summary đều phải nằm trong khoảng của chart
  const outside = Object.keys(perDay).filter((d) => !trend.labels.includes(d));
  expect.soft(outside, `[${code}] ngày có trên Game Summary nhưng không có trên chart`).toEqual([]);

  const diffs = trend.labels
    .map((day, i) => ({
      day,
      chart: trend.values[i],
      gameSummary: round4(perDay[day] ?? 0),
      diff: round4(trend.values[i] - (perDay[day] ?? 0)),
    }))
    .filter((d) => Math.abs(d.diff) > TOL_ROWS);
  expect.soft(diffs, `[${code}] các ngày GGR lệch giữa chart và Game Summary`).toEqual([]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe("Dashboard - Hiển thị", () => {
  test("Có khối ALERTS, 3 chart và 3 dropdown mặc định (Bet Count / USD / USD)", async ({ page }) => {
    test.setTimeout(90000);
    await openDashboard(page);

    await expect(page.getByText("ALERTS", { exact: true })).toBeVisible();
    for (const severity of ["Info", "Warning", "Critical"]) {
      await expect(page.getByText(severity, { exact: true }).first(), `thiếu mức ${severity}`).toBeVisible();
    }
    await expect(page.locator("canvas")).toHaveCount(3);
    await expect(page.locator(".ant-select")).toHaveCount(3);
    await expect(page.locator(".ant-select .ant-select-selection-item")).toHaveText(["Bet Count", "USD", "USD"]);

    const types = await Promise.all([0, 1, 2].map((i) => readChart(page, i).then((c) => c.type)));
    expect(types).toEqual(["bar", "bar", "line"]);
  });

  test("Tiêu đề 3 chart cùng khoảng 30 ngày gần nhất", async ({ page }) => {
    test.setTimeout(90000);
    await openDashboard(page);
    const titles = await Promise.all([0, 1, 2].map((i) => readChart(page, i).then((c) => c.title)));

    expect(titles[0]).toMatch(/^Top 10 Games \(/);
    expect(titles[1]).toMatch(/^Top 10 GGR by Currencies \(/);
    expect(titles[2]).toMatch(/^GGR \(/);
    const ranges = titles.map((t) => t.match(/\((\d{2}\/\d{2}\/\d{4}) - (\d{2}\/\d{2}\/\d{4})\)$/));
    for (const [i, m] of ranges.entries()) expect(m, `tiêu đề chart #${i}: "${titles[i]}"`).not.toBeNull();
    expect(new Set(ranges.map((m) => m[0])).size, "3 chart phải cùng khoảng ngày").toBe(1);

    const [from, to] = [ranges[0][1], ranges[0][2]].map((s) => parseDay(s.replace(/\//g, "-")));
    expect(diffDays(to, from), "khoảng ngày phải là 30 ngày (gồm cả ngày đầu và cuối)").toBe(29);
  });

  test("Dropdown metric có 3 lựa chọn Bet Count / Turnover / GGR", async ({ page }) => {
    test.setTimeout(90000);
    await openDashboard(page);
    await dashSelect(page, 0).click();
    await optionsOpen(page).first().waitFor();
    const titles = await optionsOpen(page).evaluateAll((els) => els.map((e) => e.getAttribute("title")));
    expect(titles).toEqual(["Bet Count", "Turnover", "GGR"]);
  });
});

test.describe("Dashboard - Chart khớp response API", () => {
  test("Mặc định: cả 3 chart hiển thị đúng dữ liệu API và request mặc định đúng", async ({ page }) => {
    test.setTimeout(90000);
    const dash = await openDashboard(page);

    expect(dash.topGames.body.currencyId).toEqual(expect.any(Number));
    expect(String(dash.topGames.body.performanceType)).toBe("1");
    expect(dash.ggrTrend.body.currencyId).toBe(dash.topGames.body.currencyId); // cùng currency mặc định (USD)

    const games = dash.topGames.json.data;
    await expectChartData(page, 0, games.map((g) => g.gameName), games.map((g) => g.value), "Top 10 Games");
    const currencies = dash.topCurrencies.json.data;
    await expectChartData(
      page,
      1,
      currencies.map((c) => c.currencyCode),
      currencies.map((c) => c.ggr),
      "Top 10 GGR by Currencies",
    );
    const trend = dash.ggrTrend.json.data;
    await expectChartData(page, 2, trend.map((t) => t.betDate), trend.map((t) => t.ggr), "GGR");
  });

  test("Top 10 Games: mọi currency có dữ liệu x 3 metric gửi đúng request, chart khớp response, giảm dần, tối đa 10 game", async ({
    page,
  }) => {
    test.setTimeout(420000);
    const dash = await openDashboard(page);
    const codes = currenciesWithData(dash);
    test.skip(codes.length === 0, "Không có currency nào có dữ liệu trên Top 10 GGR by Currencies");

    const state = { metric: METRICS[0] };
    const seenIds = new Set(); // currencyId gửi lên khi đổi sang từng currency phải khác nhau
    for (const code of codes) {
      const perMetric = await collectTopGames(page, dash, code, state);
      for (const metric of METRICS) {
        const { body, json, chart } = perMetric[metric.name];
        const at = `${code} / ${metric.name}`;
        expect.soft(json.status, at).toBe("success");
        expect.soft(String(body.performanceType), `performanceType của ${at}`).toBe(metric.type);
        expect.soft(body.currencyId, `currencyId của ${at}`).toEqual(expect.any(Number));
        expect.soft(body.currencyId, `${at}: đổi metric không được đổi currency`).toBe(perMetric[METRICS[0].name].body.currencyId);

        const values = json.data.map((g) => g.value);
        expect.soft(json.data.length, `${at}: tối đa 10 game`).toBeLessThanOrEqual(10);
        expect.soft(values, `${at}: phải sắp xếp giảm dần`).toEqual([...values].sort((a, b) => b - a));
        expect.soft(new Set(json.data.map((g) => g.gameCode)).size, `${at}: game bị lặp`).toBe(json.data.length);
        expect.soft(chart.datasetLabel, `nhãn dataset của ${at}`).toMatch(new RegExp(metric.name));
      }
      seenIds.add(perMetric[METRICS[0].name].body.currencyId);
    }
    expect(seenIds.size, "mỗi currency phải gửi currencyId khác nhau").toBe(codes.length);
  });

  test("GGR line chart: mọi currency có dữ liệu - đổi currency gửi đúng request, 30 ngày liên tiếp, chart khớp response", async ({
    page,
  }) => {
    test.setTimeout(300000);
    const dash = await openDashboard(page);
    const codes = currenciesWithData(dash);
    test.skip(codes.length === 0, "Không có currency nào có dữ liệu trên Top 10 GGR by Currencies");

    for (const code of codes) {
      const { body, json, title, labels } = await collectTrend(page, dash, code);
      expect.soft(body.currencyId, `request của ${code}`).toEqual(expect.any(Number));
      expect.soft(json.status, code).toBe("success");
      expect.soft(json.data, `${code}: phải đủ 30 ngày`).toHaveLength(30);
      for (let i = 1; i < labels.length; i++) {
        expect
          .soft(diffDays(parseDay(labels[i]), parseDay(labels[i - 1])), `${code}: ${labels[i - 1]} -> ${labels[i]} phải liên tiếp`)
          .toBe(1);
      }
      // Khoảng ngày ở tiêu đề = ngày đầu - ngày cuối của dữ liệu
      const toTitle = (d) => d.replace(/-/g, "/");
      expect.soft(title, `${code}: tiêu đề chart`).toBe(`GGR (${toTitle(labels[0])} - ${toTitle(labels[labels.length - 1])})`);
    }
  });

  test("Top 10 GGR by Currencies: tối đa 10 currency, không trùng, sắp xếp GGR giảm dần", async ({ page }) => {
    test.setTimeout(90000);
    const dash = await openDashboard(page);
    const currencies = dash.topCurrencies.json.data;
    expect(dash.topCurrencies.json.status).toBe("success");
    expect(currencies.length).toBeLessThanOrEqual(10);
    expect(new Set(currencies.map((c) => c.currencyCode)).size).toBe(currencies.length);
    const values = currencies.map((c) => c.ggr);
    expect(values, "phải sắp xếp GGR giảm dần").toEqual([...values].sort((a, b) => b - a));
  });
});

test.describe("Dashboard - So sánh với Game Summary (theo chart: mọi currency có dữ liệu)", () => {
  test("Khoảng ngày trên tiêu đề chart = Date Period 'Last 30 Days' của Game Summary", async ({ page }) => {
    test.setTimeout(120000);
    await openDashboard(page);
    const title = (await readChart(page, 0)).title;
    const m = title.match(/\((\d{2})\/(\d{2})\/(\d{4}) - (\d{2})\/(\d{2})\/(\d{4})\)$/);
    expect(m, `tiêu đề chart: "${title}"`).not.toBeNull();
    const chartRange = `${m[1]}-${m[2]}-${m[3]} - ${m[4]}-${m[5]}-${m[6]}`;

    await openGameSummary(page);
    await pickDatePreset(page, "Last 30 Days");
    await expect(dateRangeInput(page)).toHaveValue(chartRange);
  });

  test("Top 10 GGR by Currencies: mỗi cột = Total GGR của currency đó (Summation By Currency)", async ({ page }) => {
    test.setTimeout(420000);
    await openDashboard(page);
    const chart = await readChart(page, 1);
    const bars = chart.labels.map((code, i) => ({ code, ggr: chart.datasets[0].data[i] }));
    test.skip(bars.length === 0, "Top 10 GGR by Currencies không có dữ liệu");

    await openGameSummary(page);
    for (const [i, { code, ggr }] of bars.entries()) {
      if (i > 0) await resetGameSummary(page);
      await filterAndSearch(page, { currency: code });
      const totals = await readSummationTotals(page, code);
      expectClose(ggr, num(totals["Total GGR"]), TOL_SUMMATION, `Total GGR ${code}`);
    }
  });

  test("Top 10 Games: mọi currency có dữ liệu x 3 metric (Bet Count / Turnover / GGR) = Game Summary", async ({
    page,
  }) => {
    test.setTimeout(900000);
    const dash = await openDashboard(page);
    const codes = currenciesWithData(dash);
    test.skip(codes.length === 0, "Không có currency nào có dữ liệu trên Top 10 GGR by Currencies");

    // Bước 1: đọc chart Top 10 Games của từng currency / metric trên Dashboard
    const state = { metric: METRICS[0] };
    const charts = {};
    for (const code of codes) charts[code] = await collectTopGames(page, dash, code, state);

    // Bước 2: Game Summary của từng currency rồi so với chart
    await openGameSummary(page);
    for (const [i, code] of codes.entries()) {
      const { rows } = await loadGameSummary(page, code, { reset: i > 0 });
      expect.soft(rows.length, `Game Summary không có dòng nào cho ${code}`).toBeGreaterThan(0);
      for (const metric of METRICS) compareTopGames(code, metric, charts[code][metric.name].chart, rows);
    }
  });

  test("GGR line chart: mọi currency có dữ liệu - tổng các điểm = Total GGR của Game Summary (30 ngày)", async ({
    page,
  }) => {
    test.setTimeout(600000);
    const dash = await openDashboard(page);
    const codes = currenciesWithData(dash);
    test.skip(codes.length === 0, "Không có currency nào có dữ liệu trên Top 10 GGR by Currencies");

    const trends = {};
    for (const code of codes) trends[code] = await collectTrend(page, dash, code);

    await openGameSummary(page);
    for (const [i, code] of codes.entries()) {
      if (i > 0) await resetGameSummary(page);
      await filterAndSearch(page, { currency: code });
      const totals = await readSummationTotals(page, code);
      expectClose(sum(trends[code].values), num(totals["Total GGR"]), TOL_TREND_SUM, `Tổng GGR ${code}`);
    }
  });

  // LỖI ỨNG DỤNG ĐÃ XÁC NHẬN (giữ test FAIL cho tới khi sửa): GGR từng ngày của line chart lệch Game Summary dù tổng cả khoảng khớp.
  // TKN (17/11/2026): 10-11-2026 chart 18,939.122 / Game Summary 19,901.432 (chart thấp hơn 962.31); 11-11-2026 chart -55,580.109 /
  // Game Summary -56,542.419 (chart cao hơn 962.31) -> 1 khoản GGR 962.31 bị tính sang ngày khác. Các currency khác khớp từng ngày.
  test("GGR line chart: mọi currency có dữ liệu - GGR từng ngày = tổng GGR các dòng của ngày đó trên Game Summary", async ({
    page,
  }) => {
    test.setTimeout(600000);
    const dash = await openDashboard(page);
    const codes = currenciesWithData(dash);
    test.skip(codes.length === 0, "Không có currency nào có dữ liệu trên Top 10 GGR by Currencies");

    const trends = {};
    for (const code of codes) trends[code] = await collectTrend(page, dash, code);

    await openGameSummary(page);
    for (const [i, code] of codes.entries()) {
      const { rows } = await loadGameSummary(page, code, { reset: i > 0 });
      compareTrendPerDay(code, trends[code], rows);
    }
  });
});

test.describe("Dashboard - Đối chiếu cố định: TKN / Samba Bonanza", () => {
  test(`${FIXED_CURRENCY} / ${FIXED_GAME}: cột Turnover và Bet Count trên Top 10 Games = Total ETO và Total Bet Count (Summation By Currency)`, async ({
    page,
  }) => {
    test.setTimeout(300000);
    const dash = await openDashboard(page);
    test.skip(
      !currenciesWithData(dash).includes(FIXED_CURRENCY),
      `${FIXED_CURRENCY} không có dữ liệu trên Top 10 GGR by Currencies`,
    );
    const charts = await collectTopGames(page, dash, FIXED_CURRENCY, { metric: METRICS[0] });
    const bar = (metricName) => {
      const { labels, values } = charts[metricName].chart;
      const i = labels.indexOf(FIXED_GAME);
      return i < 0 ? null : values[i];
    };
    const turnover = bar("Turnover");
    const betCount = bar("Bet Count");
    test.skip(
      turnover === null && betCount === null,
      `${FIXED_GAME} không nằm trong Top 10 Games của ${FIXED_CURRENCY} (cả Turnover lẫn Bet Count)`,
    );

    // Game Summary: Currency + Game Name (30 ngày, Sweepstake All) -> bảng Summation By Currency
    await openGameSummary(page);
    await filterAndSearch(page, { currency: FIXED_CURRENCY, game: FIXED_GAME });
    const totals = await readSummationTotals(page, FIXED_CURRENCY);
    if (turnover !== null) {
      expectClose(turnover, num(totals["Total ETO"]), TOL_SUMMATION, `Turnover ${FIXED_GAME} (${FIXED_CURRENCY})`);
    }
    if (betCount !== null) {
      expectClose(betCount, num(totals["Total Bet Count"]), 0, `Bet Count ${FIXED_GAME} (${FIXED_CURRENCY})`);
    }
  });

  test(`${FIXED_CURRENCY}: Top 10 Games (Bet Count / Turnover / GGR) = Game Summary`, async ({ page }) => {
    test.setTimeout(300000);
    const dash = await openDashboard(page);
    test.skip(
      !currenciesWithData(dash).includes(FIXED_CURRENCY),
      `${FIXED_CURRENCY} không có dữ liệu trên Top 10 GGR by Currencies`,
    );
    const charts = await collectTopGames(page, dash, FIXED_CURRENCY, { metric: METRICS[0] });

    await openGameSummary(page);
    const { rows } = await loadGameSummary(page, FIXED_CURRENCY);
    for (const metric of METRICS) compareTopGames(FIXED_CURRENCY, metric, charts[metric.name].chart, rows);
  });

  test(`${FIXED_CURRENCY}: cột Top 10 GGR by Currencies = tổng GGR line chart = Total GGR của Game Summary`, async ({
    page,
  }) => {
    test.setTimeout(300000);
    const dash = await openDashboard(page);
    const bars = await readChart(page, 1);
    const i = bars.labels.indexOf(FIXED_CURRENCY);
    test.skip(i < 0, `${FIXED_CURRENCY} không có dữ liệu trên Top 10 GGR by Currencies`);
    const barGgr = bars.datasets[0].data[i];
    const trend = await collectTrend(page, dash, FIXED_CURRENCY);

    await openGameSummary(page);
    await filterAndSearch(page, { currency: FIXED_CURRENCY });
    const totalGgr = num((await readSummationTotals(page, FIXED_CURRENCY))["Total GGR"]);

    expectClose(barGgr, totalGgr, TOL_SUMMATION, `Cột ${FIXED_CURRENCY} trên Top 10 GGR by Currencies`);
    expectClose(sum(trend.values), totalGgr, TOL_TREND_SUM, `Tổng GGR line chart ${FIXED_CURRENCY}`);
  });

  // LỖI ỨNG DỤNG ĐÃ XÁC NHẬN (giữ test FAIL cho tới khi sửa): GGR từng ngày của line chart TKN lệch Game Summary dù tổng khớp.
  // 17/11/2026: 10-11-2026 chart 18,939.122 / Game Summary 19,901.432 (chart thấp hơn 962.31); 11-11-2026 chart -55,580.109 /
  // Game Summary -56,542.419 (chart cao hơn 962.31) -> 1 khoản GGR 962.31 bị tính sang ngày khác.
  test(`${FIXED_CURRENCY}: GGR từng ngày của line chart = tổng GGR các dòng của ngày đó trên Game Summary`, async ({ page }) => {
    test.setTimeout(300000);
    const dash = await openDashboard(page);
    test.skip(
      !currenciesWithData(dash).includes(FIXED_CURRENCY),
      `${FIXED_CURRENCY} không có dữ liệu trên Top 10 GGR by Currencies`,
    );
    const trend = await collectTrend(page, dash, FIXED_CURRENCY);

    await openGameSummary(page);
    const { rows } = await loadGameSummary(page, FIXED_CURRENCY);
    compareTrendPerDay(FIXED_CURRENCY, trend, rows);
  });
});

// ---------------------------------------------------------------------------
// ALERTS (Info / Warning / Critical) <-> Alert Report
// ---------------------------------------------------------------------------
const alertReportRows = (page) => page.locator(".ant-table").first().locator("tbody tr.ant-table-row");
const alertReportSummary = (page) => page.getByText(/^Showing \d+ - \d+ of [\d,]+ records$/);

// Giá trị 1 cột (theo tên header) của bảng Alert Report ở trang hiện tại
async function alertReportColumn(page, name) {
  const table = page.locator(".ant-table").first();
  const heads = (await table.locator("thead th").allInnerTexts()).map((t) => t.trim());
  expect(heads, `Alert Report thiếu cột "${name}"`).toContain(name);
  return alertReportRows(page).evaluateAll((trs, i) => trs.map((tr) => tr.children[i].innerText.trim()), heads.indexOf(name));
}

test.describe("Dashboard - ALERTS (Info / Warning / Critical)", () => {
  test("Hiển thị đúng thứ tự Info / Warning / Critical, số lượng khớp response alertreport/summary", async ({ page }) => {
    test.setTimeout(90000);
    const { json } = await openDashboardAlerts(page);
    expect(json.status).toBe("success");

    // API trả đủ 3 mức, mỗi mức là số nguyên không âm (thứ tự trong response không cố định: CRITICAL, INFO, WARNING)
    const byLevel = Object.fromEntries(json.data.map((d) => [d.severity, d.quantity]));
    expect(Object.keys(byLevel).sort(), "response phải có đủ 3 mức").toEqual(["CRITICAL", "INFO", "WARNING"]);
    for (const [severity, quantity] of Object.entries(byLevel)) {
      expect(Number.isInteger(quantity) && quantity >= 0, `${severity}: ${quantity}`).toBe(true);
    }

    // Thứ tự hiển thị từ trái sang phải: Info, Warning, Critical
    const xs = [];
    for (const { label } of ALERT_LEVELS) {
      await expect(alertLabel(page, label), `thiếu mức ${label}`).toBeVisible();
      xs.push((await alertLabel(page, label).boundingBox()).x);
    }
    expect(xs, "thứ tự hiển thị").toEqual([...xs].sort((a, b) => a - b));

    // Con số hiển thị = quantity của API (số nguyên, không có dấu phân cách hàng nghìn)
    for (const { label, api } of ALERT_LEVELS) {
      await expect(alertNumber(page, label), `số của ${label}`).toHaveText(String(byLevel[api]));
    }
  });

  for (const { label } of ALERT_LEVELS) {
    test(`Bấm số ${label}: chuyển sang Alert Report lọc Severity ${label}, tổng bản ghi = số trên Dashboard`, async ({
      page,
    }) => {
      test.setTimeout(90000);
      await openDashboardAlerts(page);
      const shown = Number((await alertNumber(page, label).innerText()).trim());
      expect(Number.isInteger(shown), `số ${label} trên Dashboard`).toBe(true);

      const [req, res] = await Promise.all([
        page.waitForRequest(isAlertList),
        page.waitForResponse(isAlertList),
        alertNumber(page, label).click(),
      ]);
      await expect(page).toHaveURL(/\/report\/alert$/);

      // Request của Alert Report: lọc đúng Severity, timezone mặc định, trang 1
      const body = JSON.parse(req.postData());
      expect(body.filters.severity, "filter severity gửi lên").toBe(label);
      expect(body.filters.timezoneId).toEqual(expect.any(Number));
      expect(body).toMatchObject({ page: 1, pageSize: 10 });

      // Tổng bản ghi của Alert Report = số trên Dashboard
      const json = await res.json();
      expect(json.status).toBe("success");
      const total = json.data.totalCount;
      expect(total, `Alert Report (Severity ${label}) có ${total} bản ghi, Dashboard hiển thị ${shown}`).toBe(shown);

      // Màn hình Alert Report hiển thị đúng: ô Severity, tổng số bản ghi, và mọi dòng của trang đầu đúng Severity
      await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
      await expect(
        page
          .locator(".NextGen-filter-element")
          .filter({ has: page.locator("#severity") })
          .locator(".ant-select-selection-item[title]"),
      ).toHaveAttribute("title", label);
      await expect(alertReportSummary(page)).toBeVisible();
      const [, from, to, count] = (await alertReportSummary(page).innerText()).match(/^Showing (\d+) - (\d+) of ([\d,]+) records$/);
      expect(num(count), "tổng bản ghi hiển thị ở chân bảng Alert Report").toBe(total);
      expect([Number(from), Number(to)], "khoảng dòng đang hiển thị").toEqual(total === 0 ? [0, 0] : [1, Math.min(10, total)]);
      if (total > 0) {
        await expect(alertReportRows(page)).toHaveCount(Math.min(10, total));
        for (const v of await alertReportColumn(page, "Severity")) expect(v).toBe(label);
      }
    });
  }

  // Alert Report không lọc có tổng = Info + Warning + Critical (dev có thể sinh alert mới giữa 2 lần đọc -> hiếm khi lệch 1-2 bản ghi)
  test("Tổng Info + Warning + Critical = tổng số bản ghi của Alert Report (không lọc Severity)", async ({ page }) => {
    test.setTimeout(90000);
    const { json } = await openDashboardAlerts(page);
    const dashboardTotal = sum(json.data.map((d) => d.quantity));

    const [req, res] = await Promise.all([
      page.waitForRequest(isAlertList),
      page.waitForResponse(isAlertList),
      page.goto("/report/alert"),
    ]);
    expect(JSON.parse(req.postData()).filters.severity, "Alert Report mở ra không được lọc sẵn Severity").toBeUndefined();
    const total = (await res.json()).data.totalCount;
    expect(total, `Alert Report có ${total} bản ghi, tổng 3 mức trên Dashboard là ${dashboardTotal}`).toBe(dashboardTotal);
  });
});

// ---------------------------------------------------------------------------
// Chuông thông báo (Notification) ở header <-> Alert Report
// ---------------------------------------------------------------------------
const bellButton = (page) =>
  page.locator("button").filter({ has: page.locator(".NextGen-popover-notification__button__badge") });
const notificationPopover = (page) => page.locator(".ant-popover:not(.ant-popover-hidden)").filter({ hasText: "Notification" });
// Màu tag Severity đã quan sát được (Warning chưa có trong 10 cảnh báo mới nhất nên không kiểm tra màu)
const SEVERITY_TAG_CLASS = { Info: "ant-tag-blue", Critical: "ant-tag-red" };

// Mở Dashboard và chờ alertreport/list của chuông. Trả về { body, json }.
async function openDashboardBell(page) {
  const list = page.waitForResponse(isBellList).then(async (res) => ({
    body: JSON.parse(res.request().postData() || "{}"),
    json: await res.json(),
  }));
  await gotoAndWait(page, DASHBOARD_URL, list);
  await expect(bellButton(page)).toBeVisible();
  return list;
}

// Các cảnh báo trong popover: { title, severity, tagClass, rule, time }
async function readNotifications(popover) {
  return popover.locator('[class*="__notification__media_"]').evaluateAll((els) =>
    els.map((e) => {
      const [head, rule, time] = [...e.children];
      const tag = head.querySelector(".ant-tag");
      return {
        title: head.children[0].innerText.trim(),
        severity: tag.innerText.trim(),
        tagClass: tag.className,
        rule: rule.innerText.trim(),
        time: time.innerText.trim(),
      };
    }),
  );
}

// Dòng của response alertreport/list -> dạng hiển thị trong popover
const expectedNotification = (a) => ({
  title: `${a.playerName} - ${a.gameName} - ${a.currencyCode}`,
  severity: a.severity,
  rule: a.ruleName,
  time: `${a.fromTime} - ${a.toTime}`,
});

test.describe("Dashboard - Chuông thông báo (Notification)", () => {
  test("Request khi mở trang, popover 'Notification' hiển thị đúng các cảnh báo mới nhất và nút View All", async ({ page }) => {
    test.setTimeout(90000);
    const { body, json } = await openDashboardBell(page);

    // Request: 10 cảnh báo mới nhất (id giảm dần), không lọc
    expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc", filters: {} });
    expect(json.status).toBe("success");
    const alerts = json.data.list;
    test.skip(alerts.length === 0, "Chưa có cảnh báo nào để hiển thị trong chuông");
    const ids = alerts.map((a) => a.id);
    expect(ids, "response phải sắp xếp id giảm dần").toEqual([...ids].sort((a, b) => b - a));

    await bellButton(page).click();
    const popover = notificationPopover(page);
    await expect(popover).toBeVisible();
    await expect(popover.locator(".ant-popover-title")).toHaveText("Notification");
    await expect(popover.getByRole("button", { name: "View All" })).toBeVisible();

    // Từng cảnh báo trong popover = dòng tương ứng của response (cùng thứ tự)
    await expect(popover.locator('[class*="__notification__media_"]')).toHaveCount(alerts.length);
    const items = await readNotifications(popover);
    items.forEach((item, i) => {
      const at = `cảnh báo #${i + 1} (id ${alerts[i].id})`;
      expect({ title: item.title, severity: item.severity, rule: item.rule, time: item.time }, at).toEqual(
        expectedNotification(alerts[i]),
      );
      const colorClass = SEVERITY_TAG_CLASS[item.severity];
      if (colorClass) expect(item.tagClass, `${at}: màu tag ${item.severity}`).toContain(colorClass);
    });
  });

  // Dev có thể sinh cảnh báo mới giữa lúc mở Dashboard và lúc mở Alert Report -> hiếm khi lệch dòng đầu
  test("Bấm View All: chuyển sang Alert Report (không lọc), 10 dòng đầu trùng các cảnh báo trong popover", async ({ page }) => {
    test.setTimeout(90000);
    const { json } = await openDashboardBell(page);
    test.skip(json.data.list.length === 0, "Chưa có cảnh báo nào để hiển thị trong chuông");

    await bellButton(page).click();
    const popover = notificationPopover(page);
    await expect(popover).toBeVisible();
    const items = await readNotifications(popover);

    const [req, res] = await Promise.all([
      page.waitForRequest(isAlertList),
      page.waitForResponse(isAlertList),
      popover.getByRole("button", { name: "View All" }).click(),
    ]);
    await expect(page).toHaveURL(/\/report\/alert$/);
    const body = JSON.parse(req.postData());
    expect(body.filters.severity, "View All không được lọc Severity").toBeUndefined();
    expect(body).toMatchObject({ page: 1, pageSize: 10, sortBy: "id", sortDirection: "desc" });
    expect((await res.json()).status).toBe("success");

    // 10 dòng đầu của Alert Report (cột theo tên header) = các cảnh báo trong popover
    await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
    await expect(alertReportRows(page)).toHaveCount(items.length);
    const [player, game, currency, rule, severity, from, to] = await Promise.all(
      ["Player Name", "Game", "Currency", "Rule Name", "Severity", "From Time", "To Time"].map((c) => alertReportColumn(page, c)),
    );
    items.forEach((item, i) => {
      expect(
        {
          title: `${player[i]} - ${game[i]} - ${currency[i]}`,
          severity: severity[i],
          rule: rule[i],
          time: `${from[i]} - ${to[i]}`,
        },
        `dòng #${i + 1} của Alert Report`,
      ).toEqual({ title: item.title, severity: item.severity, rule: item.rule, time: item.time });
    });
  });
});
