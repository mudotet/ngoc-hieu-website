import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { palette, sceneColors, type ThemeMode } from './theme';
import { mobileCamera } from './mobileCamera';
import { createTrafficState, stepTraffic, trafficBodies, trafficPose, trafficSignal } from './traffic';
import { pedestrianLimits, createPedestrianAgents, stepPedestrians, type PedestrianAppearance } from './streetPedestrians';

declare global {
  interface ImportMeta {
    readonly env: { readonly DEV: boolean };
  }
}

gsap.registerPlugin(ScrollTrigger);

const sceneLighting = {
  dark: { hemisphere: 0.55, fill: 0.35, environment: 0.35, interior: 12, entrance: 16, exposure: 1.05 },
  light: { hemisphere: 2.1, fill: 0.8, environment: 0.35, interior: 5, entrance: 7, exposure: 1.12 },
  ao: 0.18,
  vignette: 0,
} as const;

const aoIntensity = (progress: number) => sceneLighting.ao * THREE.MathUtils.smoothstep(progress, 0.24, 0.3) * (1 - THREE.MathUtils.smoothstep(progress, 0.82, 0.88));

export default function RestaurantScene({ entered = false, onEntered, onUnavailable, theme, tourMode = 'scroll' }: { entered?: boolean; onEntered?: () => void; onUnavailable?: () => void; theme: ThemeMode; tourMode?: 'scroll' | 'steps' }) {
  const themeRef = useRef(theme);
  const applyTheme = useRef<((mode: ThemeMode) => void) | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onEntered);
  const unavailable = useRef(onUnavailable);
  useEffect(() => { unavailable.current = onUnavailable; }, [onUnavailable]);
  const controls = useRef<((value: boolean) => void) | null>(null);
  const [failed, setFailed] = useState(false);
  const previousEntered = useRef(entered);

  useEffect(() => { callback.current = onEntered; }, [onEntered]);
  useEffect(() => {
    themeRef.current = theme;
    applyTheme.current?.(theme);
  }, [theme]);

  useEffect(() => {
    const container = host.current;
    const chapter = container?.closest<HTMLElement>('.hero');
    if (!container || !chapter) return;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const instances = new Set<THREE.InstancedMesh>();
    const textures = new Set<THREE.Texture>();
    const media = gsap.matchMedia();
    const progress = { value: 0 };
    let renderer: THREE.WebGLRenderer | undefined;
    let composer: EffectComposer | undefined;
    const passes: { dispose: () => void }[] = [];
    let resize: ResizeObserver | undefined;
    let intersection: IntersectionObserver | undefined;
    let visible = false;
    let disposed = false;
    let readyEmitted = false;
    let frame = 0;
    let lastFrame = 0;
    let walkingTime = 0;
    let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let syncAnimation = () => {};
    const visibilityChanged = () => syncAnimation();
    const caption = chapter.querySelector<HTMLElement>('.scene-caption');
    const originalCaption = caption?.textContent;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibilityChanged);
      delete container.dataset.walking;
      delete container.dataset.traffic;
      delete container.dataset.hostLift;
      delete container.dataset.receptionWave;
      delete container.dataset.ledPhase;
      delete container.dataset.ledIntensity;
      delete container.dataset.theme;
      media.revert();
      gsap.killTweensOf(progress);
      resize?.disconnect();
      intersection?.disconnect();
      renderer?.domElement.removeEventListener('webglcontextlost', contextLost);
      instances.forEach(item => item.dispose());
      geometries.forEach(item => item.dispose());
      materials.forEach(item => item.dispose());
      textures.forEach(item => item.dispose());
      applyTheme.current = null;
      passes.forEach(pass => pass.dispose());
      composer?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
      delete chapter.dataset.journey;
      delete chapter.dataset.progress;
      chapter.style.removeProperty('--story-progress');
      for (const name of ['quality', 'fps', 'environment', 'drawCalls', 'triangles', 'renderedFps', 'pixelRatio', 'batchedMeshes', 'lighting', 'exposure', 'aoIntensity']) delete container.dataset[name];
      if (caption && originalCaption) caption.textContent = originalCaption;
      controls.current = null;
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      const rect = chapter.getBoundingClientRect();
      const wasInStory = rect.top <= 1 && rect.bottom > 0;
      setFailed(true);
      cleanup();
      unavailable.current?.();
      if (tourMode === 'scroll' && wasInStory) window.scrollTo({ top: window.scrollY + chapter.getBoundingClientRect().top, behavior: 'instant' });
    };

    try {
      const mobile = matchMedia('(max-width: 899px), (pointer: coarse)').matches;
      const mobileSteps = mobile && tourMode === 'steps';
      const weak = (navigator.hardwareConcurrency || 4) <= 4;
      let quality = mobile || weak ? 0 : 1;
      const targetFps = mobile ? 30 : 60;
      let renderDelta = 1 / targetFps;
      let smoothedProgress = 0;
      let measuredFrames = 0;
      let measuredTime = 0;
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: quality > 0, powerPreference: 'high-performance' });
      const gl = renderer;
      let pixelRatioCap = quality ? 1.5 : 1;
      gl.setPixelRatio(Math.min(devicePixelRatio || 1, pixelRatioCap));
      gl.info.autoReset = false;
      gl.outputColorSpace = THREE.SRGBColorSpace;
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 1.12;
      gl.shadowMap.enabled = quality > 0;
      gl.shadowMap.autoUpdate = false;
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      gl.domElement.setAttribute('aria-hidden', 'true');
      container.appendChild(gl.domElement);
      const scene = new THREE.Scene();
      const distanceFog = new THREE.Fog(palette.ink, 24, 85);
      scene.fog = distanceFog;
      const room = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(gl);
      const environment = pmrem.fromScene(room, 0.04);
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.35;
      container.dataset.environment = 'generated-room-pmrem';
      passes.push({ dispose: () => environment.dispose() });
      room.dispose();
      pmrem.dispose();
      const rimLight = new THREE.DirectionalLight(palette.amber, 1.4);
      rimLight.position.set(-8, 7, -9);
      scene.add(rimLight);
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 180);
      const hemisphere = new THREE.HemisphereLight(sceneColors.white, palette.paper, 1.65);
      scene.add(hemisphere);
      const key = new THREE.DirectionalLight(palette.cream, 2.1);
      key.position.set(6, 10, 8);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 30 });
      key.shadow.normalBias = 0.035;
      scene.add(key);
      const fill = new THREE.DirectionalLight(sceneColors.white, 0.65);
      fill.position.set(-5, 5, 6);
      scene.add(fill);
      const lamp = new THREE.PointLight(palette.amber, 12, 8);
      const interiorLights = [lamp];
      lamp.position.set(0, 2.8, -2);
      scene.add(lamp);
      const tint = (color: string, amount: number) => new THREE.Color(color).lerp(new THREE.Color(palette.cream), amount);
      const material = (color: THREE.ColorRepresentation, roughness = 0.8) => {
        const value = new THREE.MeshStandardMaterial({ color, roughness });
        materials.add(value);
        return value;
      };
      const grain = document.createElement('canvas');
      grain.width = grain.height = 128;
      const grainContext = grain.getContext('2d');
      if (!grainContext) throw new Error('Canvas 2D unavailable');
      const pixels = grainContext.createImageData(128, 128);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const shade = 180 + ((i * 73 + (i % 131) * 29) % 65);
        pixels.data.set([shade, shade, shade, 255], i);
      }
      grainContext.putImageData(pixels, 0, 0);
      const surface = new THREE.CanvasTexture(grain);
      surface.wrapS = surface.wrapT = THREE.RepeatWrapping;
      surface.repeat.set(4, 4);
      textures.add(surface);
      const bone = material(palette.cream);
      const wall = material(tint(palette.purpleMid, 0.55));
      const iron = material(sceneColors.iron, 0.65);
      const timber = material(sceneColors.timber);
      const accent = material(palette.greenMid);
      const doorPaint = material(palette.purpleMid);
      const brass = material(sceneColors.brass, 0.4);
      const glass = material(palette.amber, 0.2);
      glass.transparent = true;
      glass.opacity = 0.18;
      glass.depthWrite = false;
      for (const finish of [bone, wall, timber, iron]) {
        finish.roughnessMap = surface;
        finish.bumpMap = surface;
        finish.bumpScale = 0.025;
      }
      brass.metalness = 0.55;
      const asphalt = material(sceneColors.asphalt, 1);
      asphalt.map = surface;
      const mortar = material(sceneColors.mortar, 1);
      const marking = material(palette.paper, 1);
      const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
      const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 32);
      geometries.add(boxGeometry);
      geometries.add(cylinderGeometry);
      const mesh = (shape: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, position: number[], scale: number[]) => {
        const object = new THREE.Mesh(shape, mat);
        object.position.set(position[0], position[1], position[2]);
        object.scale.set(scale[0], scale[1], scale[2]);
        object.castShadow = mat !== glass;
        object.receiveShadow = true;
        parent.add(object);
        return object;
      };
      const box = (mat: THREE.Material, position: number[], scale: number[], parent: THREE.Object3D = scene) => mesh(boxGeometry, mat, parent, position, scale);
      const cylinder = (mat: THREE.Material, position: number[], scale: number[]) => mesh(cylinderGeometry, mat, scene, position, scale);
      box(asphalt, [0, -0.28, -4], [600, 0.24, 600]).name = 'road-ground';
      box(mortar, [-4.25, -0.08, -4.5], [18.5, 0.22, 17]).name = 'sidewalk-ground';
      for (let x = -13.15; x < 4.8; x += 0.6) {
        for (let z = -12.65; z < 3.8; z += 0.6) {
          if (x > -12.7 && x < 3.7 && z > -12.2 && z < 2.3) continue;
          box(bone, [x, 0.045, z], [0.575, 0.025, 0.575]);
        }
      }
      box(bone, [-4.25, -0.015, 4], [18.68, 0.25, 0.18]).name = 'sidewalk-front-curb';
      box(bone, [-4.25, -0.015, -13], [18.68, 0.25, 0.18]).name = 'sidewalk-rear-curb';
      for (const x of [-13.5, 5]) box(bone, [x, -0.015, -4.5], [0.18, 0.25, 17]).name = 'sidewalk-side-curb';
      for (let x = -4; x < 8; x += 2.3) box(marking, [x, -0.151, 6.1], [1.1, 0.008, 0.08]);
      for (let z = -12; z < 4; z += 2.3) box(marking, [7.1, -0.151, z], [0.08, 0.008, 1.1]);
      for (let i = 0; i < 5; i++) box(marking, [5.6 + i * 0.55, -0.15, 4.7], [0.32, 0.008, 1.5]);
      box(bone, [-4.5, 0.04, -5], [16, 0.12, 14]).name = 'interior-continuous-floor';
      const rightBuilding = new THREE.Group();
      rightBuilding.name = 'restaurant-building-right';
      scene.add(rightBuilding);
      const leftBuilding = new THREE.Group();
      leftBuilding.name = 'restaurant-building-left';
      scene.add(leftBuilding);
      const structuralWalls: THREE.Mesh[] = [];
      const structure = (mat: THREE.Material, position: number[], scale: number[], parent: THREE.Object3D = scene) => {
        const object = box(mat, position, scale, parent);
        structuralWalls.push(object);
        return object;
      };
      structure(wall, [-5.5, 1.6, -8.9], [0.22, 3.2, 6.2], rightBuilding).name = 'connector-wall-rear';
      structure(wall, [-5.5, 1.6, -0.9], [0.22, 3.2, 5.8], rightBuilding).name = 'connector-wall-front';
      structure(wall, [-5.5, 2.98, -4.8], [0.22, 0.44, 2], rightBuilding).name = 'connector-lintel';
      const connector = new THREE.Group();
      connector.name = 'connector-opening';
      connector.position.set(-5.5, 1.43, -4.8);
      connector.userData.clearance = { width: 1.98, height: 2.6, axis: 'z' };
      rightBuilding.add(connector);
      for (const z of [-5.82, -3.78]) box(brass, [-5.5, 1.4, z], [0.3, 2.6, 0.06], rightBuilding);
      box(brass, [-5.5, 2.73, -4.8], [0.3, 0.06, 2.1], rightBuilding);
      const leftPlaster = material(tint(palette.greenMid, 0.6));
      structure(leftPlaster, [-12.5, 1.9, -5], [0.22, 3.8, 14], leftBuilding).name = 'left-outer-wall';
      structure(leftPlaster, [-9, 1.9, -12], [7, 3.8, 0.22], leftBuilding).name = 'left-back-wall';
      for (const x of [-11.285, -6.715]) structure(leftPlaster, [x, 0.38, 2], [2.43, 0.76, 0.25], leftBuilding).name = 'left-entrance-wall-base';
      structure(leftPlaster, [-9, 3.28, 2], [7, 1.04, 0.25], leftBuilding).name = 'left-entrance-lintel';
      for (const x of [-12.4, -10.15, -7.85, -5.6]) {
        structure(timber, [x, 1.72, 2], [0.16, 2.1, 0.3], leftBuilding);
      }
      for (const x of [-11.27, -6.73]) {
        box(glass, [x, 1.72, 2.04], [2.05, 1.88, 0.04], leftBuilding);
        for (const y of [0.78, 2.66]) box(iron, [x, y, 2.08], [2.15, 0.07, 0.1], leftBuilding);
        box(brass, [x, 1.72, 2.09], [0.045, 1.88, 0.06], leftBuilding);
        box(accent, [x, 2.78, 2.38], [2.18, 0.1, 0.8], leftBuilding);
        box(bone, [x, 0.75, 2.14], [2.18, 0.1, 0.36], leftBuilding);
      }
      const leftEntrance = new THREE.Group();
      leftEntrance.name = 'left-entrance-door';
      leftEntrance.userData.clearance = { width: 1.7, height: 2.58, axis: 'x' };
      leftBuilding.add(leftEntrance);
      for (const side of [-1, 1]) {
        box(doorPaint, [-9 + side * 1.02, 1.43, 2], [0.1, 2.66, 0.2], leftEntrance).name = 'left-entrance-jamb';
        const hinge = new THREE.Group();
        hinge.name = `left-entrance-door-leaf-${side}`;
        hinge.position.set(-9 + side * 1.12, 0.1, 2.22);
        hinge.rotation.y = Math.PI;
        leftEntrance.add(hinge);
        for (const y of [0.055, 2.575]) box(doorPaint, [-side * 0.48, y, 0], [0.96, 0.11, 0.1], hinge);
        for (const edge of [0.045, 0.915]) box(doorPaint, [-side * edge, 1.315, 0], [0.09, 2.52, 0.1], hinge);
        box(glass, [-side * 0.48, 1.315, 0], [0.78, 2.41, 0.035], hinge).name = 'left-entrance-glass';
        box(brass, [-side * 0.8, 1.22, 0.09], [0.035, 0.38, 0.035], hinge).name = 'left-entrance-handle';
        for (const y of [0.34, 2.25]) box(brass, [0, y, 0], [0.12, 0.12, 0.12], hinge);
      }
      box(doorPaint, [-9, 2.73, 2], [2.14, 0.06, 0.2], leftEntrance).name = 'left-entrance-header';
      box(bone, [-9, 0.1, 2.12], [2.14, 0.04, 0.58], leftEntrance).name = 'left-entrance-threshold';
      box(accent, [-9, 2.86, 2.5], [2.7, 0.14, 1.2], leftEntrance).name = 'left-entrance-canopy';
      const connectingDoor = new THREE.Group();
      connectingDoor.name = 'interior-connecting-door';
      connectingDoor.position.set(-5.72, 0.1, -5.96);
      connectingDoor.rotation.y = Math.PI;
      connectingDoor.userData.openAngle = Math.PI;
      rightBuilding.add(connectingDoor);
      for (const y of [0.055, 2.575]) box(doorPaint, [0, y, 0.94], [0.1, 0.11, 1.88], connectingDoor);
      for (const z of [0.045, 1.835]) box(doorPaint, [0, 1.315, z], [0.1, 2.41, 0.09], connectingDoor);
      box(glass, [0, 1.315, 0.94], [0.035, 2.41, 1.7], connectingDoor).name = 'interior-connecting-door-glass';
      box(brass, [-0.09, 1.22, 1.68], [0.035, 0.38, 0.035], connectingDoor).name = 'interior-connecting-door-handle';
      for (const y of [0.34, 2.25]) box(brass, [0, y, 0], [0.12, 0.12, 0.12], connectingDoor);
      if (import.meta.env.DEV) {
      leftEntrance.updateMatrixWorld(true);
      connectingDoor.updateMatrixWorld(true);
      const entrancePassage = new THREE.Box3(new THREE.Vector3(-9.75, 0.18, 0.7), new THREE.Vector3(-8.25, 2.5, 2.6));
      leftEntrance.traverse(object => {
        if (object instanceof THREE.Mesh) console.assert(!new THREE.Box3().setFromObject(object).intersectsBox(entrancePassage), '[left-entrance-clearance] Door leaves and trim must leave the entrance open');
      });
      console.assert(!new THREE.Box3().setFromObject(connectingDoor).intersectsBox(new THREE.Box3(new THREE.Vector3(-7.6, 0.15, -5.8), new THREE.Vector3(-5.2, 2.55, -3.8))), '[connector-door-clearance] Open glass leaf must clear the connecting corridor');
      }
      structure(iron, [-9.1, 3.91, -5], [7.2, 0.22, 14.4], leftBuilding).name = 'left-building-roof';
      box(bone, [-9, 3.74, 2.16], [7.1, 0.16, 0.38], leftBuilding).name = 'left-facade-cornice';
      box(accent, [-9, 3.88, 2.23], [7.2, 0.06, 0.07], leftBuilding);
      box(timber, [-11.55, 0.55, -8.3], [1.1, 0.85, 4.2], leftBuilding).name = 'left-lounge-banquette';
      box(accent, [-11.55, 1.055, -8.3], [1.08, 0.14, 4.18], leftBuilding);
      box(accent, [-12.02, 1.585, -8.3], [0.18, 0.9, 4.18], leftBuilding);
      for (const z of [-7.1, -9.3]) {
        box(timber, [-10.1, 0.92, z], [1.1, 0.12, 1.2], leftBuilding).name = 'left-lounge-table';
        box(iron, [-10.1, 0.48, z], [0.12, 0.85, 0.12], leftBuilding);
      }
      const leftDiningZone = new THREE.Group();
      leftDiningZone.name = 'left-dining-zone';
      leftBuilding.add(leftDiningZone);
      const leftGalleryLounge = new THREE.Group();
      leftGalleryLounge.name = 'left-gallery-lounge';
      leftDiningZone.add(leftGalleryLounge);
      box(timber, [-12.28, 0.96, -8.3], [0.12, 1.7, 4.4], leftGalleryLounge).name = 'left-gallery-wainscot';
      box(brass, [-12.19, 1.84, -8.3], [0.06, 0.04, 4.4], leftGalleryLounge).name = 'left-gallery-picture-rail';
      for (const z of [-7.1, -9.3]) {
        box(accent, [-9.18, 0.59, z], [0.52, 0.14, 0.62], leftGalleryLounge).name = 'left-gallery-dining-chair';
        box(timber, [-8.96, 0.93, z], [0.08, 0.54, 0.62], leftGalleryLounge);
        for (const dz of [-0.22, 0.22]) box(iron, [-9.18, 0.33, z + dz], [0.42, 0.38, 0.055], leftGalleryLounge);
      }
      for (const [name, z, length, tableZs] of [
        ['left-rear-dining-booth', -9.7, 3.35, [-8.85, -10.55]],
        ['left-window-dining-nook', 0.35, 2.2, [0.35]],
      ] as const) {
        const zone = new THREE.Group();
        zone.name = name;
        leftDiningZone.add(zone);
        box(timber, [-6.18, 0.34, z], [0.7, 0.46, length], zone).name = `${name}-banquette`;
        box(accent, [-6.18, 0.64, z], [0.69, 0.14, length - 0.04], zone);
        box(accent, [-5.88, 1.02, z], [0.12, 0.58, length - 0.04], zone).name = `${name}-back`;
        for (const tableZ of tableZs) {
          box(timber, [-7.04, 0.87, tableZ], [0.82, 0.1, 0.95], zone).name = `${name}-table`;
          mesh(cylinderGeometry, iron, zone, [-7.04, 0.49, tableZ], [0.055, 0.66, 0.055]);
          mesh(cylinderGeometry, iron, zone, [-7.04, 0.14, tableZ], [0.27, 0.06, 0.27]);
          box(bone, [-7.04, 0.927, tableZ], [0.32, 0.014, 0.7], zone).name = `${name}-linen`;
        }
        box(timber, [-6.22, 1.62, z], [0.6, 0.065, length - 0.2], zone).name = `${name}-wall-shelf`;
        for (const dz of [-0.55, 0.55]) {
          mesh(cylinderGeometry, bone, zone, [-6.14, 1.75, z + dz], [0.105, 0.19, 0.105]).name = `${name}-shelf-ceramic`;
        }
        box(brass, [-6.96, 3.46, z], [0.02, 0.56, 0.02], zone).name = `${name}-pendant-stem`;
        mesh(cylinderGeometry, brass, zone, [-6.96, 3.13, z], [0.36, 0.12, 0.36]).name = `${name}-pendant`;
        mesh(cylinderGeometry, bone, zone, [-6.96, 3.06, z], [0.32, 0.018, 0.32]);
      }
      for (const [x, z] of [[-11.45, -11.15], [-6.35, -7.48]]) {
        box(timber, [x, 0.4, z], [1.05, 0.56, 0.48], leftDiningZone).name = 'left-low-planter-partition';
        box(iron, [x, 0.69, z], [0.96, 0.025, 0.39], leftDiningZone);
        for (const dx of [-0.32, 0, 0.32]) {
          mesh(cylinderGeometry, accent, leftDiningZone, [x + dx, 0.92, z], [0.15, 0.42, 0.15]).name = 'left-planter-foliage';
        }
      }
      box(timber, [-10.4, 0.66, -1.4], [2.5, 1.12, 1.1], leftBuilding).name = 'left-reception-counter';
      box(bone, [-10.4, 1.26, -1.4], [2.65, 0.1, 1.24], leftBuilding);
      for (let x = -11.55; x < -9.2; x += 0.2) box(brass, [x, 0.67, -0.82], [0.025, 1, 0.03], leftBuilding);
      box(brass, [-10.4, 1.16, -0.82], [2.5, 0.035, 0.03], leftBuilding).name = 'left-reception-counter-front';
      box(iron, [-10.5, 1.45, -1.5], [0.45, 0.28, 0.04], leftBuilding).name = 'left-reservation-terminal';
      box(accent, [-10.5, 1.45, -1.474], [0.39, 0.22, 0.01], leftBuilding).name = 'left-reservation-terminal-screen';
      for (const z of [-4.5, -8.5]) {
        const glow = new THREE.PointLight(palette.amber, 9, 7);
        interiorLights.push(glow);
        glow.position.set(-8.5, 3.2, z);
        leftBuilding.add(glow);
        box(brass, [-8.5, 3.55, z], [0.025, 0.55, 0.025], leftBuilding);
        box(bone, [-8.5, 3.24, z], [0.65, 0.14, 0.65], leftBuilding);
      }
      const rightBlankWall = box(wall, [3.5, 1.6, -8], [0.22, 3.2, 8]);
      rightBlankWall.name = 'right-blank-wall';
      box(wall, [-4.5, 0.4, 2], [2, 0.8, 0.25]);
      box(glass, [-4.5, 1.8, 2], [1.8, 2, 0.04]);
      box(timber, [-5.4, 1.7, 2], [0.18, 2.8, 0.25]);
      box(wall, [-4.5, 3, 2], [2, 0.4, 0.25]);
      box(timber, [-4.35, 0.65, 0.1], [1.45, 1.1, 1.3]).name = 'reception-counter';
      box(bone, [-4.35, 1.25, 0.1], [1.6, 0.1, 1.45]);
      for (let x = -4.95; x < -3.65; x += 0.18) box(brass, [x, 0.68, 0.77], [0.025, 0.95, 0.025]);
      box(iron, [-4.45, 1.42, 0.12], [0.36, 0.25, 0.035]).name = 'reception-reservation-terminal';
      box(timber, [-5.28, 1.6, -1.75], [0.2, 2.7, 1.5]).name = 'reception-display-shelf';
      for (const y of [0.65, 1.4, 2.15]) {
        box(bone, [-5.04, y, -1.75], [0.5, 0.075, 1.45]);
        for (let i = 0; i < 4; i++) box(i % 2 ? accent : brass, [-5.04, y + 0.2, -2.25 + i * 0.28], [0.24, 0.32, 0.1]);
      }
      box(timber, [-4, 0.38, -3.15], [1.45, 0.55, 1.7]).name = 'reception-waiting-bench';
      box(accent, [-4, 0.74, -3.15], [1.43, 0.15, 1.68]);
      box(accent, [-4.62, 1.225, -3.15], [0.15, 0.8, 1.68]);
      const sideFacade = new THREE.Group();
      sideFacade.name = 'facade-side';
      sideFacade.position.set(3.5, 0, -1);
      sideFacade.rotation.y = Math.PI / 2;
      scene.add(sideFacade);
      structure(wall, [0, 0.35, 0], [6, 0.7, 0.24], sideFacade);
      structure(wall, [0, 2.95, 0], [6, 0.5, 0.24], sideFacade);
      for (const x of [-2.8, -0.95, 0.95, 2.8]) structure(timber, [x, 1.7, 0], [0.2, 2.1, 0.28], sideFacade);
      for (const x of [-1.88, 0, 1.88]) {
        for (const edge of [-1, 1]) {
          box(iron, [x + edge * 0.79, 1.68, 0], [0.07, 1.95, 0.14], sideFacade);
          box(iron, [x, 1.68 + edge * 0.94, 0], [1.65, 0.07, 0.14], sideFacade);
        }
        box(glass, [x, 1.68, 0.035], [1.51, 1.77, 0.03], sideFacade);
        box(bone, [x, 0.73, 0.13], [1.85, 0.12, 0.38], sideFacade);
        box(brass, [x, 1.7, 0.08], [0.045, 1.8, 0.04], sideFacade);
        box(accent, [x, 2.78, 0.36], [1.85, 0.1, 0.9], sideFacade);
      }
      box(wall, [-1, 1.6, -12], [9, 3.2, 0.16]).name = 'interior-back-wall';
      const warmWall = material(palette.paper);
      warmWall.bumpMap = surface;
      warmWall.bumpScale = 0.035;
      box(warmWall, [-1, 1.6, -11.88], [8.7, 3.1, 0.08]);
      box(timber, [-1, 0.48, -10.85], [6.6, 0.75, 0.9]).name = 'interior-rear-credenza';
      box(bone, [-1, 0.9, -10.85], [6.7, 0.1, 1]);
      for (const side of [-1, 1]) {
        box(timber, [side * 3.33, 0.65, -7.7], [0.12, 1.1, 4.2]).name = 'interior-wood-wainscot';
        for (let z = -9.5; z < -5.8; z += 0.3) box(brass, [side * 3.25, 0.65, z], [0.02, 1, 0.025]);
        box(timber, [side * 2.65, 0.36, -7.25], [1.05, 0.55, 3.3]).name = 'lounge-banquette';
        box(accent, [side * 2.62, 0.69, -7.25], [1.02, 0.18, 3.24]);
        box(accent, [side * 3.04, 1.1, -7.25], [0.18, 0.85, 3.24]);
        for (const z of [-6.25, -8.05]) {
          box(timber, [side * 1.85, 0.95, z], [0.95, 0.1, 1.05]).name = 'lounge-table';
          cylinder(iron, [side * 1.85, 0.48, z], [0.055, 0.9, 0.055]);
        }
      }
      for (const z of [-4.6, -7.5]) {
        const glow = new THREE.PointLight(palette.amber, 8, 5);
        interiorLights.push(glow);
        glow.position.set(0, 2.7, z);
        scene.add(glow);
        cylinder(brass, [0, 2.98, z], [0.015, 0.4, 0.015]);
        cylinder(bone, [0, 2.72, z], [0.38, 0.18, 0.38]).name = 'interior-pendant';
      }
      for (const x of [-2.35, 2.35]) {
        box(wall, [x, 0.37, 2], [2.3, 0.74, 0.25]);
        box(wall, [x, 2.95, 2], [2.3, 0.5, 0.25]);
        for (const edge of [-1, 1]) {
          box(timber, [x + edge * 1.04, 1.7, 2], [0.22, 2, 0.3]);
          box(iron, [x + edge * 0.82, 1.7, 2.1], [0.08, 1.95, 0.12]);
          box(iron, [x, 1.7 + edge * 0.94, 2.1], [1.72, 0.08, 0.12]);
        }
        box(bone, [x, 0.72, 2.18], [2.2, 0.12, 0.42]);
        box(glass, [x, 1.7, 2.17], [1.55, 1.7, 0.04]);
        box(brass, [x, 1.7, 2.2], [0.04, 1.7, 0.03]);
        box(accent, [x, 2.8, 2.5], [2.35, 0.12, 1]);
      }
      structure(iron, [-0.9, 3.3, -5], [9.2, 0.22, 14.4], rightBuilding).name = 'building-roof';
      box(accent, [-1, 3.35, 2.23], [9.4, 0.08, 0.07]);
      box(timber, [0, 2.95, 2], [2.4, 0.5, 0.2]);
      const doors: THREE.Group[] = [];
      for (const side of [-1, 1]) {
        const hinge = new THREE.Group();
        hinge.name = `entrance-door-${side}`;
        hinge.position.set(side * 1.12, 0.08, 2.05);
        scene.add(hinge);
        box(doorPaint, [-side * 0.55, 0.35, 0], [1.1, 0.7, 0.12], hinge);
        box(doorPaint, [-side * 0.55, 2.5, 0], [1.1, 0.12, 0.12], hinge);
        for (const edge of [0.06, 1.04]) box(doorPaint, [-side * edge, 1.28, 0], [0.12, 2.56, 0.12], hinge);
        box(glass, [-side * 0.55, 1.55, 0.08], [0.88, 1.75, 0.03], hinge);
        box(brass, [-side * 0.96, 1.2, 0.14], [0.04, 0.35, 0.04], hinge);
        doors.push(hinge);
      }
      const housePalette = [palette.purple, palette.green, palette.purpleMid, palette.greenMid, palette.purple];
      const houseColors = housePalette.map(color => material(tint(color, 0.32)));
      const windowDark = material(sceneColors.window, 0.35);
      const streetWindow = material(palette.amber, 0.35);
      const streetDetails: { mat: THREE.Material; positions: number[][]; scales: number[][] }[] = [bone, doorPaint, streetWindow, iron].map(mat => ({ mat, positions: [], scales: [] }));
      const detail = (index: number, x: number, y: number, z: number, width: number, height: number, depth: number, side: boolean) => {
        streetDetails[index].positions.push(side ? [z, y, x] : [x, y, z]);
        streetDetails[index].scales.push(side ? [depth, height, width] : [width, height, depth]);
      };
      for (const side of [false, true]) {
        box(mortar, side ? [16, -0.04, -12] : [-10, -0.04, 16], side ? [6, 0.32, 62] : [62, 0.32, 6]).name = `street-opposite-sidewalk-${side}`;
        for (let i = 0; i < 10; i++) {
          const along = -36 + i * 5.6;
          const height = 5.3 + i % 3 * 0.65;
          const house = new THREE.Group();
          house.name = `street-house-${side ? 'side' : 'front'}-${i}`;
          const lod = new THREE.LOD();
          lod.position.copy(side ? new THREE.Vector3(19, 0, along) : new THREE.Vector3(along, 0, 19));
          house.position.copy(lod.position).negate();
          lod.addLevel(house, 0);
          lod.addLevel(new THREE.Group(), 65);
          scene.add(lod);
          box(houseColors[i % houseColors.length], side ? [19, height / 2, along] : [along, height / 2, 19], side ? [7, height, 5.5] : [5.5, height, 7], house).castShadow = false;
          const oppositeDetail = (index: number, x: number, y: number, z: number, width: number, height: number, depth: number, side: boolean) => detail(index, x, y, z + 2, width, height, depth, side);
          oppositeDetail(0, along, height + 0.08, 16.8, 5.6, 0.18, 7.4, side);
          oppositeDetail(3, along, height + 0.25, 16.8, 5.3, 0.16, 7.1, side);
          oppositeDetail(0, along, 2.7, 13.43, 5.5, 0.12, 0.22, side);
          oppositeDetail(1, along, 1.2, 13.44, 1.12, 2.4, 0.12, side);
          oppositeDetail(2, along, 1.35, 13.365, 0.87, 1.8, 0.025, side);
          oppositeDetail(0, along, 0.16, 13.18, 1.3, 0.2, 0.6, side);
          for (const x of [-1.65, 1.65]) for (const y of [1.5, 3.8]) {
            oppositeDetail(3, along + x, y, 13.43, 1.25, 1.55, 0.14, side);
            oppositeDetail(2, along + x, y, 13.345, 1.05, 1.35, 0.025, side);
            oppositeDetail(0, along + x, y - 0.8, 13.25, 1.45, 0.12, 0.4, side);
            oppositeDetail(1, along + x, y, 13.29, 0.055, 1.4, 0.06, side);
          }
        }
      }
      for (const side of [false, true]) {
        const frontage = side ? 3.5 : 2;
        const rowStart = side ? -14.8 : -15.3;
        const rowCenter = rowStart - 7 * 5.55 / 2;
        box(mortar, side ? [4.25, -0.08, rowCenter] : [rowCenter, -0.08, 3], side ? [1.5, 0.22, 44.4] : [44.4, 0.22, 2]).name = `terrace-sidewalk-${side}`;
        box(bone, side ? [5, 0.015, rowCenter] : [rowCenter, 0.015, 4], side ? [0.15, 0.2, 44.4] : [44.4, 0.2, 0.15]).name = `terrace-curb-${side}`;
        for (let i = 0; i < 8; i++) {
          const along = rowStart - i * 5.55;
          const across = frontage - 3.5;
          const height = 4.2 + i % 3 * 0.65;
          const lod = new THREE.LOD();
          lod.name = `neighborhood-building-${side ? 'side-terrace' : 'front-terrace'}-${i}`;
          lod.position.set(side ? across : along, 0, side ? along : across);
          const house = new THREE.Group();
          box(houseColors[i % houseColors.length], [0, height / 2, 0], side ? [7, height, 5.5] : [5.5, height, 7], house).castShadow = false;
          box(bone, [0, height, 0], side ? [7.12, 0.18, 5.55] : [5.55, 0.18, 7.12], house);
          lod.addLevel(house, 0);
          lod.addLevel(new THREE.Group(), 90);
          scene.add(lod);
          detail(1, along, 1.1, frontage + 0.025, 1.15, 2.2, 0.08, side);
          detail(2, along, 1.25, frontage + 0.075, 0.9, 1.7, 0.025, side);
          detail(1, along, 2.52, frontage + 0.1, 4.7, 0.36, 0.16, side);
          detail(0, along, 2.8, frontage + 0.38, 5.2, 0.1, 0.8, side);
          detail(0, along, height - 0.16, frontage + 0.12, 5.5, 0.12, 0.28, side);
          for (const x of [-1.75, 1.75]) {
            detail(3, along + x, 1.3, frontage + 0.035, 1.25, 1.65, 0.1, side);
            detail(2, along + x, 1.3, frontage + 0.095, 1.08, 1.45, 0.025, side);
            detail(3, along + x, 3.55, frontage + 0.035, 1.25, 1.25, 0.1, side);
            detail(2, along + x, 3.55, frontage + 0.095, 1.08, 1.08, 0.025, side);
          }
          detail(0, along, 2.95, frontage + 0.3, 4.5, 0.12, 0.62, side);
          detail(3, along, 3.5, frontage + 0.62, 4.5, 0.055, 0.055, side);
          for (let rail = -2; rail <= 2; rail += 0.4) detail(3, along + rail, 3.22, frontage + 0.62, 0.035, 0.52, 0.035, side);
        }
      }
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      const backdrop = new THREE.LOD();
      backdrop.name = 'backdrop-rear-rooftops';
      backdrop.position.set(-23.5, 0, -27.5);
      const backdropHouses = new THREE.Group();
      for (const [index, finish] of [houseColors[2], iron].entries()) {
        const batch = new THREE.InstancedMesh(boxGeometry, finish, 8);
        batch.name = index ? 'backdrop-roof-caps' : 'backdrop-house-bodies';
        for (let i = 0; i < 8; i++) {
          const height = 5.2 + i % 4 * 0.85;
          matrix.compose(new THREE.Vector3(-10.5 + i % 4 * 7, index ? height + 0.1 : height / 2, i < 4 ? 4.5 : -4.5), quaternion, new THREE.Vector3(index ? 6.2 : 6, index ? 0.2 : height, index ? 6.2 : 6));
          batch.setMatrixAt(i, matrix);
        }
        batch.computeBoundingBox();
        batch.computeBoundingSphere();
        instances.add(batch);
        backdropHouses.add(batch);
      }
      backdrop.addLevel(backdropHouses, 0);
      backdrop.addLevel(new THREE.Group(), 110);
      scene.add(backdrop);
      streetDetails.forEach(({ mat, positions, scales }, index) => {
        const batch = new THREE.InstancedMesh(boxGeometry, mat, positions.length);
        batch.name = `street-house-details-${index}`;
        positions.forEach((position, i) => {
          matrix.compose(new THREE.Vector3(...position), quaternion, new THREE.Vector3(...scales[i]));
          batch.setMatrixAt(i, matrix);
        });
        instances.add(batch);
        batch.receiveShadow = true;
        scene.add(batch);
      });
      for (let x = -38; x < 35; x += 3) box(marking, [x, -0.151, 7.8], [1.4, 0.008, 0.09]);
      for (let z = -40; z < 35; z += 3) box(marking, [8.9, -0.151, z], [0.09, 0.008, 1.4]);
      const vehicleWheels: THREE.Mesh[][] = [];
      const trafficState = createTrafficState();
      const trafficSignals = [0, 1].map(axis => {
        const pole = new THREE.Group();
        pole.position.set(axis ? 5.5 : 2.9, 0, axis ? 0.4 : 4);
        pole.rotation.y = axis ? Math.PI / 2 : 0;
        scene.add(pole);
        box(iron, [0, 1.55, 0], [0.09, 3.1, 0.09], pole);
        box(iron, [0, 2.75, 0], [0.3, 0.86, 0.24], pole);
        return [sceneColors.steak, palette.amber, palette.greenMid].map((color, index) => {
          const light = material(color, 0.3);
          light.emissive.set(color);
          box(light, [0, 3.02 - index * 0.27, 0.13], [0.19, 0.19, 0.035], pole);
          return light;
        });
      });
      const traffic = sceneColors.vehicle.map((color, index) => {
        const wheels: THREE.Mesh[] = [];
        vehicleWheels.push(wheels);
        const car = new THREE.Group();
        car.name = `traffic-car-${index}`;
        scene.add(car);
        const paint = material(color, 0.24);
        paint.metalness = 0.65;
        for (const side of [-1, 1]) {
          box(iron, [side * 0.79, 0.96, 0.52], [0.2, 0.12, 0.26], car);
          box(brass, [side * 0.69, 0.73, -0.23], [0.025, 0.045, 0.18], car);
        }
        box(iron, [0, 0.36, 1.82], [1.22, 0.13, 0.04], car);
        box(bone, [0, 0.44, 1.845], [0.38, 0.1, 0.025], car);
        box(paint, [0, 0.52, 0], [1.55, 0.5, 3.6], car);
        box(paint, [0, 0.92, -0.15], [1.35, 0.62, 1.95], car);
        box(windowDark, [0, 1.01, 0.842], [1.22, 0.36, 0.035], car);
        box(windowDark, [0, 1.01, -1.142], [1.22, 0.36, 0.035], car);
        for (const side of [-1, 1]) {
          for (const z of [-0.65, 0.36]) box(windowDark, [side * 0.683, 1.01, z], [0.025, 0.35, 0.82], car);
          box(bone, [side * 0.54, 0.6, 1.81], [0.3, 0.16, 0.025], car);
          box(paint, [side * 0.54, 0.6, -1.81], [0.3, 0.16, 0.025], car);
          for (const z of [-1.12, 1.12]) {
            const wheel = mesh(cylinderGeometry, iron, car, [side * 0.76, 0.21, z], [0.29, 0.16, 0.29]);
            wheel.rotation.z = Math.PI / 2;
            const hub = mesh(cylinderGeometry, brass, car, [side * 0.85, 0.21, z], [0.13, 0.025, 0.13]);
            hub.rotation.z = Math.PI / 2;
            wheels.push(wheel, hub);
          }
        }
        const pose = trafficPose(trafficState.vehicles[index]);
        car.position.set(pose.x, -0.08, pose.z);
        car.rotation.y = pose.heading;
        return car;
      });
      const roundedGeometry = new THREE.SphereGeometry(1, 16, 10);
      const plateRimGeometry = new THREE.TorusGeometry(0.2, 0.025, 8, 24);
      geometries.add(roundedGeometry);
      geometries.add(plateRimGeometry);
      const ceramic = material(sceneColors.ceramic, 0.26);
      const steak = material(sceneColors.steak, 0.72);
      steak.bumpMap = surface;
      steak.bumpScale = 0.008;
      const char = material(sceneColors.char, 0.9);
      const eggWhite = material(sceneColors.eggWhite, 0.38);
      const yolk = material(sceneColors.yolk, 0.3);
      const garnish = material(sceneColors.garnish, 0.8);
      const steamCanvas = document.createElement('canvas');
      steamCanvas.width = steamCanvas.height = 64;
      const steamContext = steamCanvas.getContext('2d');
      if (!steamContext) throw new Error('Canvas 2D unavailable');
      const vapor = steamContext.createRadialGradient(32, 32, 0, 32, 32, 30);
      vapor.addColorStop(0, sceneColors.vapor[0]);
      vapor.addColorStop(0.45, sceneColors.vapor[1]);
      vapor.addColorStop(1, sceneColors.vapor[2]);
      steamContext.fillStyle = vapor;
      steamContext.fillRect(0, 0, 64, 64);
      const steamTexture = new THREE.CanvasTexture(steamCanvas);
      textures.add(steamTexture);
      const steamWisps: THREE.Sprite[] = [];
      const steamMaterials = Array.from({ length: 3 }, () => {
        const finish = new THREE.SpriteMaterial({ map: steamTexture, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false });
        materials.add(finish);
        return finish;
      });
      for (const x of [-2.06, 2.06]) {
        cylinder(timber, [x, 1, -1.2], [0.8, 0.12, 0.8]);
        cylinder(iron, [x, 0.5, -1.2], [0.06, 1, 0.06]);
        cylinder(iron, [x, 0.08, -1.2], [0.42, 0.08, 0.42]);
        for (const side of [-1, 1]) {
          box(accent, [x + side * 1.04, 0.55, -1.2], [0.48, 0.12, 0.55]);
          box(timber, [x + side * 1.25, 0.86, -1.2], [0.08, 0.72, 0.55]);
          box(iron, [x + side * 1.04, 0.25, -1.2], [0.07, 0.5, 0.4]);
          const plate = new THREE.Group();
          plate.name = `table-plate-${x}-${side}`;
          plate.position.set(x + side * 0.35, 1.085, -1.2);
          scene.add(plate);
          steamMaterials.forEach((finish, index) => {
            const wisp = new THREE.Sprite(finish);
            wisp.name = `steak-steam-${steamWisps.length}`;
            wisp.position.set(-0.035, 0.15 + index * 0.1, 0);
            wisp.scale.set(0.15, 0.28, 1);
            plate.add(wisp);
            steamWisps.push(wisp);
          });
          mesh(cylinderGeometry, ceramic, plate, [0, 0, 0], [0.21, 0.025, 0.21]);
          const rim = mesh(plateRimGeometry, ceramic, plate, [0, 0.018, 0], [1, 1, 1]);
          rim.rotation.x = Math.PI / 2;
          mesh(roundedGeometry, steak, plate, [-0.035, 0.045, 0], [0.12, 0.03, 0.085]).name = 'food-steak';
          for (let i = 0; i < 4; i++) {
            const sear = box(char, [-0.1 + i * 0.04, 0.073, 0], [0.009, 0.003, 0.1], plate);
            sear.rotation.y = -0.35;
          }
          mesh(roundedGeometry, eggWhite, plate, [0.092, 0.028, 0.055], [0.069, 0.012, 0.061]).name = 'food-egg';
          mesh(roundedGeometry, yolk, plate, [0.099, 0.042, 0.057], [0.027, 0.017, 0.027]);
          for (let i = 0; i < 3; i++) mesh(roundedGeometry, garnish, plate, [0.05 + i * 0.028, 0.03, -0.09], [0.036, 0.012, 0.022]);
        }
        cylinder(brass, [x, 2.9, -1.2], [0.015, 0.7, 0.015]);
        cylinder(iron, [x, 2.5, -1.2], [0.3, 0.14, 0.3]);
      }
      box(timber, [-2.65, 0.6, -3.05], [1.1, 1.2, 1.7]).name = 'interior-service-alcove';
      box(bone, [-2.65, 1.24, -3.05], [1.2, 0.1, 1.85]);
      for (let z = -3.75; z < -2.3; z += 0.2) box(brass, [-2.08, 0.6, z], [0.02, 1, 0.02]);
      const signCanvas = document.createElement('canvas');
      signCanvas.width = 1536;
      signCanvas.height = 384;
      const signContext = signCanvas.getContext('2d');
      if (!signContext) throw new Error('Canvas 2D unavailable');
      const signTexture = new THREE.CanvasTexture(signCanvas);
      signTexture.colorSpace = THREE.SRGBColorSpace;
      textures.add(signTexture);
      const letterCanvas = document.createElement('canvas');
      letterCanvas.width = letterCanvas.height = 512;
      const letterContext = letterCanvas.getContext('2d');
      if (!letterContext) throw new Error('Canvas 2D unavailable');
      const letterTexture = new THREE.CanvasTexture(letterCanvas);
      letterTexture.colorSpace = THREE.SRGBColorSpace;
      textures.add(letterTexture);
      const signMaterial = new THREE.MeshBasicMaterial({ map: letterTexture, toneMapped: false });
      signMaterial.name = 'led-letter-enamel';
      materials.add(signMaterial);
      const welcomeMaterial = new THREE.MeshBasicMaterial({ map: signTexture, toneMapped: false });
      materials.add(welcomeMaterial);
      const signMetal = material(palette.purple, 0.48);
      signMetal.name = 'led-brushed-metal';
      signMetal.metalness = 0.7;
      signMetal.roughnessMap = surface;
      signMetal.bumpMap = surface;
      signMetal.bumpScale = 0.003;
      const ledMaterials = Array.from({ length: 4 }, (_, index) => {
        const finish = material(palette.neon, 0.3);
        finish.name = `led-diffuser-${index}`;
        finish.emissive.set(palette.neon);
        finish.emissiveIntensity = 0.85;
        return finish;
      });
      const signGeometry = new THREE.PlaneGeometry(4.4, 1.1);
      geometries.add(signGeometry);
      for (const [parent, depth, faceName] of [[scene, 2.25, 'facade-front'], [leftBuilding, 2.25, 'facade-left-sign'], [sideFacade, 0.1, 'facade-side-sign']] as const) {
        const housing = new THREE.Group();
        housing.name = `led-housing-${faceName}`;
        housing.position.set(parent === leftBuilding ? -9 : 0, 3.6, depth);
        housing.scale.x = 0.25;
        parent.add(housing);
        box(signMetal, [0, 0, 0], [4.72, 1.42, 0.28], housing);
        box(iron, [0, 0, 0.145], [4.48, 1.18, 0.025], housing).name = 'led-inset-gasket';
        const sign = new THREE.Mesh(signGeometry, signMaterial);
        sign.name = faceName;
        sign.position.z = 0.162;
        housing.add(sign);
        for (const side of [-1, 1]) {
          box(signMetal, [0, side * 0.66, 0.17], [4.72, 0.1, 0.08], housing);
          box(signMetal, [side * 2.31, 0, 0.17], [0.1, 1.22, 0.08], housing);
          for (const y of [-0.65, 0.65]) {
            const screw = mesh(cylinderGeometry, brass, housing, [side * 2.31, y, 0.22], [0.025, 0.014, 0.025]);
            screw.name = 'led-fastener';
            screw.rotation.x = Math.PI / 2;
            box(iron, [side * 2.31, y, 0.229], [0.028, 0.005, 0.003], housing);
          }
          for (let i = 0; i < 12; i++) {
            const index = side === 1 ? i : 26 - i;
            box(ledMaterials[index % 4], [-2.09 + i * 0.38, side * 0.635, 0.218], [0.22, 0.026, 0.022], housing).name = `led-strip-${index}`;
          }
          for (let i = 0; i < 3; i++) {
            const index = side === 1 ? 12 + i : 29 - i;
            box(ledMaterials[index % 4], [side * 2.29, 0.38 - i * 0.38, 0.218], [0.026, 0.22, 0.022], housing).name = `led-strip-${index}`;
          }
        }
      }
      const advertisementCanvas = document.createElement('canvas');
      advertisementCanvas.width = 1536;
      advertisementCanvas.height = 640;
      const advertisementContext = advertisementCanvas.getContext('2d');
      if (!advertisementContext) throw new Error('Canvas 2D unavailable');
      const advertisementTexture = new THREE.CanvasTexture(advertisementCanvas);
      advertisementTexture.colorSpace = THREE.SRGBColorSpace;
      textures.add(advertisementTexture);
      const paintAdvertisement = () => {
        advertisementContext.fillStyle = palette.purple;
        advertisementContext.fillRect(0, 0, 1536, 640);
        advertisementContext.strokeStyle = palette.amber;
        advertisementContext.lineWidth = 6;
        advertisementContext.strokeRect(32, 32, 1472, 576);
        advertisementContext.fillStyle = palette.cream;
        advertisementContext.textAlign = 'center';
        advertisementContext.textBaseline = 'middle';
        advertisementContext.font = '500 180px "Be Vietnam Pro", sans-serif';
        advertisementContext.fillText('Ngọc Hiếu', 768, 258, 1350);
        advertisementContext.fillStyle = palette.lime;
        advertisementContext.font = '500 82px "Be Vietnam Pro", sans-serif';
        advertisementContext.fillText('Bít tết & Mỳ Ý', 768, 442, 1350);
        advertisementTexture.needsUpdate = true;
      };
      paintAdvertisement();
      const advertisementMaterial = new THREE.MeshStandardMaterial({ map: advertisementTexture, emissiveMap: advertisementTexture, emissive: sceneColors.white, roughness: 0.55 });
      materials.add(advertisementMaterial);
      const advertisementLight = material(palette.amber, 0.4);
      advertisementLight.emissive.set(palette.amber);
      const advertisement = new THREE.Group();
      advertisement.name = 'right-wall-advertisement';
      advertisement.position.set(3.66, 1.85, -7.7);
      advertisement.rotation.y = Math.PI / 2;
      rightBuilding.add(advertisement);
      box(signMetal, [0, 0, 0], [4.8, 2.08, 0.1], advertisement).name = 'right-wall-advertisement-housing';
      box(advertisementLight, [0, 0, 0.06], [4.68, 1.96, 0.035], advertisement).name = 'right-wall-advertisement-frame';
      const advertisementFace = new THREE.Mesh(signGeometry, advertisementMaterial);
      advertisementFace.name = 'right-wall-advertisement-face';
      advertisementFace.scale.set(4.56 / 4.4, 1.9 / 1.1, 1);
      advertisementFace.position.z = 0.082;
      advertisement.add(advertisementFace);
      const tickerCanvas = document.createElement('canvas');
      tickerCanvas.width = 2048;
      tickerCanvas.height = 128;
      const tickerContext = tickerCanvas.getContext('2d');
      if (!tickerContext) throw new Error('Canvas 2D unavailable');
      const tickerTexture = new THREE.CanvasTexture(tickerCanvas);
      tickerTexture.colorSpace = THREE.SRGBColorSpace;
      tickerTexture.wrapS = THREE.RepeatWrapping;
      textures.add(tickerTexture);
      const tickerMaterial = new THREE.MeshStandardMaterial({ map: tickerTexture, emissiveMap: tickerTexture, emissive: sceneColors.white, emissiveIntensity: 0.35, roughness: 0.55 });
      materials.add(tickerMaterial);
      const paintTicker = () => {
        tickerContext.fillStyle = palette.purple;
        tickerContext.fillRect(0, 0, 2048, 128);
        tickerContext.fillStyle = palette.lime;
        tickerContext.font = '500 68px "Be Vietnam Pro", sans-serif';
        tickerContext.textAlign = 'center';
        tickerContext.textBaseline = 'middle';
        tickerContext.fillText('BÍT TẾT NGỌC HIẾU · HẸN NHAU MỘT BỮA NGON', 1024, 64, 1960);
        tickerTexture.needsUpdate = true;
      };
      paintTicker();
      const tickerSide = new THREE.Group();
      tickerSide.position.set(3.77, 0, -4.865);
      tickerSide.rotation.y = Math.PI / 2;
      rightBuilding.add(tickerSide);
      for (const [parent, width, x, z, offset, name] of [[leftBuilding, 7, -9, 2.27, 0, 'front-left'], [rightBuilding, 9.27, -0.865, 2.27, 0.7, 'front-right'], [tickerSide, 14.27, 0, 0, 1.627, 'side']] as const) {
        const tickerGeometry = new THREE.PlaneGeometry(width, 0.34);
        const uv = tickerGeometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setX(i, offset + uv.getX(i) * width / 10);
        geometries.add(tickerGeometry);
        box(signMetal, [x, 4.48, z - 0.055], [width, 0.44, 0.1], parent).name = `ticker-housing-${name}`;
        for (const post of [-1, 1]) box(signMetal, [x + post * (width / 2 - 0.18), 3.87, z - 0.08], [0.065, 1.18, 0.065], parent);
        const ticker = new THREE.Mesh(tickerGeometry, tickerMaterial);
        ticker.name = `facade-ticker-${name}`;
        ticker.userData.segment = `ticker-${name}`;
        ticker.userData.distance = [offset * 10, offset * 10 + width];
        ticker.position.set(x, 4.48, z);
        parent.add(ticker);
      }
      const signSpill = new THREE.PointLight(palette.amber, 0.9, 3.8, 2);
      signSpill.name = 'led-warm-spill';
      signSpill.position.set(0, 3.65, 2.85);
      scene.add(signSpill);
      const leaves = material(palette.green);
      const foliageGeometry = new THREE.IcosahedronGeometry(1, 1);
      geometries.add(foliageGeometry);
      const backdropTrees = new THREE.LOD();
      backdropTrees.name = 'backdrop-canopy-groups';
      backdropTrees.position.set(-23.5, 0, -18);
      const canopyGroup = new THREE.Group();
      for (const [index, finish] of [leaves, timber].entries()) {
        const batch = new THREE.InstancedMesh(index ? cylinderGeometry : foliageGeometry, finish, index ? 6 : 18);
        batch.name = index ? 'backdrop-tree-trunks' : 'backdrop-tree-canopies';
        for (let i = 0; i < batch.count; i++) {
          const tree = index ? i : Math.floor(i / 3);
          const lobe = index ? 0 : i % 3 - 1;
          matrix.compose(new THREE.Vector3(-10 + tree * 4.8 + lobe * 0.65, index ? 1.65 : 3.9 + (tree % 2) * 0.6 + (lobe === 0 ? 0.35 : 0), tree % 2 * 1.8 + lobe * 0.3), quaternion, index ? new THREE.Vector3(0.12, 3.3, 0.12) : new THREE.Vector3(1.65, 1.5, 1.4));
          batch.setMatrixAt(i, matrix);
        }
        batch.computeBoundingBox();
        batch.computeBoundingSphere();
        instances.add(batch);
        canopyGroup.add(batch);
      }
      backdropTrees.addLevel(canopyGroup, 0);
      backdropTrees.addLevel(new THREE.Group(), 95);
      scene.add(backdropTrees);
      for (const [x, z] of [[-3.1, 2.55], [3.95, -4.45], [-2.8, -9.25], [2.8, -9.25], [2.9, -3.8]]) {
        cylinder(timber, [x, 0.25, z], [0.24, 0.38, 0.24]);
        cylinder(iron, [x, 0.62, z], [0.025, 0.6, 0.025]);
        mesh(foliageGeometry, leaves, scene, [x, 0.96, z], [0.34, 0.45, 0.32]);
      }
      const cornerPocket = new THREE.Group();
      cornerPocket.name = 'diagonal-corner-pocket';
      scene.add(cornerPocket);
      box(bone, [3.48, 0.265, 2.83], [0.62, 0.41, 0.62], cornerPocket).name = 'corner-planter';
      box(timber, [3.48, 0.474, 2.83], [0.5, 0.018, 0.5], cornerPocket).name = 'corner-planter-soil';
      for (const side of [-1, 1]) {
        mesh(foliageGeometry, leaves, cornerPocket, [3.48 + side * 0.13, 0.63, 2.83], [0.22, 0.27, 0.25]);
        box(iron, [3.3 + side * 0.36, 0.26, 3.51], [0.09, 0.405, 0.38], cornerPocket);
      }
      box(timber, [3.3, 0.5, 3.51], [1.08, 0.09, 0.48], cornerPocket).name = 'corner-bench';
      box(brass, [3.3, 0.49, 3.76], [1.08, 0.04, 0.025], cornerPocket).name = 'corner-bench-trim';
      const wireMaterial = new THREE.LineBasicMaterial({ color: sceneColors.iron });
      materials.add(wireMaterial);
      for (const side of [false, true]) {
        for (const along of [-15, -3, 9]) {
          const x = side ? 12.5 : along;
          const z = side ? along : 12.5;
          cylinder(timber, [x, 2.9, z], [0.09, 5.8, 0.09]);
          box(iron, [x, 5.5, z], side ? [0.12, 0.12, 1.2] : [1.2, 0.12, 0.12]);
          if (along === 9) continue;
          for (const offset of [-0.4, 0.4]) {
            const curve = new THREE.QuadraticBezierCurve3(
              new THREE.Vector3(x + (side ? 0 : offset), 5.5, z + (side ? offset : 0)),
              new THREE.Vector3(x + (side ? 0 : 6 + offset), 4.6, z + (side ? 6 + offset : 0)),
              new THREE.Vector3(x + (side ? 0 : 12 + offset), 5.5, z + (side ? 12 + offset : 0)),
            );
            const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(16));
            geometries.add(geometry);
            scene.add(new THREE.Line(geometry, wireMaterial));
          }
        }
      }
      const treePositions = [[-4.1, 2.1], [4.9, -56]];
      const treeCrowns: THREE.Group[] = [];
      treePositions.forEach(([x, z], index) => {
        const tree = new THREE.Group();
        tree.name = `street-tree-${index}`;
        treeCrowns.push(tree);
        tree.position.set(x, 0.03, z);
        scene.add(tree);
        mesh(cylinderGeometry, mortar, tree, [0, 0.1, 0], [0.34, 0.2, 0.34]);
        mesh(cylinderGeometry, timber, tree, [0, 0.85, 0], [0.07, 1.65, 0.07]);
        for (const side of [-1, 1]) {
          const branch = mesh(cylinderGeometry, timber, tree, [side * 0.14, 1.55, 0], [0.035, 0.6, 0.035]);
          branch.rotation.z = -side * 0.5;
          mesh(foliageGeometry, leaves, tree, [side * 0.26, 2.02, side * 0.1], [0.46, 0.57, 0.42]);
        }
        mesh(foliageGeometry, leaves, tree, [0, 2.3, 0], [0.48, 0.55, 0.46]);
      });
      const leafShape = new THREE.Shape();
      leafShape.moveTo(0, -1);
      leafShape.bezierCurveTo(-0.8, -0.5, -0.7, 0.4, 0, 1);
      leafShape.bezierCurveTo(0.7, 0.4, 0.8, -0.5, 0, -1);
      const leafGeometry = new THREE.ShapeGeometry(leafShape, 6);
      geometries.add(leafGeometry);
      const leafMaterials = [palette.green, palette.greenMid, palette.lime].map(color => {
        const finish = material(color, 0.9);
        finish.side = THREE.DoubleSide;
        return finish;
      });
      scene.traverse(object => {
        if (object instanceof THREE.Mesh && object.parent?.name.startsWith('street-tree-') && object.geometry === foliageGeometry) object.material = leafMaterials[object.parent.name.endsWith('0') ? 0 : 1];
      });
      const fallingLeaves = Array.from({ length: 8 }, (_, index) => {
        const leaf = mesh(leafGeometry, leafMaterials[index % 3], scene, [0, 0, 0], [0.045, 0.075, 1]);
        leaf.name = `falling-leaf-${index}`;
        leaf.castShadow = false;
        return leaf;
      });
      const lightMaterial = material(palette.greenMid);
      lightMaterial.emissive.set(palette.greenMid);
      lightMaterial.emissiveIntensity = 0.65;
      for (const x of [-1.22, 1.22]) {
        box(iron, [x, 2.43, 2.18], [0.15, 0.3, 0.22]);
        box(lightMaterial, [x, 2.43, 2.3], [0.08, 0.21, 0.02]);
      }
      const headGeometry = new THREE.SphereGeometry(0.13, 16, 12);
      const limbGeometry = new THREE.CapsuleGeometry(1, 2, 4, 8);
      geometries.add(headGeometry);
      geometries.add(limbGeometry);
      const skin = material(sceneColors.skin);
      const hair = material(sceneColors.hair);
      const trousers = material(sceneColors.trousers);
      const shoe = material(sceneColors.shoe);
      const clothingPool = new Map<string, THREE.MeshStandardMaterial>();
      const skinPool = [skin, material(new THREE.Color(sceneColors.skin).multiplyScalar(0.77).getStyle()), material(new THREE.Color(sceneColors.skin).lerp(new THREE.Color(palette.cream), 0.25).getStyle())];
      const hairPool = [hair, material(sceneColors.timber), material(sceneColors.mortar)];
      const trouserPool = [trousers, material(sceneColors.iron), material(sceneColors.timber), material(palette.purpleMid)];
      const accessoryPool = [material(palette.greenMid), material(palette.amber), material(palette.purpleMid)];
      const person = (color: string, appearance?: PedestrianAppearance) => {
        const body = new THREE.Group();
        scene.add(body);
        let clothing = clothingPool.get(color);
        if (!clothing) {
          clothing = material(color);
          clothingPool.set(color, clothing);
        }
        const complexion = appearance ? skinPool[appearance.skin] : skin;
        const hairstyle = appearance ? hairPool[appearance.hair] : hair;
        if (appearance) body.scale.set(appearance.scale * appearance.width, appearance.scale, appearance.scale);
        const older = appearance?.kind === 'older';
        const child = appearance?.kind === 'child';
        const headScale = appearance?.headScale ?? 1;
        mesh(roundedGeometry, clothing, body, [0, older ? 1.03 : 1.07, 0], [0.19, older ? 0.34 : 0.29, child ? 0.145 : 0.13]).name = 'person-garment';
        mesh(limbGeometry, complexion, body, [0, 1.37, 0], [0.055, 0.04, 0.055]);
        mesh(headGeometry, complexion, body, [0, 1.48, older ? 0.025 : 0], [headScale, child ? 1.36 : 1.2, headScale]).name = 'person-head';
        if (appearance?.hairStyle !== 3) mesh(headGeometry, hairstyle, body, [0, 1.56, -0.025], [headScale * 1.04, appearance?.hairStyle === 2 ? 0.95 : 0.65, headScale * 1.02]);
        if (appearance?.hairStyle === 1) mesh(roundedGeometry, hairstyle, body, [0, 1.4, -0.095], [0.13, 0.19, 0.06]);
        if (appearance?.hairStyle === 2) mesh(headGeometry, hairstyle, body, [0, 1.57, -0.14], [0.55, 0.7, 0.6]);
        if (appearance) {
          const trim = accessoryPool[appearance.outfit % accessoryPool.length];
          if (appearance.accessory === 0) {
            mesh(roundedGeometry, trim, body, [0, 1.1, -0.17], [0.13, 0.19, 0.085]).name = 'person-backpack';
            for (const side of [-1, 1]) box(trim, [side * 0.115, 1.16, 0.125], [0.025, 0.32, 0.025], body);
          } else if (appearance.accessory === 1) {
            mesh(cylinderGeometry, trim, body, [0, 1.65, 0], [0.135, 0.08, 0.135]).name = 'person-hat';
            mesh(cylinderGeometry, trim, body, [0, 1.61, 0.025], [0.18, 0.018, 0.18]);
          } else if (appearance.accessory === 2) {
            mesh(roundedGeometry, trim, body, [0.23, 0.79, 0], [0.06, 0.15, 0.115]).name = 'person-bag';
            box(trim, [0.19, 1.02, 0], [0.023, 0.35, 0.023], body);
          } else if (appearance.accessory === 3) {
            box(trim, [0, 1.28, 0.13], [0.27, 0.055, 0.035], body).name = 'person-scarf';
            box(trim, [-0.075, 1.14, 0.145], [0.06, 0.26, 0.025], body);
          }
        }
        const legs: THREE.Group[] = [];
        const arms: THREE.Group[] = [];
        for (const side of [-1, 1]) {
          const leg = new THREE.Group();
          leg.position.set(side * 0.095, 0.84, 0);
          body.add(leg);
          mesh(limbGeometry, appearance ? trouserPool[appearance.trousers] : trousers, leg, [0, -0.35, 0], [0.075, 0.175, 0.08]).name = 'person-leg';
          mesh(roundedGeometry, shoe, leg, [0, -0.735, 0.04], [0.08, 0.055, 0.145]);
          legs.push(leg);
          const arm = new THREE.Group();
          arm.position.set(side * 0.23, 1.27, 0);
          body.add(arm);
          mesh(limbGeometry, clothing, arm, [0, -0.15, 0], [0.065, 0.075, 0.07]).name = 'person-sleeve';
          mesh(limbGeometry, complexion, arm, [0, -0.39, 0.025], [0.046, 0.065, 0.05]).name = 'person-forearm';
          mesh(roundedGeometry, complexion, arm, [0, -0.53, 0.03], [0.052, 0.07, 0.045]);
          arms.push(arm);
        }
        return { body, legs, arms };
      };
      for (let index = 0; index < 2; index++) {
        const bike = new THREE.Group();
        bike.name = `traffic-motorcycle-${index}`;
        scene.add(bike);
        box(doorPaint, [0, 0.46, 0], [0.3, 0.27, 0.95], bike);
        box(iron, [0, 0.67, -0.12], [0.34, 0.1, 0.6], bike);
        box(brass, [0, 0.91, 0.42], [0.62, 0.055, 0.055], bike);
        box(bone, [0, 0.71, 0.6], [0.22, 0.2, 0.045], bike);
        const wheels: THREE.Mesh[] = [];
        for (const z of [-0.55, 0.55]) {
          const wheel = mesh(cylinderGeometry, iron, bike, [0, 0.23, z], [0.28, 0.13, 0.28]);
          wheel.rotation.z = Math.PI / 2;
          wheels.push(wheel);
          box(brass, [0, 0.45, z], [0.065, 0.45, 0.065], bike);
        }
        const rider = person(index ? palette.purpleMid : palette.greenMid);
        bike.add(rider.body);
        rider.body.position.set(0, 0.1, -0.12);
        rider.body.scale.setScalar(0.8);
        rider.legs.forEach(leg => { leg.rotation.x = -0.9; });
        rider.arms.forEach(arm => { arm.rotation.x = -0.9; });
        mesh(headGeometry, iron, rider.body, [0, 1.57, 0], [1.12, 0.85, 1.12]);
        const pose = trafficPose(trafficState.vehicles[traffic.length]);
        bike.position.set(pose.x, -0.08, pose.z);
        bike.rotation.y = pose.heading;
        traffic.push(bike);
        vehicleWheels.push(wheels);
      }
      for (const [name, x, z, rotation] of [['doorway', -4.35, -0.93, 0], ['booking', -10.4, -2.6, 0]] as const) {
        const cashier = person(palette.cream);
        cashier.body.name = `cashier-${name}`;
        cashier.body.position.set(x, 0.1, z);
        cashier.body.scale.setScalar(1.12);
        cashier.body.rotation.y = rotation;
        box(accent, [0, 1.05, 0.13], [0.29, 0.4, 0.025], cashier.body).name = 'cashier-apron';
        box(brass, [0.09, 1.26, 0.13], [0.08, 0.055, 0.02], cashier.body);
        cashier.arms.forEach(arm => { arm.rotation.x = -1.15; });
      }
      const kitchen = new THREE.Group();
      kitchen.name = 'interior-open-kitchen';
      kitchen.position.set(0, 0.1, -9.3);
      scene.add(kitchen);
      box(iron, [0, 0.47, 0], [1.65, 0.94, 0.9], kitchen).name = 'kitchen-stove';
      box(brass, [0, 0.96, 0], [1.75, 0.09, 1], kitchen);
      for (const x of [-0.55, 0, 0.55]) mesh(cylinderGeometry, iron, kitchen, [x, 0.8, 0.48], [0.07, 0.04, 0.07]).rotation.x = Math.PI / 2;
      box(bone, [1.25, 0.94, 0], [0.65, 0.1, 0.95], kitchen).name = 'kitchen-prep-surface';
      box(timber, [1.25, 0.44, 0], [0.6, 0.88, 0.85], kitchen);
      mesh(cylinderGeometry, iron, kitchen, [0, 1.04, 0], [0.34, 0.06, 0.34]).name = 'kitchen-burner';
      const flameMaterial = material(palette.amber, 0.5);
      flameMaterial.emissive.set(palette.amber);
      flameMaterial.emissiveIntensity = 2.4;
      const flames = Array.from({ length: 7 }, (_, index) => {
        const angle = index / 7 * Math.PI * 2;
        const flame = mesh(roundedGeometry, flameMaterial, kitchen, [Math.cos(angle) * 0.25, 1.15, Math.sin(angle) * 0.25], [0.06, 0.15, 0.06]);
        flame.name = `kitchen-flame-${index}`;
        flame.castShadow = false;
        return flame;
      });
      const stoveGlow = new THREE.PointLight(palette.amber, 3, 3);
      stoveGlow.name = 'kitchen-stove-glow';
      stoveGlow.position.set(0, 1.45, 0.1);
      kitchen.add(stoveGlow);
      const pan = new THREE.Group();
      pan.name = 'kitchen-pan';
      pan.position.set(0, 1.31, 0);
      kitchen.add(pan);
      mesh(cylinderGeometry, iron, pan, [0, 0, 0], [0.37, 0.08, 0.37]);
      box(timber, [0, 0, -0.56], [0.095, 0.08, 0.5], pan).name = 'kitchen-pan-handle';
      const cookingSteak = mesh(roundedGeometry, steak, pan, [0, 0.065, 0], [0.23, 0.055, 0.17]);
      cookingSteak.name = 'kitchen-steak';
      for (let i = 0; i < 4; i++) box(char, [-0.13 + i * 0.085, 0.114, 0], [0.015, 0.006, 0.22], pan);
      steamMaterials.forEach((finish, index) => {
        const smoke = new THREE.Sprite(finish);
        smoke.name = `kitchen-smoke-${index}`;
        pan.add(smoke);
        steamWisps.push(smoke);
      });
      const chef = person(palette.cream);
      chef.body.name = 'cashier-chef';
      chef.body.position.set(0, 0.1, -10.05);
      chef.body.scale.setScalar(1.1);
      box(accent, [0, 0.99, 0.135], [0.29, 0.5, 0.025], chef.body).name = 'chef-apron';
      mesh(cylinderGeometry, bone, chef.body, [0, 1.66, 0], [0.135, 0.14, 0.135]).name = 'chef-hat';
      mesh(roundedGeometry, bone, chef.body, [0, 1.77, 0], [0.18, 0.11, 0.15]);
      chef.arms[0].name = 'chef-cooking-arm';
      box(brass, [0, -0.64, 0.03], [0.035, 0.3, 0.035], chef.arms[0]).name = 'chef-spatula';
      const residentSeed = crypto.getRandomValues(new Uint32Array(1))[0];
      const pedestrianAgents = createPedestrianAgents(quality > 0 ? pedestrianLimits.desktop : pedestrianLimits.economy, residentSeed);
      container.dataset.pedestrianSeed = String(residentSeed);
      container.dataset.pedestrianCount = String(pedestrianAgents.length);
      const outfits = [palette.paper, palette.greenMid, palette.purpleMid, palette.cream, sceneColors.timber, sceneColors.trousers];
      const residents = pedestrianAgents.map((agent, index) => {
        const resident = person(outfits[agent.appearance.outfit], agent.appearance);
        resident.body.name = `pedestrian-${index}-${agent.appearance.kind}`;
        resident.body.position.set(agent.x, agent.ground, agent.z);
        resident.body.rotation.y = agent.heading;
        return { ...resident, agent };
      });
      const pedestrianFrustum = new THREE.Frustum();
      const pedestrianProjection = new THREE.Matrix4();
      const pedestrianSphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
      const dog = new THREE.Group();
      dog.name = 'walking-dog';
      scene.add(dog);
      const fur = material(sceneColors.fur, 0.92);
      mesh(roundedGeometry, fur, dog, [0, 0.42, 0], [0.15, 0.18, 0.31]);
      mesh(roundedGeometry, fur, dog, [0, 0.6, 0.27], [0.125, 0.15, 0.14]);
      mesh(roundedGeometry, fur, dog, [0, 0.55, 0.4], [0.085, 0.065, 0.1]);
      mesh(roundedGeometry, iron, dog, [0, 0.565, 0.485], [0.044, 0.03, 0.018]);
      for (const side of [-1, 1]) {
        mesh(roundedGeometry, timber, dog, [side * 0.12, 0.59, 0.24], [0.047, 0.14, 0.075]);
        mesh(roundedGeometry, iron, dog, [side * 0.082, 0.64, 0.373], [0.016, 0.017, 0.012]);
      }
      const dogLegs: THREE.Group[] = [];
      for (const side of [-1, 1]) for (const end of [-1, 1]) {
        const leg = new THREE.Group();
        leg.name = `dog-leg-${dogLegs.length}`;
        leg.position.set(side * 0.105, 0.39, end * 0.2);
        dog.add(leg);
        mesh(limbGeometry, fur, leg, [0, -0.14, 0], [0.045, 0.08, 0.045]);
        mesh(roundedGeometry, fur, leg, [0, -0.3, 0.035], [0.055, 0.035, 0.085]);
        dogLegs.push(leg);
      }
      const dogTail = new THREE.Group();
      dogTail.name = 'dog-tail';
      dogTail.position.set(0, 0.47, -0.27);
      dog.add(dogTail);
      const tail = mesh(limbGeometry, fur, dogTail, [0, 0.09, -0.12], [0.037, 0.085, 0.037]);
      tail.rotation.x = -0.7;
      const collar = mesh(cylinderGeometry, accent, dog, [0, 0.53, 0.22], [0.12, 0.055, 0.12]);
      collar.name = 'dog-collar';
      const leashGeometry = new THREE.BufferGeometry();
      const leashPoints = new THREE.BufferAttribute(new Float32Array(9), 3);
      leashGeometry.setAttribute('position', leashPoints);
      geometries.add(leashGeometry);
      const leashMaterial = new THREE.LineBasicMaterial({ color: sceneColors.leash });
      materials.add(leashMaterial);
      const leash = new THREE.Line(leashGeometry, leashMaterial);
      leash.name = 'dog-leash';
      leash.frustumCulled = false;
      scene.add(leash);
      const leashHand = new THREE.Vector3();
      const leashCollar = new THREE.Vector3();
      const greeter = person(palette.cream);
      greeter.body.name = 'welcome-host';
      greeter.body.position.set(-2.15, 0.1, 3.15);
      const receptionist = person(palette.greenMid);
      receptionist.body.name = 'welcome-receptionist';
      receptionist.body.position.set(2.15, 0.1, 3.15);
      box(bone, [0.075, 1.2, 0.13], [0.09, 0.055, 0.015], receptionist.body).name = 'receptionist-name-badge';
      box(wall, [0, 0.93, 0.125], [0.27, 0.51, 0.025], greeter.body);
      const welcome = new THREE.Group();
      welcome.name = 'welcome-board';
      welcome.scale.setScalar(0.7);
      greeter.body.add(welcome);
      box(timber, [0, -0.22, -0.03], [0.04, 0.55, 0.045], welcome);
      box(wall, [0, 0, 0], [1.16, 0.36, 0.06], welcome);
      const welcomeFace = new THREE.Mesh(signGeometry, welcomeMaterial);
      welcomeFace.name = 'welcome-board-face';
      welcomeFace.scale.setScalar(0.25);
      welcomeFace.position.z = 0.04;
      welcome.add(welcomeFace);
      const badgeGeometry = new THREE.PlaneGeometry(1, 1);
      geometries.add(badgeGeometry);
      const badgeMaterial = new THREE.MeshBasicMaterial({ color: sceneColors.white, toneMapped: false });
      materials.add(badgeMaterial);
      badgeMaterial.name = 'brand-profile-enamel';
      const badges: THREE.Mesh[] = [];
      for (const [parent, x, y, z, size, name] of [[welcome, 0, -0.42, 0.045, 0.24, 'brand-badge-host']] as const) {
        box(signMetal, [x, y, z - 0.035], [size + 0.06, size + 0.06, 0.06], parent);
        const badge = new THREE.Mesh(badgeGeometry, badgeMaterial);
        badge.name = name;
        badge.position.set(x, y, z);
        badge.scale.set(size, size, 1);
        badge.visible = false;
        parent.add(badge);
        badges.push(badge);
      }
      const paintSign = () => {
        signContext.fillStyle = palette.purple;
        signContext.fillRect(0, 0, 1536, 384);
        signContext.strokeStyle = palette.lime;
        signContext.lineWidth = 8;
        signContext.strokeRect(16, 16, 1504, 352);
        signContext.fillStyle = palette.lime;
        signContext.textAlign = 'center';
        signContext.textBaseline = 'middle';
        signContext.font = '500 132px "Be Vietnam Pro", sans-serif';
        signContext.fillText('Ngọc Hiếu kính chào', 768, 190, 1430);
        signTexture.needsUpdate = true;
      };
      paintSign();
      letterContext.fillStyle = palette.purple;
      letterContext.fillRect(0, 0, 512, 512);
      letterTexture.needsUpdate = true;
      const finaleMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      materials.add(finaleMaterial);
      const finaleLogo = new THREE.Mesh(badgeGeometry, finaleMaterial);
      finaleLogo.name = 'journey-finale-logo';
      finaleLogo.position.set(-8.3, 1.8, -11.76);
      finaleLogo.visible = false;
      scene.add(finaleLogo);
      const wordmark = document.createElement('canvas');
      wordmark.width = 384;
      wordmark.height = 96;
      const wordmarkContext = wordmark.getContext('2d');
      const particleTargets: number[] = [];
      if (wordmarkContext) {
        wordmarkContext.fillStyle = 'white';
        wordmarkContext.font = 'bold 52px sans-serif';
        wordmarkContext.textAlign = 'center';
        wordmarkContext.fillText('NGỌC HIẾU', 192, 65);
        const data = wordmarkContext.getImageData(0, 0, 384, 96).data;
        for (let y = 0; y < 96; y += 4) for (let x = 0; x < 384; x += 4) {
          if (data[(y * 384 + x) * 4 + 3] > 128) particleTargets.push(-8.3 + (x - 192) / 150, 2.6 - y / 150, -11.5);
        }
      }
      const particleGeometry = new THREE.BufferGeometry();
      const particlePositions = new Float32Array(particleTargets.length);
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
      geometries.add(particleGeometry);
      const particleMaterial = new THREE.PointsMaterial({ color: palette.amber, size: 0.015, transparent: true, opacity: 0.65, depthWrite: false });
      materials.add(particleMaterial);
      const finaleParticles = new THREE.Points(particleGeometry, particleMaterial);
      finaleParticles.name = 'finale-wordmark-particles';
      finaleParticles.frustumCulled = false;
      scene.add(finaleParticles);
      for (const [index, path, ratio] of [[0, '/images/ngoc-hieu-social-official-atmosphere-family.jpg', 700 / 770], [1, '/images/official-hang-cot-reference.jpg', 700 / 935]] as const) {
        const photoMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7 });
        materials.add(photoMaterial);
        const picture = new THREE.Mesh(badgeGeometry, photoMaterial);
        picture.name = `interior-official-photo-${index}`;
        picture.position.set(-12.36, 2.98, -5.4 - index * 2.1);
        picture.rotation.y = Math.PI / 2;
        picture.scale.set(ratio * 1.15, 1.15, 1);
        picture.visible = false;
        scene.add(picture);
        box(brass, [-12.4, picture.position.y, picture.position.z], [0.06, 1.27, ratio * 1.15 + 0.12]);
        const photo = new THREE.TextureLoader().load(path, loaded => {
          if (disposed) { loaded.dispose(); return; }
          loaded.colorSpace = THREE.SRGBColorSpace;
          photoMaterial.map = loaded;
          photoMaterial.needsUpdate = true;
          picture.visible = true;
          render();
        }, undefined, () => {});
        textures.add(photo);
      }
      const menuBook = new THREE.Group();
      menuBook.name = 'journey-menu-book';
      menuBook.position.set(-10.1, 1.02, -7.1);
      scene.add(menuBook);
      box(signMetal, [0, 0, 0], [0.72, 0.055, 0.52], menuBook);
      for (const side of [-1, 1]) {
        const page = box(bone, [side * 0.17, 0.042, 0], [0.33, 0.035, 0.48], menuBook);
        page.rotation.z = side * 0.08;
        for (let line = 0; line < 5; line++) box(brass, [side * 0.17, 0.065, -0.15 + line * 0.06], [0.23, 0.004, 0.008], menuBook);
      }
      const stages = [
        { name: 'outside', at: 0, position: new THREE.Vector3(-14, 12, 10), look: new THREE.Vector3(-4.5, 2, -3), caption: 'Từ một lời hẹn, đến một bàn ăn.' },
        { name: 'doorway', at: 0.2, position: new THREE.Vector3(0, 2.15, 4.5), look: new THREE.Vector3(0, 1.65, -3), caption: 'Cửa đã mở. Mời bạn ghé vào.' },
        { name: 'signature', at: 0.36, position: new THREE.Vector3(0.1, 1.9, -6.2), look: new THREE.Vector3(0, 1.55, -9.65), caption: 'Chảo nóng, làn khói nhẹ và một bữa ngon.' },
        { name: 'feedback', at: 0.54, position: new THREE.Vector3(-7.1, 1.75, -4.8), look: new THREE.Vector3(-12.36, 2.98, -6.45), caption: 'Những khoảnh khắc tại Ngọc Hiếu.' },
        { name: 'menu', at: 0.7, position: new THREE.Vector3(-9.15, 1.85, -6), look: new THREE.Vector3(-10.1, 1.05, -7.1), caption: 'Mở thực đơn, chọn một bữa ngon.' },
        { name: 'booking', at: 0.79, position: new THREE.Vector3(-8.1, 1.8, 0.2), look: new THREE.Vector3(-10.4, 1.55, -2.6), caption: 'Dành một bàn cho cuộc hẹn của bạn.' },
        { name: 'finale', at: 1, position: new THREE.Vector3(-8.3, 1.8, -9.2), look: new THREE.Vector3(-8.3, 1.8, -11.76), caption: 'Ngọc Hiếu · Hẹn nhau một bữa ngon.' },
      ];
      let ao: SSAOPass | undefined;
      let dof: BokehPass | undefined;
      let bloom: UnrealBloomPass | undefined;
      let grade: ShaderPass | undefined;
      if (quality) {
      composer = new EffectComposer(gl);
      const renderPass = new RenderPass(scene, camera);
      ao = new SSAOPass(scene, camera, 1, 1, 16);
      ao.kernelRadius = 6;
      ao.minDistance = 0.002;
      ao.maxDistance = 0.06;
      ao.copyMaterial.blendDst = THREE.OneMinusSrcAlphaFactor;
      ao.copyMaterial.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      ao.copyMaterial.uniforms.opacity.value = 0;
      if (import.meta.env.DEV) console.assert(aoIntensity(0.24) === 0 && aoIntensity(0.88) === 0 && aoIntensity(0.5) === sceneLighting.ao && aoIntensity(0.2401) < 0.00001, 'Interior AO must fade continuously from identity with bounded attenuation');
      dof = new BokehPass(scene, camera, { focus: 6, aperture: 0.000035, maxblur: 0.003 });
      bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.35, 1.6);
      grade = new ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
          strength: { value: 0.025 },
          vignetteStrength: { value: sceneLighting.vignette },
          purple: { value: new THREE.Color(palette.purpleMid) },
          green: { value: new THREE.Color(palette.greenMid) },
        },
        vertexShader: `varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `uniform sampler2D tDiffuse;
          uniform float strength;
          uniform float vignetteStrength;
          uniform vec3 purple;
          uniform vec3 green;
          varying vec2 vUv;
          void main() {
            vec4 source = texture2D(tDiffuse, vUv);
            vec3 rgb = source.rgb;
            float hi = max(max(rgb.r, rgb.g), rgb.b);
            float lo = min(min(rgb.r, rgb.g), rgb.b);
            float chroma = hi - lo;
            float saturation = chroma / max(hi, 0.0001);
            float hue = 0.0;
            if (chroma > 0.0001) {
              if (hi == rgb.r) hue = mod((rgb.g - rgb.b) / chroma, 6.0);
              else if (hi == rgb.g) hue = (rgb.b - rgb.r) / chroma + 2.0;
              else hue = (rgb.r - rgb.g) / chroma + 4.0;
              hue = fract(hue / 6.0 + 1.0);
            }
            float greenMask = smoothstep(0.29, 0.34, hue) * (1.0 - smoothstep(0.43, 0.48, hue));
            float purpleMask = smoothstep(0.67, 0.72, hue) * (1.0 - smoothstep(0.85, 0.9, hue));
            float mask = smoothstep(0.25, 0.55, saturation);
            float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
            vec3 tint = green * greenMask + purple * purpleMask;
            float tintLuma = max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 0.0001);
            vec3 graded = mix(rgb, tint * luma / tintLuma, strength * mask * (greenMask + purpleMask));
            float vignette = 1.0 - smoothstep(0.22, 0.76, length(vUv - 0.5)) * vignetteStrength;
            float grain = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
            gl_FragColor = vec4(graded * vignette + grain, source.a);
          }`,
      });
      const output = new OutputPass();
      for (const pass of [renderPass, ao, dof, bloom, grade, output]) {
        passes.push(pass);
        composer.addPass(pass);
      }
      }
      passes.push({ dispose: () => key.shadow.dispose() });
      const naturalMaterials = [skin, steak, char, eggWhite, yolk, garnish];
      const naturalColors = naturalMaterials.map(finish => finish.color.clone());
      let dark = themeRef.current === 'dark';
      let ledBase = 0.2;
      let spillBase = 0.5;
      const updateTheme = (mode: ThemeMode) => {
        dark = mode === 'dark';
        scene.background = new THREE.Color(dark ? palette.ink : palette.cream);
        distanceFog.color.copy(scene.background);
        scene.fog = distanceFog;
        const lighting = sceneLighting[mode];
        hemisphere.intensity = lighting.hemisphere;
        hemisphere.color.set(sceneColors.white);
        hemisphere.groundColor.set(dark ? palette.ink : palette.paper);
        key.intensity = dark ? 0.85 : 2.6;
        fill.intensity = lighting.fill;
        scene.environmentIntensity = lighting.environment;
        gl.toneMappingExposure = lighting.exposure;
        container.dataset.lighting = `${mode}-balanced-interior`;
        container.dataset.exposure = String(lighting.exposure);
        wall.color.copy(tint(palette.purpleMid, dark ? 0.24 : 0.62));
        leftPlaster.color.copy(tint(palette.greenMid, dark ? 0.28 : 0.68));
        bone.color.set(dark ? palette.paper : palette.cream);
        accent.color.set(dark ? palette.green : palette.greenMid);
        doorPaint.color.set(dark ? palette.purple : palette.purpleMid);
        houseColors.forEach((finish, index) => finish.color.copy(tint(housePalette[index], dark ? 0.06 : 0.35)));
        interiorLights.forEach((light, index) => {
          light.intensity = index ? lighting.interior : lighting.entrance;
          light.color.set(palette.cream).lerp(new THREE.Color(palette.amber), dark ? 0.35 : 1);
        });
        glass.emissive.set(palette.amber);
        glass.emissiveIntensity = dark ? 1.8 : 0.05;
        glass.opacity = dark ? 0.3 : 0.12;
        streetWindow.color.set(dark ? palette.amber : sceneColors.window);
        streetWindow.emissive.set(palette.amber);
        streetWindow.emissiveIntensity = dark ? 2 : 0;
        lightMaterial.emissiveIntensity = dark ? 3.2 : 0.15;
        tickerMaterial.emissiveIntensity = dark ? 1.8 : 0.12;
        advertisementMaterial.emissiveIntensity = dark ? 0.7 : 0.08;
        advertisementLight.emissiveIntensity = dark ? 2.4 : 0.15;
        ledBase = dark ? 1.9 : 0.2;
        spillBase = dark ? 0.65 : 0.35;
        if (bloom) bloom.enabled = dark;
        if (grade) grade.uniforms.strength.value = dark ? 0.045 : 0.02;
        container.dataset.theme = mode;
        if (import.meta.env.DEV) console.assert(naturalMaterials.every((finish, index) => finish.color.equals(naturalColors[index]) && finish.emissiveIntensity === 1 && finish.emissive.getHex() === 0), 'Theme changes must preserve natural skin and food materials without emissive bloom');
      };
      updateTheme(themeRef.current);
      const target = new THREE.Vector3();
      const cameraKnots = [
        stages[0],
        { at: 0.055, position: new THREE.Vector3(-6, 6.5, 10), look: new THREE.Vector3(-3.5, 2, -2) },
        { at: 0.11, position: new THREE.Vector3(8, 5.5, 10), look: new THREE.Vector3(0, 1.9, -3) },
        { at: 0.155, position: new THREE.Vector3(6, 3.4, 8), look: new THREE.Vector3(0, 1.7, 2) },
        stages[1],
        { at: 0.24, position: new THREE.Vector3(0, 1.8, 3.2), look: new THREE.Vector3(0, 1.7, -1) },
        { at: 0.28, position: new THREE.Vector3(0, 1.8, 0.5), look: new THREE.Vector3(-4.35, 1.65, -0.93) },
        { at: 0.31, position: new THREE.Vector3(0, 1.8, -2.2), look: new THREE.Vector3(0, 1.55, -9.65) },
        stages[2],
        { at: 0.42, position: new THREE.Vector3(0, 1.8, -4.8), look: new THREE.Vector3(-5.5, 1.6, -4.8) },
        { at: 0.47, position: new THREE.Vector3(-4.5, 1.8, -4.8), look: new THREE.Vector3(-8.5, 1.6, -4.8) },
        { at: 0.5, position: new THREE.Vector3(-6.2, 1.8, -4.8), look: new THREE.Vector3(-10, 1.7, -4.8) },
        ...stages.slice(3),
      ];
      const cameraCurve = new THREE.CatmullRomCurve3(cameraKnots.map(knot => knot.position), false, 'catmullrom', 0.12);
      const lookCurve = new THREE.CatmullRomCurve3(cameraKnots.map(knot => knot.look), false, 'catmullrom', 0.12);
      if (import.meta.env.DEV) {
      scene.traverse(object => {
        if (object instanceof THREE.Mesh && object.geometry === boxGeometry && !Array.isArray(object.material) && !object.material.transparent && object.scale.y >= 0.4 && (Math.abs(object.position.z - 2) < 0.15 || Math.abs(object.position.x - 3.5) < 0.15 || object.name === 'interior-back-wall') && !structuralWalls.includes(object)) structuralWalls.push(object);
      });
      scene.updateMatrixWorld(true);
      const entranceClearance = new THREE.Box3(new THREE.Vector3(-1.3, 0, 0.5), new THREE.Vector3(1.3, 2.5, 4.8));
      const pocketBounds = new THREE.Box3().setFromObject(cornerPocket);
      console.assert(pocketBounds.min.x > 2.7 && pocketBounds.max.x < 3.9 && pocketBounds.min.z > 2.4 && pocketBounds.max.z < 3.9 && pocketBounds.min.y >= 0.055, 'Corner pocket must stay grounded on existing pavement inside both curbs, clear of road lanes and the side pedestrian path');
      console.assert(!pocketBounds.intersectsBox(entranceClearance), 'Corner pocket must leave the entrance clear');
      const blankWallBounds = new THREE.Box3().setFromObject(rightBlankWall);
      const advertisementBounds = new THREE.Box3().setFromObject(advertisement);
      console.assert(advertisementBounds.min.x >= blankWallBounds.max.x - 0.000001 && advertisementBounds.min.z > blankWallBounds.min.z && advertisementBounds.max.z < blankWallBounds.max.z && advertisementBounds.min.y > blankWallBounds.min.y && advertisementBounds.max.y < blankWallBounds.max.y, 'Right wall advertisement must sit on the exterior blank wall without covering side windows');
      const advertisementNormal = new THREE.Vector3(0, 0, 1).transformDirection(advertisement.matrixWorld);
      console.assert(advertisementNormal.dot(cameraKnots[2].position.clone().sub(advertisement.getWorldPosition(new THREE.Vector3()))) > 0, 'Right wall advertisement must face the right-hand facade sweep');
      for (const staff of [greeter, receptionist]) {
        if (import.meta.env.DEV) console.assert(!new THREE.Box3().setFromObject(staff.body).intersectsBox(entranceClearance), `${staff.body.name} must leave the entrance clear`);
      }
      const sightline = new THREE.Raycaster();
      const sightlineBlockers: THREE.Mesh[] = [];
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          const finishes = Array.isArray(object.material) ? object.material : [object.material];
          if (finishes.some(finish => !finish.transparent)) sightlineBlockers.push(object);
        }
      });
      for (const [stage, name] of [[stages[1], 'cashier-doorway'], [stages[2], 'cashier-chef'], [stages[5], 'cashier-booking']] as const) {
        const staff = scene.getObjectByName(name)!;
        const head = staff.getObjectByName('person-head')!;
        const focus = head.getWorldPosition(new THREE.Vector3());
        const direction = focus.clone().sub(stage.position);
        sightline.set(stage.position, direction.clone().normalize());
        sightline.far = direction.length() - 0.2;
        const blocked = sightline.intersectObjects(sightlineBlockers, false).length > 0;
        if (import.meta.env.DEV) console.assert(!blocked, `${name} head sightline must clear opaque scene geometry`);
      }
      const buildingBodies = [...structuralWalls];
      scene.traverse(object => {
        if (object instanceof THREE.LOD) object.traverse(child => {
          if (child instanceof THREE.Mesh) buildingBodies.push(child);
        });
      });
      const buildingBounds = buildingBodies.map(object => ({ name: object.name || object.parent?.name || object.parent?.parent?.name || 'restaurant-wall', bounds: new THREE.Box3().setFromObject(object) }));
      const detailBounds = streetDetails.flatMap(detail => detail.positions.map((position, index) => new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...position), new THREE.Vector3(...detail.scales[index]))));
      for (const journey of ['outside', 'signature', 'menu']) {
        for (const aspect of [390 / 844, 390 / 420, 844 / 390]) {
          const shot = mobileCamera(journey, aspect);
          const point = new THREE.Vector3(...shot.position);
          const collision = buildingBounds.find(({ bounds }) => bounds.distanceToPoint(point) < 0.18);
          console.assert(!collision, `[mobile-camera-building-clearance] ${journey}: ${collision?.name} intersects the 0.18m camera envelope`);
          console.assert(detailBounds.every(bounds => bounds.distanceToPoint(point) >= 0.18), `[mobile-camera-detail-clearance] ${journey} must clear street trim`);
          console.assert(journey === 'outside' || point.y <= 2.5, '[mobile-camera-ceiling-clearance] Interior shots must remain below ceiling height');
        }
      }
      const sample = new THREE.Vector3();
      const frontageFocus = new THREE.Vector3(0, 1.65, 2.6);
      const frontageRay = new THREE.Ray();
      const frontageHit = new THREE.Vector3();
      for (const aspect of [1440 / 900, 390 / 844, 2560 / 1080]) {
        for (let segment = 0; segment < cameraKnots.length - 1; segment++) {
          for (let step = 0; step <= 100; step++) {
            const blend = step / 100;
            cameraCurve.getPoint((segment + blend) / (cameraKnots.length - 1), sample);
            if (segment === 0) sample.y += stages[0].position.y * (Math.max(1, 0.95 / aspect) - 1) * (1 - blend);
            const collision = buildingBounds.find(({ bounds }) => bounds.distanceToPoint(sample) < 0.18);
            if (import.meta.env.DEV) console.assert(!collision, `[camera-building-clearance] ${collision?.name} intersects the 0.18m camera envelope at ${segment}:${step}, aspect ${aspect}`);
            if (import.meta.env.DEV) console.assert(detailBounds.every(bounds => bounds.distanceToPoint(sample) >= 0.18), '[camera-detail-clearance] Street trim must clear the camera near plane');
            if (THREE.MathUtils.lerp(cameraKnots[segment].at, cameraKnots[segment + 1].at, blend) <= 0.2) {
              frontageRay.set(sample, frontageFocus.clone().sub(sample).normalize());
              const obstruction = buildingBounds.find(({ bounds }) => frontageRay.intersectBox(bounds, frontageHit) && frontageHit.distanceTo(sample) < sample.distanceTo(frontageFocus) - 0.1);
              if (import.meta.env.DEV) console.assert(!obstruction, `[camera-frontage-sightline] ${obstruction?.name} blocks the opening frontage at ${segment}:${step}, aspect ${aspect}`);
            }
            if (Math.abs(sample.x + 5.5) < 0.3 && sample.z < 2 && sample.z > -12) console.assert(sample.z > -5.62 && sample.z < -3.98 && sample.y < 2.58, '[camera-connector-clearance] Camera must traverse the physical connector opening');
          }
        }
      }
      }
      scene.updateMatrixWorld(true);
      const animatedRoots = new Set<THREE.Object3D>([...doors, ...traffic, ...treeCrowns, ...residents.map(resident => resident.body), greeter.body, receptionist.body, chef.body, dog, pan]);
      const staticBatches = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>();
      const collectStatic = (object: THREE.Object3D) => {
        if (animatedRoots.has(object) || object instanceof THREE.LOD) return;
        if (object instanceof THREE.Mesh && !(object instanceof THREE.InstancedMesh) && object.geometry === boxGeometry && !object.name && !object.children.length && !Array.isArray(object.material) && !object.material.transparent) {
          const elements = object.matrixWorld.elements;
          const key = `${object.material.id}:${object.castShadow}:${object.receiveShadow}:${Math.floor(elements[12] / 8)}:${Math.floor(elements[14] / 8)}`;
          const group = staticBatches.get(key);
          if (group) group.push(object);
          else staticBatches.set(key, [object]);
        }
        object.children.forEach(collectStatic);
      };
      collectStatic(scene);
      let batchedMeshes = 0;
      for (const objects of staticBatches.values()) {
        if (objects.length < 3) continue;
        const first = objects[0];
        const batch = new THREE.InstancedMesh(boxGeometry, first.material, objects.length);
        batch.name = 'static-architecture-batch';
        batch.castShadow = first.castShadow;
        batch.receiveShadow = first.receiveShadow;
        objects.forEach((object, index) => {
          batch.setMatrixAt(index, object.matrixWorld);
          if (import.meta.env.DEV) {
            batch.getMatrixAt(index, matrix);
            console.assert(matrix.elements.every((value, i) => Math.abs(value - object.matrixWorld.elements[i]) < 0.00001), 'Static instance must preserve its original world transform');
          }
          object.removeFromParent();
        });
        batch.computeBoundingBox();
        batch.computeBoundingSphere();
        instances.add(batch);
        scene.add(batch);
        batchedMeshes += objects.length;
      }
      container.dataset.batchedMeshes = String(batchedMeshes);
      let trafficTime = 0;
      let diagnosticTime = -Infinity;
      let shadowTime = -Infinity;
      let telemetryTime = performance.now();
      let renderedFrames = 0;
      let drawCalls = 0;
      let triangles = 0;
      const render = () => {
        if (disposed || !visible || document.hidden) return;
        const now = performance.now();
        const diagnostics = now - diagnosticTime >= 250;
        if (diagnostics) diagnosticTime = now;
        const trafficDelta = walkingTime - trafficTime;
        trafficTime = walkingTime;
        stepTraffic(trafficState, Math.max(0, trafficDelta));
        trafficSignals.forEach((lights, axis) => {
          const signal = trafficSignal(trafficState, axis ? 'z' : 'x');
          lights.forEach((light, index) => { light.emissiveIntensity = index === (signal === 'green' ? 2 : signal === 'amber' ? 1 : 0) ? 3 : 0.05; });
        });
        traffic.forEach((car, index) => {
          const vehicle = trafficState.vehicles[index];
          const pose = trafficPose(vehicle);
          vehicleWheels[index].forEach(wheel => { wheel.rotation.x = -vehicle.travel / trafficBodies[vehicle.kind].wheelRadius; });
          car.position.set(pose.x, -0.08, pose.z);
          car.rotation.y = pose.heading;
        });
        if (diagnostics) container.dataset.traffic = traffic.map(car => `${car.position.x.toFixed(3)},${car.position.z.toFixed(3)}`).join(';');
        tickerTexture.offset.x = reduced ? 0 : (walkingTime * 0.025) % 1;
        if (import.meta.env.DEV) console.assert(tickerTexture.offset.x >= 0 && tickerTexture.offset.x < 1, 'Ticker UV offset must remain normalized');
        const ledPhase = reduced ? 0 : (walkingTime % 6) / 6;
        const ledPulse = reduced ? 0 : Math.sin(ledPhase * Math.PI * 2);
        ledMaterials.forEach((finish, index) => {
          finish.emissiveIntensity = ledBase + (reduced ? 0 : 0.06 * Math.sin(ledPhase * Math.PI * 2 - index * Math.PI / 2));
        });
        signSpill.intensity = spillBase + ledPulse * 0.04;
        if (import.meta.env.DEV) console.assert(ledMaterials.every(finish => Math.abs(finish.emissiveIntensity - ledBase) <= 0.060001), 'LED output must remain steady within its low-amplitude bounds');
        if (diagnostics) {
          container.dataset.ledPhase = ledPhase.toFixed(4);
          container.dataset.ledIntensity = ledMaterials[0].emissiveIntensity.toFixed(4);
        }
        smoothedProgress = reduced ? progress.value : THREE.MathUtils.damp(smoothedProgress, progress.value, 9, renderDelta);
        const value = THREE.MathUtils.clamp(smoothedProgress, 0, 1);
        const progressText = value.toFixed(4);
        if (chapter.dataset.progress !== progressText) {
          chapter.dataset.progress = progressText;
          chapter.style.setProperty('--story-progress', progressText);
        }
        const mobileShot = mobileSteps ? mobileCamera(chapter.dataset.journey, camera.aspect) : null;
        const stageIndex = mobileShot?.stageIndex ?? Math.min(6, Math.floor(value * 7));
        const stage = stages[stageIndex];
        if (tourMode === 'scroll' && chapter.dataset.journey !== stage.name) {
          chapter.dataset.journey = stage.name;
          chapter.dispatchEvent(new CustomEvent('storychapter', { detail: { index: stageIndex, progress: value } }));
          if (caption) caption.textContent = stage.caption;
        }
        const opening = THREE.MathUtils.smoothstep(value, 0.02, 0.1);
        doors.forEach((door, index) => { door.rotation.y = (index === 0 ? 1 : -1) * opening * Math.PI * 0.55; });
        greeter.body.visible = true;
        welcome.position.set(0, 1.08 + opening * 0.04, 0.54);
        greeter.arms.forEach((arm, index) => {
          arm.rotation.x = -1.3;
          arm.rotation.z = index ? 0.2 : -0.2;
        });
        const waving = stage.name === 'doorway' && visible && !document.hidden && !reduced;
        receptionist.arms[0].rotation.z = -2.45 + (waving ? Math.sin(walkingTime * 2.2) * 0.12 : 0);
        receptionist.arms[0].rotation.x = -0.15;
        if (diagnostics) {
          container.dataset.receptionWave = receptionist.arms[0].rotation.z.toFixed(4);
          container.dataset.hostLift = opening.toFixed(3);
        }
        camera.updateMatrixWorld();
        pedestrianProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        pedestrianFrustum.setFromProjectionMatrix(pedestrianProjection);
        if (!reduced) stepPedestrians(pedestrianAgents, renderDelta);
        residents.forEach((resident, index) => {
          const agent = resident.agent;
          const jogging = agent.appearance.kind === 'jogger';
          resident.body.position.set(agent.x, agent.ground, agent.z);
          resident.body.rotation.y = agent.heading;
          pedestrianSphere.center.set(agent.x, 0.9, agent.z);
          resident.body.visible = (quality > 0 || index < pedestrianLimits.economy) && pedestrianFrustum.intersectsSphere(pedestrianSphere);
          if (!resident.body.visible) return;
          const stride = reduced ? 0 : Math.sin(agent.phase) * (jogging ? 0.42 : 0.34) * agent.moving;
          resident.body.position.y += Math.abs(stride) * (jogging ? 0.09 : 0.045);
          resident.body.rotation.x = jogging ? 0.09 : agent.appearance.kind === 'older' ? 0.045 : 0;
          resident.legs.forEach((leg, side) => { leg.rotation.x = side ? stride : -stride; });
          resident.arms.forEach((arm, side) => {
            arm.rotation.x = (side ? -stride : stride) * 0.8 - (jogging ? 0.65 : 0);
            arm.rotation.z = 0;
          });
        });
        treeCrowns.forEach((tree, index) => { tree.rotation.z = reduced ? 0 : Math.sin(walkingTime * 0.7 + index) * 0.009; });
        fallingLeaves.forEach((leaf, index) => {
          leaf.visible = quality > 0 || index < 3;
          const [x, z] = treePositions[index % treePositions.length];
          const cycle = (walkingTime * 0.085 + index / fallingLeaves.length) % 1;
          leaf.position.set(x + Math.sin(walkingTime * 0.65 + index * 2) * 0.28, 0.09 + (1 - cycle) * 2.25, z + Math.cos(walkingTime * 0.45 + index) * 0.3);
          leaf.rotation.set(index + walkingTime * 0.35, walkingTime * 0.45 + index, Math.sin(walkingTime + index) * 0.4);
        });
        const walker = residents[2];
        dog.position.set(walker.body.position.x, walker.agent.ground, walker.body.position.z + 0.38);
        dog.visible = walker.body.visible;
        leash.visible = walker.body.visible;
        dog.rotation.y = walker.body.rotation.y;
        dogLegs.forEach((leg, index) => { leg.rotation.x = Math.sin(walkingTime * 5.5 + (index === 0 || index === 3 ? 0 : Math.PI)) * 0.28; });
        dogTail.rotation.z = Math.sin(walkingTime * 3) * 0.18;
        dogTail.rotation.y = Math.sin(walkingTime * 3) * 0.16;
        const leashArm = walker.arms[walker.body.rotation.y > 0 ? 0 : 1];
        leashArm.updateWorldMatrix(true, false);
        leashHand.set(0, -0.53, 0.03).applyMatrix4(leashArm.matrixWorld);
        collar.getWorldPosition(leashCollar);
        leashPoints.setXYZ(0, leashHand.x, leashHand.y, leashHand.z);
        leashPoints.setXYZ(1, (leashHand.x + leashCollar.x) / 2, Math.min(leashHand.y, leashCollar.y) - 0.1, (leashHand.z + leashCollar.z) / 2);
        leashPoints.setXYZ(2, leashCollar.x, leashCollar.y, leashCollar.z);
        leashPoints.needsUpdate = true;
        if (import.meta.env.DEV) console.assert(fallingLeaves.length <= 12 && dog.position.z > 2.5 && dog.position.z < 3.8, 'Street motion must remain sparse and inside the sidewalk curb');
        const segment = Math.min(cameraKnots.length - 2, Math.max(0, cameraKnots.findIndex((knot, index) => index > 0 && value <= knot.at) - 1));
        const from = cameraKnots[segment];
        const to = cameraKnots[segment + 1];
        const blend = THREE.MathUtils.clamp((value - from.at) / (to.at - from.at), 0, 1);
        const curveProgress = (segment + blend) / (cameraKnots.length - 1);
        if (mobileShot) {
          camera.position.fromArray(mobileShot.position);
          target.fromArray(mobileShot.look);
          if (camera.fov !== mobileShot.fov) {
            camera.fov = mobileShot.fov;
            camera.updateProjectionMatrix();
          }
        } else {
          cameraCurve.getPoint(curveProgress, camera.position);
          if (segment === 0) camera.position.y += stages[0].position.y * (Math.max(1, 0.95 / camera.aspect) - 1) * (1 - blend);
          lookCurve.getPoint(curveProgress, target);
        }
        camera.lookAt(target);
        const finale = THREE.MathUtils.smoothstep(value, 0.88, 1);
        finaleLogo.visible = Boolean(finaleMaterial.map) && finale > 0;
        finaleMaterial.opacity = finale;
        finaleParticles.visible = finale > 0 && !reduced;
        particleGeometry.setDrawRange(0, Math.floor(particleTargets.length / 3 * (quality ? 1 : 0.35)));
        if (finaleParticles.visible) {
        for (let i = 0; i < particlePositions.length; i += 3) {
          particlePositions[i] = particleTargets[i] + Math.sin(i * 0.7 + walkingTime * 0.1) * (1 - finale) * 4;
          particlePositions[i + 1] = particleTargets[i + 1] + Math.cos(i * 0.3) * (1 - finale) * 2;
          particlePositions[i + 2] = particleTargets[i + 2] + (1 - finale) * (2 + Math.sin(i));
        }
        particleGeometry.attributes.position.needsUpdate = true;
        }
        finaleLogo.scale.setScalar((0.75 + finale * 0.55) * Math.min(1, camera.aspect / 0.95));
        const cookingTime = reduced ? 0 : walkingTime;
        const stir = Math.sin(cookingTime * 2);
        chef.arms[0].rotation.x = -1.32 + stir * 0.12;
        chef.arms[0].rotation.z = -0.22;
        chef.arms[1].rotation.x = -1.48;
        chef.arms[1].rotation.z = 0.35;
        pan.rotation.x = stir * 0.045;
        pan.position.y = 1.31 + Math.max(0, stir) * 0.035;
        cookingSteak.position.y = 0.065 + Math.max(0, stir) * 0.025;
        flames.forEach((flame, index) => {
          flame.visible = quality > 0 || index % 2 === 0;
          flame.scale.y = 0.15 + (reduced ? 0 : Math.sin(cookingTime * 7 + index * 2) * 0.045);
        });
        stoveGlow.intensity = (quality ? 3 : 1.8) + (reduced ? 0 : Math.sin(cookingTime * 7) * 0.2);
        steamWisps.forEach((wisp, index) => {
          wisp.visible = quality > 0 || index % 3 === 1;
          const phase = ((reduced ? 0 : walkingTime) * 0.32 + (index % 3 + 0.5) / 3) % 1;
          wisp.position.set(-0.035 + Math.sin(walkingTime * 0.7 + index) * 0.045, 0.1 + phase * 0.45, Math.cos(walkingTime * 0.5 + index) * 0.025);
          wisp.scale.set(0.1 + phase * 0.16, 0.2 + phase * 0.2, 1);
          wisp.material.opacity = Math.sin(phase * Math.PI) * 0.32;
        });
        const ambientOcclusion = !dark && quality > 0 && ao ? aoIntensity(value) : 0;
        if (ao) {
          ao.enabled = ambientOcclusion > 0;
          ao.copyMaterial.uniforms.opacity.value = ambientOcclusion;
        }
        if (diagnostics) container.dataset.aoIntensity = ambientOcclusion.toFixed(4);
        if (dof) {
          dof.enabled = quality > 0 && (stage.name === 'signature' || stage.name === 'menu' || stage.name === 'finale');
          (dof.uniforms as { focus: { value: number } }).focus.value = camera.position.distanceTo(target);
        }
        if (bloom) bloom.enabled = quality > 0 && dark && (value < 0.24 || stage.name === 'signature' || stage.name === 'finale');
        if (diagnostics) container.dataset.quality = quality ? 'cinematic' : 'economy';
        gl.shadowMap.needsUpdate = gl.shadowMap.enabled && (reduced || now - shadowTime >= 1000 / 15);
        if (gl.shadowMap.needsUpdate) shadowTime = now;
        gl.info.reset();
        if (quality && composer) composer.render();
        else gl.render(scene, camera);
        if (!readyEmitted) {
          readyEmitted = true;
          chapter.dataset.sceneReady = 'true';
          chapter.dispatchEvent(new CustomEvent('sceneready', { bubbles: true }));
        }
        renderedFrames++;
        drawCalls += gl.info.render.calls;
        triangles += gl.info.render.triangles;
        if (now - telemetryTime >= 1000) {
          container.dataset.drawCalls = (drawCalls / renderedFrames).toFixed(1);
          container.dataset.triangles = String(Math.round(triangles / renderedFrames));
          container.dataset.renderedFps = (renderedFrames * 1000 / (now - telemetryTime)).toFixed(1);
          container.dataset.pixelRatio = gl.getPixelRatio().toFixed(2);
          telemetryTime = now;
          renderedFrames = 0;
          drawCalls = 0;
          triangles = 0;
        }
      };
      applyTheme.current = mode => {
        updateTheme(mode);
        render();
      };
      const animate = (now: number) => {
        frame = 0;
        if (disposed || !visible || document.hidden || reduced) return;
        if (!lastFrame || now - lastFrame >= 1000 / targetFps - 1) {
          renderDelta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 1 / targetFps;
          const scrollEnergy = Math.min(0.25, Math.abs(progress.value - smoothedProgress) * 2);
          walkingTime += renderDelta * (1 + scrollEnergy);
          measuredTime += lastFrame ? (now - lastFrame) / 1000 : 1 / targetFps;
          measuredFrames++;
          if (measuredTime >= 3) {
            const fps = measuredFrames / measuredTime;
            container.dataset.fps = fps.toFixed(1);
            if (fps < targetFps * 0.72 && (quality || pixelRatioCap > 0.75)) {
              pixelRatioCap = quality ? 1 : Math.max(0.75, pixelRatioCap - 0.15);
              quality = 0;
              gl.setPixelRatio(Math.min(devicePixelRatio || 1, pixelRatioCap));
              composer?.setPixelRatio(Math.min(devicePixelRatio || 1, pixelRatioCap));
              gl.shadowMap.enabled = false;
              container.dataset.quality = 'economy';
            }
            measuredTime = 0;
            measuredFrames = 0;
          }
          lastFrame = now;
          render();
        }
        frame = requestAnimationFrame(animate);
      };
      syncAnimation = () => {
        cancelAnimationFrame(frame);
        frame = 0;
        lastFrame = 0;
        measuredTime = 0;
        measuredFrames = 0;
        telemetryTime = performance.now();
        renderedFrames = 0;
        drawCalls = 0;
        triangles = 0;
        shadowTime = -Infinity;
        const active = visible && !document.hidden && !reduced && !disposed;
        container.dataset.walking = String(active);
        if (!active) container.dataset.renderedFps = '0.0';
        if (active) frame = requestAnimationFrame(animate);
        render();
      };
      const profileTexture = new THREE.TextureLoader().load('/images/ngoc-hieu-logo-white.jpg', loaded => {
        if (disposed) { loaded.dispose(); return; }
        loaded.colorSpace = THREE.SRGBColorSpace;
        const image = loaded.image as HTMLImageElement;
        const scale = Math.min(496 / image.naturalWidth, 496 / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        if (import.meta.env.DEV) console.assert(Math.abs(width / height - image.naturalWidth / image.naturalHeight) < 0.000001, 'Facade logo must preserve its aspect ratio');
        letterContext.drawImage(image, (512 - width) / 2, (512 - height) / 2, width, height);
        letterTexture.needsUpdate = true;
        finaleMaterial.map = loaded;
        finaleMaterial.needsUpdate = true;
        badgeMaterial.map = loaded;
        badgeMaterial.needsUpdate = true;
        badges.forEach(badge => { badge.visible = true; });
        render();
      }, undefined, () => {});
      textures.add(profileTexture);
      document.addEventListener('visibilitychange', visibilityChanged);
      void document.fonts.load('500 132px "Be Vietnam Pro"', 'Bít Tết Ngọc Hiếu').then(() => {
        if (disposed) return;
        paintSign();
        paintTicker();
        paintAdvertisement();
        render();
      }).catch(() => {});
      let journeyTrigger: ScrollTrigger | undefined;
      const tweenProgress = (value: number, onComplete?: () => void) => {
        gsap.killTweensOf(progress);
        if (reduced) {
          progress.value = value;
          smoothedProgress = value;
          render();
          onComplete?.();
          return;
        }
        gsap.to(progress, { value, duration: 1.8, ease: 'power2.inOut', onComplete });
      };
      const seekChapter = (event: Event) => {
        const index = (event as CustomEvent<{ index: number }>).detail?.index;
        if (!Number.isInteger(index) || index < 0 || index > 6) return;
        const value = index === 0 ? 0 : index === 6 ? 1 : (index + 0.5) / 7;
        if (tourMode === 'steps') {
          if (mobileSteps) {
            gsap.killTweensOf(progress);
            progress.value = stages[mobileCamera(chapter.dataset.journey, camera.aspect).stageIndex].at;
            smoothedProgress = progress.value;
            render();
          } else tweenProgress(value);
          return;
        }
        if (!journeyTrigger) gsap.killTweensOf(progress);
        progress.value = value;
        smoothedProgress = value;
        if (journeyTrigger) window.scrollTo({ top: journeyTrigger.start + (journeyTrigger.end - journeyTrigger.start) * value, behavior: 'instant' });
        render();
      };
      const requestedStage = stages.findIndex(stage => stage.name === chapter.dataset.journey);
      if (tourMode === 'steps' && requestedStage >= 0) {
        progress.value = mobileSteps ? stages[mobileCamera(chapter.dataset.journey, camera.aspect).stageIndex].at : requestedStage === 0 ? 0 : requestedStage === 6 ? 1 : (requestedStage + 0.5) / 7;
        smoothedProgress = progress.value;
      }
      chapter.addEventListener('storyseek', seekChapter);
      passes.push({ dispose: () => chapter.removeEventListener('storyseek', seekChapter) });
      controls.current = value => {
        if (journeyTrigger) {
          window.scrollTo({ top: value ? journeyTrigger.start + (journeyTrigger.end - journeyTrigger.start) * 0.2 : journeyTrigger.start, behavior: 'instant' });
          if (value) callback.current?.();
          return;
        }
        tweenProgress(value ? 0.36 : 0, () => { if (value) callback.current?.(); });
      };
      resize = new ResizeObserver(() => {
        const { width, height } = container.getBoundingClientRect();
        if (!width || !height) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        const pixelRatio = Math.min(devicePixelRatio || 1, pixelRatioCap);
        gl.setPixelRatio(pixelRatio);
        gl.setSize(width, height, false);
        composer?.setPixelRatio(pixelRatio);
        composer?.setSize(width, height);
        render();
      });
      resize.observe(container);
      intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncAnimation(); });
      intersection.observe(container);
      gl.domElement.addEventListener('webglcontextlost', contextLost);
      media.add({ desktop: '(min-width: 900px)', mobile: '(max-width: 899px)', reduced: '(prefers-reduced-motion: reduce)' }, context => {
        reduced = Boolean(context.conditions?.reduced);
        if (reduced && tourMode === 'steps') gsap.getTweensOf(progress).forEach(tween => { tween.progress(1).kill(); });
        syncAnimation();
        if (reduced || tourMode === 'steps') return;
        const tween = gsap.fromTo(progress, { value: 0 }, { value: 1, ease: 'none', scrollTrigger: { trigger: chapter, start: 'top top', end: () => `+=${innerHeight * (context.conditions?.desktop ? 5 : 4)}`, pin: true, scrub: 1, invalidateOnRefresh: true } });
        journeyTrigger = tween.scrollTrigger;
        return () => { journeyTrigger = undefined; };
      }, chapter);
      if (import.meta.env.DEV && tourMode === 'steps') console.assert(!journeyTrigger && (!mobile || (quality === 0 && targetFps === 30)), 'Step tours must remain unpinned and preserve mobile economy rendering at 30fps');
      if (tourMode === 'scroll' && window.location.hash && window.location.hash !== '#home') {
        const destination = document.getElementById(window.location.hash.slice(1));
        destination?.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
      render();
    } catch {
      cleanup();
      setFailed(true);
      unavailable.current?.();
    }
    return cleanup;
  }, [tourMode]);

  useEffect(() => {
    if (previousEntered.current === entered) return;
    previousEntered.current = entered;
    controls.current?.(entered);
  }, [entered]);

  return <div ref={host} className="restaurant-scene" role="img" aria-label="Minh họa 3D Ngọc Hiếu: hai tòa nhà nối liền, hành trình từ tòa bên phải sang tòa bên trái, có ô tô và khu phố xung quanh. Lễ tân và nhân viên cầm biển chào đón trước hành trình nội thất, kết thúc bằng logo. Không tái hiện chính xác chi nhánh thực tế.">{failed ? <div className="scene-message" role="status" lang="vi"><strong>Nhà hàng Ngọc Hiếu</strong><span>Không thể hiển thị không gian 3D trên thiết bị này. Thực đơn vẫn sẵn sàng bên dưới.</span></div> : null}</div>;
}
