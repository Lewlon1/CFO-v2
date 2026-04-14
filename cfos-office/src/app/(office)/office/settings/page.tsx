import { AccountDataManagement } from '@/components/settings/AccountDataManagement'
import { SignOutButton } from './SignOutButton'

export default function SettingsPage() {
  return (
    <div className="px-3.5 pt-2 pb-24 space-y-6">
      <SignOutButton />
      <AccountDataManagement />
    </div>
  )
}
