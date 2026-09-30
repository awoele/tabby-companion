export const clamp = (value, low = -1, high = 1) => Math.max(low, Math.min(high, value));
export function deadZone(value, threshold = 0.10) {
  return Math.abs(value) <= threshold ? 0 : Math.sign(value) * (Math.abs(value) - threshold) / (1 - threshold);
}
export function frameFor(value, center, count) {
  const v = clamp(value);
  return Math.round(v < 0 ? center * (1 + v) : center + v * (count - 1 - center));
}
export function chooseAxis(x, y, previous = 'yaw') {
  // Hysteresis prevents diagonal sensor noise from flipping source clips every frame.
  if (previous === 'pitch') return Math.abs(x) > Math.abs(y) + .22 ? 'yaw' : 'pitch';
  return Math.abs(y) > Math.abs(x) + .22 ? 'pitch' : 'yaw';
}
export function relativeTilt(sample, baseline, screenAngle = 0) {
  let dx = sample.gamma - baseline.gamma;
  let dy = ((sample.beta - baseline.beta + 540) % 360) - 180;
  const radians = screenAngle * Math.PI / 180;
  return {
    x: clamp((dx * Math.cos(radians) + dy * Math.sin(radians)) / 22),
    y: clamp((dy * Math.cos(radians) - dx * Math.sin(radians)) / 18),
  };
}
