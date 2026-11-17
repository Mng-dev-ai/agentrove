import type { ChannelSearchResult, ChatSearchResult } from '@/types/chat.types';

export type SearchHit =
  | { kind: 'chat'; result: ChatSearchResult }
  | { kind: 'channel'; result: ChannelSearchResult };

export function hitKey(hit: SearchHit): string {
  return hit.kind === 'chat' ? hit.result.chat_id : hit.result.channel_id;
}
