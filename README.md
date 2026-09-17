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

目录只保存模块元数据；安装时 ToolNest 会从对应 Release 下载 `.tnmod`，校验 SHA-256 后再进入运行时安装队列。

发布前应先提交对应模块版本变更，再手动运行 `Publish ToolNest modules` workflow。workflow 默认生成 `module-release-<run_number>` Release，也可以传入自定义 tag。
