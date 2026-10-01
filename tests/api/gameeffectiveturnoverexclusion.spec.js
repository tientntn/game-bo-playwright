// Test cho GameEffectiveTurnoverExclusionController
// (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\GameEffectiveTurnoverExclusionController.cs)
// add/remove được test theo cặp roundtrip (thêm 1 game từ danh sách "available" vào danh sách
// loại trừ, rồi gỡ ngay lại) để không để lại thay đổi thật.
const { test, expect } = require("./fixtures");
const { apiPost, API_PATH, genTraceId } = require("./helpers/api-client");

test.describe("GameEffectiveTurnoverExclusion API - /game/effective-turnover-exclusion/list", () => {
  test("lists exclusions with pagination envelope", async ({ authedRequest }) => {
    const { response, json } = await apiPost(authedRequest, "/game/effective-turnover-exclusion/list", {
      page: 1,
      pageSize: 10,
      filters: {},
    });

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(typeof json.data.totalCount).toBe("number");
    expect(Array.isArray(json.data.list)).toBe(true);
  });
});

test.describe("GameEffectiveTurnoverExclusion API - available dropdown", () => {
  test("lists available games for exclusion", async ({ authedRequest }) => {
    const { json } = await apiPost(
      authedRequest,
      "/dropdown/game/effective-turnover-exclusion/available",
      {},
    );
    expect(json.status).toBe("success");
    expect(Array.isArray(json.data)).toBe(true);
  });
});

test.describe("GameEffectiveTurnoverExclusion API - add/remove roundtrip", () => {
  test("adds a game to the exclusion list, then removes it again", async ({ authedRequest }) => {
    const { json: availableJson } = await apiPost(
      authedRequest,
      "/dropdown/game/effective-turnover-exclusion/available",
      {},
    );
    expect(availableJson.status).toBe("success");
    test.skip(
      availableJson.data.length === 0,
      "Không có game nào khả dụng để thêm vào danh sách loại trừ",
    );
    const gameId = availableJson.data[0].value;

    const { json: addJson } = await apiPost(authedRequest, "/game/effective-turnover-exclusion/add", {
      gameIds: [gameId],
    });
    expect(addJson.status).toBe("success");

    try {
      const { json: listJson } = await apiPost(
        authedRequest,
        "/game/effective-turnover-exclusion/list",
        { page: 1, pageSize: 500, filters: {} },
      );
      const added = listJson.data.list.find((entry) => entry.gameId === gameId);
      expect(added, `Không tìm thấy game vừa thêm (gameId=${gameId}) trong danh sách loại trừ`).toBeTruthy();

      const { json: removeJson } = await apiPost(
        authedRequest,
        "/game/effective-turnover-exclusion/remove",
        { ids: [added.id] },
      );
      expect(removeJson.status).toBe("success");
    } catch (error) {
      // Đảm bảo vẫn cố gắng gỡ lại nếu có lỗi xảy ra sau bước add nhưng trước bước remove ở trên
      const { json: cleanupList } = await apiPost(
        authedRequest,
        "/game/effective-turnover-exclusion/list",
        { page: 1, pageSize: 500, filters: {} },
      );
      const leftover = cleanupList.data.list.find((entry) => entry.gameId === gameId);
      if (leftover) {
        await apiPost(authedRequest, "/game/effective-turnover-exclusion/remove", {
          ids: [leftover.id],
        });
      }
      throw error;
    }

    const { json: listAfterJson } = await apiPost(
      authedRequest,
      "/game/effective-turnover-exclusion/list",
      { page: 1, pageSize: 500, filters: {} },
    );
    expect(listAfterJson.data.list.some((entry) => entry.gameId === gameId)).toBe(false);
  });
});

test.describe("GameEffectiveTurnoverExclusion API - /game/effective-turnover-exclusion/template", () => {
  test("downloads CSV template file", async ({ authedRequest, authInfo }) => {
    // Duy nhất HttpGet trong toàn bộ API - không dùng apiPost helper, gọi GET trực tiếp
    const response = await authedRequest.get(
      `${API_PATH}/game/effective-turnover-exclusion/template`,
    );

    expect(response.status()).toBe(200);
    const contentType = response.headers()["content-type"] || "";
    expect(contentType).toContain("text/csv");

    const body = await response.text();
    expect(body).toContain("Game Code");
  });
});

test.describe("GameEffectiveTurnoverExclusion API - /game/effective-turnover-exclusion/upload", () => {
  test("uploads the header-only template CSV as a no-op", async ({ authedRequest }) => {
    // Đã đọc GameEffectiveTurnoverExclusionService.Upload (Infrastructure) - endpoint này CHỈ
    // parse + validate file, KHÔNG ghi gì vào DB (khác hẳn /add - đây chỉ là bước preview trước
    // khi người dùng bấm "add" thật ở FE). Vì vậy an toàn để test bằng chính file mẫu tải về từ
    // /template ở trên - file này chỉ có dòng header "Game Code" và 0 dòng dữ liệu, nên kết quả
    // parse chắc chắn là items/errors đều rỗng.
    const templateResponse = await authedRequest.get(
      `${API_PATH}/game/effective-turnover-exclusion/template`,
    );
    const templateBody = await templateResponse.body();

    const response = await authedRequest.post(
      `${API_PATH}/game/effective-turnover-exclusion/upload`,
      {
        multipart: {
          TraceId: genTraceId(),
          Files: {
            name: "GameExclusionSample.csv",
            mimeType: "text/csv",
            buffer: templateBody,
          },
        },
      },
    );
    const json = await response.json();

    expect(json.status).toBe("success");
    expect(json.data.items).toEqual([]);
    expect(json.data.errors).toEqual([]);
  });
});
