// 로컬 PC에서 직접 실행하는 스마트스토어 동기화 스크립트.
// Vercel은 고정 출구 IP가 없어 네이버 API IP 허용 정책을 통과하지 못하므로,
// IP가 등록된 본인 PC에서 이 스크립트를 실행해 동기화한다.
//
// 실행:  npm run sync
// (내부적으로 node --env-file=.env.local scripts/sync-smartstore.mjs)

import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

const API_BASE = "https://api.commerce.naver.com";

// ── 네이버 인증 (bcrypt 전자서명) ───────────────────────
async function getNaverToken() {
  const clientId = (process.env.NAVER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.NAVER_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) throw new Error("NAVER_CLIENT_ID / SECRET 미설정");

  const timestamp = Date.now().toString();
  const password = `${clientId}_${timestamp}`;
  const hashed = bcrypt.hashSync(password, clientSecret);
  const sign = Buffer.from(hashed, "utf-8").toString("base64");

  const body =
    `grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&timestamp=${timestamp}` +
    `&client_secret_sign=${encodeURIComponent(sign)}` +
    `&type=SELF`;

  const res = await fetch(`${API_BASE}/external/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Naver 인증 실패 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 429(Rate Limit) 대응 백오프 재시도. 기존 알림톡 시스템과 API 공유 중이라 필요.
async function naverFetch(token, path, init = {}) {
  const url = `${API_BASE}${path}`;
  const maxRetry = 5;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < maxRetry) {
      const wait = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s, 16s, 32s
      console.log(`   ⏳ Rate limit — ${wait / 1000}s 대기 후 재시도 (${attempt + 1}/${maxRetry})`);
      await sleep(wait);
      continue;
    }
    throw new Error(`Naver API ${path} 오류 (${res.status}): ${await res.text()}`);
  }
}

const naverGet = (token, path) => naverFetch(token, path);
const naverPost = (token, path, body) =>
  naverFetch(token, path, { method: "POST", body: JSON.stringify(body) });

// 상품 목록 조회: POST /external/v1/products/search
// 응답: { contents: [{ originProductNo, channelProducts: [{ channelProductNo, name, salePrice, stockQuantity, statusType }] }], totalPages }
async function getAllProducts(token) {
  const all = [];
  let page = 1; // 1-based
  while (true) {
    const data = await naverPost(token, `/external/v1/products/search`, {
      page,
      size: 100,
      orderType: "NO",
    });
    const contents = data.contents ?? [];
    for (const item of contents) {
      for (const cp of item.channelProducts ?? []) {
        all.push({
          channelProductNo: cp.channelProductNo,
          originProductNo: cp.originProductNo ?? item.originProductNo,
          name: cp.name,
          salePrice: cp.salePrice,
          stockQuantity: cp.stockQuantity,
          status: cp.statusType, // SALE | OUTOFSTOCK | SUSPENSION | ...
        });
      }
    }
    if (page >= (data.totalPages ?? 1) || contents.length === 0) break;
    page++;
    await sleep(1000);
  }
  return all;
}

// Date → KST(+09:00) ISO8601 문자열
function kstIso(d) {
  const shifted = new Date(d.getTime() + 9 * 3600 * 1000);
  return shifted.toISOString().replace("Z", "+09:00");
}

// 주문 조회: ① 변경상품주문 ID 목록 → ② 상세 조회
// ① GET /external/v1/pay-order/seller/product-orders/last-changed-statuses
//    (조회 기간 최대 24시간 → 일 단위로 나눠 호출)
// ② POST /external/v1/pay-order/seller/product-orders/query  (productOrderIds, 최대 300)
async function getOrdersLast30Days(token) {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const DAY = 24 * 3600 * 1000;

  // ① 변경된 상품주문 ID 수집 — 24시간 윈도우 반복
  const ids = new Set();
  for (let ws = start.getTime(); ws < end.getTime(); ws += DAY) {
    const we = Math.min(ws + DAY, end.getTime());
    let moreSequence = null;
    let guard = 0;
    while (guard++ < 50) {
      const params = new URLSearchParams({
        lastChangedFrom: kstIso(new Date(ws)),
        lastChangedTo: kstIso(new Date(we)),
      });
      if (moreSequence) params.set("moreSequence", moreSequence);
      const data = await naverGet(
        token,
        `/external/v1/pay-order/seller/product-orders/last-changed-statuses?${params}`,
      );
      const list = data.data?.lastChangeStatuses ?? [];
      for (const s of list) if (s.productOrderId) ids.add(s.productOrderId);
      moreSequence = data.data?.more?.moreSequence ?? data.data?.moreSequence ?? null;
      if (!moreSequence) break;
      await sleep(400);
    }
    await sleep(300);
  }

  // ② 300개씩 상세 조회
  const idArr = [...ids];
  const out = [];
  for (let i = 0; i < idArr.length; i += 300) {
    const chunk = idArr.slice(i, i + 300);
    const data = await naverPost(token, `/external/v1/pay-order/seller/product-orders/query`, {
      productOrderIds: chunk,
    });
    for (const row of data.data ?? []) {
      const po = row.productOrder ?? {};
      const ord = row.order ?? {};
      out.push({
        paymentDate: ord.paymentDate ?? po.paymentDate ?? "",
        channelProductNo: Number(po.productId ?? po.channelProductNo ?? 0),
        productName: po.productName ?? "",
        quantity: po.quantity ?? 0,
        amount: po.totalPaymentAmount ?? (po.unitPrice ?? 0) * (po.quantity ?? 0),
      });
    }
    await sleep(800);
  }
  return out;
}

// ── 텔레그램 (선택) ──────────────────────────────────────
async function sendTelegram(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  }).catch(() => {});
}

// ── 메인 ────────────────────────────────────────────────
async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const now = new Date().toISOString();

  console.log("🔑 네이버 인증 중...");
  const token = await getNaverToken();
  console.log("✅ 인증 성공");

  // 1. 상품
  console.log("📦 상품 동기화 중...");
  const products = await getAllProducts(token);
  if (products.length > 0) {
    const { error } = await supabase.from("smartstore_products").upsert(
      products.map((p) => ({
        channel_product_no: p.channelProductNo,
        origin_product_no: p.originProductNo,
        name: p.name,
        sale_price: p.salePrice,
        stock_quantity: p.stockQuantity,
        status: p.status,
        synced_at: now,
      })),
      { onConflict: "channel_product_no" },
    );
    if (error) throw new Error(`상품 upsert 실패: ${error.message}`);
  }
  console.log(`   상품 ${products.length}개`);

  // 2. 주문 집계 (실패해도 상품 동기화는 유지)
  let salesCount = 0;
  try {
    console.log("🛒 주문 동기화 중...");
    const orders = await getOrdersLast30Days(token);
    const salesMap = new Map();
    for (const o of orders) {
      const date = (o.paymentDate ?? "").substring(0, 10);
      if (!date || !o.channelProductNo) continue;
      const key = `${date}__${o.channelProductNo}`;
      const cur = salesMap.get(key) ?? { qty: 0, rev: 0, name: o.productName };
      cur.qty += o.quantity ?? 0;
      cur.rev += o.amount ?? 0;
      cur.name = o.productName;
      salesMap.set(key, cur);
    }
    if (salesMap.size > 0) {
      const rows = [...salesMap.entries()].map(([key, v]) => {
        const [date, no] = key.split("__");
        return {
          sale_date: date,
          channel_product_no: Number(no),
          product_name: v.name,
          total_quantity: v.qty,
          total_revenue: v.rev,
          synced_at: now,
        };
      });
      const { error } = await supabase
        .from("smartstore_daily_sales")
        .upsert(rows, { onConflict: "sale_date,channel_product_no" });
      if (error) throw new Error(`판매 집계 upsert 실패: ${error.message}`);
    }
    salesCount = salesMap.size;
    console.log(`   주문 집계 ${salesCount}건`);
  } catch (e) {
    console.warn(`   ⚠️ 주문 동기화 건너뜀: ${e.message}`);
  }

  // 3. 재고 임박 알림
  const { data: thresholds } = await supabase
    .from("smartstore_products")
    .select("channel_product_no, low_stock_threshold");
  const threshMap = new Map(
    (thresholds ?? []).map((r) => [r.channel_product_no, r.low_stock_threshold ?? 10]),
  );
  const lowStock = products.filter((p) => {
    const t = threshMap.get(p.channelProductNo) ?? 10;
    return p.status === "SALE" && p.stockQuantity >= 0 && p.stockQuantity <= t;
  });
  if (lowStock.length > 0) {
    const lines = [
      "📦 *재고 임박 알림*",
      "",
      ...lowStock.map((p) => `• *${p.name}*\n  재고 ${p.stockQuantity}개`),
      "",
      "🛒 매입 검토가 필요합니다.",
    ];
    await sendTelegram(lines.join("\n"));
  }

  console.log(
    `\n✅ 동기화 완료 — 상품 ${products.length}개 / 주문집계 ${salesCount}건 / 재고임박 ${lowStock.length}건`,
  );
}

main().catch((e) => {
  console.error("\n🚨 동기화 오류:", e.message);
  sendTelegram(`🚨 *스마트스토어 동기화 오류*\n${e.message}`).finally(() => process.exit(1));
});
