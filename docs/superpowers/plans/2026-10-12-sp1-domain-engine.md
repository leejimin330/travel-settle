# SP1 도메인 엔진 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 트래블 정산의 금액·환율·공금·분배·정산 계산을 UI와 DB 없이 순수 함수 모듈 `lib/domain`으로 만들고, 원본 명세의 시나리오 3개와 속성 테스트로 "손해 보는 사람이 없는 정산"을 고정한다.

**Architecture:** Next.js 16 저장소 골격 위에 `lib/domain/*`만 구현한다. 모든 금액은 `bigint` 최소 단위 정수, 환율은 10^10 배 고정소수 `bigint`이다. 공금은 통화별 원가 풀을 시간순으로 재생해 계산한다. 공금 외 지출의 원가는 호출자가 `resolveCost`로 미리 확정한 스냅샷을 받는다. `computeBalances → settle → describeTransfers` 순으로 흐른다.

**Tech Stack:** Node 24, Next.js 16.4.0 (create-next-app), TypeScript 5 strict, Vitest 5.0.3, fast-check 4.10.2, ESLint 9 (eslint-config-next)

**Spec:** `docs/superpowers/specs/2026-10-12-travel-settle-design.md` (특히 §4 도메인 엔진). 원본 명세는 `docs/original-spec.md`이다.

## Global Constraints

- TypeScript `strict: true` + `noUncheckedIndexedAccess: true`, `target: "ES2022"` (bigint 리터럴 `10n`은 ES2020 미만에서 컴파일 오류)
- `lib/domain`에서는 float를 쓰지 않는다: `parseFloat`·`parseInt`·`Number()`·`Math.round/floor/ceil/trunc`·`toFixed`·소수 리터럴은 ESLint 오류 (Task 1에서 설정)
- 모든 금액은 `Money = { amountMinor: bigint, currency: string }`. 통화는 ISO 4217 대문자 코드
- 반올림은 half away from zero, 변환 1건당 마지막에 한 번만 (`divRound`)
- 환율 `Rate` = 외화 **1 단위**당 원화(major) × 10^10 (`RATE_SCALE`). 수수료율 = 비율 × 10^6 (`FEE_SCALE`, 1.5% = `15000n`)
- 정산 통화(baseCurrency)는 MVP에서 항상 `"KRW"`이지만, 함수는 인자로 받는다
- `lib/domain`은 React·Next·Supabase·네트워크를 import하지 않는다. 모듈끼리는 상대 경로로 import한다
- 커밋 메시지 형식은 `feat(domain): …` / `chore: …` / `docs: …`이고, 끝에 빈 줄과 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`을 붙인다
- 테스트 이름·주석은 한국어로 쓴다 (저장소 문서와 맞춤)

## Review Focus

테스트로 직접 덮기 전에 사람이 가장 먼저 걸려 넘어질 입력들이다. 각 줄의 테스트가 해당 Task에 들어 있다.

1. **엔화 환율을 100엔당으로 입력** ("905" = 100엔당 905원): 1엔당 905원으로 계산하면 정산이 100배 틀린다 → Task 1 `parseRate("905", 100)` 테스트
2. **TWD에 소수 입력** ("100.5"): 저장은 2자리지만 표시는 0자리이므로 거부한다. "100"은 `10000n`으로 저장한다 → Task 2 `parseMajor` 테스트
3. **결제수단 통화와 지출 통화가 다름** (USD 카드로 엔화 결제): 결제수단의 USD 환율을 엔화에 적용하면 안 된다. 수수료만 적용한다 → Task 3 테스트
4. **삭제(soft delete)된 지출·입금**: 정산에 섞이면 안 된다 → Task 6 테스트
5. **입금보다 공금 지출이 먼저이거나 잔액 부족**: 초과분은 API 환율로 평가하고 경고 목록에 남긴다. 합계는 여전히 0이다 → Task 5·6 테스트

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `lib/domain/errors.ts` | 도메인 오류 클래스 |
| `lib/domain/currency.ts` | 통화 메타데이터 (ISO minor unit, 표시 자릿수, 환율 호가 단위) |
| `lib/domain/fixed.ts` | `RATE_SCALE`·`FEE_SCALE`, `divRound`, `parseRate`, `parseFeePercent`, `convertMinor` |
| `lib/domain/money.ts` | `Money`, `parseMajor`, `formatMajor` |
| `lib/domain/rate.ts` | 지출 1건의 원화 원가 확정 (`resolveCost`) |
| `lib/domain/hash.ts` | FNV-1a 32bit (나머지 배분 시작점) |
| `lib/domain/split.ts` | `allocate`, 분배 4종 (`splitCost`) |
| `lib/domain/wallet.ts` | 공금 원가 풀 시간순 재생 (`replayWallet`) |
| `lib/domain/balance.ts` | 멤버별 순잔액, 남은 공금 처리 (`computeBalances`) |
| `lib/domain/settle.ts` | 그리디 송금 목록, 검산 |
| `lib/domain/display.ts` | 여행 평균 환율, 원화→외화 표시 |
| `lib/domain/index.ts` | 공개 API 재수출 |
| `lib/domain/scenarios/fixtures.ts` | 원본 명세 §12 시나리오 3개 |
| `lib/domain/*.test.ts`, `lib/domain/scenarios/scenarios.test.ts`, `lib/domain/properties.test.ts` | 테스트 |
| `docs/scenarios.md` | 시나리오 손 검산 기록 |
| `vitest.config.ts`, `eslint.config.mjs`, `tsconfig.json`, `package.json` | 도구 설정 |

---

### Task 1: 저장소 골격 + 통화·고정소수 연산

**Files:**
- Create: Next.js 골격 전체 (`create-next-app`), `vitest.config.ts`
- Modify: `tsconfig.json`, `package.json`(scripts), `eslint.config.mjs`
- Create: `lib/domain/errors.ts`, `lib/domain/currency.ts`, `lib/domain/fixed.ts`
- Test: `lib/domain/fixed.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `errors.ts`: `DomainError`, `UnknownCurrencyError`, `CurrencyMismatchError`, `InvalidAmountError`, `InvalidRateError`, `MissingRateError`, `SplitValidationError`, `UnknownMemberError`, `SettlementInvariantError`
  - `currency.ts`: `interface CurrencyMeta { code: string; minorUnits: number; displayDigits: number; quoteUnit: 1 | 100 }`, `getCurrency(code: string): CurrencyMeta`, `isSupportedCurrency(code: string): boolean`, `SUPPORTED_CURRENCIES: readonly string[]`
  - `fixed.ts`: `RATE_SCALE = 10_000_000_000n`, `FEE_SCALE = 1_000_000n`, `type Rate = bigint`, `pow10(n: number): bigint`, `divRound(num: bigint, den: bigint): bigint`, `parseRate(input: string, quoteUnit?: 1 | 100): Rate`, `parseFeePercent(input: string): bigint`, `convertMinor(amountMinor: bigint, fromMinorUnits: number, toMinorUnits: number, rate: Rate, feeRate?: bigint): bigint`

- [ ] **Step 1: Next.js 골격 생성**

저장소 루트(`~/travel-settle`, 이미 `docs/`와 `.git`이 있음)에서 실행한다:

```bash
npx -y create-next-app@16.4.0 . --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --disable-git --yes
```

Expected: `Success! Created travel-settle` 메시지. `docs/`는 그대로 남고 `app/`, `AGENTS.md`, `eslint.config.mjs`, `tsconfig.json`이 생긴다.

- [ ] **Step 2: 테스트 도구 설치**

```bash
npm i -D vitest@5.0.3 fast-check@4.10.2 @types/node@24
```

Expected: 오류 없이 설치된다. (`@types/node@24`가 없으면 vitest 5의 peer 의존성(`^22 || >=24`)과 create-next-app 기본 `@types/node@^20`이 충돌해 ERESOLVE가 난다.)

- [ ] **Step 3: tsconfig 수정**

`tsconfig.json`의 `compilerOptions`에서 `"target": "ES2017"`을 `"target": "ES2022"`로 바꾸고, `"strict": true,` 바로 아래에 `"noUncheckedIndexedAccess": true,`를 추가한다. 결과:

```json
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
```

- [ ] **Step 4: package.json scripts 추가**

`"scripts"`에 세 줄을 추가한다:

```json
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
```

- [ ] **Step 5: vitest 설정 생성**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 6: ESLint에 float 금지 규칙 추가**

`eslint.config.mjs`를 아래 내용으로 바꾼다. 생성된 파일에 `{ files: ["lib/domain/**/*.ts"], … }` 블록 하나만 추가한 것이다. 정규식의 `\\.`는 백슬래시 두 개 그대로 둔다:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // 금액·환율은 bigint 정수로만 다룬다 (설계 문서 §4, 원본 명세 §5)
    files: ["lib/domain/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "parseFloat", message: "금액·환율은 bigint로만 다룹니다." },
        { name: "parseInt", message: "BigInt()를 쓰세요." },
        { name: "Number", message: "금액·환율은 bigint로만 다룹니다." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "round", message: "divRound()를 쓰세요." },
        { object: "Math", property: "floor", message: "bigint 나눗셈을 쓰세요." },
        { object: "Math", property: "ceil", message: "bigint 나눗셈을 쓰세요." },
        { object: "Math", property: "trunc", message: "bigint 나눗셈을 쓰세요." },
        { object: "Number", property: "parseFloat", message: "금액·환율은 bigint로만 다룹니다." },
        { property: "toFixed", message: "formatMajor()를 쓰세요." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[raw=/^[0-9_]*\\.[0-9_]+/]", message: "소수 리터럴 금지 — bigint를 쓰세요." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
```

- [ ] **Step 7: 실패하는 테스트 작성**

`lib/domain/fixed.test.ts`:

```ts
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
    expect(parseRate("43.5")).toBe(435_000_000_000n);
    expect(parseRate("1,500")).toBe(1500n * RATE_SCALE);
  });

  it("JPY처럼 100 단위 호가는 1 단위로 바꾼다", () => {
    expect(parseRate("905", 100)).toBe(90_500_000_000n);
  });

  it.each(["0", "-1", "abc", "", "1.12345678901"])("잘못된 값 %j 은 거부", (s) => {
    expect(() => parseRate(s)).toThrow(InvalidRateError);
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
    expect(convertMinor(12_050n, 2, 0, parseRate("1500"))).toBe(180_750n);
  });

  it("TWD는 minor 2자리: 4,500 TWD(450000) × 43 = 193,500원", () => {
    expect(convertMinor(450_000n, 2, 0, parseRate("43"))).toBe(193_500n);
  });
});
```

- [ ] **Step 8: 테스트가 실패하는지 확인**

Run: `npm test -- lib/domain/fixed.test.ts`
Expected: FAIL — `./currency`, `./errors`, `./fixed` 모듈을 찾을 수 없다는 오류

- [ ] **Step 9: 구현**

`lib/domain/errors.ts`:

```ts
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnknownCurrencyError extends DomainError {}
export class CurrencyMismatchError extends DomainError {}
export class InvalidAmountError extends DomainError {}
export class InvalidRateError extends DomainError {}
export class MissingRateError extends DomainError {}
export class SplitValidationError extends DomainError {}
export class UnknownMemberError extends DomainError {}
export class SettlementInvariantError extends DomainError {}
```

`lib/domain/currency.ts`:

```ts
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
```

`lib/domain/fixed.ts`:

```ts
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
```

- [ ] **Step 10: 테스트·타입·린트 통과 확인**

Run: `npm test -- lib/domain/fixed.test.ts && npm run typecheck && npm run lint`
Expected: fixed.test.ts 전부 PASS, tsc 출력 없음, eslint 출력 없음

린트 규칙이 실제로 동작하는지 한 번 확인하고 지운다:

```bash
printf 'export const bad = Math.round(1.5) + parseFloat("2") + 10n;\n' > lib/domain/zz-bad.ts
npx eslint lib/domain/zz-bad.ts   # Expected: 3 errors (Math.round, 소수 리터럴, parseFloat). 10n은 통과
rm lib/domain/zz-bad.ts
```

- [ ] **Step 11: 커밋**

`AGENTS.md`는 `next dev`가 다시 만드는 파일이라 함께 커밋한다.

```bash
git add -A
git commit -m "chore: Next.js 16 골격, Vitest·fast-check, 도메인 float 금지 린트

