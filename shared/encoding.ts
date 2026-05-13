import type { PaymentRequired, PaymentPayload } from "./types.js";

export function encodePaymentRequired(pr: PaymentRequired): string {
  return btoa(JSON.stringify(pr));
}

export function decodePaymentRequired(encoded: string): PaymentRequired {
  return JSON.parse(atob(encoded));
}

export function encodePaymentPayload(pp: PaymentPayload): string {
  return btoa(JSON.stringify(pp));
}

export function decodePaymentPayload(encoded: string): PaymentPayload {
  return JSON.parse(atob(encoded));
}
