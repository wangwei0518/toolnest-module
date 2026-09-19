import { RiErrorWarningLine, RiInboxLine } from "@remixicon/react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export function PageError({ title = "加载失败", description, retry }: { title?: string; description: string; retry?: () => void }) { return <Alert variant="destructive"><RiErrorWarningLine /><AlertTitle>{title}</AlertTitle><AlertDescription>{description}</AlertDescription>{retry ? <AlertAction><Button variant="outline" size="sm" onClick={retry}>重试</Button></AlertAction> : null}</Alert>; }
export function PageEmpty({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) { return <Empty><EmptyHeader><EmptyMedia variant="icon"><RiInboxLine /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>{action}</Empty>; }
export function AnimeGridSkeleton() { return <div className="tn-anime-grid">{Array.from({ length: 12 }, (_, index) => <div key={index} className="grid gap-2"><Skeleton className="aspect-[3/4] w-full" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-3 w-2/3" /></div>)}</div>; }
