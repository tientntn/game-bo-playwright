// Chọn ngẫu nhiên 1 option của Ant Select theo id của input (vd: "roleIds")
async function selectRandomOption(page, id) {
  await page
    .locator(".ant-select")
    .filter({ has: page.locator(`#${id}`) })
    .click();

  const options = page.locator(
    `.ant-select-dropdown:has(#${id}_list) .ant-select-item-option:not(.ant-select-item-option-disabled)`,
  );
  await options.first().waitFor();

  const count = await options.count();
  const option = options.nth(Math.floor(Math.random() * count));
  await option.click();
}

module.exports = { selectRandomOption };
