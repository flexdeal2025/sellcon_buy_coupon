import { describe, it, expect } from "vitest";
import { lineageIssues, isComplete, primaryIssue, type LineageFlags } from "@/lib/lineage";

const F = (o: Partial<LineageFlags>): LineageFlags => ({
  proof: "linked", published: true, sold: false, sent: false, failed: false, ...o,
});

describe("lineage 무결성 판정", () => {
  it("증빙연결+발행+미판매 = 정상(대기)", () => {
    expect(isComplete(F({ sold: false }))).toBe(true);
    expect(primaryIssue(F({ sold: false }))).toBe("complete");
  });
  it("증빙연결+발행+판매+발송 = 정상(완결)", () => {
    expect(isComplete(F({ sold: true, sent: true }))).toBe(true);
  });
  it("셀콘 시스템증빙도 증빙 충족", () => {
    expect(isComplete(F({ proof: "system" }))).toBe(true);
  });
  it("증빙 없음 → proof-missing", () => {
    expect(lineageIssues(F({ proof: "missing" }))).toContain("proof-missing");
  });
  it("미발행 → unpublished", () => {
    expect(lineageIssues(F({ published: false }))).toContain("unpublished");
  });
  it("판매됐는데 미발송 → dispatch-issue", () => {
    expect(lineageIssues(F({ sold: true, sent: false }))).toContain("dispatch-issue");
  });
  it("판매됐는데 발송실패 → dispatch-issue", () => {
    expect(primaryIssue(F({ sold: true, sent: false, failed: true }))).toBe("dispatch-issue");
  });
  it("미판매는 발송 미확인이어도 정상", () => {
    expect(isComplete(F({ sold: false, sent: false }))).toBe(true);
  });
  it("복합 이슈: 대표는 발송이상 우선", () => {
    expect(primaryIssue(F({ proof: "missing", sold: true, sent: false }))).toBe("dispatch-issue");
  });
});
