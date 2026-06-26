"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRecords } from "@/hooks/use-records";
import { PurchaseCard } from "@/components/purchase-card";
import { InventoryDetail } from "@/components/inventory-detail";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OPEN_STATUSES } from "@/lib/types";
import { ArrowLeft, Loader2 } from "lucide-react";

function InventoryInner() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id");
  const { records, loading, update, remove } = useRecords();

  const selected = useMemo(
    () => records.find((r) => r.id === id) ?? null,
    [records, id],
  );

  const openRecords = useMemo(
    () => records.filter((r) => OPEN_STATUSES.includes(r.status)),
    [records],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  // 상세 보기
  if (id && selected) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => router.push("/inventory")}
        >
          <ArrowLeft className="h-4 w-4" />
          재고확인 목록
        </Button>
        <InventoryDetail
          record={selected}
          onUpdate={update}
          onDelete={remove}
          onClose={() => router.push("/inventory")}
        />
      </div>
    );
  }

  // 목록
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">재고 확인 · 마감</h1>
        <p className="text-sm text-muted-foreground">
          미완료 {openRecords.length}건 — 카드를 눌러 입고를 기록하세요.
        </p>
      </div>

      {openRecords.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            확인할 미완료 건이 없습니다. 🎉
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {openRecords.map((r) => (
            <PurchaseCard
              key={r.id}
              record={r}
              onClick={() => router.push(`/inventory?id=${r.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <InventoryInner />
    </Suspense>
  );
}
