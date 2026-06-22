-- 매입 증빙 + 증빙↔재고 매핑 (당근/중고나라 거래내역 캡쳐를 재고와 연결)
-- 재고는 우리 stock_registrations(이미지형·코드형 공통 1행=1건)에 매핑.
-- Supabase SQL Editor 에서 실행 (schema_stock_registration.sql 이후)

-- 증빙 (거래내역/채팅 캡쳐)
CREATE TABLE IF NOT EXISTS public.purchase_proofs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform    text NOT NULL DEFAULT '',   -- 당근마켓 / 중고나라 등
  trader_name text NOT NULL DEFAULT '',   -- 거래자
  proof_date  date,                        -- 거래일
  amount      integer,                     -- 거래금액
  image_path  text NOT NULL DEFAULT '',    -- GCP proof/ 경로
  memo        text NOT NULL DEFAULT '',
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.purchase_proofs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.purchase_proofs;
CREATE POLICY "anon_all" ON public.purchase_proofs FOR ALL USING (true) WITH CHECK (true);

-- 증빙 ↔ 재고 매핑. 증빙 1개가 여러 재고에 연결 가능(N:1).
-- registration_id UNIQUE → 재고 1건은 증빙 1개에만 매핑(이중 증빙 방지).
CREATE TABLE IF NOT EXISTS public.proof_registration_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id        uuid NOT NULL REFERENCES public.purchase_proofs(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL UNIQUE REFERENCES public.stock_registrations(id) ON DELETE CASCADE,
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE public.proof_registration_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON public.proof_registration_links;
CREATE POLICY "anon_all" ON public.proof_registration_links FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_prooflink_proof ON public.proof_registration_links (proof_id);
