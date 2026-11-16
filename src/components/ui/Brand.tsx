import Link from 'next/link';

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand" aria-label="Impactor home"><span className="brand-symbol" aria-hidden="true"><span /><span /><span /></span>{!compact && <span>impactor<span className="brand-period">.</span></span>}</Link>;
}
