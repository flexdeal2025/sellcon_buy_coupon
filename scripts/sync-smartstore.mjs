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

async function naverGet(token, path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Naver API ${path} 오류 (${res.status}): ${await res.text()}`);
  return res.json();
}

async function getAllProducts(token) {
  const all = [];
  let page = 0;
  while (true) {
    const params = new URLSearchParams({ page: String(page), size: "100" });
    const data = await naverGet(token, `/external/v2/products/channel-products?${params}`);
    all.push(...(data.contents ?? []));
    if (page >= (data.totalPages ?? 1) - 1 || (data.contents ?? []).length === 0) break;
    page++;
    await sleep(1000);
  }
  return all;
}

async function getOrdersLast30Days(token) {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const all = [];
  let pageNum = 1;
  while (true) {
    const params = new URLSearchParams({
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      pageNum: String(pageNum),
      pageSize: "300",
      paymentDateType: "PAYMENT_DATE",
      orderStatusCode: "PAY_DONE,PRODUCT_PREPARE,DELIVERING,DELIVERED",
    });
    const data = await naverGet(
      token,
      `/external/v1/pay-order/seller/orders/query-date?${params}`,
    );
    const contents = data.data?.contents ?? [];
    all.push(...contents);
    if (contents.length < 300) break;
    pageNum++;
    await sleep(1000);
  }
  return all;
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

  // 2. 주문 집계
  console.log("🛒 주문 동기화 중...");
  const orders = await getOrdersLast30Days(token);
  const salesMap = new Map();
  for (const o of orders) {
    const date = (o.paymentDate ?? "").substring(0, 10);
    if (!date || !o.channelProductNo) continue;
    const key = `${date}__${o.channelProductNo}`;
    const cur = salesMap.get(key) ?? { qty: 0, rev: 0, name: o.productName };
    cur.qty += o.quantity ?? 0;
    cur.rev += (o.unitPrice ?? 0) * (o.quantity ?? 0);
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
  console.log(`   주문 집계 ${salesMap.size}건`);

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
    `\n✅ 동기화 완료 — 상품 ${products.length}개 / 주문집계 ${salesMap.size}건 / 재고임박 ${lowStock.length}건`,
  );
}

main().catch((e) => {
  console.error("\n🚨 동기화 오류:", e.message);
  sendTelegram(`🚨 *스마트스토어 동기화 오류*\n${e.message}`).finally(() => process.exit(1));
});
