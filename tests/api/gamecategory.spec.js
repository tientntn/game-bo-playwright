// Test cho GameCategoryController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\GameCategoryController.cs)
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

test.describe("GameCategory API - /game/game_category/list", () => {
  test("lists game categories with pagination envelope", async ({
    authedRequest,
  }) => {
    const { response, json } = await apiPost(
      authedRequest,
      "/game/game_category/list",
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

test.describe("GameCategory API - view & dropdown", () => {
  test("views a game category and lists it in the dropdown", async ({
    authedRequest,
  }) => {
    const { json: listJson } = await apiPost(
      authedRequest,
      "/game/game_category/list",
      {
        page: 1,
        pageSize: 1,
        filters: {},
      },
    );
    test.skip(
      listJson.data.list.length === 0,
      "Không có game category nào trên DB dev để test",
    );
    const category = listJson.data.list[0];

    const { json: viewJson } = await apiPost(
      authedRequest,
      "/game/game_category/view",
      {
        id: category.id,
      },
    );
    expect(viewJson.status).toBe("success");
    expect(viewJson.data.id).toBe(category.id);

    const { json: dropdownJson } = await apiPost(
      authedRequest,
      "/dropdown/gamecategory",
      {},
    );
    expect(dropdownJson.status).toBe("success");
    expect(Array.isArray(dropdownJson.data)).toBe(true);
  });
});

test.describe("GameCategory API - /game/game_category/validate_code", () => {
  test("reports an existing code as taken", async ({ authedRequest }) => {
    const { json: listJson } = await apiPost(
      authedRequest,
      "/game/game_category/list",
      {
        page: 1,
        pageSize: 1,
        filters: {},
      },
    );
    test.skip(
      listJson.data.list.length === 0,
      "Không có game category nào trên DB dev để test",
    );

    const { json } = await apiPost(
      authedRequest,
      "/game/game_category/validate_code",
      {
        code: listJson.data.list[0].code,
      },
    );
    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("DUPLICATE_GAME_CATEGORY_CODE");
  });

  test("reports a fresh code as available", async ({ authedRequest }) => {
    const { json } = await apiPost(
      authedRequest,
      "/game/game_category/validate_code",
      {
        code: `QA_FREE_${uniqueSuffix()}`,
      },
    );
    expect(json.status).toBe("success");
  });
});

test.describe("GameCategory API - /game/game_category/update", () => {
  test("updates a game category, writing back its current values unchanged", async ({
    authedRequest,
  }) => {
    // create bị broken (UNKNOWN_ERROR - xem describe bên dưới) nên không có dữ liệu rời rạc để
    // test update an toàn. Test này chỉ AN TOÀN vì lấy đúng giá trị hiện tại từ /view rồi ghi lại
    // y hệt trên 1 category thật đang dùng chung.
    const { json: listJson } = await apiPost(authedRequest, "/game/game_category/list", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có game category nào trên DB dev để test");
    const categoryId = listJson.data.list[0].id;

    const { json: viewJson } = await apiPost(authedRequest, "/game/game_category/view", {
      id: categoryId,
    });
    expect(viewJson.status).toBe("success");

    const { json: updateJson } = await apiPost(authedRequest, "/game/game_category/update", {
      id: categoryId,
      name: viewJson.data.name,
      status: viewJson.data.status,
      effectiveTurnoverRate: viewJson.data.effectiveTurnoverRate,
    });
    expect(updateJson.status).toBe("success");

    const { json: viewAfterJson } = await apiPost(authedRequest, "/game/game_category/view", {
      id: categoryId,
    });
    expect(viewAfterJson.data.name).toBe(viewJson.data.name);
    expect(viewAfterJson.data.status).toBe(viewJson.data.status);
    expect(viewAfterJson.data.effectiveTurnoverRate).toBe(viewJson.data.effectiveTurnoverRate);
  });
});

test.describe("GameCategory API - /game/game_category/update_status", () => {
  test("deactivates then restores a game category's original status", async ({ authedRequest }) => {
    // update_status đổi status thật của category dùng chung - test này LUÔN khôi phục lại status
    // ban đầu trong finally, kể cả khi assertion ở giữa thất bại.
    const { json: listJson } = await apiPost(authedRequest, "/game/game_category/list", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có game category nào trên DB dev để test");
    const category = listJson.data.list[0];
    const originalStatus = category.status;
    const toggledStatus = originalStatus === 1 ? 0 : 1;

    try {
      const { json: toggleJson } = await apiPost(authedRequest, "/game/game_category/update_status", {
        ids: [category.id],
        status: toggledStatus,
      });
      expect(toggleJson.status).toBe("success");

      const { json: viewAfterToggle } = await apiPost(authedRequest, "/game/game_category/view", {
        id: category.id,
      });
      expect(viewAfterToggle.data.status).toBe(toggledStatus);
    } finally {
      const { json: restoreJson } = await apiPost(authedRequest, "/game/game_category/update_status", {
        ids: [category.id],
        status: originalStatus,
      });
      expect(restoreJson.status).toBe("success");

      const { json: viewAfterRestore } = await apiPost(authedRequest, "/game/game_category/view", {
        id: category.id,
      });
      expect(viewAfterRestore.data.status).toBe(originalStatus);
    }
  });
});

test.describe("GameCategory API - /game/game_category/create", () => {
  // KNOWN ISSUE (backend): create trả UNKNOWN_ERROR trên DB dev hiện tại dù request body đúng
  // theo CreateGameCategoryRequestValidator (code/name hợp lệ, effectiveTurnoverRate trong
  // khoảng 1-100). Đây là bug RIÊNG của GameCategory, KHÔNG cùng nguyên nhân với House/
  // MasterAgent/Agent (GameCategory không thuộc SasEntity hierarchy, không đi qua
  // _sasEntityRoleService.CreateRole - xem CreateGameCategoryHandler.cs). Test này CỐ TÌNH để
  // fail đỏ - không dùng test.fail() - để nhắc backend xử lý mỗi lần chạy suite, cho tới khi
  // bug được fix.
  test("creates a game category", async ({ authedRequest }) => {
    const suffix = uniqueSuffix();

    const { json: createJson } = await apiPost(
      authedRequest,
      "/game/game_category/create",
      {
        code: `QACAT${suffix}`,
        name: `QA Cat ${suffix}`,
        status: 1,
        effectiveTurnoverRate: 50.5,
      },
    );

    expect(createJson.status).toBe("success");
  });
});
