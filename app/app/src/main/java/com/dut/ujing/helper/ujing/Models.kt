package com.dut.ujing.helper.ujing

import com.dut.ujing.helper.ujing.optFlexibleBool
import com.dut.ujing.helper.ujing.optIntOrNull
import com.dut.ujing.helper.ujing.optLongOrNull
import com.dut.ujing.helper.ujing.optStringOrNull
import org.json.JSONObject

/** 设备类型 id → 名称（ujing-mini 与 liteU 交叉确认的枚举） */
object DeviceTypes {
    fun name(id: Int?, fallback: String? = null): String? = when (id) {
        1 -> "波轮机"
        2 -> "滚筒机"
        3 -> "烘干机"
        4 -> "洗鞋机"
        6 -> "大型烘干机"
        8 -> "波轮机(OTT)"
        9 -> "10kg滚筒机"
        10 -> "9kg烘干机"
        11 -> "6.5kg波轮机"
        12 -> "新10kg滚筒机"
        13 -> "10kg干衣护理机"
        null -> fallback
        else -> fallback ?: "设备#$id"
    }
}

/** 订单状态 → 文案（ujing-mini 实机验证 + liteU 文档） */
object OrderStatus {
    fun name(status: Int?): String = when (status) {
        10 -> "已预约"
        17 -> "支付中"
        20 -> "已支付"
        21 -> "启动中"
        22 -> "筒自洁启动中"
        24 -> "投放洗涤剂中"
        29 -> "订单保护中"
        30 -> "筒自洁中"
        35 -> "筒自洁完成"
        40 -> "运行中"
        50 -> "已完成"
        51 -> "支付超时"
        52 -> "启动失败"
        53 -> "已取消"
        54 -> "超时未启动"
        60, 61 -> "故障中"
        else -> status?.let { "状态#$it" } ?: ""
    }

    /** 仅 30(自洁)/40(运行) 且未暂停时 remainTime 才有效（liteU 实测结论） */
    fun counting(status: Int?): Boolean = status == 30 || status == 40
}

/** 扫码结果（data.result 的强类型视图；raw 保留完整 JSON 用于诊断） */
data class ScanInfo(
    val deviceId: String?,
    val macAddress: String?,
    val deviceTypeId: Int?,
    val deviceTypeName: String?,
    val storeId: String?,
    val storeName: String?,
    val deviceNo: String?,
    val online: Int?,
    val createOrderEnabled: Boolean?,
    val reason: String?,
    val status: Int?,
    val orderId: Long?,
    val raw: JSONObject,
) {
    companion object {
        fun from(result: JSONObject) = ScanInfo(
            deviceId = result.optStringOrNull("deviceId"),
            macAddress = result.optStringOrNull("macAddress"),
            deviceTypeId = result.optIntOrNull("deviceTypeId"),
            deviceTypeName = result.optStringOrNull("deviceTypeName"),
            storeId = result.optStringOrNull("storeId"),
            storeName = result.optStringOrNull("storeName"),
            deviceNo = result.optStringOrNull("deviceNo"),
            online = result.optIntOrNull("online"),
            createOrderEnabled = result.optFlexibleBool("createOrderEnabled"),
            reason = result.optStringOrNull("reason"),
            status = result.optIntOrNull("status"),
            orderId = result.optLongOrNull("orderId"),
            raw = result,
        )
    }
}

/**
 * 友好显示名：「西山1舍-5层 #3」这种给人看的名字。
 * 优先 门店名 + 机号；拿不到时返回 null（调用方自行降级到机身码尾号）。
 */
fun friendlyName(storeName: String?, deviceNo: String?, fallback: String? = null): String? {
    val s = storeName?.trim()?.takeIf { it.isNotBlank() }
    val n = deviceNo?.trim()?.takeIf { it.isNotBlank() }
    return when {
        s != null && n != null -> "$s #$n"
        s != null -> s
        n != null -> "机器 #$n"
        else -> fallback
    }
}

/** 订单信息（running 列表项 / detail 响应共用） */
data class OrderBrief(
    val orderId: Long,
    val deviceId: String?,
    val deviceNo: String?,
    val deviceTypeId: Int?,
    val deviceTypeName: String?,
    val storeName: String?,
    val status: Int?,
    val statusRemark: String?,
    val remainTime: Int?,   // 秒
    val workTime: Int?,     // 分钟（整洗时长）
    val isPauseStatus: Boolean?,
) {
    companion object {
        fun from(o: JSONObject) = OrderBrief(
            orderId = o.optLongOrNull("orderId") ?: 0L,
            deviceId = o.optStringOrNull("deviceId"),
            deviceNo = o.optStringOrNull("deviceNo"),
            deviceTypeId = o.optIntOrNull("deviceTypeId"),
            deviceTypeName = o.optStringOrNull("deviceTypeName"),
            storeName = o.optStringOrNull("storeName"),
            status = o.optIntOrNull("status"),
            statusRemark = o.optStringOrNull("statusRemark"),
            remainTime = o.optIntOrNull("remainTime"),
            workTime = o.optIntOrNull("workTime"),
            isPauseStatus = o.optFlexibleBool("isPauseStatus"),
        )
    }

    /** 预计结束时刻（epoch ms）；仅倒计时状态且 remainTime>0 有效 */
    fun endAt(now: Long): Long? =
        if (remainTime != null && remainTime > 0 && OrderStatus.counting(status)) now + remainTime * 1000L
        else null

    /** 该订单在 UI 上展示的名字（「我的订单」视图用） */
    fun title(): String =
        friendlyName(storeName, deviceNo)
            ?: deviceTypeName?.takeIf { it.isNotBlank() }
            ?: "订单 #$orderId"
}

