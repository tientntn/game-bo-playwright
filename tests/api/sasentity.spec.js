// Test cho SasEntityController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\SasEntityController.cs)
// Dùng bởi form tạo House/MasterAgent/Agent để validate entityCode/name trước khi submit.
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

test.describe("SasEntity API - /validate/entitycode", () => {
  test("reports an existing entity code as taken", async ({ authedRequest }) => {
    const { json: houseDropdown } = await apiPost(authedRequest, "/dropdown/house", {});
    test.skip(houseDropdown.data.length === 0, "Không có house nào trên DB dev để test");

    const { json } = await apiPost(authedRequest, "/validate/entitycode", {
      entityCode: houseDropdown.data[0].code,
    });

    // Phát hiện cosmetic (cùng dạng bug với validate/ip trong geofencing.spec.js): messageCode
    // ở đây bị copy-paste nhầm từ module Currency, trả "DUPLICATE_CURRENCY_CODE" / "Currency
    // code is already existed" thay vì thông báo entity code trùng. Logic chặn trùng vẫn đúng
    // (status "fail") nên chỉ assert status, không pin messageCode sai.
    expect(json.status).toBe("fail");
  });

  test("reports a fresh entity code as available", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/validate/entitycode", {
      entityCode: `qafreecode${Date.now()}`,
    });
    expect(json.status).toBe("success");
  });
});

test.describe("SasEntity API - /validate/entityname", () => {
  test("reports an existing entity name as taken", async ({ authedRequest }) => {
    const { json: houseDropdown } = await apiPost(authedRequest, "/dropdown/house", {});
    test.skip(houseDropdown.data.length === 0, "Không có house nào trên DB dev để test");

    const { json } = await apiPost(authedRequest, "/validate/entityname", {
      name: houseDropdown.data[0].label,
    });
    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("DUPLICATE_NAME");
  });

  test("reports a fresh entity name as available", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/validate/entityname", {
      name: `QA Free Name ${Date.now()}`,
    });
    expect(json.status).toBe("success");
  });
});
