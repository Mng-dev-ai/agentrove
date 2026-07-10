import { Label } from '@/components/ui/primitives/Label/Label';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { useDraftField } from '@/hooks/useDraftField';
import styles from './InstructionsSettingsTab.module.scss';

interface InstructionsSettingsTabProps {
  instructions: string;
  onPersist: (value: string) => void;
}

export const InstructionsSettingsTab: React.FC<InstructionsSettingsTabProps> = ({
  instructions,
  onPersist,
}) => {
  const { draft, setDraft, handleBlur } = useDraftField(instructions, onPersist);

  return (
    <div className={styles.instructions}>
      <div>
        <h2 className={styles.title}>Custom Instructions</h2>
        <p className={styles.description}>
          These instructions will be added to every conversation with the AI.
        </p>
      </div>
      <div>
        <Label className={styles.label}>Instructions for the AI assistant</Label>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          placeholder="Enter custom instructions for how the AI should behave, respond, or approach tasks..."
          rows={8}
          className={styles.textarea}
        />
      </div>
    </div>
  );
};
