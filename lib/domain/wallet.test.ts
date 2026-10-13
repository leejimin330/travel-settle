import { describe, expect, it } from "vitest";
import { InvalidAmountError, MissingRateError } from "./errors";
import { parseRate } from "./fixed";
import { money } from "./money";
import { replayWallet, type WalletContribution, type WalletEvent, type WalletSpend } from "./wallet";

const t = (day: number, hour = 0) =>
  `2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

const contribute = (id: string, memberId: string, yen: bigint, cost: bigint, at: string): WalletContribution => ({
  kind: "contribution",
  id,
  memberId,
  occurredAt: at,
  createdAt: at,
  amount: money(yen, "JPY"),
  baseCost: cost,
});

const spend = (id: string, yen: bigint, at: string, overdraft: string | null = null): WalletSpend => ({
  kind: "spend",
  id,
  occurredAt: at,
  createdAt: at,
  amount: money(yen, "JPY"),
  overdraftRate: overdraft === null ? null : parseRate(overdraft, 100),
});

describe("replayWallet", () => {
  it("이동평균 원가로 차감하고 원가가 보존된다", () => {
    const r = replayWallet(
      [
        contribute("c1", "A", 20_000n, 180_000n, t(1)),
        contribute("c2", "C", 20_000n, 182_000n, t(1)),
        spend("s1", 10_000n, t(2)),
      ],
      "KRW",
    );
    expect(r.spendCosts.get("s1")).toBe(90_500n);
    expect(r.pools.get("JPY")).toEqual({ foreignMinor: 30_000n, costMinor: 271_500n });
    expect(r.overdrawn).toEqual([]);
  });

  it("잔액을 정확히 다 쓰면 남은 원가 전부가 그 지출의 원가", () => {
    const r = replayWallet(
      [contribute("c1", "A", 3n, 10n, t(1)), spend("s1", 1n, t(2)), spend("s2", 2n, t(3))],
      "KRW",
    );
    expect(r.spendCosts.get("s1")! + r.spendCosts.get("s2")!).toBe(10n);
    expect(r.pools.get("JPY")).toEqual({ foreignMinor: 0n, costMinor: 0n });
  });

  it("입력 배열 순서가 아니라 occurredAt → createdAt → id 순으로 적용", () => {
    const events = [
      spend("s1", 10_000n, t(3)),
      contribute("c2", "C", 20_000n, 182_000n, t(2)),
      contribute("c1", "A", 20_000n, 180_000n, t(1)),
    ];
    expect(replayWallet(events, "KRW").spendCosts.get("s1")).toBe(90_500n);
  });

  it("잔액 부족: 남은 잔액은 풀 원가, 초과분은 API 환율, 경고 목록에 남김", () => {
    const r = replayWallet(
      [contribute("c1", "A", 1_000n, 9_000n, t(1)), spend("s1", 3_000n, t(2), "1000")],
      "KRW",
    );
    expect(r.spendCosts.get("s1")).toBe(9_000n + 20_000n);
    expect(r.pools.get("JPY")).toEqual({ foreignMinor: 0n, costMinor: 0n });
    expect(r.deficits).toEqual([{ spendId: "s1", currency: "JPY", foreignMinor: 2_000n, costMinor: 20_000n }]);
    expect(r.overdrawn).toEqual(["s1"]);
  });

  it("부족분을 나중 입금이 메우면 그 입금의 실제 원가로 다시 평가한다 (최종 리뷰 #1)", () => {
    const usd = (id: string, memberId: string, cents: bigint, cost: bigint, at: string): WalletEvent => ({
      ...contribute(id, memberId, 0n, cost, at),
      amount: money(cents, "USD"),
    });
    const usdSpend = (id: string, cents: bigint, at: string): WalletEvent => ({
      ...spend(id, 0n, at),
      amount: money(cents, "USD"),
      overdraftRate: parseRate("1400", 1),
    });
    const r = replayWallet(
      [
        usdSpend("s1", 10_000n, t(1)), // 입금 전 100 USD 지출 → 임시로 API 1400 = 140,000
        usd("c1", "A", 10_000n, 130_000n, t(2)), // A가 100 USD(130,000원) 입금 → s1 원가 130,000
        usd("c2", "B", 1_000n, 13_000n, t(3)),
        usdSpend("s2", 1_000n, t(4)),
      ],
      "KRW",
    );
    expect(r.spendCosts.get("s1")).toBe(130_000n);
    expect(r.spendCosts.get("s2")).toBe(13_000n);
    expect(r.pools.get("USD")).toEqual({ foreignMinor: 0n, costMinor: 0n });
    expect(r.deficits).toEqual([]);
    expect(r.overdrawn).toEqual(["s1"]);
  });

  it("부족분 일부만 메우면 메운 몫만 다시 평가하고 나머지는 부족분으로 남는다", () => {
    const r = replayWallet(
      [
        contribute("c1", "A", 1_000n, 9_000n, t(1)),
        spend("s1", 3_000n, t(2), "1000"), // 9,000 + 2,000엔×10 = 29,000 (임시)
        contribute("c2", "B", 1_000n, 9_500n, t(3)), // 1,000엔을 9,500원으로 메움
      ],
      "KRW",
    );
    expect(r.spendCosts.get("s1")).toBe(9_000n + 9_500n + 10_000n);
    expect(r.deficits).toEqual([{ spendId: "s1", currency: "JPY", foreignMinor: 1_000n, costMinor: 10_000n }]);
    expect(r.pools.get("JPY")).toEqual({ foreignMinor: 0n, costMinor: 0n });
  });

  it("정산 통화(KRW) 공금은 잔액이 부족해도 환율 없이 액면가로 평가한다 (최종 리뷰 #2)", () => {
    const r = replayWallet(
      [{ ...spend("s1", 0n, t(1)), amount: money(30_000n, "KRW"), overdraftRate: null }],
      "KRW",
    );
    expect(r.spendCosts.get("s1")).toBe(30_000n);
  });

  it("잔액 부족인데 API 환율이 없으면 MissingRateError", () => {
    expect(() => replayWallet([spend("s1", 1n, t(1))], "KRW")).toThrow(MissingRateError);
  });

  it("0 이하 금액은 거부", () => {
    expect(() => replayWallet([contribute("c1", "A", 0n, 0n, t(1))], "KRW")).toThrow(
      InvalidAmountError,
    );
  });

  it("통화별로 풀이 따로 있다", () => {
    const r = replayWallet(
      [
        contribute("c1", "A", 1_000n, 9_000n, t(1)),
        {
          kind: "contribution",
          id: "c2",
          memberId: "A",
          occurredAt: t(1),
          createdAt: t(1),
          amount: money(10_000n, "USD"),
          baseCost: 140_000n,
        },
      ],
      "KRW",
    );
    expect(r.pools.get("JPY")).toEqual({ foreignMinor: 1_000n, costMinor: 9_000n });
    expect(r.pools.get("USD")).toEqual({ foreignMinor: 10_000n, costMinor: 140_000n });
  });
});
