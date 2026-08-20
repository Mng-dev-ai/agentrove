import type { SVGProps } from 'react';
import type { AgentKind } from '@/types/chat.types';
import { AGENT_ICONS } from './providerIcons';

interface ProviderIconProps extends SVGProps<SVGSVGElement> {
  agentKind: AgentKind;
}

export function ProviderIcon({ agentKind, ...props }: ProviderIconProps) {
  const Icon = AGENT_ICONS[agentKind];
  return <Icon aria-hidden {...props} />;
}