feat(domain): 통화 메타데이터와 고정소수 환율 연산

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Money — 입력 파싱과 표시

**Files:**
- Create: `lib/domain/money.ts`
- Test: `lib/domain/money.test.ts`

**Interfaces:**
- Consumes: `getCurrency` (currency.ts), `divRound`, `pow10` (fixed.ts), `CurrencyMismatchError`, `InvalidAmountError`, `UnknownCurrencyError` (errors.ts)
- Produces: `interface Money { readonly amountMinor: bigint; readonly currency: string }`, `money(amountMinor: bigint, currency: string): Money`, `addMoney(a: Money, b: Money): Money`, `parseMajor(input: string, currency: string): Money`, `formatMajor(m: Money): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/domain/money.test.ts`:

```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- lib/domain/money.test.ts`
Expected: FAIL — `./money` 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`lib/domain/money.ts`:

```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- lib/domain/money.test.ts && npm run typecheck && npm run lint`
Expected: PASS, 타입·린트 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add lib/domain/money.ts lib/domain/money.test.ts
git commit -m "feat(domain): Money 입력 파싱과 표시 (표시 자릿수 기준)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 지출 1건의 원화 원가 확정

**Files:**
- Create: `lib/domain/rate.ts`
- Test: `lib/domain/rate.test.ts`

**Interfaces:**
- Consumes: `getCurrency`, `RATE_SCALE`, `convertMinor`, `Rate`, `parseRate`, `parseFeePercent`, `Money`, `money`, `InvalidAmountError`, `MissingRateError`
- Produces:
  - `type RateSource = "user" | "funding_source" | "api" | "base"` (`base` = 지출 통화가 정산 통화와 같음. SP2의 `rate_source` 컬럼도 이 네 값을 허용해야 한다)
  - `interface FundingSourceRate { currency: string; rate: Rate | null; feeRate: bigint }`
  - `interface CostInput { amount: Money; baseCurrency: string; userRate?: Rate | null; fundingSource?: FundingSourceRate | null; apiRate?: Rate | null }`
  - `interface ResolvedCost { base: Money; rate: Rate; feeRate: bigint; source: RateSource }`
  - `resolveCost(input: CostInput): ResolvedCost`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/domain/rate.test.ts`:

```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- lib/domain/rate.test.ts`
Expected: FAIL — `./rate` 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`lib/domain/rate.ts`:

```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- lib/domain/rate.test.ts && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/domain/rate.ts lib/domain/rate.test.ts
git commit -m "feat(domain): 환율 결정 우선순위와 지출 원화 원가 확정

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 분배 — allocate와 분배 4종

**Files:**
- Create: `lib/domain/hash.ts`, `lib/domain/split.ts`
- Test: `lib/domain/split.test.ts`

**Interfaces:**
- Consumes: `Money`, `money`, `SplitValidationError`, `UnknownMemberError`
- Produces:
  - `hash.ts`: `fnv1a32(input: string): number`
  - `split.ts`: `type SplitType = "equal" | "exact" | "percent" | "shares"`, `interface SplitParticipant { memberId: string; value: bigint }`, `interface Weighted { memberId: string; weight: bigint }`, `allocate(total: bigint, weighted: readonly Weighted[], seed: string, order: readonly string[]): Map<string, bigint>`, `splitWeights(type: SplitType, participants: readonly SplitParticipant[], foreignAmount: Money): Weighted[]`, `interface SplitCostInput { expenseId: string; splitType: SplitType; participants: readonly SplitParticipant[]; foreignAmount: Money; baseCost: bigint; memberOrder: readonly string[] }`, `splitCost(input: SplitCostInput): Map<string, bigint>`

규칙(설계 §4.4):
- 각자 floor(total × weight ÷ Σweight)를 받는다.
- 남는 단위는 `order` 순서로 정렬한 참여자 중 weight > 0인 사람에게, `fnv1a32(seed) % 인원` 위치부터 하나씩 준다.
- `seed`는 지출 id다.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/domain/split.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SplitValidationError, UnknownMemberError } from "./errors";
import { fnv1a32 } from "./hash";
import { money } from "./money";
import { allocate, splitCost } from "./split";

const order = ["A", "B", "C", "D"];
const sum = (m: Map<string, bigint>) => [...m.values()].reduce((s, v) => s + v, 0n);

describe("fnv1a32", () => {
  it("알려진 값 (결정적)", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
  });
});

describe("allocate", () => {
  it("나머지 1원은 seed로 정한 시작점부터 순서대로 준다", () => {
    const w = order.slice(0, 3).map((memberId) => ({ memberId, weight: 1n }));
    const r = allocate(10_000n, w, "e1", order);
    expect(sum(r)).toBe(10_000n);
    expect([...r.values()].sort()).toEqual([3333n, 3333n, 3334n]);
    const lucky = ["A", "B", "C"][fnv1a32("e1") % 3]!;
    expect(r.get(lucky)).toBe(3334n);
  });

  it("같은 입력이면 같은 결과, 입력 배열 순서와 무관", () => {
    const w = [
      { memberId: "C", weight: 1n },
      { memberId: "A", weight: 1n },
      { memberId: "B", weight: 1n },
    ];
    expect(allocate(100n, w, "x", order)).toEqual(allocate(100n, [...w].reverse(), "x", order));
  });

  it("음수 total도 합이 정확히 맞는다", () => {
    const w = order.map((memberId) => ({ memberId, weight: 1n }));
    const r = allocate(-10n, w, "neg", order);
    expect(sum(r)).toBe(-10n);
    expect([...r.values()].every((v) => v === -2n || v === -3n)).toBe(true);
  });

  it("weight 0인 사람은 나머지를 받지 않는다", () => {
    const r = allocate(
      5n,
      [
        { memberId: "A", weight: 0n },
        { memberId: "B", weight: 1n },
        { memberId: "C", weight: 1n },
      ],
      "z",
      order,
    );
    expect(r.get("A")).toBe(0n);
    expect(sum(r)).toBe(5n);
  });

  it("잘못된 입력은 거부", () => {
    expect(() => allocate(1n, [], "s", order)).toThrow(SplitValidationError);
    expect(() =>
      allocate(1n, [{ memberId: "A", weight: 1n }, { memberId: "A", weight: 1n }], "s", order),
    ).toThrow(SplitValidationError);
    expect(() => allocate(1n, [{ memberId: "Z", weight: 1n }], "s", order)).toThrow(
      UnknownMemberError,
    );
    expect(() => allocate(1n, [{ memberId: "A", weight: 0n }], "s", order)).toThrow(
      SplitValidationError,
    );
  });
});

