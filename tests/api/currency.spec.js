// Test cho CurrencyController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\CurrencyController.cs)
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

function randomCurrencyCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "QA";
  for (let i = 0; i < 6; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  return code;
}

test.describe("Currency API - /currency/list", () => {
  test("lists currencies WITHOUT authentication (public endpoint)", async ({
    request,
  }) => {
    // Phát hiện: currency/list là endpoint DUY NHẤT trong toàn bộ controller không có
    // [SecurityCheckpoint(...)] - hoạt động bình thường kể cả khi không gửi Authorization header.
    const { response, json } = await apiPost(request, "/currency/list", {
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

test.describe("Currency API - view & validate", () => {
  test("views a currency and reads its rate history", async ({
    authedRequest,
  }) => {
    const { json: listJson } = await apiPost(authedRequest, "/currency/list", {
      page: 1,
      pageSize: 1,
      filters: {},
    });
    const currency = listJson.data.list[0];

    const { json: viewJson } = await apiPost(authedRequest, "/currency/view", {
      id: currency.id,
    });
    expect(viewJson.status).toBe("success");
    expect(viewJson.data.id).toBe(currency.id);

    const { json: historyJson } = await apiPost(
      authedRequest,
      "/currencyrate/history",
      {
        page: 1,
        pageSize: 5,
        id: currency.id,
      },
    );
    expect(historyJson.status).toBe("success");
    expect(Array.isArray(historyJson.data.list)).toBe(true);
  });

  test("reports an existing currency code as taken", async ({
    authedRequest,
  }) => {
    const { json: listJson } = await apiPost(authedRequest, "/currency/list", {
      page: 1,
      pageSize: 1,
      filters: {},
    });

    const { json } = await apiPost(authedRequest, "/currency/validate/code", {
      code: listJson.data.list[0].code,
    });
    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("DUPLICATE_CURRENCY_CODE");
  });

  test("reports a fresh currency code as available", async ({
    authedRequest,
  }) => {
    const { json } = await apiPost(authedRequest, "/currency/validate/code", {
      code: randomCurrencyCode(),
    });
    expect(json.status).toBe("success");
  });
});

test.describe("Currency API - /dropdown/currency", () => {
  // KNOWN ISSUE (backend): trả UNKNOWN_ERROR trên DB dev hiện tại kể cả với session đã verify
  // OTP (dùng verifiedRequest) - đã thử với body rỗng lẫn body đủ field, lỗi giống nhau. Test
  // này CỐ TÌNH để fail đỏ - không dùng test.fail() - để nhắc backend xử lý mỗi lần chạy suite,
  // cho tới khi bug được fix.
  test("lists currencies for filtering", async ({ verifiedRequest }) => {
    const { json } = await apiPost(verifiedRequest, "/dropdown/currency", {
      houseIds: [],
      masterAgentIds: [],
      agentIds: [],
    });

    expect(json.status).toBe("success");
  });
});

test.describe("Currency API - full lifecycle", () => {
  test("creates, updates and deactivates a currency", async ({
    authedRequest,
  }) => {
    // Code chỉ được chứa chữ hoa A-Z (CreateCurrencyRequestValidator) - không dùng số/timestamp
    const code = randomCurrencyCode();

    const { json: createJson } = await apiPost(
      authedRequest,
      "/currency/create",
      {
        code,
        name: "QA Currency",
        status: 1,
        exchangeRate: 1.5,
        maxPayout: 1000,
        isSweep: 0,
      },
    );
    expect(createJson.status).toBe("success");
    expect(createJson.messageCode).toBe("CREATE_CURRENCY_SUCCESS");

    // Response không trả id, phải tự tìm lại bằng code
    const { json: listJson } = await apiPost(authedRequest, "/currency/list", {
      page: 1,
      pageSize: 500,
      filters: {},
    });
    const created = listJson.data.list.find((c) => c.code === code);
    expect(
      created,
      `Không tìm thấy currency vừa tạo (code=${code}) trong /currency/list`,
    ).toBeTruthy();
    const currencyId = created.id;

    try {
      const { json: updateJson } = await apiPost(
        authedRequest,
        "/currency/update",
        {
          id: currencyId,
          name: "QA Currency Updated",
          status: 1,
          exchangeRate: 2.5,
          maxPayout: 2000,
          isSweep: 0,
        },
      );
      expect(updateJson.status).toBe("success");

      const { json: viewAfterUpdate } = await apiPost(
        authedRequest,
        "/currency/view",
        { id: currencyId },
      );
      expect(viewAfterUpdate.data.name).toBe("QA Currency Updated");
    } finally {
      // Cleanup - deactivate currency vừa tạo, không để lại dữ liệu "active" thừa trên DB dev
      const { json: deactivateJson } = await apiPost(
        authedRequest,
        "/currency/deactivate",
        {
          ids: [currencyId],
          status: 0,
        },
      );
      expect(deactivateJson.status).toBe("success");

      const { json: viewAfterDeactivate } = await apiPost(
        authedRequest,
        "/currency/view",
        { id: currencyId },
      );
      expect(viewAfterDeactivate.data.status).toBe(0); // 0 = Inactive
    }
  });
});
