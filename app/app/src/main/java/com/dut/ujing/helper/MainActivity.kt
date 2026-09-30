package com.dut.ujing.helper

import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.dut.ujing.helper.databinding.ActivityMainBinding
import com.dut.ujing.helper.ujing.AuthSession
import com.dut.ujing.helper.ujing.DeviceTypes
import com.dut.ujing.helper.ujing.DeviceLive
import com.dut.ujing.helper.ujing.OrderBrief
import com.dut.ujing.helper.ujing.ScanInfo
import com.dut.ujing.helper.ujing.SavedDevice
import com.dut.ujing.helper.ujing.StatusResolver
import com.dut.ujing.helper.ujing.Store
import com.dut.ujing.helper.ujing.UjingApi
import com.dut.ujing.helper.ujing.UjingApiException
import com.dut.ujing.helper.ujing.UiStatus
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * 主面板：已收藏洗衣机列表 + 实时占用状态。
 *
 * v2 关键改进：
 *  - 服务端错误原文透出（非营业时间扫码不再只显示「查询失败」）
 *  - 占用中设备显示剩余时间/预计结束时刻（自己订单权威 + 扫码 orderId 尽力而为）
 *  - 机型名称（波轮/滚筒/烘干/洗鞋）与门店信息展示
 */
class MainActivity : AppCompatActivity() {

    companion object {
        fun start(ctx: Context, clearStack: Boolean = false) {
            val intent = Intent(ctx, MainActivity::class.java)
            if (clearStack) intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            ctx.startActivity(intent)
        }
    }

    private lateinit var b: ActivityMainBinding
    private lateinit var adapter: DeviceAdapter
    private var devices: MutableList<SavedDevice> = mutableListOf()
    private var session: AuthSession? = null
    private var refreshing = false

    private val mainHandler = Handler(Looper.getMainLooper())

    /** 30 秒自动刷新循环 */
    private val autoRunnable = object : Runnable {
        override fun run() {
            refreshAll()
            mainHandler.postDelayed(this, 30_000)
        }
    }

    /** 1 秒 UI tick：只刷新可见卡片的倒计时行 */
    private val tickRunnable = object : Runnable {
        override fun run() {
            for (i in 0 until b.recycler.childCount) {
                (b.recycler.getChildViewHolder(b.recycler.getChildAt(i)) as? DeviceAdapter.VH)
                    ?.updateCountdown()
            }
            mainHandler.postDelayed(this, 1_000)
        }
    }

