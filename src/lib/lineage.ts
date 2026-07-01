/**
 * 리니지 무결성 판정 (순수 로직).
 * 매입 1건의 4단계(증빙→발행→판매→발송) 상태로 누락(issue)을 도출한다.
 *   · 증빙 없음(비-셀콘)         → proof-missing
 *   · 미발행                      → unpublished
 *   · 판매됐는데 발송 안 됨/실패  → dispatch-issue
 *   · 미판매는 누락 아님(정상 대기)
 */
export interface LineageFlags {
  proof: "linked" | "system" | "missing";
  published: boolean;
  sold: boolean;
  sent: boolean;
  failed: boolean;
}

export type LineageIssue = "proof-missing" | "unpublished" | "dispatch-issue";

export function lineageIssues(f: LineageFlags): LineageIssue[] {
  const out: LineageIssue[] = [];
  if (f.proof === "missing") out.push("proof-missing");
  if (!f.published) out.push("unpublished");
  if (f.sold && !f.sent) out.push("dispatch-issue"); // failed 포함(판매됐는데 발송완료 아님)
  return out;
}

export function isComplete(f: LineageFlags): boolean {
  return lineageIssues(f).length === 0;
}

/** 배지용 대표 상태 (심각도 순: 발송이상 > 증빙누락 > 미발행 > 정상) */
export function primaryIssue(f: LineageFlags): LineageIssue | "complete" {
  const i = lineageIssues(f);
  if (i.includes("dispatch-issue")) return "dispatch-issue";
  if (i.includes("proof-missing")) return "proof-missing";
  if (i.includes("unpublished")) return "unpublished";
  return "complete";
}
