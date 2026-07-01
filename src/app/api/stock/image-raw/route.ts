import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { getOcrImageBytes } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

// 편집기 캔버스용 원본 바이트 스트리밍(동일출처) — canvas 오염(taint) 방지.
// image_path(GCP) 우선, 없으면 source_image_url(셀콘 직결 공개 URL) 폴백.
export async function GET(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  try {
    const sb = getServerSupabase();
    const { data: row, error } = await sb
      .from("stock_registrations").select("image_path, source_image_url").eq("id", id).single();
    if (error || !row) return NextResponse.json({ ok: false, error: "항목 없음" }, { status: 404 });

    let buffer: Buffer;
    let contentType = "image/jpeg";
    if (row.image_path) {
      ({ buffer, contentType } = await getOcrImageBytes(row.image_path));
    } else if (row.source_image_url) {
      const r = await fetch(row.source_image_url);
      if (!r.ok) throw new Error(`원본 fetch 실패 (${r.status})`);
      contentType = r.headers.get("content-type") || "image/jpeg";
      buffer = Buffer.from(await r.arrayBuffer());
    } else {
      return NextResponse.json({ ok: false, error: "이미지 없음" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "이미지 조회 실패" },
      { status: 500 },
    );
  }
}
