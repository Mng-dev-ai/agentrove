import type { SVGProps } from 'react';

export function AntigravityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="m9 5-7 7 7 7M15 5l7 7-7 7M6 12h12" />
      <ellipse cx="12" cy="12" rx="4" ry="10" transform="rotate(45 12 12)" />
    </svg>
  );
}
