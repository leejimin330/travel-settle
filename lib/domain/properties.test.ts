import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeBalances, type ExpenseInput, type TripInput } from "./balance";
import { parseRate } from "./fixed";
import { money } from "./money";
import { settle, verifySettlement } from "./settle";
import { allocate } from "./split";

const MEMBERS = ["A", "B", "C", "D", "E", "F"];

/** 무작위 여행: 1~6명, 공금 입금, 공금 지출(잔액 부족 포함), 개인 지출 */
const tripArb: fc.Arbitrary<TripInput> = fc
  .integer({ min: 1, max: 6 })
  .chain((n) => {
    const ids = MEMBERS.slice(0, n);
    const member = fc.constantFrom(...ids);
    const subset = fc.subarray(ids, { minLength: 1 });
    const day = fc.integer({ min: 1, max: 9 });
    const contribution = fc.record({
      memberId: member,
      yen: fc.bigInt({ min: 1n, max: 200_000n }),
      won: fc.bigInt({ min: 0n, max: 2_000_000n }),
      day,
    });
    const expense = fc.record({
      wallet: fc.boolean(),
      payer: member,
      yen: fc.bigInt({ min: 1n, max: 100_000n }),
      won: fc.bigInt({ min: 1n, max: 1_000_000n }),
      who: subset,
      day,
    });
    return fc.record({
      ids: fc.constant(ids),
      contributions: fc.array(contribution, { maxLength: 6 }),
      expenses: fc.array(expense, { maxLength: 12 }),
      taker: fc.option(member, { nil: null }),
    });
  })
  .map(({ ids, contributions, expenses, taker }) => ({
    baseCurrency: "KRW",
    members: ids.map((id, i) => ({ id, sortOrder: i })),
    contributions: contributions.map((c, i) => ({
      id: `c${i}`,
      memberId: c.memberId,
      amount: money(c.yen, "JPY"),
      baseCost: c.won,
      occurredAt: `2026-11-0${c.day}T00:00:00.000Z`,
      createdAt: `2026-11-0${c.day}T00:00:00.000Z`,
    })),
    expenses: expenses.map(
      (e, i): ExpenseInput => ({
        id: `e${i}`,
        amount: money(e.yen, "JPY"),
        paidBy: e.wallet ? { kind: "wallet" } : { kind: "member", memberId: e.payer },
        baseCost: e.wallet ? null : e.won,
        occurredAt: `2026-11-0${e.day}T12:00:00.000Z`,
        createdAt: `2026-11-0${e.day}T12:00:00.000Z`,
        splitType: "equal",
        participants: e.who.map((memberId) => ({ memberId, value: 0n })),
        overdraftRate: parseRate("905", 100),
      }),
    ),
    leftover: taker === null ? { kind: "split_by_contribution" } : { kind: "taker", memberId: taker },
  }));

describe("속성", () => {
  it("순잔액 합 = 0, 그리디 송금을 반영하면 모두 0", () => {
    fc.assert(
      fc.property(tripArb, (trip) => {
        const r = computeBalances(trip);
        expect([...r.balances.values()].reduce((s, v) => s + v, 0n)).toBe(0n);
        expect(verifySettlement(r.balances, settle(r.balances, r.memberOrder))).toBe(true);
      }),
    );
  });

  it("공금 원가 보존: Σ입금 원가 = Σ공금 지출 원가 + 남은 원가", () => {
    fc.assert(
      fc.property(tripArb, (trip) => {
        const r = computeBalances(trip);
        const contributed = trip.contributions.reduce((s, c) => s + c.baseCost, 0n);
        const spent = trip.expenses
          .filter((e) => e.paidBy.kind === "wallet")
          .reduce((s, e) => s + r.expenseCosts.get(e.id)!, 0n);
        const left = [...r.wallet.pools.values()].reduce((s, p) => s + p.costMinor, 0n);
        expect(spent + left).toBe(contributed);
      }),
    );
  });

  it("결정적: 입력 배열 순서를 섞어도 결과가 같다", () => {
    fc.assert(
      fc.property(tripArb, fc.nat(), (trip, k) => {
        const shuffle = <T>(xs: T[]) => {
          if (xs.length === 0) return xs;
          const i = k % xs.length;
          return [...xs.slice(i), ...xs.slice(0, i)].reverse();
        };
        const a = computeBalances(trip);
        const b = computeBalances({
          ...trip,
          members: [...trip.members].reverse(),
          expenses: shuffle(trip.expenses),
          contributions: shuffle(trip.contributions),
        });
        expect(b.balances).toEqual(a.balances);
        expect(settle(b.balances, b.memberOrder)).toEqual(settle(a.balances, a.memberOrder));
      }),
    );
  });

  it("allocate: 몫의 합 = total, 각 몫은 공정한 몫과 1 이하 차이", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -10_000_000n, max: 10_000_000n }),
        fc.array(fc.bigInt({ min: 1n, max: 1_000n }), { minLength: 1, maxLength: 6 }),
        fc.string(),
        (total, ws, seed) => {
          const weighted = ws.map((weight, i) => ({ memberId: MEMBERS[i]!, weight }));
          const r = allocate(total, weighted, seed, MEMBERS);
          const W = ws.reduce((s, w) => s + w, 0n);
          expect([...r.values()].reduce((s, v) => s + v, 0n)).toBe(total);
          for (const w of weighted) {
            const fair = (total * w.weight) / W;
            const diff = r.get(w.memberId)! - fair;
            expect(diff >= -1n && diff <= 1n).toBe(true);
          }
        },
      ),
    );
  });
});
