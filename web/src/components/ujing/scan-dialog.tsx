"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Camera, CameraOff, Keyboard, CheckCircle2, XCircle, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ScanResult } from "@/lib/types";

interface ScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  /** 扫码并确认后回调（保存动作由父组件完成），携带实时状态与用户命名 */
  onScanned: (qrCode: string, scanInfo: ScanResult | null, name: string) => Promise<void> | void;
}

type Phase = "scan" | "querying" | "result";

/**
 * 扫码添加洗衣机：
 * 1. 摄像头扫描 U净洗衣机二维码（html5-qrcode）
 * 2. 立即调后端查询该设备实时状态
 * 3. 用户命名并保存
 * 摄像头不可用时可手动粘贴二维码链接
 */
export function ScanDialog({ open, onOpenChange, token, onScanned }: ScanDialogProps) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("scan");
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [scanInfo, setScanInfo] = useState<ScanResult | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [querying, setQuerying] = useState(false);

  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const elementId = "ujing-qr-reader";
  const startedRef = useRef(false);
  const lastDecodedRef = useRef<string | null>(null);

  // 扫到码 → 查询状态（必须定义在摄像头 effect 之前）
  const handleDecoded = useCallback(
    async (text: string) => {
      const code = text.trim();
      if (!/^https?:\/\/(q\.ujing\.com\.cn|app\.littleswan\.com)\//i.test(code)) {
        toast({
          title: "不是 U净 洗衣机码",
          description: "请扫描洗衣机机身上的二维码",
          variant: "destructive",
        });
        return;
      }
      setScannedCode(code);
      setPhase("querying");
      setQuerying(true);
      try {
        const res = await fetch("/api/ujing/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, qrCode: code, withProgram: true }),
        });
        const json = (await res.json()) as {
          result?: ScanResult;
          program?: Record<string, unknown> | null;
          error?: string;
        };
        if (!res.ok || !json.result) throw new Error(json.error || "查询失败");
        const merged: ScanResult = {
          ...json.result,
          storeName:
            (json.program?.storeName as string) || json.result.storeName || undefined,
          deviceNo:
            (json.program?.deviceNo as string) || json.result.deviceNo || undefined,
          deviceTypeName:
            (json.program?.deviceTypeName as string) ||
            json.result.deviceTypeName ||
            undefined,
        };
        setScanInfo(merged);
        setName(merged.storeName ? `${merged.storeName} ${merged.deviceNo ?? ""}`.trim() : "");
        setPhase("result");
      } catch (e) {
        setPhase("scan");
        toast({
          title: "查询设备失败",
          description: e instanceof Error ? e.message : "请稍后重试",
          variant: "destructive",
        });
      } finally {
        setQuerying(false);
      }
    },
    [token, toast]
  );

  // 摄像头扫码初始化（依赖 handleDecoded，定义在其后）
  useEffect(() => {
    if (!open || manualMode || phase !== "scan") return;
    let cancelled = false;

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode(elementId, {
          verbose: false,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        });
        scannerRef.current = scanner as unknown as { stop: () => Promise<void>; clear: () => void };
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
          (decodedText) => {
            // 去抖：同一码 3s 内不重复触发
            if (lastDecodedRef.current === decodedText) return;
            lastDecodedRef.current = decodedText;
            setTimeout(() => (lastDecodedRef.current = null), 3000);
            void handleDecoded(decodedText);
          },
          () => {
            /* per-frame decode errors are noisy, ignore */
          }
        );
        startedRef.current = true; // 仅在成功启动后标记
        setCameraError(null);
      } catch (e) {
        if (cancelled) return;
        console.warn("[camera] not available:", e);
        setCameraError(
          "无法访问摄像头。请确认已授权相机权限，或切换到手动输入模式。"
        );
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current as
        | { stop: () => Promise<void>; clear: () => void }
        | null;
      scannerRef.current = null;
      if (s && startedRef.current) {
        // 仅在真正启动成功后才需要 stop；stop/clear 均可能抛异常，全部容错
        startedRef.current = false;
        Promise.resolve()
          .then(() => s.stop())
          .then(() => s.clear())
          .catch(() => {});
      }
    };
  }, [open, manualMode, phase, handleDecoded]);

  // 手动提交
  const submitManual = () => {
    if (!manualCode.trim()) {
      toast({ title: "请粘贴二维码链接", variant: "destructive" });
      return;
    }
    void handleDecoded(manualCode.trim());
  };

  const save = async () => {
    if (!scannedCode) return;
    setSaving(true);
    try {
      await onScanned(scannedCode, scanInfo, name.trim());
      // 关闭并重置
      onOpenChange(false);
      resetState();
    } finally {
      setSaving(false);
    }
  };

  const resetState = () => {
    setPhase("scan");
    setScannedCode(null);
    setScanInfo(null);
    setName("");
    setManualCode("");
    setManualMode(false);
  };

  const busy = scanInfo ? scanInfo.createOrderEnabled === false : false;
  const free = scanInfo?.createOrderEnabled === true;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) resetState();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>扫码添加洗衣机</DialogTitle>
          <DialogDescription>
            扫描 U净 洗衣机机身上的二维码（q.ujing.com.cn 开头）
          </DialogDescription>
        </DialogHeader>

        {/* ===== 阶段1：扫码 ===== */}
        {phase === "scan" && !manualMode && (
          <div className="space-y-3">
            <div
              id={elementId}
              className="w-full rounded-xl overflow-hidden bg-muted min-h-64 flex items-center justify-center"
              aria-label="二维码扫描取景器"
            >
              {cameraError ? (
                <div className="p-6 text-center space-y-3">
                  <CameraOff className="w-10 h-10 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{cameraError}</p>
                  <Button variant="outline" size="sm" onClick={() => setManualMode(true)}>
                    <Keyboard className="w-4 h-4 mr-1.5" />
                    手动输入二维码链接
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground py-20">
                  <Camera className="w-8 h-8 animate-pulse" />
                  <p className="text-xs">正在启动相机…</p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              提示：也可以拍下洗衣机二维码照片，用微信/相册识别后粘贴链接
            </p>
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setManualMode(true)}>
              <Keyboard className="w-4 h-4 mr-1.5" />
              摄像头不可用？手动输入
            </Button>
          </div>
        )}

        {/* ===== 阶段1b：手动输入 ===== */}
        {phase === "scan" && manualMode && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="manual-code">二维码链接</Label>
              <Input
                id="manual-code"
                placeholder="https://q.ujing.com.cn/ucqrc/index.html?cd=…"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitManual()}
              />
              <p className="text-xs text-muted-foreground">
                打开图片识别工具（如微信「扫一扫 → 相册」）读取洗衣机二维码后，把识别出的链接粘贴到这里
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setManualMode(false)} className="flex-1">
                返回摄像头扫码
              </Button>
              <Button onClick={submitManual} disabled={querying} className="flex-1">
                {querying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                查询设备
              </Button>
            </div>
          </div>
        )}

        {/* ===== 阶段2：查询中 ===== */}
        {phase === "querying" && (
          <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
            <p className="text-sm">正在查询洗衣机状态…</p>
          </div>
        )}

        {/* ===== 阶段3：结果 + 保存 ===== */}
        {phase === "result" && scanInfo && (
          <div className="space-y-4">
            <div
              className={`rounded-xl p-4 space-y-2 ${
                free
                  ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900"
                  : "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900"
              }`}
            >
              <div className="flex items-center gap-2">
                {free ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                ) : (
                  <XCircle className="w-6 h-6 text-red-600" />
                )}
                <span className="text-lg font-semibold">
                  {free ? "空闲可用" : busy ? "占用中" : "状态未知"}
                </span>
                {scanInfo.online === 0 && (
                  <Badge variant="outline" className="text-xs">
                    设备离线
                  </Badge>
                )}
              </div>
              {busy && scanInfo.reason && (
                <p className="text-sm text-red-700 dark:text-red-400">{scanInfo.reason}</p>
              )}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {scanInfo.storeName && <Badge variant="secondary">{scanInfo.storeName}</Badge>}
                {scanInfo.deviceNo && <Badge variant="secondary">机号 {scanInfo.deviceNo}</Badge>}
                {scanInfo.deviceTypeName && (
                  <Badge variant="secondary">{scanInfo.deviceTypeName}</Badge>
                )}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="device-name">备注名（保存后可随时查看）</Label>
              <Input
                id="device-name"
                placeholder="例如：3楼洗衣房右滚筒"
                value={name}
                maxLength={30}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => resetState()} className="flex-1">
                重新扫
              </Button>
              <Button onClick={save} disabled={saving} className="flex-1">
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                保存到我的洗衣机
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
