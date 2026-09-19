import { RiExternalLinkLine, RiEyeOffLine, RiHeartFill, RiHeartLine } from "@remixicon/react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useDetail, useMarkMutation } from "@/hooks/use-calendar";
import { airInfo, displayTitle, fallbackCover, mediaLabels, statusLabels } from "@/lib/anime";
import type { AnimeListItem } from "@/types";

export function AnimeDetailSheet({ item, onOpenChange }: { item: AnimeListItem | null; onOpenChange: (open: boolean) => void }) {
  const detail = useDetail(item?.id ?? null); const mark = useMarkMutation(); const current = detail.data ?? item;
  return <Sheet open={Boolean(item)} onOpenChange={onOpenChange}><SheetContent className="tn-anime-detail-sheet">
    <SheetHeader><SheetTitle>番剧详情</SheetTitle><SheetDescription>查看放送信息、标签与作品简介。</SheetDescription></SheetHeader>
    {!current && detail.isLoading ? <div className="tn-anime-detail-sheet__loading"><Skeleton className="h-64 w-full" /><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24 w-full" /></div> : detail.isError ? <Alert variant="destructive"><AlertTitle>详情加载失败</AlertTitle><AlertDescription><Button size="sm" variant="outline" onClick={() => void detail.refetch()}>重试</Button></AlertDescription></Alert> : current ? <div className="tn-anime-detail">
      <section className="tn-anime-detail__hero"><img src={current.cover_url || fallbackCover(current)} alt={displayTitle(current)} onError={(event) => { event.currentTarget.src = fallbackCover(current); }} /><div><div className="flex flex-wrap gap-2"><Badge>{mediaLabels[current.media_type]}</Badge><Badge variant="secondary">{statusLabels[current.status]}</Badge>{current.score ? <Badge variant="outline">★ {current.score}</Badge> : null}</div><p>{current.cour_label}</p><h2>{displayTitle(current)}</h2>{current.title_original && current.title_original !== displayTitle(current) ? <span>{current.title_original}</span> : null}<strong>{airInfo(current)}</strong><div className="flex flex-wrap gap-2"><Button onClick={() => mark.mutate({ item: current, mark: "watching" })}>{current.mark_type === "watching" ? <RiHeartFill data-icon="inline-start" /> : <RiHeartLine data-icon="inline-start" />}{current.mark_type === "watching" ? "取消关注" : "关注"}</Button>{current.external_url ? <Button variant="outline" render={<a href={current.external_url} target="_blank" rel="noreferrer" />}><RiExternalLinkLine data-icon="inline-start" />Bangumi</Button> : null}<Button size="icon" variant="outline" aria-label={current.mark_type === "ignored" ? "取消屏蔽" : "屏蔽"} onClick={() => mark.mutate({ item: current, mark: "ignored" })}><RiEyeOffLine /></Button></div></div></section>
      <Separator /><section><h3>放送信息</h3><dl className="tn-anime-detail__facts"><div><dt>放送</dt><dd>{airInfo(current)}</dd></div><div><dt>集数</dt><dd>{current.episode_count ? `共 ${current.episode_count} 集` : "暂未公布"}</dd></div><div><dt>制作</dt><dd>{current.studio || "暂未公布"}</dd></div><div><dt>档期</dt><dd>{current.cour_label}</dd></div></dl></section>
      {detail.data?.tags.length ? <><Separator /><section><h3>标签</h3><div className="flex flex-wrap gap-2">{detail.data.tags.map((tag: string) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div></section></> : null}
      <Separator /><section><h3>简介</h3><p className="tn-anime-detail__summary">{detail.data?.summary || "暂未收录剧情简介。"}</p></section>
    </div> : null}
  </SheetContent></Sheet>;
}
