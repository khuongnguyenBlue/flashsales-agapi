export type IdentifierKind = 'EMAIL' | 'PHONE';

export interface NormalizedIdentifier {
  kind: IdentifierKind;
  normalized: string;
}
