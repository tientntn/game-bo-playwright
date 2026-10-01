// Test cho AuthController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\AuthController.cs)
// File này KHÔNG dùng fixtures.js/authedRequest dùng chung, vì mỗi test tự login/logout
// độc lập - tránh làm hỏng token của các file test khác chạy song song (đặc biệt là test logout).
const { test, expect } = require("@playwright/test");
const { apiPost, genTraceId, API_PATH } = require("./helpers/api-client");
const { generateTotp } = require("./helpers/totp");

const VALID_CREDENTIALS = {
  loginCode: process.env.API_LOGIN_CODE,
  username: process.env.API_USERNAME,
  password: process.env.API_PASSWORD,
};

test.describe("Auth API - /auth/login", () => {
  test("login succeeds with valid credentials", async ({ request }) => {
    const { response, json } = await apiPost(request, "/auth/login", VALID_CREDENTIALS);

    expect(response.status()).toBe(200);
    expect(json.status).toBe("success");
    expect(json.messageCode).toBe("LOGIN_SUCCESS");
    expect(json.data.token).toBeTruthy();
    expect(json.data.refreshToken).toBeTruthy();
    expect(json.data.sasEntity).toBeTruthy();
  });

  test("login fails with incorrect password", async ({ request }) => {
    const { json } = await apiPost(request, "/auth/login", {
      ...VALID_CREDENTIALS,
      password: "WrongPassword123",
    });

    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("UNAUTHORIZED_USER");
  });

  test("login fails with incorrect username", async ({ request }) => {
    const { json } = await apiPost(request, "/auth/login", {
      ...VALID_CREDENTIALS,
      username: "no_such_user",
    });

    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("UNAUTHORIZED_USER");
  });

  test("login fails with incorrect login code", async ({ request }) => {
    const { json } = await apiPost(request, "/auth/login", {
      ...VALID_CREDENTIALS,
      loginCode: "no_such_entity",
    });

    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("UNAUTHORIZED_USER");
  });

  test("login fails validation when username is empty", async ({ request }) => {
    const { json } = await apiPost(request, "/auth/login", {
      ...VALID_CREDENTIALS,
      username: "",
    });

    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("VALIDATION_FAILED");
    expect(json.validation.Username).toBeTruthy();
  });

  test("returns HTTP 400 when traceId is missing from the body", async ({ request }) => {
    // traceId là "required" property ở tầng C#, thiếu hẳn field (khác với null/rỗng)
    // sẽ bị model binding chặn trước khi vào validator, trả JSON Problem Details thay vì BaseResponse.
    const response = await request.post(`${API_PATH}/auth/login`, {
      data: VALID_CREDENTIALS,
    });

    expect(response.status()).toBe(400);
  });
});

test.describe("Auth API - /auth/logout", () => {
  test("logout invalidates the current session token", async ({ request }) => {
    const { json: loginJson } = await apiPost(request, "/auth/login", VALID_CREDENTIALS);
    const token = loginJson.data.token;

    const logoutResponse = await request.post(`${API_PATH}/auth/logout`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { traceId: genTraceId() },
    });
    const logoutJson = await logoutResponse.json();
    expect(logoutJson.status).toBe("success");

    // Token vừa logout phải bị vô hiệu hoá ngay lập tức cho các API cần Session
    const afterLogout = await request.post(`${API_PATH}/user/list`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { traceId: genTraceId(), page: 1, pageSize: 5, filters: {} },
    });
    const afterLogoutJson = await afterLogout.json();

    expect(afterLogoutJson.status).toBe("fail");
    expect(afterLogoutJson.messageCode).toBe("UNAUTHORIZED_USER");
  });
});

