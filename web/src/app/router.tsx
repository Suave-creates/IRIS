import { createBrowserRouter, Navigate } from 'react-router-dom';
import { VIEW_PATHS } from '@iris/shared';
import { AppShell } from '@/components/shell/AppShell';
import { ViewPage } from '@/views/ViewPage';
import { NotFound } from '@/views/NotFound';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <ViewPage view="dashboard" /> },
      { path: VIEW_PATHS.onboarding.slice(1), element: <ViewPage view="onboarding" /> },
      { path: VIEW_PATHS.chat.slice(1), element: <ViewPage view="chat" /> },
      { path: VIEW_PATHS.projects.slice(1), element: <ViewPage view="projects" /> },
      { path: VIEW_PATHS.mail.slice(1), element: <ViewPage view="mail" /> },
      { path: VIEW_PATHS.calendar.slice(1), element: <ViewPage view="calendar" /> },
      { path: VIEW_PATHS.journal.slice(1), element: <ViewPage view="journal" /> },
      { path: VIEW_PATHS.whiteboard.slice(1), element: <ViewPage view="whiteboard" /> },
      { path: VIEW_PATHS.knowledge.slice(1), element: <ViewPage view="knowledge" /> },
      { path: VIEW_PATHS.connectors.slice(1), element: <ViewPage view="connectors" /> },
      { path: VIEW_PATHS.memory.slice(1), element: <ViewPage view="memory" /> },
      { path: VIEW_PATHS.admin.slice(1), element: <ViewPage view="admin" /> },
      { path: VIEW_PATHS.settings.slice(1), element: <ViewPage view="settings" /> },
      { path: VIEW_PATHS.architecture.slice(1), element: <ViewPage view="architecture" /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
