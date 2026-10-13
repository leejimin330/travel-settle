import { InvalidAmountError, SettlementInvariantError, UnknownMemberError } from "./errors";
import type { Rate } from "./fixed";
import type { Money } from "./money";
import { allocate, splitCost, type SplitParticipant, type SplitType, type Weighted } from "./split";
import { replayWallet, type WalletEvent, type WalletReplay } from "./wallet";

export interface MemberInput {
  id: string;
  sortOrder: number;
}

export type Payer = { kind: "member"; memberId: string } | { kind: "wallet" };

export interface ExpenseInput {
  id: string;
  amount: Money;
  paidBy: Payer;
  /** 공금 외 지출의 원화 원가 스냅샷. 공금 지출이면 null */
  baseCost: bigint | null;
  occurredAt: string;
  createdAt: string;
  splitType: SplitType;
  participants: SplitParticipant[];
  /** 공금 지출의 잔액 부족분 평가용 API 환율 */
  overdraftRate: Rate | null;
  deletedAt?: string | null;
}

export interface ContributionInput {
  id: string;
  memberId: string;
  amount: Money;
  baseCost: bigint;
  occurredAt: string;
  createdAt: string;
  deletedAt?: string | null;
}

export type LeftoverPolicy =
  | { kind: "split_by_contribution" }
  | { kind: "taker"; memberId: string };

export interface TripInput {
  baseCurrency: string;
  members: MemberInput[];
  expenses: ExpenseInput[];
  contributions: ContributionInput[];
  leftover: LeftoverPolicy;
}

export interface LeftoverShare {
  memberId: string;
  foreignMinor: bigint;
  costMinor: bigint;
}

export interface BalanceResult {
  memberOrder: string[];
  /** 멤버 id → 순잔액 (base minor, +는 받을 돈) */
  balances: Map<string, bigint>;
  /** 활성 지출 id → 원화 원가 (공금 지출은 재계산 값) */
  expenseCosts: Map<string, bigint>;
  wallet: WalletReplay;
  /** 통화 → 남은 공금을 누가 얼마 가져가는지 */
  leftoverShares: Map<string, LeftoverShare[]>;
}

export function memberOrderOf(members: readonly MemberInput[]): string[] {
  return [...members]
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((m) => m.id);
}

export function computeBalances(input: TripInput): BalanceResult {
  const order = memberOrderOf(input.members);
  const known = new Set(order);
  const need = (id: string) => {
    if (!known.has(id)) throw new UnknownMemberError(id);
  };
  const balances = new Map(order.map((id) => [id, 0n]));
  const bump = (id: string, delta: bigint) => balances.set(id, balances.get(id)! + delta);

  const expenses = input.expenses.filter((e) => e.deletedAt == null);
  const contributions = input.contributions.filter((c) => c.deletedAt == null);

  const events: WalletEvent[] = [
    ...contributions.map((c): WalletEvent => {
      need(c.memberId);
      return {
        kind: "contribution",
        id: c.id,
        memberId: c.memberId,
        occurredAt: c.occurredAt,
        createdAt: c.createdAt,
        amount: c.amount,
        baseCost: c.baseCost,
      };
    }),
    ...expenses
      .filter((e) => e.paidBy.kind === "wallet")
      .map(
        (e): WalletEvent => ({
          kind: "spend",
          id: e.id,
          occurredAt: e.occurredAt,
          createdAt: e.createdAt,
          amount: e.amount,
          overdraftRate: e.overdraftRate,
        }),
      ),
  ];
  const wallet = replayWallet(events, input.baseCurrency);

  const expenseCosts = new Map<string, bigint>();
  for (const e of expenses) {
    let cost: bigint;
    if (e.paidBy.kind === "wallet") {
      cost = wallet.spendCosts.get(e.id)!;
    } else {
      need(e.paidBy.memberId);
      if (e.baseCost == null) throw new InvalidAmountError(`원화 원가가 없습니다: ${e.id}`);
      cost = e.baseCost;
      bump(e.paidBy.memberId, cost);
    }
    expenseCosts.set(e.id, cost);
    const shares = splitCost({
      expenseId: e.id,
      splitType: e.splitType,
      participants: e.participants,
      foreignAmount: e.amount,
      baseCost: cost,
      memberOrder: order,
    });
    for (const [memberId, share] of shares) bump(memberId, -share);
  }

  for (const c of contributions) bump(c.memberId, c.baseCost);

  const leftoverShares = new Map<string, LeftoverShare[]>();
  const currencies = [...wallet.pools.keys()].sort();
  for (const currency of currencies) {
    const pool = wallet.pools.get(currency)!;
    if (pool.foreignMinor === 0n && pool.costMinor === 0n) continue;

    if (input.leftover.kind === "taker") {
      need(input.leftover.memberId);
      bump(input.leftover.memberId, -pool.costMinor);
      leftoverShares.set(currency, [
        { memberId: input.leftover.memberId, foreignMinor: pool.foreignMinor, costMinor: pool.costMinor },
      ]);
      continue;
    }

    const byMember = new Map<string, bigint>();
    for (const c of contributions) {
      if (c.amount.currency !== currency) continue;
      byMember.set(c.memberId, (byMember.get(c.memberId) ?? 0n) + c.baseCost);
    }
    let weights: Weighted[] = [...byMember].map(([memberId, weight]) => ({ memberId, weight }));
    if (weights.reduce((s, w) => s + w.weight, 0n) === 0n) {
      // 입금 기록 없이 공금을 쓴 경우: 전원 균등
      weights = order.map((memberId) => ({ memberId, weight: 1n }));
    }
    const seed = `leftover:${currency}`;
    const costs = allocate(pool.costMinor, weights, seed, order);
    const foreign = allocate(pool.foreignMinor, weights, seed, order);
    const shares: LeftoverShare[] = [];
    for (const memberId of order) {
      const costMinor = costs.get(memberId);
      if (costMinor === undefined) continue;
      bump(memberId, -costMinor);
      shares.push({ memberId, foreignMinor: foreign.get(memberId)!, costMinor });
    }
    leftoverShares.set(currency, shares);
  }

  const sum = [...balances.values()].reduce((s, v) => s + v, 0n);
  if (sum !== 0n) throw new SettlementInvariantError(`순잔액 합이 0이 아닙니다: ${sum}`);

  return { memberOrder: order, balances, expenseCosts, wallet, leftoverShares };
}
