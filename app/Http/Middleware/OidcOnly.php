<?php

/**
 * Invoice Ninja (https://invoiceninja.com).
 *
 * @link https://github.com/invoiceninja/invoiceninja source repository
 *
 * @copyright Copyright (c) 2026. Invoice Ninja LLC (https://invoiceninja.com)
 *
 * @license https://www.elastic.co/licensing/elastic-license
 */

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/**
 * SSO-only mode (OIDC_ONLY=true).
 *
 * Refuses every sign-in path other than the generic OIDC flow: password and
 * passkey login, signup, social-token login and password reset. Applied per
 * route, so the OIDC redirect/callback, the exchange endpoint and the
 * token-authenticated API are unaffected. Off by default.
 */
class OidcOnly
{
    public function handle(Request $request, Closure $next)
    {
        if (config('services.oidc.only')) {
            return response()->json(['message' => 'Password sign-in is disabled on this server. Use single sign-on instead.'], 403);
        }

        return $next($request);
    }
}
