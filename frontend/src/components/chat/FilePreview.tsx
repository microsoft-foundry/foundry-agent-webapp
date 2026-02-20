import { makeStyles, tokens, Button, Badge, Text } from '@fluentui/react-components';
import { 
  Dismiss24Regular, 
  ImageRegular, 
  DocumentPdfRegular,
  DocumentRegular,
  DocumentTextRegular,
  CodeRegular
} from '@fluentui/react-icons';
import { useState, useEffect, useRef } from 'react';
import { getEffectiveMimeType } from '../../utils/fileAttachments';

// MIME types that can be previewed as text content
const TEXT_PREVIEW_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'text/html',
  'application/xml',
  'text/xml',
]);

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingVerticalS,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    marginBottom: tokens.spacingVerticalS,
  },
  previewItem: {
    position: 'relative',
    width: '80px',
    height: '80px',
    borderRadius: tokens.borderRadiusMedium,
    overflow: 'hidden',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  textPreview: {
    width: '100%',
    height: '100%',
    padding: '4px',
    fontSize: '7px',
    fontFamily: 'monospace',
    lineHeight: '1.2',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    overflow: 'hidden',
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  placeholderIcon: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalXXS,
    color: tokens.colorNeutralForeground3,
    padding: tokens.spacingHorizontalXS,
  },
  fileName: {
    fontSize: '9px',
    textAlign: 'center',
    wordBreak: 'break-word',
    lineHeight: '1.1',
    maxHeight: '22px',
    overflow: 'hidden',
  },
  removeButton: {
    position: 'absolute',
    top: '2px',
    right: '2px',
    minWidth: '20px',
    minHeight: '20px',
    padding: '2px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: '50%',
    boxShadow: tokens.shadow4,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  sizeBadge: {
    position: 'absolute',
    bottom: '4px',
    left: '4px',
    fontSize: '10px',
    padding: '2px 4px',
  },
});

interface FilePreviewProps {
  files: File[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}

export const FilePreview: React.FC<FilePreviewProps> = ({ files, onRemove, disabled }) => {
  const styles = useStyles();
  // Key thumbnails by unique file identifier to prevent stale mappings on reorder
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  // Store text content previews for text-based files
  const [textPreviews, setTextPreviews] = useState<Map<string, string>>(new Map());
  // Track files that are currently being read to prevent duplicate reads
  const pendingReadsRef = useRef<Set<string>>(new Set());

  // Generate a stable unique key for each file
  const getFileKey = (file: File): string => `${file.name}-${file.size}-${file.lastModified}`;

  // Check if a file can be previewed as text using the shared MIME type utility
  const isTextPreviewable = (file: File): boolean => {
    const mimeType = getEffectiveMimeType(file);
    return TEXT_PREVIEW_TYPES.has(mimeType);
  };

  useEffect(() => {
    const currentFileKeys = new Set(files.map(getFileKey));

    // Clean up previews for removed files
    setThumbnails(prev => {
      let changed = false;
      for (const key of prev.keys()) {
        if (!currentFileKeys.has(key)) { changed = true; break; }
      }
      if (!changed) return prev;
      const updated = new Map<string, string>();
      for (const [key, value] of prev) {
        if (currentFileKeys.has(key)) {
          updated.set(key, value);
        }
      }
      return updated;
    });

    setTextPreviews(prev => {
      let changed = false;
      for (const key of prev.keys()) {
        if (!currentFileKeys.has(key)) { changed = true; break; }
      }
      if (!changed) return prev;
      const updated = new Map<string, string>();
      for (const [key, value] of prev) {
        if (currentFileKeys.has(key)) {
          updated.set(key, value);
        }
      }
      return updated;
    });

    // Clear pending reads for removed files
    for (const key of pendingReadsRef.current) {
      if (!currentFileKeys.has(key)) {
        pendingReadsRef.current.delete(key);
      }
    }

    // Generate previews for new files
    for (const file of files) {
      const fileKey = getFileKey(file);
      const mimeType = getEffectiveMimeType(file);

      // Skip if already loaded or currently loading
      if (pendingReadsRef.current.has(fileKey)) continue;

      if (mimeType.startsWith('image/') && !thumbnails.has(fileKey)) {
        pendingReadsRef.current.add(fileKey);
        const reader = new FileReader();
        reader.onload = (e) => {
          pendingReadsRef.current.delete(fileKey);
          if (e.target?.result) {
            setThumbnails(p => new Map(p).set(fileKey, e.target!.result as string));
          }
        };
        reader.onerror = () => {
          pendingReadsRef.current.delete(fileKey);
        };
        reader.readAsDataURL(file);
      } else if (isTextPreviewable(file) && !textPreviews.has(fileKey)) {
        pendingReadsRef.current.add(fileKey);
        const reader = new FileReader();
        reader.onload = (e) => {
          pendingReadsRef.current.delete(fileKey);
          if (e.target?.result) {
            const text = e.target.result as string;
            setTextPreviews(p => new Map(p).set(fileKey, text.slice(0, 200)));
          }
        };
        reader.onerror = () => {
          pendingReadsRef.current.delete(fileKey);
        };
        reader.readAsText(file);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${Math.round(bytes / Math.pow(k, i) * 10) / 10} ${sizes[i]}`;
  };

  const getFileIcon = (file: File) => {
    const mimeType = getEffectiveMimeType(file);

    if (mimeType.startsWith('image/')) {
      return <ImageRegular fontSize={32} />;
    }
    if (mimeType === 'application/pdf') {
      return <DocumentPdfRegular fontSize={32} />;
    }
    if (mimeType === 'application/json' || mimeType === 'text/xml' || mimeType === 'application/xml' || mimeType === 'text/html') {
      return <CodeRegular fontSize={32} />;
    }
    if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/csv') {
      return <DocumentTextRegular fontSize={32} />;
    }
    return <DocumentRegular fontSize={32} />;
  };

  const getFileExtension = (fileName: string): string => {
    const parts = fileName.split('.');
    return parts.length > 1 ? `.${parts[parts.length - 1].toUpperCase()}` : '';
  };

  if (files.length === 0) return null;

  return (
    <div className={styles.container} role="list" aria-label="Attached files">
      {files.map((file, index) => {
        const fileKey = getFileKey(file);
        const mimeType = getEffectiveMimeType(file);
        const isImage = mimeType.startsWith('image/');
        const thumbnail = thumbnails.get(fileKey);
        const textPreview = textPreviews.get(fileKey);
        
        return (
          <div key={fileKey} className={styles.previewItem} role="listitem" title={file.name}>
            {isImage && thumbnail ? (
              <img 
                src={thumbnail} 
                alt={file.name}
                className={styles.thumbnail}
              />
            ) : textPreview ? (
              <div className={styles.textPreview}>
                {textPreview}
              </div>
            ) : (
              <div className={styles.placeholderIcon}>
                {getFileIcon(file)}
                <Text className={styles.fileName}>
                  {getFileExtension(file.name)}
                </Text>
              </div>
            )}
            <Badge 
              appearance="filled" 
              size="small"
              className={styles.sizeBadge}
            >
              {formatFileSize(file.size)}
            </Badge>
            <Button
              appearance="subtle"
              size="small"
              icon={<Dismiss24Regular />}
              onClick={() => onRemove(index)}
              disabled={disabled}
              aria-label={`Remove ${file.name}`}
              className={styles.removeButton}
            />
          </div>
        );
      })}
    </div>
  );
};
