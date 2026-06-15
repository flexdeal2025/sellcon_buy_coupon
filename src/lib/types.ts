// 매입 워크플로우 상태
export type PurchaseStatus = "매입등록" | "재고확인중" | "이슈발생" | "완료";

export const PURCHASE_STATUSES: PurchaseStatus[] = [
  "매입등록",
  "재고확인중",
  "이슈발생",
  "완료",
];

// 미완료로 간주하는 상태 (대시보드 요약용)
export const OPEN_STATUSES: PurchaseStatus[] = ["매입등록", "재고확인중", "이슈발생"];

// 부분 입고 로그 1건
export interface DeliveryLog {
  date: string; // YYYY-MM-DD
  quantity: number; // 이번에 확인한 수량
  worker: string; // 작업자
  note?: string; // 메모
}

// phone_lines 테이블 행
export interface PhoneLine {
  id: string;
  sequence_number: number;
  phone_number: string | null;
  alias: string | null;
  is_active: boolean;
  created_at: string;
}

// purchase_records 테이블 행
export interface PurchaseRecord {
  id: string;
  purchase_date: string;
  supplier: string;
  product_name: string;
  ordered_quantity: number;
  received_quantity: number;
  limit_per_number: number;
  allocated_phone_ids: number[];
  unit_price: number;
  total_price: number;
  account_email: string | null;
  evidence_type: string | null;
  status: PurchaseStatus;
  status_updated_by: string | null;
  delivery_logs: DeliveryLog[];
  checked_phone_ids: number[]; // 쿠폰 발송 확인 완료된 회선 sequence_number 목록
  notes: string | null;
  created_at: string;
}

// 신규 매입 등록 시 insert payload
export type PurchaseInsert = Omit<PurchaseRecord, "id" | "created_at">;
