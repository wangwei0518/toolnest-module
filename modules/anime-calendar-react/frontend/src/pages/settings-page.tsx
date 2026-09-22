import { useEffect, useState } from "react";
import { RiDatabase2Line, RiEyeLine, RiNotification3Line, RiRefreshLine, RiSendPlaneLine } from "@remixicon/react";

import { animeApi } from "@/api";
import { CompactSelect, MultiSelectMenu } from "@/components/controls";
import { PageError } from "@/components/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSaveSettingsMutation, useSettings } from "@/hooks/use-calendar";
import { regionOptions } from "@/lib/anime";
import { notify } from "@/module-context";
import { defaultAnimeSettings, type AnimeSettings, type NotificationRuleBase } from "@/types";

type Section = "data" | "display" | "notifications";
const sections = [{ key: "data", label: "数据与缓存", description: "管理 Bangumi 连接、缓存与刷新。", icon: RiDatabase2Line }, { key: "display", label: "展示偏好", description: "设置默认页面、视图、排序和地区。", icon: RiEyeLine }, { key: "notifications", label: "通知设置", description: "配置季度新番与关注更新通知。", icon: RiNotification3Line }] as const;
const channels = [["default", "平台默认渠道"], ["web_internal", "站内通知"], ["qqbot", "QQBot"], ["email", "Email"]] as const;
const courVariables = ["{year}", "{cour_month}", "{cour_label}", "{total_count}", "{new_count}", "{continuing_count}", "{region}", "{anime_list}", "{refresh_time}", "{module_url}"];
const watchingVariables = ["{date}", "{weekday}", "{count}", "{anime_list}", "{region}", "{module_url}", "{anime_title}", "{anime_title_original}", "{score}", "{media_type}", "{cour_relation}", "{bangumi_url}"];
const templateVariableDescriptions: Record<string, string> = {
  "{year}": "季度通知所属年份。",
  "{cour_month}": "季度通知所属月份，例如 1、4、7 或 10。",
  "{cour_label}": "档期名称，例如“2026年7月新番”。",
  "{total_count}": "当前筛选条件匹配的作品总数。",
  "{new_count}": "当前档期的新番数量。",
  "{continuing_count}": "当前档期的续播作品数量。",
  "{region}": "本次通知使用的地区筛选名称。",
  "{anime_list}": "匹配作品列表，包含作品名称和放送时间。",
  "{refresh_time}": "档期数据最近一次刷新时间。",
  "{module_url}": "新番日历对应页面的地址。",
  "{date}": "关注番放送日期。",
  "{weekday}": "关注番放送日期对应的星期。",
  "{count}": "当天关注番的数量。",
  "{anime_title}": "通知分组中第一部番剧的中文标题；逐部发送时为当前番剧。",
  "{anime_title_original}": "通知分组中第一部番剧的原始标题；逐部发送时为当前番剧。",
  "{score}": "通知分组中第一部番剧的 Bangumi 评分；逐部发送时为当前番剧。",
  "{media_type}": "通知分组中第一部番剧的媒体类型；逐部发送时为当前番剧。",
  "{cour_relation}": "通知分组中第一部番剧的档期关系；逐部发送时为当前番剧。",
  "{bangumi_url}": "通知分组中第一部番剧的 Bangumi 详情地址；逐部发送时为当前番剧。",
};
const templatePreviewValues: Record<"cour" | "watching", Record<string, string>> = {
  cour: {
    year: "2026", cour_month: "7", cour_label: "2026年7月新番", total_count: "32", new_count: "24", continuing_count: "8",
    region: "全部地区", anime_list: "- 示例番剧 A\n- 示例番剧 B\n- 示例番剧 C", refresh_time: "2026-07-01 09:00", module_url: "/modules/anime-calendar-react",
  },
  watching: {
    date: "2026-09-22", weekday: "周二", count: "3", anime_list: "- 示例番剧 A（20:00）\n- 示例番剧 B（23:30）", region: "全部地区",
    module_url: "/modules/anime-calendar-react/weekly", anime_title: "示例番剧 A", anime_title_original: "Example Anime A", score: "8.2", media_type: "TV", cour_relation: "新番", bangumi_url: "https://bgm.tv/subject/1",
  },
};

