# @toolnest/react-module-sdk

ToolNest React 模块的运行时契约。模块入口默认导出 `ToolNestReactFrontendModule`，在 `install` 中通过上下文注册路由、菜单、权限和 Dashboard widget。

路由使用模块相对路径（`''`、`'settings'`），平台会统一挂载到 `/modules/<moduleId>/...`；菜单使用绝对路径。模块入口只依赖 React Module SDK，不要直接修改平台路由。React 运行时和平台批准的公共依赖由 Host 以共享 Runtime ESM 提供，模块只需要把业务依赖打进自己的入口或相对 chunk。

对应 `manifest.json` 的 `frontend` 必须显式声明 `"framework": "react"`；未声明或使用其他前端框架的模块会被平台拒绝加载。

模块实例由 `(moduleId, releaseId)` 标识。`install(context)` 收到的上下文包含 `releaseId` 和 `AbortSignal`；模块发起的请求应使用 `context.apiClient`，定时器、事件监听器、WebSocket、轮询和自建 Store 应通过 `context.onDispose()` 注册清理。

`registerRoutes`、`registerMenus`、`registerPermissions` 和 `registerDashboardWidgets` 都返回 disposer。模块可以主动调用，也可以依赖宿主在卸载时自动调用。`uninstall(context)` 是补充钩子，不能替代资源注册和自动清理协议。

## 依赖与共享运行时

React 模块依赖分成两类：

| 类型 | 处理方式 | 当前范围 |
| --- | --- | --- |
| Host 共享依赖 | 模块构建时 externalize，浏览器通过 Host import map 加载同一份 Runtime ESM | `react`、`react-dom`、`react-dom/client`、`react/jsx-runtime`、`react/jsx-dev-runtime`、`@tanstack/react-query`、`react-router-dom`、`@toolnest/react-module-sdk`、`axios`、`sonner`、`zod` |
| 模块业务依赖 | 由模块自行安装并打包到 `.tnmod`，不能假定 Host 存在 | 业务 SDK、图表、编辑器、日期库、领域组件和未列入共享清单的 UI/图标库 |

共享清单是精确的 import-map specifier 白名单，不是“所有 `node_modules` 都共享”。当前 Host 的版本以 `frontend-react/package.json` 和构建产物为准；模块必须使用兼容版本，并在 `manifest.json` 的 `frontend.shared_dependencies` 中声明实际 externalize 的 specifier。未知 specifier 会被后端 Manifest 校验拒绝。

模块构建推荐使用 SDK 提供的 Vite 判断函数：

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { isToolNestReactSharedDependency } from '@toolnest/react-module-sdk/vite'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/index.tsx', formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: {
      external: isToolNestReactSharedDependency,
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => assetInfo.name?.endsWith('.css') ? 'style.css' : '[name][extname]',
      },
    },
  },
})
```

发布前必须检查：

1. 构建产物仍是可被浏览器直接加载的 ESM，并且没有把 `node_modules` 的绝对路径写入文件。
2. 共享依赖只出现在 import 语句中，未共享的业务依赖和其相对 chunk 仍在模块包内。
3. `frontend.shared_dependencies` 与实际 externalize 结果一致；没有声明的共享包不能被 externalize。
4. 使用与 Host 兼容的 React/ReactDOM 版本，避免出现两份 React 导致 Hooks 或 Context 错误。
5. 使用 `pnpm build` 后通过 Host preview 或集成环境实际访问模块；开发时 Host 会把同一组 specifier 映射到 Vite dev modules，但仍不能只用独立静态服务器验证入口。

共享 Runtime 文件属于 Host 发布物，模块不能复制、覆盖或通过 CDN 替换。若模块必须使用不在清单中的版本，优先把该依赖作为模块私有依赖打包；若连 React 核心 ABI 都不兼容，则不能由当前 React Host 加载，应升级模块或等待 Host 发布兼容的共享 Runtime。共享依赖只解决重复下载和重复实例问题，不提供安全沙箱，也不能让浏览器真正回收已经执行的 ESM。
