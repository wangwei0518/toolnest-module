import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { RiBarChartGroupedLine, RiCheckLine, RiDownload2Line, RiErrorWarningLine, RiFileList2Line,
  RiHome5Line, RiRefreshLine, RiSettings3Line, RiShipLine, RiStackLine } from "@remixicon/react";
import * as api from "@/api/subvoyage";
import { HeatMap, ItemsPanel, Trend, type DateRange, type Range } from "@/components/analytics";
import { CompanyCard, FleetPanel, FleetRows, LootTable, SelectField, StatusTag, SummaryCard, TodayCard } from "@/components/presentation";
import { ModuleLayout } from "@/components/module-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { aggregate, calendar, chinaToday, companyName, displayMonth, displayTime, downloadReports, gil, number,
  triggerName, type Loot } from "@/lib/income";
import type { Company, Credential, Dashboard, Report } from "@/types";

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
    <Label htmlFor="subv-webhook-url">Webhook 地址</Label><Input id="subv-webhook-url" readOnly value={url}/>
    <Label htmlFor="subv-webhook-token">上报令牌</Label><Input id="subv-webhook-token" readOnly value={credential.token}/>
    <Label htmlFor="subv-webhook-curl">认证请求示例</Label><Input id="subv-webhook-curl" readOnly value={command} onFocus={event => event.target.select()}/>
    <Button variant="outline" onClick={async () => {
      try { await navigator.clipboard.writeText(command); setCopyStatus("已复制完整请求"); }
      catch { document.getElementById("subv-webhook-curl")?.focus(); setCopyStatus("已选中请求，请使用 Ctrl+C 复制"); }
    }}>复制认证请求</Button><span role="status" className="subv-small">{copyStatus}</span>
  </div>;
}
function CompanySettings({ company, onChange }: { company: Company | undefined; onChange: (companyId: string) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [credential, setCredential] = useState<Credential>();
  const [confirmRotate, setConfirmRotate] = useState(false);

  async function run(action: () => Promise<void>) {
    setPending(true); setError(""); setMessage("");
    try { await action(); }
    catch (failure) { setError(api.errorText(failure, "操作失败，请重试。")); }
    finally { setPending(false); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = String(form.get("id") ?? "").trim();
    const alias = String(form.get("alias") ?? "").trim();
    void run(async () => {
      const result = await api.createCompany(id, alias);
      setCredential(result); onChange(result.companyId);
    });
  }
  function edit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!company) return;
    const alias = String(new FormData(event.currentTarget).get("alias") ?? "").trim();
    void run(async () => { await api.editCompany(company.companyId, alias); onChange(""); setMessage("部队别名已保存"); });
  }
  if (credential) return <CredentialView credential={credential}/>;
  return <div className="subv-settings">
    {error && <ErrorNotice message={error}/>}
    {message && <p role="status">{message}</p>}
    {company && <section aria-label="当前部队配置" className="subv-form">
      <h3>{companyName(company)}</h3>
      <form onSubmit={edit} className="subv-form">
        <Label htmlFor="subv-edit-alias">显示别名</Label><Input id="subv-edit-alias" name="alias" defaultValue={company.alias} maxLength={80}/>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>保存别名</Button>
      </form>
      {confirmRotate ? <Alert variant="destructive"><AlertTitle>轮换后旧令牌立即失效</AlertTitle><AlertDescription>
        <div className="subv-actions"><Button size="sm" variant="destructive" disabled={pending} onClick={() => void run(async () => {
          setCredential(await api.rotateToken(company.companyId)); setConfirmRotate(false);
        })}>确认轮换</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirmRotate(false)}>取消</Button></div>
      </AlertDescription></Alert> : <Button variant="outline" size="sm" onClick={() => setConfirmRotate(true)}>轮换上报令牌</Button>}
    </section>}
    <form className="subv-form" onSubmit={create}>
      <h3>新增部队</h3>
      <Label htmlFor="subv-company-id">部队 ID</Label><Input id="subv-company-id" name="id" inputMode="numeric" pattern="[1-9][0-9]{0,19}" maxLength={20} required/>
      <Label htmlFor="subv-company-alias">显示别名（可选）</Label><Input id="subv-company-alias" name="alias" maxLength={80}/>
      <Button size="sm" type="submit" disabled={pending}>创建部队与令牌</Button>
    </form>
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

