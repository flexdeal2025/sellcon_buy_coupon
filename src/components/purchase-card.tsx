"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { formatKRW } from "@/lib/utils";
import { formatSequenceRanges } from "@/lib/rotation";
import { Package, Phone } from "lucide-react";
import type { PurchaseRecord } from "@/lib/types";

export function PurchaseCard({
  record,
  onClick,
}: {
  record: PurchaseRecord;
  onClick?: () => void;
}) {
  const progress =
    record.ordered_quantity > 0
      ? Math.min(100, Math.round((record.received_quantity / record.ordered_quantity) * 100))
      : 0;

  return (
    <Card
      onClick={onClick}
      className="cursor-pointer p-4 transition-shadow hover:shadow-md active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{record.supplier}</span>
          </div>
          <p className="truncate text-sm text-muted-foreground">{record.product_name}</p>
        </div>
        <StatusBadge status={record.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Package className="h-4 w-4" />
          <span className="font-medium text-foreground tabular-nums">
            {record.received_quantity}/{record.ordered_quantity}
          </span>
          개
        </span>
        <span className="font-semibold tabular-nums">{formatKRW(record.total_price)}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {record.purchase_date}
        </span>
      </div>

      {/* 입고 진행률 바 */}
      {record.status !== "완료" && record.ordered_quantity > 0 && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* 사용 회선 뱃지 */}
      {record.allocated_phone_ids?.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5">
          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
          <Badge variant="line" className="text-xs">
            {formatSequenceRanges(record.allocated_phone_ids)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            ({record.allocated_phone_ids.length}회선)
          </span>
        </div>
      )}
    </Card>
  );
}
