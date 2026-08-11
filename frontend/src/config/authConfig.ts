import type { Configuration } from "@azure/msal-browser";
import { LogLevel } from "@azure/msal-browser";

export const isLocalPreview =
  import.meta.env.DEV &&
  import.meta.env.VITE_LOCAL_PREVIEW === "true";

// Real values remain mandatory unless explicit local preview is enabled.
const clientId =
  import.meta.env.VITE_ENTRA_SPA_CLIENT_ID ||
  (isLocalPreview ? "00000000-0000-0000-0000-000000000000" : "");

if (!clientId) {
  throw new Error(
    "VITE_ENTRA_SPA_CLIENT_ID is not set. This must be provided during build time."
  );
}

const tenantId =
  import.meta.env.VITE_ENTRA_TENANT_ID ||
  (isLocalPreview ? "organizations" : "");

if (!tenantId) {
  throw new Error(
    "VITE_ENTRA_TENANT_ID is not set. This must be provided during build time."
  );
}

// When OBO is enabled, scopes target the backend API app instead of the SPA.
const scopeClientId =
  import.meta.env.VITE_ENTRA_BACKEND_CLIENT_ID || clientId;

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      logLevel: import.meta.env.DEV
        ? LogLevel.Info
        : LogLevel.Warning,
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;

        switch (level) {
          case LogLevel.Error:
            console.error(message);
            break;
          case LogLevel.Warning:
            console.warn(message);
            break;
          case LogLevel.Info:
            console.info(message);
            break;
          case LogLevel.Verbose:
            console.debug(message);
            break;
        }
      },
    },
  },
};

export const loginRequest = {
  scopes: isLocalPreview
    ? []
    : [`api://${scopeClientId}/Chat.ReadWrite`],
};

export const tokenRequest = {
  scopes: isLocalPreview
    ? []
    : [`api://${scopeClientId}/Chat.ReadWrite`],
  forceRefresh: false,
};