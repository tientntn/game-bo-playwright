// Reporter phụ (thêm cùng "list", không thay thế) - in ra terminal toàn bộ request/response
// (endpoint, request body, HTTP status, response JSON) của MỌI lần gọi apiPost() trong 1 test,
// nhưng CHỈ khi test đó fail - để dễ kiểm tra ngay tại sao API trả lỗi mà không cần mở HTML report.
// api-client.js đính kèm mỗi lần gọi vào testInfo qua attach("api-call", ...), reporter này chỉ
// đọc lại và in ra khi kết thúc test.
class ApiResponseReporter {
  onTestEnd(test, result) {
    if (result.status === "passed" || result.status === "skipped") return;

    const apiCalls = result.attachments.filter((a) => a.name === "api-call");
    if (apiCalls.length === 0) return;

    const title = test.titlePath().slice(1).join(" > ");
    console.log(`\n----- API responses (test failed): ${title} -----`);
    apiCalls.forEach((attachment, index) => {
      const text = attachment.body
        ? attachment.body.toString("utf-8")
        : attachment.path
          ? require("fs").readFileSync(attachment.path, "utf-8")
          : "(không đọc được nội dung attachment)";
      console.log(`[${index + 1}] ${text}`);
    });
    console.log(`----- end API responses: ${title} -----\n`);
  }
}

module.exports = ApiResponseReporter;
