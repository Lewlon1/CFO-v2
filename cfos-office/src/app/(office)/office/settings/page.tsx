import { AccountDataManagement } from '@/components/settings/AccountDataManagement'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { SignOutButton } from './SignOutButton'

export default function SettingsPage() {
  return (
    <div className="px-3.5 pt-2 pb-24 space-y-6">
      <section>
        <h2 className="text-sm font-medium text-foreground mb-3">Appearance</h2>
        <ThemeToggle variant="row" />
      </section>

      <SignOutButton />
      <AccountDataManagement />
    </div>
  )
}
