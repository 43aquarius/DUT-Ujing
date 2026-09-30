/**
 * 登录页：手机号 + 短信验证码（与 Web 版流程一致）
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { sendCaptcha, login } from "../lib/ujing";
import { saveSession, AuthSession } from "../lib/storage";

interface Props {
  onLoginSuccess: (session: AuthSession) => void;
}

export function LoginScreen({ onLoginSuccess }: Props) {
  const [mobile, setMobile] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  const sendCode = async () => {
    if (!/^1\d{10}$/.test(mobile)) {
      setError("请输入 11 位手机号");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendCaptcha(mobile);
      setCodeSent(true);
      startCountdown();
    } catch (e) {
      setError(e instanceof Error ? e.message : "验证码发送失败");
    } finally {
      setSending(false);
    }
  };

  const doLogin = async () => {
    if (!/^\d{4,8}$/.test(captcha)) {
      setError("验证码格式错误");
      return;
    }
    setLoggingIn(true);
    setError(null);
    try {
      const result = await login(mobile, captcha);
      const session: AuthSession = {
        mobile,
        token: result.token,
        savedAt: Date.now(),
      };
      await saveSession(session);
      onLoginSuccess(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败，请重试");
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* 品牌区 */}
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>净</Text>
          </View>
          <Text style={styles.title}>U净洗衣机助手</Text>
          <Text style={styles.subtitle}>扫码收藏洗衣机 · 随时查看占用状态</Text>
        </View>

        {/* 表单卡片 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>登录 U净账号</Text>
          <Text style={styles.cardDesc}>
            使用 U净 App 注册的手机号，通过官方短信接口接收验证码
          </Text>

          <Text style={styles.label}>手机号</Text>
          <TextInput
            style={styles.input}
            placeholder="请输入手机号"
            placeholderTextColor="#9ca3af"
            keyboardType="number-pad"
            maxLength={11}
            value={mobile}
            editable={!codeSent}
            onChangeText={(t) => setMobile(t.replace(/\D/g, ""))}
          />

          {codeSent && (
            <>
              <Text style={styles.label}>短信验证码</Text>
              <View style={styles.captchaRow}>
                <TextInput
                  style={[styles.input, styles.captchaInput]}
                  placeholder="输入验证码"
                  placeholderTextColor="#9ca3af"
                  keyboardType="number-pad"
                  maxLength={8}
                  value={captcha}
                  onChangeText={(t) => setCaptcha(t.replace(/\D/g, ""))}
                />
                <TouchableOpacity
                  style={[styles.resendBtn, (countdown > 0 || sending) && styles.resendDisabled]}
                  disabled={countdown > 0 || sending}
                  onPress={sendCode}
                >
                  <Text style={styles.resendText}>
                    {countdown > 0 ? `${countdown}s` : "重发"}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, (!codeSent && !mobile) || sending || loggingIn ? styles.btnDisabled : null]}
            disabled={sending || loggingIn || (!codeSent && !mobile)}
            onPress={codeSent ? doLogin : sendCode}
          >
            {sending || loggingIn ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {codeSent ? "登录" : "获取短信验证码"}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.tip}>
            凭证仅保存在你的手机本地，不会上传到任何第三方服务器。{"\n"}
            没有账号？先在应用商店下载「U净」App 注册。
          </Text>
        </View>

        <Text style={styles.footer}>逆向协议来自开源社区 · 仅供个人学习使用</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0fdf4" },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
    paddingVertical: 40,
  },
  brand: { alignItems: "center", marginBottom: 28 },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: "#059669",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    shadowColor: "#059669",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  logoText: { color: "#fff", fontSize: 30, fontWeight: "700" },
  title: { fontSize: 22, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 13, color: "#6b7280", marginTop: 4 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  cardTitle: { fontSize: 17, fontWeight: "600", color: "#111827" },
  cardDesc: { fontSize: 12, color: "#6b7280", marginTop: 4, marginBottom: 16, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: "500", color: "#374151", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#fafafa",
    marginBottom: 14,
  },
  captchaRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  captchaInput: { flex: 1, marginBottom: 0 },
  resendBtn: {
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  resendDisabled: { opacity: 0.5 },
  resendText: { color: "#374151", fontSize: 14 },
  error: {
    color: "#dc2626",
    fontSize: 13,
    marginBottom: 12,
    backgroundColor: "#fef2f2",
    padding: 10,
    borderRadius: 8,
  },
  primaryBtn: {
    backgroundColor: "#059669",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.55 },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  tip: { fontSize: 11, color: "#9ca3af", marginTop: 14, lineHeight: 17 },
  footer: { textAlign: "center", fontSize: 11, color: "#9ca3af", marginTop: 20 },
});
