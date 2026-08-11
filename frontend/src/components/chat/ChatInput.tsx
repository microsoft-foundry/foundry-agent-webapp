import { useState, useRef, useEffect } from 'react';
import {
  ChatInput as ChatInputFluent,
  ImperativeControlPlugin,
  type ImperativeControlPluginRef,
} from '@fluentui-copilot/react-copilot';
import { Button, Toast, ToastTitle, Toaster, useId, useToastController, Text, makeStyles, tokens, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, Select, Tab, TabList, Tooltip } from '@fluentui/react-components';
import { Attach24Regular, Stop24Regular, MoreHorizontal24Regular, History24Regular, Settings24Regular, ChatAdd24Regular, ArrowDownload24Regular, Keyboard24Regular } from '@fluentui/react-icons';
import { FilePreview } from './FilePreview';
import { VoiceInput } from './VoiceInput';
import { MessageQueue } from './MessageQueue';
import { validateFile, validateFileCount } from '../../utils/fileAttachments';
import type { IFileAttachment, PendingChatMessage, ResponseMode } from '../../types/chat';
import styles from './ChatInput.module.css';

const CHAR_WARNING_THRESHOLD = 3000;
const CHAR_DANGER_THRESHOLD = 3500;
const CHAR_MAX_RECOMMENDED = 4000;

const useCharCounterStyles = makeStyles({
  container: {
    display: 'flex',
    justifyContent: 'flex-end',
    paddingRight: tokens.spacingHorizontalM,
    paddingBottom: tokens.spacingVerticalXS,
  },
  text: {
    fontSize: tokens.fontSizeBase200,
  },
  normal: {
    color: tokens.colorNeutralForeground3,
  },
  warning: {
    color: tokens.colorPaletteYellowForeground1,
  },
  danger: {
    color: tokens.colorPaletteDarkOrangeForeground1,
  },
});

interface ChatInputProps {
  onSubmit: (value: string, files?: File[], mode?: ResponseMode) => void;
  responseMode: ResponseMode;
  onResponseModeChange: (mode: ResponseMode) => void;
  disabled?: boolean;
  placeholder?: string;
  onOpenSettings?: () => void;
  onNewChat?: () => void;
  onToggleSidebar?: () => void;
  onExportConversation?: () => void;
  onShowShortcuts?: () => void;
  hasMessages?: boolean;
  isStreaming?: boolean;
  onCancelStream?: () => void;
  isEditing?: boolean;
  onCancelEdit?: () => void;
  recoveredInput?: string;
  recoveredAttachments?: IFileAttachment[];
  recoveredMode?: ResponseMode;
  onRecoveredInputConsumed?: () => void;
  pendingMessages?: PendingChatMessage[];
  onDequeueMessage?: (index: number) => void;
  droppedFiles?: File[];
  onDroppedFilesConsumed?: () => void;
}

const focusInput = (containerRef: React.RefObject<HTMLDivElement | null>) => {
  const editableDiv = containerRef.current?.querySelector('[contenteditable="true"]') as HTMLElement;
  if (editableDiv) {
    editableDiv.focus();
  }
};

