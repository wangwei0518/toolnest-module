/** Module validation responses are sanitized by the backend; never display raw server failures. */
export function getTransferErrorMessage(error: unknown, fallback: string): string {
  const response = error && typeof error === "object" && "response" in error
    ? (error as { response?: { status?: number; data?: { message?: unknown } } }).response : undefined;
  if (response?.status === 401) return "登录状态已失效，请重新登录后重试。";
  if ([403,404].includes(response?.status ?? 0) && typeof response?.data?.message === "string" && ["取件码无效或投递已失效", "提取码无效或投递已失效", "投递不存在或已失效", "文件不可用或已达到授权次数限制"].includes(response.data.message)) return response.data.message;
  if (response?.status === 403) return response.data?.message === "宿主未传递管理员身份，请升级或重启 ToolNest 宿主后端。"
    ? response.data.message : "当前账号无权执行此操作；修改存储设置需要管理员权限。";
  if (response?.status === 429) return "请求过于频繁，请稍后重试。";
  const message = response
    ? [400, 409, 413, 422, 507].includes(response.status ?? 0) ? response.data?.message : undefined
    : error instanceof Error ? error.message : undefined;
  if (typeof message !== "string" || message.length > 200 || !/[\u3400-\u9fff]/.test(message) || /https?:\/\//i.test(message) || Array.from(message).some((character) => character.charCodeAt(0) < 32)) return fallback;
  if (message === "尚未配置 R2 存储") return "尚未配置 R2 存储，请先在模块设置中完成配置。文字和链接投递不受影响。";
  return message;
}
