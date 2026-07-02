import { SupplierDocsPanel } from "@/components/supplier-docs-panel";

export default function SupplierDocsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">증빙 보관함</h1>
        <p className="text-sm text-muted-foreground">
          대량 매입 공급처의 거래내역서·세금계산서 등을 미리 보관하고 필요할 때 조회합니다.
        </p>
      </div>
      <SupplierDocsPanel />
    </div>
  );
}
