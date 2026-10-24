import { mkdir, copyFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
await mkdir("public/lidar", { recursive: true });
await copyFile(
  "node_modules/laz-perf/lib/web/laz-perf.wasm",
  "public/lidar/laz-perf.wasm",
);
const name = "ort-wasm-simd-threaded.asyncify";
await copyFile(
  `node_modules/onnxruntime-web/dist/${name}.mjs`,
  `public/lidar/${name}.mjs`,
);
await writeFile(
  `public/lidar/${name}.bin`,
  gzipSync(await readFile(`node_modules/onnxruntime-web/dist/${name}.wasm`), {
    level: 9,
  }),
);
