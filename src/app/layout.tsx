import './globals.css';
import TopBar from '@/components/TopBar';
import { ThemeProvider } from 'next-themes';

export const metadata = {
  title: 'WreckWatch',
  description: 'Search auction records',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* ThemeProvider will set class="light" or "dark" on <html> */}
      <body className="bg-[var(--bg)] text-[var(--fg)]">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {/* global spacing variables (do NOT hardcode colors here) */}
          <div style={{ ['--appbar-h' as any]: '64px' } as React.CSSProperties} />
          <TopBar />
          <main className="pt-[var(--appbar-h)]">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
