export const pedestrianLimits = { desktop: 18, economy: 10 } as const;
export const pedestrianBodyRadius = 0.5;
export const pedestrianWalkways = [
  { minX: -54, maxX: -3.5, minZ: 2.95, maxZ: 3.24, ground: 0.06 },
  { minX: 4.12, maxX: 4.2, minZ: -54, maxZ: 1.4, ground: 0.06 },
  { minX: -39, maxX: 14.35, minZ: 13.95, maxZ: 14.35, ground: 0.12 },
  { minX: 13.95, maxX: 14.35, minZ: -40, maxZ: 14.35, ground: 0.12 },
] as const;

type PedestrianNode = { x: number; z: number; ground: number; neighbors: number[] };
export const pedestrianGraph: PedestrianNode[] = [];
const connect = (a: number, b: number) => {
  pedestrianGraph[a].neighbors.push(b);
  pedestrianGraph[b].neighbors.push(a);
};
for (let index = 0; index < pedestrianWalkways.length; index++) {
  const area = pedestrianWalkways[index];
  const horizontal = index % 2 === 0;
  const start = pedestrianGraph.length;
  const minimum = horizontal ? area.minX : area.minZ;
  const maximum = horizontal ? area.maxX : area.maxZ;
  for (let station = 0; station < 10; station++) {
    for (let lane = 0; lane < 2; lane++) {
      const along = minimum + (maximum - minimum) * station / 9;
      const across = horizontal ? area.minZ + (area.maxZ - area.minZ) * lane : area.minX + (area.maxX - area.minX) * lane;
      pedestrianGraph.push({ x: horizontal ? along : across, z: horizontal ? across : along, ground: area.ground, neighbors: [] });
      const id = pedestrianGraph.length - 1;
      if (lane) connect(id, id - 1);
      if (station) {
        connect(id, id - 2);
        connect(id, start + (station - 1) * 2 + 1 - lane);
      }
    }
  }
}
connect(58, 78);
connect(59, 79);

