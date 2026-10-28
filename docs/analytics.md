# Usage analytics

Open `/admin/analytics` and sign in with an email in `ADMIN_EMAILS` (default: metzdevan@gmail.com). The API requires the existing session; it does not expose reports publicly.

Anonymous opens collect a random daily ID, UTC day, installed/browser status, returning status, first open this ISO week/month, and server-derived country. IDs rotate at UTC midnight. Country comes from Cloudflare request metadata; IP addresses are not stored. Rate limits use a salted hash of the connecting IP (salt changes when the Worker isolate restarts). No coordinates, account IDs, emails, URLs, UA strings or map content are collected. Analytics requests omit cookies.

Features collect only an allowlisted feature name, optional ok/fail outcome, UTC day, first-use-in-week/month flags, daily ID, installed status, app version and country. Layer toggles, basemap changes and sync outcomes are deduplicated per page session/day. Organize search records the first non-empty search per panel opening. Offline download has no corresponding action in this app and is not instrumented. The public trails counter records enabling that layer; layer-specific counts are otherwise not collected. Failed or cancelled shares are not counted as successful file delivery; export counts record the export action.

D1 stores opens in `usage_pings` (one row per day/ID) and feature counts in `feature_uses` (day/ID/feature/outcome). Rows older than 400 days are pruned on incoming analytics requests. Optional Analytics Engine binding `USAGE` writes to `fhm_usage`; its retention is managed by Cloudflare independently. Cloudflare Web Analytics supplies cookieless page-view measurements. View it at Cloudflare dashboard → Analytics & Logs → Web Analytics → freehuntingmap.com.

## Admin report

`/admin/analytics` keeps the admin Google sign-in and device exclusion switch. `GET /api/admin/usage?from=YYYY-MM-DD&to=YYYY-MM-DD` accepts an inclusive range of 1–400 UTC days; omitted bounds default to the last 30 days ending today. Invalid dates or ranges return 400. Missing local `internal` columns fall back to real traffic, with each table inspected once per request.

Today counts distinct daily IDs. Rolling 7d and 30d headline totals sum user-days through today, independently of the selected range. Daily IDs rotate, so these are device approximations, not unique people across days. Range audience totals (new/returning and installed/browser), countries and feature users also count device-days. New means an open with no earlier UTC open day stored locally; returning means an earlier day exists.

The 30d/90d choices and date inputs filter the daily chart, audience, feature ranking, top 25 countries and internal summary. Reports separate `internal=1` from real traffic; internal opens and feature uses appear separately, with a dashed chart series. Bots are dropped before storage; historical bot traffic cannot be separated retroactively.

Feature uses are action counts; users collapse outcomes into one daily ID per feature/day. Ranking sorts by real device-days, then uses. OK/fail rates divide by outcomes (`ok + fail`), excluding actions without an outcome; no outcomes displays a dash. Failure rates of at least 10% are highlighted. Cleared or blocked storage, multiple devices, queue loss and offline delays affect counts. First-use flags remain stored for other analysis but are not used for rolling user-day totals.

The client keeps one pending open and at most 100 feature events for seven days in localStorage, flushing on boot, reconnect, a ten-second debounce and page hiding. Each batch uses its original day's ID. This analytics-only localStorage is an explicit exception to map-data IndexedDB conventions. DNT or GPC clears analytics state and prevents collection. “Usage analytics” defaults on; switching it off clears state and reloads to unload the Web Analytics beacon. The preference is device-local and never synced. The beacon loads only online on the two production hostnames.

Headless browsers, bots, `navigator.webdriver` and `?fhm_bot=1` skip opens, feature events and the Web Analytics beacon. The URL flag persists as localStorage `fhm_analytics_exclude=bot`; `?fhm_bot=0` clears only that bot flag. The server also drops requests with missing or bot User-Agents before any analytics or rate-limit writes. Browser verification scripts include the bot flag.

Authenticated admins can turn on “Exclude this device” to store `fhm_analytics_exclude=internal`. Opens and feature payloads then include `internal: true`; D1 retains them with `internal=1`, while Analytics Engine skips them. Turning the switch off removes the internal preference. DNT, GPC and the analytics opt-out still take precedence. Existing rows are unchanged.

A read-only check found 62 sync failures across 35 daily IDs, with 60 failures joined to new-device opens; stored rows cannot identify the exact cause. Previously, any sync setup or request error counted as `sync` failure, including signed-out session discovery and network interruptions. Failures now count only during signed-in sync, excluding 401s, offline/network errors, aborted requests and cancelled runs; a confirmed signed-out session stops automatic retries until sign-in.

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

`community_trail_upload` records `ok` when an anonymous queued scan is accepted or acknowledged as a duplicate (409), and `fail` when permanently rejected (400/413/415). Transient network failures and 429/5xx keep the queue entry for retry. This event contains no scan hash, geometry, area or model; it is independent of the anonymous community scan tables and follows the analytics opt-out.

`community_hike_share` counts `ok` on delivered deliberate shares (including 409 duplicates), and `fail` on HTTP rejection. `community_hike_report` counts `ok` on accepted reports and `fail` on HTTP rejection. Offline/network errors keep pending actions without emitting an event; retries can count again after a lost acknowledgment. Unshares do not count as shares. Both follow analytics opt-out and carry only the allowlisted feature/outcome, never hike IDs, tokens, names, geometry, month or type.
