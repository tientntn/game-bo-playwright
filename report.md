# Báo cáo các file đã làm – UI test BO (dev-bo.royaledge.io)

Cập nhật: 10/11/2026

## 1. File test (thư mục `tests/`)

| File | Màn hình | Số test | Nội dung chính |
|---|---|---|---|
| `report_bet_history.spec.js` | Report > Bet History | 59 | Filter, Record Scope, Settled Time / Bet Time bắt buộc, sort, phân trang, Manage Columns, Export |
| `report_summary_player.spec.js` | Report > Player Summary | 69 | Filter theo player / game / currency..., bảng tổng, sort, phân trang, Manage Columns, Export |
| `report_summary_game.spec.js` | Report > Game Summary | 78 | 2 tab General và Free Spin or Buy Bonus, Filter Type Day / Month, bảng Summation / Conversion, sort, Manage Columns, Export |
| `report_summary_promotion.spec.js` | Report > Promotion Summary | 71 | Filter Date Period / Creation Date, popup Promotion Details, màn hình con (Total Invited Player / No of Participants), sort, Manage Columns, Export |
| `report_failed_operator_request.spec.js` | Report > Failed Operator Request | 64 | Bet Time bắt buộc, filter, popup chi tiết (icon mắt), hộp thoại huỷ request / huỷ hàng loạt (chỉ mở rồi bấm Cancel), sort, Manage Columns, Export |
| `report_alert.spec.js` | Report > Alert Report | 56 | Filter (Severity / Status / Flag...), link Player Name sang Bet History, sort, phân trang, Manage Columns |
| `report_segmentation_player.spec.js` | Report > Player Segmentation | 48 | Điều kiện bắt buộc trước khi Search, modal Customize Table, 3 tab (Spending Power / Spending Behavior / Profile Category), Reset, ghi nhớ filter |
| `report_game_recommendation.spec.js` | Report > Game Recommendation | 62 | Filter Type Day / Month, bảng chính + bảng tổng, popup View Details, sort, phân trang, Manage Columns, Export |
| `game_list.spec.js` | Games > Games (`/game`) | 77 | Chạy màn hình rộng 1920x1080. 7 filter, bảng 15 cột, sort, phân trang, chọn dòng + 5 nút thao tác hàng loạt (chỉ mở hộp thoại rồi Cancel), menu "..." của từng dòng, điều hướng sang trang View / Update / Create, Manage Columns, Export |
| `game_update.spec.js` | Games > Update Game (`/game/update/{id}`) | 49 | Id lấy từ danh sách game (bấm icon Update, không hard-code). Wizard 5 bước: Basic Information (validation Name / Hit Rate, Win Formula, Settings), Currency, Agent Assignment, Paytable, Review & Submit (không bấm Submit) |
| `game_category.spec.js` | Games > Game Categories (`/game/game-category`) | 55 | Filter Name / Status, sort, chọn dòng + 2 nút Activate / Deactivate hàng loạt, hộp thoại Update / Create (không bấm Save), Manage Columns, Export CSV, ghi nhớ filter |
| `game_sub_category.spec.js` | Games > Game Sub Categories (`/game/game-sub-category`) | 74 | Filter Name / Denom Type / Game Category (chọn nhiều), phân trang, sort, hộp thoại Update / Create (không bấm Confirm khi form hợp lệ), Manage Columns, Export CSV theo trang, ghi nhớ filter và page size |
| `game_recommendation_group.spec.js` | Game Recommendation > Recommendation Group (`/game-recommendation/recommendation-group`) | 73 | Filter Group Name / Game Name, chip game, phân trang, sort, hộp thoại Add / Update / Delete (không bấm Submit / Delete xác nhận), Manage Columns, ghi nhớ filter và page size |
| `game_denom.spec.js` | Games > Denominations (`/game/denom`) | 71 | Tab Denom Type (Slot / Mini / Crash / Card) và Game Sub Category, filter Currency / Name, phân trang, sort 3 cột, hộp thoại Upload (không bấm Confirm), màn hình chi tiết chỉ đọc, Manage Columns, ghi nhớ tab / sub category / filter / page size / sort |
| `game_effective_turnover_exclusion.spec.js` | Games > Effective Turnover Exclusion (`/game/effective-turnover-exclusion`) | 73 | Filter Code / Name / Game Category (chọn nhiều), phân trang, sort Game Name, chọn dòng và Bulk Delete (chỉ mở hộp thoại, không bấm Delete xác nhận), hộp thoại Add New Exclusion và Upload CSV (không bấm Submit), Manage Columns, Export, ghi nhớ filter / sort / page size |
| `master_agent_entity.spec.js` | Master Agent > Entity (`/master-agent/entity`) | 104 | 5 filter (House / Master Agent / Game Category / Currency chọn nhiều, Status chọn 1), dropdown Master Agent phụ thuộc House, bảng 9 cột, phân trang, sort 5 cột, chọn dòng + Activate / Deactivate hàng loạt (chỉ mở hộp thoại), menu "..." (Activate / Deactivate, Create Master Agent User), View / Update / Create (wizard 3 bước, validate bắt buộc, trùng tên / code), Manage Columns, Export, ghi nhớ filter. Request ghi bị chặn hoặc trả response giả, riêng describe cuối tạo 1 master agent `QA-AUTO-<timestamp>` thật rồi Deactivate (không có Delete nên bản ghi ở lại Inactive) |
| `master_agent_users.spec.js` | Master Agent > Users (`/master-agent/users`) | 122 | 3 filter (House / Master Agent / Username chọn nhiều; dropdown Master Agent phụ thuộc House), bảng 8 cột (có House + Master Agent), phân trang, sort 6 cột, chọn dòng + Activate / Deactivate hàng loạt, menu "..." (Activate / Deactivate, Reset Password, Reset 2FA), hộp thoại Roles, View / Update / Create (wizard 2 bước House -> Master Agent -> Username / Roles, validate, trùng Username), Manage Columns, ghi nhớ filter. Request ghi bị chặn hoặc trả response giả, riêng describe cuối tạo 1 user QA `qaauto<6 số>` thật (không có Delete nên user ở lại Inactive, các lần chạy sau dùng lại) |

