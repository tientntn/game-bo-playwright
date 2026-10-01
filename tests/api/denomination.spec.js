// Test cho DenominationController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\DenominationController.cs)
// "update" test theo pattern xem → ghi lại y hệt (xem describe riêng bên dưới) vì đây là
// full-replace toàn bộ danh sách denomination của 1 cặp (subCategory, currency) trên dữ liệu thật
// dùng chung - đã đọc DenominationService.ViewList xác nhận response trả ĐỦ field cần để ghi lại
// (Id/Name/IsDefault/DefaultBetLevel/BetLevels/Remarks khớp UpdateDenominationRequest.DenominationVo).
// "upload" test bằng 1 CSV chỉ có header, 0 dòng dữ liệu (xem describe riêng bên dưới) - đã đọc
// DenominationService.Upload xác nhận input rỗng thì GroupBy trả dictionary rỗng, vòng ghi DB
// không chạy lần nào nên an toàn tuyệt đối, không phụ thuộc dữ liệu DB dev hiện tại.
const { test, expect } = require("./fixtures");
const { apiPost, API_PATH, genTraceId } = require("./helpers/api-client");

// Không phải mọi game sub category đều có sẵn denomination (tuỳ dữ liệu DB dev) - lấy đại ĐÚNG 1
// sub category đầu tiên (pageSize: 1) hay bị "xui" trúng cái rỗng, khiến test skip không cần
// thiết dù DB dev thực ra có đủ dữ liệu ở sub category khác. Hàm này duyệt qua nhiều sub category
// (pageSize lớn hơn) để tìm ĐÚNG 1 cái có denomination thật, giảm khả năng skip do chọn trúng dữ
// liệu rỗng ngẫu nhiên.
async function findSubCategoryWithDenominations(authedRequest) {
  const { json: subCategoryList } = await apiPost(
    authedRequest,
    "/game/game_sub_category/list",
    {
      page: 1,
      pageSize: 100,
      filters: {},
    },
  );

  for (const subCategory of subCategoryList.data.list) {
    const { json: dropdownJson } = await apiPost(authedRequest, "/denomination/dropdown", {
      gameSubCategoryId: subCategory.id,
    });
    if (dropdownJson.status === "success" && dropdownJson.data.length > 0) {
      return { gameSubCategoryId: subCategory.id, currencyGroup: dropdownJson.data[0] };
    }
  }

  return null;
}

test.describe("Denomination API - /denomination/list", () => {
  test("lists denominations grouped by currency for a game sub category", async ({
    authedRequest,
  }) => {
    const { json: subCategoryList } = await apiPost(
      authedRequest,
      "/game/game_sub_category/list",
      {
        page: 1,
        pageSize: 1,
        filters: {},
      },
    );
    test.skip(
      subCategoryList.data.list.length === 0,
      "Không có game sub category nào trên DB dev để test",
    );
    const gameSubCategoryId = subCategoryList.data.list[0].id;

    const { response, json } = await apiPost(
      authedRequest,
      "/denomination/list",
      {
        page: 1,
        pageSize: 10,
        gameSubCategoryId,
        filters: {},
      },
    );

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(typeof json.data.totalCount).toBe("number");
    expect(Array.isArray(json.data.list)).toBe(true);
  });
});

test.describe("Denomination API - dropdown & detail", () => {
  test("reads the dropdown, detail view, and delete/assignment checks for a denomination", async ({
    authedRequest,
  }) => {
    test.setTimeout(60 * 1000); 
    const found = await findSubCategoryWithDenominations(authedRequest);
    test.skip(
      !found,
      "Không tìm thấy sub category nào có denomination trên DB dev để test",
    );
    const { gameSubCategoryId, currencyGroup } = found;
    const denominationId = currencyGroup.denominationList[0].id;

    const { json: viewListJson } = await apiPost(
      authedRequest,
      "/denomination/view/list",
      {
        page: 1,
        pageSize: 10,
        gameSubCategoryId,
        currencyId: currencyGroup.currencyId,
        timezoneId: 336,
      },
    );
    expect(viewListJson.status).toBe("success");
    expect(Array.isArray(viewListJson.data.denominations)).toBe(true);

    const { json: assignmentJson } = await apiPost(
      authedRequest,
      "/denomination/check_assignment",
      {
        id: denominationId,
      },
    );
    expect(assignmentJson.status).toBe("success");

    const { json: deleteCheckJson } = await apiPost(
      authedRequest,
      "/denomination/check/delete",
      {
        id: denominationId,
      },
    );
    expect(deleteCheckJson.status).toBe("success");
    expect(typeof deleteCheckJson.data.deletable).toBe("boolean");
  });
});

