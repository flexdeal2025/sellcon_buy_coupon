// 로컬 PC에서 직접 실행하는 AI 매입 전략 분석 스크립트.
// Supabase에 저장된 스마트스토어 데이터를 Gemini로 분석해 리포트를 만들고
// DB 저장 + 텔레그램 발송한다. (네이버 API를 직접 호출하지 않으므로 IP 무관하지만,
//  최신 데이터 분석을 위해 보통 sync 직후 실행한다.)
//
// 실행:  npm run analyze

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";

// 분석 프롬프트 — 환각(임의 수치 계산) 차단 + 전략 깊이 강화.
// route.ts 의 동일 프롬프트와 항상 동기화할 것.
function buildAnalysisPrompt(productSummary, purchases) {
  return `당신은 대한민국 기프티콘 대량 매입·재판매 비즈니스를 전담하는 시니어 매입·판매 전략가입니다.
아래 두 데이터는 실제 운영 데이터입니다. 오직 이 데이터에 근거해서만 전략 인사이트를 작성하세요.

## 📊 스마트스토어 상품별 현황 (status=SALE, 재고 적은 순)
- 각 항목 필드: 상품명 / 현재재고 / 판매가 / 7일판매량 / 30일판매량 / 30일매출 / 예상소진일수
- "예상소진일수"는 (현재재고 ÷ 최근7일 일평균판매량)으로 **이미 계산된 값**입니다.
${JSON.stringify(productSummary, null, 2)}

## 🛒 최근 30일 매입 이력
${JSON.stringify(purchases ?? [], null, 2)}

# ⛔ 수치 사용 규칙 (반드시 준수 — 위반 시 분석 무효)
1. 재고·판매량·매출·판매가·예상소진일수는 **위 JSON에 있는 값만 그대로 인용**한다.
2. JSON에 없는 일수·비율(%)·예측매출·예상수익을 **새로 계산하거나 지어내지 않는다.** 특히 "예상소진일수"는 제공된 값을 그대로 쓰고 절대 직접 재계산하지 않는다.
3. "예상소진일수"가 null이거나 7일판매량이 0인 상품은 **"최근 7일 판매 없음 — 소진 예측 불가"**로 표기한다.
4. 상품명은 JSON의 정확한 명칭을 사용한다. 데이터에 없는 상품은 언급하지 않는다.
5. 순위·비교·정성 판단은 제공된 수치 근거로만 한다. (제공값으로 자명한 단순 대소 비교는 허용, 임의의 정밀 배수·퍼센트 날조는 금지)
6. 최근 재입고·신규등록 상품은 7일 데이터가 실제 수요를 왜곡할 수 있으므로, 예상소진일수를 단정하지 말고 "데이터 누적 후 재판단 필요"라고 단서를 단다.

# 📈 분석 구성 (각 섹션을 풍부하고 구체적으로)
🔴 **즉시 매입 (소진 임박)** — 예상소진일수 3일 이내 또는 재고 0~소량. 상품별 [재고/7일판매/예상소진일] 인용 + 권장 매입 방향.
🟡 **단기 선제 매입** — 예상소진일수 약 4~10일. 품절 전 확보 권장.
🟢 **캐시카우 (고매출·고회전)** — 30일매출·7일판매 상위. 재고 끊기지 않게 방어할 핵심 상품과 그 이유.
📉 **사장·과잉 재고** — 7일판매 0 또는 재고 대비 회전이 현저히 느린 상품. 할인·번들·매입중단 등 유동화 방안.
🎯 **이번 주 매입 우선순위 TOP 5** — 순위 + 한 줄 근거(인용 수치 기반).
💰 **가격대·마진 관점** — 고액권(예: 5만원권)과 저액권의 회전 차이, 자금 회수 관점 코멘트.
🧩 **브랜드·카테고리 패턴** — 카페/영화/편의점/베이커리 등 묶어 보이는 수요 흐름.
⚠️ **리스크 & 데이터 주의** — 재입고 직후 왜곡, 매입했으나 판매현황에 없는 상품 등.
💡 **핵심 실행 플랜** — 지금 바로 할 행동 3~5가지 (무엇을, 얼마나, 왜).

# 작성 지침
- 한국어, 마크다운. 실무자가 바로 행동할 수 있게 구체적으로.
- 분량 제한 없이 깊이 있게 쓰되, 데이터로 뒷받침되지 않는 추측성 수치는 넣지 않는다.`;
}

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

  // Supabase는 1회 select 시 최대 1000행만 반환 → range 페이지네이션으로 전체 수집
  const sales30 = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("smartstore_daily_sales")
      .select("channel_product_no, product_name, sale_date, total_quantity, total_revenue")
      .gte("sale_date", thirtyDaysAgo)
      .order("sale_date", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`판매 데이터 조회 실패: ${error.message}`);
    sales30.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

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
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = buildAnalysisPrompt(productSummary, purchases);

  const result = await model.generateContent(prompt);
  const reportText = result.response.text();

  await supabase.from("ai_analysis_reports").insert({
    report_date: now.toISOString().substring(0, 10),
    report_text: reportText,
    model: "gemini-2.5-flash",
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
