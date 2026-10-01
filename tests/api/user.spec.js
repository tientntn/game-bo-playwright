// Test cho UserController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\UserController.cs)
// Toàn bộ dữ liệu do test tạo ra đều được dọn dẹp bằng update-user-status (không có API xoá
// cứng user) vì DB dev đang dùng chung với team - không được để lại rác vĩnh viễn.
const { test, expect, loginAs, apiBaseURL } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

// uniqueSuffix() thường dài tới 16 ký tự - cộng thêm prefix sẽ vượt quá giới hạn 20 ký tự
// của Username (xem LoginRequestValidator.cs .Length(2, 20)), dù /user/create cho phép tới 50
// ký tự. Chỉ dùng hàm này cho username sẽ đem đi login lại (/auth/login) - nén timestamp về
// base36 để rút ngắn nhưng vẫn đủ duy nhất giữa các lần chạy test.
function uniqueUsername(prefix) {
  const compactSuffix =
    Date.now().toString(36) + Math.floor(Math.random() * 36 ** 3).toString(36);
  return `${prefix}${compactSuffix}`;
}

test.describe("User API - /user/list", () => {
  test("lists users with pagination envelope", async ({ authedRequest }) => {
    const { response, json } = await apiPost(authedRequest, "/user/list", {
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

test.describe("User API - /user/details", () => {
  test("returns the current logged-in user's own details", async ({ authedRequest, authInfo }) => {
    const { json } = await apiPost(authedRequest, "/user/details", {});

    expect(json.status).toBe("success");
    expect(json.data.id).toBe(authInfo.userId);
    expect(typeof json.data.permission).toBe("object");
  });
});

test.describe("User API - /user/details_by_id", () => {
  test("returns details for a given user id", async ({ authedRequest, authInfo }) => {
    const { json } = await apiPost(authedRequest, "/user/details_by_id", {
      id: authInfo.userId,
    });

    expect(json.status).toBe("success");
    expect(json.data.id).toBe(authInfo.userId);
  });
});

test.describe("User API - hierarchy/dropdown endpoints (known issues)", () => {
  // KNOWN ISSUE (backend): 4 endpoint dưới đây đều trả UNKNOWN_ERROR trên DB dev hiện tại, dù
  // request body đủ field bắt buộc theo handler. Đã thử lại nhiều lần với các filter khác nhau,
  // lỗi lặp lại - không phải may rủi. Các test này CỐ TÌNH để fail đỏ - không dùng test.fail() -
  // để nhắc backend xử lý mỗi lần chạy suite, cho tới khi bug được fix.
  test("lists role dropdown by hierarchy", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/user/dropdown_role_by_hierarchy", {
      page: 1,
      pageSize: 10,
      filters: { sasEntityHierarchyId: 1 },
    });
    expect(json.status).toBe("success");
  });

  test("lists user dropdown", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/user/dropdown_user_list", {
      page: 1,
      pageSize: 10,
      filters: {},
    });
    expect(json.status).toBe("success");
  });

  test("lists user dropdown by hierarchy", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/user/dropdown_user_by_hierarchy", {
      page: 1,
      pageSize: 10,
      filters: { sasEntityHierarchyId: 1 },
    });
    expect(json.status).toBe("success");
  });

  test("lists users by hierarchy level", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/user/listhierarchy", {
      page: 1,
      pageSize: 10,
      filters: { sasEntityHierarchyId: [1] },
    });
    expect(json.status).toBe("success");
  });
});

test.describe("User API - /user/validate/username", () => {
  test("reports an existing username as taken", async ({
    authedRequest,
    authInfo,
  }) => {
    const { json } = await apiPost(authedRequest, "/user/validate/username", {
      username: process.env.API_USERNAME,
      sasEntityId: authInfo.sasEntityId,
    });

    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("USERNAME_ALREADY_EXISTS");
  });

  test("reports a fresh username as available", async ({
    authedRequest,
    authInfo,
  }) => {
    const { json } = await apiPost(authedRequest, "/user/validate/username", {
      username: `qa_free_${uniqueSuffix()}`,
      sasEntityId: authInfo.sasEntityId,
    });

    expect(json.status).toBe("success");
  });
});

