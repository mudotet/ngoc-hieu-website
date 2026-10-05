import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BookPage } from './menuContent';
import { palette, sceneColors, type ThemeMode } from './theme';
import { normalizePage, springStep } from './bookPhysics';

export type MenuBookHandle = { goTo: (page: number) => void; turn: (direction: number) => void };
type Props = { pages: BookPage[]; theme: ThemeMode; mobile: boolean; reduced: boolean; muted: boolean; onPageChange: (page: number) => void; onBusyChange: (busy: boolean) => void; onDishSelect: (dishId: string) => void; onError: () => void };
type Zone = { x: number; y: number; w: number; h: number; page?: number; dish?: string };
const W = 2.65;
const H = 3.65;
const deformation = `
uniform float rootAngle;
uniform float edgeAngle;
vec3 sheetPoint(vec2 p) {
  float u = p.x / 2.65 + 0.5;
  float v = p.y / 3.65 + 0.5;
  float bend = sin(3.14159265 * clamp(rootAngle, 0.0, 1.0));
  vec2 arc = vec2(0.0);
  for (int i = 0; i < 20; i++) {
    float s = u * (float(i) + 0.5) / 20.0;
    float a = 3.14159265 * (rootAngle + (edgeAngle-rootAngle)*s*s) + bend*sin(s*3.14159265)*0.25;
    arc += vec2(cos(a), sin(a)) * u * 2.65 / 20.0;
  }
  arc.y += sin(u*3.14159265)*0.025 + bend*u*u*(0.5-v)*0.13;
  return vec3(arc.x, arc.y, (0.5-v)*3.65);
}
`;

