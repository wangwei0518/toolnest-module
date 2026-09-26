# 背屏壁纸

ToolNest React 运行时模块：上传静态图片或安卓 Live Photo，为小米手机背屏调整取景、预览、保存作品并下载生成文件。

背屏参数已按设备规格设置为 **976 × 596 px、400 PPI**。导出图使用设备像素尺寸；400 PPI 是屏幕物理像素密度，作为设备信息展示，不改变图片的像素几何。随模块提供的 1211 × 2512 设备示意图仍用于预览机身、圆角与镜头遮挡；其白色区域约 955 × 587 px，仅作为预览定位，不再决定导出尺寸。目标参数由 `frontend/src/lib/device-profile.ts` 和 `backend/src/types.ts` 管理。

## 功能与数据

- 制作与我的作品两个视图；支持拖动、缩放取景。
- 支持 JPG、PNG、WebP，以及内含 MP4 的安卓 Live Photo/MVIMG JPG；每个文件最大 30 MB。
- 静态图片导出 PNG；安卓 Live Photo 在浏览器本地裁切并重新编码 H.264 视频，输出为包含 XMP 元数据和 MP4 的 JPG。动态编码需要支持 WebCodecs/H.264 的 Chrome 或 Edge。
- 支持 GIF 转安卓动态照片 JPG（首帧 JPEG + H.264 MP4）；预览循环播放，手机图库中的播放方式由系统控制。预览图为 WebP。结果尺寸固定为 976 × 596。
- 模块只注册一个主菜单入口；通过 `@toolnest/react-module-sdk` 使用宿主 API 和确认框。
- 原图、生成图、预览图和 JSON 索引写入 `TOOLNEST_PLUGIN_DATA_DIR`，按网关注入的用户 ID 隔离。
- 上传和重新生成提供进度状态；进程重启后会续跑处理中任务。

## 开发

从 `toolnest-module` 仓库执行模块验证：

```bash
pnpm --filter @toolnest/xiaomi-rear-wallpaper-react-frontend typecheck
pnpm --filter @toolnest/xiaomi-rear-wallpaper-react-backend test
pnpm --filter @toolnest/xiaomi-rear-wallpaper-react-frontend build
pnpm --filter @toolnest/xiaomi-rear-wallpaper-react-backend build
```

在 ToolNest 仓库根目录启动 React Host 和隔离的模块 HMR 开发映射：

```bash
pnpm react:dev:xiaomi-rear-wallpaper
```

正式打包：

```bash
pnpm package:module --id xiaomi-rear-wallpaper
```

打包器会将当前构建平台与 CPU 架构所需的 Sharp 原生可选依赖一并放入 `.tnmod`。请在目标运行环境的平台上安装可选依赖并打包；跨平台发布时需分别在各目标平台构建。