test.describe("User API - full lifecycle", () => {
  test("creates, views, updates and deactivates a user", async ({
    authedRequest,
    authInfo,
  }) => {
    // 1. Lấy 1 role hợp lệ để gán cho user mới, tránh hard-code roleId có thể không tồn tại
    const { json: roleDropdown } = await apiPost(
      authedRequest,
      "/user/dropdown_role_list",
      {},
    );
    expect(roleDropdown.status).toBe("success");
    expect(roleDropdown.data.length).toBeGreaterThan(0);
    const roleId = roleDropdown.data[0].id;

    const suffix = uniqueSuffix();
    const username = `qa_user_${suffix}`;

    // 2. Create
    const { json: createJson } = await apiPost(authedRequest, "/user/create", {
      sasEntityId: authInfo.sasEntityId,
      name: "QA Automation User",
      username,
      password: "Admin@123",
      email: `${username}@example.com`,
      phoneCode: "84",
      phoneNumber: "978122944",
      forceUpdatePassword: false,
      roleIds: [roleId],
      status: 1,
    });

    expect(createJson.status).toBe("success");
    expect(createJson.messageCode).toBe("CREATE_USER_SUCCESS");
    const userId = createJson.data.id;
    expect(userId).toBeTruthy();

    try {
      // 3. View - xác nhận dữ liệu vừa tạo
      const { json: viewJson } = await apiPost(authedRequest, "/user/view", {
        id: userId,
      });
      expect(viewJson.status).toBe("success");
      expect(viewJson.data.username).toBe(username);
      expect(viewJson.data.status).toBe(1); // 1 = Active

      // 4. Update
      const updatedName = "QA Automation User Updated";
      const { json: updateJson } = await apiPost(
        authedRequest,
        "/user/update",
        {
          id: userId,
          sasEntityId: authInfo.sasEntityId,
          name: updatedName,
          email: viewJson.data.email,
          phoneCode: viewJson.data.phoneCode,
          phoneNumber: viewJson.data.phoneNumber,
          roleIds: [roleId],
          status: 1,
        },
      );
      expect(updateJson.status).toBe("success");
      expect(updateJson.messageCode).toBe("UPDATE_USER_SUCCESS");

      // 5. View lại - xác nhận update phản ánh đúng
      const { json: viewAfterUpdate } = await apiPost(
        authedRequest,
        "/user/view",
        { id: userId },
      );
      expect(viewAfterUpdate.data.name).toBe(updatedName);
    } finally {
      // 6. Cleanup - deactivate user vừa tạo để không để lại tài khoản "active" thừa trên DB dev
      const { json: deactivateJson } = await apiPost(
        authedRequest,
        "/user/update-user-status",
        {
          ids: [userId],
          status: 0,
        },
      );
      expect(deactivateJson.status).toBe("success");

      const { json: viewAfterDeactivate } = await apiPost(
        authedRequest,
        "/user/view",
        { id: userId },
      );
      expect(viewAfterDeactivate.data.status).toBe(0); // 0 = Inactive
    }
  });

  test("rejects creating a user with a username that already exists", async ({
    authedRequest,
    authInfo,
  }) => {
    const { json: roleDropdown } = await apiPost(
      authedRequest,
      "/user/dropdown_role_list",
      {},
    );
    const roleId = roleDropdown.data[0].id;

    const { json } = await apiPost(authedRequest, "/user/create", {
      sasEntityId: authInfo.sasEntityId,
      name: "QA Duplicate User",
      username: process.env.API_USERNAME, // đã tồn tại
      password: "Admin@123",
      email: "qa_duplicate@example.com",
      forceUpdatePassword: false,
      roleIds: [roleId],
      status: 1,
    });

    expect(json.status).toBe("fail");
    expect(json.messageCode).not.toBe("VALIDATION_FAILED");
  });
});

