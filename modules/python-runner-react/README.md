# Python Runner React 模块

这是面向 ToolNest React 平台的新 Python Runner 实现，与旧 Vue 模块 `modules/python-runner` 分开维护。

当前版本已包含：

- React ESM 动态前端入口；
- 独立 Node 运行时进程；
- 模块专用 PostgreSQL 表迁移；
- PostgreSQL 持久化的项目仓库、release 更新/回滚和存储统计；
- ZIP 安全解压、只读源码预览、静态安全扫描和风险确认；
- 内联/项目 Python 执行、参数限制、超时、输出截断、停止、重跑、日志和执行历史；
- Cron/一次性定时任务，支持 IANA 时区、启停、立即运行和持久化统计；
- 常驻任务、自动启动、失败重启策略、日志和生命周期事件；
- JSON/YAML 配置读取与覆盖保存，敏感字段脱敏并保留原值；
- React 页面：总览、快速运行、项目仓库、项目详情、执行记录、定时任务和常驻任务；
- 运行时模块级加载/卸载，前端 ESM 与后端独立 Node 进程分别由宿主治理。

当前状态：首轮功能纵向切片和宿主真实浏览器流程已完成，模块后端集成测试、React/新后端类型检查、Lint、构建和模块包校验已通过；发布前仍需完成宿主安装升级回滚、跨 PC 验证矩阵和性能基准记录。

生成可导入包：

```bash
pnpm package:python-runner-react
```

产物位于 `module-react/python-runner-react/dist/python-runner-2.0.0.tnmod`。导入 React 平台后，模块默认停用；在“模块管理”中启用即可。

完整迁移范围、API、数据库、进程治理、安全、性能和测试门禁见：

[Python Runner React 模块迁移开发文档](../../docs/modules/python-runner/python-runner-react-migration-development.md)
