# 工单模板 React 模块

工作流工单与项目协作

这是 ToolNest React 运行时的工单与项目协作模块，提供工单、流程模板、节点运行、日程、项目、里程碑、定时任务、通知规则、自动化和数据迁移能力。平台运行独立 Go 进程并通过网关转发请求。业务数据存放于 PostgreSQL，附件保存在 `TOOLNEST_PLUGIN_DATA_DIR`。

## 目录结构

```text
workflow-tickets-react/
  manifest.json
  README.md
  backend-go/
    go.mod
    main.go
    schema.sql
  frontend/
    components.json
    package.json
    tsconfig.json
    vite.config.ts
    src/
      components/
      lib/
      types/
      app.tsx
      index.tsx
      menu.ts
      permissions.ts
      routes.tsx
      styles.css
```

## 开发边界

- 模块源码位于 `modules/workflow-tickets-react/`。
- React 模块只能注册一个主菜单入口；更多页面使用模块内部路由和导航。
- 前端通过 `@toolnest/react-module-sdk` 使用宿主能力，不能导入 `frontend-react/src` 的私有路径。
- 后端以独立 Go 进程运行，通过平台网关提供业务 API。模块启用时，后台调度随平台启动。
- 运行数据写入 `TOOLNEST_PLUGIN_DATA_DIR`，不要写入模块源码或发布包。
- 模块私有设置使用 `/module-settings`，避免与平台保留的 `/settings` 管理 API 冲突。

## 开发和验证

从仓库根目录执行：

```bash
pnpm install
pnpm --dir modules/workflow-tickets-react/frontend typecheck
pnpm --dir modules/workflow-tickets-react/frontend build
go -C modules/workflow-tickets-react/backend-go test ./...
go -C modules/workflow-tickets-react/backend-go vet ./...
```

打包和应用：

```bash
pnpm package:module -- --id workflow-tickets-react --no-version-bump --target linux/amd64
```

按宿主架构选择包。使用运行时安装或升级接口导入 `.tnmod` 并轮询操作结果，验证过程使用专用 PostgreSQL 库和模块数据目录。

平台的 `pnpm ui:check` 和浏览器回归命令在 ToolNest 主仓库执行。

## 迁移验收

- 数据兼容、验证步骤和回退方式见 [Go 迁移方案](GO-MIGRATION.md)。
- 模块前端通过 `menu.ts` 注册一个主菜单和内部子导航；API 类型集中在 `frontend/src/api.ts`。
- 发布前执行完整平台测试、浏览器真机测试，并检查 1280×720、1440×900 的亮色/暗色截图。
