# 文件邮局 Go 后端重构方案

将文件邮局的 Node.js 后端替换为独立的 Go HTTP 进程。沿用平台现有的 `native` 模块协议。React 前端继续调用当前接口，模块标识、访问地址和权限名称保持兼容。

| 层 | 实现 | 验收依据 |
| --- | --- | --- |
| 进程 | 回环监听、内部 token、就绪检查、信号和 HTTP 关停。Windows 与 Linux 复用平台原生模块包规范 | 打包后检查平台启动、停止、升级和回退 |
| 数据 | 保留 SQLite 表结构、时间戳单位、元数据、两个签名密钥、配置文件与本地文件目录。旧库只使用与 Node 版兼容的增量迁移 | 使用 Node 版生成数据库、分享码、未完成分片和已签发本地链接，由 Go 版读取，随后回退读取 Go 版数据 |
| API | 保持接口、输入约束、JSON 字段、错误状态与公开页面的安全头。下载授权和配额在 SQLite 事务中更新 | 回归发件、取件、期限、上传续传、授权和清理 |
| 存储 | 本地分片沿用目录与原子提交；R2 继续使用 S3 兼容接口，浏览器直传 | 校验本地分片和 Range 下载；使用模拟 S3 服务验证 R2 请求和预签名 |
| 交付 | 原生包按既有流程构建 Linux amd64、Linux arm64、Windows amd64。CI 增加 Go 测试和静态检查 | 检查所有目标二进制和包体预算，再用本机宿主安装 API 验证真实 release |

采用纯 Go SQLite 驱动以支持无 CGO 构建，R2 使用 AWS 的 Go SDK。SQLite 继续承载安装升级之间共享的数据。旧 Node 实现可从 Git 历史构建，已部署的上一版 release 可用于回退。


## 评估与迁移步骤

- 保留 SQLite 避免新增 PostgreSQL 依赖或执行数据导出导入。移除独立 Node 进程和其 AWS SDK 依赖，保留现有密钥格式和路径。下载授权与文件配额仍由事务约束。
- 纯 Go SQLite 和 S3 客户端使原生包可直接跨架构编译，但比原 Node 包大。三目标合包实测约 16.65 MiB，目录按平台分发单目标包。单目标包仍受原预算检查。
- 在升级前暂停新的投递、上传和取件，备份完整模块数据目录，包含 SQLite 主文件及可能存在的 WAL、配置、密钥和本地对象。备份应在模块停写后取得。
- Linux 上使用平台升级接口导入对应目标包并等到 operation 完成。检查旧记录、已有分享链接和待续传文件。需要回退时用平台回退接口选择上一版 release，并轮询结果。完成迁移后恢复新投递。

- Windows 上从旧 Node 版升级时，先在平台停用模块。如果旧进程因缺少 Windows 协作关停而提示未能正常停止，等待宿主完成停止操作，再执行一次停用。确认状态为已停用后，备份数据、导入 Go 包，再启用。不要卸载模块来解决停机超时。
- 已在 Windows 验证上述流程以及回退到 Node 版。Go 版启用内部 HTTP 关停，后续停用和升级可正常排空请求。备份和回退操作应使用同一个独立模块标识。

## 开发验证

从仓库根目录运行：

```sh
go -C modules/temporary-transfer/backend-go test -race ./...
go -C modules/temporary-transfer/backend-go vet ./...
pnpm package:module -- --id temporary-transfer --no-version-bump --target linux/amd64
node scripts/check-module-budgets.mjs --id temporary-transfer --target linux/amd64
```

在独立数据库和空模块目录的本机宿主上执行：

```sh
node modules/temporary-transfer/test/go-host-migration.mjs http://127.0.0.1:8190 <Node版.tnmod> <Go版.tnmod>
```

脚本创建测试账户，通过上传接口安装并轮询每次换版。Linux 验证覆盖旧文本和取件码、跨版本恢复两片上传、旧签名 PUT、访客资源、Range 读取，以及回退后访问 Go 写入的内容和签发的下载链接。Windows 已验证原生包安装、停用和再启用，并用相同脚本加 `--legacy-windows` 复现旧版停用、换版与回退。Linux arm64 已交叉构建和校验目标包。R2 使用本地 S3 模拟服务验证分页、合并、清理和预签名，本次未使用真实存储桶。
