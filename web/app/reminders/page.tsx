import { redirect } from 'next/navigation'

// Reminders are part of the Medicines screen now.
export default function RemindersPage() {
  redirect('/medications')
}
