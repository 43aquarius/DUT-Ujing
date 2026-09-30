import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isUjingQrCode } from "@/lib/ujing";

export const runtime = "nodejs";

/** GET /api/devices?mobile=xxx —— 获取用户已保存的洗衣机列表 */
export async function GET(req: NextRequest) {
  const mobile = req.nextUrl.searchParams.get("mobile")?.trim();
  if (!mobile || !/^1\d{10}$/.test(mobile)) {
    return NextResponse.json({ error: "缺少有效的 mobile 参数" }, { status: 400 });
  }
  const devices = await db.device.findMany({
    where: { userMobile: mobile },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ devices });
}

/** POST /api/devices  body: { mobile, qrCode, name, scanInfo } —— 保存扫码结果 */
export async function POST(req: NextRequest) {
  try {
    const { mobile, qrCode, name, scanInfo } = (await req.json()) as {
      mobile?: string;
      qrCode?: string;
      name?: string;
      scanInfo?: {
        deviceId?: string;
        deviceNo?: string;
        storeName?: string;
        deviceTypeName?: string;
        macAddress?: string;
        createOrderEnabled?: boolean;
        reason?: string;
      };
    };
    if (!mobile || !/^1\d{10}$/.test(mobile)) {
      return NextResponse.json({ error: "缺少有效的 mobile" }, { status: 400 });
    }
    if (!qrCode || !isUjingQrCode(qrCode.trim())) {
      return NextResponse.json({ error: "二维码内容不是有效的 U净洗衣机码" }, { status: 400 });
    }
    const code = qrCode.trim();
    await db.user.upsert({
      where: { mobile },
      update: {},
      create: { mobile },
    });
    const device = await db.device.upsert({
      where: { userMobile_qrCode: { userMobile: mobile, qrCode: code } },
      update: {
        name: name?.trim() || undefined,
        deviceId: scanInfo?.deviceId ? String(scanInfo.deviceId) : undefined,
        deviceNo: scanInfo?.deviceNo ?? undefined,
        storeName: scanInfo?.storeName ?? undefined,
        deviceTypeName: scanInfo?.deviceTypeName ?? undefined,
        macAddress: scanInfo?.macAddress ?? undefined,
        lastStatus: scanInfo?.createOrderEnabled ? "free" : "busy",
        lastReason: scanInfo?.reason ?? null,
        lastCheckedAt: new Date(),
      },
      create: {
        userMobile: mobile,
        qrCode: code,
        name: name?.trim() || `洗衣机 ${code.slice(-6)}`,
        deviceId: scanInfo?.deviceId ? String(scanInfo.deviceId) : null,
        deviceNo: scanInfo?.deviceNo ?? null,
        storeName: scanInfo?.storeName ?? null,
        deviceTypeName: scanInfo?.deviceTypeName ?? null,
        macAddress: scanInfo?.macAddress ?? null,
        lastStatus: scanInfo?.createOrderEnabled ? "free" : "busy",
        lastReason: scanInfo?.reason ?? null,
        lastCheckedAt: new Date(),
      },
    });
    return NextResponse.json({ device });
  } catch (e) {
    console.error("[devices POST]", e);
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}
