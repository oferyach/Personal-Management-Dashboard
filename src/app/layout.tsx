import type { Metadata, Viewport } from "next";
import { getConfig } from "@/lib/env";
import { getI18n } from "@/i18n/requestLocale";
import { dirOf, langOf } from "@/i18n/locales";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f9fb" },
    { media: "(prefers-color-scheme: dark)", color: "#1c2129" },
  ],
};

/**
 * Layout metadata. One source only (Next 16 rejects `metadata` +
 * `generateMetadata` together): the static privacy bits and the localized
 * title/description are returned from the same place.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return {
    title: dict.app.name,
    description: dict.app.tagline,
    // Private self-hosted tool: not indexable (spec §19).
    robots: { index: false, follow: false },
    icons: [{ rel: "icon", url: "/favicon.svg" }],
  };
}

/**
 * The document direction is decided here, once, on the server, before any
 * markup is sent. Because every spacing/alignment rule in globals.css uses
 * logical properties, RTL is this `dir` attribute — not a second stylesheet.
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const env = getConfig();
  const { locale } = await getI18n();

  return (
    <html
      lang={langOf(locale)}
      dir={dirOf(locale)}
      data-locale={locale}
      data-default-language={env.defaultLanguage}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
