import { RiExternalLinkLine, RiEyeOffLine, RiHeartFill, RiHeartLine } from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from "@/components/ui/attachment";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { airInfo, coverUrl, displayTitle, fallbackCover, mediaLabels } from "@/lib/anime";
import type { AnimeListItem, AnimeMarkType } from "@/types";

export function AnimePosterCard({ item, isToday = false, onOpen, onMark }: { item: AnimeListItem; isToday?: boolean; onOpen: () => void; onMark: (mark: AnimeMarkType) => void }) {
  return <Card className="tn-anime-card group" data-ignored={item.mark_type === "ignored" || undefined} role="button" tabIndex={0} aria-label={displayTitle(item)} onClick={onOpen} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(); } }}>
    <CardContent className="tn-anime-card__media">
      <img src={cover(item)} alt={displayTitle(item)} loading="lazy" decoding="async" sizes="(min-width: 1180px) 16vw, (min-width: 900px) 21vw, (min-width: 640px) 25vw, 45vw" onError={(event) => { event.currentTarget.src = fallbackCover(item); }} />
      <div className="tn-anime-card__badges"><Badge variant="default" className="tn-anime-card__type-badge">{mediaLabels[item.media_type]}</Badge>{item.score ? <Badge variant="outline" className="tn-anime-card__score-badge">★ {item.score}</Badge> : null}</div>
      {item.cour_relation !== "unknown" ? <Badge variant="default" className="tn-anime-card__relation">{item.cour_relation_label}</Badge> : null}
      <div className={`tn-anime-card__actions${item.score ? " has-score" : ""}`} onClick={(event) => event.stopPropagation()}>
        <Tooltip><TooltipTrigger render={<Button type="button" className="tn-anime-card__icon-button tn-anime-card__icon-button--favorite" size="icon-sm" variant="secondary" data-following={item.mark_type === "watching" || undefined} aria-label={item.mark_type === "watching" ? "取消关注" : "关注"} aria-pressed={item.mark_type === "watching"} onClick={() => onMark("watching")} />}>{item.mark_type === "watching" ? <RiHeartFill /> : <RiHeartLine />}</TooltipTrigger><TooltipContent>{item.mark_type === "watching" ? "取消关注" : "关注"}</TooltipContent></Tooltip>
        {item.external_url ? <Tooltip><TooltipTrigger render={<Button className="tn-anime-card__icon-button tn-anime-card__icon-button--open" size="icon-sm" variant="secondary" nativeButton={false} aria-label="打开 Bangumi" render={<a href={item.external_url} target="_blank" rel="noreferrer" />} />}><RiExternalLinkLine /></TooltipTrigger><TooltipContent>打开 Bangumi</TooltipContent></Tooltip> : null}
      </div>
      <div className="tn-anime-card__poster-info">{isToday ? <Badge className="tn-anime-card__update-badge">今日更新</Badge> : null}<strong title={displayTitle(item)}>{displayTitle(item)}</strong><span>{item.studio || "制作公司未定"}</span></div>
    </CardContent>
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
  const title = displayTitle(item);
  const following = item.mark_type === "watching";
  return <Attachment orientation="vertical" className="tn-anime-attachment-flush w-full gap-0 p-0 shadow-sm" aria-label={title}>
    <AttachmentMedia variant="image" className="aspect-[4/5] rounded-t-[inherit] rounded-b-none p-0">
      <img className="h-full w-full object-cover" src={cover(item, 400)} alt="" loading="lazy" onError={(event) => { event.currentTarget.src = fallbackCover(item); }} />
    </AttachmentMedia>
    <AttachmentContent className="flex min-h-11 w-full items-center px-2 py-1.5">
      <AttachmentTitle className="line-clamp-2 whitespace-normal" title={title}>{title}</AttachmentTitle>
    </AttachmentContent>
    <AttachmentActions>
      <AttachmentAction type="button" size="icon-sm" variant="secondary" className="tn-anime-card__icon-button tn-anime-card__icon-button--favorite" data-following={following || undefined} aria-label={following ? "取消关注" : "关注"} aria-pressed={following} onClick={onMark}>{following ? <RiHeartFill /> : <RiHeartLine />}</AttachmentAction>
    </AttachmentActions>
    <AttachmentTrigger className="rounded-[inherit] border-0 bg-transparent p-0 text-inherit" onClick={onOpen} render={<button type="button" aria-label={`打开 ${title}`} />} />
  </Attachment>;
}

function cover(item: AnimeListItem, width: 400 | 800 = 800) { return coverUrl(item.cover_url, width) || fallbackCover(item); }
