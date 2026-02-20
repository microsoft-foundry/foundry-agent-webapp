import React from 'react';
import {
  Drawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
  Button,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';
import { ThemePicker } from './ThemePicker';
import { AgentPicker } from './AgentPicker';

interface AgentOption {
  id: string;
  name: string;
}

interface SettingsPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  agents?: AgentOption[];
  selectedAgentId?: string;
  onAgentChange?: (agentId: string) => void;
  agentPickerDisabled?: boolean;
}

const useStyles = makeStyles({
  drawer: {
    width: '320px',
  },
  section: {
    marginBottom: tokens.spacingVerticalXXL,
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    marginBottom: tokens.spacingVerticalM,
    color: tokens.colorNeutralForeground1,
  },
});

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onOpenChange, agents, selectedAgentId, onAgentChange, agentPickerDisabled }) => {
  const styles = useStyles();

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(_, { open }) => onOpenChange(open)}
      position="end"
      className={styles.drawer}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              aria-label="Close"
              icon={<Dismiss24Regular />}
              onClick={() => onOpenChange(false)}
            />
          }
        >
          Settings
        </DrawerHeaderTitle>
      </DrawerHeader>

      <DrawerBody>
        {agents && agents.length > 0 && selectedAgentId && onAgentChange && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Agent</div>
            <AgentPicker
              agents={agents}
              selectedAgentId={selectedAgentId}
              onAgentChange={onAgentChange}
              disabled={agentPickerDisabled}
            />
          </div>
        )}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Appearance</div>
          <ThemePicker />
        </div>
      </DrawerBody>
    </Drawer>
  );
};