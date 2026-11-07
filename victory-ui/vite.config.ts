/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Mock dev mode only (`npm run dev:mock`): stands in for the two browser navigations that msw
 * cannot intercept, because service workers do not see top-level page loads to another path:
 *  - GET /auth/oidc  -> the Invoice Ninja server would bounce through Google and come back to
 *    REACT_URL/oauth-callback?code=<64 chars>; here we redirect straight to the callback.
 *  - GET /__mock-admin/oauth-callback -> where the mocked admin_handoff URL points.
 */
function mockNavigations(): Plugin {
  return {
    name: 'victory-mock-navigations',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url.startsWith('/auth/oidc')) {
          const code = 'm'.repeat(64);
          res.statusCode = 302;
          res.setHeader('Location', `/team/oauth-callback?code=${code}`);
          res.end();
          return;
        }
        if (url.startsWith('/__mock-admin')) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(
            '<!doctype html><meta charset="utf-8"><title>Admin (mock)</title>' +
              '<body style="font:16px system-ui;padding:40px;max-width:640px">' +
              '<h1>Invoice Ninja admin app</h1><p>In production this tab opens ' +
              '<b>https://projects-admin.victorycto.com</b>, already signed in through the one-time ' +
              'handoff code.</p><p><a href="/team/">Back to VictoryCTO Projects</a></p></body>',
          );
          return;
        }
        if (url === '/' || url === '') {
          res.statusCode = 302;
          res.setHeader('Location', '/team/');
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VICTORY_API_TARGET;
  const isMock = mode === 'mock';

  return {
    base: '/team/',
    define: { 'globalThis.__MUI_X_TELEMETRY_DISABLED__': 'true' },
    plugins: [react(), ...(isMock ? [mockNavigations()] : [])],
    // The msw service worker only ships in mock mode; production dist/ has no public files.
    publicDir: isMock ? 'mock-public' : false,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      target: 'es2022',
    },
    server: {
      // Optional: point a non-mock dev server at a local Invoice Ninja (never production).
      proxy: target && !isMock ? { '/api': target, '/auth': target } : undefined,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['src/test/setup.ts'],
      css: false,
      restoreMocks: true,
      testTimeout: 15000,
    },
  };
});
