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

export interface WalletReplay {
  /** 통화별 최종 잔액과 남은 원가 */
  pools: Map<string, Pool>;
  /** 공금 지출 id → 원화 원가 */
  spendCosts: Map<string, bigint>;
  /** 잔액보다 많이 쓴 지출 id (시간순) */
  overdrawn: string[];
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

/** 공금 이벤트를 시간순으로 처음부터 적용한다 (통화별 원가 풀 = 이동평균과 동치) */
export function replayWallet(events: readonly WalletEvent[], baseCurrency: string): WalletReplay {
  const base = getCurrency(baseCurrency);
  const pools = new Map<string, Pool>();
  const spendCosts = new Map<string, bigint>();
  const overdrawn: string[] = [];

  for (const ev of [...events].sort(compareEvents)) {
    if (ev.amount.amountMinor <= 0n) {
      throw new InvalidAmountError(`금액은 0보다 커야 합니다: ${ev.id}`);
    }
    const pool = pools.get(ev.amount.currency) ?? { foreignMinor: 0n, costMinor: 0n };
    pools.set(ev.amount.currency, pool);

    if (ev.kind === "contribution") {
      if (ev.baseCost < 0n) throw new InvalidAmountError(`입금 원가는 음수일 수 없습니다: ${ev.id}`);
      pool.foreignMinor += ev.amount.amountMinor;
      pool.costMinor += ev.baseCost;
      continue;
    }

    const s = ev.amount.amountMinor;
    let cost: bigint;
    if (pool.foreignMinor >= s) {
      cost = divRound(pool.costMinor * s, pool.foreignMinor);
    } else {
      const covered = pool.foreignMinor > 0n ? pool.foreignMinor : 0n;
      const coveredCost = covered > 0n ? pool.costMinor : 0n;
      if (ev.overdraftRate == null) {
        throw new MissingRateError(`공금 잔액 부족분을 평가할 환율이 없습니다: ${ev.id}`);
      }
      const from = getCurrency(ev.amount.currency);
      cost =
        coveredCost + convertMinor(s - covered, from.minorUnits, base.minorUnits, ev.overdraftRate);
      overdrawn.push(ev.id);
    }
    pool.foreignMinor -= s;
    pool.costMinor -= cost;
    spendCosts.set(ev.id, cost);
  }

  return { pools, spendCosts, overdrawn };
}
