import type { ContributionInput, ExpenseInput, MemberInput, TripInput } from "../balance";
import { parseFeePercent, parseRate } from "../fixed";
import { money, parseMajor } from "../money";
import { resolveCost } from "../rate";

export const at = (day: number, hour = 0) =>
  `2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

const members = (ids: string[]): MemberInput[] => ids.map((id, i) => ({ id, sortOrder: i }));
const everyone = (ids: string[]) => ids.map((memberId) => ({ memberId, value: 0n }));

/**
 * 시나리오 1 — 친구 4명, 일본 3박 4일, 공금 여행 (원본 명세 §12-1)
 * A·B 900원/100엔, C 910원/100엔 환전, D 트래블카드 905원/100엔 충전으로 각자 2만 엔 입금.
 * 공금 지출 3건(전원 균등) 후 3,250엔이 남는다. A가 신용카드(수수료 1.5%)로 1만 엔 대납.
 */
export function scenario1(): TripInput {
  const ids = ["A", "B", "C", "D"];
  const contribution = (id: string, memberId: string, rate: string, travelCard = false): ContributionInput => {
    const amount = money(20_000n, "JPY");
    const cost = resolveCost(
      travelCard
        ? { amount, baseCurrency: "KRW", fundingSource: { currency: "JPY", rate: parseRate(rate, 100), feeRate: 0n } }
        : { amount, baseCurrency: "KRW", userRate: parseRate(rate, 100) },
    );
    return { id, memberId, amount, baseCost: cost.base.amountMinor, occurredAt: at(1), createdAt: at(1) };
  };
  const walletSpend = (id: string, yen: bigint, day: number): ExpenseInput => ({
    id,
    amount: money(yen, "JPY"),
    paidBy: { kind: "wallet" },
    baseCost: null,
    occurredAt: at(day, 12),
    createdAt: at(day, 12),
    splitType: "equal",
    participants: everyone(ids),
    overdraftRate: parseRate("905", 100),
  });
  const card = resolveCost({
    amount: money(10_000n, "JPY"),
    baseCurrency: "KRW",
    fundingSource: { currency: "JPY", rate: null, feeRate: parseFeePercent("1.5") },
    apiRate: parseRate("905", 100),
  });
  return {
    baseCurrency: "KRW",
    members: members(ids),
    contributions: [
      contribution("c-A", "A", "900"),
      contribution("c-B", "B", "900"),
      contribution("c-C", "C", "910"),
      contribution("c-D", "D", "905", true),
    ],
    expenses: [
      walletSpend("w1", 30_000n, 1),
      walletSpend("w2", 26_750n, 2),
      walletSpend("w3", 20_000n, 3),
      {
        id: "p1",
        amount: money(10_000n, "JPY"),
        paidBy: { kind: "member", memberId: "A" },
        baseCost: card.base.amountMinor,
        occurredAt: at(2, 20),
        createdAt: at(2, 20),
        splitType: "equal",
        participants: everyone(ids),
        overdraftRate: null,
      },
    ],
    leftover: { kind: "split_by_contribution" },
  };
}

/**
 * 시나리오 2 — 동아리 15명, 대만 MT (원본 명세 §12-2)
 * M13~M15는 2일차 합류, 2일차 저녁은 M01~M08 8명만.
 */
export function scenario2(): TripInput {
  const ids = Array.from({ length: 15 }, (_, i) => `M${String(i + 1).padStart(2, "0")}`);
  const twd = (s: string) => parseMajor(s, "TWD");
  const personal = (
    id: string,
    payer: string,
    amount: string,
    who: string[],
    day: number,
    cost: Parameters<typeof resolveCost>[0],
  ): ExpenseInput => ({
    id,
    amount: twd(amount),
    paidBy: { kind: "member", memberId: payer },
    baseCost: resolveCost(cost).base.amountMinor,
    occurredAt: at(day, 19),
    createdAt: at(day, 19),
    splitType: "equal",
    participants: everyone(who),
    overdraftRate: null,
  });
  const api = parseRate("43.5");
  return {
    baseCurrency: "KRW",
    members: members(ids),
    contributions: [],
    expenses: [
      personal("d1-dinner", "M01", "4500", ids.slice(0, 12), 1, {
        amount: twd("4500"),
        baseCurrency: "KRW",
        fundingSource: { currency: "TWD", rate: parseRate("43"), feeRate: 0n },
      }),
      personal("d2-bus", "M02", "3000", ids, 2, {
        amount: twd("3000"),
        baseCurrency: "KRW",
        fundingSource: { currency: "TWD", rate: null, feeRate: parseFeePercent("1") },
        apiRate: api,
      }),
      personal("d2-dinner", "M03", "2400", ids.slice(0, 8), 2, {
        amount: twd("2400"),
        baseCurrency: "KRW",
        apiRate: api,
      }),
    ],
    leftover: { kind: "split_by_contribution" },
  };
}

/** 시나리오 3 — 혼자 유럽 3개국 (원본 명세 §12-3): EUR·CHF·CZK, 정산 없이 가계부 */
export function scenario3(): TripInput {
  const solo = (id: string, amount: string, currency: string, rate: string, day: number): ExpenseInput => {
    const a = parseMajor(amount, currency);
    return {
      id,
      amount: a,
      paidBy: { kind: "member", memberId: "S" },
      baseCost: resolveCost({ amount: a, baseCurrency: "KRW", apiRate: parseRate(rate) }).base.amountMinor,
      occurredAt: at(day),
      createdAt: at(day),
      splitType: "equal",
      participants: [{ memberId: "S", value: 0n }],
      overdraftRate: null,
    };
  };
  return {
    baseCurrency: "KRW",
    members: members(["S"]),
    contributions: [],
    expenses: [
      solo("eur", "120.50", "EUR", "1500", 1),
      solo("chf", "45", "CHF", "1600", 3),
      solo("czk", "350", "CZK", "60", 5),
    ],
    leftover: { kind: "split_by_contribution" },
  };
}
