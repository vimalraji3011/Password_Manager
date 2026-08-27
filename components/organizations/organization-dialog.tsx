'use client';

import * as React from 'react';
import { Building2 } from 'lucide-react';
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
import { apiFetch, useMutation } from '@/hooks/use-api';
import type { Organization } from '@/types';

/**
 * Create/edit dialog for an organization.
 *
 * One component covers both modes: `organization` present means edit (PATCH),
 * absent means create (POST). Sharing it guarantees the two forms cannot drift
 * apart in validation or layout.
 */
export function OrganizationDialog({
  open,
  onOpenChange,
  organization,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization?: Organization | null;
  onSaved: () => void | Promise<void>;
}) {
  const isEdit = Boolean(organization);

  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');

  // Reset the fields each time the dialog opens so an edit never shows the
  // previous record and a create never shows leftover input.
  React.useEffect(() => {
    if (open) {
      setName(organization?.name ?? '');
      setDescription(organization?.description ?? '');
    }
  }, [open, organization]);

  const save = useMutation((input: { name: string; description: string }) =>
    isEdit
      ? apiFetch<Organization>(`/api/organizations/${organization!.id}`, {
          method: 'PATCH',
          json: input,
        })
      : apiFetch<Organization>('/api/organizations', { method: 'POST', json: input }),
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    await save.run(
      { name, description },
      {
        successMessage: isEdit ? 'Organization updated' : 'Organization created',
        onSuccess: async () => {
          onOpenChange(false);
          await onSaved();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit organization' : 'New organization'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Rename this organization or update its description. Its credentials are unaffected.'
                : 'Organizations group related credentials — one per company, client or environment.'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-5">
            <Field
              label="Organization name"
              htmlFor="org-name"
              required
              error={save.fieldErrors.name}
              hint="Must be unique. For example: Aafiya, Netkathir, Corporate IT."
            >
              <Input
                id="org-name"
                autoFocus
                placeholder="Aafiya"
                icon={<Building2 />}
                value={name}
                invalid={Boolean(save.fieldErrors.name)}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <Field
              label="Description"
              htmlFor="org-description"
              error={save.fieldErrors.description}
              hint="Optional. Helps whoever comes looking for a credential later."
            >
              <Textarea
                id="org-description"
                placeholder="Primary operating company"
                maxLength={280}
                value={description}
                invalid={Boolean(save.fieldErrors.description)}
                onChange={(event) => setDescription(event.target.value)}
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
              {isEdit ? 'Save changes' : 'Create organization'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
