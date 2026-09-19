# 新番日历

ToolNest React 运行时模块。按档期与星期浏览 Bangumi 新番数据，维护关注/屏蔽标记，并配置季度新番和关注番放送通知。

## 功能

- 档期页：季度切换、今日放送、关注列表、搜索、地区/状态/类型筛选、评分排序、卡片/列表视图和详情侧栏。
- 周历页：七日放送分栏、地区与关注筛选、折叠/展开和详情查看。
- 设置页：真实 Bangumi 连接测试、代理、手动刷新、长剧集缓存、默认展示偏好、通知渠道/条件/模板。
- Dashboard 小组件：今日放送摘要与模块快捷入口。
- 缓存与标记：模块数据目录内原子写入 JSON；关注标记独立于上游缓存，刷新不会覆盖。

完整迁移拆解、旧模块行为矩阵和优化决策见 [`MIGRATION_ANALYSIS.md`](./MIGRATION_ANALYSIS.md)。

## 数据与运行边界

- 数据源为 Bangumi 公共 API，无需用户凭据；上游不可用时保留并回退到现有缓存。
- 可选代理支持 `http`、`https`、`socks5` 和 `socks5h`。
- 持久化文件只写入 `TOOLNEST_PLUGIN_DATA_DIR`，不写模块源码或发布包。
- 后端通过平台网关提供 API，并使用平台内部令牌发送通知；前端不直接访问外网。
- React、React DOM、TanStack Query、SDK 与 Sonner 由宿主共享，模块不打包第二份运行时。
- 模块只注册一个主菜单入口，档期、周历和设置通过模块内部路由访问。

## 权限与能力

- `anime.calendar.read`：查看档期、周历、详情、缓存状态和设置。
- `anime.calendar.update`：刷新数据、修改关注标记和保存设置。
- `notifications.send` capability：由后端调用平台内部通知接口发送测试通知与定时通知。

## 本地开发

```bash
pnpm install
pnpm --dir modules/anime-calendar-react/backend test
pnpm --dir modules/anime-calendar-react/backend typecheck
pnpm --dir modules/anime-calendar-react/backend build
pnpm --dir modules/anime-calendar-react/frontend test
pnpm --dir modules/anime-calendar-react/frontend typecheck
pnpm --dir modules/anime-calendar-react/frontend build
```

正式交付包从仓库根目录生成：

```bash
pnpm package:module --id anime-calendar-react
```

生成的 `.tnmod` 必须通过 ToolNest 运行时安装/升级接口上传，并轮询 operation 到明确成功或失败；不能只复制前端 `dist`。

## 故障恢复

- 档期刷新失败：页面显示失败/旧缓存状态，已有缓存与关注标记保持不变，可检查网络或代理后重试。
- 周历请求失败：存在缓存时回退缓存；无缓存时显示可重试错误态。
- 设置校验失败：服务端返回明确的 4xx 信息，不会写入部分设置。
- 状态文件异常：模块以默认空状态启动，后续刷新可重建业务缓存。
- 通知不可用：测试与调度返回失败结果，不伪造成功，不影响日历浏览。

## 已知外部限制

- 番剧元数据、评分、封面和放送安排以 Bangumi 返回为准；缺失字段会以“未知”或空值展示。
- Bangumi 的周历接口是轻量数据，详情首次打开时会按需补全并缓存七天。
- 定时通知依赖模块进程持续运行以及平台通知渠道已启用。
