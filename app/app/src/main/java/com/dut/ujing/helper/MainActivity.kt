package com.dut.ujing.helper

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.dut.ujing.helper.databinding.ActivityMainBinding
import com.dut.ujing.helper.ujing.AuthSession
import com.dut.ujing.helper.ujing.DeviceTypes
import com.dut.ujing.helper.ujing.DeviceLive
import com.dut.ujing.helper.ujing.OrderBrief
import com.dut.ujing.helper.ujing.OrderStatus
import com.dut.ujing.helper.ujing.ScanInfo
import com.dut.ujing.helper.ujing.SavedDevice
import com.dut.ujing.helper.ujing.SortMode
import com.dut.ujing.helper.ujing.StatusResolver
import com.dut.ujing.helper.ujing.Store
import com.dut.ujing.helper.ujing.UjingApi
import com.dut.ujing.helper.ujing.UjingApiException
import com.dut.ujing.helper.ujing.UiStatus
import com.dut.ujing.helper.ujing.displayName
import com.dut.ujing.helper.ujing.friendlyName
import com.dut.ujing.helper.ujing.isLegacyAutoName
import com.dut.ujing.helper.ujing.optBooleanOrNull
import com.dut.ujing.helper.ujing.optIntOrNull
import com.dut.ujing.helper.ujing.optStringOrNull
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.Collator
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 主面板：已收藏洗衣机列表 + 实时占用状态。
 *
 * v2.1 关键改进：
 *  - 卡片大字显示友好别名（「西山1舍-5层 #3」），机身码尾号移入小字（需求①）
 *  - 批量导入 / 导出设备清单（JSON 文件，按二维码去重合并）（需求②）
 *  - 排序（添加时间/名称/状态/剩余时间）+「只看空闲」筛选，偏好持久化（需求③）
 *  - 「我的订单」视图：自己下的订单直接查剩余时间倒计时（需求④）
 */
class MainActivity : AppCompatActivity() {

    companion object {
        const val REPO_URL = "https://github.com/43aquarius/DUT-Ujing"

        fun start(ctx: android.content.Context, clearStack: Boolean = false) {
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

    // 筛选 / 排序状态（持久化）
    private var sortMode: SortMode = SortMode.ADDED
    private var freeOnly = false

    // 「我的订单」对话框状态
    private var myOrders: List<OrderBrief> = emptyList()
    private var myOrdersFetchedAt: Long = 0
    private var ordersDlg: AlertDialog? = null
    private var ordersListContainer: LinearLayout? = null
    private var countdownViews: MutableList<Pair<TextView, Long>> = mutableListOf()

    private val mainHandler = Handler(Looper.getMainLooper())
    private val collator = Collator.getInstance(Locale.CHINA)

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
            updateOrdersCountdown()
            mainHandler.postDelayed(this, 1_000)
        }
    }

    private val scanLauncher = registerForActivityResult(ScanContract()) { result ->
        result.contents?.let { handleQr(it) }
    }

