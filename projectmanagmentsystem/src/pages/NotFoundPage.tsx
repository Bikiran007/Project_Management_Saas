import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo />
      <h1 className="text-4xl font-bold text-slate-900">404</h1>
      <p className="text-slate-500">We couldn't find that page.</p>
      <Link to="/dashboard" className="text-sm font-medium text-brand-600 hover:underline">Back to dashboard</Link>
    </div>
  );
}
