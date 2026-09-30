package com.dut.ujing.helper.ujing

import android.util.Base64
import com.dut.ujing.helper.ujing.optStringOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** U净业务异常：code 为服务端 envelope code，message 为服务端原文（直接给用户看） */
class UjingApiException(val code: Int, message: String) : Exception(message)

/**
 * U净 (Ujing) 云端 API 客户端 —— 原生 Kotlin 版
 *
 * 协议逆向来源与交叉验证见仓库 docs/ujing-api.md：
 *  - 验证码/登录：wechat/captcha/create (HMAC-SHA256 签名) + /api/v1/login（web 版已实测）
 *  - 扫码：devices/scanWasherCode（ujing-mini / FlandreSY / Because66666 交叉确认）
 *  - 订单：orders/running、orders/{id}/detail（liteU / ujing-mini 实测，
 *          含 status / statusRemark / remainTime / workTime 字段）
 */
object UjingApi {

    const val BASE = "https://phoenix.ujing.online"

    /** 验证码接口 HMAC 签名密钥（逆向自 U净 App，多开源项目一致；作为原始字符串字节使用） */
    private const val CAPTCHA_HMAC_KEY = "T3pAWrBqKzS2GC7LKQbIDN2xkWEYzTS/nrHdYfbTkHU="

    private const val UA_PHONE = "U jing/2.4.3 (iPhone; iOS 17.3; Scale/3.00)"

    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    // -------------------------------------------------------------- 请求头

    private fun captchaHeaders(): Map<String, String> = mapOf(
        "x-app-code" to "BO",
        "x-app-version" to "1.1.0",
        "User-Agent" to UA_PHONE,
        "x-mobile-brand" to "apple",
        "x-mobile-model" to "iPhone14,5",
        "x-user-geo" to "-180.000000,-180.000000",
    )

    private fun bizHeaders(token: String): Map<String, String> = mapOf(
        "x-app-code" to "BA",
        "x-app-version" to "2.4.8",
        "weex-version" to "1.1.68",
        "User-Agent" to UA_PHONE,
        "x-mobile-brand" to "apple",
        "x-mobile-model" to "iPhone14,5",
        "Content-Type" to "application/json; charset=utf-8",
        "Authorization" to "Bearer $token",
    )

    // -------------------------------------------------------------- 核心

