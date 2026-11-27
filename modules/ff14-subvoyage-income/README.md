# 潜航控制台

ToolNest FF14 部队潜水艇模块。按部队和统计月份查看今日收入、部队概况、月度热力图、收入趋势、逐艇预计返航与道具贡献。管理员可以查阅每日快照和导出当月 CSV。

## 插件对接

1. 在「公司设置」添加游戏部队 ID，复制一次性显示的令牌。
2. 在 SubVoyage 的「今日收益 Webhook」启用推送，填入模块提供的 URL。
3. 鉴权选择「自定义请求头」，请求头名填 X-ToolNest-Token，值填该部队令牌。
4. 在工房内点击「查看今日收益」。舰队时间只会在客户端能读取工房时更新。

上报入口为 **POST /api/v1/modules/ff14-subvoyage-income/public/reports**，兼容 subvoyage.income.summary v1 和缺少 submersibles 的早期快照。收入按部队与北京时间日期保留最新完整快照。艇队字段为 null 时保留最近有效艇队，空数组清除旧艇队。待估价道具计入数量，金额仅累计已知 NPC 估价。数据库位于 TOOLNEST_PLUGIN_DATA_DIR/subvoyage.sqlite。道具图标按 ID 从 FFCafe 获取，加载失败时显示占位图。

## 管理 API

通过 /api/v1/modules/ff14-subvoyage-income 访问，要求平台管理员会话。

| 请求 | 说明 |
| --- | --- |
| GET /companies | 列出已配置部队 |
| POST /companies | 创建部队并返回一次性令牌 |
| PATCH /companies/{id} | 更新别名 |
| POST /companies/{id}/token | 生成新令牌，旧令牌立即失效 |
| GET /dashboard?companyId=…&month=YYYY-MM | 当前状态、选中月快照和近 90 日汇总 |
| GET /trend?companyId=…&from=YYYY-MM-DD&to=YYYY-MM-DD | 查询含起止日的日收益，最多 366 天 |
| GET /reports/{date}?companyId=… | 查询某日快照，缺报返回 JSON null |
| GET /items/{id}/icon | 代理道具 PNG |

模块由 React Module SDK 安装，通过宿主 Gateway 访问独立的原生 Go 进程。
