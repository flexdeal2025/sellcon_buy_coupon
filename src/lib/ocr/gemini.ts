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
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        { parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] },
      ],
      generationConfig: { response_mime_type: "application/json" },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini 오류 (${res.status}): ${t.slice(0, 300)}`);
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

/** 영문/숫자/underscore 만 남기는 정제 */
export function sanitizeSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

/** 한국어 상품명 → 짧은 영문 슬러그 (파일명용). 예: "CGV 2D 관람권" → "cgv_2d" */
export async function slugifyProductName(name: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";
  const prompt = `다음 한국어 상품명을 짧은 영문 슬러그로 변환하라. 규칙: 소문자, 단어 구분은 underscore(_), 영문/숫자만, 브랜드·핵심어 위주로 간결하게.
JSON {"slug":"..."} 형식으로만 답하라.
예: "CGV 2D 관람권" -> {"slug":"cgv_2d"}
예: "메가박스 일반관람권" -> {"slug":"megabox"}
예: "스타벅스 아메리카노 T" -> {"slug":"starbucks_americano"}
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
