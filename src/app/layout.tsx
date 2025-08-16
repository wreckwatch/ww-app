import './globals.css';
import TopBar from '@/components/TopBar';

export const metadata = {
  title: 'WreckWatch',
  description: 'Search auction records',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Set shared CSS variables here so every page can use them */}
      <body
        style={
          {
            // height of the top bar (also used by sticky table headers)
            ['--appbar-h' as any]: '64px',
            // brand color for the bar
            ['--brand' as any]: '#32CD32',
            // optional UI fallbacks if you want
            ['--bg' as any]: '#0e0f12',
            ['--fg' as any]: '#e5e7eb',
            ['--card' as any]: '#111318',
            ['--border' as any]: '#1f232a',
          } as React.CSSProperties
        }
        className="bg-[var(--bg)] text-[var(--fg)]"
      >
        <TopBar />
        {/* Push page content below the fixed bar */}
        <main className="pt-[var(--appbar-h)]">{children}</main>
      </body>
    </html>
  );
}
