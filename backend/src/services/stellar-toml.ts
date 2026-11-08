export interface StellarTomlVerifyResult {
  verified: boolean;
  domain: string;
  matchedField: "SIGNING_KEY" | "ACCOUNTS" | null;
  signingKey: string | null;
  accounts: string[];
  error?: string;
}

const PRIVATE_OR_LOCAL_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fe80:/i,
];

export function isSafePublicDomain(domainInput: string): boolean {
  const cleaned = domainInput.trim().toLowerCase();
  if (!cleaned || cleaned.length > 253) return false;
  if (cleaned.includes("/") || cleaned.includes(":") || cleaned.includes("@")) return false;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned)) return false;

  for (const pattern of PRIVATE_OR_LOCAL_HOST_PATTERNS) {
    if (pattern.test(cleaned)) {
      return false;
    }
  }
  return true;
}

export function parseStellarTomlAccounts(tomlText: string): {
  signingKey: string | null;
  accounts: string[];
} {
  const signingMatch = tomlText.match(/^\s*SIGNING_KEY\s*=\s*"([^"]+)"/m);
  const signingKey = signingMatch?.[1]?.trim() ?? null;

  const accounts: string[] = [];
  const accountsBlockMatch = tomlText.match(/^\s*ACCOUNTS\s*=\s*\[([\s\S]*?)\]/m);
  if (accountsBlockMatch?.[1]) {
    const strMatches = accountsBlockMatch[1].matchAll(/"([^"]+)"/g);
    for (const m of strMatches) {
      if (m[1]) {
        accounts.push(m[1].trim());
      }
    }
  }

  return { signingKey, accounts };
}

/**
 * Fetches `https://<domain>/.well-known/stellar.toml` with SSRF protections and verifies
 * that `brandAddress` appears in either `SIGNING_KEY` or `ACCOUNTS`.
 */
export async function verifyBrandDomainToml(params: {
  domain: string;
  brandAddress: string;
  fetchImpl?: typeof fetch;
}): Promise<StellarTomlVerifyResult> {
  const domain = params.domain.trim().toLowerCase();
  if (!isSafePublicDomain(domain)) {
    return {
      verified: false,
      domain,
      matchedField: null,
      signingKey: null,
      accounts: [],
      error: "UnsafeOrInvalidDomain",
    };
  }

  const fetchFn = params.fetchImpl ?? fetch;
  const url = `https://${domain}/.well-known/stellar.toml`;

  try {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { Accept: "text/plain, application/toml" },
      redirect: "error",
    });

    if (!res.ok) {
      return {
        verified: false,
        domain,
        matchedField: null,
        signingKey: null,
        accounts: [],
        error: `HttpStatus:${res.status}`,
      };
    }

    const text = await res.text();
    const { signingKey, accounts } = parseStellarTomlAccounts(text);

    if (signingKey === params.brandAddress) {
      return {
        verified: true,
        domain,
        matchedField: "SIGNING_KEY",
        signingKey,
        accounts,
      };
    }

    if (accounts.includes(params.brandAddress)) {
      return {
        verified: true,
        domain,
        matchedField: "ACCOUNTS",
        signingKey,
        accounts,
      };
    }

    return {
      verified: false,
      domain,
      matchedField: null,
      signingKey,
      accounts,
      error: "AddressNotListedInStellarToml",
    };
  } catch (err) {
    return {
      verified: false,
      domain,
      matchedField: null,
      signingKey: null,
      accounts: [],
      error: err instanceof Error ? err.message : "StellarTomlFetchFailed",
    };
  }
}
