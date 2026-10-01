// Test cho GameRoundController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\GameRoundController.cs)
// Không test update-status: đã đọc GameRoundService.UpdateStatus (Infrastructure) - hàm này gọi
// thẳng ra IBetHistoryClientService.UpdateStatusGameRound, tức là thao tác trên round cược THẬT ở
// 1 hệ thống bet-history NGOÀI (không phải chỉ ghi DB nội bộ của BO API) - cùng nhóm rủi ro với
// operator_request/retry (side-effect hệ thống ngoài trên dữ liệu giao dịch/tài chính thật, không
// có cách khôi phục an toàn). Ngoài ra list cũng đang bị lỗi (xem KNOWN ISSUE dưới) nên cũng không
// có cách lấy 1 round id hợp lệ dù có muốn thử.
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

function formatDMY(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function narrowDateRange() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return [formatDMY(yesterday), formatDMY(tomorrow)];
}

test.describe("GameRound API - /game_round/list", () => {
  // KNOWN ISSUE (hệ thống bet-history ngoài, không phải bug BO API/test): đã xác nhận qua curl
  // trực tiếp với đủ filters.timezoneId + createdTime range - vẫn UNKNOWN_ERROR. Đã đọc
  // GameRoundService.List: gọi _betHistoryClientService.ListGameRound(...) - CÙNG gRPC
  // BetHistoryService với bet_history/settled (FilterBetHistory), nhưng FilterBetHistory đã xác
  // nhận chạy tốt (xem report.spec.js) trong khi ListGameRound vẫn lỗi - nghĩa là RPC method
  // ListGameRound cụ thể đang có vấn đề ở phía server ngoài (175.41.231.2:8916), không phải do
  // thiếu field hay do BO API. Test CỐ TÌNH để fail đỏ - không dùng test.fail() - để nhắc xử lýđu
  // mỗi lần chạy suite, cho tới khi RPC method này được backend/hệ thống ngoài fix.
  test("lists game rounds", async ({ authedRequest }) => {
    const [start, end] = narrowDateRange();
    const { json } = await apiPost(authedRequest, "/game_round/list", {
      page: 1,
      pageSize: 10,
      filters: { timezoneId: 336, createdTime: [start, end], statuses: [ "failed"] },
    });

    expect(json.status).toBe("success");
    expect(typeof json.data.totalCount).toBe("number");
    expect(Array.isArray(json.data.list)).toBe(true);
  });
});
