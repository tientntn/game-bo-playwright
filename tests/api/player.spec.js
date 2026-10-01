// Test cho PlayerController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\PlayerController.cs)
// Không test "kick": handler publish message qua Kafka (topic "PlayerKick" trong
// MessageProducer.Topics, xem appsettings.Development.json) để 1 service NGOÀI thật sự ngắt
// session của player - đây là side-effect ra hệ thống ngoài, không thể xem/khôi phục như DB
// thường (giống lý do loại trừ operator_request/retry), nên không test tự động ở đây.
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("Player API - /player/list", () => {
  test("lists players with pagination envelope", async ({ authedRequest }) => {
    const { response, json } = await apiPost(authedRequest, "/player/list", {
      page: 1,
      pageSize: 10,
      sortBy: "id",
      sortDirection: "desc",
      filters: {
        houseIds: [5, 21, 22, 19, 14, 41, 12, 24, 15, 1, 34, 44, 43, 2],
        masterAgentIds: [
          35, 18, 19, 11, 14, 24, 17, 10, 30, 2, 3, 4, 5, 31, 32,
        ],
        sasEntityId: [1],
        timezoneId: 336,
        currencyIds: [7, 8],
      },
    });

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(typeof json.data.totalCount).toBe("number");
    expect(Array.isArray(json.data.list)).toBe(true);
  });
});

test.describe("Player API - /player/dropdown-list", () => {
  test("lists players for a sas entity", async ({
    authedRequest,
    authInfo,
  }) => {
    const { json } = await apiPost(authedRequest, "/player/dropdown-list", {
      page: 1,
      pageSize: 10,
      filters: { sasEntityId: [authInfo.sasEntityId] },
    });
    expect(json.status).toBe("success");
    expect(typeof json.data.totalCount).toBe("number");
    expect(Array.isArray(json.data.list)).toBe(true);
  });
});

test.describe("Player API - /player/update-status", () => {
  test("deactivates then restores a player's original status", async ({ authedRequest }) => {
    // Đổi status thật của player dùng chung - test này LUÔN khôi phục lại status ban đầu trong
    // finally, kể cả khi assertion ở giữa thất bại.
    const { json: listJson } = await apiPost(authedRequest, "/player/list", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có player nào trên DB dev để test");
    const player = listJson.data.list[0];
    const originalStatus = player.status;
    const toggledStatus = originalStatus === 1 ? 0 : 1;

    try {
      const { json: toggleJson } = await apiPost(authedRequest, "/player/update-status", {
        ids: [player.id],
        status: toggledStatus,
      });
      expect(toggleJson.status).toBe("success");
    } finally {
      const { json: restoreJson } = await apiPost(authedRequest, "/player/update-status", {
        ids: [player.id],
        status: originalStatus,
      });
      expect(restoreJson.status).toBe("success");
    }
  });
});
