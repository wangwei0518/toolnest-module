# React 模块源码

`module-react/` 只存放面向 React 新平台的模块源码，按模块独立目录组织：

```text
module-react/<module-id>/
├── manifest.json
├── frontend/       # React + TypeScript ESM
├── backend/        # 独立进程后端
└── dist/            # 可选的 .tnmod 发布产物
```

旧 Vue/兼容模块继续放在 `modules/`，两者不混用：

- `modules/`：旧 Vue 平台和仓库内置模块；
- `module-react/`：React 新平台模块源码；
- `data/plugins/`：平台运行期间安装的 `.tnmod` 模块及 release 数据，不属于源码目录。

React 模块必须通过 `@toolnest/react-module-sdk` 接入宿主，不能依赖旧 Vue SDK，也不能把业务代码编译进 `frontend-react` 或 `backend-react` 主程序。

当前示例模块：

- [Python Runner React](./python-runner-react/)

新模块请从仓库根目录使用 `templates/react-module` 生成，不要复制示例模块的业务代码：

```bash
pnpm create:react-module --id demo-module --name 示例模块 --description "示例 React 模块"
```

开发、打包和验收规范见：

- [React 模块开发指南](../docs/modules/runtime/react-module-development-guide.md)
- [Vue / Python Runner 到 React 模块迁移指南](../docs/modules/runtime/react-module-migration-guide.md)

常用命令：

```bash
pnpm build:modules-react
pnpm package:python-runner-react
pnpm package:react-module --id <module-id>
```
