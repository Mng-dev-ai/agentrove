import { Label } from '@/components/ui/primitives/Label/Label';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { useDraftField } from '@/hooks/useDraftField';

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
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
          Custom Instructions
        </h2>
        <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
          These instructions will be added to every conversation with the AI.
        </p>
      </div>
      <div>
        <Label className="mb-2 block text-xs text-text-secondary dark:text-text-dark-secondary">
          Instructions for the AI assistant
        </Label>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          placeholder="Enter custom instructions for how the AI should behave, respond, or approach tasks..."
          rows={8}
          className="min-h-32"
        />
      </div>
    </div>
  );
};
