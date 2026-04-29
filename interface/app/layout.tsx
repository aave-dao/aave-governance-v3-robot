import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { AppBar } from '@/components/AppBar';
import { ToastProvider } from '@/components/ui/Toast';
import { WalletProvider } from '@/lib/wallet';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata = {
  title: 'Aave Governance V3 — Robot',
  description: 'Operator interface for the Aave Governance V3 keeper',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen">
        <ToastProvider>
          <WalletProvider>
            <AppBar />
            <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8">{children}</div>
          </WalletProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
