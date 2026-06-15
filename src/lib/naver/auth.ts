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
  const password = `${clientId}_${timestamp}`;
  const sign = crypto.createHmac("sha256", clientSecret).update(password).digest("base64");

  // URLSearchParams 대신 직접 구성 — base64 서명의 +/= 를 명시적으로 인코딩
  const body =
    `grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&timestamp=${timestamp}` +
    `&client_secret_sign=${encodeURIComponent(sign)}` +
    `&type=SELF`;

  // 디버그: 시크릿 길이 및 sign 확인 (시크릿 자체는 노출하지 않음)
  console.info(
    "[Naver Auth] clientId:", clientId,
    "| secretLen:", clientSecret.length,
    "| secretStart:", clientSecret.slice(0, 7),
    "| timestamp:", timestamp,
    "| sign:", sign,
  );

  const res = await fetch(`${API_BASE}/external/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver 인증 실패 (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cache.token;
}

export { API_BASE };
