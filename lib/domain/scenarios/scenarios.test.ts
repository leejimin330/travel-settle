import { describe, expect, it } from "vitest";
import { computeBalances } from "../balance";
import { describeTransfers, tripAverageRate } from "../display";
import { parseRate } from "../fixed";
import { money } from "../money";
import { settle, verifySettlement } from "../settle";
import { scenario1, scenario2, scenario3 } from "./fixtures";

describe("시나리오 1 — 친구 4명 일본 공금 여행", () => {
  const input = scenario1();
  const r = computeBalances(input);

  it("입금 원가: A·B 180,000 / C 182,000 / D 181,000", () => {
    expect(input.contributions.map((c) => c.baseCost)).toEqual([180_000n, 180_000n, 182_000n, 181_000n]);
  });

  it("공금 지출 원가는 이동평균으로, 남은 3,250엔의 원가는 29,372원", () => {
    expect(r.expenseCosts).toEqual(
      new Map([
        ["w1", 271_125n],
        ["w2", 241_753n],
        ["w3", 180_750n],
        ["p1", 91_858n],
      ]),
    );
    expect(r.wallet.pools.get("JPY")).toEqual({ foreignMinor: 3_250n, costMinor: 29_372n });
  });

  it("남은 공금은 입금 원가 비율로 나눠 갖는다", () => {
    expect(r.leftoverShares.get("JPY")).toEqual([
      { memberId: "A", foreignMinor: 809n, costMinor: 7_312n },
      { memberId: "B", foreignMinor: 810n, costMinor: 7_313n },
      { memberId: "C", foreignMinor: 818n, costMinor: 7_394n },
      { memberId: "D", foreignMinor: 813n, costMinor: 7_353n },
    ]);
  });

  it("순잔액: 비싸게 환전한 C가 B보다 덜 낸다, 카드로 대납한 A가 받는다", () => {
    expect(r.balances).toEqual(
      new Map([
        ["A", 68_174n],
        ["B", -23_684n],
        ["C", -21_765n],
        ["D", -22_725n],
      ]),
    );
  });

  it("송금 목록과 외화 표시", () => {
    const t = settle(r.balances, r.memberOrder);
    expect(t).toEqual([
      { from: "B", to: "A", amountMinor: 23_684n },
      { from: "D", to: "A", amountMinor: 22_725n },
      { from: "C", to: "A", amountMinor: 21_765n },
    ]);
    expect(verifySettlement(r.balances, t)).toBe(true);

    const avg = tripAverageRate(r, input.expenses, "JPY", "KRW");
    expect(avg).toBe(90_545_936_599n); // ≈ 905.46원/100엔
    const [first] = describeTransfers(t, "KRW", "JPY", avg, parseRate("890", 100));
    expect(first).toMatchObject({ atAverage: money(2_616n, "JPY"), atToday: money(2_661n, "JPY") });
  });
});

describe("시나리오 2 — 동아리 15명 대만 MT", () => {
  const input = scenario2();
  const r = computeBalances(input);

  it("원가: 현금 43원 / 카드 43.5원+1% / API 43.5원", () => {
    expect(r.expenseCosts).toEqual(
      new Map([
        ["d1-dinner", 193_500n],
        ["d2-bus", 131_805n],
        ["d2-dinner", 104_400n],
      ]),
    );
  });

  it("2일차 합류(M13~15)는 버스만, 저녁 불참(M09~12)은 1일차 저녁+버스만", () => {
    const b = r.balances;
    expect(b.get("M01")).toBe(155_538n);
    expect(b.get("M02")).toBe(93_843n);
    expect(b.get("M03")).toBe(66_438n);
    for (const id of ["M04", "M05", "M06", "M07", "M08"]) expect(b.get(id)).toBe(-37_962n);
    for (const id of ["M09", "M10", "M11", "M12"]) expect(b.get(id)).toBe(-24_912n);
    for (const id of ["M13", "M14", "M15"]) expect(b.get(id)).toBe(-8_787n);
  });

  it("송금 14건 이하, 늦게 합류한 사람의 송금 합은 각자 8,787원", () => {
    const t = settle(r.balances, r.memberOrder);
    expect(verifySettlement(r.balances, t)).toBe(true);
    expect(t.length).toBeLessThanOrEqual(14);
    for (const id of ["M13", "M14", "M15"]) {
      expect(t.filter((x) => x.from === id).reduce((s, x) => s + x.amountMinor, 0n)).toBe(8_787n);
    }
  });
});

describe("시나리오 3 — 혼자 유럽 3개국", () => {
  const input = scenario3();
  const r = computeBalances(input);

  it("정산 없음, 통화별 원가만", () => {
    expect(r.balances).toEqual(new Map([["S", 0n]]));
    expect(settle(r.balances, r.memberOrder)).toEqual([]);
    expect(r.expenseCosts).toEqual(
      new Map([
        ["eur", 180_750n],
        ["chf", 72_000n],
        ["czk", 21_000n],
      ]),
    );
    expect([...r.expenseCosts.values()].reduce((s, v) => s + v, 0n)).toBe(273_750n);
  });
});
