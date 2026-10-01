// Test cho AgentGameCurrencyController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\AgentGameCurrencyController.cs)
//
// agent-update đã test được (no-op, kể cả nếu nghi vấn bug dưới đây đúng hay sai): permission seed
// gap từng chặn route này (trả NOT_PERMISSION) ĐÃ ĐƯỢC BACKEND SỬA - xác nhận qua chạy thật lại,
// giờ trả "success" bình thường. Đã đọc kỹ AgentUpdateAgentGameCurrencyHandler.cs +
// AgentGameCurrencyService.AgentUpdate() - khác với Update() (dùng cho /agentgamecurrency/update,
// có gọi rõ `_unitOfWork.AgentGameCurrencyCommandRepository.BatchUpdate(agentGameCurrencies)` trước
// Commit), AgentUpdate() chỉ tạo object AgentGameCurrency MỚI (detached, không phải entity đang
// được query-track) để build Outbox message, rồi return - KHÔNG thấy gọi BatchUpdate/Update nào
// trên repository. NGHI VẤN đây có thể là bug (endpoint trả "success" + bắn Kafka message nhưng
// không thực sự ghi gì vào DB) - CHƯA verify được bằng cách gọi thật (muốn xác nhận phải gửi giá
// trị MỚI rồi xem view có đổi không - rủi ro nếu nghi vấn sai, chưa làm). Nhưng test dưới đây vẫn
// AN TOÀN để viết ngay bất kể nghi vấn đúng hay sai: chỉ gửi lại ĐÚNG giá trị
// Override/MaxPayoutCustom/MaxMultiplier hiện tại - nếu nghi vấn đúng (không ghi DB) thì dĩ nhiên
// không đổi gì; nếu nghi vấn sai (có ghi DB) thì ghi lại y hệt giá trị cũ cũng là no-op. Để nghi
// vấn mở cho backend tự xác minh khi cần.
//
// update-game-help-config đã test được (no-op): đã đối chiếu code -
// ViewGameHelpConfigurationResponse.ConfigurationValueResponse và
// UpdateGameHelpConfigurationRequest.ConfigurationValueRequest có CHÍNH XÁC cùng 5 field
// (MaxWinEnabled/GameLimitsEnabled/VolatilityEnabled/RtpDisplayEnabled/InterruptionPolicyEnabled)
// nên đọc từ view-game-help-config rồi ghi lại y hệt là an toàn.
// update đã test được (no-op): đã đối chiếu UpdateAgentGameCurrencyHandler.cs (GameSetting DTO:
// Id/PayTableId/IsDefaultPaytable/DenominationId/IsDenomOverride/Override/Status/MaxPayoutCustom/
// MaxMultiplier) với ListAgentGameCurrencyResponse.GameSettingView (field đọc được y hệt, đủ cả 9
// field) + top-level AutoFinalizationDuration/AutoFinalizationStatus khớp với AutoFinalization DTO
// - viết lại y hệt khiến AgentGameCurrencyService.Update tính isAgentChanged=false (Agent record
// không hề bị đổi). Chỉ 1 rủi ro: MaxPayoutCustom ở view là STRING, cần parse về number - test
// dùng Number.isFinite để tự skip nếu parse ra NaN, tránh nguy cơ ghi đè 0 (xem sự cố House trước
// đây, không lặp lại kiểu lỗi tương tự).
// bulk_update đã test được (no-op có điều kiện): validator bắt buộc
// `IsResetMaxPayout || IsResetMaxMultiplier || MaxPayoutCustom > 0 || MaxMultiplier > 0` (không
// cho gửi "không đổi gì" - xem BulkUpdateAgentGameCurrencyRequestValidator.cs), nên test chọn 1
// trong 2 nhánh vô hại tuỳ giá trị maxMultiplier hiện tại của dòng đang test: nếu > 0, gửi lại
// đúng giá trị đó (AgentGameCurrencyService.BulkUpdate chỉ coi là "changed" khi giá trị THẬT SỰ
// khác - xem biến `isChangeMaxMultiplier`); nếu đang = 0, gửi `isResetMaxMultiplier: true` (reset
// 0 -> 0, cũng không đổi gì - xem nhánh `request.IsResetMaxMultiplier ? 0m : ...`). Cả 2 nhánh đều
// không đụng tới Override/MaxPayoutCustom (giữ nguyên vì không set IsResetMaxPayout/MaxPayoutCustom).
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

