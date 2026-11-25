// Kiểm tra "dữ liệu server LƯU" có đúng với "dữ liệu đã GỬI" và các màn hình đọc có nhất quán với nhau không.
//
// Vì sao cần: nhiều lỗi backend KHÔNG làm API ghi báo lỗi mà trả `success`, nhưng lưu sai (vd tạo master agent với house X
// nhưng server gán house mặc định). Test chỉ kiểm tra `status === "success"` hoặc chọn option ĐẦU TIÊN (thường trùng giá trị mặc định)
// thì không bao giờ thấy. Ba cách bắt được lỗi dạng này:
//   1. expectPersisted  - sau khi tạo / sửa, ĐỌC LẠI (view / list) rồi so từng trường với dữ liệu đã gửi.
//   2. relationMismatches - kiểm tra CHÉO các nguồn đọc: quan hệ cha-con trong list / view phải khớp nhau (chỉ đọc, chạy hằng ngày).
//   3. Khi tạo bản ghi có quan hệ (house, master agent, role...), chọn option KHÔNG phải option đầu / mặc định (xem pickIndexNotDefault).
//
// Mỗi sai lệch là 1 câu "đã gửi / server lưu" hoặc "mong đợi / hiển thị" nên failures.md liệt kê được từng trường lỗi.
const { expect } = require("@playwright/test");

// Chuẩn hoá để so sánh: số và chuỗi số coi như nhau (id có thể là 497 hoặc "497"), mảng so không phụ thuộc thứ tự, object so theo khoá
function canon(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map(canon).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : String(v);
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const show = (v) => (v === undefined ? "(không có)" : JSON.stringify(v));

// pairs: [[tên trường, giá trị đã gửi, giá trị server lưu]] -> danh sách câu mô tả trường bị lệch (rỗng = khớp hết)
function diffPersisted(pairs) {
  return pairs
    .filter(([, sent, stored]) => !same(sent, stored))
    .map(([field, sent, stored]) => `Trường ${field}: đã gửi = ${show(sent)}; server lưu = ${show(stored)}`);
}

function expectPersisted(pairs, message) {
  expect(diffPersisted(pairs), message).toEqual([]);
}

// Quan hệ cha-con phải nhất quán giữa các nguồn đọc.
//   relation: tên quan hệ ("house", "master agent"...)
//   rows: [{ label, why, expected: { id, code } | undefined, shown: [[nơi hiển thị, { id, code }]] }]
//     expected = bản ghi cha SUY RA từ nguồn đáng tin (vd house có sasEntityId = parentSasEntityId của view)
//     shown    = cha mà các màn hình / API khác đang hiển thị cho cùng bản ghi
function relationMismatches(relation, rows) {
  const out = [];
  for (const r of rows) {
    if (!r.expected) {
      out.push(`${r.label}: không tìm thấy ${relation} nào theo ${r.why}`);
      continue;
    }
    for (const [where, ref] of r.shown) {
      if (!ref || String(ref.id) !== String(r.expected.id)) {
        out.push(
          `${r.label}: ${relation} theo ${r.why} là "${r.expected.code}" (id ${r.expected.id}), ` +
            `nhưng ${where} hiển thị "${ref ? ref.code : "(trống)"}" (id ${ref ? ref.id : "-"})`,
        );
      }
    }
  }
  return out;
}

// Tham chiếu so sánh theo MÃ (code) thay vì id: id của cùng 1 house / master agent khác nhau giữa các API
// (house.id trong masteragent/list ≠ sasEntityId trong entityParent của user / role), còn code thì luôn giống nhau.
const codeRef = (o) => (o && o.code ? { id: o.code, code: o.code } : undefined);

// Bảng tra cứu theo sasEntityId từ 1 danh sách (house/list, masteragent/list, agent/list đều có sasEntityId; role/listhierarchy dùng entityId)
const bySasEntityId = (list, key = "sasEntityId") => new Map(list.map((r) => [String(r[key]), r]));

// Chọn option để TẠO bản ghi sao cho khác giá trị mặc định: option thứ 2 (index 1) nếu có từ 2 option trở lên.
// Option đầu thường trùng giá trị mặc định của hệ thống (vd Royal Edge House) nên không phát hiện được lỗi "luôn gán mặc định".
// Trả -1 khi chỉ có 1 option: test nên skip vì không phân biệt được giá trị đã chọn với mặc định.
const pickIndexNotDefault = (count) => (count >= 2 ? 1 : -1);

// Mở màn hình `path` và trả về JSON của response POST kết thúc bằng `endpoint` (chỉ ĐỌC).
async function captureJson(page, endpoint, path) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(endpoint), { timeout: 60000 }),
    page.goto(path),
  ]);
  return res.json();
}

// Như captureJson nhưng ép request list lấy `pageSize` dòng (mặc định 200 = lựa chọn lớn nhất của màn hình) để có đủ bản ghi dựng bảng tra cứu.
async function captureFullList(page, endpoint, path, pageSize = 200) {
  const pattern = new RegExp(endpoint.replace(/\//g, "\\/") + "$");
  const handler = async (route) => {
    const req = route.request();
    let body = null;
    try {
      body = JSON.parse(req.postData());
    } catch {
      /* không phải JSON */
    }
    if (req.method() !== "POST" || !body) return route.fallback();
    return route.continue({ postData: JSON.stringify({ ...body, page: 1, pageSize }) });
  };
  await page.route(pattern, handler);
  try {
    return await captureJson(page, endpoint, path);
  } finally {
    await page.unroute(pattern, handler);
  }
}

module.exports = { diffPersisted, expectPersisted, relationMismatches, pickIndexNotDefault, captureJson, captureFullList, codeRef, bySasEntityId };
