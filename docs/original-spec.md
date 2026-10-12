# 외화 여행 지출·정산 웹서비스 (가칭: 트래블 정산)

> 이 문서는 Claude Code로 개발을 진행하기 위한 프로젝트 명세입니다.
> 구현 시 이 문서의 원칙(특히 "금액 처리 규칙"과 "환율 스냅샷")을 반드시 지켜 주세요.

---

## 1. 프로젝트 개요

해외여행 중 발생하는 외화 지출을 기록하고, 여행 종료 후 멤버 간 더치페이 정산을 쉽게 해주는 **웹 서비스(PWA)**.

### 핵심 문제
- 멤버마다 돈을 마련한 경로가 다름 (출국 전 현금 환전 / 트래블카드 / 일반 신용카드 등) → 실제 적용 환율과 수수료가 서로 다름
- 기존 정산 앱들은 "오늘 환율" 하나로 일괄 계산 → 누군가는 손해
- 공금(모임 지갑)과 개인 대납이 섞이면 정산이 꼬임
- 다국가 여행 시 통화가 여러 개 섞임

### 한 줄 차별점
**"환율 때문에 손해 보는 사람이 없는 여행 정산"**
- 결제수단별 실제 환율·수수료 반영
- 공금 지갑을 1급 기능으로 지원
- 가입 없이 링크만으로 참여

### 서비스 형태
- 독립 웹 서비스 (PWA, 모바일 브라우저 우선)
- 혼자 여행 / 커플 / 친구 소그룹 / 동아리·워크숍 단체 여행 모두 지원
- 별도 모드 없이 **하나의 데이터 구조**로 모든 유형을 커버

---

## 2. 기술 스택

| 영역 | 선택 |
|---|---|
| 프레임워크 | Next.js (App Router) + TypeScript |
| 스타일 | Tailwind CSS |
| 백엔드/DB | Supabase (PostgreSQL, Auth, Realtime) |
| 인증 | Supabase 익명 로그인 → 선택적으로 정식 계정 전환 |
| 오프라인 | PWA (Service Worker) + IndexedDB (Dexie.js 권장) |
| 환율 데이터 | 한국수출입은행 환율 API 또는 ECB 기반 무료 API (Frankfurter 등) |
| 금액 연산 | 정수 최소 단위 연산 (BigInt 또는 정수), 필요 시 decimal 라이브러리 |
| 테스트 | Vitest (정산 로직 단위 테스트 필수) |

---

## 3. 핵심 개념 (도메인 모델)

```
Trip (여행)
 ├─ Member (멤버) : 참여 기간(선택), 역할(admin/member)
 ├─ Wallet (지갑)
 │    ├─ 공금 지갑 (shared) : 멤버들이 돈을 모아 만든 지갑, 통화별 잔액
 │    └─ 개인 결제 (personal) : 멤버 개인이 직접 결제
 ├─ FundingSource (자금 출처) : 현금 환전 / 트래블카드 / 신용카드 등, 실제 환율·수수료
 ├─ Contribution (공금 입금) : 누가 공금에 얼마를 넣었는지
 └─ Expense (지출)
      ├─ 금액, 통화
      ├─ 결제 주체 (공금 지갑 or 특정 멤버)
      ├─ 결제수단(FundingSource)
      ├─ 적용 환율 스냅샷
      ├─ 참여자 목록 + 분배 방식 (균등 / 금액 지정 / 비율 / 몫(share))
      └─ 카테고리, 메모, 날짜
```

### 유형별 매핑 예시
- 혼자 여행 = 멤버 1명, 정산 없이 가계부로만 사용
- 커플 공금 여행 = 공금 지갑 1개, 대부분 지출이 공금에서 발생
- 단체 여행 = 멤버 다수 + admin 권한 + 부분 참여

---

## 4. 데이터베이스 스키마 (초안)

