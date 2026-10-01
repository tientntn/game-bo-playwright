// Test cho AuditLogController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\AuditLogController.cs)
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("AuditLog API - /log", () => {
  // filters.timeZoneId bắt buộc > 0 (khác với schema swagger không đánh dấu required) - thiếu
  // field này API trả VALIDATION_FAILED, không phải lỗi giả định.
  test("lists audit logs with pagination envelope", async ({
    authedRequest,
  }) => {
    const { response, json } = await apiPost(authedRequest, "/log", {
      page: 1,
      pageSize: 10,
      filters: { timezoneId: 336 },
    });

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(typeof json.data.totalCount).toBe("number");
    expect(Array.isArray(json.data.list)).toBe(true);
  });
});

test.describe("AuditLog API - /log/view", () => {
  test("views an audit log entry", async ({ authedRequest }) => {
    const { json: listJson } = await apiPost(authedRequest, "/log", {
      page: 1,
      pageSize: 1,
      filters: { timezoneId: 336 },
    });
    test.skip(
      listJson.data.list.length === 0,
      "Không có audit log nào trên DB dev để test",
    );

    const { json } = await apiPost(authedRequest, "/log/view", {
      id: listJson.data.list[0].id,
    });

    expect(json.status).toBe("success");
    expect(typeof json.data.module).toBe("string");
  });
});
