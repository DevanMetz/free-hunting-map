import * as ort from "onnxruntime-web/webgpu";
export type Provider = "wasm" | "webgpu";
export async function cached(url: string): Promise<ArrayBuffer> {
  const cache = await caches.open("lidar-v4-assets-v1"),
    hit = await cache.match(url);
  if (hit) return hit.arrayBuffer();
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Asset HTTP ${r.status}: ${url}`);
  await cache.put(url, r.clone());
  return r.arrayBuffer();
}
export async function session(
  provider: Provider,
): Promise<ort.InferenceSession> {
  ort.env.logLevel = "error";
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1;
  const runtime = await cached("/lidar/ort-wasm-simd-threaded.asyncify.mjs");
  const compressed = await cached("/lidar/ort-wasm-simd-threaded.asyncify.bin");
  const wasm = await new Response(
    new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream("gzip")),
  ).arrayBuffer();
  ort.env.wasm.wasmPaths = {
    mjs: URL.createObjectURL(new Blob([runtime], { type: "text/javascript" })),
    wasm: URL.createObjectURL(new Blob([wasm], { type: "application/wasm" })),
  };
  const model = await cached("/lidar/model.onnx");
  return ort.InferenceSession.create(model, {
    executionProviders: [provider],
    graphOptimizationLevel: "all",
  });
}
export function starts(n: number): number[] {
  const last = Math.max(n - 512, 0),
    v: number[] = [];
  for (let i = 0; i <= last; i += 384) v.push(i);
  if (v[v.length - 1] !== last) v.push(last);
  return v;
}
function mirror(i: number, n: number): number {
  if (n === 1) return 0;
  const j = i % (2 * n - 2);
  return j < n ? j : 2 * n - 2 - j;
}
export async function predict(
  s: ort.InferenceSession,
  channels: Float32Array[],
  w: number,
  h: number,
  progress: (s: string) => void,
): Promise<Float32Array> {
  const out = new Float32Array(w * h),
    count = new Float32Array(w * h),
    ys = starts(h),
    xs = starts(w);
  let tile = 0;
  for (const y of ys)
    for (const x of xs) {
      progress(`Inference ${++tile}/${ys.length * xs.length}`);
      const th = Math.min(512, h - y),
        tw = Math.min(512, w - x),
        ph = Math.ceil(th / 32) * 32,
        pw = Math.ceil(tw / 32) * 32,
        input = new Float32Array(channels.length * ph * pw);
      for (let c = 0; c < channels.length; c++)
        for (let r = 0; r < ph; r++)
          for (let col = 0; col < pw; col++)
            input[c * ph * pw + r * pw + col] =
              channels[c]![(y + mirror(r, th)) * w + x + mirror(col, tw)]!;
      const tensor = new ort.Tensor("float32", input, [
          1,
          channels.length,
          ph,
          pw,
        ]),
        result = await s.run({ features: tensor }),
        logits = result.logits!;
      const data = logits.data as Float32Array;
      for (let r = 0; r < th; r++)
        for (let col = 0; col < tw; col++) {
          const weight =
              Math.min((r + 1) / 64, (512 - r) / 64, 1) *
              Math.min((col + 1) / 64, (512 - col) / 64, 1),
            i = (y + r) * w + x + col;
          out[i] =
            out[i]! + (1 / (1 + Math.exp(-data[r * pw + col]!))) * weight;
          count[i] = count[i]! + weight;
        }
      tensor.dispose();
      Object.values(result).forEach((t) => t.dispose());
    }
  return Float32Array.from(out, (v, i) => v / Math.max(count[i]!, 1e-6));
}
