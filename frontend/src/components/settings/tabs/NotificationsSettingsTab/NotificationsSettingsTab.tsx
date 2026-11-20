import { SectionCard, ToggleRow } from '@/components/settings/SettingsCard/SettingsCard';
import type { NotifySetting, UserSettings } from '@/types/user.types';
import styles from './NotificationsSettingsTab.module.scss';

const NOTIFY_SETTINGS: { key: NotifySetting; title: string; desc: string }[] = [
  {
    key: 'notify_permission_requests',
    title: 'Permission requests',
    desc: 'Tool approvals and plans waiting for your review.',
  },
  { key: 'notify_questions', title: 'Questions', desc: 'Agents asking you to choose an answer.' },
  { key: 'notify_completions', title: 'Chat finished', desc: 'A chat completes or fails.' },
  {
    key: 'notify_inbox_messages',
    title: 'Inbox messages',
    desc: 'Messages an agent sends to your inbox.',
  },
  {
    key: 'notify_sub_threads',
    title: 'Sub-threads',
    desc: 'Include sub-thread chats. When off, only parent chats notify; inbox messages always do.',
  },
];

interface NotificationsSettingsTabProps {
  settings: UserSettings;
  onNotificationsEnabledChange: (enabled: boolean) => void;
  onNotifySettingChange: (setting: NotifySetting, enabled: boolean) => void;
}

export function NotificationsSettingsTab({
  settings,
  onNotificationsEnabledChange,
  onNotifySettingChange,
}: NotificationsSettingsTabProps) {
  return (
    <div className={styles.notifications}>
      <h2 className={styles['page-title']}>Notifications</h2>

      <SectionCard title="Alerts">
        <ToggleRow
          title="Notifications"
          desc="Notify when an agent needs you or finishes."
          checked={settings.notifications_enabled}
          onCheckedChange={onNotificationsEnabledChange}
          ariaLabel="Notifications"
        />
      </SectionCard>

      {settings.notifications_enabled && (
        <SectionCard title="Notify me about">
          {NOTIFY_SETTINGS.map(({ key, title, desc }) => (
            <ToggleRow
              key={key}
              title={title}
              desc={desc}
              checked={settings[key]}
              onCheckedChange={(enabled) => onNotifySettingChange(key, enabled)}
              ariaLabel={`Notify for ${title.toLowerCase()}`}
            />
          ))}
        </SectionCard>
      )}
    </div>
  );
}
