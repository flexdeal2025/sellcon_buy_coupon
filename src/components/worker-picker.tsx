"use client";

import { useWorker } from "@/hooks/use-worker";
import { DEFAULT_WORKERS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { UserRound } from "lucide-react";

/**
 * 현재 작업자(부부) 선택 토글. 상태 변경/입고 로그에 자동 기록됩니다.
 */
export function WorkerPicker({ className }: { className?: string }) {
  const { worker, setWorker, hydrated } = useWorker();
  if (!hydrated) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full bg-secondary p-1 text-sm",
        className,
      )}
    >
      <UserRound className="ml-1.5 h-4 w-4 text-muted-foreground" />
      {DEFAULT_WORKERS.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => setWorker(w)}
          className={cn(
            "rounded-full px-3 py-1 font-medium transition-colors",
            worker === w
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground",
          )}
        >
          {w}
        </button>
      ))}
    </div>
  );
}
