-- 재고 등록(이미지/코드) 스테이징 — 우리 Supabase
-- 등록·OCR·검수는 여기서 진행하고, '발행(승인)' 시에만 vivacon coupon_codes / GCP 로 내보낸다.
-- (실데이터는 발행 단계에서만 건드림 = 완전 대체 전까지 안전)
-- Supabase SQL Editor 에서 실행.

-- 업로드 배치
CREATE TABLE IF NOT EXISTS public.stock_batches (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_no                  text UNIQUE NOT NULL,            -- 예: 20260622_01
  storage_type              text NOT NULL DEFAULT 'image',   -- image | code
  default_product_name      text NOT NULL DEFAULT '',        -- 배치 전체 기본 상품명
  default_exchange_location text NOT NULL DEFAULT '',        -- 매입처(당근/중고나라 등)
  purchase_date             date,                            -- 매입일
  status                    text NOT NULL DEFAULT 'processing', -- processing | completed
  total_count               integer NOT NULL DEFAULT 0,
  created_by                text NOT NULL DEFAULT '',
  created_at                timestamptz DEFAULT now()
);
ALTER TABLE public.stock_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.stock_batches;
CREATE POLICY "anon_all" ON public.stock_batches FOR ALL USING (true) WITH CHECK (true);

-- 등록 항목 (기프티콘 1장 = 1행). OCR 결과 + 검수 수정값 + 발행 상태.
CREATE TABLE IF NOT EXISTS public.stock_registrations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           uuid REFERENCES public.stock_batches(id) ON DELETE CASCADE,

  -- 원본 이미지 (GCP OCR 버킷 경로)
  image_path         text NOT NULL DEFAULT '',

  -- OCR 추출 / 검수 수정값 (검수자가 직접 고침)
  product_name       text NOT NULL DEFAULT '',
  option_name        text NOT NULL DEFAULT '',
  coupon_code        text NOT NULL DEFAULT '',
  expiry_date        date,
  exchange_location  text NOT NULL DEFAULT '',  -- 교환처(GS25/CU 등, OCR)
  purchase_date      date,
  unit_cost          integer,                   -- 매입원가
  ocr_confidence     numeric(5,2),              -- 0~100
  extraction_quality text NOT NULL DEFAULT '',  -- high | medium | low
  ocr_raw            jsonb,                     -- OCR 원본 응답(디버그/재처리용)

  -- 검수 / 발행
  inspection_status  text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  stored_as_code     boolean NOT NULL DEFAULT true,   -- true=코드형, false=이미지형
  published          boolean NOT NULL DEFAULT false,  -- 실데이터로 내보냈는지
  published_ref      text NOT NULL DEFAULT '',        -- 발행 결과(coupon uuid 또는 GCP pending 경로)
  published_at       timestamptz,

  notes              text NOT NULL DEFAULT '',
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
ALTER TABLE public.stock_registrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.stock_registrations;
CREATE POLICY "anon_all" ON public.stock_registrations FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_stockreg_batch  ON public.stock_registrations (batch_id);
CREATE INDEX IF NOT EXISTS idx_stockreg_status ON public.stock_registrations (inspection_status);
CREATE INDEX IF NOT EXISTS idx_stockreg_pub    ON public.stock_registrations (published);

-- updated_at 자동 갱신 (set_updated_at 함수는 schema_supplier_accounts.sql 에서 생성됨)
DROP TRIGGER IF EXISTS stock_registrations_updated_at ON public.stock_registrations;
CREATE TRIGGER stock_registrations_updated_at
  BEFORE UPDATE ON public.stock_registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