    private val scanLauncher = registerForActivityResult(ScanContract()) { result ->
        result.contents?.let { handleQr(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)

        session = Store.session(this)
        if (session == null) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        adapter = DeviceAdapter(
            onRefresh = { refreshOneUi(it) },
            onMenu = { showDeviceMenu(it) },
            onRaw = { showRawDialog(it) },
        )
        b.recycler.layoutManager = LinearLayoutManager(this)
        b.recycler.adapter = adapter

        b.swipe.setOnRefreshListener { refreshAll() }
        b.btnScan.setOnClickListener { launchScanner() }
        b.btnEmptyAdd.setOnClickListener { launchScanner() }
        b.btnManual.setOnClickListener { showManualAddDialog() }
        b.btnLogout.setOnClickListener { confirmLogout() }

        b.switchAuto.isChecked = Store.autoRefresh(this)
        b.switchAuto.setOnCheckedChangeListener { _, checked ->
            Store.setAutoRefresh(this, checked)
            if (checked) mainHandler.postDelayed(autoRunnable, 30_000) else mainHandler.removeCallbacks(autoRunnable)
        }

        reload()
        refreshAll()
    }

    override fun onResume() {
        super.onResume()
        mainHandler.post(tickRunnable)
    }

    override fun onPause() {
        mainHandler.removeCallbacks(tickRunnable)
        super.onPause()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(autoRunnable)
        mainHandler.removeCallbacks(tickRunnable)
        super.onDestroy()
    }

    // ------------------------------------------------------------ 数据

    private fun reload() {
        devices = Store.devices(this)
        adapter.submit(devices.toList())
        updateEmpty()
        updateSubtitle()
    }

    private fun updateEmpty() {
        b.empty.isVisible = devices.isEmpty()
    }

    private fun updateSubtitle() {
        val s = session ?: return
        if (devices.isEmpty()) {
            b.tvSub.text = s.mobile.replace(Regex("(\\d{3})\\d{4}(\\d{4})"), "$1****$2")
        } else {
            val free = devices.count { it.lastStatus == UiStatus.FREE.name }
            b.tvSub.text = "${devices.size} 台 · ${free} 台空闲"
        }
    }

    private fun persist() = Store.saveDevices(this, devices)

    // ------------------------------------------------------------ 刷新

    private fun refreshAll() {
        val token = session?.token ?: return
        if (refreshing) {
            b.swipe.isRefreshing = false
            return
        }
        if (devices.isEmpty()) {
            b.swipe.isRefreshing = false
            updateEmpty()
            return
        }
        refreshing = true
        b.swipe.isRefreshing = true
        lifecycleScope.launch {
            // 自己运行中的订单：剩余时间的权威来源
            val ownOrders = withContext(Dispatchers.IO) {
                runCatching { UjingApi.runningOrders(token).map { OrderBrief.from(it) } }
                    .getOrDefault(emptyList())
            }
            // 逐台串行刷新，避免并发轰炸服务端
            for (d in devices.toList()) {
                refreshOneInternal(d, ownOrders)
            }
            refreshing = false
            b.swipe.isRefreshing = false
            updateEmpty()
        }
    }

    private fun refreshOneUi(d: SavedDevice) {
        val token = session?.token ?: return
        lifecycleScope.launch {
            val own = withContext(Dispatchers.IO) {
                runCatching { UjingApi.runningOrders(token).map { OrderBrief.from(it) } }
                    .getOrDefault(emptyList())
            }
            refreshOneInternal(d, own)
        }
    }

    private suspend fun refreshOneInternal(d: SavedDevice, ownOrders: List<OrderBrief>) {
        val token = session?.token ?: return
        val now = System.currentTimeMillis()
        markChecking(d)
        try {
            val raw = withContext(Dispatchers.IO) { UjingApi.scanWasherCode(token, d.qrCode) }
            val scan = ScanInfo.from(raw)
            val own = ownOrders.matchDevice(d)
            // 扫到 orderId（占用中）时尽力拉订单详情；他人订单可能被服务端拒绝 → null 降级
            val detail = if ((scan.orderId ?: 0L) > 0L) {
                withContext(Dispatchers.IO) {
                    runCatching { UjingApi.orderDetail(token, scan.orderId!!) }.getOrNull()
                }?.let { OrderBrief.from(it) }
            } else null
            val live = StatusResolver.resolve(scan, null, own, detail, now)
            applyLive(d, live, scan)
        } catch (e: UjingApiException) {
            if (e.code == 401) {
                onTokenExpired()
                return
            }
            applyLive(d, StatusResolver.resolve(null, e, null, null, now), null)
        } catch (e: Exception) {
            applyLive(
                d,
                DeviceLive(UiStatus.ERROR, e.message ?: "网络错误，请检查网络后重试", null, null, null, now, null),
                null
            )
        }
    }

    private fun markChecking(d: SavedDevice) {
        val idx = devices.indexOfFirst { it.id == d.id }
        if (idx < 0) return
        devices[idx] = devices[idx].copy(lastStatus = UiStatus.CHECKING.name, lastLabel = "查询中…")
        adapter.updateDevice(devices[idx])
    }

    private fun applyLive(d: SavedDevice, live: DeviceLive, scan: ScanInfo?) {
        val idx = devices.indexOfFirst { it.id == d.id }
        if (idx < 0) return
        val old = devices[idx]
        val updated = old.copy(
            deviceId = scan?.deviceId ?: old.deviceId,
            deviceTypeId = scan?.deviceTypeId ?: old.deviceTypeId,
            macAddress = scan?.macAddress ?: old.macAddress,
            lastOrderId = scan?.orderId ?: old.lastOrderId,
            lastStatus = live.status.name,
            lastLabel = live.label,
            lastDetail = live.detail,
            lastRemainSec = live.remainSec,
            lastEndAt = live.endAt,
            lastCheckedAt = live.checkedAt,
            lastRaw = scan?.raw?.toString() ?: old.lastRaw,
        )
        devices[idx] = updated
        persist()
        adapter.updateDevice(updated)
        updateSubtitle()
    }

    /** 订单与已收藏设备匹配（deviceId 优先，deviceNo 兜底） */
    private fun List<OrderBrief>.matchDevice(d: SavedDevice): OrderBrief? = firstOrNull {
        (it.deviceId != null && it.deviceId == d.deviceId) ||
            (it.deviceNo != null && it.deviceNo == d.deviceNo)
    }

    // ------------------------------------------------------------ 扫码 / 手动添加

    private fun launchScanner() {
        val options = ScanOptions().apply {
            setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            setPrompt("将洗衣机机身上的二维码对准取景框")
            setBeepEnabled(false)
            setOrientationLocked(true)
        }
        scanLauncher.launch(options)
    }

    private fun handleQr(qr: String) {
        val content = qr.trim()
        if (!UjingApi.isUjingQrCode(content)) {
            MaterialAlertDialogBuilder(this)
                .setTitle("不是 U净洗衣机二维码")
                .setMessage("识别到的内容：\n\n$content\n\n仅支持 q.ujing.com.cn 或 app.littleswan.com 的设备码，也可以用「手动输入」粘贴完整二维码内容。")
                .setPositiveButton(R.string.confirm, null)
                .show()
            return
        }
        addDevice(content)
    }

    private fun addDevice(qrCode: String) {
        val token = session?.token ?: return
        val progress = MaterialAlertDialogBuilder(this)
            .setTitle("正在获取设备信息…")
            .setView(ProgressBar(this).apply {
                isIndeterminate = true
                val pad = (16 * resources.displayMetrics.density).toInt()
                setPadding(pad, pad, pad, pad)
            })
            .setCancelable(false)
            .create()
        progress.show()

        lifecycleScope.launch {
            var scan: ScanInfo? = null
            var program: JSONObject? = null
            var error: UjingApiException? = null
            try {
                val raw = withContext(Dispatchers.IO) { UjingApi.scanWasherCode(token, qrCode) }
                scan = ScanInfo.from(raw)
                scan.deviceId?.let { did ->
                    program = withContext(Dispatchers.IO) {
                        runCatching { UjingApi.programInfo(token, did) }.getOrNull()
                    }
                }
            } catch (e: UjingApiException) {
                error = e
            } catch (e: Exception) {
                error = UjingApiException(0, e.message ?: "网络错误")
            }

            progress.dismiss()
            if (error?.code == 401) {
                onTokenExpired()
                return@launch
            }

            if (error != null) {
                // v2 修复：服务端消息原样展示（如「不在工作时间」），并提供「仍然收藏」选项
                MaterialAlertDialogBuilder(this@MainActivity)
                    .setTitle("暂时无法查询这台设备")
                    .setMessage("U净服务端返回：\n\n${error?.message}\n\n可以先收藏这台设备，等它恢复可用后再刷新状态。")
                    .setPositiveButton("仍然收藏") { _, _ ->
                        saveDevice(qrCode, null, null, error?.message)
                        toast("已收藏")
                        refreshAll()
                    }
                    .setNegativeButton(R.string.cancel, null)
                    .show()
                return@launch
            }

            saveDevice(qrCode, scan, program, null)
            toast("已收藏")
            refreshAll()
        }
    }

    /** 保存/合并设备（扫码或手动输入） */
    private fun saveDevice(qrCode: String, scan: ScanInfo?, program: JSONObject?, errMsg: String?) {
        val list = Store.devices(this).toMutableList()
        val idx = list.indexOfFirst { it.qrCode == qrCode }
        val now = System.currentTimeMillis()

        val programTypeName = program?.optString("deviceTypeName")?.takeIf { it.isNotBlank() }
        val typeNameFallback = scan?.let { DeviceTypes.name(it.deviceTypeId, programTypeName) } ?: programTypeName

        val liveStatus = when {
            scan?.createOrderEnabled == true -> UiStatus.FREE
            scan != null -> if ((scan.orderId ?: 0L) > 0L) UiStatus.BUSY else UiStatus.UNAVAILABLE
            errMsg != null -> UiStatus.ERROR
            else -> UiStatus.UNKNOWN
        }
        val liveLabel = when {
            scan?.createOrderEnabled == true -> "空闲可用"
            scan != null -> scan.reason?.takeIf { it.isNotBlank() }
                ?: if ((scan.orderId ?: 0L) > 0L) "占用中" else "当前不可用"
            errMsg != null -> errMsg
            else -> "未知状态"
        }

        if (idx >= 0) {
            val old = list[idx]
            list[idx] = old.copy(
                deviceId = scan?.deviceId ?: program?.optString("deviceId")?.takeIf { it.isNotBlank() } ?: old.deviceId,
                deviceNo = program?.optString("deviceNo")?.takeIf { it.isNotBlank() } ?: old.deviceNo,
                storeId = program?.optString("storeId")?.takeIf { it.isNotBlank() } ?: old.storeId,
                storeName = program?.optString("storeName")?.takeIf { it.isNotBlank() } ?: old.storeName,
                deviceTypeId = scan?.deviceTypeId ?: old.deviceTypeId,
                macAddress = scan?.macAddress ?: old.macAddress,
                lastStatus = liveStatus.name,
                lastLabel = liveLabel,
                lastDetail = typeNameFallback?.let { "机型：$it" },
                lastOrderId = scan?.orderId,
                lastCheckedAt = now,
                lastRaw = scan?.raw?.toString() ?: old.lastRaw,
            )
        } else {
            list.add(
                SavedDevice(
                    id = Store.newDeviceId(),
                    name = "洗衣机 ${qrCode.takeLast(6)}",
                    qrCode = qrCode,
                    deviceId = scan?.deviceId ?: program?.optString("deviceId")?.takeIf { it.isNotBlank() },
                    deviceNo = program?.optString("deviceNo")?.takeIf { it.isNotBlank() },
                    storeId = program?.optString("storeId")?.takeIf { it.isNotBlank() },
                    storeName = program?.optString("storeName")?.takeIf { it.isNotBlank() },
                    deviceTypeId = scan?.deviceTypeId,
                    macAddress = scan?.macAddress,
                    lastStatus = liveStatus.name,
                    lastLabel = liveLabel,
                    lastDetail = typeNameFallback?.let { "机型：$it" },
                    lastCheckedAt = now,
                    lastOrderId = scan?.orderId,
                    lastRaw = scan?.raw?.toString(),
                    createdAt = now,
                )
            )
        }
        Store.saveDevices(this, list)
        reload()
    }

    // ------------------------------------------------------------ 对话框

    private fun showDeviceMenu(d: SavedDevice) {
        val items = arrayOf(getString(R.string.refresh), getString(R.string.rename), getString(R.string.raw_data), getString(R.string.delete))
        MaterialAlertDialogBuilder(this)
            .setTitle(d.name)
            .setItems(items) { _, which ->
                when (which) {
                    0 -> refreshOneUi(d)
                    1 -> showRenameDialog(d)
                    2 -> showRawDialog(d)
                    3 -> confirmDelete(d)
                }
            }
            .show()
    }

    private fun showRenameDialog(d: SavedDevice) {
        val input = EditText(this).apply {
            setText(d.name)
            setSelection(text.length)
            filters = arrayOf(android.text.InputFilter.LengthFilter(30))
        }
        val pad = (20 * resources.displayMetrics.density).toInt()
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.rename)
            .setView(input.apply { setPadding(pad, pad / 2, pad, 0) })
            .setPositiveButton(R.string.save) { _, _ ->
                val name = input.text.toString().trim()
                if (name.isNotEmpty()) {
                    val idx = devices.indexOfFirst { it.id == d.id }
                    if (idx >= 0) {
                        devices[idx] = devices[idx].copy(name = name)
                        persist()
                        adapter.submit(devices.toList())
                    }
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun confirmDelete(d: SavedDevice) {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.delete)
            .setMessage("确定删除「${d.name}」吗？")
            .setPositiveButton(R.string.delete) { _, _ ->
                devices = devices.filterNot { it.id == d.id }.toMutableList()
                persist()
                adapter.removeDevice(d.id)
                updateEmpty()
                updateSubtitle()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    /** 原始扫码 JSON（诊断用：可用于发现服务端新增字段） */
    private fun showRawDialog(d: SavedDevice) {
        val raw = d.lastRaw
        val pretty = if (raw.isNullOrBlank()) {
            "暂无数据。刷新一次状态后即可查看服务端返回的完整字段。"
        } else {
            try {
                JSONObject(raw).toString(2)
            } catch (e: Exception) {
                raw
            }
        }
        val padPx = (12 * resources.displayMetrics.density).toInt()
        val tv = TextView(this).apply {
            text = pretty
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
            setPadding(padPx, padPx, padPx, padPx)
        }
        val scroll = ScrollView(this).apply {
            val pad = (18 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, pad / 2)
            addView(tv)
        }
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.raw_data)
            .setView(scroll)
            .setPositiveButton(R.string.confirm, null)
            .show()
    }

    private fun showManualAddDialog() {
        val input = EditText(this).apply {
            hint = "粘贴完整二维码内容"
            setText("https://q.ujing.com.cn/ucqrc/index.html?cd=")
            setSelection(text.length)
            isSingleLine = true
            textSize = 13f
        }
        val pad = (20 * resources.displayMetrics.density).toInt()
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.manual_add)
            .setMessage("无法扫码时，可手动输入/粘贴机身二维码的完整链接内容。")
            .setView(input.apply { setPadding(pad, pad / 2, pad, 0) })
            .setPositiveButton(R.string.confirm) { _, _ ->
                val text = input.text.toString().trim()
                if (text.isNotEmpty()) handleQr(text)
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun confirmLogout() {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.menu_logout)
            .setMessage("退出后需要重新短信验证码登录，收藏的洗衣机会保留。")
            .setPositiveButton(R.string.confirm) { _, _ ->
                Store.clearSession(this)
                startActivity(Intent(this, LoginActivity::class.java))
                finishAffinity()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun onTokenExpired() {
        toast("登录已过期，请重新登录")
        Store.clearSession(this)
        startActivity(Intent(this, LoginActivity::class.java))
        finishAffinity()
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
