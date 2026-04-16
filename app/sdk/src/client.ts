/**
 * X402Client — used server-side by merchants to verify payments
 * and client-side by payers to discover facilitators + submit payments.
 */

import axios, { AxiosInstance } from "axios";
import type {
  X402PaymentPayload,
  VerifyResponse,
  X402Challenge,
  FacilitatorInfo,
} from "./types.js";

export interface X402ClientOptions {
  /** URL of the facilitator node (e.g. https://node1.x402.network) */
  facilitatorUrl: string;
  /** Optional: timeout in ms (default: 10000) */
  timeout?: number;
}

export class X402Client {
  private http: AxiosInstance;
  private facilitatorUrl: string;

  constructor(options: X402ClientOptions) {
    this.facilitatorUrl = options.facilitatorUrl.replace(/\/$/, "");
    this.http = axios.create({
      baseURL: `${this.facilitatorUrl}/api`,
      timeout: options.timeout ?? 10_000,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Verify a payment with the facilitator.
   * Called by merchants after receiving the X-PAYMENT header from a client.
   */
  async verify(
    payment: X402PaymentPayload,
    expectedAmount: string,
    expectedRecipient: string
  ): Promise<VerifyResponse> {
    const { data } = await this.http.post<VerifyResponse>("/verify", {
      payment,
      expectedAmount,
      expectedRecipient,
    });
    return data;
  }

  /**
   * Get a payment challenge for a resource.
   * Returns the 402 body merchants should forward to clients.
   */
  async getChallenge(params: {
    amount: string;
    currency?: string;
    recipient: string;
    resource: string;
  }): Promise<X402Challenge> {
    const { data } = await this.http.get<X402Challenge>("/challenge", { params });
    return data;
  }

  /** Get list of active facilitators for load-balancing / redundancy */
  async getFacilitators(): Promise<FacilitatorInfo[]> {
    const { data } = await this.http.get<{ facilitators: FacilitatorInfo[] }>("/facilitators");
    return data.facilitators;
  }

  /** Health check */
  async ping(): Promise<boolean> {
    try {
      await this.http.get("/health");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parse the X-PAYMENT header from an incoming request.
   * The header value is base64-encoded JSON of X402PaymentPayload.
   */
  static parsePaymentHeader(header: string | undefined): X402PaymentPayload | null {
    if (!header) return null;
    try {
      const decoded = Buffer.from(header, "base64").toString("utf-8");
      return JSON.parse(decoded) as X402PaymentPayload;
    } catch {
      return null;
    }
  }

  /**
   * Encode a payment payload into the X-PAYMENT header format.
   * Used by client-side code after submitting a transaction.
   */
  static encodePaymentHeader(payment: X402PaymentPayload): string {
    return Buffer.from(JSON.stringify(payment)).toString("base64");
  }
}
