/**
 * 本地存储：会话 + 洗衣机列表（AsyncStorage）
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_SESSION = "ujing_session";
const KEY_DEVICES = "ujing_devices";

export interface AuthSession {
  mobile: string;
  token: string;
  savedAt: number;
}

export interface SavedDevice {
  id: string;
  name: string;
  qrCode: string;
  deviceId?: string | null;
  deviceNo?: string | null;
  storeName?: string | null;
  deviceTypeName?: string | null;
  macAddress?: string | null;
  lastStatus: "free" | "busy" | "unknown";
  lastReason?: string | null;
  lastCheckedAt?: number | null; // epoch ms
  createdAt: number;
}

export async function loadSession(): Promise<AuthSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SESSION);
    if (!raw) return null;
    const s = JSON.parse(raw) as AuthSession;
    if (!s?.mobile || !s?.token) return null;
    // 本地兜底：7 天后需重新登录
    if (Date.now() - s.savedAt > 7 * 24 * 3600 * 1000) return null;
    return s;
  } catch {
    return null;
  }
}

export async function saveSession(session: AuthSession): Promise<void> {
  await AsyncStorage.setItem(KEY_SESSION, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(KEY_SESSION);
}

export async function loadDevices(): Promise<SavedDevice[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_DEVICES);
    if (!raw) return [];
    return JSON.parse(raw) as SavedDevice[];
  } catch {
    return [];
  }
}

export async function saveDevices(devices: SavedDevice[]): Promise<void> {
  await AsyncStorage.setItem(KEY_DEVICES, JSON.stringify(devices));
}
