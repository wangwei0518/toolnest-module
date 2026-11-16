const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (typeof input === "string" && input.includes("/public/")) {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { code?: string };
    if (payload.code !== "123456") return Response.json({ message: "提取码无效或投递已失效" }, { status: 403 });
    if (input.endsWith("/verify")) return Response.json({ title: "项目资料", content: "https://example.com", expiresAt: Date.now() + 86400000, files: [{ id: "example", filename: "项目资料.zip", size: 12345 }] });
    return Response.json({ message: "预览模式不下载文件" }, { status: 400 });
  }
  return originalFetch(input, init);
};
await import("./guest");
export {};
