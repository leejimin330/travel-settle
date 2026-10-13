import { describe, expect, it } from "vitest";
import { computeBalances, type TripInput } from "./balance";
import { averageRate, baseToForeign, describeTransfers, tripAverageRate } from "./display";
import { parseRate } from "./fixed";
import { money } from "./money";

const at = "2026-11-01T00:00:00.000Z";

describe("averageRate", () => {
  it("181,000원 / 20,000엔 = 9.05원/엔", () => {
    expect(averageRate(181_000n, 20_000n, "JPY", "KRW")).toBe(parseRate("905", 100));
  });
  it("외화 합이 0 이하이면 null", () => {
    expect(averageRate(1n, 0n, "JPY", "KRW")).toBeNull();
  });
  it("자릿수가 다른 통화: 180,750원 / 120.50 EUR = 1500", () => {
    expect(averageRate(180_750n, 12_050n, "EUR", "KRW")).toBe(parseRate("1500"));
  });
});

describe("baseToForeign", () => {
  it("23,684원 ÷ 8.9원/엔 = 2,661.1 → 2,661엔", () => {
    expect(baseToForeign(23_684n, "KRW", parseRate("890", 100), "JPY")).toEqual(money(2_661n, "JPY"));
  });
  it("TWD는 표시 자릿수(0)로 반올림해 minor 2자리로 저장: 10,000원 ÷ 43 = 232.56 → 233 TWD", () => {
    expect(baseToForeign(10_000n, "KRW", parseRate("43"), "TWD")).toEqual(money(23_300n, "TWD"));
  });
  it("USD는 센트까지: 10,000원 ÷ 1,400 = 7.14", () => {
    expect(baseToForeign(10_000n, "KRW", parseRate("1400"), "USD")).toEqual(money(714n, "USD"));
  });
});

describe("tripAverageRate", () => {
  const base = (over: Partial<TripInput>): TripInput => ({
    baseCurrency: "KRW",
    members: [{ id: "A", sortOrder: 0 }],
    expenses: [],
    contributions: [],
    leftover: { kind: "split_by_contribution" },
    ...over,
  });

  it("주 통화 지출(공금 포함) 원가 합 ÷ 외화 합", () => {
    const input = base({
      expenses: [
        {
          id: "e1",
          amount: money(10_000n, "JPY"),
          paidBy: { kind: "member", memberId: "A" },
          baseCost: 90_000n,
          occurredAt: at,
          createdAt: at,
          splitType: "equal",
          participants: [{ memberId: "A", value: 0n }],
          overdraftRate: null,
        },
        {
          id: "e2",
          amount: money(10_000n, "JPY"),
          paidBy: { kind: "member", memberId: "A" },
          baseCost: 92_000n,
          occurredAt: at,
          createdAt: at,
          splitType: "equal",
          participants: [{ memberId: "A", value: 0n }],
          overdraftRate: null,
        },
      ],
    });
    const r = computeBalances(input);
    expect(tripAverageRate(r, input.expenses, "JPY", "KRW")).toBe(parseRate("910", 100));
  });

  it("주 통화 지출이 없으면 공금 평균 원가", () => {
    const input = base({
      contributions: [
        { id: "c", memberId: "A", amount: money(20_000n, "JPY"), baseCost: 181_000n, occurredAt: at, createdAt: at },
      ],
    });
    const r = computeBalances(input);
    expect(tripAverageRate(r, input.expenses, "JPY", "KRW")).toBe(parseRate("905", 100));
  });

  it("아무것도 없으면 null, 주 통화가 정산 통화면 null", () => {
    const input = base({});
    const r = computeBalances(input);
    expect(tripAverageRate(r, input.expenses, "JPY", "KRW")).toBeNull();
    expect(tripAverageRate(r, input.expenses, "KRW", "KRW")).toBeNull();
  });
});

describe("describeTransfers", () => {
  it("원화 + 평균 환율 외화 + 오늘 환율 외화", () => {
    const v = describeTransfers(
      [{ from: "B", to: "A", amountMinor: 23_684n }],
      "KRW",
      "JPY",
      parseRate("905", 100),
      parseRate("890", 100),
    );
    expect(v).toEqual([
      {
        from: "B",
        to: "A",
        base: money(23_684n, "KRW"),
        atAverage: money(2_617n, "JPY"),
        atToday: money(2_661n, "JPY"),
      },
    ]);
  });

  it("환율이 없으면 그 칸은 null", () => {
    const [v] = describeTransfers([{ from: "B", to: "A", amountMinor: 1n }], "KRW", "JPY", null, null);
    expect(v).toMatchObject({ atAverage: null, atToday: null });
  });
});
