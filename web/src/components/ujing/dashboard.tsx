"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ScanLine,
  RefreshCw,
  LogOut,
  WashingMachine,
  Loader2,
  MoreVertical,
  UserRound,
  Plus,
  ArrowUpDown,
  Filter,
  Download,
  Upload,
  ClipboardList,
  Timer,
  Github,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ScanDialog } from "./scan-dialog";
import { DeviceCard, DeviceLiveState, type LiveStatus } from "./device-card";
import {
  type SavedDevice,
  type RunningOrderView,
  type ScanResult,
  displayNameOf,
  ORDER_STATUS_NAME,
} from "@/lib/types";
import { friendlyName } from "@/lib/ujing";

interface DashboardProps {
  mobile: string;
  token: string;
  onLogout: () => void;
  onTokenExpired: () => void;
}

type SortMode = "added" | "name" | "status" | "remain";

const SORT_LABEL: Record<SortMode, string> = {
  added: "添加时间",
  name: "名称",
  status: "状态（空闲优先）",
  remain: "剩余时间（快洗完优先）",
};

const STATUS_RANK: Record<string, number> = {
  free: 0,
  busy: 1,
  error: 4,
  unknown: 3,
  checking: 2,
};

function fmtCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
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

  // v2.1：排序 / 筛选（localStorage 持久化）
  const [sortMode, setSortMode] = useState<SortMode>("added");
  const [freeOnly, setFreeOnly] = useState(false);
  useEffect(() => {
    try {
      const s = localStorage.getItem("ujing_sort") as SortMode | null;
      if (s && s in SORT_LABEL) setSortMode(s);
      setFreeOnly(localStorage.getItem("ujing_free_only") === "1");
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("ujing_sort", sortMode);
      localStorage.setItem("ujing_free_only", freeOnly ? "1" : "0");
    } catch {}
  }, [sortMode, freeOnly]);

  // v2.1：我的订单
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [orders, setOrders] = useState<RunningOrderView[] | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [, ordersTick] = useState(0);

  // 订单倒计时每秒重绘
  useEffect(() => {
    if (!ordersOpen) return;
    const t = setInterval(() => ordersTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [ordersOpen]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const res = await fetch("/api/ujing/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current }),
      });
      if (res.status === 401) {
        onTokenExpired();
        return;
      }
      const json = (await res.json()) as { orders?: RunningOrderView[]; error?: string };
      if (!res.ok) throw new Error(json.error || "查询失败");
      setOrders(json.orders ?? []);
    } catch (e) {
      toast({
        title: "查询订单失败",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setOrdersLoading(false);
    }
  }, [onTokenExpired, toast]);

  useEffect(() => {
    if (ordersOpen) void loadOrders();
  }, [ordersOpen, loadOrders]);

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

  /** 查询单台设备实时状态（ownOrders：自己运行中的订单，剩余时间权威来源） */
  const refreshOne = useCallback(
    async (device: SavedDevice, ownOrders?: RunningOrderView[]) => {
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
          result?: {
            deviceId?: string;
            deviceNo?: string;
            storeName?: string;
            deviceTypeName?: string;
            macAddress?: string;
            createOrderEnabled?: boolean;
            reason?: string;
            orderId?: number;
          };
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
        const scanOrder = json.order ?? null;
        // 自己的订单优先（权威剩余时间），扫码 orderId 详情尽力而为
        const own =
          ownOrders?.find(
            (o) =>
              (o.deviceId && String(r.deviceId) === o.deviceId) ||
              (o.deviceNo && r.deviceNo === o.deviceNo)
          ) ?? null;
        const order = own
          ? {
              status: own.status ?? undefined,
              statusRemark: own.statusRemark ?? null,
              remainTime: own.remainTime ?? null,
              workTime: own.workTime ?? null,
            }
          : scanOrder;
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
        // 后台回填设备信息（v2.1：服务端会顺带升级自动友好名）
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
        }).then(() => loadDevices());
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
    [mobile, onTokenExpired, loadDevices]
  );

  /** 刷新全部（先拉自己的运行订单，再逐台查询） */
  const refreshAll = useCallback(async () => {
    if (devices.length === 0) return;
    setRefreshingAll(true);
    // 自己运行中的订单：剩余时间的权威来源
    let ownOrders: RunningOrderView[] | undefined;
    try {
      const res = await fetch("/api/ujing/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current }),
      });
      const json = (await res.json()) as { orders?: RunningOrderView[] };
      ownOrders = json.orders ?? [];
    } catch {
      ownOrders = undefined;
    }
    // 顺序查询，避免并发过高触发限流
    for (const d of devices) {
      await refreshOne(d, ownOrders);
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
        body: JSON.stringify({ mobile, name, customName: true }),
      });
      setDevices((ds) =>
        ds.map((d) => (d.id === device.id ? { ...d, name, customName: true } : d))
      );
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
        toast({ title: "已删除", description: `「${displayNameOf(device)}」已移除` });
      }
    },
    [mobile, toast]
  );

  // v2.1：导出设备清单（JSON 下载）
  const exportDevices = useCallback(() => {
    if (devices.length === 0) {
      toast({ title: "还没有收藏任何洗衣机" });
      return;
    }
    const payload = {
      app: "DUT-Ujing",
      schema: 1,
      exportedAt: new Date().toLocaleString("zh-CN"),
      count: devices.length,
      devices: devices.map((d) => ({
        name: d.name,
        customName: d.customName ?? false,
        qrCode: d.qrCode,
        deviceId: d.deviceId ?? undefined,
        deviceNo: d.deviceNo ?? undefined,
        storeName: d.storeName ?? undefined,
        deviceTypeName: d.deviceTypeName ?? undefined,
        macAddress: d.macAddress ?? undefined,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DUT-Ujing-设备备份-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "已导出", description: `${devices.length} 台设备已保存为 JSON 文件` });
  }, [devices, toast]);

  // v2.1：导入设备清单
  const importDevices = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as { devices?: unknown[] } | unknown[];
        const list = Array.isArray(parsed)
          ? parsed
          : ((parsed as { devices?: unknown[] }).devices ?? []);
        if (!Array.isArray(list) || list.length === 0) {
          throw new Error("文件里没有设备数据");
        }
        const res = await fetch("/api/devices/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mobile, devices: list }),
        });
        const json = (await res.json()) as {
          imported?: number;
          merged?: number;
          skipped?: number;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || "导入失败");
        toast({
          title: "导入完成",
          description: `新增 ${json.imported ?? 0} 台 · 合并 ${json.merged ?? 0} 台 · 跳过 ${json.skipped ?? 0} 条`,
        });
        await loadDevices();
        void refreshAll();
      } catch (e) {
        toast({
          title: "导入失败",
          description: e instanceof Error ? e.message : "",
          variant: "destructive",
        });
      }
    },
    [mobile, loadDevices, toast, refreshAll]
  );

  const freeCount = devices.filter(
    (d) => liveMap[d.id]?.status === "free" || d.lastStatus === "free"
  ).length;

  // v2.1：排序 + 筛选后的可见列表
  const visibleDevices = useMemo(() => {
    const live = (d: SavedDevice): LiveStatus =>
      liveMap[d.id]?.status ??
      (d.lastStatus === "free"
        ? "free"
        : d.lastStatus === "busy"
          ? "busy"
          : "unknown");
    let list = [...devices];
    if (freeOnly) list = list.filter((d) => live(d) === "free");
    list.sort((a, b) => {
      switch (sortMode) {
        case "name":
          return displayNameOf(a).localeCompare(displayNameOf(b), "zh-CN");
        case "status":
          return (STATUS_RANK[live(a)] ?? 9) - (STATUS_RANK[live(b)] ?? 9);
        case "remain": {
          const ea = liveMap[a.id]?.endAt ?? Infinity;
          const eb = liveMap[b.id]?.endAt ?? Infinity;
          return ea - eb;
        }
        default:
          return (
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
      }
    });
    return list;
  }, [devices, liveMap, sortMode, freeOnly]);

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
                  ? freeOnly
                    ? `空闲 ${freeCount} 台（共 ${devices.length} 台）`
                    : `${devices.length} 台 · ${freeCount} 台空闲`
                  : `${mobile.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              asChild
            >
              <a
                href="https://github.com/43aquarius/DUT-Ujing"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub 仓库"
                title="GitHub 仓库"
              >
                <Github className="w-4 h-4" />
              </a>
            </Button>
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
                <DropdownMenuLabel className="text-xs">
                  <UserRound className="w-4 h-4 mr-2 inline" />
                  {mobile.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setOrdersOpen(true)}>
                  <ClipboardList className="w-4 h-4 mr-2" />
                  我的订单（剩余时间）
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportDevices}>
                  <Download className="w-4 h-4 mr-2" />
                  导出设备清单
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "application/json,.json";
                    input.onchange = () => {
                      const f = input.files?.[0];
                      if (f) void importDevices(f);
                    };
                    input.click();
                  }}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  导入设备清单
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout} className="text-red-600 focus:text-red-600">
                  <LogOut className="w-4 h-4 mr-2" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* v2.1 工具栏：只看空闲 + 排序 */}
        {devices.length > 0 && (
          <div className="max-w-2xl mx-auto px-4 pb-2.5 flex items-center gap-2 overflow-x-auto">
            <Button
              size="sm"
              variant={freeOnly ? "default" : "outline"}
              className="h-7 rounded-full text-xs px-3 shrink-0"
              onClick={() => setFreeOnly((v) => !v)}
            >
              <Filter className="w-3.5 h-3.5 mr-1.5" />
              {freeOnly ? `只看空闲（${freeCount}）` : "只看空闲"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full text-xs px-3 shrink-0"
                >
                  <ArrowUpDown className="w-3.5 h-3.5 mr-1.5" />
                  排序：{SORT_LABEL[sortMode]}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(Object.keys(SORT_LABEL) as SortMode[]).map((k) => (
                  <DropdownMenuItem key={k} onClick={() => setSortMode(k)}>
                    {k === sortMode ? "✓ " : ""}
                    {SORT_LABEL[k]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
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

        {/* 筛选后为空 */}
        {!loading && devices.length > 0 && visibleDevices.length === 0 && (
          <div className="py-16 text-center space-y-3">
            <div className="text-5xl">😴</div>
            <h2 className="text-base font-semibold">当前没有空闲的洗衣机</h2>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              全部被占用或不可用，可关闭「只看空闲」查看完整列表
            </p>
          </div>
        )}

        {/* 设备列表 */}
        {visibleDevices.length > 0 && (
          <div className="space-y-3">
            {visibleDevices.map((d) => (
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

      {/* v2.1：我的订单对话框 */}
      <Dialog open={ordersOpen} onOpenChange={setOrdersOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-emerald-600" />
              我的订单（运行中）
            </DialogTitle>
            <DialogDescription>
              自己下的订单可查询官方接口的剩余时间（含 U净官方 App 下的单）
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {ordersLoading && (
              <div className="py-8 flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
                <p className="text-sm">查询中…</p>
              </div>
            )}
            {!ordersLoading && orders != null && orders.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                当前没有进行中的订单
                <p className="text-xs mt-1.5">下单后这里会显示剩余时间倒计时</p>
              </div>
            )}
            {!ordersLoading &&
              orders?.map((o) => {
                const saved = devices.find(
                  (d) =>
                    (o.deviceId && d.deviceId === o.deviceId) ||
                    (o.deviceNo && d.deviceNo === o.deviceNo)
                );
                const statusName =
                  o.statusRemark ||
                  (o.status != null ? ORDER_STATUS_NAME[o.status] : null) ||
                  "进行中";
                const endAt = o.endAt ?? null;
                const remain = endAt ? (endAt - Date.now()) / 1000 : null;
                return (
                  <div
                    key={String(o.orderId)}
                    className="rounded-xl border bg-emerald-50/50 dark:bg-emerald-950/20 p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm truncate">
                        {friendlyName(o.storeName, o.deviceNo) ||
                          o.deviceTypeName ||
                          `订单 #${o.orderId}`}
                      </span>
                      <Badge
                        variant={saved ? "default" : "secondary"}
                        className={
                          saved
                            ? "bg-emerald-600 hover:bg-emerald-600 text-[10px]"
                            : "text-[10px] text-muted-foreground"
                        }
                      >
                        {saved ? "已收藏" : "未收藏"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {[o.deviceTypeName, statusName, o.isPauseStatus ? "已暂停" : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {endAt != null && remain != null && remain > 0 && (
                      <p className="text-red-600 dark:text-red-400 font-semibold text-sm mt-2 flex items-center gap-1.5">
                        <Timer className="w-4 h-4" />
                        剩余 {fmtCountdown(remain)} · 预计 {fmtClock(endAt)} 洗完
                      </p>
                    )}
                    {endAt != null && remain != null && remain <= 0 && (
                      <p className="text-emerald-600 font-semibold text-sm mt-2">
                        可能已经洗完 🎉
                      </p>
                    )}
                    {endAt == null && (
                      <p className="text-muted-foreground text-xs mt-2">
                        {o.workTime ? `整程约 ${o.workTime} 分钟` : "暂无倒计时数据"}
                      </p>
                    )}
                    {!saved && (
                      <p className="text-[10px] text-muted-foreground mt-2">
                        这台还没收藏：订单不含机身码，可到机身扫码收藏
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => void loadOrders()}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              刷新
            </Button>
            <Button size="sm" onClick={() => setOrdersOpen(false)}>
              关闭
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