export type PedestrianAppearance = {
  kind: 'adult' | 'child' | 'jogger' | 'older';
  scale: number; width: number; skin: number; hair: number; hairStyle: number;
  outfit: number; trousers: number; accessory: number; headScale: number;
};
export type PedestrianAgent = {
  appearance: PedestrianAppearance; companion: number; x: number; z: number; ground: number;
  heading: number; speed: number; moving: number; wait: number; journeys: number;
  node: number; target: number; previous: number; random: number; look: number; phase: number;
};
const randomAgent = (agent: PedestrianAgent) => {
  agent.random = (Math.imul(agent.random, 1664525) + 1013904223) >>> 0;
  return agent.random / 4294967296;
};
export function isPedestrianPositionSafe(x: number, z: number) {
  return pedestrianWalkways.some(area => x >= area.minX - 1e-8 && x <= area.maxX + 1e-8 && z >= area.minZ - 1e-8 && z <= area.maxZ + 1e-8);
}
export function createPedestrianAgents(count: number, seed = 0): PedestrianAgent[] {
  if (!Number.isInteger(count) || count < 0 || count > pedestrianLimits.desktop || !Number.isFinite(seed)) throw new RangeError('Invalid pedestrian count or seed');
  const random = pedestrianRandom(seed);
  return Array.from({ length: count }, (_, index) => {
    const kind = index === 5 || index === 9 || index === 15 ? 'child' : index % 6 === 1 ? 'jogger' : index % 6 === 3 ? 'older' : 'adult';
    const appearance: PedestrianAppearance = {
      kind, scale: kind === 'child' ? 0.6 + random() * 0.12 : 0.91 + random() * 0.17,
      width: kind === 'jogger' ? 0.82 : 0.87 + random() * 0.16,
      skin: Math.floor(random() * 3), hair: kind === 'older' ? 2 : Math.floor(random() * 3),
      hairStyle: index % 4, outfit: (index + Math.floor(random() * 6)) % 6,
      trousers: index % 4, accessory: index % 5, headScale: 0.89 + random() * 0.19,
    };
    const route = index === 2 ? 0 : index % 4;
    const node = route * 20 + Math.floor(random() * 20);
    const point = pedestrianGraph[node];
    return { appearance, companion: kind === 'child' ? index - 1 : -1, ...point,
      heading: random() * Math.PI * 2, speed: kind === 'jogger' ? 1.2 + random() * 0.18 : kind === 'older' ? 0.38 + random() * 0.12 : 0.52 + random() * 0.24,
      moving: 0, wait: random() * 2, journeys: 0, node, target: node, previous: -1,
      random: Math.floor(random() * 4294967296), look: 0, phase: random() * Math.PI * 2,
    };
  }).map((agent, index, agents) => {
    if (agent.companion >= 0) {
      const adult = agents[agent.companion];
      const neighbor = pedestrianGraph[pedestrianGraph[adult.node].neighbors.find(id => Math.hypot(pedestrianGraph[id].x - adult.x, pedestrianGraph[id].z - adult.z) > 1) ?? adult.node];
      const distance = Math.hypot(neighbor.x - adult.x, neighbor.z - adult.z) || 1;
      agent.x = adult.x + (neighbor.x - adult.x) * 0.55 / distance;
      agent.z = adult.z + (neighbor.z - adult.z) * 0.55 / distance;
      agent.ground = adult.ground;
      agent.node = adult.node;
      agent.target = adult.target;
      agent.speed = adult.speed;
    }
    agent.phase += index;
    return agent;
  });
}
function steerPedestrian(agent: PedestrianAgent, x: number, z: number, dt: number, speed: number) {
  const dx = x - agent.x;
  const dz = z - agent.z;
  const distance = Math.hypot(dx, dz);
  const desired = distance > 0.001 ? Math.atan2(dx, dz) : agent.heading + agent.look * dt;
  const angle = Math.atan2(Math.sin(desired - agent.heading), Math.cos(desired - agent.heading));
  agent.heading += Math.max(-dt * 2.2, Math.min(dt * 2.2, angle));
  const travel = Math.min(distance, dt * speed * Math.max(0.08, Math.cos(angle)));
  const nextX = agent.x + dx * travel / (distance || 1);
  const nextZ = agent.z + dz * travel / (distance || 1);
  if (isPedestrianPositionSafe(nextX, nextZ)) {
    agent.x = nextX;
    agent.z = nextZ;
  } else if (isPedestrianPositionSafe(nextX, agent.z)) agent.x = nextX;
  else if (isPedestrianPositionSafe(agent.x, nextZ)) agent.z = nextZ;
  agent.moving += ((travel > 0.00001 ? 1 : 0) - agent.moving) * Math.min(1, dt * 8);
  agent.phase += travel * (agent.appearance.kind === 'jogger' ? 6 : 7) / agent.appearance.scale;
}
export function stepPedestrians(agents: PedestrianAgent[], dt: number) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid pedestrian timestep');
  let remaining = Math.min(dt, 0.25);
  while (remaining > 0.000001) {
    const delta = Math.min(remaining, 1 / 60);
    remaining -= delta;
    for (const agent of agents) {
      if (agent.companion >= 0) {
        const adult = agents[agent.companion];
        const distance = Math.hypot(adult.x - agent.x, adult.z - agent.z);
        steerPedestrian(agent, adult.x, adult.z, delta, distance > 0.5 ? adult.speed * Math.min(2.5, distance / 0.35) : 0);
        agent.node = adult.node;
        agent.target = adult.target;
        continue;
      }
      if (agent.wait > 0) {
        agent.wait = Math.max(0, agent.wait - delta);
        steerPedestrian(agent, agent.x, agent.z, delta, 0);
        continue;
      }
      const destination = pedestrianGraph[agent.target];
      if (Math.hypot(destination.x - agent.x, destination.z - agent.z) < 0.015) {
        agent.previous = agent.node;
        agent.node = agent.target;
        const neighbors = pedestrianGraph[agent.node].neighbors;
        let target = neighbors[Math.floor(randomAgent(agent) * neighbors.length)];
        if (target === agent.previous && neighbors.length > 1 && randomAgent(agent) < 0.8) target = neighbors[(neighbors.indexOf(target) + 1) % neighbors.length];
        agent.target = target;
        agent.journeys++;
        agent.wait = randomAgent(agent) < 0.42 ? randomAgent(agent) * (agent.appearance.kind === 'older' ? 3.4 : 2.5) : 0;
        agent.look = (randomAgent(agent) - 0.5) * 0.9;
      } else steerPedestrian(agent, destination.x, destination.z, delta, agent.speed);
    }
  }
  return agents;
}
export function samplePedestrianAgent<T extends { x: number; z: number; heading: number; ground: number }>(agent: PedestrianAgent, target: T): T {
  target.x = agent.x;
  target.z = agent.z;
  target.heading = agent.heading;
  target.ground = agent.ground;
  return target;
}

export const pedestrianRoutes = [
  { axis: 'x', min: -54, max: -3.5, fixed: 3.05, radius: 0.18, ground: 0.06 },
  { axis: 'z', min: -54, max: 1.5, fixed: 4.15, radius: 0.1, ground: 0.06 },
  { axis: 'x', min: -39, max: 18, fixed: 14.1, radius: 0.2, ground: 0.12 },
  { axis: 'z', min: -40, max: 16, fixed: 14.1, radius: 0.2, ground: 0.12 },
] as const;

export function pedestrianRandom(seed = 0) {
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
