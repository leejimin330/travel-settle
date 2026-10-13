import { describe, expect, it } from "vitest";
import { SplitValidationError, UnknownMemberError } from "./errors";
import { fnv1a32 } from "./hash";
import { money } from "./money";
import { allocate, splitCost } from "./split";

const order = ["A", "B", "C", "D"];
const sum = (m: Map<string, bigint>) => [...m.values()].reduce((s, v) => s + v, 0n);

describe("fnv1a32", () => {
  it("알려진 값 (결정적)", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
  });
});

describe("allocate", () => {
  it("나머지 1원은 seed로 정한 시작점부터 순서대로 준다", () => {
    const w = order.slice(0, 3).map((memberId) => ({ memberId, weight: 1n }));
    const r = allocate(10_000n, w, "e1", order);
    expect(sum(r)).toBe(10_000n);
    expect([...r.values()].sort()).toEqual([3333n, 3333n, 3334n]);
    const lucky = ["A", "B", "C"][fnv1a32("e1") % 3]!;
    expect(r.get(lucky)).toBe(3334n);
  });

  it("같은 입력이면 같은 결과, 입력 배열 순서와 무관", () => {
    const w = [
      { memberId: "C", weight: 1n },
      { memberId: "A", weight: 1n },
      { memberId: "B", weight: 1n },
    ];
    expect(allocate(100n, w, "x", order)).toEqual(allocate(100n, [...w].reverse(), "x", order));
  });

  it("음수 total도 합이 정확히 맞는다", () => {
    const w = order.map((memberId) => ({ memberId, weight: 1n }));
    const r = allocate(-10n, w, "neg", order);
    expect(sum(r)).toBe(-10n);
    expect([...r.values()].every((v) => v === -2n || v === -3n)).toBe(true);
  });

  it("weight 0인 사람은 나머지를 받지 않는다", () => {
    const r = allocate(
      5n,
      [
        { memberId: "A", weight: 0n },
        { memberId: "B", weight: 1n },
        { memberId: "C", weight: 1n },
      ],
      "z",
      order,
    );
    expect(r.get("A")).toBe(0n);
    expect(sum(r)).toBe(5n);
  });

  it("잘못된 입력은 거부", () => {
    expect(() => allocate(1n, [], "s", order)).toThrow(SplitValidationError);
    expect(() =>
      allocate(1n, [{ memberId: "A", weight: 1n }, { memberId: "A", weight: 1n }], "s", order),
    ).toThrow(SplitValidationError);
    expect(() => allocate(1n, [{ memberId: "Z", weight: 1n }], "s", order)).toThrow(
      UnknownMemberError,
    );
    expect(() => allocate(1n, [{ memberId: "A", weight: 0n }], "s", order)).toThrow(
      SplitValidationError,
    );
  });
});

describe("splitCost 4종", () => {
  const base = { expenseId: "e", memberOrder: order };

  it("equal: 10,000원을 3명 → 합 10,000", () => {
    const r = splitCost({
      ...base,
      splitType: "equal",
      participants: ["A", "B", "C"].map((memberId) => ({ memberId, value: 0n })),
      foreignAmount: money(10_000n, "KRW"),
      baseCost: 10_000n,
    });
    expect(sum(r)).toBe(10_000n);
  });

  it("exact: 외화 금액 지정 비율로 원가를 나눈다", () => {
    const r = splitCost({
      ...base,
      splitType: "exact",
      participants: [
        { memberId: "A", value: 3_000n },
        { memberId: "B", value: 1_000n },
      ],
      foreignAmount: money(4_000n, "JPY"),
      baseCost: 36_000n,
    });
    expect(r).toEqual(new Map([["A", 27_000n], ["B", 9_000n]]));
  });

  it("exact: 합이 지출액과 다르면 거부", () => {
    expect(() =>
      splitCost({
        ...base,
        splitType: "exact",
        participants: [{ memberId: "A", value: 1n }],
        foreignAmount: money(2n, "JPY"),
        baseCost: 18n,
      }),
    ).toThrow(SplitValidationError);
  });

  it("percent: basis point 합 10000", () => {
    const r = splitCost({
      ...base,
      splitType: "percent",
      participants: [
        { memberId: "A", value: 7_000n },
        { memberId: "B", value: 3_000n },
      ],
      foreignAmount: money(100n, "KRW"),
      baseCost: 100n,
    });
    expect(r).toEqual(new Map([["A", 70n], ["B", 30n]]));
    expect(() =>
      splitCost({
        ...base,
        splitType: "percent",
        participants: [{ memberId: "A", value: 9_999n }],
        foreignAmount: money(100n, "KRW"),
        baseCost: 100n,
      }),
    ).toThrow(SplitValidationError);
  });

  it("shares: 몫 2:1:1", () => {
    const r = splitCost({
      ...base,
      splitType: "shares",
      participants: [
        { memberId: "A", value: 2n },
        { memberId: "B", value: 1n },
        { memberId: "C", value: 1n },
      ],
      foreignAmount: money(4_000n, "KRW"),
      baseCost: 4_000n,
    });
    expect(r).toEqual(new Map([["A", 2_000n], ["B", 1_000n], ["C", 1_000n]]));
  });
});
