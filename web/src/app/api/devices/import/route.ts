import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { friendlyName, isUjingQrCode } from "@/lib/ujing";

export const runtime = "nodejs";

/**
 * POST /api/devices/import  body: { mobile, devices: [{ qrCode, name?, customName?, ... }] }
 * 批量导入洗衣机清单（来自导出的 JSON 备份）。
 * 同机身码（qrCode）设备自动 upsert 合并：已有的只回填缺失字段，不覆盖已有数据。
 */
export async function POST(req: NextRequest) {
  try {
    const { mobile, devices } = (await req.json()) as {
      mobile?: string;
      devices?: Array<{
        qrCode?: string;
        name?: string;
        customName?: boolean;
        deviceId?: string;
        deviceNo?: string;
        storeName?: string;
        deviceTypeName?: string;
        macAddress?: string;
      }>;
    };
    if (!mobile || !/^1\d{10}$/.test(mobile)) {
      return NextResponse.json({ error: "缺少有效的 mobile" }, { status: 400 });
    }
    if (!Array.isArray(devices) || devices.length === 0) {
      return NextResponse.json({ error: "文件里没有设备数据" }, { status: 400 });
    }

    await db.user.upsert({
      where: { mobile },
      update: {},
      create: { mobile },
    });

    let imported = 0; // 新增
    let merged = 0;   // 与已有设备合并
    let skipped = 0;  // 无效条目

    for (const item of devices) {
      const qr = item?.qrCode?.trim();
      if (!qr || !isUjingQrCode(qr)) {
        skipped++;
        continue;
      }
      // 自动名：门店 #机号，降级到导入的备注名，再降级到机身码尾号
      const autoName =
        friendlyName(item.storeName, item.deviceNo) ??
        item.name?.trim() ??
        `洗衣机 ${qr.slice(-6)}`;
      const deviceNo = item.deviceNo?.trim() || null;
      const storeName = item.storeName?.trim() || null;

      const existing = await db.device.findUnique({
        where: { userMobile_qrCode: { userMobile: mobile, qrCode: qr } },
      });
      if (existing) {
        // 合并：仅回填本机缺失的字段；名称只在旧名还是自动名时升级
        const nextName =
          !existing.customName && storeName && deviceNo
            ? (friendlyName(storeName, deviceNo) ?? existing.name)
            : existing.name;
        await db.device.update({
          where: { id: existing.id },
          data: {
            name: nextName,
            deviceNo: existing.deviceNo ?? deviceNo,
            storeName: existing.storeName ?? storeName,
            deviceTypeName: existing.deviceTypeName ?? item.deviceTypeName?.trim() ?? undefined,
            macAddress: existing.macAddress ?? item.macAddress?.trim() ?? undefined,
          },
        });
        merged++;
      } else {
        await db.device.create({
          data: {
            userMobile: mobile,
            qrCode: qr,
            name: autoName,
            customName: item.customName === true,
            deviceNo,
            storeName,
            deviceTypeName: item.deviceTypeName?.trim() || null,
            macAddress: item.macAddress?.trim() || null,
          },
        });
        imported++;
      }
    }

    return NextResponse.json({ imported, merged, skipped });
  } catch (e) {
    console.error("[devices import]", e);
    return NextResponse.json({ error: "导入失败" }, { status: 500 });
  }
}
