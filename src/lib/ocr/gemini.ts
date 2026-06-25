/**
 * Gemini 기반 기프티콘 OCR (서버 전용).
 * 이미지에서 상품명·쿠폰번호·유효기간·교환처를 추출.
 */
export interface OcrResult {
  product_name: string;
  coupon_code: string;
  expiry_date: string; // YYYY-MM-DD ('' 가능)
  exchange_location: string;
  confidence: number; // 0~100
}

const PROMPT = `이 모바일 상품권(기프티콘) 이미지에서 아래 항목을 추출해 JSON으로만 답하라.
{
 "product_name": "상품명",
 "coupon_code": "바코드 아래의 쿠폰번호(숫자/문자, 공백 제거)",
 "expiry_date": "유효기간 YYYY-MM-DD",
 "exchange_location": "교환처(예: GS25, CU, 스타벅스, BBQ)",
 "confidence": 0~100 정수(추출 확신도)
}
못 읽는 항목은 빈 문자열("")로. 날짜는 반드시 YYYY-MM-DD 형식.`;

export async function ocrGifticon(
  imageBase64: string,
  mimeType: string,
): Promise<{ result: OcrResult; raw: unknown }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 미설정");
  const models = [
    process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
  ];

  const body = JSON.stringify({
    contents: [
      { parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] },
    ],
    generationConfig: { response_mime_type: "application/json" },
  });

  let res: Response | null = null;
  const MAX_TRIES = 3;
  for (let i = 0; i < MAX_TRIES; i++) {
    const model = i < 2 ? models[0] : models[1];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok || (res.status !== 429 && res.status !== 503)) break;
    if (i < MAX_TRIES - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }

  if (!res?.ok) {
    const t = await res?.text().catch(() => "") ?? "";
    throw new Error(`Gemini 오류 (${res?.status}): ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  let parsed: Partial<OcrResult> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OCR 응답 파싱 실패");
  }

  const expiry = String(parsed.expiry_date ?? "").trim();
  return {
    result: {
      product_name: String(parsed.product_name ?? "").trim(),
      coupon_code: String(parsed.coupon_code ?? "").replace(/\s+/g, "").trim(),
      expiry_date: /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : "",
      exchange_location: String(parsed.exchange_location ?? "").trim(),
      confidence: Number(parsed.confidence ?? 0) || 0,
    },
    raw: data,
  };
}

// ─── 당근 거래내역 증빙 OCR ─────────────────────────────────────────────────

export interface ProofOcrResult {
  platform: string;          // "당근마켓"(기본)
  trade_type: string;        // "바로구매" | "머니송금" | ""
  product_name_raw: string;  // 화면에 보이는 원문
  product_name: string;      // 접두·접미사 제거 후 정제
  trader_name: string;       // 거래한 사람
  proof_date: string;        // YYYY-MM-DD ('' 가능)
  trade_datetime: string;    // YYYY-MM-DD HH:mm ('' 가능)
  total_amount: number;      // 총 결제/송금액 (실제 지출)
  product_amount: number;    // 상품 금액(바로구매), 없으면 total과 동일
  trade_no: string;          // 거래번호(KPE…), 머니송금이면 ""
  confidence: number;        // 0~100
}

/** 상품명 정제: [판매]/팝니다/기프티콘 등 거래 접두·접미사 제거 */
export function cleanProofProductName(raw: string): string {
  return String(raw ?? "")
    .replace(/\[[^\]]*\]/g, " ")                         // [판매] [삽니다] [급처] …
    .replace(/(팝니다|삽니다|판매합니다|판매|구해요|구합니다)\s*$/g, " ")
    .replace(/\b(기프티콘|교환권|모바일상품권|상품권|쿠폰)\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PROOF_PROMPT = `이 이미지는 당근마켓(당근페이) 거래 "상세 내역" 화면이다. 아래 항목을 추출해 JSON으로만 답하라.
{
 "trade_type": "바로구매 또는 머니송금 (화면 상단 좌측 라벨)",
 "product_name_raw": "상품명/송금 제목 원문 그대로",
 "trader_name": "'거래한 사람' 옆의 이름",
 "trade_datetime": "'일시' 값을 YYYY-MM-DD HH:mm 형식으로",
 "total_amount": 총 결제 금액 또는 송금액(숫자만, 부호·콤마 제거),
 "product_amount": "상품 금액"(있으면 숫자만, 없으면 0),
 "trade_no": "거래번호(KPE로 시작). 없으면 빈 문자열",
 "confidence": 0~100 정수
}
규칙: 금액은 정수만. 못 읽는 항목은 빈 문자열("") 또는 0. 날짜시각은 반드시 YYYY-MM-DD HH:mm.`;

export async function ocrPurchaseProof(
  imageBase64: string,
  mimeType: string,
): Promise<{ result: ProofOcrResult; raw: unknown }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 미설정");
  const models = [process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite", "gemini-2.5-flash"];

  const body = JSON.stringify({
    contents: [{ parts: [{ text: PROOF_PROMPT }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
    generationConfig: { response_mime_type: "application/json" },
  });

  let res: Response | null = null;
  const MAX_TRIES = 3;
  for (let i = 0; i < MAX_TRIES; i++) {
    const model = i < 2 ? models[0] : models[1];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok || (res.status !== 429 && res.status !== 503)) break;
    if (i < MAX_TRIES - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  if (!res?.ok) {
    const t = (await res?.text().catch(() => "")) ?? "";
    throw new Error(`Gemini 오류 (${res?.status}): ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  let p: Record<string, unknown> = {};
  try { p = JSON.parse(text); } catch { throw new Error("증빙 OCR 응답 파싱 실패"); }

  const num = (v: unknown) => {
    const n = Number(String(v ?? "").replace(/[^0-9]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const dt = String(p.trade_datetime ?? "").trim();
  const dtMatch = dt.match(/^(\d{4}-\d{2}-\d{2})/);
  const raw = String(p.product_name_raw ?? "").trim();
  const total = num(p.total_amount);
  const prodAmt = num(p.product_amount);

  return {
    result: {
      platform: "당근마켓",
      trade_type: String(p.trade_type ?? "").trim(),
      product_name_raw: raw,
      product_name: cleanProofProductName(raw),
      trader_name: String(p.trader_name ?? "").trim(),
      proof_date: dtMatch ? dtMatch[1] : "",
      trade_datetime: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(dt) ? dt.slice(0, 16) : (dtMatch ? dtMatch[1] : ""),
      total_amount: total,
      product_amount: prodAmt || total,
      trade_no: String(p.trade_no ?? "").trim(),
      confidence: Number(p.confidence ?? 0) || 0,
    },
    raw: data,
  };
}

/** 영문/숫자/underscore 만 남기는 정제 */
export function sanitizeSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

/**
 * 한국어 상품명 → 영문 슬러그 (파일명·식별용). 슬러그만 보고 상품을 추정 가능하게.
 * 구성: 브랜드[_금액/규격][_유형]  예: "메가MGC커피 1만원권 잔액관리형" → "megacoffee_1man_bal"
 */
export async function slugifyProductName(name: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";
  const prompt = `다음 한국어 상품명을 영문 슬러그로 변환하라. 목적: 슬러그만 보고 어떤 상품인지 추정 가능해야 함.
규칙: 소문자, 단어 구분 underscore(_), 영문/숫자만, 40자 이내. 구성 = 브랜드[_금액/규격][_유형]
- 브랜드: 핵심 브랜드 영문 (메가MGC커피→megacoffee, 메가박스→megabox, CGV→cgv, 스타벅스→starbucks, GS25→gs25)
- 금액권: 만원→nman / 천원→ncheon (1만원→1man, 3만원→3man, 5천원→5cheon)
- 규격: 인원·사이즈·포맷 (2인→2in, 톨→tall, 2D→2d)
- 유형(구분 필요시만): 잔액관리형→bal, 교환형→exc, 금액형→amt
JSON {"slug":"..."} 형식으로만 답하라.
예: "메가MGC커피 1만원권 잔액관리형" -> {"slug":"megacoffee_1man_bal"}
예: "CGV 2D 관람권" -> {"slug":"cgv_2d"}
예: "GS25 모바일상품권 3만원" -> {"slug":"gs25_3man"}
예: "스타벅스 아메리카노 T" -> {"slug":"starbucks_americano_tall"}
상품명: ${name}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini 오류 (${res.status})`);
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  let slug = "";
  try { slug = String(JSON.parse(text).slug ?? ""); } catch { slug = ""; }
  return sanitizeSlug(slug);
}
