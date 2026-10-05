export const pedestrianLimits = { desktop: 18, economy: 10 } as const;

export const pedestrianRoutes = [
  { axis: 'x', min: -54, max: -3.5, fixed: 3.05, radius: 0.18, ground: 0.06 },
  { axis: 'z', min: -54, max: 1.5, fixed: 4.15, radius: 0.1, ground: 0.06 },
  { axis: 'x', min: -39, max: 18, fixed: 14.1, radius: 0.2, ground: 0.12 },
  { axis: 'z', min: -40, max: 16, fixed: 14.1, radius: 0.2, ground: 0.12 },
] as const;

export function pedestrianRandom(seed = 73129) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function pedestrianRouteLength(route: typeof pedestrianRoutes[number]) {
  return 2 * (route.max - route.min) + 2 * Math.PI * route.radius;
}

export function samplePedestrianRoute(route: typeof pedestrianRoutes[number], distance: number, target: { x: number; z: number; heading: number }) {
  const straight = route.max - route.min;
  const arc = Math.PI * route.radius;
  const total = pedestrianRouteLength(route);
  const phase = ((distance % total) + total) % total;
  let along: number;
  let across: number;
  let tangent: number;
  if (phase < straight) {
    along = route.min + phase;
    across = -route.radius;
    tangent = 0;
  } else if (phase < straight + arc) {
    const angle = (phase - straight) / route.radius - Math.PI / 2;
    along = route.max + Math.cos(angle) * route.radius;
    across = Math.sin(angle) * route.radius;
    tangent = angle + Math.PI / 2;
  } else if (phase < 2 * straight + arc) {
    along = route.max - (phase - straight - arc);
    across = route.radius;
    tangent = Math.PI;
  } else {
    const angle = (phase - 2 * straight - arc) / route.radius + Math.PI / 2;
    along = route.min + Math.cos(angle) * route.radius;
    across = Math.sin(angle) * route.radius;
    tangent = angle + Math.PI / 2;
  }
  target.x = route.axis === 'x' ? along : route.fixed + across;
  target.z = route.axis === 'x' ? route.fixed + across : along;
  target.heading = route.axis === 'x' ? Math.PI / 2 - tangent : tangent;
  return target;
}
