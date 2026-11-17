import type { ReactNode } from "react";
/** Module-local equivalent of the platform PageContainer; no host private imports. */
export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      {children}
    </div>
  );
}