    /** 导出：SAF 创建 JSON 文件 */
    private val exportLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri -> uri?.let { exportDevices(it) } }

    /** 导入：SAF 选择 JSON 文件 */
    private val importLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> uri?.let { importDevices(it) } }

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

        sortMode = Store.sortMode(this)
        freeOnly = Store.freeOnly(this)

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
        b.btnGithub.setOnClickListener { openRepo() }

        // v2.1 工具栏
        b.btnFreeOnly.setOnClickListener {
            freeOnly = !freeOnly
            Store.setFreeOnly(this, freeOnly)
            renderToolbar()
            refreshListView()
        }
        b.btnSort.setOnClickListener { showSortDialog() }
        b.btnOrders.setOnClickListener { showMyOrders() }
        b.btnImport.setOnClickListener {
            MaterialAlertDialogBuilder(this)
                .setTitle("批量导入")
                .setMessage("从之前导出的 JSON 备份文件中导入洗衣机清单。\n\n同名（同机身码）设备会自动合并信息，不会重复添加。")
                .setPositiveButton("选择文件") { _, _ -> importLauncher.launch(arrayOf("application/json", "text/*", "*/*")) }
                .setNegativeButton(R.string.cancel, null)
                .show()
        }
        b.btnExport.setOnClickListener {
            if (devices.isEmpty()) {
                toast("还没有收藏任何洗衣机")
                return@setOnClickListener
            }
            exportLauncher.launch("DUT-Ujing-设备备份.json")
        }

        b.switchAuto.isChecked = Store.autoRefresh(this)
        b.switchAuto.setOnCheckedChangeListener { _, checked ->
            Store.setAutoRefresh(this, checked)
            if (checked) mainHandler.postDelayed(autoRunnable, 30_000) else mainHandler.removeCallbacks(autoRunnable)
        }

        renderToolbar()
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

    // ------------------------------------------------------------ 数据 / 列表视图

    private fun reload() {
        devices = Store.devices(this)
        refreshListView()
    }

    /** 排序 + 筛选后的可见列表 */
    private fun visibleDevices(): List<SavedDevice> {
        var list = devices.toList()
        if (freeOnly) list = list.filter { it.lastStatus == UiStatus.FREE.name }
        list = when (sortMode) {
            SortMode.ADDED -> list.sortedBy { it.createdAt }
            SortMode.NAME -> list.sortedWith(compareBy(collator) { it.displayName() })
            SortMode.STATUS -> list.sortedBy { statusRank(it) }
            SortMode.REMAIN -> list.sortedBy { it.lastEndAt ?: Long.MAX_VALUE }
        }
        return list
    }

    private fun statusRank(d: SavedDevice): Int = when (parseStatus(d.lastStatus)) {
        UiStatus.FREE -> 0
        UiStatus.BUSY -> 1
        UiStatus.UNAVAILABLE -> 2
        UiStatus.CHECKING -> 3
        UiStatus.ERROR -> 4
        UiStatus.UNKNOWN -> 5
    }

    private fun parseStatus(s: String?): UiStatus = try {
        s?.let { UiStatus.valueOf(it) } ?: UiStatus.UNKNOWN
    } catch (e: IllegalArgumentException) {
        UiStatus.UNKNOWN
    }

    /** 列表视图整体刷新（数据、空态、副标题、工具栏角标） */
    private fun refreshListView() {
        val visible = visibleDevices()
        adapter.submit(visible)
        b.empty.isVisible = devices.isEmpty()
        b.filteredEmpty.isVisible = devices.isNotEmpty() && visible.isEmpty()
        updateSubtitle()
        renderToolbar()
    }

    private fun updateSubtitle() {
        val s = session ?: return
        if (devices.isEmpty()) {
            b.tvSub.text = s.mobile.replace(Regex("(\\d{3})\\d{4}(\\d{4})"), "$1****$2")
        } else {
            val free = devices.count { it.lastStatus == UiStatus.FREE.name }
            b.tvSub.text = if (freeOnly) "空闲 ${free} 台（共 ${devices.size} 台）" else "${devices.size} 台 · ${free} 台空闲"
        }
    }

    private fun persist() = Store.saveDevices(this, devices)

    /** 工具栏按钮渲染（只看空闲切换态 / 排序模式名） */
    private fun renderToolbar() {
        val active = ContextCompat.getColor(this, R.color.primary)
        val inactive = ContextCompat.getColor(this, R.color.text_sub)
        val activeBg = ContextCompat.getColor(this, R.color.primary)
        val inactiveBg = ContextCompat.getColor(this, R.color.divider)
        if (freeOnly) {
            b.btnFreeOnly.text = "✓ 只看空闲"
            b.btnFreeOnly.setTextColor(Color.WHITE)
            b.btnFreeOnly.backgroundTintList = ColorStateList.valueOf(activeBg)
            b.btnFreeOnly.rippleColor = ColorStateList.valueOf(active)
        } else {
            b.btnFreeOnly.text = "只看空闲"
            b.btnFreeOnly.setTextColor(inactive)
            b.btnFreeOnly.backgroundTintList = ColorStateList.valueOf(inactiveBg)
        }
        b.btnSort.text = "↕ ${sortMode.label}"
    }

    // ------------------------------------------------------------ 刷新

    private fun refreshAll() {
        val token = session?.token ?: return
        if (refreshing) {
            b.swipe.isRefreshing = false
            return
        }
        if (devices.isEmpty()) {
            b.swipe.isRefreshing = false
            refreshListView()
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
            refreshListView()
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
        // v2.1：扫码响应直接携带门店/机号，回填并自动升级友好名（用户手动改名不覆盖）
        val storeName = scan?.storeName ?: old.storeName
        val deviceNo = scan?.deviceNo ?: old.deviceNo
        val autoName = friendlyName(storeName, deviceNo)
        val newName = when {
            old.customName -> old.name                       // 用户改过名，保留
            autoName != null -> autoName                     // 自动升级为「西山1舍-5层 #3」
            else -> old.name
        }
        val updated = old.copy(
            deviceId = scan?.deviceId ?: old.deviceId,
            storeId = scan?.storeId ?: old.storeId,
            storeName = storeName,
            deviceNo = deviceNo,
            deviceTypeId = scan?.deviceTypeId ?: old.deviceTypeId,
            macAddress = scan?.macAddress ?: old.macAddress,
            name = newName,
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
        // 排序模式下位置会变（空闲优先/剩余时间），全量重排；同步副标题/空态
        refreshListView()
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

    /** 保存/合并设备（扫码或手动输入）。v2.1：默认名 = 门店 #机号 */
    private fun saveDevice(qrCode: String, scan: ScanInfo?, program: JSONObject?, errMsg: String?) {
        val list = Store.devices(this).toMutableList()
        val idx = list.indexOfFirst { it.qrCode == qrCode }
        val now = System.currentTimeMillis()

        // 门店/机号：扫码响应优先，程序详情兜底
        val pStoreName = program?.optStringOrNull("storeName")
        val pDeviceNo = program?.optStringOrNull("deviceNo")
        val pStoreId = program?.optStringOrNull("storeId")
        val fStoreName = scan?.storeName ?: pStoreName
        val fDeviceNo = scan?.deviceNo ?: pDeviceNo

        val programTypeName = program?.optStringOrNull("deviceTypeName")?.takeIf { it.isNotBlank() }
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
            val storeName = fStoreName ?: old.storeName
            val deviceNo = fDeviceNo ?: old.deviceNo
            val autoName = friendlyName(storeName, deviceNo)
            list[idx] = old.copy(
                deviceId = scan?.deviceId ?: program?.optStringOrNull("deviceId")?.takeIf { it.isNotBlank() } ?: old.deviceId,
                deviceNo = deviceNo,
                storeId = scan?.storeId ?: pStoreId ?: old.storeId,
                storeName = storeName,
                deviceTypeId = scan?.deviceTypeId ?: old.deviceTypeId,
                macAddress = scan?.macAddress ?: old.macAddress,
                name = when {
                    old.customName -> old.name
                    autoName != null -> autoName
                    else -> old.name
                },
                lastStatus = liveStatus.name,
                lastLabel = liveLabel,
                lastDetail = typeNameFallback?.let { "机型：$it" },
                lastOrderId = scan?.orderId,
                lastCheckedAt = now,
                lastRaw = scan?.raw?.toString() ?: old.lastRaw,
            )
        } else {
            // v2.1：默认名直接用友好别名，拿不到时才降级为「洗衣机 159528」
            val defaultName = friendlyName(fStoreName, fDeviceNo) ?: "洗衣机 ${qrCode.takeLast(6)}"
            list.add(
                SavedDevice(
                    id = Store.newDeviceId(),
                    name = defaultName,
                    qrCode = qrCode,
                    deviceId = scan?.deviceId ?: program?.optStringOrNull("deviceId")?.takeIf { it.isNotBlank() },
                    deviceNo = fDeviceNo,
                    storeId = scan?.storeId ?: pStoreId,
                    storeName = fStoreName,
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

    // ------------------------------------------------------------ 导入 / 导出（v2.1 需求②）

    /** 导出全部设备为 JSON（SAF 文件） */
    private fun exportDevices(uri: Uri) {
        try {
            val payload = JSONObject().apply {
                put("app", "DUT-Ujing")
                put("schema", 1)
                put("exportedAt", SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date()))
                put("count", devices.size)
                val arr = JSONArray()
                devices.forEach { d ->
                    arr.put(
                        JSONObject().apply {
                            put("name", d.name)
                            put("qrCode", d.qrCode)
                            put("customName", d.customName)
                            d.deviceId?.let { put("deviceId", it) }
                            d.deviceNo?.let { put("deviceNo", it) }
                            d.storeId?.let { put("storeId", it) }
                            d.storeName?.let { put("storeName", it) }
                            d.deviceTypeId?.let { put("deviceTypeId", it) }
                            d.macAddress?.let { put("macAddress", it) }
                            put("createdAt", d.createdAt)
                        }
                    )
                }
                put("devices", arr)
            }
            contentResolver.openOutputStream(uri)?.use { os ->
                os.write(payload.toString(2).toByteArray(Charsets.UTF_8))
                os.flush()
            } ?: throw IllegalStateException("无法写入文件")
            toast("已导出 ${devices.size} 台设备")
        } catch (e: Exception) {
            toast("导出失败：${e.message}")
        }
    }

    /** 从 JSON 导入设备（支持 {devices:[...]} 或裸数组；按 qrCode 去重合并） */
    private fun importDevices(uri: Uri) {
        try {
            val text = contentResolver.openInputStream(uri)?.use {
                it.readBytes().toString(Charsets.UTF_8)
            } ?: throw IllegalStateException("无法读取文件")

            val trimmed = text.trim()
            if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
                throw IllegalStateException("文件内容不是 JSON")
            }
            val root = JSONObject(trimmed)
            val arr = root.optJSONArray("devices")
                ?: (if (trimmed.startsWith("[")) JSONArray(trimmed) else null)
                ?: throw IllegalStateException("文件里没有 devices 数组")

            var added = 0
            var merged = 0
            var skipped = 0
            val list = devices.toMutableList()
            val now = System.currentTimeMillis()

            for (i in 0 until arr.length()) {
                val o = arr.opt(i) as? JSONObject
                if (o == null) {
                    skipped++
                    continue
                }
                val qr = o.optStringOrNull("qrCode")?.trim()?.takeIf { it.isNotBlank() }
                if (qr == null || !UjingApi.isUjingQrCode(qr)) {
                    skipped++
                    continue
                }
                val idx = list.indexOfFirst { it.qrCode == qr }
                if (idx >= 0) {
                    // 合并：只回填本机缺失的字段，不动已有数据
                    val old = list[idx]
                    list[idx] = old.copy(
                        deviceId = old.deviceId ?: o.optStringOrNull("deviceId"),
                        deviceNo = old.deviceNo ?: o.optStringOrNull("deviceNo"),
                        storeId = old.storeId ?: o.optStringOrNull("storeId"),
                        storeName = old.storeName ?: o.optStringOrNull("storeName"),
                        deviceTypeId = old.deviceTypeId ?: o.optIntOrNull("deviceTypeId"),
                        macAddress = old.macAddress ?: o.optStringOrNull("macAddress"),
                    )
                    merged++
                } else {
                    val name = o.optStringOrNull("name")?.takeIf { it.isNotBlank() }
                        ?: "洗衣机 ${qr.takeLast(6)}"
                    list.add(
                        SavedDevice(
                            id = Store.newDeviceId(),
                            name = name,
                            qrCode = qr,
                            deviceId = o.optStringOrNull("deviceId"),
                            deviceNo = o.optStringOrNull("deviceNo"),
                            storeId = o.optStringOrNull("storeId"),
                            storeName = o.optStringOrNull("storeName"),
                            deviceTypeId = o.optIntOrNull("deviceTypeId"),
                            macAddress = o.optStringOrNull("macAddress"),
                            customName = o.optBooleanOrNull("customName") ?: false,
                            createdAt = o.optLong("createdAt", now + added),
                        )
                    )
                    added++
                }
            }
            devices = list
            persist()
            refreshListView()
            toast("导入完成：新增 $added 台 · 合并 $merged 台 · 跳过 $skipped 条")
            if (added > 0) refreshAll()
        } catch (e: Exception) {
            toast("导入失败：${e.message}")
        }
    }

    // ------------------------------------------------------------ 我的订单（v2.1 需求④）

    /**
     * 「我的订单」：直接查询自己运行中的订单及剩余时间。
     * 数据源 GET /api/v1/orders/running：orderId/status/statusRemark/remainTime（秒）。
     */
    private fun showMyOrders() {
        val token = session?.token ?: return
        val pad = (18 * resources.displayMetrics.density).toInt()

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad / 2, pad, pad / 2)
        }
        ordersListContainer = container
        container.addView(
            TextView(this).apply {
                text = "正在查询…"
                setPadding(0, pad, 0, pad)
                gravity = Gravity.CENTER
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_sub))
            }
        )

        val scroll = ScrollView(this).apply { addView(container) }
        ordersDlg = MaterialAlertDialogBuilder(this)
            .setTitle("我的订单（运行中）")
            .setView(scroll)
            .setPositiveButton("刷新") { _, _ -> showMyOrders() }
            .setNegativeButton(R.string.confirm, null)
            .setOnDismissListener {
                ordersListContainer = null
                countdownViews.clear()
            }
            .show()

        lifecycleScope.launch {
            val orders = withContext(Dispatchers.IO) {
                runCatching { UjingApi.runningOrders(token).map { OrderBrief.from(it) } }
                    .getOrDefault(emptyList())
            }
            myOrders = orders
            myOrdersFetchedAt = System.currentTimeMillis()
            renderOrders()
        }
    }

    /** 渲染订单列表内容 */
    private fun renderOrders() {
        val container = ordersListContainer ?: return
        container.removeAllViews()
        countdownViews.clear()
        val dp = resources.displayMetrics.density

        if (myOrders.isEmpty()) {
            container.addView(
                TextView(this).apply {
                    text = "当前没有进行中的订单。\n\n下单后（含 U净官方 App 下的单）这里会显示剩余时间。"
                    setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_sub))
                    textSize = 13f
                    gravity = Gravity.CENTER
                    setPadding(0, (20 * dp).toInt(), 0, (20 * dp).toInt())
                    setLineSpacing(4 * dp, 1f)
                }
            )
            return
        }

        myOrders.forEach { order ->
            val saved = devices.firstOrNull {
                (order.deviceId != null && it.deviceId == order.deviceId) ||
                    (order.deviceNo != null && it.deviceNo == order.deviceNo)
            }
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding((12 * dp).toInt(), (12 * dp).toInt(), (12 * dp).toInt(), (12 * dp).toInt())
                background = ContextCompat.getDrawable(this@MainActivity, R.drawable.bg_round_primary)
                backgroundTintList = ColorStateList.valueOf(
                    ContextCompat.getColor(this@MainActivity, R.color.card_free_bg)
                )
            }

            // 行1：标题 + 收藏状态
            val row1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            row1.addView(
                TextView(this).apply {
                    text = order.title()
                    textSize = 15f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_main))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                }
            )
            row1.addView(
                TextView(this).apply {
                    text = if (saved != null) "已收藏" else "未收藏"
                    textSize = 11f
                    setTextColor(
                        ContextCompat.getColor(
                            this@MainActivity,
                            if (saved != null) R.color.status_free else R.color.text_meta
                        )
                    )
                }
            )
            card.addView(row1)

            // 行2：机型 · 状态
            val meta = listOfNotNull(
                order.deviceTypeName?.takeIf { it.isNotBlank() }
                    ?: DeviceTypes.name(order.deviceTypeId),
                order.statusRemark?.takeIf { it.isNotBlank() } ?: OrderStatus.name(order.status).ifBlank { "进行中" },
                order.isPauseStatus?.takeIf { it }?.let { "已暂停" },
            ).joinToString(" · ")
            card.addView(
                TextView(this).apply {
                    text = meta
                    textSize = 12f
                    setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_sub))
                    setPadding(0, (6 * dp).toInt(), 0, 0)
                }
            )

            // 行3：剩余时间倒计时（endAt 由 remainTime + 拉取时刻计算）
            val endAt = order.endAt(myOrdersFetchedAt)
            if (endAt != null && endAt > System.currentTimeMillis()) {
                val tv = TextView(this).apply {
                    textSize = 15f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(ContextCompat.getColor(this@MainActivity, R.color.status_busy))
                    setPadding(0, (8 * dp).toInt(), 0, 0)
                }
                card.addView(tv)
                countdownViews.add(tv to endAt)   // 与该卡片的结束时间绑定，逐秒自走
            } else if (endAt != null) {
                card.addView(
                    TextView(this).apply {
                        text = "可能已经洗完 🎉"
                        textSize = 13f
                        setTextColor(ContextCompat.getColor(this@MainActivity, R.color.status_free))
                        setPadding(0, (8 * dp).toInt(), 0, 0)
                    }
                )
            }
            if (saved == null) {
                card.addView(
                    TextView(this).apply {
                        text = "这台还没收藏：订单不含机身码，可到机身上扫码收藏"
                        textSize = 10f
                        setTextColor(ContextCompat.getColor(this@MainActivity, R.color.text_meta))
                        setPadding(0, (6 * dp).toInt(), 0, 0)
                    }
                )
            }
            container.addView(card)
            (card.layoutParams as LinearLayout.LayoutParams).setMargins(0, 0, 0, (10 * dp).toInt())
        }
        updateOrdersCountdown()
    }

    /** 每秒刷新订单倒计时（由 tickRunnable 驱动；每个 TV 用创建时绑定的 endAt，避免索引错位） */
    private fun updateOrdersCountdown() {
        if (ordersListContainer == null || countdownViews.isEmpty()) return
        val fmt = SimpleDateFormat("HH:mm", Locale.getDefault())
        val now = System.currentTimeMillis()
        for ((tv, endAt) in countdownViews) {
            if (endAt > now) {
                val remain = ((endAt - now) / 1000L).toInt()
                tv.text = "⏳ 剩余 ${remain / 60}:${String.format(Locale.getDefault(), "%02d", remain % 60)} · 预计 ${fmt.format(Date(endAt))} 洗完"
            } else {
                tv.text = "可能已经洗完 🎉"
            }
        }
    }

    // ------------------------------------------------------------ 排序对话框（v2.1 需求③）

    private fun showSortDialog() {
        val modes = SortMode.entries
        val labels = modes.map { it.label }.toTypedArray()
        val current = modes.indexOf(sortMode)
        MaterialAlertDialogBuilder(this)
            .setTitle("排序方式")
            .setSingleChoiceItems(labels, current) { dlg, which ->
                sortMode = modes[which]
                Store.setSortMode(this, sortMode)
                renderToolbar()
                refreshListView()
                dlg.dismiss()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    // ------------------------------------------------------------ 对话框

    private fun showDeviceMenu(d: SavedDevice) {
        val items = arrayOf(getString(R.string.refresh), getString(R.string.rename), getString(R.string.raw_data), getString(R.string.delete))
        MaterialAlertDialogBuilder(this)
            .setTitle(d.displayName())
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
                        devices[idx] = devices[idx].copy(name = name, customName = true)
                        persist()
                        refreshListView()
                    }
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun confirmDelete(d: SavedDevice) {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.delete)
            .setMessage("确定删除「${d.displayName()}」吗？")
            .setPositiveButton(R.string.delete) { _, _ ->
                devices = devices.filterNot { it.id == d.id }.toMutableList()
                persist()
                refreshListView()
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

    // ------------------------------------------------------------ 外部入口

    /** 打开 GitHub 仓库页（无浏览器时降级为 toast 提示地址） */
    private fun openRepo() {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(REPO_URL)))
        } catch (e: Exception) {
            toast("无法打开浏览器：$REPO_URL")
        }
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
