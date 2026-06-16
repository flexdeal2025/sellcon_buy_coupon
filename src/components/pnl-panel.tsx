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
} from "lucide-react";

type Granularity = "day" | "month" | "year";

interface Product {
  channel_product_no: number;
  name: string;
  status: string;
  sale_price: number;
}
interface Settlement {
  channel_product_no: number;
  product_name: string;
  quantity: number;
  settle_amount: number | null;
  order_status: string;
  decision_date: string | null;
}
interface Cost {
  id: string;
  channel_product_no: number;
  unit_cost: number;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
}

// 특정 날짜에 유효한 단가 찾기 (기간 겹치면 시작일이 가장 늦은 것)
function findCost(list: Cost[] | undefined, date: string): Cost | null {
  if (!list || !date) return null;
  const matches = list.filter(
    (c) => c.effective_from <= date && (!c.effective_to || date <= c.effective_to),
  );
  if (!matches.length) return null;
  return matches.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
}

export function PnLPanel() {
  const [view, setView] = useState<"dashboard" | "cost">("dashboard");
  const [products, setProducts] = useState<Product[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const sb = getSupabaseClient();
    const [{ data: prods }, { data: cs }] = await Promise.all([
      sb.from("smartstore_products").select("channel_product_no,name,status,sale_price").eq("status", "SALE").order("name"),
      sb.from("product_cost").select("*"),
    ]);
    // 정산 — 1000행 제한 회피 페이지네이션 (구매확정만)
    const setl: Settlement[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await sb
        .from("smartstore_settlements")
        .select("channel_product_no,product_name,quantity,settle_amount,order_status,decision_date")
        .eq("order_status", "PURCHASE_DECIDED")
        .order("decision_date", { ascending: true })
        .range(from, from + 999);
      setl.push(...((data as Settlement[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    setProducts((prods as Product[]) ?? []);
    setCosts((cs as Cost[]) ?? []);
    setSettlements(setl);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const costsByProduct = useMemo(() => {
    const m = new Map<number, Cost[]>();
    for (const c of costs) {
      const arr = m.get(c.channel_product_no) ?? [];
      arr.push(c);
      m.set(c.channel_product_no, arr);
    }
    return m;
  }, [costs]);

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 서브탭 */}
      <div className="flex rounded-xl bg-secondary p-1">
        <SubTab active={view === "dashboard"} onClick={() => setView("dashboard")} icon={TrendingUp} label="손익 대시보드" />
        <SubTab active={view === "cost"} onClick={() => setView("cost")} icon={Tag} label="매입원가 관리" />
      </div>

      {view === "dashboard" ? (
        <Dashboard
          settlements={settlements}
          costsByProduct={costsByProduct}
          onGoCost={() => setView("cost")}
        />
      ) : (
        <CostManager
          products={products}
          costsByProduct={costsByProduct}
          onChanged={loadAll}
        />
      )}
    </div>
  );
}

function SubTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof TrendingUp;
  label: string;
}) {
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
function Dashboard({
  settlements,
  costsByProduct,
  onGoCost,
}: {
  settlements: Settlement[];
  costsByProduct: Map<number, Cost[]>;
  onGoCost: () => void;
}) {
  const [gran, setGran] = useState<Granularity>("month");

  const { totals, periods, productRank, missingProducts } = useMemo(() => {
    const periodMap = new Map<
      string,
      { rev: number; matchedRev: number; cost: number; missingRev: number; missingCnt: number }
    >();
    const prodMap = new Map<number, { name: string; rev: number; cost: number; matched: boolean; missing: boolean }>();
    const missSet = new Map<number, string>();
    let tRev = 0, tMatchedRev = 0, tCost = 0, tMissRev = 0, tMissCnt = 0;

    for (const s of settlements) {
      if (s.settle_amount == null || !s.decision_date) continue;
      const rev = s.settle_amount;
      const periodKey =
        gran === "day" ? s.decision_date : gran === "month" ? s.decision_date.slice(0, 7) : s.decision_date.slice(0, 4);
      const pm = periodMap.get(periodKey) ?? { rev: 0, matchedRev: 0, cost: 0, missingRev: 0, missingCnt: 0 };
      pm.rev += rev;

      const costRow = findCost(costsByProduct.get(s.channel_product_no), s.decision_date);
      const pr = prodMap.get(s.channel_product_no) ?? { name: s.product_name, rev: 0, cost: 0, matched: false, missing: false };
      pr.rev += rev;

      if (costRow) {
        const costAmt = s.quantity * costRow.unit_cost;
        pm.matchedRev += rev;
        pm.cost += costAmt;
        pr.cost += costAmt;
        pr.matched = true;
        tMatchedRev += rev;
        tCost += costAmt;
      } else {
        pm.missingRev += rev;
        pm.missingCnt += 1;
        pr.missing = true;
        missSet.set(s.channel_product_no, s.product_name);
        tMissRev += rev;
        tMissCnt += 1;
      }
      tRev += rev;
      periodMap.set(periodKey, pm);
      prodMap.set(s.channel_product_no, pr);
    }

    const periods = [...periodMap.entries()]
      .map(([k, v]) => ({ key: k, ...v, profit: v.matchedRev - v.cost }))
      .sort((a, b) => (a.key < b.key ? 1 : -1));

    const productRank = [...prodMap.entries()]
      .filter(([, v]) => v.matched)
      .map(([no, v]) => ({ no, name: v.name, rev: v.rev, cost: v.cost, profit: v.rev - v.cost, missing: v.missing }))
      .sort((a, b) => b.profit - a.profit);

    return {
      totals: {
        rev: tRev,
        matchedRev: tMatchedRev,
        cost: tCost,
        profit: tMatchedRev - tCost,
        margin: tMatchedRev > 0 ? ((tMatchedRev - tCost) / tMatchedRev) * 100 : 0,
        missRev: tMissRev,
        missCnt: tMissCnt,
      },
      periods,
      productRank,
      missingProducts: [...missSet.entries()].map(([no, name]) => ({ no, name })),
    };
  }, [settlements, costsByProduct, gran]);

  if (settlements.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          정산 데이터가 없습니다 — PC에서 <strong>npm run sync</strong> 실행 후 확인하세요.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 원가 미입력 경고 */}
      {totals.missCnt > 0 && (
        <button
          onClick={onGoCost}
          className="flex w-full items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-left"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-semibold text-warning">매입원가 미입력 {missingProducts.length}개 상품</p>
            <p className="text-muted-foreground">
              미입력 매출 {formatKRW(totals.missRev)}는 수익 계산에서 제외됨. 탭하여 원가를 입력하세요 →
            </p>
          </div>
        </button>
      )}

      {/* 요약 */}
      <div className="grid grid-cols-2 gap-2">
        <SummaryCard label="매출 (정산·원가입력분)" value={formatKRW(totals.matchedRev)} icon={Wallet} />
        <SummaryCard label="매입원가 (비용)" value={formatKRW(totals.cost)} icon={Calculator} />
        <SummaryCard label="수익" value={formatKRW(totals.profit)} accent={totals.profit >= 0 ? "success" : "destructive"} icon={TrendingUp} />
        <SummaryCard label="수익률" value={`${totals.margin.toFixed(1)}%`} accent={totals.profit >= 0 ? "success" : "destructive"} icon={TrendingUp} />
      </div>
      <p className="text-xs text-muted-foreground">
        ※ 귀속 기준: 구매확정일 · 매출은 정산금액(수수료 차감 실수령) 기준
      </p>

      {/* 기간 토글 */}
      <div className="flex rounded-lg bg-secondary p-1">
        {(["day", "month", "year"] as Granularity[]).map((g) => (
          <button
            key={g}
            onClick={() => setGran(g)}
            className={cn(
              "flex-1 rounded-md py-1.5 text-sm font-medium transition-colors",
              gran === g ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {g === "day" ? "일간" : g === "month" ? "월간" : "연간"}
          </button>
        ))}
      </div>

      {/* 기간별 손익 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">기간별 손익</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {periods.map((p) => {
            const margin = p.matchedRev > 0 ? (p.profit / p.matchedRev) * 100 : 0;
            return (
              <div key={p.key} className="rounded-lg border border-border bg-secondary p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold tabular-nums">{p.key}</span>
                  <span className={cn("font-bold tabular-nums", p.profit >= 0 ? "text-success" : "text-destructive")}>
                    {formatKRW(p.profit)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">({margin.toFixed(1)}%)</span>
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>매출 {formatKRW(p.matchedRev)}</span>
                  <span>비용 {formatKRW(p.cost)}</span>
                  {p.missingCnt > 0 && (
                    <span className="text-warning">원가미입력 {p.missingCnt}건 / {formatKRW(p.missingRev)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* 상품별 손익 순위 */}
      {productRank.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">상품별 손익 (원가 입력분)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {productRank.slice(0, 10).map((p, i) => {
              const margin = p.rev > 0 ? (p.profit / p.rev) * 100 : 0;
              return (
                <div key={p.no} className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2">
                  <span className="w-5 shrink-0 text-sm font-bold text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      매출 {formatKRW(p.rev)} · 비용 {formatKRW(p.cost)}
                    </p>
                  </div>
                  <span className={cn("shrink-0 text-right text-sm font-bold tabular-nums", p.profit >= 0 ? "text-success" : "text-destructive")}>
                    {formatKRW(p.profit)}
                    <span className="block text-[10px] font-normal text-muted-foreground">{margin.toFixed(0)}%</span>
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  accent?: "success" | "destructive";
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p
        className={cn(
          "mt-1 text-lg font-bold tabular-nums",
          accent === "success" && "text-success",
          accent === "destructive" && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ─────────────────────────── 매입원가 관리 ───────────────────────────
function CostManager({
  products,
  costsByProduct,
  onChanged,
}: {
  products: Product[];
  costsByProduct: Map<number, Cost[]>;
  onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  const [openNo, setOpenNo] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = kw ? products.filter((p) => p.name.toLowerCase().includes(kw)) : products;
    // 원가 미입력 상단 정렬
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
        <Input
          placeholder="상품명 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        판매중 상품 {products.length}개 · 원가 미입력 <span className="font-semibold text-warning">{missingCount}개</span> (상단 정렬)
      </p>

      <div className="space-y-2">
        {filtered.map((p) => {
          const list = costsByProduct.get(p.channel_product_no);
          const today = toDateInput();
          const current = findCost(list, today);
          const isOpen = openNo === p.channel_product_no;
          return (
            <Card key={p.channel_product_no}>
              <button
                onClick={() => setOpenNo(isOpen ? null : p.channel_product_no)}
                className="flex w-full items-center gap-2 p-3 text-left"
              >
                {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">판매가 {formatKRW(p.sale_price)}</p>
                </div>
                {current ? (
                  <Badge variant="line" className="shrink-0">현재 원가 {formatKRW(current.unit_cost)}</Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0 border-warning/60 text-warning">원가 미입력</Badge>
                )}
              </button>
              {isOpen && (
                <CardContent className="border-t border-border pt-3">
                  <CostEditor
                    channelNo={p.channel_product_no}
                    periods={list ?? []}
                    onChanged={onChanged}
                  />
                </CardContent>
              )}
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</p>
        )}
      </div>
    </div>
  );
}

function CostEditor({
  channelNo,
  periods,
  onChanged,
}: {
  channelNo: number;
  periods: Cost[];
  onChanged: () => void;
}) {
  const [unitCost, setUnitCost] = useState("");
  const [from, setFrom] = useState(toDateInput());
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const sorted = [...periods].sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));

  async function add() {
    const cost = Number(unitCost);
    if (!cost || cost <= 0) {
      toast.error("매입원가를 입력하세요.");
      return;
    }
    if (to && to < from) {
      toast.error("종료일이 시작일보다 빠릅니다.");
      return;
    }
    setBusy(true);
    const { error } = await getSupabaseClient().from("product_cost").insert({
      channel_product_no: channelNo,
      unit_cost: Math.round(cost),
      effective_from: from,
      effective_to: to || null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(`저장 실패: ${error.message}`);
      return;
    }
    setUnitCost("");
    setNote("");
    setTo("");
    toast.success("매입원가 기간이 추가되었습니다.");
    onChanged();
  }

  async function remove(id: string) {
    setBusy(true);
    const { error } = await getSupabaseClient().from("product_cost").delete().eq("id", id);
    setBusy(false);
    if (error) {
      toast.error(`삭제 실패: ${error.message}`);
      return;
    }
    toast.success("삭제되었습니다.");
    onChanged();
  }

  return (
    <div className="space-y-3">
      {/* 기존 기간 목록 */}
      {sorted.length > 0 && (
        <div className="space-y-1.5">
          {sorted.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-semibold tabular-nums">{formatKRW(c.unit_cost)}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {c.effective_from} ~ {c.effective_to ?? "진행중"}
                </span>
                {c.note && <p className="truncate text-xs text-muted-foreground">{c.note}</p>}
              </div>
              <button
                onClick={() => remove(c.id)}
                disabled={busy}
                className="text-muted-foreground hover:text-destructive"
                aria-label="삭제"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 추가 폼 */}
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
