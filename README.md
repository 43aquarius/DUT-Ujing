# DUT-Ujing · U净洗衣机状态查询

扫描 U净洗衣机的二维码并收藏，随时查看洗衣机**是否被占用、还剩多久洗完、能否直接使用**。包含 Web 版和 App 版双端实现。

```
📱 扫码收藏洗衣机 → 💾 保存到列表 → 🔄 随时查询实时状态
   空闲可用 ✅ / 占用中 ❌（含原因 + 剩余时间⏳）/ 不在工作时间等服务端提示原文
```

## 功能

- **登录 U净**：手机号 + 短信验证码（走官方接口，与官方 App 同链路）
- **扫码添加**：摄像头扫描洗衣机机身上的二维码（支持手动粘贴链接兜底）
- **实时状态**：调用官方 `scanWasherCode` 接口，`createOrderEnabled = true` 即空闲可用
- **服务端提示原文透出**：非营业时间/离线/维护等情况下，直接显示 U净服务端返回的原因文案（不再只显示「查询失败」）
- **剩余时间倒计时**⏳：占用中时尽力获取当前订单的 `remainTime`，显示「剩余 X:XX · 预计 HH:mm 洗完」
- **机型识别**：波轮/滚筒/烘干/洗鞋机等类型展示
- **状态面板**：每台洗衣机的占用状态 + 占用原因 + 距上次查询时间
- **自动刷新**：可开启 30 秒轮询，全部设备状态一屏掌握
- **设备管理**：重命名、删除、单台刷新、全部刷新、查看原始接口数据（便于发现新字段）

## 仓库结构

```
DUT-Ujing/
├── docs/
│   └── ujing-api.md        # U净 API 协议文档（7 个开源项目逆向成果交叉比对）
├── web/                    # Web 版（Next.js 16 + Prisma + shadcn/ui）
│   ├── src/lib/ujing.ts    #   U净 API 客户端（服务端）
│   ├── src/app/api/        #   代理接口（规避浏览器 CORS）
│   └── src/components/ujing/
│       ├── login-view.tsx  #   登录视图
│       ├── scan-dialog.tsx #   扫码对话框（html5-qrcode）
│       ├── dashboard.tsx   #   主面板
│       └── device-card.tsx #   设备状态卡片
└── app/                    # App 版（原生 Android / Kotlin，v2.0 起替换 Expo 版）
    ├── app/src/main/java/com/dut/ujing/helper/
    │   ├── ujing/UjingApi.kt    #   U净 API 客户端（验证码/登录/扫码/订单详情）
    │   ├── ujing/Models.kt      #   状态解析（服务端原文透出 + 剩余时间）
    │   ├── ujing/Store.kt       #   本地存储（SharedPreferences）
    │   ├── LoginActivity.kt     #   登录（手机号 + 验证码）
    │   ├── MainActivity.kt      #   主面板（设备列表/扫码/自动刷新）
    │   └── DeviceAdapter.kt     #   状态卡片适配器
    └── keys/               #   Android 签名密钥（个人项目随仓库分发）
```

## 📲 直接下载 APK

到 [Releases](https://github.com/43aquarius/DUT-Ujing/releases) 页面下载最新的 `DUT-Ujing-vX.X.X.apk`，手机上直接安装（需允许“安装未知来源应用”）。

- **v2.0.0 起为原生 Kotlin 实现，APK 仅约 2MB**（v1 的 Expo/RN 版为 78MB；同包名同签名，可直接覆盖升级）。
- 每次打 `v*` tag 可由 GitHub Actions 自动构建发布（需激活 `.github/workflow-templates/`，见下文）。

## Web 版运行

```bash
cd web
bun install               # 或 npm install
bun run db:push           # 初始化 SQLite 数据库
bun run dev               # http://localhost:3000
```

技术栈：Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma (SQLite) · html5-qrcode

架构说明：浏览器无法直连 `phoenix.ujing.online`（CORS），因此由 Next.js API Routes 做服务端代理；洗衣机列表存 SQLite（按手机号隔离，跨设备可同步）；JWT 只存浏览器 localStorage。

## App 版运行与打包

App 为原生 Android 工程（Kotlin），需 Android SDK + JDK 17：

```bash
cd app
./gradlew assembleRelease    # 产物：app/build/outputs/apk/release/app-release.apk
```

技术栈：Kotlin · Material 3（经典 View 体系）· OkHttp · zxing-android-embedded（扫码）· SharedPreferences

体积说明：不依赖 React Native/Compose 运行时，无 native so，R8 压缩后 APK 仅约 2MB；权限只有相机 + 网络。App 直连 U净 接口，数据全部保存在本机。

- **CI 自动打包**：推送 `v*` tag，Actions 自动构建 release APK 并发布（模板在 `.github/workflow-templates/`，PAT 无 workflow 权限时需手动复制到 `.github/workflows/` 激活）。
- **本地打包**：`cd app && ./gradlew assembleRelease`，用仓库内 `keys/release.keystore`（alias `ujing`）签名。

签名说明：本项目为个人使用，签名密钥 `app/keys/release.keystore` 随仓库分发（口令见 `app/app/build.gradle.kts`），保证后续版本可覆盖安装；公开分发请自行更换密钥。

## U净 API 协议（速览）

完整逆向文档见 [`docs/ujing-api.md`](docs/ujing-api.md)，综合了以下 7 个开源项目的成果：

| 接口 | 说明 |
|------|------|
| `POST /api/v1/devices/scanWasherCode` | **核心**：传二维码原文 → `createOrderEnabled` 判空闲；占用时 `orderId`/`reason` 可取剩余时间与原因 |
| `GET /api/v1/orders/{orderId}/detail` | 订单详情：`status`/`statusRemark`/`remainTime`（剩余秒）/`workTime`（总时长分钟）|
| `GET /api/v1/orders/running` | 自己进行中的订单（剩余时间权威来源）|
| `GET /api/v1/wechat/captcha/create` | 新版验证码（HMAC-SHA256 签名，失败自动降级旧版 `/api/v1/captcha`）|
| `POST /api/v1/login` | 手机号 + 验证码 → JWT |
| `GET /api/v1/app/washer/devices/program/info` | 设备详情（门店/机号/价目表）|
| `GET /api/v1/stores/near` · `GET /api/v1/devices/reserve` | 门店级空闲概览（free/total/waitTime）|

Base URL：`https://phoenix.ujing.online`

## 声明

- 本项目为开源协议学习项目，只读使用官方查询接口，不涉及下单、支付、蓝牙控制。
- 与美的集团、无锡小净共享网络、U净 App 无任何关联，接口著作权归原厂商所有。
- 仅供个人学习使用，请勿高频请求或用于商业用途。
