// Test cho FailOperatorRequestController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\FailOperatorRequestController.cs)
// Không test "retry": đã đọc FailOperatorRequestService.Retry (Infrastructure) - gọi thẳng ra
// WebClient.RetryCancelBetService (1 HTTP client NGOÀI, xem DependencyInjection.cs) để retry huỷ
// cược thật ở hệ thống bet-history/thanh toán - side-effect tài chính thật, không có cách khôi
// phục nếu chạy nhầm, và endpoint này hiện cũng sẽ tự fail vì service đó đang là URL placeholder
// ".example.invalid" trên appsettings.Development.json (xem KNOWN_ISSUES.md mục "service report/
// promo bên ngoài chưa cấu hình" - cùng nhóm nguyên nhân).
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("FailOperatorRequest API - /operator_request/list", () => {
  // ĐÃ TỰ HẾT (xác nhận qua curl trực tiếp, cùng đúng body test này đang gửi): trả success bình
  // thường, không còn UNKNOWN_ERROR. Xem KNOWN_ISSUES.md mục "THAY ĐỔI MÔI TRƯỜNG LỚN".
  test("lists failed operator requests", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/operator_request/list", {
      page: 1,
      pageSize: 10,
      filters: { timezoneId: 336 },
    });

    expect(json.status).toBe("success");
    expect(typeof json.data.totalCount).toBe("number");
    expect(Array.isArray(json.data.list)).toBe(true);
  });
});
