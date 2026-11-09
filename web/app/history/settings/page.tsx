import { redirect } from 'next/navigation'

// Settings now lives at its own top-level route.
export default function HistorySettingsPage() {
  redirect('/settings')
}
