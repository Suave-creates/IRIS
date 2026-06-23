import type { ConnectorProvider } from '@iris/shared';
import { syncCalendar, syncDrive, syncGmail, syncSheets, type SyncResult } from './google/sync.js';

export interface ConnectorCtx {
  tenantId: string;
  userId: string;
}

export interface ConnectorDef {
  provider: ConnectorProvider;
  displayName: string;
  group: string;
  capabilities: string;
  /** Whether this connector is part of the Google OAuth grant. */
  google: boolean;
  /** Pull data from the provider into IRIS. Undefined = not yet implemented. */
  sync?: (ctx: ConnectorCtx) => Promise<SyncResult>;
}

export const CONNECTORS: Record<ConnectorProvider, ConnectorDef> = {
  gmail: {
    provider: 'gmail', displayName: 'Gmail', group: 'Google Workspace', capabilities: 'Read · Draft · Send',
    google: true, sync: ({ tenantId }) => syncGmail(tenantId),
  },
  gcalendar: {
    provider: 'gcalendar', displayName: 'Calendar', group: 'Google Workspace', capabilities: 'Read · Create · Update',
    google: true, sync: ({ tenantId, userId }) => syncCalendar(tenantId, userId),
  },
  gdrive: {
    provider: 'gdrive', displayName: 'Drive & Docs', group: 'Google Workspace', capabilities: 'Read · Edit · Comment',
    google: true, sync: ({ tenantId }) => syncDrive(tenantId),
  },
  gsheets: {
    provider: 'gsheets', displayName: 'Sheets & Tasks', group: 'Google Workspace', capabilities: 'Read · Write · Update',
    google: true, sync: ({ tenantId }) => syncSheets(tenantId),
  },
  slack: { provider: 'slack', displayName: 'Slack', group: 'Communication & Work', capabilities: 'Read · Post · Summarize', google: false },
  notion: { provider: 'notion', displayName: 'Notion', group: 'Communication & Work', capabilities: 'Read · Create · Update', google: false },
  github: { provider: 'github', displayName: 'GitHub', group: 'Communication & Work', capabilities: 'Read · Issues · PRs', google: false },
  jira: { provider: 'jira', displayName: 'Jira', group: 'Communication & Work', capabilities: 'Read · Issues', google: false },
};

export const GOOGLE_PROVIDER_LIST: ConnectorProvider[] = ['gmail', 'gcalendar', 'gdrive', 'gsheets'];