test.describe("User API - Google OTP bind/unbind/verify + admin password reset", () => {
  // Test trên 1 user rời rạc tự tạo (không phải tài khoản đang đăng nhập) - an toàn vì không
  // đụng tới 2FA/mật khẩu thật của chính tài khoản test.
  //
  // Phát hiện: user/bind-google-otp chỉ sinh 1 secret Google Authenticator MỚI ở phía server
  // (BindedGoogleOtp vẫn = false) mà KHÔNG trả secret đó về response - nghĩa là không có cách
  // nào lấy được secret để tính mã OTP hợp lệ và hoàn tất việc bind qua API. Vì vậy
  // unbind-google-otp/reset-two-factory gọi sau đó LUÔN trả "USER_OTP_UNBINDED" (đúng theo logic
  // ứng dụng, không phải bug) - đây là hành vi thực tế đã verify, không phải giả định.
  test("binds a Google OTP secret then reflects the not-yet-verified state on unbind/reset", async ({
    authedRequest,
    authInfo,
  }) => {
    const { json: roleDropdown } = await apiPost(authedRequest, "/user/dropdown_role_list", {});
    const roleId = roleDropdown.data[0].id;

    const suffix = uniqueSuffix();
    const username = `qa_2fa_${suffix}`;
    const { json: createJson } = await apiPost(authedRequest, "/user/create", {
      sasEntityId: authInfo.sasEntityId,
      name: "QA 2FA Test User",
      username,
      password: "Admin@123",
      forceUpdatePassword: false,
      roleIds: [roleId],
      status: 1,
    });
    expect(createJson.status).toBe("success");
    const userId = createJson.data.id;

    try {
      const { json: bindJson } = await apiPost(authedRequest, "/user/bind-google-otp", {
        id: userId,
      });
      expect(bindJson.status).toBe("success");

      const { json: unbindJson } = await apiPost(authedRequest, "/user/unbind-google-otp", {
        id: userId,
      });
      expect(unbindJson.status).toBe("fail");
      expect(unbindJson.messageCode).toBe("USER_OTP_UNBINDED");

      const { json: resetTwoFactoryJson } = await apiPost(authedRequest, "/user/reset-two-factory", {
        id: userId,
      });
      expect(resetTwoFactoryJson.status).toBe("fail");
      expect(resetTwoFactoryJson.messageCode).toBe("USER_OTP_UNBINDED");

      const { json: resetPasswordJson } = await apiPost(authedRequest, "/user/reset-password", {
        entityUserId: userId,
        newPassword: "Admin@1234",
        forceUpdatePassword: false,
      });
      expect(resetPasswordJson.status).toBe("success");
    } finally {
      const { json: deactivateJson } = await apiPost(authedRequest, "/user/update-user-status", {
        ids: [userId],
        status: 0,
      });
      expect(deactivateJson.status).toBe("success");
    }
  });
});

