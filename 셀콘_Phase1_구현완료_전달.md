# 📨 컨트롤타워 세션에 전달 — 셀콘 Phase 1 구현 완료, 받는 쪽(타워) 구현 요청

> 셀콘(보내는 쪽)은 확정 계약(`셀콘회신_연동계약.md`)대로 **호출부를 구현 완료**했습니다.
> 이 문서는 **실제 배포된 셀콘 코드 기준**의 정확한 계약입니다. 타워는 이 문서대로
> `POST /api/stock/ingest` 와 `DELETE /api/stock/ingest` 를 구현하면 즉시 연동됩니다.
>
> 셀콘 측 커밋: `81ae561` (잠자기 상태로 배포 — 아래 §6 활성화 전까지 호출 안 함)

---

## 0. 한눈에 — 무엇이 언제 호출되나

| 시점 | 셀콘 동작 | 타워 엔드포인트 |
|------|----------|----------------|
| 회원이 **판매 동의 완료**(소유권 이관) | 재고 1건 푸시 | `POST /api/stock/ingest` |
| 그 건이 **취소(CANCELLED)/반려(REJECTED)** | 재고 철회 | `DELETE /api/stock/ingest?source_ref=...` |

- 검수(쿠폰·유효기간·이미지 확정)는 **동의보다 항상 먼저** 끝나므로, 푸시 시점에 데이터는 모두 확정 상태입니다.
- **쿠폰 1건 = 푸시 1건 = 정산 1건** (1:1). 멱등키는 쿠폰 단위.

---

## 1. 인증

모든 요청 헤더:
```
Authorization: Bearer <STOCK_INGEST_KEY>
```
- 키 불일치 시 타워는 `401` + `{ "ok": false, "error": "unauthorized" }` 반환 권장.
- 키는 §6에서 양쪽이 공유.

---

## 2. `POST /api/stock/ingest` — 재고 푸시

### 요청 본문 (셀콘이 실제로 보내는 필드 — 전부 이대로 전송됨)

```jsonc
{
  "source": "sellcon",
  "source_ref": "sellcon_gifticon_clx1a2b3c4d5e6f7g8h9i0j1k", // 멱등키 (쿠폰 1건당 고유·불변)
  "stored_as_code": true,            // true=코드형(coupon_code 있음) / false=이미지형
  "product_name": "스타벅스 아메리카노 Tall",
  "option_name": "",                 // 항상 빈 문자열 — 타워가 기본값('유효기간 최소…') 적용
  "coupon_code": "1234-5678-9012",   // 코드형이면 문자열, 이미지형이면 null
  "expiry_date": "2026-09-30",       // KST 'YYYY-MM-DD'. OCR 누락 시 null 가능 → 타워 검수에서 보완
  "image_url": "https://[ref].supabase.co/storage/v1/object/public/gifticons/uuid.jpg", // 공개 URL(바로 fetch 가능)
  "supplier": "셀콘",
  "purchase_channel": "sellcon_auto",
  "proof_type": "no_formal_sellcon",
  "payout_uuid": "clx1a2b3c4d5e6f7g8h9i0j1k", // = gifticons.id (세무 소명 시 셀콘 조회키)
  "unit_cost": 38000,                // 매입원가(원) = 판매자 기본 지급액
  "payout_amount": 38000,            // 실지급(원) = unit_cost + bonus_amount
  "bonus_amount": 0,                 // 보너스(원). ※ 동의 시점엔 대부분 0 (아래 주의 참고)
  "purchase_date": "2026-06-24",     // KST 'YYYY-MM-DD' = 검수완료(매입확정)일
  "seller_ref": "clx9z8y7x6w5v4u3t2s1r0q", // = sellerId (불투명 키, PII 아님)
  "seller_name_masked": "홍*동"       // 마스킹명만 (실명·전화·계좌 평문은 절대 안 보냄)
}
```

### 셀콘이 기대하는 응답 (★ 타워 구현 시 반드시 준수)

**성공** — 셀콘은 `HTTP 2xx` **그리고** `ok === true` **그리고** `id`(문자열)가 **모두** 있어야 성공으로 처리하고, `id`를 `towerStockId`로 저장합니다.
```jsonc
{ "ok": true, "id": "TWR-000123", "batch_no": "SC-260624-001", "deduped": false } // 신규
{ "ok": true, "id": "TWR-000123", "batch_no": "SC-260624-001", "deduped": true }  // 재요청(멱등)
```
> - `id`(타워 재고 ID)는 **문자열 필수**. 없으면 셀콘이 실패로 간주합니다.
> - `batch_no`, `deduped` 는 셀콘이 저장/검사하지 않습니다(있어도 무방). **신규·deduped 모두 동일하게 성공 처리.**

**실패** — 아래 중 하나면 셀콘은 실패로 보고(텔레그램 알림) `towerStockId`를 비워 둡니다.
```jsonc
{ "ok": false, "error": "unauthorized" }   // 401 등
```

### 주의 (타워가 알아야 할 셀콘 측 사정)
- **멱등 필수**: 같은 `source_ref` 재요청 시 새로 만들지 말고 **기존 `id`를 그대로** 반환(`deduped:true`). 셀콘이 재시도해도 1건이어야 함.
- **응답 8초 이내**: 셀콘은 8초 타임아웃(AbortController) 후 실패 처리합니다.
- **`bonus_amount`는 동의 시점엔 0이 일반적**: 보너스는 셀콘에서 *정산 시점*에 확정·잠금됩니다. 따라서 ingest 시 `unit_cost`가 신뢰 가능한 매입원가이고, `payout_amount`엔 후속 보너스가 빠져 있을 수 있습니다. **최종 지급액은 Phase 2(정산 스냅샷)에서 별도 전달 예정.**
- **`expiry_date`/`coupon_code`가 null일 수 있음**: 이미지형이거나 OCR이 유효기간을 못 읽은 경우. 타워 검수에서 보완.
- **`image_url`은 Supabase 공개 URL**: 인증 없이 바로 fetch 가능. (서명 URL/TTL은 현재 미적용 — 필요 시 셀콘이 후속 추가)
- **적재 정책(계약 합의)**: 타워는 `pending`(검수대기)로만 적재하고, 실판매 발행은 타워 관리자가 수동(오배송 방어).