const MenuBook3D = forwardRef<MenuBookHandle, Props>(function MenuBook3D(props, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  const api = useRef<MenuBookHandle | null>(null);
  const refresh = useRef<(() => void) | null>(null);
  useEffect(() => { latest.current = props; refresh.current?.(); }, [props]);
  useImperativeHandle(ref, () => ({ goTo: page => api.current?.goTo(page), turn: direction => api.current?.turn(direction) }), []);

  useEffect(() => {
    if (!canvas.current) return;
    const element = canvas.current;
    let renderer: THREE.WebGLRenderer | undefined;
    let frame = 0;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let audio: AudioContext | undefined;
    const sources = new Set<AudioBufferSourceNode>();
    const textures = new Set<THREE.Texture>();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const images = new Set<HTMLImageElement>();
    const removers: (() => void)[] = [];
    let busy = false;
    const setBusy = (value: boolean) => {
      if (busy !== value) { busy = value; latest.current.onBusyChange(value); }
    };
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      removers.forEach(remove => remove());
      images.forEach(image => { image.onload = null; image.onerror = null; image.src = ''; });
      sources.forEach(source => { try { source.stop(); } catch { source.disconnect(); } });
      void audio?.close().catch(() => {});
      textures.forEach(texture => texture.dispose());
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      if (renderer) {
        const context = renderer.getContext();
        context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
        context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        renderer.resetState(); renderer.dispose();
      }
      api.current = null;
      refresh.current = null;
      setBusy(false);
    };
    const fail = () => { cleanup(); latest.current.onError(); };
    const listen = (name: string, handler: EventListener) => {
      element.addEventListener(name, handler);
      removers.push(() => element.removeEventListener(name, handler));
    };
    try {
      renderer = new THREE.WebGLRenderer({ canvas: element, antialias: true, alpha: false, powerPreference: 'low-power' });
      const gl = renderer;
      gl.debug.onShaderError = () => fail();
      gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, props.mobile ? 1.25 : 1.5));
      gl.outputColorSpace = THREE.SRGBColorSpace;
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.shadowMap.enabled = true;
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
      const book = new THREE.Group();
      scene.add(book);
      const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.add(geometry); return geometry; };
      const ownMaterial = <T extends THREE.Material>(material: T) => { materials.add(material); return material; };
      const texture = (source: HTMLCanvasElement, color = true) => {
        const result = new THREE.CanvasTexture(source);
        result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        result.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
        textures.add(result);
        return result;
      };
      const surface = (size: number) => {
        const c = document.createElement('canvas'); c.width = size; c.height = size;
        const context = c.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        return { c, context };
      };
      const normalSurface = surface(256);
      const normalPixels = normalSurface.context.createImageData(256, 256);
      for (let i = 0; i < normalPixels.data.length; i += 4) {
        const n = Math.sin(i * 0.173) * 7;
        normalPixels.data.set([128 + n, 128 - n, 254, 255], i);
      }
      normalSurface.context.putImageData(normalPixels, 0, 0);
      const paperNormal = texture(normalSurface.c, false);
      paperNormal.wrapS = paperNormal.wrapT = THREE.RepeatWrapping;
      paperNormal.repeat.set(5, 7);
      const logo = surface(512);
      logo.context.fillStyle = palette.purple; logo.context.fillRect(0, 0, 512, 512);
      logo.context.strokeStyle = palette.amber; logo.context.lineWidth = 2;
      logo.context.strokeRect(26, 26, 460, 460);
      logo.context.fillStyle = palette.amber; logo.context.textAlign = 'center';
      logo.context.font = '32px "Be Vietnam Pro", sans-serif'; logo.context.fillText('BÍT TẾT', 256, 176);
      logo.context.font = 'bold 48px "Be Vietnam Pro", sans-serif'; logo.context.fillText('NGỌC HIẾU', 256, 248);
      logo.context.font = '20px "Be Vietnam Pro", sans-serif'; logo.context.fillText('THỰC ĐƠN', 256, 340);
      const logoMap = texture(logo.c);
      const relief = surface(512);
      const mask = logo.context.getImageData(0, 0, 512, 512);
      const pixels = relief.context.createImageData(512, 512);
      const heightAt = (x: number, y: number) => mask.data[(Math.max(0, Math.min(511, y)) * 512 + Math.max(0, Math.min(511, x))) * 4];
      for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
        const i = (y * 512 + x) * 4;
        pixels.data.set([128 + (heightAt(x - 1, y) - heightAt(x + 1, y)) * 0.35, 128 + (heightAt(x, y - 1) - heightAt(x, y + 1)) * 0.35, 240, 255], i);
      }
      relief.context.putImageData(pixels, 0, 0);
      const logoNormal = texture(relief.c, false);
      const officialLogo = new Image(); images.add(officialLogo);
      officialLogo.onload = () => {
        images.delete(officialLogo); if (disposed) return;
        logo.context.fillStyle = palette.purple; logo.context.fillRect(30, 105, 452, 205);
        const scale = Math.min(390 / officialLogo.naturalWidth, 190 / officialLogo.naturalHeight);
        logo.context.drawImage(officialLogo, (512 - officialLogo.naturalWidth * scale) / 2, 115 + (190 - officialLogo.naturalHeight * scale) / 2, officialLogo.naturalWidth * scale, officialLogo.naturalHeight * scale);
        const stamp = logo.context.getImageData(0, 0, 512, 512); mask.data.set(stamp.data);
        for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
          const i = (y * 512 + x) * 4;
          pixels.data.set([128 + (heightAt(x - 1, y) - heightAt(x + 1, y)) * 0.35, 128 + (heightAt(x, y - 1) - heightAt(x, y + 1)) * 0.35, 240, 255], i);
        }
        relief.context.putImageData(pixels, 0, 0); logoMap.needsUpdate = logoNormal.needsUpdate = true;
        refresh.current?.();
      };
      officialLogo.onerror = () => images.delete(officialLogo);
      officialLogo.src = '/images/logo-bit-tet-ngoc-hieu.png';
      const leather = ownMaterial(new THREE.MeshStandardMaterial({ color: palette.purple, roughness: 0.72, normalMap: paperNormal, normalScale: new THREE.Vector2(0.4, 0.4) }));
      const pageBlock = ownMaterial(new THREE.MeshStandardMaterial({ color: palette.paper, roughness: 0.93 }));
      const makeBox = (w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z = 0) => {
        const mesh = new THREE.Mesh(ownGeometry(new RoundedBoxGeometry(w, h, d, 3, Math.min(0.07, h / 3))), material);
        mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; book.add(mesh); return mesh;
      };
      makeBox(W + 0.17, 0.12, H + 0.22, leather, W / 2, -0.15);
      const leftCover = makeBox(W + 0.17, 0.12, H + 0.22, leather, -W / 2, -0.15);
      makeBox(0.22, 0.22, H + 0.22, leather, 0, -0.12);
      const rightBlock = makeBox(W - 0.025, 0.12, H - 0.015, pageBlock, W / 2, -0.025);
      const leftBlock = makeBox(W - 0.025, 0.12, H - 0.015, pageBlock, -W / 2, -0.025);
      const leftLayers: THREE.Mesh[] = [];
      for (let i = 0; i < 9; i++) {
        const line = ownMaterial(new THREE.MeshStandardMaterial({ color: palette.paper, roughness: 1 }));
        line.color.multiplyScalar(i % 2 ? 0.83 : 0.94);
        makeBox(W - 0.02, 0.003, H, line, W / 2, -0.079 + i * 0.014);
        leftLayers.push(makeBox(W - 0.02, 0.003, H, line, -W / 2, -0.079 + i * 0.014));
      }
      const cover = new THREE.Group(); book.add(cover);
      const coverBody = new THREE.Mesh(ownGeometry(new RoundedBoxGeometry(W + 0.17, 0.12, H + 0.22, 3, 0.04)), leather);
      coverBody.position.set(W / 2, 0, 0); coverBody.castShadow = true; cover.add(coverBody); cover.position.y = 0.12;
      const emblem = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(W * 0.82, H * 0.78)), ownMaterial(new THREE.MeshStandardMaterial({ map: logoMap, normalMap: logoNormal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.5, metalness: 0.18 })));
      emblem.rotation.x = -Math.PI / 2; emblem.position.set(W / 2, 0.062, 0); cover.add(emblem);
      const wood = surface(512);
      wood.context.fillStyle = sceneColors.timber; wood.context.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 350; i++) {
        wood.context.strokeStyle = i % 2 ? sceneColors.char : sceneColors.brass;
        wood.context.globalAlpha = 0.08 + (i % 5) * 0.016; wood.context.lineWidth = i % 3 + 0.4;
        wood.context.beginPath();
        for (let x = 0; x <= 512; x += 8) {
          const y = i * 1.5 + Math.sin(x * 0.008 + i * 0.1) * 4 + Math.sin(x * 0.027 + i) * 1.5;
          if (x === 0) wood.context.moveTo(x, y); else wood.context.lineTo(x, y);
        }
        wood.context.stroke();
      }
      const woodMap = texture(wood.c); woodMap.wrapS = woodMap.wrapT = THREE.RepeatWrapping; woodMap.repeat.set(3, 3);
      const table = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(80, 80)), ownMaterial(new THREE.MeshPhysicalMaterial({ map: woodMap, color: sceneColors.timber, roughness: 0.48, clearcoat: 0.22, clearcoatRoughness: 0.55 })));
      table.rotation.x = -Math.PI / 2; table.position.y = -0.23; table.receiveShadow = true; scene.add(table);
      const ambient = new THREE.HemisphereLight(palette.cream, palette.purple, 2.4); scene.add(ambient);
      const key = new THREE.DirectionalLight(palette.cream, 3.2); key.position.set(-3, 7, 3); key.castShadow = true;
      key.shadow.mapSize.set(props.mobile ? 512 : 1024, props.mobile ? 512 : 1024);
      Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.1, far: 18 });
      key.shadow.normalBias = 0.025; key.shadow.bias = -0.00015; key.shadow.radius = 4; scene.add(key);
      removers.push(() => key.shadow.map?.dispose());
      const warm = new THREE.PointLight(palette.amber, 15, 16); warm.position.set(4, 4, -3); scene.add(warm);
      let current = 0;
      let target = 0;
      let opening = props.reduced ? 1 : 0;
      let root = { value: 0, velocity: 0 };
      let edge = { value: 0, velocity: 0 };
      let transition: { from: number; to: number; direction: number; goal: number } | null = null;
      let last = 0;
      let pointer: { id: number; x: number; y: number; time: number; lastX: number; lastTime: number; velocity: number; dragged: boolean; direction: number } | null = null;
      const cache = new Map<number, { map: THREE.CanvasTexture; back: THREE.Texture; zones: Zone[]; pending: number }>();
      const wake = () => { if (!disposed && !frame && !document.hidden) frame = requestAnimationFrame(render); };
      const wrapText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lineHeight: number, lines = 3) => {
        const words = text.split(/\s+/); let line = ''; let row = 0;
        for (const word of words) {
          if (ctx.measureText(`${line} ${word}`).width > max && line) {
            ctx.fillText(line, x, y + row * lineHeight); line = word; row++;
            if (row >= lines) return;
          } else line = line ? `${line} ${word}` : word;
        }
        ctx.fillText(line, x, y + row * lineHeight);
      };
      const pageTexture = (index: number) => {
        const cached = cache.get(index); if (cached) return cached;
        const c = document.createElement('canvas'); c.width = 768; c.height = 1056;
        const ctx = c.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
        const map = texture(c); const back = map.clone(); back.repeat.x = -1; back.offset.x = 1; textures.add(back);
        const result = { map, back, zones: [] as Zone[], pending: 0 }; cache.set(index, result);
        const page = props.pages[index];
        const loaded = new Map<string, HTMLImageElement>();
        const paint = () => {
          if (disposed || cache.get(index) !== result) return;
          result.zones.length = 0;
          ctx.fillStyle = palette.cream; ctx.fillRect(0, 0, 768, 1056);
          const shade = ctx.createLinearGradient(0, 0, 768, 0); shade.addColorStop(0, `${palette.purple}24`); shade.addColorStop(0.08, `${palette.paper}00`); shade.addColorStop(0.93, `${palette.paper}00`); shade.addColorStop(1, `${palette.paper}66`);
          ctx.fillStyle = shade; ctx.fillRect(0, 0, 768, 1056);
          ctx.strokeStyle = `${palette.purple}35`; ctx.strokeRect(40, 40, 688, 976);
          ctx.fillStyle = palette.greenText; ctx.font = '18px "Be Vietnam Pro", sans-serif'; ctx.fillText('NGỌC HIẾU  /  THỰC ĐƠN', 70, 88);
          ctx.fillStyle = palette.purple; ctx.font = 'bold 42px "Be Vietnam Pro", sans-serif';
          wrapText(ctx, page?.title ?? 'Ngọc Hiếu', 70, 158, 630, 52, 2);
          if (page?.kind === 'contents') {
            ctx.font = '22px "Be Vietnam Pro", sans-serif'; ctx.fillStyle = palette.purpleMid;
            ctx.fillText('Chọn món cho bữa hẹn hôm nay', 70, 254);
            const categories = new Set<string>();
            const entries = props.pages.map((p, i) => ({ p, i })).filter(({ p }) => {
              if (p.kind !== 'dishes') return false;
              const category = p.category ?? p.title;
              if (categories.has(category)) return false;
              categories.add(category); return true;
            });
            const row = Math.min(132, 620 / Math.max(1, entries.length));
            entries.forEach(({ p, i }, n) => {
              const y = 320 + n * row;
              ctx.fillStyle = palette.purple; ctx.font = 'bold 27px "Be Vietnam Pro", sans-serif';
              wrapText(ctx, p.category ?? p.title, 75, y, 530, 32, 2);
              ctx.font = '23px "Be Vietnam Pro", sans-serif'; ctx.fillStyle = palette.greenText; ctx.fillText(String(i + 1).padStart(2, '0'), 650, y);
              ctx.strokeStyle = `${palette.purple}30`; ctx.beginPath(); ctx.moveTo(75, y + row - 30); ctx.lineTo(695, y + row - 30); ctx.stroke();
              result.zones.push({ x: 60, y: y - 35, w: 650, h: row, page: i });
            });
          } else if (page) {
            const count = Math.max(1, page.dishes.length); const height = 750 / count;
            page.dishes.forEach((dish, i) => {
              const top = 225 + height * i; const image = loaded.get(dish.image); const imageHeight = Math.min(390, height * 0.52);
              ctx.fillStyle = palette.paper; ctx.fillRect(70, top, 628, imageHeight);
              if (image) {
                const ratio = Math.max(628 / image.naturalWidth, imageHeight / image.naturalHeight);
                ctx.save(); ctx.beginPath(); ctx.rect(70, top, 628, imageHeight); ctx.clip();
                ctx.drawImage(image, 70 + (628 - image.naturalWidth * ratio) / 2, top + (imageHeight - image.naturalHeight * ratio) / 2, image.naturalWidth * ratio, image.naturalHeight * ratio); ctx.restore();
              }
              ctx.fillStyle = palette.purple; ctx.font = 'bold 30px "Be Vietnam Pro", sans-serif'; wrapText(ctx, dish.name, 70, top + imageHeight + 48, 620, 37, 2);
              ctx.fillStyle = palette.greenText; ctx.font = 'bold 27px "Be Vietnam Pro", sans-serif';
              ctx.fillText(dish.price === null ? 'Liên hệ nhà hàng' : `${dish.price.toLocaleString('vi-VN')} đ`, 70, top + imageHeight + 135);
              ctx.fillStyle = palette.purpleMid; ctx.font = '21px "Be Vietnam Pro", sans-serif'; wrapText(ctx, dish.description, 70, top + imageHeight + 182, 620, 31, 3);
              if (dish.badge) { ctx.fillStyle = palette.greenText; ctx.font = 'bold 19px "Be Vietnam Pro", sans-serif'; ctx.fillText(dish.badge, 90, top + 34); }
              result.zones.push({ x: 65, y: top, w: 635, h: height - 10, dish: dish.id });
            });
          }
          ctx.fillStyle = palette.purpleMid; ctx.font = '18px "Be Vietnam Pro", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(Math.max(1, index + 1)), 384, 993); ctx.textAlign = 'left';
          map.needsUpdate = true; back.needsUpdate = true; wake();
        };
        paint();
        page?.dishes.forEach(dish => {
          if (!dish.image.startsWith('/images/')) return;
          const image = new Image(); images.add(image); result.pending++;
          image.onload = () => { images.delete(image); result.pending--; loaded.set(dish.image, image); paint(); wake(); };
          image.onerror = () => { images.delete(image); result.pending--; wake(); };
          image.src = dish.image;
        });
        return result;
      };
      const sheetGeometry = ownGeometry(new THREE.PlaneGeometry(W, H, 48, 12));
      const createSheet = () => {
        const uniforms = { rootAngle: { value: 0 }, edgeAngle: { value: 0 } };
        const deform = (shader: { vertexShader: string; uniforms: Record<string, unknown> }) => {
          Object.assign(shader.uniforms, uniforms);
          shader.vertexShader = deformation + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 pu = sheetPoint(position.xy + vec2(0.001,0.0)) - sheetPoint(position.xy); vec3 pv = sheetPoint(position.xy + vec2(0.0,0.001)) - sheetPoint(position.xy); vec3 objectNormal = normalize(cross(pu,pv));');
          shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = sheetPoint(position.xy);');
        };
        const front = ownMaterial(new THREE.MeshStandardMaterial({ roughness: 0.91, normalMap: paperNormal, normalScale: new THREE.Vector2(0.035, 0.035), side: THREE.FrontSide }));
        const back = ownMaterial(front.clone()); back.side = THREE.BackSide;
        front.onBeforeCompile = back.onBeforeCompile = deform;
        const group = new THREE.Group(); book.add(group); group.position.y = 0.065;
        const depth = ownMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })); depth.onBeforeCompile = deform;
        for (const material of [front, back]) {
          const mesh = new THREE.Mesh(sheetGeometry, material); mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true; mesh.customDepthMaterial = depth; group.add(mesh);
        }
        return { group, uniforms, front, back, index: -1 };
      };
      const left = createSheet(); const right = createSheet(); const moving = createSheet();
      const bind = (sheet: ReturnType<typeof createSheet>, index: number, reverse = index) => {
        sheet.index = index; sheet.front.map = pageTexture(index).map; sheet.back.map = pageTexture(reverse).back;
        sheet.front.needsUpdate = sheet.back.needsUpdate = true;
      };
      const setAngle = (sheet: ReturnType<typeof createSheet>, r: number, e = r) => { sheet.uniforms.rootAngle.value = Math.max(0, Math.min(1, r)); sheet.uniforms.edgeAngle.value = Math.max(0, Math.min(1, e)); };
      const layout = () => {
        const mobile = props.mobile;
        left.group.visible = !mobile;
        right.group.visible = true;
        moving.group.visible = !!transition;
        setAngle(left, 1); setAngle(right, 0);
        if (!transition) {
          bind(left, current); bind(right, mobile ? current : current + 1);
        } else {
          const { from, to, direction } = transition;
          if (direction > 0) {
            bind(left, from); bind(right, mobile ? to : to + 1);
            bind(moving, mobile ? from : from + 1, to);
          } else {
            bind(left, to); bind(right, mobile ? from : from + 1);
            bind(moving, mobile ? to : to + 1, from);
          }
          moving.group.position.y = 0.08;
        }
        const keep = new Set([left.front.map, left.back.map, right.front.map, right.back.map, moving.front.map, moving.back.map]);
        cache.forEach((entry, index) => {
          if (!keep.has(entry.map) && !keep.has(entry.back)) { entry.map.dispose(); entry.back.dispose(); textures.delete(entry.map); textures.delete(entry.back); cache.delete(index); }
        });
      };
      const rustle = () => {
        if (latest.current.muted || !audio || audio.state !== 'running') return;
        const buffer = audio.createBuffer(1, audio.sampleRate * 0.2, audio.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / data.length);
        const source = audio.createBufferSource(); source.buffer = buffer;
        const filter = audio.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1300; filter.Q.value = 0.6;
        const gain = audio.createGain(); gain.gain.value = 0.035;
        source.connect(filter); filter.connect(gain); gain.connect(audio.destination); sources.add(source);
        source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); sources.delete(source); }; source.start();
      };
      const begin = (direction: number) => {
        const to = normalizePage(current + direction * (props.mobile ? 1 : 2), props.pages.length, props.mobile);
        if (to === current) return false;
        if (pageTexture(to).pending || (!props.mobile && pageTexture(to + 1).pending)) return false;
        transition = { from: current, to, direction, goal: direction > 0 ? 1 : 0 };
        root = { value: direction > 0 ? 0 : 1, velocity: 0 }; edge = { ...root };
        layout(); setBusy(true); rustle(); return true;
      };
      const unlockAudio = () => {
        if (latest.current.muted) return;
        try { audio ??= new AudioContext(); void audio.resume().catch(() => {}); } catch { audio = undefined; }
      };
      const request = (page: number) => {
        if (!Number.isFinite(page)) return;
        unlockAudio();
        target = normalizePage(page, props.pages.length, props.mobile);
        if (target !== current) setBusy(true);
        wake();
      };
      api.current = { goTo: request, turn: direction => { if (Number.isFinite(direction) && direction !== 0) request(target + Math.sign(direction) * (props.mobile ? 1 : 2)); } };
      let lastTheme: ThemeMode | undefined;
      const theme = () => {
        if (lastTheme === latest.current.theme) return;
        lastTheme = latest.current.theme;
        scene.background = new THREE.Color(lastTheme === 'dark' ? palette.ink : palette.paper);
        ambient.intensity = lastTheme === 'dark' ? 1.35 : 2.4; key.intensity = lastTheme === 'dark' ? 2.4 : 3.2;
        table.material.color.set(sceneColors.timber).lerp(new THREE.Color(palette.ink), lastTheme === 'dark' ? 0.4 : 0);
        gl.toneMappingExposure = lastTheme === 'dark' ? 0.9 : 1.05;
      };
      const resize = () => {
        const rect = element.getBoundingClientRect();
        gl.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
        camera.aspect = Math.max(0.1, rect.width / Math.max(1, rect.height)); camera.updateProjectionMatrix(); wake();
      };
      function render(time: number) {
        frame = 0; if (disposed) return;
        try {
          const dt = Math.min(0.04, Math.max(0.001, (time - (last || time - 16)) / 1000)); last = time;
          theme();
          opening = latest.current.reduced ? 1 : Math.min(1, opening + dt / 1.2);
          const eased = opening * opening * (3 - 2 * opening);
          cover.rotation.z = Math.PI * eased; cover.visible = opening < 1;
          leftCover.visible = leftBlock.visible = opening === 1;
          leftLayers.forEach(layer => { layer.visible = opening === 1; });
          left.group.visible = !props.mobile && opening === 1;
          if (opening === 1 && !transition && target !== current) begin(Math.sign(target - current));
          if (transition) {
            if (latest.current.reduced && !pointer?.dragged) { root = { value: transition.goal, velocity: 0 }; edge = { ...root }; }
            else {
              root = springStep(root, transition.goal, dt, pointer?.dragged ? 180 : 85, 17);
              edge = springStep(edge, root.value, dt, 62, 13);
            }
            setAngle(moving, root.value, edge.value);
            if (!pointer?.dragged && Math.abs(root.value - transition.goal) < 0.002 && Math.abs(edge.value - transition.goal) < 0.003 && Math.abs(edge.velocity) < 0.012) {
              const completed = transition.goal === (transition.direction > 0 ? 1 : 0);
              if (completed) { current = transition.to; latest.current.onPageChange(current); }
              transition = null; layout();
            }
          }
          rightBlock.scale.y = 0.5 + (1 - current / Math.max(1, props.pages.length)) * 0.5;
          leftBlock.scale.y = 0.5 + current / Math.max(1, props.pages.length) * 0.5;
          const mobile = props.mobile;
          const focusX = mobile ? W / 2 : 0;
          const fit = Math.max(mobile ? 5.8 : 7.6, (mobile ? 3.3 : 6.1) / camera.aspect * 1.55);
          camera.position.set(focusX + (1 - eased) * 0.9, fit + (1 - eased) * 1.2, mobile ? 1.4 : 2.1);
          camera.lookAt(focusX, 0, 0);
          gl.render(scene, camera);
          if (disposed) return;
          const active = opening < 1 || !!transition || target !== current;
          setBusy(active);
          element.dataset.page = String(current); element.dataset.animating = String(active); element.dataset.sheets = moving.group.visible ? '3' : mobile ? '1' : '2';
          if (active) wake();
        } catch { fail(); }
      }
      const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
      const flatHit = (event: PointerEvent) => {
        const rect = element.getBoundingClientRect(); mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        ray.setFromCamera(mouse, camera);
        const point = new THREE.Vector3();
        if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.07), point)) return null;
        if (Math.abs(point.x) > W || Math.abs(point.z) > H / 2 || (props.mobile && point.x < 0)) return null;
        return { x: point.x, z: point.z, index: props.mobile ? current : current + (point.x >= 0 ? 1 : 0), u: point.x >= 0 ? point.x / W : 1 + point.x / W, v: point.z / H + 0.5 };
      };
      const down = (event: PointerEvent) => {
        if (pointer || event.button !== 0 || opening < 1 || transition) return;
        const hit = flatHit(event); if (!hit) return;
        if (!latest.current.muted) {
          try { audio ??= new AudioContext(); void audio.resume().catch(() => {}); } catch { audio = undefined; }
        }
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, lastX: event.clientX, lastTime: event.timeStamp, velocity: 0, dragged: false, direction: hit.x < 0 ? -1 : 1 };
        element.setPointerCapture(event.pointerId);
      };
      const move = (event: PointerEvent) => {
        if (!pointer || pointer.id !== event.pointerId) return;
        const dx = event.clientX - pointer.x; const dy = event.clientY - pointer.y;
        if (!pointer.dragged && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          pointer.direction = dx < 0 ? 1 : -1;
          if (!begin(pointer.direction)) return;
          pointer.dragged = true;
        }
        pointer.velocity = (event.clientX - pointer.lastX) / Math.max(1, event.timeStamp - pointer.lastTime);
        pointer.lastX = event.clientX; pointer.lastTime = event.timeStamp;
        if (pointer.dragged && transition) {
          event.preventDefault();
          const travel = Math.min(1, Math.max(0, -dx * pointer.direction / (element.clientWidth * (props.mobile ? 0.7 : 0.42))));
          transition.goal = pointer.direction > 0 ? travel : 1 - travel; wake();
        }
      };
      const up = (event: PointerEvent, cancel = false) => {
        if (!pointer || pointer.id !== event.pointerId) return;
        const pressed = pointer; pointer = null;
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
        if (pressed.dragged && transition) {
          const progress = transition.direction > 0 ? transition.goal : 1 - transition.goal;
          const commit = !cancel && (progress > 0.32 || pressed.velocity * transition.direction < -0.35);
          transition.goal = commit ? (transition.direction > 0 ? 1 : 0) : (transition.direction > 0 ? 0 : 1);
          target = commit ? transition.to : current; root.velocity = Math.max(-2, Math.min(2, -pressed.velocity * 0.8)); wake();
        } else if (!cancel && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 12) {
          const hit = flatHit(event); if (!hit) return;
          if ((hit.x > 0 && hit.u > 0.9) || (hit.x < 0 && hit.u < 0.1)) { api.current?.turn(hit.x > 0 ? 1 : -1); return; }
          const zone = pageTexture(hit.index).zones.find(z => hit.u * 768 >= z.x && hit.u * 768 <= z.x + z.w && hit.v * 1056 >= z.y && hit.v * 1056 <= z.y + z.h);
          if (zone?.page !== undefined) request(zone.page);
          else if (zone?.dish) latest.current.onDishSelect(zone.dish);
        }
      };
      listen('pointerdown', down as EventListener); listen('pointermove', move as EventListener);
      listen('pointerup', ((event: PointerEvent) => up(event)) as EventListener);
      listen('pointercancel', ((event: PointerEvent) => up(event, true)) as EventListener);
      listen('lostpointercapture', ((event: PointerEvent) => up(event, true)) as EventListener);
      listen('webglcontextlost', ((event: Event) => { event.preventDefault(); fail(); }) as EventListener);
      removers.push(() => { if (pointer && element.hasPointerCapture(pointer.id)) element.releasePointerCapture(pointer.id); });
      const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else { last = 0; wake(); } };
      document.addEventListener('visibilitychange', visibility); removers.push(() => document.removeEventListener('visibilitychange', visibility));
      refresh.current = () => { if (latest.current.muted) sources.forEach(source => { try { source.stop(); } catch { source.disconnect(); } }); wake(); };
      layout(); theme(); resize(); observer = new ResizeObserver(resize); observer.observe(element);
      latest.current.onPageChange(0); setBusy(opening < 1); wake();
    } catch { fail(); }
    return cleanup;
  }, [props.pages, props.mobile]);

  return <canvas ref={canvas} className="menu-book-canvas" aria-hidden="true" />;
});

export default MenuBook3D;
