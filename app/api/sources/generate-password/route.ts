import { ok, withAuth } from '@/lib/api';
import { generatePassword } from '@/lib/crypto';

/**
 * GET /api/sources/generate-password
 *
 * Generated server-side with Node's CSPRNG rather than in the browser, so the
 * quality of the randomness does not depend on the client. Admin only: there is
 * no reason for a read-only account to be minting credentials.
 */
export const GET = withAuth<{ password: string }>(
  async () => {
    const response = ok({ password: generatePassword(20) });
    response.headers.set('cache-control', 'no-store');
    return response;
  },
  { role: 'admin' },
);
