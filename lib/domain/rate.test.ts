import { describe, expect, it } from "vitest";
import { InvalidAmountError, MissingRateError } from "./errors";
import { parseFeePercent, parseRate } from "./fixed";
import { money } from "./money";
import { resolveCost } from "./rate";

const yen = (n: bigint) => money(n, "JPY");
const api = parseRate("905", 100);

describe("resolveCost 우선순위", () => {
  it("1) 사용자 입력 환율이 가장 먼저, 수수료는 붙이지 않는다", () => {
    const r = resolveCost({
      amount: yen(10_000n),
      baseCurrency: "KRW",
      userRate: parseRate("880", 100),
      fundingSource: { currency: "JPY", rate: parseRate("900", 100), feeRate: parseFeePercent("1.5") },
      apiRate: api,
    });
    expect(r).toMatchObject({ base: money(88_000n, "KRW"), source: "user", feeRate: 0n });
  });

  it("2) 결제수단 환율 + 수수료", () => {
    const r = resolveCost({
      amount: yen(10_000n),
      baseCurrency: "KRW",
      fundingSource: { currency: "JPY", rate: parseRate("900", 100), feeRate: parseFeePercent("1") },
      apiRate: api,
    });
    expect(r).toMatchObject({ base: money(90_900n, "KRW"), source: "funding_source" });
  });

  it("3) 결제수단에 환율이 없으면(신용카드) API 환율 + 결제수단 수수료", () => {
    const r = resolveCost({
      amount: yen(10_000n),
      baseCurrency: "KRW",
      fundingSource: { currency: "JPY", rate: null, feeRate: parseFeePercent("1.5") },
      apiRate: api,
    });
    expect(r).toMatchObject({ base: money(91_858n, "KRW"), source: "api", feeRate: 15_000n });
  });

  it("결제수단 통화가 지출 통화와 다르면 그 환율은 쓰지 않고 수수료만 적용", () => {
    const r = resolveCost({
      amount: yen(10_000n),
      baseCurrency: "KRW",
      fundingSource: { currency: "USD", rate: parseRate("1400"), feeRate: parseFeePercent("1.5") },
      apiRate: api,
    });
    expect(r).toMatchObject({ base: money(91_858n, "KRW"), source: "api" });
  });

  it("정산 통화와 같은 통화는 환산하지 않는다", () => {
    const r = resolveCost({ amount: money(50_000n, "KRW"), baseCurrency: "KRW" });
    expect(r).toMatchObject({ base: money(50_000n, "KRW"), source: "base", feeRate: 0n });
  });

  it("쓸 수 있는 환율이 없으면 MissingRateError", () => {
    expect(() => resolveCost({ amount: yen(1n), baseCurrency: "KRW" })).toThrow(MissingRateError);
  });

  it.each([0n, -100n])("금액 %s 은 거부", (n) => {
    expect(() => resolveCost({ amount: yen(n), baseCurrency: "KRW", apiRate: api })).toThrow(
      InvalidAmountError,
    );
  });

  it("결제수단별 환율 차이: 같은 10,000엔도 현금(900)과 카드(905+1.5%)의 원가가 다르다", () => {
    const cash = resolveCost({
      amount: yen(10_000n),
      baseCurrency: "KRW",
      fundingSource: { currency: "JPY", rate: parseRate("900", 100), feeRate: 0n },
    });
    const card = resolveCost({
      amount: yen(10_000n),
      baseCurrency: "KRW",
      fundingSource: { currency: "JPY", rate: null, feeRate: parseFeePercent("1.5") },
      apiRate: api,
    });
    expect(cash.base.amountMinor).toBe(90_000n);
    expect(card.base.amountMinor).toBe(91_858n);
  });
});
