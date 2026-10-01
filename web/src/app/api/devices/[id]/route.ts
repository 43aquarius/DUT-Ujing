import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { friendlyName } from "@/lib/ujing";

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

/** PATCH /api/devices/[id]  body: { mobile, name?, customName?, lastStatus?, lastReason?, scanInfo? } —— 修改备注名 / 更新状态缓存 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as {
      mobile?: string;
      name?: string;
      customName?: boolean;
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
    // 名称处理：
    //  - 显式改名 → 用新名并标记 customName（此后不再自动升级）
    //  - 携带 scanInfo 回填且旧名非自定义 → 升级为友好别名「门店 #机号」
    const storeName = body.scanInfo?.storeName?.trim() || existing.storeName;
    const deviceNo = body.scanInfo?.deviceNo?.trim() || existing.deviceNo;
    let nameData: string | undefined = undefined;
    let customNameData: boolean | undefined = undefined;
    if (body.name !== undefined) {
      nameData = body.name.trim() || existing.name;
      customNameData = body.customName ?? true;
    } else if (!existing.customName && storeName && deviceNo) {
      nameData = friendlyName(storeName, deviceNo) ?? undefined;
    }
    const device = await db.device.update({
      where: { id },
      data: {
        name: nameData,
        customName: customNameData,
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
