package com.dut.ujing.helper.ujing

import org.json.JSONArray
import org.json.JSONObject

/**
 * org.json 防御性取值扩展。
 *
 * U净服务端的同一字段在不同接口/版本下类型不稳定：
 * 数字字段可能返回 "40"（字符串）、40.0（浮点）；
 * 布尔字段可能返回 0/1（参考 ujing-mini 的 FlexibleBool/FlexibleInt 序列化器）。
 */

fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).takeIf { it.isNotBlank() }
}

fun JSONObject.optIntOrNull(key: String): Int? {
    if (!has(key) || isNull(key)) return null
    val v = get(key) ?: return null
    return when (v) {
        is Int -> v
        is Long -> v.toInt()
        is Number -> v.toInt()
        is String -> v.trim().toIntOrNull() ?: v.trim().toDoubleOrNull()?.toInt()
        is Boolean -> if (v) 1 else 0
        else -> null
    }
}

fun JSONObject.optLongOrNull(key: String): Long? {
    if (!has(key) || isNull(key)) return null
    val v = get(key) ?: return null
    return when (v) {
        is Long -> v
        is Int -> v.toLong()
        is Number -> v.toLong()
        is String -> v.trim().toLongOrNull() ?: v.trim().toDoubleOrNull()?.toLong()
        else -> null
    }
}

/** 宽容布尔：true/false/0/1/"true"/null */
fun JSONObject.optFlexibleBool(key: String): Boolean? {
    if (!has(key) || isNull(key)) return null
    val v = get(key) ?: return null
    return when (v) {
        is Boolean -> v
        is Int -> v != 0
        is Long -> v != 0L
        is Number -> v.toDouble() != 0.0
        is String -> when (v.trim().lowercase()) {
            "1", "true" -> true
            "0", "0.0", "", "false", "null" -> false
            else -> v.toDoubleOrNull()?.let { it != 0.0 }
        }
        else -> null
    }
}

/** 严格布尔（存储字段用）：仅接受 JSON true/false */
fun JSONObject.optBooleanOrNull(key: String): Boolean? {
    if (!has(key) || isNull(key)) return null
    return try {
        if (get(key) is Boolean) optBoolean(key) else null
    } catch (e: Exception) {
        null
    }
}

/** 遍历 JSONArray 的下标迭代（空安全） */
inline fun JSONArray.forEachObj(action: (JSONObject) -> Unit) {
    for (i in 0 until length()) {
        (opt(i) as? JSONObject)?.let(action)
    }
}
