/**
 * DUT-Ujing App 入口
 * 复刻 Web 版功能：登录 U净 → 扫码收藏洗衣机 → 随时查看占用状态
 */

import React, { useEffect, useState } from "react";
import { StatusBar } from "react-native";
import { LoginScreen } from "./src/screens/LoginScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { loadSession, clearSession, AuthSession } from "./src/lib/storage";

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    void loadSession().then((s) => {
      if (s) setSession(s);
      setBooted(true);
    });
  }, []);

  if (!booted) return null; // 启动闪屏（避免闪烁）

  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      {session ? (
        <DashboardScreen
          session={session}
          onLogout={async () => {
            await clearSession();
            setSession(null);
          }}
          onTokenExpired={async () => {
            await clearSession();
            setSession(null);
          }}
        />
      ) : (
        <LoginScreen
          onLoginSuccess={(s) => setSession(s)}
        />
      )}
    </>
  );
}
