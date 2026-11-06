<?php

namespace App\Services\Victory;

use App\Libraries\MultiDB;
use App\Models\User;

/** Keep Google-owned profile fields current without an invitation or email workflow. */
class GoogleIdentity
{
    public static function avatar(?string $url): string
    {
        $host = strtolower((string) parse_url($url ?? '', PHP_URL_HOST));
        return strlen($url ?? '') <= 255 && parse_url($url ?? '', PHP_URL_SCHEME) === 'https'
            && ($host === 'googleusercontent.com' || str_ends_with($host, '.googleusercontent.com')) ? $url : '';
    }

    public static function sync(User $user, $identity): void
    {
        $raw = $identity->getRaw();
        $name = preg_split('/\s+/', trim((string) $identity->getName()), 2);
        $fields = [
            'first_name' => mb_substr(trim((string) ($raw['given_name'] ?? $name[0] ?? $user->first_name)), 0, 100),
            'last_name' => mb_substr(trim((string) ($raw['family_name'] ?? $name[1] ?? '')), 0, 100),
            'avatar' => self::avatar($identity->getAvatar()),
        ];
        if (($raw['email_verified'] ?? false) === true && $identity->getEmail()) {
            $email = mb_strtolower(trim($identity->getEmail()));
            $other = MultiDB::hasUser(['email' => $email]);
            abort_if($other && $other->id !== $user->id, 409, 'This Google email is already linked to another account.');
            $fields += ['email' => $email, 'email_verified_at' => $user->email_verified_at ?: now(), 'confirmation_code' => null];
        }
        $user->forceFill($fields)->save();
    }
}
