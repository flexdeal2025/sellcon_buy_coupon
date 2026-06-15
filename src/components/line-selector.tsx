"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, RotateCcw } from "lucide-react";
import { formatSequenceRanges } from "@/lib/rotation";

interface LineSelectorProps {
  /** 표시할 회선 목록 (sequence_number 오름차순) */
  lines: {
    sequence_number: number;
    is_active: boolean;
    phone_number?: string | null;
    alias?: string | null;
  }[];
  /** 선택된 sequence_number 배열 */
  value: number[];
  onChange: (next: number[]) => void;
  /** 순환 추천 번호 (시각적 강조 + 일괄선택용) */
  recommended?: number[];
  /** 필요한 회선 수 (안내 문구용) */
  requiredCount?: number;
}

export function LineSelector({
  lines,
  value,
  onChange,
  recommended = [],
  requiredCount,
}: LineSelectorProps) {
  const selected = new Set(value);
  const recoSet = new Set(recommended);

  function toggle(seq: number) {
    const next = new Set(value);
    if (next.has(seq)) next.delete(seq);
    else next.add(seq);
    onChange([...next].sort((a, b) => a - b));
  }

  function applyRecommended() {
    onChange([...recommended].sort((a, b) => a - b));
  }

  function clear() {
    onChange([]);
  }

  return (
    <div className="space-y-3">
      {/* 추천 가이드 배너 */}
      {recommended.length > 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Sparkles className="h-4 w-4" />
            순환 추천 회선
          </div>
          <p className="mt-1 text-sm text-foreground">
            직전 매입 기준 다음 순번{" "}
            <span className="font-bold text-primary">
              {formatSequenceRanges(recommended)}
            </span>{" "}
            ({recommended.length}개)
          </p>
          <Button
            type="button"
            size="sm"
            onClick={applyRecommended}
            className="mt-2 w-full"
          >
            <Sparkles className="h-4 w-4" />
            추천 번호 일괄 선택
          </Button>
        </div>
      )}

      {/* 선택 요약 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">선택됨</span>
        <Badge variant={value.length ? "default" : "outline"}>
          {value.length}개
        </Badge>
        {requiredCount ? (
          <span
            className={cn(
              "text-xs",
              value.length === requiredCount
                ? "text-success"
                : "text-muted-foreground",
            )}
          >
            (필요 {requiredCount}개)
          </span>
        ) : null}
        {value.length > 0 && (
          <>
            <span className="font-medium text-primary">
              {formatSequenceRanges(value)}
            </span>
            <button
              type="button"
              onClick={clear}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
            >
              <RotateCcw className="h-3 w-3" />
              초기화
            </button>
          </>
        )}
      </div>

      {/* 번호 그리드 */}
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
        {lines.map((line) => {
          const seq = line.sequence_number;
          const isSelected = selected.has(seq);
          const isReco = recoSet.has(seq);
          const disabled = !line.is_active;
          // phone_number 우선(010 제외 8자리), 없으면 alias 폴백
          const phoneLabel = line.phone_number
            ? line.phone_number.replace(/\D/g, "").slice(3) // 010 제거 → 8자리
            : (line.alias?.trim() ?? null);
          return (
            <button
              key={seq}
              type="button"
              disabled={disabled}
              onClick={() => toggle(seq)}
              className={cn(
                "relative flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-lg border text-sm font-bold tabular-nums transition-all active:scale-95",
                disabled &&
                  "cursor-not-allowed border-dashed border-border bg-muted text-muted-foreground/40 line-through",
                !disabled &&
                  isSelected &&
                  "border-primary bg-primary text-primary-foreground shadow-sm",
                !disabled &&
                  !isSelected &&
                  isReco &&
                  "border-primary/60 bg-primary/10 text-primary ring-1 ring-primary/30",
                !disabled &&
                  !isSelected &&
                  !isReco &&
                  "border-border bg-background text-foreground hover:border-primary/40",
              )}
            >
              <span className="leading-none">{seq}</span>
              {phoneLabel && (
                <span
                  className={cn(
                    "text-[8px] leading-none tracking-tighter tabular-nums",
                    isSelected ? "opacity-80" : "opacity-50",
                  )}
                >
                  {phoneLabel}
                </span>
              )}
              {isReco && !isSelected && !disabled && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        버튼 아래 숫자는 전화번호 뒷 4자리입니다. 점선/취소선은 비활성 회선, 파란 점은 추천 번호입니다.
      </p>
    </div>
  );
}
