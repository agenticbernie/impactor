import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Impactor — From contract to application', template: '%s · Impactor' },
  description: 'Build an Avalanche dApp visually. Compose your interface, connect a contract, test on Fuji, and take your Next.js source with you.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to content</a>{children}</body></html>;
}
