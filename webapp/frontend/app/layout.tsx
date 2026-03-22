import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { Wind } from "lucide-react";

export const metadata: Metadata = {
  title: "Air Quality Dashboard",
  description: "Xiaomi Air Purifier monitoring & control panel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        {/* Nav */}
        <nav className="sticky top-0 z-50 border-b border-gray-800 bg-gray-950/80 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-6">
            <Link
              href="/"
              className="flex items-center gap-2 text-white font-semibold text-lg hover:opacity-80 transition"
            >
              <Wind size={20} className="text-blue-400" />
              AirQ
            </Link>

            <div className="flex items-center gap-1 ml-2">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/control">Control</NavLink>
              <NavLink href="/history">History</NavLink>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</main>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
    >
      {children}
    </Link>
  );
}
