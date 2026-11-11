# Cờ RUN_FULL_TESTS - bật/tắt test tạo dữ liệu

Dành cho agent / người viết spec mới trong project này. Đọc file này trước khi viết bất kỳ test nào **ghi dữ liệu thật** (tạo / sửa / xoá bản ghi) lên môi trường dev.

## Mục đích

Có 1 cờ trong `.env` để chọn chế độ chạy:

| `RUN_FULL_TESTS` | Hành vi |
|---|---|
| `false` (mặc định) | Chỉ chạy test **không tạo dữ liệu**. Test submit tạo / sửa bản ghi bị **skip**, không sinh dữ liệu rác. |
| `true` | Chạy **full**, gồm cả test submit tạo bản ghi QA (và dọn dẹp). |

Mục tiêu: chạy test thường ngày không để lại rác trên dev; chỉ bật `true` khi thật sự muốn kiểm tra luồng tạo dữ liệu.

## File liên quan

- `.env` - dòng `RUN_FULL_TESTS=false` (đã có kèm chú thích). `playwright.config.js` tự nạp `.env` bằng dotenv, worker kế thừa biến môi trường.
- `tests/helpers/flags.js` - đọc cờ và export:
  - `RUN_FULL_TESTS` (boolean)
  - `SKIP_WRITE_REASON` (chuỗi lý do skip dùng chung: "Test tạo dữ liệu - đặt RUN_FULL_TESTS=true trong .env để chạy")
- `.env_example` - đã có dòng `RUN_FULL_TESTS` cho người clone project.

### Quy tắc đọc giá trị (trong `flags.js`)

- Bật khi giá trị là `true` hoặc `1` (không phân biệt hoa thường, bỏ khoảng trắng).
- Mọi giá trị khác, để trống hoặc không khai báo -> **TẮT**. Quên khai báo thì vẫn an toàn.

```js
const RUN_FULL_TESTS = /^(1|true)$/i.test(String(process.env.RUN_FULL_TESTS ?? "").trim());
```

## Cách dùng trong spec

```js
const { RUN_FULL_TESTS, SKIP_WRITE_REASON } = require("./helpers/flags");

// Skip cả 1 nhóm test ghi dữ liệu
test.describe("Tạo game thật và dọn dẹp (cần RUN_FULL_TESTS=true)", () => {
  test.skip(!RUN_FULL_TESTS, SKIP_WRITE_REASON);
  // ... test submit tạo bản ghi QA, test dọn dẹp ...
});

// Hoặc skip riêng 1 test
test("Submit tạo X", async ({ page }) => {
  test.skip(!RUN_FULL_TESTS, SKIP_WRITE_REASON);
  // ...
});
```

Với spec nằm trong thư mục con (vd `tests/api/`), chỉnh lại đường dẫn require cho đúng (`../helpers/flags`).

## Quy ước cho test ghi dữ liệu

1. **Phải gắn cờ**: mọi test thật sự submit tạo / sửa / xoá bản ghi đều `test.skip(!RUN_FULL_TESTS, SKIP_WRITE_REASON)`.
2. **Test không ghi dữ liệu thì KHÔNG skip**: validate form rỗng, mở hộp thoại rồi Cancel, điều hướng, lọc, phân trang... vẫn chạy ở chế độ `false`.
3. **Chỉ làm toàn quyền với bản ghi QA do chính test tạo**: đặt tên / code có tiền tố nhận diện (vd game `QA-<số>` / code `QA_<số>`; currency `QAUI...`) và có hàm kiểm tra kiểu `isQaGame(g)` trước khi sửa / xoá. **Không đụng bản ghi có sẵn.**
4. **Dọn dẹp** bản ghi QA sau test: xoá nếu hệ thống cho phép, nếu không thì Deactivate (hoặc ghi chú trong comment đầu file rằng không dọn được).
5. **Kiểm chứng ở cả 2 chế độ** trước khi báo xong:
   - `true`: test tạo dữ liệu pass.
   - `false`: các test đó hiện `skipped` (không fail) và không gửi request ghi nào.
6. Ghi rõ quy tắc cờ ở comment đầu file spec.

## Cách chạy

node KHÔNG nằm trên PATH. Dùng `C:\laragon\bin\nodejs\node-v22` (thêm vào PATH cho phiên chạy).

PowerShell:

```powershell
$env:Path = "C:\laragon\bin\nodejs\node-v22;" + $env:Path

# Chế độ an toàn (dùng giá trị trong .env, mặc định false)
npx playwright test tests/game_list.spec.js --project=setup --project=chromium

# Chạy full, ghi đè nhanh không cần sửa .env
$env:RUN_FULL_TESTS = "true"
npx playwright test tests/game_list.spec.js --project=setup --project=chromium -g "Tạo game"
Remove-Item Env:RUN_FULL_TESTS   # bỏ ghi đè để lần sau lại theo .env
```

Biến môi trường của shell **ưu tiên hơn** `.env` (dotenv không ghi đè biến đã có), nên ghi đè bằng `$env:` luôn thắng.

## Trạng thái áp dụng

| Spec | Đã gắn cờ? |
|---|---|
| `tests/game_list.spec.js` (nhóm "Tạo game thật và dọn dẹp") | Có (agent playwright đang hoàn thiện) |
| `tests/game_recommendation_group.spec.js` (nhóm "Tạo / sửa / xoá nhóm QA thật") | Có |
| Các spec khác có ghi dữ liệu (vd `admin_currency.spec.js` describe "CRUD", user / roles / entity...) | **Chưa** - vẫn chạy bất kể cờ. Cần rà soát và gắn cờ nếu muốn `false` = hoàn toàn không tạo dữ liệu. |

## Lưu ý

- Cờ này **độc lập** với `RUN_DANGEROUS_TESTS` (chỉ cho `tests/api/dangerous.spec.js`: rác vĩnh viễn / side-effect hệ thống ngoài). Không dùng lẫn.
- Đừng đọc / in giá trị trong `.env` ra log hay báo cáo vì file chứa thông tin đăng nhập; chỉ thêm / sửa đúng dòng cờ.
- Không để file tạm (ảnh chụp...) trong thư mục project; dùng thư mục scratchpad / temp.
