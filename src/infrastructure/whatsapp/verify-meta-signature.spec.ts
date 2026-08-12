import { createHmac } from 'crypto';
import { verifyMetaSignature } from './verify-meta-signature';

const APP_SECRET = 'test-app-secret';

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifyMetaSignature', () => {
  it('accepts a correctly signed body', () => {
    const body = Buffer.from('{"entry":[]}');
    const signature = sign(body.toString());

    expect(verifyMetaSignature(body, signature, APP_SECRET)).toBe(true);
  });

  it('rejects a body signed with the wrong secret (forged request)', () => {
    const body = Buffer.from('{"entry":[]}');
    const signature = sign(body.toString(), 'wrong-secret');

    expect(verifyMetaSignature(body, signature, APP_SECRET)).toBe(false);
  });

  it('rejects when the body was tampered with after signing', () => {
    const signature = sign('{"entry":[]}');
    const tamperedBody = Buffer.from('{"entry":["injected"]}');

    expect(verifyMetaSignature(tamperedBody, signature, APP_SECRET)).toBe(
      false,
    );
  });

  it('rejects a missing signature header', () => {
    expect(verifyMetaSignature(Buffer.from('{}'), undefined, APP_SECRET)).toBe(
      false,
    );
  });

  it('rejects a malformed signature header (no algo prefix)', () => {
    expect(
      verifyMetaSignature(
        Buffer.from('{}'),
        'not-a-real-signature',
        APP_SECRET,
      ),
    ).toBe(false);
  });

  it('rejects a signature using an unsupported algorithm', () => {
    const body = Buffer.from('{"entry":[]}');
    const sha1ish = `sha1=${createHmac('sha1', APP_SECRET).update(body).digest('hex')}`;

    expect(verifyMetaSignature(body, sha1ish, APP_SECRET)).toBe(false);
  });
});
