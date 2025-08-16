'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

const nav = [
  { href: '/', label: 'Home' },
  { href: '/search', label: 'Search' },
  // { href: '/pricing', label: 'Pricing' },
  // { href: '/about', label: 'About' },
];

export default function TopBar() {
  const pathname = usePathname();

  return (
    <header className="fixed inset-x-0 top-0 z-40 h-[var(--appbar-h)]">
      {/* Solid brand bar (lime) */}
      <div className="[background:var(--brand)] text-white shadow-[0_2px_0_rgba(0,0,0,0.15)] h-full">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-3">
            {/* If you already have an icon, swap the square below for your <Image /> */}
            {/* <Image src="/logo-mark-light.svg" alt="WreckWatch" width={28} height={28} priority /> */}
            <div className="h-7 w-7 rounded-md bg-white/15" aria-hidden />
            <span className="text-lg font-extrabold tracking-tight">WreckWatch</span>
          </Link>

          {/* Nav (desktop) */}
          <nav className="hidden md:flex items-center gap-6">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-sm font-medium transition-opacity ${
                    active ? 'opacity-100' : 'opacity-90 hover:opacity-100'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-md bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/15"
            >
              Log in
            </Link>
            {/* Primary CTA (optional)
            <Link
              href="/subscribe"
              className="rounded-md bg-white text-[var(--brand)] px-3 py-1.5 text-sm font-bold hover:bg-white/90"
            >
              Subscribe
            </Link> */}
          </div>
        </div>
      </div>
    </header>
  );
}
