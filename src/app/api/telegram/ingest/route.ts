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

const DEFAULT_OPTION = "유효기간 최소 10일 이상 쿠폰 발송";

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

// 상품명 → 옵션명 자동매핑 (product_option_map 부분일치, 미매칭 시 기본값)
async function resolveOptionName(
  sb: ReturnType<typeof getServerSupabase>,
  productName: string,
): Promise<string> {
  const norm = (s: string) => s.replace(/^\[비바콘\]\s*/, "").replace(/\s+/g, "").toLowerCase();
  const n = norm(productName);
  if (!n) return DEFAULT_OPTION;
  const { data } = await sb.from("product_option_map").select("product_match, option_name");
  const maps = (data ?? []) as { product_match: string; option_name: string }[];
  const hit = maps.find((m) => n.includes(norm(m.product_match)));
  return hit?.option_name ?? DEFAULT_OPTION;
}

// YYMMDD 문자열 (매입일 우선, 없으면 오늘) — 배치명·경로 공통
function ymdOf(purchaseDate: string | null): string {
  if (purchaseDate) return String(purchaseDate).replaceAll("-", "").slice(2);
  const now = new Date();
  return `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

// 배치 확보(없으면 생성). batchNo = TG-YYMMDD[-매입처]. storageType 으로 배치 라벨(이미지/코드) 지정.
// 기존 배치의 라벨이 현재 모드와 다르면 갱신(자가치유) — 이미지형/코드형 표시 정확화.
async function ensureBatch(
  sb: ReturnType<typeof getServerSupabase>,
  batchNo: string, supplier: string, purchaseDate: string | null,
  storageType: "image" | "code" = "code",
): Promise<string> {
  const { data: existing } = await sb.from("stock_batches").select("id, storage_type").eq("batch_no", batchNo).maybeSingle();
  if (existing?.id) {
    if (existing.storage_type !== storageType) {
      await sb.from("stock_batches").update({ storage_type: storageType }).eq("id", existing.id);
    }
    return existing.id as string;
  }
  const { data: nb, error: be } = await sb.from("stock_batches")
    .insert({ batch_no: batchNo, storage_type: storageType, default_exchange_location: supplier, purchase_date: purchaseDate, created_by: "telegram" })
    .select("id").single();
  if (be) throw new Error(be.message);
  return nb.id as string;
}

// 유효기간 경고 (YYYY-MM-DD). 만료=🔴 / 임박(D-10 이내)=🟡 / 그 외·미인식="".
// 기본 판매 약속이 '유효기간 최소 10일 이상'이므로 10일을 임박 기준으로 둔다.
function expiryWarning(expiry: string | null | undefined): string {
  if (!expiry) return "";
  const d = new Date(`${expiry}T00:00:00`);
  if (isNaN(d.getTime())) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.floor((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return `\n🔴 만료됨(${expiry}) — 등록 보류 권장`;
  if (days <= 10) return `\n🟡 유효기간 임박(${expiry}, D-${days})`;
  return "";
}

// 직전 등록 id 묶음을 컨텍스트에 저장('취소' 명령용).
// last_insert_ids 컬럼이 없으면(마이그레이션 미적용) 조용히 무시 — 정상흐름 보존.
async function storeLastIds(
  sb: ReturnType<typeof getServerSupabase>,
  chatId: number | undefined, ids: string[],
): Promise<void> {
  if (chatId == null || !ids.length) return;
  try { await sb.from("telegram_ingest_context").update({ last_insert_ids: ids }).eq("chat_id", String(chatId)); }
  catch { /* 컬럼 미존재 등 — 무시 */ }
}

// 코드 묶음 중복 카운트(읽기전용): 스테이징 + 비바콘 재고에 이미 있는 코드 수
async function countDuplicateCodes(
  sb: ReturnType<typeof getServerSupabase>,
  codes: string[],
): Promise<number> {
  const found = new Set<string>();
  const { data: stg } = await sb.from("stock_registrations").select("coupon_code").in("coupon_code", codes);
  (stg ?? []).forEach((r: { coupon_code: string }) => r.coupon_code && found.add(r.coupon_code));
  try {
    const { getVivaconSupabase } = await import("@/lib/supabase/vivacon");
    const vc = getVivaconSupabase();
    const { data: vcRows } = await vc.from("coupon_codes").select("coupon_code").in("coupon_code", codes);
    (vcRows ?? []).forEach((r: { coupon_code: string }) => r.coupon_code && found.add(r.coupon_code));
  } catch { /* vivacon 미연결 시 무시 */ }
  return codes.filter((c) => found.has(c)).length;
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
    // ── 취소: 직전 등록 묶음 되돌리기(검수대기·미발행만 삭제) ──
    if (/^(취소|되돌리기|undo)$/i.test(text) && chatId != null) {
      const { data: ctx } = await sb.from("telegram_ingest_context").select("*").eq("chat_id", String(chatId)).maybeSingle();
      const ids = (ctx?.last_insert_ids as string[] | undefined) ?? null;
      if (!ids || ids.length === 0) {
        await reply("↩️ 취소할 직전 등록이 없습니다.\n(업데이트 미적용 시 schema_telegram_ingest_v2.sql 실행 필요)");
        return NextResponse.json({ ok: true, cancelled: 0 });
      }
      // 안전 가드: 검수대기(pending) + 미발행(published=false) 행만 삭제
      const { data: del, error: de } = await sb.from("stock_registrations")
        .delete().in("id", ids).eq("inspection_status", "pending").eq("published", false)
        .select("id");
      if (de) { await reply("⚠️ 취소 실패: " + de.message); return NextResponse.json({ ok: true }); }
      const removed = del?.length ?? 0;
      const protectedN = ids.length - removed;
      try { await sb.from("telegram_ingest_context").update({ last_insert_ids: [] }).eq("chat_id", String(chatId)); } catch { /* noop */ }
      await reply(`↩️ 직전 등록 ${removed}건 취소(삭제)했습니다.${protectedN > 0 ? `\n(검수완료·발행분 ${protectedN}건은 보호되어 제외)` : ""}`);
      return NextResponse.json({ ok: true, cancelled: removed });
    }
    // ── 저장형식 선택 (수집 첫 단계): '이미지형' / '코드형' ──
    if (/^(이미지형|이미지)$/i.test(text) && chatId != null) {
      await sb.from("telegram_ingest_context").upsert({
        chat_id: String(chatId), storage_mode: "image", code_mode: false,
        updated_at: new Date().toISOString(),
      });
      await reply("🖼️ 이미지형 선택됨.\n다음: 'YYMMDD 매입처'를 보낸 뒤(예: 260625 당근), 쿠폰 이미지를 올려주세요.\n→ 이미지형 재고로 등록됩니다.");
      return NextResponse.json({ ok: true, mode: "image" });
    }
    if (/^(코드형|코드입력)$/i.test(text) && chatId != null) {
      await sb.from("telegram_ingest_context").upsert({
        chat_id: String(chatId), storage_mode: "code", code_mode: false,
        updated_at: new Date().toISOString(),
      });
      await reply("🔢 코드형 선택됨.\n다음: 'YYMMDD 매입처'를 보낸 뒤, '코드\\n상품명\\nYYMMDD'로 코드를 등록하세요.\n→ 코드형 재고로 등록됩니다.");
      return NextResponse.json({ ok: true, mode: "code" });
    }
    // 도움말: /help · /start · 도움말 · help · ? (그룹의 /help@봇이름 형태도 허용)
    if (/^(\/(help|start)(@\w+)?|도움말|help|\?)$/i.test(text)) {
      await reply(
        "📖 수집 봇 사용법 (순서대로)\n\n" +
        "1️⃣ 저장형식 선택: '이미지형' 또는 '코드형'\n\n" +
        "2️⃣ 매입 설정: 'YYMMDD 매입처' (예: 260623 당근)\n\n" +
        "3️⃣ 수집:\n" +
        "   • 이미지형 → 쿠폰 이미지 업로드 (AI OCR → 검수대기)\n" +
        "   • 코드형 → '코드\\n상품명(부분 OK)\\n유효기간(YYMMDD)' 보낸 뒤 코드 줄바꿈 전송\n\n" +
        "🔚 종료: '종료'/'끝' · ↩️ 취소: '취소'(직전 묶음 삭제)\n" +
        "💡 형식을 바꾸려면 '이미지형'/'코드형' 다시 전송\n" +
        "💡 매입처가 바뀌면 새로 'YYMMDD 매입처' 전송\n" +
        "💡 이 도움말 다시 보기: /help"
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
      const optName = await resolveOptionName(sb, prod.name);
      const displayName = prod.matched ? prod.name.replace(/^\[비바콘\]\s*/, "") : productRaw;
      await sb.from("telegram_ingest_context").upsert({
        chat_id: String(chatId),
        code_mode: true, storage_mode: "code", code_product: prod.name, code_expiry: expDate,
        updated_at: new Date().toISOString(),
      });
      const matchTag = prod.matched ? "" : "\n⚠️ 상품 미매칭 — 검수에서 수정 가능";
      const optTag = optName !== DEFAULT_OPTION ? `\n옵션: ${optName}` : `\n옵션: ${DEFAULT_OPTION} (기본)`;
      await reply(`📋 코드 수집 모드: ${displayName} (~${expDate})${optTag}${matchTag}\n코드를 줄바꿈으로 보내주세요. 완료 후 '종료' 또는 새 매입설정.`);
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
        // 매입일 미설정 보류 — 돈 추적이 끊기지 않도록 등록 전 차단
        if (!purchaseDate) {
          await reply("⏸️ 등록 보류 — 먼저 매입일을 설정하세요.\n'YYMMDD 매입처' 한 줄을 보낸 뒤 코드를 다시 보내주세요. (예: 260623 당근)");
          return NextResponse.json({ ok: true, held: "no-context" });
        }
        const ymd = ymdOf(purchaseDate);
        const batchNo = supplier ? `TG-${ymd}-${supplier}` : `TG-${ymd}`;
        const batchId = await ensureBatch(sb, batchNo, supplier, purchaseDate, "code");
        const optName = await resolveOptionName(sb, productName);
        const cleanCodes = codes.map((code) => code.replace(/\s+/g, ""));
        const dupCount = await countDuplicateCodes(sb, cleanCodes);
        const inserts = cleanCodes.map((code) => ({
          batch_id: batchId,
          image_path: "",
          product_name: productName,
          option_name: optName,
          coupon_code: code,
          expiry_date: expiry || null,
          exchange_location: "",
          supplier,
          purchase_date: purchaseDate,
          ocr_confidence: 100,
          extraction_quality: "high",
          inspection_status: "pending",
          stored_as_code: true,
        }));
        const { data: insRows, error: ie } = await sb.from("stock_registrations").insert(inserts).select("id");
        if (ie) throw new Error(ie.message);
        await storeLastIds(sb, chatId, (insRows ?? []).map((r) => r.id as string));
        const displayName = productName.replace(/^\[비바콘\]\s*/, "");
        const dupNote = dupCount > 0 ? `\n⚠️ 이 중 ${dupCount}건은 기존 재고와 코드 중복(검수 확인)` : "";
        const expNote = expiryWarning(expiry);
        await reply(`✅ ${codes.length}건 등록(검수대기): ${displayName}\n배치 ${batchNo}${supplier ? ` · ${supplier}` : ""} · ${purchaseDate}${expNote}${dupNote}\n\n추가 코드를 보내거나, 다른 상품은 '코드\\n상품명\\nYYMMDD', 종료는 '종료', 직전 취소는 '취소'.`);
        return NextResponse.json({ ok: true, codes: codes.length, dup: dupCount });
      }
    }

    // ── 매입 컨텍스트 설정 (YYMMDD 매입처) ──
    const ctx = parseCtx(text);
    if (ctx.hasDate && chatId != null) {
      const v = await resolveVendor(sb, ctx.supplier);
      // 매입 설정 시 코드모드만 해제(storage_mode 는 보존 — 미지정 컬럼은 upsert가 건드리지 않음)
      await sb.from("telegram_ingest_context").upsert({
        chat_id: String(chatId), purchase_date: ctx.purchaseDate, supplier: v.name,
        code_mode: false, code_product: "", code_expiry: "",
        updated_at: new Date().toISOString(),
      });
      // 현재 저장형식 조회 → 다음 단계 안내
      const { data: cur } = await sb.from("telegram_ingest_context").select("*").eq("chat_id", String(chatId)).maybeSingle();
      const mode = (cur?.storage_mode as string) ?? "";
      const next = mode === "image" ? "이제 쿠폰 이미지를 올리면 이미지형으로 등록됩니다."
        : mode === "code" ? "이제 '코드\\n상품명\\nYYMMDD'로 코드를 등록하세요."
        : "⚠️ '이미지형' 또는 '코드형'을 먼저 선택하세요.";
      const tag = !ctx.supplier ? "" : v.matched ? (v.fuzzy ? ` (입력 '${ctx.supplier}' → 매칭)` : "") : " ⚠️ 마스터 미등록(설정>매입처에 추가 권장)";
      await reply(`📌 매입 설정: ${ctx.purchaseDate}${v.name ? ` · ${v.name}` : ""}${tag}\n${next}`);
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

    // 저장형식 게이트 — 이미지형 모드에서만 이미지 등록(미선택/코드형이면 보류)
    let storageMode = "";
    if (chatId != null) {
      const { data: smRow } = await sb.from("telegram_ingest_context").select("*").eq("chat_id", String(chatId)).maybeSingle();
      storageMode = (smRow?.storage_mode as string) ?? "";
    }
    if (storageMode !== "image") {
      await reply(storageMode === "code"
        ? "🔢 코드형 모드입니다 — 이미지 대신 '코드\\n상품명\\nYYMMDD'로 등록하거나, 이미지형으로 바꾸려면 '이미지형'을 보내세요."
        : "먼저 저장형식을 선택하세요 — '이미지형' 또는 '코드형'.");
      return NextResponse.json({ ok: true, held: "no-mode" });
    }

    // 매입일 미설정 보류 — OCR/업로드 비용 쓰기 전에 차단(돈 추적 끊김 방지)
    if (!purchaseDate) {
      await reply("⏸️ 등록 보류 — 먼저 매입일을 설정하세요.\n'YYMMDD 매입처' 한 줄을 보내거나, 이미지 캡션에 직접 달아주세요. (예: 260623 당근)");
      return NextResponse.json({ ok: true, held: "no-context" });
    }

    // 파일 다운로드
    const gf = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)).json();
    const filePath = gf?.result?.file_path;
    if (!filePath) { await reply("⚠️ 파일을 가져오지 못했어요."); return NextResponse.json({ ok: true }); }
    const buf = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)).arrayBuffer());
    const isPng = filePath.toLowerCase().endsWith(".png");
    const mime = isPng ? "image/png" : "image/jpeg";

    // 배치 확보 (매입일+매입처 기준 TG-YYMMDD-매입처)
    const ymd = ymdOf(purchaseDate);
    const batchNo = supplier ? `TG-${ymd}-${supplier}` : `TG-${ymd}`;
    const batchId = await ensureBatch(sb, batchNo, supplier, purchaseDate, "image");

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

    const { data: insRow, error: ie } = await sb.from("stock_registrations").insert({
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
      stored_as_code: false,   // 이미지형 모드에서만 도달 → 이미지형으로 저장
    }).select("id").single();
    if (ie) throw new Error(ie.message);
    if (insRow?.id) await storeLastIds(sb, chatId, [insRow.id as string]);

    const codeMask = ocr.coupon_code ? ocr.coupon_code.slice(0, 2) + "***" : "(코드 미인식)";
    const ctxNote = !supplier ? "\n⚠️ 매입처 미설정 — 'YYMMDD 매입처'로 설정 권장(증빙 추적)" : "";
    const ocrNote = ocrErr ? `\n⚠️ OCR 실패: ${ocrErr}` : (!ocr.product_name && !ocr.coupon_code ? "\n⚠️ OCR 인식 0건 — 검수에서 수동 입력하세요." : "");
    const expNote = expiryWarning(ocr.expiry_date);
    await reply(`✅ 등록(검수대기·이미지형): ${ocr.product_name || "상품명 미인식"} / 코드 ${codeMask}\n배치 ${batchNo}${supplier ? ` · ${supplier}` : ""} · ${purchaseDate}${expNote}${ctxNote}${ocrNote}${dupNote}`);
    return NextResponse.json({ ok: true, batch: batchNo });
  } catch (e) {
    await reply("⚠️ 처리 실패: " + (e instanceof Error ? e.message : "오류"));
    return NextResponse.json({ ok: true });
  }
}
