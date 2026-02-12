import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Synra - Managed MCP Gateway",
    template: "%s | Synra"
  },
  description: "Connect AI assistants to your databases and tools through a secure MCP gateway. No config files, no local servers.",
  icons: {
    icon: "/synraico.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-ZKDWCL1QP5"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-ZKDWCL1QP5');
          `}
        </Script>
        <Script
          src="https://t.contentsquare.net/uxa/9037ef9b7b84e.js"
          strategy="afterInteractive"
        />
      </head>
      <body
        className={`${geistMono.variable} antialiased bg-[#0a0a0a] text-gray-100 min-h-screen font-mono`}
      >
        {children}
      </body>
    </html>
  );
}
