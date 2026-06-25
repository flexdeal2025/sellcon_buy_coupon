import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// IP 화이트리스트 미설정 기간 동안 비활성화. 재개 시 git history에서 복원.
export async function GET() {
  return NextResponse.json(
    { ok: false, error: "일시 중지 — IP 화이트리스트 설정 후 재개 예정" },
    { status: 503 },
  );
}
