"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MessageSquare, WashingMachine, ShieldCheck, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface LoginViewProps {
  onLoginSuccess: (mobile: string, token: string) => void;
}

/**
 * U净账号登录视图：手机号 + 短信验证码
 * 流程与官方 App 一致（captcha → login → JWT）
 */
export function LoginView({ onLoginSuccess }: LoginViewProps) {
  const { toast } = useToast();
  const [mobile, setMobile] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const startCountdown = () => {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const sendCaptcha = async () => {
    if (!/^1\d{10}$/.test(mobile.trim())) {
      toast({ title: "手机号格式不正确", description: "请输入 11 位手机号", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/auth/captcha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: mobile.trim() }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "发送失败");
      setCodeSent(true);
      startCountdown();
      toast({ title: "验证码已发送", description: "请查收 U净 发来的短信验证码" });
    } catch (e) {
      toast({
        title: "验证码发送失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const doLogin = async () => {
    if (!codeSent) {
      toast({ title: "请先获取验证码", variant: "destructive" });
      return;
    }
    if (!/^\d{4,8}$/.test(captcha.trim())) {
      toast({ title: "验证码格式不正确", variant: "destructive" });
      return;
    }
    setLoggingIn(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: mobile.trim(), captcha: captcha.trim() }),
      });
      const json = (await res.json()) as { token?: string; mobile?: string; error?: string };
      if (!res.ok || !json.token) throw new Error(json.error || "登录失败");
      toast({ title: "登录成功", description: "现在可以扫码添加你的洗衣机了" });
      onLoginSuccess(json.mobile ?? mobile.trim(), json.token);
    } catch (e) {
      toast({
        title: "登录失败",
        description: e instanceof Error ? e.message : "请检查验证码后重试",
        variant: "destructive",
      });
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-emerald-50 via-white to-white dark:from-emerald-950/40 dark:via-background dark:to-background p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* 品牌区 */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-600/20">
            <WashingMachine className="w-9 h-9 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">U净洗衣机助手</h1>
            <p className="text-sm text-muted-foreground mt-1">
              扫码收藏洗衣机 · 随时查看占用状态
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">登录 U净账号</CardTitle>
            <CardDescription>
              使用 U净 App 注册的手机号登录，将通过官方短信接口接收验证码
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mobile">手机号</Label>
              <Input
                id="mobile"
                type="tel"
                inputMode="numeric"
                maxLength={11}
                placeholder="请输入 U净 账号手机号"
                value={mobile}
                disabled={codeSent}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && !codeSent && sendCaptcha()}
              />
            </div>

            {codeSent && (
              <div className="space-y-2">
                <Label htmlFor="captcha">短信验证码</Label>
                <div className="flex gap-2">
                  <Input
                    id="captcha"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="输入短信验证码"
                    value={captcha}
                    onChange={(e) => setCaptcha(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => e.key === "Enter" && doLogin()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 whitespace-nowrap"
                    disabled={countdown > 0 || sending}
                    onClick={sendCaptcha}
                  >
                    {countdown > 0 ? `${countdown}s` : "重发"}
                  </Button>
                </div>
              </div>
            )}

            {!codeSent ? (
              <Button className="w-full" onClick={sendCaptcha} disabled={sending || !mobile}>
                {sending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <MessageSquare className="w-4 h-4 mr-2" />
                )}
                {sending ? "发送中…" : "获取短信验证码"}
              </Button>
            ) : (
              <Button className="w-full" onClick={doLogin} disabled={loggingIn || !captcha}>
                {loggingIn ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4 mr-2" />
                )}
                {loggingIn ? "登录中…" : "登录"}
              </Button>
            )}

            <p className="text-xs text-muted-foreground leading-relaxed">
              <Send className="w-3 h-3 inline mr-1" />
              凭证仅保存在你自己的浏览器中，本服务不会存储你的密码或 token。
              没有账号？先在应用商店下载「U净」App 注册。
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          逆向协议来自开源社区 · 仅供个人学习使用
        </p>
      </div>
    </div>
  );
}
