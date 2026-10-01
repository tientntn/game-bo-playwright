// Test cho RoleController (D:\Net\bo_backend\AlizeGames.BO.API\Controllers\RoleController.cs)
// Lưu ý: API không có endpoint xoá/deactivate role, nên role do test tạo ra sẽ tồn tại
// vĩnh viễn trên DB dev (giống cách các role "test", "test02", ... đã có sẵn trong DB).
// Đặt tên/code có tiền tố "QA_AUTO" để dễ nhận diện và dọn tay sau này nếu cần.
const { test, expect } = require("./fixtures");
const { apiPost } = require("./helpers/api-client");

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

// UpdateRoleRequestValidator bắt buộc permissionIds không rỗng (khác với CreateRoleRequestValidator
// không có ràng buộc này) - lấy tạm 1 permission id có sẵn từ chính response /role/view.
function firstPermissionId(permissionsByCategory) {
  for (const category of Object.values(permissionsByCategory)) {
    for (const permission of Object.values(category)) {
      return permission.id;
    }
  }
  throw new Error("Không tìm thấy permission id nào trong response /role/view");
}

test.describe("Role API - /role/list", () => {
  test("lists roles with pagination envelope", async ({ authedRequest }) => {
    const { response, json } = await apiPost(authedRequest, "/role/list", {
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

test.describe("Role API - /dropdown/role", () => {
  test("lists roles for a sas entity", async ({ authedRequest, authInfo }) => {
    const { json } = await apiPost(authedRequest, "/dropdown/role", {
      sasEntityId: authInfo.sasEntityId,
    });

    expect(json.status).toBe("success");
    expect(Array.isArray(json.data)).toBe(true);
  });
});

test.describe("Role API - /role/listhierarchy", () => {
  // KNOWN ISSUE (backend): trả UNKNOWN_ERROR trên DB dev hiện tại dù request body đủ field bắt
  // buộc theo handler (filters.sasEntityHierarchyId) - đã thử với nhiều hierarchy level khác
  // nhau (2, 3), lỗi lặp lại. Test này CỐ TÌNH để fail đỏ - không dùng test.fail() - để nhắc
  // backend xử lý mỗi lần chạy suite, cho tới khi bug được fix.
  test("lists roles by hierarchy level", async ({ authedRequest }) => {
    const { json } = await apiPost(authedRequest, "/role/listhierarchy", {
      page: 1,
      pageSize: 10,
      filters: { sasEntityHierarchyId: [2] },
    });

    expect(json.status).toBe("success");
    expect(typeof json.data.totalCount).toBe("number");
    expect(Array.isArray(json.data.list)).toBe(true);
  });
});

test.describe("Role API - create/view/update", () => {
  test("creates a role and reflects an update when viewed", async ({ authedRequest, authInfo }) => {
    const suffix = uniqueSuffix();
    const code = `QA_AUTO_${suffix}`;
    const name = `QA Auto Role ${suffix}`;

    // 1. Create - response của API này không trả về id, nên phải tự tìm lại bằng code
    const { json: createJson } = await apiPost(authedRequest, "/role/create", {
      sasEntityId: authInfo.sasEntityId,
      name,
      code,
      permissionIds: [],
    });
    expect(createJson.status).toBe("success");
    expect(createJson.messageCode).toBe("CREATE_ROLE_SUCCESS");

    // 2. Tìm lại role vừa tạo qua list (pageSize lớn để chắc chắn quét hết)
    const { json: listJson } = await apiPost(authedRequest, "/role/list", {
      page: 1,
      pageSize: 500,
      filters: {},
    });
    const created = listJson.data.list.find((r) => r.code === code);
    expect(created, `Không tìm thấy role vừa tạo (code=${code}) trong /role/list`).toBeTruthy();
    const roleId = created.id;

    // 3. View
    const { json: viewJson } = await apiPost(authedRequest, "/role/view", { id: roleId });
    expect(viewJson.status).toBe("success");
    expect(viewJson.data.code).toBe(code);
    expect(viewJson.data.name).toBe(name);

    // 4. Update - phải kèm ít nhất 1 permissionId (xem ghi chú firstPermissionId ở trên)
    const permissionId = firstPermissionId(viewJson.data.permissions);
    const updatedName = `${name} Updated`;
    const { json: updateJson } = await apiPost(authedRequest, "/role/edit", {
      id: roleId,
      name: updatedName,
      code,
      permissionIds: [permissionId],
    });
    expect(updateJson.status).toBe("success");

    // 5. View lại - xác nhận update phản ánh đúng (tên mới + permission vừa gán)
    const { json: viewAfterUpdate } = await apiPost(authedRequest, "/role/view", { id: roleId });
    expect(viewAfterUpdate.data.name).toBe(updatedName);

    const grantedPermission = Object.values(viewAfterUpdate.data.permissions)
      .flatMap((category) => Object.values(category))
      .find((permission) => permission.id === permissionId);
    expect(grantedPermission.value).toBe(true);
  });

  test("rejects creating a role with a duplicate code", async ({ authedRequest, authInfo }) => {
    const suffix = uniqueSuffix();
    const code = `QA_AUTO_DUP_${suffix}`;

    const first = await apiPost(authedRequest, "/role/create", {
      sasEntityId: authInfo.sasEntityId,
      name: `QA Auto Dup Role ${suffix}`,
      code,
      permissionIds: [],
    });
    expect(first.json.status).toBe("success");

    const second = await apiPost(authedRequest, "/role/create", {
      sasEntityId: authInfo.sasEntityId,
      name: `QA Auto Dup Role ${suffix} B`,
      code, // trùng code
      permissionIds: [],
    });

    expect(second.json.status).toBe("fail");
    expect(second.json.messageCode).toBe("ROLE_CODE_EXIST");
  });
});
