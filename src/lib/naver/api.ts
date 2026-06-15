import { getNaverToken, API_BASE } from "./auth";

async function naverGet<T>(path: string): Promise<T> {
  const token = await getNaverToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver API ${path} 오류 (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── 상품 ────────────────────────────────────────────
export interface NaverProduct {
  channelProductNo: number;
  originProductNo: number;
  name: string;
  salePrice: number;
  stockQuantity: number;
  status: string; // SALE | SUSPENSION | OUTOFSTOCK | ...
}

interface ChannelProductsRes {
  contents: NaverProduct[];
  totalElements: number;
  totalPages: number;
  number: number; // 현재 페이지 (0-based)
  size: number;
}

export async function getAllProducts(): Promise<NaverProduct[]> {
  const all: NaverProduct[] = [];
  let page = 0;

  while (true) {
    const params = new URLSearchParams({ page: String(page), size: "100" });
    const data = await naverGet<ChannelProductsRes>(
      `/external/v2/products/channel-products?${params}`,
    );
    all.push(...(data.contents ?? []));
    if (page >= (data.totalPages ?? 1) - 1 || (data.contents ?? []).length === 0) break;
    page++;
    await sleep(1000); // Rate limit 방지
  }
  return all;
}

// ── 주문 ────────────────────────────────────────────
export interface NaverOrder {
  productOrderId: string;
  orderId: string;
  productName: string;
  channelProductNo: number;
  quantity: number;
  unitPrice: number;
  paymentDate: string; // ISO8601
  productOrderStatus: string;
}

interface OrdersRes {
  data: {
    contents: NaverOrder[];
    totalElements: number;
    totalPages: number;
    number: number;
  };
}

export async function getOrdersByDateRange(start: Date, end: Date): Promise<NaverOrder[]> {
  const all: NaverOrder[] = [];
  let pageNum = 1;

  while (true) {
    const params = new URLSearchParams({
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      pageNum: String(pageNum),
      pageSize: "300",
      paymentDateType: "PAYMENT_DATE",
      orderStatusCode: "PAY_DONE,PRODUCT_PREPARE,DELIVERING,DELIVERED",
    });
    const data = await naverGet<OrdersRes>(
      `/external/v1/pay-order/seller/orders/query-date?${params}`,
    );
    const contents = data.data?.contents ?? [];
    all.push(...contents);
    if (contents.length < 300) break;
    pageNum++;
    await sleep(1000);
  }
  return all;
}

export async function getOrdersLast30Days(): Promise<NaverOrder[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return getOrdersByDateRange(start, end);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
