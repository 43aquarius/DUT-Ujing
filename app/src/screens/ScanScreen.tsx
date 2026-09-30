/**
 * 扫码页：expo-camera 扫描 U净洗衣机二维码
 * 扫到后立即查询实时状态 → 命名 → 保存
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { scanWasherCode, programInfo, isUjingQrCode, ScanWasherResult } from "../lib/ujing";

interface Props {
  token: string;
  onSave: (
    qrCode: string,
    scanInfo: ScanWasherResult | null,
    name: string
  ) => Promise<void>;
  onClose: () => void;
}

type Phase = "scan" | "querying" | "result";

export function ScanScreen({ token, onSave, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>("scan");
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [scanInfo, setScanInfo] = useState<ScanWasherResult | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");

  const handleDecoded = async (text: string) => {
    const code = text.trim();
    if (!isUjingQrCode(code)) {
      Alert.alert("不是 U净 洗衣机码", "请扫描洗衣机机身上的二维码（q.ujing.com.cn 开头）");
      return;
    }
    setScannedCode(code);
    setPhase("querying");
    try {
      const result = await scanWasherCode(token, code);
      let info: ScanWasherResult = result;
      try {
        const program = await programInfo(token, String(result.deviceId));
        info = {
          ...result,
          storeName: program.storeName || result.storeName,
          deviceNo: program.deviceNo || result.deviceNo,
          deviceTypeName: program.deviceTypeName || result.deviceTypeName,
        };
      } catch {
        // 详情失败不影响状态展示
      }
      setScanInfo(info);
      setName(
        info.storeName ? `${info.storeName} ${info.deviceNo ?? ""}`.trim() : ""
      );
      setPhase("result");
    } catch (e) {
      setPhase("scan");
      Alert.alert(
        "查询设备失败",
        e instanceof Error ? e.message : "请稍后重试"
      );
    }
  };

  const save = async () => {
    if (!scannedCode) return;
    setSaving(true);
    try {
      await onSave(scannedCode, scanInfo, name.trim());
      onClose();
    } catch (e) {
      Alert.alert("保存失败", e instanceof Error ? e.message : "请重试");
    } finally {
      setSaving(false);
    }
  };

  const free = scanInfo?.createOrderEnabled === true;
  const busy = scanInfo ? scanInfo.createOrderEnabled === false : false;

  return (
    <View style={styles.container}>
      {/* 顶栏 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.closeBtn}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>扫码添加洗衣机</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* ===== 阶段1：扫码 ===== */}
      {phase === "scan" && !manualMode && (
        <View style={styles.scanArea}>
          {permission === null ? (
            <ActivityIndicator size="large" color="#059669" />
          ) : !permission.granted ? (
            <View style={styles.permissionBox}>
              <Text style={styles.permissionText}>需要相机权限才能扫描二维码</Text>
              <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
                <Text style={styles.permissionBtnText}>授权相机</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setManualMode(true)}>
                <Text style={styles.manualLink}>改用手动输入</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <CameraView
                style={styles.camera}
                facing="back"
                onBarcodeScanned={phase === "scan" ? ({ data }) => handleDecoded(data) : undefined}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              />
              <View style={styles.qrFrame} pointerEvents="none">
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              <Text style={styles.scanHint}>对准洗衣机机身上的二维码</Text>
              <TouchableOpacity onPress={() => setManualMode(true)} style={styles.manualBtn}>
                <Text style={styles.manualBtnText}>摄像头不好使？手动输入</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* ===== 阶段1b：手动输入 ===== */}
      {phase === "scan" && manualMode && (
        <ScrollView style={styles.manualArea} contentContainerStyle={{ padding: 20 }}>
          <Text style={styles.label}>二维码链接</Text>
          <TextInput
            style={styles.input}
            placeholder="https://q.ujing.com.cn/ucqrc/index.html?cd=…"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            autoCorrect={false}
            value={manualCode}
            onChangeText={setManualCode}
          />
          <Text style={styles.tip}>
            用微信「扫一扫 → 相册」识别洗衣机二维码的照片，把识别出的链接粘贴到这里
          </Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <TouchableOpacity
              style={[styles.secondaryBtn, { flex: 1 }]}
              onPress={() => setManualMode(false)}
            >
              <Text style={styles.secondaryBtnText}>返回扫码</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1 }]}
              onPress={() => handleDecoded(manualCode)}
            >
              <Text style={styles.primaryBtnText}>查询设备</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* ===== 阶段2：查询中 ===== */}
      {phase === "querying" && (
        <View style={styles.centerArea}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.queryingText}>正在查询洗衣机状态…</Text>
        </View>
      )}

      {/* ===== 阶段3：结果 + 保存 ===== */}
      {phase === "result" && scanInfo && (
        <ScrollView style={styles.resultArea} contentContainerStyle={{ padding: 20 }}>
          <View style={[styles.statusCard, free ? styles.freeCard : styles.busyCard]}>
            <Text style={styles.statusEmoji}>{free ? "✅" : "❌"}</Text>
            <Text style={[styles.statusText, free ? styles.freeText : styles.busyText]}>
              {free ? "空闲可用" : busy ? "占用中" : "状态未知"}
            </Text>
            {busy && !!scanInfo.reason && (
              <Text style={styles.reasonText}>{scanInfo.reason}</Text>
            )}
            <Text style={styles.metaText}>
              {[scanInfo.storeName, scanInfo.deviceNo ? `机号 ${scanInfo.deviceNo}` : null, scanInfo.deviceTypeName]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>

          <Text style={styles.label}>备注名（保存后可随时查看）</Text>
          <TextInput
            style={styles.input}
            placeholder="例如：3楼洗衣房右滚筒"
            placeholderTextColor="#9ca3af"
            maxLength={30}
            value={name}
            onChangeText={setName}
          />

          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <TouchableOpacity
              style={[styles.secondaryBtn, { flex: 1 }]}
              onPress={() => {
                setPhase("scan");
                setScannedCode(null);
                setScanInfo(null);
                setName("");
              }}
            >
              <Text style={styles.secondaryBtnText}>重新扫</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1 }, saving ? styles.btnDisabled : null]}
              disabled={saving}
              onPress={save}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.primaryBtnText}>保存到我的洗衣机</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    height: 52,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
    paddingTop: 8,
  },
  closeBtn: { fontSize: 20, color: "#374151", padding: 4 },
  headerTitle: { fontSize: 16, fontWeight: "600", color: "#111827" },
  scanArea: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  qrFrame: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  corner: {
    position: "absolute",
    width: 32,
    height: 32,
    borderColor: "#34d399",
  },
  cornerTL: { top: "30%", left: "15%", borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 8 },
  cornerTR: { top: "30%", right: "15%", borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 8 },
  cornerBL: { bottom: "30%", left: "15%", borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 8 },
  cornerBR: { bottom: "30%", right: "15%", borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 8 },
  scanHint: {
    position: "absolute",
    bottom: 110,
    alignSelf: "center",
    color: "#fff",
    fontSize: 14,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  manualBtn: {
    position: "absolute",
    bottom: 50,
    alignSelf: "center",
  },
  manualBtnText: { color: "#a7f3d0", fontSize: 13 },
  permissionBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 },
  permissionText: { color: "#6b7280", fontSize: 14, textAlign: "center" },
  permissionBtn: {
    backgroundColor: "#059669",
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  permissionBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  manualLink: { color: "#059669", fontSize: 13 },
  manualArea: { flex: 1 },
  label: { fontSize: 13, fontWeight: "500", color: "#374151", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#fafafa",
  },
  tip: { fontSize: 11, color: "#9ca3af", marginTop: 8, lineHeight: 16 },
  primaryBtn: {
    backgroundColor: "#059669",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  secondaryBtnText: { color: "#374151", fontSize: 15, fontWeight: "500" },
  btnDisabled: { opacity: 0.55 },
  centerArea: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  queryingText: { color: "#6b7280", fontSize: 14 },
  resultArea: { flex: 1 },
  statusCard: {
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    marginBottom: 20,
  },
  freeCard: { backgroundColor: "#ecfdf5", borderWidth: 1, borderColor: "#a7f3d0" },
  busyCard: { backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca" },
  statusEmoji: { fontSize: 40 },
  statusText: { fontSize: 20, fontWeight: "700", marginTop: 8 },
  freeText: { color: "#047857" },
  busyText: { color: "#b91c1c" },
  reasonText: { color: "#dc2626", fontSize: 13, marginTop: 6, textAlign: "center" },
  metaText: { color: "#6b7280", fontSize: 12, marginTop: 10, textAlign: "center" },
});
