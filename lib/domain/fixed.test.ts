import { describe, expect, it } from "vitest";
import { SUPPORTED_CURRENCIES, getCurrency, isSupportedCurrency } from "./currency";
import { InvalidRateError, UnknownCurrencyError } from "./errors";
import { RATE_SCALE, convertMinor, divRound, parseFeePercent, parseRate } from "./fixed";

describe("currency", () => {
  it("ISO minor unit과 표시 자릿수를 따로 둔다", () => {
    expect(getCurrency("KRW")).toEqual({ code: "KRW", minorUnits: 0, displayDigits: 0, quoteUnit: 1 });
    expect(getCurrency("TWD")).toMatchObject({ minorUnits: 2, displayDigits: 0 });
    expect(getCurrency("KWD")).toMatchObject({ minorUnits: 3, displayDigits: 3 });
    expect(getCurrency("JPY").quoteUnit).toBe(100);
  });

  it("모르는 통화는 거부한다", () => {
    expect(() => getCurrency("XYZ")).toThrow(UnknownCurrencyError);
    expect(isSupportedCurrency("jpy")).toBe(false);
    expect(SUPPORTED_CURRENCIES).toContain("CZK");
  });
});

describe("divRound (half away from zero)", () => {
  it.each([
    [5n, 2n, 3n],
    [-5n, 2n, -3n],
    [4n, 3n, 1n],
    [-4n, 3n, -1n],
    [7n, -2n, -4n],
    [6n, 3n, 2n],
  ])("%s / %s = %s", (n, d, q) => {
    expect(divRound(n, d)).toBe(q);
  });

  it("0으로 나누면 RangeError", () => {
    expect(() => divRound(1n, 0n)).toThrow(RangeError);
  });
});

describe("parseRate", () => {
  it("1 단위당 환율을 10^10 배 정수로", () => {
    expect(parseRate("43.5", 1)).toBe(435_000_000_000n);
    expect(parseRate("1,500", 1)).toBe(1500n * RATE_SCALE);
  });

  it("호가 단위는 생략할 수 없다 — 엔화를 1엔당으로 잘못 넣는 실수 방지 (최종 리뷰 #5)", () => {
    // 실행하지 않고 타입만 검사한다 (tsc가 이 줄의 오류를 기대함)
    // @ts-expect-error quoteUnit 필수
    const call = () => parseRate("905");
    expect(typeof call).toBe("function");
  });

  it("JPY처럼 100 단위 호가는 1 단위로 바꾼다", () => {
    expect(parseRate("905", 100)).toBe(90_500_000_000n);
  });

  it.each(["0", "-1", "abc", "", "1.12345678901"])("잘못된 값 %j 은 거부", (s) => {
    expect(() => parseRate(s, 1)).toThrow(InvalidRateError);
  });
});

describe("parseFeePercent", () => {
  it("퍼센트를 FEE_SCALE(10^6) 비율로", () => {
    expect(parseFeePercent("1.5")).toBe(15_000n);
    expect(parseFeePercent("0")).toBe(0n);
  });
  it("100% 이상은 거부", () => {
    expect(() => parseFeePercent("100")).toThrow(InvalidRateError);
  });
});

describe("convertMinor", () => {
  it("10,000엔 × 9.05 × 1.015 = 91,857.5 → 91,858원 (한 번만 반올림)", () => {
    expect(convertMinor(10_000n, 0, 0, parseRate("905", 100), 15_000n)).toBe(91_858n);
  });

  it("자릿수가 다른 통화: 120.50 EUR × 1500 = 180,750원", () => {
    expect(convertMinor(12_050n, 2, 0, parseRate("1500", 1))).toBe(180_750n);
  });

  it("TWD는 minor 2자리: 4,500 TWD(450000) × 43 = 193,500원", () => {
    expect(convertMinor(450_000n, 2, 0, parseRate("43", 1))).toBe(193_500n);
  });
});
