# Free Hunting Map roadmap

Rough order; nothing here is built yet.

- **Download area for offline:** pre-fetch tiles for a drawn box and zoom range into the tile caches (with size estimate and per-source caps).
- **Sync server:** drain `outbox` to a small self-hostable server; pull remote changes through `mergeSets`. Shared "hunt groups" with invite codes.
- **Phone wrapper:** Capacitor build for background GPS recording and better camera/QR performance.
- **More public-lands context:** BLM Surface Management Agency layer (endpoint already verified, see README), PAD-US feature identify on tap (manager, designation, access).
- **Waypoint photos** stored as blobs in IndexedDB (excluded from QR transfer).
- **Track stats:** elevation profile, time/pace for recorded tracks.
- **Peer-to-peer transfer** without QR size limits (WebRTC on a local hotspot, Nearby/Bluetooth in the native wrapper).
- **Wind-aware tools:** scent cone overlay from the current wind direction at a stand.