describe("splitCost 4종", () => {
  const base = { expenseId: "e", memberOrder: order };

  it("equal: 10,000원을 3명 → 합 10,000", () => {
    const r = splitCost({
      ...base,
      splitType: "equal",
      participants: ["A", "B", "C"].map((memberId) => ({ memberId, value: 0n })),
      foreignAmount: money(10_000n, "KRW"),
      baseCost: 10_000n,
    });
    expect(sum(r)).toBe(10_000n);
  });

  it("exact: 외화 금액 지정 비율로 원가를 나눈다", () => {
    const r = splitCost({
      ...base,
      splitType: "exact",
      participants: [
        { memberId: "A", value: 3_000n },
        { memberId: "B", value: 1_000n },
      ],
      foreignAmount: money(4_000n, "JPY"),
      baseCost: 36_000n,
    });
    expect(r).toEqual(new Map([["A", 27_000n], ["B", 9_000n]]));
  });

  it("exact: 합이 지출액과 다르면 거부", () => {
    expect(() =>
      splitCost({
        ...base,
        splitType: "exact",
        participants: [{ memberId: "A", value: 1n }],
        foreignAmount: money(2n, "JPY"),
        baseCost: 18n,
      }),
    ).toThrow(SplitValidationError);
  });

  it("percent: basis point 합 10000", () => {
    const r = splitCost({
      ...base,
      splitType: "percent",
      participants: [
        { memberId: "A", value: 7_000n },
        { memberId: "B", value: 3_000n },
      ],
      foreignAmount: money(100n, "KRW"),
      baseCost: 100n,
    });
    expect(r).toEqual(new Map([["A", 70n], ["B", 30n]]));
    expect(() =>
      splitCost({
        ...base,
        splitType: "percent",
        participants: [{ memberId: "A", value: 9_999n }],
        foreignAmount: money(100n, "KRW"),
        baseCost: 100n,
      }),
    ).toThrow(SplitValidationError);
  });

  it("shares: 몫 2:1:1", () => {
    const r = splitCost({
      ...base,
      splitType: "shares",
      participants: [
        { memberId: "A", value: 2n },
        { memberId: "B", value: 1n },
        { memberId: "C", value: 1n },
      ],
      foreignAmount: money(4_000n, "KRW"),
      baseCost: 4_000n,
    });
    expect(r).toEqual(new Map([["A", 2_000n], ["B", 1_000n], ["C", 1_000n]]));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- lib/domain/split.test.ts`
Expected: FAIL — `./hash`, `./split` 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`lib/domain/hash.ts`:

```ts
/** FNV-1a 32bit. 나머지 배분 시작점처럼 "결정적이지만 고르게" 필요한 곳에만 쓴다 */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
```

`lib/domain/split.ts`:

```ts
import { SplitValidationError, UnknownMemberError } from "./errors";
import { fnv1a32 } from "./hash";
import type { Money } from "./money";

export type SplitType = "equal" | "exact" | "percent" | "shares";

export interface SplitParticipant {
  memberId: string;
  /** equal: 무시 / exact: 외화 minor / percent: basis point(합 10000) / shares: 몫 */
  value: bigint;
}

export interface Weighted {
  memberId: string;
  weight: bigint;
}

/**
 * total을 weight 비율로 나눈다. 각자 floor 후 남는 1단위들은
 * order 순서로 정렬한 참여자 중 weight>0인 사람에게, seed 해시로 정한 시작점부터 하나씩 준다.
 * 음수 total은 절댓값으로 나눈 뒤 부호를 붙인다.
 */
export function allocate(
  total: bigint,
  weighted: readonly Weighted[],
  seed: string,
  order: readonly string[],
): Map<string, bigint> {
  if (weighted.length === 0) throw new SplitValidationError("참여자가 없습니다");
  const seen = new Set<string>();
  for (const w of weighted) {
    if (seen.has(w.memberId)) throw new SplitValidationError(`중복 참여자: ${w.memberId}`);
    seen.add(w.memberId);
    if (!order.includes(w.memberId)) throw new UnknownMemberError(w.memberId);
    if (w.weight < 0n) throw new SplitValidationError("가중치는 음수일 수 없습니다");
  }
  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0n);
  if (totalWeight === 0n) throw new SplitValidationError("가중치 합이 0입니다");

  const sorted = [...weighted].sort(
    (a, b) => order.indexOf(a.memberId) - order.indexOf(b.memberId),
  );
  const sign = total < 0n ? -1n : 1n;
  const abs = total * sign;
  const shares = sorted.map((w) => (abs * w.weight) / totalWeight);
  let rem = abs - shares.reduce((s, x) => s + x, 0n);

  const eligible = sorted.flatMap((w, i) => (w.weight > 0n ? [i] : []));
  const start = fnv1a32(seed) % eligible.length;
  for (let k = 0; rem > 0n; k++, rem--) {
    const idx = eligible[(start + k) % eligible.length]!;
    shares[idx] = shares[idx]! + 1n;
  }

  return new Map(sorted.map((w, i) => [w.memberId, shares[i]! * sign]));
}

export function splitWeights(
  type: SplitType,
  participants: readonly SplitParticipant[],
  foreignAmount: Money,
): Weighted[] {
  if (participants.length === 0) throw new SplitValidationError("참여자가 없습니다");
  if (type === "equal") return participants.map((p) => ({ memberId: p.memberId, weight: 1n }));

  for (const p of participants) {
    if (p.value < 0n) throw new SplitValidationError("분배 값은 음수일 수 없습니다");
  }
  const sum = participants.reduce((s, p) => s + p.value, 0n);
  if (type === "exact" && sum !== foreignAmount.amountMinor) {
    throw new SplitValidationError(
      `금액 지정 합(${sum})이 지출액(${foreignAmount.amountMinor})과 다릅니다`,
    );
  }
  if (type === "percent" && sum !== 10_000n) {
    throw new SplitValidationError(`비율 합이 100%가 아닙니다 (${sum} bp)`);
  }
  if (type === "shares" && sum === 0n) throw new SplitValidationError("몫의 합이 0입니다");
  return participants.map((p) => ({ memberId: p.memberId, weight: p.value }));
}

export interface SplitCostInput {
  expenseId: string;
  splitType: SplitType;
  participants: readonly SplitParticipant[];
  foreignAmount: Money;
  /** 원화 원가 (base minor) */
  baseCost: bigint;
  memberOrder: readonly string[];
}

/** 지출 원화 원가를 참여자 부담분으로 나눈다. 부담분 합 = baseCost 가 항상 성립 */
export function splitCost(input: SplitCostInput): Map<string, bigint> {
  const weights = splitWeights(input.splitType, input.participants, input.foreignAmount);
  return allocate(input.baseCost, weights, input.expenseId, input.memberOrder);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- lib/domain/split.test.ts && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/domain/hash.ts lib/domain/split.ts lib/domain/split.test.ts
git commit -m "feat(domain): 결정적 나머지 배분과 분배 4종

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 공금 원가 풀

**Files:**
- Create: `lib/domain/wallet.ts`
- Test: `lib/domain/wallet.test.ts`

**Interfaces:**
- Consumes: `getCurrency`, `convertMinor`, `divRound`, `Rate`, `parseRate`, `Money`, `money`, `InvalidAmountError`, `MissingRateError`
- Produces:
  - `interface WalletContribution { kind: "contribution"; id: string; memberId: string; occurredAt: string; createdAt: string; amount: Money; baseCost: bigint }`
  - `interface WalletSpend { kind: "spend"; id: string; occurredAt: string; createdAt: string; amount: Money; overdraftRate: Rate | null }`
  - `type WalletEvent = WalletContribution | WalletSpend`
  - `interface Pool { foreignMinor: bigint; costMinor: bigint }`
  - `interface WalletReplay { pools: Map<string, Pool>; spendCosts: Map<string, bigint>; overdrawn: string[] }`
  - `compareEvents(a, b): number` (occurredAt → createdAt → id)
  - `replayWallet(events: readonly WalletEvent[], baseCurrency: string): WalletReplay`

`occurredAt`·`createdAt`은 ISO 8601 UTC 문자열(`toISOString()` 형식)이다.

규칙(설계 §4.3):
- 지출 원가 = round(costMinor × s ÷ foreignMinor)
- 잔액이 부족하면 남은 잔액 부분은 풀 원가 전부로, 초과분은 `overdraftRate`로 평가한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/domain/wallet.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InvalidAmountError, MissingRateError } from "./errors";
import { parseRate } from "./fixed";
import { money } from "./money";
import { replayWallet, type WalletEvent } from "./wallet";

const t = (day: number, hour = 0) =>
  `2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

const contribute = (id: string, memberId: string, yen: bigint, cost: bigint, at: string): WalletEvent => ({
  kind: "contribution",
  id,
  memberId,
  occurredAt: at,
  createdAt: at,
  amount: money(yen, "JPY"),
  baseCost: cost,
});

const spend = (id: string, yen: bigint, at: string, overdraft: string | null = null): WalletEvent => ({
  kind: "spend",
  id,
  occurredAt: at,
  createdAt: at,
  amount: money(yen, "JPY"),
  overdraftRate: overdraft === null ? null : parseRate(overdraft, 100),
});

describe("replayWallet", () => {
  it("이동평균 원가로 차감하고 원가가 보존된다", () => {
    const r = replayWallet(
      [
        contribute("c1", "A", 20_000n, 180_000n, t(1)),
        contribute("c2", "C", 20_000n, 182_000n, t(1)),
        spend("s1", 10_000n, t(2)),
      ],
      "KRW",
    );
    expect(r.spendCosts.get("s1")).toBe(90_500n);
    expect(r.pools.get("JPY")).toEqual({ foreignMinor: 30_000n, costMinor: 271_500n });
    expect(r.overdrawn).toEqual([]);
  });

  it("잔액을 정확히 다 쓰면 남은 원가 전부가 그 지출의 원가", () => {
    const r = replayWallet(
      [contribute("c1", "A", 3n, 10n, t(1)), spend("s1", 1n, t(2)), spend("s2", 2n, t(3))],
      "KRW",
    );
    expect(r.spendCosts.get("s1")! + r.spendCosts.get("s2")!).toBe(10n);
    expect(r.pools.get("JPY")).toEqual({ foreignMinor: 0n, costMinor: 0n });
  });

  it("입력 배열 순서가 아니라 occurredAt → createdAt → id 순으로 적용", () => {
    const events = [
      spend("s1", 10_000n, t(3)),
      contribute("c2", "C", 20_000n, 182_000n, t(2)),
      contribute("c1", "A", 20_000n, 180_000n, t(1)),
    ];
    expect(replayWallet(events, "KRW").spendCosts.get("s1")).toBe(90_500n);
  });

  it("잔액 부족: 남은 잔액은 풀 원가, 초과분은 API 환율, 경고 목록에 남김", () => {
    const r = replayWallet(
      [contribute("c1", "A", 1_000n, 9_000n, t(1)), spend("s1", 3_000n, t(2), "1000")],
      "KRW",
    );
    expect(r.spendCosts.get("s1")).toBe(9_000n + 20_000n);
    expect(r.pools.get("JPY")).toEqual({ foreignMinor: -2_000n, costMinor: -20_000n });
    expect(r.overdrawn).toEqual(["s1"]);
  });

  it("잔액 부족인데 API 환율이 없으면 MissingRateError", () => {
    expect(() => replayWallet([spend("s1", 1n, t(1))], "KRW")).toThrow(MissingRateError);
  });

  it("0 이하 금액은 거부", () => {
    expect(() => replayWallet([contribute("c1", "A", 0n, 0n, t(1))], "KRW")).toThrow(
      InvalidAmountError,
    );
  });

  it("통화별로 풀이 따로 있다", () => {
    const r = replayWallet(
      [
        contribute("c1", "A", 1_000n, 9_000n, t(1)),
        {
          kind: "contribution",
          id: "c2",
          memberId: "A",
          occurredAt: t(1),
          createdAt: t(1),
          amount: money(10_000n, "USD"),
          baseCost: 140_000n,
        },
      ],
      "KRW",
    );
    expect(r.pools.get("JPY")).toEqual({ foreignMinor: 1_000n, costMinor: 9_000n });
    expect(r.pools.get("USD")).toEqual({ foreignMinor: 10_000n, costMinor: 140_000n });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- lib/domain/wallet.test.ts`
Expected: FAIL — `./wallet` 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`lib/domain/wallet.ts`:

```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- lib/domain/wallet.test.ts && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/domain/wallet.ts lib/domain/wallet.test.ts
git commit -m "feat(domain): 공금 통화별 원가 풀 시간순 재생

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 멤버별 순잔액과 남은 공금 처리

**Files:**
- Create: `lib/domain/balance.ts`
- Test: `lib/domain/balance.test.ts`

**Interfaces:**
- Consumes: `replayWallet`, `WalletEvent`, `WalletReplay` (wallet.ts), `allocate`, `splitCost`, `SplitParticipant`, `SplitType`, `Weighted` (split.ts), `Money`, `money`, `Rate`, `parseRate`, `InvalidAmountError`, `SettlementInvariantError`, `UnknownMemberError`
- Produces:
  - `interface MemberInput { id: string; sortOrder: number }`
  - `type Payer = { kind: "member"; memberId: string } | { kind: "wallet" }`
  - `interface ExpenseInput { id: string; amount: Money; paidBy: Payer; baseCost: bigint | null; occurredAt: string; createdAt: string; splitType: SplitType; participants: SplitParticipant[]; overdraftRate: Rate | null; deletedAt?: string | null }`
  - `interface ContributionInput { id: string; memberId: string; amount: Money; baseCost: bigint; occurredAt: string; createdAt: string; deletedAt?: string | null }`
  - `type LeftoverPolicy = { kind: "split_by_contribution" } | { kind: "taker"; memberId: string }`
  - `interface TripInput { baseCurrency: string; members: MemberInput[]; expenses: ExpenseInput[]; contributions: ContributionInput[]; leftover: LeftoverPolicy }`
  - `interface LeftoverShare { memberId: string; foreignMinor: bigint; costMinor: bigint }`
  - `interface BalanceResult { memberOrder: string[]; balances: Map<string, bigint>; expenseCosts: Map<string, bigint>; wallet: WalletReplay; leftoverShares: Map<string, LeftoverShare[]> }`
  - `memberOrderOf(members: readonly MemberInput[]): string[]`
  - `computeBalances(input: TripInput): BalanceResult` (Σ순잔액 ≠ 0이면 `SettlementInvariantError`)

규칙(설계 §4.5):
- 순잔액 = +직접 결제 원가 +입금 원가 −부담분 −남은 공금 처리분
- 입금 비율로 나눌 때 그 통화의 입금 원가 합이 0이면 전원 균등으로 나눈다.
- 나머지 배분 seed는 `leftover:<통화>`다.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/domain/balance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeBalances, memberOrderOf, type ExpenseInput, type TripInput } from "./balance";
import { InvalidAmountError, UnknownMemberError } from "./errors";
import { parseRate } from "./fixed";
import { money } from "./money";

const at = (day: number) => `2026-11-0${day}T00:00:00.000Z`;
const all = (ids: string[]) => ids.map((memberId) => ({ memberId, value: 0n }));

const krwExpense = (id: string, payer: string, won: bigint, who: string[]): ExpenseInput => ({
  id,
  amount: money(won, "KRW"),
  paidBy: { kind: "member", memberId: payer },
  baseCost: won,
  occurredAt: at(1),
  createdAt: at(1),
  splitType: "equal",
  participants: all(who),
  overdraftRate: null,
});

const trip = (over: Partial<TripInput>): TripInput => ({
  baseCurrency: "KRW",
  members: [
    { id: "A", sortOrder: 0 },
    { id: "B", sortOrder: 1 },
  ],
  expenses: [],
  contributions: [],
  leftover: { kind: "split_by_contribution" },
  ...over,
});

describe("memberOrderOf", () => {
  it("sortOrder, 같으면 id 순", () => {
    expect(
      memberOrderOf([
        { id: "b", sortOrder: 1 },
        { id: "z", sortOrder: 0 },
        { id: "a", sortOrder: 1 },
      ]),
    ).toEqual(["z", "a", "b"]);
  });
});

describe("computeBalances", () => {
  it("2인 단순: A가 5만 원 결제, 둘이 나눔 → A +25,000 / B −25,000", () => {
    const r = computeBalances(trip({ expenses: [krwExpense("e1", "A", 50_000n, ["A", "B"])] }));
    expect(r.balances).toEqual(new Map([["A", 25_000n], ["B", -25_000n]]));
  });

  it("부분 참여: 참여하지 않은 지출은 부담하지 않는다", () => {
    const r = computeBalances(
      trip({
        members: [
          { id: "A", sortOrder: 0 },
          { id: "B", sortOrder: 1 },
          { id: "C", sortOrder: 2 },
        ],
        expenses: [
          krwExpense("e1", "A", 30_000n, ["A", "B", "C"]),
          krwExpense("e2", "B", 20_000n, ["A", "B"]),
        ],
      }),
    );
    expect(r.balances).toEqual(new Map([["A", 10_000n], ["B", 0n], ["C", -10_000n]]));
  });

  it("삭제된 지출과 입금은 계산에서 빠진다", () => {
    const r = computeBalances(
      trip({
        expenses: [
          krwExpense("e1", "A", 50_000n, ["A", "B"]),
          { ...krwExpense("e2", "B", 90_000n, ["A", "B"]), deletedAt: at(2) },
        ],
        contributions: [
          {
            id: "c1",
            memberId: "B",
            amount: money(10_000n, "JPY"),
            baseCost: 90_000n,
            occurredAt: at(1),
            createdAt: at(1),
            deletedAt: at(2),
          },
        ],
      }),
    );
    expect(r.balances).toEqual(new Map([["A", 25_000n], ["B", -25_000n]]));
    expect(r.expenseCosts.has("e2")).toBe(false);
    expect(r.wallet.pools.size).toBe(0);
  });

  it("다통화: JPY·USD 지출이 각자 원가로 합산된다", () => {
    const r = computeBalances(
      trip({
        expenses: [
          { ...krwExpense("j", "A", 0n, ["A", "B"]), amount: money(10_000n, "JPY"), baseCost: 90_000n },
          { ...krwExpense("u", "B", 0n, ["A", "B"]), amount: money(5_000n, "USD"), baseCost: 70_000n },
        ],
      }),
    );
    expect(r.balances).toEqual(new Map([["A", 10_000n], ["B", -10_000n]]));
  });

  it("공금: 입금 원가 크레딧 − 부담분 − 남은 공금 반환(입금 비율)", () => {
    const r = computeBalances(
      trip({
        contributions: [
          { id: "cA", memberId: "A", amount: money(10_000n, "JPY"), baseCost: 90_000n, occurredAt: at(1), createdAt: at(1) },
          { id: "cB", memberId: "B", amount: money(10_000n, "JPY"), baseCost: 92_000n, occurredAt: at(1), createdAt: at(1) },
        ],
        expenses: [
          {
            id: "w1",
            amount: money(15_000n, "JPY"),
            paidBy: { kind: "wallet" },
            baseCost: null,
            occurredAt: at(2),
            createdAt: at(2),
            splitType: "equal",
            participants: all(["A", "B"]),
            overdraftRate: null,
          },
        ],
      }),
    );
    // 풀: 20,000엔/182,000원 → w1 원가 136,500 → 남은 5,000엔/45,500원
    expect(r.expenseCosts.get("w1")).toBe(136_500n);
    expect(r.wallet.pools.get("JPY")).toEqual({ foreignMinor: 5_000n, costMinor: 45_500n });
    // 남은 원가 45,500을 90,000:92,000으로 → 22,500 / 23,000 (나누어떨어짐)
    // 외화 5,000엔은 2,472.5 / 2,527.5 → 나머지 1엔은 fnv1a32("leftover:JPY") % 2 = 1 → B
    expect(r.leftoverShares.get("JPY")).toEqual([
      { memberId: "A", foreignMinor: 2_472n, costMinor: 22_500n },
      { memberId: "B", foreignMinor: 2_528n, costMinor: 23_000n },
    ]);
    // A: 90,000 − 68,250 − 22,500 = −750 / B: 92,000 − 68,250 − 23,000 = +750
    expect(r.balances).toEqual(new Map([["A", -750n], ["B", 750n]]));
  });

  it("남은 공금을 한 사람이 다 가져가면 그 사람이 남은 원가를 전부 부담", () => {
    const r = computeBalances(
      trip({
        leftover: { kind: "taker", memberId: "A" },
        contributions: [
          { id: "cA", memberId: "A", amount: money(10_000n, "JPY"), baseCost: 90_000n, occurredAt: at(1), createdAt: at(1) },
          { id: "cB", memberId: "B", amount: money(10_000n, "JPY"), baseCost: 90_000n, occurredAt: at(1), createdAt: at(1) },
        ],
      }),
    );
    expect(r.leftoverShares.get("JPY")).toEqual([
      { memberId: "A", foreignMinor: 20_000n, costMinor: 180_000n },
    ]);
    expect(r.balances).toEqual(new Map([["A", -90_000n], ["B", 90_000n]]));
  });

  it("입금 없이 공금을 쓴 경우(잔액 부족) 음수 잔여는 전원 균등", () => {
    const r = computeBalances(
      trip({
        expenses: [
          {
            id: "w1",
            amount: money(1_000n, "JPY"),
            paidBy: { kind: "wallet" },
            baseCost: null,
            occurredAt: at(1),
            createdAt: at(1),
            splitType: "equal",
            participants: all(["A"]),
            overdraftRate: parseRate("900", 100),
          },
        ],
      }),
    );
    expect(r.wallet.overdrawn).toEqual(["w1"]);
    expect(r.balances).toEqual(new Map([["A", -4_500n], ["B", 4_500n]]));
  });

  it("공금 외 지출에 원가가 없으면 거부", () => {
    expect(() =>
      computeBalances(trip({ expenses: [{ ...krwExpense("e", "A", 1n, ["A"]), baseCost: null }] })),
    ).toThrow(InvalidAmountError);
  });

  it("모르는 멤버는 거부", () => {
    expect(() => computeBalances(trip({ expenses: [krwExpense("e", "Z", 1n, ["A"])] }))).toThrow(
      UnknownMemberError,
    );
    expect(() =>
      computeBalances(trip({ expenses: [krwExpense("e", "A", 1n, ["Q"])] })),
    ).toThrow(UnknownMemberError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- lib/domain/balance.test.ts`
Expected: FAIL — `./balance` 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`lib/domain/balance.ts`:

```ts
import { InvalidAmountError, SettlementInvariantError, UnknownMemberError } from "./errors";
import type { Rate } from "./fixed";
import type { Money } from "./money";
import { allocate, splitCost, type SplitParticipant, type SplitType, type Weighted } from "./split";
import { replayWallet, type WalletEvent, type WalletReplay } from "./wallet";

export interface MemberInput {
  id: string;
  sortOrder: number;
}

export type Payer = { kind: "member"; memberId: string } | { kind: "wallet" };

export interface ExpenseInput {
  id: string;
  amount: Money;
  paidBy: Payer;
  /** 공금 외 지출의 원화 원가 스냅샷. 공금 지출이면 null */
  baseCost: bigint | null;
  occurredAt: string;
  createdAt: string;
  splitType: SplitType;
  participants: SplitParticipant[];
  /** 공금 지출의 잔액 부족분 평가용 API 환율 */
  overdraftRate: Rate | null;
  deletedAt?: string | null;
}

export interface ContributionInput {
  id: string;
  memberId: string;
  amount: Money;
  baseCost: bigint;
  occurredAt: string;
  createdAt: string;
  deletedAt?: string | null;
}

export type LeftoverPolicy =
  | { kind: "split_by_contribution" }
  | { kind: "taker"; memberId: string };

export interface TripInput {
  baseCurrency: string;
  members: MemberInput[];
  expenses: ExpenseInput[];
  contributions: ContributionInput[];
  leftover: LeftoverPolicy;
}

export interface LeftoverShare {
  memberId: string;
  foreignMinor: bigint;
  costMinor: bigint;
}

export interface BalanceResult {
  memberOrder: string[];
  /** 멤버 id → 순잔액 (base minor, +는 받을 돈) */
  balances: Map<string, bigint>;
  /** 활성 지출 id → 원화 원가 (공금 지출은 재계산 값) */
  expenseCosts: Map<string, bigint>;
  wallet: WalletReplay;
  /** 통화 → 남은 공금을 누가 얼마 가져가는지 */
  leftoverShares: Map<string, LeftoverShare[]>;
}

export function memberOrderOf(members: readonly MemberInput[]): string[] {
  return [...members]
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((m) => m.id);
}

export function computeBalances(input: TripInput): BalanceResult {
  const order = memberOrderOf(input.members);
  const known = new Set(order);
  const need = (id: string) => {
    if (!known.has(id)) throw new UnknownMemberError(id);
  };
  const balances = new Map(order.map((id) => [id, 0n]));
  const bump = (id: string, delta: bigint) => balances.set(id, balances.get(id)! + delta);

  const expenses = input.expenses.filter((e) => e.deletedAt == null);
  const contributions = input.contributions.filter((c) => c.deletedAt == null);

  const events: WalletEvent[] = [
    ...contributions.map((c): WalletEvent => {
      need(c.memberId);
      return {
        kind: "contribution",
        id: c.id,
        memberId: c.memberId,
        occurredAt: c.occurredAt,
        createdAt: c.createdAt,
        amount: c.amount,
        baseCost: c.baseCost,
      };
    }),
    ...expenses
      .filter((e) => e.paidBy.kind === "wallet")
      .map(
        (e): WalletEvent => ({
          kind: "spend",
          id: e.id,
          occurredAt: e.occurredAt,
          createdAt: e.createdAt,
          amount: e.amount,
          overdraftRate: e.overdraftRate,
        }),
      ),
  ];
  const wallet = replayWallet(events, input.baseCurrency);

  const expenseCosts = new Map<string, bigint>();
  for (const e of expenses) {
    let cost: bigint;
    if (e.paidBy.kind === "wallet") {
      cost = wallet.spendCosts.get(e.id)!;
    } else {
      need(e.paidBy.memberId);
      if (e.baseCost == null) throw new InvalidAmountError(`원화 원가가 없습니다: ${e.id}`);
      cost = e.baseCost;
      bump(e.paidBy.memberId, cost);
    }
    expenseCosts.set(e.id, cost);
    const shares = splitCost({
      expenseId: e.id,
      splitType: e.splitType,
      participants: e.participants,
      foreignAmount: e.amount,
      baseCost: cost,
      memberOrder: order,
    });
    for (const [memberId, share] of shares) bump(memberId, -share);
  }

  for (const c of contributions) bump(c.memberId, c.baseCost);

  const leftoverShares = new Map<string, LeftoverShare[]>();
  const currencies = [...wallet.pools.keys()].sort();
  for (const currency of currencies) {
    const pool = wallet.pools.get(currency)!;
    if (pool.foreignMinor === 0n && pool.costMinor === 0n) continue;

    if (input.leftover.kind === "taker") {
      need(input.leftover.memberId);
      bump(input.leftover.memberId, -pool.costMinor);
      leftoverShares.set(currency, [
        { memberId: input.leftover.memberId, foreignMinor: pool.foreignMinor, costMinor: pool.costMinor },
      ]);
      continue;
    }

    const byMember = new Map<string, bigint>();
    for (const c of contributions) {
      if (c.amount.currency !== currency) continue;
      byMember.set(c.memberId, (byMember.get(c.memberId) ?? 0n) + c.baseCost);
    }
    let weights: Weighted[] = [...byMember].map(([memberId, weight]) => ({ memberId, weight }));
    if (weights.reduce((s, w) => s + w.weight, 0n) === 0n) {
      // 입금 기록 없이 공금을 쓴 경우: 전원 균등
      weights = order.map((memberId) => ({ memberId, weight: 1n }));
    }
    const seed = `leftover:${currency}`;
    const costs = allocate(pool.costMinor, weights, seed, order);
    const foreign = allocate(pool.foreignMinor, weights, seed, order);
    const shares: LeftoverShare[] = [];
    for (const memberId of order) {
      const costMinor = costs.get(memberId);
      if (costMinor === undefined) continue;
      bump(memberId, -costMinor);
      shares.push({ memberId, foreignMinor: foreign.get(memberId)!, costMinor });
    }
    leftoverShares.set(currency, shares);
  }

  const sum = [...balances.values()].reduce((s, v) => s + v, 0n);
  if (sum !== 0n) throw new SettlementInvariantError(`순잔액 합이 0이 아닙니다: ${sum}`);

  return { memberOrder: order, balances, expenseCosts, wallet, leftoverShares };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- lib/domain/balance.test.ts && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/domain/balance.ts lib/domain/balance.test.ts
git commit -m "feat(domain): 멤버별 순잔액과 남은 공금 처리 2종

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 그리디 정산과 검산

**Files:**
- Create: `lib/domain/settle.ts`
- Test: `lib/domain/settle.test.ts`

**Interfaces:**
- Consumes: `SettlementInvariantError`
- Produces: `interface Transfer { from: string; to: string; amountMinor: bigint }`, `settle(balances: ReadonlyMap<string, bigint>, memberOrder: readonly string[]): Transfer[]`, `verifySettlement(balances: ReadonlyMap<string, bigint>, transfers: readonly Transfer[]): boolean`

규칙(설계 §4.6):
- 받을 사람과 줄 사람을 각각 금액 내림차순으로 정렬한다. 금액이 같으면 `memberOrder` 순서로 정한다.
- 매번 맨 앞끼리 min(받을 금액, 줄 금액)만큼 송금하도록 매칭한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/domain/settle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SettlementInvariantError } from "./errors";
import { settle, verifySettlement } from "./settle";

const order = ["A", "B", "C", "D"];

describe("settle", () => {
  it("2인: B → A", () => {
    const b = new Map([["A", 25_000n], ["B", -25_000n]]);
    expect(settle(b, order)).toEqual([{ from: "B", to: "A", amountMinor: 25_000n }]);
  });

  it("가장 많이 줄 사람 ↔ 가장 많이 받을 사람부터 매칭", () => {
    const b = new Map([
      ["A", 70n],
      ["B", 30n],
      ["C", -60n],
      ["D", -40n],
    ]);
    const t = settle(b, order);
    expect(t).toEqual([
      { from: "C", to: "A", amountMinor: 60n },
      { from: "D", to: "B", amountMinor: 30n },
      { from: "D", to: "A", amountMinor: 10n },
    ]);
    expect(verifySettlement(b, t)).toBe(true);
  });

  it("금액이 같으면 멤버 순서로 (결정적)", () => {
    const b = new Map([
      ["B", 10n],
      ["A", 10n],
      ["D", -10n],
      ["C", -10n],
    ]);
    expect(settle(b, order)).toEqual([
      { from: "C", to: "A", amountMinor: 10n },
      { from: "D", to: "B", amountMinor: 10n },
    ]);
  });

  it("모두 0이면 송금 없음", () => {
    expect(settle(new Map([["A", 0n]]), order)).toEqual([]);
  });

  it("합이 0이 아니면 거부", () => {
    expect(() => settle(new Map([["A", 1n]]), order)).toThrow(SettlementInvariantError);
  });
});

describe("verifySettlement", () => {
  it("틀린 송금 목록은 false", () => {
    const b = new Map([["A", 10n], ["B", -10n]]);
    expect(verifySettlement(b, [{ from: "B", to: "A", amountMinor: 9n }])).toBe(false);
    expect(verifySettlement(b, [{ from: "B", to: "Z", amountMinor: 10n }])).toBe(false);
    expect(verifySettlement(b, [{ from: "B", to: "A", amountMinor: 10n }])).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- lib/domain/settle.test.ts`
Expected: FAIL — `./settle` 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`lib/domain/settle.ts`:

```ts
import { SettlementInvariantError } from "./errors";

export interface Transfer {
  from: string;
  to: string;
  /** base minor */
  amountMinor: bigint;
}

interface Party {
  id: string;
  amount: bigint;
  rank: number;
}

const byAmountDesc = (a: Party, b: Party) =>
  a.amount === b.amount ? a.rank - b.rank : a.amount > b.amount ? -1 : 1;

/** 가장 많이 받을 사람 ↔ 가장 많이 줄 사람을 반복 매칭 (그리디) */
export function settle(
  balances: ReadonlyMap<string, bigint>,
  memberOrder: readonly string[],
): Transfer[] {
  const sum = [...balances.values()].reduce((s, v) => s + v, 0n);
  if (sum !== 0n) throw new SettlementInvariantError(`순잔액 합이 0이 아닙니다: ${sum}`);

  const rank = (id: string) => {
    const i = memberOrder.indexOf(id);
    return i === -1 ? memberOrder.length : i;
  };
  const creditors: Party[] = [];
  const debtors: Party[] = [];
  for (const [id, v] of balances) {
    if (v > 0n) creditors.push({ id, amount: v, rank: rank(id) });
    if (v < 0n) debtors.push({ id, amount: -v, rank: rank(id) });
  }

  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmountDesc);
    debtors.sort(byAmountDesc);
    const c = creditors[0]!;
    const d = debtors[0]!;
    const x = c.amount < d.amount ? c.amount : d.amount;
    transfers.push({ from: d.id, to: c.id, amountMinor: x });
    c.amount -= x;
    d.amount -= x;
    if (c.amount === 0n) creditors.shift();
    if (d.amount === 0n) debtors.shift();
  }
  return transfers;
}

/** 송금을 모두 반영하면 모든 순잔액이 0이 되는지 검산 */
export function verifySettlement(
  balances: ReadonlyMap<string, bigint>,
  transfers: readonly Transfer[],
): boolean {
  const left = new Map(balances);
  for (const t of transfers) {
    if (t.amountMinor <= 0n || !left.has(t.from) || !left.has(t.to)) return false;
    left.set(t.from, left.get(t.from)! + t.amountMinor);
    left.set(t.to, left.get(t.to)! - t.amountMinor);
  }
  return [...left.values()].every((v) => v === 0n);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- lib/domain/settle.test.ts && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/domain/settle.ts lib/domain/settle.test.ts
git commit -m "feat(domain): 그리디 송금 목록과 검산

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 송금 금액의 외화 표시

**Files:**
- Create: `lib/domain/display.ts`
- Test: `lib/domain/display.test.ts`

**Interfaces:**
- Consumes: `BalanceResult`, `ExpenseInput`, `TripInput`, `computeBalances` (balance.ts), `Transfer` (settle.ts), `getCurrency`, `RATE_SCALE`, `divRound`, `pow10`, `Rate`, `parseRate`, `Money`, `money`
- Produces:
  - `averageRate(costMinor: bigint, foreignMinor: bigint, foreignCurrency: string, baseCurrency: string): Rate | null`
  - `tripAverageRate(result: BalanceResult, expenses: readonly ExpenseInput[], primaryCurrency: string, baseCurrency: string): Rate | null`
  - `baseToForeign(baseMinor: bigint, baseCurrency: string, rate: Rate, foreignCurrency: string): Money` (표시 자릿수로 반올림)
  - `interface TransferView { from: string; to: string; base: Money; atAverage: Money | null; atToday: Money | null }`
  - `describeTransfers(transfers: readonly Transfer[], baseCurrency: string, primaryCurrency: string, avgRate: Rate | null, todayRate: Rate | null): TransferView[]`

규칙(설계 §4.7):
- 여행 평균 환율 = 주 통화 지출(공금 포함)의 원가 합 ÷ 외화 합
- 주 통화 지출이 없으면 공금 평균 원가를 쓰고, 그것도 없으면 `null`
- 주 통화가 정산 통화와 같으면 외화 표시는 `null`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/domain/display.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeBalances, type TripInput } from "./balance";
import { averageRate, baseToForeign, describeTransfers, tripAverageRate } from "./display";
import { parseRate } from "./fixed";
import { money } from "./money";

const at = "2026-11-01T00:00:00.000Z";

describe("averageRate", () => {
  it("181,000원 / 20,000엔 = 9.05원/엔", () => {
    expect(averageRate(181_000n, 20_000n, "JPY", "KRW")).toBe(parseRate("905", 100));
  });
  it("외화 합이 0 이하이면 null", () => {
    expect(averageRate(1n, 0n, "JPY", "KRW")).toBeNull();
  });
  it("자릿수가 다른 통화: 180,750원 / 120.50 EUR = 1500", () => {
    expect(averageRate(180_750n, 12_050n, "EUR", "KRW")).toBe(parseRate("1500"));
  });
});

describe("baseToForeign", () => {
  it("23,684원 ÷ 8.9원/엔 = 2,661.1 → 2,661엔", () => {
    expect(baseToForeign(23_684n, "KRW", parseRate("890", 100), "JPY")).toEqual(money(2_661n, "JPY"));
  });
  it("TWD는 표시 자릿수(0)로 반올림해 minor 2자리로 저장: 10,000원 ÷ 43 = 232.56 → 233 TWD", () => {
    expect(baseToForeign(10_000n, "KRW", parseRate("43"), "TWD")).toEqual(money(23_300n, "TWD"));
  });
  it("USD는 센트까지: 10,000원 ÷ 1,400 = 7.14", () => {
    expect(baseToForeign(10_000n, "KRW", parseRate("1400"), "USD")).toEqual(money(714n, "USD"));
  });
});

describe("tripAverageRate", () => {
  const base = (over: Partial<TripInput>): TripInput => ({
    baseCurrency: "KRW",
    members: [{ id: "A", sortOrder: 0 }],
    expenses: [],
    contributions: [],
    leftover: { kind: "split_by_contribution" },
    ...over,
  });

  it("주 통화 지출(공금 포함) 원가 합 ÷ 외화 합", () => {
    const input = base({
      expenses: [
        {
          id: "e1",
          amount: money(10_000n, "JPY"),
          paidBy: { kind: "member", memberId: "A" },
          baseCost: 90_000n,
          occurredAt: at,
          createdAt: at,
          splitType: "equal",
          participants: [{ memberId: "A", value: 0n }],
          overdraftRate: null,
        },
        {
          id: "e2",
          amount: money(10_000n, "JPY"),
          paidBy: { kind: "member", memberId: "A" },
          baseCost: 92_000n,
          occurredAt: at,
          createdAt: at,
          splitType: "equal",
          participants: [{ memberId: "A", value: 0n }],
          overdraftRate: null,
        },
      ],
    });
    const r = computeBalances(input);
    expect(tripAverageRate(r, input.expenses, "JPY", "KRW")).toBe(parseRate("910", 100));
  });

  it("주 통화 지출이 없으면 공금 평균 원가", () => {
    const input = base({
      contributions: [
        { id: "c", memberId: "A", amount: money(20_000n, "JPY"), baseCost: 181_000n, occurredAt: at, createdAt: at },
      ],
    });
    const r = computeBalances(input);
    expect(tripAverageRate(r, input.expenses, "JPY", "KRW")).toBe(parseRate("905", 100));
  });

  it("아무것도 없으면 null, 주 통화가 정산 통화면 null", () => {
    const input = base({});
    const r = computeBalances(input);
    expect(tripAverageRate(r, input.expenses, "JPY", "KRW")).toBeNull();
    expect(tripAverageRate(r, input.expenses, "KRW", "KRW")).toBeNull();
  });
});

describe("describeTransfers", () => {
  it("원화 + 평균 환율 외화 + 오늘 환율 외화", () => {
    const v = describeTransfers(
      [{ from: "B", to: "A", amountMinor: 23_684n }],
      "KRW",
      "JPY",
      parseRate("905", 100),
      parseRate("890", 100),
    );
    expect(v).toEqual([
      {
        from: "B",
        to: "A",
        base: money(23_684n, "KRW"),
        atAverage: money(2_617n, "JPY"),
        atToday: money(2_661n, "JPY"),
      },
    ]);
  });

  it("환율이 없으면 그 칸은 null", () => {
    const [v] = describeTransfers([{ from: "B", to: "A", amountMinor: 1n }], "KRW", "JPY", null, null);
    expect(v).toMatchObject({ atAverage: null, atToday: null });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- lib/domain/display.test.ts`
Expected: FAIL — `./display` 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`lib/domain/display.ts`:

```ts
import type { BalanceResult, ExpenseInput } from "./balance";
import { getCurrency } from "./currency";
import { RATE_SCALE, divRound, pow10, type Rate } from "./fixed";
import type { Money } from "./money";
import type { Transfer } from "./settle";

/** 원가 합 ÷ 외화 합 → Rate. 외화 합이 0 이하이면 null */
export function averageRate(
  costMinor: bigint,
  foreignMinor: bigint,
  foreignCurrency: string,
  baseCurrency: string,
): Rate | null {
  if (foreignMinor <= 0n) return null;
  const f = getCurrency(foreignCurrency);
  const b = getCurrency(baseCurrency);
  return divRound(costMinor * RATE_SCALE * pow10(f.minorUnits), foreignMinor * pow10(b.minorUnits));
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
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- lib/domain/display.test.ts && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/domain/display.ts lib/domain/display.test.ts
git commit -m "feat(domain): 여행 평균 환율과 오늘 환율 기준 외화 표시

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 검증 시나리오·속성 테스트·공개 API·손 검산 문서

**Files:**
- Create: `lib/domain/index.ts`, `lib/domain/scenarios/fixtures.ts`, `docs/scenarios.md`
- Test: `lib/domain/scenarios/scenarios.test.ts`, `lib/domain/properties.test.ts`

**Interfaces:**
- Consumes: Task 1~8의 모든 공개 함수·타입
- Produces:
  - `index.ts`: `lib/domain`의 공개 API 전체 재수출 (SP2·SP3는 `@/lib/domain`으로만 import)
  - `fixtures.ts`: `at(day: number, hour?: number): string`, `scenario1(): TripInput`, `scenario2(): TripInput`, `scenario3(): TripInput`

이 Task는 앞선 모듈을 조합해서 원본 명세 §12 시나리오의 숫자를 고정한다. 기대값은 `docs/scenarios.md`에 손으로 검산한 값과 같다. 엔진 동작을 바꾸지 않으므로 테스트를 먼저 쓰고 fixtures를 채우는 순서다.

- [ ] **Step 1: 공개 API 파일 작성**

`lib/domain/index.ts`:

```ts
export * from "./errors";
export * from "./currency";
export * from "./fixed";
export * from "./money";
export * from "./rate";
export * from "./split";
export * from "./wallet";
export * from "./balance";
export * from "./settle";
export * from "./display";
```

- [ ] **Step 2: 시나리오·속성 테스트 작성**

`lib/domain/scenarios/scenarios.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeBalances } from "../balance";
import { describeTransfers, tripAverageRate } from "../display";
import { parseRate } from "../fixed";
import { money } from "../money";
import { settle, verifySettlement } from "../settle";
import { scenario1, scenario2, scenario3 } from "./fixtures";

describe("시나리오 1 — 친구 4명 일본 공금 여행", () => {
  const input = scenario1();
  const r = computeBalances(input);

  it("입금 원가: A·B 180,000 / C 182,000 / D 181,000", () => {
    expect(input.contributions.map((c) => c.baseCost)).toEqual([180_000n, 180_000n, 182_000n, 181_000n]);
  });

  it("공금 지출 원가는 이동평균으로, 남은 3,250엔의 원가는 29,372원", () => {
    expect(r.expenseCosts).toEqual(
      new Map([
        ["w1", 271_125n],
        ["w2", 241_753n],
        ["w3", 180_750n],
        ["p1", 91_858n],
      ]),
    );
    expect(r.wallet.pools.get("JPY")).toEqual({ foreignMinor: 3_250n, costMinor: 29_372n });
  });

  it("남은 공금은 입금 원가 비율로 나눠 갖는다", () => {
    expect(r.leftoverShares.get("JPY")).toEqual([
      { memberId: "A", foreignMinor: 809n, costMinor: 7_312n },
      { memberId: "B", foreignMinor: 810n, costMinor: 7_313n },
      { memberId: "C", foreignMinor: 818n, costMinor: 7_394n },
      { memberId: "D", foreignMinor: 813n, costMinor: 7_353n },
    ]);
  });

  it("순잔액: 비싸게 환전한 C가 B보다 덜 낸다, 카드로 대납한 A가 받는다", () => {
    expect(r.balances).toEqual(
      new Map([
        ["A", 68_174n],
        ["B", -23_684n],
        ["C", -21_765n],
        ["D", -22_725n],
      ]),
    );
  });

  it("송금 목록과 외화 표시", () => {
    const t = settle(r.balances, r.memberOrder);
    expect(t).toEqual([
      { from: "B", to: "A", amountMinor: 23_684n },
      { from: "D", to: "A", amountMinor: 22_725n },
      { from: "C", to: "A", amountMinor: 21_765n },
    ]);
    expect(verifySettlement(r.balances, t)).toBe(true);

    const avg = tripAverageRate(r, input.expenses, "JPY", "KRW");
    expect(avg).toBe(90_545_936_599n); // ≈ 905.46원/100엔
    const [first] = describeTransfers(t, "KRW", "JPY", avg, parseRate("890", 100));
    expect(first).toMatchObject({ atAverage: money(2_616n, "JPY"), atToday: money(2_661n, "JPY") });
  });
});

describe("시나리오 2 — 동아리 15명 대만 MT", () => {
  const input = scenario2();
  const r = computeBalances(input);

  it("원가: 현금 43원 / 카드 43.5원+1% / API 43.5원", () => {
    expect(r.expenseCosts).toEqual(
      new Map([
        ["d1-dinner", 193_500n],
        ["d2-bus", 131_805n],
        ["d2-dinner", 104_400n],
      ]),
    );
  });

  it("2일차 합류(M13~15)는 버스만, 저녁 불참(M09~12)은 1일차 저녁+버스만", () => {
    const b = r.balances;
    expect(b.get("M01")).toBe(155_538n);
    expect(b.get("M02")).toBe(93_843n);
    expect(b.get("M03")).toBe(66_438n);
    for (const id of ["M04", "M05", "M06", "M07", "M08"]) expect(b.get(id)).toBe(-37_962n);
    for (const id of ["M09", "M10", "M11", "M12"]) expect(b.get(id)).toBe(-24_912n);
    for (const id of ["M13", "M14", "M15"]) expect(b.get(id)).toBe(-8_787n);
  });

  it("송금 14건 이하, 늦게 합류한 사람의 송금 합은 각자 8,787원", () => {
    const t = settle(r.balances, r.memberOrder);
    expect(verifySettlement(r.balances, t)).toBe(true);
    expect(t.length).toBeLessThanOrEqual(14);
    for (const id of ["M13", "M14", "M15"]) {
      expect(t.filter((x) => x.from === id).reduce((s, x) => s + x.amountMinor, 0n)).toBe(8_787n);
    }
  });
});

describe("시나리오 3 — 혼자 유럽 3개국", () => {
  const input = scenario3();
  const r = computeBalances(input);

  it("정산 없음, 통화별 원가만", () => {
    expect(r.balances).toEqual(new Map([["S", 0n]]));
    expect(settle(r.balances, r.memberOrder)).toEqual([]);
    expect(r.expenseCosts).toEqual(
      new Map([
        ["eur", 180_750n],
        ["chf", 72_000n],
        ["czk", 21_000n],
      ]),
    );
    expect([...r.expenseCosts.values()].reduce((s, v) => s + v, 0n)).toBe(273_750n);
  });
});
```

`lib/domain/properties.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeBalances, type ExpenseInput, type TripInput } from "./balance";
import { parseRate } from "./fixed";
import { money } from "./money";
import { settle, verifySettlement } from "./settle";
import { allocate } from "./split";

const MEMBERS = ["A", "B", "C", "D", "E", "F"];

/** 무작위 여행: 1~6명, 공금 입금, 공금 지출(잔액 부족 포함), 개인 지출 */
const tripArb: fc.Arbitrary<TripInput> = fc
  .integer({ min: 1, max: 6 })
  .chain((n) => {
    const ids = MEMBERS.slice(0, n);
    const member = fc.constantFrom(...ids);
    const subset = fc.subarray(ids, { minLength: 1 });
    const day = fc.integer({ min: 1, max: 9 });
    const contribution = fc.record({
      memberId: member,
      yen: fc.bigInt({ min: 1n, max: 200_000n }),
      won: fc.bigInt({ min: 0n, max: 2_000_000n }),
      day,
    });
    const expense = fc.record({
      wallet: fc.boolean(),
      payer: member,
      yen: fc.bigInt({ min: 1n, max: 100_000n }),
      won: fc.bigInt({ min: 1n, max: 1_000_000n }),
      who: subset,
      day,
    });
    return fc.record({
      ids: fc.constant(ids),
      contributions: fc.array(contribution, { maxLength: 6 }),
      expenses: fc.array(expense, { maxLength: 12 }),
      taker: fc.option(member, { nil: null }),
    });
  })
  .map(({ ids, contributions, expenses, taker }) => ({
    baseCurrency: "KRW",
    members: ids.map((id, i) => ({ id, sortOrder: i })),
    contributions: contributions.map((c, i) => ({
      id: `c${i}`,
      memberId: c.memberId,
      amount: money(c.yen, "JPY"),
      baseCost: c.won,
      occurredAt: `2026-11-0${c.day}T00:00:00.000Z`,
      createdAt: `2026-11-0${c.day}T00:00:00.000Z`,
    })),
    expenses: expenses.map(
      (e, i): ExpenseInput => ({
        id: `e${i}`,
        amount: money(e.yen, "JPY"),
        paidBy: e.wallet ? { kind: "wallet" } : { kind: "member", memberId: e.payer },
        baseCost: e.wallet ? null : e.won,
        occurredAt: `2026-11-0${e.day}T12:00:00.000Z`,
        createdAt: `2026-11-0${e.day}T12:00:00.000Z`,
        splitType: "equal",
        participants: e.who.map((memberId) => ({ memberId, value: 0n })),
        overdraftRate: parseRate("905", 100),
      }),
    ),
    leftover: taker === null ? { kind: "split_by_contribution" } : { kind: "taker", memberId: taker },
  }));

describe("속성", () => {
  it("순잔액 합 = 0, 그리디 송금을 반영하면 모두 0", () => {
    fc.assert(
      fc.property(tripArb, (trip) => {
        const r = computeBalances(trip);
        expect([...r.balances.values()].reduce((s, v) => s + v, 0n)).toBe(0n);
        expect(verifySettlement(r.balances, settle(r.balances, r.memberOrder))).toBe(true);
      }),
    );
  });

  it("공금 원가 보존: Σ입금 원가 = Σ공금 지출 원가 + 남은 원가", () => {
    fc.assert(
      fc.property(tripArb, (trip) => {
        const r = computeBalances(trip);
        const contributed = trip.contributions.reduce((s, c) => s + c.baseCost, 0n);
        const spent = trip.expenses
          .filter((e) => e.paidBy.kind === "wallet")
          .reduce((s, e) => s + r.expenseCosts.get(e.id)!, 0n);
        const left = [...r.wallet.pools.values()].reduce((s, p) => s + p.costMinor, 0n);
        expect(spent + left).toBe(contributed);
      }),
    );
  });

  it("결정적: 입력 배열 순서를 섞어도 결과가 같다", () => {
    fc.assert(
      fc.property(tripArb, fc.nat(), (trip, k) => {
        const shuffle = <T>(xs: T[]) => {
          if (xs.length === 0) return xs;
          const i = k % xs.length;
          return [...xs.slice(i), ...xs.slice(0, i)].reverse();
        };
        const a = computeBalances(trip);
        const b = computeBalances({
          ...trip,
          members: [...trip.members].reverse(),
          expenses: shuffle(trip.expenses),
          contributions: shuffle(trip.contributions),
        });
        expect(b.balances).toEqual(a.balances);
        expect(settle(b.balances, b.memberOrder)).toEqual(settle(a.balances, a.memberOrder));
      }),
    );
  });

  it("allocate: 몫의 합 = total, 각 몫은 공정한 몫과 1 이하 차이", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -10_000_000n, max: 10_000_000n }),
        fc.array(fc.bigInt({ min: 1n, max: 1_000n }), { minLength: 1, maxLength: 6 }),
        fc.string(),
        (total, ws, seed) => {
          const weighted = ws.map((weight, i) => ({ memberId: MEMBERS[i]!, weight }));
          const r = allocate(total, weighted, seed, MEMBERS);
          const W = ws.reduce((s, w) => s + w, 0n);
          expect([...r.values()].reduce((s, v) => s + v, 0n)).toBe(total);
          for (const w of weighted) {
            const fair = (total * w.weight) / W;
            const diff = r.get(w.memberId)! - fair;
            expect(diff >= -1n && diff <= 1n).toBe(true);
          }
        },
      ),
    );
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test -- lib/domain/scenarios lib/domain/properties.test.ts`
Expected: scenarios.test.ts FAIL (`./fixtures` 모듈 없음). properties.test.ts는 PASS여야 한다. 이미 구현된 모듈만 쓰기 때문이다. 여기서 실패하면 fast-check가 출력한 반례(Counterexample)를 보고 Task 4~7 구현을 고친다.

- [ ] **Step 4: 시나리오 fixtures 작성**

`lib/domain/scenarios/fixtures.ts`:

```ts
import type { ContributionInput, ExpenseInput, MemberInput, TripInput } from "../balance";
import { parseFeePercent, parseRate } from "../fixed";
import { money, parseMajor } from "../money";
import { resolveCost } from "../rate";