test.describe("User API - self-service password endpoints (change-password, user-reset-password)", () => {
  // Cả 2 endpoint này đều thao tác trên CHÍNH session đang gọi (không nhận field "id"/entityUserId
  // - xem ChangePasswordHandler.cs dùng request.GetUserId(), UserResetPasswordHandler.cs cũng vậy)
  // - khác với /user/reset-password (nhận entityUserId, đã test ở describe "Google OTP" phía
  // trên). Vì vậy KHÔNG được gọi bằng session của chính tài khoản test (API_USERNAME) - sẽ đổi
  // mất mật khẩu dùng để login mọi test khác. Thay vào đó, test tạo 1 user rời rạc, TỰ LOGIN
  // bằng chính user đó (session độc lập, không dùng chung token với authedRequest), rồi mới gọi
  // change-password/user-reset-password trên session đó - an toàn vì không đụng tới tài khoản
  // test chính, và user rời rạc này bị deactivate ở cuối test.
  test("changes then resets a disposable user's own password via their own session", async ({
    authedRequest,
    authInfo,
    playwright,
  }) => {
    const { json: roleDropdown } = await apiPost(authedRequest, "/user/dropdown_role_list", {});
    test.skip(roleDropdown.data.length === 0, "Không có role nào trên DB dev để gán cho user mới");
    const roleId = roleDropdown.data[0].id;

    const username = uniqueUsername("qa_pwd_");
    const initialPassword = "Admin@123";

    const { json: createJson } = await apiPost(authedRequest, "/user/create", {
      sasEntityId: authInfo.sasEntityId,
      name: "QA Password Test User",
      username,
      password: initialPassword,
      forceUpdatePassword: false,
      roleIds: [roleId],
      status: 1,
    });
    expect(createJson.status).toBe("success");
    const userId = createJson.data.id;

    // Context "bootstrap" KHÔNG mang theo Authorization header nào - dùng riêng để login (mỗi
    // request.newContext() ở đây độc lập với authedRequest, không đụng tới token của admin).
    const bootstrap = await playwright.request.newContext({ baseURL: apiBaseURL });

    try {
      // 1. Login bằng chính user rời rạc này - session RIÊNG, không ảnh hưởng authedRequest
      const disposableUserSession = await loginAs(bootstrap, {
        loginCode: process.env.API_LOGIN_CODE,
        username,
        password: initialPassword,
      });
      const disposableUserRequest = await playwright.request.newContext({
        baseURL: apiBaseURL,
        extraHTTPHeaders: { Authorization: `Bearer ${disposableUserSession.token}` },
      });

      // 2. change-password trên chính session vừa login (đổi initialPassword -> changedPassword)
      const changedPassword = "Admin@1234";
      const { json: changeJson } = await apiPost(disposableUserRequest, "/user/change-password", {
        oldPassword: initialPassword,
        newPassword: changedPassword,
        confirmPassword: changedPassword,
      });
      expect(changeJson.status).toBe("success");
      await disposableUserRequest.dispose();

      // 3. Xác nhận mật khẩu đã đổi bằng cách login lại với mật khẩu mới
      const afterChangeSession = await loginAs(bootstrap, {
        loginCode: process.env.API_LOGIN_CODE,
        username,
        password: changedPassword,
      });
      expect(afterChangeSession.token).toBeTruthy();

      // 4. user-reset-password trên session MỚI vừa login lại (tự đặt lại mật khẩu của chính mình
      // lần nữa, đổi changedPassword -> resetPassword)
      const afterChangeRequest = await playwright.request.newContext({
        baseURL: apiBaseURL,
        extraHTTPHeaders: { Authorization: `Bearer ${afterChangeSession.token}` },
      });
      const resetPassword = "Admin@12345";
      const { json: resetJson } = await apiPost(afterChangeRequest, "/user/user-reset-password", {
        newPassword: resetPassword,
        forceUpdatePassword: false,
      });
      expect(resetJson.status).toBe("success");
      await afterChangeRequest.dispose();

      // 5. Xác nhận lần cuối bằng cách login lại với mật khẩu vừa reset
      const finalSession = await loginAs(bootstrap, {
        loginCode: process.env.API_LOGIN_CODE,
        username,
        password: resetPassword,
      });
      expect(finalSession.token).toBeTruthy();
    } finally {
      await bootstrap.dispose();
      // Cleanup - deactivate user rời rạc, dùng session admin (authedRequest), không phải session
      // của chính user đó (đã có thể bị vô hiệu hoá bởi các lần login lại ở trên).
      const { json: deactivateJson } = await apiPost(authedRequest, "/user/update-user-status", {
        ids: [userId],
        status: 0,
      });
      expect(deactivateJson.status).toBe("success");
    }
  });
});

test.describe("User API - /user/verify-google-otp (self session, not a target user)", () => {
  test("rejects an incorrect OTP code", async ({ authedRequest }) => {
    // Khác với bind/unbind/reset-two-factory ở trên (nhận "id" của user mục tiêu),
    // verify-google-otp lại thao tác trên CHÍNH session đang đăng nhập (không có field "id") -
    // đã verify qua thực tế, không phải giả định.
    const { json } = await apiPost(authedRequest, "/user/verify-google-otp", { otp: "000000" });

    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("INCORRECT_GOOGLE_OTP");
  });
});
