import { Badge } from "@/components/ui/badge";
import type { PurchaseStatus } from "@/lib/types";

const MAP: Record<PurchaseStatus, { variant: "secondary" | "default" | "warning" | "destructive" | "success"; emoji: string }> = {
  매입등록: { variant: "secondary", emoji: "📝" },
  재고확인중: { variant: "default", emoji: "🔄" },
  이슈발생: { variant: "destructive", emoji: "🚨" },
  완료: { variant: "success", emoji: "✅" },
};

export function StatusBadge({ status }: { status: PurchaseStatus }) {
  const cfg = MAP[status] ?? MAP["매입등록"];
  return (
    <Badge variant={cfg.variant} className="gap-1 px-2 py-1 text-xs">
      <span>{cfg.emoji}</span>
      {status}
    </Badge>
  );
}
