import { memo } from 'react';
import clsx from 'clsx';
import { User } from 'lucide-react';
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
