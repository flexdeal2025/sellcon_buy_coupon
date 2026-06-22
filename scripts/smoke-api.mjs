// 읽기 API 스모크 테스트 (GET만, 쓰기 없음)
// 실행: node scripts/smoke-api.mjs [BASE_URL]
//   기본 BASE: SMOKE_BASE 환경변수 → 없으면 배포 URL
//   예) node scripts/smoke-api.mjs http://localhost:3000
const BASE = process.argv[2] || process.env.SMOKE_BASE || "https://sellcon-buy-coupon.vercel.app";

const ENDPOINTS = [
  "/api/vivacon/inventory?pageSize=1",
  "/api/stock/registrations",
  "/api/stock/batches",
  "/api/proofs",
  "/api/proof/inventory",
  "/api/proof/report",
];

console.log(`대상: ${BASE}\n`);
let pass = 0, fail = 0;
for (const ep of ENDPOINTS) {
  try {
    const res = await fetch(BASE + ep, { headers: { "cache-control": "no-cache" } });
    let ok = false, note = "";
    try { const j = await res.json(); ok = j?.ok === true; note = ok ? "" : (j?.error ?? ""); }
    catch { note = "JSON 파싱 실패"; }
    if (res.ok && ok) { console.log(`✅ ${ep} (${res.status})`); pass++; }
    else { console.log(`❌ ${ep} (${res.status}) ${note}`); fail++; }
  } catch (e) {
    console.log(`❌ ${ep} — ${e.message}`); fail++;
  }
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail > 0 ? 1 : 0);
