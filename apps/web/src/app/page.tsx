import { redirect } from 'next/navigation';

export default function RootPage() {
  // O middleware decide entre /dashboard e /login conforme a sessão.
  redirect('/dashboard');
}
