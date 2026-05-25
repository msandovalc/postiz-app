import { parse } from 'tldts';

export function getCookieUrlFromDomain(domain: string) {
  // If the domain is localhost, do not set a domain on the cookie.
  // This ensures the cookie works correctly in local development environments.
  if (domain.includes('localhost') || domain.includes('127.0.0.1')) {
    return undefined;
  }

  // If it's a subdomain of duckdns.org (or similar dynamic DNS services),
  // do not set a domain. This allows the cookie to be valid only for
  // the exact subdomain, fixing the "rejected for invalid domain" error.
  if (domain.includes('duckdns.org')) {
    return undefined;
  }

  // For any other domain (real production with a custom domain),
  // extract the main domain to allow sharing cookies across subdomains.
  try {
    const url = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
    const hostname = url.hostname;
    // If it's an IP address or a simple domain (e.g., "localhost"), return undefined
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.split('.').length <= 2) {
      return undefined;
    }
    // For domains like "example.com", return ".example.com" to allow subdomain sharing
    const parts = hostname.split('.');
    return '.' + parts.slice(-2).join('.');
  } catch {
    // If we can't parse the domain, it's safer to not set a domain on the cookie
    return undefined;
  }
}