import { normalizeIdentifier } from './identifier.util';

describe('normalizeIdentifier', () => {
  it('lowercases and trims email', () => {
    const result = normalizeIdentifier('  User@Example.COM  ');
    expect(result).toEqual({ kind: 'EMAIL', normalized: 'user@example.com' });
  });

  it('converts Vietnamese phone to E.164 with default region VN', () => {
    const result = normalizeIdentifier('0912345678');
    expect(result).toEqual({ kind: 'PHONE', normalized: '+84912345678' });
  });

  it('converts international phone with + prefix', () => {
    const result = normalizeIdentifier('+84912345678');
    expect(result).toEqual({ kind: 'PHONE', normalized: '+84912345678' });
  });

  it('throws on garbage input', () => {
    expect(() => normalizeIdentifier('not-an-identifier')).toThrow('Invalid identifier');
  });

  it('throws on empty string', () => {
    expect(() => normalizeIdentifier('   ')).toThrow('Invalid identifier');
  });
});
