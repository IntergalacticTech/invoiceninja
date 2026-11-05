import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { handleOAuthCallback } from './auth/oauthCallback';
import { createQueryClient } from './queryClient';
import './styles.css';

export async function boot(container: HTMLElement): Promise<void> {
  if (import.meta.env.MODE === 'mock') {
    const { startMockWorker } = await import('./mocks/browser');
    await startMockWorker();
  }
  // /team/oauth-callback?code=... : exchange the code, clean the URL, then load the session.
  const callback = await handleOAuthCallback();
  const queryClient = createQueryClient();

  const app = <App queryClient={queryClient} initialNotice={callback.error} />;
  let tree = <StrictMode>{app}</StrictMode>;
  if (import.meta.env.MODE === 'mock') {
    const { MockBanner } = await import('./mocks/MockBanner');
    tree = (
      <StrictMode>
        <MockBanner />
        {app}
      </StrictMode>
    );
  }
  createRoot(container).render(tree);
}

const root = document.getElementById('root');
if (root) void boot(root);
