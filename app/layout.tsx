import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import PersistentPlayerHost from "./(earprint)/PersistentPlayerHost";
import { isYoutubeResolveTestServerEnabled } from "@/app/lib/youtubeResolveTestEnv";

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
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  userScalable: true,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("spotify_access_token")?.value ?? "";
  const youtubeResolveTestFromServer = isYoutubeResolveTestServerEnabled();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PersistentPlayerHost
          accessToken={accessToken}
          youtubeResolveTestFromServer={youtubeResolveTestFromServer}
        >
          {children}
        </PersistentPlayerHost>
      </body>
    </html>
  );
}
