import type { ResponseMode } from '../types/chat';

export const IDA_RESPONSE_MODE_STORAGE_KEY = 'ida.response-mode';

const isResponseMode = (value: string | null): value is ResponseMode =>
  value === 'auto' || value === 'simple' || value === 'detailed';

export const getStoredResponseMode = (): ResponseMode => {
  try {
    const storedMode = window.localStorage.getItem(IDA_RESPONSE_MODE_STORAGE_KEY);
    return isResponseMode(storedMode) ? storedMode : 'auto';
  } catch {
    return 'auto';
  }
};

export const setStoredResponseMode = (mode: ResponseMode): void => {
  try {
    window.localStorage.setItem(IDA_RESPONSE_MODE_STORAGE_KEY, mode);
  } catch {
    // The mode remains available for the current component lifetime if storage is unavailable.
  }
};