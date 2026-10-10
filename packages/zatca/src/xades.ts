import { zatcaDigest } from './hash.js';

/**
 * ZATCA XAdES signature block (the ext:UBLExtensions envelope).
 *
 * EVERY BYTE HERE IS LOAD-BEARING and this module emits STRINGS, never a DOM. Four things look like
 * mistakes and are the spec (all verified against SDK 3.4.6 and ZATCA's live sandbox):
 *
 *  1. `<sac:SignatureInformation> ` carries a TRAILING SPACE.
 *  2. The two XAdES digests are base64 of the 64-char HEX string of the SHA-256 — not of the raw digest.
 *  3. CertDigest hashes the certificate's BASE64 TEXT, not its DER bytes.
 *  4. The SignedProperties digest is taken over that subtree serialised with `xmlns:xades` on the
 *     element and `xmlns:ds` re-declared on every ds:* element inside it, with the document's own
 *     indentation (closing tag at 32 spaces) — not how it appears in the finished document. No C14N
 *     variant reproduces it, so `signedPropertiesFor` renders BOTH forms from one template.
 *
 * The block is inserted flush against the root's opening tag, so deleting it again restores the
 * document byte-for-byte — which is what keeps the invoice hash stable across signing.
 */
const XMLNS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const XMLNS_DS = 'http://www.w3.org/2000/09/xmldsig#';

export function signedPropertiesFor(p: { signingTime: string; certDigest: string; issuer: string; serial: string }): { digest: string; embed: string } {
  // Indentation is part of the digest. Do not reflow.
  const body = (dsNs: string) => [
    '                                    <xades:SignedSignatureProperties>',
    `                                        <xades:SigningTime>${p.signingTime}</xades:SigningTime>`,
    '                                        <xades:SigningCertificate>',
    '                                            <xades:Cert>',
    '                                                <xades:CertDigest>',
    `                                                    <ds:DigestMethod${dsNs} Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>`,
    `                                                    <ds:DigestValue${dsNs}>${p.certDigest}</ds:DigestValue>`,
    '                                                </xades:CertDigest>',
    '                                                <xades:IssuerSerial>',
    `                                                    <ds:X509IssuerName${dsNs}>${p.issuer}</ds:X509IssuerName>`,
    `                                                    <ds:X509SerialNumber${dsNs}>${p.serial}</ds:X509SerialNumber>`,
    '                                                </xades:IssuerSerial>',
    '                                            </xades:Cert>',
    '                                        </xades:SigningCertificate>',
    '                                    </xades:SignedSignatureProperties>',
    '                                </xades:SignedProperties>',
  ].join('\n');
  const dsNs = ` xmlns:ds="${XMLNS_DS}"`;
  return {
    digest: `<xades:SignedProperties xmlns:xades="${XMLNS_XADES}" Id="xadesSignedProperties">\n${body(dsNs)}`,
    embed: `                                <xades:SignedProperties Id="xadesSignedProperties">\n${body('')}`,
  };
}

export interface XadesInput {
  /** the invoice hash, base64 of the RAW digest (44 chars) */
  invoiceHashBase64: string;
  /** ECDSA over the raw 32-byte invoice hash */
  signatureBase64: string;
  /** CSID certificate, base64 DER without PEM armour */
  certificateBase64: string;
  /** "YYYY-MM-DDTHH:MM:SS" — no trailing Z */
  signingTime: string;
  issuer: string;
  serial: string;
}

export function buildXadesBlock(p: XadesInput): string {
  const props = signedPropertiesFor({ signingTime: p.signingTime, certDigest: zatcaDigest(p.certificateBase64), issuer: p.issuer, serial: p.serial });
  const propsDigest = zatcaDigest(props.digest);
  return [
    '<ext:UBLExtensions>',
    '    <ext:UBLExtension>',
    '        <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>',
    '        <ext:ExtensionContent>',
    '            <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">',
    '                <sac:SignatureInformation> ',
    '                    <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>',
    '                    <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>',
    `                    <ds:Signature xmlns:ds="${XMLNS_DS}" Id="signature">`,
    '                        <ds:SignedInfo>',
    '                            <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>',
    '                            <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>',
    '                            <ds:Reference Id="invoiceSignedData" URI="">',
    '                                <ds:Transforms>',
    '                                    <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">',
    '                                        <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>',
    '                                    </ds:Transform>',
    '                                    <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">',
    '                                        <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>',
    '                                    </ds:Transform>',
    '                                    <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">',
    "                                        <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>",
    '                                    </ds:Transform>',
    '                                    <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>',
    '                                </ds:Transforms>',
    '                                <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>',
    `                                <ds:DigestValue>${p.invoiceHashBase64}</ds:DigestValue>`,
    '                            </ds:Reference>',
    '                            <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">',
    '                                <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>',
    `                                <ds:DigestValue>${propsDigest}</ds:DigestValue>`,
    '                            </ds:Reference>',
    '                        </ds:SignedInfo>',
    `                        <ds:SignatureValue>${p.signatureBase64}</ds:SignatureValue>`,
    '                        <ds:KeyInfo>',
    '                            <ds:X509Data>',
    `                                <ds:X509Certificate>${p.certificateBase64}</ds:X509Certificate>`,
    '                            </ds:X509Data>',
    '                        </ds:KeyInfo>',
    '                        <ds:Object>',
    `                            <xades:QualifyingProperties xmlns:xades="${XMLNS_XADES}" Target="signature">`,
    props.embed,
    '                            </xades:QualifyingProperties>',
    '                        </ds:Object>',
    '                    </ds:Signature>',
    '                </sac:SignatureInformation>',
    '            </sig:UBLDocumentSignatures>',
    '        </ext:ExtensionContent>',
    '    </ext:UBLExtension>',
    '</ext:UBLExtensions>',
  ].join('\n');
}

/** Splice the block in flush against the root element's opening tag — no whitespace around it. */
export function insertXades(xml: string, block: string): string {
  const m = /<Invoice\b[^>]*>/.exec(xml);
  if (!m) throw new Error('cannot insert XAdES: no Invoice root element found');
  const at = m.index + m[0].length;
  return xml.slice(0, at) + block + xml.slice(at);
}
