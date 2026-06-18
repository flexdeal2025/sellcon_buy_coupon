-- 공급처 거래명세서 라인 (매입등록 원천 + 카드 대조용)
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS public.supplier_statements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier     text    NOT NULL,                 -- 공급처 (예: 센드비)
  owner        text    NOT NULL DEFAULT '',       -- 매입 명의자 (예: 유정인)
  account      text    DEFAULT '',                -- 발송사이트 계정 (이메일/담당자)
  order_date   date    NOT NULL,                  -- 거래일자
  product_name text    NOT NULL DEFAULT '',       -- 브랜드 접두 제거한 정규화 상품명
  brand        text    DEFAULT '',                -- 브랜드([..] 접두)
  raw_product  text    DEFAULT '',                -- 원본 상품명
  quantity     integer NOT NULL DEFAULT 0,        -- 주문수량
  unit_price   integer NOT NULL DEFAULT 0,        -- 단가(소비자가/제공가)
  line_total   integer NOT NULL DEFAULT 0,        -- 거래금액(=수량×단가)
  registered   boolean NOT NULL DEFAULT false,    -- purchase_records 등록 여부
  purchase_id  uuid,                              -- 등록된 매입 id
  source_file  text    DEFAULT '',
  row_hash     text    NOT NULL,
  created_at   timestamptz DEFAULT now(),
  CONSTRAINT supplier_statements_row_hash_key UNIQUE (row_hash)
);

CREATE INDEX IF NOT EXISTS ss_supplier_idx ON public.supplier_statements (supplier);
CREATE INDEX IF NOT EXISTS ss_date_idx     ON public.supplier_statements (order_date);
CREATE INDEX IF NOT EXISTS ss_total_idx    ON public.supplier_statements (line_total);
CREATE INDEX IF NOT EXISTS ss_reg_idx      ON public.supplier_statements (registered);

ALTER TABLE public.supplier_statements DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_statements TO anon, authenticated;
