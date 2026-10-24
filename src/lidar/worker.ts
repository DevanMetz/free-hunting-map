import { checkedBox, emptyStats, groundTile, type Box } from "./ept";
import { demFeatures, normalize, type Normalization } from "./features";
import { extract, type Calibration } from "./postprocess";
import { cached, predict, session, type Provider } from "./inference";
const scope = globalThis as unknown as {
  postMessage: (v: unknown, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};
scope.onmessage = async (
  e: MessageEvent<{ box: Box; provider: Provider; benchmark?: boolean }>,
) => {
  const started = performance.now(),
    stats = emptyStats(),
    progress = (stage: string) =>
      scope.postMessage({ type: "progress", stage });
  let runtime: Awaited<ReturnType<typeof session>> | undefined;
  try {
    const bb = checkedBox(e.data.box),
      pad: Box = [bb[0] - 64, bb[1] - 64, bb[2] + 64, bb[3] + 64],
      w = pad[2] - pad[0],
      h = pad[3] - pad[1];
    const st = JSON.parse(
      new TextDecoder().decode(await cached("/lidar/manifest.json")),
    ) as Normalization;
    const calibration = JSON.parse(
      new TextDecoder().decode(await cached("/lidar/calibration.json")),
    ) as Calibration;
    const channels = st.channels.map(() => new Float32Array(w * h));
    for (
      let tx = Math.floor(pad[0] / 1000);
      tx <= Math.floor((pad[2] - 1) / 1000);
      tx++
    )
      for (
        let ty = Math.floor(pad[1] / 1000);
        ty <= Math.floor((pad[3] - 1) / 1000);
        ty++
      ) {
        progress(`Lidar ${tx}_${ty}`);
        const dtm = await groundTile(tx, ty, stats, progress),
          t = performance.now();
        const features = normalize(demFeatures(dtm, 1128, 1128), st);
        stats.featureMs += performance.now() - t;
        for (let c = 0; c < channels.length; c++)
          for (
            let yy = Math.max(pad[1], ty * 1000);
            yy < Math.min(pad[3], ty * 1000 + 1000);
            yy++
          )
            for (
              let xx = Math.max(pad[0], tx * 1000);
              xx < Math.min(pad[2], tx * 1000 + 1000);
              xx++
            )
              channels[c]![(pad[3] - yy - 1) * w + xx - pad[0]] =
                features[c]![
                  (ty * 1000 + 1064 - yy - 1) * 1128 + xx - tx * 1000 + 64
                ]!;
      }
    let provider = e.data.provider;
    progress(`Loading ${provider}`);
    try {
      runtime = await session(provider);
    } catch (err) {
      if (provider === "wasm" || e.data.benchmark) throw err;
      provider = "wasm";
      progress("Loading WASM");
      runtime = await session(provider);
    }
    const t = performance.now(),
      full = await predict(runtime, channels, w, h, progress);
    stats.inferenceMs = performance.now() - t;
    const cw = bb[2] - bb[0],
      ch = bb[3] - bb[1],
      p = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++)
      p.set(full.subarray((y + 64) * w + 64, (y + 64) * w + 64 + cw), y * cw);
    const post = performance.now(),
      candidates = extract(p, cw, ch, bb, calibration);
    stats.postMs = performance.now() - post;
    scope.postMessage(
      {
        type: "result",
        candidates,
        stats: {
          ...stats,
          totalMs: performance.now() - started,
          provider,
          crossOriginIsolated: globalThis.crossOriginIsolated,
        },
        box: e.data.box,
        utm: bb,
        ...(e.data.benchmark ? { probabilities: p.buffer } : {}),
      },
      e.data.benchmark ? [p.buffer] : [],
    );
  } catch (err) {
    scope.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      stats: { ...stats, totalMs: performance.now() - started },
    });
  } finally {
    await runtime?.release();
  }
};
