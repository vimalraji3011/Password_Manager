'use client';

import * as React from 'react';
import { AtSign, KeyRound, Link2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetch, useMutation } from '@/hooks/use-api';
import type { Organization, SafeSource } from '@/types';

/**
 * Create/edit dialog for a credential source.
 *
 * On edit the password field starts empty and is optional: submitting without
 * it leaves the stored ciphertext untouched. That is what makes it possible to
 * correct a username or URL without knowing the password — and it means this
 * form never has to receive a decrypted value in the first place.
 */
export function SourceDialog({
  open,
  onOpenChange,
  source,
  organizations,
  defaultOrganizationId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: SafeSource | null;
  organizations: Organization[];
  defaultOrganizationId?: number;
  onSaved: () => void | Promise<void>;
}) {
  const isEdit = Boolean(source);

  const [organizationId, setOrganizationId] = React.useState('');
  const [sourceName, setSourceName] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [notes, setNotes] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setOrganizationId(String(source?.organizationId ?? defaultOrganizationId ?? ''));
    setSourceName(source?.source ?? '');
    setUsername(source?.username ?? '');
    setUrl(source?.url ?? '');
    setNotes(source?.notes ?? '');
    // Always blank: an edit form must not hold a credential value.
    setPassword('');
  }, [open, source, defaultOrganizationId]);

  const save = useMutation((input: Record<string, unknown>) =>
    isEdit
      ? apiFetch<SafeSource>(`/api/sources/${source!.id}`, { method: 'PATCH', json: input })
      : apiFetch<SafeSource>('/api/sources', { method: 'POST', json: input }),
  );

  /** Ask the server for a strong password so generation uses a real CSPRNG. */
  async function suggestPassword() {
    try {
      const { password: generated } = await apiFetch<{ password: string }>(
        '/api/sources/generate-password',
      );
      setPassword(generated);
      toast.success('Generated a 20-character password.');
    } catch {
      toast.error('Could not generate a password. Enter one manually.');
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    const payload: Record<string, unknown> = {
      organizationId: Number(organizationId),
      source: sourceName,
      username,
      url,
      notes,
    };

    // Only send the password when there is one to set.
    if (password.length > 0) payload.password = password;

    await save.run(payload, {
      successMessage: isEdit
        ? password.length > 0
          ? 'Credential updated and password rotated'
          : 'Credential details updated'
        : 'Credential added',
      onSuccess: async () => {
        setPassword('');
        onOpenChange(false);
        await onSaved();
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{isEdit ? `Edit ${source?.source}` : 'Add credential'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Leave the password blank to keep the stored credential unchanged.'
                : 'The password is encrypted with AES-256-GCM before it is written to disk.'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Organization"
                htmlFor="source-org"
                required
                error={save.fieldErrors.organizationId}
              >
                <Select value={organizationId} onValueChange={setOrganizationId}>
                  <SelectTrigger id="source-org">
                    <SelectValue placeholder="Select an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((organization) => (
                      <SelectItem key={organization.id} value={String(organization.id)}>
                        {organization.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label="Source name"
                htmlFor="source-name"
                required
                error={save.fieldErrors.source}
                hint="AWS, GitHub, Azure, Gmail…"
              >
                <Input
                  id="source-name"
                  autoFocus
                  placeholder="AWS"
                  icon={<KeyRound />}
                  value={sourceName}
                  invalid={Boolean(save.fieldErrors.source)}
                  onChange={(event) => setSourceName(event.target.value)}
                />
              </Field>
            </div>

            <Field
              label="Username or email"
              htmlFor="source-username"
              required
              error={save.fieldErrors.username}
            >
              <Input
                id="source-username"
                placeholder="admin@company.com"
                autoComplete="off"
                icon={<AtSign />}
                value={username}
                invalid={Boolean(save.fieldErrors.username)}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>

            <Field
              label={isEdit ? 'New password' : 'Password'}
              htmlFor="source-password"
              required={!isEdit}
              error={save.fieldErrors.password}
              hint={
                isEdit
                  ? 'Optional. Fill this in only to rotate the stored password.'
                  : 'Stored encrypted. Only a System Admin can reveal it later.'
              }
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 py-1 text-xs"
                  onClick={suggestPassword}
                >
                  <Sparkles className="!size-3.5" />
                  Generate
                </Button>
              }
            >
              <PasswordInput
                id="source-password"
                autoComplete="new-password"
                placeholder={isEdit ? 'Leave blank to keep current password' : 'Enter or generate a password'}
                showStrength
                value={password}
                invalid={Boolean(save.fieldErrors.password)}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>

            <Field
              label="URL"
              htmlFor="source-url"
              error={save.fieldErrors.url}
              hint="Optional. Where this credential is used."
            >
              <Input
                id="source-url"
                type="url"
                inputMode="url"
                placeholder="https://aws.amazon.com"
                icon={<Link2 />}
                value={url}
                invalid={Boolean(save.fieldErrors.url)}
                onChange={(event) => setUrl(event.target.value)}
              />
            </Field>

            <Field
              label="Notes"
              htmlFor="source-notes"
              error={save.fieldErrors.notes}
              hint="Optional. Never put a second password in here — add another source instead."
            >
              <Textarea
                id="source-notes"
                placeholder="Root account. MFA enforced."
                maxLength={1000}
                value={notes}
                invalid={Boolean(save.fieldErrors.notes)}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={save.submitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="gradient" loading={save.submitting}>
              {isEdit ? 'Save changes' : 'Add credential'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
