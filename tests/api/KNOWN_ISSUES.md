# Known issues & test scope notes

Ghi nhận đầy đủ trong lúc xây dựng bộ test API cho backend BO API (trước đây tên project
`AlizeGames.BO.API`, đường dẫn `d:\Net\bo_backend\AlizeGames.BO.API\...`). Cập nhật file này
mỗi khi thêm test mới phát hiện vấn đề, thay vì viết dồn vào README.md.

## ⚠️ THAY ĐỔI MÔI TRƯỜNG LỚN (2026-08) - nhiều ghi chú cũ bên dưới có thể đã lỗi thời

1. **Backend đổi tên project**: `AlizeGames.BO.API`/`AlizeGames.BackOffice` → `GridPlay.BO.API`/
   `GridPlay.BackOffice`, đường dẫn giờ là `d:\Net\bo_backend\GridPlay.BO.API\...`. Mọi comment
   trong `tests/api/*.spec.js` trỏ tới đường dẫn `AlizeGames.BO.API` (ghi chú đầu mỗi file) đều là
   đường dẫn CŨ, chưa cập nhật lại - vẫn đúng về mặt logic/route, chỉ sai path tham chiếu.
2. **`.env` (`API_BASE_URL`) và `appsettings.Development.json` đã trỏ sang hạ tầng THẬT** thay vì
   local: `ConnectionStrings.Default` → RDS dev thật (`royal-edge-dev...`),
   `Grpc.Client.BetHistoryService.Uri` → `http://175.41.231.2:8916` (TRƯỚC ĐÂY thiếu hẳn key này,
   xem mục cũ về `NullReferenceException`/`InvalidOperationException` bên dưới - GIỜ ĐÃ CÓ),
   `WebClient.*` (GameReportSummaryService/PlayerReportQueryService/RetryCancelBetService/
   PromoReportServiceClient) → toàn bộ IP thật `175.41.231.2:<port>` (TRƯỚC ĐÂY là placeholder
   `.example.invalid`).
   **ĐÃ XÁC NHẬN qua curl trực tiếp (login+generateOtp+verifyOtp thủ công bằng bash/openssl, không
   cần `node`)**: phần lớn mục "Nghi vấn: service report/promo bên ngoài chưa cấu hình" cũ ĐÃ TỰ
   HẾT thật (dashboard/*, summary/game*, summary/fs-game*, promotion-summary-player-report/
   -player-detail-report, free_game_dropdown, player_dropdown) - xem mục đó bên dưới đã viết lại
   theo kết quả xác nhận, không còn là "nghi vấn" nữa. Một số route KHÁC vẫn lỗi thật (không phải do
   thiếu cấu hình chung, mà do chính route đó/RPC method đó có vấn đề ở phía service ngoài) - xem
   chi tiết trong cùng mục.
3. **Dữ liệu giờ là dữ liệu dev THẬT (lớn hơn nhiều)**, không phải DB local nhỏ/rỗng trước đây - hệ
   quả: query rộng (vd cả năm, không lọc status) có thể chậm/treo thay vì trả UNKNOWN_ERROR nhanh
   như trước. Đã gặp thật ở `bet_history/settled` (xem mục "Service report/promo bên ngoài" bên
   dưới) - cần rà soát lại các test dùng khoảng ngày rộng/thiếu filter tương tự nếu gặp timeout
   tương tự.
4. **Cách xác minh nhanh 1 endpoint mà không cần `node`/`npx`** (môi trường này không có sẵn): login
   + generateOtp + verifyOtp bằng `curl`/`base32`/`openssl` thuần bash (tự tính TOTP theo RFC 6238),
   cache token ra file để không phải login lại mỗi lần gọi (chỉ tự login lại khi cache chết/
   UNAUTHORIZED_USER). Script mẫu đã dùng để xác nhận toàn bộ mục dưới đây - xem lịch sử hội thoại
   nếu cần dựng lại.

## Tổng kết coverage

**Đã kiểm đếm lại chính xác từ `Endpoints.cs`** (nguồn đáng tin cậy hơn 1 file swagger snapshot cũ
có thể lệch theo thời gian): tổng cộng **201 route** khai báo. Trong đó **1 route
(`dropdown/agentcredential`, nhóm ApiKey) đã khai báo hằng số nhưng KHÔNG được wire vào bất kỳ
controller action nào** (`ApiKeyController.cs` không có `[HttpPost(Endpoints.ApiKey.DROPDOWN)]`,
và không có controller nào khác tham chiếu hằng số này) - gọi route này sẽ ra 404 (không khớp
route nào), không phải lỗi nghiệp vụ để test. Vì vậy **200 route thực sự tồn tại/gọi được**.

Trong 200 route thực đó: **191 route có test Playwright thật** (191 = 200 - 9 route cố tình không
test, xem danh sách bên dưới), tổng cộng **165 test** trong 33 file (`tests/api/*.spec.js`) - 1
test có thể cover nhiều route liên quan trong cùng 1 flow (vd đọc → ghi → đọc lại), nên số test ít
hơn số route được cover.

**Sửa chữa so với ghi chú "192/201" cũ**: con số đó đã SAI ở 2 chỗ - từng liệt `denomination/update`
và `denomination/upload` là "đã test" trong các mục bên dưới dù thực tế `denomination.spec.js`
chưa từng có test nào cho 2 route này (mâu thuẫn với chính comment đầu file `denomination.spec.js`
lúc đó, vốn nói đúng sự thật là chưa test). Đã viết bổ sung cả 2 test này (xem describe
`/denomination/update` và `/denomination/upload` trong file) sau khi đọc kỹ
`DenominationService.ViewList`/`Upload` xác nhận an toàn - không còn là gap nữa.

**9 endpoint (route thật, KHÔNG tính `dropdown/agentcredential` vì route đó không tồn tại) không
có test** - đã rà soát lại nhiều lần qua các đợt "viết toàn bộ api" liên tiếp, mỗi endpoint đều có
lý do cụ thể đã verify bằng cách đọc code, rơi vào đúng 3 nhóm rủi ro không thể giảm nhẹ bằng
pattern no-op/toggle-restore:

1. **Rác vĩnh viễn không xoá được**: `game/create`, `/create/v2` (không có API xoá game).
2. **Mất dữ liệu thật không đọc lại được để khôi phục**: `game/update`, `/update/v2`,
   `/update-paytable` (field ghi được mà response view không trả lại - viết là coi như xoá luôn
   giá trị cũ), `game/reset-default-paytable` (tạo paytable mới thay thế, không có API phục hồi).
3. **Side-effect hệ thống ngoài thật (tài chính/session)**: `game_round/update-status`,
   `operator_request/retry` (gọi thẳng hệ thống bet-history/thanh toán ngoài),
   `player/kick` (Kafka ngắt session player thật, không có API tạo player rời rạc để kick an toàn).

Xem chi tiết bằng chứng code cho từng endpoint ở mục "Giới hạn môi trường test khác" bên dưới.

**Cả 9 endpoint này ĐÃ CÓ test viết sẵn trong `tests/api/dangerous.spec.js`** - file riêng, mặc
định TOÀN BỘ skip khi chạy `npm run test:api` bình thường (không ảnh hưởng suite chính), chỉ chạy
khi chủ động set biến môi trường `RUN_DANGEROUS_TESTS=1` (3 endpoint nhóm side-effect hệ thống
ngoài còn cần thêm biến môi trường riêng trỏ tới 1 bản ghi thật do người chạy tự chọn - xem comment
đầu file). 6 endpoint nhóm 1-2 (`game/create*`, `game/update*`, `game/update-paytable`,
`game/reset-default-paytable`) test bằng cách tự tạo 1 game/paytable RIÊNG cho test rồi mới
update/reset trên chính bản ghi vừa tạo đó - vẫn để lại rác vĩnh viễn (rủi ro gốc không đổi) nhưng
không đụng tới dữ liệu thật của ai. 3 endpoint nhóm 3 (side-effect hệ thống ngoài) không thể giảm
nhẹ rủi ro theo cách đó - vẫn tác động thật khi bật.

**`dangerous.spec.js` còn có thêm 1 test thứ 10** (`agentcredential/generate_key`, `/update`,
`/update_status`) chuyển từ `apikey.spec.js` sang - cùng cơ chế bật/tắt, xem mục "Ảnh hưởng
consumer thật ngoài phạm vi test (FE)" ở "Giới hạn môi trường test khác" bên dưới.

## 2FA đã được tự động hoá

`tests/api/fixtures.js` có fixture **`verifiedRequest`** (bên cạnh `authedRequest`): tự gọi
`auth/generateOtp` để lấy secret TOTP mới, tự tính mã OTP bằng thuật toán RFC 6238 thuần JS
(`tests/api/helpers/totp.js`, không cần package ngoài), rồi gọi `auth/verifyOtp` - qua đó vượt
được `SecurityCheckpointType.SessionVerify` mà không cần Google Authenticator thật.

**Lưu ý an toàn quan trọng**: gọi `generateOtp` sẽ REBIND lại secret Google Authenticator của tài
khoản `API_USERNAME`. Việc này ĐÃ được xác nhận an toàn vì tài khoản test dùng RIÊNG cho test tự
động, không dùng chung với app Authenticator thật của ai khác trong team. Nếu đổi sang tài khoản
khác, phải xác nhận lại điều này trước khi dùng `verifiedRequest`.

Nhờ vậy, các endpoint trước đây bị coi là "không test được vì 2FA" (`timezone/list`,
`dropdown/language`, toàn bộ `download/*`, `action-ack/*`, `dropdown/currency`, `dashboard/*`,
`bet_history/*`, `summary/*`, `report/promotion-summary-*`) giờ ĐỀU gọi được - phần lớn hoá ra bị
chặn bởi lý do khác (xem 2 mục "Bug backend thật" và "Service report/promo bên ngoài" bên dưới),
không phải do 2FA.

## Pattern toggle+restore / no-op - áp dụng cho các endpoint ghi trên dữ liệu thật dùng chung

Với các endpoint mà request chỉ ghi lại đúng field mà response view/list cũng trả về (nên đọc
được để verify + khôi phục), test luôn theo khuôn: đọc giá trị hiện tại → đổi → verify đã đổi →
khôi phục lại đúng giá trị cũ trong `finally` (kể cả khi assertion ở giữa fail). Đã áp dụng cho:

- `house/update-status`, `masteragent/update-status`, `agent/update-status`, `player/update-status`,
  `game/update-status/v2`, `game/set-maintenance`, `agentgamecurrency/update_status`,
  `game/game_category/update_status`, `alertreport/unflag` (skip có điều kiện - xem dưới)
- `house/update`, `masteragent/update`, `agent/update`, `denomination/update`,
  `game/game_category/update`, `gamesetting/add_or_update` (no-op: ghi lại y hệt toàn bộ giá trị
  đọc được từ view, KHÔNG rút gọn/hard-code mảng)

**Điều kiện bắt buộc để áp dụng pattern này an toàn**: request phải KHÔNG có field ghi được nào mà
response view/list không trả lại giá trị hiện tại (nếu có, xem ví dụ phản chứng ở `game/update` -
mục "Giới hạn môi trường test khác" bên dưới, có field `Rows/Reels/Payline/ReleaseDate` không đọc
lại được nên KHÔNG áp dụng pattern này).

## Lỗi test đã sửa (không phải bug backend - phát hiện khi chạy thật lần đầu sau khi server sống lại)

- `auth/verify_otp_password` › "rejects an incorrect password": test cũ kỳ vọng messageCode
  `INCORRECT_PASSWORD` (suy ra từ chuỗi truyền vào constructor của `LoginIncorrectPasswordException`
  trong `VerifyOtpPasswordHandler.cs`), nhưng đó chỉ là `Exception.Message` nội bộ - đã đọc
  `ExceptionMiddleware.cs` và xác nhận qua chạy thật: middleware map TYPE exception này sang
  `Errors.Authentication.LoginIncorrectPassword`, messageCode thực tế là `UNAUTHORIZED_USER`. Đã
  sửa lại expectation.
- `agentcredential/check_api_exist`: test cũ giả định agent đầu tiên trong dropdown luôn CÓ sẵn
  api credential (`expect(status).toBe("success")`), nhưng endpoint trả `fail`/
  `AGENT_API_CREDENTIALS_NOT_FOUND` một cách HỢP LỆ khi agent chưa có key nào - không phải bug,
  chỉ là agent đầu tiên trong dropdown (ngẫu nhiên tuỳ dữ liệu DB dev) không có key. Đã sửa test
  chấp nhận cả 2 kết quả hợp lệ.
- `gamesetting/view` › "views game settings for an existing game": cùng loại lỗi test như
  `agentcredential/check_api_exist` ở trên - test cũ giả định game đầu tiên trong `/game/list/v2`
  luôn CÓ sẵn game setting (`expect(status).toBe("success")`), nhưng `GameSettingService.View`
  ném `GameSettingNotFoundException` (`GAME_SETTING_NOT_FOUND`) một cách HỢP LỆ khi game đó chưa
  từng được `add_or_update` lần nào (đã đọc `GameSettingService.cs` xác nhận: `AddOrUpdate` là
  upsert, tạo mới nếu chưa có) - không phải bug. Đã sửa test chấp nhận cả 2 kết quả hợp lệ; test
  `add_or_update` (no-op write-back) `test.skip` khi game đầu tiên chưa có setting, vì không có
  API xoá `GameSetting` nên không an toàn để tự tạo mới trên game thật dùng chung.

## CỤM lỗi UNKNOWN_ERROR mới phát hiện khi chạy thật lần đầu (server dev vừa khởi động lại)

Sau khi server dev được khởi động lại và chạy thật toàn bộ suite lần đầu, phát hiện 1 cụm endpoint
mới bị `UNKNOWN_ERROR` mà TRƯỚC ĐÂY (trong các lần chạy ở phiên làm việc trước) vẫn luôn ổn định -
đã verify bằng cách gọi trực tiếp (không qua Playwright) để loại trừ khả năng do code test, và lặp
lại ổn định qua nhiều lần gọi (không phải flaky):

`currency/list`, `game/list/v2`, `game/game_category/list`, `permission/manage/list`, `player/list`,
`rulesetting/list`, `agentgamecurrency/view`, `user/dropdown_role_list`,
`game/effective-turnover-exclusion/add`.

Trong khi đó các endpoint sau vẫn hoạt động BÌNH THƯỜNG (đã verify cùng lúc, cùng session, cùng
cách gọi) - CHỨNG MINH đây không phải lỗi toàn server mà là lỗi ở một cụm endpoint cụ thể:
`house/list`, `agent/list`, `user/list`, `role/list`, `masteragent/list`, `denomination/list`,
`dropdown/agent-filter`, `dropdown/game/effective-turnover-exclusion/available`.

**Đây rất có thể là hậu quả trực tiếp của việc khởi động lại server** (ví dụ: 1 phần dữ liệu/kết
nối chưa khởi tạo xong, cache/migration lỡ dở, hoặc 1 bug thật mới xuất hiện) - cần xem console/log
thật của server .NET lúc gọi các endpoint trên để thấy stack trace chính xác (client chỉ nhận được
message chung chung "Unknown Error"). Vì phần lớn test khác trong suite PHỤ THUỘC vào các endpoint
này để lấy id hợp lệ trước khi test tiếp (vd hầu hết describe trong `agentgamecurrency.spec.js`,
`currency.spec.js`, `game.spec.js`, `gamecategory.spec.js`, `permission.spec.js`, `player.spec.js`,
`rulesetting.spec.js`, `gamesetting.spec.js`, phần lớn `user.spec.js`), **rất nhiều trong số 70 test
fail ở lần chạy này chỉ là hệ quả DÂY CHUYỀN của đúng 9 endpoint trên, không phải 70 lỗi độc lập.**
Khi 9 endpoint này được backend fix, khả năng cao phần lớn 70 test fail sẽ tự pass lại - cần chạy
lại toàn bộ suite để xác nhận sau khi fix.

## Bug backend thật (test cố tình fail đỏ, không dùng `test.fail()`)

| File test | Endpoint | Hiện tượng |
|---|---|---|
| house.spec.js | `house/create` | `UNKNOWN_ERROR` |
| masteragent.spec.js | `masteragent/create` | `UNKNOWN_ERROR` |
| agent.spec.js | `agent/create` | `UNKNOWN_ERROR` |
| gamecategory.spec.js | `game/game_category/create` | `UNKNOWN_ERROR` |
| gameround.spec.js | `game_round/list` | `UNKNOWN_ERROR` - đã xác nhận qua curl KHÔNG phải do thiếu field: cùng gRPC `BetHistoryService` với `bet_history/settled` (đã fix, chạy tốt), nhưng RPC method `ListGameRound` cụ thể vẫn lỗi ở phía service ngoài (175.41.231.2:8916) |
| user.spec.js | `user/dropdown_role_by_hierarchy` | `UNKNOWN_ERROR` |
| user.spec.js | `user/dropdown_user_by_hierarchy` | `UNKNOWN_ERROR` |

**`geofencing.spec.js › country/list` KHÔNG còn trong bảng trên** - endpoint hiện không được dùng
ở app thật, nên test đã chuyển sang `test.skip` thay vì tiếp tục cố tình đỏ. **Nguyên nhân giờ đã
XÁC NHẬN CHẮC CHẮN (không còn là nghi vấn)**: đọc trực tiếp `ListCountryHandler.cs` (Handle) thấy
toàn bộ thân hàm chỉ có `throw new NotImplementedException();` - endpoint CHƯA TỪNG được lập
trình, sẽ LUÔN lỗi bất kể môi trường/DB/config nào - bật lại test (bỏ `test.skip`) khi backend thật
sự implement handler này.

**`download/list` KHÔNG còn trong bảng trên** - đã xác định đúng nguyên nhân (không phải "môi
trường"): `DownloadHistoryRequestValidator` chỉ bắt buộc `timezoneId`, không bắt buộc `filters`,
nhưng `DownloadApplicationService.ListHistory()` đọc `request.Filters.Module` **thiếu `?.`**
(khác 2 dòng ngay bên dưới nó, `request.Filters?.DownloadId`/`Status` có `?.`) - thiếu hẳn field
`filters` trong body làm `Filters = null` → `NullReferenceException` → `UNKNOWN_ERROR`. Test đã
tránh được bằng cách luôn gửi `filters: {}` (giống quy ước "mọi API `.../list` cần `filters` có
mặt tường minh" ở mục "Hành vi đáng chú ý" bên dưới) - nhưng đây **vẫn là 1 bug thật ở backend**
(thiếu `?.` dòng 116 `DownloadApplicationService.cs`), chưa được fix, chỉ là test không còn bị
chặn bởi nó nữa.

**ĐÃ TỰ HẾT (xác nhận qua chạy thật lần này, không còn trong danh sách trên nữa)**:
`role/listhierarchy`, `user/dropdown_user_list`, `user/listhierarchy`, `action-ack/list`,
`dropdown/currency` - cả 5 endpoint này từng bị UNKNOWN_ERROR ở các lần chạy trước, nay đã trả
`success` bình thường. Nhiều khả năng được backend fix cùng đợt với việc khởi động lại server.

**`operator_request/list` (failoperatorrequest.spec.js) cũng ĐÃ TỰ HẾT** - xác nhận qua curl trực
tiếp bằng ĐÚNG body mà test đang gửi (`filters.timezoneId: 336`) → trả `success` bình thường. Test
này thật ra CHƯA BAO GIỜ sai (đã có `filters.timezoneId` sẵn từ trước) - chỉ là backend/hạ tầng lúc
đó chưa sẵn sàng; đã bỏ comment "KNOWN ISSUE" cũ trong file.

**3 lỗi UNKNOWN_ERROR ở house/masteragent/agent là CÙNG MỘT bug hệ thống**: cả 3 tạo entity qua
chung 1 code path (`_sasEntityRoleService.CreateRole` sau khi tạo `SasEntity`) - sửa 1 chỗ nhiều
khả năng fix cả 3. `gamecategory` UNKNOWN_ERROR là bug RIÊNG (GameCategory không thuộc SasEntity
hierarchy, xem `CreateGameCategoryHandler.cs`). Các endpoint còn lại trong bảng trên giờ ĐỀU đã xác
định nguyên nhân riêng cụ thể (không còn "chưa rõ nguyên nhân chung"): `country/list` -
`NotImplementedException` (xem ghi chú riêng ở trên), `game_round/list` - RPC `ListGameRound` lỗi
ở service ngoài (xem ghi chú riêng ở trên), `download/list` - thiếu `?.` (xem ghi chú riêng ở
trên); 2 endpoint `user/dropdown_*_by_hierarchy` còn lại vẫn chưa xác định nguyên nhân.

## Service report/promo bên ngoài (đã xác nhận qua curl, không còn là "nghi vấn")

`appsettings.Development.json` từng khai báo các địa chỉ service ngoài dưới `WebClient` là
**placeholder** (`PromoReportServiceClient`, `PlayerReportQueryService`, `GameReportSummaryService`,
`RetryCancelBetService` đều `.example.invalid`) - GIỜ ĐÃ ĐƯỢC CẤU HÌNH ĐỊA CHỈ THẬT
(`http://175.41.231.2:<port>`, xem mục "THAY ĐỔI MÔI TRƯỜNG LỚN" ở đầu file). Đã dùng curl (login +
generateOtp + verifyOtp thủ công, xem mục đó) xác nhận lại TỪNG endpoint từng nằm trong danh sách
"UNKNOWN_ERROR nghi do service ngoài chưa cấu hình" cũ - kết quả chia làm 2 nhóm rõ ràng:

**ĐÃ TỰ HẾT (xác nhận trả `success` thật qua curl)**:
- `dashboard/top-performing-games`, `dashboard/ggr-trend`, `dashboard/top-currencies` (dashboard.spec.js)
- `summary/game`, `summary/game/currency-summation`, `summary/fs-game`,
  `summary/fs-game/currency-summation` (report.spec.js) - đi qua `GameReportSummaryService`
- `bet_history/details-report` (report.spec.js) - lỗi thật là do test hard-code `round_id: "1"`
  không tồn tại trên dữ liệu dev thật (round id thật dạng số dài, vd `916895077329010689`), không
  liên quan service ngoài - đã sửa lấy round_id thật từ `bet_history/settled` trước
- `report/free_game_dropdown`, `report/player_dropdown` (promotionsummary.spec.js)
- `report/promotion-summary-player-report`, `report/promotion-summary-player-detail-report`
  (promotionsummary.spec.js)

**VẪN LỖI THẬT (không phải do thiếu cấu hình chung - từng route/RPC method cụ thể có vấn đề ở
service ngoài, đã đọc code xác nhận đường đi rồi mới kết luận, không đoán)**:
- `summary/player`, `summary/player/free-spin`, `summary/player/currency-summation`
  (report.spec.js) - đi qua `_playerHttpClient` (`WebClient.PlayerReportQueryService`,
  175.41.231.2:8969) - KHÁC với `_gameHttpClient` mà `summary/game*` dùng (đã tự hết). Response lỗi
  forward thẳng từ chính service ngoài đó (`ReportQueryService.EnsureSuccess` map
  `metadata.Code`/`metadata.Message` trực tiếp vào `ReportServiceException`) - quan sát được
  `messageCode: "PlayerSummaryQueryService.UnexpectedError"` cho `summary/player`, nghĩa là chính
  `PlayerReportQueryService` tự báo lỗi. `summary/player/currency-summation` lỗi generic
  `UNKNOWN_ERROR` hơn (có thể do lỗi HTTP status trước khi tới bước đọc `metadata`, chưa xác định
  chi tiết hơn được) - cùng root service, khả năng cao cùng nguyên nhân.
- `report/promotion-summary-report`, `report/promotion-summary-promo-report`
  (promotionsummary.spec.js) - đi qua CÙNG `PromoReportServiceClient` với `-player-report`/
  `-player-detail-report` (đã tự hết), nhưng gọi 2 route khác nhau
  (`/api/freegame/promotion-summary-report`, `/api/freegame/promotion-summary-promo-report`) - đã
  thử cả với `promoId` thật (lấy từ `free_game_dropdown`), vẫn lỗi. Vì route anh em trên CÙNG
  service chạy tốt, kết luận đây là lỗi cụ thể ở 2 route này trên chính service ngoài, không phải
  thiếu cấu hình.
- `game_round/list` (gameround.spec.js) - xem ghi chú riêng ở mục "Bug backend thật" (RPC
  `ListGameRound` trên gRPC `BetHistoryService`, khác `FilterBetHistory` đã tự hết).

Cả 2 nhóm trên đều đã cập nhật comment trong đúng file test tương ứng - không còn treo nguyên văn
"KNOWN ISSUE (môi trường, không chắc là bug)" chung chung nữa.

**`bet_history/settled` và `summary/player-segment/*` (3 endpoint: `spending-power`,
`profile-category`, `spending-behavior`)** - đã xác định đúng nguyên nhân, KHÔNG phải service ngoài
chưa cấu hình: cả 2 nhóm parse field ngày (`betTime`/`settledTime`) bằng format cố định
`dd-MM-yyyy HH:mm:ss` (`DateTimeFormat.UI_FORMAT`, dùng xuyên suốt app), qua `DateTime.ParseExact`
không có fallback. Test cũ gửi kiểu ISO `yyyy-MM-dd HH:mm:ss` → `FormatException` (không map trong
`ExceptionMiddleware.cs`) → `UNKNOWN_ERROR`. Đã sửa test dùng đúng format - xác nhận qua test trực
tiếp, gRPC pipeline trả data mẫu bình thường khi format đúng. Không phải thiếu field
`segmentFilters` như ghi chú cũ - structure `PlayerSegmentationFilter` thực ra là
`{ field, details: [{ name, min, max }] }`, đã viết đầy đủ trong report.spec.js.

Thêm nữa, `bet_history/settled` từng bị `Playwright timeout 30000ms exceeded` /
`Request context disposed` sau khi backend trỏ sang DB/gRPC dev THẬT - lúc đầu nghi do
`BetHistoryService` không kết nối được, nhưng verify bằng curl y hệt request thật của FE (copy từ
DevTools) → trả `success` dưới 1 giây, LOẠI TRỪ nguyên nhân kết nối. So sánh trực tiếp với curl phát
hiện test SAI 2 chỗ: (1) gửi `betTime` thay vì `settledTime` (2 field riêng biệt trong
`BetHistoryReportFilter`, FE thật lọc bằng `settledTime` cho đúng nghiệp vụ "settled bets"); (2)
thiếu hẳn `recordScope`/`statuses`/`operatorStatuses` (FE luôn gửi để thu hẹp query) và dùng khoảng
ngày CẢ NĂM. Trên dữ liệu dev thật (lớn hơn nhiều so với DB local trước đây), tổ hợp "cả năm +
không lọc status" khiến query quá nặng → treo >30s. Đã sửa dùng đúng field `settledTime` + đủ
filter + khoảng ngày hẹp (hôm qua → ngày mai, tính động lúc chạy test) - xem `report.spec.js`. Áp
dụng luôn khoảng ngày hẹp cho 3 test `player-segment/*` để phòng ngừa rủi ro tương tự.

## Bug cosmetic (messageCode sai nhưng logic đúng - không assert exact messageCode)

- `geofencing/validate/ip` khi IP trùng trả `DUPLICATE_CURRENCY_CODE` / "Currency code is already
  existed" thay vì thông báo IP trùng - copy-paste nhầm từ module Currency
  (`CreateIpHandler.cs`, dòng `return Errors.Currency.DuplicateCode`).
- `validate/entitycode` (SasEntityController) khi code trùng CŨNG trả `DUPLICATE_CURRENCY_CODE` -
  cùng 1 kiểu lỗi copy-paste, ở module khác. **Xuất hiện 2 lần ở 2 module khác nhau** → đáng báo
  backend rà soát tổng thể các chỗ dùng `Errors.Currency.DuplicateCode` sai ngữ cảnh.

## Giới hạn permission seed gap (`NOT_PERMISSION`, khác với bug UNKNOWN_ERROR ở trên)

Role của tài khoản test (ADMIN_1) có thể thiếu permission mapping cho các action sau (trả
`NOT_PERMISSION` dù request/session hợp lệ, kể cả sau khi đã verify OTP):

- `auth/refresh-token`, `geofencing/ip-restrict-view`
- `download/file`, `action-ack/status`
- `tracking/retention`, `calculate/retention`, `bet_history/misc_dropdown`

**ĐÃ TỰ HẾT**: `agent/agentgamecurrency/update` từng nằm trong danh sách này (trả `NOT_PERMISSION`)
nhưng backend đã sửa - xác nhận qua chạy thật lại, giờ trả `success` bình thường, xem lại mục
agentgamecurrency.spec.js ở "Giới hạn môi trường test khác" bên dưới.

## Giới hạn môi trường test khác (không phải bug)

- **`dropdown/agentcredential` (nhóm ApiKey) - route khai báo trong `Endpoints.cs` nhưng KHÔNG
  được wire vào bất kỳ controller action nào** (`ApiKeyController.cs` không có action cho route
  này, không controller nào khác tham chiếu hằng số `Endpoints.ApiKey.DROPDOWN`) - gọi route này
  sẽ ra 404, không có logic nghiệp vụ nào để test. Không tính vào danh sách "endpoint cố tình
  không test" (đó là các route THẬT bị loại trừ vì rủi ro) - đây đơn giản là chưa được lập trình.
- **`[Obsolete]` controller**: `RtpGroupController` - create/view/update/update-status đều là
  stub chết trả dữ liệu giả cố định bất kể input (đã verify qua code + gọi thật) - test chỉ assert
  hành vi stub đó, cộng với `/list` (read-only, dữ liệu thật).
- **Ghi/mutate hệ thống bên NGOÀI thật (không thể khôi phục, đã đọc code service xác nhận, không
  chỉ suy đoán)** - đây là nhóm rủi ro cao nhất, loại trừ trên nguyên tắc dù DB nội bộ có thể toggle
  được:
  - `operator_request/retry` - `FailOperatorRequestService.Retry` gọi thẳng
    `WebClient.RetryCancelBetService` (HTTP client ngoài) để retry huỷ cược thật ở hệ thống bet-
    history/thanh toán. Địa chỉ service này ĐÃ được cấu hình thật (`175.41.231.2:8919`, không còn
    placeholder `.example.invalid` như trước) - nghĩa là gọi endpoint này giờ CÓ THỂ thực sự thành
    công và retry huỷ cược thật, rủi ro tài chính CAO HƠN trước, không phải thấp đi. Chưa/không tự
    verify bằng curl (khác các endpoint read-only khác) vì đây chính là hành động có side-effect
    thật - vẫn giữ nguyên trong `dangerous.spec.js`, gate bằng `RUN_DANGEROUS_TESTS` +
    `DANGEROUS_OPERATOR_REQUEST_ID` tự chọn.
  - `player/kick` - publish message Kafka topic "PlayerKick" để 1 service ngoài ngắt session thật
    của player. Không có API `player/create` (PlayerController.cs không có action Create) nên cũng
    không thể tạo player rời rạc để kick an toàn.
  - `game_round/update-status` - `GameRoundService.UpdateStatus` gọi thẳng
    `IBetHistoryClientService.UpdateStatusGameRound`, một hệ thống bet-history ngoài, trên round
    cược thật. `game_round/list` (prerequisite để lấy round id) cũng đang là KNOWN ISSUE riêng.
- **Ghi thật, không có cách khôi phục qua API (khác nhóm trên - đây là nội bộ nhưng vẫn phá dữ liệu
  vĩnh viễn)**:
  - `game/reset-default-paytable` - đã đọc `ResetPaytableHandler.cs`: tạo hẳn 1 paytable MỚI thay
    thế paytable hiện tại của game thật, không có API phục hồi lại đúng paytable cũ.
  - `game/create`, `/create/v2` - không có API xoá game, sẽ để lại rác vĩnh viễn trên catalog dùng
    chung. Đã viết được test cho cả 2 (kèm `/update`, `/update-paytable`,
    `game/reset-default-paytable` chạy tiếp trên game vừa tạo) trong `dangerous.spec.js` - cấu trúc
    `payTableInfoList` (`GamePayTableInfo`: `code`, `payTable`, `status`, validator chỉ yêu cầu
    `Code` không rỗng + `PayTable` không null) đã xác định được qua code, chỉ còn 1 điểm CHƯA CHẮC:
    nội dung JSON thật sự hợp lệ của field `payTable` (dùng tạm `"{}"` - xem comment trong
    `dangerous.spec.js` nếu create fail ở bước này).
  - `game/update`, `/update/v2` - khác với house/agent/masteragent (write-back toàn bộ giá trị đọc
    từ view là an toàn), `UpdateGameRequest`/`UpdateGameRequest1` có field ghi được (`Rows`,
    `Reels`, `Payline`, `ReleaseDate`) mà `/game/view` HOÀN TOÀN không trả lại (xem
    `ViewGameResponse.cs`) - không có cách đọc lại để ghi y hệt, cũng không thể verify các field
    này còn nguyên vẹn sau update. Giới hạn thật của schema, không phải chưa hiểu domain.
  - `game/update-paytable` - cùng dạng giới hạn schema như `game/update`: `GamePayTableInfo` (ghi)
    có field `Name` mà `PaytableViewInfo` (`/game/view`, đọc) KHÔNG trả lại - không đọc lại được để
    ghi y hệt toàn bộ `payTableInfoList` một cách an toàn.
  - `house/create`, `masteragent/create`, `agent/create`, `game/game_category/create` - xem bug
    backend UNKNOWN_ERROR ở trên; vì create broken nên `update`/`update-status` của house/
    masteragent/agent/game_category **vẫn được test bằng cách toggle/write-back trên entity CÓ
    SẴN** trên DB dev (không tạo mới) - xem house.spec.js/masteragent.spec.js/agent.spec.js/
    gamecategory.spec.js.
- **Config gắn liền với agent thật - ĐÃ test được bằng no-op sau khi đối chiếu kỹ field giữa
  request ghi và response đọc** (agentgamecurrency.spec.js):
  - `agent/agentgamecurrency/update` - permission seed gap từng chặn route này (`NOT_PERMISSION`)
    **ĐÃ ĐƯỢC BACKEND SỬA** (xác nhận qua chạy thật lại, giờ trả "success" bằng đúng session admin).
    **NGHI VẤN bug backend riêng, TÁCH BIỆT với việc có test hay không** (vẫn CHƯA verify được):
    đã đọc kỹ `AgentGameCurrencyService.AgentUpdate()` - khác với `Update()` (dùng cho
    `/agentgamecurrency/update`, có gọi rõ `AgentGameCurrencyCommandRepository.BatchUpdate(...)`),
    `AgentUpdate()` chỉ tạo object `AgentGameCurrency` MỚI (detached) để build Outbox message rồi
    return, KHÔNG thấy gọi BatchUpdate/Update nào trên repository - nhiều khả năng endpoint trả
    "success" + bắn Kafka message nhưng KHÔNG thực sự ghi gì vào DB. Test vẫn viết được AN TOÀN
    (no-op, gửi lại đúng Override/MaxPayoutCustom/MaxMultiplier hiện tại) bất kể nghi vấn đúng hay
    sai. Test KHÔNG tự kết luận được nghi vấn này (muốn vậy phải gửi giá trị MỚI rồi xem view có
    đổi không - rủi ro nếu nghi vấn sai, chưa làm) - để nghi vấn mở cho backend tự xác minh khi cần.
  - `agentgamecurrency/update_status` - toggle+restore, request chỉ có `agentId/ids/status`,
    `/agentgamecurrency/view` trả lại đúng field đó.
  - `agentgamecurrency/update` - `GameSetting` DTO (9 field: Id/PayTableId/IsDefaultPaytable/
    DenominationId/IsDenomOverride/Override/Status/MaxPayoutCustom/MaxMultiplier) khớp hoàn toàn
    với `ListAgentGameCurrencyResponse.GameSettingView`; viết lại y hệt khiến
    `AgentGameCurrencyService.Update` tính `isAgentChanged=false` (không đụng tới Agent record).
    Lưu ý `MaxPayoutCustom` ở view là string, test tự parse + `Number.isFinite` guard, skip nếu
    parse ra NaN thay vì liều ghi đè.
  - `agentgamecurrency/bulk_update` - validator bắt buộc phải "đổi" ít nhất 1 field
    (`IsResetMaxPayout || IsResetMaxMultiplier || MaxPayoutCustom > 0 || MaxMultiplier > 0`), nên
    không thể gửi request "trống" - test chọn nhánh vô hại tuỳ giá trị `maxMultiplier` hiện tại
    (gửi lại đúng giá trị cũ nếu > 0, hoặc `isResetMaxMultiplier: true` nếu đang = 0 - cả 2 đều
    dẫn tới `isChangeMaxMultiplier=false` trong `AgentGameCurrencyService.BulkUpdate`).
  - `agentgamecurrency/update-game-help-config` - `ConfigurationValueResponse` (đọc, qua
    `view-game-help-config`) và `ConfigurationValueRequest` (ghi) có CHÍNH XÁC cùng 5 field.
- **Prerequisite bị lỗi nên chỉ skip có điều kiện (test SẼ tự chạy thật khi bug được backend fix)**:
  - `alertreport/unflag` - bản thân endpoint chỉ đổi 1 field nội bộ (an toàn, đã verify code, không
    gọi service ngoài), nhưng `/alertreport/list` (nguồn duy nhất để lấy alert id thật) đang là
    KNOWN ISSUE UNKNOWN_ERROR - test `test.skip` khi list không trả được dữ liệu.
- **Ảnh hưởng consumer thật ngoài phạm vi test (FE)** - đã CHUYỂN sang `tests/api/dangerous.spec.js`
  (trước đó `test.skip(true, ...)` cứng trong `apikey.spec.js`, giờ gate bằng `RUN_DANGEROUS_TESTS`
  cùng cơ chế với 9 endpoint rủi ro khác - xem đầu file `dangerous.spec.js`):
  - `agentcredential/generate_key`, `agentcredential/update`, `agentcredential/update_status`
    (test "generates, views, updates and deactivates an agent api key") - dù test tự tạo key MỚI
    rồi tự deactivate lại trong `finally` (không đụng key có sẵn), agent lấy để test là agent ĐẦU
    TIÊN ngẫu nhiên từ `/dropdown/agent-filter`, có thể trùng agent mà FE đang dùng thật để tích
    hợp API - sinh/đổi/vô hiệu hoá key trên agent đó khiến FE phải cấu hình lại api key, gây lỗi
    cho FE. Cần có agent riêng dành cho test tự động (không phải agent FE đang dùng thật) trước
    khi bật thường xuyên.

### Endpoint tưởng chừng rủi ro nhưng đã xác nhận AN TOÀN để test qua session/user rời rạc

- `auth/verify_otp_password` - đã đọc `VerifyOtpPasswordHandler.cs`: đây là 1 Query thuần, CHỈ so
  sánh password+OTP với giá trị hiện tại, không ghi/đổi/invalidate gì - test trực tiếp trên tài
  khoản test chính (xem auth.spec.js), gồm cả 2 trường hợp sai OTP/sai password.
- `user/change-password`, `user/user-reset-password` - đã đọc `ChangePasswordHandler.cs`/
  `UserResetPasswordHandler.cs`: cả 2 đều dùng `request.GetUserId()` (thao tác trên CHÍNH session
  đang gọi, không nhận id user mục tiêu) - khác với `user/reset-password` (nhận `entityUserId`,
  admin đổi mật khẩu user khác, đã test từ trước). Vì vậy KHÔNG gọi bằng session của tài khoản test
  chính (sẽ tự khoá mất mật khẩu login) - test tạo 1 user rời rạc, TỰ LOGIN bằng user đó (session
  độc lập), gọi change-password rồi user-reset-password trên chính session đó, xác nhận bằng cách
  login lại sau mỗi bước, rồi deactivate user rời rạc ở cuối (xem describe "self-service password
  endpoints" trong user.spec.js).
- `denomination/upload`, `game/effective-turnover-exclusion/upload` - 2 endpoint upload CSV tưởng
  chừng cần dữ liệu thật để test, nhưng ĐÃ VIẾT ĐƯỢC test cho cả 2 (không còn là gap):
  - `game/effective-turnover-exclusion/upload` chỉ parse+validate (KHÔNG ghi DB - xem
    `GameEffectiveTurnoverExclusionService.Upload`, đây là bước preview trước khi FE gọi `/add`
    thật riêng) - test dùng lại chính file tải về từ `/template` (chỉ có header, 0 dòng dữ liệu).
  - `denomination/upload` với 0 dòng dữ liệu thì `Upload([])` không có group (subCategory,
    currency) nào để xử lý nên vòng ghi DB không chạy lần nào (xem `DenominationService.cs`) - test
    dùng 1 CSV chỉ có đúng dòng header bắt buộc (lấy trực tiếp từ `DenominationCsvParser.cs`,
    không đoán) và 0 dòng dữ liệu (xem describe `/denomination/upload` trong `denomination.spec.js`).
- `geofencing/ip-restrict-view` - permission seed gap (`NOT_PERMISSION`), không phải rủi ro dữ
  liệu - test assert đúng messageCode quan sát được (xem mục "permission seed gap" ở trên).

## Hành vi đáng chú ý (không phải bug, nhưng dễ gây nhầm)

- **`currency/list` là endpoint DUY NHẤT trong toàn bộ API không có `[SecurityCheckpoint]`** -
  hoạt động kể cả không gửi `Authorization` header.
- **Mọi API `.../list` yêu cầu field `filters` phải có mặt tường minh trong body (dù `{}`)** -
  thiếu field này API âm thầm trả `totalCount: 0` / `list: []` thay vì lỗi, dù DB có dữ liệu thật.
  Riêng `download/list` còn NẶNG hơn: thiếu `filters` làm CRASH hẳn (`UNKNOWN_ERROR`, xem
  `NullReferenceException` do thiếu `?.` ở `DownloadApplicationService.cs:116` - mục "Bug backend
  thật" ở trên) thay vì chỉ âm thầm trả rỗng như các endpoint khác.
- **1 session hoạt động / tài khoản**: mỗi lần login mới sẽ tự động huỷ mọi session cũ của user
  đó (xem `SasEntityUserAuthenticationLogCommandRepository.UpdateUserLoginStatus`). Vì vậy suite
  bắt buộc chạy `--workers=1` (script `test:api` đã có sẵn flag này) và mỗi test tự login riêng
  (xem `tests/api/fixtures.js`) - không dùng chung 1 token.
- Nhiều field lọc theo entity (vd `player/dropdown-list` filters.sasEntityId,
  `audit-log`/`operator_request` filters.timezoneId) là **required dù schema swagger đánh dấu
  nullable** - thiếu field trả `VALIDATION_FAILED`, không phải giả định.
- `dashboard/top-performing-games`: field `performanceType` là số nguyên (`1`=BetCount,
  `2`=TurnOver), KHÔNG phải chuỗi enum như đa số field enum khác trong API này.

## Cách chạy 1 phần nhỏ để debug

```
npx playwright test tests/api/<file>.spec.js --project=api --workers=1
```
