"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

// Locked full-screen frame with its own scroll area. iOS home-screen apps move
// position:fixed bars around while the body scrolls; with the body locked and
// only this div scrolling, the tab bar stays put.
export function AppFrame({ children, nav, sidebar }: { children: ReactNode; nav: ReactNode; sidebar?: ReactNode }) {
  const path = usePathname();
  const scroller = useRef<HTMLDivElement>(null);

  // The frame survives navigation, so reset its scroll on a new page
  // (query-only changes like opening a transaction keep their position).
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [path]);

  return (
    <div className="fixed inset-0 flex bg-bg">
      {sidebar}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Solid backing under the translucent iOS status bar so scrolled content never shows behind the clock. */}
        <div aria-hidden="true" className="h-[env(safe-area-inset-top)] shrink-0 bg-bg" />
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto max-w-3xl px-4 pb-8 pt-4 lg:mx-0 lg:max-w-2xl lg:px-10 lg:pt-10">{children}</div>
        </div>
        {nav}
      </div>
    </div>
  );
}
