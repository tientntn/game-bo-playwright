// Test cho PermisisonController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\PermisisonController.cs)
// Lưu ý: API không có endpoint xoá permission, nên record test tạo ra sẽ tồn tại vĩnh viễn
// trên DB dev (giống Role). Đặt tên tiền tố "QA_AUTO" để dễ nhận diện.
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

test.describe("Permission API - /permission/manage/list", () => {
  test("lists permissions with pagination envelope", async ({ authedRequest }) => {
    const { response, json } = await apiPost(authedRequest, "/permission/manage/list", {
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

test.describe("Permission API - /permission/list (role permission map)", () => {
  test("lists the permission map for a hierarchy level", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/permission/list", {
      sasEntityHierarchyIds: [1],
    });

    expect(json.status).toBe("success");
    expect(typeof json.data).toBe("object");
  });
});

test.describe("Permission API - create/view/update", () => {
  test("creates a permission and reflects an update when viewed", async ({ authedRequest }) => {
    const suffix = uniqueSuffix();
    const name = `QA_AUTO_${suffix}`;

    // Response không trả id, phải tự tìm lại bằng tên qua /manage/list
    const { json: createJson } = await apiPost(authedRequest, "/permission/create", {
      name,
      url: `/api/v1/qa/${suffix}`,
      type: "view",
      category: "QA_TEST_CATEGORY",
      isPublic: false,
      hierarchyMap: [1],
    });
    expect(createJson.status).toBe("success");
    expect(createJson.messageCode).toBe("CREATE_PERMISSION_SUCCESS");

    const { json: listJson } = await apiPost(authedRequest, "/permission/manage/list", {
      page: 1,
      pageSize: 500,
      filters: {},
    });
    const created = listJson.data.list.find((p) => p.name === name);
    expect(created, `Không tìm thấy permission vừa tạo (name=${name}) trong /manage/list`).toBeTruthy();
    const permissionId = created.id;

    const { json: viewJson } = await apiPost(authedRequest, "/permission/view", { id: permissionId });
    expect(viewJson.status).toBe("success");
    expect(viewJson.data.name).toBe(name);

    const updatedName = `${name}_UPDATED`;
    const { json: updateJson } = await apiPost(authedRequest, "/permission/update", {
      id: permissionId,
      name: updatedName,
      url: `/api/v1/qa/${suffix}/updated`,
      type: "edit",
      category: "QA_TEST_CATEGORY",
      isPublic: false,
      hierarchyMap: [1, 2],
    });
    expect(updateJson.status).toBe("success");

    const { json: viewAfterUpdate } = await apiPost(authedRequest, "/permission/view", { id: permissionId });
    expect(viewAfterUpdate.data.name).toBe(updatedName);
    expect(viewAfterUpdate.data.type).toBe("EDIT");
  });
});
