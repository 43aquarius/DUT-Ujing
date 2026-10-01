import { NextRequest, NextResponse } from "next/server";
import { runningOrders } from "@/lib/ujing";

export const runtime = "nodejs";

/**
 * POST /api/ujing/orders  body: { token }
 * 我正在进行的订单列表（自己下的单 → 权威剩余时间）。
 * GET /api/v1/orders/running：orderId/status/statusRemark/remainTime（秒）/workTime。
 */
export async function POST(req: NextRequest) {
  try {
    const { token } = (await req.json()) as { token?: string };
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const orders = await runningOrders(token);
    const now = Date.now();
    // 归一化：仅 status 30(自洁)/40(运行) 且 remainTime>0 时倒计时有效（liteU 实测）
    const normalized = orders.map((o) => {
      const status = o.status != null ? Number(o.status) : undefined;
      const remain = Number(o.remainTime ?? 0);
      const counting = (status === 30 || status === 40) && remain > 0;
      return {
        orderId: o.orderId,
        deviceId: o.deviceId ? String(o.deviceId) : null,
        deviceNo: o.deviceNo ?? null,
        deviceTypeName: o.deviceTypeName ?? null,
        storeName: o.storeName ?? null,
        status: status ?? null,
        statusRemark: o.statusRemark ?? null,
        remainTime: counting ? remain : null,
        workTime: o.workTime != null ? Number(o.workTime) : null,
        endAt: counting ? now + remain * 1000 : null,
        isPauseStatus: Boolean(o.isPauseStatus),
      };
    });
    return NextResponse.json({ orders: normalized });
  } catch (e) {
    console.error("[orders]", e);
    return NextResponse.json({ error: "查询订单失败，请稍后重试" }, { status: 502 });
  }
}
