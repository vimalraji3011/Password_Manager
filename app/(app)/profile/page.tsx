import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { ProfileView } from '@/components/profile/profile-view';
import { getCurrentUser, toSafeUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'My profile' };

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div>
      <PageHeader
        title="My profile"
        description="Your account details and the password you use to sign in and to reveal credentials."
      />

      <ProfileView user={toSafeUser(user)} />
    </div>
  );
}
