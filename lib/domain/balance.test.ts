import { describe, expect, it } from "vitest";
import { computeBalances, memberOrderOf, type ExpenseInput, type TripInput } from "./balance";
import { InvalidAmountError, UnknownMemberError } from "./errors";
import { parseRate } from "./fixed";
import { money } from "./money";

const at = (day: number) => `2026-11-0${day}T00:00:00.000Z`;
const all = (ids: string[]) => ids.map((memberId) => ({ memberId, value: 0n }));

const krwExpense = (id: string, payer: string, won: bigint, who: string[]): ExpenseInput => ({
  id,
  amount: money(won, "KRW"),
  paidBy: { kind: "member", memberId: payer },
  baseCost: won,
  occurredAt: at(1),
  createdAt: at(1),
  splitType: "equal",
  participants: all(who),
  overdraftRate: null,
});

const trip = (over: Partial<TripInput>): TripInput => ({
  baseCurrency: "KRW",
  members: [
    { id: "A", sortOrder: 0 },
    { id: "B", sortOrder: 1 },
  ],
  expenses: [],
  contributions: [],
  leftover: { kind: "split_by_contribution" },
  ...over,
});

describe("memberOrderOf", () => {
  it("sortOrder, 같으면 id 순", () => {
    expect(
      memberOrderOf([
        { id: "b", sortOrder: 1 },
        { id: "z", sortOrder: 0 },
        { id: "a", sortOrder: 1 },
      ]),
    ).toEqual(["z", "a", "b"]);
  });
});

