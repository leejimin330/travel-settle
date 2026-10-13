import type { BalanceResult, ExpenseInput } from "./balance";
import { getCurrency } from "./currency";
import { InvalidRateError } from "./errors";
import { RATE_SCALE, divRound, pow10, type Rate } from "./fixed";
import type { Money } from "./money";
import type { Transfer } from "./settle";

/** 원가 합 ÷ 외화 합 → Rate. 외화 합이나 결과 환율이 0 이하이면 null */
export function averageRate(
  costMinor: bigint,
  foreignMinor: bigint,
  foreignCurrency: string,
  baseCurrency: string,
): Rate | null {
  if (foreignMinor <= 0n) return null;
  const f = getCurrency(foreignCurrency);
  const b = getCurrency(baseCurrency);
  const rate = divRound(costMinor * RATE_SCALE * pow10(f.minorUnits), foreignMinor * pow10(b.minorUnits));
  return rate > 0n ? rate : null;
}

/**
 * 여행 평균 적용 환율: 주 통화 지출(공금 포함)의 원가 합 ÷ 외화 합.
 * 주 통화 지출이 없으면 공금 평균 원가, 그것도 없으면 null.
 */
export function tripAverageRate(
  result: BalanceResult,
  expenses: readonly ExpenseInput[],
  primaryCurrency: string,
  baseCurrency: string,
): Rate | null {
  if (primaryCurrency === baseCurrency) return null;
  let cost = 0n;
  let foreign = 0n;
  for (const e of expenses) {
    if (e.deletedAt != null || e.amount.currency !== primaryCurrency) continue;
    const c = result.expenseCosts.get(e.id);
    if (c === undefined) continue;
    cost += c;
    foreign += e.amount.amountMinor;
  }
  const fromExpenses = averageRate(cost, foreign, primaryCurrency, baseCurrency);
  if (fromExpenses !== null) return fromExpenses;
  const pool = result.wallet.pools.get(primaryCurrency);
  return pool ? averageRate(pool.costMinor, pool.foreignMinor, primaryCurrency, baseCurrency) : null;
}

/** 원화 금액 → 외화 (표시 자릿수로 반올림) */
export function baseToForeign(
  baseMinor: bigint,
  baseCurrency: string,
  rate: Rate,
  foreignCurrency: string,
): Money {
  if (rate <= 0n) throw new InvalidRateError(`환율은 0보다 커야 합니다: ${rate}`);
  const f = getCurrency(foreignCurrency);
  const b = getCurrency(baseCurrency);
  const step = pow10(f.minorUnits - f.displayDigits);
  const raw = baseMinor * RATE_SCALE * pow10(f.minorUnits);
  const den = rate * pow10(b.minorUnits);
  return { amountMinor: divRound(raw, den * step) * step, currency: foreignCurrency };
}

export interface TransferView {
  from: string;
  to: string;
  base: Money;
  atAverage: Money | null;
  atToday: Money | null;
}

export function describeTransfers(
  transfers: readonly Transfer[],
  baseCurrency: string,
  primaryCurrency: string,
  avgRate: Rate | null,
  todayRate: Rate | null,
): TransferView[] {
  const foreignOk = primaryCurrency !== baseCurrency;
  return transfers.map((t) => ({
    from: t.from,
    to: t.to,
    base: { amountMinor: t.amountMinor, currency: baseCurrency },
    atAverage:
      foreignOk && avgRate !== null
        ? baseToForeign(t.amountMinor, baseCurrency, avgRate, primaryCurrency)
        : null,
    atToday:
      foreignOk && todayRate !== null
        ? baseToForeign(t.amountMinor, baseCurrency, todayRate, primaryCurrency)
        : null,
  }));
}
