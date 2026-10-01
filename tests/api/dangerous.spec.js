// ============================================================================
// ⚠️ FILE ĐẶC BIỆT - chứa test cho 9 endpoint bị loại trừ khỏi bộ test chính vì rủi ro THẬT (rác
// vĩnh viễn không xoá được, mất dữ liệu thật không đọc lại được để khôi phục, hoặc side-effect
// lên hệ thống ngoài thật - tài chính/session), CỘNG THÊM 3 endpoint agentcredential/generate_key,
// /update, /update_status (side-effect thật lên agent có thể đang được FE dùng - chuyển từ
// apikey.spec.js sang đây để quy về 1 mối, cùng cơ chế bật/tắt). Xem giải thích chi tiết từng
// endpoint (đã đọc kỹ code để xác nhận) trong KNOWN_ISSUES.md, mục "9 endpoint không có test" và
// mục "Ảnh hưởng consumer thật ngoài phạm vi test (FE)".
//
// MẶC ĐỊNH TOÀN BỘ FILE NÀY SKIP khi chạy `npm run test:api` bình thường (không ảnh hưởng tới
// suite chính). Muốn bật lên khi thật sự cần test:
//
//   PowerShell:
//     $env:RUN_DANGEROUS_TESTS=1
//     npx playwright test tests/api/dangerous.spec.js --project=api --workers=1
//
//   Bash:
//     RUN_DANGEROUS_TESTS=1 npx playwright test tests/api/dangerous.spec.js --project=api --workers=1
//
// ĐỌC KỸ comment ngay trên từng test TRƯỚC KHI bật - 3 test cuối (game_round/update-status,
// operator_request/retry, player/kick) còn cần thêm biến môi trường riêng trỏ tới 1 bản ghi THẬT
// do CHÍNH BẠN chọn, vì không có cách nào tự động chọn an toàn (mọi lựa chọn tự động đều là chọn
// đại 1 bản ghi thật đang dùng chung, có thể gây hậu quả thật ngoài ý muốn).
// ============================================================================
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

// LƯU Ý: so sánh === "1" tường minh, không dùng !!process.env.RUN_DANGEROUS_TESTS - vì .env luôn
// set biến này thành chuỗi "0" khi tắt, mà !!"0" lại là true trong JS (chuỗi khác rỗng luôn
// truthy), sẽ vô tình BẬT test nguy hiểm thay vì tắt.
const RUN = process.env.RUN_DANGEROUS_TESTS === "1";

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

// Giống findSubCategoryWithDenominations trong denomination.spec.js (không import chung để file
// này tự đứng độc lập, đúng phong cách các file spec khác trong repo) - duyệt qua nhiều sub
// category để tìm 1 cái có denomination thật, dùng làm currencyInfoList hợp lệ khi tạo game.
// Nhận request context chung (authedRequest hoặc verifiedRequest tuỳ endpoint gọi) thay vì cố định
// tên fixture, vì 2 endpoint list/dropdown ở đây chỉ cần Session, không cần SessionVerify.
async function findSubCategoryWithDenominations(request) {
  const { json: subCategoryList } = await apiPost(
    request,
    "/game/game_sub_category/list",
    { page: 1, pageSize: 100, filters: {} },
  );

  for (const subCategory of subCategoryList.data.list) {
    const { json: dropdownJson } = await apiPost(request, "/denomination/dropdown", {
      gameSubCategoryId: subCategory.id,
    });
    if (dropdownJson.status === "success" && dropdownJson.data.length > 0) {
      return { subCategory, currencyGroup: dropdownJson.data[0] };
    }
  }

  return null;
}

