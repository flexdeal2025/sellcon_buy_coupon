"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getSupabaseClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatKRW, cn, toDateInput } from "@/lib/utils";
import {
  Loader2,
  TrendingUp,
  Wallet,
  AlertTriangle,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Search,
  Calculator,
  Tag,
  Download,
  Clock,
  ArrowLeftRight,
} from "lucide-react";

type Granularity = "day" | "month" | "year";
type DatePreset = "all" | "this_year" | "this_month" | "last_month" | "custom";

interface DateRange { from: string | null; to: string | null }

interface Product {
  channel_product_no: number;
  name: string;
  status: string;
  sale_price: number;
}
interface Cost {
  id: string;
  channel_product_no: number;
  unit_cost: number;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
}
interface OrderCost {
  product_order_id: string;
  cost_amount: number;
  note: string | null;
}
interface OrderRow {
  product_order_id: string;
  decision_date: string | null;
  quantity: number;
  settle_amount: number | null;
}
interface Summary {
  matched_rev: number;
  cost: number;
  profit: number;
  miss_rev: number;
  miss_cnt: number;
  miss_products: number;
}
interface PeriodRow {
  period: string;
  matched_rev: number;
  cost: number;
  profit: number;
  miss_rev: number;
  miss_cnt: number;
}
interface ProductRow {
  channel_product_no: number;
  product_name: string;
  rev: number;
  cost: number;
  profit: number;
}
interface CashFlowRow {
  settle_complete_date: string;
  settle_amount: number;
  pay_settle_amount: number;
  commission_amount: number;
}
interface Freshness {
  maxDate: string;
  maxSync: string;
}

const n = (v: unknown) => Number(v ?? 0);

// ── 날짜 유틸 ──────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function presetRange(preset: DatePreset): DateRange {
  const d = new Date();
  const yr = d.getFullYear();
  const mo = d.getMonth();
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  switch (preset) {
    case "this_month":
      return { from: fmt(new Date(yr, mo, 1)), to: todayStr() };
    case "last_month":
      return { from: fmt(new Date(yr, mo - 1, 1)), to: fmt(new Date(yr, mo, 0)) };
    case "this_year":
      return { from: `${yr}-01-01`, to: todayStr() };
    default:
      return { from: null, to: null };
  }
}

