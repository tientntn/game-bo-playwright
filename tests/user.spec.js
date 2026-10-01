// login.spec.js
const { test, expect } = require("@playwright/test");
import { format } from "date-fns";
const timestamp = format(new Date(), "yyyyMMddHHmmss");
const random = `${timestamp.substring(6)}`;

test("Create user success", async ({ page }) => {
  await page.goto("/admin/users/create");

  await page.getByRole("textbox", { name: "* Username :" }).click();
  await page
    .getByRole("textbox", { name: "* Username :" })
    .fill("tien" + random);
  await page.getByRole("textbox", { name: "* Real Name :" }).click();
  await page.getByRole("textbox", { name: "* Real Name :" }).fill("nguyen");
  await page.getByRole("textbox", { name: "* Real Name :" }).press("Tab");
  await page.locator(".ant-select-selection-overflow").click();
  await page.getByText("ADMIN_1").click();
  await page.getByText("test", { exact: true }).click();
  await page.locator(".form-entity").click();
  await page.getByRole("textbox", { name: "Email :" }).click();
  await page
    .getByRole("textbox", { name: "Email :" })
    .fill("tien" + random + "@gmail.com");
  await page.locator("#phoneCode").click();
  await page.locator("#phoneCode").fill("84");
  await page.getByTitle("+").locator("div").click();
  await page.getByRole("textbox", { name: "Enter the phone" }).click();
  await page
    .getByRole("textbox", { name: "Enter the phone" })
    .fill("978122944");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Create Password").click();
  await page.getByRole("textbox").click();
  await page.getByRole("textbox").fill("Admin@123");
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByText("User successfully created")).toBeVisible({
    timeout: 10000,
  });
});

test("View house", async ({ page }) => {
  await page.goto("/house");

  await page.getByRole("menuitem", { name: "Houses" }).click();
  await page.getByRole("link", { name: "Houses" }).click();

  await page.locator(".NextGen-filter-dropdown__control").first().click();
  await page.getByText("royaleadge - Royal Edge House").click();

  await page.getByRole("button", { name: "search Search" }).click();

  // Kiểm tra xem có ít nhất 1 dòng dữ liệu xuất hiện hay không
  await expect(page.locator("tbody tr.ant-table-row").first()).toBeVisible({
    timeout: 10000,
  });

  await expect(page.getByRole("cell", { name: /royaleadge/i })).toBeVisible();
});
