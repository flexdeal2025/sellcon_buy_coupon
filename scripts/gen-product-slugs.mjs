// 스마트스토어 상품명 → 영문 슬러그 사전 미리 생성 (vivacon_product_slugs 적재)
// 실행: node --env-file=.env.local scripts/gen-product-slugs.mjs
// 이미 사전에 있는 상품명은 건너뜀(증분).
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const geminiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";
if (!url || !key || !geminiKey) { console.error("❌ SUPABASE/GEMINI 환경변수 누락"); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false } });

const strip = (n) => (n ?? "").replace(/^\s*\[?\s*비바콘\s*\]?\s*/, "").trim();
const sanitize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

async function slugify(name) {
  const prompt = `다음 한국어 상품명을 영문 슬러그로 변환하라. 목적: 슬러그만 보고 상품 추정 가능. 규칙: 소문자, 단어구분 underscore(_), 영문/숫자만, 40자 이내. 구성=브랜드[_금액/규격][_유형] (만원→nman, 천원→ncheon, 2인→2in, 톨→tall, 잔액관리형→bal, 교환형→exc). JSON {"slug":"..."} 로만 답하라.
예: "메가MGC커피 1만원권 잔액관리형"->{"slug":"megacoffee_1man_bal"}, "CGV 2D 관람권"->{"slug":"cgv_2d"}, "GS25 3만원권"->{"slug":"gs25_3man"}
상품명: ${name}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { response_mime_type: "application/json" } }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try { return sanitize(String(JSON.parse(text).slug ?? "")); } catch { return ""; }
}

// 1) 상품명 수집
const { data: prods } = await sb.from("smartstore_products").select("name").limit(5000);
const names = Array.from(new Set((prods ?? []).map((r) => strip(r.name)).filter(Boolean)));
console.log("스마트스토어 상품명(중복제거):", names.length);

// 2) 이미 사전에 있는 것 제외
const { data: existing } = await sb.from("vivacon_product_slugs").select("product_name").limit(10000);
const have = new Set((existing ?? []).map((r) => r.product_name));
const todo = names.filter((n) => !have.has(n));
console.log("신규 생성 대상:", todo.length);

let done = 0;
for (const name of todo) {
  try {
    const slug = await slugify(name);
    await sb.from("vivacon_product_slugs").upsert({ product_name: name, slug, updated_at: new Date().toISOString() }, { onConflict: "product_name" });
    done++;
    if (done % 20 === 0) console.log(`  ${done}/${todo.length} ...`);
  } catch (e) {
    console.warn("실패:", name, e.message);
  }
}
console.log(`✅ 완료 — ${done}건 생성`);
