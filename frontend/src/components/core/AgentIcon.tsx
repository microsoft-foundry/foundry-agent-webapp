import { Avatar } from '@fluentui/react-components';
import { Bot24Regular } from '@fluentui/react-icons';

interface AgentIconProps {
  alt?: string;
  size?: 'small' | 'medium' | 'large';
  logoUrl?: string;
}

export function AgentIcon({ 
  alt = "AI Assistant", 
  size = 'medium',
  logoUrl
}: AgentIconProps) {
  const sizeMap: Record<string, number> = {
    small: 32,
    medium: 40,
    large: 48,
  };

  return (
    <Avatar
      aria-label={alt}
      image={logoUrl ? { src: logoUrl } : undefined}
      icon={!logoUrl ? <Bot24Regular /> : undefined}
      size={sizeMap[size] as 16 | 20 | 24 | 28 | 32 | 36 | 40 | 48 | 56 | 64 | 72 | 96 | 120 | 128}
      color="brand"
    />
  );
}
