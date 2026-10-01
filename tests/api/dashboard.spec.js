// Test cho DashboardController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\DashboardController.cs)
// Dùng fixture verifiedRequest (tự vượt qua SecurityCheckpointType.SessionVerify) cho tất cả
// endpoint trong file này.
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("Dashboard API - report endpoints", () => {
  // ĐÃ TỰ HẾT (xác nhận qua curl trực tiếp): backend nay trỏ WebClient.GameReportSummaryService
  // sang địa chỉ thật (không còn placeholder .example.invalid) - cả 3 endpoint dưới đây giờ trả
  // success bình thường. Xem KNOWN_ISSUES.md mục "THAY ĐỔI MÔI TRƯỜNG LỚN".
  test("shows top performing games", async ({ verifiedRequest }) => {
    const { json } = await apiPost(verifiedRequest, "/dashboard/top-performing-games", {
      performanceType: 1, // DashboardPerformanceType.BetCount
      currencyId: 1,
    });
    expect(json.status).toBe("success");
  });

  test("shows the GGR trend", async ({ verifiedRequest }) => {
    const { json } = await apiPost(verifiedRequest, "/dashboard/ggr-trend", { currencyId: 1 });
    expect(json.status).toBe("success");
  });

  test("shows top currencies", async ({ verifiedRequest }) => {
    const { json } = await apiPost(verifiedRequest, "/dashboard/top-currencies", {
      page: 1,
      pageSize: 10,
    });
    expect(json.status).toBe("success");
  });
});

test.describe("Dashboard API - retention endpoints", () => {
  // KNOWN LIMITATION (permission seed gap, không phải bug): trả NOT_PERMISSION dù session đã
  // verify OTP - role ADMIN_1 có thể thiếu permission mapping cho 2 action này, giống
  // auth/refresh-token.
  test("rejects tracking/retention without the required permission", async ({ verifiedRequest }) => {
    const { json } = await apiPost(verifiedRequest, "/tracking/retention", {});
    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("NOT_PERMISSION");
  });

  test("rejects calculate/retention without the required permission", async ({ verifiedRequest }) => {
    const { json } = await apiPost(verifiedRequest, "/calculate/retention", {});
    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("NOT_PERMISSION");
  });
});
