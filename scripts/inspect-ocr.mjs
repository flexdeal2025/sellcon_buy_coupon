// Gemini OCR 검증 — GCP의 실제 기프티콘 이미지 1장으로 추출 테스트
// 실행: node --env-file=.env.local scripts/inspect-ocr.mjs
// 쿠폰번호는 마스킹 출력.
import { Storage } from "@google-cloud/storage";

const b64 = process.env.GCP_SA_KEY_B64;
const gifBucket = process.env.GCP_GIFTICON_BUCKET;
const geminiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";

if (!b64 || !gifBucket || !geminiKey) {
  console.error("❌ GCP_SA_KEY_B64 / GCP_GIFTICON_BUCKET / GEMINI_API_KEY 누락");
  process.exit(1);
}

const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
const storage = new Storage({ projectId: creds.project_id, credentials: creds });

// 1) pending/ 에서 이미지 1장 찾기
const [files] = await storage.bucket(gifBucket).getFiles({ prefix: "pending/", maxResults: 100, autoPaginate: false });
const img = files.find((f) => /\.(jpe?g|png)$/i.test(f.name));
if (!img) { console.error("❌ pending/ 에서 이미지 파일을 못 찾음"); process.exit(1); }
console.log("샘플 이미지:", img.name.replace(/[^/]+$/, "***")); // 파일명 마스킹

const [buf] = await img.download();
const mime = img.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
console.log("이미지 크기:", Math.round(buf.length / 1024), "KB");

// 2) Gemini OCR 호출
const prompt = `이 모바일 상품권(기프티콘) 이미지에서 아래 항목을 추출해 JSON으로만 답하라.
{
 "product_name": "상품명",
 "coupon_code": "바코드 아래의 쿠폰번호(숫자/문자)",
 "expiry_date": "유효기간 YYYY-MM-DD",
 "exchange_location": "교환처(예: GS25, CU, 스타벅스)",
 "confidence": 0~100 정수(추출 확신도)
}
못 읽는 항목은 빈 문자열로.`;

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: buf.toString("base64") } }] }],
    generationConfig: { response_mime_type: "application/json" },
  }),
});

if (!res.ok) {
  console.error(`❌ Gemini 오류 (${res.status}):`, (await res.text()).slice(0, 500));
  process.exit(1);
}

const data = await res.json();
const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
let parsed;
try { parsed = JSON.parse(text); } catch { console.error("❌ JSON 파싱 실패. 원문:", text.slice(0, 300)); process.exit(1); }

const code = String(parsed.coupon_code ?? "");
const masked = code ? code.slice(0, 2) + "***(" + code.length + "자리)" : "(없음)";
console.log("✅ Gemini OCR 성공 (model:", model + ")");
console.log("  상품명:", parsed.product_name);
console.log("  쿠폰번호:", masked);
console.log("  유효기간:", parsed.expiry_date);
console.log("  교환처:", parsed.exchange_location);
console.log("  확신도:", parsed.confidence);
