import { makeStyles, tokens, Text, Button } from '@fluentui/react-components';
import { ErrorCircleRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: tokens.spacingVerticalXXL,
    gap: tokens.spacingVerticalL,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  icon: {
    fontSize: '48px',
    color: tokens.colorPaletteRedForeground1,
  },
  title: {
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  message: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    textAlign: 'center',
    maxWidth: '600px',
  },
  details: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    backgroundColor: tokens.colorNeutralBackground3,
    padding: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusMedium,
    maxWidth: '800px',
    width: '100%',
    overflowX: 'auto',
  },
  errorText: {
    marginBottom: tokens.spacingVerticalS,
  },
  stackTrace: {
    margin: 0,
    fontSize: tokens.fontSizeBase100,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  actions: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalM,
  },
});

/**
 * Default fallback UI for ErrorBoundary
 */
export function DefaultErrorFallback({ error, resetError }: { error: Error; resetError: () => void }) {
  const styles = useStyles();

  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div className={styles.container}>
      <ErrorCircleRegular className={styles.icon} />
      <Text className={styles.title}>Something went wrong</Text>
      <Text className={styles.message}>
        An unexpected error occurred. You can try refreshing the page or starting a new chat.
      </Text>

      {import.meta.env.DEV && error.stack && (
        <div className={styles.details}>
          <div className={styles.errorText}>
            <strong>Error:</strong> {error.message}
          </div>
          <pre className={styles.stackTrace}>
            {error.stack}
          </pre>
        </div>
      )}

      <div className={styles.actions}>
        <Button appearance="primary" onClick={handleReload}>
          Reload Page
        </Button>
        <Button appearance="secondary" onClick={resetError}>
          Try Again
        </Button>
      </div>
    </div>
  );
}
