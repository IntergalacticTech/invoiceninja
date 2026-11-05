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

namespace App\Utils;

use App\Models\User;

/**
 * Opt-in: hide money from non-admin users (HIDE_FINANCIALS_FROM_NON_ADMINS=true).
 *
 * When on, API responses built for a company user who is not an administrator
 * zero out rates, budgets, balances and invoice links on projects, tasks and
 * clients, so a team member who only tracks time never receives financial
 * data, whatever the client application shows. Admins, owners, the client
 * portal and unauthenticated contexts (queued jobs, PDFs) are unaffected.
 */
class FinancialVisibility
{
    public static function enabled(): bool
    {
        return (bool) config('ninja.hide_financials_from_non_admins', false);
    }

    /**
     * True when the current request's user must not see financial fields.
     */
    public static function hidden(): bool
    {
        if (!self::enabled()) {
            return false;
        }

        $user = auth()->user();

        if (!$user instanceof User) {
            return false;
        }

        try {
            return !$user->isAdmin() && !$user->isOwner();
        } catch (\Throwable $e) {
            // No company token in this context (console, portal): nothing to hide from.
            return false;
        }
    }
}