/** 卡片 UI 状态 */
enum class UiStatus { CHECKING, FREE, BUSY, UNAVAILABLE, ERROR, UNKNOWN }

/** 单台设备的实时解析结果（由 [StatusResolver] 输出） */
data class DeviceLive(
    val status: UiStatus,
    val label: String,      // 主状态文案
    val detail: String?,    // 副文案（服务端 message / statusRemark / 剩余时间）
    val remainSec: Int?,    // checkedAt 时刻的剩余秒数
    val endAt: Long?,       // 预计结束时刻 epoch ms
    val checkedAt: Long,
    val scanInfo: ScanInfo?,
)

/**
 * 状态判定核心（v2 修复点）：
 *
 * 1. 扫码接口本身报错（code!=0）→ ERROR，label = 服务端 message 原文
 *    （例：非营业时间服务端返回「当前不在服务时间段…」，v1 只显示「查询失败」）
 * 2. createOrderEnabled=true → FREE 空闲可用
 * 3. createOrderEnabled=false → 按 reason 细分：
 *    - 「他人使用中/运行中」类 → BUSY（红）
 *    - 其他（不在工作时间/离线/维护…）→ UNAVAILABLE（橙），文案=reason 原文
 *    - 有 orderId 时尽力拉订单详情取 statusRemark + remainTime（他人订单可能被拒，静默降级）
 */
object StatusResolver {

    private val BUSY_KEYWORDS = listOf("使用", "占用", "运行", "工作", "自洁", "清洗", "洗涤", "他人", "有人")

    fun resolve(
        scan: ScanInfo?,
        scanError: UjingApiException?,
        ownOrder: OrderBrief?,       // 来自 orders/running 且与该设备匹配（自己的订单，最权威）
        detailOrder: OrderBrief?,    // 来自扫到的 orderId 详情（可能是他人订单，尽力而为）
        now: Long,
    ): DeviceLive {
        // 1) 接口层失败 → 服务端原文透出（关键修复）
        if (scanError != null) {
            val msg = scanError.message ?: "查询失败"
            return DeviceLive(UiStatus.ERROR, msg, "code=${scanError.code}", null, null, now, null)
        }
        val s = scan ?: return DeviceLive(UiStatus.UNKNOWN, "未知状态", null, null, null, now, null)

        // 2) 空闲
        if (s.createOrderEnabled == true) {
            return DeviceLive(UiStatus.FREE, "空闲可用", null, null, null, now, s)
        }

        // 3) 不可下单：优先自己的运行订单（可拿到权威剩余时间）
        val order = ownOrder ?: detailOrder
        val reason = s.reason?.takeIf { it.isNotBlank() }
        val remain = order?.remainTime?.takeIf { it > 0 && OrderStatus.counting(order.status) }
        val endAt = order?.endAt(now)

        val hasActiveOrder = order != null && order.status in setOf(21, 22, 24, 30, 40)
        val busyLike = hasActiveOrder || (orderIdPositive(s)) || reason?.let { r -> BUSY_KEYWORDS.any { r.contains(it) } } == true

        return if (busyLike) {
            val label = order?.statusRemark?.takeIf { it.isNotBlank() }
                ?: reason
                ?: "占用中"
            DeviceLive(UiStatus.BUSY, label, detailOf(order, reason), remain, endAt, now, s)
        } else {
            DeviceLive(UiStatus.UNAVAILABLE, reason ?: "当前不可用", detailOf(order, reason), remain, endAt, now, s)
        }
    }

    private fun orderIdPositive(s: ScanInfo): Boolean = (s.orderId ?: 0L) > 0L

    /** 副文案：状态机译名 / 模式时长 */
    private fun detailOf(order: OrderBrief?, reason: String?): String? {
        val parts = mutableListOf<String>()
        order?.status?.let { OrderStatus.name(it).takeIf { it.isNotBlank() && order.statusRemark == null }?.let { n -> parts.add(n) } }
        order?.workTime?.takeIf { it > 0 }?.let { parts.add("整程约${it}分钟") }
        return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
    }

    /** 剩余时间文案：如「剩余约 26 分钟」 */
    fun remainText(remainSec: Int?): String? {
        val sec = remainSec ?: return null
        if (sec <= 0) return "即将结束"
        val min = sec / 60
        return if (min <= 0) "剩余不足 1 分钟" else "剩余约 $min 分钟"
    }
}
