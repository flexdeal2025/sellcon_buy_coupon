import type { Metadata } from "next";
import {
  Smartphone,
  Carrot,
  Send,
  ServerCog,
  ShieldCheck,
  Store,
  MessageSquareShare,
  ArrowRight,
  ArrowDown,
  Bot,
  GitBranch,
  ReceiptText,
  Rocket,
  CheckCircle2,
  Clock,
  CircleDashed,
  Coffee,
  ShieldHalf,
  Infinity as InfinityIcon,
  Sparkles,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Sellcon X Vivacon 자동화 아키텍처 맵",
  description: "현업 병행을 위한 0인 운영 파이프라인",
};

export default function ArchitecturePage() {
  return (
    <div className="-mx-4 -my-4 min-h-screen bg-slate-950 px-4 py-10 text-slate-100 sm:-my-8 sm:py-16">
      {/* 은은한 배경 글로우 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-blue-600/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-5xl space-y-16">
        <TitleSection />
        <FlowSection />
        <RoadmapSection />
        <ReassuranceSection />
        <FooterNote />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   1. 타이틀
────────────────────────────────────────────── */
function TitleSection() {
  return (
    <header className="space-y-4 text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-medium text-indigo-300">
        <Sparkles className="h-3.5 w-3.5" />
        함께 보는 시스템 구조
      </div>
      <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
        <span className="bg-gradient-to-r from-indigo-400 via-blue-400 to-sky-300 bg-clip-text text-transparent">
          Sellcon X Vivacon
        </span>
        <br />
        자동화 아키텍처 맵
      </h1>
      <p className="mx-auto max-w-2xl text-base text-slate-400 sm:text-lg">
        현업 병행을 위한 <span className="font-semibold text-slate-200">0인(無人) 운영 파이프라인</span>
        <br className="hidden sm:block" />
        지금 무엇을 만들고 있고, 어떤 순서로 완성할지 정리한 문서입니다.
      </p>
    </header>
  );
}

/* ──────────────────────────────────────────────
   2. 3단계 데이터 흐름도
────────────────────────────────────────────── */
function FlowSection() {
  return (
    <section className="space-y-6">
      <SectionLabel index="01" title="데이터 흐름" subtitle="매입 → 콘트롤 타워 → 자동 판매" />

      <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1.1fr_auto_1fr]">
        {/* 좌측: 옴니채널 매입 */}
        <FlowCard
          tone="intake"
          badge="INPUT"
          title="옴니채널 매입"
          desc="3개 경로로 매입한 데이터가 모임"
        >
          <ChannelRow icon={Smartphone} name="셀콘 앱 (C2B 자동)" note="개인이 직접 파는 매입" />
          <ChannelRow icon={Carrot} name="당근마켓 (수동 퀵폼)" note="대표 직접 발품 매입" />
          <ChannelRow icon={Send} name="B2B 분산 수신" note="텔레그램 봇 무인 수집" />
        </FlowCard>

        <Connector />

        {/* 중앙: 콘트롤 타워 */}
        <div className="relative rounded-2xl border border-indigo-400/40 bg-gradient-to-b from-indigo-600/20 to-slate-900/60 p-5 shadow-[0_0_40px_-12px] shadow-indigo-500/40">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-500 px-3 py-0.5 text-[10px] font-bold tracking-wider text-white">
            HEART · 현재 시스템
          </div>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/20 ring-1 ring-indigo-400/40">
              <ServerCog className="h-7 w-7 text-indigo-300" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">자체 사업관리 어드민</h3>
              <p className="mt-1 text-sm text-slate-400">
                흩어진 매입 데이터를 모으고
                <br />
                <span className="inline-flex items-center gap-1 font-semibold text-indigo-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  국세청 증빙(payout_uuid)
                </span>
                을 자동 생성
              </p>
            </div>
            <div className="mt-1 grid w-full grid-cols-2 gap-2 text-left">
              <MiniStat label="매입 집계" value="A·B·C 통합" />
              <MiniStat label="세무 증빙" value="자동 생성" />
              <MiniStat label="손익 계산" value="실시간" />
              <MiniStat label="재고 토스" value="외주 DB 연동" />
            </div>
          </div>
        </div>

        <Connector />

        {/* 우측: 자동 판매 */}
        <FlowCard
          tone="output"
          badge="OUTPUT"
          title="자동 판매 · 무인 유통"
          desc="주문 → 재고 동기화 → 카톡 발송"
        >
          <ChannelRow icon={Store} name="스마트스토어 주문" note="비바콘 판매 채널" />
          <ChannelRow icon={ServerCog} name="외주 재고 DB 전송" note="실시간 재고 동기화" />
          <ChannelRow icon={MessageSquareShare} name="카톡 자동 발송" note="주문 즉시 무인 배송" />
        </FlowCard>
      </div>
    </section>
  );
}

function FlowCard({
  tone,
  badge,
  title,
  desc,
  children,
}: {
  tone: "intake" | "output";
  badge: string;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  const accent =
    tone === "intake"
      ? "text-emerald-300 border-emerald-400/20 bg-emerald-500/10"
      : "text-sky-300 border-sky-400/20 bg-sky-500/10";
  return (
    <div className="flex flex-col rounded-2xl border border-slate-700/60 bg-slate-900/60 p-5">
      <span className={`mb-3 inline-flex w-fit rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wider ${accent}`}>
        {badge}
      </span>
      <h3 className="text-lg font-bold text-white">{title}</h3>
      <p className="mb-4 text-sm text-slate-400">{desc}</p>
      <div className="flex flex-1 flex-col gap-2.5">{children}</div>
    </div>
  );
}

function ChannelRow({
  icon: Icon,
  name,
  note,
}: {
  icon: typeof Smartphone;
  name: string;
  note: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-800/40 px-3 py-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-700/50">
        <Icon className="h-4.5 w-4.5 text-slate-200" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-100">{name}</p>
        <p className="truncate text-xs text-slate-500">{note}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xs font-semibold text-indigo-200">{value}</p>
    </div>
  );
}

/* 단계 사이 화살표 (데스크톱: 가로 / 모바일: 세로) */
function Connector() {
  return (
    <div className="flex items-center justify-center">
      <ArrowRight className="hidden h-6 w-6 text-indigo-400/60 lg:block" />
      <ArrowDown className="h-6 w-6 text-indigo-400/60 lg:hidden" />
    </div>
  );
}

/* ──────────────────────────────────────────────
   3. 4단계 로드맵 타임라인
────────────────────────────────────────────── */
const ROADMAP = [
  {
    icon: Bot,
    step: "1단계",
    title: "텔레그램 봇 기반 재고 자동 적재",
    desc: "봇이 수신 문자를 받아 재고 DB에 자동 입력. 복사·붙여넣기 수작업 제거.",
    state: "progress" as const,
  },
  {
    icon: GitBranch,
    step: "2단계",
    title: "외주 소스코드 해부 및 이양 기획",
    desc: "확보한 스마트스토어 시스템을 분석해 4번 콘트롤 타워로 흡수하는 설계.",
    state: "wait" as const,
  },
  {
    icon: ReceiptText,
    step: "3단계",
    title: "payout_uuid 세무 소명 자동 매핑",
    desc: "지출 한 건마다 증빙을 자동 연결해 세무 소명 자료를 자동 구성.",
    state: "wait" as const,
  },
  {
    icon: Rocket,
    step: "4단계",
    title: "셀콘 웹앱 정식 오픈 + 1,000원 프로모션",
    desc: "첫 거래 1,000원 보너스로 개인 매입자 유입.",
    state: "wait" as const,
  },
];

function RoadmapSection() {
  return (
    <section className="space-y-6">
      <SectionLabel index="02" title="4단계 로드맵" subtitle="한 단계씩 자동화 확장" />

      <div className="relative">
        {/* 세로 연결선 */}
        <div className="absolute left-[27px] top-2 bottom-2 w-px bg-gradient-to-b from-indigo-500/60 via-slate-700 to-slate-800 sm:left-1/2" />

        <ol className="space-y-5">
          {ROADMAP.map((item, i) => (
            <RoadmapItem key={item.step} item={item} align={i % 2 === 0 ? "left" : "right"} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function RoadmapItem({
  item,
  align,
}: {
  item: (typeof ROADMAP)[number];
  align: "left" | "right";
}) {
  const stateMeta = {
    progress: { label: "진행 예정", cls: "border-indigo-400/40 bg-indigo-500/15 text-indigo-200", Icon: Clock },
    wait: { label: "대기", cls: "border-slate-600/50 bg-slate-800/60 text-slate-400", Icon: CircleDashed },
    done: { label: "완료", cls: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200", Icon: CheckCircle2 },
  }[item.state];

  return (
    <li className="relative pl-16 sm:grid sm:grid-cols-2 sm:gap-8 sm:pl-0">
      {/* 노드 아이콘 */}
      <div className="absolute left-0 top-1 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 sm:left-1/2 sm:-translate-x-1/2 sm:z-10">
        <item.icon className="h-6 w-6 text-indigo-300" />
      </div>

      {/* 카드 (좌우 번갈아) */}
      <div
        className={
          align === "left"
            ? "sm:col-start-1 sm:pr-12 sm:text-right"
            : "sm:col-start-2 sm:pl-12"
        }
      >
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4 transition-colors hover:border-indigo-400/40">
          <div className={`mb-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${stateMeta.cls}`}>
            <stateMeta.Icon className="h-3 w-3" />
            {item.step} · {stateMeta.label}
          </div>
          <h3 className="text-base font-bold text-white">{item.title}</h3>
          <p className="mt-1 text-sm text-slate-400">{item.desc}</p>
        </div>
      </div>
    </li>
  );
}

/* ──────────────────────────────────────────────
   4. 배우자 안심 3대 요약
────────────────────────────────────────────── */
const REASSURE = [
  {
    icon: Coffee,
    title: "퇴근 후 수작업 제거",
    desc: "문자 복사·재고 입력 같은 반복 작업을 자동화로 대체.",
    accent: "from-amber-500/20 to-slate-900/40 text-amber-300",
  },
  {
    icon: ShieldHalf,
    title: "세무 증빙 자동 축적",
    desc: "매입 한 건마다 증빙이 쌓여, 소명 요청 시 자료를 바로 제출.",
    accent: "from-indigo-500/20 to-slate-900/40 text-indigo-300",
  },
  {
    icon: InfinityIcon,
    title: "무인 순환 구조",
    desc: "주문 → 발송 → 정산이 사람 개입 없이 자동으로 진행.",
    accent: "from-sky-500/20 to-slate-900/40 text-sky-300",
  },
];

function ReassuranceSection() {
  return (
    <section className="space-y-6">
      <SectionLabel index="03" title="이 시스템이 만드는 3가지" subtitle="자동화가 바꾸는 운영 방식" />

      <div className="grid gap-4 sm:grid-cols-3">
        {REASSURE.map((r) => (
          <div
            key={r.title}
            className={`rounded-2xl border border-slate-700/60 bg-gradient-to-b p-5 ${r.accent}`}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950/40 ring-1 ring-white/10">
              <r.icon className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-bold text-white">{r.title}</h3>
            <p className="mt-1.5 text-sm text-slate-300/80">{r.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────
   공통 요소
────────────────────────────────────────────── */
function SectionLabel({
  index,
  title,
  subtitle,
}: {
  index: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-sm font-bold text-indigo-400/70">{index}</span>
      <div>
        <h2 className="text-xl font-bold text-white sm:text-2xl">{title}</h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function FooterNote() {
  return (
    <footer className="border-t border-slate-800 pt-8 text-center">
      <p className="text-sm text-slate-500">
        <span className="text-slate-300">Sellcon × Vivacon</span> 시스템 구조 문서
      </p>
    </footer>
  );
}
