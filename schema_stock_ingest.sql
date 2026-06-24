-- 셀콘 → 컨트롤타워 재고 직결 (POST/DELETE /api/stock/ingest)
-- 실행 순서: schema_stock_registration.sql 다음
-- 기존 컬럼 무수정, 컬럼 추가 + 멱등 유니크 인덱스만. (기존 수동/텔레그램 등록 영향 0)
-- 적용 전: 셀콘은 잠자기 상태(STOCK_INGEST_KEY 미설정)라 호출하지 않음.

ALTER TABLE public.stock_registrations
  ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT 'manual',  -- manual | telegram | sellcon
  ADD COLUMN IF NOT EXISTS source_ref         text NOT NULL DEFAULT '',        -- 외부 멱등키(예: sellcon_gifticon_<id>)
  -- 핵심 증빙 세트 (A경로)
  ADD COLUMN IF NOT EXISTS purchase_channel   text NOT NULL DEFAULT '',        -- sellcon_auto 등
  ADD COLUMN IF NOT EXISTS proof_type         text NOT NULL DEFAULT '',        -- no_formal_sellcon 등 (적격증빙 비중 집계 기준)
  ADD COLUMN IF NOT EXISTS payout_uuid        text NOT NULL DEFAULT '',        -- 셀콘 정산건 ID(gifticons.id) — 소명 조회키
  ADD COLUMN IF NOT EXISTS payout_amount      integer,                         -- 실지급액(원가+보너스)
  ADD COLUMN IF NOT EXISTS payout_date        date,                            -- 지급(정산)일 — Phase2 스냅샷에서 확정
  ADD COLUMN IF NOT EXISTS bonus_amount       integer,                         -- 프로모션 보너스(원가 아님, 별도집계)
  -- 매도자: 평문 PII 미저장. 링크키 + 마스킹명만
  ADD COLUMN IF NOT EXISTS seller_ref         text NOT NULL DEFAULT '',        -- 셀콘 sellerId(불투명) — 원천징수 누적·소명 조회용
  ADD COLUMN IF NOT EXISTS seller_name_masked text NOT NULL DEFAULT '',        -- 홍*동
  -- 이미지형: 원본 공개 URL 보존(GCP materialize는 발행/후속 단계)
  ADD COLUMN IF NOT EXISTS source_image_url   text NOT NULL DEFAULT '';

-- 멱등성: 같은 source_ref는 1건만. 빈 값(기존 수동/텔레그램)은 인덱스에서 제외 → 기존 데이터 안전
CREATE UNIQUE INDEX IF NOT EXISTS idx_stockreg_source_ref
  ON public.stock_registrations (source_ref) WHERE source_ref <> '';

-- 출처/증빙 집계용 보조 인덱스
CREATE INDEX IF NOT EXISTS idx_stockreg_channel ON public.stock_registrations (purchase_channel);
CREATE INDEX IF NOT EXISTS idx_stockreg_seller  ON public.stock_registrations (seller_ref);

-- 적격증빙 없는 매입 비중(예시 쿼리):
--   SELECT CASE WHEN proof_type LIKE 'no_%' THEN '적격없음' ELSE '적격있음' END 구분,
--          COUNT(*) 건수, COALESCE(SUM(unit_cost),0) 금액
--   FROM public.stock_registrations WHERE purchase_channel='sellcon_auto' GROUP BY 1;
