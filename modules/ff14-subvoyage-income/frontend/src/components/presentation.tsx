import { useState, type ReactNode } from "react";
import { RiAnchorLine, RiArchiveStackLine, RiArrowRightLine, RiCalendarLine, RiCompass3Line, RiErrorWarningLine, RiShipLine, RiStackLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { iconUrl } from "@/api/subvoyage";
import { companyName, displayTime, gil, number, percent, schedule, triggerName, type Loot } from "@/lib/income";
import type { Company, Dashboard, Report, Vessel } from "@/types";

type Icon = typeof RiAnchorLine;
export function Panel({ title, id, icon: Mark, action, children, className = "" }: {
  title: string; id?: string; icon?: Icon; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return <Card id={id} className={"subv-panel " + className}>
    <CardHeader className="subv-panel-head"><CardTitle className="subv-title">
      <h2>{Mark && <Mark aria-hidden/>}{title}</h2></CardTitle>{action}</CardHeader>
    <CardContent className="subv-panel-content">{children}</CardContent>
  </Card>;
}
export function SelectField({ label, value, onChange, options, disabled }: {
  label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean;
}) {
  return <Select value={value} items={options} disabled={disabled} onValueChange={next => { if (next) onChange(next); }}>
    <SelectTrigger aria-label={label} className="subv-select"><SelectValue/></SelectTrigger>
    <SelectContent alignItemWithTrigger={false} className="tn-ff14-subvoyage-income-popup"><SelectGroup>
      {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
    </SelectGroup></SelectContent>
  </Select>;
}
export function StatusTag({ tone = "neutral", children }: {
  tone?: "neutral" | "warning" | "accent" | "success"; children: ReactNode;
}) {
  return <Badge variant="outline" className="subv-status" data-tone={tone}>{children}</Badge>;
}

export function TodayCard({ today, yesterday, onOpen, configured = true }: { today: Report | null; yesterday: number | undefined; onOpen: () => void; configured?: boolean }) {
  const delta = today && yesterday !== undefined && yesterday > 0 ? (today.totalGil - yesterday) / yesterday : null;
  return <Card className="subv-income">
    <CardHeader><CardTitle><h2>今日潜艇打捞总收入</h2></CardTitle></CardHeader>
    <CardContent className="subv-income-body">
      <div className="subv-income-total">{today ? number.format(today.totalGil) : "—"} <small>Gil</small></div>
      <div className="subv-income-meta">
        <span>NPC 估值</span>
        {delta !== null && <span data-delta={delta < 0 ? "negative" : delta > 0 ? "positive" : "flat"}>较昨日 {delta > 0 ? "+" : ""}{percent.format(delta)}</span>}
        {today && <Button variant="ghost" size="sm" onClick={onOpen}>道具明细 <RiArrowRightLine data-icon="inline-end"/></Button>}
      </div>
      <p className="subv-muted subv-small">{today ? displayTime(today.generatedAt) + " · " + triggerName(today.trigger) : configured ? "今日尚未收到上报" : "等待插件首次上报"}</p>
    </CardContent>
  </Card>;
}
export function CompanyCard({ company, vessels, onSettings }: { company: Company | undefined; vessels: Vessel[] | undefined; onSettings: () => void }) {
  const name = company ? companyName(company) : "尚未收到部队上报";
  return <Card className="subv-panel" aria-label="部队概况">
    <CardContent className="subv-panel-content subv-company-body"><div className="subv-company-profile">
    <RiAnchorLine aria-hidden className="subv-company-icon"/>
    <div>
      <h2 title={name}>{name}</h2>
      <dl className="subv-profile-list">
        <div><dt>服务器</dt><dd>{company?.companyWorld || "—"}</dd></div>
        <div><dt>公司规模</dt><dd>{vessels === undefined ? "—" : vessels.length + " 艘潜水艇"} · {company?.companyTotalMembers != null ? company.companyTotalMembers + " 人" : "—"}</dd></div>
        <div><dt>等级／军队</dt><dd>{company?.companyRank ?? "—"} ／ {company?.companyGrandCompany ?? "—"}</dd></div>
        <div><dt>会长</dt><dd>{company?.companyLeaderName ?? "—"}</dd></div>
        <div><dt>部队 ID</dt><dd>{company?.companyId ?? "—"}</dd></div>
      </dl>
    </div>
    </div>
    {!company && <Button size="sm" className="subv-company-settings" onClick={onSettings}>配置上报</Button>}
    </CardContent>
  </Card>;
}
export function SummaryCard({ count, missing, pending, next }: { count: number | null; missing: number | null; pending: number | null; next: Vessel | undefined }) {
  return <Card className="subv-panel subv-summary" aria-label="统计摘要"><CardContent className="subv-panel-content"><dl>
    <div><dt><RiCalendarLine aria-hidden/>已上报天数</dt><dd><strong>{count ?? "—"}</strong>{count !== null && " 天"}</dd></div>
    <div><dt><RiErrorWarningLine aria-hidden/>缺报天数</dt><dd><strong>{missing ?? "—"}</strong>{missing !== null && " 天"}</dd></div>
    <div><dt><RiStackLine aria-hidden/>待估价数量</dt><dd><strong>{pending === null ? "—" : number.format(pending)}</strong>{pending !== null && " 件"}</dd></div>
    <div><dt><RiCompass3Line aria-hidden/>下一艘返航</dt><dd className="subv-gold">{next?.nextCompletionTimestamp != null ?
      next.name + " · " + displayTime(next.nextCompletionTimestamp * 1000) : "—"}</dd></div>
  </dl></CardContent></Card>;
}
function VesselDrawing() {
  return <svg className="subv-vessel-mark" viewBox="0 0 180 54" aria-hidden="true" fill="none" stroke="currentColor">
    <path d="M6 41c14-8 27-10 51-12l75-3c17 0 31 3 43 8-10 9-25 12-42 13H43C24 47 10 45 6 41Z"/>
    <path d="m6 41 14 1 128-2 27-6M26 38l23-7m-9 15v-7m14 7v-8m16 8v-8m63 7v-7M72 28l6-5 10-1 2-8 24-1 4 10 11 3m-36-12V7h4v6m10 0V4h3v9m7 0v-5h2m-34 15 35-1m-25-5h4m4 0h4m4 0h4M146 28l8-7 6 2-3 7M28 32l-10-4-2 4 4 4"/>
  </svg>;
}
export function FleetRows({ view, now }: { view: Dashboard | undefined; now: number }) {
  if (!view?.fleet) return <div className="subv-empty subv-fleet-empty">
    <VesselDrawing/>
    <p>{view ? "尚未收到潜水艇快照。请在部队工房内触发一次插件上报。" : "收到潜水艇快照后显示预计返航和剩余时间。"}</p>
  </div>;
  const inherited = view.latest?.submersibles === null && view.latest.generatedAt !== view.fleet.generatedAt;
  return <>
    {view.fleet.submersibles.length ? <div className="subv-vessels">{view.fleet.submersibles.map(vessel => {
      const info = schedule(vessel, now);
      return <Card className="subv-vessel" key={vessel.slot}>
        <CardHeader className="subv-vessel-header"><CardTitle><h3 title={vessel.name}>{vessel.name || "槽位 " + vessel.slot}</h3></CardTitle>
          <StatusTag tone={info.tone}>{info.status}</StatusTag></CardHeader>
        <VesselDrawing/>
        <CardContent><dl><div><dt>预计返航</dt><dd>{info.time}</dd></div><div><dt>剩余时间</dt><dd className="subv-countdown">{info.remaining}</dd></div></dl></CardContent>
      </Card>;
    })}</div> : <p className="subv-empty">暂无已登记的潜水艇。</p>}
    <p className="subv-muted subv-small subv-fleet-source">{inherited ? "沿用历史快照 · " : "潜水艇快照 · "}{displayTime(view.fleet.generatedAt)}</p>
  </>;
}
export function FleetPanel({ view, now, onOpen }: { view: Dashboard | undefined; now: number; onOpen: (() => void) | undefined }) {
  return <Panel title="潜水艇返航计划" id="subv-fleet" icon={RiShipLine} action={onOpen && <Button variant="ghost" size="sm" onClick={onOpen}>查看潜水艇 <RiArrowRightLine data-icon="inline-end"/></Button>}>
    <FleetRows view={view} now={now}/>
  </Panel>;
}
function ItemIcon({ id }: { id: number }) {
  const [missing, setMissing] = useState(false);
  return <span className="subv-item-icon">{missing ? <RiArchiveStackLine aria-hidden/> :
    <img src={iconUrl(id)} alt="" loading="lazy" decoding="async" onError={() => setMissing(true)}/>}</span>;
}
export function TableContainer({ children }: { children: ReactNode }) {
  return <div className="subv-table-container">{children}</div>;
}
export function LootTable({ rows, total, onPrice, limit }: {
  rows: Loot[]; total: number | null; onPrice: (row: Loot) => void; limit?: number;
}) {
  const visible = limit ? rows.slice(0, limit) : rows;
  return <TableContainer><Table className="subv-loot-table">
    <caption className="subv:sr-only">打捞物品明细</caption>
    <colgroup><col className="subv-name-col"/><col/><col/><col/><col className="subv-share-col"/></colgroup>
    <TableHeader><TableRow><TableHead scope="col">物品名称</TableHead><TableHead scope="col">上报数量</TableHead>
      <TableHead scope="col">NPC 单价 (Gil)</TableHead><TableHead scope="col">总估价 (Gil)</TableHead><TableHead scope="col">收入占比</TableHead></TableRow></TableHeader>
    <TableBody>{!visible.length && <TableRow><TableCell colSpan={5}><p className="subv-empty">暂无道具明细。</p></TableCell></TableRow>}{visible.map(row => {
      const price = [...row.prices.keys()][0];
      const share = row.subtotal !== null && total !== null && total > 0 ? row.subtotal / total : null;
      return <TableRow key={row.itemId}><TableCell><span className="subv-item-name" title={row.name}><ItemIcon id={row.itemId}/>{row.name}</span></TableCell>
        <TableCell>{number.format(row.quantity)}</TableCell>
        <TableCell>{row.prices.size > 1 ? <Button variant="link" className="subv-price" size="sm" onClick={() => onPrice(row)}>多单价</Button>
          : price == null ? <span className="subv-gold">待估价</span> : number.format(price)}</TableCell>
        <TableCell>{row.subtotal === null ? "—" : number.format(row.subtotal)}</TableCell>
        <TableCell>{share === null ? "—" : <span className="subv-share"><i aria-hidden><span style={{ width: percent.format(share) }}/></i>{percent.format(share)}</span>}</TableCell>
      </TableRow>;
    })}</TableBody>
    <TableFooter><TableRow><TableCell>合计</TableCell><TableCell>{rows.length ? number.format(rows.reduce((sum, row) => sum + row.quantity, 0)) : "—"}</TableCell>
      <TableCell>—</TableCell><TableCell>{total === null ? "—" : number.format(total)}</TableCell><TableCell>{total !== null && total > 0 ? "100%" : "—"}</TableCell></TableRow></TableFooter>
  </Table></TableContainer>;
}