type Drawer = { kind: "settings" | "fleet" | "loot" | "reports" } | { kind: "day"; date: string } |
  { kind: "price"; row: Loot; previous: Drawer | null };
const sectionLabel = { settings: "公司设置", fleet: "舰队管理", loot: "本月打捞物品", reports: "上报记录", day: "每日收益", price: "单价明细" };

function DrawerBody({ drawer, current, companyId, view, now, rows, total, onChange, onDay, onPrice, onDrawer }: {
  drawer: Drawer; current: Company | undefined; companyId: string; view: Dashboard | undefined; now: number;
  rows: Loot[]; total: number; onChange: (id: string) => void; onDay: (date: string) => void;
  onPrice: (row: Loot) => void; onDrawer: (drawer: Drawer | null) => void;
}) {
  if (drawer.kind === "settings") return <CompanySettings company={current} onChange={onChange}/>;
  if (drawer.kind === "day") return <DayDetails companyId={companyId} date={drawer.date} onPrice={onPrice}/>;
  if (drawer.kind === "price") return <div className="subv-form">
    {drawer.previous && <Button size="sm" variant="outline" onClick={() => onDrawer(drawer.previous)}>返回明细</Button>}
    <dl className="subv-detail-list">{[...drawer.row.prices].map(([price, quantity]) => <div key={price ?? "unknown"}>
      <dt>{price === null ? "待估价" : gil(price)}</dt><dd>{number.format(quantity)} 件</dd><dd>{price === null ? "—" : gil(price * quantity)}</dd>
    </div>)}</dl>
  </div>;
  if (!view) return <p className="subv-empty">暂无可查看的数据。</p>;
  if (drawer.kind === "fleet") return <FleetRows view={view} now={now}/>;
  if (drawer.kind === "loot") return <LootTable rows={rows} total={total} onPrice={onPrice}/>;
  return view.reports.length ? <div className="subv-report-list">{[...view.reports].reverse().map(row =>
    <Button size="sm" variant="outline" key={row.date} onClick={() => onDay(row.date)}>
      <span>{row.date}</span><span>{displayTime(row.generatedAt)} · {triggerName(row.trigger)}</span><b>{gil(row.totalGil)}</b>
    </Button>)}</div> : <p className="subv-empty">该月份暂无上报。</p>;
}

