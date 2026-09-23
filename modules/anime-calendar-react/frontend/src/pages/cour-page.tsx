import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RiArrowLeftSLine, RiArrowRightSLine, RiFilter3Line, RiGridLine, RiListCheck2, RiRefreshLine, RiSearchLine } from "@remixicon/react";

import { AnimeDetailSheet } from "@/components/anime-detail-sheet";
import { AnimeListRow, AnimePosterCard, CompactAnimeRow } from "@/components/anime-card";
import { CompactSelect } from "@/components/controls";
import { AnimeGridSkeleton, PageEmpty, PageError } from "@/components/page-state";
import { YearSlider } from "@/components/year-slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCourItems, useMarkMutation, useRefreshMutation, useSettings, useToday } from "@/hooks/use-calendar";
import { currentDateParts, filterItems, nextCour, regionOptions, weekdayLabel, weekdayOptions } from "@/lib/anime";
import { cn } from "@/lib/utils";
import { timezone } from "@/module-context";
import type { AnimeListItem, AnimeMediaType, AnimeStatus } from "@/types";

const courOptions = [[1, "1月新番"], [4, "4月新番"], [7, "7月新番"], [10, "10月新番"]] as const;
const statusOptions = [["all", "全部状态"], ["not_started", "未开播"], ["airing", "放送中"], ["finished", "已完结"]] as const;
const mediaOptions = [["all", "全部类型"], ["tv", "TV"], ["movie", "剧场版"], ["ova", "OVA"], ["ona", "ONA"], ["sp", "SP"]] as const;
const markOptions = [["all", "全部标记"], ["watching", "我关注的"], ["ignored", "已屏蔽的"]] as const;
const initialVisibleCount = 36;
const loadMoreCount = 24;

