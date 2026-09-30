# DUT-Ujing · U净洗衣机状态查询

扫描 U净洗衣机的二维码并收藏，随时查看洗衣机**是否被占用、能否直接使用**。包含 Web 版和 App 版双端实现。

```
📱 扫码收藏洗衣机 → 💾 保存到列表 → 🔄 随时查询实时状态
   空闲可用 ✅ / 占用中 ❌（含原因）
```

## 功能

- **登录 U净**：手机号 + 短信验证码（走官方接口，与官方 App 同链路）
- **扫码添加**：摄像头扫描洗衣机机身上的二维码（支持手动粘贴链接兜底）
- **实时状态**：调用官方 `scanWasherCode` 接口，`createOrderEnabled = true` 即空闲可用
- **状态面板**：每台洗衣机的占用状态 + 占用原因 + 距上次查询时间
- **自动刷新**：可开启 30 秒轮询，全部设备状态一屏掌握
- **设备管理**：重命名、删除、单台刷新、全部刷新

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
└── app/                    # App 版（Expo React Native，复刻 Web 功能）
    ├── plugins/            #   Expo 配置插件（release 签名 + 权限裁剪）
    ├── keys/               #   Android 签名密钥（个人项目随仓库分发）
    ├── App.tsx
    └── src/
        ├── lib/ujing.ts    #   U净 API 客户端（RN 直连，无 CORS 限制）
        ├── lib/storage.ts  #   AsyncStorage 会话与设备存储
        └── screens/        #   登录 / 主面板 / 扫码
```

## 📲 直接下载 APK

到 [Releases](https://github.com/43aquarius/DUT-Ujing/releases) 页面下载最新的 `DUT-Ujing-vX.X.X.apk`，手机上直接安装（需允许“安装未知来源应用”）。APK 由 GitHub Actions 自动构建并签名，每次打 `v*` tag 会自动发布新版本。

## Web 版运行

```bash
cd web
bun install               # 或 npm install
bun run db:push           # 初始化 SQLite 数据库
bun run dev               # http://localhost:3000
```

技术栈：Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma (SQLite) · html5-qrcode

架构说明：浏览器无法直连 `phoenix.ujing.online`（CORS），因此由 Next.js API Routes 做服务端代理；洗衣机列表存 SQLite（按手机号隔离，跨设备可同步）；JWT 只存浏览器 localStorage。

## App 版运行

```bash
cd app
bun install               # 或 npm install
npx expo start            # 手机装 Expo Go 扫码即可体验
```

技术栈：Expo SDK 53 · React Native 0.79 · expo-camera（扫码） · AsyncStorage · crypto-js（验证码 HMAC 签名）

App 直连 U净 接口（RN 无 CORS 限制），数据全部保存在本机。

### 打包 Android APK

- **CI 自动打包（推荐）**：推送 `v*` tag（如 `git tag v1.0.1 && git push origin v1.0.1`），GitHub Actions 自动构建 release APK 并发布到 [Releases](https://github.com/43aquarius/DUT-Ujing/releases)；也可在 Actions 页手动触发（产物在 Artifacts）。
- **本地打包**：`cd app && npx expo prebuild -p android && cd android && ./gradlew assembleRelease`，产物在 `android/app/build/outputs/apk/release/`，用仓库内 `keys/release.keystore`（alias `ujing`）签名。

签名说明：本项目为个人使用，签名密钥 `app/keys/release.keystore` 随仓库分发（口令见 `app/plugins/withReleaseSigning.js`），保证后续版本可覆盖安装；公开分发请自行更换密钥。

## U净 API 协议（速览）

完整逆向文档见 [`docs/ujing-api.md`](docs/ujing-api.md)，综合了以下 7 个开源项目的成果：

| 接口 | 说明 |
|------|------|
| `POST /api/v1/devices/scanWasherCode` | **核心**：传二维码原文 → `createOrderEnabled` 判空闲/占用 |
| `GET /api/v1/wechat/captcha/create` | 新版验证码（HMAC-SHA256 签名，失败自动降级旧版 `/api/v1/captcha`）|
| `POST /api/v1/login` | 手机号 + 验证码 → JWT |
| `GET /api/v1/app/washer/devices/program/info` | 设备详情（门店/机号/洗衣模式）|

Base URL：`https://phoenix.ujing.online`

## 声明

- 本项目为开源协议学习项目，只读使用官方查询接口，不涉及下单、支付、蓝牙控制。
- 与美的集团、无锡小净共享网络、U净 App 无任何关联，接口著作权归原厂商所有。
- 仅供个人学习使用，请勿高频请求或用于商业用途。
