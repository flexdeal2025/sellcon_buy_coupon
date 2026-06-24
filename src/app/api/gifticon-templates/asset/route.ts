import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSignedReadUrl, OCR_BUCKET } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

// 템플릿 이미지 바이트를 동일 출처로 전달(프록시). 캔버스 합성 시 CORS 오염 방지.
// (GCP 서명 URL을 브라우저가 직접 그리면 canvas tainted → toBlob 불가)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  const which = u.searchParams.get("which") === "product" ? "product_path" : "template_path";
  if (!id) return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  try {
    const sb = getServerSupabase();
    const { data } = await sb.from("gifticon_templates").select("template_path, product_path").eq("id", id).maybeSingle();
    const path = data?.[which] as string | undefined;
    if (!path) return NextResponse.json({ ok: false, error: "이미지 없음" }, { status: 404 });
    const url = await getSignedReadUrl(OCR_BUCKET, path);
    const resp = await fetch(url);
    if (!resp.ok) return NextResponse.json({ ok: false, error: "원본 로드 실패" }, { status: 502 });
    const buf = Buffer.from(await resp.arrayBuffer());
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "조회 실패" }, { status: 500 });
  }
}
