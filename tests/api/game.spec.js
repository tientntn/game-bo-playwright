// Test cho GameController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\GameController.cs)
// Không test create/create-v2/update/update-v2/update-paytable/reset-default-paytable (2FA KHÔNG
// còn là lý do chặn - verifiedRequest đã vượt qua SecurityCheckpointType.SessionVerify):
// - create/create-v2: không có API xoá game thật, sẽ để lại rác vĩnh viễn trên catalog dùng
//   chung; CreateGameRequest còn cần payTableInfoList (List<GamePayTableInfo>) với cấu trúc paytable
//   chưa xác định đầy đủ.
// - update/update-v2 (UpdateGameRequest1/UpdateGameRequest): ĐÃ kiểm tra kỹ - khác với house/
//   agent/masteragent/... (nơi write-back TOÀN BỘ giá trị đọc được từ view là an toàn), request
//   update game có các field ghi được (Rows, Reels, Payline, ReleaseDate) mà /game/view HOÀN TOÀN
//   KHÔNG trả lại giá trị hiện tại (xem ViewGameResponse.cs) - nghĩa là không có cách nào đọc lại
//   để ghi y hệt, cũng không thể verify sau khi update rằng các field này còn nguyên vẹn. Đây là
//   giới hạn thật của schema, không phải do chưa hiểu domain.
// - update-paytable/reset-default-paytable: ResetPaytableHandler.cs tạo hẳn 1 paytable MỚI thay
//   thế paytable hiện tại của game thật (đã đọc code xác nhận) - không có API nào phục hồi lại
//   đúng paytable cũ, rủi ro không thể khôi phục trên dữ liệu game thật dùng chung.
// update-status/v2 (deactivate) và set-maintenance NGƯỢC LẠI hoàn toàn an toàn: request chỉ có
// GameIds + Status/MaintenanceStatus (0/1), /game/view trả lại đúng 2 giá trị này để verify và
// khôi phục - cùng pattern toggle+restore như house/agent/masteragent/player.
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("Game API - /game/list/v2", () => {
  test("lists games with pagination envelope", async ({ authedRequest }) => {
    const { response, json } = await apiPost(authedRequest, "/game/list/v2", {
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

test.describe("Game API - view & dropdown", () => {
  test("views a game and lists it in the dropdown", async ({ authedRequest }) => {
    const { json: listJson } = await apiPost(authedRequest, "/game/list/v2", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có game nào trên DB dev để test");
    const game = listJson.data.list[0];

    const { json: viewJson } = await apiPost(authedRequest, "/game/view", { gameId: game.id });
    expect(viewJson.status).toBe("success");
    expect(viewJson.data.id).toBe(game.id);

    const { json: dropdownJson } = await apiPost(authedRequest, "/dropdown/game", { filters: {} });
    expect(dropdownJson.status).toBe("success");
    expect(Array.isArray(dropdownJson.data)).toBe(true);
  });
});

test.describe("Game API - /validate/game/code", () => {
  test("reports an existing game code as taken", async ({ authedRequest }) => {
    const { json: listJson } = await apiPost(authedRequest, "/game/list/v2", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có game nào trên DB dev để test");

    const { json } = await apiPost(authedRequest, "/validate/game/code", {
      code: listJson.data.list[0].code,
    });
    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("DUPLICATE_GAME_CODE");
  });

  test("reports a fresh game code as available", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/validate/game/code", {
      code: `QA_FREE_${Date.now()}`,
    });
    expect(json.status).toBe("success");
  });
});

test.describe("Game API - /game/update-status/v2", () => {
  test("deactivates then restores a game's original status", async ({ authedRequest }) => {
    // Đổi status thật của game dùng chung - test này LUÔN khôi phục lại status ban đầu trong
    // finally, kể cả khi assertion ở giữa thất bại.
    const { json: listJson } = await apiPost(authedRequest, "/game/list/v2", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có game nào trên DB dev để test");
    const gameId = listJson.data.list[0].id;

    const { json: viewJson } = await apiPost(authedRequest, "/game/view", { gameId });
    const originalStatus = viewJson.data.status;
    const toggledStatus = originalStatus === 1 ? 0 : 1;

    try {
      const { json: toggleJson } = await apiPost(authedRequest, "/game/update-status/v2", {
        gameIds: [gameId],
        status: toggledStatus,
      });
      expect(toggleJson.status).toBe("success");

      const { json: viewAfterToggle } = await apiPost(authedRequest, "/game/view", { gameId });
      expect(viewAfterToggle.data.status).toBe(toggledStatus);
    } finally {
      const { json: restoreJson } = await apiPost(authedRequest, "/game/update-status/v2", {
        gameIds: [gameId],
        status: originalStatus,
      });
      expect(restoreJson.status).toBe("success");

      const { json: viewAfterRestore } = await apiPost(authedRequest, "/game/view", { gameId });
      expect(viewAfterRestore.data.status).toBe(originalStatus);
    }
  });
});

test.describe("Game API - /game/set-maintenance", () => {
  test("sets then restores a game's original maintenance status", async ({ authedRequest }) => {
    // Đổi maintenance status thật của game dùng chung - test này LUÔN khôi phục lại giá trị ban
    // đầu trong finally, kể cả khi assertion ở giữa thất bại.
    const { json: listJson } = await apiPost(authedRequest, "/game/list/v2", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có game nào trên DB dev để test");
    const gameId = listJson.data.list[0].id;

    const { json: viewJson } = await apiPost(authedRequest, "/game/view", { gameId });
    const originalMaintenance = viewJson.data.maintenance;
    const toggledMaintenance = originalMaintenance === 1 ? 0 : 1;

    try {
      const { json: toggleJson } = await apiPost(authedRequest, "/game/set-maintenance", {
        gameIds: [gameId],
        maintenanceStatus: toggledMaintenance,
      });
      expect(toggleJson.status).toBe("success");

      const { json: viewAfterToggle } = await apiPost(authedRequest, "/game/view", { gameId });
      expect(viewAfterToggle.data.maintenance).toBe(toggledMaintenance);
    } finally {
      const { json: restoreJson } = await apiPost(authedRequest, "/game/set-maintenance", {
        gameIds: [gameId],
        maintenanceStatus: originalMaintenance,
      });
      expect(restoreJson.status).toBe("success");

      const { json: viewAfterRestore } = await apiPost(authedRequest, "/game/view", { gameId });
      expect(viewAfterRestore.data.maintenance).toBe(originalMaintenance);
    }
  });
});
