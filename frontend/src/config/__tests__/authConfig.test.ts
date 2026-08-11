import { afterEach, describe, expect, it, vi } from 'vitest';

interface AuthEnvironment {
  dev: boolean;
  localPreview: boolean;
  spaClientId: string;
  backendClientId: string;
  tenantId: string;
}

const loadAuthConfig = async ({
  dev,
  localPreview,
  spaClientId,
  backendClientId,
  tenantId,
}: AuthEnvironment) => {
  vi.resetModules();
  vi.stubEnv('DEV', dev);
  vi.stubEnv('VITE_LOCAL_PREVIEW', String(localPreview));
  vi.stubEnv('VITE_ENTRA_SPA_CLIENT_ID', spaClientId);
  vi.stubEnv('VITE_ENTRA_BACKEND_CLIENT_ID', backendClientId);
  vi.stubEnv('VITE_ENTRA_TENANT_ID', tenantId);

  return import('../../config/authConfig');
};

const productionEnvironment: AuthEnvironment = {
  dev: true,
  localPreview: false,
  spaClientId: 'spa-client-id',
  backendClientId: '',
  tenantId: 'tenant-id',
};

describe('authConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the SPA client ID for scopes when the backend client ID is not set', async () => {
    const { loginRequest, tokenRequest } = await loadAuthConfig(productionEnvironment);

    expect(loginRequest.scopes).toEqual(['api://spa-client-id/Chat.ReadWrite']);
    expect(tokenRequest.scopes).toEqual(['api://spa-client-id/Chat.ReadWrite']);
  });

  it('uses the backend client ID for scopes when it is set', async () => {
    const { loginRequest, tokenRequest } = await loadAuthConfig({
      ...productionEnvironment,
      backendClientId: 'backend-client-id',
    });

    expect(loginRequest.scopes).toEqual(['api://backend-client-id/Chat.ReadWrite']);
    expect(tokenRequest.scopes).toEqual(['api://backend-client-id/Chat.ReadWrite']);
  });

  it('rejects missing Entra values outside local preview', async () => {
    await expect(loadAuthConfig({
      ...productionEnvironment,
      spaClientId: '',
      tenantId: '',
    })).rejects.toThrow('VITE_ENTRA_SPA_CLIENT_ID is not set');
  });

  it('uses empty scopes and placeholder MSAL configuration only for development local preview', async () => {
    const { isLocalPreview, loginRequest, msalConfig, tokenRequest } = await loadAuthConfig({
      dev: true,
      localPreview: true,
      spaClientId: '',
      backendClientId: '',
      tenantId: '',
    });

    expect(isLocalPreview).toBe(true);
    expect(loginRequest.scopes).toEqual([]);
    expect(tokenRequest.scopes).toEqual([]);
    expect(msalConfig.auth.clientId).toBe('00000000-0000-0000-0000-000000000000');
    expect(msalConfig.auth.authority).toBe('https://login.microsoftonline.com/organizations');
  });

  it('does not allow local preview to bypass authentication in a production build', async () => {
    await expect(loadAuthConfig({
      dev: false,
      localPreview: true,
      spaClientId: '',
      backendClientId: '',
      tenantId: '',
    })).rejects.toThrow('VITE_ENTRA_SPA_CLIENT_ID is not set');
  });
});