test.describe("Game API - /game/create + /game/update [rác vĩnh viễn không xoá được]", () => {
  // /game/create và /game/update yêu cầu SecurityCheckpointType.SessionVerify (xem GameController.cs)
  // - phải dùng fixture verifiedRequest (đã tự động verifyOtp), authedRequest (chỉ login) sẽ bị từ
  // chối với UNAUTHORIZED_USER dù token hợp lệ, giống pattern ở download.spec.js.
  test("creates a disposable game (v1) then updates it", async ({ verifiedRequest }) => {
    // RỦI RO: GameController.cs không có action Delete - game tạo ra ở đây sẽ nằm vĩnh viễn trên
    // catalog game dùng chung cho cả team, không có cách dọn lại qua API.
    // AN TOÀN cho phần "update": /game/view không trả lại Rows/Reels/Payline/ReleaseDate (xem
    // KNOWN_ISSUES.md) nên bình thường không thể ghi lại y hệt cho 1 game THẬT đang dùng chung -
    // nhưng ở đây update lên đúng game VỪA TẠO RIÊNG cho test này, nên ghi giá trị mới không làm
    // mất dữ liệu thật của ai cả.
    test.skip(
      !RUN,
      "Set RUN_DANGEROUS_TESTS=1 để bật - xem comment đầu file dangerous.spec.js. Rủi ro: để lại 1 game rác vĩnh viễn trên catalog dùng chung (không có API xoá game).",
    );

    const found = await findSubCategoryWithDenominations(verifiedRequest);
    test.skip(!found, "Không tìm thấy sub category nào có denomination trên DB dev để test");
    const { subCategory, currencyGroup } = found;
    const currencyId = currencyGroup.currencyId;
    const denominationId = currencyGroup.denominationList[0].id;

    const suffix = uniqueSuffix();
    const code = `QATESTGAME${suffix}`;

    const { json: createJson } = await apiPost(verifiedRequest, "/game/create", {
      code,
      name: `QA Test Game ${suffix}`,
      categoryId: subCategory.gameCategoryId,
      subCategoryId: subCategory.id,
      status: 1,
      currencyInfoList: [{ id: currencyId, denominationId }],
    });
    expect(createJson.status).toBe("success");

    // /game/create không trả về id - phải tự tìm lại bằng code vừa tạo qua /game/list/v2 (giống
    // pattern agentcredential/generate_key trong apikey.spec.js)
    const { json: listJson } = await apiPost(verifiedRequest, "/game/list/v2", {
      page: 1,
      pageSize: 500,
      filters: {},
    });
    const created = listJson.data.list.find((g) => g.code === code);
    expect(created, `Không tìm thấy game vừa tạo (code=${code}) trong /game/list/v2`).toBeTruthy();
    const gameId = created.id;

    const { json: updateJson } = await apiPost(verifiedRequest, "/game/update", {
      id: gameId,
      name: `QA Test Game ${suffix} Updated`,
      categoryId: subCategory.gameCategoryId,
      subCategoryId: subCategory.id,
      status: 1,
      currencyInfoList: [{ id: currencyId, denominationId }],
      rows: 5,
      reels: 3,
      payline: 25,
    });
    expect(updateJson.status).toBe("success");

    const { json: viewJson } = await apiPost(verifiedRequest, "/game/view", { gameId });
    expect(viewJson.status).toBe("success");
    expect(viewJson.data.name).toBe(`QA Test Game ${suffix} Updated`);
  });
});

