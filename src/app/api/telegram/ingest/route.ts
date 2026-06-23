import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { uploadOcrImage } from "@/lib/gcp/storage";
import { ocrGifticon } from "@/lib/ocr/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

const pad = (n: number) => String(n).padStart(2, "0");
const quality = (c: number) => (c >= 90 ? "high" : c >= 70 ? "medium" : "low");

// "YYMMDD 매입처" 파싱 → { purchaseDate: 'YYYY-MM-DD', supplier, hasDate }
function parseCtx(s: string) {
  const dm = s.match(/(\d{6})/);
  const purchaseDate = dm ? `20${dm[1].slice(0, 2)}-${dm[1].slice(2, 4)}-${dm[1].slice(4, 6)}` : null;
  const supplier = s.replace(/\d{6}/, "").trim();
  return { purchaseDate, supplier, hasDate: !!dm };
}

// 입력 매입처명을 마스터(purchase_vendors)의 정식 명칭으로 정규화
//  · 정확일치(공백·대소문자 무시) → 그 이름
//  · 부분일치(예: '당근' ⊂ '당근마켓', '당근마켓에서' ⊃ '당근마켓') → 길이 근접 후보
//  · 없으면 입력값 그대로(matched:false) — 봇이 마스터 미등록 경고
async function resolveVendor(
  sb: ReturnType<typeof getServerSupabase>,
  raw: string,
  cachedVendors?: { name: string }[],
): Promise<{ name: string; matched: boolean; fuzzy: boolean }> {
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const n = norm(raw);
  if (!n) return { name: raw, matched: false, fuzzy: false };
  const vendors = cachedVendors ?? ((await sb.from("purchase_vendors").select("name")).data ?? []) as { name: string }[];
  const exact = vendors.find((v) => norm(v.name) === n);
  if (exact) return { name: exact.name, matched: true, fuzzy: false };
  const cont = vendors.filter((v) => { const vn = norm(v.name); return vn && (vn.includes(n) || n.includes(vn)); });
  if (cont.length) {
    cont.sort((a, b) => Math.abs(norm(a.name).length - n.length) - Math.abs(norm(b.name).length - n.length));
    return { name: cont[0].name, matched: true, fuzzy: true };
  }
  return { name: raw, matched: false, fuzzy: false };
}

// 상품명 부분일치 매칭 (smartstore_products 마스터, [비바콘] 제거 후 비교)
async function resolveProduct(
  sb: ReturnType<typeof getServerSupabase>,
  raw: string,
): Promise<{ name: string; matched: boolean }> {
  const strip = (s: string) => s.replace(/^\[비바콘\]\s*/, "").replace(/\s+/g, "").toLowerCase();
  const n = strip(raw);
  if (!n) return { name: raw, matched: false };
  const { data } = await sb.from("smartstore_products").select("name").limit(5000);
  const prods = (data ?? []) as { name: string }[];
  const exact = prods.find((p) => strip(p.name) === n);
  if (exact) return { name: exact.name, matched: true };
  const cont = prods.filter((p) => { const pn = strip(p.name); return pn && (pn.includes(n) || n.includes(pn)); });
  if (cont.length) {
    cont.sort((a, b) => Math.abs(strip(a.name).length - n.length) - Math.abs(strip(b.name).length - n.length));
    return { name: cont[0].name, matched: true };
  }
  return { name: raw, matched: false };
}

