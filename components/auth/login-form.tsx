'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { apiFetch, useMutation } from '@/hooks/use-api';
import {
  PASSWORD_KDF,
  PasswordKdfUnavailableError,
  derivePasswordProof,
  kdfSupported,
  type PasswordKdf,
} from '@/lib/password-kdf';
import type { SafeUser } from '@/types';

/** localStorage key for the remembered address. Only the email, never a password. */
const REMEMBER_KEY = 'opm:last-email';

/**
 * Sanitise the `?next=` destination.
 *
 * `next` arrives in the URL, so anyone can put anything in it. A bare
 * `startsWith('/')` test is not enough: `//evil.example` and `/\evil.example`
 * are both protocol-relative URLs that browsers happily resolve to another
 * origin, which would turn the login screen into an open redirect — the classic
 * setup for a convincing credential-phishing link that genuinely starts on the
 * real vault's domain.
 *
 * Only a single-slash, same-origin path is accepted; anything else falls back
 * to the dashboard.
 */
function safeNextPath(value: string | null): string {
  if (!value) return '/dashboard';
  if (!value.startsWith('/')) return '/dashboard';
  // Rules out `//host` and the backslash variant `/\host`, which some parsers
  // and proxies still normalise into a scheme-relative URL.
  const second = value.charAt(1);
  if (second === '/' || second === '\\') return '/dashboard';
  return value;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get('next');

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [remember, setRemember] = React.useState(false);

  // Explain an automatic sign-out rather than leaving the user to wonder why
  // they are back at the login screen.
  React.useEffect(() => {
    if (params.get('timeout') !== '1') return;
    toast.info('Signed out', {
      description: 'Your session ended after a period of inactivity.',
    });
  }, [params]);

  // Prefill from a previous "remember me". Runs after mount so the server-
  // rendered markup and the first client render agree.
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setEmail(saved);
        setRemember(true);
      }
    } catch {
      // Private browsing can throw on localStorage access; prefill is optional.
    }
  }, []);

  /**
   * Sign in without ever putting the password on the wire.
   *
   * Ask the server which credential this account expects, derive the proof
   * locally when it wants one, and post that instead. A legacy account is told
   * to send the password one final time — the login route upgrades it in place,
   * so this is the last request that will ever carry it.
   */
  const login = useMutation(
    async (input: { email: string; password: string; remember: boolean }) => {
      const { kdf } = await apiFetch<{ kdf: PasswordKdf; iterations: number }>(
        '/api/auth/prelogin',
        { method: 'POST', json: { email: input.email } },
      );

      const credential =
        kdf === PASSWORD_KDF
          ? await derivePasswordProof(input.password, input.email)
          : input.password;

      return apiFetch<{ user: SafeUser }>('/api/auth/login', {
        method: 'POST',
        json: { email: input.email, password: credential, remember: input.remember },
      });
    },
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    /**
     * Refuse rather than fall back.
     *
     * WebCrypto is missing only on an insecure origin. Quietly posting the raw
     * password in that case would hand an attacker a downgrade they could force
     * by stripping TLS, so this fails closed and says why.
     */
    if (!kdfSupported()) {
      toast.error('Insecure connection', { description: new PasswordKdfUnavailableError().message });
      return;
    }

    await login.run(
      { email, password, remember },
      {
        onSuccess: ({ user }) => {
          try {
            if (remember) window.localStorage.setItem(REMEMBER_KEY, email);
            else window.localStorage.removeItem(REMEMBER_KEY);
          } catch {
            // Non-fatal.
          }

          // `replace` so Back does not land on the login screen post-auth.
          router.replace(safeNextPath(nextPath));
          router.refresh();
          void user;
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field label="Work email" htmlFor="email" required error={login.fieldErrors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoFocus
          placeholder="you@company.com"
          icon={<Mail />}
          value={email}
          invalid={Boolean(login.fieldErrors.email)}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        required
        error={login.fieldErrors.password}
        action={
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            tabIndex={0}
          >
            Forgot password?
          </Link>
        }
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          invalid={Boolean(login.fieldErrors.password)}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <div className="flex items-center gap-2.5">
        <Checkbox
          id="remember"
          checked={remember}
          onCheckedChange={(checked) => setRemember(checked === true)}
        />
        <Label htmlFor="remember" className="cursor-pointer text-sm font-normal text-muted-foreground">
          Remember my email on this device
        </Label>
      </div>

      <Button
        type="submit"
        variant="gradient"
        size="lg"
        className="w-full"
        loading={login.submitting}
      >
        {login.submitting ? 'Signing in…' : 'Sign in'}
        {login.submitting ? null : <ArrowRight />}
      </Button>
    </form>
  );
}
