import { memo } from 'react';
import { MarkDown } from '@/components/ui/markdown/MarkDown';
import { RollupRow } from './WorkedRollup';

export const NoticeCard = memo(function NoticeCard({ text }: { text: string }) {
  return (
    <RollupRow label="Automated update">
      <MarkDown content={text} />
    </RollupRow>
  );
});
