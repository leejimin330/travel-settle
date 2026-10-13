import { describe, expect, it } from "vitest";
import { SettlementInvariantError } from "./errors";
import { settle, verifySettlement } from "./settle";

const order = ["A", "B", "C", "D"];

describe("settle", () => {
  it("2인: B → A", () => {
    const b = new Map([["A", 25_000n], ["B", -25_000n]]);
    expect(settle(b, order)).toEqual([{ from: "B", to: "A", amountMinor: 25_000n }]);
  });

  it("가장 많이 줄 사람 ↔ 가장 많이 받을 사람부터 매칭", () => {
    const b = new Map([
      ["A", 70n],
      ["B", 30n],
      ["C", -60n],
      ["D", -40n],
    ]);
    const t = settle(b, order);
    expect(t).toEqual([
      { from: "C", to: "A", amountMinor: 60n },
      { from: "D", to: "B", amountMinor: 30n },
      { from: "D", to: "A", amountMinor: 10n },
    ]);
    expect(verifySettlement(b, t)).toBe(true);
  });

  it("금액이 같으면 멤버 순서로 (결정적)", () => {
    const b = new Map([
      ["B", 10n],
      ["A", 10n],
      ["D", -10n],
      ["C", -10n],
    ]);
    expect(settle(b, order)).toEqual([
      { from: "C", to: "A", amountMinor: 10n },
      { from: "D", to: "B", amountMinor: 10n },
    ]);
  });

  it("모두 0이면 송금 없음", () => {
    expect(settle(new Map([["A", 0n]]), order)).toEqual([]);
  });

  it("합이 0이 아니면 거부", () => {
    expect(() => settle(new Map([["A", 1n]]), order)).toThrow(SettlementInvariantError);
  });
});

describe("verifySettlement", () => {
  it("틀린 송금 목록은 false", () => {
    const b = new Map([["A", 10n], ["B", -10n]]);
    expect(verifySettlement(b, [{ from: "B", to: "A", amountMinor: 9n }])).toBe(false);
    expect(verifySettlement(b, [{ from: "B", to: "Z", amountMinor: 10n }])).toBe(false);
    expect(verifySettlement(b, [{ from: "B", to: "A", amountMinor: 10n }])).toBe(true);
  });
});
