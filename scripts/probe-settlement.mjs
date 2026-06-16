// 네이버 커머스 "정산내역" API 검증용 probe.
// 정확한 엔드포인트/응답 구조가 공식 문서(JS 렌더링)로 확인이 안 되어,
// 후보 경로들을 실제로 호출해 404(없음) vs 400/200(존재)을 가려내고,
// 살아있는 엔드포인트의 응답 구조(키)를 덤프한다.
//
// 사전조건: 네이버 API센터에 현재 IP가 등록되어 있어야 함 (GW.IP_NOT_ALLOWED 방지)
// 실행:  npm run probe:settle
//
// ⚠️ 이 스크립트는 조회(GET)만 수행하며 어떤 데이터도 쓰지 않는다.

import bcrypt from "bcryptjs";

const API_BASE = "https://api.commerce.naver.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// KST(+09:00) 날짜/일시 포맷
function kstDate(d) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function kstIso(d) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().replace("Z", "+09:00");
}

async function probe(token, path) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    return { status: 0, text: String(e) };
  }
}

function summarize(text) {
  try {
    const j = JSON.parse(text);
    const top = Object.keys(j);
    let sample = j;
    // data 안에 배열/객체가 흔함 → 한 단계 더 파봄
    if (j.data) sample = j.data;
    const sampleKeys = Array.isArray(sample)
      ? `array[${sample.length}] 첫요소키: ${sample[0] ? Object.keys(sample[0]).join(",") : "(빈배열)"}`
      : typeof sample === "object" && sample
      ? `object 키: ${Object.keys(sample).join(",")}`
      : String(sample);
    return `topKeys: ${top.join(",")} | ${sampleKeys}`;
  } catch {
    return text.slice(0, 200);
  }
}

async function main() {
  const token = await getToken();
  console.log("✅ 인증 성공\n");

  const end = new Date();
  const start = new Date(end.getTime() - 7 * 864e5);
  const d1 = kstDate(start), d2 = kstDate(end);
  const i1 = kstIso(start), i2 = kstIso(end);

  // 후보 경로 — 파라미터 조합도 몇 가지 시도
  const qDate = `startDate=${d1}&endDate=${d2}`;
  const qIso = `startDateTime=${encodeURIComponent(i1)}&endDateTime=${encodeURIComponent(i2)}`;
  const qSettle = `settleDateType=SETTLE_CASEBYCASE_SETTLE_COMPLETE_DATE&${qDate}`;

  const candidates = [
    // 일별 정산내역(합계) 후보
    `/external/v1/pay-settle/settle/daily?${qDate}`,
    `/external/v1/pay-settle/seller/settle/daily?${qDate}`,
    `/external/v1/pay-settle/daily-settlements?${qDate}`,
    `/external/v1/pay-settle/settle-amounts/daily?${qDate}`,
    // 건별 정산내역 후보
    `/external/v1/pay-settle/settle/casebycase?${qSettle}`,
    `/external/v1/pay-settle/settle/by-case?${qSettle}`,
    `/external/v1/pay-settle/seller/settle/casebycase?${qSettle}`,
    `/external/v1/pay-settle/settle?${qSettle}`,
    `/external/v1/pay-settle/settle/case-by-case?${qSettle}`,
    // 다른 네임스페이스 후보
    `/external/v1/seller/settle/daily?${qDate}`,
    `/external/v1/pay-order/seller/settle/daily?${qDate}`,
    `/external/v1/settle/daily?${qDate}`,
  ];

  console.log(`조회 구간: ${d1} ~ ${d2}\n`);
  console.log("경로별 결과 (404=없음 / 400=존재하나 파라미터 불일치 / 200=성공):\n");

  for (const path of candidates) {
    const { status, text } = await probe(token, path);
    const tag = status === 200 ? "✅200" : status === 404 ? "❌404" : `⚠️ ${status}`;
    console.log(`${tag}  ${path.split("?")[0]}`);
    if (status !== 404) {
      console.log(`        ↳ ${summarize(text)}`);
    }
    await sleep(600); // rate limit 배려
  }

  console.log("\n완료. ✅200 또는 ⚠️400 으로 표시된 경로가 실제 엔드포인트 후보입니다.");
}

main().catch((e) => {
  console.error("🚨 probe 오류:", e.message);
  process.exit(1);
});
