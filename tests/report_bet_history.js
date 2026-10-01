// login.spec.js
const { test, expect } = require("@playwright/test");

test("Bet History Report reset filter", async ({ page }) => {
  await page.goto("/report/bet-history");

  await page.getByText("All Record").click({ timeout: 3000 });
  await page.getByText("External Party Only").click();
  await page.locator("#settledTime_dateRange").click();
  await page
    .getByRole("option", { name: "Choose Friday, August 21st," })
    .click();
  await page
    .getByRole("option", { name: "Choose Wednesday, September 23rd," })
    .click();

  // Popover Settled Time không tự đóng khi chọn xong ngày. Component này
  // đóng popover bằng listener click/mousedown ở ngoài (không phải sự kiện
  // blur trên input) nên gọi el.blur() bằng JS không có tác dụng - phải
  // click thật vào tiêu đề "Filter" ở trên panel để trigger đúng cơ chế đó.
  // Lọc thêm ":visible" vì có thể có bản sao "Filter" khác ẩn trong DOM.
  await page
    .locator("div:visible")
    .filter({ hasText: /^Filter$/ })
    .first()
    .click();

  // #betTime_dateRange đang rỗng nên input co lại gần như không có chiều
  // rộng, Playwright không click trực tiếp được. Click vào <label> "Bet
  // Time" thay thế (luôn hiển thị đầy đủ), giống cách đã làm với "Player
  // Name" ở dưới.
  await page.locator("label").filter({ hasText: "Bet Time" }).click();
  // Popover Settled Time đã đóng nhưng vẫn còn sót lại trong DOM (không rõ
  // cơ chế ẩn cụ thể, cả ":visible" lẫn loại trừ theo class đều không lọc
  // được). Popup của Bet Time luôn được render/append SAU, nên lấy phần tử
  // cuối cùng khớp trong DOM (.last()) sẽ luôn đúng là popup đang mở.
  await page
    .locator(".NextGen-datetime-preset__item")
    .filter({ hasText: "Today" })
    .last()
    .click({ timeout: 3000 });

  // await page
  //   .getByRole("option", { name: "Choose Thursday, August 6th," })
  //   .click({ timeout: 3000 });
  // await page
  //   .getByRole("option", { name: "Choose Monday, September 14th," })
  //   .click({ timeout: 3000 });

  // Cùng lý do như Settled Time: popover Bet Time cũng không tự đóng, phải
  // blur input này trước khi click sang filter House bên dưới.
  await page.locator("#betTime_dateRange").evaluate((el) => el.blur());

  await page
    .locator(
      "div:nth-child(5) > .NextGen-filter-dropdown > .NextGen-filter-dropdown__control",
    )
    .click();
  await page.getByText("123455").click();
  await page.getByText("Fortune").click();
  await page.getByRole("option", { name: "house 3" }).click();
  await page.getByText("house 02").click();
  await page
    .locator(
      "div:nth-child(6) > .NextGen-filter-dropdown > .NextGen-filter-dropdown__control",
    )
    .click();
  await page.locator("span").filter({ hasText: "+ 3" }).first().click();
  await page
    .getByRole("option", { name: "Royal Edge House" })
    .locator("div")
    .click();
  await page.getByText("quynhbn").click();
  await page
    .locator(
      "div:nth-child(6) > .NextGen-filter-dropdown > .NextGen-filter-dropdown__control",
    )
    .click();
  await page.getByText("130820261436").click();
  await page.getByText("abc.com").click();
  await page.getByText("LalaMasterAgent02").click();
  await page
    .getByRole("option", { name: "Royal Edge Master" })
    .locator("div")
    .click();
  await page.getByText("Test MA 4").click();
  await page
    .locator(
      "div:nth-child(7) > .NextGen-filter-dropdown > .NextGen-filter-dropdown__control",
    )
    .click();
  await page.getByText("Reverse Proxy QA").click();
  await page.getByText("Royal Edge UAH").click();
  await page.getByText("Royal Edge 1").click();
  await page.locator("label").filter({ hasText: "Player Name" }).click();
  await page.locator("#playerName").fill("abc");
  await page
    .locator(
      "div:nth-child(9) > .NextGen-filter-dropdown > .NextGen-filter-dropdown__control",
    )
    .click();
  await page.getByText("Fishing").click();
  await page.getByText("Poker").click();
  await page.getByText("Mini Games").click();
  await page.getByRole("option", { name: "Slots" }).locator("div").click();
  await page
    .locator(
      "div:nth-child(10) > .NextGen-filter-dropdown > .NextGen-filter-dropdown__control",
    )
    .click();
  await page.getByText("AVIATORX - AviatorX").click();
  await page.getByText("123GAME -").click();
  await page.getByText("ABDBS - Lucky Rainbow1132 !@#").click();
  await page.getByRole("option", { name: "- game name test 123 456" }).click();
  await page
    .locator("div")
    .filter({ hasText: /^Round ID$/ })
    .nth(2)
    .click();
  await page.locator("#roundId").fill("11");
  await page
    .locator("div")
    .filter({ hasText: /^Bet ID$/ })
    .nth(2)
    .click();
  await page.locator("#betId").fill("12");
  await page
    .locator(
      "div:nth-child(13) > .NextGen-filter-dropdown > .NextGen-filter-dropdown__control",
    )
    .click();
  await page.getByText("AAA", { exact: true }).click();
  await page.getByRole("option", { name: "AAAA", exact: true }).click();
  await page.getByRole("option", { name: "AAAAB" }).click();
  await page.getByRole("option", { name: "AABB" }).click();
  await page
    .locator(
      "div:nth-child(14) > .NextGen-filter-dropdown > .NextGen-filter-dropdown__control",
    )
    .click();
  await page.getByRole("option", { name: "Bet" }).click();
  await page.getByRole("option", { name: "Settled" }).locator("div").click();
  await page
    .locator(
      "div:nth-child(15) > .NextGen-filter-dropdown > .NextGen-filter-dropdown__control",
    )
    .click();
  await page.getByRole("option", { name: "Success" }).locator("div").click();
  await page.getByText("Fail", { exact: true }).click();
  await page.getByText("Game Under Maintenance").click();
  await page
    .locator(
      "div:nth-child(16) > .NextGen-filter-dropdown > .NextGen-filter-dropdown__control",
    )
    .click();
  await page.getByText("Freespin").click();
  await page.getByText("Progressive").click();
  await page.getByRole("option", { name: "Normal" }).locator("div").click();
  await page.getByRole("button", { name: "close Reset" }).click();

  // Mỗi filter trong thanh filter bar thuộc 1 trong 3 loại control:
  // - .NextGen-filter-datetime-picker (Settled Time, Bet Time...)
  // - .NextGen-filter-input (Player Name, Round ID, Bet ID...)
  // - .NextGen-filter-dropdown (Timezone, Record Scope, House, ...)
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const todayStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
  // Settled Time là filter bắt buộc, Reset đưa nó về mặc định "hôm nay"
  // (00:00:00 - 23:59:59), không rỗng - đã xác nhận đây là hành vi đúng.
  // Bet Time thì ngược lại, là filter optional nên Reset xong sẽ rỗng thật.
  const todayFullDayRange = `${todayStr} 00:00:00 - ${todayStr} 23:59:59`;
  const dateRangeDefaults = {
    "Settled Time": todayFullDayRange,
    "Bet Time": "",
  };

  const filterElements = page.locator(
    ".NextGen-filter-bar__items > .NextGen-filter-element",
  );
  const filterCount = await filterElements.count();

  for (let i = 0; i < filterCount; i++) {
    const el = filterElements.nth(i);
    const label = (
      (await el.locator("label").first().innerText()) || ""
    ).trim();

    // 1. Date range: Settled Time về mặc định "hôm nay", Bet Time về rỗng
    if ((await el.locator(".NextGen-filter-datetime-picker").count()) > 0) {
      const expected = Object.prototype.hasOwnProperty.call(
        dateRangeDefaults,
        label,
      )
        ? dateRangeDefaults[label]
        : "";
      await expect(
        el.locator(".NextGen-filter-datetime-picker__control input"),
        `${label}: chưa được reset đúng`,
      ).toHaveValue(expected);
      continue;
    }

    // 2. Input text: phải rỗng sau Reset
    if ((await el.locator(".NextGen-filter-input").count()) > 0) {
      await expect(
        el.locator(".NextGen-filter-input__control input"),
        `${label}: chưa được reset`,
      ).toHaveValue("");
      continue;
    }

    // 3. Dropdown (select)
    const dropdown = el.locator(".NextGen-filter-dropdown");
    if ((await dropdown.count()) === 0) continue;

    if (label.includes("*")) {
      // Field bắt buộc (Timezone*, Record Scope*) luôn có giá trị mặc định
      // sau Reset, KHÔNG rỗng -> chỉ kiểm tra vẫn còn đúng 1 item được chọn.
      await expect(
        dropdown.locator(".ant-select-selection-item"),
        `${label}: phải còn giá trị mặc định sau Reset`,
      ).toHaveCount(1);
    } else {
      // Các dropdown còn lại (House, Master Agent, Agent, Game Category,
      // Game, Currency, Record Type, Operator Status, Bet Type, Misc,
      // Sweepstake...) phải rỗng hoàn toàn sau Reset.
      await expect(
        dropdown.locator(".ant-select-selection-item"),
        `${label}: vẫn còn option được chọn sau khi bấm Reset`,
      ).toHaveCount(0);
      await expect(
        dropdown.locator(".ant-select-selection-placeholder"),
      ).toBeAttached();
      await expect(dropdown.locator(".ant-select-clear")).toBeHidden();
    }
  }
});
