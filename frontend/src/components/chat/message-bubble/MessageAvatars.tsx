import { memo } from 'react';
import clsx from 'clsx';
import { User } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
import iconDark from '/assets/images/icon-dark.svg';
import iconLight from '/assets/images/icon-white.svg';
import styles from './MessageAvatars.module.scss';

export const UserAvatarCircle = memo(function UserAvatarCircle({
  displayName,
  size = 'default',
}: {
  displayName: string;
  size?: 'default' | 'large';
}) {
  const modifier = size === 'large' ? 'large' : 'default';

  return (
    <div className={clsx(styles['avatar-circle'], styles[`avatar-circle--${modifier}`])}>
      {displayName?.[0]?.toUpperCase() || (
        <User className={styles[`avatar-circle-icon--${modifier}`]} />
      )}
    </div>
  );
});

UserAvatarCircle.displayName = 'UserAvatarCircle';

export function UserAvatar() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  useCurrentUserQuery({
    enabled: isAuthenticated,
  });

  return (
    <div className={styles.avatar}>
      <User className={styles['avatar-icon']} />
    </div>
  );
}

export function BotAvatar() {
  return (
    <div className={styles.avatar}>
      <img
        src={iconDark}
        alt="Agentrove"
        className={clsx(styles['bot-icon'], styles['bot-icon--on-light'])}
      />
      <img
        src={iconLight}
        alt="Agentrove"
        className={clsx(styles['bot-icon'], styles['bot-icon--on-dark'])}
      />
    </div>
  );
}
