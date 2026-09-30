import { NextRequest, NextResponse } from "next/server";
import { sendCaptcha, UjingApiError } from "@/lib/ujing";

export const runtime = "nodejs";

/** POST /api/auth/captcha  body: { mobile }  —— 发送 U净短信验证码 */
export async function POST(req: NextRequest) {
  try {
    const { mobile } = (await req.json()) as { mobile?: string };
    if (!mobile || !/^1\d{10}$/.test(mobile.trim())) {
      return NextResponse.json({ error: "请输入正确的手机号" }, { status: 400 });
    }
    await sendCaptcha(mobile.trim());
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UjingApiError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.code === 401 ? 401 : 502 }
      );
    }
    console.error("[captcha]", e);
    return NextResponse.json({ error: "验证码发送失败，请稍后重试" }, { status: 502 });
  }
}
