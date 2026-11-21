"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import de from "../locales/de.json";
import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import zh from "../locales/zh.json";

export const SUPPORTED_LOCALES = ["en", "es", "fr", "de", "zh"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_STORAGE_KEY = "veritag_locale_v1";
export const LOCALE_COOKIE_NAME = "veritag_locale";

export type LocaleMessages = typeof en;

export const LOCALE_MESSAGES: Record<Locale, LocaleMessages> = {
  en,
  es,
  fr,
  de,
  zh,
};

export const LOCALE_LABELS: Record<Locale, { name: string; nativeName: string; flag: string }> = {
  en: { name: "English", nativeName: "English", flag: "EN" },
  es: { name: "Spanish", nativeName: "Español", flag: "ES" },
  fr: { name: "French", nativeName: "Français", flag: "FR" },
  de: { name: "German", nativeName: "Deutsch", flag: "DE" },
  zh: { name: "Chinese (Simplified)", nativeName: "简体中文", flag: "ZH" },
};

/**
 * Normalizes a BCP-47 language tag (e.g. "es-MX", "zh-CN") to a supported Veritag locale.
 */
export function normalizeLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  const base = input.trim().toLowerCase().split(/[-_]/)[0];
  if (base && (SUPPORTED_LOCALES as readonly string[]).includes(base)) {
    return base as Locale;
  }
  return DEFAULT_LOCALE;
}

/**
 * Auto-detects the preferred locale from `navigator.language` / `navigator.languages`, falling back to `en`.
 */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const candidates =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const base = candidate.trim().toLowerCase().split(/[-_]/)[0];
    if (base && (SUPPORTED_LOCALES as readonly string[]).includes(base)) {
      return base as Locale;
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * Reads a persisted locale preference from `localStorage` or `document.cookie`.
 */
export function getStoredLocale(): Locale | null {
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
        return stored as Locale;
      }
    }
  } catch {
    // Ignore storage access errors
  }

  try {
    if (typeof document !== "undefined" && document.cookie) {
      const match = document.cookie
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${LOCALE_COOKIE_NAME}=`));
      if (match) {
        const val = decodeURIComponent(match.slice(LOCALE_COOKIE_NAME.length + 1));
        if ((SUPPORTED_LOCALES as readonly string[]).includes(val)) {
          return val as Locale;
        }
      }
    }
  } catch {
    // Ignore cookie access errors
  }

  return null;
}

/**
 * Persists the selected locale in both `localStorage` and a 1-year cookie, and updates `<html lang>`.
 */
export function persistLocale(locale: Locale): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    }
  } catch {
    // Ignore storage errors
  }

  try {
    if (typeof document !== "undefined") {
      document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; path=/; max-age=31536000; SameSite=Lax`;
      if (document.documentElement) {
        document.documentElement.lang = locale;
      }
    }
  } catch {
    // Ignore cookie/DOM errors
  }
}

function resolveNestedKey(obj: Record<string, unknown>, key: string): string | null {
  const parts = key.split(".");
  let curr: unknown = obj;
  for (const part of parts) {
    if (curr && typeof curr === "object" && part in curr) {
      curr = (curr as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return typeof curr === "string" ? curr : null;
}

/**
 * Resolves a dot-notation translation key for `locale`, falling back to `en` and interpolating `{{var}}`.
 */
export function getTranslation(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const table = LOCALE_MESSAGES[locale] ?? LOCALE_MESSAGES[DEFAULT_LOCALE];
  const raw =
    resolveNestedKey(table as unknown as Record<string, unknown>, key) ??
    resolveNestedKey(LOCALE_MESSAGES[DEFAULT_LOCALE] as unknown as Record<string, unknown>, key) ??
    key;

  if (!params) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, token: string) =>
    token in params ? String(params[token]) : `{{${token}}}`,
  );
}

/**
 * Flattens a nested locale dictionary into sorted dot-notation leaf keys.
 */
export function flattenTranslationKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flattenTranslationKeys(v as Record<string, unknown>, next));
    } else {
      keys.push(next);
    }
  }
  return keys.sort();
}

interface I18nContextValue {
  locale: Locale;
  messages: LocaleMessages;
  setLocale: (next: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const initial = getStoredLocale() ?? detectBrowserLocale();
    setLocaleState(initial);
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = initial;
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    const normalized = normalizeLocale(next);
    setLocaleState(normalized);
    persistLocale(normalized);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => getTranslation(locale, key, params),
    [locale],
  );

  return (
    <I18nContext.Provider
      value={{
        locale,
        messages: LOCALE_MESSAGES[locale],
        setLocale,
        t,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside <I18nProvider>");
  }
  return ctx;
}
