"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useRecords } from "@/hooks/use-records";
import { usePhoneLines } from "@/hooks/use-phone-lines";
import { usePresets } from "@/hooks/use-presets";
import { useWorker } from "@/hooks/use-worker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LineSelector } from "@/components/line-selector";
import { WorkerPicker } from "@/components/worker-picker";
import { reconcile, type CalcSource } from "@/lib/calc";
import {
  getLastUsedHighest,
  recommendRotation,
  requiredLineCount,
  formatSequenceRanges,
} from "@/lib/rotation";
import { formatKRW, formatUnitPrice, toDateInput } from "@/lib/utils";
import { sendTelegram } from "@/lib/notify";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { EVIDENCE_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { PurchaseInsert } from "@/lib/types";
import { Calculator, Save, Loader2 } from "lucide-react";

export default function NewPurchasePage() {
  const router = useRouter();
  const { records, insert } = useRecords();
  const { lines } = usePhoneLines();
  const { suppliers, products } = usePresets();
  const { worker } = useWorker();

  const [date, setDate] = useState(toDateInput());
  const [supplier, setSupplier] = useState("");
  const [productName, setProductName] = useState("");
  const [orderedQty, setOrderedQty] = useState<string>("");
  const [limitPer, setLimitPer] = useState<string>("");
  const [unitPrice, setUnitPrice] = useState<string>("");
  const [totalPrice, setTotalPrice] = useState<string>("");
  const [accountEmail, setAccountEmail] = useState("");
  const [evidence, setEvidence] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedLines, setSelectedLines] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const qtyNum = Number(orderedQty) || 0;
  const limitNum = Number(limitPer) || 0;
  const needCount = requiredLineCount(qtyNum, limitNum);

  // 활성 회선 sequence 목록
  const activeSeqs = useMemo(
    () => lines.filter((l) => l.is_active).map((l) => l.sequence_number),
    [lines],
  );

  // 순환 추천
  const suggestion = useMemo(() => {
    if (!supplier || needCount <= 0)
      return { sequences: [] as number[], start: null, wrapped: false, enough: true };
    const lastHighest = getLastUsedHighest(records, supplier);
    return recommendRotation(activeSeqs, lastHighest, needCount);
  }, [supplier, needCount, records, activeSeqs]);

  // ── 양방향 계산기 ──
  function recompute(
    q: number,
    u: number,
    t: number,
    source: CalcSource,
  ) {
    const { unitPrice: nu, totalPrice: nt } = reconcile(q, u, t, source);
    setUnitPrice(nu ? String(nu) : "");
    setTotalPrice(nt ? String(nt) : "");
  }

  function onQtyChange(v: string) {
    setOrderedQty(v);
    const q = Number(v) || 0;
    // 단가 우선으로 총액 재계산 (단가가 있으면)
    if (unitPrice) recompute(q, Number(unitPrice) || 0, Number(totalPrice) || 0, "unit");
    else if (totalPrice)
      recompute(q, Number(unitPrice) || 0, Number(totalPrice) || 0, "total");
  }
  function onUnitChange(v: string) {
    setUnitPrice(v);
    recompute(qtyNum, Number(v) || 0, Number(totalPrice) || 0, "unit");
  }
  function onTotalChange(v: string) {
    setTotalPrice(v);
    recompute(qtyNum, Number(unitPrice) || 0, Number(v) || 0, "total");
  }

  const canSave =
    supplier.trim() && productName.trim() && qtyNum > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    if (!isSupabaseConfigured) {
      toast.error("Supabase 환경변수가 설정되지 않아 저장할 수 없습니다.");
      return;
    }
    setSaving(true);
    const payload: PurchaseInsert = {
      purchase_date: date,
      supplier: supplier.trim(),
      product_name: productName.trim(),
      ordered_quantity: qtyNum,
      received_quantity: 0,
      limit_per_number: limitNum,
      allocated_phone_ids: selectedLines,
      unit_price: Number(unitPrice) || 0,
      total_price: Number(totalPrice) || 0,
      account_email: accountEmail.trim() || null,
      evidence_type: evidence || null,
      status: "매입등록",
      status_updated_by: worker,
      delivery_logs: [],
      notes: notes.trim() || null,
    };

    try {
      await insert(payload);
      // 텔레그램 알림 (실패해도 무시)
      void sendTelegram({
        type: "new_purchase",
        supplier: payload.supplier,
        product_name: payload.product_name,
        ordered_quantity: payload.ordered_quantity,
        sequences: formatSequenceRanges(selectedLines),
        total_price: payload.total_price,
        worker,
      });
      toast.success("매입이 등록되었습니다.");
      router.push("/");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">매입 입력</h1>
        <WorkerPicker />
      </div>

      {/* 매입처 / 상품 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">매입처 · 상품</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>매입처</Label>
            <ChipRow
              items={suppliers}
              active={supplier}
              onPick={(v) => setSupplier(v)}
            />
            <Input
              placeholder="매입처명 입력"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>상품명</Label>
            <ChipRow
              items={products}
              active={productName}
              onPick={(v) => setProductName(v)}
            />
            <Input
              placeholder="상품명 입력"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">매입일</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* 수량 & 양방향 계산기 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4" />
            수량 · 단가 계산기
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="qty">주문수량</Label>
              <Input
                id="qty"
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={orderedQty}
                onChange={(e) => onQtyChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="limit">번호당 제한</Label>
              <Input
                id="limit"
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={limitPer}
                onChange={(e) => setLimitPer(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="unit">매입단가</Label>
              <Input
                id="unit"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={unitPrice}
                onChange={(e) => onUnitChange(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="total">총 매입액</Label>
              <Input
                id="total"
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={totalPrice}
                onChange={(e) => onTotalChange(e.target.value)}
              />
            </div>
          </div>

          {/* 계산 결과 미리보기 */}
          <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">
              단가 {formatUnitPrice(Number(unitPrice) || 0)} × {qtyNum}개
            </span>
            <span className="font-bold tabular-nums">
              = {formatKRW(Number(totalPrice) || 0)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            단가↔총액은 자동 양방향 계산됩니다. (총액÷수량으로 단가가 소수점까지
            역산됩니다)
          </p>
        </CardContent>
      </Card>

      {/* 회선 할당 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">회선 할당 (순환 추천)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {needCount > 0 && (
            <div className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">
              주문 {qtyNum}개 ÷ 제한 {limitNum}개 ={" "}
              <span className="font-bold">필요 회선 {needCount}개</span>
            </div>
          )}
          {!supplier && (
            <p className="text-sm text-muted-foreground">
              매입처를 선택하면 직전 기록 기반 순환 추천이 표시됩니다.
            </p>
          )}
          {supplier && needCount > 0 && !suggestion.enough && (
            <p className="text-sm font-medium text-destructive">
              활성 회선이 부족합니다. (활성 {activeSeqs.length}개 / 필요 {needCount}개)
            </p>
          )}
          <LineSelector
            lines={lines}
            value={selectedLines}
            onChange={setSelectedLines}
            recommended={suggestion.sequences}
            requiredCount={needCount || undefined}
          />
        </CardContent>
      </Card>

      {/* 부가 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">증빙 · 메모</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">계정 이메일</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              placeholder="account@example.com"
              value={accountEmail}
              onChange={(e) => setAccountEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>증빙 유형</Label>
            <Select value={evidence} onValueChange={setEvidence}>
              <SelectTrigger>
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                {EVIDENCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">메모</Label>
            <Textarea
              id="notes"
              placeholder="특이사항"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* 저장 (모바일 하단 고정) */}
      <div className="sticky bottom-20 z-20 sm:bottom-2">
        <Button
          size="xl"
          className={cn("w-full shadow-lg", !canSave && "opacity-60")}
          disabled={!canSave}
          onClick={handleSave}
        >
          {saving ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Save className="h-5 w-5" />
          )}
          매입 등록 ({formatKRW(Number(totalPrice) || 0)})
        </Button>
      </div>
    </div>
  );
}

function ChipRow({
  items,
  active,
  onPick,
}: {
  items: string[];
  active: string;
  onPick: (v: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="-mx-1 flex flex-wrap gap-2 px-1">
      {items.map((it) => (
        <button
          key={it}
          type="button"
          onClick={() => onPick(it)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
            active === it
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background hover:border-primary/40",
          )}
        >
          {it}
        </button>
      ))}
    </div>
  );
}
