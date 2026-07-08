"use client";

import { useEffect } from "react";

/**
 * Registers the app-shell service worker (public/sw.js) once the page has
 * loaded, making Evolution OS installable and openable offline. Renders
 * nothing. Registration is best-effort — if it fails, the app runs exactly as
 * before, just without the offline shell.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline shell is a progressive enhancement — ignore failures */
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
