import { InvalidRateError } from "./errors";

/** 환율 고정소수 배율: 외화 1 단위당 원화(major)를 10^10 배한 정수 */
export const RATE_SCALE = 10_000_000_000n;
/** 수수료율 고정소수 배율: 비율을 10^6 배한 정수 (1.5% = 15000n) */
export const FEE_SCALE = 1_000_000n;

/** 외화 1 단위당 원화(major) × RATE_SCALE */
export type Rate = bigint;

export function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** num / den 을 0.5는 0에서 먼 쪽으로 반올림 (half away from zero) */
export function divRound(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError("division by zero");
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const q = num / den;
  const r = num % den;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice >= den) return num < 0n ? q - 1n : q + 1n;
  return q;
}

function parseDecimal(input: string, scaleDigits: number): bigint {
  const s = input.trim().replaceAll(",", "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new InvalidRateError(`숫자가 아닙니다: "${input}"`);
  const intPart = m[1] ?? "0";
  const frac = m[2] ?? "";
  if (frac.length > scaleDigits) {
    throw new InvalidRateError(`소수점 ${scaleDigits}자리까지만: "${input}"`);
  }
  return BigInt(intPart) * pow10(scaleDigits) + BigInt(frac.padEnd(scaleDigits, "0") || "0");
}

/** "905.12" (quoteUnit 단위당 원화) → 1 단위당 Rate */
export function parseRate(input: string, quoteUnit: 1 | 100 = 1): Rate {
  const v = parseDecimal(input, 10);
  if (v <= 0n) throw new InvalidRateError(`환율은 0보다 커야 합니다: "${input}"`);
  return quoteUnit === 1 ? v : divRound(v, BigInt(quoteUnit));
}

/** 퍼센트 문자열 "1.5" → 15000n (FEE_SCALE 기준). 0 이상 100 미만 */
export function parseFeePercent(input: string): bigint {
  const v = parseDecimal(input, 4);
  if (v >= 1_000_000n) throw new InvalidRateError(`수수료율은 100% 미만: "${input}"`);
  return v;
}

/** amountMinor(from) → to 통화 minor. 수수료 포함, 마지막에 한 번만 반올림 */
export function convertMinor(
  amountMinor: bigint,
  fromMinorUnits: number,
  toMinorUnits: number,
  rate: Rate,
  feeRate: bigint = 0n,
): bigint {
  const num = amountMinor * rate * (FEE_SCALE + feeRate) * pow10(toMinorUnits);
  const den = RATE_SCALE * FEE_SCALE * pow10(fromMinorUnits);
  return divRound(num, den);
}
