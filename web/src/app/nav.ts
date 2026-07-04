import type { ComponentType } from 'react';
import { VIEW_PATHS, VIEW_TITLES, type ViewKey } from '@iris/shared';
import {
  Brain,
  Calendar,
  Chat,
  Folder,
  Grid,
  type IconProps,
  Journal,
  Layers,
  Mail,
  Mic,
  Plug,
  Search,
  ShieldCheck,
  Gear,
  Sparkle,
  Users,
  Whiteboard,
} from '@/components/icons';

export interface NavItem {
  key: ViewKey;
  /** Short label shown in the sidebar (differs from the header title for some views). */
  label: string;
  path: string;
  Icon: ComponentType<IconProps>;
  /** Render a divider above this item. */
  dividerBefore?: boolean;
}

/** Sidebar navigation, in display order (matches the prototype exactly). */
export const NAV_ITEMS: NavItem[] = [
  { key: 'onboarding', label: 'Welcome', path: VIEW_PATHS.onboarding, Icon: Sparkle },
  { key: 'chat', label: 'Ask IRIS', path: VIEW_PATHS.chat, Icon: Chat },
  { key: 'dashboard', label: 'Dashboard', path: VIEW_PATHS.dashboard, Icon: Grid },
  { key: 'projects', label: 'Projects', path: VIEW_PATHS.projects, Icon: Folder },
  { key: 'mail', label: 'Mail', path: VIEW_PATHS.mail, Icon: Mail },
  { key: 'calendar', label: 'Calendar', path: VIEW_PATHS.calendar, Icon: Calendar },
  { key: 'journal', label: 'Journal', path: VIEW_PATHS.journal, Icon: Journal },
  { key: 'people', label: 'People', path: VIEW_PATHS.people, Icon: Users },
  { key: 'meetings', label: 'Meetings', path: VIEW_PATHS.meetings, Icon: Mic },
  { key: 'whiteboard', label: 'Whiteboard', path: VIEW_PATHS.whiteboard, Icon: Whiteboard },
  { key: 'knowledge', label: 'Lens', path: VIEW_PATHS.knowledge, Icon: Search },
  { key: 'connectors', label: 'Connectors', path: VIEW_PATHS.connectors, Icon: Plug },
  { key: 'memory', label: 'Memory', path: VIEW_PATHS.memory, Icon: Brain },
  { key: 'admin', label: 'Admin', path: VIEW_PATHS.admin, Icon: ShieldCheck, dividerBefore: true },
  { key: 'settings', label: 'Settings', path: VIEW_PATHS.settings, Icon: Gear },
  { key: 'architecture', label: 'Architecture', path: VIEW_PATHS.architecture, Icon: Layers },
];

/** Resolve the current view key from a pathname (for header title + active nav). */
export function viewKeyFromPath(pathname: string): ViewKey {
  const match = NAV_ITEMS.find((n) => n.path === pathname);
  if (match) return match.key;
  // Nested routes fall back to their section prefix.
  const prefix = NAV_ITEMS.filter((n) => n.path !== '/').find((n) => pathname.startsWith(n.path));
  return prefix?.key ?? 'dashboard';
}

export { VIEW_TITLES };