describe("computeBalances", () => {
  it("2인 단순: A가 5만 원 결제, 둘이 나눔 → A +25,000 / B −25,000", () => {
    const r = computeBalances(trip({ expenses: [krwExpense("e1", "A", 50_000n, ["A", "B"])] }));
    expect(r.balances).toEqual(new Map([["A", 25_000n], ["B", -25_000n]]));
  });

  it("부분 참여: 참여하지 않은 지출은 부담하지 않는다", () => {
    const r = computeBalances(
      trip({
        members: [
          { id: "A", sortOrder: 0 },
          { id: "B", sortOrder: 1 },
          { id: "C", sortOrder: 2 },
        ],
        expenses: [
          krwExpense("e1", "A", 30_000n, ["A", "B", "C"]),
          krwExpense("e2", "B", 20_000n, ["A", "B"]),
        ],
      }),
    );
    expect(r.balances).toEqual(new Map([["A", 10_000n], ["B", 0n], ["C", -10_000n]]));
  });

  it("삭제된 지출과 입금은 계산에서 빠진다", () => {
    const r = computeBalances(
      trip({
        expenses: [
          krwExpense("e1", "A", 50_000n, ["A", "B"]),
          { ...krwExpense("e2", "B", 90_000n, ["A", "B"]), deletedAt: at(2) },
        ],
        contributions: [
          {
            id: "c1",
            memberId: "B",
            amount: money(10_000n, "JPY"),
            baseCost: 90_000n,
            occurredAt: at(1),
            createdAt: at(1),
            deletedAt: at(2),
          },
        ],
      }),
    );
    expect(r.balances).toEqual(new Map([["A", 25_000n], ["B", -25_000n]]));
    expect(r.expenseCosts.has("e2")).toBe(false);
    expect(r.wallet.pools.size).toBe(0);
  });

  it("다통화: JPY·USD 지출이 각자 원가로 합산된다", () => {
    const r = computeBalances(
      trip({
        expenses: [
          { ...krwExpense("j", "A", 0n, ["A", "B"]), amount: money(10_000n, "JPY"), baseCost: 90_000n },
          { ...krwExpense("u", "B", 0n, ["A", "B"]), amount: money(5_000n, "USD"), baseCost: 70_000n },
        ],
      }),
    );
    expect(r.balances).toEqual(new Map([["A", 10_000n], ["B", -10_000n]]));
  });

  it("공금: 입금 원가 크레딧 − 부담분 − 남은 공금 반환(입금 비율)", () => {
    const r = computeBalances(
      trip({
        contributions: [
          { id: "cA", memberId: "A", amount: money(10_000n, "JPY"), baseCost: 90_000n, occurredAt: at(1), createdAt: at(1) },
          { id: "cB", memberId: "B", amount: money(10_000n, "JPY"), baseCost: 92_000n, occurredAt: at(1), createdAt: at(1) },
        ],
        expenses: [
          {
            id: "w1",
            amount: money(15_000n, "JPY"),
            paidBy: { kind: "wallet" },
            baseCost: null,
            occurredAt: at(2),
            createdAt: at(2),
            splitType: "equal",
            participants: all(["A", "B"]),
            overdraftRate: null,
          },
        ],
      }),
    );
    // 풀: 20,000엔/182,000원 → w1 원가 136,500 → 남은 5,000엔/45,500원
    expect(r.expenseCosts.get("w1")).toBe(136_500n);
    expect(r.wallet.pools.get("JPY")).toEqual({ foreignMinor: 5_000n, costMinor: 45_500n });
    // 남은 원가 45,500을 90,000:92,000으로 → 22,500 / 23,000 (나누어떨어짐)
    // 외화 5,000엔은 2,472.5 / 2,527.5 → 나머지 1엔은 fnv1a32("leftover:JPY") % 2 = 1 → B
    expect(r.leftoverShares.get("JPY")).toEqual([
      { memberId: "A", foreignMinor: 2_472n, costMinor: 22_500n },
      { memberId: "B", foreignMinor: 2_528n, costMinor: 23_000n },
    ]);
    // A: 90,000 − 68,250 − 22,500 = −750 / B: 92,000 − 68,250 − 23,000 = +750
    expect(r.balances).toEqual(new Map([["A", -750n], ["B", 750n]]));
  });

  it("남은 공금을 한 사람이 다 가져가면 그 사람이 남은 원가를 전부 부담", () => {
    const r = computeBalances(
      trip({
        leftover: { kind: "taker", memberId: "A" },
        contributions: [
          { id: "cA", memberId: "A", amount: money(10_000n, "JPY"), baseCost: 90_000n, occurredAt: at(1), createdAt: at(1) },
          { id: "cB", memberId: "B", amount: money(10_000n, "JPY"), baseCost: 90_000n, occurredAt: at(1), createdAt: at(1) },
        ],
      }),
    );
    expect(r.leftoverShares.get("JPY")).toEqual([
      { memberId: "A", foreignMinor: 20_000n, costMinor: 180_000n },
    ]);
    expect(r.balances).toEqual(new Map([["A", -90_000n], ["B", 90_000n]]));
  });

  it("입금 없이 공금을 쓴 경우(잔액 부족) 음수 잔여는 전원 균등", () => {
    const r = computeBalances(
      trip({
        expenses: [
          {
            id: "w1",
            amount: money(1_000n, "JPY"),
            paidBy: { kind: "wallet" },
            baseCost: null,
            occurredAt: at(1),
            createdAt: at(1),
            splitType: "equal",
            participants: all(["A"]),
            overdraftRate: parseRate("900", 100),
          },
        ],
      }),
    );
    expect(r.wallet.overdrawn).toEqual(["w1"]);
    expect(r.balances).toEqual(new Map([["A", -4_500n], ["B", 4_500n]]));
  });

  it("공금 외 지출에 원가가 없으면 거부", () => {
    expect(() =>
      computeBalances(trip({ expenses: [{ ...krwExpense("e", "A", 1n, ["A"]), baseCost: null }] })),
    ).toThrow(InvalidAmountError);
  });

  it("모르는 멤버는 거부", () => {
    expect(() => computeBalances(trip({ expenses: [krwExpense("e", "Z", 1n, ["A"])] }))).toThrow(
      UnknownMemberError,
    );
    expect(() =>
      computeBalances(trip({ expenses: [krwExpense("e", "A", 1n, ["Q"])] })),
    ).toThrow(UnknownMemberError);
  });
});