export const at = (day: number, hour = 0) =>
  `2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

const members = (ids: string[]): MemberInput[] => ids.map((id, i) => ({ id, sortOrder: i }));
const everyone = (ids: string[]) => ids.map((memberId) => ({ memberId, value: 0n }));

/**
 * 시나리오 1 — 친구 4명, 일본 3박 4일, 공금 여행 (원본 명세 §12-1)
 * A·B 900원/100엔, C 910원/100엔 환전, D 트래블카드 905원/100엔 충전으로 각자 2만 엔 입금.
 * 공금 지출 3건(전원 균등) 후 3,250엔이 남는다. A가 신용카드(수수료 1.5%)로 1만 엔 대납.
 */
export function scenario1(): TripInput {
  const ids = ["A", "B", "C", "D"];
  const contribution = (id: string, memberId: string, rate: string, travelCard = false): ContributionInput => {
    const amount = money(20_000n, "JPY");
    const cost = resolveCost(
      travelCard
        ? { amount, baseCurrency: "KRW", fundingSource: { currency: "JPY", rate: parseRate(rate, 100), feeRate: 0n } }
        : { amount, baseCurrency: "KRW", userRate: parseRate(rate, 100) },
    );
    return { id, memberId, amount, baseCost: cost.base.amountMinor, occurredAt: at(1), createdAt: at(1) };
  };
  const walletSpend = (id: string, yen: bigint, day: number): ExpenseInput => ({
    id,
    amount: money(yen, "JPY"),
    paidBy: { kind: "wallet" },
    baseCost: null,
    occurredAt: at(day, 12),
    createdAt: at(day, 12),
    splitType: "equal",
    participants: everyone(ids),
    overdraftRate: parseRate("905", 100),
  });
  const card = resolveCost({
    amount: money(10_000n, "JPY"),
    baseCurrency: "KRW",
    fundingSource: { currency: "JPY", rate: null, feeRate: parseFeePercent("1.5") },
    apiRate: parseRate("905", 100),
  });
  return {
    baseCurrency: "KRW",
    members: members(ids),
    contributions: [
      contribution("c-A", "A", "900"),
      contribution("c-B", "B", "900"),
      contribution("c-C", "C", "910"),
      contribution("c-D", "D", "905", true),
    ],
    expenses: [
      walletSpend("w1", 30_000n, 1),
      walletSpend("w2", 26_750n, 2),
      walletSpend("w3", 20_000n, 3),
      {
        id: "p1",
        amount: money(10_000n, "JPY"),
        paidBy: { kind: "member", memberId: "A" },
        baseCost: card.base.amountMinor,
        occurredAt: at(2, 20),
        createdAt: at(2, 20),
        splitType: "equal",
        participants: everyone(ids),
        overdraftRate: null,
      },
    ],
    leftover: { kind: "split_by_contribution" },
  };
}

/**
 * 시나리오 2 — 동아리 15명, 대만 MT (원본 명세 §12-2)
 * M13~M15는 2일차 합류, 2일차 저녁은 M01~M08 8명만.
 */
export function scenario2(): TripInput {
  const ids = Array.from({ length: 15 }, (_, i) => `M${String(i + 1).padStart(2, "0")}`);
  const twd = (s: string) => parseMajor(s, "TWD");
  const personal = (
    id: string,
    payer: string,
    amount: string,
    who: string[],
    day: number,
    cost: Parameters<typeof resolveCost>[0],
  ): ExpenseInput => ({
    id,
    amount: twd(amount),
    paidBy: { kind: "member", memberId: payer },
    baseCost: resolveCost(cost).base.amountMinor,
    occurredAt: at(day, 19),
    createdAt: at(day, 19),
    splitType: "equal",
    participants: everyone(who),
    overdraftRate: null,
  });
  const api = parseRate("43.5");
  return {
    baseCurrency: "KRW",
    members: members(ids),
    contributions: [],
    expenses: [
      personal("d1-dinner", "M01", "4500", ids.slice(0, 12), 1, {
        amount: twd("4500"),
        baseCurrency: "KRW",
        fundingSource: { currency: "TWD", rate: parseRate("43"), feeRate: 0n },
      }),
      personal("d2-bus", "M02", "3000", ids, 2, {
        amount: twd("3000"),
        baseCurrency: "KRW",
        fundingSource: { currency: "TWD", rate: null, feeRate: parseFeePercent("1") },
        apiRate: api,
      }),
      personal("d2-dinner", "M03", "2400", ids.slice(0, 8), 2, {
        amount: twd("2400"),
        baseCurrency: "KRW",
        apiRate: api,
      }),
    ],
    leftover: { kind: "split_by_contribution" },
  };
}

/** 시나리오 3 — 혼자 유럽 3개국 (원본 명세 §12-3): EUR·CHF·CZK, 정산 없이 가계부 */
export function scenario3(): TripInput {
  const solo = (id: string, amount: string, currency: string, rate: string, day: number): ExpenseInput => {
    const a = parseMajor(amount, currency);
    return {
      id,
      amount: a,
      paidBy: { kind: "member", memberId: "S" },
      baseCost: resolveCost({ amount: a, baseCurrency: "KRW", apiRate: parseRate(rate) }).base.amountMinor,
      occurredAt: at(day),
      createdAt: at(day),
      splitType: "equal",
      participants: [{ memberId: "S", value: 0n }],
      overdraftRate: null,
    };
  };
  return {
    baseCurrency: "KRW",
    members: members(["S"]),
    contributions: [],
    expenses: [
      solo("eur", "120.50", "EUR", "1500", 1),
      solo("chf", "45", "CHF", "1600", 3),
      solo("czk", "350", "CZK", "60", 5),
    ],
    leftover: { kind: "split_by_contribution" },
  };
}
```

