import { describe, it, expect } from 'vitest';
import { fromShortId, toShortId } from './shortId';

// Oracle: base64url of the UUID's 16 bytes (RFC 4648 §5, unpadded), computed
// independently with Node's Buffer.
const UUID = 'bfe5f9d2-dba3-4d0f-af2d-f55fde1f33a8';
const SHORT = Buffer.from(UUID.replace(/-/g, ''), 'hex').toString('base64url');

describe('shortId', () => {
  it('writes a UUID as 22 base64url characters', () => {
    expect(SHORT).toHaveLength(22);
    expect(toShortId(UUID)).toBe(SHORT);
    expect(toShortId(UUID.toUpperCase())).toBe(SHORT);
  });

  it('reads it back losslessly, for any bytes', () => {
    expect(fromShortId(SHORT)).toBe(UUID);
    for (const u of ['00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'fbefbeff-ef00-4000-8000-0000fbffbfef']) {
      expect(fromShortId(toShortId(u))).toBe(u);
    }
  });

  it('accepts a full UUID written into the URL by hand', () => {
    expect(fromShortId(UUID.toUpperCase())).toBe(UUID);
  });

  it('rejects anything else', () => {
    for (const s of ['', 'kb-1', `${SHORT}x`, SHORT.slice(1), 'not/valid+base64-xxxxxx']) {
      expect(fromShortId(s)).toBeNull();
    }
  });
});