export function CourPage() {
  const todayParts = currentDateParts(timezone()); const currentMonth = todayParts.month >= 10 ? 10 : todayParts.month >= 7 ? 7 : todayParts.month >= 4 ? 4 : 1;
  const [year, setYear] = useState(todayParts.year); const [month, setMonth] = useState(currentMonth); const [keyword, setKeyword] = useState(""); const [filtersOpen, setFiltersOpen] = useState(false);
  const [weekday, setWeekday] = useState<number | null>(null); const [status, setStatus] = useState<AnimeStatus | null>(null); const [mediaType, setMediaType] = useState<AnimeMediaType | null>(null); const [markType, setMarkType] = useState<"watching" | "ignored" | null>(null); const [region, setRegion] = useState("all"); const [sort, setSort] = useState<"default" | "score">("default"); const [view, setView] = useState<"grid" | "list">("grid"); const [visible, setVisible] = useState(initialVisibleCount); const [detail, setDetail] = useState<AnimeListItem | null>(null); const [todayWatching, setTodayWatching] = useState(false); const [todayRegion, setTodayRegion] = useState("all");
  const [preservedOrder, setPreservedOrder] = useState<{ key: string; order: Map<string, number> } | null>(null);
  const itemsQuery = useCourItems(year, month); const todayQuery = useToday(); const settingsQuery = useSettings(); const mark = useMarkMutation(); const refresh = useRefreshMutation(year, month); const autoRefreshKey = useRef("");
  const settings = settingsQuery.data; useEffect(() => { if (!settings) return; setRegion(settings.defaultRegion); setSort(settings.defaultSort); setView(settings.defaultView); }, [settings]);
  useEffect(() => { const data = itemsQuery.data; const key = `${year}-${month}`; if (settings?.autoFetchEmptyCour && data && (data.cache_status === "stale" || (data.cache_status === "empty" && !data.items.length)) && autoRefreshKey.current !== key) { autoRefreshKey.current = key; refresh.mutate(); } }, [itemsQuery.data, month, refresh, settings?.autoFetchEmptyCour, year]);
  useEffect(() => { setVisible(initialVisibleCount); setPreservedOrder(null); }, [year, month, keyword, weekday, status, mediaType, markType, region, sort, view]);
  const currentCourKey = `${year}-${month}`;
  const filtered = useMemo(() => {
    const order = preservedOrder?.key === currentCourKey ? preservedOrder.order : null;
    const options = { keyword, weekday, status, mediaType, markType, region, showContinuing: settings?.showContinuing ?? true, showUnknown: settings?.showUnknownRegion ?? false, sort, ...(order ? { preservedOrder: order } : {}) };
    return filterItems(itemsQuery.data?.items ?? [], options);
  }, [currentCourKey, itemsQuery.data, keyword, weekday, status, mediaType, markType, region, settings, sort, preservedOrder]);
  const markItem = useCallback((item: AnimeListItem, value: "watching" | "ignored") => {
    setPreservedOrder((current) => {
      if (current?.key === currentCourKey) return current;
      return { key: currentCourKey, order: new Map(filtered.map((entry, index) => [entry.id, index])) };
    });
    mark.mutate({ item, mark: value });
  }, [currentCourKey, filtered, mark]);
  const refreshCour = () => { setPreservedOrder(null); refresh.mutate(); };
  const loadMoreSentinel = useRef<HTMLDivElement | null>(null);
  const loadMore = useCallback(() => setVisible((current) => Math.min(current + loadMoreCount, filtered.length)), [filtered.length]);
  useEffect(() => {
    const sentinel = loadMoreSentinel.current;
    if (!sentinel || visible >= filtered.length || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root: null, rootMargin: "0px 0px 320px 0px", threshold: 0.01 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filtered.length, loadMore, visible]);
  const watched = (itemsQuery.data?.items ?? []).filter((item) => item.mark_type === "watching"); const todayItems = (todayQuery.data?.items ?? []).filter((item) => !todayWatching || item.mark_type === "watching").filter((item) => todayRegion === "all" || item.region === todayRegion);
  const isCurrent = year === todayParts.year && month === currentMonth;
  const moveCour = (direction: -1 | 1) => { const next = nextCour(year, month, direction); setYear(next.year); setMonth(next.month); };
  const clearFilters = () => { setWeekday(null); setStatus(null); setMediaType(null); setMarkType(null); setKeyword(""); };
  return <div className="tn-anime-page">
    <Card className="tn-anime-courbar"><CardContent><div className="tn-anime-courbar__title"><Button size="icon-sm" variant="ghost" aria-label="上一档" onClick={() => moveCour(-1)}><RiArrowLeftSLine /></Button><div><strong>{itemsQuery.data?.cour_label ?? `${year}年${month}月新番`}</strong>{isCurrent ? <span>当前放送档期</span> : <button type="button" onClick={() => { setYear(todayParts.year); setMonth(currentMonth); }}>回到当前档期</button>}</div><Button size="icon-sm" variant="ghost" aria-label="下一档" onClick={() => moveCour(1)}><RiArrowRightSLine /></Button></div><div className="tn-anime-courbar__tools"><YearSlider value={year} onChange={setYear} /><Separator orientation="vertical" /><CompactSelect value={String(month)} options={courOptions} onChange={(value) => setMonth(Number(value))} /><Button variant={filtersOpen ? "secondary" : "outline"} onClick={() => setFiltersOpen((value) => !value)}><RiFilter3Line data-icon="inline-start" />筛选</Button><Button variant="outline" disabled={refresh.isPending} aria-busy={refresh.isPending} onClick={refreshCour}><RiRefreshLine data-icon="inline-start" className={cn(refresh.isPending && "animate-spin")} />{refresh.isPending ? "刷新中" : "刷新"}</Button></div></CardContent>
      {filtersOpen ? <><Separator /><CardContent className="tn-anime-filter-panel"><CompactSelect value={weekday === null ? "all" : String(weekday)} options={[["all", "全部星期"], ...weekdayOptions]} onChange={(value) => setWeekday(value === "all" ? null : Number(value))} /><CompactSelect value={status ?? "all"} options={statusOptions} onChange={(value) => setStatus(value === "all" ? null : value as AnimeStatus)} /><CompactSelect value={mediaType ?? "all"} options={mediaOptions} onChange={(value) => setMediaType(value === "all" ? null : value as AnimeMediaType)} /><CompactSelect value={markType ?? "all"} options={markOptions} onChange={(value) => setMarkType(value === "all" ? null : value as "watching" | "ignored")} /><Button size="sm" variant="ghost" onClick={clearFilters}>清除条件</Button></CardContent></> : null}</Card>
    {itemsQuery.isError ? <PageError description="无法读取档期新番。" retry={() => void itemsQuery.refetch()} /> : itemsQuery.isLoading ? <AnimeGridSkeleton /> : <>
      <Section title="我关注的新番" count={watched.length} meta={`在追 ${watched.length} 部`}>{watched.length ? <div className="tn-anime-poster-rail">{watched.map((item) => <AnimePosterCard key={item.id} item={item} isToday={isCurrent && item.weekday === todayParts.weekday} onOpen={() => setDetail(item)} onMark={(value) => markItem(item, value)} />)}</div> : <PageEmpty title="还没有关注的新番" description="可以在全部新番中选择感兴趣的作品。" />}</Section>
      {isCurrent ? <Section title="今日更新" count={todayItems.length} meta={`${weekdayLabel(todayParts.weekday)} · ${todayParts.key}`} actions={<div className="flex gap-2"><Button size="sm" variant={todayWatching ? "secondary" : "outline"} aria-pressed={todayWatching} onClick={() => setTodayWatching((value) => !value)}>只看关注</Button><CompactSelect value={todayRegion} options={regionOptions} onChange={setTodayRegion} /></div>}>{todayQuery.isError ? <PageError title="今日放送加载失败" description="无法读取今日放送，请稍后重试。" retry={() => void todayQuery.refetch()} /> : todayQuery.isLoading ? <div className="tn-anime-today-grid">{Array.from({ length: 4 }, (_, index) => <Empty key={index} className="h-20" />)}</div> : todayItems.length ? <div className="tn-anime-today-grid">{todayItems.map((item) => <CompactAnimeRow key={item.id} item={item} onOpen={() => setDetail(item)} onMark={() => markItem(item, "watching")} />)}</div> : <PageEmpty title="今日暂无更新" description="当前筛选条件下没有放送作品。" />}</Section> : null}
      <Section title="全部新番" count={filtered.length} actions={<div className="tn-anime-section__actions"><div className="tn-anime-search"><RiSearchLine /><Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索番剧、原名或制作公司" /></div><CompactSelect value={region} options={regionOptions} onChange={setRegion} /><Button size="sm" variant="outline" onClick={() => setSort((value) => value === "default" ? "score" : "default")}>{sort === "score" ? "按评分" : "默认顺序"}</Button><ToggleGroup value={[view]} onValueChange={(values) => { const value = values[0]; if (value === "grid" || value === "list") setView(value); }} variant="outline" spacing={0}><ToggleGroupItem value="grid" aria-label="卡片视图"><RiGridLine /></ToggleGroupItem><ToggleGroupItem value="list" aria-label="列表视图"><RiListCheck2 /></ToggleGroupItem></ToggleGroup></div>}>
        {filtered.length ? view === "grid" ? <div className="tn-anime-grid">{filtered.slice(0, visible).map((item) => <AnimePosterCard key={item.id} item={item} isToday={isCurrent && item.weekday === todayParts.weekday} onOpen={() => setDetail(item)} onMark={(value) => markItem(item, value)} />)}</div> : <div className="tn-anime-list">{filtered.slice(0, visible).map((item) => <AnimeListRow key={item.id} item={item} onOpen={() => setDetail(item)} onMark={(value) => markItem(item, value)} />)}</div> : <PageEmpty title="没有匹配的新番" description="调整筛选条件，或刷新当前档期。" action={<Button onClick={refreshCour}>刷新当前档期</Button>} />}
        {visible < filtered.length ? <div ref={loadMoreSentinel} className="tn-anime-load-more"><Button variant="outline" onClick={loadMore}>加载更多（剩余 {filtered.length - visible}）</Button></div> : null}
      </Section>
    </>}
    <AnimeDetailSheet item={detail} onOpenChange={(open) => { if (!open) setDetail(null); }} />
  </div>;
}

function Section({ title, count, meta, actions, children }: { title: string; count: number; meta?: string; actions?: React.ReactNode; children: React.ReactNode }) { return <section className="tn-anime-section"><header className="tn-anime-section__header"><div><h2>{title}</h2><Badge variant="secondary">{count}</Badge>{meta ? <span>{meta}</span> : null}</div>{actions}</header>{children}</section>; }
