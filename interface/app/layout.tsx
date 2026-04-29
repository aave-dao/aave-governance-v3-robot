import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Aave Governance V3 — Robot',
  description: 'Operator interface for the Aave Governance V3 keeper',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
