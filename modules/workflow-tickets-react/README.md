# 工单模板 React 模块

工作流工单与项目协作

这是 ToolNest React 运行时的工单与项目协作模块，提供工单、流程模板、节点运行、日程、项目/里程碑、定时任务、通知规则、自动化和数据迁移能力。模块使用独立 Node 进程和 `TOOLNEST_PLUGIN_DATA_DIR` 下的 JSON 数据存储，业务请求统一经过平台 Gateway。

## 目录结构

```text
workflow-tickets-react/
  manifest.json
  README.md
  backend/
    package.json
    tsconfig.json
    src/
      config.ts
      main.ts
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
- 后端以独立 Node 进程运行；只通过平台网关提供业务 API。
- 运行数据写入 `TOOLNEST_PLUGIN_DATA_DIR`，不要写入模块源码或发布包。
- 模块私有设置使用 `/module-settings`，避免与平台保留的 `/settings` 管理 API 冲突。

## 开发和验证

从仓库根目录执行：

```bash
pnpm install
pnpm --dir modules/workflow-tickets-react/frontend typecheck
pnpm --dir modules/workflow-tickets-react/frontend build
pnpm --dir modules/workflow-tickets-react/backend typecheck
pnpm --dir modules/workflow-tickets-react/backend build
pnpm ui:check
pnpm --dir modules/workflow-tickets-react/backend exec tsx --test test/service.test.ts
```

打包和应用：

```bash
pnpm package:react-module --id workflow-tickets-react
```

然后在 React 平台的“模块管理”中导入生成的 `.tnmod` 包。开发环境也可以通过运行时模块安装接口导入；不要直接把源码目录映射到生产模块数据目录。

## 迁移验收

- 行为对照表：[workflow-tickets-react-behavior-matrix.md](../../docs/modules/runtime/workflow-tickets-react-behavior-matrix.md)
- 模块前端通过 `menu.ts` 注册一个主菜单和内部子导航；API 类型集中在 `frontend/src/api.ts`。
- 发布前执行完整平台测试、浏览器真机测试，并检查 1280×720、1440×900 的亮色/暗色截图。