    /**
     * 通用请求。
     *
     * 成功（code==0 或 200）返回完整 envelope；
     * 失败抛 [UjingApiException]，message 保留服务端原文
     * （例如非营业时间扫码时服务端会返回人话提示，这是 v2 错误显示的关键）。
     */
    private fun request(
        method: String,
        path: String,
        headers: Map<String, String>,
        query: Map<String, String>? = null,
        body: JSONObject? = null,
    ): JSONObject {
        val url = buildString {
            append(BASE).append(path)
            if (!query.isNullOrEmpty()) {
                append('?')
                append(query.entries.joinToString("&") {
                    "${urlEncode(it.key)}=${urlEncode(it.value)}"
                })
            }
        }

        val builder = Request.Builder().url(url)
        for ((k, v) in headers) builder.header(k, v)

        var bodyStr: String? = null
        if (body != null) {
            bodyStr = body.toString()
            // 兜底：U净网关对 text/plain 会回 {"code":400,"reason":"CODEC",...}（v1 登录 bug 根因）
            if (headers.keys.none { it.equals("Content-Type", ignoreCase = true) }) {
                builder.header("Content-Type", "application/json")
            }
        }

        when (method.uppercase()) {
            "GET" -> builder.get()
            "POST" -> builder.post((bodyStr ?: "{}").toRequestBody(JSON_MEDIA))
            else -> builder.method(method, bodyStr?.toRequestBody(JSON_MEDIA))
        }

        client.newCall(builder.build()).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            val json = try {
                JSONObject(text)
            } catch (e: Exception) {
                throw UjingApiException(resp.code, "U净服务返回了无法解析的响应 (HTTP ${resp.code})")
            }
            val code = json.optInt("code", -1)
            if (code != 0 && code != 200) {
                val msg = json.optStringOrNull("message")
                    ?: json.optStringOrNull("msg")
                    ?: "U净接口错误 (code=$code)"
                throw UjingApiException(code, msg)
            }
            return json
        }
    }

    private fun urlEncode(v: String): String = URLEncoder.encode(v, "UTF-8")

    // -------------------------------------------------------------- 鉴权

    /** 发送短信验证码：新版（HMAC 签名）优先，失败降级旧版 */
    fun sendCaptcha(mobile: String) {
        try {
            val nonce = randomNonce()
            val timestamp = System.currentTimeMillis() / 1000
            val signature = hmacSha256Base64(CAPTCHA_HMAC_KEY, "$nonce$timestamp")
            request(
                "GET", "/api/v1/wechat/captcha/create", captchaHeaders(),
                mapOf(
                    "mobile" to mobile, "type" to "1",
                    "nonce" to nonce, "timestamp" to timestamp.toString(),
                    "signature" to signature,
                )
            )
            return
        } catch (e: Exception) {
            // 降级旧版
        }
        request(
            "GET", "/api/v1/captcha", captchaHeaders(),
            mapOf(
                "mobile" to mobile, "type" to "1",
                "sessionId" to "AFS_SWITCH_OFF",
                "sig" to "AFS_SWITCH_OFF",
                "token" to "AFS_SWITCH_OFF",
            )
        )
    }

    /** 登录：返回 JWT token */
    fun login(mobile: String, captcha: String): String {
        val json = request(
            "POST", "/api/v1/login",
            captchaHeaders() + ("Content-Type" to "application/json"),
            body = JSONObject().put("mobile", mobile).put("captcha", captcha)
        )
        val token = json.optJSONObject("data")?.optStringOrNull("token")
        if (token.isNullOrBlank()) throw UjingApiException(0, "登录成功但响应缺少 token")
        return token
    }

    // -------------------------------------------------------------- 设备

    /**
     * 扫码查询洗衣机状态（核心接口）。
     * 返回 data.result 的原始 JSON（保留全部字段，未识别字段用于「原始数据」诊断视图）。
     */
    fun scanWasherCode(token: String, qrCode: String): JSONObject {
        val json = request(
            "POST", "/api/v1/devices/scanWasherCode", bizHeaders(token),
            body = JSONObject().put("qrCode", qrCode)
        )
        val result = json.optJSONObject("data")?.optJSONObject("result")
            ?: throw UjingApiException(0, "扫码响应缺少 result 字段")
        return result
    }

    /** 设备程序详情（storeId/storeName/deviceNo/机型/价目表）。失败返回 null（辅助接口） */
    fun programInfo(token: String, deviceId: String): JSONObject? = try {
        request(
            "GET", "/api/v1/app/washer/devices/program/info", bizHeaders(token),
            mapOf("deviceId" to deviceId)
        ).optJSONObject("data")
    } catch (e: Exception) {
        null
    }

    // -------------------------------------------------------------- 订单

    /** 我正在进行的订单列表（用于给「自己正在洗的那台」显示剩余时间）。失败静默返回空 */
    fun runningOrders(token: String): List<JSONObject> {
        return try {
            val json = request("GET", "/api/v1/orders/running", bizHeaders(token))
            val arr = json.optJSONArray("data")
                ?: json.optJSONObject("data")?.optJSONArray("orders")
                ?: JSONArray()
            buildList {
                for (i in 0 until arr.length()) {
                    (arr.opt(i) as? JSONObject)?.let { add(it) }
                }
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    /**
     * 订单详情（status / statusRemark / remainTime 秒 / workTime 分钟）。
     * 扫占用中的机器拿到的 orderId 可能属于他人，服务端可能拒绝 → 失败返回 null（尽力而为）。
     */
    fun orderDetail(token: String, orderId: Long): JSONObject? = try {
        request(
            "GET", "/api/v1/orders/$orderId/detail", bizHeaders(token),
            mapOf("additional" to "price")
        ).optJSONObject("data")
    } catch (e: Exception) {
        null
    }

    // -------------------------------------------------------------- 工具

    /** base64(HMAC-SHA256(key 原始字符串字节, data))——与 web 版 crypto-js 及 Huoyuuu/python 实现一致 */
    private fun hmacSha256Base64(keyStr: String, data: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(keyStr.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return Base64.encodeToString(mac.doFinal(data.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    private fun randomNonce(): String {
        val chars = "0123456789abcdef"
        val sb = StringBuilder(32)
        repeat(32) { sb.append(chars[(Math.random() * 16).toInt()]) }
        return sb.toString()
    }

    /** 校验二维码是否为 U净洗衣机码（两种已知格式） */
    fun isUjingQrCode(text: String): Boolean {
        val t = text.trim()
        return Regex("^https?://q\\.ujing\\.com\\.cn/ucqrc/index\\.html\\?cd=\\d+", RegexOption.IGNORE_CASE).containsMatchIn(t) ||
            Regex("^https?://app\\.littleswan\\.com/u_download\\.html\\?", RegexOption.IGNORE_CASE).containsMatchIn(t)
    }
}
