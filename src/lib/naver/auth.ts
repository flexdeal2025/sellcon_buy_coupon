import bcrypt from "bcryptjs";

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

  // 네이버 커머스 API 전자서명: bcrypt(password, salt=clientSecret) → base64
  // clientSecret 자체가 bcrypt salt 형식($2a$04$...)임
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver 인증 실패 (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cache.token;
}

export { API_BASE };
