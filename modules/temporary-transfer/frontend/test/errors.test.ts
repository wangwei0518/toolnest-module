import test from "node:test";
import assert from "node:assert/strict";
import { getTransferErrorMessage } from "../src/api/errors.ts";

const fallback = "操作失败，请重试。";

test("missing R2 and capacity errors explain why creating a transfer failed", () => {
  const error = (message: string) => ({ response: { status: 400, data: { message } } });
  assert.match(getTransferErrorMessage(error("尚未配置 R2 存储"), fallback), /模块设置/);
  assert.equal(getTransferErrorMessage(error("暂存空间不足"), fallback), "暂存空间不足");
});

test("authentication and administrator errors give actionable messages", () => {
  assert.match(getTransferErrorMessage({ response: { status: 401 } }, fallback), /重新登录/);
  assert.match(getTransferErrorMessage({ response: { status: 403 } }, fallback), /管理员/);
  assert.match(getTransferErrorMessage({ response: { status: 403, data: { message: "宿主未传递管理员身份，请升级或重启 ToolNest 宿主后端。" } } }, fallback), /宿主后端/);
});

test("raw server failures and URLs are not exposed", () => {
  assert.equal(getTransferErrorMessage({ response: { status: 500, data: { message: "服务错误 SecretAccessKey=private" } } }, fallback), fallback);
  assert.equal(getTransferErrorMessage({ response: { status: 400, data: { message: "请求 https://example.invalid/?signature=private 失败" } } }, fallback), fallback);
  assert.equal(getTransferErrorMessage(new Error("Request failed with status code 400"), fallback), fallback);
});

test("client validation and paused uploads keep their specific messages", () => {
  assert.equal(getTransferErrorMessage(new Error("上传已暂停"), fallback), "上传已暂停");
  assert.match(getTransferErrorMessage(new Error("尚未配置 R2 存储"), fallback), /文字和链接投递不受影响/);
});
