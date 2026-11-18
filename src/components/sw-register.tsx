"use client";

import { useEffect } from "react";

// Registers the push-only service worker. It caches nothing.
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Push just will not be available; the app works without it.
    });
  }, []);
  return null;
}
