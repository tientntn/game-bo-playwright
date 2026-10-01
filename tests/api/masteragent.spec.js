// Test cho MasterAgentController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\MasterAgentController.cs)
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

test.describe("MasterAgent API - /masteragent/list", () => {
  test("lists master agents with pagination envelope", async ({
    authedRequest,
  }) => {
    const { response, json } = await apiPost(
      authedRequest,
      "/masteragent/list",
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

test.describe("MasterAgent API - view & dropdowns", () => {
  test("views a master agent and reads its supported currencies/categories", async ({
    authedRequest,
  }) => {
    // dropdown/masteragent-filter trả TẤT CẢ master agent (không cần houseId) - dùng để lấy
    // 1 id có thật thay vì hard-code, tránh phụ thuộc dữ liệu cụ thể của DB dev.
    const { json: filterJson } = await apiPost(
      authedRequest,
      "/dropdown/masteragent-filter",
      {},
    );
    expect(filterJson.status).toBe("success");
    test.skip(
      filterJson.data.length === 0,
      "Không có master agent nào trên DB dev để test",
    );

    const masterAgentId = filterJson.data[0].value;

    const { json: viewJson } = await apiPost(
      authedRequest,
      "/masteragent/view",
      {
        id: masterAgentId,
      },
    );
    expect(viewJson.status).toBe("success");
    expect(viewJson.data.id).toBe(masterAgentId);

    // dropdown/masteragent lọc theo house - dùng houseId lấy từ chính response view ở trên
    const houseId = viewJson.data.house.id;
    const { json: byHouseJson } = await apiPost(
      authedRequest,
      "/dropdown/masteragent",
      {
        houseId,
      },
    );
    expect(byHouseJson.status).toBe("success");
    expect(Array.isArray(byHouseJson.data)).toBe(true);

    const { json: currencyJson } = await apiPost(
      authedRequest,
      "/masteragent/supportedcurrency",
      {
        masterAgentId,
      },
    );
    expect(currencyJson.status).toBe("success");
    expect(Array.isArray(currencyJson.data)).toBe(true);

    const { json: categoryJson } = await apiPost(
      authedRequest,
      "/masteragent/supportedcategories",
      {
        masterAgentId,
      },
    );
    expect(categoryJson.status).toBe("success");
    expect(Array.isArray(categoryJson.data)).toBe(true);
  });
});

test.describe("MasterAgent API - /masteragent/update-status", () => {
  test("deactivates then restores a master agent's original status", async ({ authedRequest }) => {
    // Đổi status thật của master agent dùng chung - test này LUÔN khôi phục lại status ban đầu
    // trong finally, kể cả khi assertion ở giữa thất bại.
    const { json: listJson } = await apiPost(authedRequest, "/masteragent/list", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có master agent nào trên DB dev để test");
    const masterAgent = listJson.data.list[0];
    const originalStatus = masterAgent.status;
    const toggledStatus = originalStatus === 1 ? 0 : 1;

    try {
      const { json: toggleJson } = await apiPost(authedRequest, "/masteragent/update-status", {
        ids: [masterAgent.id],
        status: toggledStatus,
      });
      expect(toggleJson.status).toBe("success");

      const { json: viewAfterToggle } = await apiPost(authedRequest, "/masteragent/view", {
        id: masterAgent.id,
      });
      expect(viewAfterToggle.data.status).toBe(toggledStatus);
    } finally {
      const { json: restoreJson } = await apiPost(authedRequest, "/masteragent/update-status", {
        ids: [masterAgent.id],
        status: originalStatus,
      });
      expect(restoreJson.status).toBe("success");

      const { json: viewAfterRestore } = await apiPost(authedRequest, "/masteragent/view", {
        id: masterAgent.id,
      });
      expect(viewAfterRestore.data.status).toBe(originalStatus);
    }
  });
});

test.describe("MasterAgent API - /masteragent/update", () => {
  test("updates a master agent, writing back its current values unchanged", async ({
    authedRequest,
  }) => {
    // QUAN TRỌNG: masteragent/update là full-replace (currencyIds/gameCategoryIds/geofencing
    // gửi lên sẽ THAY THẾ toàn bộ danh sách hiện có trên master agent thật đang dùng chung).
    // Test này chỉ AN TOÀN vì lấy TOÀN BỘ giá trị hiện tại từ /masteragent/view bằng code (không
    // hard-code/rút gọn), rồi ghi lại y hệt. TUYỆT ĐỐI không thay các dòng .map(...) dưới đây
    // bằng danh sách viết tay.
    const { json: filterJson } = await apiPost(authedRequest, "/dropdown/masteragent-filter", {});
    test.skip(filterJson.data.length === 0, "Không có master agent nào trên DB dev để test");
    const masterAgentId = filterJson.data[0].value;

    const { json: viewJson } = await apiPost(authedRequest, "/masteragent/view", {
      id: masterAgentId,
    });
    expect(viewJson.status).toBe("success");

    const currencyIds = viewJson.data.currencies.map((c) => c.id);
    const gameCategoryIds = viewJson.data.gameCategoryList.map((c) => c.id);
    test.skip(
      currencyIds.length === 0 || gameCategoryIds.length === 0,
      "Master agent này chưa gán currency/game category nào - bỏ qua để tránh ghi đè mảng rỗng",
    );
    const ipv4 = viewJson.data.geofencing.ipv4.map((entry) => ({
      id: entry.id,
      value: entry.value,
      remark: entry.remark,
    }));

    const { json: updateJson } = await apiPost(authedRequest, "/masteragent/update", {
      id: masterAgentId,
      name: viewJson.data.name,
      currencyIds,
      gameCategoryIds,
      status: viewJson.data.status,
      timezoneId: viewJson.data.timezone.id,
      geofencing: { ipv4, ipv6: [], country: [], geofencingDelete: [] },
    });
    expect(updateJson.status).toBe("success");

    const { json: viewAfterJson } = await apiPost(authedRequest, "/masteragent/view", {
      id: masterAgentId,
    });
    expect(viewAfterJson.data.name).toBe(viewJson.data.name);
    expect(viewAfterJson.data.status).toBe(viewJson.data.status);
    expect(
      viewAfterJson.data.currencies.map((c) => c.id).sort((a, b) => a - b),
    ).toEqual(currencyIds.slice().sort((a, b) => a - b));
    expect(
      viewAfterJson.data.gameCategoryList.map((c) => c.id).sort((a, b) => a - b),
    ).toEqual(gameCategoryIds.slice().sort((a, b) => a - b));
  });
});

test.describe("MasterAgent API - /masteragent/create", () => {
  // KNOWN ISSUE (backend): giống hệt house/create - trả UNKNOWN_ERROR trên DB dev hiện tại dù
  // request body đúng theo CreateMasterAgentRequestValidator. MasterAgentService.Create dùng
  // chung code path với HouseService.Create (gọi _sasEntityRoleService.CreateRole(...) sau khi
  // tạo SasEntity) - tức đây là 1 bug hệ thống ảnh hưởng House/MasterAgent/Agent như nhau, không
  // phải lỗi riêng của module này. Test này CỐ TÌNH để fail đỏ - không dùng test.fail() - để
  // nhắc backend xử lý mỗi lần chạy suite, cho tới khi bug được fix.
  test("creates a master agent under an existing house", async ({
    authedRequest,
  }) => {
    const { json: houseDropdown } = await apiPost(
      authedRequest,
      "/dropdown/house",
      {},
    );
    expect(houseDropdown.status).toBe("success");
    test.skip(
      houseDropdown.data.length === 0,
      "Không có house nào trên DB dev để làm parent",
    );
    const parentSasEntityId = houseDropdown.data[0].sasEntityId;

    const suffix = uniqueSuffix();
    const [{ json: currencyList }, { json: categoryList }] = await Promise.all([
      apiPost(authedRequest, "/currency/list", {
        page: 1,
        pageSize: 1,
        filters: {},
      }),
      apiPost(authedRequest, "/game/game_category/list", {
        page: 1,
        pageSize: 1,
        filters: {},
      }),
    ]);

    const currencyId = currencyList.data.list[0].id;
    const gameCategoryId = categoryList.data.list[0].id;

    const { json: createJson } = await apiPost(
      authedRequest,
      "/masteragent/create",
      {
        sasEntityHierarchyId: 3, // MasterAgent (xem SasEntityHierarchyEnum)
        name: `QA Test MA ${suffix}`,
        entityCode: `QATESTMA${suffix}`,
        parentId: parentSasEntityId,
        currencyIds: [currencyId],
        gameCategoryIds: [gameCategoryId],
        status: 1,
        timezoneId: 336,
        products: {},
        geofencing: {
          country: [],
          geofencingDelete: [],
          ipv4: [],
          ipv6: [],
        },
      },
    );
    expect(createJson.status).toBe("success");
  });
});