test.describe("Game API - /game/create/v2 + /game/update/v2 + /game/update-paytable + /game/reset-default-paytable [rác vĩnh viễn không xoá được]", () => {
  // Cùng lý do cần verifiedRequest như describe /game/create ở trên - create/v2, update/v2 và
  // update-paytable đều yêu cầu SecurityCheckpointType.SessionVerify (xem GameController.cs).
  test("creates a disposable game (v2) with a paytable, then updates/resets it", async ({
    verifiedRequest,
  }) => {
    // Cùng rủi ro "rác vĩnh viễn" như describe phía trên, cộng thêm: nội dung THẬT SỰ hợp lệ của
    // field "payTable" (JSON cấu hình paytable) CHƯA XÁC ĐỊNH được qua đọc code -
    // GamePayTableInfoValidator chỉ yêu cầu NotNull, không có schema cụ thể nào khác. "{}" có thể
    // pass validator nhưng CHƯA CHẮC được logic xử lý paytable phía sau (GameManageCommandService)
    // chấp nhận - nếu create fail, khả năng cao là do nội dung "payTable" này, cần mẫu thật từ FE.
    test.skip(
      !RUN,
      "Set RUN_DANGEROUS_TESTS=1 để bật - xem comment đầu file dangerous.spec.js. Rủi ro: để lại 1 game + 1 paytable rác vĩnh viễn trên catalog dùng chung.",
    );

    const found = await findSubCategoryWithDenominations(verifiedRequest);
    test.skip(!found, "Không tìm thấy sub category nào có denomination trên DB dev để test");
    const { subCategory, currencyGroup } = found;
    const currencyId = currencyGroup.currencyId;
    const denominationId = currencyGroup.denominationList[0].id;

    const suffix = uniqueSuffix();
    const code = `QATESTGAMEV2${suffix}`;
    const paytableCode = `QAPT${suffix}`;

    const { json: createJson } = await apiPost(verifiedRequest, "/game/create/v2", {
      code,
      name: `QA Test Game V2 ${suffix}`,
      categoryId: subCategory.gameCategoryId,
      subCategoryId: subCategory.id,
      status: 1,
      currencyInfoList: [{ id: currencyId, denominationId }],
      payTableInfoList: [{ code: paytableCode, payTable: "{}", status: 1 }],
    });
    expect(createJson.status).toBe("success");

    const { json: listJson } = await apiPost(verifiedRequest, "/game/list/v2", {
      page: 1,
      pageSize: 500,
      filters: {},
    });
    const created = listJson.data.list.find((g) => g.code === code);
    expect(created, `Không tìm thấy game vừa tạo (code=${code}) trong /game/list/v2`).toBeTruthy();
    const gameId = created.id;

    const { json: viewJson } = await apiPost(verifiedRequest, "/game/view", { gameId });
    expect(viewJson.status).toBe("success");
    const paytable = viewJson.data.payTableInfoList.find((p) => p.code === paytableCode);
    expect(paytable, "Không tìm thấy paytable vừa tạo trong /game/view").toBeTruthy();
    const paytableId = paytable.id;

    // update/v2 - an toàn vì là game vừa tạo riêng cho test này (xem giải thích ở describe trên)
    const { json: updateJson } = await apiPost(verifiedRequest, "/game/update/v2", {
      id: gameId,
      name: `QA Test Game V2 ${suffix} Updated`,
      categoryId: subCategory.gameCategoryId,
      subCategoryId: subCategory.id,
      status: 1,
      currencyInfoList: [{ id: currencyId, denominationId }],
      // payTableInfoList ở đây là full-replace (xem GameManageCommandService.ValidatePaytables,
      // validateExisting=true) - PHẢI kèm id của paytable hiện có, nếu không backend hiểu là đang
      // xoá paytable đó (không được phép) và trả CANNOT_DELETE_PAYTABLE -> INVALID_UPDATE_REQUEST.
      payTableInfoList: [{ id: paytableId, code: paytableCode, payTable: "{}", status: 1 }],
      rows: 5,
      reels: 3,
      payline: 25,
    });
    expect(updateJson.status).toBe("success");

    // update-paytable - Id ở đây là GAME id (không phải paytable id - xem
    // UpdateGamePaytableRequest.cs), PayTableInfoList full-replace toàn bộ paytable của game này
    // (giống pattern denomination/update). Gửi lại đúng paytable vừa tạo (kèm id) để không đổi gì.
    const { json: updatePaytableJson } = await apiPost(verifiedRequest, "/game/update-paytable", {
      id: gameId,
      payTableInfoList: [{ id: paytableId, code: paytableCode, payTable: "{}", status: 1 }],
    });
    expect(updatePaytableJson.status).toBe("success");

    // reset-default-paytable - tạo hẳn 1 paytable MỚI thay thế, không có API phục hồi paytable cũ
    // (xem ResetPaytableHandler.cs) - an toàn vì paytable bị thay là dữ liệu rác vừa tạo riêng cho
    // test này, không phải paytable thật đang dùng chung. Endpoint này chỉ cần Session (không cần
    // SessionVerify) nhưng verifiedRequest vẫn dùng được (verifyOtp không làm mất quyền Session).
    const { json: resetJson } = await apiPost(verifiedRequest, "/game/reset-default-paytable", {
      paytableId,
    });
    expect(resetJson.status).toBe("success");
  });
});

