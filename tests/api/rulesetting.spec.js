// Test cho RuleSettingController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\RuleSettingController.cs)
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

const RULE_SETTING_REQUEST_TIMEOUT_MS = 60_000;

function ruleSettingApiPost(request, endpoint, body = {}) {
  return apiPost(request, endpoint, body, {
    timeout: RULE_SETTING_REQUEST_TIMEOUT_MS,
  });
}

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

test.describe("RuleSetting API - /rulesetting/list", () => {
  test("lists rule settings with pagination envelope", async ({
    authedRequest,
  }) => {
    const { response, json } = await apiPost(
      authedRequest,
      "/rulesetting/list",
      {
        page: 1,
        pageSize: 10,
        filters: {},
      },
    );

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(typeof json.data.totalCount).toBe("number");
    expect(Array.isArray(json.data.list)).toBe(true);
  });
});

test.describe("RuleSetting API - /rulesetting/filter-game", () => {
  test("filters games by game category", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/rulesetting/filter-game", {
      gameCategoryIds: [1], // SLOTS
    });
    expect(json.status).toBe("success");
    expect(Array.isArray(json.data.games)).toBe(true);
  });
});

test.describe("RuleSetting API - full lifecycle", () => {
  test("creates, views, updates and deactivates a rule setting", async ({
    authedRequest,
  }) => {
    test.setTimeout(300_000);
    const suffix = uniqueSuffix();
    const name = `QA Rule ${suffix}`;

    // gameCategoryIds/gameIds = [-1] nghĩa là "chọn tất cả" (xem gameCategorySelectAll/
    // gameSelectAll trong response view - CreateRuleSettingRequestValidator cho phép -1)
    const { json: createJson } = await ruleSettingApiPost(
      authedRequest,
      "/rulesetting/create",
      {
        name,
        severity: "info",
        gameCategoryIds: [-1],
        gameIds: [-1],
        conditions: {
          relation: "AND",
          rules: [{ type: "WinRate", operator: "<", threshold: -50 }],
        },
        channels: [{ channelType: "email", recipients: "qa@example.com" }],
        description: "QA automation test rule",
        status: 1,
      },
    );
    expect(createJson.status).toBe("success");
    expect(createJson.messageCode).toBe("CREATE_RULE_SETTING_SUCCESS");

    // Response không trả id, phải tự tìm lại bằng tên qua /list
    const { json: listJson } = await ruleSettingApiPost(
      authedRequest,
      "/rulesetting/list",
      {
        page: 1,
        pageSize: 500,
        filters: {},
      },
    );
    const created = listJson.data.list.find((r) => r.name === name);
    expect(
      created,
      `Không tìm thấy rule setting vừa tạo (name=${name}) trong /rulesetting/list`,
    ).toBeTruthy();
    const ruleId = created.id;

    try {
      const { json: viewJson } = await ruleSettingApiPost(
        authedRequest,
        "/rulesetting/view",
        { id: ruleId },
      );
      expect(viewJson.status).toBe("success");
      expect(viewJson.data.name).toBe(name);
      expect(viewJson.data.severity).toBe("INFO");

      const updatedName = `${name} Updated`;
      const { json: updateJson } = await ruleSettingApiPost(
        authedRequest,
        "/rulesetting/update",
        {
          id: ruleId,
          name: updatedName,
          severity: "critical",
          gameCategoryIds: [-1],
          gameIds: [-1],
          conditions: {
            relation: "AND",
            rules: [{ type: "WinRate", operator: "<", threshold: -60 }],
          },
          channels: [{ channelType: "email", recipients: "qa2@example.com" }],
          description: "QA automation test rule updated",
          status: 1,
        },
      );
      expect(updateJson.status).toBe("success");

      const { json: viewAfterUpdate } = await ruleSettingApiPost(
        authedRequest,
        "/rulesetting/view",
        {
          id: ruleId,
        },
      );
      expect(viewAfterUpdate.data.name).toBe(updatedName);
      expect(viewAfterUpdate.data.severity).toBe("CRITICAL");
    } finally {
      // Cleanup - deactivate rule setting vừa tạo, không để lại rule "active" thừa trên DB dev
      const { json: deactivateJson } = await ruleSettingApiPost(
        authedRequest,
        "/rulesetting/deactivate",
        {
          ruleSettingIds: [ruleId],
          status: 0,
        },
      );
      expect(deactivateJson.status).toBe("success");
    }
  });
});
