// Test cho ApiKeyController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\ApiKeyController.cs)
// Route thực tế là "agentcredential/*" (xem Endpoints.ApiKey trong Endpoints.cs) dù tên
// controller/file là ApiKeyController.
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("ApiKey API - /agentcredential/list", () => {
  test("lists agent api credentials with pagination envelope", async ({ authedRequest }) => {
    const { response, json } = await apiPost(authedRequest, "/agentcredential/list", {
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

test.describe("ApiKey API - /agentcredential/check_api_exist", () => {
  test("checks whether an agent already has an api credential", async ({ authedRequest }) => {
    // Endpoint trả "fail"/AGENT_API_CREDENTIALS_NOT_FOUND (đã verify qua gọi thật) một cách HỢP
    // LỆ khi agent chưa có api key nào - không phải lỗi. Vì agent đầu tiên trong dropdown là ngẫu
    // nhiên (tuỳ dữ liệu DB dev), test chấp nhận cả 2 kết quả hợp lệ thay vì giả định luôn có key.
    const { json: agentFilter } = await apiPost(authedRequest, "/dropdown/agent-filter", {});
    test.skip(agentFilter.data.length === 0, "Không có agent nào trên DB dev để test");

    const { json } = await apiPost(authedRequest, "/agentcredential/check_api_exist", {
      agentId: agentFilter.data[0].value,
    });
    if (json.status === "fail") {
      expect(json.messageCode).toBe("AGENT_API_CREDENTIALS_NOT_FOUND");
    } else {
      expect(json.status).toBe("success");
    }
  });
});

// generate/view/update/deactivate lifecycle (agentcredential/generate_key, /update, /update_status)
// đã CHUYỂN sang tests/api/dangerous.spec.js - side-effect thật lên agent có thể đang được FE dùng
// (đổi api key/callback thật), quy về chung 1 file với các endpoint rủi ro khác, gate bằng
// RUN_DANGEROUS_TESTS thay vì test.skip(true, ...) cứng trong code.