test.describe("Denomination API - /denomination/update", () => {
  test("updates denominations for a sub category/currency pair, writing back current values unchanged", async ({
    authedRequest,
  }) => {
    // No-op: /denomination/update là full-replace toàn bộ danh sách denomination của 1 cặp
    // (subCategory, currency) - denomination nào KHÔNG có trong request sẽ bị coi là đã xoá (xem
    // UpdateDenominationHandler.cs deletedIds = oldDenomIds.Except(denomIds)). Vì vậy bắt buộc phải
    // lấy ĐỦ toàn bộ danh sách hiện có từ /denomination/view/list (không paginate thật - đã đọc
    // DenominationService.ViewList, Page/PageSize bị bỏ qua, luôn trả toàn bộ) rồi ghi lại y hệt,
    // không rút gọn/hard-code.
    test.setTimeout(60 * 1000); 
    const found = await findSubCategoryWithDenominations(authedRequest);
    test.skip(
      !found,
      "Không tìm thấy sub category nào có denomination trên DB dev để test",
    );
    const { gameSubCategoryId, currencyGroup } = found;
    const currencyId = currencyGroup.currencyId;

    const { json: viewListJson } = await apiPost(
      authedRequest,
      "/denomination/view/list",
      {
        page: 1,
        pageSize: 50,
        gameSubCategoryId,
        currencyId,
        timezoneId: 336,
      },
    );
    expect(viewListJson.status).toBe("success");
    const currentDenominations = viewListJson.data.denominations;
    test.skip(
      currentDenominations.length === 0,
      "Cặp sub category/currency này chưa có denomination nào",
    );

    const denominations = currentDenominations.map((d) => ({
      id: d.id,
      name: d.name,
      isDefault: d.isDefault,
      defaultBetLevel: d.defaultBetLevel,
      betLevels: d.betLevels,
      remarks: d.remarks,
    }));

    const { json: updateJson } = await apiPost(authedRequest, "/denomination/update", {
      subCategoryId: gameSubCategoryId,
      currencyId,
      denominations,
    });
    expect(updateJson.status).toBe("success");

    const { json: viewListAfterJson } = await apiPost(
      authedRequest,
      "/denomination/view/list",
      {
        page: 1,
        pageSize: 50,
        gameSubCategoryId,
        currencyId,
        timezoneId: 336,
      },
    );
    const sortById = (list) => [...list].sort((a, b) => a.id - b.id);
    expect(sortById(viewListAfterJson.data.denominations).map((d) => ({
      id: d.id,
      name: d.name,
      isDefault: d.isDefault,
      defaultBetLevel: d.defaultBetLevel,
      betLevels: d.betLevels,
      remarks: d.remarks,
    }))).toEqual(sortById(denominations));
  });
});

test.describe("Denomination API - /denomination/upload", () => {
  test("uploads a header-only CSV as a no-op", async ({ authedRequest }) => {
    // Đã đọc DenominationService.Upload: input rỗng (0 dòng dữ liệu) làm
    // `deminominations.GroupBy(...)` trả dictionary rỗng, vòng ghi DB (BatchSave, outbox) không
    // chạy lần nào - an toàn tuyệt đối, không phụ thuộc dữ liệu DB dev hiện tại. Header lấy đúng
    // theo DenominationCsvParser.cs (Currency, Game Sub Category, Denom Name, Default Bet Level,
    // Level N... - bắt buộc có ít nhất 1 cột "Level").
    const csvContent = "Currency,Game Sub Category,Denom Name,Default Bet Level,Level 1\n";

    const response = await authedRequest.post(`${API_PATH}/denomination/upload`, {
      multipart: {
        TraceId: genTraceId(),
        Request: JSON.stringify({ denomType: 1 }),
        Files: {
          name: "denomination-header-only.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(csvContent, "utf-8"),
        },
      },
    });
    const json = await response.json();

    expect(json.status).toBe("success");
  });
});
