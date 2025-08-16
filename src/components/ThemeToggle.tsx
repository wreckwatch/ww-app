'use client';
import { useTheme } from 'next-themes';

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm"
    >
      {isDark ? 'Light' : 'Dark'}
    </button>
  );
}
