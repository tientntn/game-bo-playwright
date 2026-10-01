// Test cho AlertReportController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\AlertReportController.cs)
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("AlertReport API - /alertreport/list", () => {
  // KNOWN ISSUE (backend): trả UNKNOWN_ERROR trên DB dev hiện tại dù request body đủ field bắt
  // buộc. Test này CỐ TÌNH để fail đỏ - không dùng test.fail() - để nhắc backend xử lý mỗi lần
  // chạy suite, cho tới khi bug được fix.
  test("lists alert reports with pagination envelope", async ({ authedRequest }) => {
    const { response, json } = await apiPost(authedRequest, "/alertreport/list", {
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

test.describe("AlertReport API - /alertreport/unflag", () => {
  // UnFlagAlertReportHandler.cs chỉ đổi 1 field "flag" (StatusEnum) trong DB nội bộ, không gọi
  // service ngoài nào - về bản chất an toàn để test bằng pattern toggle+restore (giống house/
  // agent/player/...). Nhưng /alertreport/list đang bị KNOWN ISSUE (UNKNOWN_ERROR - xem describe
  // phía trên) nên KHÔNG có cách nào lấy được 1 alert id thật để test - test này skip khi list
  // không trả về được dữ liệu, và sẽ tự chạy thật khi bug list được backend fix.
  test("unflags then restores an alert report's original flag", async ({ authedRequest }) => {
    const { json: listJson } = await apiPost(authedRequest, "/alertreport/list", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(
      listJson.status !== "success" || listJson.data.list.length === 0,
      "Không lấy được alert report nào từ /alertreport/list (đang KNOWN ISSUE) để test unflag",
    );
    const alert = listJson.data.list[0];
    const originalFlag = alert.flag;
    const toggledFlag = originalFlag === 1 ? 0 : 1;

    try {
      const { json: toggleJson } = await apiPost(authedRequest, "/alertreport/unflag", {
        ids: [alert.id],
        flag: toggledFlag,
      });
      expect(toggleJson.status).toBe("success");
    } finally {
      const { json: restoreJson } = await apiPost(authedRequest, "/alertreport/unflag", {
        ids: [alert.id],
        flag: originalFlag,
      });
      expect(restoreJson.status).toBe("success");
    }
  });
});

test.describe("AlertReport API - dropdowns & summary", () => {
  test("lists games and rules for filtering, and the severity summary", async ({ authedRequest }) => {
    const { json: gameDropdown } = await apiPost(authedRequest, "/alertreport/game/dropdown", {});
    expect(gameDropdown.status).toBe("success");
    expect(Array.isArray(gameDropdown.data)).toBe(true);

    const { json: ruleDropdown } = await apiPost(authedRequest, "/alertreport/rule/dropdown", {});
    expect(ruleDropdown.status).toBe("success");
    expect(Array.isArray(ruleDropdown.data)).toBe(true);

    const { json: summary } = await apiPost(authedRequest, "/alertreport/summary", {});
    expect(summary.status).toBe("success");
    expect(Array.isArray(summary.data)).toBe(true);
  });
});
