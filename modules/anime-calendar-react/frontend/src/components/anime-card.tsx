import { RiExternalLinkLine, RiEyeOffLine, RiHeartFill, RiHeartLine } from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { airInfo, displayTitle, fallbackCover, mediaLabels } from "@/lib/anime";
import type { AnimeListItem, AnimeMarkType } from "@/types";

export function AnimePosterCard({ item, onOpen, onMark }: { item: AnimeListItem; onOpen: () => void; onMark: (mark: AnimeMarkType) => void }) {
  return <Card className="tn-anime-card group" data-ignored={item.mark_type === "ignored" || undefined} onClick={onOpen}>
    <CardContent className="tn-anime-card__media">
      <img src={cover(item)} alt={displayTitle(item)} loading="lazy" onError={(event) => { event.currentTarget.src = fallbackCover(item); }} />
      <div className="tn-anime-card__badges"><Badge variant="secondary">{mediaLabels[item.media_type]}</Badge>{item.score ? <Badge variant="outline">★ {item.score}</Badge> : null}</div>
      {item.cour_relation !== "unknown" ? <Badge className="tn-anime-card__relation">{item.cour_relation_label}</Badge> : null}
      <div className="tn-anime-card__actions" onClick={(event) => event.stopPropagation()}>
        <Tooltip><TooltipTrigger render={<Button type="button" size="icon-sm" variant={item.mark_type === "watching" ? "default" : "secondary"} aria-label={item.mark_type === "watching" ? "取消关注" : "关注"} onClick={() => onMark("watching")} />}>{item.mark_type === "watching" ? <RiHeartFill /> : <RiHeartLine />}</TooltipTrigger><TooltipContent>{item.mark_type === "watching" ? "取消关注" : "关注"}</TooltipContent></Tooltip>
        {item.external_url ? <Tooltip><TooltipTrigger render={<Button size="icon-sm" variant="secondary" aria-label="打开 Bangumi" render={<a href={item.external_url} target="_blank" rel="noreferrer" />} />}><RiExternalLinkLine /></TooltipTrigger><TooltipContent>打开 Bangumi</TooltipContent></Tooltip> : null}
      </div>
    </CardContent>
    <CardFooter className="tn-anime-card__footer"><div className="min-w-0"><strong title={displayTitle(item)}>{displayTitle(item)}</strong><span>{item.studio || "制作公司未定"}</span></div>{item.weekday ? <span>{item.air_time || "时间未定"}</span> : null}</CardFooter>
  </Card>;
}

export function AnimeListRow({ item, onOpen, onMark }: { item: AnimeListItem; onOpen: () => void; onMark: (mark: AnimeMarkType) => void }) {
  return <Card className="tn-anime-list-row" onClick={onOpen}><CardContent>
    <img src={cover(item)} alt={displayTitle(item)} loading="lazy" onError={(event) => { event.currentTarget.src = fallbackCover(item); }} />
    <div className="tn-anime-list-row__body"><div><strong>{displayTitle(item)}</strong>{item.score ? <Badge variant="outline">★ {item.score}</Badge> : null}</div><span>{airInfo(item)} · {item.studio || "制作公司未定"}</span><div><Badge variant="secondary">{mediaLabels[item.media_type]}</Badge><Badge variant="outline">{item.cour_relation_label}</Badge></div></div>
    <div className="tn-anime-list-row__actions" onClick={(event) => event.stopPropagation()}><Button type="button" size="icon-sm" variant={item.mark_type === "watching" ? "default" : "ghost"} aria-label={item.mark_type === "watching" ? "取消关注" : "关注"} onClick={() => onMark("watching")}>{item.mark_type === "watching" ? <RiHeartFill /> : <RiHeartLine />}</Button><Button type="button" size="icon-sm" variant="ghost" aria-label={item.mark_type === "ignored" ? "取消屏蔽" : "屏蔽"} onClick={() => onMark("ignored")}><RiEyeOffLine /></Button></div>
  </CardContent></Card>;
}

export function CompactAnimeRow({ item, onOpen, onMark }: { item: AnimeListItem; onOpen: () => void; onMark: () => void }) {
  return <div role="button" tabIndex={0} className="tn-anime-compact-row" onClick={onOpen} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(); } }}><img src={cover(item)} alt="" loading="lazy" onError={(event) => { event.currentTarget.src = fallbackCover(item); }} /><span><strong>{displayTitle(item)}</strong><small>{item.current_episode ? `第 ${item.current_episode} 话 · ` : ""}{item.air_time || "今日放送"}</small></span><Button type="button" size="icon-sm" variant={item.mark_type === "watching" ? "default" : "ghost"} aria-label={item.mark_type === "watching" ? "取消关注" : "关注"} onClick={(event) => { event.stopPropagation(); onMark(); }}>{item.mark_type === "watching" ? <RiHeartFill /> : <RiHeartLine />}</Button></div>;
}

function cover(item: AnimeListItem) { if (!item.cover_url) return fallbackCover(item); return item.cover_url.replace("/r/100/", "/r/400/").replace("/r/200/", "/r/400/"); }
