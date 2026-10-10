import type { ZatcaEnvironment } from './csr.js';

/**
 * Fatoora API client — onboarding and transmission. Endpoints, headers and body fields were
 * confirmed against the live gateway (sandbox issued real compliance + production CSIDs).
 *
 *   • clearance header is `Clearance-Status: 1` (a bare `Clearance` is silently ignored → the B2B
 *     invoice would be REPORTED instead of cleared)
 *   • HTTP 303 on clearance means clearance is switched off for this taxpayer → report instead
 *   • 200 accepted · 202 accepted WITH WARNINGS (still legal) · 400 rejected for good · 5xx transport
 *   • response fields really are spelled `qrSellertStatus` / `qrBuyertStatus`
 */
export const BASES: Record<ZatcaEnvironment, string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

/** ZATCA's published sandbox OTP — works on the sandbox only. */
export const SANDBOX_OTP = '123345';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

/** A response ZATCA gave that the document cannot recover from (wrong CSR, spent OTP, …). */
export class ZatcaRejection extends Error {
  readonly retryable = false;
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = 'ZatcaRejection';
  }
}

/** The gateway could not be reached or answered 5xx / 429: nothing is wrong with the document; try again later. */
export class ZatcaTransportError extends Error {
  readonly retryable = true;
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = 'ZatcaTransportError';
  }
}

export interface Verdict {
  httpStatus: number;
  accepted: boolean;
  /** true for 400 / 401 / 403: do not retry */
  permanent: boolean;
  withWarnings: boolean;
  reportingStatus: string | null;
  clearanceStatus: string | null;
  clearedInvoiceXml: string | null;
  warnings: { code?: string; message?: string }[];
  errors: { code?: string; message?: string }[];
  /** clearance was off for this taxpayer, so the document was reported instead */
  clearanceDisabled?: boolean;
  raw: Record<string, unknown>;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Turn a response into a verdict; throws ZatcaTransportError for anything that is ZATCA's problem, not the document's. */
export function interpret(status: number, json: Json): Verdict {
  const v = (json.validationResults ?? {}) as Json;
  const verdict: Verdict = {
    httpStatus: status,
    accepted: false,
    permanent: false,
    withWarnings: false,
    reportingStatus: json.reportingStatus ?? null,
    clearanceStatus: json.clearanceStatus ?? null,
    clearedInvoiceXml: json.clearedInvoice ? Buffer.from(String(json.clearedInvoice), 'base64').toString('utf8') : null,
    warnings: ((v.warningMessages ?? []) as Json[]).map((m) => ({ code: m.code, message: m.message })),
    errors: ((v.errorMessages ?? []) as Json[]).map((m) => ({ code: m.code, message: m.message })),
    raw: json,
  };
  if (status === 200 || status === 202) {
    verdict.accepted = true;
    verdict.withWarnings = status === 202 || verdict.warnings.length > 0;
    return verdict;
  }
  if (status === 400 || status === 401 || status === 403 || status === 409 || status === 422) {
    verdict.permanent = true;
    return verdict;
  }
  throw new ZatcaTransportError(`ZATCA transport failure (HTTP ${status})`, json);
}

export interface Credentials { csid: string; secret: string }

/** HTTP Basic from a CSID pair. The token is used verbatim — it is ALREADY base64; do not re-wrap. */
export function basicAuth(csid: string, secret: string): string {
  return `Basic ${Buffer.from(`${csid}:${secret}`).toString('base64')}`;
}

/** The CSID certificate as PEM. `binarySecurityToken` is base64 OF the base64 DER — decode once. */
export function certificateFromToken(binarySecurityToken: string): string {
  const b64 = Buffer.from(binarySecurityToken, 'base64').toString('utf8');
  return `-----BEGIN CERTIFICATE-----\n${b64.replace(/(.{64})/g, '$1\n').trim()}\n-----END CERTIFICATE-----\n`;
}

export interface IssuedCsid { requestId: string; csid: string; secret: string; certificatePem: string }

export interface FatooraClient {
  readonly environment: ZatcaEnvironment;
  requestComplianceCsid(csrPem: string, otp: string): Promise<IssuedCsid>;
  submitComplianceInvoice(c: Credentials, d: { invoiceHash: string; uuid: string; xml: string }): Promise<Verdict>;
  requestProductionCsid(c: Credentials, complianceRequestId: string): Promise<IssuedCsid>;
  submitInvoice(c: Credentials, d: { invoiceHash: string; uuid: string; xml: string; standard: boolean }): Promise<Verdict>;
}

export function createFatooraClient(opts: { environment: ZatcaEnvironment; fetch?: FetchLike; baseUrl?: string; timeoutMs?: number }): FatooraClient {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init) as never);
  const base = (opts.baseUrl ?? BASES[opts.environment]).replace(/\/$/, '');

  async function call(path: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; json: Json }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Version': 'V2', 'Accept-Language': 'en', ...headers },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      let json: Json = {};
      try { json = ((await res.json()) as Json) ?? {}; } catch { /* some errors carry no body */ }
      return { status: res.status, json };
    } catch (e) {
      throw new ZatcaTransportError(`ZATCA gateway unreachable: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  const issued = (json: Json): IssuedCsid => ({
    requestId: String(json.requestID),
    csid: String(json.binarySecurityToken),
    secret: String(json.secret),
    certificatePem: certificateFromToken(String(json.binarySecurityToken)),
  });

  return {
    environment: opts.environment,
    async requestComplianceCsid(csrPem, otp) {
      const { status, json } = await call('/compliance', { csr: Buffer.from(csrPem, 'utf8').toString('base64') }, { OTP: String(otp) });
      if (status >= 500) throw new ZatcaTransportError(`ZATCA transport failure (HTTP ${status})`, json);
      if (status !== 200 || !json.binarySecurityToken) {
        throw new ZatcaRejection(`ZATCA refused the compliance CSID request (HTTP ${status}). The usual cause is an expired or already-used OTP — request a new one from Fatoora.`, json);
      }
      return issued(json);
    },
    async submitComplianceInvoice(c, d) {
      const { status, json } = await call('/compliance/invoices', { invoiceHash: d.invoiceHash, uuid: d.uuid, invoice: Buffer.from(d.xml, 'utf8').toString('base64') }, { Authorization: basicAuth(c.csid, c.secret) });
      return interpret(status, json);
    },
    async requestProductionCsid(c, complianceRequestId) {
      const { status, json } = await call('/production/csids', { compliance_request_id: String(complianceRequestId) }, { Authorization: basicAuth(c.csid, c.secret) });
      if (status >= 500) throw new ZatcaTransportError(`ZATCA transport failure (HTTP ${status})`, json);
      if (status !== 200 || !json.binarySecurityToken) throw new ZatcaRejection(`ZATCA refused the production CSID (HTTP ${status})`, json);
      return issued(json);
    },
    async submitInvoice(c, d) {
      const headers: Record<string, string> = { Authorization: basicAuth(c.csid, c.secret) };
      if (d.standard) headers['Clearance-Status'] = '1';
      const body = { invoiceHash: d.invoiceHash, uuid: d.uuid, invoice: Buffer.from(d.xml, 'utf8').toString('base64') };
      const res = await call(d.standard ? '/invoices/clearance/single' : '/invoices/reporting/single', body, headers);
      if (res.status === 303 && d.standard) {
        const again = await call('/invoices/reporting/single', body, { Authorization: basicAuth(c.csid, c.secret) });
        return { ...interpret(again.status, again.json), clearanceDisabled: true };
      }
      return interpret(res.status, res.json);
    },
  };
}
