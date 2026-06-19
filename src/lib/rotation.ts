import type { PurchaseRecord } from "./types";

/** 날짜 내림차순 정렬 비교 함수 */
function byDateDesc(a: PurchaseRecord, b: PurchaseRecord): number {
  const d = (b.purchase_date ?? "").localeCompare(a.purchase_date ?? "");
  return d !== 0 ? d : (b.created_at ?? "").localeCompare(a.created_at ?? "");
}

/** 직전 매입에서 사용한 회선 번호 전체를 반환합니다. 기록이 없으면 빈 배열. */
export function getLastUsedLines(
  records: PurchaseRecord[],
  supplier: string,
): number[] {
  const prior = records
    .filter(
      (r) =>
        r.supplier?.trim() === supplier.trim() &&
        Array.isArray(r.allocated_phone_ids) &&
        r.allocated_phone_ids.length > 0,
    )
    .sort(byDateDesc);
  return prior.length === 0 ? [] : prior[0].allocated_phone_ids;
}

/**
 * 특정 매입처의 "직전 매입에서 사용한 가장 높은 회선 번호"를 찾습니다.
 * 기록이 없으면 null.
 * @deprecated getLastUsedLines 로 대체. 하위 호환용으로 유지.
 */
export function getLastUsedHighest(
  records: PurchaseRecord[],
  supplier: string,
): number | null {
  const lines = getLastUsedLines(records, supplier);
  return lines.length === 0 ? null : Math.max(...lines);
}

/**
 * 주문수량과 번호당 제한으로 필요한 회선 수를 계산합니다.
 */
export function requiredLineCount(
  orderedQuantity: number,
  limitPerNumber: number,
): number {
  if (!orderedQuantity || !limitPerNumber || limitPerNumber <= 0) return 0;
  return Math.ceil(orderedQuantity / limitPerNumber);
}

export interface RotationSuggestion {
  start: number | null; // 추천 시작 번호 (활성 회선 기준)
  sequences: number[]; // 실제 추천된 sequence_number 배열
  wrapped: boolean; // 56 → 1 순환이 발생했는지
  enough: boolean; // 활성 회선이 count 만큼 충분한지
}

/**
 * 순차 순환(Rotation) 추천.
 * - activeSequences: 현재 활성화된 회선의 sequence_number 목록 (정렬 무관)
 * - lastHighest: 직전 매입에서 쓴 가장 높은 번호 (없으면 null → 1번부터)
 * - count: 이번에 필요한 회선 수
 *
 * lastHighest 다음 번호부터 활성 회선을 count 개 순환 선택합니다.
 * (56번을 넘으면 1번으로 되돌아갑니다.)
 */
export function recommendRotation(
  activeSequences: number[],
  lastHighest: number | null,
  count: number,
): RotationSuggestion {
  const sorted = [...new Set(activeSequences)].sort((a, b) => a - b);
  if (count <= 0 || sorted.length === 0) {
    return { start: null, sequences: [], wrapped: false, enough: false };
  }

  // 시작 번호: 직전 최고번호 다음. 없으면 가장 작은 활성 번호.
  const startThreshold = lastHighest === null ? -Infinity : lastHighest;

  // startThreshold 보다 큰 첫 활성 번호의 인덱스 (없으면 0 = 순환하여 맨 앞)
  let startIdx = sorted.findIndex((s) => s > startThreshold);
  let wrapped = false;
  if (startIdx === -1) {
    startIdx = 0;
    wrapped = lastHighest !== null; // 직전 기록이 있는데 처음으로 되돌아간 경우
  }

  const sequences: number[] = [];
  const take = Math.min(count, sorted.length);
  for (let i = 0; i < take; i++) {
    const idx = (startIdx + i) % sorted.length;
    if (idx < startIdx + i && idx <= startIdx) wrapped = true; // 순환 발생 표시
    sequences.push(sorted[idx]);
  }

  return {
    start: sequences[0] ?? null,
    sequences,
    wrapped,
    enough: count <= sorted.length,
  };
}

/**
 * 연속된 sequence 배열을 "#21~#35, #40" 형태의 압축 문자열로 표현.
 */
export function formatSequenceRanges(seqs: number[]): string {
  if (!seqs || seqs.length === 0) return "—";
  const sorted = [...new Set(seqs)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    ranges.push(start === prev ? `#${start}` : `#${start}~#${prev}`);
    start = cur;
    prev = cur;
  }
  return ranges.join(", ");
}
