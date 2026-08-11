import {
  AuthenticatedTemplate,
  UnauthenticatedTemplate,
  useMsalAuthentication,
} from "@azure/msal-react";
import { InteractionType } from "@azure/msal-browser";
import { Spinner } from "@fluentui/react-components";
import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { AgentChat } from "./components/AgentChat";
import { ErrorBoundary } from "./components/core/ErrorBoundary";
import {
  isLocalPreview,
  loginRequest,
} from "./config/authConfig";
import { useAppState } from "./hooks/useAppState";
import { useAuth } from "./hooks/useAuth";
import type { IAgentMetadata } from "./types/chat";

import "./App.css";

const previewMetadata: IAgentMetadata = {
  id: "ida-local-preview",
  object: "agent",
  createdAt: Date.now() / 1000,
  name: "IDA",
  description:
    "Network Rail's Investment and Delivery Assistant",
  model: "gpt-5.6-terra",
  metadata: {
    logo: "Avatar_Default.svg",
  },
};

function PreviewApp() {
  useEffect(() => {
    document.title =
      "IDA | Investment and Delivery Assistant";
  }, []);

  return (
    <ErrorBoundary>
      <div className="app-container">
        <AgentChat
          agentId={previewMetadata.id}
          agentName={previewMetadata.name}
          agentDescription={
            previewMetadata.description || undefined
          }
          agentLogo={previewMetadata.metadata?.logo}
          starterPrompts={
            previewMetadata.starterPrompts || undefined
          }
        />
      </div>
    </ErrorBoundary>
  );
}

function AuthenticatedApp() {
  useMsalAuthentication(
    InteractionType.Redirect,
    loginRequest
  );

  const { auth } = useAppState();
  const { getAccessToken } = useAuth();

  const [agentMetadata, setAgentMetadata] =
    useState<IAgentMetadata | null>(null);

  const [isLoadingAgent, setIsLoadingAgent] =
    useState(true);

  const fetchAgentMetadata = useCallback(async () => {
    if (auth.status !== "authenticated") return;

    try {
      const token = await getAccessToken();
      const apiUrl =
        import.meta.env.VITE_API_URL || "/api";

      const response = await fetch(
        `${apiUrl}/agent`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const data = await response.json();
      setAgentMetadata(data);

      document.title = data.name
        ? `${data.name} - IDA`
        : "IDA";
    } catch (error) {
      console.error(
        "Error fetching agent metadata:",
        error
      );

      setAgentMetadata({
        id: "fallback-agent",
        object: "agent",
        createdAt: Date.now() / 1000,
        name: "IDA",
        description:
          "Network Rail's Investment and Delivery Assistant",
        model: "gpt-5.6-terra",
        metadata: {
          logo: "Avatar_Default.svg",
        },
      });

      document.title = "IDA";
    } finally {
      setIsLoadingAgent(false);
    }
  }, [auth.status, getAccessToken]);

  useEffect(() => {
    fetchAgentMetadata();
  }, [fetchAgentMetadata]);

  return (
    <ErrorBoundary>
      {auth.status === "initializing" || isLoadingAgent ? (
        <div
          className="app-container"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <Spinner size="large" />

          <p style={{ margin: 0 }}>
            {auth.status === "initializing"
              ? "Preparing your session..."
              : "Loading IDA..."}
          </p>
        </div>
      ) : (
        <>
          <AuthenticatedTemplate>
            {agentMetadata && (
              <div className="app-container">
                <AgentChat
                  agentId={agentMetadata.id}
                  agentName={agentMetadata.name}
                  agentDescription={
                    agentMetadata.description || undefined
                  }
                  agentLogo={agentMetadata.metadata?.logo}
                  starterPrompts={
                    agentMetadata.starterPrompts || undefined
                  }
                />
              </div>
            )}
          </AuthenticatedTemplate>

          <UnauthenticatedTemplate>
            <div
              className="app-container"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100vh",
              }}
            >
              <p>Signing in...</p>
            </div>
          </UnauthenticatedTemplate>
        </>
      )}
    </ErrorBoundary>
  );
}

function App() {
  return isLocalPreview ? (
    <PreviewApp />
  ) : (
    <AuthenticatedApp />
  );
}

export default App;