import { useEffect, useState } from "react";
import { RiCheckLine, RiDownload2Line, RiErrorWarningLine, RiRefreshLine } from "@remixicon/react";
import * as api from "@/api/subvoyage";
import { HeatMap, ItemsPanel, Trend, type DateRange, type Range } from "@/components/analytics";
import { CompanyCard, FleetPanel, LootTable, Panel, SelectField, StatusTag, SummaryCard, TodayCard } from "@/components/presentation";
import { ModuleLayout, type ModuleTab } from "@/components/module-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { aggregate, calendar, chinaToday, companyName, displayMonth, displayTime, downloadReports, gil, number,
  triggerName, type Loot } from "@/lib/income";
import type { Credential, Report } from "@/types";

type Result<T> = { key: string; data?: T; error?: string };
function useLoad<T>(key: string, refresh: number, load: () => Promise<T>, message: string) {
  const [result, setResult] = useState<Result<T>>();
  useEffect(() => {
    if (!key) return;
    let live = true;
    void load().then(data => { if (live) setResult({ key, data }); },
      error => { if (live) setResult({ key, error: api.errorText(error, message) }); });
    return () => { live = false; };
    // The key and refresh revision identify the request; callback identity follows render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh]);
  return key && result?.key === key ? result : undefined;
}
function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <Alert variant="destructive"><RiErrorWarningLine/><AlertTitle>暂时无法完成请求</AlertTitle>
    <AlertDescription>{message}{retry && <Button variant="outline" size="sm" onClick={retry}>重试</Button>}</AlertDescription></Alert>;
}

function CredentialView({ credential }: { credential: Credential }) {
  const [copyStatus, setCopyStatus] = useState("");
  const url = api.publicUrl();
  const command = [
    'curl -X POST "' + url + '"',
    '-H "Content-Type: application/json"',
    '-H "X-ToolNest-Token: ' + credential.token + '"',
    '--data-binary "@report.json"',
  ].join(" ");
  return <div className="subv-form">
    <Alert><AlertTitle>令牌仅在本次显示</AlertTitle><AlertDescription>在插件启用「推送今日收益」，鉴权方式选「自定义请求头」，名称填 X-ToolNest-Token。</AlertDescription></Alert>
    <Label htmlFor="subv-webhook-token">上报令牌</Label><Input id="subv-webhook-token" readOnly value={credential.token}/>
    <Label htmlFor="subv-webhook-curl">认证请求示例</Label><Input id="subv-webhook-curl" readOnly value={command} onFocus={event => event.target.select()}/>
    <Button variant="outline" onClick={async () => {
      try { await navigator.clipboard.writeText(command); setCopyStatus("已复制完整请求"); }
      catch { document.getElementById("subv-webhook-curl")?.focus(); setCopyStatus("已选中请求，请使用 Ctrl+C 复制"); }
    }}>复制认证请求</Button><span role="status" className="subv-small">{copyStatus}</span>
  </div>;
}
function WebhookSettings() {
  const [revision, setRevision] = useState(0);
  const status = useLoad("webhook", revision, api.webhookStatus, "上报设置加载失败。");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [credential, setCredential] = useState<Credential>();
  const [confirmRotate, setConfirmRotate] = useState(false);

  async function issueToken(rotate: boolean) {
    setPending(true);
    setError("");
    try {
      setCredential(await (rotate ? api.rotateWebhookToken() : api.createWebhookToken()));
      setConfirmRotate(false);
    } catch (failure) {
      setError(api.errorText(failure, "生成上报令牌失败，请重试。"));
      setRevision(value => value + 1);
    }
    finally { setPending(false); }
  }
  return <div className="subv-form">
    <p className="subv-muted">将上报 URL 和令牌填入插件。首次收到有效上报后，系统按上报中的部队 ID 自动建档。</p>
    <Label htmlFor="subv-webhook-url">上报 URL</Label>
    <Input id="subv-webhook-url" readOnly value={api.publicUrl()} onFocus={event => event.target.select()}/>
    {error && <ErrorNotice message={error}/>}
    {credential ? <CredentialView credential={credential}/>
      : status?.error ? <ErrorNotice message={status.error} retry={() => setRevision(value => value + 1)}/>
      : !status?.data ? <p role="status">正在读取上报设置…</p>
      : !status.data.configured ? <Button size="sm" disabled={pending} onClick={() => void issueToken(false)}>生成上报令牌</Button>
      : confirmRotate ? <Alert variant="destructive"><AlertTitle>当前上报令牌将立即失效</AlertTitle><AlertDescription>
        <div className="subv-actions"><Button size="sm" variant="destructive" disabled={pending} onClick={() => void issueToken(true)}>确认轮换</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirmRotate(false)}>取消</Button></div>
      </AlertDescription></Alert>
      : <div className="subv-form"><p>已生成上报令牌</p><Button variant="outline" size="sm" onClick={() => setConfirmRotate(true)}>轮换上报令牌</Button></div>}
  </div>;
}

