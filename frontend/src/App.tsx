import { AuthenticatedTemplate, UnauthenticatedTemplate, useMsalAuthentication } from "@azure/msal-react";
import { Spinner } from '@fluentui/react-components';
import { useAppState } from './hooks/useAppState';
import { InteractionType } from "@azure/msal-browser";
import { ErrorBoundary } from "./components/core/ErrorBoundary";
import { AgentPreview } from "./components/AgentPreview";
import { loginRequest } from "./config/authConfig";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "./hooks/useAuth";
import type { IAgentMetadata } from "./types/chat";
import "./App.css";

interface AgentListItem {
  id: string;
  name: string;
  description?: string | null;
  model: string;
  createdAt: number;
}

function App() {
  // This hook handles authentication automatically - redirects if not authenticated
  useMsalAuthentication(InteractionType.Redirect, loginRequest);
  const { auth } = useAppState();
  const { getAccessToken } = useAuth();
  const [agentMetadata, setAgentMetadata] = useState<IAgentMetadata | null>(null);
  const [isLoadingAgent, setIsLoadingAgent] = useState(true);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // Wrap fetchAgentMetadata in useCallback to make it stable for the effect
  const fetchAgentMetadata = useCallback(async () => {
    if (auth.status !== 'authenticated') return;

    try {
      const token = await getAccessToken();
      const apiUrl = import.meta.env.VITE_API_URL || '/api';

      const response = await fetch(`${apiUrl}/agent`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setAgentMetadata(data);

      // Default selection to the configured agent
      setSelectedAgentId((prev) => prev ?? data.id);

      // Update document title with agent name
      document.title = data.name ? `${data.name} - Azure AI Agent` : 'Azure AI Agent';
    } catch (error) {
      console.error('Error fetching agent metadata:', error);
      // Fallback data keeps UI functional on error
      setAgentMetadata({
        id: 'fallback-agent',
        object: 'agent',
        createdAt: Date.now() / 1000,
        name: 'Azure AI Agent',
        description: 'Your intelligent conversational partner powered by Azure AI',
        model: 'gpt-4o-mini',
        metadata: { logo: 'Avatar_Default.svg' }
      });
      document.title = 'Azure AI Agent';
    } finally {
      setIsLoadingAgent(false);
    }
  }, [auth.status, getAccessToken]);

  // Fetch agent list for the picker
  const fetchAgentsList = useCallback(async () => {
    if (auth.status !== 'authenticated') return;

    try {
      const token = await getAccessToken();
      const apiUrl = import.meta.env.VITE_API_URL || '/api';

      const response = await fetch(`${apiUrl}/agents`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setAgents(data.agents ?? []);
    } catch (error) {
      console.error('Error fetching agents list:', error);
    }
  }, [auth.status, getAccessToken]);

  useEffect(() => {
    fetchAgentMetadata();
    fetchAgentsList();
  }, [fetchAgentMetadata, fetchAgentsList]);

  // Derive active agent: use rich metadata for the default agent, list data for others
  const activeAgent = useMemo(() => {
    if (!agentMetadata) return null;

    // If selected agent is the default (configured) agent, use rich metadata
    if (!selectedAgentId || selectedAgentId === agentMetadata.id) {
      return agentMetadata;
    }

    // For non-default agents, use list data
    const listAgent = agents.find((a) => a.id === selectedAgentId);
    if (listAgent) {
      return {
        id: listAgent.id,
        object: 'agent' as const,
        createdAt: listAgent.createdAt,
        name: listAgent.name,
        description: listAgent.description,
        model: listAgent.model,
      } satisfies IAgentMetadata;
    }

    // Fallback to default agent if selected agent not found in list
    return agentMetadata;
  }, [agentMetadata, selectedAgentId, agents]);

  // Agent picker options
  const agentOptions = useMemo(
    () => agents.map((a) => ({ id: a.id, name: a.name })),
    [agents]
  );

  const handleAgentChange = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    const agent = agents.find((a) => a.id === agentId);
    document.title = agent?.name ? `${agent.name} - Azure AI Agent` : 'Azure AI Agent';
  }, [agents]);

  return (
    <ErrorBoundary>
      {auth.status === 'initializing' || isLoadingAgent ? (
        <div className="app-container" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '100vh', 
          flexDirection: 'column', 
          gap: '1rem' 
        }}>
          <Spinner size="large" />
          <p style={{ margin: 0 }}>
            {auth.status === 'initializing' ? 'Preparing your session...' : 'Loading agent...'}
          </p>
        </div>
      ) : (
        <>
          <AuthenticatedTemplate>
            {activeAgent && (
              <div className="app-container">
                <AgentPreview
                  agentId={activeAgent.id}
                  agentName={activeAgent.name}
                  agentDescription={activeAgent.description || undefined}
                  agentLogo={activeAgent.metadata?.logo}
                  starterPrompts={activeAgent.starterPrompts || undefined}
                  agents={agentOptions}
                  selectedAgentId={selectedAgentId ?? activeAgent.id}
                  onAgentChange={handleAgentChange}
                />
              </div>
            )}
          </AuthenticatedTemplate>
          <UnauthenticatedTemplate>
            <div className="app-container" style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              height: '100vh'
            }}>
              <p>Signing in...</p>
            </div>
          </UnauthenticatedTemplate>
        </>
      )}
    </ErrorBoundary>
  );
}

export default App;
