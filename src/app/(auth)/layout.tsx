import { LanguageToggle } from "@/i18n/LanguageToggle";
import { getI18n } from "@/i18n/requestLocale";

export default async function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { dict, locale } = await getI18n();

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-5">
      <div className="border-border bg-card w-full max-w-md rounded-(--radius-card) border p-6">
        <div className="flex items-start justify-between gap-3">
          <p className="text-muted-foreground text-sm font-semibold">{dict.app.name}</p>
          <LanguageToggle locale={locale} dict={dict} nextPath="/login" />
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