export function ModuleApp() {
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
  const openSettings = () => setDrawer({ kind: "settings" });
  const openDay = (date: string) => setDrawer({ kind: "day", date });
  const openPrice = (row: Loot) => setDrawer({ kind: "price", row, previous: drawer });
  function scrollTo(id: string) { document.getElementById(id)?.scrollIntoView({ block: "nearest" }); }
  function exportData() {
    if (!view) return;
    downloadReports(view.reports, companyId, view.month);
    setToast("已导出 " + displayMonth(view.month) + "收益");
  }
  const actions: [string, ReactNode, () => void, boolean][] = [
    ["总览看板", <RiHome5Line data-icon="inline-start"/>, () => scrollTo("subv-overview"), false],
    ["舰队管理", <RiShipLine data-icon="inline-start"/>, () => scrollTo("subv-fleet"), !view && !needsCompany],
    ["收益分析", <RiBarChartGroupedLine data-icon="inline-start"/>, () => scrollTo("subv-trend"), !view && !needsCompany],
    ["物品分析", <RiStackLine data-icon="inline-start"/>, () => scrollTo("subv-loot"), !view && !needsCompany],
    ["上报记录", <RiFileList2Line data-icon="inline-start"/>, () => setDrawer({ kind: "reports" }), !view],
    ["数据导出", <RiDownload2Line data-icon="inline-start"/>, exportData, !view?.reports.length],
    ["公司设置", <RiSettings3Line data-icon="inline-start"/>, openSettings, !companies?.data],
  ];
  return <ModuleLayout actions={actions}>
    <div className="subv-console" id="subv-overview">
      <div className="subv-filters">
        <div className="subv-filter-controls">
          {companies?.data && <>
            <span>所属公司</span><SelectField label="所属公司" value={needsCompany ? "unconfigured" : companyId} disabled={needsCompany}
              options={needsCompany ? [{ value: "unconfigured", label: "尚未配置" }] : companies.data.map(value => ({ value: value.companyId, label: companyName(value) }))}
              onChange={value => { setSelected(value); setMonth(""); setCustom(null); setToast(""); }}/>
            <span>统计日期</span><SelectField label="统计日期" value={activeMonth} disabled={needsCompany}
              options={months.map(value => ({ value, label: value }))} onChange={value => { setMonth(value); setCustom(null); }}/>
          </>}
          <Button variant="ghost" size="icon-sm" aria-label="刷新数据" onClick={refresh}><RiRefreshLine/></Button>
        </div>
        {view && <div className="subv-filter-tags">
          <StatusTag><RiCheckLine/>已上报 {received} 天</StatusTag>
          {missing !== null && <StatusTag tone={missing ? "warning" : "neutral"}>缺报 {missing} 天</StatusTag>}
          {pending !== null && <StatusTag>待估价 {number.format(pending)} 件</StatusTag>}
        </div>}
      </div>
      <span className="sr-only" role="status">{toast}</span>
      {companies?.error ? <ErrorNotice message={companies.error} retry={refresh}/>
        : data?.error ? <ErrorNotice message={data.error} retry={refresh}/>
          : !view && !needsCompany ? <div className="subv-skeleton"><Skeleton/><Skeleton/><Skeleton/></div>
            : <>
              <div className="subv-overview">
                <TodayCard today={view?.todayReport ?? null} yesterday={yesterday} configured={!needsCompany} onOpen={() => openDay(today)}/>
                <CompanyCard company={company} vessels={view?.fleet?.submersibles} onSettings={openSettings}/>
                <SummaryCard count={received} missing={missing} pending={pending} next={next}/>
              </div>
              <div className="subv-analysis">
                <HeatMap view={view} today={today} month={activeMonth} total={monthlyTotal} onMonth={value => { setMonth(value); setCustom(null); }} onDay={openDay}/>
                <Trend view={view} today={today} month={activeMonth} range={range} custom={custom} result={customTrend} onCustom={setCustom} onRange={value => { setRange(value); setCustom(null); }} onDay={openDay}/>
              </div>
              <div className="subv-bottom">
                <FleetPanel view={view} now={now} onOpen={() => setDrawer({ kind: "fleet" })}/>
                <ItemsPanel hasItems={rows.length > 0} onOpen={() => setDrawer({ kind: "loot" })}>
                  <LootTable rows={rows} total={monthlyTotal} onPrice={openPrice} limit={5}/>
                </ItemsPanel>
              </div>
            </>}
    </div>
    <Sheet open={drawer !== null} onOpenChange={open => { if (!open) setDrawer(null); }}>
      <SheetContent className="tn-ff14-subvoyage-income subv-sheet">
        <SheetHeader><SheetTitle>{drawer?.kind === "day" ? drawer.date + " · 每日收益" : drawer ? sectionLabel[drawer.kind] : "潜航控制台"}</SheetTitle>
          <SheetDescription>{company ? companyName(company) + " · " : ""}北京时间</SheetDescription></SheetHeader>
        {drawer && <div className="subv-sheet-body"><DrawerBody drawer={drawer} current={company} companyId={companyId} view={view}
          now={now} rows={rows} total={monthlyTotal ?? 0} onChange={id => { if (id) { setSelected(id); setMonth(""); setCustom(null); } refresh(); }}
          onDay={openDay} onPrice={openPrice} onDrawer={setDrawer}/></div>}
      </SheetContent>
    </Sheet>
  </ModuleLayout>;
}