export const ChatInput: React.FC<ChatInputProps> = ({
  onSubmit,
  responseMode,
  onResponseModeChange,
  disabled = false,
  placeholder = "Type your message...",
  onOpenSettings,
  onNewChat,
  onToggleSidebar,
  onExportConversation,
  onShowShortcuts,
  hasMessages = false,
  isStreaming = false,
  onCancelStream,
  isEditing = false,
  onCancelEdit,
  recoveredInput,
  recoveredAttachments,
  recoveredMode,
  onRecoveredInputConsumed,
  pendingMessages = [],
  onDequeueMessage,
  droppedFiles,
  onDroppedFilesConsumed,
}) => {
  const [inputText, setInputText] = useState<string>("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [recoveredSubmissionMode, setRecoveredSubmissionMode] = useState<ResponseMode>();
  const controlRef = useRef<ImperativeControlPluginRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  
  const toasterId = useId("toaster");
  const { dispatchToast } = useToastController(toasterId);
  const charCounterId = useId("char-counter");
  const counterStyles = useCharCounterStyles();

  const charCount = inputText.length;
  const showCounter = charCount >= CHAR_WARNING_THRESHOLD;
  
  const getCounterStyle = () => {
    if (charCount >= CHAR_DANGER_THRESHOLD) return counterStyles.danger;
    if (charCount >= CHAR_WARNING_THRESHOLD) return counterStyles.warning;
    return counterStyles.normal;
  };

  // Auto-focus on mount for immediate typing
  useEffect(() => {
    if (!disabled) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => focusInput(inputContainerRef), 100);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // Restore focus after message is sent (when status changes from disabled back to enabled)
  useEffect(() => {
    if (!disabled && !isStreaming) {
      // Small delay to allow state to settle
      const timer = setTimeout(() => focusInput(inputContainerRef), 50);
      return () => clearTimeout(timer);
    }
  }, [disabled, isStreaming]);

  // Focus input when messages are cleared (new chat button clicked)
  useEffect(() => {
    if (!hasMessages && !disabled) {
      // Delay to ensure state has settled after clearing
      const timer = setTimeout(() => focusInput(inputContainerRef), 100);
      return () => clearTimeout(timer);
    }
  }, [hasMessages, disabled]);

  useEffect(() => {
    if (recoveredInput) {
      setInputText(recoveredInput);
      controlRef.current?.setInputText(recoveredInput);
      setRecoveredSubmissionMode(recoveredMode);
      // Restore attachments by converting dataURIs back to Files
      if (recoveredAttachments?.length) {
        for (const att of recoveredAttachments) {
          if (att.dataUri) {
            try {
              const res = fetch(att.dataUri);
              res.then(r => r.blob()).then(blob => {
                const file = new File([blob], att.fileName, { type: blob.type });
                setSelectedFiles(prev => [...prev, file]);
              });
            } catch { /* skip unrecoverable attachments */ }
          }
        }
      }
      onRecoveredInputConsumed?.();
      const timer = setTimeout(() => focusInput(inputContainerRef), 50);
      return () => clearTimeout(timer);
    }
  }, [recoveredInput, recoveredAttachments, recoveredMode, onRecoveredInputConsumed]);

  // Clear input when edit is cancelled
  const prevEditingRef = useRef(isEditing);
  useEffect(() => {
    if (prevEditingRef.current && !isEditing) {
      setInputText("");
      controlRef.current?.setInputText("");
      setSelectedFiles([]);
    }
    prevEditingRef.current = isEditing;
  }, [isEditing]);

  // Accept files from drag-drop via parent
  useEffect(() => {
    if (droppedFiles && droppedFiles.length > 0) {
      const countValidation = validateFileCount(droppedFiles, selectedFiles.length);
      if (!countValidation.valid) {
        dispatchToast(
          <Toast>
            <ToastTitle>{countValidation.error}</ToastTitle>
          </Toast>,
          { intent: 'warning' },
        );
      } else {
        const validFiles: File[] = [];
        for (const file of droppedFiles) {
          const validation = validateFile(file);
          if (validation.valid) {
            validFiles.push(file);
          } else {
            dispatchToast(
              <Toast>
                <ToastTitle>{validation.error}</ToastTitle>
              </Toast>,
              { intent: 'error' },
            );
          }
        }
        if (validFiles.length > 0) {
          setSelectedFiles(prev => [...prev, ...validFiles]);
        }
      }
      onDroppedFilesConsumed?.();
    }
  }, [droppedFiles, onDroppedFilesConsumed, selectedFiles.length, dispatchToast]);

  const handleSubmit = () => {
    if (inputText && inputText.trim() !== "") {
      onSubmit(inputText.trim(), selectedFiles.length > 0 ? selectedFiles : undefined, recoveredSubmissionMode ?? responseMode);
      setInputText("");
      setSelectedFiles([]);
      setRecoveredSubmissionMode(undefined);
      controlRef.current?.setInputText("");
    }
  };

  const handleCancelStream = () => {
    onCancelStream?.();
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    
    // Validate file count first
    const countValidation = validateFileCount(files, selectedFiles.length);
    if (!countValidation.valid) {
      dispatchToast(
        <Toast>
          <ToastTitle>{countValidation.error}</ToastTitle>
        </Toast>,
        { intent: 'warning' }
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    // Validate each file
    const validFiles: File[] = [];
    for (const file of files) {
      const validation = validateFile(file);
      if (!validation.valid) {
        dispatchToast(
          <Toast>
            <ToastTitle>{validation.error}</ToastTitle>
          </Toast>,
          { intent: 'error' }
        );
      } else {
        validFiles.push(file);
      }
    }

    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
    }
    
    // Reset input value so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handlePaste = async (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    if (files.length === 0) return;

    // Validate file count
    const countValidation = validateFileCount(files, selectedFiles.length);
    if (!countValidation.valid) {
      event.preventDefault();
      dispatchToast(
        <Toast>
          <ToastTitle>{countValidation.error}</ToastTitle>
        </Toast>,
        { intent: 'warning' }
      );
      return;
    }

    // Validate each file
    const validFiles: File[] = [];
    for (const file of files) {
      const validation = validateFile(file);
      if (!validation.valid) {
        dispatchToast(
          <Toast>
            <ToastTitle>{validation.error}</ToastTitle>
          </Toast>,
          { intent: 'error' }
        );
      } else {
        validFiles.push(file);
      }
    }

    if (validFiles.length > 0) {
      event.preventDefault();
      setSelectedFiles(prev => [...prev, ...validFiles]);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Escape to cancel streaming
    if (event.key === 'Escape' && isStreaming) {
      event.preventDefault();
      handleCancelStream();
    }
  };

  const handleVoiceTranscript = (transcript: string) => {
    const newText = inputText ? `${inputText} ${transcript}` : transcript;
    setInputText(newText);
    controlRef.current?.setInputText(newText);
    focusInput(inputContainerRef);
  };

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />
      <div className={styles.chatInputContainer} onPaste={handlePaste} onKeyDown={handleKeyDown} ref={inputContainerRef}>
        <FilePreview 
          files={selectedFiles}
          onRemove={handleRemoveFile}
          disabled={disabled}
        />
        <div className={styles.inputWrapper}>
        <div className={styles.responseModeRow}>
          <Text className={styles.responseModeLabel}>Response depth</Text>
          <TabList
            className={styles.modeSelector}
            aria-label="IDA response mode"
            selectedValue={responseMode}
            onTabSelect={(_, data) => onResponseModeChange(data.value as ResponseMode)}
            size="small"
          >
            <Tooltip content="IDA selects the appropriate response depth." relationship="description">
              <Tab value="auto" aria-label="Auto response mode">Auto</Tab>
            </Tooltip>
            <Tooltip content="A concise answer using targeted evidence." relationship="description">
              <Tab value="simple" aria-label="Simple response mode">Simple</Tab>
            </Tooltip>
            <Tooltip content="A fuller answer drawing across all IDA knowledge bases." relationship="description">
              <Tab value="detailed" aria-label="Detailed response mode">Detailed</Tab>
            </Tooltip>
          </TabList>
          <Tooltip content="Select how much detail IDA should use in its next response." relationship="description">
            <Select
              className={styles.compactModeSelector}
              aria-label="IDA response depth"
              value={responseMode}
              onChange={(_, data) => onResponseModeChange(data.value as ResponseMode)}
              size="small"
            >
              <option value="auto">Auto</option>
              <option value="simple">Simple</option>
              <option value="detailed">Detailed</option>
            </Select>
          </Tooltip>
        </div>
        <ChatInputFluent
          aria-label="Chat Input"
          aria-describedby={showCounter ? charCounterId : undefined}
          charactersRemainingMessage={() => ``}
          disabled={disabled}
          history={true}
          onChange={(_, data) => setInputText(data.value)}
          onSubmit={handleSubmit}
          placeholderValue={placeholder}
        >
          <ImperativeControlPlugin ref={controlRef} />
        </ChatInputFluent>
        {showCounter && (
          <div className={counterStyles.container} id={charCounterId}>
            <Text className={`${counterStyles.text} ${getCounterStyle()}`}>
              {charCount} / {CHAR_MAX_RECOMMENDED} characters (recommended limit)
            </Text>
          </div>
        )}
        {pendingMessages.length > 0 && onDequeueMessage && (
          <MessageQueue messages={pendingMessages} onRemove={onDequeueMessage} />
        )}
        <div className={styles.buttonRow}>
          <div className={styles.actionButtons}>
            <Button
              appearance="subtle"
              icon={<Attach24Regular />}
              onClick={handleAttachClick}
              disabled={disabled}
              aria-label="Attach files"
            />
            <Button
              appearance="subtle"
              icon={<Stop24Regular />}
              onClick={isEditing ? onCancelEdit : handleCancelStream}
              disabled={!isStreaming && !isEditing}
              aria-label={isEditing ? "Cancel edit" : "Cancel response"}
              title={isEditing ? "Cancel edit" : undefined}
              className={styles.cancelButton}
            />
            <VoiceInput
              onTranscript={handleVoiceTranscript}
              disabled={disabled}
            />
            {onNewChat && (
              <Button
                appearance="subtle"
                icon={<ChatAdd24Regular />}
                onClick={onNewChat}
                disabled={disabled || !hasMessages}
                aria-label="New chat"
              />
            )}
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button
                  appearance="subtle"
                  icon={<MoreHorizontal24Regular />}
                  aria-label="More options"
                />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {onToggleSidebar && (
                    <MenuItem icon={<History24Regular />} onClick={onToggleSidebar} disabled={disabled}>
                      Conversation history
                    </MenuItem>
                  )}
                  {onExportConversation && (
                    <MenuItem icon={<ArrowDownload24Regular />} onClick={onExportConversation} disabled={disabled || !hasMessages}>
                      Export as Markdown
                    </MenuItem>
                  )}
                  {onShowShortcuts && (
                    <MenuItem icon={<Keyboard24Regular />} onClick={onShowShortcuts}>
                      Keyboard shortcuts
                    </MenuItem>
                  )}
                  {onOpenSettings && (
                    <MenuItem icon={<Settings24Regular />} onClick={onOpenSettings} disabled={disabled}>
                      Settings
                    </MenuItem>
                  )}
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileSelect}
        accept="image/*,.pdf,.txt,.md,.csv,.json,.html,.xml"
        aria-label="Upload files"
      />
    </div>
    </>
  );
};
