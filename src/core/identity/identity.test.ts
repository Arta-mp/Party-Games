import { describe, expect, it } from 'vitest';
import { avatarColor, cleanName, newDeviceId, uniqueName, validateName } from './identity';

describe('identity', () => {
  it('validates names: 2–16 chars, fa/en, no extra spaces', () => {
    expect(validateName('علی')).toBe('ok');
    expect(validateName('Sara')).toBe('ok');
    expect(validateName('  مریم   رضایی ')).toBe('ok');
    expect(cleanName('  مریم   رضایی ')).toBe('مریم رضایی');
    expect(validateName('ع')).toBe('short');
    expect(validateName('a'.repeat(17))).toBe('long');
    expect(validateName('ali!')).toBe('chars');
    expect(validateName('علی۲')).toBe('ok');
  });
  it('device ids are random and long', () => {
    const a = newDeviceId();
    expect(a).toMatch(/^d[0-9a-f]{24}$/);
    expect(newDeviceId()).not.toBe(a);
  });
  it('avatar colour is stable per name', () => {
    expect(avatarColor('علی')).toBe(avatarColor('علی'));
    expect(avatarColor('علی')).not.toBe(avatarColor('رضا'));
  });
  it('dedupes names inside a lobby', () => {
    expect(uniqueName('علی', ['رضا'])).toBe('علی');
    expect(uniqueName('علی', ['علی'])).toBe('علی ۲');
    expect(uniqueName('علی', ['علی', 'علی ۲'])).toBe('علی ۳');
  });
});