function DayDetails({ companyId, date, onPrice }: { companyId: string; date: string; onPrice: (row: Loot) => void }) {
  const [refresh, setRefresh] = useState(0);
  const result = useLoad(companyId + ":" + date, refresh, () => api.report(companyId, date), "日期明细加载失败。");
  if (!result) return <Skeleton className="subv-detail-skeleton"/>;
  if (result.error) return <ErrorNotice message={result.error} retry={() => setRefresh(refresh + 1)}/>;
  const row = result.data;
  if (!row) return <p className="subv-empty">当天暂无上报。</p>;
  return <div className="subv-form">
    <div className="subv-day-total"><strong>{gil(row.totalGil)}</strong><span>NPC 估值 · {displayTime(row.generatedAt)} · {triggerName(row.trigger)}</span></div>
    {!row.items.length ? <p className="subv-empty">已上报，暂无已确认领取的战利品。</p> :
      <LootTable rows={aggregate([row])} total={row.totalGil} onPrice={onPrice}/>}
  </div>;
}

type Drawer = { kind: "day"; date: string } |
  { kind: "price"; row: Loot; previous: Drawer | null };

function DrawerBody({ drawer, companyId, onPrice, onDrawer }: {
  drawer: Drawer; companyId: string;
  onPrice: (row: Loot) => void; onDrawer: (drawer: Drawer | null) => void;
}) {
  if (drawer.kind === "day") return <DayDetails companyId={companyId} date={drawer.date} onPrice={onPrice}/>;
  return <div className="subv-form">
    {drawer.previous && <Button size="sm" variant="outline" onClick={() => onDrawer(drawer.previous)}>返回明细</Button>}
    <dl className="subv-detail-list">{[...drawer.row.prices].map(([price, quantity]) => <div key={price ?? "unknown"}>
      <dt>{price === null ? "待估价" : gil(price)}</dt><dd>{number.format(quantity)} 件</dd><dd>{price === null ? "—" : gil(price * quantity)}</dd>
    </div>)}</dl>
  </div>;
}

function ReportList({ reports, onDay }: { reports: Report[]; onDay: (date: string) => void }) {
  return reports.length ? <div className="subv-report-list">{[...reports].reverse().map(row =>
    <Button size="sm" variant="outline" key={row.date} onClick={() => onDay(row.date)}>
      <span>{row.date}</span><span>{displayTime(row.generatedAt)} · {triggerName(row.trigger)}</span><b>{gil(row.totalGil)}</b>
    </Button>)}</div> : <p className="subv-empty">该月份暂无上报。</p>;
}

