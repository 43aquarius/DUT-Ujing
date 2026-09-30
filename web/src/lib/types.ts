"use client";

/** 前端共享类型 */

export interface SavedDevice {
  id: string;
  userMobile: string;
  name: string;
  qrCode: string;
  deviceId?: string | null;
  deviceNo?: string | null;
  storeName?: string | null;
  deviceTypeName?: string | null;
  macAddress?: string | null;
  lastStatus: string; // free | busy | unknown
  lastReason?: string | null;
  lastCheckedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScanResult {
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
}

/** localStorage 中保存的会话 */
export interface AuthSession {
  mobile: string;
  token: string;
  savedAt: number;
}
