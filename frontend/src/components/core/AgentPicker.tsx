import { useMemo } from 'react';
import { Dropdown, Option, Label } from '@fluentui/react-components';

interface AgentOption {
  id: string;
  name: string;
}

interface AgentPickerProps {
  agents: AgentOption[];
  selectedAgentId: string;
  onAgentChange: (agentId: string) => void;
  disabled?: boolean;
}

export function AgentPicker({ agents, selectedAgentId, onAgentChange, disabled }: AgentPickerProps) {
  const selectedText = useMemo(
    () => agents.find((a) => a.id === selectedAgentId)?.name ?? selectedAgentId,
    [agents, selectedAgentId]
  );

  const selectedOptions = useMemo(() => [selectedAgentId], [selectedAgentId]);

  return (
    <>
      <Label htmlFor="AgentPickerDropdown">Agent</Label>
      <Dropdown
        id="AgentPickerDropdown"
        onOptionSelect={(_, { optionValue }) => {
          if (optionValue !== undefined) {
            onAgentChange(optionValue);
          }
        }}
        selectedOptions={selectedOptions}
        value={selectedText}
        disabled={disabled}
      >
        {agents.map((agent) => (
          <Option key={agent.id} value={agent.id}>
            {agent.name}
          </Option>
        ))}
      </Dropdown>
    </>
  );
}