| `agent_roles.spec.js` | Agent > Agent Roles (`/agent/roles`) | 113 | 5 filter chọn nhiều (House / Master Agent / Agent phụ thuộc nhau, Agent Role Name / Code), bảng 7 cột, phân trang, sort 6 cột, View (chỉ đọc), Add New (House -> Master Agent -> Agent phụ thuộc nhau, cây Permission, validate), Update (3 ô cấp trên bị khoá), Manage Columns, ghi nhớ filter. Request ghi bị chặn hoặc trả response giả, riêng describe cuối tạo 1 role `QA-AUTO-<timestamp>` (code `QAAUTO...`) gắn vào 1 agent "QA Test Agent ..." có sẵn rồi sửa tên / quyền và khôi phục (màn hình không có xoá role nên role QA ở lại) |

| `agent_entity.spec.js` | Agent > Entity (`/agent/entity`) | 112 | 6 filter (House / Master Agent / Agent / Game Category / Currency chọn nhiều, Status chọn 1; dropdown Master Agent và Agent thu hẹp theo House / Master Agent), bảng 11 cột, phân trang, sort 7 cột, chọn dòng + Activate / Deactivate hàng loạt (chỉ mở hộp thoại hoặc response giả), menu "..." (Activate / Deactivate, Create Agent Role, Agent Game Settings), View / Update / Create (wizard 3 bước, validate bắt buộc, trùng tên / code), Manage Columns, Export, ghi nhớ filter. Request ghi bị chặn hoặc trả response giả, riêng describe cuối tạo 1 agent `QA-AUTO-<timestamp>` thật rồi Deactivate (không có Delete nên bản ghi ở lại Inactive) |

Mỗi spec đều kiểm tra: hiển thị mặc định, dữ liệu khớp response API, từng filter (kèm request body), Reset, ghi nhớ filter sau khi reload.
Test không hard-code dữ liệu, giá trị lấy từ chính dòng đầu tiên của danh sách / báo cáo (riêng `report_segmentation_player.spec.js` dùng Currency / Agent mẫu,
đổi được bằng biến môi trường `SEG_CURRENCY`, `SEG_AGENT`).
Các màn hình có thao tác ghi dữ liệu (Save, Submit, Activate / Deactivate, Delete...) chỉ được mở hộp thoại rồi Cancel, test không bấm nút xác nhận.

## 2. File cấu hình