export function ModuleApp() {
  const [tab, setTab] = useState<ModuleTab>("overview");
  const [selected, setSelected] = useState("");
  const [month, setMonth] = useState("");
  const [range, setRange] = useState<Range>(30);
  const [custom, setCustom] = useState<DateRange | null>(null);
  const [revision, setRevision] = useState(0);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [toast, setToast] = useState("");
  const now = useClock();
  const companies = useLoad("companies", revision, api.companies, "部队列表加载失败。");
  const companyId = selected || companies?.data?.[0]?.companyId || "";
  const needsCompany = companies?.data?.length === 0 && !companyId;
  const data = useLoad(companyId && companyId + ":" + month, revision, () => api.dashboard(companyId, month), "看板数据加载失败。");
  const view = data?.data;
  const customTrend = useLoad(custom && companyId ? companyId + ":" + custom.from + ":" + custom.to : "", revision,
    () => api.trend(companyId, custom!.from, custom!.to), "自定义日期趋势加载失败。");
  const company = view?.company ?? companies?.data?.find(value => value.companyId === companyId);
  const today = view?.today ?? chinaToday();
  const activeMonth = view?.month ?? (month || today.slice(0, 7));
  const received = view?.reports.length ?? null;
  const monthlyTotal = view?.reports.length ? view.reports.reduce((sum, row) => sum + row.totalGil, 0) : null;
  const rows = aggregate(view?.reports ?? []);
  const pending = received ? rows.reduce((sum, row) => sum + row.pending, 0) : null;
  const missing = view?.latest && received !== null ? Math.max(0, (activeMonth === today.slice(0, 7) ? Number(today.slice(8)) : calendar(activeMonth).days) - received) : null;
  const next = view?.fleet?.submersibles.filter(vessel => (vessel.nextCompletionTimestamp ?? 0) * 1000 > now)
    .sort((a, b) => (a.nextCompletionTimestamp ?? 0) - (b.nextCompletionTimestamp ?? 0))[0];
  const months = [...new Set([today.slice(0, 7), activeMonth, ...(view?.months ?? [])])].sort().reverse();
  const yesterday = view?.yesterdayTotalGil ?? undefined;

  useEffect(() => {
    const timer = window.setInterval(() => setRevision(value => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const refresh = () => setRevision(revision => revision + 1);
  const openDay = (date: string) => setDrawer({ kind: "day", date });
  const openPrice = (row: Loot) => setDrawer({ kind: "price", row, previous: drawer });
  function exportData() {
    if (!view) return;
    downloadReports(view.reports, companyId, view.month);
    setToast("已导出 " + displayMonth(view.month) + "收益");
  }
  const analysis = <div className="subv-analysis">
    <HeatMap view={view} today={today} month={activeMonth} total={monthlyTotal} onMonth={value => { setMonth(value); setCustom(null); }} onDay={openDay}/>
    <Trend view={view} today={today} month={activeMonth} range={range} custom={custom} result={customTrend} onCustom={setCustom} onRange={value => { setRange(value); setCustom(null); }} onDay={openDay}/>
  </div>;
  const fleet = <FleetPanel view={view} now={now} onOpen={tab === "overview" ? () => setTab("fleet") : undefined}/>;
  const items = <ItemsPanel hasItems={rows.length > 0} onOpen={tab === "overview" ? () => setTab("items") : undefined}>
    <LootTable rows={rows} total={monthlyTotal} onPrice={openPrice} {...(tab === "overview" ? { limit: 5 } : {})}/>
  </ItemsPanel>;
  const busy = !companies || (!view && !needsCompany);
  const failure = companies?.error ?? data?.error;
  return <ModuleLayout activeTab={tab} onTabChange={setTab}>
    <div className="subv-console">
      {tab !== "settings" && <div className="subv-filters">
        <div className="subv-filter-controls">
          {companies?.data && <>
            <span>所属公司</span><SelectField label="所属公司" value={needsCompany ? "unconfigured" : companyId} disabled={needsCompany}
              options={needsCompany ? [{ value: "unconfigured", label: "等待上报" }] : companies.data.map(value => ({ value: value.companyId, label: companyName(value) }))}
              onChange={value => { setSelected(value); setMonth(""); setCustom(null); setToast(""); }}/>
            <span>统计日期</span><SelectField label="统计日期" value={activeMonth} disabled={needsCompany}
              options={months.map(value => ({ value, label: value }))} onChange={value => { setMonth(value); setCustom(null); }}/>
          </>}
          <Button variant="ghost" size="icon-sm" aria-label="刷新数据" onClick={refresh}><RiRefreshLine/></Button>
        </div>
        <div className="subv-toolbar-end">
          {view && <div className="subv-filter-tags">
            <StatusTag><RiCheckLine/>已上报 {received} 天</StatusTag>
            {missing !== null && <StatusTag tone={missing ? "warning" : "neutral"}>缺报 {missing} 天</StatusTag>}
            {pending !== null && <StatusTag>待估价 {number.format(pending)} 件</StatusTag>}
          </div>}
          <div className="subv-actions">
            <Button variant="outline" size="sm" disabled={!view?.reports.length} onClick={exportData}>
              <RiDownload2Line data-icon="inline-start" aria-hidden/>数据导出
            </Button>
          </div>
        </div>
      </div>}
      <span className="subv:sr-only" role="status">{toast}</span>
      <TabsContent key={tab} value={tab} className="subv-tab-content">
        {tab === "settings" ? <Panel title="上报配置" className="subv-settings-panel"><WebhookSettings/></Panel>
          : failure ? <ErrorNotice message={failure} retry={refresh}/>
          : busy ? <div className="subv-skeleton"><Skeleton/><Skeleton/><Skeleton/></div>
          : tab === "overview" ? <>
              <div className="subv-overview">
                <TodayCard today={view?.todayReport ?? null} yesterday={yesterday} configured={!needsCompany} onOpen={() => openDay(today)}/>
                <CompanyCard company={company} onSettings={() => setTab("settings")}/>
                <SummaryCard count={received} missing={missing} pending={pending} next={next}/>
              </div>
              {analysis}
              <div className="subv-bottom">{fleet}{items}</div>
            </>
          : tab === "fleet" ? fleet
          : tab === "income" ? analysis
          : tab === "items" ? items
          : <Panel title="本月上报"><ReportList reports={view?.reports ?? []} onDay={openDay}/></Panel>}
      </TabsContent>
    </div>
    <Sheet open={drawer !== null} onOpenChange={open => { if (!open) setDrawer(null); }}>
      <SheetContent className="tn-ff14-subvoyage-income subv-sheet">
        <SheetHeader><SheetTitle>{drawer?.kind === "day" ? drawer.date + " · 每日收益" : "单价明细"}</SheetTitle>
          <SheetDescription>{company ? companyName(company) + " · " : ""}北京时间</SheetDescription></SheetHeader>
        {drawer && <div className="subv-sheet-body"><DrawerBody drawer={drawer} companyId={companyId}
          onPrice={openPrice} onDrawer={setDrawer}/></div>}
      </SheetContent>
    </Sheet>
  </ModuleLayout>;
}
