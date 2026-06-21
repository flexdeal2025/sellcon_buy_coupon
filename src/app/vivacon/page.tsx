import { VivaconInventoryPanel } from "@/components/vivacon-inventory-panel";

export default function VivaconPage() {
  // 폭은 app-shell 이 라우트(/vivacon)에 맞춰 넓혀줌 → 헤더와 정렬 일치
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">쿠폰재고 (비바콘)</h1>
        <p className="text-sm text-muted-foreground">
          외주 비바콘 시스템의 코드형 쿠폰 재고를 직접 조회·수정합니다.
        </p>
      </div>
      <VivaconInventoryPanel />
    </div>
  );
}
