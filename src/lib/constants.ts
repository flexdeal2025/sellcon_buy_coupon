// 기본 회선 총 개수 (DB의 phone_lines 가 비어있을 때 폴백)
export const DEFAULT_TOTAL_LINES = 56;

// 자주 쓰는 매입처 프리셋 (사용자가 회선/세무 페이지에서 수정 가능)
export const DEFAULT_SUPPLIERS = [
  "지에스쿠폰",
  "센드비",
  "쿠칩",
  "이음기프트",
  "기쇼비즈",
];

// 자주 쓰는 상품명 프리셋
export const DEFAULT_PRODUCTS = [
  "메가박스 2인패키지",
  "세븐일레븐 5만",
  "CGV 1만",
  "스타벅스 3만",
  "GS25 3만",
];

// 증빙 유형
export const EVIDENCE_TYPES = ["세금계산서", "카드", "현금영수증", "기타"];

// localStorage 키
export const LS_KEYS = {
  passcodeOk: "gc_passcode_ok",
  worker: "gc_worker_name",
  suppliers: "gc_preset_suppliers",
  products: "gc_preset_products",
} as const;

// 작업자(부부) 기본 후보
export const DEFAULT_WORKERS = ["남편", "아내"];
