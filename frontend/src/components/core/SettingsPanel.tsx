import React, { useState, useEffect, useCallback } from 'react';
import {
  Drawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
  Button,
  Text,
  Spinner,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  DialogTrigger,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Dismiss24Regular, Delete24Regular } from '@fluentui/react-icons';
import { ThemePicker } from './ThemePicker';
import type { ChatService } from '../../services/chatService';

interface SettingsPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  chatService: ChatService;
}

const useStyles = makeStyles({
  drawer: {
    width: 'min(320px, 100vw)',
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
  filesRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  filesSummary: {
    color: tokens.colorNeutralForeground2,
  },
  filesHint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  status: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  statusError: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorPaletteRedForeground1,
  },
  destructiveButton: {
    backgroundColor: tokens.colorPaletteRedBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    border: 'none',
    ':hover': {
      backgroundColor: tokens.colorPaletteRedForeground1,
      color: tokens.colorNeutralForegroundOnBrand,
    },
    ':hover:active': {
      backgroundColor: tokens.colorPaletteRedForeground3,
      color: tokens.colorNeutralForegroundOnBrand,
    },
  },
});

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onOpenChange, chatService }) => {
  const styles = useStyles();

  const [filesInfo, setFilesInfo] = useState<{ count: number; totalBytes: number } | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadFilesInfo = useCallback(async () => {
    setLoadingInfo(true);
    try {
      const info = await chatService.getUploadedFilesInfo();
      setFilesInfo(info);
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : 'Failed to load file info', isError: true });
    } finally {
      setLoadingInfo(false);
    }
  }, [chatService]);

  useEffect(() => {
    if (isOpen) {
      void loadFilesInfo();
    } else {
      setStatus(null);
    }
  }, [isOpen, loadFilesInfo]);

  // Auto-dismiss successful status after a short delay; errors stay until next action.
  useEffect(() => {
    if (!status || status.isError) return;
    const timer = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const handleCleanup = async () => {
    setConfirmOpen(false);
    setCleaning(true);
    setStatus(null);
    try {
      const result = await chatService.cleanupUploadedFiles();
      const failedNote = result.failed > 0 ? ` (${result.failed} failed)` : '';
      setStatus({ text: `Deleted ${result.deleted} image${result.deleted === 1 ? '' : 's'}${failedNote}`, isError: false });
      await loadFilesInfo();
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : 'Cleanup failed', isError: true });
    } finally {
      setCleaning(false);
    }
  };

  const count = filesInfo?.count ?? 0;
  const canCleanup = !loadingInfo && !cleaning && count > 0;

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
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Appearance</div>
          <ThemePicker />
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Uploaded images</div>
          <div className={styles.filesRow}>
            <Text className={styles.filesSummary}>
              {loadingInfo ? (
                <Spinner size="tiny" label="Loading…" labelPosition="after" />
              ) : filesInfo ? (
                `${count} image${count === 1 ? '' : 's'} (${formatBytes(filesInfo.totalBytes)})`
              ) : (
                '—'
              )}
            </Text>
            <Text className={styles.filesHint}>
              Images you attach in chat are stored in the Foundry project.
            </Text>
            <Dialog open={confirmOpen} onOpenChange={(_, data) => setConfirmOpen(data.open)}>
              <DialogTrigger disableButtonEnhancement>
                <Button
                  appearance="secondary"
                  icon={<Delete24Regular />}
                  disabled={!canCleanup}
                  onClick={() => setConfirmOpen(true)}
                >
                  {cleaning ? 'Cleaning up…' : 'Clean up'}
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>Delete uploaded images?</DialogTitle>
                  <DialogContent>
                    This will delete {count} image{count === 1 ? '' : 's'} previously uploaded
                    by this web app. Images referenced by past conversations will no longer
                    render. This cannot be undone.
                  </DialogContent>
                  <DialogActions>
                    <DialogTrigger disableButtonEnhancement>
                      <Button appearance="primary">Cancel</Button>
                    </DialogTrigger>
                    <Button
                      className={styles.destructiveButton}
                      disabled={cleaning}
                      onClick={handleCleanup}
                    >
                      Delete {count} image{count === 1 ? '' : 's'}
                    </Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
            {status && (
              <Text className={status.isError ? styles.statusError : styles.status}>
                {status.text}
              </Text>
            )}
          </div>
        </div>
      </DrawerBody>
    </Drawer>
  );
};