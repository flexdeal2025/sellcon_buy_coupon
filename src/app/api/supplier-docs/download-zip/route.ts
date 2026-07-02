import { NextResponse } from "next/server";
import JSZip from "jszip";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { getOcrImageBytes } from "@/lib/gcp/storage";

export const runtime = "nodejs";
export const maxDuration = 120;

// 공급처별 증빙 일괄 ZIP. 클라가 AUTH 헤더로 fetch → blob → '공급처_날짜.zip'로 저장.
export async function GET(req: Request) {
  if (!checkAppPasscode(req)) return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const supplier = url.searchParams.get("supplier") || "";
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    if (!supplier) return NextResponse.json({ ok: false, error: "공급처 필요" }, { status: 400 });

    const sb = getServerSupabase();
    let q = sb.from("supplier_documents").select("file_path, file_name, doc_date").eq("supplier", supplier).limit(2000);
    if (from) q = q.gte("doc_date", from);
    if (to) q = q.lte("doc_date", to);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return NextResponse.json({ ok: false, error: "다운로드할 증빙이 없습니다" }, { status: 404 });

    const zip = new JSZip();
    const used = new Set<string>();
    for (const d of data) {
      if (!d.file_path) continue;
      try {
        const { buffer } = await getOcrImageBytes(d.file_path);
        // 파일명 충돌 방지: 날짜 접두 + 원본명, 중복 시 (n)
        let name = `${d.doc_date ?? "무일자"}_${d.file_name || d.file_path.split("/").pop()}`;
        let i = 1;
        while (used.has(name)) { const dot = name.lastIndexOf("."); name = dot > 0 ? `${name.slice(0, dot)}(${i})${name.slice(dot)}` : `${name}(${i})`; i++; }
        used.add(name);
        zip.file(name, buffer);
      } catch (e) {
        console.warn("zip 파일 누락:", d.file_path, e instanceof Error ? e.message : e);
      }
    }
    const blob = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return new NextResponse(new Uint8Array(blob), {
      status: 200,
      headers: { "Content-Type": "application/zip", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "ZIP 생성 실패" }, { status: 500 });
  }
}
