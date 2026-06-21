import { VivaconStockPanel } from "@/components/vivacon-stock-panel";

export default function StockPage() {
  // 폭은 app-shell 이 /stock 라우트에 맞춰 넓혀줌
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">재고 등록 (OCR)</h1>
        <p className="text-sm text-muted-foreground">
          기프티콘 이미지를 올리면 OCR로 코드를 읽고, 검수·수정 후 코드형/이미지형으로 발행합니다.
        </p>
      </div>
      <VivaconStockPanel />
    </div>
  );
}
