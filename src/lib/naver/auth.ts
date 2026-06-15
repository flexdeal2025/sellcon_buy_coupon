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

  const hmac = (msg: string, enc: "base64" | "hex" | "base64url") =>
    crypto.createHmac("sha256", clientSecret).update(msg).digest(enc);

  // 시도 순서: base64(공식), hex, base64url, base64(timestamp만)
  const candidates = [
    { label: "base64/full",     sign: hmac(`${clientId}_${timestamp}`, "base64") },
    { label: "hex/full",        sign: hmac(`${clientId}_${timestamp}`, "hex") },
    { label: "base64url/full",  sign: hmac(`${clientId}_${timestamp}`, "base64url") },
    { label: "base64/ts-only",  sign: hmac(timestamp, "base64") },
    { label: "hex/ts-only",     sign: hmac(timestamp, "hex") },
  ];

  const makeBody = (sign: string) =>
    `grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&timestamp=${timestamp}` +
    `&client_secret_sign=${encodeURIComponent(sign)}` +
    `&type=SELF`;

  console.info("[Naver Auth] secretLen:", clientSecret.length, "| timestamp:", timestamp);

  let lastErr = "";
  for (const { label, sign } of candidates) {
    const res = await fetch(`${API_BASE}/external/v1/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: makeBody(sign),
    });

    if (res.ok) {
      console.info("[Naver Auth] 성공:", label);
      const data = (await res.json()) as { access_token: string; expires_in: number };
      cache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
      return cache.token;
    }

    const err = await res.text();
    console.warn(`[Naver Auth] 실패(${label}):`, err);
    lastErr = err;
  }

  throw new Error(`Naver 인증 실패 (모든 서명 방식 소진): ${lastErr}`);

}

export { API_BASE };
