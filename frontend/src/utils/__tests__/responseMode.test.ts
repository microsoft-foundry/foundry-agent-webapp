import { beforeEach, describe, expect, it } from 'vitest';
import {
  getStoredResponseMode,
  IDA_RESPONSE_MODE_STORAGE_KEY,
  setStoredResponseMode,
} from '../responseMode';

describe('response mode storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to Auto when no mode has been stored', () => {
    expect(getStoredResponseMode()).toBe('auto');
  });

  it('stores a changed response mode for subsequent conversations', () => {
    setStoredResponseMode('detailed');

    expect(window.localStorage.getItem(IDA_RESPONSE_MODE_STORAGE_KEY)).toBe('detailed');
    expect(getStoredResponseMode()).toBe('detailed');
  });

  it('returns to Auto when the stored mode is cleared', () => {
    setStoredResponseMode('simple');
    window.localStorage.removeItem(IDA_RESPONSE_MODE_STORAGE_KEY);

    expect(getStoredResponseMode()).toBe('auto');
  });

  it('falls back to Auto for an invalid stored value', () => {
    window.localStorage.setItem(IDA_RESPONSE_MODE_STORAGE_KEY, 'unsupported');

    expect(getStoredResponseMode()).toBe('auto');
  });
});