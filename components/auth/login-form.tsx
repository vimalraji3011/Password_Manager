'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { apiFetch, useMutation } from '@/hooks/use-api';
import type { SafeUser } from '@/types';

/** localStorage key for the remembered address. Only the email, never a password. */
const REMEMBER_KEY = 'opm:last-email';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get('next');

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [remember, setRemember] = React.useState(false);

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

  const login = useMutation((input: { email: string; password: string; remember: boolean }) =>
    apiFetch<{ user: SafeUser }>('/api/auth/login', { method: 'POST', json: input }),
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

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
          router.replace(nextPath && nextPath.startsWith('/') ? nextPath : '/dashboard');
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
