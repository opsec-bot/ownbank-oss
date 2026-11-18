"use client";

import { useEffect, useState } from "react";
import { primaryBtn, secondaryBtn } from "@/components/ui";

function keyToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "loading" | "unsupported" | "needs-install" | "blocked" | "off" | "on";

// Enable / disable push on this device. iOS only allows Web Push from the installed home screen app.
export function PushControls({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Detect what this device can do. iOS only allows Web Push from the installed home screen app.
    async function detect(): Promise<State> {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (ios && !standalone) return "needs-install";
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
      if (Notification.permission === "denied") return "blocked";
      const reg = await navigator.serviceWorker.ready;
      return (await reg.pushManager.getSubscription()) ? "on" : "off";
    }
    detect().then(setState, () => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setError("");
    try {
      if (!publicKey) throw new Error("Push is not configured on the server (VAPID keys missing).");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("The server rejected the subscription.");
      setState("on");
      window.location.reload(); // refresh the device list
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disable notifications.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {state === "needs-install" && (
        <p className="rounded-lg border border-border p-3 text-sm">
          Add to Home Screen first: tap Share, then Add to Home Screen, then open ownbank from the new icon and come back here. iPhone only
          allows push from the installed app.
        </p>
      )}
      {state === "unsupported" && <p className="text-sm text-muted">This browser does not support push notifications.</p>}
      {state === "blocked" && <p className="text-sm text-danger">Notifications are blocked for this site. Allow them in the browser or phone settings.</p>}
      {state === "off" && (
        <button type="button" onClick={enable} disabled={busy} className={primaryBtn}>
          {busy ? "Enabling..." : "Enable notifications"}
        </button>
      )}
      {state === "on" && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">
            <span className="text-accent">&#10003;</span> On for this device
          </p>
          <button type="button" onClick={disable} disabled={busy} className={secondaryBtn + " py-2 text-sm"}>
            Turn off
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
