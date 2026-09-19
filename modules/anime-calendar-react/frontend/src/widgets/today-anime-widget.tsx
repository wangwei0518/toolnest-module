import { RiCalendarScheduleLine } from "@remixicon/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToday } from "@/hooks/use-calendar";
import { displayTitle, fallbackCover, mediaLabels } from "@/lib/anime";

export function TodayAnimeWidget({ width: _width, height: _height }: { width: number; height: number }) {
  const query = useToday();
  if (query.isLoading) return <div className="grid gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>;
  if (query.isError) return <Alert><RiCalendarScheduleLine /><AlertDescription>今日更新加载失败</AlertDescription></Alert>;
  if (!query.data?.items.length) return <p className="text-muted-foreground">今天暂无放送作品</p>;
  return <div className="tn-anime-widget">{query.data.items.slice(0, 3).map((item) => <article key={item.id}><img src={item.cover_url || fallbackCover(item)} alt="" onError={(event) => { event.currentTarget.src = fallbackCover(item); }} /><span><strong>{displayTitle(item)}</strong><small>{item.air_time || "今日放送"}</small></span><Badge variant="secondary">{mediaLabels[item.media_type]}</Badge></article>)}</div>;
}
