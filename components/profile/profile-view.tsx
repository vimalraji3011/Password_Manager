'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Clock3, KeyRound, Mail, Phone, Save, ShieldCheck, User2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Separator } from '@/components/ui/separator';
import { apiFetch, useMutation } from '@/hooks/use-api';
import { formatDateTime, initials } from '@/lib/utils';
import type { SafeUser } from '@/types';

/**
 * Profile page.
 *
 * Two independent forms — details and password — so a failure in one does not
 * discard what was typed in the other. Email and role are shown read-only: the
 * email is the login identity and the role is the permission boundary, so
 * neither is self-editable.
 */
export function ProfileView({ user }: { user: SafeUser }) {
  const router = useRouter();

  const [name, setName] = React.useState(user.name);
  const [mobile, setMobile] = React.useState(user.mobile);

  const [currentPassword, setCurrentPassword] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');

  const saveProfile = useMutation((input: { name: string; mobile: string }) =>
    apiFetch<SafeUser>('/api/profile', { method: 'PATCH', json: input }),
  );

  const changePassword = useMutation(
    (input: { currentPassword: string; password: string; confirmPassword: string }) =>
      apiFetch<{ changed: true }>('/api/profile/password', { method: 'POST', json: input }),
  );

  const detailsDirty = name !== user.name || mobile !== user.mobile;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Identity summary */}
      <Card glass className="lg:col-span-1">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <Avatar className="size-14">
              <AvatarFallback className="text-base">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{user.name}</p>
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>

          <Separator className="my-5" />

          <dl className="space-y-3 text-sm">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Role</dt>
                <dd className="mt-0.5">
                  <Badge variant={user.role === 'admin' ? 'default' : 'neutral'}>
                    {user.role === 'admin' ? 'System Admin' : 'Viewer'}
                  </Badge>
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Last sign-in</dt>
                <dd className="mt-0.5 truncate">{formatDateTime(user.lastLogin)}</dd>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <User2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Account created</dt>
                <dd className="mt-0.5 truncate">{formatDateTime(user.createdAt)}</dd>
              </div>
            </div>
          </dl>

          <p className="mt-5 rounded-lg border border-border/70 bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            {user.role === 'admin'
              ? 'Your login password is also what you type to reveal a stored credential. Rotating it here changes both.'
              : 'Viewer accounts can browse organizations and sources but cannot reveal, edit or delete credentials.'}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4 lg:col-span-2">
        {/* Details */}
        <Card glass>
          <CardHeader>
            <CardTitle>Your details</CardTitle>
            <CardDescription>
              Your email address and role are managed by a System Admin and cannot be changed here.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form
              className="space-y-5"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                await saveProfile.run(
                  { name, mobile },
                  {
                    successMessage: 'Profile updated',
                    // Refresh so the topbar and sidebar pick up the new name.
                    onSuccess: () => router.refresh(),
                  },
                );
              }}
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Full name" htmlFor="profile-name" required error={saveProfile.fieldErrors.name}>
                  <Input
                    id="profile-name"
                    icon={<User2 />}
                    value={name}
                    invalid={Boolean(saveProfile.fieldErrors.name)}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>

                <Field
                  label="Mobile number"
                  htmlFor="profile-mobile"
                  required
                  error={saveProfile.fieldErrors.mobile}
                >
                  <Input
                    id="profile-mobile"
                    inputMode="tel"
                    icon={<Phone />}
                    value={mobile}
                    invalid={Boolean(saveProfile.fieldErrors.mobile)}
                    onChange={(event) => setMobile(event.target.value)}
                  />
                </Field>
              </div>

              <Field label="Email address" htmlFor="profile-email" hint="Used to sign in and to receive reset codes.">
                <Input id="profile-email" icon={<Mail />} value={user.email} readOnly disabled />
              </Field>

              <div className="flex justify-end gap-2">
                {detailsDirty ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setName(user.name);
                      setMobile(user.mobile);
                    }}
                  >
                    Discard
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  variant="gradient"
                  loading={saveProfile.submitting}
                  disabled={!detailsDirty}
                >
                  <Save />
                  Save changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Password */}
        <Card glass>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              {user.role === 'admin'
                ? 'This is both your sign-in password and the password you confirm before revealing a credential.'
                : 'Used to sign in to the vault.'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form
              className="space-y-5"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                await changePassword.run(
                  { currentPassword, password, confirmPassword },
                  {
                    successMessage: 'Password changed',
                    onSuccess: () => {
                      setCurrentPassword('');
                      setPassword('');
                      setConfirmPassword('');
                    },
                  },
                );
              }}
            >
              <Field
                label="Current password"
                htmlFor="current-password"
                required
                error={changePassword.fieldErrors.currentPassword}
              >
                <PasswordInput
                  id="current-password"
                  autoComplete="current-password"
                  value={currentPassword}
                  invalid={Boolean(changePassword.fieldErrors.currentPassword)}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="New password"
                  htmlFor="profile-new-password"
                  required
                  error={changePassword.fieldErrors.password}
                  hint="At least 8 characters, mixed case and a number."
                >
                  <PasswordInput
                    id="profile-new-password"
                    autoComplete="new-password"
                    showStrength
                    value={password}
                    invalid={Boolean(changePassword.fieldErrors.password)}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>

                <Field
                  label="Confirm new password"
                  htmlFor="profile-confirm-password"
                  required
                  error={changePassword.fieldErrors.confirmPassword}
                >
                  <PasswordInput
                    id="profile-confirm-password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    invalid={Boolean(changePassword.fieldErrors.confirmPassword)}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </Field>
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="gradient"
                  loading={changePassword.submitting}
                  disabled={!currentPassword || !password || !confirmPassword}
                >
                  <KeyRound />
                  Change password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