- [ ] **Step 5: 전체 통과 확인**

Run: `npm test && npm run typecheck && npm run lint`
Expected: Test Files 10 passed, Tests 102 passed (개수는 대략 이 정도. 실패 0이 기준). 타입·린트 오류 없음

- [ ] **Step 6: 손 검산 문서 작성**

`docs/scenarios.md`:

````markdown
# 정산 시나리오 손 검산

`lib/domain/scenarios/fixtures.ts`의 값을 사람이 직접 계산해 엔진 결과(`scenarios.test.ts`)와 맞춰 본 기록이다. 엔진을 바꿔 이 숫자가 달라지면, 테스트를 고치기 전에 이 문서부터 다시 검산한다.

## 시나리오 1 — 친구 4명, 일본 3박 4일, 공금 여행

환율 표기는 "원/100엔"이다. 엔진 내부에서는 1엔당 값으로 쓴다(905원/100엔 = 9.05원/엔).

### 1. 공금 입금 (각자 20,000엔)

| 멤버 | 환전 | 입금 원가 |
|---|---|---|
| A | 현금 900 | 20,000 × 9.00 = **180,000** |
| B | 현금 900 | **180,000** |
| C | 현금 910 | 20,000 × 9.10 = **182,000** |
| D | 트래블카드 905 (수수료 0) | 20,000 × 9.05 = **181,000** |

