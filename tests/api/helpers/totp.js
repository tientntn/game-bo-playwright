const crypto = require("crypto");

// Cài đặt TOTP (RFC 6238) thuần JS, không cần thêm package ngoài - dùng để tự vượt qua bước
// xác thực OTP (SecurityCheckpointType.SessionVerify) trong tests/api/fixtures.js.
function base32Decode(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = base32.toUpperCase().replace(/=+$/, "");

  let bits = "";
  for (const char of cleaned) {
    const value = alphabet.indexOf(char);
    if (value === -1) continue;
    bits += value.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotp(secret, { timeStep = 30, digits = 6 } = {}) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / timeStep);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, "0");
}

module.exports = { generateTotp };
