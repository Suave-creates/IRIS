import { createBrowserRouter, Navigate } from 'react-router-dom';
import { VIEW_PATHS } from '@iris/shared';
import { AppShell } from '@/components/shell/AppShell';
import { AuthGuard } from '@/features/auth/AuthGuard';
import { Login } from '@/features/auth/Login';
import { ViewPage } from '@/views/ViewPage';
import { Welcome } from '@/views/Welcome';
import { Settings } from '@/views/Settings';
import { Chat } from '@/views/Chat';
import { Lens } from '@/views/Lens';
import { Dashboard } from '@/views/Dashboard';
import { Projects } from '@/views/Projects';
import { Kpi } from '@/views/Kpi';
import { Planner } from '@/views/Planner';
import { Whiteboard } from '@/views/Whiteboard';
import { Journal } from '@/views/Journal';
import { People } from '@/views/People';
import { Meetings } from '@/views/Meetings';
import { Calendar } from '@/views/Calendar';
import { Mail } from '@/views/Mail';
import { Memory } from '@/views/Memory';
import { Connectors } from '@/views/Connectors';
import { Admin } from '@/views/Admin';
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
          { index: true, element: <Dashboard /> },
          { path: p(VIEW_PATHS.onboarding), element: <Welcome /> },
          { path: p(VIEW_PATHS.chat), element: <Chat /> },
          { path: p(VIEW_PATHS.projects), element: <Projects /> },
          { path: p(VIEW_PATHS.kpi), element: <Kpi /> },
          { path: p(VIEW_PATHS.planner), element: <Planner /> },
          { path: p(VIEW_PATHS.mail), element: <Mail /> },
          { path: p(VIEW_PATHS.calendar), element: <Calendar /> },
          { path: p(VIEW_PATHS.journal), element: <Journal /> },
          { path: p(VIEW_PATHS.people), element: <People /> },
          { path: p(VIEW_PATHS.meetings), element: <Meetings /> },
          { path: p(VIEW_PATHS.whiteboard), element: <Whiteboard /> },
          { path: p(VIEW_PATHS.knowledge), element: <Lens /> },
          { path: p(VIEW_PATHS.connectors), element: <Connectors /> },
          { path: p(VIEW_PATHS.memory), element: <Memory /> },
          { path: p(VIEW_PATHS.admin), element: <Admin /> },
          { path: p(VIEW_PATHS.settings), element: <Settings /> },
          { path: p(VIEW_PATHS.architecture), element: <ViewPage view="architecture" /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
