import { NextRequest, NextResponse } from "next/server";
import {
  scanWasherCode,
  programInfo,
  orderDetail,
  isUjingQrCode,
  UjingApiError,
  ScanWasherResult,
} from "@/lib/ujing";

export const runtime = "nodejs";

/**
 * POST /api/ujing/scan  body: { token, qrCode, withProgram? }
 * 实时查询某台洗衣机当前状态（是否被占用 + 剩余时间）
 */
export async function POST(req: NextRequest) {
  try {
    const { token, qrCode, withProgram } = (await req.json()) as {
      token?: string;
      qrCode?: string;
      withProgram?: boolean;
    };
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!qrCode || !qrCode.trim()) {
      return NextResponse.json({ error: "缺少二维码内容" }, { status: 400 });
    }
    const code = qrCode.trim();
    if (!isUjingQrCode(code)) {
      return NextResponse.json(
        {
          error:
            "这不是 U净洗衣机的二维码。U净码格式：https://q.ujing.com.cn/ucqrc/index.html?cd=…",
        },
        { status: 400 }
      );
    }
    const result: ScanWasherResult = await scanWasherCode(token, code);
    // 可选：拉取设备详情（门店名/设备号/洗衣模式），用于保存时展示更多信息
    let program: Record<string, unknown> | null = null;
    if (withProgram && result.deviceId) {
      try {
        program = await programInfo(token, String(result.deviceId));
      } catch {
        program = null; // 详情失败不影响状态展示
      }
    }
    // 占用中：尽力拉订单详情取剩余时间（orderId 可能属于他人，失败返回 null 降级）
    let order: {
      status?: number;
      statusRemark?: string | null;
      remainTime?: number | null;
      workTime?: number | null;
    } | null = null;
    const orderId = Number((result as { orderId?: unknown }).orderId ?? 0);
    if (result.createOrderEnabled === false && orderId > 0) {
      const detail = await orderDetail(token, orderId);
      if (detail) {
        order = {
          status: detail.status != null ? Number(detail.status) : undefined,
          statusRemark: detail.statusRemark ?? null,
          remainTime:
            detail.remainTime != null && Number(detail.remainTime) > 0
              ? Number(detail.remainTime)
              : null,
          workTime:
            detail.workTime != null && Number(detail.workTime) > 0
              ? Number(detail.workTime)
              : null,
        };
      }
    }
    return NextResponse.json({ result, program, order });
  } catch (e) {
    if (e instanceof UjingApiError) {
      // 401 = token 失效，前端应引导重新登录；其余业务错误原样透出（如「不在工作时间」）
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.code === 401 ? 401 : 502 }
      );
    }
    console.error("[scan]", e);
    return NextResponse.json({ error: "查询失败，请稍后重试" }, { status: 502 });
  }
}