test.describe("GameRound API - /game_round/update-status [side-effect hệ thống ngoài thật]", () => {
  test("updates the status of real game rounds on the external bet-history system", async ({
    authedRequest,
  }) => {
    // RỦI RO CAO NHẤT trong file này: GameRoundService.UpdateStatus gọi thẳng
    // _betHistoryClientService.UpdateStatusGameRound(...) - đổi status của round cược THẬT trên hệ
    // thống bet-history ngoài, không có cách khôi phục. KHÔNG tự động chọn round id (game_round/list
    // hiện cũng đang là KNOWN ISSUE UNKNOWN_ERROR, và kể cả list được thì tự chọn đại 1 round thật
    // để đổi status cũng là rủi ro không nên tự động hoá) - bắt buộc TỰ BẠN chỉ định đúng round id
    // muốn test qua biến môi trường.
    const roundIds = (process.env.DANGEROUS_GAME_ROUND_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    test.skip(
      !RUN || roundIds.length === 0,
      "Set RUN_DANGEROUS_TESTS=1 và DANGEROUS_GAME_ROUND_IDS=<id1,id2,...> (round id THẬT, tự chọn) để bật. Rủi ro: đổi status round cược THẬT trên hệ thống bet-history ngoài, không có cách khôi phục.",
    );
    const status = process.env.DANGEROUS_GAME_ROUND_STATUS || "Completed";

    const { json } = await apiPost(authedRequest, "/game_round/update-status", {
      ids: roundIds,
      status,
    });
    expect(json.status).toBe("success");
  });
});

test.describe("FailOperatorRequest API - /operator_request/retry [side-effect hệ thống ngoài thật]", () => {
  test("retries a real failed operator request against the external retry-cancel-bet system", async ({
    authedRequest,
  }) => {
    // RỦI RO: FailOperatorRequestService.Retry POST thẳng tới hệ thống retry-cancel-bet ngoài -
    // ảnh hưởng giao dịch tài chính THẬT. operator_request/list hiện cũng đang là KNOWN ISSUE
    // UNKNOWN_ERROR nên không tự động lấy được id nào - bắt buộc TỰ BẠN chỉ định qua biến môi trường.
    const id = process.env.DANGEROUS_OPERATOR_REQUEST_ID;
    test.skip(
      !RUN || !id,
      "Set RUN_DANGEROUS_TESTS=1 và DANGEROUS_OPERATOR_REQUEST_ID=<id THẬT, tự chọn> để bật. Rủi ro: gọi thẳng hệ thống retry huỷ cược THẬT, ảnh hưởng giao dịch tài chính thật.",
    );

    const { json } = await apiPost(authedRequest, "/operator_request/retry", { id });
    expect(json.status).toBe("success");
  });
});

test.describe("Player API - /player/kick [side-effect hệ thống ngoài thật]", () => {
  test("kicks a real player's live session via Kafka", async ({ authedRequest }) => {
    // RỦI RO: PlayerService.Kick publish Kafka topic "PlayerKick" chứa player id thật, để 1 service
    // ngoài ngắt session THẬT của player đó. PlayerController.cs không có action Create nên không
    // thể tạo player rời rạc để kick an toàn - bắt buộc TỰ BẠN chỉ định 1 player THẬT (nên chọn
    // player test/nội bộ, KHÔNG chọn player thật đang chơi) qua biến môi trường.
    const playerId = process.env.DANGEROUS_PLAYER_ID;
    const agentCode = process.env.DANGEROUS_PLAYER_AGENT_CODE;
    const username = process.env.DANGEROUS_PLAYER_USERNAME;
    test.skip(
      !RUN || !playerId || !agentCode || !username,
      "Set RUN_DANGEROUS_TESTS=1, DANGEROUS_PLAYER_ID, DANGEROUS_PLAYER_AGENT_CODE, DANGEROUS_PLAYER_USERNAME (player THẬT, tự chọn) để bật. Rủi ro: ngắt session THẬT của player đang chơi, không có API tạo player rời rạc để test an toàn.",
    );

    const { json } = await apiPost(authedRequest, "/player/kick", {
      playerKicks: [{ playerId: Number(playerId), agentCode, username }],
    });
    expect(json.status).toBe("success");
  });
});

test.describe("ApiKey API - agentcredential/generate_key + /update + /update_status lifecycle [side-effect thật lên agent có thể đang được FE dùng]", () => {
  test("generates, views, updates and deactivates an agent api key", async ({ authedRequest }) => {
    // Chuyển từ apikey.spec.js sang đây (trước đó test.skip(true, ...) cứng trong code). Rủi ro:
    // generate_key/update đổi api key + callback/IP thật của agent, update_status (dùng để cleanup)
    // đổi trạng thái key đó - agent lấy để test là agent ĐẦU TIÊN ngẫu nhiên từ
    // /dropdown/agent-filter, có thể trùng agent mà FE đang dùng thật để tích hợp API - sinh/đổi/
    // vô hiệu hoá key trên agent đó khiến FE phải cấu hình lại api key, gây lỗi cho FE. Bản thân
    // test tự tạo key MỚI rồi tự deactivate lại trong finally (không đụng key có sẵn), nhưng vẫn
    // rủi ro vì KHÔNG chọn được đúng 1 agent riêng dành cho test tự động (không phải agent FE đang
    // dùng thật) - cần có agent đó trước khi bật lại thường xuyên.
    test.skip(
      !RUN,
      "Set RUN_DANGEROUS_TESTS=1 để bật - xem comment đầu file dangerous.spec.js. Rủi ro: đổi api key/callback của agent thật (agent đầu tiên ngẫu nhiên từ dropdown) sẽ khiến FE phải config lại nếu agent đó đang được dùng thật.",
    );

    // Sinh api key MỚI cho agent (không đụng tới key có sẵn), rồi tự deactivate lại trong
    // finally bên dưới - an toàn vì chỉ thêm/xoá đúng record vừa tạo, không sửa key thật đã tồn tại.
    const { json: agentFilter } = await apiPost(authedRequest, "/dropdown/agent-filter", {});
    test.skip(agentFilter.data.length === 0, "Không có agent nào trên DB dev để test");
    const agentId = agentFilter.data[0].value;

    const { json: generateJson } = await apiPost(authedRequest, "/agentcredential/generate_key", {
      agentId,
      callbackUrl: "https://example.com/qa-callback",
      ipAddress: "1.2.3.4",
      status: 1,
    });
    expect(generateJson.status).toBe("success");
    expect(generateJson.messageCode).toBe("GENERATE_AGENT_API_KEYS_SUCCESS");
    const apiKey = generateJson.data.apiKey;
    expect(apiKey).toBeTruthy();

    // Response không trả id, phải tự tìm lại bằng api_key vừa sinh ra qua /list
    const { json: listJson } = await apiPost(authedRequest, "/agentcredential/list", {
      page: 1,
      pageSize: 50,
      filters: { agentIds: [agentId] },
    });
    const created = listJson.data.list.find((k) => k.api_key === apiKey);
    expect(created, `Không tìm thấy api key vừa sinh (${apiKey}) trong /agentcredential/list`).toBeTruthy();
    const keyId = created.id;

    try {
      const { json: viewJson } = await apiPost(authedRequest, "/agentcredential/view", { id: keyId });
      expect(viewJson.status).toBe("success");
      expect(viewJson.data.apiKey).toBe(apiKey);

      const { json: updateJson } = await apiPost(authedRequest, "/agentcredential/update", {
        id: keyId,
        callbackUrl: "https://example.com/qa-callback-updated",
        ipAddress: "5.6.7.8",
        status: 1,
      });
      expect(updateJson.status).toBe("success");

      const { json: viewAfterUpdate } = await apiPost(authedRequest, "/agentcredential/view", {
        id: keyId,
      });
      expect(viewAfterUpdate.data.callbackUrl).toBe("https://example.com/qa-callback-updated");
    } finally {
      // Cleanup - deactivate api key vừa tạo, không để lại credential "active" thừa trên DB dev
      const { json: deactivateJson } = await apiPost(authedRequest, "/agentcredential/update_status", {
        id: keyId,
        agentId,
        status: 0,
      });
      expect(deactivateJson.status).toBe("success");

      const { json: viewAfterDeactivate } = await apiPost(authedRequest, "/agentcredential/view", {
        id: keyId,
      });
      expect(viewAfterDeactivate.data.status).toBe(0);
    }
  });
});
