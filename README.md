install extention:
https://chromewebstore.google.com/detail/playwright-crx/jambeljnbnfbkcpnoiaedcabbgmnnlcd

npm cache clean --force

npm install --save-dev @playwright/test --legacy-peer-deps

npx playwright install

npx playwright test --ui

Test nhanh
npx playwright test --workers=4 --project=setup --project=chromium

// Chạy test theo nhóm màn hình (UI) - chỉ chạy nhóm vừa sửa, nhanh hơn chạy full (~1 giờ)
// Server dev quá tải khi chạy nhiều worker song song nên các script dùng --workers=4.
npm run test:ui:admin          // tests/admin_*
npm run test:ui:game           // tests/game_*
npm run test:ui:report         // tests/report_*
npm run test:ui:house          // tests/house_*
npm run test:ui:master-agent   // tests/master_agent_*
npm run test:ui:agent          // tests/agent_*
npm run test:ui:dashboard      // dashboard
npm run test:ui:other          // player, download_history, user, user_menu
npm run test:ui                // full (tất cả nhóm trên)
// Chạy 1 file: npm run test:ui -- tests/report_alert.spec.js
// Game client (canvas) tests/game_fortune_pig.spec.js: tự lấy URL game qua trang chủ GridPlay, chỉ cần trong .env:
//   LOBBY_USERNAME, LOBBY_PASSWORD (tuỳ chọn LOBBY_URL) hoặc GAME_URL (URL game có sẵn ?data=..., được ưu tiên, chỉ test đúng biến thể trong URL).
//   Thiếu cả hai -> file bị skip. Mã game thuộc về spec (GAME_VARIANTS đầu file): `npx playwright test tests/game_fortune_pig.spec.js`
//   test CẢ HAI bản (SL_33_FORTUNE_PIGCOOL rồi SL_33_FORTUNE_PIGCOOL_MK) tuần tự, mỗi bản lấy URL riêng, dùng chung ví nên không song song.
//   GAME_CODE=<mã[,mã]> chỉ để thu hẹp (mã sai -> fail, nêu mã hợp lệ). Game khác cần spec riêng + GAME_VARIANTS riêng, dùng lại tests/helpers/game-lobby.js.
//   Nhóm "Quay thật" LUÔN chạy (không phụ thuộc RUN_FULL_TESTS), MẶC ĐỊNH quay 60 lượt thật
//   (GAME_BETS=min,mid,max x GAME_SPINS=20 lượt/mức, ~25-30 phút/bản; cược tối đa ~940 TKN bản thường, ~2.040 TKN bản _mk).
//   `npm run test:ui:game` cũng quay 60 lượt MỖI BẢN (chạy trần = cả hai bản: 120 lượt, ~50-60 phút, cược tối đa ~2.980 TKN). Chạy nhanh: GAME_CODE=<một mã> GAME_BETS=min GAME_SPINS=3.
//   GAME_BETS=all = mọi mệnh giá x 20 lượt (rất tốn: ~180 lượt/75 phút/~2.540 TKN bản thường; ~400 lượt/2,8 giờ/~6.460 TKN bản _mk).
//   Báo cáo chi tiết (HTML, mở bằng trình duyệt) sau mỗi lần chạy, mỗi biến thể 1 file: test-results/game-report-<MÃ GAME>.html (+ .json) và bản lưu lâu dài
//   test-history/game-reports/<ngày_giờ>_<MÃ GAME>.html. Gồm: kết luận; giao diện (từng nút / popup đạt - lỗi - lưu ý); tổng hợp theo mức cược; đối chiếu
//   rule (đúng / sai từng loại kiểm tra); đối chiếu lịch sử (đúng / sai từng trường); RTP thực tế so với RTP lý thuyết ở màn Info (tham khảo); độ phủ; từng lượt quay.
//   Spec tự gia hạn phiên game (token ~20-30 phút) qua lobby; trần chi phí GAME_MAX_COST (mặc định 20000 TKN) - vượt thì dừng, không quay.
//   Chi tiết đầu file tests/game_fortune_pig.spec.js và tests/helpers/game-lobby.js. KHÔNG ghi mật khẩu vào file nào ngoài .env.