export function SettingsPage() {
  const query = useSettings(); const save = useSaveSettingsMutation(); const [section, setSection] = useState<Section>("data"); const [draft, setDraft] = useState<AnimeSettings | null>(null); const [busy, setBusy] = useState<string | null>(null); const [advanced, setAdvanced] = useState<"cour" | "watching" | null>(null);
  useEffect(() => { if (query.data) setDraft(structuredClone(query.data)); }, [query.data]);
  if (query.isError) return <PageError description="无法读取模块设置。" retry={() => void query.refetch()} />;
  if (!draft) return <div className="tn-anime-settings-loading">正在读取设置…</div>;
  const active = sections.find((item) => item.key === section)!;
  const action = async (key: string, callback: () => Promise<void>) => { setBusy(key); try { await callback(); } catch (error) { notify("error", error instanceof Error ? error.message : "操作失败"); } finally { setBusy(null); } };
  return <div className="tn-anime-settings-shell"><aside className="tn-anime-settings-nav" aria-label="新番日历设置分类">{sections.map((item) => { const Icon = item.icon; return <Button key={item.key} variant={section === item.key ? "secondary" : "ghost"} onClick={() => setSection(item.key)}><Icon data-icon="inline-start" />{item.label}</Button>; })}</aside><section className="tn-anime-settings-content"><header><h2>{active.label}</h2><p>{active.description}</p></header>
    {section === "data" ? <div className="tn-anime-settings-grid"><SettingsCard title="数据源设置" description="通过 Bangumi 公共接口读取档期新番与周历。" icon={<RiDatabase2Line />}><FieldGroup><SettingRow title="当前数据源"><Badge>Bangumi</Badge></SettingRow><SettingRow title="Bangumi 公开接口" description="无需访问凭据，连接测试会实际请求上游。"><Badge variant="secondary">无需配置</Badge></SettingRow><Field orientation="vertical"><div className="tn-anime-setting-switch"><FieldContent><FieldTitle>网络代理</FieldTitle><FieldDescription>仅影响本模块访问 Bangumi，支持 HTTP、HTTPS、SOCKS5 与 SOCKS5H。</FieldDescription></FieldContent><Switch checked={draft.proxy.enabled} onCheckedChange={(checked) => setDraft({ ...draft, proxy: { ...draft.proxy, enabled: checked } })} /></div><Input aria-label="代理地址" disabled={!draft.proxy.enabled} value={draft.proxy.url} onChange={(event) => setDraft({ ...draft, proxy: { ...draft.proxy, url: event.target.value } })} placeholder="例如 socks5://127.0.0.1:1080" /></Field><SettingRow title="测试连接"><Button variant="outline" disabled={busy !== null} onClick={() => void action("connection", async () => { const result = await animeApi.testConnection(draft); notify("success", result.message); })}>{busy === "connection" ? "测试中" : "测试连接"}</Button></SettingRow><SettingRow title="手动刷新当前档期"><Button variant="outline" disabled={busy !== null} onClick={() => void action("cour", async () => { const current = await animeApi.currentCour(); const result = await animeApi.refresh(current.year, current.cour_month); notify("success", `当前档期已刷新，共 ${result.total} 部`); })}><RiRefreshLine data-icon="inline-start" />{busy === "cour" ? "刷新中" : "刷新当前档期"}</Button></SettingRow><SettingRow title="刷新长剧集缓存" description="重新读取长期放送候选并用于档期和周历合并。"><Button variant="outline" disabled={busy !== null} onClick={() => void action("long", async () => { const result = await animeApi.refreshLongRunning(); notify("success", `长剧集缓存已更新，保留 ${result.retained_count} 部`); })}>{busy === "long" ? "刷新中" : "刷新"}</Button></SettingRow></FieldGroup></SettingsCard><SettingsCard title="缓存状态" description="缓存优先展示，外部数据不可用时仍保留可恢复状态。"><FieldGroup><SettingRow title="今日放送" description="每日首次读取后缓存至当天结束。"><Badge variant="secondary">当天有效</Badge></SettingRow><SettingRow title="周历" description="普通读取命中短期缓存，手动刷新主动拉取。"><Badge variant="secondary">30 分钟</Badge></SettingRow><SettingRow title="进入空档期时自动拉取" description="当前档期无数据或过期时在后台刷新。"><Switch checked={draft.autoFetchEmptyCour} onCheckedChange={(checked) => setDraft({ ...draft, autoFetchEmptyCour: checked })} /></SettingRow></FieldGroup></SettingsCard></div> : null}
    {section === "display" ? <SettingsCard title="默认展示" description="这些偏好会在下次进入页面时应用。"><FieldGroup><SettingRow title="默认打开页面"><CompactSelect value={draft.defaultPage} options={[["cour", "档期新番"], ["weekly", "周历"]]} onChange={(value) => setDraft({ ...draft, defaultPage: value as AnimeSettings["defaultPage"] })} /></SettingRow><SettingRow title="默认视图"><CompactSelect value={draft.defaultView} options={[["grid", "卡片"], ["list", "列表"]]} onChange={(value) => setDraft({ ...draft, defaultView: value as AnimeSettings["defaultView"] })} /></SettingRow><SettingRow title="默认排序"><CompactSelect value={draft.defaultSort} options={[["default", "默认顺序"], ["score", "按评分"]]} onChange={(value) => setDraft({ ...draft, defaultSort: value as AnimeSettings["defaultSort"] })} /></SettingRow><SettingRow title="默认地区"><CompactSelect value={draft.defaultRegion} options={regionOptions} onChange={(value) => setDraft({ ...draft, defaultRegion: value })} /></SettingRow><SettingRow title="周历默认地区"><CompactSelect value={draft.weeklyRegion} options={regionOptions} onChange={(value) => setDraft({ ...draft, weeklyRegion: value })} /></SettingRow><SettingRow title="显示续播番" description="包含上个档期延续放送的作品。"><Switch checked={draft.showContinuing} onCheckedChange={(checked) => setDraft({ ...draft, showContinuing: checked })} /></SettingRow><SettingRow title="显示未知地区"><Switch checked={draft.showUnknownRegion} onCheckedChange={(checked) => setDraft({ ...draft, showUnknownRegion: checked })} /></SettingRow></FieldGroup></SettingsCard> : null}
    {section === "notifications" ? <div className="tn-anime-notification-grid"><NotificationEditor title="季度新番通知" description="在季度首日或指定提前天数，从本地缓存生成摘要。" rule={draft.notifications.courRelease} variables={courVariables} kind="cour" onChange={(rule) => setDraft({ ...draft, notifications: { ...draft.notifications, courRelease: { ...draft.notifications.courRelease, ...rule } } })} onAdvanced={() => setAdvanced("cour")} onTest={() => void action("notify-cour", async () => { const result = await animeApi.testNotification("cour", draft); notify(result.ok ? "success" : "warning", result.message); })} testing={busy === "notify-cour"} extras={<><Field><FieldLabel>发送日期</FieldLabel><CompactSelect value={draft.notifications.courRelease.scheduleMode} options={[["cour_first_day", "档期首日"], ["offset", "提前发送"]]} onChange={(value) => setDraft({ ...draft, notifications: { ...draft.notifications, courRelease: { ...draft.notifications.courRelease, scheduleMode: value as "cour_first_day" | "offset" } } })} /></Field><Field><FieldLabel htmlFor="cour-offset">提前天数</FieldLabel><Input id="cour-offset" type="number" min={-30} max={30} disabled={draft.notifications.courRelease.scheduleMode !== "offset"} value={draft.notifications.courRelease.offsetDays} onChange={(event) => setDraft({ ...draft, notifications: { ...draft.notifications, courRelease: { ...draft.notifications.courRelease, offsetDays: Number(event.target.value) } } })} /></Field><Field><FieldLabel htmlFor="cour-minimum">最少番剧数</FieldLabel><Input id="cour-minimum" type="number" min={0} max={999} value={draft.notifications.courRelease.minimumCount} onChange={(event) => setDraft({ ...draft, notifications: { ...draft.notifications, courRelease: { ...draft.notifications.courRelease, minimumCount: Number(event.target.value) } } })} /></Field><Field><FieldLabel htmlFor="cour-score">最低评分</FieldLabel><Input id="cour-score" type="number" min={0} max={10} step={0.1} value={draft.notifications.courRelease.minScore ?? ""} onChange={(event) => setDraft({ ...draft, notifications: { ...draft.notifications, courRelease: { ...draft.notifications.courRelease, minScore: event.target.value ? Number(event.target.value) : null } } })} /></Field></>} /><NotificationEditor title="关注新番放送通知" description="每日从本地周历读取当天关注番。" rule={draft.notifications.watchingUpdate} variables={watchingVariables} kind="watching" onChange={(rule) => setDraft({ ...draft, notifications: { ...draft.notifications, watchingUpdate: { ...draft.notifications.watchingUpdate, ...rule } } })} onAdvanced={() => setAdvanced("watching")} onTest={() => void action("notify-watching", async () => { const result = await animeApi.testNotification("watching", draft); notify(result.ok ? "success" : "warning", result.message); })} testing={busy === "notify-watching"} extras={<Field><FieldLabel>发送模式</FieldLabel><CompactSelect value={draft.notifications.watchingUpdate.deliveryMode} options={[["digest", "合并通知"], ["single", "逐部发送"]]} onChange={(value) => setDraft({ ...draft, notifications: { ...draft.notifications, watchingUpdate: { ...draft.notifications.watchingUpdate, deliveryMode: value as "digest" | "single" } } })} /></Field>} /></div> : null}
    <div className="tn-anime-settings-footer"><Button variant="outline" onClick={() => { setDraft(structuredClone(defaultAnimeSettings)); notify("info", "已恢复默认设置草稿，保存后生效"); }}>恢复默认</Button><Button disabled={save.isPending} onClick={() => save.mutate(draft)}>{save.isPending ? "保存中" : "保存设置"}</Button></div>
    <TemplateSheet kind={advanced} draft={draft} setDraft={setDraft} onClose={() => setAdvanced(null)} />
  </section></div>;
}

