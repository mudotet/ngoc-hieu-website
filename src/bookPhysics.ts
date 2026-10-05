export type SpringState = { value: number; velocity: number };

export function springStep(state: SpringState, target: number, dt: number, stiffness = 95, damping = 17): SpringState {
  if (!Number.isFinite(dt) || dt <= 0) return { ...state };
  const steps = Math.max(1, Math.ceil(Math.min(dt, 0.064) / 0.008));
  const h = Math.min(dt, 0.064) / steps;
  let { value, velocity } = state;
  for (let i = 0; i < steps; i++) {
    velocity += ((target - value) * stiffness - velocity * damping) * h;
    value += velocity * h;
  }
  return { value, velocity };
}

export function normalizePage(page: number, count: number, mobile: boolean) {
  const valid = Number.isFinite(page) ? Math.trunc(page) : 0;
  const length = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const clamped = Math.max(0, Math.min(Math.max(0, length - 1), valid));
  return mobile ? clamped : Math.floor(clamped / 2) * 2;
}

export function pagePoint(u: number, v: number, root: number, edge: number, width = 2.65, height = 3.65) {
  const segments = 20;
  const step = u * width / segments;
  const bend = Math.sin(Math.PI * Math.max(0, Math.min(1, root)));
  let x = 0;
  let y = 0;
  for (let i = 0; i < segments; i++) {
    const s = u * (i + 0.5) / segments;
    const angle = Math.PI * (root + (edge - root) * s * s) + bend * Math.sin(s * Math.PI) * 0.25;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
  }
  y += Math.sin(u * Math.PI) * 0.025 + bend * u * u * (v - 0.5) * 0.13;
  return { x, y, z: (v - 0.5) * height };
}