---

## 3. `DELETE /api/stock/ingest?source_ref=...` — 재고 철회

동의 후 그 건이 취소/반려되면 호출. 쿼리스트링으로 멱등키 전달:
```
DELETE /api/stock/ingest?source_ref=sellcon_gifticon_clx1a2b3c4d5e6f7g8h9i0j1k
Authorization: Bearer <STOCK_INGEST_KEY>
```

### 셀콘이 기대하는 응답
셀콘은 `HTTP 2xx` **그리고** `ok === true` 여야 정상으로 처리합니다.
```jsonc
{ "ok": true, "withdrawn": true }                        // 미발행분 삭제 완료 → 셀콘이 towerStockId 비움
{ "ok": true, "withdrawn": false, "reason": "published" } // 이미 발행됨 → 자동철회 불가 (셀콘이 관리자 알림 + towerStockId 유지)
{ "ok": false, "error": "..." }                          // 실패 → 셀콘 관리자 알림
```
> - `withdrawn` 명시 없이 `ok:true`만 오면 셀콘은 "철회됨"으로 간주합니다. **이미 발행된 건은 반드시 `withdrawn:false`로 구분**해 주세요(실재고 회수는 사람이 협의).
> - 동기화된 적 없는 건(towerStockId 없음)은 셀콘이 **애초에 호출하지 않습니다.**

---

## 4. 셀콘이 보내는 값 ↔ 출처 (디버깅·검증용)

| 필드 | 셀콘 DB 출처 |
|------|-------------|
| `source_ref` / `payout_uuid` | `gifticons.id` (cuid) |
| `stored_as_code` | `gifticons.couponCode != null` |
| `coupon_code` | `gifticons.couponCode` |
| `expiry_date` | `gifticons.validPeriod` → KST 날짜 |
| `image_url` | `gifticons.imageUrl` (Supabase 공개 URL) |
| `unit_cost` | `gifticons.purchasePrice` |
| `payout_amount` | `purchasePrice + (bonusAmount ?? 0)` |
| `bonus_amount` | `gifticons.bonusAmount ?? 0` |
| `purchase_date` | `gifticons.inspectionCompletedAt` → KST 날짜 |
| `seller_ref` | `gifticons.sellerId` |
| `seller_name_masked` | KYC 실명 마스킹 (홍길동→홍*동) |
| `product_name` | `products.title` |

---

## 5. 동작 규칙 요약

- **멱등**: `source_ref` 단위. 재시도 안전.
- **타임아웃**: 8초.
- **PII 최소**: `seller_ref`(불투명) + 마스킹명만. 실명·전화·계좌 평문 미전송(동일 법인 — 필요 시 `payout_uuid`로 셀콘 내부 조회).
- **베스트 에포트**: 전송 실패해도 셀콘의 회원 동의/취소 흐름은 정상 진행(타워 장애가 셀콘 판매를 막지 않음).
- **잠자기 배포**: 아래 §6 환경변수 설정 전까지 셀콘은 타워를 **호출하지 않음**.

---

## 6. 연동 활성화 — 타워가 셀콘에 줘야 할 것

타워 엔드포인트가 준비되면 아래 2개를 셀콘에 전달:
1. **타워 base URL** (예: `https://tower.example.com`) → 셀콘 env `STOCK_INGEST_URL`
2. **공유 비밀키** → 셀콘 env `STOCK_INGEST_KEY`

셀콘이 Vercel 환경변수에 이 2개를 넣는 순간 연동이 자동 활성화됩니다(코드 재배포 불필요).

---

## 7. 셀콘 측 아직 안 된 것 (타워가 기대하면 안 되는 것)

- **전송 실패 자동 재시도**: 현재 없음. 실패 시 셀콘 관리자에게 텔레그램 알림만. → 타워는 가급적 안정적으로 응답. (셀콘 자동 재시도는 후속 예정)
- **Phase 2 — 정산완료 스냅샷**: `POST /api/stock/ingest/payout` (확정 지급일 + `kyc_name_hash`). **아직 미구현.** 타워가 이 엔드포인트를 먼저 만들어도 셀콘은 당장 호출하지 않음.
- **셀콘 자체 매입재고(`ADMIN_UPLOAD`)**: 미전송(셀콘 자체 '쿠폰 구매하기' 기능 생길 때 별도). 현재는 **회원 판매분만** 전송.

---

## 8. 타워 측 구현 체크리스트

- [ ] `POST /api/stock/ingest` — Bearer 인증, §2 요청 수신, **멱등(source_ref)**, `{ok:true,id}` 반환
- [ ] `DELETE /api/stock/ingest?source_ref=` — Bearer 인증, `{ok:true,withdrawn}` 반환, 발행분은 `withdrawn:false`
- [ ] 적재는 `pending`으로, 실판매 발행은 관리자 수동
- [ ] 8초 내 응답
- [ ] (후속) `POST /api/stock/ingest/payout` — Phase 2 정산 스냅샷
- [ ] base URL + `STOCK_INGEST_KEY` 셀콘에 전달 → 활성화

---

문의나 필드 변경 필요 시 셀콘 세션에 회신 주세요. 양쪽 준비되면 **실거래 1건으로 연결 테스트** 후 가동하면 됩니다.
