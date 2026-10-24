import "fake-indexeddb/auto";
import { openDB } from "idb";
import { it, expect } from "vitest";
import { openHuntDB } from "./db";
import type { Waypoint } from "../types";
import { Repo } from "./repo";
it("upgrades a real v1 database without losing stores or records", async () => {
  const name = "lidar-migration";
  const old = await openDB(name, 1, {
    upgrade(db) {
      db.createObjectStore("items", { keyPath: "id" }).createIndex(
        "kind",
        "kind",
      );
      db.createObjectStore("outbox", { keyPath: "id" });
      db.createObjectStore("imports", { keyPath: "seq", autoIncrement: true });
      db.createObjectStore("meta");
    },
  });
  await old.put("meta", { preserved: true }, "settings");
  await old.put("items", { id: "existing", kind: "waypoint" });
  old.close();
  const db = await openHuntDB(name);
  expect(await db.get("meta", "settings")).toEqual({ preserved: true });
  expect((await db.get("items", "existing"))?.id).toBe("existing");
  expect(db.objectStoreNames.contains("lidarRuns")).toBe(true);
  db.close();
});
it("persists and clears derived candidates without touching user items or sync", async () => {
  const repo = await Repo.open("lidar-repo");
  const item = await repo.create<Waypoint>({
    kind: "waypoint",
    name: "Test",
    note: "",
    icon: "pin",
    coord: [-90, 44],
  });
  const pending = await repo.pending();
  await repo.saveLidarRun({
    box: [-91, 44, -90, 45],
    candidates: { type: "FeatureCollection", features: [] },
  });
  expect(await repo.listLidarRuns()).toHaveLength(1);
  await repo.clearLidarRuns();
  expect(await repo.listLidarRuns()).toHaveLength(0);
  expect(await repo.get(item.id)).toEqual(item);
  expect(await repo.pending()).toEqual(pending);
});
