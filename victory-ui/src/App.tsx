import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { setUnauthorizedHandler } from './api/client';
import { SessionProvider } from './auth/session';
import { SignIn } from './auth/SignIn';
import { clearToken, getToken } from './auth/token';
import { Header } from './components/Header';
import { Toasts } from './components/Toasts';
import { Tracker } from './components/Tracker';
import { TimerProvider } from './hooks/timer';
import { MyTasksPage } from './pages/MyTasksPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { TimePage } from './pages/TimePage';
import { navigate, useRoute, type Route } from './router';
import { clearToasts } from './toasts';

/** Route table: first segment -> page. Add Timesheets / Reports here and in nav.ts. */
const ROUTES: Record<string, (r: Route) => ReactNode> = {
  projects: (r) => <ProjectsPage selectedId={r.segments[1]} />,
  tasks: () => <MyTasksPage />,
  time: (r) => <TimePage week={r.segments[1]} />,
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
