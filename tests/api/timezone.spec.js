// Test cho TimeZoneController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\TimeZoneController.cs)
// Endpoint yêu cầu session đã verify OTP (SecurityCheckpointType.SessionVerify) - dùng fixture
// verifiedRequest (tự generateOtp + verifyOtp trước khi test, xem tests/api/fixtures.js).
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("TimeZone API - /timezone/list", () => {
  test("lists timezones", async ({ verifiedRequest }) => {
    const { response, json } = await apiPost(verifiedRequest, "/timezone/list", {});

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(Array.isArray(json.data)).toBe(true);
  });

  test("searches timezones by keyword", async ({ verifiedRequest }) => {
    const { json } = await apiPost(verifiedRequest, "/timezone/list", { search: "Singapore" });

    expect(json.status).toBe("success");
    expect(json.data.some((tz) => tz.countryName.includes("Singapore"))).toBe(true);
  });
});
