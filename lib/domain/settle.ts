import { SettlementInvariantError } from "./errors";

export interface Transfer {
  from: string;
  to: string;
  /** base minor */
  amountMinor: bigint;
}

interface Party {
  id: string;
  amount: bigint;
  rank: number;
}

const byAmountDesc = (a: Party, b: Party) =>
  a.amount === b.amount ? a.rank - b.rank : a.amount > b.amount ? -1 : 1;

/** 가장 많이 받을 사람 ↔ 가장 많이 줄 사람을 반복 매칭 (그리디) */
export function settle(
  balances: ReadonlyMap<string, bigint>,
  memberOrder: readonly string[],
): Transfer[] {
  const sum = [...balances.values()].reduce((s, v) => s + v, 0n);
  if (sum !== 0n) throw new SettlementInvariantError(`순잔액 합이 0이 아닙니다: ${sum}`);

  const rank = (id: string) => {
    const i = memberOrder.indexOf(id);
    return i === -1 ? memberOrder.length : i;
  };
  const creditors: Party[] = [];
  const debtors: Party[] = [];
  for (const [id, v] of balances) {
    if (v > 0n) creditors.push({ id, amount: v, rank: rank(id) });
    if (v < 0n) debtors.push({ id, amount: -v, rank: rank(id) });
  }

  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmountDesc);
    debtors.sort(byAmountDesc);
    const c = creditors[0]!;
    const d = debtors[0]!;
    const x = c.amount < d.amount ? c.amount : d.amount;
    transfers.push({ from: d.id, to: c.id, amountMinor: x });
    c.amount -= x;
    d.amount -= x;
    if (c.amount === 0n) creditors.shift();
    if (d.amount === 0n) debtors.shift();
  }
  return transfers;
}

/** 송금을 모두 반영하면 모든 순잔액이 0이 되는지 검산 */
export function verifySettlement(
  balances: ReadonlyMap<string, bigint>,
  transfers: readonly Transfer[],
): boolean {
  const left = new Map(balances);
  for (const t of transfers) {
    if (t.amountMinor <= 0n || !left.has(t.from) || !left.has(t.to)) return false;
    left.set(t.from, left.get(t.from)! + t.amountMinor);
    left.set(t.to, left.get(t.to)! - t.amountMinor);
  }
  return [...left.values()].every((v) => v === 0n);
}
