import type { Metadata, Viewport } from 'next';
import { Orbitron, Chakra_Petch, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { AppShell } from '@/components/layout';
import { ToastProvider } from '@/components/ui';
import { DisplayPrefs } from '@/components/DisplayPrefs';

const orbitron = Orbitron({ subsets: ['latin'], weight: ['700', '900'], variable: '--font-orbitron', display: 'swap' });
const chakra = Chakra_Petch({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-chakra', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: 'Forgetting Forecast — Memory Weather',
  description: 'Forecast what you will forget, review what is fading, and check every forecast against what actually happened.',
};

export const viewport: Viewport = {
  themeColor: '#0f0826',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${orbitron.variable} ${chakra.variable} ${jetbrains.variable} dark`}>
      <body>
        <DisplayPrefs />
        <AuthProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
