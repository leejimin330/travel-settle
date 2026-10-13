import { getCurrency } from "./currency";
import { InvalidAmountError, MissingRateError } from "./errors";
import { convertMinor, divRound, type Rate } from "./fixed";
import type { Money } from "./money";

export interface WalletContribution {
  kind: "contribution";
  id: string;
  memberId: string;
  occurredAt: string;
  createdAt: string;
  amount: Money;
  /** 입금 원가 스냅샷 (base minor) */
  baseCost: bigint;
}

export interface WalletSpend {
  kind: "spend";
  id: string;
  occurredAt: string;
  createdAt: string;
  amount: Money;
  /** 잔액 부족분을 평가할 지출 날짜 API 환율. 부족이 없으면 쓰이지 않는다 */
  overdraftRate: Rate | null;
}

export type WalletEvent = WalletContribution | WalletSpend;

export interface Pool {
  foreignMinor: bigint;
  costMinor: bigint;
}

/** 잔액보다 많이 쓴 지출 중 아직 입금으로 메워지지 않은 부분 (API 환율로 임시 평가) */
export interface Deficit {
  spendId: string;
  currency: string;
  foreignMinor: bigint;
  costMinor: bigint;
}

export interface WalletReplay {
  /** 통화별 최종 잔액과 남은 원가 (항상 0 이상) */
  pools: Map<string, Pool>;
  /** 공금 지출 id → 원화 원가 */
  spendCosts: Map<string, bigint>;
  /** 잔액보다 많이 쓴 적이 있는 지출 id (시간순) */
  overdrawn: string[];
  /** 끝까지 메워지지 않은 부족분 (시간순) */
  deficits: Deficit[];
}

export function compareEvents(
  a: { occurredAt: string; createdAt: string; id: string },
  b: { occurredAt: string; createdAt: string; id: string },
): number {
  const byOccurred = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
  if (byOccurred !== 0) return byOccurred;
  const byCreated = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (byCreated !== 0) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 공금 이벤트를 시간순으로 처음부터 적용한다 (통화별 원가 풀 = 이동평균과 동치).
 * 잔액보다 많이 쓰면 초과분은 부족분(deficit)으로 따로 두고 API 환율로 임시 평가한다.
 * 이후 입금은 부족분부터 메우고, 메운 몫은 그 입금의 실제 원가로 해당 지출 원가를 다시 정한다.
 */
export function replayWallet(events: readonly WalletEvent[], baseCurrency: string): WalletReplay {
  const base = getCurrency(baseCurrency);
  const pools = new Map<string, Pool>();
  const spendCosts = new Map<string, bigint>();
  const overdrawn: string[] = [];
  const deficits: Deficit[] = [];

  for (const ev of [...events].sort(compareEvents)) {
    if (ev.amount.amountMinor <= 0n) {
      throw new InvalidAmountError(`금액은 0보다 커야 합니다: ${ev.id}`);
    }
    const currency = ev.amount.currency;
    const pool = pools.get(currency) ?? { foreignMinor: 0n, costMinor: 0n };
    pools.set(currency, pool);

    if (ev.kind === "contribution") {
      if (ev.baseCost < 0n) throw new InvalidAmountError(`입금 원가는 음수일 수 없습니다: ${ev.id}`);
      let foreignLeft = ev.amount.amountMinor;
      let costLeft = ev.baseCost;
      for (const d of deficits) {
        if (foreignLeft === 0n) break;
        if (d.currency !== currency || d.foreignMinor === 0n) continue;
        const filled = foreignLeft < d.foreignMinor ? foreignLeft : d.foreignMinor;
        const actual = divRound(costLeft * filled, foreignLeft);
        const provisional = divRound(d.costMinor * filled, d.foreignMinor);
        spendCosts.set(d.spendId, spendCosts.get(d.spendId)! - provisional + actual);
        d.foreignMinor -= filled;
        d.costMinor -= provisional;
        foreignLeft -= filled;
        costLeft -= actual;
      }
      pool.foreignMinor += foreignLeft;
      pool.costMinor += costLeft;
      continue;
    }

    const s = ev.amount.amountMinor;
    if (pool.foreignMinor >= s) {
      const cost = divRound(pool.costMinor * s, pool.foreignMinor);
      pool.foreignMinor -= s;
      pool.costMinor -= cost;
      spendCosts.set(ev.id, cost);
      continue;
    }

    const excess = s - pool.foreignMinor;
    let excessCost: bigint;
    if (currency === baseCurrency) {
      excessCost = excess;
    } else {
      if (ev.overdraftRate == null) {
        throw new MissingRateError(`공금 잔액 부족분을 평가할 환율이 없습니다: ${ev.id}`);
      }
      const from = getCurrency(currency);
      excessCost = convertMinor(excess, from.minorUnits, base.minorUnits, ev.overdraftRate);
    }
    spendCosts.set(ev.id, pool.costMinor + excessCost);
    pool.foreignMinor = 0n;
    pool.costMinor = 0n;
    deficits.push({ spendId: ev.id, currency, foreignMinor: excess, costMinor: excessCost });
    overdrawn.push(ev.id);
  }

  return { pools, spendCosts, overdrawn, deficits: deficits.filter((d) => d.foreignMinor > 0n) };
}
