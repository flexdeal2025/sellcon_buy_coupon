-- ════════════════════════════════════════════════════════════════════════
--  기프티콘 매입 관리 앱 — Supabase 스키마
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- ════════════════════════════════════════════════════════════════════════

-- UUID 생성 확장 (Supabase 기본 포함이지만 안전하게 명시)
create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────────────────
-- 1) phone_lines : 보유 회선 풀 (1~56번, 추가/삭제 가능)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.phone_lines (
  id              uuid primary key default gen_random_uuid(),
  sequence_number integer not null unique,          -- 1 ~ 56 순번 (고유)
  phone_number    text,                             -- 실제 전화번호
  alias           text,                             -- 대역/별칭 (예: "A대역", "SKT-1")
  is_active       boolean not null default true,    -- 사용 가능 여부
  created_at      timestamptz not null default now()
);

create index if not exists phone_lines_seq_idx on public.phone_lines (sequence_number);

-- ────────────────────────────────────────────────────────────────────────
-- 2) purchase_records : 매입 현황 및 워크플로우
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.purchase_records (
  id                 uuid primary key default gen_random_uuid(),
  purchase_date      date not null default current_date,
  supplier           text not null,                       -- 매입처명
  product_name       text not null,                       -- 상품명
  ordered_quantity   integer not null default 0,          -- 주문수량
  received_quantity  integer not null default 0,          -- 실제 확인된 총 입고수량
  limit_per_number   integer not null default 0,          -- 번호당 수신제한량
  allocated_phone_ids integer[] not null default '{}',    -- 할당된 sequence_number 배열
  unit_price         numeric(12, 2) not null default 0,   -- 매입단가 (소수점)
  total_price        numeric(14, 2) not null default 0,   -- 총 매입액
  account_email      text,                                -- 계정 이메일
  evidence_type      text,                                -- '세금계산서' | '카드' | '현금영수증' ...
  status             text not null default '매입등록'
                       check (status in ('매입등록','재고확인중','이슈발생','완료')),
  status_updated_by  text,                                -- 마지막 상태 변경자
  delivery_logs      jsonb not null default '[]'::jsonb,  -- [{date, quantity, note, worker}]
  notes              text,
  created_at         timestamptz not null default now()
);

create index if not exists purchase_records_status_idx on public.purchase_records (status);
create index if not exists purchase_records_date_idx   on public.purchase_records (purchase_date desc);
create index if not exists purchase_records_supplier_idx on public.purchase_records (supplier);

-- ────────────────────────────────────────────────────────────────────────
-- 3) Realtime 활성화 (변경사항 즉시 동기화)
-- ────────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.purchase_records;
alter publication supabase_realtime add table public.phone_lines;

-- ────────────────────────────────────────────────────────────────────────
-- 4) RLS (Row Level Security)
--    앱 진입은 4자리 Passcode 로 통제하고, DB 접근은 anon 키로 합니다.
--    부부 둘만 쓰는 비공개 내부 앱이므로 anon 에 전체 CRUD 를 허용합니다.
--    (외부 공개가 필요해지면 Supabase Auth 로 전환하세요.)
-- ────────────────────────────────────────────────────────────────────────
alter table public.phone_lines      enable row level security;
alter table public.purchase_records enable row level security;

drop policy if exists "allow_all_phone_lines" on public.phone_lines;
create policy "allow_all_phone_lines" on public.phone_lines
  for all using (true) with check (true);

drop policy if exists "allow_all_purchase_records" on public.purchase_records;
create policy "allow_all_purchase_records" on public.purchase_records
  for all using (true) with check (true);

-- ────────────────────────────────────────────────────────────────────────
-- 5) 시드 데이터 : 1~56번 회선 자동 생성 (없을 때만)
-- ────────────────────────────────────────────────────────────────────────
insert into public.phone_lines (sequence_number, alias, is_active)
select g, '회선 ' || g, true
from generate_series(1, 56) as g
on conflict (sequence_number) do nothing;