풀: 80,000엔 / 723,000원

### 2. 공금 지출 (전원 균등, 이동평균 원가)

| 지출 | 계산 | 원가 | 지출 후 풀 |
|---|---|---|---|
| w1 30,000엔 | 723,000 × 30,000 ÷ 80,000 | **271,125** | 50,000엔 / 451,875원 |
| w2 26,750엔 | 451,875 × 26,750 ÷ 50,000 = 241,753.125 | **241,753** | 23,250엔 / 210,122원 |
| w3 20,000엔 | 210,122 × 20,000 ÷ 23,250 = 180,750.11 | **180,750** | 3,250엔 / 29,372원 |

보존 검산: 271,125 + 241,753 + 180,750 + 29,372 = 723,000 ✓

### 3. A의 카드 대납

p1 10,000엔, API 9.05원/엔, 수수료 1.5%: 10,000 × 9.05 × 1.015 = 91,857.5 → **91,858**

### 4. 각자 부담분

- 공금 지출 합 693,628 ÷ 4 = 173,407
- p1 91,858 ÷ 4 = 22,964.5
- 지출마다 생기는 1원 나머지가 해시로 정한 시작점부터 분배되어, A·D는 **196,372**, B·C는 **196,371**을 부담한다.
- 합 785,486 = 693,628 + 91,858 ✓

