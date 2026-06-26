import { describe, it, expect } from "vitest";
import { subtractCompleted, type ProductDates } from "@/lib/stock-net";

const pd = (product: string, dates: Array<[string, number]>): ProductDates => ({
  product,
  dates: dates.map(([date, count]) => ({ date, count })),
  total: dates.reduce((s, [, c]) => s + c, 0),
});

describe("subtractCompleted — 이미지형 판매중 = pending − completed", () => {
  it("판매완료분을 상품×유효기간별로 차감", () => {
    const pending = [pd("올리브영 5만원권", [["260731", 5]])];
    const completed = [pd("올리브영 5만원권", [["260731", 2]])];
    const r = subtractCompleted(pending, completed);
    expect(r).toEqual([pd("올리브영 5만원권", [["260731", 3]])]);
  });

  it("전량 판매완료된 그룹은 제거(0 그룹 제외)", () => {
    const pending = [pd("맘스터치 세트", [["270626", 2]])];
    const completed = [pd("맘스터치 세트", [["270626", 2]])];
    expect(subtractCompleted(pending, completed)).toEqual([]);
  });

  it("completed가 더 많아도 음수가 아닌 0으로 클램프(그룹 제거)", () => {
    const pending = [pd("교촌치킨", [["261231", 1]])];
    const completed = [pd("교촌치킨", [["261231", 3]])];
    expect(subtractCompleted(pending, completed)).toEqual([]);
  });

  it("유효기간이 다르면 차감하지 않음(다른 그룹)", () => {
    const pending = [pd("스타벅스 3만", [["260731", 4]])];
    const completed = [pd("스타벅스 3만", [["260801", 4]])]; // 날짜 다름
    expect(subtractCompleted(pending, completed)).toEqual([pd("스타벅스 3만", [["260731", 4]])]);
  });

  it("같은 상품 여러 유효기간 중 일부만 차감", () => {
    const pending = [pd("CU 1만", [["260731", 5], ["260930", 3]])];
    const completed = [pd("CU 1만", [["260731", 5]])]; // 앞 그룹만 전량 판매
    expect(subtractCompleted(pending, completed)).toEqual([pd("CU 1만", [["260930", 3]])]);
  });

  it("completed에만 있는 상품은 결과에 없음(판매중 아님)", () => {
    const pending = [pd("A", [["260731", 2]])];
    const completed = [pd("B", [["260731", 9]])];
    expect(subtractCompleted(pending, completed)).toEqual([pd("A", [["260731", 2]])]);
  });
});
