/**
 * 증빙 ↔ 재고 자동 매핑용 유사도 로직 (순수 함수, 서버/클라 공용).
 * 외부 API 없이 상품명 정규화 + char-bigram Jaccard 유사도로 후보를 순위화한다.
 */

/** 상품명 정규화: 거래 접두·접미사, 공백, 특수문자 제거 후 소문자화 */
export function normalizeName(s: string): string {
  return String(s ?? "")
    .replace(/\[[^\]]*\]/g, " ") // [판매] [삽니다] …
    .replace(/기프티콘|교환권|모바일상품권|상품권|쿠폰|팝니다|삽니다|판매|구매/g, " ")
    .replace(/[^가-힣a-zA-Z0-9]+/g, "") // 공백·특수문자 제거
    .toLowerCase();
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length <= 1) {
    if (s) set.add(s);
    return set;
  }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** 두 상품명의 유사도 0~1 (정규화 + char-bigram Jaccard, 포함관계 보정) */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // 한쪽이 다른 쪽을 완전히 포함하면 높은 점수 (예: "교촌치킨허니콤보콜라" ⊂ "교촌치킨허니콤보콜라125l")
  if (na.includes(nb) || nb.includes(na)) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    return 0.85 + 0.15 * ratio;
  }
  const A = bigrams(na);
  const B = bigrams(nb);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface MatchCandidate {
  registration_id: string;
  product_name: string;
  option_name?: string | null;
  unit_cost?: number | null;
  coupon_code?: string | null;
  expiry_date?: string | null;
  created_at?: string | null;
  purchase_date?: string | null;
  score: number; // 상품명 유사도 0~1
  date_close: boolean; // 거래일과 등록/매입일이 ±2일 이내
}

export interface SuggestInput {
  proof_product_name: string;
  proof_date?: string | null; // YYYY-MM-DD
  total_amount?: number | null;
  product_amount?: number | null;
  registrations: Array<{
    id: string;
    product_name: string;
    option_name?: string | null;
    unit_cost?: number | null;
    coupon_code?: string | null;
    expiry_date?: string | null;
    created_at?: string | null;
    purchase_date?: string | null;
  }>;
}

export interface SuggestResult {
  candidates: MatchCandidate[]; // 점수 내림차순
  /** 자동 추천 묶음(N:1 포함): 금액이 맞아떨어지면 합계가 일치하는 조합, 아니면 최고점 단건 */
  recommended_ids: string[];
  amount_matched: boolean; // 추천 묶음의 매입원가 합 == 증빙 금액
}

const DATE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

function dateClose(proofDate: string | null | undefined, regDate: string | null | undefined): boolean {
  if (!proofDate || !regDate) return false;
  const a = Date.parse(proofDate.slice(0, 10));
  const b = Date.parse(String(regDate).slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= DATE_WINDOW_MS;
}

/**
 * 한 증빙에 대해 후보 재고를 순위화하고 추천 묶음을 계산.
 * - 1:1 기본: 최고 유사도 단건이 금액과 맞으면 그것
 * - N:1: 동일/유사 상품 여러 건의 매입원가 합이 증빙 금액과 맞으면 묶음 추천
 */
export function suggestMatches(input: SuggestInput, opts?: { minScore?: number }): SuggestResult {
  const minScore = opts?.minScore ?? 0.45;
  const targets = [input.total_amount, input.product_amount].filter(
    (v): v is number => typeof v === "number" && v > 0,
  );

  const candidates: MatchCandidate[] = input.registrations
    .map((r) => ({
      registration_id: r.id,
      product_name: r.product_name,
      option_name: r.option_name,
      unit_cost: r.unit_cost,
      coupon_code: r.coupon_code,
      expiry_date: r.expiry_date,
      created_at: r.created_at,
      purchase_date: r.purchase_date,
      score: nameSimilarity(input.proof_product_name, r.product_name),
      date_close: dateClose(input.proof_date, r.purchase_date ?? r.created_at),
    }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // 동점이면 거래일 근접 우선
      if (a.date_close !== b.date_close) return a.date_close ? -1 : 1;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });

  if (candidates.length === 0) {
    return { candidates, recommended_ids: [], amount_matched: false };
  }

  const matchesTarget = (sum: number) => targets.some((t) => t === sum);

  // 1) 최고점 단건이 금액과 일치하면 1:1 확정
  const top = candidates[0];
  if (typeof top.unit_cost === "number" && matchesTarget(top.unit_cost)) {
    return { candidates, recommended_ids: [top.registration_id], amount_matched: true };
  }

  // 2) N:1 — 동일 상품(최고점과 같은 정규화명)군의 누적 합이 금액과 맞는 조합 탐색
  if (targets.length > 0) {
    const topNorm = normalizeName(top.product_name);
    const sameProduct = candidates.filter((c) => normalizeName(c.product_name) === topNorm);
    let sum = 0;
    const picked: string[] = [];
    for (const c of sameProduct) {
      if (typeof c.unit_cost !== "number") break;
      sum += c.unit_cost;
      picked.push(c.registration_id);
      if (matchesTarget(sum)) {
        return { candidates, recommended_ids: picked, amount_matched: true };
      }
      if (targets.every((t) => sum > t)) break; // 모든 목표 초과 시 중단
    }
  }

  // 3) 금액 매칭 실패 — 최고점 단건만 추천(사용자 검수)
  return { candidates, recommended_ids: [top.registration_id], amount_matched: false };
}
