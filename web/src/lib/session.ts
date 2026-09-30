"use client";

import { AuthSession } from "./types";

const KEY = "ujing_session";

export function loadSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AuthSession;
    if (!s?.mobile || !s?.token) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession) {
  window.localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(KEY);
}

/** 会话有效期：7 天（token 本身有效期由服务端控制，这里只是本地兜底） */
export function isSessionFresh(s: AuthSession | null): boolean {
  if (!s) return false;
  return Date.now() - s.savedAt < 7 * 24 * 3600 * 1000;
}
