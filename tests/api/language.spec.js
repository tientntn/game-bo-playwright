// Test cho LanguageController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\LanguageController.cs)
// Endpoint yêu cầu session đã verify OTP (SecurityCheckpointType.SessionVerify) - dùng fixture
// verifiedRequest (tự generateOtp + verifyOtp trước khi test, xem tests/api/fixtures.js).
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("Language API - /dropdown/language", () => {
  test("lists languages", async ({ verifiedRequest }) => {
    const { response, json } = await apiPost(verifiedRequest, "/dropdown/language", {});

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
  });
});
