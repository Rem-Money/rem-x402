export type TransferMethod = "eip3009" | "permit2";

export interface TokenConfig {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  version: string;
  eip3009Enabled: boolean;
}

export interface ResourceInfo {
  url: string;
  description: string;
  mimeType: string;
}

export interface PaymentAccept {
  scheme: "exact";
  network: string;
  amount: string;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
    assetTransferMethod: TransferMethod;
  };
}

export interface PaymentRequired {
  x402Version: 2;
  error: string;
  resource: ResourceInfo;
  accepts: PaymentAccept[];
}

export interface EIP3009Authorization {
  method: "eip3009";
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
}

export interface Permit2Authorization {
  method: "permit2";
  from: `0x${string}`;
  to: `0x${string}`;
  token: `0x${string}`;
  amount: string;
  nonce: string;
  deadline: string;
  witness: {
    to: `0x${string}`;
    validAfter: string;
  };
}

export type PaymentAuthorization = EIP3009Authorization | Permit2Authorization;

export interface PaymentPayload {
  x402Version: 2;
  resource: ResourceInfo;
  accepted: PaymentAccept;
  payload: {
    signature: `0x${string}`;
    authorization: PaymentAuthorization;
  };
}

export interface VerifyRequest {
  paymentPayload: string;
  paymentRequirements: PaymentAccept;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
}

export interface SettleRequest {
  paymentPayload: string;
  paymentRequirements: PaymentAccept;
}

export interface SettlementResponse {
  success: boolean;
  transaction?: `0x${string}`;
  network?: string;
  payer?: `0x${string}`;
  error?: string;
}
