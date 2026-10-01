const base = require("@playwright/test");
const { apiPost, REQUEST_TIMEOUT_MS } = require("./helpers/api-client");
const { generateTotp } = require("./helpers/totp");

const apiBaseURL = process.env.API_BASE_URL || "http://127.0.0.1:5000";

// QUAN TRỌNG: backend chỉ cho phép 1 session hoạt động / tài khoản - mỗi lần login mới
// sẽ tự động vô hiệu hoá MỌI session cũ của user đó (xem is_logout/is_deleted trong
// SasEntityUserAuthenticationLogCommandRepository.UpdateUserLoginStatus). Vì vậy KHÔNG
// được login 1 lần rồi dùng chung token cho nhiều test chạy song song - test nào login
// sau sẽ âm thầm phá session của test khác. Thay vào đó mỗi test tự login riêng ngay
// trước khi dùng, và suite này phải chạy với --workers=1 (xem package.json) để đảm bảo
// không có 2 lần login nào diễn ra cùng lúc.
async function loginAs(request, { loginCode, username, password }) {
  const { json } = await apiPost(request, "/auth/login", {
    loginCode,
    username,
    password,
  });

  if (json.status !== "success") {
    throw new Error(`API login failed: ${json.messageCode} - ${json.message}`);
  }

  return {
    token: json.data.token,
    refreshToken: json.data.refreshToken,
    userId: json.data.id,
    sasEntityId: json.data.sasEntity.id,
    sasEntityHierarchyId: json.data.sasEntity.sasEntityHierarchyId,
  };
}

async function login(request) {
  return loginAs(request, {
    loginCode: process.env.API_LOGIN_CODE,
    username: process.env.API_USERNAME,
    password: process.env.API_PASSWORD,
  });
}

// Hoàn thành bước xác thực OTP (SecurityCheckpointType.SessionVerify) cho 1 session đã login,
// để mở khoá các endpoint như game/create, dropdown/currency, timezone/list, download/*, ...
//
// Ưu tiên dùng API_OTP_SECRET trong .env (secret cố định, capture 1 lần) để tự tính OTP tại chỗ,
// KHÔNG gọi /auth/generateOtp nữa - tách test khỏi hành vi của route đó (route này trả lại đúng
// secret hiện có cho session đã login, bất kể tài khoản đã bind OTP hay chưa, xem GenerateOtpHandler.cs
// - đã báo cho team BE như 1 lỗ hổng cần fix; khi fix chắc chắn sẽ thắt lại điều kiện của route này,
// nên test không nên phụ thuộc vào nó nữa). Chỉ khi KHÔNG có API_OTP_SECRET (vd lần đầu setup, hoặc
// sau khi tài khoản bị Reset2Factory - reset thật, secret đổi) mới fallback gọi generateOtp như cũ.
async function verifyOtpSession(context) {
  let secret = process.env.API_OTP_SECRET;

  if (!secret) {
    const { json: generateJson } = await apiPost(context, "/auth/generateOtp", {});
    if (generateJson.status !== "success") {
      throw new Error(`generateOtp failed: ${generateJson.messageCode} - ${generateJson.message}`);
    }
    secret = generateJson.data.secret;
  }

  const otp = generateTotp(secret);
  const { json: verifyJson } = await apiPost(context, "/auth/verifyOtp", { otp });
  if (verifyJson.status !== "success") {
    throw new Error(`verifyOtp failed: ${verifyJson.messageCode} - ${verifyJson.message}`);
  }
}

const test = base.test.extend({
  // Thông tin user đã đăng nhập (id, sasEntityId, ...) để build request body.
  // Tự login riêng cho từng test - xem giải thích ở trên.
  authInfo: async ({ playwright }, use) => {
    const bootstrap = await playwright.request.newContext({ baseURL: apiBaseURL ,
    timeout: REQUEST_TIMEOUT_MS, });
    const info = await login(bootstrap);
    await bootstrap.dispose();
    await use(info);
  },

  // APIRequestContext đã gắn sẵn header Authorization: Bearer <token> của session vừa login.
  // setDefaultTimeout đảm bảo giới hạn timeout 1 request (REQUEST_TIMEOUT_MS, xem api-client.js)
  // áp dụng luôn cho những chỗ gọi request.post/get trực tiếp (không qua apiPost) trong context này.
  authedRequest: async ({ playwright, authInfo }, use) => {
    const context = await playwright.request.newContext({
      baseURL: apiBaseURL,
      extraHTTPHeaders: {
        Authorization: `Bearer ${authInfo.token}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    await use(context);
    await context.dispose();
  },

  // Giống authedRequest, nhưng session đã hoàn thành xác thực OTP (SecurityCheckpointType.
  // SessionVerify) - dùng cho các test cần gọi endpoint yêu cầu 2FA. Xem ghi chú an toàn ở
  // verifyOtpSession() phía trên.
  verifiedRequest: async ({ playwright, authInfo }, use) => {
    const context = await playwright.request.newContext({
      baseURL: apiBaseURL,
      extraHTTPHeaders: {
        Authorization: `Bearer ${authInfo.token}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    await verifyOtpSession(context);
    await use(context);
    await context.dispose();
  },
});

module.exports = { test, expect: base.expect, loginAs, apiBaseURL };