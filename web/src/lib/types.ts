"use client";

/** 前端共享类型 */

import { friendlyName } from "@/lib/ujing";

export interface SavedDevice {
  id: string;
  userMobile: string;
  name: string;
  customName?: boolean; // true = 用户手动改过名，不再自动升级为友好别名
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

/** 卡片大字展示名：自定义名优先，否则自动友好名（门店 #机号），降级到备注名 */
export function displayNameOf(d: SavedDevice): string {
  if (!d.customName) {
    const auto = friendlyName(d.storeName, d.deviceNo);
    if (auto) return auto;
  }
  return d.name;
}

/** 「我的订单」条目（/api/ujing/orders 归一化后） */
export interface RunningOrderView {
  orderId: string | number;
  deviceId?: string | null;
  deviceNo?: string | null;
  deviceTypeName?: string | null;
  storeName?: string | null;
  status?: number | null;
  statusRemark?: string | null;
  remainTime?: number | null; // 秒（仅 30/40 状态有效）
  workTime?: number | null;   // 分钟
  endAt?: number | null;      // 预计结束 epoch ms
  isPauseStatus?: boolean;
}

/** 订单状态枚举（与 App 端一致，ujing-mini 实测） */
export const ORDER_STATUS_NAME: Record<number, string> = {
  10: "已预约",
  17: "支付中",
  20: "已支付",
  21: "启动中",
  22: "筒自洁启动中",
  24: "投放洗涤剂中",
  29: "订单保护中",
  30: "筒自洁中",
  35: "筒自洁完成",
  40: "运行中",
  50: "已完成",
  51: "支付超时",
  52: "启动失败",
  53: "已取消",
  54: "超时未启动",
  60: "故障中",
  61: "故障中",
};

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
