import type { LayoutState } from "./types.js";

const LOCAL_KEY = "qhf-room-planner-v1";
const HASH_PREFIX = "#layout=";

export function saveLocal(state: LayoutState): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be disabled (private mode, etc.) — silently ignore.
  }
}

export function loadLocal(): LayoutState | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LayoutState;
  } catch {
    return null;
  }
}

export function writeHash(state: LayoutState): void {
  const encoded = encodeState(state);
  // Replace without scrolling.
  history.replaceState(null, "", `${location.pathname}${location.search}${HASH_PREFIX}${encoded}`);
}

export function readHash(): LayoutState | null {
  const h = location.hash;
  if (!h.startsWith(HASH_PREFIX)) return null;
  try {
    return decodeState(h.slice(HASH_PREFIX.length));
  } catch {
    return null;
  }
}

function encodeState(state: LayoutState): string {
  // URL-safe base64 of compact JSON.
  const json = JSON.stringify(state);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeState(encoded: string): LayoutState {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const json = decodeURIComponent(escape(atob(padded)));
  return JSON.parse(json) as LayoutState;
}
