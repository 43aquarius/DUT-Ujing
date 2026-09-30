import { NextRequest, NextResponse } from "next/server";
import {
  scanWasherCode,
  programInfo,
  isUjingQrCode,
  UjingApiError,
  ScanWasherResult,
} from "@/lib/ujing";

export const runtime = "nodejs";

/**
 * POST /api/ujing/scan  body: { token, qrCode, withProgram? }
 * 实时查询某台洗衣机当前状态（是否被占用）
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
    return NextResponse.json({ result, program });
  } catch (e) {
    if (e instanceof UjingApiError) {
      // 401 = token 失效，前端应引导重新登录
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.code === 401 ? 401 : 502 }
      );
    }
    console.error("[scan]", e);
    return NextResponse.json({ error: "查询失败，请稍后重试" }, { status: 502 });
  }
}
