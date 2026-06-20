# 🎟️ 기프티콘 매입 관리 앱

부부가 함께 운영하는 기프티콘 대량 매입 비즈니스를 위한 관리 웹 앱입니다.
**PC·모바일 모두 동작하며, 모바일 한 손 입력/조회에 최적화**된 반응형 UI로 제작되었습니다.

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| 🔒 4자리 Passcode 잠금 | 앱 진입 차단막 + 세션 유지(재방문 시 자동 통과) |
| 🔄 56회선 순차 순환 추천 | 매입처별 직전 사용 최고번호 다음부터 자동 추천·일괄선택 (56→1 순환) |
| ⚡ 양방향 단가 계산기 | 수량×단가=총액, 총액÷수량=단가(소수점) 자동 양방향 계산 |
| 📦 부분 입고 로그 | 나눠 들어오는 입고를 날짜·수량·작업자·메모로 누적 기록(타임라인) |
| 📡 실시간 동기화 | Supabase Realtime 으로 부부 화면이 새로고침 없이 즉시 반영 |
| 📲 텔레그램 알림 | 신규 매입 등록·상태 변경(이슈발생 등) 시 단톡방 자동 알림 |
| 🧾 세무 관리 | 기간·매입처·증빙별 필터 + CSV 다운로드(세무사 제출용) |
| ⭐ 프리셋 | 자주 쓰는 매입처/상품명 원터치 선택으로 모바일 타이핑 최소화 |

## 🧱 기술 스택

- **Frontend**: Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui 스타일
- **Backend/DB**: Supabase (PostgreSQL + Realtime)
- **알림**: Telegram Bot API (Next.js Route Handler 연동)
- **배포**: Vercel(무료) + Supabase(무료)

## 🚀 시작하기

### 1) 의존성 설치

```bash
npm install
```

### 2) Supabase 프로젝트 준비

1. [supabase.com](https://supabase.com) 에서 무료 프로젝트 생성
2. **SQL Editor** 에 [`schema.sql`](./schema.sql) 전체를 붙여넣고 실행
   - `phone_lines`, `purchase_records` 테이블 생성
   - **1~56번 회선 자동 시드**
   - Realtime publication 등록 + RLS 정책 설정
3. **Project Settings → API** 에서 `Project URL` 과 `anon public` 키 복사

> ℹ️ Realtime 이 동작하지 않으면 Supabase 대시보드 → **Database → Replication** 에서
> `purchase_records`, `phone_lines` 테이블의 Realtime 이 켜져 있는지 확인하세요.

### 3) 텔레그램 봇 준비 (선택)

1. [@BotFather](https://t.me/BotFather) 에서 `/newbot` 으로 봇 생성 → **토큰** 발급
2. 알림 받을 단톡방에 봇 초대
3. `https://api.telegram.org/bot<토큰>/getUpdates` 접속 → 메시지의 `chat.id` 확인

### 4) 환경변수 설정

[`.env.example`](./.env.example) 를 복사해 `.env.local` 을 만들고 값을 채웁니다.

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...        # 서버 전용(노출 금지)

NEXT_PUBLIC_APP_PASSCODE=1234                 # 부부 공유 4자리 암호

TELEGRAM_BOT_TOKEN=123456:AA...               # 없으면 알림만 비활성
TELEGRAM_CHAT_ID=-100123456789
```

### 5) 개발 서버 실행

```bash
npm run dev
# http://localhost:3000
```

## ☁️ Vercel 배포

1. GitHub 에 푸시 후 [Vercel](https://vercel.com) 에서 Import
2. **Settings → Environment Variables** 에 위 `.env.local` 값들을 그대로 등록
   - `NEXT_PUBLIC_*` 와 서버 키(`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_*`) 모두 등록
3. Deploy — 끝. (별도 빌드 설정 불필요)

> 모바일 홈 화면에 추가하면 PWA 처럼 전체화면으로 사용할 수 있습니다.

## 🗺️ 화면 구성

| 경로 | 화면 | 주 사용자 |
|------|------|-----------|
| `/` | 현황 홈 (이번 달 매입액·미완료 요약 + 실시간 카드 리스트) | 공통 |
| `/new` | 매입 입력 (프리셋·양방향 계산기·순환 추천 회선 선택) | 입력 담당 |
| `/inventory` | 재고 확인·마감 (부분 입고 추가·타임라인·완료 마감) | 입고 담당(배우자) |
| `/manage` | 정산·세무 (손익 / AI분석 / 카드장부 / 매입대조 / 세무) | 공통 |
| `/settings` | 설정 (회선 / 계정정보 / 프리셋) | 공통 |
| `/admin/architecture` | 사업방향 (자동화 아키텍처 맵) | 공통 |

## 🔁 순환 추천 로직

`src/lib/rotation.ts`

1. 입력한 **매입처의 직전 매입 기록**에서 사용한 회선 중 **가장 높은 번호**를 찾습니다.
2. 그 **다음 번호**부터 활성 회선을 필요한 개수만큼 순서대로 추천합니다.
3. 최대 번호(기본 56)를 넘으면 **1번으로 순환**합니다.
4. 비활성 회선은 건너뜁니다. "추천 번호 일괄 선택" 버튼으로 한 번에 적용됩니다.

## 🧮 양방향 계산기 로직

`src/lib/calc.ts` — 수량/단가/총액 중 마지막으로 수정한 값을 기준으로 나머지를 재계산.
총액 기준 입력 시 단가는 소수점 2자리까지 역산됩니다.

## 📁 프로젝트 구조

```
schema.sql                     # Supabase 스키마(테이블·RLS·시드·Realtime)
src/
  app/
    layout.tsx                 # Passcode 게이트 + 앱 셸
    page.tsx                   # 현황 홈(대시보드)
    new/page.tsx               # 매입 입력
    inventory/page.tsx         # 재고 확인·마감
    manage/page.tsx            # 회선/세무/프리셋
    api/notify/route.ts        # 텔레그램 알림 엔드포인트
  components/
    ui/                        # shadcn 스타일 프리미티브
    passcode-gate.tsx          # 4자리 잠금 + 세션
    app-shell.tsx              # 상단/하단 네비게이션
    line-selector.tsx          # 스마트 회선 멀티 셀렉터
    inventory-detail.tsx       # 부분 입고/마감 상세
    phone-lines-panel.tsx      # 회선 관리
    tax-panel.tsx              # 세무 필터 표 + CSV
    presets-panel.tsx          # 프리셋 편집
  hooks/                       # Realtime 데이터 훅, localStorage 훅 등
  lib/                         # supabase 클라이언트, rotation/calc/csv 유틸
```

## 🔐 보안 메모

- 부부 둘만 쓰는 내부 앱이므로 DB 접근은 anon 키 + 전체 허용 RLS, 진입은 Passcode 로 통제합니다.
- 외부 공개가 필요해지면 [Supabase Auth](https://supabase.com/docs/guides/auth) 로 전환하고
  RLS 정책을 사용자 기반으로 강화하세요.
- `SUPABASE_SERVICE_ROLE_KEY` 와 `TELEGRAM_*` 는 서버 전용이며 클라이언트에 노출되지 않습니다.
