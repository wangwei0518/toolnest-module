# 新番日历 React 复刻拆解与迁移分析

## 1. 迁移目标

目标模块为 `anime-calendar-react`。它以旧 `modules/anime-calendar` 的实际行为为基线，迁移为独立 React ESM + Node/Fastify 进程模块，并保留一个平台主菜单入口。迁移不是逐像素复制 Naive UI，而是在不改变信息架构和用户任务的前提下，使用 ToolNest React 平台的 shadcn/Base UI、语义 Token、模块公共布局和响应式规则重构完整界面。

验收目标：

- 保留档期新番、今日更新、周历、设置、详情抽屉、仪表盘今日新番摘要的全部可见界面与交互。
- 保留 Bangumi 数据读取、缓存、关注/屏蔽、详情、设置、通知测试与定时通知的公开语义。
- loading、empty、error、stale、refreshing、无封面、长标题、上游超时等状态均有完整界面。
- Light/Dark、`1280x720`、`1440x900` 和窄屏均不横向溢出。
- 包可安装、升级并通过运行时 operation 轮询得到明确结果。

## 2. 旧模块真实结构

### 2.1 入口与页面

旧模块只有一个主菜单“新番日历”，模块内部使用三个子页面：

| 页面 | 路由 | 主要职责 |
| --- | --- | --- |
| 档期新番 | `/modules/anime-calendar` | 档期切换、关注区、今日更新、全部新番、筛选、搜索、排序、网格/列表 |
| 周历 | `/modules/anime-calendar/weekly` | 周一至周日分组、今日/已过/即将状态、关注/续播/地区过滤、单日展开 |
| 设置 | `/modules/anime-calendar/settings` | 数据源与缓存、展示偏好、通知规则、模板编辑与测试发送 |

三个路由共用同一页面状态机；详情由右侧抽屉承载，不增加平台主菜单。旧模块另注册“今日新番”仪表盘组件，展示当天前三部作品。

### 2.2 前端状态分层

| 状态类型 | 旧实现 | React 迁移策略 |
| --- | --- | --- |
| 服务端数据 | 手写请求 + `ref` | TanStack Query，按档期/周历/今日/详情拆分 query key |
| 会话缓存 | `sessionStorage`，档期 10 分钟、周历 30 分钟、今日当天 | TanStack Query 管理页面请求；跨刷新恢复统一由后端持久缓存承担 |
| 用户设置 | 后端 JSON + `localStorage` 回退 | 后端 JSON 为唯一事实来源；保存成功后再提示，避免两份状态漂移 |
| 筛选与视图 | 页面组件本地状态 | 页面本地 state；不污染服务端数据 |
| 关注/屏蔽 | 乐观更新多个数组 | Query mutation + 精确更新/失效相关缓存，失败回滚 |
| 路由 | 手工监听 path | SDK 模块相对路由与统一模块布局 |

### 2.3 后端与数据

旧后端使用 JSON 文件原子替换持久化：

- `anime_items.json`：完整番剧目录。
- `anime_marks.json`：关注/屏蔽映射，与源数据分离。
- `anime_cour_cache.json`：每档刷新状态、候选范围、统计和错误。
- `anime_weekly_cache.json`、`anime_today_cache.json`：周历和当天派生缓存。
- `anime_long_running_cache.json`：半年以上长期放送候选。
- `anime_detail_cache.json`：详情独立缓存。
- `anime_settings.json`：展示、代理、通知设置。
- `anime_notification_history.json`：定时通知幂等记录。

迁移继续使用模块 `DATA_DIR` 中的 JSON 持久化，以保持轻量部署和无需数据库迁移的特性；所有写入采用临时文件 + rename，避免并发中产生半文件。运行时 release 内不存业务数据。

### 2.4 上游与领域规则

- 数据源是 Bangumi 公共 API，不需要 Token。
- 档期仅允许 1、4、7、10 月；档期列表合并当季新番、跨季续播和长期放送缓存。
- 周历读取 Bangumi calendar 并按星期分组；今日数据从周历派生。
- 列表响应是轻量字段，详情按需请求并独立缓存。
- 地区先读取明确字段，再用标签、标题、制作公司文本推断；未知地区受用户设置控制。
- 关注和屏蔽是互斥单值标记；默认列表隐藏屏蔽项，但可通过筛选查看。
- 详情不存在返回 404；无缓存且上游失败返回可理解错误，有旧缓存时优先展示旧数据。

## 3. API 行为对照表

| 方法 | React 模块路径 | 保留行为 |
| --- | --- | --- |
| `GET` | `/cour/current` | 返回平台时区下当前年份与档期月份 |
| `GET` | `/items` | 年份、档期、星期、状态、类型、关键词、标记筛选；返回缓存状态 |
| `GET` | `/items/:id` | 返回完整详情；缓存缺字段时向 Bangumi 补全；不存在为 404 |
| `GET` | `/weekly?force=` | 返回七天完整分组；普通请求命中短期缓存，force 跳过 |
| `GET` | `/today` | 仅返回平台日期当天星期的条目；同日缓存 |
| `POST` | `/refresh` | 刷新指定档期；失败保留已有目录与缓存信息 |
| `POST` | `/long-running/refresh` | 重建长剧集缓存并回填周历 |
| `POST/DELETE` | `/items/:id/mark` | 关注、屏蔽、取消；幂等并使派生缓存失效 |
| `GET` | `/stats` | 档期总数、关注、屏蔽、状态和今日更新统计 |
| `GET/PUT` | `/calendar-settings` | 读取、校验并持久化全部有效设置；避开平台保留的模块 `/settings` 路由 |
| `POST` | `/connection-test` | 使用当前设置草稿（含未保存代理）真实请求 Bangumi 周历 |
| `POST` | `/notifications/test-cour-release` | 生成季度摘要并调用平台通知 API |
| `POST` | `/notifications/test-watching-update` | 生成当天关注摘要并调用平台通知 API |

