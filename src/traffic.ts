export type TrafficAxis = 'x' | 'z';
export type TrafficLane = { axis: TrafficAxis; direction: 1 | -1; fixed: number; min: number; max: number; entry: number; exit: number };
export const trafficLanes: readonly TrafficLane[] = [
  { axis: 'x', direction: 1, fixed: 6.1, min: -48, max: 48, entry: 4, exit: 13 },
  { axis: 'x', direction: -1, fixed: 9.5, min: -48, max: 48, entry: 13, exit: 4 },
  { axis: 'z', direction: 1, fixed: 6.8, min: -48, max: 48, entry: 3.4, exit: 12 },
  { axis: 'z', direction: -1, fixed: 10.4, min: -48, max: 48, entry: 12, exit: 3.4 },
];
export const trafficBodies = {
  car: { length: 3.72, width: 1.8, wheelRadius: 0.29, cruiseSpeed: 2.4 },
  motorcycle: { length: 1.7, width: 0.8, wheelRadius: 0.28, cruiseSpeed: 2.8 },
} as const;
export const trafficGap = 0.9;
export const trafficStep = 1 / 120;
export const trafficFrameCap = 0.1;
export type TrafficVehicle = { lane: number; kind: keyof typeof trafficBodies; distance: number; travel: number; speed: number };
export type TrafficState = { time: number; accumulator: number; vehicles: TrafficVehicle[] };

export function createTrafficState(): TrafficState {
  return {
    time: 0,
    accumulator: 0,
    vehicles: [
      { lane: 0, kind: 'car', distance: 18, travel: 0, speed: 0 },
      { lane: 1, kind: 'car', distance: 25, travel: 0, speed: 0 },
      { lane: 2, kind: 'car', distance: 15, travel: 0, speed: 0 },
      { lane: 3, kind: 'car', distance: 30, travel: 0, speed: 0 },
      { lane: 0, kind: 'motorcycle', distance: 5, travel: 0, speed: 0 },
      { lane: 2, kind: 'motorcycle', distance: 5, travel: 0, speed: 0 },
    ],
  };
}

function laneDistance(lane: TrafficLane, coordinate: number) {
  return lane.direction === 1 ? coordinate - lane.min : lane.max - coordinate;
}

export function trafficStopDistance(vehicle: TrafficVehicle) {
  return laneDistance(trafficLanes[vehicle.lane], trafficLanes[vehicle.lane].entry) - trafficBodies[vehicle.kind].length / 2;
}

export function trafficInJunction(vehicle: TrafficVehicle) {
  const lane = trafficLanes[vehicle.lane];
  return vehicle.distance > trafficStopDistance(vehicle) + 1e-8 && vehicle.distance < laneDistance(lane, lane.exit) + trafficBodies[vehicle.kind].length / 2 + trafficGap;
}

export function trafficSignal(state: TrafficState, axis: TrafficAxis): 'red' | 'amber' | 'green' {
  if (state.vehicles.some(vehicle => trafficLanes[vehicle.lane].axis !== axis && trafficInJunction(vehicle))) return 'red';
  const phase = (state.time + (axis === 'z' ? 10 : 0)) % 20;
  return phase < 8 ? 'green' : phase < 10 ? 'amber' : 'red';
}

export function trafficPose(vehicle: TrafficVehicle) {
  const lane = trafficLanes[vehicle.lane];
  const along = lane.direction === 1 ? lane.min + vehicle.distance : lane.max - vehicle.distance;
  return { x: lane.axis === 'x' ? along : lane.fixed, z: lane.axis === 'z' ? along : lane.fixed, heading: lane.axis === 'x' ? lane.direction * Math.PI / 2 : lane.direction === 1 ? 0 : Math.PI };
}

export function stepTraffic(state: TrafficState, delta: number) {
  if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Traffic delta must be finite and nonnegative');
  state.accumulator += Math.min(delta, trafficFrameCap);
  while (state.accumulator + 1e-10 >= trafficStep) {
    const advances = state.vehicles.map(vehicle => {
      const lane = trafficLanes[vehicle.lane];
      const body = trafficBodies[vehicle.kind];
      const length = lane.max - lane.min;
      let available = Infinity;
      for (const leader of state.vehicles) {
        if (leader === vehicle || leader.lane !== vehicle.lane) continue;
        const ahead = (leader.distance - vehicle.distance + length) % length;
        const clearance = (body.length + trafficBodies[leader.kind].length) / 2 + trafficGap;
        available = Math.min(available, Math.max(0, ahead - clearance));
      }
      const stop = trafficStopDistance(vehicle);
      if (vehicle.distance <= stop + 1e-8 && trafficSignal(state, lane.axis) !== 'green') available = Math.min(available, Math.max(0, stop - vehicle.distance));
      const targetSpeed = Math.min(body.cruiseSpeed, Math.sqrt(2 * 2.4 * available));
      const speed = Math.min(vehicle.speed + 1.4 * trafficStep, targetSpeed);
      return Math.min(available, speed * trafficStep);
    });
    state.vehicles.forEach((vehicle, index) => {
      const lane = trafficLanes[vehicle.lane];
      vehicle.distance = (vehicle.distance + advances[index]) % (lane.max - lane.min);
      vehicle.travel += advances[index];
      vehicle.speed = advances[index] / trafficStep;
    });
    state.time += trafficStep;
    state.accumulator = Math.max(0, state.accumulator - trafficStep);
  }
}