function SettingsCard({ title, description, icon, children }: { title: string; description: string; icon?: React.ReactNode; children: React.ReactNode }) { return <Card><CardHeader><div><CardTitle>{icon}{title}</CardTitle><CardDescription>{description}</CardDescription></div></CardHeader><CardContent>{children}</CardContent></Card>; }
function SettingRow({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) { return <Field orientation="horizontal"><FieldContent className="min-w-0"><FieldTitle>{title}</FieldTitle>{description ? <FieldDescription>{description}</FieldDescription> : null}</FieldContent><div className="tn-anime-setting-row__control">{children}</div></Field>; }
function templateVariableDescription(variable: string) { return templateVariableDescriptions[variable] ?? "新番日历通知模板变量。"; }

function TemplateVariableButton({ variable, onInsert }: { variable: string; onInsert: (variable: string) => void }) {
  return <TooltipProvider delay={0}><Tooltip><TooltipTrigger render={<Button type="button" size="sm" variant="outline" onClick={() => onInsert(variable)} />}><code>{variable}</code></TooltipTrigger><TooltipContent side="top" align="start"><p>{templateVariableDescription(variable)}</p></TooltipContent></Tooltip></TooltipProvider>;
}

function VariableInsertMenu({ variables, onSelect }: { variables: string[]; onSelect: (variable: string) => void }) {
  return <TooltipProvider delay={0}><DropdownMenu><DropdownMenuTrigger render={<Button type="button" size="sm" variant="outline" />}>插入变量</DropdownMenuTrigger><DropdownMenuContent align="end" className="w-auto min-w-40"><DropdownMenuGroup>{variables.map((variable) => <Tooltip key={variable}><TooltipTrigger render={<DropdownMenuItem onClick={() => onSelect(variable)} />}>{variable}</TooltipTrigger><TooltipContent side="right" align="start"><p>{templateVariableDescription(variable)}</p></TooltipContent></Tooltip>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu></TooltipProvider>;
}

function NotificationEditor({ title, description, rule, variables, kind, onChange, onAdvanced, onTest, testing, extras }: { title: string; description: string; rule: NotificationRuleBase; variables: string[]; kind: "cour" | "watching"; onChange: (rule: Partial<NotificationRuleBase>) => void; onAdvanced: () => void; onTest: () => void; testing: boolean; extras: React.ReactNode }) {
  return <Card><CardHeader><div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div><Switch checked={rule.enabled} onCheckedChange={(enabled) => onChange({ enabled })} /></CardHeader><CardContent><FieldGroup><Field><FieldLabel htmlFor={`${kind}-time`}>发送时间</FieldLabel><Input id={`${kind}-time`} value={rule.sendTime} onChange={(event) => onChange({ sendTime: event.target.value })} placeholder="09:00" /></Field>{extras}<Field><FieldLabel>地区</FieldLabel><MultiSelectMenu label="地区" values={rule.regions} options={regionOptions} onChange={(regions) => onChange({ regions })} /></Field><Field><FieldLabel>通知渠道</FieldLabel><MultiSelectMenu label="渠道" values={rule.channels} options={channels} exclusiveValue="default" fallbackValue="default" onChange={(channelsValue) => onChange({ channels: channelsValue })} /></Field><SettingRow title="包含续播番"><Switch checked={rule.includeContinuing} onCheckedChange={(includeContinuing) => onChange({ includeContinuing })} /></SettingRow><Separator /><div className="tn-anime-template-toolbar"><div><strong>通知内容模板</strong><p>这里只生成新番日历的标题和正文，发送时会继续套用平台的统一消息模板。</p></div><div><VariableInsertMenu variables={variables} onSelect={(variable) => onChange({ bodyTemplate: `${rule.bodyTemplate}${variable}` })} /><Button type="button" size="sm" variant="outline" onClick={onAdvanced}>高级编辑</Button></div></div><Field><FieldLabel htmlFor={`${kind}-title`}>标题模板</FieldLabel><Input id={`${kind}-title`} value={rule.titleTemplate} maxLength={4000} onChange={(event) => onChange({ titleTemplate: event.target.value })} /></Field><Field><FieldLabel htmlFor={`${kind}-body`}>正文模板</FieldLabel><Textarea id={`${kind}-body`} value={rule.bodyTemplate} maxLength={4000} rows={5} onChange={(event) => onChange({ bodyTemplate: event.target.value })} /></Field><Button type="button" variant="outline" disabled={testing} onClick={onTest}><RiSendPlaneLine data-icon="inline-start" />{testing ? "发送中" : kind === "cour" ? "发送季度新番测试通知" : "发送关注更新测试通知"}</Button></FieldGroup></CardContent></Card>;
}

function TemplateSheet({ kind, draft, setDraft, onClose }: { kind: "cour" | "watching" | null; draft: AnimeSettings; setDraft: (settings: AnimeSettings) => void; onClose: () => void }) {
  if (!kind) return null;
  const rule = kind === "cour" ? draft.notifications.courRelease : draft.notifications.watchingUpdate;
  const variables = kind === "cour" ? courVariables : watchingVariables;
  const update = (values: Partial<NotificationRuleBase>) => setDraft(kind === "cour" ? { ...draft, notifications: { ...draft.notifications, courRelease: { ...draft.notifications.courRelease, ...values } } } : { ...draft, notifications: { ...draft.notifications, watchingUpdate: { ...draft.notifications.watchingUpdate, ...values } } });
  const bodyPreview = renderTemplate(rule.bodyTemplate, templatePreviewValues[kind]);
  return <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}><SheetContent className="tn-anime-template-sheet"><SheetHeader><SheetTitle>高级编辑通知内容</SheetTitle><SheetDescription>这里只编辑新番日历生成的标题和正文；实际发送格式由平台消息模板统一决定。</SheetDescription></SheetHeader><div className="tn-anime-template-sheet__body"><FieldGroup><Field><FieldLabel>标题模板</FieldLabel><Input value={rule.titleTemplate} onChange={(event) => update({ titleTemplate: event.target.value })} /></Field><Field><FieldLabel>正文模板</FieldLabel><Textarea value={rule.bodyTemplate} rows={14} onChange={(event) => update({ bodyTemplate: event.target.value })} /></Field><Card size="sm" className="tn-anime-template-preview"><CardHeader><CardTitle>模块正文预览</CardTitle><CardDescription>变量会以示例数据替换；平台统一消息模板会在发送时继续套用。</CardDescription></CardHeader><CardContent><p>{bodyPreview || "暂无正文内容"}</p></CardContent></Card></FieldGroup><aside><strong>可用变量</strong><p>点击后追加到正文模板。</p><div>{variables.map((variable) => <TemplateVariableButton key={variable} variable={variable} onInsert={(value) => update({ bodyTemplate: `${rule.bodyTemplate}${value}` })} />)}</div></aside></div><SheetFooter><Button variant="outline" onClick={onClose}>完成编辑</Button></SheetFooter></SheetContent></Sheet>;
}

function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{([^{}]+)\}/g, (match, key: string) => values[key] ?? match);
}
