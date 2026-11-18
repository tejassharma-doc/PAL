import { redirect } from 'next/navigation'

// Lab reports are now part of the unified Records screen (/records → /records/[id]).
export default function LabReportsPage() {
  redirect('/records')
}
