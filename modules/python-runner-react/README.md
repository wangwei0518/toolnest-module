# Python Runner

Python Runner 使用 React 前端、Go 原生模块进程和 PostgreSQL。模块随 ToolNest 启动，定时任务和设为自动启动的常驻任务由后端调度。运行项目仍需系统 Python，可以单独为各项目创建虚拟环境。

主要功能包括项目 ZIP 导入、版本更新与回滚、源码预览、安全风险确认、依赖安装及日志、单次执行、Cron 和常驻任务。配置编辑支持 JSON 和 YAML，界面会遮盖敏感值。

## 开发和打包

在模块仓库根目录运行：

```bash
go -C modules/python-runner-react/backend-go test -race ./...
go -C modules/python-runner-react/backend-go vet ./...
pnpm package:module --id python-runner --module-dir python-runner-react --no-version-bump --target linux/amd64
pnpm budget:check --id python-runner --target linux/amd64
```

也可打包 `linux/arm64` 和 `windows/amd64`。产物在 `modules/python-runner-react/dist`。安装或升级通过 ToolNest 运行时模块 API 完成，须等待操作成功。

数据库集成测试使用 `PYTHON_RUNNER_TEST_DATABASE_URL` 指定独立的 PostgreSQL 测试库，并在临时 schema 创建测试数据。真实升级回归使用 `node test/python-runner-go-upgrade.mjs <旧版包> <Go版包>`，需要 Docker 和预构建的 ToolNest Go 平台镜像。通过 `TOOLNEST_GO_TEST_IMAGE` 指定镜像标签。

[迁移方案与验收](backend-go/MIGRATION.md)
