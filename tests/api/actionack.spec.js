// Test cho ActionAckController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\ActionAckController.cs)
// Toàn bộ endpoint yêu cầu session đã verify OTP (SecurityCheckpointType.SessionVerify) - dùng
// fixture verifiedRequest (xem tests/api/fixtures.js).
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("ActionAck API - /action-ack/list", () => {
  // KNOWN ISSUE (backend): trả UNKNOWN_ERROR trên DB dev hiện tại dù request body đủ field bắt
  // buộc. Test này CỐ TÌNH để fail đỏ - không dùng test.fail() - để nhắc backend xử lý mỗi lần
  // chạy suite, cho tới khi bug được fix.
  test("lists action acks", async ({ verifiedRequest }) => {
    const { json } = await apiPost(verifiedRequest, "/action-ack/list", {
      page: 1,
      pageSize: 10,
      filters: {},
    });

    expect(json.status).toBe("success");
  });
});

test.describe("ActionAck API - /action-ack/status", () => {
  // KNOWN LIMITATION (permission seed gap, không phải bug 2FA): trả NOT_PERMISSION dù session đã
  // verify OTP - giống download/file, auth/refresh-token.
  test("rejects checking status without the required permission", async ({ verifiedRequest }) => {
    const { json } = await apiPost(verifiedRequest, "/action-ack/status", {
      messageId: "qa-test-message-id",
      filters: {},
    });

    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("NOT_PERMISSION");
  });
});

test.describe("ActionAck API - /action-ack/notify/list", () => {
  test("lists action ack notifications", async ({ verifiedRequest }) => {
    const { response, json } = await apiPost(verifiedRequest, "/action-ack/notify/list", {});

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(Array.isArray(json.data.list)).toBe(true);
  });
});

test.describe("ActionAck API - /action-ack/notify/received", () => {
  test("rejects marking a non-existent message as received", async ({ verifiedRequest }) => {
    const { json } = await apiPost(verifiedRequest, "/action-ack/notify/received", {
      messageId: "qa-nonexistent-message-id",
      application: "BO",
      notifyStatus: "received",
    });

    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("INVALID_REQUEST");
  });
});
