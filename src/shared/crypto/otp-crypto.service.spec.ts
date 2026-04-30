import { ConfigService } from '@nestjs/config';
import { OtpCryptoService } from './otp-crypto.service';

const TEST_KEY = 'a'.repeat(64); // 32 bytes as hex

function makeService() {
  const config = { getOrThrow: () => TEST_KEY } as unknown as ConfigService;
  return new OtpCryptoService(config);
}

describe('OtpCryptoService', () => {
  it('decrypts back to the original code', () => {
    const svc = makeService();
    const plain = '482910';
    expect(svc.decrypt(svc.encrypt(plain))).toBe(plain);
  });

  it('produces different ciphertext each call (unique IV)', () => {
    const svc = makeService();
    const a = svc.encrypt('123456');
    const b = svc.encrypt('123456');
    expect(a).not.toBe(b);
  });

  it('rejects tampered ciphertext', () => {
    const svc = makeService();
    const parts = svc.encrypt('999999').split(':');
    parts[2] = 'deadbeef'; // corrupt ciphertext
    expect(() => svc.decrypt(parts.join(':'))).toThrow();
  });

  it('rejects tampered auth tag', () => {
    const svc = makeService();
    const parts = svc.encrypt('111111').split(':');
    parts[1] = 'a'.repeat(32); // corrupt tag
    expect(() => svc.decrypt(parts.join(':'))).toThrow();
  });
});
