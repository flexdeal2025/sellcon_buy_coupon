import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 외주(비바콘) Supabase 프로젝트 전용 클라이언트.
 * ⚠️ service_role 키를 사용하므로 **서버에서만** 호출해야 합니다.
 * (route handler / server action 안에서만 import)
 */
let cached: SupabaseClient | null = null;

export function getVivaconSupabase(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("getVivaconSupabase 는 서버에서만 사용할 수 있습니다.");
  }
  if (cached) return cached;

  const url = process.env.VIVACON_SUPABASE_URL;
  const key = process.env.VIVACON_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("VIVACON_SUPABASE_URL / VIVACON_SUPABASE_SERVICE_KEY 미설정");
  }

  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export const COUPON_STATUSES = ["available", "allocated", "disabled", "exchanged"] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

/** 수정 허용 컬럼 (이 외에는 서버가 무시) */
export const EDITABLE_FIELDS = [
  "상품명",
  "옵션명",
  "coupon_code",
  "expiry_date",
  "status",
  "이슈사항",
  "매입원가",
] as const;

/** 가벼운 보호: 앱 passcode 헤더 검증 (drive-by 차단용. 강한 인증 아님) */
export function checkAppPasscode(req: Request): boolean {
  const expected = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";
  return req.headers.get("x-app-passcode") === expected;
}

/** 입력 patch 를 허용 컬럼만 남기고 정제. 유효기간은 YYMMDD 집계칸을 자동 동기화. */
export function sanitizeCouponPatch(
  patch: Record<string, unknown>,
): { update?: Record<string, unknown>; error?: string } {
  const update: Record<string, unknown> = {};
  if ("상품명" in patch) update["상품명"] = String(patch["상품명"] ?? "").trim();
  if ("옵션명" in patch) update["옵션명"] = String(patch["옵션명"] ?? "").trim();
  if ("coupon_code" in patch) update["coupon_code"] = String(patch["coupon_code"] ?? "").trim();
  if ("이슈사항" in patch) update["이슈사항"] = String(patch["이슈사항"] ?? "").trim();
  if ("매입원가" in patch) {
    const raw = String(patch["매입원가"] ?? "").replace(/[^0-9-]/g, "");
    update["매입원가"] = raw === "" ? null : Number(raw);
  }
  if ("status" in patch) {
    const s = String(patch["status"] ?? "");
    if (!COUPON_STATUSES.includes(s as CouponStatus)) return { error: `status 값 오류: ${s}` };
    update["status"] = s;
  }
  if ("expiry_date" in patch) {
    const d = String(patch["expiry_date"] ?? "").trim();
    if (d === "") {
      update["expiry_date"] = null;
      update["expiry_yymmdd"] = null;
    } else {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
      if (!m) return { error: "유효기간 형식 오류(YYYY-MM-DD)" };
      update["expiry_date"] = d;
      update["expiry_yymmdd"] = m[1].slice(2) + m[2] + m[3];
    }
  }
  if (Object.keys(update).length === 0) return { error: "수정할 항목 없음" };
  return { update };
}

/** 조회·반환 공통 컬럼 셀렉트 (전 컬럼) */
export const COUPON_SELECT =
  "id,상품명,옵션명,coupon_code,expiry_date,expiry_yymmdd,status,매입원가,이슈사항,batch_id,allocated_to,allocated_at,created_at";
