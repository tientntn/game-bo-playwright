// Test cho RtpGroupController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\RtpGroupController.cs)
// Controller này được đánh dấu [Obsolete] ngay trong source code. Đã verify qua curl: create/
// update/update-status/view (rtpgroups/id) đều trả response THÀNH CÔNG với dữ liệu GIẢ cố định
// (vd houseId=2147483647/"HouseCode", id=2147483647/"Name"/"Code") bất kể input gửi lên - tức
// đây là các stub không đọc/ghi gì thật vào DB. Vì vậy test toàn bộ 4 endpoint là an toàn tuyệt
// đối (không có rủi ro dữ liệu thật).
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("RtpGroup API - /rtpgroups/list (deprecated controller)", () => {
  test("lists rtp groups with pagination envelope", async ({ authedRequest }) => {
    const { response, json } = await apiPost(authedRequest, "/rtpgroups/list", {
      page: 1,
      pageSize: 10,
    });

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(typeof json.data.totalCount).toBe("number");
    expect(Array.isArray(json.data.list)).toBe(true);
  });
});

test.describe("RtpGroup API - create/view/update/update-status (stub, [Obsolete])", () => {
  test("creates an rtp group (stub response)", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/rtpgroups/create", {});
    expect(json.status).toBe("success");
  });

  test("views an rtp group by id (stub response)", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/rtpgroups/id", {});
    expect(json.status).toBe("success");
    expect(typeof json.data.houseId).toBe("number");
  });

  test("updates an rtp group (stub response)", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/rtpgroups/update", {});
    expect(json.status).toBe("success");
  });

  test("updates an rtp group's status (stub response)", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/rtpgroups/update-status", { status: 1 });
    expect(json.status).toBe("success");
    expect(typeof json.data.id).toBe("number");
  });
});