// ── CSV 내보내기 ────────────────────────────────────────
function downloadCSV(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 특정 날짜에 유효한 단가 찾기
function findCost(list: Cost[] | undefined, date: string): Cost | null {
  if (!list || !date) return null;
  const matches = list.filter(
    (c) => c.effective_from <= date && (!c.effective_to || date <= c.effective_to),
  );
  if (!matches.length) return null;
  return matches.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
}

// ─────────────────────────── PnLPanel ───────────────────────────
export function PnLPanel() {
  const [view, setView] = useState<"dashboard" | "cost">("dashboard");
  const [products, setProducts] = useState<Product[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [orderCosts, setOrderCosts] = useState<OrderCost[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMeta = useCallback(async () => {
    const sb = getSupabaseClient();
    const [{ data: prods }, { data: cs }, { data: ocs }] = await Promise.all([
      sb.from("smartstore_products").select("channel_product_no,name,status,sale_price").eq("status", "SALE").order("name"),
      sb.from("product_cost").select("*"),
      sb.from("order_cost").select("*"),
    ]);
    setProducts((prods as Product[]) ?? []);
    setCosts((cs as Cost[]) ?? []);
    setOrderCosts((ocs as OrderCost[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  const costsByProduct = useMemo(() => {
    const m = new Map<number, Cost[]>();
    for (const c of costs) {
      const arr = m.get(c.channel_product_no) ?? [];
      arr.push(c);
      m.set(c.channel_product_no, arr);
    }
    return m;
  }, [costs]);

  const orderCostMap = useMemo(() => {
    const m = new Map<string, OrderCost>();
    for (const oc of orderCosts) m.set(oc.product_order_id, oc);
    return m;
  }, [orderCosts]);

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex rounded-xl bg-secondary p-1">
        <SubTab active={view === "dashboard"} onClick={() => setView("dashboard")} icon={TrendingUp} label="손익 대시보드" />
        <SubTab active={view === "cost"} onClick={() => setView("cost")} icon={Tag} label="매입원가 관리" />
      </div>
      {view === "dashboard" ? (
        <Dashboard onGoCost={() => setView("cost")} />
      ) : (
        <CostManager
          products={products}
          costsByProduct={costsByProduct}
          orderCostMap={orderCostMap}
          onChanged={loadMeta}
        />
      )}
    </div>
  );
}

function SubTab({
  active, onClick, icon: Icon, label,
}: { active: boolean; onClick: () => void; icon: typeof TrendingUp; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-medium transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

// ─────────────────────────── 손익 대시보드 ───────────────────────────
function Dashboard({ onGoCost }: { onGoCost: () => void }) {
  const [preset, setPreset] = useState<DatePreset>("all");
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null });
  const [gran, setGran] = useState<Granularity>("month");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [productRank, setProductRank] = useState<ProductRow[]>([]);
  const [cashFlow, setCashFlow] = useState<CashFlowRow[]>([]);
  const [freshness, setFreshness] = useState<Freshness | null>(null);

  const [initLoading, setInitLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [cashLoading, setCashLoading] = useState(false);

  // 최신화 시점 — 마운트 1회
  useEffect(() => {
    (async () => {
      const { data } = await getSupabaseClient()
        .from("smartstore_settlements")
        .select("decision_date, synced_at")
        .order("synced_at", { ascending: false })
        .limit(1);
      const row = (data as { decision_date: string; synced_at: string }[] | null)?.[0];
      if (row) {
        setFreshness({
          maxDate: row.decision_date,
          maxSync: row.synced_at.slice(0, 16).replace("T", " "),
        });
      }
    })();
  }, []);

  // 요약 + 상품순위 — dateRange 변경 시
  useEffect(() => {
    (async () => {
      setSummaryLoading(true);
      const sb = getSupabaseClient();
      const params = { date_from: dateRange.from ?? null, date_to: dateRange.to ?? null };
      const [{ data: sum }, { data: prod }] = await Promise.all([
        sb.rpc("pnl_summary", params),
        sb.rpc("pnl_by_product", { limit_n: 10, ...params }),
      ]);
      const s = (sum as Record<string, unknown>[] | null)?.[0];
      setSummary(
        s ? {
          matched_rev: n(s.matched_rev), cost: n(s.cost), profit: n(s.profit),
          miss_rev: n(s.miss_rev), miss_cnt: n(s.miss_cnt), miss_products: n(s.miss_products),
        } : null,
      );
      setProductRank(
        ((prod as Record<string, unknown>[] | null) ?? []).map((p) => ({
          channel_product_no: n(p.channel_product_no),
          product_name: String(p.product_name ?? ""),
          rev: n(p.rev), cost: n(p.cost), profit: n(p.profit),
        })),
      );
      setSummaryLoading(false);
      setInitLoading(false);
    })();
  }, [dateRange]);

  // 기간별 — gran 또는 dateRange 변경 시
  useEffect(() => {
    (async () => {
      setPeriodLoading(true);
      const params = { gran, date_from: dateRange.from ?? null, date_to: dateRange.to ?? null };
      const { data } = await getSupabaseClient().rpc("pnl_by_period", params);
      setPeriods(
        ((data as Record<string, unknown>[] | null) ?? []).map((p) => ({
          period: String(p.period ?? ""),
          matched_rev: n(p.matched_rev), cost: n(p.cost), profit: n(p.profit),
          miss_rev: n(p.miss_rev), miss_cnt: n(p.miss_cnt),
        })),
      );
      setPeriodLoading(false);
    })();
  }, [gran, dateRange]);

  // 현금흐름(정산완료일 기준) — dateRange 변경 시
  useEffect(() => {
    (async () => {
      setCashLoading(true);
      let q = getSupabaseClient()
        .from("smartstore_daily_settlement")
        .select("settle_complete_date,settle_amount,pay_settle_amount,commission_amount")
        .order("settle_complete_date", { ascending: false })
        .limit(500);
      if (dateRange.from) q = q.gte("settle_complete_date", dateRange.from);
      if (dateRange.to) q = q.lte("settle_complete_date", dateRange.to);
      const { data } = await q;
      setCashFlow((data as CashFlowRow[]) ?? []);
      setCashLoading(false);
    })();
  }, [dateRange]);

  function applyPreset(p: DatePreset) {
    setPreset(p);
    if (p !== "custom") setDateRange(presetRange(p));
  }

  if (initLoading) {
    return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const hasData = summary && (summary.matched_rev > 0 || summary.miss_cnt > 0);
  if (!hasData && !summaryLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          정산 데이터가 없습니다 — PC에서 <strong>npm run sync</strong> 실행 후 확인하세요.
        </CardContent>
      </Card>
    );
  }

  const margin = summary && summary.matched_rev > 0 ? (summary.profit / summary.matched_rev) * 100 : 0;
  const cashTotal = cashFlow.reduce((a, r) => a + r.settle_amount, 0);
  const cashCommission = cashFlow.reduce((a, r) => a + r.commission_amount, 0);

  return (
    <div className="space-y-4">

      {/* ── 날짜 범위 필터 ── */}
      <div className="space-y-2 rounded-xl border border-border bg-secondary p-3">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "this_year", "this_month", "last_month"] as DatePreset[]).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                preset === p ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {p === "all" ? "전체기간" : p === "this_year" ? "올해" : p === "this_month" ? "이번 달" : "지난달"}
            </button>
          ))}
          <button
            onClick={() => setPreset("custom")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              preset === "custom" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            직접 입력
          </button>
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={dateRange.from ?? ""}
              onChange={(e) => setDateRange((r) => ({ ...r, from: e.target.value || null }))}
              className="h-8 text-xs"
            />
            <span className="text-xs text-muted-foreground">~</span>
            <Input
              type="date"
              value={dateRange.to ?? ""}
              onChange={(e) => setDateRange((r) => ({ ...r, to: e.target.value || null }))}
              className="h-8 text-xs"
            />
          </div>
        )}
      </div>

      {/* ── 데이터 최신화 시점 ── */}
      {freshness && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>데이터 기준 <strong className="text-foreground">{freshness.maxDate}</strong>까지 · 최종 수집 {freshness.maxSync} KST</span>
        </div>
      )}

      {/* ── 원가 미입력 경고 ── */}
      {summary && summary.miss_cnt > 0 && (
        <button
          onClick={onGoCost}
          className="flex w-full items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-left"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-semibold text-warning">매입원가 미입력 {summary.miss_products}개 상품 ({summary.miss_cnt}건)</p>
            <p className="text-muted-foreground">미입력 매출 {formatKRW(summary.miss_rev)}는 수익 계산에서 제외됨. 탭하여 원가를 입력하세요 →</p>
          </div>
        </button>
      )}

      {/* ── 요약 카드 ── */}
      {summaryLoading ? (
        <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : summary && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <SummaryCard label="매출 (정산·원가입력분)" value={formatKRW(summary.matched_rev)} icon={Wallet} />
            <SummaryCard label="매입원가 (비용)" value={formatKRW(summary.cost)} icon={Calculator} />
            <SummaryCard label="수익" value={formatKRW(summary.profit)} accent={summary.profit >= 0 ? "success" : "destructive"} icon={TrendingUp} />
            <SummaryCard label="수익률" value={`${margin.toFixed(1)}%`} accent={summary.profit >= 0 ? "success" : "destructive"} icon={TrendingUp} />
          </div>
          <p className="text-xs text-muted-foreground">※ 귀속 기준: 구매확정일 · 매출은 정산금액(수수료 차감 실수령) 기준</p>
        </>
      )}

      {/* ── 기간별 손익 ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">기간별 손익</CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg bg-secondary p-0.5">
                {(["day", "month", "year"] as Granularity[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGran(g)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      gran === g ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    {g === "day" ? "일간" : g === "month" ? "월간" : "연간"}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  const rows = [
                    ["기간", "매출", "원가", "수익", "수익률", "원가미입력매출", "원가미입력건수"],
                    ...periods.map((p) => {
                      const m = p.matched_rev > 0 ? ((p.profit / p.matched_rev) * 100).toFixed(1) + "%" : "0%";
                      return [p.period, p.matched_rev, p.cost, p.profit, m, p.miss_rev, p.miss_cnt];
                    }),
                  ] as string[][];
                  downloadCSV(rows, `손익_기간별_${todayStr()}.csv`);
                }}
                className="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                title="CSV 다운로드"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {periodLoading ? (
            <div className="flex justify-center py-4 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : periods.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">해당 기간에 데이터가 없습니다.</p>
          ) : (
            periods.map((p) => {
              const m = p.matched_rev > 0 ? (p.profit / p.matched_rev) * 100 : 0;
              return (
                <div key={p.period} className="rounded-lg border border-border bg-secondary p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold tabular-nums">{p.period}</span>
                    <span className={cn("font-bold tabular-nums", p.profit >= 0 ? "text-success" : "text-destructive")}>
                      {formatKRW(p.profit)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">({m.toFixed(1)}%)</span>
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span>매출 {formatKRW(p.matched_rev)}</span>
                    <span>비용 {formatKRW(p.cost)}</span>
                    {p.miss_cnt > 0 && <span className="text-warning">원가미입력 {p.miss_cnt}건 / {formatKRW(p.miss_rev)}</span>}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* ── 상품별 손익 ── */}
      {productRank.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">상품별 손익 (원가 입력분)</CardTitle>
              <button
                onClick={() => {
                  const rows = [
                    ["순위", "상품명", "매출", "원가", "수익", "수익률"],
                    ...productRank.map((p, i) => {
                      const m = p.rev > 0 ? ((p.profit / p.rev) * 100).toFixed(1) + "%" : "0%";
                      return [i + 1, p.product_name, p.rev, p.cost, p.profit, m];
                    }),
                  ] as string[][];
                  downloadCSV(rows, `손익_상품별_${todayStr()}.csv`);
                }}
                className="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                title="CSV 다운로드"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {productRank.map((p, i) => {
              const m = p.rev > 0 ? (p.profit / p.rev) * 100 : 0;
              return (
                <div key={p.channel_product_no} className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2">
                  <span className="w-5 shrink-0 text-sm font-bold text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.product_name}</p>
                    <p className="text-xs text-muted-foreground">매출 {formatKRW(p.rev)} · 비용 {formatKRW(p.cost)}</p>
                  </div>
                  <span className={cn("shrink-0 text-right text-sm font-bold tabular-nums", p.profit >= 0 ? "text-success" : "text-destructive")}>
                    {formatKRW(p.profit)}
                    <span className="block text-[10px] font-normal text-muted-foreground">{m.toFixed(0)}%</span>
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── 현금흐름 (정산완료일 기준) ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <ArrowLeftRight className="h-4 w-4" />
                현금흐름 (정산완료일 기준)
              </CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">네이버 정산 완료일 기준 실입금액 — 위 P&amp;L(구매확정일 기준)과 귀속 시점이 다를 수 있음</p>
            </div>
            {cashFlow.length > 0 && (
              <button
                onClick={() => {
                  const rows = [
                    ["정산완료일", "정산금액", "수수료"],
                    ...cashFlow.map((r) => [r.settle_complete_date, r.settle_amount, r.commission_amount]),
                  ] as string[][];
                  downloadCSV(rows, `현금흐름_${todayStr()}.csv`);
                }}
                className="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                title="CSV 다운로드"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {cashLoading ? (
            <div className="flex justify-center py-4 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : cashFlow.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">해당 기간에 정산 완료 데이터가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-secondary p-3">
                  <p className="text-xs text-muted-foreground">기간 내 실입금 합계</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-success">{formatKRW(cashTotal)}</p>
                </div>
                <div className="rounded-lg bg-secondary p-3">
                  <p className="text-xs text-muted-foreground">기간 내 수수료 합계</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-destructive">{formatKRW(cashCommission)}</p>
                </div>
              </div>
              <div className="max-h-60 space-y-1 overflow-y-auto">
                {cashFlow.map((r) => (
                  <div key={r.settle_complete_date} className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
                    <span className="tabular-nums text-muted-foreground">{r.settle_complete_date}</span>
                    <div className="text-right">
                      <span className="font-semibold tabular-nums">{formatKRW(r.settle_amount)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">수수료 {formatKRW(r.commission_amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

function SummaryCard({
  label, value, icon: Icon, accent,
}: { label: string; value: string; icon: typeof Wallet; accent?: "success" | "destructive" }) {
  return (
    <div className="rounded-lg border border-border bg-secondary p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className={cn("mt-1 text-lg font-bold tabular-nums", accent === "success" && "text-success", accent === "destructive" && "text-destructive")}>
        {value}
      </p>
    </div>
  );
}

// ─────────────────────────── 매입원가 관리 ───────────────────────────
function CostManager({
  products, costsByProduct, orderCostMap, onChanged,
}: {
  products: Product[];
  costsByProduct: Map<number, Cost[]>;
  orderCostMap: Map<string, OrderCost>;
  onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  const [openNo, setOpenNo] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = kw ? products.filter((p) => p.name.toLowerCase().includes(kw)) : products;
    return [...list].sort((a, b) => {
      const ax = costsByProduct.has(a.channel_product_no) ? 1 : 0;
      const bx = costsByProduct.has(b.channel_product_no) ? 1 : 0;
      if (ax !== bx) return ax - bx;
      return a.name.localeCompare(b.name);
    });
  }, [products, costsByProduct, q]);

  const missingCount = products.filter((p) => !costsByProduct.has(p.channel_product_no)).length;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="상품명 검색" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>
      <p className="text-xs text-muted-foreground">
        판매중 상품 {products.length}개 · 기간원가 미입력 <span className="font-semibold text-warning">{missingCount}개</span> (상단 정렬)
      </p>
      <div className="space-y-2">
        {filtered.map((p) => {
          const list = costsByProduct.get(p.channel_product_no);
          const current = findCost(list, toDateInput());
          const isOpen = openNo === p.channel_product_no;
          return (
            <Card key={p.channel_product_no}>
              <button onClick={() => setOpenNo(isOpen ? null : p.channel_product_no)} className="flex w-full items-center gap-2 p-3 text-left">
                {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">판매가 {formatKRW(p.sale_price)}</p>
                </div>
                {current ? (
                  <Badge variant="line" className="shrink-0">현재 원가 {formatKRW(current.unit_cost)}</Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0 border-warning/60 text-warning">기간원가 미입력</Badge>
                )}
              </button>
              {isOpen && (
                <CardContent className="space-y-4 border-t border-border pt-3">
                  <CostEditor channelNo={p.channel_product_no} periods={list ?? []} onChanged={onChanged} />
                  <OrderCostSection channelNo={p.channel_product_no} orderCostMap={orderCostMap} onChanged={onChanged} />
                </CardContent>
              )}
            </Card>
          );
        })}
        {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</p>}
      </div>
    </div>
  );
}

function CostEditor({
  channelNo, periods, onChanged,
}: { channelNo: number; periods: Cost[]; onChanged: () => void }) {
  const [unitCost, setUnitCost] = useState("");
  const [from, setFrom] = useState(toDateInput());
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const sorted = [...periods].sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));

  async function add() {
    const cost = Number(unitCost);
    if (!cost || cost <= 0) return toast.error("매입원가를 입력하세요.");
    if (to && to < from) return toast.error("종료일이 시작일보다 빠릅니다.");
    setBusy(true);
    const { error } = await getSupabaseClient().from("product_cost").insert({
      channel_product_no: channelNo,
      unit_cost: Math.round(cost),
      effective_from: from,
      effective_to: to || null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(`저장 실패: ${error.message}`);
    setUnitCost(""); setNote(""); setTo("");
    toast.success("매입원가 기간이 추가되었습니다.");
    onChanged();
  }

  async function remove(id: string) {
    setBusy(true);
    const { error } = await getSupabaseClient().from("product_cost").delete().eq("id", id);
    setBusy(false);
    if (error) return toast.error(`삭제 실패: ${error.message}`);
    toast.success("삭제되었습니다.");
    onChanged();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">기간별 원가 (일반 상품)</p>
      {sorted.length > 0 && (
        <div className="space-y-1.5">
          {sorted.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-semibold tabular-nums">{formatKRW(c.unit_cost)}</span>
                <span className="ml-2 text-xs text-muted-foreground">{c.effective_from} ~ {c.effective_to ?? "진행중"}</span>
                {c.note && <p className="truncate text-xs text-muted-foreground">{c.note}</p>}
              </div>
              <button onClick={() => remove(c.id)} disabled={busy} className="text-muted-foreground hover:text-destructive" aria-label="삭제">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">매입원가 (개당)</label>
            <Input type="number" inputMode="numeric" placeholder="예: 27000" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">메모 (선택)</label>
            <Input placeholder="예: 5월 매입분" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">적용 시작일</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">종료일 (비우면 진행중)</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <Button onClick={add} disabled={busy} className="w-full" size="sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          기간별 원가 추가
        </Button>
      </div>
    </div>
  );
}

function OrderCostSection({
  channelNo, orderCostMap, onChanged,
}: { channelNo: number; orderCostMap: Map<string, OrderCost>; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const LIMIT = 200;

  async function load() {
    setLoading(true);
    const { data } = await getSupabaseClient()
      .from("smartstore_settlements")
      .select("product_order_id,decision_date,quantity,settle_amount")
      .eq("channel_product_no", channelNo)
      .eq("order_status", "PURCHASE_DECIDED")
      .not("settle_amount", "is", null)
      .order("decision_date", { ascending: false })
      .limit(LIMIT);
    setOrders((data as OrderRow[]) ?? []);
    setLoading(false);
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && orders === null) load();
  }

  const sorted = useMemo(() => {
    if (!orders) return [];
    return [...orders].sort((a, b) => {
      const am = orderCostMap.has(a.product_order_id) ? 1 : 0;
      const bm = orderCostMap.has(b.product_order_id) ? 1 : 0;
      if (am !== bm) return am - bm;
      return (b.decision_date ?? "").localeCompare(a.decision_date ?? "");
    });
  }, [orders, orderCostMap]);

  const enteredCount = sorted.filter((o) => orderCostMap.has(o.product_order_id)).length;

  return (
    <div className="space-y-2">
      <button onClick={toggle} className="flex w-full items-center gap-1.5 text-sm font-medium text-foreground">
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        건별 원가
        <span className="text-xs font-normal text-muted-foreground">(주문마다 원가가 다를 때 사용)</span>
      </button>
      {open && (
        <div className="space-y-1.5">
          {loading ? (
            <div className="flex justify-center py-3 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : sorted.length === 0 ? (
            <p className="text-xs text-muted-foreground">이 상품의 구매확정 주문이 없습니다.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{enteredCount}/{sorted.length} 입력{sorted.length >= LIMIT ? ` (최근 ${LIMIT}건만 표시)` : ""}</p>
              {sorted.map((o) => (
                <OrderCostRow key={o.product_order_id} order={o} existing={orderCostMap.get(o.product_order_id)} onChanged={onChanged} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OrderCostRow({
  order, existing, onChanged,
}: { order: OrderRow; existing: OrderCost | undefined; onChanged: () => void }) {
  const [cost, setCost] = useState(existing ? String(existing.cost_amount) : "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);

  const settle = order.settle_amount ?? 0;
  const costNum = Number(cost) || 0;
  const profit = costNum > 0 ? settle - costNum : null;

  async function save() {
    const c = Number(cost);
    if (!c || c <= 0) return toast.error("매입원가를 입력하세요.");
    setBusy(true);
    const { error } = await getSupabaseClient()
      .from("order_cost")
      .upsert({ product_order_id: order.product_order_id, cost_amount: Math.round(c), note: note.trim() || null }, { onConflict: "product_order_id" });
    setBusy(false);
    if (error) return toast.error(`저장 실패: ${error.message}`);
    toast.success("건별 원가가 저장되었습니다.");
    onChanged();
  }

  async function remove() {
    setBusy(true);
    const { error } = await getSupabaseClient().from("order_cost").delete().eq("product_order_id", order.product_order_id);
    setBusy(false);
    if (error) return toast.error(`삭제 실패: ${error.message}`);
    setCost(""); setNote("");
    toast.success("삭제되었습니다.");
    onChanged();
  }

  return (
    <div className={cn("rounded-lg border p-2.5", existing ? "border-success/30 bg-success/5" : "border-border bg-secondary")}>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        <span className="font-mono">{order.product_order_id}</span>
        <span>{order.decision_date}</span>
        <span>수량 {order.quantity}</span>
        <span>정산 {formatKRW(settle)}</span>
        {profit != null && (
          <span className={cn("font-semibold", profit >= 0 ? "text-success" : "text-destructive")}>수익 {formatKRW(profit)}</span>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <Input type="number" inputMode="numeric" placeholder="이 주문 총 매입원가" value={cost} onChange={(e) => setCost(e.target.value)} className="h-9" />
        <Input placeholder="협의 메모(선택)" value={note} onChange={(e) => setNote(e.target.value)} className="h-9" />
        <Button onClick={save} disabled={busy} size="sm" className="h-9 shrink-0">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "저장"}
        </Button>
        {existing && (
          <button onClick={remove} disabled={busy} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="삭제">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
