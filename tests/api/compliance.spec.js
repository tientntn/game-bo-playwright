// Test cho ComplianceController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\ComplianceController.cs)
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("Compliance API - /compliance/jurisdictional-codes", () => {
  test("lists jurisdictional codes", async ({ authedRequest }) => {
    const { response, json } = await apiPost(authedRequest, "/compliance/jurisdictional-codes", {});

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.some((c) => c.code === "DEFAULT")).toBe(true);
  });
});
