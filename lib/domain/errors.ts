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
