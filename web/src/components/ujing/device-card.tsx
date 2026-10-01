"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  WashingMachine,
  RefreshCw,
  MoreVertical,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  HelpCircle,
  MapPin,
  Hash,
  Loader2,
} from "lucide-react";
import type { SavedDevice } from "@/lib/types";
import { displayNameOf } from "@/lib/types";

export type LiveStatus = "checking" | "free" | "busy" | "error" | "unknown";

export interface DeviceLiveState {
  status: LiveStatus;
  reason?: string | null;
  checkedAt?: Date;
  error?: string;
  /** checkedAt 时刻的剩余秒数（订单 status 30/40 时有效） */
  remainSec?: number | null;
  /** 预计结束时刻 epoch ms */
  endAt?: number | null;
}

interface DeviceCardProps {
  device: SavedDevice;
  live?: DeviceLiveState;
  onRefresh: (device: SavedDevice) => void;
  onRename: (device: SavedDevice, name: string) => void;
  onDelete: (device: SavedDevice) => void;
}

function timeAgo(d?: Date | string | null): string {
  if (!d) return "未查询";
  const t = typeof d === "string" ? new Date(d) : d;
  const diff = Math.floor((Date.now() - t.getTime()) / 1000);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function fmtCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 单台洗衣机的状态卡片 */
export function DeviceCard({ device, live, onRefresh, onRename, onDelete }: DeviceCardProps) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(device.name);
  // 有倒计时时每秒重绘
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live?.endAt) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [live?.endAt]);

  const status: LiveStatus = live?.status ?? "unknown";
  const isChecking = status === "checking";

  const statusConfig: Record<
    LiveStatus,
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    free: {
      label: "空闲可用",
      cls: "border-emerald-300 dark:border-emerald-800 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-card",
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" />,
    },
    busy: {
      label: "占用中",
      cls: "border-red-300 dark:border-red-800 bg-gradient-to-br from-red-50 to-white dark:from-red-950/40 dark:to-card",
      icon: <XCircle className="w-5 h-5 text-red-600" />,
    },
    checking: {
      label: "查询中",
      cls: "border-border",
      icon: <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />,
    },
    error: {
      label: "查询失败",
      cls: "border-amber-300 dark:border-amber-800",
      icon: <HelpCircle className="w-5 h-5 text-amber-600" />,
    },
    unknown: {
      label: "未知状态",
      cls: "border-border",
      icon: <HelpCircle className="w-5 h-5 text-muted-foreground" />,
    },
  };

  const cfg = statusConfig[status];

  const commitRename = () => {
    const n = draftName.trim();
    if (n && n !== device.name) onRename(device, n);
    else setDraftName(device.name);
    setEditing(false);
  };

  // 编辑时预填备注名（大字可能是自动别名，改名基于备注名）
  useEffect(() => setDraftName(device.name), [device.name]);

  return (
    <Card className={`transition-colors ${cfg.cls}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          {/* 名称 + 元信息 */}
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={draftName}
                  maxLength={30}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") {
                      setDraftName(device.name);
                      setEditing(false);
                    }
                  }}
                  className="h-8"
                />
                <Button size="sm" variant="ghost" onClick={commitRename} aria-label="确认改名">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <WashingMachine className="w-5 h-5 shrink-0 text-muted-foreground" />
                <h3 className="font-semibold truncate" title={device.name}>
                  {displayNameOf(device)}
                </h3>
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {device.deviceTypeName && <span>{device.deviceTypeName}</span>}
              {/* 大字是自动别名时门店/机号已含在大字里；自定义名时在小字补充 */}
              {device.customName && device.storeName && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {device.storeName}
                  {device.deviceNo ? ` #${device.deviceNo}` : ""}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Hash className="w-3 h-3" />
                机身码 {device.qrCode.slice(-6)}
              </span>
            </div>
          </div>

          {/* 状态 + 操作 */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background/80 border text-sm font-medium">
              {cfg.icon}
              <span className="hidden sm:inline">{cfg.label}</span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => onRefresh(device)}
              disabled={isChecking}
              aria-label="刷新此设备状态"
            >
              <RefreshCw className={`w-4 h-4 ${isChecking ? "animate-spin" : ""}`} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="更多操作">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <Pencil className="w-4 h-4 mr-2" />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600"
                  onClick={() => onDelete(device)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* 占用原因 / 错误信息 / 剩余时间 / 时间 */}
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            {status === "busy" && live?.reason && (
              <span className="text-red-600 dark:text-red-400 truncate block">
                {live.reason}
              </span>
            )}
            {status === "error" && (
              <span className="text-amber-600 truncate block">{live?.error ?? "查询出错"}</span>
            )}
            {status === "free" && (
              <span className="text-emerald-600 dark:text-emerald-400">
                可以直接去洗啦 🎉
              </span>
            )}
            {(status === "unknown" || status === "checking") && (
              <span className="text-muted-foreground">点击右上角刷新按钮查询实时状态</span>
            )}
          </div>
          <span className="text-muted-foreground shrink-0">
            更新于 {timeAgo(live?.checkedAt ?? device.lastCheckedAt)}
          </span>
        </div>

        {/* 剩余时间倒计时（订单 remainTime，占用中且可拿到时显示） */}
        {status === "busy" && (live?.endAt ?? 0) > Date.now() && (
          <div className="mt-2 text-sm font-semibold text-red-600 dark:text-red-400">
            ⏳ 剩余 {fmtCountdown((live!.endAt! - Date.now()) / 1000)} · 预计{" "}
            {new Date(live!.endAt!).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            洗完
          </div>
        )}
        {status === "busy" && live?.endAt && live.endAt <= Date.now() && (
          <div className="mt-2 text-sm font-semibold text-red-600 dark:text-red-400">
            可能已洗完，刷新看看
          </div>
        )}

        {device.deviceId && (
          <Badge variant="outline" className="mt-2 text-[10px] text-muted-foreground">
            ID {String(device.deviceId).slice(0, 12)}…
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
