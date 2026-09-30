import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/devices/[id]?mobile=xxx —— 删除已保存的洗衣机 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const mobile = req.nextUrl.searchParams.get("mobile")?.trim();
  if (!mobile) return NextResponse.json({ error: "缺少 mobile 参数" }, { status: 400 });
  try {
    const existing = await db.device.findUnique({ where: { id } });
    if (!existing || existing.userMobile !== mobile) {
      return NextResponse.json({ error: "设备不存在" }, { status: 404 });
    }
    await db.device.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[devices DELETE]", e);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}

/** PATCH /api/devices/[id]  body: { mobile, name } —— 修改备注名 / 更新状态缓存 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as {
      mobile?: string;
      name?: string;
      lastStatus?: string;
      lastReason?: string | null;
      scanInfo?: {
        deviceId?: string;
        deviceNo?: string;
        storeName?: string;
        deviceTypeName?: string;
        macAddress?: string;
      };
    };
    if (!body.mobile) return NextResponse.json({ error: "缺少 mobile" }, { status: 400 });
    const existing = await db.device.findUnique({ where: { id } });
    if (!existing || existing.userMobile !== body.mobile) {
      return NextResponse.json({ error: "设备不存在" }, { status: 404 });
    }
    const device = await db.device.update({
      where: { id },
      data: {
        name: body.name?.trim() || undefined,
        lastStatus: body.lastStatus ?? undefined,
        lastReason: body.lastReason ?? undefined,
        lastCheckedAt:
          body.lastStatus !== undefined ? new Date() : undefined,
        deviceId: body.scanInfo?.deviceId ? String(body.scanInfo.deviceId) : undefined,
        deviceNo: body.scanInfo?.deviceNo ?? undefined,
        storeName: body.scanInfo?.storeName ?? undefined,
        deviceTypeName: body.scanInfo?.deviceTypeName ?? undefined,
        macAddress: body.scanInfo?.macAddress ?? undefined,
      },
    });
    return NextResponse.json({ device });
  } catch (e) {
    console.error("[devices PATCH]", e);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}
