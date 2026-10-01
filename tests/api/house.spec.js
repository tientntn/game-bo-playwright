// Test cho HouseController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\HouseController.cs)
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

test.describe("House API - /house/list", () => {
  test("lists houses with pagination envelope", async ({ authedRequest }) => {
    // filters phải truyền tường minh (dù rỗng {}) - thiếu field này API trả totalCount=0/list=[]
    // một cách âm thầm (không lỗi) dù DB thực tế có dữ liệu. Đây là hành vi đã xác nhận thực tế,
    // không phải giả định - cẩn thận khi viết request body cho các API .../list khác.
    const { response, json } = await apiPost(authedRequest, "/house/list", {
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

test.describe("House API - view & dropdowns", () => {
  test("views a house and reads its supported currencies/categories", async ({
    authedRequest,
  }) => {
    const { json: dropdownJson } = await apiPost(
      authedRequest,
      "/dropdown/house",
      {},
    );
    expect(dropdownJson.status).toBe("success");
    test.skip(
      dropdownJson.data.length === 0,
      "Không có house nào trên DB dev để test dropdown-by-house",
    );

    const houseId = dropdownJson.data[0].value;

    const { json: viewJson } = await apiPost(authedRequest, "/house/view", {
      id: houseId,
    });
    expect(viewJson.status).toBe("success");
    expect(viewJson.data.id).toBe(houseId);

    const { json: currencyJson } = await apiPost(
      authedRequest,
      "/house/supportedcurrency",
      {
        houseId,
      },
    );
    expect(currencyJson.status).toBe("success");
    expect(Array.isArray(currencyJson.data)).toBe(true);

    const { json: categoryJson } = await apiPost(
      authedRequest,
      "/house/supportedcategories",
      {
        houseId,
      },
    );
    expect(categoryJson.status).toBe("success");
    expect(Array.isArray(categoryJson.data)).toBe(true);
  });
});

test.describe("House API - /house/update-status", () => {
  test("deactivates then restores a house's original status", async ({ authedRequest }) => {
    // Đổi status thật của house dùng chung - test này LUÔN khôi phục lại status ban đầu trong
    // finally, kể cả khi assertion ở giữa thất bại.
    const { json: listJson } = await apiPost(authedRequest, "/house/list", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    test.skip(listJson.data.list.length === 0, "Không có house nào trên DB dev để test");
    const house = listJson.data.list[0];
    const originalStatus = house.status;
    const toggledStatus = originalStatus === 1 ? 0 : 1;

    try {
      const { json: toggleJson } = await apiPost(authedRequest, "/house/update-status", {
        ids: [house.id],
        status: toggledStatus,
      });
      expect(toggleJson.status).toBe("success");

      const { json: viewAfterToggle } = await apiPost(authedRequest, "/house/view", { id: house.id });
      expect(viewAfterToggle.data.status).toBe(toggledStatus);
    } finally {
      const { json: restoreJson } = await apiPost(authedRequest, "/house/update-status", {
        ids: [house.id],
        status: originalStatus,
      });
      expect(restoreJson.status).toBe("success");

      const { json: viewAfterRestore } = await apiPost(authedRequest, "/house/view", { id: house.id });
      expect(viewAfterRestore.data.status).toBe(originalStatus);
    }
  });
});

test.describe("House API - /house/update", () => {
  test("updates a house, writing back its current values unchanged", async ({ authedRequest }) => {
    // QUAN TRỌNG: house/update là full-replace (currencyIds/gameCategoryIds/geofencing gửi lên
    // sẽ THAY THẾ toàn bộ danh sách hiện có trên house thật đang dùng chung). Test này chỉ AN
    // TOÀN vì lấy TOÀN BỘ giá trị hiện tại từ /house/view bằng code (không hard-code/rút gọn),
    // rồi ghi lại y hệt. TUYỆT ĐỐI không thay các dòng .map(...) dưới đây bằng danh sách viết tay.
    const { json: dropdownJson } = await apiPost(authedRequest, "/dropdown/house", {});
    test.skip(dropdownJson.data.length === 0, "Không có house nào trên DB dev để test");
    const houseId = dropdownJson.data[0].value;

    const { json: viewJson } = await apiPost(authedRequest, "/house/view", { id: houseId });
    expect(viewJson.status).toBe("success");

    const currencyIds = viewJson.data.currencies.map((c) => c.id);
    const gameCategoryIds = viewJson.data.gameCategoryList.map((c) => c.id);
    // Bảo vệ: nếu house này chưa gán currency/category nào thì KHÔNG tiếp tục - tránh vô tình
    // ghi đè mảng rỗng lên dữ liệu thật trong trường hợp bất thường.
    test.skip(
      currencyIds.length === 0 || gameCategoryIds.length === 0,
      "House này chưa gán currency/game category nào - bỏ qua để tránh ghi đè mảng rỗng",
    );
    const ipv4 = viewJson.data.geofencing.ipv4.map((entry) => ({
      id: entry.id,
      value: entry.value,
      remark: entry.remark,
    }));

    const { json: updateJson } = await apiPost(authedRequest, "/house/update", {
      id: houseId,
      name: viewJson.data.name,
      currencyIds,
      gameCategoryIds,
      status: viewJson.data.status,
      timezoneId: viewJson.data.timezone.id,
      geofencing: { ipv4, ipv6: [], country: [], geofencingDelete: [] },
    });
    expect(updateJson.status).toBe("success");

    // Xác nhận ghi lại y hệt: view lại phải khớp với dữ liệu trước khi update
    const { json: viewAfterJson } = await apiPost(authedRequest, "/house/view", { id: houseId });
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

test.describe("House API - /house/create", () => {
  // KNOWN ISSUE (backend): house/create trả UNKNOWN_ERROR trên DB dev hiện tại, dù request
  // body đúng theo CreateHouseRequestValidator (đã thử với 2 bộ currency/game category khác
  // nhau, cả hai đều fail giống nhau - lỗi lặp lại, không phải may rủi). Nghi vấn nằm ở bước
  // tạo role mặc định cho house mới (SasEntityRoleService.CreateRole) hoặc một bước insert
  // phía sau trong HouseService.Create. Test này CỐ TÌNH để fail đỏ - không dùng test.fail() -
  // để nhắc backend xử lý mỗi lần chạy suite, cho tới khi bug được fix.
  test("creates a house with valid currencies/game categories/timezone", async ({
    authedRequest,
    authInfo,
  }) => {
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

    const { json: createJson } = await apiPost(authedRequest, "/house/create", {
      sasEntityHierarchyId: 2, // House (xem SasEntityHierarchyEnum)
      name: `QA Test House ${suffix}`,
      entityCode: `QATESTH${suffix}`,
      parentId: authInfo.sasEntityId,
      currencyIds: [currencyId],
      gameCategoryIds: [gameCategoryId],
      geofencing: { country: [], geofencingDelete: [], ipv4: [], ipv6: [] },
      status: 1,
      timezoneId: 336,
    });

    expect(createJson.status).toBe("success");
  });
});
