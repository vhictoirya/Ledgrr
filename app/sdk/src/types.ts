export interface X402PaymentPayload {
  x402Version: number;
  amount: string;
  to: string;
  chain: string;
  txHash: string;
  timestamp: number;
  scheme?: string;
  network?: string;
}

export interface X402Challenge {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    payTo: string;
    maxTimeoutSeconds: number;
    asset: string;
    extra?: Record<string, unknown>;
  }>;
  error: string;
}

export interface VerifyResponse {
  valid: boolean;
  paymentId?: string;
  grossAmount?: string;
  facilitatorFee?: string;
  error?: string;
}

export interface FacilitatorInfo {
  address: string;
  endpoint: string;
  feeBps: number;
  status: string;
}
