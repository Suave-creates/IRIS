import { createBrowserRouter, Navigate } from 'react-router-dom';
import { VIEW_PATHS } from '@iris/shared';
import { AppShell } from '@/components/shell/AppShell';
import { AuthGuard } from '@/features/auth/AuthGuard';
import { Login } from '@/features/auth/Login';
import { ViewPage } from '@/views/ViewPage';
import { Welcome } from '@/views/Welcome';
import { Settings } from '@/views/Settings';
import { NotFound } from '@/views/NotFound';

const p = (path: string) => path.slice(1);

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    element: <AuthGuard />,
    children: [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, element: <ViewPage view="dashboard" /> },
          { path: p(VIEW_PATHS.onboarding), element: <Welcome /> },
          { path: p(VIEW_PATHS.chat), element: <ViewPage view="chat" /> },
          { path: p(VIEW_PATHS.projects), element: <ViewPage view="projects" /> },
          { path: p(VIEW_PATHS.mail), element: <ViewPage view="mail" /> },
          { path: p(VIEW_PATHS.calendar), element: <ViewPage view="calendar" /> },
          { path: p(VIEW_PATHS.journal), element: <ViewPage view="journal" /> },
          { path: p(VIEW_PATHS.whiteboard), element: <ViewPage view="whiteboard" /> },
          { path: p(VIEW_PATHS.knowledge), element: <ViewPage view="knowledge" /> },
          { path: p(VIEW_PATHS.connectors), element: <ViewPage view="connectors" /> },
          { path: p(VIEW_PATHS.memory), element: <ViewPage view="memory" /> },
          { path: p(VIEW_PATHS.admin), element: <ViewPage view="admin" /> },
          { path: p(VIEW_PATHS.settings), element: <Settings /> },
          { path: p(VIEW_PATHS.architecture), element: <ViewPage view="architecture" /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
