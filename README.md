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
npm run test:ui:other          // player, download_history, user, user_menu
npm run test:ui                // full (tất cả nhóm trên)
// Chạy 1 file: npm run test:ui -- tests/report_alert.spec.js

// Thời gian từng test được ghi vào test-results/timings.json sau mỗi lần chạy (reporter json).
// Liệt kê 15 file chạy lâu nhất của lần chạy gần nhất:
// node -e "const r=require('./test-results/timings.json'),m={};(function w(s){(s.specs||[]).forEach(p=>p.tests.forEach(t=>t.results.forEach(x=>m[p.file]=(m[p.file]||0)+x.duration)));(s.suites||[]).forEach(w)})(...r.suites.map(s=>s));Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([f,d])=>console.log((d/60000).toFixed(1)+' phút (tổng thời gian test)',f))"

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
