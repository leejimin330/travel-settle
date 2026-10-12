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
