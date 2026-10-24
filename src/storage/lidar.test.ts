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
it("syncs saved candidates and deletion without changing existing user items", async () => {
  const repo = await Repo.open("lidar-repo");
  const item = await repo.create<Waypoint>({
    kind: "waypoint",
    name: "Test",
    note: "",
    icon: "pin",
    coord: [-90, 44],
  });
  const pending = await repo.pending();
  const run = await repo.saveLidarRun({
    box: [-91, 44, -90, 45],
    candidates: { type: "FeatureCollection", features: [] },
  });
  expect(await repo.listLidarRuns()).toHaveLength(1);
  await repo.clearLidarRuns();
  expect(await repo.listLidarRuns()).toHaveLength(0);
  expect(await repo.get(item.id)).toEqual(item);
  const changes = await repo.pending();
  expect(changes.find(entry => entry.id === item.id)).toEqual(pending[0]);
  expect(changes.find(entry => entry.id === run.id)?.item).toMatchObject({ kind: 'lidar-run', deleted: true });
});

it('clears legacy candidates before first account binding with a synced tombstone', async () => {
  const db = await openHuntDB('lidar-legacy');
  await db.put('lidarRuns', { id: 'legacy-run-id', createdAt: 10, box: [-91, 44, -90, 45], candidates: { type: 'FeatureCollection', features: [] } });
  db.close();
  const repo = await Repo.open('lidar-legacy');
  await repo.clearLidarRuns();
  expect(await repo.listLidarRuns()).toHaveLength(0);
  expect((await repo.pending())[0]?.item).toMatchObject({ id: 'legacy-run-id', deleted: true });
});
