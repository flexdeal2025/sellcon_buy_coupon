"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRecords } from "@/hooks/use-records";
import { getSupabaseClient } from "@/lib/supabase/client";
import { PurchaseCard } from "@/components/purchase-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatKRW, formatYearMonth } from "@/lib/utils";
import { OPEN_STATUSES, PURCHASE_STATUSES, type PurchaseStatus } from "@/lib/types";
import { Wallet, ListChecks, PlusCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Filter = "전체" | "미완료" | PurchaseStatus;
const FILTERS: Filter[] = ["전체", "미완료", ...PURCHASE_STATUSES];

export default function DashboardPage() {
  const { records, loading } = useRecords();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("미완료");

  // 증빙 업로드된 매입 건 id 집합 (현황 카드에 '증빙완료' 태그 표시용)
  const [proofSet, setProofSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    (async () => {
      const { data } = await getSupabaseClient()
        .from("supplier_documents").select("purchase_record_id").not("purchase_record_id", "is", null);
      setProofSet(new Set((data ?? []).map((d: { purchase_record_id: string }) => d.purchase_record_id)));
    })();
  }, [records]);

  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const summary = useMemo(() => {
    const thisMonth = records.filter((r) => r.purchase_date?.startsWith(ym));
    const monthTotal = thisMonth.reduce((s, r) => s + Number(r.total_price || 0), 0);
    const openCount = records.filter((r) =>
      OPEN_STATUSES.includes(r.status),
    ).length;
    const issueCount = records.filter((r) => r.status === "이슈발생").length;
    return { monthTotal, openCount, issueCount, monthCount: thisMonth.length };
  }, [records, ym]);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (filter === "전체") return true;
      if (filter === "미완료") return OPEN_STATUSES.includes(r.status);
      return r.status === filter;
    });
  }, [records, filter]);

  return (
    <div className="space-y-5">
      {/* 요약 대시보드 */}
      <div>
        <h1 className="text-xl font-bold">현황 홈</h1>
        <p className="text-sm text-muted-foreground">{formatYearMonth(now)} 기준</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-primary text-primary-foreground">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm opacity-90">
              <Wallet className="h-4 w-4" />
              이번 달 총 매입액
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {formatKRW(summary.monthTotal)}
            </p>
            <p className="mt-1 text-xs opacity-80">{summary.monthCount}건</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ListChecks className="h-4 w-4" />
              미완료 건수
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">{summary.openCount}건</p>
            <p className="mt-1 text-xs">
              {summary.issueCount > 0 ? (
                <span className="font-semibold text-destructive">
                  🚨 이슈 {summary.issueCount}건
                </span>
              ) : (
                <span className="text-muted-foreground">이슈 없음</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <Button asChild size="lg" className="w-full">
        <Link href="/new">
          <PlusCircle className="h-5 w-5" />
          신규 매입 등록
        </Link>
      </Button>

      {/* 필터 칩 */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              filter === f
                ? "bg-foreground text-background"
                : "bg-secondary text-secondary-foreground",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* 리스트 */}
      {loading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            표시할 매입 건이 없습니다.
            <div className="mt-3">
              <Button asChild variant="outline" size="sm">
                <Link href="/new">첫 매입 등록하기</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{filtered.length}건</span>
            <Badge variant="outline" className="gap-1 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              실시간 동기화
            </Badge>
          </div>
          {filtered.map((r) => (
            <PurchaseCard
              key={r.id}
              record={r}
              hasProof={proofSet.has(r.id)}
              onClick={() => router.push(`/inventory?id=${r.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
