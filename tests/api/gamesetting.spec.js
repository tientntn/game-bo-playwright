// Test cho GameSettingController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\GameSettingController.cs)
// và endpoint gamesetting/notify trong GameController.cs
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("GameSetting API - /gamesetting/view", () => {
  test("views game settings for an existing game", async ({ authedRequest }) => {
    // Lấy 1 game id hợp lệ từ list
    const { json: listJson } = await apiPost(authedRequest, "/game/list/v2", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có game nào trên DB dev để test");

    const gameId = listJson.data.list[0].id;
    const { response, json } = await apiPost(authedRequest, "/gamesetting/view", {
      gameId: gameId,
    });

    // GameSettingService.View ném GameSettingNotFoundException khi game CHƯA từng được
    // add_or_update lần nào - đây là trạng thái HỢP LỆ (không phải bug), giống hệt
    // agentcredential/check_api_exist. Game đầu tiên trong list (ngẫu nhiên tuỳ dữ liệu DB dev)
    // không đảm bảo đã có setting, nên chấp nhận cả 2 kết quả hợp lệ thay vì luôn kỳ vọng success.
    expect(response.status()).toBe(200);
    expect(["success", "fail"]).toContain(json.status);
    if (json.status === "fail") {
      expect(json.messageCode).toBe("GAME_SETTING_NOT_FOUND");
    }
  });
});

test.describe("GameSetting API - /gamesetting/notify", () => {
  test("sends a notify update for an existing game", async ({ authedRequest }) => {
    // Endpoint nằm trong GameController.cs nhưng cùng feature group gamesetting.
    // Dùng Session (không cần SessionVerify), nên test happy path được.
    const { json: listJson } = await apiPost(authedRequest, "/game/list/v2", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có game nào trên DB dev để test");

    const gameId = listJson.data.list[0].id;
    const { response, json } = await apiPost(authedRequest, "/gamesetting/notify", {
      gameIds: [gameId],
    });

    expect(response.status()).toBe(200);
    // notify có thể trả success hoặc fail tuỳ trạng thái game - chỉ assert HTTP 200
    // và response envelope hợp lệ (có field status)
    expect(json.status).toBeTruthy();
  });
});

test.describe("GameSetting API - /gamesetting/add_or_update", () => {
  test("updates a game's setting, writing back its current value unchanged", async ({
    authedRequest,
  }) => {
    // Ghi lại đúng chuỗi "setting" hiện tại (lấy từ /gamesetting/view) - an toàn vì không đổi
    // nội dung, dù đây là config game thật dùng chung.
    const { json: listJson } = await apiPost(authedRequest, "/game/list/v2", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có game nào trên DB dev để test");
    const gameId = listJson.data.list[0].id;

    const { json: viewJson } = await apiPost(authedRequest, "/gamesetting/view", { gameId });
    // Game đầu tiên trong list có thể CHƯA từng được add_or_update (GAME_SETTING_NOT_FOUND là
    // trạng thái hợp lệ - xem describe "/gamesetting/view" phía trên). Không có API xoá game
    // setting, nên KHÔNG an toàn để tự tạo mới ở đây (sẽ để lại rác vĩnh viễn trên game thật dùng
    // chung) - skip thay vì ép setting fail này thành lỗi test.
    test.skip(
      viewJson.status !== "success",
      "Game đầu tiên trong list chưa có game setting nào - bỏ qua để tránh tạo rác vĩnh viễn",
    );

    const { json: updateJson } = await apiPost(authedRequest, "/gamesetting/add_or_update", {
      gameIds: [gameId],
      setting: viewJson.data.setting,
    });
    expect(updateJson.status).toBe("success");

    const { json: viewAfterJson } = await apiPost(authedRequest, "/gamesetting/view", { gameId });
    expect(viewAfterJson.data.setting).toBe(viewJson.data.setting);
  });
});
