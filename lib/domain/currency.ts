import { UnknownCurrencyError } from "./errors";

export interface CurrencyMeta {
  /** ISO 4217 코드 */
  code: string;
  /** ISO 4217 minor unit — 저장·연산 자릿수 */
  minorUnits: number;
  /** 입력·표시 자릿수 (TWD는 저장 2, 표시 0) */
  displayDigits: number;
  /** 환율을 몇 단위당 원화로 입력·표시하는지 (JPY는 100엔당) */
  quoteUnit: 1 | 100;
}

const ROWS: ReadonlyArray<readonly [string, number, number, 1 | 100]> = [
  ["KRW", 0, 0, 1],
  ["JPY", 0, 0, 100],
  ["VND", 0, 0, 100],
  ["IDR", 2, 0, 100],
  ["TWD", 2, 0, 1],
  ["HUF", 2, 0, 1],
  ["USD", 2, 2, 1],
  ["EUR", 2, 2, 1],
  ["GBP", 2, 2, 1],
  ["CHF", 2, 2, 1],
  ["CZK", 2, 2, 1],
  ["THB", 2, 2, 1],
  ["CNY", 2, 2, 1],
  ["HKD", 2, 2, 1],
  ["SGD", 2, 2, 1],
  ["MYR", 2, 2, 1],
  ["PHP", 2, 2, 1],
  ["AUD", 2, 2, 1],
  ["NZD", 2, 2, 1],
  ["CAD", 2, 2, 1],
  ["KWD", 3, 3, 1],
  ["BHD", 3, 3, 1],
];

const TABLE: ReadonlyMap<string, CurrencyMeta> = new Map(
  ROWS.map(([code, minorUnits, displayDigits, quoteUnit]) => [
    code,
    { code, minorUnits, displayDigits, quoteUnit },
  ]),
);

export const SUPPORTED_CURRENCIES: readonly string[] = ROWS.map((r) => r[0]);

export function isSupportedCurrency(code: string): boolean {
  return TABLE.has(code);
}

export function getCurrency(code: string): CurrencyMeta {
  const meta = TABLE.get(code);
  if (!meta) throw new UnknownCurrencyError(`지원하지 않는 통화: ${code}`);
  return meta;
}
