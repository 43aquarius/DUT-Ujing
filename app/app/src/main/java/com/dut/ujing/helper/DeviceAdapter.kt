package com.dut.ujing.helper


import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.dut.ujing.helper.databinding.ItemDeviceBinding
import com.dut.ujing.helper.ujing.DeviceTypes
import com.dut.ujing.helper.ujing.SavedDevice
import com.dut.ujing.helper.ujing.UiStatus
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 设备列表适配器：状态卡片（v2 新增服务端原文/剩余时间倒计时/机型展示） */
class DeviceAdapter(
    private val onRefresh: (SavedDevice) -> Unit,
    private val onMenu: (SavedDevice) -> Unit,
    private val onRaw: (SavedDevice) -> Unit,
) : RecyclerView.Adapter<DeviceAdapter.VH>() {

    private var devices: MutableList<SavedDevice> = mutableListOf()

    fun submit(list: List<SavedDevice>) {
        devices = list.toMutableList()
        notifyDataSetChanged()
    }

    fun updateDevice(device: SavedDevice) {
        val idx = devices.indexOfFirst { it.id == device.id }
        if (idx >= 0) {
            devices[idx] = device
            notifyItemChanged(idx)
        }
    }

    fun removeDevice(id: String) {
        val idx = devices.indexOfFirst { it.id == id }
        if (idx >= 0) {
            devices.removeAt(idx)
            notifyItemRemoved(idx)
        }
    }

    class VH(val b: ItemDeviceBinding) : RecyclerView.ViewHolder(b.root) {
        var bound: SavedDevice? = null

        fun bind(d: SavedDevice) {
            bound = d
            b.tvName.text = d.name

            // 元信息：门店 · 机号 · 机型
            val meta = listOfNotNull(
                d.storeName?.takeIf { it.isNotBlank() },
                d.deviceNo?.takeIf { it.isNotBlank() }?.let { "#$it" },
                DeviceTypes.name(d.deviceTypeId),
            ).filter { it.isNotBlank() }.joinToString(" · ")
            b.tvMeta.text = meta.ifBlank { d.qrCode.takeLast(18) }

            applyStatus(d)
            b.tvTime.text = "更新于 ${timeAgo(d.lastCheckedAt)}"
            b.tvRefresh.setOnClickListener { onRefreshClick(d) }
            b.tvMore.setOnClickListener { onMenuClick(d) }
            b.btnRaw.setOnClickListener { onRawClick(d) }
        }

        // 点击回调延迟绑定（构造时无法访问 adapter 的回调）
        var onRefreshClick: (SavedDevice) -> Unit = {}
        var onMenuClick: (SavedDevice) -> Unit = {}
        var onRawClick: (SavedDevice) -> Unit = {}

        private fun applyStatus(d: SavedDevice) {
            val ctx = b.root.context
            val status = parseStatus(d.lastStatus)
            val (label, colorRes, bgRes, strokeRes) = when (status) {
                UiStatus.FREE -> listOf("空闲可用", R.color.status_free, R.color.card_free_bg, R.color.card_free_border)
                UiStatus.BUSY -> listOf("占用中", R.color.status_busy, R.color.card_busy_bg, R.color.card_busy_border)
                UiStatus.UNAVAILABLE -> listOf("不可用", R.color.status_warn, R.color.card_warn_bg, R.color.card_warn_border)
                UiStatus.ERROR -> listOf("查询失败", R.color.status_error, R.color.card_error_bg, R.color.card_error_border)
                UiStatus.CHECKING -> listOf("查询中…", R.color.status_error, R.color.card_error_bg, R.color.card_error_border)
                else -> listOf("未知状态", R.color.status_error, R.color.card_error_bg, R.color.card_error_border)
            }

            // 卡片底色/描边
            b.card.setCardBackgroundColor(ContextCompat.getColor(ctx, bgRes as Int))
            b.card.strokeColor = ContextCompat.getColor(ctx, strokeRes as Int)

            // 状态主文案：缓存里的 label（可能是服务端原文）
            val mainLabel = d.lastLabel?.takeIf { it.isNotBlank() } ?: (label as String)
            b.tvStatus.text = mainLabel
            b.tvStatus.setTextColor(ContextCompat.getColor(ctx, colorRes as Int))

            // 状态点
            b.statusDot.background.setTint(ContextCompat.getColor(ctx, colorRes as Int))

            // 副文案
            if (!d.lastDetail.isNullOrBlank()) {
                b.tvDetail.text = d.lastDetail
                b.tvDetail.visibility = View.VISIBLE
            } else {
                b.tvDetail.visibility = View.GONE
            }

            updateCountdown()
        }

        /** 每秒被外部 tick 调用，仅刷新倒计时行，不重绑整卡 */
        fun updateCountdown() {
            val d = bound ?: return
            val endAt = d.lastEndAt
            if (endAt != null && endAt > System.currentTimeMillis()) {
                val remainSec = ((endAt - System.currentTimeMillis()) / 1000L).toInt()
                val hm = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(endAt))
                b.tvCountdown.text = "⏳ 剩余 ${remainSec / 60}:${String.format(Locale.getDefault(), "%02d", remainSec % 60)} · 预计 $hm 洗完"
                b.tvCountdown.visibility = View.VISIBLE
            } else if (endAt != null) {
                b.tvCountdown.text = "可能已洗完，下拉刷新看看"
                b.tvCountdown.visibility = View.VISIBLE
            } else {
                b.tvCountdown.visibility = View.GONE
            }
        }

        private fun parseStatus(s: String?): UiStatus = try {
            s?.let { UiStatus.valueOf(it) } ?: UiStatus.UNKNOWN
        } catch (e: IllegalArgumentException) {
            UiStatus.UNKNOWN
        }

        private fun timeAgo(ts: Long?): String {
            if (ts == null || ts <= 0) return "未查询"
            val diff = (System.currentTimeMillis() - ts) / 1000
            return when {
                diff < 60 -> "刚刚"
                diff < 3600 -> "${diff / 60} 分钟前"
                diff < 86400 -> "${diff / 3600} 小时前"
                else -> "${diff / 86400} 天前"
            }
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val binding = ItemDeviceBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return VH(binding)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val d = devices.getOrNull(position) ?: return
        holder.onRefreshClick = onRefresh
        holder.onMenuClick = onMenu
        holder.onRawClick = onRaw
        holder.bind(d)
    }

    override fun getItemCount(): Int = devices.size
}
