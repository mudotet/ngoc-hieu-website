const shots = {
  outside: { stageIndex: 0, position: [8, 2.8, 10], look: [0, 1.8, 0], horizontalFov: 40 },
  signature: { stageIndex: 2, position: [0.45, 2.15, -7.2], look: [0, 1.475, -9.3], horizontalFov: 32 },
  menu: { stageIndex: 4, position: [-9.55, 1.85, -6.25], look: [-10.1, 1.065, -7.1], horizontalFov: 38 },
} as const;

export function mobileCamera(journey: string | undefined, aspect: number) {
  const shot = journey === 'signature' ? shots.signature : journey === 'menu' ? shots.menu : shots.outside;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const fov = Math.min(85, Math.max(40, 2 * Math.atan(Math.tan(shot.horizontalFov * Math.PI / 360) / safeAspect) * 180 / Math.PI));
  return { ...shot, fov };
}
