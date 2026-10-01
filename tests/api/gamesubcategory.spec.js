// Test cho GameSubCategoryController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\GameSubCategoryController.cs)
// Lưu ý: API không có endpoint xoá/deactivate game sub category, nên record test tạo ra sẽ
// tồn tại vĩnh viễn trên DB dev (giống Role). Đặt tên tiền tố "QA Auto" để dễ nhận diện.
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

test.describe("GameSubCategory API - /game/game_sub_category/list", () => {
  test("lists game sub categories with pagination envelope", async ({ authedRequest }) => {
    const { response, json } = await apiPost(authedRequest, "/game/game_sub_category/list", {
      page: 1,
      pageSize: 10,
      filters: {},
    });

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(typeof json.data.totalCount).toBe("number");
    expect(Array.isArray(json.data.list)).toBe(true);
  });

  test("lists game sub categories by denom type", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/game/game_sub_category/list_by_denom_type", {
      denomType: "slots",
    });
    expect(json.status).toBe("success");
    expect(Array.isArray(json.data)).toBe(true);
  });
});

test.describe("GameSubCategory API - /game/game_sub_category/validate_name", () => {
  test("reports an existing name as taken", async ({ authedRequest }) => {
    const { json: listJson } = await apiPost(authedRequest, "/game/game_sub_category/list", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có game sub category nào trên DB dev để test");

    const { json } = await apiPost(authedRequest, "/game/game_sub_category/validate_name", {
      name: listJson.data.list[0].name,
    });
    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("DUPLICATE_GAME_SUB_CATEGORY_NAME");
  });

  test("reports a fresh name as available", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/game/game_sub_category/validate_name", {
      name: `QA Free Sub ${uniqueSuffix()}`,
    });
    expect(json.status).toBe("success");
  });
});

test.describe("GameSubCategory API - create/view/update", () => {
  test("creates a sub category and reflects an update when viewed", async ({ authedRequest }) => {
    // Lấy 1 game category có thật (thay vì hard-code id) để làm gameCategoryId
    const { json: categoryDropdown } = await apiPost(authedRequest, "/dropdown/gamecategory", {});
    expect(categoryDropdown.status).toBe("success");
    const gameCategoryId = categoryDropdown.data[0].value;

    const suffix = uniqueSuffix();
    const name = `QA Auto Sub ${suffix}`;

    // Response không trả id, phải tự tìm lại bằng tên qua /list
    const { json: createJson } = await apiPost(authedRequest, "/game/game_sub_category/create", {
      gameCategoryId,
      denomType: "slots",
      name,
    });
    expect(createJson.status).toBe("success");
    expect(createJson.messageCode).toBe("CREATE_GAME_SUB_CATEGORY_SUCCESS");

    const { json: listJson } = await apiPost(authedRequest, "/game/game_sub_category/list", {
      page: 1,
      pageSize: 500,
      filters: {},
    });
    const created = listJson.data.list.find((s) => s.name === name);
    expect(created, `Không tìm thấy sub category vừa tạo (name=${name}) trong /list`).toBeTruthy();
    const subCategoryId = created.id;

    const { json: viewJson } = await apiPost(authedRequest, "/game/game_sub_category/view", {
      id: subCategoryId,
    });
    expect(viewJson.status).toBe("success");
    expect(viewJson.data.name).toBe(name);

    const updatedName = `${name} Updated`;
    const { json: updateJson } = await apiPost(authedRequest, "/game/game_sub_category/update", {
      id: subCategoryId,
      name: updatedName,
    });
    expect(updateJson.status).toBe("success");

    const { json: viewAfterUpdate } = await apiPost(authedRequest, "/game/game_sub_category/view", {
      id: subCategoryId,
    });
    expect(viewAfterUpdate.data.name).toBe(updatedName);
  });

  test("rejects creating a sub category with a duplicate name", async ({ authedRequest }) => {
    const { json: categoryDropdown } = await apiPost(authedRequest, "/dropdown/gamecategory", {});
    const gameCategoryId = categoryDropdown.data[0].value;

    const suffix = uniqueSuffix();
    const name = `QA Auto Dup Sub ${suffix}`;

    const first = await apiPost(authedRequest, "/game/game_sub_category/create", {
      gameCategoryId,
      denomType: "slots",
      name,
    });
    expect(first.json.status).toBe("success");

    const second = await apiPost(authedRequest, "/game/game_sub_category/create", {
      gameCategoryId,
      denomType: "slots",
      name, // trùng tên
    });
    expect(second.json.status).toBe("fail");
    expect(second.json.messageCode).toBe("DUPLICATE_GAME_SUB_CATEGORY_NAME");
  });
});
