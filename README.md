# ToolNest 模块仓库

这里维护可被 ToolNest 运行时安装的独立模块。模块以完整的 `.tnmod` 发布包交付，平台不会把源码编译进主程序。

## 当前模块

- `workflow-tickets-react`：工单模板与项目协作。模块 ID 保持不变，以兼容已有安装记录。
- `python-runner-react`：Python 项目运行、调度和环境管理。模块 ID 为 `python-runner`。

目录结构：

```text
modules/<module-id>/
├── manifest.json
├── frontend/       # 独立 ESM 前端
├── backend/        # 独立 Node.js 运行时
└── dist/           # 本地生成的 .tnmod，不提交到 Git
```

## 本地开发

环境要求：Node.js 22、pnpm 10。

```bash
pnpm install
pnpm create:module --id demo-module --name 示例模块
pnpm typecheck:modules
pnpm build:modules
pnpm package:module -- --id workflow-tickets-react --no-version-bump
```

开发模块页面时，在 ToolNest 主仓库的 React Host 中配置对应的开发入口，例如：

```bash
VITE_WORKFLOW_TICKETS_REACT_DEV_ENTRY=http://127.0.0.1:5175/src/index.tsx
```

模块通过 `@toolnest/react-module-sdk` 使用宿主公开能力。SDK 是本仓库的构建依赖，发布包中的前端仍由 ToolNest Host 提供共享运行时。

## 远程订阅

GitHub Actions 会构建每个模块、创建 GitHub Release，并生成目录文件。ToolNest 中添加以下来源即可订阅当前目录：

```text
https://raw.githubusercontent.com/wangwei0518/toolnest-module/main/catalog.json
```

官方目录统一使用 `catalog.json`，其格式版本为 `schema_version: 2`。原生模块按平台列出安装包，ToolNest 从对应 Release 下载 `.tnmod` 并校验 SHA-256 后进入安装队列。`catalog-v2.json` 是供仍请求旧地址的宿主读取的迁移快照，之后的新发布会写入 `catalog.json`。

推送到 `main` 后，`Publish ToolNest modules` workflow 会自动识别受影响模块。若提交中尚未更新版本，则为受影响模块递增补丁版本。工作流构建并验证发布包，上传 GitHub Release 后更新 `catalog.json`。Action 生成的版本与目录提交带有 `[skip ci]`，不会形成发布循环。

也可以手动运行该 workflow，并按需提供自定义 Release tag。默认 tag 格式为 `module-release-<run_number>-<run_attempt>-<short_sha>`。