test.describe("Auth API - /auth/verify_otp_password", () => {
  // Endpoint này CHỈ xác thực password+OTP của CHÍNH session đang gọi (xem
  // VerifyOtpPasswordHandler.cs - dùng request.GetUserId(), không ghi/đổi gì, không invalidate
  // session) - an toàn để test trực tiếp trên tài khoản test chính, khác hẳn change-password/
  // user-reset-password (2 endpoint đó THẬT SỰ đổi mật khẩu, xem describe riêng ở user.spec.js
  // dùng user rời rạc). Cần gọi generateOtp trước để có secret mới nhất tính OTP đúng - xem ghi
  // chú an toàn "rebind" ở đầu fixtures.js, áp dụng y hệt ở đây.
  async function loginAndAuthedContext(playwright) {
    const bootstrap = await playwright.request.newContext({ baseURL: process.env.API_BASE_URL });
    const { json: loginJson } = await apiPost(bootstrap, "/auth/login", VALID_CREDENTIALS);
    await bootstrap.dispose();

    return playwright.request.newContext({
      baseURL: process.env.API_BASE_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${loginJson.data.token}` },
    });
  }

  test("verifies the correct password and a fresh TOTP code", async ({ playwright }) => {
    const authedContext = await loginAndAuthedContext(playwright);

    const { json: generateJson } = await apiPost(authedContext, "/auth/generateOtp", {});
    expect(generateJson.status).toBe("success");
    const otp = generateTotp(generateJson.data.secret);

    const { json } = await apiPost(authedContext, "/auth/verify_otp_password", {
      password: VALID_CREDENTIALS.password,
      otp,
    });
    expect(json.status).toBe("success");

    await authedContext.dispose();
  });

  test("rejects an incorrect OTP code", async ({ playwright }) => {
    const authedContext = await loginAndAuthedContext(playwright);

    const { json } = await apiPost(authedContext, "/auth/verify_otp_password", {
      password: VALID_CREDENTIALS.password,
      otp: "000000",
    });
    expect(json.status).toBe("fail");
    expect(json.messageCode).toBe("INCORRECT_GOOGLE_OTP");

    await authedContext.dispose();
  });

  test("rejects an incorrect password", async ({ playwright }) => {
    const authedContext = await loginAndAuthedContext(playwright);

    const { json: generateJson } = await apiPost(authedContext, "/auth/generateOtp", {});
    const otp = generateTotp(generateJson.data.secret);

    const { json } = await apiPost(authedContext, "/auth/verify_otp_password", {
      password: "WrongPassword123",
      otp,
    });
    expect(json.status).toBe("fail");
    // VerifyOtpPasswordHandler.cs throws LoginIncorrectPasswordException("INCORRECT_PASSWORD"),
    // nhưng đó chỉ là Exception.Message nội bộ - ExceptionMiddleware.cs map TYPE exception này
    // sang Errors.Authentication.LoginIncorrectPassword, messageCode thực tế trả về là
    // "UNAUTHORIZED_USER" (đã verify qua chạy thật, không phải giả định từ tên exception).
    expect(json.messageCode).toBe("UNAUTHORIZED_USER");

    await authedContext.dispose();
  });
});

test.describe("Auth API - /auth/refresh-token", () => {
  // KNOWN LIMITATION (permission seed gap, không phải bug logic): tài khoản superadmin/tienadmin
  // trên DB dev hiện tại bị trả NOT_PERMISSION khi gọi refresh-token - role ADMIN_1 có thể đang
  // thiếu permission mapping cho action này, giống download/file, action-ack/status,
  // geofencing/ip-restrict-view. Test assert đúng messageCode quan sát được, để sau dễ check khi
  // nào permission seed được sửa (lúc đó test này sẽ tự fail để nhắc đổi lại expectation).
  test("rejects refresh token without the required permission", async ({ request }) => {
    const { json: loginJson } = await apiPost(request, "/auth/login", VALID_CREDENTIALS);

    const refreshResponse = await request.post(`${API_PATH}/auth/refresh-token`, {
      headers: { Authorization: `Bearer ${loginJson.data.token}` },
      data: { traceId: genTraceId(), refreshToken: loginJson.data.refreshToken },
    });
    const refreshJson = await refreshResponse.json();

    expect(refreshJson.status).toBe("fail");
    expect(refreshJson.messageCode).toBe("NOT_PERMISSION");
  });
});
