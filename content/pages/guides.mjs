export const guides = [
  {
    slug: 'reading-topo-hunting-maps', title: 'How to read a topo map for hunting',
    description: 'Read contours, ridges, saddles and drainages, compare aerial imagery, and turn a topo map into a practical scouting plan.',
    image: 'map', alt: 'Wisconsin topographic map in Free Hunting Map with a demo scouting track and waypoints.',
    body: `<p>A topo map helps you understand the shape of the ground before you reach it. Start with the terrain, then add cover, access and observations from the field. A promising contour pattern is a place to investigate, not evidence that an animal uses it.</p>
<h2>Read elevation before choosing a route</h2>
<p>Contour lines connect points of equal elevation. Closely spaced lines indicate a steeper slope; wider spacing indicates gentler ground. Read the elevation labels and the contour interval on the source map rather than assuming every map uses the same spacing. The <a href="https://www.usgs.gov/faqs/what-a-topographic-map">USGS explanation of topographic maps</a> is a useful reference.</p>
<p>Trace a few labeled contours across the screen. Closed loops often outline a hill; depression markings, when present, distinguish a low area. A drainage cuts uphill into a slope, while a ridge projects outward. Where contours cross a stream, their V shapes generally point upstream.</p>
<h2>Look for terrain you can recognize on foot</h2>
<ul><li><strong>Ridges:</strong> follow the high ground and note how steeply each side falls away.</li><li><strong>Saddles:</strong> look for a lower connection between two higher areas. Check the approach on both sides.</li><li><strong>Benches:</strong> look for a patch of wider contour spacing on an otherwise steep slope.</li><li><strong>Drainages:</strong> follow the low ground and identify crossings that might be difficult after rain.</li></ul>
<p>These shapes can help organize a scouting walk. They do not predict a safe crossing, an open trail or animal movement by themselves.</p>
<h2>Compare topo with aerial imagery</h2>
<p>In Free Hunting Map, open Layers and switch between Topo and Satellite over the same area. Look for transitions between timber, openings and wet ground. Add Hillshade to compare the landform with the cover. Imagery may be old or captured in a different season; dark pixels can be shadows rather than water.</p>
<h2>Save a route you can evaluate</h2>
<p>Drop a pin at a verified parking location, then use Measure to estimate the walk. A drawn track records your planned line; it does not calculate a navigable route. Save notes about steep ground, alternate exits and anything you still need to check.</p>
<p>Before entering, <a href="/guides/finding-public-hunting-land">verify public access</a>. Then <a href="/guides/offline-maps">prepare the map for offline use</a> and carry a backup you know how to use.</p>`,
  },
  {
    slug: 'finding-public-hunting-land', title: 'How to find public hunting land and legal access',
    description: 'Use PAD-US, state wildlife maps, USFS and BLM resources to research hunting land, access routes, closures and permits.',
    image: 'layers', alt: 'Public land categories in Free Hunting Map beside a Wisconsin topo map.',
    body: `<p>Start by identifying who manages a parcel. Then confirm whether your intended hunt is allowed and how you can legally reach it. A colored polygon is the beginning of that research.</p>
<h2>Use PAD-US to find leads</h2>
<p>Free Hunting Map uses the USGS Protected Areas Database of the United States (PAD-US) for its public-land overlays. In Layers, enable relevant manager categories, such as USFS, BLM or State wildlife. Select a mapped area to inspect available manager information.</p>
<h2>Research federal trails</h2>
<p>In Layers → Trails, enable Public trails. The regional pilot includes federal USFS, BLM, NPS and USGS inventories across Wisconsin, Minnesota, Michigan, Iowa and Illinois, plus neighboring territory inside its bounds. It includes Forest Service motor routes, with available uses, seasons, agency and source details on tap. State, county and private trail networks are not comprehensively included. Confirm current access and closures with the manager, and view needed tiles before testing offline.</p>
<p>PAD-US describes protected lands and management. It is not a survey, a complete inventory of hunting opportunities or a legal access determination. Publicly owned land may be closed, restricted, or inaccessible without crossing private land. Consult the <a href="https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview">USGS PAD-US overview</a> for the dataset's scope.</p>
<h2>Check the state wildlife agency</h2>
<p>Use our <a href="/public-land/">state public-land directory</a> to reach official maps, regulations and licensing information. State wildlife management areas may have property-specific rules, drawings, reservations, check-in procedures or access dates. Walk-in access programs can cover private land under agreements that differ from ordinary public ownership.</p>
<p>Find the exact property on the agency map and read its current rules. Match the species, season, method and unit to your plan. Save the relevant property map and rules before leaving reception.</p>
<h2>Check federal land with its manager</h2>
<p>For national forests, consult the forest's current alerts, orders and maps. A <a href="https://www.fs.usda.gov/r03/maps-guides">Motor Vehicle Use Map (MVUM)</a> identifies designated motor routes, vehicle classes and seasonal use; a road visible in aerial imagery is not automatically open to driving. Check current closures as well.</p>
<p>For BLM land, use <a href="https://www.blm.gov/maps">BLM maps</a> and the local field office's information to check land status, recreation restrictions and access. Refuge hunts need the individual refuge's hunt information. National Park Service ownership should never be read as a general invitation to hunt.</p>
<h2>Verify the whole way in</h2>
<ol><li>Find a legal public road, trailhead or access easement. Do not infer an easement from a narrow gap between parcels.</li><li>Check parking, gates, seasonal closures and the entire route across intervening land.</li><li>Compare agency information with signs on the ground. Resolve discrepancies with the manager or landowner before entering.</li><li>Mark confirmed parking and boundaries in your notes, and keep a generous margin from uncertain lines.</li></ol>
<p>The app's parcel overlay covers Wisconsin, not nationwide private ownership. It does not grant permission. For a Wisconsin trip, start with the <a href="/public-land/wisconsin">Wisconsin official resources</a>; for another state, use the <a href="/public-land/">directory</a>.</p>`,
  },
  {
    slug: 'offline-maps', title: 'Using offline hunting maps in the woods',
    description: 'Prepare cached maps before losing service, test airplane mode, protect battery life and back up your scouting data.',
    image: 'offline', alt: 'Free Hunting Map displaying cached Wisconsin topo imagery and demo scouting data with the browser offline.',
    body: `<p>Offline preparation has two parts: saving your map data and making sure the background map you need is actually on the device. Free Hunting Map keeps your pins and tracks locally and caches map tiles as you view them. It does not offer a bulk download of a selected region.</p>
<h2>Prepare while connected</h2>
<ol><li>Open the app on the device and browser you will carry. Allow the first load to finish. Installing it as a home-screen app can make it easier to reopen.</li><li>Choose your basemap and enable the layers you need. Pan across the approach, hunting area and alternate exits at several useful zoom levels. Wait for tiles to draw at each level.</li><li>Save parking, waypoints and a planned track. Export important pins and tracks from Share as GPX or GeoJSON.</li><li>Switch to airplane mode, reopen the app and revisit the same area and zoom levels. Blank areas mean those tiles are missing; reconnect and load them before leaving.</li></ol>
<h2>Know what the cache can and cannot do</h2>
<p>A viewed tile is not the same as every detail for an entire region. Switching basemaps or zoom levels can request different tiles. Caches have entry limits and expiration; the browser may remove storage when space is low, and clearing site data removes local maps and saved data.</p>
<p>Viewed Wisconsin deer-unit imagery is cached, but tap identification needs a connection. Viewed public-trail tiles and other cacheable layer imagery can also be reused offline. Fresh weather and new lidar analysis require a connection. Previously cached weather can be stale; saved lidar candidates remain local. Optional sync does not copy map tiles to a second device. Prepare and test each device separately.</p>
<h2>GPS can work without cellular data</h2>
<p>A phone's satellite positioning receiver can work without cell coverage, but the app still needs location permission and a usable satellite fix. Dense cover, steep terrain and device settings can reduce reliability. Map imagery must already be cached. Test location access on your own phone before relying on it.</p>
<h2>Protect the battery and recording</h2>
<p>Lower screen brightness, keep a charged power bank and cable, and protect the phone from cold and water. Searching for cell service can use battery; the <a href="https://www.nps.gov/articles/hiking-safety.htm">National Park Service's hiking guidance</a> includes battery and trip-preparation advice.</p>
<p>Keep Free Hunting Map visible when recording a GPS track. A mobile browser or operating system may suspend location updates when the screen locks or the app moves to the background. Check that points are being recorded, and stop recording when you finish.</p>
<h2>Carry an independent backup</h2>
<p>Bring a paper map and compass and know how to use them. Leave your plan and return time with someone. A cached web map is useful, but it cannot replace a working navigation plan if a device is lost or its battery fails.</p>
<p>See <a href="/guides/gpx-google-maps-import">file backups and imports</a> and the <a href="/faq">installation FAQ</a>.</p>`,
  },
  {
    slug: 'scouting-lidar-terrain', title: 'Scouting with lidar, hillshade and aerial imagery',
    description: 'Compare topo, lidar-derived hillshade and aerial imagery to plan field checks, with honest limits on automated trail candidates.',
    image: 'terrain', alt: 'Trail finder controls over a real Wisconsin hillshade map in Free Hunting Map.',
    body: `<p>Use terrain and imagery together. Terrain helps explain slope and drainage; aerial imagery helps explain visible cover. Neither tells you whether a route is legal, passable today or used by wildlife.</p>
<h2>Start with the broad landform</h2>
<p>Open Topo in Layers and trace ridges, saddles and drainages. Turn on Hillshade to see how relief connects across the area. Free Hunting Map uses USGS 3DEP elevation for this shading. The available detail varies with source coverage.</p>
<p>Hillshade simulates light on terrain. A dark band can be a shaded slope, not a ditch. Try to confirm a suspected feature with contour shapes and the surrounding terrain. The <a href="https://www.usgs.gov/3d-elevation-program">USGS 3D Elevation Program</a> explains the elevation source.</p>
<h2>Compare cover and water layers</h2>
<p>Layers also offers 2025 land cover and tree canopy, 2024 vegetation type and height, forest type, 2025 USDA crops and wetlands. Compare SSURGO soils, ecoregions, contours and elevation tint with the imagery. Use opacity and legends to read one dataset at a time. Dataset dates and geographic coverage vary; a mapped class does not establish today’s conditions.</p>
<h2>Compare cover in aerial imagery</h2>
<p>Switch to Satellite without changing your area of interest. Look for openings, edges, roads and wet areas. Leaf cover, shadows, image date and resolution affect what you can see. An apparent trail could be a drainage, skid route or imagery artifact.</p>
<h2>Use the Trail finder as a field-check list</h2>
<p>The experimental Trail finder uses lidar and elevation processing on your device. Open Trail finder, choose Draw box, select two corners and run Find trails. The selection is limited to two square miles and four kilometers per side.</p>
<p>Coverage is limited to the supported WI_Clark_2018 and WI_12County_9_B22 surveys in Wisconsin. New analysis needs network access and can take time on a phone. Results are ranked and marked Unverified; saved candidates remain available offline. These are derived suggestions, not an official public trail network, wildlife detections or evidence of legal access.</p>
<h2>Make a short scouting plan</h2>
<ol><li>Choose a few features you can compare on topo, hillshade and aerial imagery.</li><li>Verify ownership and access with the <a href="/guides/finding-public-hunting-land">managing agency</a>.</li><li>Drop named pins with the question you want to answer on the ground.</li><li>Walk the area, record observations and revise the plan when imagery and reality differ.</li></ol>
<p>Prepare the relevant views using the <a href="/guides/offline-maps">offline checklist</a>. For basic contour reading, see <a href="/guides/reading-topo-hunting-maps">the topo guide</a>.</p>`,
  },
  {
    slug: 'placing-trail-cameras', title: 'Planning trail camera locations with a hunting map',
    description: 'Plan camera sites, low-impact access and retrieval notes, then verify public-land camera rules with the managing agency.',
    image: 'trailcam', alt: 'Trail cam pin and adjustable view cone with drag handles over a Wisconsin satellite map.',
    body: `<p>A map helps organize where you want to place a camera and how you will retrieve it. Camera use can be restricted by state, property, season or technology. Check the current wildlife rules and the land manager's policy before putting anything out, including on public land.</p>
<h2>Resolve permission first</h2>
<p>Use the <a href="/public-land/">state directory</a> to find official regulations and property contacts. Ask about unattended equipment, attachment methods, identification, placement dates, retrieval deadlines and cellular transmission if relevant. A general hunting permission does not answer every equipment question.</p>
<p>On private land, get the owner's permission for the camera and your access route. Avoid pointing a camera toward homes, campsites or places where people reasonably expect privacy.</p>
<h2>Choose a question for each site</h2>
<p>Start with something you can learn: whether an edge is used, which direction travel follows, or how use changes over time. Compare topo and aerial imagery, then check for actual sign on the ground. Keep setup and retrieval routes away from fragile ground and places where repeated visits would disturb wildlife.</p>
<h2>Check the actual view</h2>
<p>Follow the camera manufacturer's setup guidance. Check aim, moving vegetation, glare and the distance to your target area. Take a test image before leaving. A location that looks useful on a map may have poor visibility at camera height.</p>
<h2>Save notes you can act on later</h2>
<p>In Free Hunting Map, use Drop pin and choose Trail cam. Name the location, then adjust the field-of-view cone: drag the tip to rotate and change range, or the side handles to change the angle. Bearing, angle and range also have numeric controls. Save the camera model, date set, last-checked date and notes about permission or retrieval. The cone is your planning record, not a prediction of detection distance or visibility through vegetation.</p>
<p>Draw or record the access track if it helps you return. Keep the app visible during GPS recording, and do not treat a drawn line as a verified route. Use Share to export your pins and tracks for a separate backup.</p>
<h2>Group cameras and search offline</h2>
<p>Assign camera pins to a category in their editor, or use Organize → Select to move several items together. Give categories colors or icons, show or hide a camera group, and search saved names, notes, category names, camera models or dates offline. Keep access pins and planned walks in separate categories when that makes the map easier to read.</p>
<h2>Review before moving equipment</h2>
<p>Compare images with your field notes and retrieve the camera within any applicable deadline. Update the pin when equipment moves so a stale marker does not send you to the wrong location.</p>
<p>Read the <a href="/guides/scouting-lidar-terrain">terrain scouting guide</a> and <a href="/guides/offline-maps">prepare the map before losing reception</a>.</p>`,
  },
  {
    slug: 'gpx-google-maps-import', title: 'Using GPX and importing Google Maps saved places',
    description: 'Back up pins and tracks as GPX or GeoJSON, import existing routes, and move supported Google Takeout saved places into Free Hunting Map.',
    image: 'share', alt: 'Share panel with GPX and GeoJSON export buttons and import controls in Free Hunting Map.',
    body: `<p>GPX and GeoJSON let you keep map data outside a single browser. Free Hunting Map imports and exports waypoints and tracks in these formats. It also imports supported Google Takeout saved places.</p>
<h2>Export a backup</h2>
<ol><li>Open Share and select the pins and tracks you want to keep.</li><li>Choose GPX or GeoJSON. Save the file somewhere separate from the browser, such as your files app or backup drive.</li><li>Check that the file exists and contains the items you expected. Keep a dated copy before major edits or clearing browser data.</li></ol>
<p>Files exported by Free Hunting Map retain its item metadata for importing back into the app. Other software may discard names, notes, symbols or metadata it does not understand. These file exports cover map items, not downloaded tiles, weather, account details or saved lidar analysis runs.</p>
<h2>Import GPX or GeoJSON</h2>
<p>Open Share, choose Import file and select a GPX, GeoJSON or supported JSON file. The app validates incoming data and merges items with existing records. Foreign GPX waypoints, tracks and routes are supported; inspect the resulting map to check names, positions and track shapes.</p>
<p>Coordinates in GeoJSON are longitude first, latitude second. If data lands far from where you expect, check the original coordinate order and format before editing your map.</p>
<h2>Move saved places from Google Maps</h2>
<ol><li>Open <a href="https://takeout.google.com/">Google Takeout</a> for the Google account holding your saved places. Select Saved; Google documents the process under <a href="https://support.google.com/maps/answer/7280933?hl=en">exporting saved lists</a>. Older saved-place exports can also appear as JSON.</li><li>Create and download the export. Keep the original archive as a backup.</li><li>In Free Hunting Map, open Share → Import file. Select the Takeout ZIP, a supported saved-list CSV, or a Saved Places, Starred places or Labeled places JSON file.</li><li>Review the imported, duplicate and skipped counts. Inspect the pins before using them in the field.</li></ol>
<p>The importer reads coordinates present in supported JSON or embedded in supported Google Maps URLs. Some CSV rows contain only place IDs, short links or addresses with no usable coordinates; those rows are skipped. It does not look up missing coordinates online. This is a saved-place import, not a live Google Maps connection, a map-tile transfer or general KML import.</p>
<h2>Organize imported places</h2>
<p>Supported Google Takeout saved-list names become categories. Open Organize to rename or recolor a category, hide it from the map, or search its saved places offline. Use Select to move multiple items into another category. GPX, GeoJSON and QR transfers retain the app’s portable category names and trail-camera fields; visibility settings stay local.</p>
<h2>Share nearby with QR</h2>
<p>Select map items in Share and choose Show QR. On the receiving device, use Scan QR and allow camera access. Larger selections cycle through several codes; keep scanning until the import completes. QR transfer itself does not require internet after both devices have loaded the app.</p>
<h2>Keep devices and domains straight</h2>
<p>Optional Google sign-in syncs map items, saved lidar candidates and map preferences. It does not transfer cached tiles. A file backup is still useful if you delete something accidentally or lose access to a device.</p>
<p>Browser storage is separate for freehuntingmap.com and the workers.dev alias. Export from the old origin and import on the one you plan to use. See the <a href="/faq">FAQ</a> for offline and storage limits.</p>`,
  },
];
