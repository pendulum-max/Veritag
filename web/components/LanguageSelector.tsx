"use client";

import { LOCALE_LABELS, SUPPORTED_LOCALES, useI18n, type Locale } from "@/lib/i18n";

export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();

  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className="sr-only">{t("nav.language")}</span>
      <select
        aria-label={t("nav.language")}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 focus:border-blue-500 focus:outline-none"
      >
        {SUPPORTED_LOCALES.map((code) => {
          const info = LOCALE_LABELS[code];
          return (
            <option key={code} value={code}>
              {info.flag} · {info.nativeName}
            </option>
          );
        })}
      </select>
    </label>
  );
}
