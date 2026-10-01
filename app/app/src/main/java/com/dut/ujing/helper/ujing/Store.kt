package com.dut.ujing.helper.ujing

import android.content.Context
import com.dut.ujing.helper.ujing.optIntOrNull
import com.dut.ujing.helper.ujing.optLongOrNull
import com.dut.ujing.helper.ujing.optStringOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** 登录会话 */
data class AuthSession(
    val mobile: String,
    val token: String,
    val savedAt: Long,
)

/** 已收藏的洗衣机（本地持久化） */
data class SavedDevice(
    val id: String,
    val name: String,
    val qrCode: String,
    val deviceId: String? = null,
    val deviceNo: String? = null,
    val storeId: String? = null,
    val storeName: String? = null,
    val deviceTypeId: Int? = null,
    val macAddress: String? = null,
    val customName: Boolean = false,   // 用户手动改过名 → 不再自动升级为友好名
    // —— 最近一次查询结果（缓存，离线也可见）——
    val lastStatus: String? = null,   // UiStatus.name
    val lastLabel: String? = null,
    val lastDetail: String? = null,
    val lastRemainSec: Int? = null,
    val lastEndAt: Long? = null,
    val lastCheckedAt: Long? = null,
    val lastOrderId: Long? = null,
    val lastRaw: String? = null,      // 最近一次扫码原始 JSON（诊断用）
    val createdAt: Long = System.currentTimeMillis(),
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id); put("name", name); put("qrCode", qrCode)
        deviceId?.let { put("deviceId", it) }
        deviceNo?.let { put("deviceNo", it) }
        storeId?.let { put("storeId", it) }
        storeName?.let { put("storeName", it) }
        deviceTypeId?.let { put("deviceTypeId", it) }
        macAddress?.let { put("macAddress", it) }
        put("customName", customName)
        lastStatus?.let { put("lastStatus", it) }
        lastLabel?.let { put("lastLabel", it) }
        lastDetail?.let { put("lastDetail", it) }
        lastRemainSec?.let { put("lastRemainSec", it) }
        lastEndAt?.let { put("lastEndAt", it) }
        lastCheckedAt?.let { put("lastCheckedAt", it) }
        lastOrderId?.let { put("lastOrderId", it) }
        lastRaw?.let { put("lastRaw", it) }
        put("createdAt", createdAt)
    }

    companion object {
        fun fromJson(o: JSONObject): SavedDevice? {
            val id = o.optStringOrNull("id") ?: return null
            val qr = o.optStringOrNull("qrCode") ?: return null
            return SavedDevice(
                id = id,
                name = o.optStringOrNull("name") ?: "洗衣机",
                qrCode = qr,
                deviceId = o.optStringOrNull("deviceId"),
                deviceNo = o.optStringOrNull("deviceNo"),
                storeId = o.optStringOrNull("storeId"),
                storeName = o.optStringOrNull("storeName"),
                deviceTypeId = o.optIntOrNull("deviceTypeId"),
                macAddress = o.optStringOrNull("macAddress"),
                customName = o.optBooleanOrNull("customName") ?: false,
                lastStatus = o.optStringOrNull("lastStatus"),
                lastLabel = o.optStringOrNull("lastLabel"),
                lastDetail = o.optStringOrNull("lastDetail"),
                lastRemainSec = o.optIntOrNull("lastRemainSec"),
                lastEndAt = o.optLongOrNull("lastEndAt"),
                lastCheckedAt = o.optLongOrNull("lastCheckedAt"),
                lastOrderId = o.optLongOrNull("lastOrderId"),
                lastRaw = o.optStringOrNull("lastRaw"),
                createdAt = o.optLongOrNull("createdAt") ?: System.currentTimeMillis(),
            )
        }
    }
}

/** 卡片大字展示名：自定义名优先，否则自动友好名（门店 #机号），降级到备注名 */
fun SavedDevice.displayName(): String =
    if (!customName) friendlyName(storeName, deviceNo) ?: name else name

/** 旧版自动名「洗衣机 123456」模式（用于存量数据升级判断） */
fun SavedDevice.isLegacyAutoName(): Boolean =
    !customName && name matches Regex("^洗衣机 \\d{1,8}$")

/** 列表排序模式 */
enum class SortMode(val label: String) {
    ADDED("添加时间"),
    NAME("名称"),
    STATUS("状态（空闲优先）"),
    REMAIN("剩余时间（快洗完优先）"),
    ;

    companion object {
        fun fromName(v: String?): SortMode = entries.firstOrNull { it.name == v } ?: ADDED
    }
}

/** 本地存储（SharedPreferences + JSON，与 v1 数据结构对等） */
object Store {
    private const val PREFS = "dut_ujing_store"
    private const val KEY_SESSION = "session"
    private const val KEY_DEVICES = "devices"
    private const val KEY_AUTO_REFRESH = "auto_refresh"
    private const val KEY_SORT_MODE = "sort_mode"
    private const val KEY_FREE_ONLY = "free_only"

    private const val SESSION_TTL_MS = 7 * 24 * 3600 * 1000L  // 与 v1 一致：7 天后需重新登录

    fun session(ctx: Context): AuthSession? {
        return try {
            val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SESSION, null)
                ?: return null
            val o = JSONObject(raw)
            val token = o.optStringOrNull("token") ?: return null
            val mobile = o.optStringOrNull("mobile") ?: return null
            val savedAt = o.optLongOrNull("savedAt") ?: 0L
            if (System.currentTimeMillis() - savedAt > SESSION_TTL_MS) null
            else AuthSession(mobile, token, savedAt)
        } catch (e: Exception) {
            null
        }
    }

    fun saveSession(ctx: Context, mobile: String, token: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(
                KEY_SESSION,
                JSONObject().put("mobile", mobile).put("token", token)
                    .put("savedAt", System.currentTimeMillis()).toString()
            )
            .apply()
    }

    fun clearSession(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_SESSION).apply()
    }

    fun devices(ctx: Context): MutableList<SavedDevice> {
        return try {
            val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_DEVICES, null)
                ?: return mutableListOf()
            val arr = JSONArray(raw)
            val list = mutableListOf<SavedDevice>()
            for (i in 0 until arr.length()) {
                (arr.opt(i) as? JSONObject)?.let { SavedDevice.fromJson(it) }?.let { list.add(it) }
            }
            list
        } catch (e: Exception) {
            mutableListOf()
        }
    }

    fun saveDevices(ctx: Context, devices: List<SavedDevice>) {
        val arr = JSONArray()
        devices.forEach { arr.put(it.toJson()) }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_DEVICES, arr.toString())
            .apply()
    }

    fun autoRefresh(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_AUTO_REFRESH, false)

    fun setAutoRefresh(ctx: Context, on: Boolean) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_AUTO_REFRESH, on).apply()
    }

    fun sortMode(ctx: Context): SortMode =
        SortMode.fromName(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SORT_MODE, null))

    fun setSortMode(ctx: Context, mode: SortMode) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_SORT_MODE, mode.name).apply()
    }

    fun freeOnly(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_FREE_ONLY, false)

    fun setFreeOnly(ctx: Context, on: Boolean) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_FREE_ONLY, on).apply()
    }

    fun newDeviceId(): String = UUID.randomUUID().toString().substring(0, 8)
}
