// 과거 정산/판매 데이터 일회성 백필 스크립트.
// 기존 sync 와 동일 로직을 임의 날짜 구간에 적용한다. UPSERT 라 중간에 멈춰도 재실행 시 안전.
//
// 사용:  npm run backfill -- <시작일> <종료일>
//   예:  npm run backfill -- 2025-01-01 2026-05-31
//   예:  npm run backfill -- 2025-06-01 2025-06-30   (월 단위 권장)
//
// ⚠️ 알림톡과 API 공유 중 → 한가한 시간(심야)에, 가능하면 월 단위로 나눠 실행 권장.

import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

const API_BASE = "https://api.commerce.naver.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 인증 ─────────────────────────────────────────────
async function getToken() {
  const clientId = (process.env.NAVER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.NAVER_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) throw new Error("NAVER_CLIENT_ID / SECRET 미설정");
  const ts = Date.now().toString();
  const sign = Buffer.from(bcrypt.hashSync(`${clientId}_${ts}`, clientSecret), "utf-8").toString("base64");
  const body =
    `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}` +
    `&timestamp=${ts}&client_secret_sign=${encodeURIComponent(sign)}&type=SELF`;
  const res = await fetch(`${API_BASE}/external/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`인증 실패 (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

// ── 429 백오프 ───────────────────────────────────────
async function naverFetch(token, path, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 6) {
      const wait = 2000 * Math.pow(2, attempt);
      console.log(`   ⏳ Rate limit — ${wait / 1000}s 대기 (${attempt + 1}/6)`);
      await sleep(wait);
      continue;
    }
    throw new Error(`Naver API ${path} 오류 (${res.status}): ${await res.text()}`);
  }
}
const naverGet = (t, p) => naverFetch(t, p);
const naverPost = (t, p, b) => naverFetch(t, p, { method: "POST", body: JSON.stringify(b) });

const kstIso = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().replace("Z", "+09:00");
const kstDate = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

// ── 텔레그램(완료 알림용, 선택) ──────────────────────
async function notify(text) {
  const bt = process.env.TELEGRAM_BOT_TOKEN, ci = process.env.TELEGRAM_CHAT_ID;
  if (!bt || !ci) return;
  await fetch(`https://api.telegram.org/bot${bt}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ci, text, parse_mode: "Markdown" }),
  }).catch(() => {});
}

async function main() {
  const [startArg, endArg] = process.argv.slice(2);
  if (!startArg || !endArg || !/^\d{4}-\d{2}-\d{2}$/.test(startArg) || !/^\d{4}-\d{2}-\d{2}$/.test(endArg)) {
    console.error("사용법: npm run backfill -- <시작일 YYYY-MM-DD> <종료일 YYYY-MM-DD>");
    console.error("  예: npm run backfill -- 2025-01-01 2026-05-31");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const now = new Date().toISOString();

  const start = new Date(`${startArg}T00:00:00+09:00`);
  const end = new Date(`${endArg}T00:00:00+09:00`);
  end.setTime(end.getTime() + 864e5); // 종료일 포함(끝나는 날 자정까지)
  const DAY = 864e5;
  const totalDays = Math.round((end.getTime() - start.getTime()) / DAY);

  console.log(`🔑 인증 중...`);
  const token = await getToken();
  console.log(`✅ 인증 성공 — 백필 구간 ${startArg} ~ ${endArg} (${totalDays}일)\n`);

  const salesMap = new Map(); // sale_date__channel → {qty,rev,name}
  let dayIdx = 0, totalSettle = 0, totalOrders = 0;

  for (let ws = start.getTime(); ws < end.getTime(); ws += DAY) {
    dayIdx++;
    const we = Math.min(ws + DAY, end.getTime());
    const label = kstDate(new Date(ws));

    // ① 변경 상품주문 ID 수집
    const ids = new Set();
    let moreSequence = null, guard = 0;
    while (guard++ < 60) {
      const q =
        `lastChangedFrom=${encodeURIComponent(kstIso(new Date(ws)))}` +
        `&lastChangedTo=${encodeURIComponent(kstIso(new Date(we)))}` +
        (moreSequence ? `&moreSequence=${moreSequence}` : "");
      const d = await naverGet(token, `/external/v1/pay-order/seller/product-orders/last-changed-statuses?${q}`);
      (d.data?.lastChangeStatuses ?? []).forEach((s) => s.productOrderId && ids.add(s.productOrderId));
      moreSequence = d.data?.more?.moreSequence ?? d.data?.moreSequence ?? null;
      if (!moreSequence) break;
      await sleep(400);
    }

    // ② 상세 조회 + 정산 upsert
    const idArr = [...ids];
    const settleRows = [];
    for (let i = 0; i < idArr.length; i += 300) {
      const d = await naverPost(token, `/external/v1/pay-order/seller/product-orders/query`, {
        productOrderIds: idArr.slice(i, i + 300),
      });
      for (const row of d.data ?? []) {
        const po = row.productOrder ?? {}, ord = row.order ?? {};
        const channelNo = Number(po.productId ?? 0);
        if (!po.productOrderId || !channelNo) continue;
        const qty = po.quantity ?? 0;
        const payAmt = po.totalPaymentAmount ?? 0;
        settleRows.push({
          product_order_id: po.productOrderId,
          channel_product_no: channelNo,
          product_name: po.productName ?? "",
          quantity: qty,
          payment_amount: payAmt,
          settle_amount: po.expectedSettlementAmount ?? null,
          commission:
            (po.paymentCommission ?? 0) + (po.saleCommission ?? 0) +
            (po.knowledgeShoppingSellingInterlockCommission ?? 0) + (po.channelCommission ?? 0),
          order_status: po.productOrderStatus ?? "",
          decision_date: (po.decisionDate ?? "").slice(0, 10) || null,
          payment_date: (ord.paymentDate ?? "").slice(0, 10) || null,
          synced_at: now,
        });
        // 판매 집계(결제일 기준)
        const sd = (ord.paymentDate ?? "").slice(0, 10);
        if (sd && channelNo) {
          const key = `${sd}__${channelNo}`;
          const cur = salesMap.get(key) ?? { qty: 0, rev: 0, name: po.productName ?? "" };
          cur.qty += qty; cur.rev += payAmt; cur.name = po.productName ?? cur.name;
          salesMap.set(key, cur);
        }
      }
      await sleep(700);
    }

    // 정산 upsert (윈도우별 즉시 flush — 메모리 절약)
    for (let i = 0; i < settleRows.length; i += 500) {
      const { error } = await supabase
        .from("smartstore_settlements")
        .upsert(settleRows.slice(i, i + 500), { onConflict: "product_order_id" });
      if (error) throw new Error(`정산 upsert 실패(${label}): ${error.message}`);
    }
    const daySettle = settleRows.reduce((a, b) => a + (b.settle_amount ?? 0), 0);
    totalSettle += daySettle;
    totalOrders += settleRows.length;
    console.log(`[${dayIdx}/${totalDays}] ${label}  주문 ${settleRows.length}건  정산 ${daySettle.toLocaleString()}원  (누적 ${totalOrders}건)`);
    await sleep(250);
  }

  // ③ 판매 집계 upsert
  if (salesMap.size > 0) {
    const rows = [...salesMap.entries()].map(([key, v]) => {
      const [sale_date, no] = key.split("__");
      return { sale_date, channel_product_no: Number(no), product_name: v.name, total_quantity: v.qty, total_revenue: v.rev, synced_at: now };
    });
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("smartstore_daily_sales").upsert(rows.slice(i, i + 500), { onConflict: "sale_date,channel_product_no" });
      if (error) throw new Error(`판매 집계 upsert 실패: ${error.message}`);
    }
  }

  // ④ 회사 전체 일별 정산(정산완료일 기준) upsert
  try {
    const ds = await naverGet(token, `/external/v1/pay-settle/settle/daily?startDate=${startArg}&endDate=${endArg}`);
    const drows = (ds.elements ?? []).map((e) => ({
      settle_complete_date: e.settleCompleteDate,
      settle_amount: e.settleAmount ?? 0,
      pay_settle_amount: e.paySettleAmount ?? 0,
      commission_amount: e.commissionSettleAmount ?? 0,
      synced_at: now,
    })).filter((r) => r.settle_complete_date);
    if (drows.length) {
      const { error } = await supabase.from("smartstore_daily_settlement").upsert(drows, { onConflict: "settle_complete_date" });
      if (error) console.warn("일별 정산 upsert 경고:", error.message);
    }
  } catch (e) {
    console.warn("일별 정산 수집 건너뜀:", e.message);
  }

  const msg = `✅ 백필 완료 — ${startArg}~${endArg}\n주문 ${totalOrders}건 / 판매집계 ${salesMap.size}건 / 정산합계 ${totalSettle.toLocaleString()}원`;
  console.log(`\n${msg}`);
  await notify(`📦 *정산 백필 완료*\n${msg}`);
}

main().catch((e) => {
  console.error("\n🚨 백필 오류:", e.message);
  process.exit(1);
});
