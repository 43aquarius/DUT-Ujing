# DUT-Ujing App（原生 Android）

U净洗衣机扫码收藏 + 占用状态查询的 Android 原生客户端（Kotlin）。

> v2.0 起本目录由 Expo/React Native 重写为原生工程：APK 从 **78MB → 约 2MB**，
> 同包名（`com.dut.ujing.helper`）同签名（`keys/release.keystore`），老版本可直接覆盖升级。
> v1 的 Expo 实现保留在 git 历史（tag `v1.0.0`）中。

## 功能

- 手机号 + 短信验证码登录 U净（新版 HMAC 签名接口 + 旧版降级）
- 摄像头扫码收藏洗衣机（zxing，支持手动粘贴链接兜底）
- 实时状态：空闲可用 / 占用中（含服务端原因原文）/ 不在工作时间等提示**原文透出**
- 占用中时尽力获取订单 `remainTime`，显示「⏳ 剩余 X:XX · 预计 HH:mm 洗完」
- 机型识别（波轮/滚筒/烘干/洗鞋…）、门店/机号信息
- 30 秒自动刷新、单台刷新、下拉全部刷新
- 重命名 / 删除 / 查看原始接口 JSON（诊断新字段用）

## 构建

依赖：JDK 17 + Android SDK（platform 35 / build-tools 35）。

```bash
./gradlew assembleRelease
# 产物: app/build/outputs/apk/release/app-release.apk（R8 压缩 + 仓库内密钥签名）
```

签名口令见 `app/build.gradle.kts`（可用环境变量 `UJING_STORE_PASSWORD` /
`UJING_KEY_ALIAS` / `UJING_KEY_PASSWORD` 覆盖）。

## 代码结构

```
app/src/main/java/com/dut/ujing/helper/
├── ujing/UjingApi.kt    # API 客户端：验证码/登录/扫码/订单详情/程序详情
├── ujing/Models.kt      # ScanInfo/OrderBrief/UiStatus + StatusResolver 状态判定
├── ujing/Store.kt       # SharedPreferences 持久化（会话 7 天 + 设备列表）
├── ujing/JsonExt.kt     # org.json 防御性取值（服务端类型不稳定）
├── LoginActivity.kt     # 登录页
├── MainActivity.kt      # 主面板（列表/扫码/自动刷新/对话框）
└── DeviceAdapter.kt     # 状态卡片（含每秒倒计时 tick）
```

## 状态判定逻辑（StatusResolver）

1. `scanWasherCode` envelope `code != 0` → **ERROR**，显示服务端 `message` 原文
   （如非营业时间的服务端提示，v1 只显示「查询失败」的问题已修复）
2. `createOrderEnabled = true` → **FREE** 空闲可用
3. `= false` → 按 `reason` 分类：
   - 含「使用/占用/运行…」或 `orderId > 0` → **BUSY**（红）
   - 其他（不在工作时间/离线/维护）→ **UNAVAILABLE**（橙），文案为 reason 原文
4. 剩余时间优先级：自己 `orders/running` 中匹配的订单（权威） >
   扫码返回的 `orderId` → `orders/{id}/detail`（他人订单可能被拒，静默降级）
5. 仅订单 `status ∈ {30, 40}` 且未暂停时 `remainTime > 0` 才倒计时
