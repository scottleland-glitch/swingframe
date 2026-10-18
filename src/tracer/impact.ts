/**
 * First loud onset in a mono waveform. Returns seconds, or null when the clip is quiet.
 * The hit is the strongest jump in loudness, not a steady whoosh.
 */
export function detectImpact(samples: Float32Array, sampleRate: number): number | null {
  if (sampleRate < 1000 || samples.length < sampleRate * 0.05) return null;
  const win = Math.max(1, Math.round(sampleRate * 0.008));
  const hop = Math.max(1, Math.round(sampleRate * 0.004));
  const onset: number[] = [];
  const times: number[] = [];
  let previous = 0;
  for (let i = 0; i + win < samples.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < win; j++) {
      const value = samples[i + j];
      sum += value * value;
    }
    const rms = Math.sqrt(sum / win);
    onset.push(Math.max(0, rms - previous));
    previous = rms;
    times.push((i + win / 2) / sampleRate);
  }
  let max = 0;
  let maxAt = -1;
  for (let i = 0; i < onset.length; i++) {
    if (times[i] < 0.04) continue;
    if (onset[i] > max) {
      max = onset[i];
      maxAt = i;
    }
  }
  if (maxAt < 0) return null;
  const sorted = [...onset].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (max < 0.02 || max < median * 6) return null;
  return times[maxAt];
}
