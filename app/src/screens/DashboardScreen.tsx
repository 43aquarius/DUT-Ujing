/**
 * 主面板：已保存洗衣机列表 + 实时占用状态（复刻 Web 版功能）
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  StatusBar,
} from "react-native";
import { scanWasherCode, ScanWasherResult } from "../lib/ujing";
import { SavedDevice, AuthSession, loadDevices, saveDevices } from "../lib/storage";
import { ScanScreen } from "./ScanScreen";

interface Props {
  session: AuthSession;
  onLogout: () => void;
  onTokenExpired: () => void;
}

type LiveStatus = "checking" | "free" | "busy" | "error" | "unknown";

interface LiveState {
  status: LiveStatus;
  reason?: string | null;
  checkedAt?: number;
  error?: string;
}

function timeAgo(ts?: number | null): string {
  if (!ts) return "未查询";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export function DashboardScreen({ session, onLogout, onTokenExpired }: Props) {
  const [devices, setDevices] = useState<SavedDevice[]>([]);
  const [liveMap, setLiveMap] = useState<Record<string, LiveState>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const tokenRef = useRef(session.token);
  tokenRef.current = session.token;

  const load = useCallback(async () => {
    const list = await loadDevices();
    setDevices(list);
    const initial: Record<string, LiveState> = {};
    for (const d of list) {
      initial[d.id] = {
        status: d.lastStatus === "free" ? "free" : d.lastStatus === "busy" ? "busy" : "unknown",
        reason: d.lastReason ?? null,
        checkedAt: d.lastCheckedAt ?? undefined,
      };
    }
    setLiveMap(initial);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(async (list: SavedDevice[]) => {
    setDevices(list);
    await saveDevices(list);
  }, []);

  const refreshOne = useCallback(
    async (device: SavedDevice) => {
      setLiveMap((m) => ({ ...m, [device.id]: { status: "checking" } }));
      try {
        const r = await scanWasherCode(tokenRef.current, device.qrCode);
        const status: LiveStatus = r.createOrderEnabled === true ? "free" : "busy";
        setLiveMap((m) => ({
          ...m,
          [device.id]: { status, reason: r.reason ?? null, checkedAt: Date.now() },
        }));
        // 回填设备信息 + 更新缓存
        setDevices((ds) => {
          const next = ds.map((d) =>
            d.id === device.id
              ? {
                  ...d,
                  deviceId: r.deviceId ? String(r.deviceId) : d.deviceId,
                  deviceNo: r.deviceNo ?? d.deviceNo,
                  storeName: r.storeName ?? d.storeName,
                  deviceTypeName: r.deviceTypeName ?? d.deviceTypeName,
                  macAddress: r.macAddress ?? d.macAddress,
                  lastStatus: status,
                  lastReason: r.reason ?? null,
                  lastCheckedAt: Date.now(),
                }
              : d
          );
          void saveDevices(next);
          return next;
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "查询失败";
        // 401 → token 过期
        if (e && typeof e === "object" && "code" in e && (e as { code: number }).code === 401) {
          onTokenExpired();
          return;
        }
        setLiveMap((m) => ({
          ...m,
          [device.id]: { status: "error", error: msg, checkedAt: Date.now() },
        }));
      }
    },
    [onTokenExpired]
  );

  const refreshAll = useCallback(async () => {
    if (devices.length === 0) return;
    setRefreshing(true);
    for (const d of devices) {
      await refreshOne(d);
    }
    setRefreshing(false);
  }, [devices, refreshOne]);

  // 自动刷新（30s）
  useEffect(() => {
    if (!autoRefresh || devices.length === 0) return;
    const timer = setInterval(() => void refreshAll(), 30000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshAll, devices.length]);

  const handleSave = useCallback(
    async (qrCode: string, scanInfo: ScanWasherResult | null, name: string) => {
      const list = await loadDevices();
      const existing = list.find((d) => d.qrCode === qrCode);
      const status: SavedDevice["lastStatus"] =
        scanInfo?.createOrderEnabled === true
          ? "free"
          : scanInfo?.createOrderEnabled === false
            ? "busy"
            : "unknown";
      if (existing) {
        const next = list.map((d) =>
          d.qrCode === qrCode
            ? {
                ...d,
                name: name || d.name,
                deviceId: scanInfo?.deviceId ? String(scanInfo.deviceId) : d.deviceId,
                deviceNo: scanInfo?.deviceNo ?? d.deviceNo,
                storeName: scanInfo?.storeName ?? d.storeName,
                deviceTypeName: scanInfo?.deviceTypeName ?? d.deviceTypeName,
                lastStatus: status,
                lastReason: scanInfo?.reason ?? null,
                lastCheckedAt: Date.now(),
              }
            : d
        );
        await persist(next);
      } else {
        const device: SavedDevice = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: name || `洗衣机 ${qrCode.slice(-6)}`,
          qrCode,
          deviceId: scanInfo?.deviceId ? String(scanInfo.deviceId) : null,
          deviceNo: scanInfo?.deviceNo ?? null,
          storeName: scanInfo?.storeName ?? null,
          deviceTypeName: scanInfo?.deviceTypeName ?? null,
          macAddress: (scanInfo?.macAddress as string | undefined) ?? null,
          lastStatus: status,
          lastReason: scanInfo?.reason ?? null,
          lastCheckedAt: Date.now(),
          createdAt: Date.now(),
        };
        await persist([...list, device]);
      }
    },
    [persist]
  );

  // 重命名弹窗（跨平台）
  const [renaming, setRenaming] = useState<SavedDevice | null>(null);
  const [renameText, setRenameText] = useState("");

  const openRename = (device: SavedDevice) => {
    setRenaming(device);
    setRenameText(device.name);
  };

  const commitRename = async () => {
    if (renaming && renameText.trim()) {
      const list = await loadDevices();
      await persist(
        list.map((d) => (d.id === renaming.id ? { ...d, name: renameText.trim() } : d))
      );
    }
    setRenaming(null);
  };

  const confirmDelete = (device: SavedDevice) => {
    Alert.alert("删除洗衣机", `确定删除「${device.name}」吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          const list = await loadDevices();
          await persist(list.filter((d) => d.id !== device.id));
        },
      },
    ]);
  };

  const freeCount = devices.filter((d) => liveMap[d.id]?.status === "free").length;

  const renderItem = ({ item }: { item: SavedDevice }) => {
    const live = liveMap[item.id];
    const status: LiveStatus = live?.status ?? "unknown";
    const isChecking = status === "checking";
    const statusLabel =
      status === "free" ? "空闲可用" : status === "busy" ? "占用中" : status === "checking" ? "查询中" : status === "error" ? "查询失败" : "未知状态";
    const statusColor =
      status === "free" ? "#059669" : status === "busy" ? "#dc2626" : "#9ca3af";
    return (
      <View style={[styles.card, status === "free" && styles.cardFree, status === "busy" && styles.cardBusy]}>
        <View style={styles.cardRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.deviceName} numberOfLines={1}>
              🌀 {item.name}
            </Text>
            <Text style={styles.deviceMeta} numberOfLines={1}>
              {[item.storeName, item.deviceNo ? `#${item.deviceNo}` : null, item.deviceTypeName]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.refreshBtn}
            disabled={isChecking}
            onPress={() => refreshOne(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isChecking ? (
              <ActivityIndicator size="small" color="#6b7280" />
            ) : (
              <Text style={styles.refreshIcon}>⟳</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.moreBtn}
            onPress={() =>
              Alert.alert(item.name, undefined, [
                { text: "刷新状态", onPress: () => refreshOne(item) },
                { text: "重命名", onPress: () => openRename(item) },
                { text: "删除", style: "destructive", onPress: () => confirmDelete(item) },
                { text: "取消", style: "cancel" },
              ])
            }
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.moreIcon}>⋯</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.cardBottom}>
          <Text
            style={[styles.statusText, { color: statusColor }]}
            numberOfLines={1}
          >
            {status === "busy" && live?.reason ? live.reason : statusLabel}
          </Text>
          <Text style={styles.timeText}>更新于 {timeAgo(live?.checkedAt ?? item.lastCheckedAt)}</Text>
        </View>
      </View>
    );
  };

  if (scanning) {
    return (
      <View style={{ flex: 1 }}>
        <StatusBar barStyle="dark-content" />
        <ScanScreen
          token={session.token}
          onSave={handleSave}
          onClose={() => {
            setScanning(false);
            void load();
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      {/* 顶栏 */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>U净洗衣机助手</Text>
          <Text style={styles.headerSub}>
            {devices.length > 0
              ? `${devices.length} 台 · ${freeCount} 台空闲`
              : session.mobile.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.scanBtn}
          onPress={() => setScanning(true)}
        >
          <Text style={styles.scanBtnText}>＋ 扫码</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.logoutIcon}>⏻</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#059669" />
        </View>
      ) : devices.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📷</Text>
          <Text style={styles.emptyTitle}>还没有收藏的洗衣机</Text>
          <Text style={styles.emptyDesc}>
            扫描洗衣机机身上的二维码{"\n"}添加后即可随时查看它是否空闲
          </Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => setScanning(true)}>
            <Text style={styles.emptyBtnText}>扫码添加洗衣机</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(d) => d.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor="#059669" />
          }
          ListHeaderComponent={
            <TouchableOpacity style={styles.autoRow} onPress={() => setAutoRefresh((v) => !v)}>
              <View>
                <Text style={styles.autoTitle}>自动刷新</Text>
                <Text style={styles.autoDesc}>每 30 秒自动查询一次所有状态</Text>
              </View>
              <View style={[styles.switchTrack, autoRefresh && styles.switchOn]}>
                <View style={[styles.switchThumb, autoRefresh && styles.switchThumbOn]} />
              </View>
            </TouchableOpacity>
          }
          ListFooterComponent={
            <Text style={styles.footer}>
              状态来自 U净 官方接口实时查询 · 仅供个人学习使用
            </Text>
          }
        />
      )}

      {/* 重命名弹窗 */}
      <Modal
        visible={!!renaming}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(null)}
      >
        <View style={styles.modalMask}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>重命名</Text>
            <TextInput
              style={styles.modalInput}
              value={renameText}
              maxLength={30}
              autoFocus
              onChangeText={setRenameText}
              onSubmitEditing={commitRename}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.secondaryBtn, { flex: 1 }]}
                onPress={() => setRenaming(null)}
              >
                <Text style={styles.secondaryBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalPrimaryBtn, { flex: 1 }]} onPress={commitRename}>
                <Text style={styles.primaryBtnText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
    paddingTop: (StatusBar.currentHeight ?? 24) + 10,
  },
  headerTitle: { fontSize: 16, fontWeight: "700", color: "#111827" },
  headerSub: { fontSize: 11, color: "#6b7280", marginTop: 2 },
  scanBtn: {
    backgroundColor: "#059669",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  scanBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  logoutBtn: { padding: 6 },
  logoutIcon: { fontSize: 18, color: "#9ca3af" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 17, fontWeight: "600", color: "#374151" },
  emptyDesc: { fontSize: 13, color: "#9ca3af", textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    marginTop: 10,
    backgroundColor: "#059669",
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 13,
  },
  emptyBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  autoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 4,
  },
  autoTitle: { fontSize: 14, fontWeight: "600", color: "#111827" },
  autoDesc: { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  switchTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#e5e7eb",
    padding: 2,
  },
  switchOn: { backgroundColor: "#059669" },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  switchThumbOn: { transform: [{ translateX: 18 }] },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  cardFree: { borderColor: "#a7f3d0", backgroundColor: "#f0fdf4" },
  cardBusy: { borderColor: "#fecaca", backgroundColor: "#fef2f2" },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  deviceName: { fontSize: 16, fontWeight: "600", color: "#111827" },
  deviceMeta: { fontSize: 12, color: "#9ca3af", marginTop: 3 },
  refreshBtn: { padding: 6 },
  refreshIcon: { fontSize: 18, color: "#6b7280" },
  moreBtn: { padding: 2 },
  moreIcon: { fontSize: 18, color: "#9ca3af", fontWeight: "700" },
  cardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
    gap: 8,
  },
  statusText: { fontSize: 13, fontWeight: "600", flex: 1 },
  timeText: { fontSize: 11, color: "#9ca3af" },
  footer: {
    textAlign: "center",
    fontSize: 11,
    color: "#9ca3af",
    paddingVertical: 16,
  },
  modalMask: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    width: "100%",
  },
  modalTitle: { fontSize: 16, fontWeight: "600", color: "#111827", marginBottom: 12 },
  modalInput: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#fafafa",
  },
  modalPrimaryBtn: {
    backgroundColor: "#059669",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  secondaryBtnText: { color: "#374151", fontSize: 15, fontWeight: "500" },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
