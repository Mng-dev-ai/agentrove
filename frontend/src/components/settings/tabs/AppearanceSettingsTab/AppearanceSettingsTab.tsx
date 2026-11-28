import { SectionCard, SettingRow } from '@/components/settings/SettingsCard/SettingsCard';
import { Dropdown } from '@/components/ui/primitives/Dropdown/Dropdown';
import {
  SegmentedControl,
  type SegmentOption,
} from '@/components/ui/primitives/SegmentedControl/SegmentedControl';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useUIStore } from '@/store/uiStore';
import type { Palette, ThemeMode, TranscriptWidth } from '@/types/ui.types';
import {
  DARK_PALETTES,
  PALETTE_TOKENS,
  THEMES,
  getThemeMeta,
  type PaletteMeta,
} from '@/utils/theme';
import styles from './AppearanceSettingsTab.module.scss';

const PALETTE_THEMES = THEMES.filter((t): t is PaletteMeta => t.value !== 'system');
const LIGHT_THEMES = PALETTE_THEMES.filter((t) => !DARK_PALETTES.has(t.value));
const DARK_THEMES = PALETTE_THEMES.filter((t) => DARK_PALETTES.has(t.value));

const MODE_OPTIONS: SegmentOption<ThemeMode>[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const CODE_FONT_SIZES = [11, 12, 13, 14, 15, 16];

const DIFF_STYLE_OPTIONS: SegmentOption<'unified' | 'split'>[] = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
];

const TRANSCRIPT_WIDTH_OPTIONS: SegmentOption<TranscriptWidth>[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'default', label: 'Default' },
  { value: 'wide', label: 'Wide' },
];

const previewTheme = (meta: PaletteMeta) => useUIStore.getState().setThemePreview(meta.value);

const clearPreviewOnClose = (isOpen: boolean) => {
  if (!isOpen) useUIStore.getState().setThemePreview(null);
};

// surfaceActive/borderHover sit far enough from black or white for the palette's hue to show.
function ThemeChip({ palette }: { palette: Palette }) {
  const { surfaceActive, borderHover, textPrimary } = PALETTE_TOKENS[palette];
  return (
    <span
      aria-hidden="true"
      className={styles.chip}
      style={{ backgroundColor: surfaceActive, borderColor: borderHover }}
    >
      <span className={styles['chip-mark']} style={{ backgroundColor: textPrimary }} />
    </span>
  );
}

function renderThemeItem(meta: PaletteMeta) {
  return (
    <span className={styles.item}>
      <ThemeChip palette={meta.value} />
      <span className={styles['item-label']}>{meta.label}</span>
    </span>
  );
}

function ThemePicker({
  label,
  value,
  themes,
  onSelect,
}: {
  label: string;
  value: Palette;
  themes: PaletteMeta[];
  onSelect: (palette: Palette) => void;
}) {
  // Dropdown reports no close when it unmounts open, e.g. when a mode switch removes this row.
  useMountEffect(() => () => useUIStore.getState().setThemePreview(null));

  return (
    <Dropdown
      value={getThemeMeta(value)}
      items={themes}
      getItemKey={(meta) => meta.value}
      getItemLabel={(meta) => meta.label}
      onSelect={(meta) => onSelect(meta.value)}
      onItemHighlight={previewTheme}
      onOpenChange={clearPreviewOnClose}
      renderItem={renderThemeItem}
      triggerIcon={<ThemeChip palette={value} />}
      ariaLabel={label}
      width="14rem"
      dropdownPosition="auto"
      dropdownAlign="right"
      searchable
      searchPlaceholder="Filter..."
      searchVariant="underline"
    />
  );
}

export function AppearanceSettingsTab() {
  const theme = useUIStore((state) => state.theme);
  const lightTheme = useUIStore((state) => state.lightTheme);
  const darkTheme = useUIStore((state) => state.darkTheme);
  const codeFontSize = useUIStore((state) => state.codeFontSize);
  const diffStyle = useUIStore((state) => state.diffStyle);
  const transcriptWidth = useUIStore((state) => state.transcriptWidth);
  const {
    setTheme,
    setThemeMode,
    setLightTheme,
    setDarkTheme,
    setCodeFontSize,
    setDiffStyle,
    setTranscriptWidth,
  } = useUIStore.getState();

  const current = getThemeMeta(theme).value;
  const isSystem = current === 'system';
  const isDark = !isSystem && DARK_PALETTES.has(current);
  const mode: ThemeMode = isSystem ? 'system' : isDark ? 'dark' : 'light';

  return (
    <div className={styles.appearance}>
      <h2 className={styles['page-title']}>Appearance</h2>

      <SectionCard title="Theme">
        <SettingRow title="Mode">
          <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setThemeMode} size="sm" />
        </SettingRow>
        {mode !== 'dark' && (
          <SettingRow
            title="Light theme"
            desc={isSystem ? 'Used while your system is in light mode.' : undefined}
          >
            <ThemePicker
              label="Light theme"
              value={isSystem ? lightTheme : current}
              themes={LIGHT_THEMES}
              onSelect={isSystem ? setLightTheme : setTheme}
            />
          </SettingRow>
        )}
        {mode !== 'light' && (
          <SettingRow
            title="Dark theme"
            desc={isSystem ? 'Used while your system is in dark mode.' : undefined}
          >
            <ThemePicker
              label="Dark theme"
              value={isSystem ? darkTheme : current}
              themes={DARK_THEMES}
              onSelect={isSystem ? setDarkTheme : setTheme}
            />
          </SettingRow>
        )}
      </SectionCard>

      <SectionCard title="Code">
        <SettingRow title="Font size" desc="Applies to the editor, diffs and terminal.">
          <Dropdown
            value={codeFontSize}
            items={CODE_FONT_SIZES}
            getItemKey={String}
            getItemLabel={(size) => `${size}px`}
            onSelect={setCodeFontSize}
            ariaLabel="Code font size"
            width="6rem"
            dropdownPosition="auto"
            dropdownAlign="right"
          />
        </SettingRow>
        <SettingRow title="Diff style" desc="Layout of the git diff view.">
          <SegmentedControl
            options={DIFF_STYLE_OPTIONS}
            value={diffStyle}
            onChange={setDiffStyle}
            size="sm"
          />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Chat">
        <SettingRow title="Transcript width" desc="Maximum width of the message column.">
          <SegmentedControl
            options={TRANSCRIPT_WIDTH_OPTIONS}
            value={transcriptWidth}
            onChange={setTranscriptWidth}
            size="sm"
          />
        </SettingRow>
      </SectionCard>
    </div>
  );
}