```sql
trips (
  id uuid pk,
  name text,
  base_currency char(3) default 'KRW',   -- 최종 정산 통화
  start_date date, end_date date,
  invite_code text unique,               -- 링크 초대용
  settlement_mode text,                  -- 'base_actual' | 'foreign' (아래 6장 참고)
  is_finalized boolean default false,
  created_by uuid, created_at timestamptz
)

members (
  id uuid pk,
  trip_id uuid fk,
  user_id uuid null,                     -- 익명/정식 사용자 연결 (없으면 이름만 있는 멤버)
  display_name text,
  role text default 'member',            -- 'admin' | 'member'
  join_date date null, leave_date date null
)

funding_sources (
  id uuid pk,
  trip_id uuid fk,
  member_id uuid fk null,                -- 공금이면 null
  type text,                             -- 'cash_exchange' | 'travel_card' | 'credit_card' | 'other'
  currency char(3),
  rate_to_base numeric(20,10) null,      -- 실제 환전 환율 (사용자 입력 시)
  fee_rate numeric(8,6) default 0,       -- 카드 해외결제 수수료율 등
  label text
)

wallets (
  id uuid pk,
  trip_id uuid fk,
  name text,
  type text                              -- 'shared'
)

contributions (                          -- 공금 입금
  id uuid pk,
  wallet_id uuid fk,
  member_id uuid fk,
  amount_minor bigint,
  currency char(3),
  rate_to_base numeric(20,10),           -- 입금 당시(환전 당시) 환율
  created_at timestamptz
)

expenses (
  id uuid pk,
  trip_id uuid fk,
  amount_minor bigint,                   -- 정수 최소 단위
  currency char(3),
  paid_by_member_id uuid null,
  paid_by_wallet_id uuid null,           -- 둘 중 하나만 non-null
  funding_source_id uuid null,
  rate_snapshot numeric(20,10),          -- 입력 시점 적용 환율 (절대 사후 변경 금지, 수정 시 새 값 기록)
  rate_source text,                      -- 'user' | 'api' | 'funding_source'
  split_type text,                       -- 'equal' | 'exact' | 'percent' | 'shares'
  category text, memo text,
  spent_at timestamptz,
  created_by uuid, created_at timestamptz,
  deleted_at timestamptz null            -- soft delete
)

expense_participants (
  expense_id uuid fk,
  member_id uuid fk,
  value bigint                           -- split_type에 따라 금액/비율/몫
)

expense_history (                        -- 수정 이력 (단체 여행 분쟁 방지)
  id uuid pk,
  expense_id uuid fk,
  changed_by uuid,
  before jsonb, after jsonb,
  changed_at timestamptz
)
```

- 모든 테이블에 Supabase RLS 적용: 해당 trip의 멤버만 읽기/쓰기 가능
- `is_finalized = true` 이후에는 admin만 수정 가능

---

## 5. 금액 처리 규칙 (필수)

1. **float 사용 금지.** 모든 금액은 통화의 최소 단위 정수(`amount_minor`)로 저장·연산
2. 통화별 소수점 자릿수 테이블을 둘 것 (ISO 4217 기준)
   - 0자리: KRW, JPY, VND, TWD(실사용 기준 0) 등
   - 2자리: USD, EUR, CHF, THB 등
   - 3자리: KWD, BHD 등
3. 균등 분배 시 나누어떨어지지 않는 나머지는 **결정적 규칙**으로 배분 (예: 멤버 정렬 순서대로 1단위씩) — 매번 같은 결과가 나와야 함
4. 환율 변환은 고정 소수 연산 후 마지막에 한 번만 반올림
5. 정산 결과 전체 합계가 0이 되는지 테스트로 검증

---

## 6. 환율 처리

### 환율 스냅샷 원칙
- 지출 입력 시 적용된 환율을 `rate_snapshot`에 저장
- 이후 시장 환율이 바뀌어도 과거 지출의 원화 환산액은 변하지 않음

### 환율 결정 우선순위
1. 사용자가 해당 지출에 직접 입력한 환율
2. 결제수단(FundingSource)에 등록된 실제 환전 환율 (+ 수수료율 반영)
3. 지출 날짜 기준 API 환율 (주말·공휴일은 직전 영업일 값)

### 정산 모드 (`settlement_mode`)
- **base_actual (기본)** : 각자 실제로 지불한 원화 기준으로 정산. 결제수단별 환율·수수료가 반영됨 → 서비스 핵심 차별점
- **foreign** : 외화 금액 그대로 정산 후, 마지막에 단일 환율로 원화 환산 (단순 모드)

여행 생성 시 기본값은 base_actual, 설정에서 변경 가능하도록.

---

## 7. 공금 지갑 로직

- 멤버가 공금에 입금 → `contributions` 기록 (입금 당시 환율 포함)
- 공금에서 지출 → `expenses.paid_by_wallet_id`
- 지갑 잔액 = Σ입금 − Σ지출 (통화별)
- **남은 공금 처리**: 여행 종료 시 잔액을 입금 비율대로 돌려받은 것으로 처리하거나, 특정 멤버가 잔여 외화를 가져가고 그 가치만큼 정산에 반영 (선택 UI 제공)
- 공금 잔액이 음수가 되면 경고 표시 (누군가 대납 중이라는 뜻)

---

## 8. 정산 알고리즘

1. 각 멤버의 순잔액(net balance) 계산
   - (+) 본인이 낸 금액 + 공금 입금액
   - (−) 본인이 참여한 지출의 부담분 + 공금 잔여 반환분
2. 순잔액을 base_currency(원화) 기준으로 산출
3. **그리디 매칭**: 가장 많이 받을 사람과 가장 많이 줄 사람을 반복 매칭하여 송금 목록 생성
   - 송금 횟수 엄밀 최소화는 NP-hard이므로 그리디로 충분
4. 결과: `[{from, to, amount}]` 목록
5. 단위 테스트 케이스 필수
   - 2인 단순 케이스 / 4인 공금 + 개인 대납 혼합 / 부분 참여 / 다통화 / 나머지 발생 균등분배 / 결제수단별 환율 차이

---

## 9. 오프라인 & 동기화 (PWA)

