// 적격증빙 없는 매입 비중 리포트 (읽기 전용) — 세무 방어 지표
// purchase_records 의 evidence_type 공란 = 무증빙으로 집계.
// 실행: node --env-file=.env.local scripts/evidence-report.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error("❌ SUPABASE 환경변수 누락"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

// 페이지네이션으로 전량 수집 (1000행 캡 회피)
const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from("purchase_records")
    .select("purchase_date, supplier, total_price, evidence_type")
    .order("purchase_date", { ascending: true })
    .range(from, from + 999);
  if (error) { console.error("❌ 조회 실패:", error.message); process.exit(1); }
  rows.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const won = (n) => Math.round(n).toLocaleString() + "원";
const hasEvi = (r) => !!(r.evidence_type && String(r.evidence_type).trim());

let gTotal = 0, gNo = 0;
const byMonth = {}, bySupplier = {};
for (const r of rows) {
  const amt = Number(r.total_price || 0);
  const ym = (r.purchase_date || "").slice(0, 7) || "(미상)";
  const sup = r.supplier || "(미상)";
  gTotal += amt; if (!hasEvi(r)) gNo += amt;
  (byMonth[ym] ??= { total: 0, no: 0 });   byMonth[ym].total += amt;   if (!hasEvi(r)) byMonth[ym].no += amt;
  (bySupplier[sup] ??= { total: 0, no: 0 }); bySupplier[sup].total += amt; if (!hasEvi(r)) bySupplier[sup].no += amt;
}
const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) : "0.0") + "%";

console.log(`\n=== 적격증빙 없는 매입 비중 (매입 ${rows.length}건) ===`);
console.log(`전체 매입액 ${won(gTotal)} · 무증빙 ${won(gNo)} · 무증빙비중 ${pct(gNo, gTotal)}\n`);

console.log("── 월별 ──");
for (const ym of Object.keys(byMonth).sort()) {
  const m = byMonth[ym];
  console.log(`  ${ym}: 무증빙 ${pct(m.no, m.total)}  (${won(m.no)} / ${won(m.total)})`);
}

console.log("\n── 매입처별 (무증빙액 상위 10) ──");
Object.entries(bySupplier)
  .map(([s, v]) => ({ s, ...v }))
  .filter((v) => v.no > 0)
  .sort((a, b) => b.no - a.no)
  .slice(0, 10)
  .forEach((v) => console.log(`  ${v.s}: 무증빙 ${won(v.no)} (${pct(v.no, v.total)})`));

console.log("\n✅ 리포트 완료");
