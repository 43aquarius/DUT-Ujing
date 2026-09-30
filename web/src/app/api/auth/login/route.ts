import { NextRequest, NextResponse } from "next/server";
import { login, UjingApiError } from "@/lib/ujing";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** POST /api/auth/login  body: { mobile, captcha } —— 登录 U净，返回 JWT */
export async function POST(req: NextRequest) {
  try {
    const { mobile, captcha } = (await req.json()) as {
      mobile?: string;
      captcha?: string;
    };
    if (!mobile || !/^1\d{10}$/.test(mobile.trim())) {
      return NextResponse.json({ error: "请输入正确的手机号" }, { status: 400 });
    }
    if (!captcha || !/^\d{4,8}$/.test(captcha.trim())) {
      return NextResponse.json({ error: "验证码格式错误" }, { status: 400 });
    }
    const result = await login(mobile.trim(), captcha.trim());
    // 自动建户（用于隔离各用户的洗衣机列表）
    await db.user.upsert({
      where: { mobile: mobile.trim() },
      update: {},
      create: { mobile: mobile.trim() },
    });
    return NextResponse.json({ token: result.token, mobile: result.mobile ?? mobile });
  } catch (e) {
    if (e instanceof UjingApiError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.code === 401 ? 401 : 502 }
      );
    }
    console.error("[login]", e);
    return NextResponse.json({ error: "登录失败，请稍后重试" }, { status: 502 });
  }
}
