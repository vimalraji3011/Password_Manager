import {
  clientIp,
  fail,
  forbidden,
  notFound,
  ok,
  parseId,
  readBody,
  userAgent,
  withAuthParams,
} from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { comparePassword } from '@/lib/auth';
import { REVEAL_VISIBLE_SECONDS } from '@/lib/constants';
import { decrypt } from '@/lib/crypto';
import { notify } from '@/lib/notify';
import { organizations, sources } from '@/lib/repository';
import { LIMITS, rateLimit, resetRateLimit } from '@/lib/rate-limit';
import { fieldErrors, revealSchema } from '@/lib/validation';

type Params = { id: string };

/**
 * POST /api/sources/[id]/reveal
 *
 * The one endpoint that returns a decrypted credential. Every guard that
 * matters is here, in this order:
 *
 *  1. **Role.** Viewers are refused outright — the requirement is that a Viewer
 *     can never reveal a password, so this is not merely a hidden button.
 *  2. **Rate limit.** Caps how fast an attacker with a live session can drain
 *     the vault, and how fast they can guess the login password below.
 *  3. **Re-authentication.** The caller must retype their own login password.
 *     A stolen session cookie alone is therefore not enough to read secrets.
 *  4. **Audit + notify.** Every successful reveal is recorded and the other
 *     admins are emailed, so a compromise leaves a trail.
 *
 * The plaintext is returned once, over HTTPS, and the client is told how long to
 * display it. It is never cached: `no-store` keeps it out of the browser cache
 * and out of any intermediate proxy.
 */
export const POST = withAuthParams<
  { password: string; visibleForSeconds: number; source: string; organization: string },
  Params
>(
  async ({ params, request, user }) => {
    // Belt and braces: `withAuthParams` already enforces the role, but this is
    // the most security-sensitive handler in the app, so it re-checks.
    if (user.role !== 'admin') {
      return forbidden('Viewer accounts cannot reveal stored passwords.');
    }

    const id = parseId(params.id);
    if (!id) return fail('Invalid source id.', 400);

    const limit = await rateLimit({ key: `reveal:${user.id}`, ...LIMITS.reveal });
    if (!limit.allowed) {
      return fail(
        `Too many reveal attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
        429,
      );
    }

    const parsed = revealSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      return fail('Enter your login password to continue.', 422, fieldErrors(parsed.error));
    }

    const source = await sources.byId(id);
    if (!source) return notFound('Source');

    const confirmed = await comparePassword(parsed.data.password, user.passwordHash);
    if (!confirmed) {
      // Audited: repeated failures here are a strong signal of a stolen session.
      await recordAudit({
        action: 'LOGIN_FAILED',
        actor: { id: user.id, name: user.name, email: user.email },
        ip: clientIp(request),
        userAgent: userAgent(request),
        sourceId: id,
        source: source.source,
        detail: 'Incorrect password on reveal attempt',
      });

      return fail('That password is not correct.', 401, {
        password: 'Incorrect password. Try again.',
      });
    }

    const organization = await organizations.byId(source.organizationId);

    // Let a decryption failure surface: it means the key changed or the file was
    // tampered with, and silently returning nothing would hide a real problem.
    const plaintext = decrypt(source.password);

    // A correct password clears the counter so normal use is never throttled.
    await resetRateLimit(`reveal:${user.id}`);

    await recordAudit({
      action: 'PASSWORD_VIEWED',
      actor: { id: user.id, name: user.name, email: user.email },
      ip: clientIp(request),
      userAgent: userAgent(request),
      organizationId: source.organizationId,
      organization: organization?.name ?? null,
      sourceId: source.id,
      source: source.source,
      detail: `Revealed for ${REVEAL_VISIBLE_SECONDS} seconds`,
    });

    void notify.passwordRevealed(
      user,
      organization?.name ?? 'Unknown',
      source.source,
      clientIp(request),
    );

    const response = ok({
      password: plaintext,
      visibleForSeconds: REVEAL_VISIBLE_SECONDS,
      source: source.source,
      organization: organization?.name ?? 'Unknown',
    });

    // Belongs in nobody's cache, at any layer.
    response.headers.set('cache-control', 'no-store, no-cache, must-revalidate, private');
    response.headers.set('pragma', 'no-cache');

    return response;
  },
  { role: 'admin' },
);
