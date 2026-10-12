import { describe, expect, it } from "vitest";
import { CurrencyMismatchError, InvalidAmountError, UnknownCurrencyError } from "./errors";
import { addMoney, formatMajor, money, parseMajor } from "./money";

describe("parseMajor", () => {
  it("표시 자릿수 기준으로 입력받아 ISO minor로 저장", () => {
    expect(parseMajor("1,234", "KRW")).toEqual({ amountMinor: 1234n, currency: "KRW" });
    expect(parseMajor("12.5", "USD")).toEqual({ amountMinor: 1250n, currency: "USD" });
    expect(parseMajor("100", "TWD")).toEqual({ amountMinor: 10000n, currency: "TWD" });
    expect(parseMajor("1.234", "KWD")).toEqual({ amountMinor: 1234n, currency: "KWD" });
  });

  it("표시 자릿수보다 긴 소수는 거부 (TWD는 정수만)", () => {
    expect(() => parseMajor("100.5", "TWD")).toThrow(InvalidAmountError);
    expect(() => parseMajor("1.005", "USD")).toThrow(InvalidAmountError);
    expect(() => parseMajor("10.5", "JPY")).toThrow(InvalidAmountError);
  });

  it.each(["", "abc", "-5", "1e3", "1.2.3"])("숫자가 아닌 %j 은 거부", (s) => {
    expect(() => parseMajor(s, "KRW")).toThrow(InvalidAmountError);
  });
});

describe("formatMajor", () => {
  it.each([
    [money(1234567n, "KRW"), "1,234,567"],
    [money(1250n, "USD"), "12.50"],
    [money(10050n, "TWD"), "101"],
    [money(-250000n, "KRW"), "-250,000"],
    [money(1234n, "KWD"), "1.234"],
  ])("%o → %s", (m, s) => {
    expect(formatMajor(m)).toBe(s);
  });
});

describe("money / addMoney", () => {
  it("모르는 통화는 거부", () => {
    expect(() => money(1n, "ABC")).toThrow(UnknownCurrencyError);
  });
  it("통화가 다르면 더할 수 없다", () => {
    expect(() => addMoney(money(1n, "KRW"), money(1n, "JPY"))).toThrow(CurrencyMismatchError);
    expect(addMoney(money(1n, "KRW"), money(2n, "KRW"))).toEqual(money(3n, "KRW"));
  });
});
