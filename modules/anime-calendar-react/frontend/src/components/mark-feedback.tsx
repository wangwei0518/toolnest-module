import type { ReactNode } from "react";

/** Only confirmed API responses trigger the icon feedback; optimistic marks stay immediate. */
export function MarkFeedback({ confirmedAt, children }: { confirmedAt?: number | undefined; children: ReactNode }) {
  return <span key={confirmedAt ?? 0} className={confirmedAt ? "tn-anime-motion-confirm inline-flex" : "inline-flex"}>{children}</span>;
}
