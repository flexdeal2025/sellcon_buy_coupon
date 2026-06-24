// 셀콘 직결 엔드포인트(/api/stock/ingest, /api/stock/ingest/payout) 공용 인증.
//   Authorization: Bearer <STOCK_INGEST_KEY>
// 키 미설정이면 항상 거부(연동 비활성 = 잠금). 서버에서만 사용.
export function ingestAuthOk(req: Request): boolean {
  const key = process.env.STOCK_INGEST_KEY;
  if (!key) return false;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  return !!m && m[1] === key;
}
