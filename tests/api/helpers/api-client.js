const crypto = require("crypto");
const { test } = require("@playwright/test");

// Tất cả route của BO API đều nằm dưới prefix này (xem Endpoints.PATH trong source .NET)
const API_PATH = "/sas-web/api/v1";

// Giới hạn timeout CHUNG cho 1 request qua apiPost() - tránh 1 request bị treo (vd query quá rộng
// trên dữ liệu dev thật, hoặc service ngoài không phản hồi) kéo dài tới hết test timeout (30s mặc
// định của Playwright) rồi mới báo lỗi mập mờ "Request context disposed". Set thấp hơn test
// timeout để fail nhanh, rõ ràng hơn (timeout của chính request, không phải do dọn fixture giữa
// chừng) - đổi số này nếu cần áp dụng khác đi cho toàn bộ suite.
const REQUEST_TIMEOUT_MS = 10_000;

function genTraceId() {
  return crypto.randomUUID();
}

// Đính kèm mọi request/response vào testInfo hiện tại, để response-reporter.js in ra
// terminal khi test fail - không cần sửa từng expect() trong các file *.spec.js.
// test.info() lấy đúng test đang chạy dù được gọi từ helper (fixtures.js) hay từ file
// dùng thẳng @playwright/test (auth.spec.js), vì nó là singleton theo AsyncLocalStorage
// của module @playwright/test, không phụ thuộc test object nào require nó.
async function attachApiCall(entry) {
  let testInfo;
  try {
    testInfo = test.info();
  } catch {
    return; // gọi ngoài 1 test đang chạy (không nên xảy ra) - bỏ qua, không làm fail test
  }
  await testInfo.attach("api-call", {
    body: JSON.stringify(entry, null, 2),
    contentType: "application/json",
  });
}

// Mọi request body của API này đều bắt buộc có traceId dạng GUID,
// thiếu field (kể cả null) sẽ bị BO API từ chối với lỗi 400 deserialize.
async function apiPost(request, endpoint, body = {}, options = {}) {
  const response = await request.post(`${API_PATH}${endpoint}`, {
    data: { traceId: genTraceId(), ...body },
    timeout: options.timeout ?? REQUEST_TIMEOUT_MS,
  });
  const json = await response.json().catch(() => null);
  await attachApiCall({
    endpoint,
    requestBody: body,
    status: response.status(),
    response: json,
  });
  return { response, json };
}

module.exports = { genTraceId, apiPost, API_PATH, REQUEST_TIMEOUT_MS };
