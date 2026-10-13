import { getCurrency } from "./currency";
import { InvalidAmountError, MissingRateError } from "./errors";
import { RATE_SCALE, convertMinor, type Rate } from "./fixed";
import type { Money } from "./money";

/** 'base'는 지출 통화 = 정산 통화라 환산이 필요 없는 경우 */
export type RateSource = "user" | "funding_source" | "api" | "base";

export interface FundingSourceRate {
  currency: string;
  /** 실제 환전·충전 환율. 신용카드처럼 없으면 null */
  rate: Rate | null;
  feeRate: bigint;
}

export interface CostInput {
  amount: Money;
  baseCurrency: string;
  userRate?: Rate | null;
  fundingSource?: FundingSourceRate | null;
  /** 지출 날짜 이하 가장 최근 API 환율 */
  apiRate?: Rate | null;
}

export interface ResolvedCost {
  base: Money;
  rate: Rate;
  feeRate: bigint;
  source: RateSource;
}

/**
 * 공금 외 지출(또는 공금 입금) 1건의 원화 원가를 확정한다.
 * 우선순위: 사용자 입력 환율 → 결제수단 환율(+수수료) → API 환율(+결제수단 수수료)
 */
export function resolveCost(input: CostInput): ResolvedCost {
  const { amount, baseCurrency } = input;
  if (amount.amountMinor <= 0n) {
    throw new InvalidAmountError("금액은 0보다 커야 합니다");
  }
  const from = getCurrency(amount.currency);
  const to = getCurrency(baseCurrency);

  if (amount.currency === baseCurrency) {
    return { base: amount, rate: RATE_SCALE, feeRate: 0n, source: "base" };
  }

  const make = (rate: Rate, feeRate: bigint, source: RateSource): ResolvedCost => ({
    base: {
      amountMinor: convertMinor(amount.amountMinor, from.minorUnits, to.minorUnits, rate, feeRate),
      currency: baseCurrency,
    },
    rate,
    feeRate,
    source,
  });

  if (input.userRate != null) return make(input.userRate, 0n, "user");

  const fs = input.fundingSource ?? null;
  if (fs && fs.rate != null && fs.currency === amount.currency) {
    return make(fs.rate, fs.feeRate, "funding_source");
  }
  if (input.apiRate != null) return make(input.apiRate, fs?.feeRate ?? 0n, "api");

  throw new MissingRateError(`${amount.currency} 환율이 없습니다`);
}
