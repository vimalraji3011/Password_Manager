import {
  Building2,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/types';

/**
 * Single source of truth for navigation.
 *
 * `adminOnly` here is a *presentation* concern — it stops viewers from seeing
 * links they cannot use. The real enforcement is in `middleware.ts` and in each
 * API route, because hiding a link is not a security control.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  adminOnly?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Vault',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        description: 'Overview and recent activity',
      },
      {
        href: '/organizations',
        label: 'Organizations',
        icon: Building2,
        description: 'Organizations and their credentials',
      },
    ],
  },
  {
    title: 'Access',
    items: [
      {
        href: '/reset-user-password',
        label: 'Reset user password',
        icon: UserCog,
        description: 'Email a reset code to a user',
        adminOnly: true,
      },
      {
        href: '/reset-view-password',
        label: 'Reset view password',
        icon: KeyRound,
        description: 'Approve reveal-password resets',
      },
    ],
  },
  {
    title: 'Governance',
    items: [
      {
        href: '/audit',
        label: 'Audit log',
        icon: ScrollText,
        description: 'Every action, who did it and when',
        adminOnly: true,
      },
      {
        href: '/profile',
        label: 'My profile',
        icon: ShieldCheck,
        description: 'Your details and password',
      },
    ],
  },
];

/** Nav tree filtered to what `role` is allowed to see. Empty sections dropped. */
export function navFor(role: Role): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.adminOnly || role === 'admin'),
  })).filter((section) => section.items.length > 0);
}

/** Longest-prefix match, so /organizations/3 highlights /organizations. */
export function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}
