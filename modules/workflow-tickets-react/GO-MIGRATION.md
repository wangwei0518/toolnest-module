# 工单模块 Go 迁移

工单模块由平台启动独立进程，React 通过平台网关调用模块 HTTP API。旧 Node 后端将业务数据和临时资源以 JSONB 写入 PostgreSQL，并将附件文件保存在模块数据目录。后台循环处理定时工单、提醒、项目通知和临时资源过期。

## 迁移方案

1. 保留模块 ID、数据库 schema、现有表和 JSON 字段。Go 直接读写相同的实体、排序和设置记录。仅在数据库尚未初始化时导入旧版 `workflow-store.json`。保留未知 JSON 字段，以兼容前后版本。
2. 将业务迁移到 Go，按模板与节点流转、项目与日程、工作流自动化、附件与资源、导入导出拆分。保留 API 路径、响应结构、状态码与内部鉴权，统一为定时执行和 HTTP 更新提供事务边界。计划时间、运行记录和自动创建的工单在同一事务内提交。
3. 保留后台随平台启动的配置。用平台的原生可执行入口打包 Linux amd64、Linux arm64 和 Windows amd64，维持 HTTP 就绪探针、模块网关、升级回滚和数据目录。
4. 在隔离的 PostgreSQL 与模块目录验证 Node → Go → Node。重点覆盖历史工单、已发布模板、下一次执行时间、活动记录、附件和新旧版本相互读写。通过平台接口安装并轮询操作，验证后台在没有页面访问时创建到期工单，并验证重启不会重复创建。
5. 完成 API 和运行时验证之后，移除旧 Node 后端、其 workspace 依赖与专项构建脚本引用。保留嵌入 Go 的 SQL 迁移和历史数据兼容路径。

## 验收

- 单元测试覆盖规则、节点完成与回退、时区和月度周期、字段与附件限制。
- PostgreSQL 集成测试覆盖旧数据读取、提交失败回滚、升级后写入及历史保留。
- 通过原生进程验证认证、就绪、后台任务、文件读写与正常停机。
- 打包验证三种目标平台，平台端验证安装、升级和回滚，再提交推送。

## 测试与回退

通过环境变量 `TOOLNEST_WORKFLOW_TEST_DATABASE_URL` 向 Go 测试提供独立 PostgreSQL 库。测试会创建并清理自身的 schema。

```sh
go -C modules/workflow-tickets-react/backend-go test -race ./...
go -C modules/workflow-tickets-react/backend-go vet ./...
pnpm package:module -- --id workflow-tickets-react --no-version-bump --target linux/amd64
pnpm budget:check -- --id workflow-tickets-react --target linux/amd64
node modules/workflow-tickets-react/test/go-host-migration.mjs <Node版.tnmod> <Go版-linux-amd64.tnmod>
```

换版测试脚本创建独立 Docker 宿主、PostgreSQL 容器及网络，然后通过安装、升级和回退接口上传包，并轮询各次操作。可用 `TOOLNEST_TEST_IMAGE` 选择本机宿主镜像。旧版包可从历史发布目录取得。正式换版前停用模块并备份模块 PostgreSQL 数据和附件目录。使用平台回退接口恢复上一版模块包，保留同一模块 ID 和数据目录。

本机使用已发布的 Node `0.1.136` 包与 Go `0.1.137` 的 Linux amd64 包通过换版测试。换版及宿主重启后，旧工单、附件、设置和待执行任务可读。重启后首次访问模块前已完成定时执行，重新启用模块后运行记录仍只有一条。回退到 Node 后验证了 Go 写入的工单、节点状态、定时运行记录和原附件。Linux arm64 和 Windows amd64 包通过交叉构建和包体检查。

Go 版从数据库提交后再调用平台通知接口。节点通知动作记录投递结果。平台通知仍采用尽力投递方式，进程在数据库提交和通知请求之间退出时不会自动补发。模块数据兼容机制与正式包切换过程不依赖这个投递步骤。
