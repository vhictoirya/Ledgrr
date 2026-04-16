"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { privyConfig } from "@/lib/privy-config";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="bg-gray-950 text-gray-100 min-h-screen font-sans">
        <PrivyProvider appId={appId} config={privyConfig}>
          {children}
        </PrivyProvider>
      </body>
    </html>
  );
}
