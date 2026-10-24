# Usage analytics

Open `/admin/analytics` and sign in with an email in `ADMIN_EMAILS` (default: metzdevan@gmail.com). The API requires the existing session; it does not expose reports publicly.

Anonymous opens collect a random daily ID, UTC day, installed/browser status, returning status, first open this ISO week/month, and server-derived country. IDs rotate at UTC midnight. Country comes from Cloudflare request metadata; IP addresses are not stored. Rate limits use a salted hash of the connecting IP (salt changes when the Worker isolate restarts). No coordinates, account IDs, emails, URLs, UA strings or map content are collected. Analytics requests omit cookies.

Features collect only an allowlisted feature name, optional ok/fail outcome, UTC day, first-use-in-week/month flags, daily ID, installed status, app version and country. Layer toggles, basemap changes and sync outcomes are deduplicated per page session/day. Search and offline download have no corresponding action in this app and are not instrumented. Failed or cancelled shares are not counted as successful file delivery; export counts record the export action.

D1 stores opens in `usage_pings` (one row per day/ID) and feature counts in `feature_uses` (day/ID/feature/outcome). Rows older than 400 days are pruned on incoming analytics requests. Optional Analytics Engine binding `USAGE` writes to `fhm_usage`; its retention is managed by Cloudflare independently. Cloudflare Web Analytics supplies cookieless page-view measurements. View it at Cloudflare dashboard → Analytics & Logs → Web Analytics → freehuntingmap.com.

DAU is today's distinct daily IDs. WAU is the sum of first-open-in-week flags during the current UTC ISO week (Monday onward). MAU is the sum of first-open-in-month flags during the current UTC calendar month. These count devices with intact local analytics state, not identifiable people. New means an open with no earlier UTC open day stored locally; returning means an earlier day exists. Thirty-day country and audience totals count user-days, not monthly unique people.

Feature uses are action counts. Today’s feature users count distinct daily IDs; weekly/monthly users count locally tracked first-use-in-period flags, collapsed across outcomes. Active percentage divides these by DAU/WAU/MAU. Queue loss, cleared storage, blocked storage, multiple devices and offline delays affect all counts. First-use flags are recorded when queued; events discarded at the queue cap cannot be recovered. Repeated outcomes on the same day preserve the first-use flags on the aggregate row.

The client keeps one pending open and at most 100 feature events for seven days in localStorage, flushing on boot, reconnect, a ten-second debounce and page hiding. Each batch uses its original day's ID. This analytics-only localStorage is an explicit exception to map-data IndexedDB conventions. DNT or GPC clears analytics state and prevents collection. “Usage analytics” defaults on; switching it off clears state and reloads to unload the Web Analytics beacon. The preference is device-local and never synced. The beacon loads only online on the two production hostnames.

## Operations

Apply migrations and query D1:

```sh
npx wrangler d1 migrations apply free-hunting-map --remote
npx wrangler d1 execute free-hunting-map --remote --command "SELECT day,COUNT(*) AS users FROM usage_pings GROUP BY day ORDER BY day DESC LIMIT 30"
npx wrangler d1 execute free-hunting-map --remote --command "SELECT feature,SUM(count) AS uses FROM feature_uses WHERE day >= date('now','start of month') GROUP BY feature"
```

Analytics Engine SQL API (use an account-scoped token with Analytics read permission):

```sh
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  --data "SELECT blob1 AS country, SUM(_sample_interval) AS opens FROM fhm_usage WHERE timestamp > NOW() - INTERVAL '30' DAY AND blob2 IN ('pwa','browser') GROUP BY country"
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  --data "SELECT blob1 AS feature, SUM(_sample_interval) AS uses FROM fhm_usage WHERE timestamp > NOW() - INTERVAL '30' DAY AND blob4 IN ('pwa','browser') GROUP BY feature"
```

Open points: index=day, blobs=country/pwa-or-browser/new-or-returning, doubles=1/first-week/first-month. Feature points: index=feature, blobs=feature/outcome/version/pwa-or-browser/country, double=1. Analytics Engine is sampled; use `SUM(_sample_interval)` for weighted counts. D1 is the source for the admin page. Retried feature requests can count twice if a successful response is lost; this lightweight counter intentionally has no persistent event identifier.
