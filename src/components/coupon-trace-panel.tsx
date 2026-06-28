"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cn, toKST, formatKRW } from "@/lib/utils";
import { Search, Loader2, ShoppingCart, Package, CreditCard, BellRing, ArrowLeftRight } from "lucide-react";

const PASSCODE = process.env.NEXT_PUBLIC_APP_PASSCODE ?? "1234";
const AUTH = { "x-app-passcode": PASSCODE };

type AnyRow = Record<string, unknown>;
interface TraceResult {
  query: { code: string | null; order: string | null; type: "code" | "image" | "unknown" };
  found: { purchase: boolean; stock: boolean; sale: boolean; dispatch: boolean };
  purchase: AnyRow[];
  stock: AnyRow[];
  sale: AnyRow[];
  dispatch: AnyRow[];
}

const s = (v: unknown) => (v == null ? "" : String(v));
const won = (v: unknown) => {
  const n = Number(s(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? formatKRW(n) : "-";
};

export function CouponTracePanel() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"code" | "order">("code");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [searched, setSearched] = useState("");

  const run = async () => {
    const q = input.replace(/\s+/g, "").trim();
    if (!q) { toast.error("쿠폰번호를 입력하세요"); return; }
    setLoading(true);
    setResult(null);
    try {
      const param = mode === "code" ? `code=${encodeURIComponent(q)}` : `order=${encodeURIComponent(q)}`;
      const res = await fetch(`/api/vivacon/trace?${param}`, { headers: AUTH });
      const json = await res.json();
      if (!json.ok) { toast.error("조회 실패: " + json.error); return; }
      setResult(json as TraceResult);
      setSearched(q);
      const f = json.found;
      if (!f.purchase && !f.stock && !f.sale) toast.warning("해당 번호로 어떤 기록도 찾지 못했습니다.");
    } catch (e) {
      toast.error("조회 오류: " + (e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 검색 바 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/40 p-3">
        <div className="flex rounded-lg bg-secondary p-0.5 text-xs">
          {([["code", "쿠폰번호"], ["order", "주문번호"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)}
              className={cn("rounded-md px-2.5 py-1 font-medium", mode === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
              {label}
            </button>
          ))}
        </div>
        <input
          className="min-w-[220px] flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-mono"
          placeholder={mode === "code" ? "쿠폰번호 입력 (예: 9356049867308023)" : "주문번호 입력"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <button onClick={run} disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} 추적
        </button>
      </div>

      {!result && !loading && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          쿠폰번호 또는 주문번호를 입력하면 <strong>매입 → 재고 → 판매 → 발송</strong> 전 과정을 한 화면에서 추적합니다.
        </p>
      )}

      {result && (
        <div className="space-y-3">
          {/* 헤더 요약 */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm">
            <span className="font-mono font-semibold">{searched}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium",
              result.query.type === "code" ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                : result.query.type === "image" ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                : "bg-secondary text-muted-foreground")}>
              {result.query.type === "code" ? "코드형" : result.query.type === "image" ? "이미지형" : "형태미상"}
            </span>
            <span className="ml-auto flex gap-1.5 text-xs">
              {(["purchase", "stock", "sale", "dispatch"] as const).map((k) => {
                const label = { purchase: "매입", stock: "재고", sale: "판매", dispatch: "발송" }[k];
                const ok = result.found[k];
                return (
                  <span key={k} className={cn("rounded px-1.5 py-0.5", ok ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-secondary text-muted-foreground")}>
                    {ok ? "●" : "○"} {label}
                  </span>
                );
              })}
            </span>
          </div>

          {/* 타임라인 */}
          <div className="space-y-0">
            <Stage icon={ShoppingCart} title="① 매입" color="amber" found={result.found.purchase}>
              {result.purchase.map((p, i) => (
                <div key={i} className="space-y-1">
                  <Row label="상품">{s(p.product_name)}{s(p.option_name) && ` (${s(p.option_name)})`}</Row>
                  <Row label="매입처">{s(p.supplier) || "-"}{s(p.purchase_channel) && ` · ${s(p.purchase_channel)}`}{s(p.source) && ` · ${s(p.source)}`}</Row>
                  <Row label="매입일">{s(p.purchase_date) || "-"}</Row>
                  <Row label="매입원가">{won(p.unit_cost)}</Row>
                  <Row label="증빙">{s(p.proof_type) || "-"}{s(p.seller_name_masked) && ` · 셀러 ${s(p.seller_name_masked)}`}</Row>
                  <Row label="발행">{p.published ? `발행됨 (${toKST(s(p.published_at)) || "-"})` : "미발행"} · 검수 {s(p.inspection_status)}</Row>
                  {result.purchase.length > 1 && i < result.purchase.length - 1 && <hr className="my-2 border-border/50" />}
                </div>
              ))}
            </Stage>

            <Stage icon={Package} title="② 재고 코드" color="violet" found={result.found.stock}
              emptyNote={result.query.type === "image" ? "이미지형은 GCP 버킷에 보관 (coupon_codes 미사용)" : undefined}>
              {result.stock.map((c, i) => (
                <div key={i} className="space-y-1">
                  <Row label="상태"><StatusBadge status={s(c.status)} /></Row>
                  <Row label="상품">{s(c["상품명"])}{s(c["옵션명"]) && ` (${s(c["옵션명"])})`}</Row>
                  <Row label="유효기간">{s(c.expiry_date) || "-"}</Row>
                  <Row label="매입원가">{won(c["매입원가"])}</Row>
                  <Row label="할당시각">{toKST(s(c.allocated_at)) || "-"}</Row>
                  {s(c["이슈사항"]) && <Row label="이슈">{s(c["이슈사항"])}</Row>}
                </div>
              ))}
            </Stage>

            <Stage icon={CreditCard} title="③ 판매" color="blue" found={result.found.sale}>
              {result.sale.map((o, i) => (
                <div key={i} className="space-y-1">
                  <Row label="주문번호"><span className="font-mono">{s(o["주문번호"]) || "-"}</span></Row>
                  <Row label="판매시각">{s(o["판매시간"]) || "-"}</Row>
                  <Row label="상태"><StatusBadge status={s(o.status)} /></Row>
                  <Row label="구매자">{s(o["구매자명"]) || "-"}</Row>
                  <Row label="수령자">{s(o["수령자명"]) || "-"} {s(o["수령자_전화번호"]) && `· ${s(o["수령자_전화번호"])}`}</Row>
                  <Row label="고객열람">{s(o.first_accessed_at) ? `열람 (${toKST(s(o.first_accessed_at))})` : "미열람"}</Row>
                  {s(o.exchanged_from) && (
                    <div className="mt-1 flex items-center gap-1 rounded bg-orange-500/10 px-2 py-1 text-xs text-orange-600 dark:text-orange-400">
                      <ArrowLeftRight className="h-3 w-3" /> 교환건 {s(o.exchanged_reason) && `· ${s(o.exchanged_reason)}`} {s(o.exchanged_at) && `(${toKST(s(o.exchanged_at))})`}
                    </div>
                  )}
                  {result.sale.length > 1 && i < result.sale.length - 1 && <hr className="my-2 border-border/50" />}
                </div>
              ))}
            </Stage>

            <Stage icon={BellRing} title="④ 발송 (알림톡)" color="green" found={result.found.dispatch}
              emptyNote="발송 audit는 2026-04-10부터 기록 — 이전 건은 판매 단계의 알림톡 정보 참조">
              {result.dispatch.map((d, i) => (
                <div key={i} className="space-y-1">
                  <Row label="알림톡 발송">{toKST(s(d.alimtalk_sent_at)) || "-"}</Row>
                  <Row label="실매출">{won(d.order_total_amount)}{s(d.order_quantity) && ` · ${s(d.order_quantity)}개`}</Row>
                  <Row label="결제일">{toKST(s(d.payment_date)) || "-"}</Row>
                  <Row label="주문자">{s(d.orderer_name) || "-"} {s(d.orderer_phone) && `· ${s(d.orderer_phone)}`}</Row>
                  <Row label="스마트스토어">{s(d.smartstore_order_status) || "-"}{s(d.smartstore_product_order_id) && ` · ${s(d.smartstore_product_order_id)}`}</Row>
                  <Row label="발송결과">{s(d.ppurio_response_code) || s(d.record_status) || "-"}{s(d.ppurio_description) && ` · ${s(d.ppurio_description)}`}</Row>
                  {result.dispatch.length > 1 && i < result.dispatch.length - 1 && <hr className="my-2 border-border/50" />}
                </div>
              ))}
            </Stage>
          </div>
        </div>
      )}
    </div>
  );
}

function Stage({ icon: Icon, title, color, found, emptyNote, children }: {
  icon: typeof ShoppingCart; title: string; color: "amber" | "violet" | "blue" | "green";
  found: boolean; emptyNote?: string; children: React.ReactNode;
}) {
  const colorMap = {
    amber: "border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400",
    violet: "border-violet-500/40 bg-violet-500/5 text-violet-600 dark:text-violet-400",
    blue: "border-blue-500/40 bg-blue-500/5 text-blue-600 dark:text-blue-400",
    green: "border-green-500/40 bg-green-500/5 text-green-600 dark:text-green-400",
  }[color];
  return (
    <div className="relative pl-8">
      {/* 연결선 */}
      <div className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-border" />
      <div className={cn("absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border", colorMap)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="pb-4">
        <div className="flex h-8 items-center gap-2">
          <span className="text-sm font-semibold">{title}</span>
          {!found && <span className="text-xs text-muted-foreground">기록 없음</span>}
        </div>
        {found ? (
          <div className="mt-1 rounded-xl border border-border bg-background p-3 text-sm">{children}</div>
        ) : emptyNote ? (
          <p className="mt-1 text-xs text-muted-foreground">{emptyNote}</p>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    available: "bg-green-500/10 text-green-600 dark:text-green-400",
    allocated: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    used: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    exchanged: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    disabled: "bg-secondary text-muted-foreground",
    active: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  };
  return <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", map[status] ?? "bg-secondary text-muted-foreground")}>{status || "-"}</span>;
}
