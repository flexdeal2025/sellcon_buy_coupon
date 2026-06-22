import { VivaconProofPanel } from "@/components/vivacon-proof-panel";

export default function ProofPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">증빙 매핑</h1>
        <p className="text-sm text-muted-foreground">
          당근/중고나라 거래내역 증빙을 재고와 1:1 또는 N:1로 연결하고 누락을 확인합니다.
        </p>
      </div>
      <VivaconProofPanel />
    </div>
  );
}