新模块 Gateway 前缀为 `/api/v1/modules/anime-calendar-react`；前端只通过 SDK API client 访问，不写死宿主地址。

## 4. UI 拆分

### 4.1 公共壳层

- `ModuleLayout`：模块页头与三项内部 Tabs；刷新和搜索动作归属对应页面工具栏。
- `PageState`：统一 loading、empty、error、重试。
- `AnimeDetailSheet`：海报、状态、评分、放送信息、标签、简介、关注/外链/屏蔽。
- `AnimePosterCard`、`AnimeListRow`：档期复用。
- `RegionMenu`、`FilterToolbar`、`ViewToggle`：用 DropdownMenu、Select、ToggleGroup 组合。

### 4.2 档期页

1. 档期导航条：上一档/下一档、当前档期、年份快捷项、档期 Select、筛选按钮。
2. 我关注的新番：横向海报轨道；空态提供跳转到全部新番。
3. 今日更新：日期说明、只看关注、地区筛选、错误重试、紧凑条目卡。
4. 全部新番：地区、排序、网格/列表切换；首批 36 项，之后每次 24 项。
5. 搜索与组合筛选：条件 Badge 可单独删除或全部清除。

### 4.3 周历页

- 当前档期与总数工具栏。
- 只看关注、包含续播、地区组合筛选。
- 七列/自适应网格；每列默认五项，独立展开/收起。
- 今日、已过、即将状态具有语义化边框和 Badge，不依赖硬编码亮暗色。

### 4.4 设置页

- 左侧/窄屏顶部分类导航：数据与缓存、展示偏好、通知设置。
- 数据与缓存：Bangumi 公共接口、代理、连接测试、档期刷新、长剧集刷新、缓存状态。
- 展示偏好：默认页、视图、排序、默认地区、周历地区、续播和未知地区。
- 通知设置：季度通知与关注更新两套完整规则，渠道/地区多选、时间与数值校验、模板变量插入、高级编辑 Sheet、测试发送。
- 底部恢复默认与保存按钮；恢复默认只修改草稿，不伪称已保存。

## 5. 确定性问题与优化点

### 5.1 旧代码中的确定性问题

1. `OverviewPage.vue` 超过 2400 行、样式超过 3100 行，页面、领域格式化、缓存、请求和设置表单耦合，难以单测。
2. 同一数据在 `items`、`todaySourceItems`、`weeklyDays`、`currentItem` 四处手动同步，容易遗漏。
3. 前端重复实现了服务端地区推断；两端规则漂移会导致同一条目在不同页面分类不同。
4. `resetCalendarSettings` 立即写入 localStorage 并提示“已恢复默认”，但后端尚未保存，反馈语义不够精确。
5. 页面头部重复模块大标题和描述，与当前 React 平台“模块内部子页不重复宿主大标题”的规则不一致。
6. 大量原生按钮与手绘 SVG 绕开组件库，焦点、尺寸、禁用和暗色状态不统一。
7. 配置类型保留了 `autoRefreshCurrentCour`、`cacheRetentionDays`、`refreshIntervalHours` 等未在旧 UI 中真正生效的历史字段，容易形成虚假能力。

### 5.2 React 版本的改进

- 将 API、领域格式化、缓存/查询、页面组件、设置表单和后端服务分层。
- 地区由后端统一返回，前端只显示，不再重复推断。
- 关注 mutation 统一更新 query cache 并让相关 query 失效，避免四份手工同步。
- 设置使用草稿，恢复默认提示“已恢复默认草稿”，只有保存成功才持久化并提示生效。
- 模块布局只显示当前子页标题与内部 Tabs，不重复品牌 Hero。
- Button、Tabs、Card、Badge、Alert、Sheet、Select、Switch、Field、Input、Textarea、DropdownMenu、ToggleGroup、Skeleton、Empty 全部优先复用 shadcn。
- 仅开放真实生效配置；保留历史字段只为读旧数据兼容，不在界面制造虚假控制项。
- 上游请求加入 timeout、并发合并和 stale-cache fallback；错误响应不暴露 token、路径或堆栈。

## 6. 测试与审计矩阵

### 单元测试

- 档期计算、跨年和前端季度导航。
- Bangumi 档期/周历/详情 payload 映射，以及收藏人数不误作当前集数。
- 档期刷新持久化、关注标记与源数据分离。
- 周历并发请求合并和今日缓存派生。
- 设置的代理、评分、渠道和模板变量校验。
- 前端组合过滤、评分排序和周历状态。

运行时集成继续覆盖 JSON 原子写入、坏缓存恢复、上游失败回退、通知历史幂等和浏览器交互。

### 集成与浏览器

- 安装、enable、真实 Gateway API、模块深链刷新、disable/enable、upgrade operation。
- 档期页：搜索、筛选、地区、排序、视图、关注、屏蔽、详情、加载更多。
- 周历页：组合筛选、单日展开、详情和关注。
- 设置页：三分类、保存/恢复、连接测试、通知模板高级编辑、测试发送。
- `1280x720`、`1440x900`、窄屏；Light/Dark；滚动和横向溢出；控制台无相关错误。

## 7. 完成判定

只有在以下项目全部满足后才提交：

- 行为对照表无缺项，前后端类型与 manifest 版本一致。
- 单元测试、typecheck、build、UI 静态检查和浏览器回归通过。
- `.tnmod` 包含完整 frontend/backend 产物并通过包检查。
- 使用运行时 API 上传，轮询 operation 到明确成功；页面经真实 Host 验证。
- 对照旧模块测试清单复审偏差，修复所有确定性问题；剩余外部限制写入 README。
