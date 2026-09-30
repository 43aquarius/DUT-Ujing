"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ScanLine,
  RefreshCw,
  LogOut,
  WashingMachine,
  Loader2,
  MoreVertical,
  UserRound,
  Plus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ScanDialog } from "./scan-dialog";
import { DeviceCard, DeviceLiveState, type LiveStatus } from "./device-card";
import type { SavedDevice, ScanResult } from "@/lib/types";

interface DashboardProps {
  mobile: string;
  token: string;
  onLogout: () => void;
  onTokenExpired: () => void;
}

/** 主面板：已保存洗衣机列表 + 实时状态 */
export function Dashboard({ mobile, token, onLogout, onTokenExpired }: DashboardProps) {
  const { toast } = useToast();
  const [devices, setDevices] = useState<SavedDevice[]>([]);
  const [liveMap, setLiveMap] = useState<Record<string, DeviceLiveState>>({});
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  /** 拉取已保存列表（并用 DB 缓存的最近状态初始化显示） */
  const loadDevices = useCallback(async () => {
    try {
      const res = await fetch(`/api/devices?mobile=${encodeURIComponent(mobile)}`);
      const json = (await res.json()) as { devices?: SavedDevice[]; error?: string };
      if (!res.ok) throw new Error(json.error || "加载失败");
      const list = json.devices ?? [];
      setDevices(list);
      const initial: Record<string, DeviceLiveState> = {};
      for (const d of list) {
        initial[d.id] = {
          status:
            d.lastStatus === "free"
              ? "free"
              : d.lastStatus === "busy"
                ? "busy"
                : "unknown",
          reason: d.lastReason ?? null,
          checkedAt: d.lastCheckedAt ? new Date(d.lastCheckedAt) : undefined,
        };
      }
      setLiveMap(initial);
    } catch (e) {
      toast({
        title: "加载洗衣机列表失败",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [mobile, toast]);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  /** 查询单台设备实时状态 */
  const refreshOne = useCallback(
    async (device: SavedDevice) => {
      setLiveMap((m) => ({
        ...m,
        [device.id]: { status: "checking" },
      }));
      try {
        const res = await fetch("/api/ujing/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: tokenRef.current, qrCode: device.qrCode }),
        });
        const json = (await res.json()) as {
          result?: ScanResult;
          order?: {
            status?: number;
            statusRemark?: string | null;
            remainTime?: number | null;
            workTime?: number | null;
          } | null;
          error?: string;
          code?: number;
        };
        if (res.status === 401) {
          onTokenExpired();
          return;
        }
        if (!res.ok || !json.result) throw new Error(json.error || "查询失败");
        const r = json.result;
        const order = json.order ?? null;
        // 仅 30(自洁)/40(运行) 且 remainTime>0 时倒计时（liteU 实测结论）
        const counting =
          order != null &&
          (order.status === 30 || order.status === 40) &&
          (order.remainTime ?? 0) > 0;
        const status: LiveStatus = r.createOrderEnabled === true ? "free" : "busy";
        setLiveMap((m) => ({
          ...m,
          [device.id]: {
            status,
            reason: r.reason ?? order?.statusRemark ?? null,
            checkedAt: new Date(),
            remainSec: counting ? order!.remainTime! : null,
            endAt: counting ? Date.now() + order!.remainTime! * 1000 : null,
          },
        }));
        // 后台回填设备信息
        void fetch(`/api/devices/${device.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mobile,
            lastStatus: status,
            lastReason: r.reason ?? null,
            scanInfo: {
              deviceId: r.deviceId ? String(r.deviceId) : undefined,
              deviceNo: r.deviceNo ?? undefined,
              storeName: r.storeName ?? undefined,
              deviceTypeName: r.deviceTypeName ?? undefined,
              macAddress: r.macAddress ?? undefined,
            },
          }),
        });
      } catch (e) {
        setLiveMap((m) => ({
          ...m,
          [device.id]: {
            status: "error",
            error: e instanceof Error ? e.message : "查询失败",
            checkedAt: new Date(),
          },
        }));
      }
    },
    [mobile, onTokenExpired]
  );

  /** 刷新全部 */
  const refreshAll = useCallback(async () => {
    if (devices.length === 0) return;
    setRefreshingAll(true);
    // 顺序查询，避免并发过高触发限流
    for (const d of devices) {
      await refreshOne(d);
    }
    setRefreshingAll(false);
  }, [devices, refreshOne]);

  /** 自动刷新（每 30s） */
  useEffect(() => {
    if (!autoRefresh || devices.length === 0) return;
    const timer = setInterval(() => void refreshAll(), 30000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshAll, devices.length]);

  /** 保存新扫码设备 */
  const handleScanned = useCallback(
    async (qrCode: string, scanInfo?: ScanResult, name?: string) => {
      try {
        const res = await fetch("/api/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mobile, qrCode, name, scanInfo }),
        });
        const json = (await res.json()) as { device?: SavedDevice; error?: string };
        if (!res.ok || !json.device) throw new Error(json.error || "保存失败");
        toast({ title: "已保存", description: `「${json.device.name}」已加入我的洗衣机` });
        await loadDevices();
      } catch (e) {
        toast({
          title: "保存失败",
          description: e instanceof Error ? e.message : "",
          variant: "destructive",
        });
        throw e;
      }
    },
    [mobile, loadDevices, toast]
  );

  /** 扫码完成回调：携带实时状态与用户命名保存 */
  const onScanSaved = useCallback(
    async (qrCode: string, scanInfo: ScanResult | null, name: string) => {
      await handleScanned(qrCode, scanInfo ?? undefined, name || undefined);
    },
    [handleScanned]
  );

  const renameDevice = useCallback(
    async (device: SavedDevice, name: string) => {
      await fetch(`/api/devices/${device.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, name }),
      });
      setDevices((ds) => ds.map((d) => (d.id === device.id ? { ...d, name } : d)));
      toast({ title: "已重命名" });
    },
    [mobile, toast]
  );

  const deleteDevice = useCallback(
    async (device: SavedDevice) => {
      const res = await fetch(
        `/api/devices/${device.id}?mobile=${encodeURIComponent(mobile)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setDevices((ds) => ds.filter((d) => d.id !== device.id));
        setLiveMap((m) => {
          const n = { ...m };
          delete n[device.id];
          return n;
        });
        toast({ title: "已删除", description: `「${device.name}」已移除` });
      }
    },
    [mobile, toast]
  );

  const freeCount = devices.filter(
    (d) => liveMap[d.id]?.status === "free" || d.lastStatus === "free"
  ).length;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-emerald-50/60 via-background to-background dark:from-emerald-950/20">
      {/* 顶栏 */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
              <WashingMachine className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-sm sm:text-base leading-none truncate">
                U净洗衣机助手
              </h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {devices.length > 0
                  ? `${devices.length} 台 · ${freeCount} 台空闲`
                  : `${mobile.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={refreshAll}
              disabled={refreshingAll || devices.length === 0}
            >
              {refreshingAll ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-1.5" />
              )}
              <span className="hidden sm:inline">全部刷新</span>
            </Button>
            <Button size="sm" onClick={() => setScanOpen(true)}>
              <ScanLine className="w-4 h-4 mr-1.5" />
              扫码添加
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="账户菜单">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled className="text-xs">
                  <UserRound className="w-4 h-4 mr-2" />
                  {mobile.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onLogout} className="text-red-600 focus:text-red-600">
                  <LogOut className="w-4 h-4 mr-2" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* 主体 */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-5 space-y-4">
        {/* 自动刷新开关 */}
        {devices.length > 0 && (
          <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
            <div>
              <Label htmlFor="auto-refresh" className="text-sm font-medium cursor-pointer">
                自动刷新
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                每 30 秒自动查询一次所有洗衣机状态
              </p>
            </div>
            <Switch
              id="auto-refresh"
              checked={autoRefresh}
              onCheckedChange={(v) => {
                setAutoRefresh(v);
                if (v) void refreshAll();
              }}
            />
          </div>
        )}

        {/* 加载骨架 */}
        {loading && (
          <div className="py-20 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">加载中…</p>
          </div>
        )}

        {/* 空状态 */}
        {!loading && devices.length === 0 && (
          <div className="py-16 text-center space-y-4">
            <div className="w-20 h-20 mx-auto rounded-3xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
              <ScanLine className="w-10 h-10 text-emerald-600" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">还没有收藏的洗衣机</h2>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                扫描洗衣机机身上的二维码，添加后即可随时查看它是否空闲
              </p>
            </div>
            <Button onClick={() => setScanOpen(true)} size="lg" className="rounded-full">
              <Plus className="w-4 h-4 mr-1.5" />
              扫码添加洗衣机
            </Button>
          </div>
        )}

        {/* 设备列表 */}
        {devices.length > 0 && (
          <div className="space-y-3">
            {devices.map((d) => (
              <DeviceCard
                key={d.id}
                device={d}
                live={liveMap[d.id]}
                onRefresh={(dev) => void refreshOne(dev)}
                onRename={(dev, name) => void renameDevice(dev, name)}
                onDelete={(dev) => void deleteDevice(dev)}
              />
            ))}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground pt-2 pb-6">
          状态来自 U净 官方接口实时查询 · 仅供个人学习使用
        </p>
      </main>

      {/* 扫码对话框 */}
      <ScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        token={token}
        onScanned={onScanSaved}
      />
    </div>
  );
}
