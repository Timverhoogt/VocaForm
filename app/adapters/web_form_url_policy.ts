import type { WebFormProvider } from "./web_form_inspection";

export interface PreparedWebFormUrl {
  provider: WebFormProvider;
  url: URL;
  queryParametersRemoved: boolean;
}

const GOOGLE_RESPONDER_HOSTS = new Set(["docs.google.com", "forms.gle"]);
const MICROSOFT_RESPONDER_HOSTS = new Set([
  "forms.office.com",
  "forms.cloud.microsoft",
  "forms.microsoft.com"
]);
const MICROSOFT_QUERY_ALLOWLIST = new Set([
  "embed",
  "id",
  "lang",
  "origin",
  "route",
  "sharetoken",
  "source",
  "topview"
]);

const PROVIDER_AUTHENTICATION_HOSTS: Record<WebFormProvider, string[]> = {
  google_forms: [
    "accounts.google.com",
    "docs.google.com"
  ],
  microsoft_forms: [
    "account.live.com",
    "forms.cloud.microsoft",
    "forms.microsoft.com",
    "forms.office.com",
    "login.live.com",
    "login.microsoft.com",
    "login.microsoftonline.com",
    "login.windows.net"
  ]
};

const PROVIDER_ASSET_SUFFIXES: Record<WebFormProvider, string[]> = {
  google_forms: [
    "google.com",
    "googleapis.com",
    "googleusercontent.com",
    "gstatic.com"
  ],
  microsoft_forms: [
    "azureedge.net",
    "azurefd.net",
    "live.com",
    "msauth.net",
    "msftauth.net",
    "microsoft.com",
    "microsoftonline.com",
    "microsoftonline-p.com",
    "microsoftusercontent.com",
    "office.com",
    "office.net",
    "officeapps.live.com",
    "windows.net"
  ]
};

export class WebFormUrlPolicyError extends Error {}

export function prepareWebFormUrl(value: string | URL): PreparedWebFormUrl {
  const input = typeof value === "string" ? value.trim() : value.href;
  if (!input || input.length > 4_096) throw new WebFormUrlPolicyError("Enter a valid web-form URL.");

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new WebFormUrlPolicyError("Enter a valid absolute web-form URL.");
  }

  if (url.protocol !== "https:") throw new WebFormUrlPolicyError("Web-form inspection requires HTTPS.");
  if (url.username || url.password) {
    throw new WebFormUrlPolicyError("Credential-bearing URLs are not accepted.");
  }

  const provider = detectWebFormProvider(url);
  if (!provider) {
    throw new WebFormUrlPolicyError("Use a public Google Forms or Microsoft Forms responder URL.");
  }

  const before = url.search;
  if (provider === "google_forms") {
    url.search = "";
  } else {
    for (const key of [...url.searchParams.keys()]) {
      if (!MICROSOFT_QUERY_ALLOWLIST.has(key.toLowerCase())) url.searchParams.delete(key);
    }
  }
  url.hash = "";

  return {
    provider,
    url,
    queryParametersRemoved: before !== url.search
  };
}

export function detectWebFormProvider(value: string | URL): WebFormProvider | null {
  let url: URL;
  try {
    url = typeof value === "string" ? new URL(value) : value;
  } catch {
    return null;
  }

  const hostname = normalizeHostname(url.hostname);
  if (GOOGLE_RESPONDER_HOSTS.has(hostname) && isGoogleResponderPath(hostname, url.pathname)) {
    return "google_forms";
  }
  if (MICROSOFT_RESPONDER_HOSTS.has(hostname) && isMicrosoftResponderPath(url.pathname)) {
    return "microsoft_forms";
  }
  return null;
}

export function isProviderAssetUrlAllowed(provider: WebFormProvider, value: string | URL): boolean {
  let url: URL;
  try {
    url = typeof value === "string" ? new URL(value) : value;
  } catch {
    return false;
  }

  if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") return true;
  if (url.protocol !== "https:") return false;
  const hostname = normalizeHostname(url.hostname);
  return PROVIDER_ASSET_SUFFIXES[provider].some((suffix) => hostMatchesSuffix(hostname, suffix));
}

export function isProviderAuthenticationUrlAllowed(
  provider: WebFormProvider,
  value: string | URL
): boolean {
  let url: URL;
  try {
    url = typeof value === "string" ? new URL(value) : value;
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const hostname = normalizeHostname(url.hostname);
  return PROVIDER_AUTHENTICATION_HOSTS[provider].some((allowed) => hostMatchesSuffix(hostname, allowed));
}

function isGoogleResponderPath(hostname: string, pathname: string): boolean {
  if (hostname === "forms.gle") return pathname.length > 1;
  return pathname.startsWith("/forms/") && /\/viewform\/?$/i.test(pathname);
}

function isMicrosoftResponderPath(pathname: string): boolean {
  return /^\/r\/[^/]+\/?$/i.test(pathname)
    || /^\/e\/[^/]+\/?$/i.test(pathname)
    || /^\/pages\/(?:response|shareform)page\.aspx$/i.test(pathname);
}

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}
