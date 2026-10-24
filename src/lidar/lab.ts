import { estimateDownload } from "./download";
import { Marker } from "maplibre-gl";
import { BoxDrawing, estimateBox, boxLabel, type Point } from "./boxDrawing";
import type { AppContext } from "../ui/context";
import { h } from "../ui/dom";
import { checkedBox, type Box } from "./ept";
import type { Candidates } from "./postprocess";
import type { GeoJSONSource } from "maplibre-gl";
export interface TrailFinder {
  open(): void;
}
export async function createTrailFinder(app: AppContext): Promise<TrailFinder> {
  const map = app.map.map;
  const empty: Candidates = { type: "FeatureCollection", features: [] };
  let displayed = empty,
    box: Box | undefined;
  const gesture = new BoxDrawing();
  const badge = h("output", { class: "trail-box-size" });
  const marker = new Marker({ element: badge, anchor: "bottom" });
  const handlers = [map.dragPan, map.boxZoom, map.doubleClickZoom, map.touchZoomRotate];
  let restore: boolean[] = [];
  const allowed = () => !!box && !estimateBox(box).over;
  let drawing = false,
    worker: Worker | undefined;
  const draw = h("button", { type: "button", class: "btn" }, "Draw box");
  const run = h(
    "button",
    { type: "button", class: "btn primary", disabled: true },
    "Find trails",
  );
  const cancel = h(
    "button",
    { type: "button", class: "btn", hidden: true },
    "Cancel",
  );
  const clear = h("button", { type: "button", class: "btn" }, "Clear");
  const status = h("output", { "aria-live": "polite" }, "Unverified");
  const panel = h(
    "div",
    { class: "form trail-finder" },
    h("div", { class: "button-row" }, draw, run, cancel, clear),
    status,
  );
  function install(): void {
    if (!map.getSource("lidar-candidates"))
      map.addSource("lidar-candidates", {
        type: "geojson",
        data: displayed,
        attribution: "USGS 3DEP",
      });
    if (!map.getLayer("lidar-candidates"))
      map.addLayer({
        id: "lidar-candidates",
        type: "line",
        source: "lidar-candidates",
        paint: {
          "line-color": "#ffc45c",
          "line-width": 3,
          "line-dasharray": [2, 1],
        },
      });
    if (!map.getLayer("lidar-rank"))
      map.addLayer({
        id: "lidar-rank",
        type: "symbol",
        source: "lidar-candidates",
        minzoom: 13,
        layout: {
          "symbol-placement": "line",
          "text-field": [
            "concat",
            ["to-string", ["get", "rank"]],
            " · Unverified",
          ],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#ffc45c",
          "text-halo-color": "#141a16",
          "text-halo-width": 2,
        },
      });
    if (!map.getSource("lidar-box"))
      map.addSource("lidar-box", { type: "geojson", data: empty });
    if (!map.getLayer("lidar-box"))
      map.addLayer({
        id: "lidar-box",
        type: "line",
        source: "lidar-box",
        paint: { "line-color": "#ffc45c", "line-width": 2 },
      });
    showBox();
  }
  function show(): void {
    (map.getSource("lidar-candidates") as GeoJSONSource | undefined)?.setData(
      displayed,
    );
  }
  const estimates = new Map<string, number>();
  let estimateTimer: ReturnType<typeof setTimeout> | undefined;
  let estimateAbort: AbortController | undefined;
  let estimateKey = "", download: number | null | undefined;
  function updateEstimate(): void {
    const key = box?.join(",") ?? "";
    if (key === estimateKey) return;
    clearTimeout(estimateTimer);
    estimateAbort?.abort();
    estimateKey = key;
    download = estimates.get(key);
    if (!box || estimateBox(box).over || download !== undefined) return;
    const selected = box;
    const controller = estimateAbort = new AbortController();
    estimateTimer = setTimeout(() => {
      void estimateDownload(selected, controller.signal).then(bytes => {
        if (estimates.size >= 32) estimates.delete(estimates.keys().next().value!);
        estimates.set(key, bytes);
        if (estimateKey === key) { download = bytes; badge.textContent = boxLabel(selected, bytes); }
      }).catch(() => {
        if (!controller.signal.aborted && estimateKey === key) { download = null; badge.textContent = boxLabel(selected, null); }
      });
    }, 400);
  }
  function showBox(): void {
    updateEstimate();
    if (!box) {
      (map.getSource("lidar-box") as GeoJSONSource | undefined)?.setData(empty);
      marker.remove();
      return;
    }
    const estimate = estimateBox(box);
    badge.textContent = boxLabel(box, download);
    badge.classList.toggle("over", estimate.over);
    marker.setLngLat([(box[0] + box[2]) / 2, box[3]]).addTo(map);
    if (map.getLayer("lidar-box")) map.setPaintProperty("lidar-box", "line-color", estimate.over ? "#ff6262" : "#ffc45c");
    const [x0, y0, x1, y1] = box;
    (map.getSource("lidar-box") as GeoJSONSource | undefined)?.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
            [x0, y0],
          ],
        ],
      },
    });
  }
  function stopDrawing(): void {
    drawing = false;
    gesture.cancel();
    restore.forEach((enabled, i) => { if (enabled) handlers[i]!.enable(); });
    restore = [];
    draw.classList.remove("selected");
    draw.textContent = "Draw box";
    draw.setAttribute("aria-pressed", "false");
    delete map.getCanvas().dataset.lidarDrawing;
    map.getCanvas().style.cursor = "";
  }
  function stop(): void {
    worker?.terminate();
    worker = undefined;
    cancel.hidden = true;
    run.disabled = !allowed();
    draw.disabled = false;
    clear.disabled = false;
  }
  map.on("style.load", install);
  if (map.isStyleLoaded()) install();
  const refreshSaved = async () => {
    const saved = await app.repo.listLidarRuns();
    displayed = { type: "FeatureCollection", features: saved.flatMap(r => r.candidates.features) };
    show();
  };
  app.repo.addEventListener('change', () => { void refreshSaved(); });
  await refreshSaved();
  function cancelDrawing(): void {
    if (!drawing) return;
    stopDrawing();
    box = undefined;
    run.disabled = true;
    showBox();
  }
  draw.onclick = () => {
    if (drawing) { cancelDrawing(); return; }
    drawing = true;
    gesture.cancel();
    box = undefined;
    run.disabled = true;
    showBox();
    restore = handlers.map(handler => handler.isEnabled());
    handlers.forEach(handler => handler.disable());
    map.getCanvas().dataset.lidarDrawing = "";
    map.getCanvas().style.cursor = "crosshair";
    draw.classList.add("selected");
    draw.textContent = "Cancel box";
    draw.setAttribute("aria-pressed", "true");
  };
  const canvas = map.getCanvas();
  let suppressClick = false;
  function position(e: PointerEvent): { pixel: Point; coord: Point } {
    const rect = canvas.getBoundingClientRect();
    const pixel: Point = [e.clientX - rect.left, e.clientY - rect.top];
    const p = map.unproject(pixel);
    return { pixel, coord: [p.lng, p.lat] };
  }
  canvas.addEventListener("pointerdown", e => {
    if (!drawing || !e.isPrimary || e.button !== 0) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const p = position(e);
    suppressClick = true;
    gesture.start(p.pixel, p.coord);
    canvas.setPointerCapture(e.pointerId);
  }, true);
  canvas.addEventListener("pointermove", e => {
    if (!drawing || !e.isPrimary) return;
    const p = position(e), preview = gesture.move(p.pixel, p.coord);
    if (preview) { box = preview; showBox(); }
  }, true);
  canvas.addEventListener("pointerup", e => {
    if (!drawing || !e.isPrimary) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const p = position(e);
    gesture.move(p.pixel, p.coord);
    const result = gesture.end(p.coord);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (!result) return;
    box = result;
    stopDrawing();
    try { checkedBox(box); run.disabled = !allowed(); status.textContent = "Unverified"; }
    catch (err) { run.disabled = true; status.textContent = (err as Error).message; }
    showBox();
  }, true);
  canvas.addEventListener("pointercancel", cancelDrawing);
  canvas.addEventListener("click", e => { if (drawing || suppressClick) { suppressClick = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape") cancelDrawing(); });
  cancel.onclick = () => {
    stop();
    status.textContent = "Cancelled";
  };
  run.onclick = () => {
    if (!box || !allowed() || worker) return;
    stopDrawing();
    run.disabled = true;
    draw.disabled = true;
    clear.disabled = true;
    cancel.hidden = false;
    status.textContent = "Loading · 0 MB";
    worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onerror = (e) => {
      status.textContent = e.message;
      stop();
    };
    worker.onmessage = async (e: MessageEvent) => {
      if (e.data.type === "progress") {
        const mb = (e.data.bytes / 1e6).toFixed(1);
        status.textContent = download ? `${e.data.stage} · ${mb} / ${Math.round(download / 1e6)} MB · ${Math.min(99, Math.round(e.data.bytes / download * 100))}%` : `${e.data.stage} · ${mb} MB`;
      }
      if (e.data.type === "error") {
        status.textContent = e.data.message;
        stop();
      }
      if (e.data.type === "result") {
        try {
          await app.repo.saveLidarRun({
            box: e.data.box,
            candidates: e.data.candidates,
          });
          const runs = await app.repo.listLidarRuns();
          displayed = {
            type: "FeatureCollection",
            features: runs.flatMap((r) => r.candidates.features),
          };
          show();
          status.textContent = `${displayed.features.length} · Unverified`;
        } catch (err) {
          status.textContent = `Save failed: ${(err as Error).message}`;
        } finally {
          stop();
        }
      }
    };
    worker.postMessage({ box, provider: "webgpu" });
  };
  clear.onclick = async () => {
    try {
      await app.repo.clearLidarRuns();
      displayed = empty;
      show();
      status.textContent = "Unverified";
    } catch (err) {
      status.textContent = (err as Error).message;
    }
  };
  return {
    open() {
      app.sheet.open("trails", "Trail finder", panel, () => {
        cancelDrawing();
        stop();
      });
    },
  };
}
