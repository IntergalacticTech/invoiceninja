import { exchangeOidcCode } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { browser } from '../browser';
import { setToken } from './token';

/**
 * Invoice Ninja's LoginController::handleOidcProviderCallback redirects to
 * REACT_URL + '/oauth-callback?code=<64 chars>'. With REACT_URL = https://projects.victorycto.com/team
 * that is the real path /team/oauth-callback, not a hash route. We read the code, immediately
 * replace the URL with /team/#/projects (the code never stays in the address bar or history),
 * then swap the one-shot code for the token via POST /api/v1/oidc/exchange.
 */
export async function handleOAuthCallback(): Promise<{ handled: boolean; error?: string }> {
  const { pathname, search } = window.location;
  if (!/\/oauth-callback\/?$/.test(pathname)) return { handled: false };

  const params = new URLSearchParams(search);
  const code = params.get('code');
  const providerError = params.get('error');

  browser.replaceUrl(`${import.meta.env.BASE_URL}#/projects`);

  if (providerError) return { handled: true, error: 'Sign-in was cancelled or failed. Please try again.' };
  if (!code) return { handled: true, error: 'The sign-in link was incomplete. Please try again.' };

  try {
    const { token } = await exchangeOidcCode(code);
    if (!token) return { handled: true, error: 'Sign-in did not return a session. Please try again.' };
    setToken(token);
    return { handled: true };
  } catch (error) {
    return { handled: true, error: errorMessage(error) };
  }
}
