/**
 * 상품별 쿠폰번호 길이 규칙 (OCR 오인식 사전 감지).
 *
 * 특정 상품은 쿠폰번호 길이(자리수)가 고정이라, OCR 결과가 그 길이와 다르면 오인식으로 본다.
 * "자리수"는 글자 수(문자 길이) 기준 — 배민상품권처럼 영문+숫자 혼합 코드도 10자리=10글자.
 * 새 규칙은 아래 CODE_RULES 배열에 한 줄 추가만 하면
 *   ① OCR 프롬프트(제미나이 안내)  ② 검수 화면 경고 배지
 * 양쪽에 자동 반영된다. (서버·클라이언트 공용 — 순수 모듈, 외부 의존 없음)
 */
export interface CodeRule {
  keyword: string;    // 상품명에 이 키워드가 포함되면 규칙 적용
  length: number[];   // 허용되는 코드 길이(글자 수, 복수 가능). 예: [10]
  label: string;      // 안내·배지 표기용
  note?: string;      // OCR 힌트 부가설명(예: "영문+숫자")
}

// 규칙 목록 — 여기만 수정하면 됨. ("상품 키워드 → 길이" 추가)
export const CODE_RULES: CodeRule[] = [
  { keyword: "배민상품권", length: [10], label: "배민상품권", note: "영문+숫자 10자리" },
];

/** 코드 길이(공백 제거 후 글자 수) */
export function codeLength(code: string): number {
  return String(code ?? "").replace(/\s+/g, "").length;
}

/** 상품명에 매칭되는 첫 규칙 (없으면 null) */
export function matchCodeRule(productName: string): CodeRule | null {
  const n = String(productName ?? "");
  return CODE_RULES.find((r) => n.includes(r.keyword)) ?? null;
}

export interface CodeLengthWarning {
  label: string;      // 규칙 라벨(예: 배민상품권)
  expected: number[]; // 기대 길이
  actual: number;     // 실제 길이
}

/**
 * 길이 검증. 규칙이 있고 코드가 입력됐는데 길이가 어긋나면 경고 반환.
 * 규칙 없음 / 코드 미입력 / 정상 → null.
 */
export function checkCodeLength(
  productName: string,
  couponCode: string,
): CodeLengthWarning | null {
  const rule = matchCodeRule(productName);
  if (!rule) return null;
  const code = String(couponCode ?? "").replace(/\s+/g, "").trim();
  if (!code) return null; // 빈 코드는 필수값 검증이 따로 처리
  const actual = code.length;
  if (rule.length.includes(actual)) return null; // 길이 일치 → 정상
  return { label: rule.label, expected: rule.length, actual };
}

/** OCR 프롬프트용 길이 안내 문구 (제미나이가 해당 길이로 정확히 읽도록 유도) */
export function ocrLengthHint(): string {
  if (CODE_RULES.length === 0) return "";
  const parts = CODE_RULES.map(
    (r) => `${r.label}=${r.length.join("/")}자리${r.note ? `(${r.note})` : ""}`,
  );
  return `참고 — 특정 상품의 쿠폰번호 길이(반드시 이 길이로 정확히 읽을 것): ${parts.join(", ")}.`;
}
