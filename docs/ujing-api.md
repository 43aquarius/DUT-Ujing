# U净 (Ujing) 云端 API 协议文档

> 本文档由对以下 7 个开源项目的逆向成果交叉比对、实测验证整理而成，作为 [DUT-Ujing](../README.md) 项目的协议依据。
>
> 实测时间：2026-09-30，接口均可达。

## 协议来源与交叉验证

| 项目 | 贡献 | 可信度 |
|------|------|--------|
| [baijuqi/ujing-mini](https://github.com/baijuqi/ujing-mini) | 完整协议逆向报告（APK 静态逆向 + 实机端到端验证），包含 BLE 协议、错误码、枚举表 | ⭐⭐⭐ 最完整 |
| [funcfang/U-Clean-Reserve](https://github.com/funcfang/U-Clean-Reserve) | 登录链路 + `scanWasherCode` 状态轮询 + 预约下单 | ⭐⭐⭐ |
| [Because66666/Public-washing-machine-query-device](https://github.com/Because66666/Public-washing-machine-query-device) | `scanWasherCode` + `createOrderEnabled` 判定占用 | ⭐⭐⭐ |
| [Huoyuuu/ujing-laundry](https://github.com/Huoyuuu/ujing-laundry) | 新版验证码接口 `wechat/captcha/create`（HMAC-SHA256 签名）+ 门店/设备查询 | ⭐⭐ |
| [jalenzz/liteU](https://github.com/jalenzz/liteU) | 新版签名实现细节 + `stores/near` + 订单接口 | ⭐⭐ |
| [amamiyakazuki/FlandreSY](https://github.com/amamiyakazuki/FlandreSY) | `scanWasherCode` 响应字段（`reason` / `status`）+ 下单链路 | ⭐⭐ |
| [abcde2333/NcepuJw](https://github.com/abcde2333/NcepuJw) | 校园 App 集成案例（华电教务 App 内置 U净模块） | ⭐ |

## 基础信息

- **Base URL**: `https://phoenix.ujing.online`（HTTPS / JSON）
- **响应包裹**: `{"code": 0, "message": "...", "data": {...}}`
  - `code === 0` 成功
  - `code === 401` token 失效（需重新登录）
  - 其余为业务错误码（如 `1012` 验证码发送太频繁、`1103` 验证码请求失败）
- **运营商**: 美的 / 无锡小净共享网络（校园共享洗衣）

## 请求头（按场景分三组）

| 组 | 场景 | Header |
|----|------|--------|
| **验证码/登录** | 获取验证码、登录 | `x-app-code: BO`、`x-app-version: 1.1.0`（新签名接口）<br>或 `x-app-code: ZA / ZI`（旧接口）|
| **业务请求** | 扫码/设备/订单 | `x-app-code: BA`、`x-app-version: 2.4.8`、`weex-version: 1.1.68`、`Authorization: Bearer {token}` |
| **门店查询** | stores/near、devices/reserve | `x-app-code: ZA`、`x-app-version: 2.4.18`、`Authorization: Bearer {token}` |

可选 UA 伪装：`User-Agent: U jing/2.4.3 (iPhone; iOS 17.3; Scale/3.00)`、`x-mobile-brand: apple`、`x-mobile-model: iPhone14,5`

## 鉴权链路

### 1. 发送短信验证码（两种方式）

**新版（推荐，带 HMAC 签名）**：

```
GET /api/v1/wechat/captcha/create
    ?mobile={手机号}
    &type=1
    &nonce={32位随机hex}
    &timestamp={秒级时间戳}
    &signature={签名}
Header: x-app-code: BO, x-app-version: 1.1.0
```

签名算法（liteU 与 ujing-laundry 实现一致）：

```text
key       = "T3pAWrBqKzS2GC7LKQbIDN2xkWEYzTS/nrHdYfbTkHU="   (字符串原样作 key，UTF-8 字节)
message   = f"{nonce}{timestamp}"
signature = Base64( HMAC-SHA256(key, message) )
```

**旧版（降级方案，无需签名）**：

```
GET /api/v1/captcha
    ?mobile={手机号}
    &sessionId=AFS_SWITCH_OFF
    &sig=AFS_SWITCH_OFF
    &token=AFS_SWITCH_OFF
    &type=1
Header: x-app-code: ZA
```

> 本项目实测（2026-09-30）：两个端点均可达。实现上采用新版优先、失败自动降级旧版。

### 2. 登录

```
POST /api/v1/login
Body: {"mobile": "13800138000", "captcha": "123456"}
→ data.token (JWT)          // Bearer token
→ data.userId, data.serviceSubjectId
```

## 核心接口：扫码查询洗衣机状态

```
POST /api/v1/devices/scanWasherCode
Header: Authorization: Bearer {token}, x-app-code: BA
Body: {"qrCode": "<二维码原文>"}
```

**二维码两种已知格式**：

- `https://q.ujing.com.cn/ucqrc/index.html?cd=755501240130321074`（主流）
- `http://app.littleswan.com/u_download.html?type=Ujing&uuid=...`（小天鹅机型）

**响应**（`data.result`）：

```json
{
  "deviceId": "665f2b1c8a9d3e0012abc555",
  "deviceTypeId": 2,
  "deviceTypeName": "滚筒洗衣机",
  "deviceNo": "12",
  "storeId": "...",
  "storeName": "...",
  "macAddress": "AABBCCDDEEFF",
  "online": 1,
  "createOrderEnabled": true,
  "reason": "",
  "status": ""
}
```

| 字段 | 说明 |
|------|------|
| `createOrderEnabled` | **true = 空闲可用；false = 占用中**（本项目判定占用的核心依据）|
| `reason` | 不可下单原因（占用时返回，如"设备使用中"）|
| `deviceId` | 平台设备 ObjectId（注意：BLE 上报时也必须用它，填 MAC 会报 1603）|
| `online` | 0 离线 / 1 在线 |

## 其他接口（本项目备而未用）

| 用途 | 方法 | 路径 | 参数 |
|------|------|------|------|
| 设备程序详情 | GET | `/api/v1/app/washer/devices/program/info` | `deviceId`（本项目用于补全门店名/机号）|
| 设备详情 | GET | `/api/v1/devices/{id}` | — |
| 门店信息 | GET | `/api/v1/app/washer/store/info` | `storeId` |
| 排队时长 | GET | `/api/v1/app/washer/store/waitTime` | `storeId`, `deviceTypeId` |
| 预约设备列表 | GET | `/api/v1/devices/reserve` | `storeId` → `devices[].device.{free,total,waitTime}` |
| 附近门店 | GET | `/api/v1/stores/near` | `lat,lont,scope,page,size,mode=BA` |
| 运行中订单 | GET | `/api/v1/orders/running` | — |
| 历史订单 | GET | `/api/v1/orders/history` | `page,size` |
| 订单详情 | GET | `/api/v1/orders/{orderId}/detail` | `additional=price`（含 `remainTime` 剩余分钟）|
| 创建订单 | POST | `/api/v1/orders/create` | 见下方 |
| 取消订单 | POST | `/api/v1/orders/{orderId}/cancel` | `{"orderId":"..."}` |

### 创建订单 Body（仅供了解，本项目不提供下单功能）

```json
{
  "type": 1,
  "deviceTypeId": 2,
  "deviceId": "<设备ID>",
  "deviceWashModelId": "<program/info 返回的 workModelId，服务端动态下发，勿硬编码>",
  "storeId": "<门店ID>",
  "washTemperatureId": 1,
  "wp_detergentGearId": 1,
  "wp_disinfectantGearId": 4,
  "dryTime": 3
}
```

### 订单状态枚举（ujing-mini 实测整理）

```
RESERVED=10  PAYING=17  PAID=20  STARTING=21  RUNNING=40  COMPLETED=50
PAYMENT_TIMEOUT=51  START_FAILED=52  CANCELED=53
```

### 设备类型枚举

```
1=波轮  2=滚筒  3=烘干机  4=洗鞋机  9=滚筒10KG  10=烘干9KG  13=烘干10KG …
```

## BLE 蓝牙协议（摘录）

洗衣机启动链路依赖服务端签发指令帧（`POST /api/v1/ble/command/acquire`），客户端只是 BLE 透传管道；纯离线开锁不可行。完整 GATT 定义、Cypress/Nordic 两种通道、ACK 帧格式见 [baijuqi/ujing-mini 的逆向报告](https://github.com/baijuqi/ujing-mini/blob/main/docs/U%E5%87%80%E5%8D%8F%E8%AE%AE%E9%80%86%E5%90%91%E6%8A%A5%E5%91%8A.md) §3-§10。

## 安全与合规提示

- 本项目只读使用官方查询接口（验证码 / 登录 / 扫码查状态 / 程序详情），**不涉及下单、支付、蓝牙控制**。
- 请勿高频轮询（自动刷新间隔 30s 起步），避免触发风控或影响他人使用。
- 仅供个人学习研究，请于 24 小时内删除并支持官方 App。与美的集团、无锡小净共享网络无任何关联。
