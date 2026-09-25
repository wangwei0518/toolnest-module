# {{MODULE_NAME}} React 模块

{{MODULE_DESCRIPTION}}

这是由 `templates/react-module` 生成的 ToolNest React 模块空白模板。模板只提供运行时接入、最小 Node 健康端点、React ESM 入口和 shadcn/ui 基础组件，不包含具体业务逻辑。

## 目录结构

```text
{{MODULE_ID}}/
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
      api/
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

- 模块源码位于 `modules/{{MODULE_ID}}/`。
- React 模块只能注册一个主菜单入口；更多页面使用模块内部路由和导航。
- 前端通过 `@toolnest/react-module-sdk` 使用宿主能力，不能导入 `frontend-react/src` 的私有路径。
- 后端以独立 Node 进程运行；只通过平台网关提供业务 API。
- 运行数据写入 `TOOLNEST_PLUGIN_DATA_DIR`，不要写入模块源码或发布包。
- 模板没有默认数据库。需要持久化时，再按开发指南增加 PostgreSQL schema、迁移和 repository；不要为了模板示例引入无用数据库依赖。

## 开发和验证

从仓库根目录执行：

```bash
pnpm install
pnpm --dir modules/{{MODULE_ID}}/frontend typecheck
pnpm --dir modules/{{MODULE_ID}}/frontend build
pnpm --dir modules/{{MODULE_ID}}/backend typecheck
pnpm --dir modules/{{MODULE_ID}}/backend build
pnpm ui:check
```

打包和应用：

```bash
pnpm package:react-module --id {{MODULE_ID}}
```

然后在 React 平台的“模块管理”中导入生成的 `.tnmod` 包。开发环境也可以通过运行时模块安装接口导入；不要直接把源码目录映射到生产模块数据目录。

## 下一步

1. 在 `frontend/src/routes.tsx` 增加业务页面路由。
2. 在 `frontend/src/api/` 增加带类型的 API 函数。
3. 在 `backend/src/main.ts` 增加薄路由，并把业务逻辑拆到 service/repository。
4. 需要跨页面能力时再增加权限、通知、Dashboard widget 或数据库迁移。
5. 按 [`docs/modules/runtime/react-module-development-guide.md`](../../docs/modules/runtime/react-module-development-guide.md) 和 [`docs/modules/runtime/react-module-migration-guide.md`](../../docs/modules/runtime/react-module-migration-guide.md) 完成设计、开发和验收。
