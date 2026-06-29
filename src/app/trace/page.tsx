import { CouponTracePanel } from "@/components/coupon-trace-panel";

export default function TracePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">이력 조회</h1>
        <p className="text-sm text-muted-foreground">
          쿠폰번호(또는 주문번호) 하나로 매입처·매입원가·증빙부터 어느 고객에게 언제 발송됐는지까지 전 과정을 추적합니다.
        </p>
      </div>
      <CouponTracePanel />
    </div>
  );
}
