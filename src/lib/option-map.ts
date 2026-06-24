import type { getServerSupabase } from "@/lib/supabase/server";

/** 옵션명 미매칭 시 기본값 (알림톡 발송 필수값) */
export const DEFAULT_OPTION = "유효기간 최소 10일 이상 쿠폰 발송";

const norm = (s: string) => s.replace(/^\[비바콘\]\s*/, "").replace(/\s+/g, "").toLowerCase();

/**
 * 상품명 → 옵션명 자동매핑. product_option_map 의 product_match 부분일치, 미매칭 시 DEFAULT_OPTION.
 * (수집봇 등록·발행 보완에서 공통 사용)
 */
export async function resolveOptionName(
  sb: ReturnType<typeof getServerSupabase>,
  productName: string,
): Promise<string> {
  const n = norm(productName);
  if (!n) return DEFAULT_OPTION;
  const { data } = await sb.from("product_option_map").select("product_match, option_name");
  const maps = (data ?? []) as { product_match: string; option_name: string }[];
  const hit = maps.find((m) => n.includes(norm(m.product_match)));
  return hit?.option_name ?? DEFAULT_OPTION;
}
