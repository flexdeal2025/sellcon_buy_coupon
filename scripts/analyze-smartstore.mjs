// 로컬 PC에서 직접 실행하는 AI 매입 전략 분석 스크립트.
// Supabase에 저장된 스마트스토어 데이터를 Gemini로 분석해 리포트를 만들고
// DB 저장 + 텔레그램 발송한다. (네이버 API를 직접 호출하지 않으므로 IP 무관하지만,
//  최신 데이터 분석을 위해 보통 sync 직후 실행한다.)
//
// 실행:  npm run analyze

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";

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

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정 — .env.local 에 등록하세요");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 864e5).toISOString().substring(0, 10);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 864e5).toISOString().substring(0, 10);

  const { data: products } = await supabase
    .from("smartstore_products")
    .select("*")
    .eq("status", "SALE")
    .order("stock_quantity", { ascending: true });

  const { data: sales30 } = await supabase
    .from("smartstore_daily_sales")
    .select("channel_product_no, product_name, sale_date, total_quantity, total_revenue")
    .gte("sale_date", thirtyDaysAgo);

  const statsMap = new Map();
  for (const s of sales30 ?? []) {
    const cur = statsMap.get(s.channel_product_no) ?? {
      name: s.product_name, qty7d: 0, qty30d: 0, rev30d: 0,
    };
    cur.qty30d += s.total_quantity;
    cur.rev30d += s.total_revenue;
    if (s.sale_date >= sevenDaysAgo) cur.qty7d += s.total_quantity;
    cur.name = s.product_name;
    statsMap.set(s.channel_product_no, cur);
  }

  const productSummary = (products ?? []).map((p) => {
    const st = statsMap.get(p.channel_product_no);
    const dailyAvg7 = st ? st.qty7d / 7 : 0;
    const daysLeft = dailyAvg7 > 0 ? Math.round((p.stock_quantity / dailyAvg7) * 10) / 10 : null;
    return {
      상품명: p.name,
      현재재고: p.stock_quantity,
      판매가: `${(p.sale_price ?? 0).toLocaleString()}원`,
      "7일판매량": st?.qty7d ?? 0,
      "30일판매량": st?.qty30d ?? 0,
      "30일매출": `${(st?.rev30d ?? 0).toLocaleString()}원`,
      예상소진일수: daysLeft,
    };
  });

  const { data: purchases } = await supabase
    .from("purchase_records")
    .select("supplier, product_name, ordered_quantity, total_price, purchase_date, status")
    .gte("purchase_date", thirtyDaysAgo)
    .order("purchase_date", { ascending: false })
    .limit(30);

  console.log("🤖 Gemini 분석 중...");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `당신은 대한민국 기프티콘 대량 매입·재판매 비즈니스의 전문 마케팅 전략가입니다.
스마트스토어 판매 데이터와 최근 매입 이력을 분석하여 전략적 인사이트를 제공해주세요.

## 📊 스마트스토어 상품별 현황 (판매가·재고·판매속도)
${JSON.stringify(productSummary, null, 2)}

## 🛒 최근 30일 매입 이력
${JSON.stringify(purchases ?? [], null, 2)}

아래 항목을 분석해주세요:

🔴 **즉시 매입 필요** — 재고 소진 임박 (예상 소진일 3일 이내 또는 재고 0)
🟡 **단기 매입 권장** — 1주일 내 소진 예상, 선제적 매입 권장
🟢 **판매 우수 상품** — 판매속도 높고 수익성 좋은 상품
📉 **주의 상품** — 재고 과잉 또는 판매 급감 추세
💡 **이번 주 핵심 전략** — 2~3문장 실행 가이드

숫자와 비율을 구체적으로 언급하고, 즉시 실행 가능한 조언을 한국어로 500자 이내로 작성해주세요.`;

  const result = await model.generateContent(prompt);
  const reportText = result.response.text();

  await supabase.from("ai_analysis_reports").insert({
    report_date: now.toISOString().substring(0, 10),
    report_text: reportText,
    model: "gemini-2.0-flash",
  });

  await sendTelegram(`📊 *AI 매입 전략 분석*\n${now.toLocaleDateString("ko-KR")}\n\n${reportText}`);

  console.log("\n✅ 분석 완료 — 텔레그램 발송 및 DB 저장됨\n");
  console.log("─".repeat(50));
  console.log(reportText);
}

main().catch((e) => {
  console.error("\n🚨 분석 오류:", e.message);
  process.exit(1);
});
