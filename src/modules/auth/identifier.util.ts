import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
import { NormalizedIdentifier } from '../../shared/types/identifier.types';

export type { IdentifierKind, NormalizedIdentifier } from '../../shared/types/identifier.types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeIdentifier(
  input: string,
  defaultRegion: string = 'VN',
): NormalizedIdentifier {
  const trimmed = input.trim();

  if (EMAIL_RE.test(trimmed)) {
    return { kind: 'EMAIL', normalized: trimmed.toLowerCase() };
  }

  if (isValidPhoneNumber(trimmed, defaultRegion as Parameters<typeof isValidPhoneNumber>[1])) {
    const parsed = parsePhoneNumber(trimmed, defaultRegion as Parameters<typeof parsePhoneNumber>[1]);
    return { kind: 'PHONE', normalized: parsed.format('E.164') };
  }

  throw new Error('Invalid identifier');
}
