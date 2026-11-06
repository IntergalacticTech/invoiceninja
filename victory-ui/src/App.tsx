import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { setUnauthorizedHandler } from './api/client';
import { SessionProvider } from './auth/session';
import { SignIn } from './auth/SignIn';
import { clearToken, getToken } from './auth/token';
import { Header } from './components/Header';
import { Toasts } from './components/Toasts';
import { Tracker } from './components/Tracker';
import { TaskDetails } from './components/TaskDetails';
import { EVALUATION_MODE } from './config';
import { TimerProvider } from './hooks/timer';
import { WorkspacePage } from './pages/WorkspacePage';
import { MyTasksPage } from './pages/MyTasksPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ReportsPage } from './pages/ReportsPage';
import { TimePage } from './pages/TimePage';
import { navigate, useRoute, type Route } from './router';
import { clearToasts } from './toasts';

/** Route table: first segment -> page. New sections go here and in nav.ts. */
const ROUTES: Record<string, (r: Route) => ReactNode> = {
  workspace: () => <WorkspacePage />,
  projects: (r) => <ProjectsPage selectedId={r.segments[1]} />,
  tasks: () => <MyTasksPage />,
  time: (r) => <TimePage week={r.segments[1]} />,
  reports: () => <ReportsPage />,
};

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const route = useRoute();
  const section = route.segments[0] ?? '';
  const render = ROUTES[section];

  useEffect(() => {
    if (!render) navigate('/projects');
  }, [render]);

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Header current={section} onSignOut={onSignOut} />
      <Tracker />
      <main id="main" tabIndex={-1}>
        <div className="wrap">{render ? render(route) : null}</div>
      </main>
      {route.query.get('task') && <TaskDetails taskId={route.query.get('task') as string} />}
      <Toasts />
    </>
  );
}

export function App({ queryClient, initialNotice }: { queryClient: QueryClient; initialNotice?: string }) {
  const [token, setTokenState] = useState(getToken);
  const [notice, setNotice] = useState(initialNotice);

  const signOut = useCallback(
    (message?: string) => {
      clearToken();
      queryClient.clear();
      clearToasts();
      setNotice(message);
      setTokenState(null);
    },
    [queryClient],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => signOut('Your session has expired. Please sign in again.'));
    return () => setUnauthorizedHandler(() => undefined);
  }, [signOut]);

  return (
    <QueryClientProvider client={queryClient}>
      {EVALUATION_MODE && (
        <aside className="evaluation-note" aria-label="Evaluation notice">
          <div className="wrap">
            <strong>Evaluation:</strong> keep logging your work in{' '}
            <a href="https://victoryteam.avaza.com" target="_blank" rel="noopener noreferrer">Avaza</a>.
            {' '}Time entered here is for testing and may be replaced during data refreshes.
          </div>
        </aside>
      )}
      {token ? (
        <SessionProvider>
          <TimerProvider>
            <Shell onSignOut={() => signOut()} />
          </TimerProvider>
        </SessionProvider>
      ) : (
        <>
          <SignIn notice={notice} />
          <Toasts />
        </>
      )}
    </QueryClientProvider>
  );
}
