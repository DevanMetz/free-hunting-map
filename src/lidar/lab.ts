import type { AppContext } from "../ui/context";
import { h } from "../ui/dom";
import { checkedBox, type Box } from "./ept";
import type { Candidates } from "./postprocess";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
export interface TrailFinder {
  open(): void;
}
export async function createTrailFinder(app: AppContext): Promise<TrailFinder> {
  const map = app.map.map;
  const empty: Candidates = { type: "FeatureCollection", features: [] };
  let displayed = empty,
    box: Box | undefined,
    first: [number, number] | undefined;
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
  function showBox(): void {
    if (!box) return;
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
    first = undefined;
    delete map.getCanvas().dataset.lidarDrawing;
    map.getCanvas().style.cursor = "";
  }
  function stop(): void {
    worker?.terminate();
    worker = undefined;
    cancel.hidden = true;
    run.disabled = !box;
    draw.disabled = false;
    clear.disabled = false;
  }
  map.on("style.load", install);
  if (map.isStyleLoaded()) install();
  const saved = await app.repo.listLidarRuns();
  displayed = {
    type: "FeatureCollection",
    features: saved.flatMap((r) => r.candidates.features),
  };
  show();
  draw.onclick = () => {
    drawing = true;
    first = undefined;
    map.getCanvas().dataset.lidarDrawing = "";
    map.getCanvas().style.cursor = "crosshair";
    draw.classList.add("selected");
  };
  map.on("click", (e: MapMouseEvent) => {
    if (!drawing) return;
    if (!first) {
      first = [e.lngLat.lng, e.lngLat.lat];
      return;
    }
    const next: Box = [
      Math.min(first[0], e.lngLat.lng),
      Math.min(first[1], e.lngLat.lat),
      Math.max(first[0], e.lngLat.lng),
      Math.max(first[1], e.lngLat.lat),
    ];
    try {
      checkedBox(next);
      box = next;
      run.disabled = false;
      status.textContent = "Unverified";
      showBox();
    } catch (err) {
      status.textContent = (err as Error).message;
    }
    stopDrawing();
    draw.classList.remove("selected");
  });
  cancel.onclick = () => {
    stop();
    status.textContent = "Cancelled";
  };
  run.onclick = () => {
    if (!box || worker) return;
    stopDrawing();
    run.disabled = true;
    draw.disabled = true;
    clear.disabled = true;
    cancel.hidden = false;
    worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onerror = (e) => {
      status.textContent = e.message;
      stop();
    };
    worker.onmessage = async (e: MessageEvent) => {
      if (e.data.type === "progress") status.textContent = e.data.stage;
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
        stopDrawing();
        stop();
      });
    },
  };
}
