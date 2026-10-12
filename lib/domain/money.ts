import { getCurrency } from "./currency";
import { CurrencyMismatchError, InvalidAmountError } from "./errors";
import { divRound, pow10 } from "./fixed";

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: string;
}

export function money(amountMinor: bigint, currency: string): Money {
  getCurrency(currency);
  return { amountMinor, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(`${a.currency} + ${b.currency}`);
  }
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

/** 사용자 입력 "1,234.5" → Money. 표시 자릿수보다 긴 소수는 거부 */
export function parseMajor(input: string, currency: string): Money {
  const meta = getCurrency(currency);
  const s = input.trim().replaceAll(",", "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new InvalidAmountError(`금액이 아닙니다: "${input}"`);
  const intPart = m[1] ?? "0";
  const frac = m[2] ?? "";
  if (frac.length > meta.displayDigits) {
    throw new InvalidAmountError(
      `${currency}는 소수점 ${meta.displayDigits}자리까지 입력할 수 있습니다: "${input}"`,
    );
  }
  const minor =
    BigInt(intPart) * pow10(meta.minorUnits) +
    BigInt(frac.padEnd(meta.minorUnits, "0") || "0");
  return { amountMinor: minor, currency };
}

/** Money → "1,234" / "12.50". 표시 자릿수로 반올림 */
export function formatMajor(m: Money): string {
  const meta = getCurrency(m.currency);
  const step = pow10(meta.minorUnits - meta.displayDigits);
  const shown = divRound(m.amountMinor, step);
  const neg = shown < 0n;
  const abs = neg ? -shown : shown;
  const unit = pow10(meta.displayDigits);
  const intStr = (abs / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fracStr =
    meta.displayDigits > 0 ? "." + (abs % unit).toString().padStart(meta.displayDigits, "0") : "";
  return (neg ? "-" : "") + intStr + fracStr;
}