// 텔레그램 수집 봇 webhook
//  · 텍스트 "260623 당근마켓"  → 채팅방 '현재 매입 컨텍스트' 갱신(매입일·매입처)
//  · 텍스트 "코드\n상품명\nYYMMDD" → 코드모드 진입(상품명 매칭+유효기간)
//  · 텍스트 줄바꿈 코드들        → 코드모드 시 일괄 등록
//  · 이미지(앨범 포함)           → GCP 저장 + Gemini OCR → 스테이징(검수대기)
//    (이미지에 직접 캡션 "260623 당근"을 달면 그 캡션이 우선)
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_INGEST_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const token = process.env.TELEGRAM_INGEST_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: true, skipped: "no ingest token" });

  let update: {
    message?: {
      chat?: { id?: number };
      text?: string;
      caption?: string;
      photo?: { file_id: string }[];
      document?: { file_id: string; mime_type?: string };
    };
  };
  try { update = await req.json(); } catch { return NextResponse.json({ ok: true }); }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  const allowChat = process.env.TELEGRAM_INGEST_CHAT_ID;
  if (allowChat && String(chatId) !== allowChat) return NextResponse.json({ ok: true, skipped: "other chat" });

  const sb = getServerSupabase();
  const reply = async (text: string) => {
    if (!chatId) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
    } catch { /* ignore */ }
  };

  // 이미지 유무 판별 (압축사진 우선, 문서이미지 폴백)
  const photo = msg?.photo?.length ? msg.photo[msg.photo.length - 1] : null;
  const doc = msg?.document && (msg.document.mime_type ?? "").startsWith("image/") ? msg.document : null;
  const fileId = photo?.file_id || doc?.file_id;

  // ── 텍스트만(이미지 없음): 종료 명령 또는 매입 컨텍스트 설정 ──
  if (!fileId) {
    const text = (msg?.text ?? "").trim();
    if (/^(종료|끝|stop|end)$/i.test(text) && chatId != null) {
      await sb.from("telegram_ingest_context").delete().eq("chat_id", String(chatId));
      await reply("🔒 수집 종료. 이미지를 올려도 등록되지 않습니다.\n다시 시작하려면 'YYMMDD 매입처'를 보내세요.");
      return NextResponse.json({ ok: true, stopped: true });
    }
    if (/^(도움말|help|\?)$/i.test(text)) {
      await reply(
        "📖 수집 봇 사용법\n\n" +
        "1️⃣ 매입 설정: 'YYMMDD 매입처' (예: 260623 당근)\n" +
        "   → 매입일·매입처가 설정됩니다.\n\n" +
        "2️⃣ 이미지 전송: 설정 후 쿠폰 이미지를 올리면\n" +
        "   → AI OCR → 검수대기로 자동 등록\n\n" +
        "3️⃣ 코드 등록: 줄바꿈으로\n" +
        "   코드\n   상품명(부분 OK)\n   유효기간(YYMMDD)\n" +
        "   → 코드모드 진입, 이후 코드 줄바꿈 전송\n\n" +
        "4️⃣ 종료: '종료' 또는 '끝'\n" +
        "   → 수집 중지(실수 방지)\n\n" +
        "💡 매입처가 바뀌면 새로 'YYMMDD 매입처' 전송\n" +
        "💡 캡션에 'YYMMDD 매입처'를 직접 달면 그 장만 적용"
      );
      return NextResponse.json({ ok: true, help: true });
    }

    // ── 코드모드 진입: "코드\n상품명\nYYMMDD" ──
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (lines[0] === "코드" && lines.length >= 3 && chatId != null) {
      const productRaw = lines[1];
      const expiryRaw = lines[2];
      const expiryMatch = expiryRaw.match(/^(\d{6})$/);
      if (!expiryMatch) {
        await reply("⚠️ 유효기간은 YYMMDD 6자리로 입력해 주세요. (예: 261231)");
        return NextResponse.json({ ok: true });
      }
      const expDate = `20${expiryRaw.slice(0, 2)}-${expiryRaw.slice(2, 4)}-${expiryRaw.slice(4, 6)}`;
      const prod = await resolveProduct(sb, productRaw);
      const displayName = prod.matched ? prod.name.replace(/^\[비바콘\]\s*/, "") : productRaw;
      await sb.from("telegram_ingest_context").upsert({
        chat_id: String(chatId),
        code_mode: true, code_product: prod.name, code_expiry: expDate,
        updated_at: new Date().toISOString(),
      });
      const matchTag = prod.matched ? "" : "\n⚠️ 상품 미매칭 — 검수에서 수정 가능";
      await reply(`📋 코드 수집 모드: ${displayName} (~${expDate})${matchTag}\n코드를 줄바꿈으로 보내주세요. 완료 후 '종료' 또는 새 매입설정.`);
      return NextResponse.json({ ok: true, codeMode: true });
    }

    // ── 코드모드 활성 시: 줄바꿈 코드들 일괄 등록 ──
    if (chatId != null) {
      const { data: ctxRow } = await sb.from("telegram_ingest_context")
        .select("purchase_date, supplier, code_mode, code_product, code_expiry")
        .eq("chat_id", String(chatId)).maybeSingle();
      if (ctxRow?.code_mode && lines.length >= 1) {
        const codes = lines.filter((l) => l.length >= 4);
        if (codes.length === 0) {
          await reply("⚠️ 유효한 코드가 없습니다. (4자리 이상)");
          return NextResponse.json({ ok: true });
        }
        const purchaseDate = ctxRow.purchase_date as string | null;
        const supplier = (ctxRow.supplier as string) ?? "";
        const productName = (ctxRow.code_product as string) ?? "";
        const expiry = (ctxRow.code_expiry as string) ?? "";
        const now = new Date();
        const ymd = purchaseDate ? String(purchaseDate).replaceAll("-", "").slice(2)
          : `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
        const batchNo = supplier ? `TG-${ymd}-${supplier}` : `TG-${ymd}`;
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
        const inserts = codes.map((code) => ({
          batch_id: batchId,
          image_path: "",
          product_name: productName,
          coupon_code: code.replace(/\s+/g, ""),
          expiry_date: expiry || null,
          exchange_location: "",
          supplier,
          purchase_date: purchaseDate,
          ocr_confidence: 100,
          extraction_quality: "high",
          inspection_status: "pending",
          stored_as_code: true,
        }));
        const { error: ie } = await sb.from("stock_registrations").insert(inserts);
        if (ie) throw new Error(ie.message);
        const displayName = productName.replace(/^\[비바콘\]\s*/, "");
        await reply(`✅ ${codes.length}건 등록(검수대기): ${displayName}\n배치 ${batchNo}${supplier ? ` · ${supplier}` : ""}${purchaseDate ? ` · ${purchaseDate}` : ""}\n\n추가 코드를 보내거나, 다른 상품은 '코드\\n상품명\\nYYMMDD', 종료는 '종료'.`);
        return NextResponse.json({ ok: true, codes: codes.length });
      }
    }

    // ── 매입 컨텍스트 설정 (YYMMDD 매입처) ──
    const ctx = parseCtx(text);
    if (ctx.hasDate && chatId != null) {
      const v = await resolveVendor(sb, ctx.supplier);
      // 매입 설정 시 코드모드 해제
      await sb.from("telegram_ingest_context").upsert({
        chat_id: String(chatId), purchase_date: ctx.purchaseDate, supplier: v.name,
        code_mode: false, code_product: "", code_expiry: "",
        updated_at: new Date().toISOString(),
      });
      const tag = !ctx.supplier ? "" : v.matched ? (v.fuzzy ? ` (입력 '${ctx.supplier}' → 매칭)` : "") : " ⚠️ 마스터 미등록(설정>매입처에 추가 권장)";
      await reply(`📌 매입 설정: ${ctx.purchaseDate}${v.name ? ` · ${v.name}` : ""}${tag}\n이미지 → 자동 OCR 등록 / 코드 → '코드\\n상품명\\nYYMMDD'로 전환`);
    }
    return NextResponse.json({ ok: true, context: ctx.hasDate });
  }

  // ── 이미지: 컨텍스트(캡션 우선 → 저장된 컨텍스트) 적용 ──
  try {
    const { data: vendorRows } = await sb.from("purchase_vendors").select("name");
    const vendorCache = (vendorRows ?? []) as { name: string }[];
    const cap = parseCtx((msg?.caption ?? "").trim());
    let purchaseDate: string | null = null;
    let supplier = "";
    if (cap.hasDate) {
      const v = await resolveVendor(sb, cap.supplier, vendorCache);
      purchaseDate = cap.purchaseDate; supplier = v.name;
      if (chatId != null) await sb.from("telegram_ingest_context").upsert({
        chat_id: String(chatId), purchase_date: purchaseDate, supplier, updated_at: new Date().toISOString(),
      });
    } else if (chatId != null) {
      const { data: row } = await sb.from("telegram_ingest_context")
        .select("purchase_date, supplier").eq("chat_id", String(chatId)).maybeSingle();
      if (row) { purchaseDate = row.purchase_date as string | null; supplier = (row.supplier as string) ?? ""; }
    }

    // 파일 다운로드
    const gf = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)).json();
    const filePath = gf?.result?.file_path;
    if (!filePath) { await reply("⚠️ 파일을 가져오지 못했어요."); return NextResponse.json({ ok: true }); }
    const buf = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)).arrayBuffer());
    const isPng = filePath.toLowerCase().endsWith(".png");
    const mime = isPng ? "image/png" : "image/jpeg";

    // 배치 확보 (매입일+매입처 기준 TG-YYMMDD-매입처, 미설정 시 오늘)
    const now = new Date();
    const ymd = purchaseDate ? purchaseDate.replaceAll("-", "").slice(2)
      : `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const batchNo = supplier ? `TG-${ymd}-${supplier}` : `TG-${ymd}`;
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

    // GCP 업로드
    const destPath = `${ymd}/${batchNo}/${crypto.randomUUID()}.${isPng ? "png" : "jpg"}`;
    await uploadOcrImage(destPath, buf, mime);

    // OCR (실패해도 빈값 등록 → 모바일 검수에서 보정). 실패사유는 ocr_raw 보존 + 회신 노출
    let ocr = { product_name: "", coupon_code: "", expiry_date: "", exchange_location: "", confidence: 0 };
    let raw: unknown = null;
    let ocrErr = "";
    try { const r = await ocrGifticon(buf.toString("base64"), mime); ocr = r.result; raw = r.raw; }
    catch (e) { ocrErr = e instanceof Error ? e.message : "ocr failed"; raw = { ocr_error: ocrErr }; }

    // 중복 감지: 동일 쿠폰번호가 스테이징 또는 비바콘 재고에 있으면 경고
    let dupNote = "";
    if (ocr.coupon_code) {
      const { data: dupStg } = await sb.from("stock_registrations")
        .select("id").eq("coupon_code", ocr.coupon_code).limit(1);
      if (dupStg?.length) dupNote = "\n⚠️ 중복: 이미 스테이징에 동일 쿠폰번호 존재";
      else {
        try {
          const { getVivaconSupabase } = await import("@/lib/supabase/vivacon");
          const vc = getVivaconSupabase();
          const { data: dupVc } = await vc.from("coupon_codes").select("id").eq("coupon_code", ocr.coupon_code).limit(1);
          if (dupVc?.length) dupNote = "\n⚠️ 중복: 비바콘 재고에 동일 쿠폰번호 존재";
        } catch { /* vivacon 미연결 시 무시 */ }
      }
    }

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
      ocr_raw: raw,
      inspection_status: "pending",
      stored_as_code: true,
    });
    if (ie) throw new Error(ie.message);

    const codeMask = ocr.coupon_code ? ocr.coupon_code.slice(0, 2) + "***" : "(코드 미인식)";
    const ctxNote = !purchaseDate && !supplier ? "\n⚠️ 매입일·매입처 미설정 — 먼저 'YYMMDD 매입처' 한 줄을 보내세요." : "";
    const ocrNote = ocrErr ? `\n⚠️ OCR 실패: ${ocrErr}` : (!ocr.product_name && !ocr.coupon_code ? "\n⚠️ OCR 인식 0건 — 검수에서 수동 입력하세요." : "");
    await reply(`✅ 등록(검수대기): ${ocr.product_name || "상품명 미인식"} / 코드 ${codeMask}\n배치 ${batchNo}${supplier ? ` · ${supplier}` : ""}${purchaseDate ? ` · ${purchaseDate}` : ""}${ctxNote}${ocrNote}${dupNote}`);
    return NextResponse.json({ ok: true, batch: batchNo });
  } catch (e) {
    await reply("⚠️ 처리 실패: " + (e instanceof Error ? e.message : "오류"));
    return NextResponse.json({ ok: true });
  }
}