// Báo cáo test lỗi cho QA: sau mỗi lần chạy, mở test-results/failures.md
// (gom theo loại: lỗi app đã biết / sai kết quả / timeout / mạng rớt; mỗi lỗi có mong đợi vs thực tế,
//  các bước đã thực hiện, ảnh lúc fail và lệnh chạy lại). Code: tests/helpers/failures-reporter.js
// Test lỗi app đã biết được nhận diện qua comment "LỖI ỨNG DỤNG ĐÃ XÁC NHẬN" ngay phía trên test trong spec.

// Thời gian từng test được ghi vào test-results/timings.json sau mỗi lần chạy (reporter json).
// Liệt kê 15 file chạy lâu nhất của lần chạy gần nhất:
// node -e "const r=require('./test-results/timings.json'),m={};(function w(s){(s.specs||[]).forEach(p=>p.tests.forEach(t=>t.results.forEach(x=>m[p.file]=(m[p.file]||0)+x.duration)));(s.suites||[]).forEach(w)})(...r.suites.map(s=>s));Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([f,d])=>console.log((d/60000).toFixed(1)+' phút (tổng thời gian test)',f))"

// Lịch sử kết quả theo ngày (không bị ghi đè như test-results/): sau mỗi lần chạy có test chạy thật,
// reporter tests/helpers/history-reporter.js ghi vào thư mục test-history/ (nên commit thư mục này):
//   summary.csv       mỗi lần chạy 1 dòng: ngày, giờ, số phút, full/partial, tổng, đạt, chập chờn, lỗi, skip
//   YYYY-MM-DD.json   trạng thái từng test + lý do lỗi của lần chạy FULL gần nhất trong ngày
// Chạy xong tự in so sánh với ngày trước (test mới / mất / mới lỗi / hết lỗi). So sánh tay:
// node tests/helpers/history-reporter.js 2026-11-19 2026-11-20      (bỏ tham số = 2 ngày gần nhất)
// Lần chạy một phần (vd test:ui:dashboard, < 90% tổng test) chỉ thêm dòng vào summary.csv. `--list` không ghi gì.

// authentication:
Login to https://dev-bo.royaledge.io/
F12, copy all Local storage and past to file: playwright/.auth/session.txt

// API tests (tests/api) - test cho AlizeGames.BO.API (D:\Net\bo_backend\AlizeGames.BO.API)
// Cấu hình tài khoản/base URL trong .env: API_BASE_URL, API_LOGIN_CODE, API_USERNAME, API_PASSWORD

npm run test:api
//Chạy 1 file
npm run test:api -- tests/api/denomination.spec.js
//chạy 1 api
npm run test:api -- tests/api/denomination.spec.js -g "lists denominations grouped by currency for a game sub category"

// (tương đương npx playwright test --project=api --workers=1)

// Xem report:
npx playwright show-report

// Lưu ý: server BO API (localhost:5000) đang trỏ vào DB dev DÙNG CHUNG với team, không phải
// DB local rời rạc. Mọi test tạo dữ liệu (create) đều tự dọn dẹp bằng API delete/deactivate
// tương ứng trên chính record vừa tạo - không đụng vào dữ liệu có sẵn của người khác.
// Riêng role/create không có API xoá/deactivate nên role test tạo ra sẽ còn lại vĩnh viễn
// (đặt tên/code tiền tố QA_AUTO để dễ nhận diện).
//
// QUAN TRỌNG: bắt buộc chạy với --workers=1 (script test:api đã có sẵn flag này).
// Backend chỉ cho phép 1 session hoạt động / tài khoản - mỗi lần login mới sẽ tự động huỷ
// mọi session cũ của user đó. Vì mọi test đều login bằng CÙNG 1 tài khoản (API_USERNAME),
// chạy song song (nhiều worker) sẽ khiến các session login đè lên nhau và trả về
// UNAUTHORIZED_USER dù request hoàn toàn hợp lệ. Mỗi test trong tests/api/fixtures.js đã
// tự login riêng ngay trước khi dùng - kết hợp với --workers=1 sẽ đảm bảo không có 2 lần
// login nào diễn ra cùng lúc.

// KNOWN ISSUES / giới hạn phạm vi test: xem tests/api/KNOWN_ISSUES.md
// (bug backend đã xác nhận, bug cosmetic, giới hạn 2FA/permission-seed, hành vi API đáng chú ý...)
