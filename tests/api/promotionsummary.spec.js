// Test cho PromotionSummaryController
// (D:\Net\bo_backend\GridPlay.BO.API\Controllers\PromotionSummaryController.cs)
// Dùng fixture verifiedRequest (tự vượt qua SecurityCheckpointType.SessionVerify) cho tất cả
// endpoint trong file này.
//
// Đã xác nhận lại qua curl trực tiếp sau khi backend trỏ WebClient.PromoReportServiceClient sang
// địa chỉ thật (không còn placeholder .example.invalid): `promotion-summary-player-report`,
// `promotion-summary-player-detail-report`, `free_game_dropdown`, `player_dropdown` ĐÃ TỰ HẾT,
// trả success bình thường - xem 4 test đầu bên dưới.
//
// `promotion-summary-report` vẫn lỗi ở service ngoài. `promotion-summary-promo-report` hiện trả
// success nhưng thường mất hơn timeout request mặc định 10 giây, nên test override thành 60 giây.
// Xem PromotionSummaryReportService.cs:
// GetList()/GetListPromotionSummaryPromoReport() gọi 2 route khác nhau
// (`/api/freegame/promotion-summary-report`, `/api/freegame/promotion-summary-promo-report`) trên
// CÙNG WebClient.PromoReportServiceClient mà 2 route kia (player-report/player-detail-report) đang
// dùng và đã chạy tốt - nghĩa là bản thân 2 route cụ thể này đang lỗi ở phía service ngoài đó,
// không phải do thiếu cấu hình hay do BO API/test.
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

const PROMOTION_SUMMARY_REQUEST_TIMEOUT_MS = 60_000;

test.describe("PromotionSummary API - đã tự hết sau khi service ngoài được cấu hình đúng", () => {
  test("shows the promotion summary player report", async ({
    verifiedRequest,
  }) => {
    const { json } = await apiPost(
      verifiedRequest,
      "/report/promotion-summary-player-report",
      {
        page: 1,
        pageSize: 10,
        filters: { timeZoneId: 336 },
      },
    );
    expect(json.status).toBe("success");
  });

  test("shows the promotion summary player detail report", async ({
    verifiedRequest,
  }) => {
    const { json } = await apiPost(
      verifiedRequest,
      "/report/promotion-summary-player-detail-report",
      { page: 1, pageSize: 10, filters: { timeZoneId: 336 } },
    );
    expect(json.status).toBe("success");
  });

  test("lists the free game dropdown", async ({ verifiedRequest }) => {
    const { json } = await apiPost(
      verifiedRequest,
      "/report/free_game_dropdown",
      {},
    );
    expect(json.status).toBe("success");
  });

  test("lists the player dropdown", async ({ verifiedRequest }) => {
    const { json } = await apiPost(
      verifiedRequest,
      "/report/player_dropdown",
      {},
    );
    expect(json.status).toBe("success");
  });
});

test.describe("PromotionSummary API - KNOWN ISSUE (service ngoài thật, vẫn lỗi)", () => {
  // Route dưới đây vẫn UNKNOWN_ERROR dù đủ field bắt buộc, trong khi 2 route "player-report"/
  // "player-detail-report" ở describe trên (cùng 1 WebClient.PromoReportServiceClient) đã chạy
  // tốt. Nghĩa là đây là lỗi cụ thể ở 2 route này trên chính service ngoài đó, không phải thiếu
  // cấu hình chung hay bug BO API/test. Test CỐ TÌNH để fail đỏ - không dùng test.fail() - để
  // nhắc theo dõi tình trạng 2 route này.
  test("shows the promotion summary report", async ({ verifiedRequest }) => {
    const { json } = await apiPost(
      verifiedRequest,
      "/report/promotion-summary-report",
      {
        page: 1,
        pageSize: 10,
        sortBy: "creationDate",
        sortDirection: "desc",
        filters: { timeZoneId: 336 },
      },
    );
    expect(json.status).toBe("success");
  });
});

test.describe("PromotionSummary API - service ngoài phản hồi chậm", () => {
  test("shows the promotion summary promo report", async ({
    verifiedRequest,
  }) => {
    test.setTimeout(120_000);
    const { json } = await apiPost(
      verifiedRequest,
      "/report/promotion-summary-promo-report",
      {
        page: 1,
        pageSize: 10,
        sortBy: "freeGameStartDate",
        sortDirection: "desc",
        filters: { timeZoneId: 336, promoId: 1 },
      },
      { timeout: PROMOTION_SUMMARY_REQUEST_TIMEOUT_MS },
    );
    expect(json.status).toBe("success");
  });
});
