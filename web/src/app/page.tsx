"use client";

import { useEffect, useState } from "react";
import { LoginView } from "@/components/ujing/login-view";
import { Dashboard } from "@/components/ujing/dashboard";
import { loadSession, saveSession, clearSession, isSessionFresh } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import type { AuthSession } from "@/lib/types";

/**
 * DUT-Ujing 主页
 * 未登录 → U净账号登录（手机号 + 短信验证码）
 * 已登录 → 洗衣机面板（扫码收藏 / 实时占用状态）
 */
export default function Home() {
  const { toast } = useToast();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 异步恢复本地会话，避免 effect 内同步 setState
    queueMicrotask(() => {
      if (cancelled) return;
      const s = loadSession();
      if (s && isSessionFresh(s)) setSession(s);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoginSuccess = (mobile: string, token: string) => {
    const s: AuthSession = { mobile, token, savedAt: Date.now() };
    saveSession(s);
    setSession(s);
  };

  const handleLogout = () => {
    clearSession();
    setSession(null);
    toast({ title: "已退出登录" });
  };

  const handleTokenExpired = () => {
    clearSession();
    setSession(null);
    toast({
      title: "登录已过期",
      description: "token 已失效，请重新登录",
      variant: "destructive",
    });
  };

  // 避免 SSR/CSR 不一致：挂载前渲染骨架
  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin" />
      </div>
    );
  }

  return session ? (
    <Dashboard
      mobile={session.mobile}
      token={session.token}
      onLogout={handleLogout}
      onTokenExpired={handleTokenExpired}
    />
  ) : (
    <LoginView onLoginSuccess={handleLoginSuccess} />
  );
}