- Service Worker로 앱 셸 캐싱 → 오프라인에서도 화면 진입 가능
- 지출 입력은 IndexedDB에 먼저 저장 (`pending` 상태) → 온라인 복귀 시 서버 동기화
- 각 레코드는 클라이언트에서 UUID 생성 (오프라인에서도 id 확정)
- **append 위주 설계**: 수정도 이력 레코드를 추가하는 방식으로 처리해 충돌 최소화
- 충돌 시 정책: 마지막 수정 우선(last-write-wins) + 이력에 남겨서 확인 가능하게
- 오프라인 상태에서 API 환율을 못 가져오면 마지막으로 캐싱된 환율 사용 + "임시 환율" 표시, 온라인 복귀 시 사용자에게 갱신 여부 확인

---

## 10. 사용자 흐름

### 여행 만들기
1. 랜딩 → "여행 만들기" (가입 없이 익명 로그인)
2. 여행 이름, 날짜, 방문 국가/통화, 정산 통화(기본 KRW) 입력
3. 멤버 이름 추가 (나중에 링크로 들어온 사람과 매칭)
4. 초대 링크 생성 → 카카오톡 등으로 공유

### 초대받은 사람
1. 링크 클릭 → 가입 없이 바로 입장
2. "나는 누구인가요?" 멤버 목록에서 본인 선택
3. 바로 지출 입력 가능

### 지출 입력 (가장 자주 쓰는 화면, 최대한 빠르게)
- 금액 → 통화(여행 통화 자동 선택) → 누가 냈나(공금/멤버) → 참여자(기본 전체) → 저장
- 결제수단, 카테고리, 메모, 분배 방식은 접힌 상세 옵션으로

### 정산
1. 여행 종료 → admin이 "정산하기"
2. 공금 잔액 처리 방식 선택
3. 송금 목록 표시 + 공유용 이미지 생성
4. 각 송금 항목에 토스/카카오페이 송금 링크(딥링크) 버튼
5. 송금 완료 체크 → 전원 완료 시 여행 확정(finalized)

---

## 11. 개발 단계

### Phase 1 — MVP
- [ ] Next.js + Supabase 프로젝트 세팅, 익명 로그인
- [ ] 여행 생성 / 멤버 관리 / 초대 링크 입장
- [ ] 통화 메타데이터(소수 자릿수) + 금액 유틸 함수 + 테스트
- [ ] 지출 입력 (다통화, 분배 방식 4종, 참여자 선택)
- [ ] 환율 API 연동 + 환율 스냅샷 저장
- [ ] 결제수단(FundingSource) 등록 및 실제 환율·수수료 반영
- [ ] 공금 지갑 (입금/지출/잔액/잔여 처리)
- [ ] 정산 알고리즘 + 단위 테스트
- [ ] 정산 결과 화면 + 공유 이미지 + 송금 링크
- [ ] 모바일 우선 반응형 UI

### Phase 2
- [ ] PWA 오프라인 입력 + 동기화
- [ ] Supabase Realtime으로 멤버 간 실시간 반영
- [ ] admin 권한, 수정 이력 보기, 여행 확정 잠금
- [ ] 멤버별 참여 기간 설정
- [ ] 개인 지출 통계 (카테고리별, 일자별)

### Phase 3
- [ ] 영수증 OCR (일본어 등 다국어) → 금액·항목 자동 입력
- [ ] 영수증 품목 단위 분배
- [ ] 정식 계정 전환 + 내 여행 목록
- [ ] 다국어 UI (영어, 일본어)

---

## 12. 검증용 시나리오

개발 중 아래 시나리오로 정산 결과가 직관과 맞는지 확인할 것.

1. **친구 4명, 일본 3박 4일, 공금 여행**
   - 각자 2만 엔씩 공금 입금 (A·B는 900원/엔에 환전, C는 910원, D는 트래블카드 충전)
   - 대부분 공금 지출, 일부는 A가 신용카드로 대납 (수수료 1.5%)
   - 마지막에 공금 3,250엔 남음
2. **동아리 15명, 대만 MT**
   - admin 2명, 3명은 2일차에 합류
   - 일부 저녁은 8명만 참여
3. **혼자 유럽 3개국 여행**
   - EUR, CHF, CZK 혼합, 정산 없이 개인 가계부로만 사용

---

## 13. 범위 밖 (하지 않을 것)

- 서비스 내 직접 결제·송금 (전자금융 규제 이슈) → 외부 송금 앱 딥링크로 대체
- 은행·카드사 계좌 연동
- 별도 네이티브 앱 (PWA로 대체)

---

## 14. 코드 컨벤션

- TypeScript strict 모드
- 도메인 로직(금액, 환율, 정산)은 UI와 분리된 순수 함수 모듈(`/lib/domain`)로 작성하고 테스트 우선
- 금액을 다루는 모든 함수는 `{ amountMinor: bigint, currency: string }` 형태의 Money 타입 사용
- 커밋 단위는 기능 단위로 작게
