-- 성능 인덱스 (데이터 증가 대비). 자주 필터/조인되는데 인덱스가 없던 컬럼.
-- 현재 규모(수백~수천 행)에선 체감 차이 적지만, 수만 행으로 커질 때 조회 속도 유지.
-- Supabase SQL Editor 에서 1회 실행 (IF NOT EXISTS라 재실행 안전).

-- 추적/중복검사/발행/리니지에서 coupon_code로 조회
CREATE INDEX IF NOT EXISTS idx_stockreg_coupon   ON public.stock_registrations (coupon_code);
-- 리니지 무결성·증빙누락알림에서 매입일 범위 조회
CREATE INDEX IF NOT EXISTS idx_stockreg_purchase ON public.stock_registrations (purchase_date);
-- 증빙매핑·리니지 매입처 필터
CREATE INDEX IF NOT EXISTS idx_stockreg_supplier ON public.stock_registrations (supplier);
