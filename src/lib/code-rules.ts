/**
 * 상품별 쿠폰번호 자리수 규칙 (OCR 오인식 사전 감지).
 *
 * 특정 상품은 쿠폰번호 자리수가 고정이라, OCR 결과가 그 자리수와 다르면 오인식으로 본다.
 * 새 규칙은 아래 CODE_RULES 배열에 한 줄 추가만 하면
 *   ① OCR 프롬프트(제미나이 안내)  ② 검수 화면 경고 배지
 * 양쪽에 자동 반영된다. (서버·클라이언트 공용 — 순수 모듈, 외부 의존 없음)
 */
export interface CodeRule {
  keyword: string;       // 상품명에 이 키워드가 포함되면 규칙 적용
  digits: number[];      // 허용되는 숫자 자리수(복수 가능). 예: [10]
  numericOnly?: boolean; // true면 숫자 외 문자가 섞여도 오인식으로 본다
  label: string;         // 안내·배지 표기용
}

// 규칙 목록 — 여기만 수정하면 됨
export const CODE_RULES: CodeRule[] = [
  { keyword: "배민상품권", digits: [10], numericOnly: true, label: "배민상품권" },
];

/** 코드 내 숫자 개수 */
export function digitCount(code: string): number {
  return (String(code ?? "").match(/\d/g) ?? []).length;
}

/** 상품명에 매칭되는 첫 규칙 (없으면 null) */
export function matchCodeRule(productName: string): CodeRule | null {
  const n = String(productName ?? "");
  return CODE_RULES.find((r) => n.includes(r.keyword)) ?? null;
}

export interface CodeDigitWarning {
  label: string;     // 규칙 라벨(예: 배민상품권)
  expected: number[]; // 기대 자리수
  actual: number;    // 실제 숫자 자리수
}

/**
 * 자리수 검증. 규칙이 있고 코드가 입력됐는데 자리수(또는 숫자전용 위반)가 어긋나면 경고 반환.
 * 규칙 없음 / 코드 미입력 / 정상 → null.
 */
export function checkCodeDigits(
  productName: string,
  couponCode: string,
): CodeDigitWarning | null {
  const rule = matchCodeRule(productName);
  if (!rule) return null;
  const code = String(couponCode ?? "").trim();
  if (!code) return null; // 빈 코드는 필수값 검증이 따로 처리
  const actual = digitCount(code);
  const lenOk = rule.digits.includes(actual);
  const cleanOk = !rule.numericOnly || /^\d+$/.test(code); // 숫자전용인데 문자 섞임?
  if (lenOk && cleanOk) return null;
  return { label: rule.label, expected: rule.digits, actual };
}

/** OCR 프롬프트용 자리수 안내 문구 (제미나이가 해당 자리수로 정확히 읽도록 유도) */
export function ocrDigitHint(): string {
  if (CODE_RULES.length === 0) return "";
  const parts = CODE_RULES.map(
    (r) => `${r.label}=${r.digits.join("/")}자리${r.numericOnly ? " 숫자" : ""}`,
  );
  return `참고 — 특정 상품의 쿠폰번호 자리수(반드시 이 자리수로 정확히 읽을 것): ${parts.join(", ")}.`;
}
