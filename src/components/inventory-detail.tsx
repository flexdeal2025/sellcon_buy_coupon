"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { WorkerPicker } from "@/components/worker-picker";
import { useWorker } from "@/hooks/use-worker";
import { formatKRW, toDateInput, cn } from "@/lib/utils";
import { formatSequenceRanges } from "@/lib/rotation";
import { sendTelegram } from "@/lib/notify";
import type { PurchaseRecord, DeliveryLog, PurchaseStatus } from "@/lib/types";
import {
  PackagePlus,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Clock,
  Phone,
  Loader2,
  Pencil,
} from "lucide-react";

interface Props {
  record: PurchaseRecord;
  onUpdate: (id: string, patch: Partial<PurchaseRecord>) => Promise<PurchaseRecord>;
  onClose: () => void;
}

export function InventoryDetail({ record, onUpdate, onClose }: Props) {
  const router = useRouter();
  const { worker } = useWorker();
  const remaining = record.ordered_quantity - record.received_quantity;
  const isComplete = record.status === "완료";

  const [addQty, setAddQty] = useState("");
  const [addNote, setAddNote] = useState("");
  const [addDate, setAddDate] = useState(toDateInput());
  const [busy, setBusy] = useState(false);

  // 부분 입고 추가
  async function addDelivery() {
    const q = Number(addQty) || 0;
    if (q <= 0) {
      toast.error("입고 수량을 입력하세요.");
      return;
    }
    setBusy(true);
    const log: DeliveryLog = {
      date: addDate,
      quantity: q,
      worker,
      note: addNote.trim() || undefined,
    };
    const newReceived = record.received_quantity + q;
    const newStatus: PurchaseStatus =
      record.status === "매입등록" ? "재고확인중" : record.status;
    try {
      await onUpdate(record.id, {
        delivery_logs: [...(record.delivery_logs ?? []), log],
        received_quantity: newReceived,
        status: newStatus === "완료" ? "재고확인중" : newStatus,
        status_updated_by: worker,
      });
      setAddQty("");
      setAddNote("");
      toast.success(`${q}개 입고 기록됨 (누적 ${newReceived}개)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: PurchaseStatus, note?: string) {
    setBusy(true);
    try {
      await onUpdate(record.id, { status, status_updated_by: worker });
      void sendTelegram({
        type: "status_change",
        status,
        supplier: record.supplier,
        product_name: record.product_name,
        worker,
        note,
      });
      toast.success(`상태가 '${status}'(으)로 변경되었습니다.`);
      if (status === "완료") onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  const canComplete =
    record.ordered_quantity > 0 &&
    record.received_quantity === record.ordered_quantity &&
    !isComplete;

  const logs = [...(record.delivery_logs ?? [])].reverse();

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-bold">{record.supplier}</p>
              <p className="text-sm text-muted-foreground">{record.product_name}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge status={record.status} />
              <button
                type="button"
                onClick={() => router.push(`/edit/${record.id}`)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                title="매입 수정"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="주문" value={`${record.ordered_quantity}`} />
            <Stat
              label="입고"
              value={`${record.received_quantity}`}
              accent={record.received_quantity === record.ordered_quantity}
            />
            <Stat
              label="잔여"
              value={`${remaining}`}
              danger={remaining > 0}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">총 매입액</span>
            <span className="font-semibold">{formatKRW(record.total_price)}</span>
          </div>
          {record.allocated_phone_ids?.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              <Badge variant="line">
                {formatSequenceRanges(record.allocated_phone_ids)}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 할당 회선 체크리스트 */}
      {record.allocated_phone_ids?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">할당 회선 ({record.allocated_phone_ids.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {[...record.allocated_phone_ids]
                .sort((a, b) => a - b)
                .map((seq) => (
                  <div
                    key={seq}
                    className="flex h-10 items-center justify-center rounded-lg border border-border bg-secondary text-sm font-bold tabular-nums"
                  >
                    #{seq}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 부분 입고 추가 */}
      {!isComplete && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PackagePlus className="h-4 w-4" />
              부분 입고 추가
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground">작업자</Label>
              <WorkerPicker />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="addqty">입고 수량</Label>
                <Input
                  id="addqty"
                  type="number"
                  inputMode="numeric"
                  placeholder={remaining > 0 ? `잔여 ${remaining}` : "0"}
                  value={addQty}
                  onChange={(e) => setAddQty(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adddate">입고일</Label>
                <Input
                  id="adddate"
                  type="date"
                  value={addDate}
                  onChange={(e) => setAddDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="addnote">메모</Label>
              <Textarea
                id="addnote"
                placeholder="예: 57개 먼저 입고, 3개 추후"
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
                className="min-h-[56px]"
              />
            </div>
            <Button onClick={addDelivery} disabled={busy} className="w-full" size="lg">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
              입고 기록 추가
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 입고 타임라인 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            입고 이력 ({logs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">아직 입고 기록이 없습니다.</p>
          ) : (
            <ol className="space-y-3">
              {logs.map((log, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
                    {i < logs.length - 1 && (
                      <span className="my-1 w-px flex-1 bg-border" />
                    )}
                  </div>
                  <div className="flex-1 pb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums">+{log.quantity}개</span>
                      <span className="text-xs text-muted-foreground">{log.date}</span>
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        {log.worker}
                      </Badge>
                    </div>
                    {log.note && (
                      <p className="mt-0.5 text-sm text-muted-foreground">{log.note}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* 액션 버튼 */}
      <div className="space-y-2">
        <Button
          size="xl"
          variant="success"
          className="w-full"
          disabled={!canComplete || busy}
          onClick={() => changeStatus("완료")}
        >
          <CheckCircle2 className="h-5 w-5" />
          {canComplete
            ? "완료 마감"
            : isComplete
              ? "마감 완료됨"
              : `완료 마감 (잔여 ${remaining}개)`}
        </Button>

        <div className="grid grid-cols-2 gap-2">
          {record.status !== "이슈발생" ? (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => changeStatus("이슈발생")}
            >
              <AlertTriangle className="h-4 w-4" />
              이슈발생
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => changeStatus("재고확인중")}
            >
              <RotateCcw className="h-4 w-4" />
              이슈 해제
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            목록으로
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: string;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg bg-secondary py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-bold tabular-nums",
          accent && "text-success",
          danger && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}