| File | Thay đổi |
|---|---|
| `playwright.config.js` | Khi dựng cookie từ `playwright/.auth/session.txt` chỉ lấy các key không phải `iconify*` và có giá trị không quá 600 ký tự. Trước đó toàn bộ key (gồm cache icon `iconify*` rất lớn) bị nhét vào cookie làm header `Cookie` lên khoảng 11 KB và server trả lỗi 500. localStorage vẫn giữ đầy đủ. |

## 3. File tài liệu

| File | Nội dung |
|---|---|
| `report.md` | File này |
| `.claude/agents/playwright.md` | Agent `playwright` để tự khám phá màn hình bằng Playwright MCP và viết file spec: quy trình, cấu trúc spec chuẩn, quy tắc an toàn dữ liệu, các điểm riêng của antd / NextGen đã gặp |

## 4. Lỗi ứng dụng phát hiện / lưu ý

### Master Agent > Entity (`master_agent_entity.spec.js`)

Phát hiện lúc khám phá, **chưa kiểm chứng bằng chạy spec** (lần chạy đầu 104 test đều fail vì session hết hạn, bị chuyển về `/login`; cần dán lại localStorage vào `playwright/.auth/session.txt` rồi chạy lại).

1. Hộp thoại Activate hàng loạt khi chọn nhiều dòng có tiêu đề "Activate 2 Master Agents" nhưng câu hỏi lại là "...deactivate these 2 Master Agents?" (sai hành động). Test bulk Activate nhiều dòng sẽ FAIL cho tới khi sửa.
2. Hộp thoại Activate / Deactivate từng dòng dùng số nhiều "these <tên> Master Agents" dù chỉ 1 dòng. Test chỉ kiểm tra tên và hành động.
3. Reset khi chưa có filter nào đang áp dụng không gọi lại API (giống lỗi đã ghi ở `game_denom.spec.js`). Test Reset đã Search với filter trước.
4. Create qua UI (`masteragent/create` thật) chưa xác nhận vì chưa chạy; mới thấy payload và response giả lúc khám phá.

### Master Agent > Users (`master_agent_users.spec.js`)

Đã chạy 115 test (loại describe CRUD thật tạo user QA, 7 test chưa chạy): 111 pass, 1 skip ("Ít bản ghi (1 trang)": có 17 bản ghi), 3 fail. Sau đó sửa test Reset Password (Create Password) và chạy lại riêng: pass. Chạy lại riêng 6 test fail ở lần đầu (14:23, session hợp lệ): 4 pass (đổi House xoá Master Agent, Reset Password Create Password, 2 test Submit Create), 2 fail do lỗi ứng dụng (mục 1 và 2).

1. Hộp thoại Bulk Activate 1 user hiện "Are you sure you want to activate this user." (kết thúc bằng dấu chấm), còn Bulk Deactivate và các hộp thoại khác kết thúc bằng dấu hỏi. Test Activate hàng loạt 1 user FAIL cho tới khi sửa (đã xác nhận khi chạy).
2. Dropdown Username ở thanh filter không thu hẹp theo House / Master Agent đang chọn: `user/dropdown_user_by_hierarchy` chỉ gửi `{sasEntityHierarchyId:3, username}` (không có `houseIds` / `masterAgentIds`) và khi mở dropdown thì hoặc không gửi lại request (lúc chạy spec) hoặc gửi lại nhưng vẫn không kèm các filter đó (lúc khám phá bằng script), nên vẫn liệt kê user của Master Agent khác (dropdown Master Agent thì có thu hẹp theo House). **Chưa xác nhận** là lỗi hay đúng thiết kế; test "Chọn House + Master Agent: dropdown Username chỉ liệt kê user thuộc master agent đó" FAIL cho tới khi xác nhận / sửa.
3. Đổi House ở filter thì ô Master Agent đang chọn bị xoá (không ghép được Master Agent của house A với House B). Test ghi nhận đây là hành vi hiện tại (pass).
4. Hộp thoại Reset Password > Create Password: khi ô mật khẩu đang focus, khung "Password Requirements" phủ lên nút Save và chặn click (Playwright báo "subtree intercepts pointer events"). Test phải bấm tiêu đề hộp thoại để bỏ focus rồi mới Save. Có thể là lỗi bố cục UI, chưa xác nhận.
5. Create user thật (`user/create` ở cấp Master Agent) và 7 test CRUD user QA chưa chạy (chưa được phép tạo user thật). Payload thấy khi khám phá bằng response giả: `{sasEntityId = sasEntityId của Master Agent, house, masterAgent, roleIds, status, forceUpdatePassword, password}`.
