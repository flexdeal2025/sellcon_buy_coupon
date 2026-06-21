// 재고등록/증빙 테이블 헬스체크 (읽기 전용, 우리 Supabase)
// 실행: node --env-file=.env.local scripts/inspect-stock.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error("❌ SUPABASE 환경변수 누락"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const TABLES = [
  "stock_batches", "stock_registrations", "purchase_proofs",
  "proof_registration_links", "purchase_vendors", "vivacon_product_slugs",
];

console.log("=== 테이블 존재/건수 ===");
for (const t of TABLES) {
  const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
  console.log(`${error ? "❌" : "✅"} ${t}: ${error ? error.message : (count ?? 0) + "건"}`);
}

// 재고 상태 분포
const { data: regs, error: e } = await sb
  .from("stock_registrations")
  .select("inspection_status, published, stored_as_code, supplier")
  .limit(5000);
if (!e && regs) {
  const tally = (key) => regs.reduce((m, r) => { const k = r[key] ?? "(null)"; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  console.log("\n=== 재고 분포(표본 최대 5000) ===");
  console.log("검수상태:", tally("inspection_status"));
  console.log("발행:", { 발행됨: regs.filter((r) => r.published).length, 미발행: regs.filter((r) => !r.published).length });
  console.log("유형:", { 코드형: regs.filter((r) => r.stored_as_code).length, 이미지형: regs.filter((r) => !r.stored_as_code).length });
}

// 증빙 연결 무결성
const { data: links } = await sb.from("proof_registration_links").select("registration_id, proof_id").limit(10000);
if (links) {
  const regIds = new Set();
  const dupReg = links.filter((l) => regIds.has(l.registration_id) || (regIds.add(l.registration_id), false));
  console.log("\n=== 증빙 연결 ===");
  console.log("연결 수:", links.length, "/ 재고 중복연결(있으면 이상):", dupReg.length);
}

console.log("\n✅ 점검 완료");
