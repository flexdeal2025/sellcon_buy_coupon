import crypto from "crypto";

const API_BASE = "https://api.commerce.naver.com";

interface TokenCache {
  token: string;
  expiresAt: number;
}

// 모듈 레벨 캐시 (서버리스 warm 재사용)
let cache: TokenCache | null = null;

export async function getNaverToken(): Promise<string> {
  if (cache && Date.now() < cache.expiresAt - 60_000) return cache.token;

  const clientId = (process.env.NAVER_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.NAVER_CLIENT_SECRET ?? "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 미설정");
  }

  const timestamp = Date.now().toString();

  // 네이버 API는 두 가지 서명 메시지 형식을 사용함 — 먼저 공식 형식 시도
  const makeSign = (msg: string) =>
    crypto.createHmac("sha256", clientSecret).update(msg).digest("base64");

  const signFull = makeSign(`${clientId}_${timestamp}`); // 공식 문서 형식
  const signTs   = makeSign(timestamp);                  // 타임스탬프만

  const makeBody = (sign: string) =>
    `grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&timestamp=${timestamp}` +
    `&client_secret_sign=${encodeURIComponent(sign)}` +
    `&type=SELF`;

  console.info(
    "[Naver Auth] secretLen:", clientSecret.length,
    "| signFull:", signFull,
    "| signTs:", signTs,
  );

  // 1차 시도: clientId_timestamp 서명
  let res = await fetch(`${API_BASE}/external/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: makeBody(signFull),
  });

  // 실패 시 2차 시도: timestamp만 서명
  if (!res.ok) {
    const errText = await res.text();
    console.warn("[Naver Auth] 1차 시도 실패, timestamp 단독 서명으로 재시도:", errText);
    res = await fetch(`${API_BASE}/external/v1/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: makeBody(signTs),
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver 인증 실패 (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cache.token;
}

export { API_BASE };
