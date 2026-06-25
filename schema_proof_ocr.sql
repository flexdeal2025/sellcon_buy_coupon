-- ============================================================================
-- 증빙 OCR 자동매핑 — purchase_proofs 부가 컬럼
--
-- 목적: 당근마켓 거래내역 캡쳐를 OCR로 자동 추출(상품명·금액·거래상대·거래번호)하고,
--       OCR 상품명과 재고 상품명을 유사도 매칭해 자동 추천(N:1 포함)하기 위함.
--
-- 동작: 이 마이그레이션을 적용하지 않아도 업로드는 동작한다(부가 컬럼 저장만 무시됨).
--       적용 후부터 OCR 자동채움 + '추천 매핑' 기능이 활성화된다.
--
-- 실행: Supabase SQL Editor 에서 1회 실행.
-- ============================================================================

ALTER TABLE public.purchase_proofs
  ADD COLUMN IF NOT EXISTS trade_type       text,     -- 바로구매 / 머니송금
  ADD COLUMN IF NOT EXISTS ocr_product_name text,     -- OCR 추출·정제 상품명(매칭 기준)
  ADD COLUMN IF NOT EXISTS product_amount   integer,  -- 상품금액(바로구매). 총액과 별개
  ADD COLUMN IF NOT EXISTS trade_no         text,     -- 거래번호(KPE…) — 중복 증빙 방지
  ADD COLUMN IF NOT EXISTS ocr_confidence   integer;  -- OCR 확신도 0~100

COMMENT ON COLUMN public.purchase_proofs.ocr_product_name IS 'OCR 추출 상품명(정제). 재고 상품명과 유사도 매칭에 사용';
COMMENT ON COLUMN public.purchase_proofs.trade_no IS '당근 거래번호. 같은 증빙 재업로드 방지용 고유키';

-- 거래번호 중복 방지(빈값/NULL 제외 부분 유니크 인덱스)
CREATE UNIQUE INDEX IF NOT EXISTS purchase_proofs_trade_no_uniq
  ON public.purchase_proofs (trade_no)
  WHERE trade_no IS NOT NULL AND trade_no <> '';

-- ============================================================================
-- [롤백] 부가 컬럼 제거:
--   DROP INDEX IF EXISTS public.purchase_proofs_trade_no_uniq;
--   ALTER TABLE public.purchase_proofs
--     DROP COLUMN IF EXISTS trade_type,
--     DROP COLUMN IF EXISTS ocr_product_name,
--     DROP COLUMN IF EXISTS product_amount,
--     DROP COLUMN IF EXISTS trade_no,
--     DROP COLUMN IF EXISTS ocr_confidence;
-- ============================================================================
