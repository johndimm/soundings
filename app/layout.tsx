import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import PersistentPlayerHost from "./(earprint)/PersistentPlayerHost";
import { isYoutubeResolveTestServerEnabled } from "@/app/lib/youtubeResolveTestEnv";
import { YOUTUBE_MODE_COOKIE } from "@/app/api/auth/youtube/route";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Soundings",
  description: "Music discovery that learns your taste",
  icons: {
    icon: [{ url: "/icon.png", type: "image/png", sizes: "512x512" }],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Soundings",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  userScalable: true,
  themeColor: "#09090b",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("spotify_access_token")?.value ?? "";
  // Only force YouTube-only mode when the user has no Spotify session; a cookie alone
  // shouldn't override a real Spotify login (Settings can flip the source at runtime).
  const youtubeModeFromCookie =
    !accessToken && cookieStore.get(YOUTUBE_MODE_COOKIE)?.value === "1";
  const youtubeResolveTestFromServer = isYoutubeResolveTestServerEnabled();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased bg-zinc-950`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950">
        <PersistentPlayerHost
          accessToken={accessToken}
          youtubeResolveTestFromServer={youtubeResolveTestFromServer}
          youtubeModeFromCookie={youtubeModeFromCookie}
        >
          {children}
        </PersistentPlayerHost>
        <div style={{ position: 'fixed', top: 10, left: 10, zIndex: 9999, display: 'flex', gap: 6 }}>
          <a href="https://johndimm.org" title="All apps — John Dimm" aria-label="All apps"
             style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(20,20,22,0.82)', color: '#e5e5e5', fontSize: 15, textDecoration: 'none', backdropFilter: 'blur(4px)' }}>🏠</a>
          <a href="/about" title="About Soundings" aria-label="About"
             style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 34, padding: '0 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(20,20,22,0.82)', color: '#e5e5e5', fontSize: 13, textDecoration: 'none', backdropFilter: 'blur(4px)' }}>About</a>
        </div>
        <footer className="w-full border-t border-zinc-800 py-4 text-center text-xs text-zinc-500">
          © 2026 John Dimm
        </footer>
      </body>
    </html>
  );
}
