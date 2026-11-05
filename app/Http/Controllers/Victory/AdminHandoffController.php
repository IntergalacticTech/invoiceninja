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

namespace App\Http\Controllers\Victory;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Utils\TruthSource;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * Sign an admin into the upstream admin app (VICTORY_ADMIN_URL) without a
 * second login. Returns a one-shot code on the same 60-second exchange used by
 * the OIDC callback, so the admin app's /oauth-callback swaps it for the
 * caller's own token via POST /api/v1/oidc/exchange. Non-admins get 403.
 */
class AdminHandoffController extends Controller
{
    public function __invoke(): JsonResponse
    {
        /** @var User $user */
        $user = auth()->user();

        if (!($user->isAdmin() || $user->isOwner())) {
            return response()->json(['message' => 'Only administrators can open the admin app.'], 403);
        }

        $admin_url = rtrim((string) config('ninja.victory_admin_url'), '/');

        if ($admin_url === '') {
            return response()->json(['message' => 'The admin app address is not configured (VICTORY_ADMIN_URL).'], 404);
        }

        // The caller's own token, already validated by token_auth.
        $token = (string) request()->header('X-API-TOKEN', '') ?: app(TruthSource::class)->getCompanyToken()?->token;

        if (!$token) {
            return response()->json(['message' => 'No session token to hand over.'], 400);
        }

        $code = Str::random(64);
        Cache::put('oidc.exchange.' . $code, $token, now()->addSeconds(60));

        return response()->json(['url' => $admin_url . '/oauth-callback?code=' . $code]);
    }
}
