export function paymentReturnUrl(requestUrl: string, configuredUrl: string | undefined, development: boolean): URL {
  const incoming = new URL(requestUrl);
  // Only the local development server may override the configured deployment.
  // Never trust arbitrary Origin/forwarded-host headers for payment redirects.
  if (development && ['localhost', '127.0.0.1', '[::1]'].includes(incoming.hostname) &&
      ['http:', 'https:'].includes(incoming.protocol)) return new URL(incoming.origin);
  const raw = configuredUrl?.trim();
  if (!raw) throw new Error('Missing application URL configuration.');
  const target = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (target.username || target.password || (target.protocol !== 'https:' &&
      !(development && target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)))) {
    throw new Error('Invalid application URL configuration.');
  }
  return new URL(target.origin);
}
