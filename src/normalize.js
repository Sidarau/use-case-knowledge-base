const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'igshid', 'ref', 's', 't',
]);

export function normalizeUrl(raw) {
  if (!raw || !/^https?:\/\//i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    // Remove www.
    u.hostname = u.hostname.replace(/^www\./, '');
    // Normalize twitter.com → x.com
    if (u.hostname === 'twitter.com') u.hostname = 'x.com';
    // Strip tracking params
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) u.searchParams.delete(key);
    }
    // Sort remaining params for consistency
    u.searchParams.sort();
    // Remove fragment
    u.hash = '';
    // Build and strip trailing slash (except root)
    let out = u.toString();
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return raw;
  }
}
