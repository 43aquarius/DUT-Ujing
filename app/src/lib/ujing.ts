/**
 * U净 (Ujing) 云端 API 客户端 — React Native (Expo) 版
 *
 * 与 web 版协议一致，逆向来源见仓库 docs/ujing-api.md：
 *  - baijuqi/ujing-mini（协议逆向报告 + 实机验证）
 *  - funcfang/U-Clean-Reserve、Because66666/...（scanWasherCode 登录链路）
 *  - Huoyuuu/ujing-laundry、jalenzz/liteU（新版验证码 HMAC 签名）
 *  - amamiyakazuki/FlandreSY（响应字段 reason/status）
 *
 * React Native 无 CORS 限制，可直连 phoenix.ujing.online。
 */

import CryptoJS from "crypto-js";

export const UJING_BASE = "https://phoenix.ujing.online";

const UA_PHONE = "U jing/2.4.3 (iPhone; iOS 17.3; Scale/3.00)";

/** 验证码接口 HMAC 签名密钥（逆向自 U净 App，多个开源项目交叉验证一致） */
const CAPTCHA_HMAC_KEY = "T3pAWrBqKzS2GC7LKQbIDN2xkWEYzTS/nrHdYfbTkHU=";

function captchaHeaders(): Record<string, string> {
  return {
    "x-app-code": "BO",
    "x-app-version": "1.1.0",
    "User-Agent": UA_PHONE,
    "x-mobile-brand": "apple",
    "x-mobile-model": "iPhone14,5",
    "x-user-geo": "-180.000000,-180.000000",
    "Content-Type": "application/json",
  };
}

function businessHeaders(token: string): Record<string, string> {
  return {
    "x-app-code": "BA",
    "x-app-version": "2.4.8",
    "weex-version": "1.1.68",
    "User-Agent": UA_PHONE,
    "x-mobile-brand": "apple",
    "x-mobile-model": "iPhone14,5",
    "Content-Type": "application/json; charset=utf-8",
    Authorization: `Bearer ${token}`,
  };
}

export interface UjingEnvelope<T = unknown> {
  code: number;
  message?: string;
  msg?: string;
  data?: T;
  reason?: string;
}

export class UjingApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "UjingApiError";
  }
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string>,
  opts: { query?: Record<string, string | number>; body?: unknown; timeoutMs?: number } = {}
): Promise<UjingEnvelope<T>> {
  const url = new URL(UJING_BASE + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      url.searchParams.set(k, String(v));
    }
  }
  // 兜底：带 body 的 POST 若未声明 Content-Type，RN fetch 会自动置为
  // text/plain;charset=UTF-8，U净网关会以 CODEC 400 拒绝（登录失败报错根因）
  if (opts.body !== undefined && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
    headers = { ...headers, "Content-Type": "application/json" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: UjingEnvelope<T>;
  try {
    json = JSON.parse(text) as UjingEnvelope<T>;
  } catch {
    throw new UjingApiError(res.status, `U净服务返回了无法解析的响应 (HTTP ${res.status})`);
  }
  if (json.code !== 0) {
    // 网关 CODEC 错误的 message 是 content-type 字符串，对用户不可读，转译
    let message = json.message || json.msg || `U净接口错误 (code=${json.code})`;
    if (json.code === 400 || /charset=/i.test(message)) {
      message = "U净网关拒绝了请求格式，请稍后重试或更新应用";
    }
    throw new UjingApiError(json.code, message);
  }
  return json;
}

/** 新版验证码接口签名：base64(HMAC-SHA256(key, `${nonce}${timestamp}`)) */
function captchaSignature(nonce: string, timestamp: number): string {
  return CryptoJS.HmacSHA256(`${nonce}${timestamp}`, CAPTCHA_HMAC_KEY).toString(
    CryptoJS.enc.Base64
  );
}

function randomNonce(): string {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

/**
 * 发送短信验证码：新版接口（HMAC 签名）优先，失败降级旧版接口。
 */
export async function sendCaptcha(mobile: string): Promise<void> {
  // --- 新版接口 ---
  try {
    const nonce = randomNonce();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = captchaSignature(nonce, timestamp);
    await request("GET", "/api/v1/wechat/captcha/create", captchaHeaders(), {
      query: { mobile, type: 1, nonce, timestamp, signature },
    });
    return;
  } catch (e) {
    console.warn("[ujing] new captcha endpoint failed, fallback to legacy:", e);
  }
  // --- 旧版接口降级 ---
  await request("GET", "/api/v1/captcha", captchaHeaders(), {
    query: {
      mobile,
      type: 1,
      sessionId: "AFS_SWITCH_OFF",
      sig: "AFS_SWITCH_OFF",
      token: "AFS_SWITCH_OFF",
    },
  });
}

export interface UjingLoginResult {
  token: string;
  mobile?: string;
  userId?: string;
  serviceSubjectId?: string;
}

/** 登录：返回 JWT token */
export async function login(mobile: string, captcha: string): Promise<UjingLoginResult> {
  const json = await request<UjingLoginResult>("POST", "/api/v1/login", captchaHeaders(), {
    body: { mobile, captcha },
  });
  const data = json.data as UjingLoginResult;
  if (!data || typeof data.token !== "string" || !data.token) {
    throw new UjingApiError(0, "登录成功但响应缺少 token");
  }
  return { ...data, mobile };
}

export interface ScanWasherResult {
  deviceId: string;
  deviceTypeId?: number;
  deviceTypeName?: string;
  deviceNo?: string;
  storeName?: string;
  storeId?: string;
  macAddress?: string;
  online?: number;
  createOrderEnabled?: boolean;
  reason?: string;
  status?: string;
  [k: string]: unknown;
}

/** 扫码查询洗衣机状态（核心接口） */
export async function scanWasherCode(token: string, qrCode: string): Promise<ScanWasherResult> {
  const json = await request<{ result: ScanWasherResult }>(
    "POST",
    "/api/v1/devices/scanWasherCode",
    businessHeaders(token),
    { body: { qrCode } }
  );
  const data = json.data as { result?: ScanWasherResult } | undefined;
  const result = data?.result;
  if (!result) {
    throw new UjingApiError(0, "扫码响应缺少 result 字段");
  }
  return result;
}

export interface ProgramInfo {
  storeId?: string;
  storeName?: string;
  deviceNo?: string;
  deviceTypeName?: string;
  deviceWashModel?: Array<{
    workModelId: number;
    name?: string;
    workModelName?: string;
    basePrice?: number;
    promotionPrice?: number;
    time?: number;
  }>;
  [k: string]: unknown;
}

/** 设备程序详情（洗衣模式/门店信息） */
export async function programInfo(token: string, deviceId: string): Promise<ProgramInfo> {
  const json = await request<ProgramInfo>(
    "GET",
    "/api/v1/app/washer/devices/program/info",
    businessHeaders(token),
    { query: { deviceId } }
  );
  return (json.data ?? {}) as ProgramInfo;
}

/** 校验二维码是否为 U净洗衣机码（两种已知格式） */
export function isUjingQrCode(text: string): boolean {
  const t = text.trim();
  return (
    /^https?:\/\/q\.ujing\.com\.cn\/ucqrc\/index\.html\?cd=\d+/i.test(t) ||
    /^https?:\/\/app\.littleswan\.com\/u_download\.html\?/i.test(t)
  );
}
