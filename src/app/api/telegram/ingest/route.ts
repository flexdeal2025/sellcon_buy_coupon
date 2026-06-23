import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { uploadOcrImage } from "@/lib/gcp/storage";
import { ocrGifticon } from "@/lib/ocr/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

const pad = (n: number) => String(n).padStart(2, "0");
const quality = (c: number) => (c >= 90 ? "high" : c >= 70 ? "medium" : "low");

// 텔레그램 수집 봇 webhook: 매입 공유방에 올린 쿠폰 이미지 → GCP 저장 + OCR → 스테이징(검수대기)
//  캡션 예: "260623 당근" → 매입일/매입처 자동
export async function POST(req: Request) {
  // 보안: setWebhook 시 지정한 secret 헤더 검증
  const secret = process.env.TELEGRAM_INGEST_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const token = process.env.TELEGRAM_INGEST_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: true, skipped: "no ingest token" });

  let update: {
    message?: {
      chat?: { id?: number };
      caption?: string;
      photo?: { file_id: string }[];
      document?: { file_id: string; mime_type?: string };
    };
  };
  try { update = await req.json(); } catch { return NextResponse.json({ ok: true }); }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  // 지정 수집방만 처리 (설정 시)
  const allowChat = process.env.TELEGRAM_INGEST_CHAT_ID;
  if (allowChat && String(chatId) !== allowChat) return NextResponse.json({ ok: true, skipped: "other chat" });

  // 이미지 추출 (압축사진 우선, 문서이미지 폴백)
  const photo = msg?.photo?.length ? msg.photo[msg.photo.length - 1] : null;
  const doc = msg?.document && (msg.document.mime_type ?? "").startsWith("image/") ? msg.document : null;
  const fileId = photo?.file_id || doc?.file_id;
  if (!fileId) return NextResponse.json({ ok: true, skipped: "no image" }); // 텍스트 등은 무시(이미지만)

  const reply = async (text: string) => {
    if (!chatId) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
    } catch { /* ignore */ }
  };

  try {
    // 1) 파일 경로 → 다운로드
    const gf = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)).json();
    const filePath = gf?.result?.file_path;
    if (!filePath) { await reply("⚠️ 파일을 가져오지 못했어요."); return NextResponse.json({ ok: true }); }
    const buf = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)).arrayBuffer());
    const isPng = filePath.toLowerCase().endsWith(".png");
    const mime = isPng ? "image/png" : "image/jpeg";

    // 2) 캡션 파싱: YYMMDD + 매입처
    const caption = (msg?.caption ?? "").trim();
    const dm = caption.match(/(\d{6})/);
    const purchaseDate = dm ? `20${dm[1].slice(0, 2)}-${dm[1].slice(2, 4)}-${dm[1].slice(4, 6)}` : null;
    const supplier = caption.replace(/\d{6}/, "").trim();

    // 3) 배치 확보 (일자별 TG-YYMMDD)
    const sb = getServerSupabase();
    const now = new Date();
    const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const batchNo = `TG-${ymd}`;
    let batchId: string;
    const { data: existing } = await sb.from("stock_batches").select("id").eq("batch_no", batchNo).maybeSingle();
    if (existing?.id) batchId = existing.id;
    else {
      const { data: nb, error: be } = await sb.from("stock_batches")
        .insert({ batch_no: batchNo, storage_type: "code", default_exchange_location: supplier, purchase_date: purchaseDate, created_by: "telegram" })
        .select("id").single();
      if (be) throw new Error(be.message);
      batchId = nb.id;
    }

    // 4) GCP 업로드
    const ext = isPng ? "png" : "jpg";
    const destPath = `${ymd}/${batchNo}/${crypto.randomUUID()}.${ext}`;
    await uploadOcrImage(destPath, buf, mime);

    // 5) OCR (실패해도 빈값 등록 → 모바일 검수에서 보정)
    let ocr = { product_name: "", coupon_code: "", expiry_date: "", exchange_location: "", confidence: 0 };
    try { ocr = (await ocrGifticon(buf.toString("base64"), mime)).result; } catch { /* keep empty */ }

    // 6) 스테이징 등록
    const { error: ie } = await sb.from("stock_registrations").insert({
      batch_id: batchId,
      image_path: destPath,
      product_name: ocr.product_name,
      coupon_code: ocr.coupon_code,
      expiry_date: ocr.expiry_date || null,
      exchange_location: ocr.exchange_location,
      supplier,
      purchase_date: purchaseDate,
      ocr_confidence: ocr.confidence,
      extraction_quality: quality(ocr.confidence),
      inspection_status: "pending",
      stored_as_code: true,
    });
    if (ie) throw new Error(ie.message);

    const codeMask = ocr.coupon_code ? ocr.coupon_code.slice(0, 2) + "***" : "(코드 미인식)";
    await reply(`✅ 등록(검수대기): ${ocr.product_name || "상품명 미인식"} / 코드 ${codeMask}\n배치 ${batchNo}${supplier ? ` · ${supplier}` : ""}${purchaseDate ? ` · ${purchaseDate}` : ""}`);
    return NextResponse.json({ ok: true, batch: batchNo });
  } catch (e) {
    await reply("⚠️ 처리 실패: " + (e instanceof Error ? e.message : "오류"));
    return NextResponse.json({ ok: true });
  }
}