### 5. 남은 공금 3,250엔 (원가 29,372원)을 입금 원가 비율로

비율 180,000 : 180,000 : 182,000 : 181,000

| 멤버 | 정확한 몫 | 원가 | 외화 |
|---|---|---|---|
| A | 7,312.3 | 7,312 | 809엔 |
| B | 7,312.3 | 7,313 | 810엔 |
| C | 7,393.9 | 7,394 | 818엔 |
| D | 7,353.3 | 7,353 | 813엔 |

남는 2원은 B·C에게 간다. 외화 합은 3,250엔이다.

### 6. 순잔액

- A = 180,000 + 91,858 − 196,372 − 7,312 = **+68,174**
- B = 180,000 − 196,371 − 7,313 = **−23,684**
- C = 182,000 − 196,371 − 7,394 = **−21,765**
- D = 181,000 − 196,372 − 7,353 = **−22,725**
- 합 = 0 ✓

**직관 확인**: C는 B보다 2,000원 비싸게 환전했다. 남은 공금도 81원어치 더 가져가므로 B보다 2,000 − 81 = **1,919원 덜 낸다** (23,684 − 21,765 = 1,919 ✓). "오늘 환율 하나로 일괄 계산"했다면 C가 2,000원을 손해 봤을 것이다.

### 7. 송금

