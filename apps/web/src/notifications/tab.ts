import { useEffect, useState } from "react";
import { useThemeChange } from "../components/useThemeChange.js";
import { useLiveStore } from "../data/store.js";
import { useNotifyCenter } from "./center.js";

/**
 * The browser tab (CR-003 §5): `(N) MeshTerm` with `⚠ ` while the node is disconnected,
 * a flashing title while hidden after a new alert, and a badge on the favicon.
 */

export const BASE_TITLE = "MeshTerm";
export const FLASH_MS = 1_500;

const countText = (n: number) => (n > 99 ? "99+" : String(n));

/** The resting title: "⚠ (3) MeshTerm". */
export function tabTitle(count: number, disconnected: boolean): string {
  return `${disconnected ? "⚠ " : ""}${count > 0 ? `(${countText(count)}) ` : ""}${BASE_TITLE}`;
}

/** Keeps the title, flashing it while the tab is hidden and a flash is pending. */
export function useTabTitle(count: number): void {
  const nodeState = useLiveStore((s) => s.nodeState);
  const flash = useNotifyCenter((s) => s.flash);
  const [alternate, setAlternate] = useState(false);
  const disconnected = nodeState !== null && nodeState !== "connected";
  const resting = tabTitle(count, disconnected);

  // Back in view: stop flashing.
  useEffect(() => {
    const clear = () => {
      if (document.visibilityState === "visible") useNotifyCenter.getState().setFlash(null);
    };
    document.addEventListener("visibilitychange", clear);
    window.addEventListener("focus", clear);
    return () => {
      document.removeEventListener("visibilitychange", clear);
      window.removeEventListener("focus", clear);
    };
  }, []);

  useEffect(() => {
    if (flash === null) return;
    const timer = setInterval(() => {
      setAlternate((a) => !a);
    }, FLASH_MS);
    return () => {
      clearInterval(timer);
      setAlternate(false);
    };
  }, [flash]);

  useEffect(() => {
    document.title = flash !== null && alternate ? flash : resting;
  }, [flash, alternate, resting]);
}

/** What the favicon badge says: nothing at 0, the count up to 9, a plain dot beyond. */
export function faviconLabel(count: number): string | null {
  if (count <= 0) return null;
  return count <= 9 ? String(count) : "";
}

const ICON_SIZE = 64;

/** The `<link rel="icon">` the app ships (index.html). */
function iconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"]');
}

/** Resolves a color token to something canvas understands (`rgb(…)`). */
function tokenColor(token: string, fallback: string): string {
  if (typeof getComputedStyle !== "function") return fallback;
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = `var(${token})`;
  document.documentElement.appendChild(probe);
  try {
    return getComputedStyle(probe).color || fallback;
  } finally {
    probe.remove();
  }
}

/**
 * Draws the icon with a count dot in the top-right corner (CR-003 §5) and swaps the
 * favicon to it; back to the plain icon at 0. Fails quietly without canvas.
 */
export function useFaviconBadge(count: number, priority: boolean): void {
  const label = faviconLabel(count);
  // Redrawn with the new badge colors after a theme switch (CR-004 §4.5).
  const [themeVersion, setThemeVersion] = useState(0);
  useThemeChange(() => {
    setThemeVersion((v) => v + 1);
  });
  useEffect(() => {
    const link = iconLink();
    if (!link) return;
    const plain = link.dataset.plainHref ?? link.getAttribute("href") ?? "";
    link.dataset.plainHref = plain;
    if (label === null) {
      link.href = plain;
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = ICON_SIZE;
      canvas.height = ICON_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
      const r = label === "" ? 14 : 20;
      const cx = ICON_SIZE - r;
      const cy = r;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fillStyle = tokenColor(priority ? "--mt-badge-priority-bg" : "--mt-badge-bg", "red");
      ctx.fill();
      if (label !== "") {
        ctx.fillStyle = tokenColor("--mt-badge-text", "white");
        ctx.font = `bold ${r * 1.5}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, cx, cy + 1);
      }
      try {
        link.href = canvas.toDataURL("image/png");
      } catch {
        // A tainted canvas or no canvas support: keep the plain icon.
      }
    };
    image.src = plain;
    return () => {
      cancelled = true;
    };
  }, [label, priority, themeVersion]);
}
