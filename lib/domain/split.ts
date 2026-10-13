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
