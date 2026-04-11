import { redirect } from 'next/navigation'

export default function TheGapPage() {
  redirect('/chat?prefill=Show+me+my+gap+analysis')
}
