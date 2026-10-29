import type { AnchorHTMLAttributes } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from '../primitives/Link/Link';
import styles from './markdownComponents.module.scss';

export const CHAT_LINK_RE = /^\/chat\/[0-9a-f-]+$/i;

// Same-app route: navigate in place, since the desktop shell only opens absolute URLs.
export function ChatLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const navigate = useNavigate();
  return (
    <Link
      {...props}
      href={href}
      variant="unstyled"
      className={styles.link}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </Link>
  );
}