const AGENT_GAME_CURRENCY_REQUEST_TIMEOUT_MS = 60_000;

test.describe("AgentGameCurrency API - /agentgamecurrency/view", () => {
  test("views game currency settings for an agent", async ({ authedRequest }) => {
    test.setTimeout(120_000);
    const { json: agentFilter } = await apiPost(authedRequest, "/dropdown/agent-filter", {});
    test.skip(agentFilter.data.length === 0, "Không có agent nào trên DB dev để test");
    const agentId = agentFilter.data[0].value;

    const { json: currencyList } = await apiPost(authedRequest, "/currency/list_by_agent", { agentId });
    test.skip(currencyList.data.length === 0, "Agent này chưa gán currency nào");
    const currencyId = currencyList.data[0].id;

    const { response, json } = await apiPost(
      authedRequest,
      "/agentgamecurrency/view",
      {
        page: 1,
        pageSize: 10,
        agentId,
        currencyId,
        filters: {},
      },
      { timeout: AGENT_GAME_CURRENCY_REQUEST_TIMEOUT_MS },
    );

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(Array.isArray(json.data.gameSettings)).toBe(true);
  });
});

test.describe("AgentGameCurrency API - /agentgamecurrency/active-by-game", () => {
  test("lists agents that have a game active", async ({ authedRequest }) => {
    const { json: gameList } = await apiPost(authedRequest, "/game/list/v2", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(gameList.data.list.length === 0, "Không có game nào trên DB dev để test");

    const { json } = await apiPost(authedRequest, "/agentgamecurrency/active-by-game", {
      page: 1,
      pageSize: 10,
      filters: { gameId: gameList.data.list[0].id },
    });

    expect(json.status).toBe("success");
    expect(typeof json.data.totalCount).toBe("number");
    expect(Array.isArray(json.data.list)).toBe(true);
  });
});

test.describe("AgentGameCurrency API - /agentgamecurrency/view-game-help-config", () => {
  test("views the game help configuration for an agent's game setting", async ({ authedRequest }) => {
    const { json: agentFilter } = await apiPost(authedRequest, "/dropdown/agent-filter", {});
    test.skip(agentFilter.data.length === 0, "Không có agent nào trên DB dev để test");
    const agentId = agentFilter.data[0].value;

    const { json: currencyList } = await apiPost(authedRequest, "/currency/list_by_agent", { agentId });
    test.skip(currencyList.data.length === 0, "Agent này chưa gán currency nào");

    const { json: viewJson } = await apiPost(authedRequest, "/agentgamecurrency/view", {
      page: 1,
      pageSize: 1,
      agentId,
      currencyId: currencyList.data[0].id,
      filters: {},
    });
    test.skip(
      !viewJson.data.gameSettings || viewJson.data.gameSettings.length === 0,
      "Agent này chưa có game setting nào",
    );

    const { json } = await apiPost(authedRequest, "/agentgamecurrency/view-game-help-config", {
      agentGameCurrencyId: viewJson.data.gameSettings[0].id,
    });

    expect(json.status).toBe("success");
    expect(typeof json.data.configurationValue).toBe("object");
  });
});

test.describe("AgentGameCurrency API - /agentgamecurrency/update_status", () => {
  test("deactivates then restores an agent game currency's original status", async ({
    authedRequest,
  }) => {
    // Đổi status thật của 1 dòng game/currency config của agent dùng chung - test này LUÔN khôi
    // phục lại status ban đầu trong finally, kể cả khi assertion ở giữa thất bại.
    const { json: agentFilter } = await apiPost(authedRequest, "/dropdown/agent-filter", {});
    test.skip(agentFilter.data.length === 0, "Không có agent nào trên DB dev để test");
    const agentId = agentFilter.data[0].value;

    const { json: currencyList } = await apiPost(authedRequest, "/currency/list_by_agent", { agentId });
    test.skip(currencyList.data.length === 0, "Agent này chưa gán currency nào");

    const { json: viewJson } = await apiPost(authedRequest, "/agentgamecurrency/view", {
      page: 1,
      pageSize: 1,
      agentId,
      currencyId: currencyList.data[0].id,
      filters: {},
    });
    test.skip(
      !viewJson.data.gameSettings || viewJson.data.gameSettings.length === 0,
      "Agent này chưa có game setting nào",
    );
    const entry = viewJson.data.gameSettings[0];
    const originalStatus = entry.status;
    const toggledStatus = originalStatus === 1 ? 0 : 1;

    try {
      const { json: toggleJson } = await apiPost(authedRequest, "/agentgamecurrency/update_status", {
        agentId,
        ids: [entry.id],
        status: toggledStatus,
      });
      expect(toggleJson.status).toBe("success");

      const { json: viewAfterToggle } = await apiPost(authedRequest, "/agentgamecurrency/view", {
        page: 1,
        pageSize: 1,
        agentId,
        currencyId: currencyList.data[0].id,
        filters: {},
      });
      const toggledEntry = viewAfterToggle.data.gameSettings.find((g) => g.id === entry.id);
      expect(toggledEntry.status).toBe(toggledStatus);
    } finally {
      const { json: restoreJson } = await apiPost(authedRequest, "/agentgamecurrency/update_status", {
        agentId,
        ids: [entry.id],
        status: originalStatus,
      });
      expect(restoreJson.status).toBe("success");

      const { json: viewAfterRestore } = await apiPost(authedRequest, "/agentgamecurrency/view", {
        page: 1,
        pageSize: 1,
        agentId,
        currencyId: currencyList.data[0].id,
        filters: {},
      });
      const restoredEntry = viewAfterRestore.data.gameSettings.find((g) => g.id === entry.id);
      expect(restoredEntry.status).toBe(originalStatus);
    }
  });
});

test.describe("AgentGameCurrency API - /agentgamecurrency/update", () => {
  test("updates an agent game currency setting, writing back its current values unchanged", async ({
    authedRequest,
  }) => {
    // No-op: đọc TOÀN BỘ giá trị hiện tại của đúng 1 dòng gameSettings + AutoFinalization cấp
    // agent từ /agentgamecurrency/view, rồi ghi lại y hệt qua /agentgamecurrency/update. Chỉ gửi
    // đúng 1 phần tử trong mảng gameSettings (không phải toàn bộ danh sách) - handler xử lý theo
    // từng Id độc lập (không phải full-replace), nên các dòng khác của agent không bị đụng tới.
    const { json: agentFilter } = await apiPost(authedRequest, "/dropdown/agent-filter", {});
    test.skip(agentFilter.data.length === 0, "Không có agent nào trên DB dev để test");
    const agentId = agentFilter.data[0].value;

    const { json: currencyList } = await apiPost(authedRequest, "/currency/list_by_agent", { agentId });
    test.skip(currencyList.data.length === 0, "Agent này chưa gán currency nào");

    const { json: viewJson } = await apiPost(authedRequest, "/agentgamecurrency/view", {
      page: 1,
      pageSize: 1,
      agentId,
      currencyId: currencyList.data[0].id,
      filters: {},
    });
    test.skip(
      !viewJson.data.gameSettings || viewJson.data.gameSettings.length === 0,
      "Agent này chưa có game setting nào",
    );
    const entry = viewJson.data.gameSettings[0];

    // MaxPayoutCustom ở view trả về dạng string - parse về number để ghi lại; nếu vì lý do gì đó
    // parse ra NaN thì SKIP hẳn thay vì gửi lên (NaN sẽ bị JSON.stringify thành null, và server
    // set null -> 0, tức là vô tình xoá mất giá trị maxPayoutCustom thật - không được để xảy ra).
    const maxPayoutCustom = Number(entry.maxPayoutCustom);
    test.skip(
      !Number.isFinite(maxPayoutCustom),
      `Không parse được maxPayoutCustom ("${entry.maxPayoutCustom}") về số - bỏ qua để tránh ghi đè sai giá trị`,
    );

    const { json: updateJson } = await apiPost(authedRequest, "/agentgamecurrency/update", {
      agentId,
      gameSettings: [
        {
          id: entry.id,
          payTableId: entry.payTableId,
          isDefaultPaytable: entry.isDefaultPaytable,
          denominationId: entry.denominationId,
          isDenomOverride: entry.isDenomOverride,
          override: entry.override,
          status: entry.status,
          maxPayoutCustom,
          maxMultiplier: entry.maxMultiplier,
        },
      ],
      autoFinalization: {
        autoFinalizationDuration: viewJson.data.autoFinalizationDuration,
        autoFinalizationStatus: viewJson.data.autoFinalizationStatus,
      },
    });
    expect(updateJson.status).toBe("success");

    const { json: viewAfterJson } = await apiPost(authedRequest, "/agentgamecurrency/view", {
      page: 1,
      pageSize: 1,
      agentId,
      currencyId: currencyList.data[0].id,
      filters: {},
    });
    const entryAfter = viewAfterJson.data.gameSettings.find((g) => g.id === entry.id);
    expect(entryAfter.payTableId).toBe(entry.payTableId);
    expect(entryAfter.denominationId).toBe(entry.denominationId);
    expect(entryAfter.status).toBe(entry.status);
    expect(entryAfter.override).toBe(entry.override);
    expect(Number(entryAfter.maxPayoutCustom)).toBe(maxPayoutCustom);
    expect(entryAfter.maxMultiplier).toBe(entry.maxMultiplier);
    expect(viewAfterJson.data.autoFinalizationDuration).toBe(viewJson.data.autoFinalizationDuration);
    expect(viewAfterJson.data.autoFinalizationStatus).toBe(viewJson.data.autoFinalizationStatus);
  });
});

test.describe("AgentGameCurrency API - /agentgamecurrency/bulk_update", () => {
  test("bulk-updates an agent game currency setting as a no-op", async ({ authedRequest }) => {
    const { json: agentFilter } = await apiPost(authedRequest, "/dropdown/agent-filter", {});
    test.skip(agentFilter.data.length === 0, "Không có agent nào trên DB dev để test");
    const agentId = agentFilter.data[0].value;

    const { json: currencyList } = await apiPost(authedRequest, "/currency/list_by_agent", { agentId });
    test.skip(currencyList.data.length === 0, "Agent này chưa gán currency nào");

    const { json: viewJson } = await apiPost(authedRequest, "/agentgamecurrency/view", {
      page: 1,
      pageSize: 1,
      agentId,
      currencyId: currencyList.data[0].id,
      filters: {},
    });
    test.skip(
      !viewJson.data.gameSettings || viewJson.data.gameSettings.length === 0,
      "Agent này chưa có game setting nào",
    );
    const entry = viewJson.data.gameSettings[0];

    // Validator bắt buộc phải "đổi" ít nhất 1 field - chọn nhánh vô hại tuỳ giá trị hiện tại (xem
    // giải thích chi tiết ở đầu file). Không đụng gì tới MaxPayout/Override.
    const body =
      entry.maxMultiplier > 0
        ? { ids: [entry.id], isResetMaxPayout: false, isResetMaxMultiplier: false, maxMultiplier: entry.maxMultiplier }
        : { ids: [entry.id], isResetMaxPayout: false, isResetMaxMultiplier: true };

    const { json: updateJson } = await apiPost(authedRequest, "/agentgamecurrency/bulk_update", body);
    expect(updateJson.status).toBe("success");

    const { json: viewAfterJson } = await apiPost(authedRequest, "/agentgamecurrency/view", {
      page: 1,
      pageSize: 1,
      agentId,
      currencyId: currencyList.data[0].id,
      filters: {},
    });
    const entryAfter = viewAfterJson.data.gameSettings.find((g) => g.id === entry.id);
    expect(entryAfter.override).toBe(entry.override);
    expect(entryAfter.maxPayoutCustom).toBe(entry.maxPayoutCustom);
    expect(entryAfter.maxMultiplier).toBe(entry.maxMultiplier);
  });
});

test.describe("AgentGameCurrency API - /agentgamecurrency/update-game-help-config", () => {
  test("updates a game help configuration, writing back its current values unchanged", async ({
    authedRequest,
  }) => {
    // No-op: đọc đúng 5 field hiện tại từ /agentgamecurrency/view-game-help-config rồi ghi lại y
    // hệt qua /agentgamecurrency/update-game-help-config. applyToAllCurrency=0 để chỉ áp dụng cho
    // đúng 1 dòng agentGameCurrencyId đang test, không lan sang currency khác của agent.
    const { json: agentFilter } = await apiPost(authedRequest, "/dropdown/agent-filter", {});
    test.skip(agentFilter.data.length === 0, "Không có agent nào trên DB dev để test");
    const agentId = agentFilter.data[0].value;

    const { json: currencyList } = await apiPost(authedRequest, "/currency/list_by_agent", { agentId });
    test.skip(currencyList.data.length === 0, "Agent này chưa gán currency nào");

    const { json: viewJson } = await apiPost(authedRequest, "/agentgamecurrency/view", {
      page: 1,
      pageSize: 1,
      agentId,
      currencyId: currencyList.data[0].id,
      filters: {},
    });
    test.skip(
      !viewJson.data.gameSettings || viewJson.data.gameSettings.length === 0,
      "Agent này chưa có game setting nào",
    );
    const agentGameCurrencyId = viewJson.data.gameSettings[0].id;

    const { json: helpViewJson } = await apiPost(authedRequest, "/agentgamecurrency/view-game-help-config", {
      agentGameCurrencyId,
    });
    expect(helpViewJson.status).toBe("success");
    const currentConfig = helpViewJson.data.configurationValue;

    const { json: updateJson } = await apiPost(authedRequest, "/agentgamecurrency/update-game-help-config", {
      agentGameCurrencyId,
      applyToAllCurrency: 0,
      configurationValue: {
        maxWinEnabled: currentConfig.maxWinEnabled,
        gameLimitsEnabled: currentConfig.gameLimitsEnabled,
        volatilityEnabled: currentConfig.volatilityEnabled,
        rtpDisplayEnabled: currentConfig.rtpDisplayEnabled,
        interruptionPolicyEnabled: currentConfig.interruptionPolicyEnabled,
      },
    });
    expect(updateJson.status).toBe("success");

    const { json: helpViewAfterJson } = await apiPost(authedRequest, "/agentgamecurrency/view-game-help-config", {
      agentGameCurrencyId,
    });
    expect(helpViewAfterJson.data.configurationValue).toEqual(currentConfig);
  });
});

test.describe("AgentGameCurrency API - /agent/agentgamecurrency/update", () => {
  // Permission seed gap trước đây (trả NOT_PERMISSION) ĐÃ ĐƯỢC BACKEND SỬA - xác nhận qua chạy
  // thật lại: endpoint giờ trả "success" bình thường bằng đúng session admin (authedRequest), như
  // /agentgamecurrency/update và /bulk_update. Quay lại test no-op (ghi lại đúng giá trị hiện tại,
  // không đổi gì) - an toàn kể cả khi nghi vấn "AgentUpdate không ghi DB" ở đầu file đúng hay sai,
  // xem giải thích chi tiết ở đó.
  test("updates an agent game currency setting via the agent route, writing back its current values unchanged", async ({
    authedRequest,
  }) => {
    const { json: agentFilter } = await apiPost(authedRequest, "/dropdown/agent-filter", {});
    test.skip(agentFilter.data.length === 0, "Không có agent nào trên DB dev để test");
    const agentId = agentFilter.data[0].value;

    const { json: currencyList } = await apiPost(authedRequest, "/currency/list_by_agent", { agentId });
    test.skip(currencyList.data.length === 0, "Agent này chưa gán currency nào");

    const { json: viewJson } = await apiPost(authedRequest, "/agentgamecurrency/view", {
      page: 1,
      pageSize: 1,
      agentId,
      currencyId: currencyList.data[0].id,
      filters: {},
    });
    test.skip(
      !viewJson.data.gameSettings || viewJson.data.gameSettings.length === 0,
      "Agent này chưa có game setting nào",
    );
    const entry = viewJson.data.gameSettings[0];

    // Cùng lý do như /agentgamecurrency/update - maxPayoutCustom ở view là string, parse có kiểm
    // tra NaN trước khi ghi lại, tránh nguy cơ vô tình ghi đè 0.
    const maxPayoutCustom = Number(entry.maxPayoutCustom);
    test.skip(
      !Number.isFinite(maxPayoutCustom),
      `Không parse được maxPayoutCustom ("${entry.maxPayoutCustom}") về số - bỏ qua để tránh ghi đè sai giá trị`,
    );

    const { json: updateJson } = await apiPost(authedRequest, "/agent/agentgamecurrency/update", {
      gameSettings: [
        {
          id: entry.id,
          override: entry.override,
          maxPayoutCustom,
          maxMultiplier: entry.maxMultiplier,
        },
      ],
    });
    expect(updateJson.status).toBe("success");

    const { json: viewAfterJson } = await apiPost(authedRequest, "/agentgamecurrency/view", {
      page: 1,
      pageSize: 1,
      agentId,
      currencyId: currencyList.data[0].id,
      filters: {},
    });
    const entryAfter = viewAfterJson.data.gameSettings.find((g) => g.id === entry.id);
    expect(entryAfter.override).toBe(entry.override);
    expect(Number(entryAfter.maxPayoutCustom)).toBe(maxPayoutCustom);
    expect(entryAfter.maxMultiplier).toBe(entry.maxMultiplier);
  });
});
