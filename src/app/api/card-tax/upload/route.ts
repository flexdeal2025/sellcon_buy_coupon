import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkAppPasscode } from "@/lib/supabase/vivacon";
import { uploadOcrImage } from "@/lib/gcp/storage";
import { detectCompany, parseSheetRecords, type CardRecord } from "@/lib/card-tax-parse";

export const runtime = "nodejs";
export const maxDuration = 60;

// 카드내역 엑셀 UI 업로드 → 자동 파싱 → card_transactions_tax 반영 + 원본 엑셀 GCS 보관.
// 증분 업로드 안전(row_hash 내용기반, onConflict upsert). npm run card-tax(PC 스크립트)는 그대로 유지.
export async function POST(req: Request) {
  if (!checkAppPasscode(req)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "form 파싱 실패" }, { status: 400 }); }
  const file = form.get("file");
  const owner = String(form.get("owner") ?? "").trim();
  if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "파일 필요" }, { status: 400 });
  if (!owner) return NextResponse.json({ ok: false, error: "명의자 필요" }, { status: 400 });

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });

    const seen = new Map<string, number>();
    const all: CardRecord[] = [];
    const byCompany: Record<string, number> = {};
    let dropped = 0;
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
      const company = detectCompany(sheetName);
      const { records } = parseSheetRecords(aoa, sheetName, company, owner, seen);
      const valid = records.filter((r) => r.transaction_date); // 날짜 없는 합계·빈 행 제외
      dropped += records.length - valid.length;
      all.push(...valid);
      byCompany[company] = (byCompany[company] ?? 0) + valid.length;
    }

    if (all.length === 0) {
      return NextResponse.json({ ok: false, error: "인식된 거래내역이 없습니다(시트 형식 확인)" }, { status: 400 });
    }

    // card_transactions_tax 반영 (내용기반 row_hash upsert → 재업로드/증분 안전)
    const sb = getServerSupabase();
    let inserted = 0;
    for (let i = 0; i < all.length; i += 500) {
      const batch = all.slice(i, i + 500);
      const { error } = await sb.from("card_transactions_tax").upsert(batch, { onConflict: "row_hash" });
      if (error) throw new Error(`반영 실패: ${error.message}`);
      inserted += batch.length;
    }

    // 원본 엑셀 GCS 보관 (감사·재처리용). 실패해도 파싱 반영은 유지.
    let rawStored = "";
    try {
      const fname = (file as File).name || "card.xlsx";
      const safe = fname.replace(/[^\w.\-가-힣]/g, "_");
      const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      rawStored = `card-statements/${owner}/${ts}_${safe}`;
      await uploadOcrImage(rawStored, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) {
      console.warn("카드 원본 엑셀 보관 실패:", e instanceof Error ? e.message : e);
      rawStored = "";
    }

    // 자동규칙(빈칸 채움) best-effort
    try { await sb.rpc("apply_card_rules", { only_empty: true }); } catch { /* 함수 없거나 실패 무시 */ }

    return NextResponse.json({ ok: true, inserted, byCompany, dropped, rawStored });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "업로드 처리 실패" }, { status: 500 });
  }
}
