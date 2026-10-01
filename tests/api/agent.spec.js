// Test cho AgentController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\AgentController.cs)
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

const AGENT_REQUEST_TIMEOUT_MS = 60_000;

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

test.describe("Agent API - /agent/list", () => {
  test("lists agents with pagination envelope", async ({ authedRequest }) => {
    const { response, json } = await apiPost(authedRequest, "/agent/list", {
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

test.describe("Agent API - view & dropdowns", () => {
  test("views an agent and reads its supported games", async ({
    authedRequest,
  }) => {
    // dropdown/agent-filter trả TẤT CẢ agent (không cần masterAgentId) - dùng để lấy 1 id có
    // thật thay vì hard-code, tránh phụ thuộc dữ liệu cụ thể của DB dev.
    test.setTimeout(120 * 1000);
    const { json: filterJson } = await apiPost(
      authedRequest,
      "/dropdown/agent-filter",
      {},
    );
    expect(filterJson.status).toBe("success");
    test.skip(
      filterJson.data.length === 0,
      "Không có agent nào trên DB dev để test",
    );

    const agentId = filterJson.data[0].value;
    const { json: viewJson } = await apiPost(
      authedRequest,
      "/agent/view",
      { id: agentId },
      { timeout: AGENT_REQUEST_TIMEOUT_MS },
    );
    expect(viewJson.status).toBe("success");
    expect(viewJson.data.id).toBe(agentId);

    // dropdown/agent lọc theo master agent - dùng masterAgentId lấy từ chính response view ở trên
    const masterAgentId = viewJson.data.masterAgent.id;
    const { json: byMasterAgentJson } = await apiPost(
      authedRequest,
      "/dropdown/agent",
      {
        masterAgentId,
      },
    );
    expect(byMasterAgentJson.status).toBe("success");
    expect(Array.isArray(byMasterAgentJson.data)).toBe(true);

    const { json: gamesJson } = await apiPost(
      authedRequest,
      "/agent/support_games",
      { agentId },
    );
    expect(gamesJson.status).toBe("success");
    expect(Array.isArray(gamesJson.data)).toBe(true);
  });
});

test.describe("Agent API - /agent/update-status", () => {
  test("deactivates then restores an agent's original status", async ({
    authedRequest,
  }) => {
    // Đổi status thật của agent dùng chung - test này LUÔN khôi phục lại status ban đầu trong
    // finally, kể cả khi assertion ở giữa thất bại.
    const { json: listJson } = await apiPost(authedRequest, "/agent/list", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(
      listJson.data.list.length === 0,
      "Không có agent nào trên DB dev để test",
    );
    const agent = listJson.data.list[0];
    const originalStatus = agent.status;
    const toggledStatus = originalStatus === 1 ? 0 : 1;

    try {
      const { json: toggleJson } = await apiPost(
        authedRequest,
        "/agent/update-status",
        {
          ids: [agent.id],
          status: toggledStatus,
        },
      );
      expect(toggleJson.status).toBe("success");

      const { json: viewAfterToggle } = await apiPost(
        authedRequest,
        "/agent/view",
        { id: agent.id },
      );
      expect(viewAfterToggle.data.status).toBe(toggledStatus);
    } finally {
      const { json: restoreJson } = await apiPost(
        authedRequest,
        "/agent/update-status",
        {
          ids: [agent.id],
          status: originalStatus,
        },
      );
      expect(restoreJson.status).toBe("success");

      const { json: viewAfterRestore } = await apiPost(
        authedRequest,
        "/agent/view",
        { id: agent.id },
      );
      expect(viewAfterRestore.data.status).toBe(originalStatus);
    }
  });
});

test.describe("Agent API - /agent/update", () => {
  test("updates an agent, writing back its current values unchanged", async ({
    authedRequest,
  }) => {
    // QUAN TRỌNG: agent/update là full-replace (currencyIds/gameCategoryIds/geofencing gửi lên
    // sẽ THAY THẾ toàn bộ danh sách hiện có trên agent thật đang dùng chung). Test này chỉ AN
    // TOÀN vì lấy TOÀN BỘ giá trị hiện tại từ /agent/view bằng code (không hard-code/rút gọn),
    // rồi ghi lại y hệt. TUYỆT ĐỐI không thay các dòng .map(...) dưới đây bằng danh sách viết tay.
    test.setTimeout(120 * 1000);
    const { json: filterJson } = await apiPost(
      authedRequest,
      "/dropdown/agent-filter",
      {},
    );
    test.skip(
      filterJson.data.length === 0,
      "Không có agent nào trên DB dev để test",
    );
    const agentId = filterJson.data[0].value;

    const { json: viewJson } = await apiPost(
      authedRequest,
      "/agent/view",
      { id: agentId },
      { timeout: AGENT_REQUEST_TIMEOUT_MS },
    );
    expect(viewJson.status).toBe("success");

    const currencyIds = viewJson.data.currencies.map((c) => c.id);
    const gameCategoryIds = viewJson.data.gameCategoryList.map((c) => c.id);
    test.skip(
      currencyIds.length === 0 || gameCategoryIds.length === 0,
      "Agent này chưa gán currency/game category nào - bỏ qua để tránh ghi đè mảng rỗng",
    );
    const ipv4 = viewJson.data.geofencing.ipv4.map((entry) => ({
      id: entry.id,
      value: entry.value,
      remark: entry.remark,
    }));

    const { json: updateJson } = await apiPost(
      authedRequest,
      "/agent/update",
      {
        id: agentId,
        name: viewJson.data.name,
        currencyIds,
        gameCategoryIds,
        status: viewJson.data.status,
        timezoneId: viewJson.data.timezone.id,
        jurisdictionalCode: viewJson.data.jurisdictionalCode,
        geofencing: { ipv4, ipv6: [], country: [], geofencingDelete: [] },
      },
      { timeout: AGENT_REQUEST_TIMEOUT_MS },
    );
    expect(updateJson.status).toBe("success");

    const { json: viewAfterJson } = await apiPost(
      authedRequest,
      "/agent/view",
      { id: agentId },
      { timeout: AGENT_REQUEST_TIMEOUT_MS },
    );
    expect(viewAfterJson.data.name).toBe(viewJson.data.name);
    expect(viewAfterJson.data.status).toBe(viewJson.data.status);
    expect(
      viewAfterJson.data.currencies.map((c) => c.id).sort((a, b) => a - b),
    ).toEqual(currencyIds.slice().sort((a, b) => a - b));
    expect(
      viewAfterJson.data.gameCategoryList
        .map((c) => c.id)
        .sort((a, b) => a - b),
    ).toEqual(gameCategoryIds.slice().sort((a, b) => a - b));
  });
});

test.describe("Agent API - /agent/create", () => {
  test("creates an agent under an existing master agent", async ({
    authedRequest,
  }) => {
    test.setTimeout(120 * 1000);
    const { json: masterAgentFilter } = await apiPost(
      authedRequest,
      "/dropdown/masteragent-filter",
      {},
    );
    expect(masterAgentFilter.status).toBe("success");
    test.skip(
      masterAgentFilter.data.length === 0,
      "Không có master agent nào trên DB dev để làm parent",
    );
    const parentSasEntityId = masterAgentFilter.data[0].sasEntityId;
    const masterAgentId = masterAgentFilter.data[0].id;
    const suffix = uniqueSuffix();

    const [{ json: currencyList }, { json: categoryList }] = await Promise.all([
      apiPost(authedRequest, "/currency/list", {
        page: 1,
        pageSize: 1,
        filters: {},
      }),
      apiPost(authedRequest, "/game/game_category/list", {
        page: 1,
        pageSize: 1,
        filters: {},
      }),
    ]);
    const currencyId = currencyList.data.list[0].id;
    const gameCategoryId = categoryList.data.list[0].id;

    const { json: createJson } = await apiPost(authedRequest, "/agent/create", {
      sasEntityHierarchyId: 4, // Agent (xem SasEntityHierarchyEnum)
      masterAgentId: masterAgentId,
      parentId: parentSasEntityId,
      name: `QA Test Agent ${suffix}`,
      entityCode: `QATESTAG${suffix}`,
      subDomain: "http://agent.newfuture.com/agen1308",
      siteUrl: "http://agent.newfuture.com/agen1308",
      currencyIds: [currencyId],
      gameCategoryIds: [gameCategoryId],
      status: 1,
      timezoneId: 336,
      jurisdictionalCode: "DEFAULT",
      geofencing: {
        ipv4: [],
        ipv6: [],
        country: [],
        geofencingDelete: [],
      },
    });

    expect(createJson.status).toBe("success");
  });
});