| 송금 | 원화 | 평균 환율(905.46원/100엔) | 오늘 환율(890원/100엔 가정) |
|---|---|---|---|
| B → A | 23,684원 | ≈ 2,616엔 | ≈ 2,661엔 |
| D → A | 22,725원 | ≈ 2,510엔 | ≈ 2,553엔 |
| C → A | 21,765원 | ≈ 2,404엔 | ≈ 2,446엔 |

평균 환율 = 주 통화(JPY) 지출 원가 합 785,486 ÷ 86,750엔 = 9.0546원/엔

## 시나리오 2 — 동아리 15명, 대만 MT

| 지출 | 결제 | 원가 | 참여 | 1인 부담 |
|---|---|---|---|---|
| 1일차 저녁 4,500 TWD | M01 현금 43원 | 193,500 | M01~M12 | 16,125 |
| 2일차 버스 3,000 TWD | M02 카드 43.5원 + 1% | 131,805 | 전원 15명 | 8,787 |
| 2일차 저녁 2,400 TWD | M03 API 43.5원 | 104,400 | M01~M08 | 13,050 |

- M01 = 193,500 − 16,125 − 8,787 − 13,050 = **+155,538**
- M02 = 131,805 − 37,962 = **+93,843**
- M03 = 104,400 − 37,962 = **+66,438**
- M04~M08 = **−37,962**
- M09~M12 = −16,125 − 8,787 = **−24,912**
- M13~M15 (2일차 합류) = **−8,787** (버스만)
- 합: 315,819 − (5×37,962 + 4×24,912 + 3×8,787) = 315,819 − 315,819 = 0 ✓

## 시나리오 3 — 혼자 유럽 3개국

EUR 120.50 × 1,500 = 180,750 / CHF 45 × 1,600 = 72,000 / CZK 350 × 60 = 21,000 → 총 **273,750원**. 멤버가 1명이라 순잔액 0, 송금 없음.
````

- [ ] **Step 7: 커밋**

```bash
git add lib/domain/index.ts lib/domain/scenarios lib/domain/properties.test.ts docs/scenarios.md
git commit -m "test(domain): 원본 명세 시나리오 3개와 속성 테스트, 손 검산 기록

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: 푸시**

```bash
git push
```

Expected: `main -> main`

---

## 완료 기준 (설계 §6 SP1)

- `npm test`, `npm run typecheck`, `npm run lint`가 모두 통과한다
- 시나리오 1의 엔진 결과가 `docs/scenarios.md` 손 검산 값과 같다 (A +68,174 / B −23,684 / C −21,765 / D −22,725)
- 속성 테스트 4종(Σ순잔액 = 0, 공금 원가 보존, 결정성, allocate 공정성)이 통과한다
