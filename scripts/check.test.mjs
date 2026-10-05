import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('visible logo surfaces use only the approved original JPEG', () => {
  assert.ok(existsSync(new URL('public/images/ngoc-hieu-logo-white.jpg', root)));
  for (const path of ['index.html', 'src/App.tsx', 'src/MenuBook3D.tsx', 'src/RestaurantScene.tsx']) {
    const source = read(path);
    assert.match(source, /\/images\/ngoc-hieu-logo-white\.jpg/, path);
    assert.doesNotMatch(source, /logo-bit-tet-ngoc-hieu\.png|ngoc-hieu-facebook-profile\.jpg/, path);
  }
  assert.match(read('index.html'), /rel="icon" type="image\/jpeg" href="\/images\/ngoc-hieu-logo-white\.jpg"/);
  assert.match(read('src/MenuBook3D.tsx'), /logo\.context\.fillStyle = 'white'/);
});

test('shared theme text and controls meet WCAG AA in both modes', () => {
  const module = { exports: {} };
  const compiled = ts.transpileModule(read('src/theme.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', compiled)(createRequire(import.meta.url), module, module.exports);
  const { palette, themeColors } = module.exports;
  const luminance = hex => hex.slice(1).match(/../g).map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const check = (foreground, background, label) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    const ratio = (values[0] + 0.05) / (values[1] + 0.05);
    assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(2)}:1 is below AA`);
  };
  for (const [mode, colors] of Object.entries(themeColors)) {
    for (const background of ['surface', 'surface-alt']) {
      for (const foreground of ['text', 'muted', 'accent', 'heading-accent']) {
        check(colors[foreground], colors[background], `${mode} ${foreground}/${background}`);
      }
    }
    for (const background of ['button-bg', 'button-hover']) check(colors['button-text'], colors[background], `${mode} button/${background}`);
  }
  for (const paper of [palette.cream, palette.paper]) {
    for (const ink of [palette.purple, palette.purpleMid, palette.greenText]) check(ink, paper, 'menu text/paper');
  }
  check(palette.amber, palette.purple, 'embossed cover');
});

test('theme defaults dark while preserving a saved light preference and blocked storage support', () => {
  assert.match(read('index.html'), /color-scheme: dark/);
  const compiled = ts.transpileModule(read('src/theme.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const saved of ['dark', 'light', 'invalid', null, new Error('Storage blocked')]) {
    const properties = new Map();
    const rootElement = { dataset: {}, style: { setProperty: (key, value) => properties.set(key, value) } };
    const storage = {
      getItem: () => { if (saved instanceof Error) throw saved; return saved; },
      setItem: () => { if (saved instanceof Error) throw saved; },
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'document', 'localStorage', compiled)(
      createRequire(import.meta.url), module, module.exports, { documentElement: rootElement, querySelector: () => null }, storage,
    );
    module.exports.initializeTheme();
    assert.equal(rootElement.dataset.theme, saved === 'light' ? 'light' : 'dark');
    assert.equal(properties.get('--purple'), module.exports.palette.purple);
    module.exports.setTheme('dark');
    assert.equal(rootElement.dataset.theme, 'dark');
    assert.equal(properties.get('--surface'), module.exports.themeColors.dark.surface);
    module.exports.setTheme('light');
    assert.equal(properties.get('--surface'), module.exports.themeColors.light.surface);
  }
});

test('book curvature anchors the spine and springs settle at varying frame rates', () => {
  const module = { exports: {} };
  const compiled = ts.transpileModule(read('src/bookPhysics.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('module', 'exports', compiled)(module, module.exports);
  const { pagePoint, springStep, normalizePage } = module.exports;
  for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
    const spine = pagePoint(0, 0.5, progress, Math.max(0, progress - 0.1));
    assert.deepEqual(spine, { x: 0, y: 0, z: 0 });
  }
  assert.ok(Math.abs(pagePoint(1, 0.5, 0, 0).x - 2.65) < 0.00001);
  assert.ok(Math.abs(pagePoint(1, 0.5, 1, 1).x + 2.65) < 0.00001);
  const middle = pagePoint(0.5, 0.5, 0.5, 0.35);
  const edge = pagePoint(1, 0.5, 0.5, 0.35);
  assert.ok(Math.abs(middle.x * edge.y - middle.y * edge.x) > 0.05, 'turning paper must curve, not rotate as a flat panel');
  for (const fps of [30, 60, 120]) {
    let state = { value: 0, velocity: 0 };
    for (let frame = 0; frame < fps * 3; frame++) state = springStep(state, 1, 1 / fps);
    assert.ok(Math.abs(state.value - 1) < 0.001 && Math.abs(state.velocity) < 0.001, `spring must settle at ${fps}fps`);
    for (let frame = 0; frame < fps * 3; frame++) state = springStep(state, 0, 1 / fps);
    assert.ok(Math.abs(state.value) < 0.001, 'cancelled turn must return');
  }
  const state = { value: 0.4, velocity: 0.2 };
  assert.deepEqual(springStep(state, 1, NaN), state);
  assert.ok(Number.isFinite(springStep(state, 1, 10).value));
  assert.equal(normalizePage(Infinity, 11, false), 0);
  assert.equal(normalizePage(-3, 11, true), 0);
  assert.equal(normalizePage(99, 11, false), 10);
  assert.equal(normalizePage(3, 11, false), 2);
  assert.equal(normalizePage(3, 11, true), 3);
  assert.equal(normalizePage(3, NaN, true), 0);
  assert.equal(normalizePage(3, 2.5, true), 1);
});

test('expanded book content has unique pages and local dish photographs', () => {
  const load = path => {
    const module = { exports: {} };
    const compiled = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('require', 'module', 'exports', compiled)(name => {
      assert.equal(name, './content');
      return load('src/content.ts');
    }, module, module.exports);
    return module.exports;
  };
  const { menuPages, menuDishes, menuCategories } = load('src/menuContent.ts');
  assert.equal(menuPages[0].kind, 'contents');
  assert.ok(menuDishes.length >= 10);
  assert.equal(new Set(menuPages.map(page => page.id)).size, menuPages.length);
  assert.equal(new Set(menuDishes.map(dish => dish.id)).size, menuDishes.length);
  for (const dish of menuDishes) {
    assert.ok(existsSync(new URL(`public${dish.image}`, root)), dish.image);
    assert.ok(dish.price === null || Number.isFinite(dish.price) && dish.price > 0);
    assert.ok(menuPages.some(page => page.dishes.some(item => item.id === dish.id)));
  }
  for (const category of menuCategories) assert.equal(menuPages[category.page].category, category.name);
});

test('bench cushions and backs do not overlap coplanar exterior faces', () => {
  const source = read('src/RestaurantScene.tsx');
  for (const name of ['left-lounge-banquette', 'reception-waiting-bench']) {
    const rows = source.split('\n');
    const start = rows.findIndex(row => row.includes(`name = '${name}'`));
    assert.ok(start >= 0);
    const boxes = rows.slice(start, start + 3).map(row => {
      const match = row.match(/box\(\w+, \[([^\]]+)\], \[([^\]]+)\]/);
      assert.ok(match);
      const center = match[1].split(',').map(Number);
      const size = match[2].split(',').map(Number);
      return { min: center.map((v, i) => v - size[i] / 2), max: center.map((v, i) => v + size[i] / 2) };
    });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const overlap = [0, 1, 2].every(axis => Math.min(boxes[i].max[axis], boxes[j].max[axis]) - Math.max(boxes[i].min[axis], boxes[j].min[axis]) > 1e-6);
      assert.ok(!overlap, `${name}: overlapping parts ${i}/${j} cause coplanar side-face flicker`);
    }
  }
});

const connectorGeometry = async () => {
  const THREE = await import('three');
  const source = read('src/RestaurantScene.tsx');
  const slice = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Missing geometry slice ${start}`);
    return source.slice(from, to);
  };
  const code = `
    const scene = new THREE.Scene();
    const finish = new THREE.MeshBasicMaterial();
    const wall = finish, brass = finish, timber = finish, accent = finish, bone = finish, iron = finish, glass = finish, doorPaint = finish, ceramic = finish, steak = finish, char = finish, eggWhite = finish, yolk = finish, garnish = finish;
    const palette = { amber: 0 }, interiorLights = [], steamMaterials = [], steamWisps = [];
    const material = () => finish, tint = () => 0, surface = null;
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1), cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 32), roundedGeometry = new THREE.SphereGeometry(1), plateRimGeometry = new THREE.TorusGeometry(0.2, 0.025);
    const mesh = (geometry, mat, parent, position, scale) => {
      const object = new THREE.Mesh(geometry, mat);
      object.position.fromArray(position); object.scale.fromArray(scale); parent.add(object); return object;
    };
    const box = (mat, position, scale, parent = scene) => mesh(boxGeometry, mat, parent, position, scale);
    const cylinder = (mat, position, scale) => mesh(cylinderGeometry, mat, scene, position, scale);
    ${slice('const rightBuilding =', 'const sideFacade =')}
    ${slice('box(wall, [-1, 1.6, -12]', 'for (const z of [-4.6, -7.5])')}
    ${slice(source.match(/for \(const x of \[[^\]]+\]\) \{\s*cylinder\(timber, \[x, 1, -1.2\]/)[0], 'const signCanvas =')}
    scene.updateMatrixWorld(true);
    return { scene, connectingDoor, rightBuilding };
  `.replaceAll('import.meta.env.DEV', 'false');
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return { THREE, ...new Function('THREE', compiled)(THREE) };
};

test('actual furniture leaves 1.5m connector approaches and main hallway clear', async () => {
  const { THREE, scene } = await connectorGeometry();
  const passages = [
    new THREE.Box3(new THREE.Vector3(-8, 0.15, -5.55), new THREE.Vector3(0.75, 2.5, -4.05)),
    new THREE.Box3(new THREE.Vector3(-0.75, 0.15, -8.6), new THREE.Vector3(0.75, 2.5, 1)),
  ];
  const collisions = [];
  scene.traverse(object => {
    if (!object.isMesh) return;
    const bounds = new THREE.Box3().setFromObject(object);
    if (passages.some(passage => passage.intersectsBox(bounds))) collisions.push(`${object.name || 'mesh'}: ${bounds.min.toArray()} / ${bounds.max.toArray()}`);
  });
  assert.deepEqual(collisions, []);
});

test('actual connector trim and folded leaf have no overlapping coplanar exposed faces', async () => {
  const { THREE, rightBuilding, connectingDoor } = await connectorGeometry();
  const boxes = rightBuilding.children.filter(object => object.isMesh && object.position.x === -5.5);
  connectingDoor.traverse(object => { if (object.isMesh) boxes.push(object); });
  assert.ok(boxes.length >= 10);
  const bounds = boxes.map(object => new THREE.Box3().setFromObject(object));
  for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
    for (const axis of ['x', 'y', 'z']) for (const face of ['min', 'max']) {
      const others = ['x', 'y', 'z'].filter(value => value !== axis);
      const coplanar = Math.abs(bounds[i][face][axis] - bounds[j][face][axis]) < 1e-6;
      const overlap = others.every(value => Math.min(bounds[i].max[value], bounds[j].max[value]) - Math.max(bounds[i].min[value], bounds[j].min[value]) > 1e-6);
      assert.ok(!coplanar || !overlap, `parts ${i}/${j}: overlapping ${face}.${axis} faces at ${bounds[i][face][axis]}`);
    }
  }
});

test('wall photo lower edges stay above the lounge backrest sightline', async () => {
  const THREE = await import('three');
  const source = read('src/RestaurantScene.tsx');
  const height = Number(source.match(/picture.position.set\(-12.36, ([\d.]+),/)[1]);
  const backrest = source.match(/box\(accent, \[-12.02, ([\d.]+), -8.3\], \[0.18, ([\d.]+),/);
  const backTop = Number(backrest[1]) + Number(backrest[2]) / 2;
  const frameBottom = height - 1.27 / 2;
  assert.ok(frameBottom > backTop + 0.2);
  assert.ok(height + 1.27 / 2 < 3.8, 'photo frame must stay below ceiling');
  const bench = new THREE.Box3(new THREE.Vector3(-12.11, 0.125, -10.4), new THREE.Vector3(-11, backTop, -6.2));
  for (const camera of [new THREE.Vector3(-7.1, 1.75, -4.8), new THREE.Vector3(-9.15, 1.85, -6)]) {
    for (const z of [-5.4, -7.5]) {
      const bottom = new THREE.Vector3(-12.36, frameBottom, z);
      const ray = new THREE.Ray(camera, bottom.clone().sub(camera).normalize());
      assert.equal(ray.intersectBox(bench, new THREE.Vector3()), null, 'bench must not block the photo lower edge');
    }
  }
});

test('startup loader releases content for readiness, timeout, skip and menu routes', () => {
  const html = read('index.html');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  for (const scenario of ['ready', 'timeout', 'skip', 'menu', 'reduced']) {
    const events = new Map(); const timers = new Map(); let id = 0; let removed = false; let pending = false;
    const shell = { inert: false, remove: () => { removed = true; }, contains: () => false, setAttribute: () => {}, classList: { add: () => {} } };
    const root = { inert: false, querySelector: () => null };
    const skip = { addEventListener: (name, handler) => events.set(`skip:${name}`, handler) };
    const document = { activeElement: null, getElementById: name => name === 'arrival' ? shell : name === 'root' ? root : skip, documentElement: { classList: { add: () => { pending = true; }, remove: () => { pending = false; } } }, addEventListener: () => {}, removeEventListener: () => {} };
    const window = { addEventListener: (name, handler) => events.set(name, handler), removeEventListener: name => events.delete(name) };
    new Function('document', 'window', 'location', 'performance', 'matchMedia', 'setTimeout', 'clearTimeout', script)(document, window, { pathname: scenario === 'menu' ? '/thuc-don' : '/' }, { now: () => 0 }, () => ({ matches: scenario === 'reduced' }), (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, key => timers.delete(key));
    if (scenario === 'menu') { assert.ok(removed && !root.inert); continue; }
    assert.ok(pending && root.inert);
    if (scenario === 'timeout') [...timers.values()].find(timer => timer.ms === 8000).fn();
    else if (scenario === 'skip') events.get('skip:click')();
    else { events.get('appready')(); [...timers.values()].find(timer => timer.ms === (scenario === 'reduced' ? 0 : 400)).fn(); }
    assert.ok(!pending && !root.inert);
    if (!removed) [...timers.values()].filter(timer => timer.ms === (scenario === 'reduced' ? 0 : 1050)).at(-1).fn();
    assert.ok(removed);
  }
});

test('every menu photograph exists locally', () => {
  const images = [...read('src/content.ts').matchAll(/image: '([^']+)'/g)].map(match => match[1]);
  assert.equal(images.length, 4);
  for (const image of images) assert.ok(existsSync(new URL(`public/images/${image}`, root)), image);
});

test('navigation anchors have matching destinations', () => {
  const app = read('src/App.tsx');
  for (const match of app.matchAll(/(?:href=|, )['"]#([^'"]+)['"]/g)) {
    assert.ok(app.includes(`id="${match[1]}"`), `Missing anchor ${match[1]}`);
  }
});

test('restaurant identity, photography and booking stay intact', () => {
  const app = read('src/App.tsx');
  assert.match(app, /Nhà hàng Ngọc Hiếu/);
  assert.match(app, /tel:0933446996/);
  assert.match(app, /mailto:bittetngochieu@gmail.com/);
  assert.match(app, /ngoc-hieu-logo-white\.jpg/);
  assert.match(app, /href="\/thuc-don"/);
  assert.match(app, /loading="lazy" decoding="async"/);
  assert.match(app, /menuToggle.current\?\.focus\(\)/);
  assert.doesNotMatch(app, /href="#"|NOXÉ|<video/);
  const images = [...app.matchAll(/src="(\/images\/[^\"]+)"/g)];
  for (const [, image] of images) assert.ok(existsSync(new URL(`public${image}`, root)), image);
  const css = read('src/style.css');
  assert.doesNotMatch(css + read('src/menu.css'), /#[\da-f]{3,8}\b/i);
  assert.match(read('src/theme.ts'), /#2A1650/);
  assert.match(read('src/theme.ts'), /#1F9D55/);
  assert.match(app, /<RestaurantScene theme=\{theme\}/);
  assert.match(css, /height:100dvh/);
  assert.equal((app.match(/<RestaurantScene /g) || []).length, 1);
  assert.match(app, /cinematic-story[\s\S]*<RestaurantScene[\s\S]*<\/section>/);
  assert.doesNotMatch(app, /className="journey wrap"/);
});

test('mobile homepage makes 3D optional and keeps details collapsed', () => {
  const app = read('src/App.tsx');
  assert.match(app, /const sceneEnabled = !mobile \|\| mobileTourEnabled/);
  assert.match(app, /sceneEnabled \? <>/);
  assert.match(app, /tourMode=\{mobile \? 'steps' : 'scroll'\}/);
  assert.match(app, /mobile-hero-photo/);
  assert.match(app, /Khám phá quán/);
  assert.match(app, /mobile-bottom-nav/);
  assert.match(app, /seek\(requestedChapter.current \+ 1\)/);
  assert.ok(app.indexOf('className="tour-steps"') < app.indexOf('className="story-overlay"'), 'mobile navigation must precede details in normal flow');
  assert.match(read('src/style.css'), /\.mobile-tour \.tour-steps\{position:relative;bottom:auto;order:2/);
  assert.match(app, /<details className="booking-disclosure"/);
  assert.match(read('src/style.css'), /@media\(max-width:767px\) and \(max-height:650px\)\{\.mobile-tour \.hero-visual\{height:140px\}/);
  assert.match(app, /<details[^>]*className="chapter-details"/);
  assert.doesNotMatch(app, /<details[^>]*className="chapter-details"[^>]*\bopen\b/);
  const scene = read('src/RestaurantScene.tsx');
  assert.match(scene, /scene.fog = distanceFog/);
  assert.match(scene, /const ambientOcclusion = !dark/);
  assert.match(scene, /tourMode === 'scroll' && chapter.dataset.journey !== stage.name/);
  assert.match(scene, /tourMode === 'steps' && requestedStage >= 0/);
});

test('mobile menu defaults to a list and makes the book opt-in', () => {
  const menu = read('src/MenuPage.tsx');
  assert.match(menu, /\[mobileBook, setMobileBook\] = useState\(false\)/);
  assert.match(menu, /const showBook = !mobile \|\| mobileBook/);
  assert.match(menu, /if \(previousShowBook !== showBook\)/);
  assert.match(menu, /notebook-menu-list/);
  assert.match(menu, /notebook-list-nav/);
  assert.match(menu, /aria-modal|<dialog/);
  assert.match(read('src/menu.css'), /env\(safe-area-inset-bottom/);
});

test('notebook route and official journal sources remain available', () => {
  const menu = read('src/MenuPage.tsx');
  assert.match(read('src/main.tsx'), /\/thuc-don/);
  assert.match(menu, /ArrowLeft/);
  assert.match(menu, /ArrowRight/);
  assert.match(menu, /aria-live="polite"/);
  assert.match(menu, /dish.price/);
  assert.match(menu, /prefers-reduced-motion/);
  assert.match(menu, /clearTimeout/);
  assert.match(menu, /MenuBook3D/);
  assert.match(menu, /<dialog/);
  assert.match(menu, /Đặt món này/);
  assert.match(menu, /tel:0933446996/);
  assert.match(menu, /setTarget\(value =>/);
  assert.match(menu, /if \(!event.currentTarget.open\) onClose\(\)/);
  assert.match(read('src/App.tsx'), /facebook.com\/reel\/1607893957441894/);
});

test('initial camera corner rays stay within the road footprint at three viewport shapes', async () => {
  const { PerspectiveCamera, Vector2, Vector3, Plane, Raycaster } = await import('three');
  const source = read('src/RestaurantScene.tsx');
  const numbers = (pattern, group = 1) => {
    const match = source.match(pattern);
    assert.ok(match, `Missing scene configuration: ${pattern}`);
    return match[group].split(',').map(Number);
  };
  const road = /box\(asphalt, \[([\d., -]+)\], \[([\d., -]+)\]\)\.name = 'road-ground'/;
  const [x, y, z] = numbers(road);
  const [width, height, depth] = numbers(road, 2);
  const outside = /name: 'outside', at: 0, position: new THREE.Vector3\(([\d., -]+)\), look: new THREE.Vector3\(([\d., -]+)\)/;
  const lens = numbers(/new THREE.PerspectiveCamera\(([\d., -]+)\)/);
  const [aspectScale] = numbers(/Math.max\(1, ([\d.]+) \/ camera.aspect\)/);
  assert.match(source, /CatmullRomCurve3/);
  assert.match(source, /camera.lookAt\(target\)/);
  const ground = new Plane(new Vector3(0, 1, 0), -(y + height / 2));
  for (const [w, h] of [[1440, 900], [390, 844], [2560, 1080]]) {
    const camera = new PerspectiveCamera(...lens);
    camera.aspect = w / h;
    camera.position.fromArray(numbers(outside));
    camera.position.y *= Math.max(1, aspectScale / camera.aspect);
    camera.lookAt(new Vector3(...numbers(outside, 2)));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    for (const u of [-1, 1]) for (const v of [-1, 1]) {
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2(u, v), camera);
      const hit = ray.ray.intersectPlane(ground, new Vector3());
      assert.ok(hit && Math.abs(hit.x - x) <= width / 2 && Math.abs(hit.z - z) <= depth / 2, `${w}x${h} corner ${u},${v} misses road`);
    }
  }
});

test('cinematic camera curve is continuous through all seven chapters', async () => {
  const THREE = await import('three');
  const source = read('src/RestaurantScene.tsx');
  const stagesSource = source.match(/const stages = (\[[\s\S]*?\n\s*\]);/);
  const knotsSource = source.match(/const cameraKnots = (\[[\s\S]*?\n\s*\]);/);
  assert.ok(stagesSource && knotsSource);
  const stages = new Function('THREE', `return ${stagesSource[1]}`)(THREE);
  const knots = new Function('THREE', 'stages', `return ${knotsSource[1]}`)(THREE, stages);
  assert.ok(knots[0].position.x < knots[1].position.x && knots[1].position.x < knots[2].position.x, 'opening must sweep left to right');
  const sweep = new THREE.CatmullRomCurve3(knots.map(knot => knot.position), false, 'catmullrom', 0.12);
  for (let i = 0; i <= 200; i++) {
    const point = sweep.getPoint(i / 200 * (2 / (knots.length - 1)));
    assert.ok(point.z < 12.5, 'opening sweep must not enter the opposite building row');
  }
  assert.doesNotMatch(source, /camera.position.multiplyScalar/);
  assert.match(source, /camera-building-clearance/);
  assert.match(source, /camera-frontage-sightline/);
  assert.equal(stages[1].position.x, 0, 'camera must align with main doorway');
  const entry = knots.find(knot => knot.at === 0.24);
  assert.ok(entry && entry.position.x === 0 && entry.position.z > 2);
  const inside = knots.find(knot => knot.at === 0.28);
  assert.ok(inside && inside.position.x === 0 && inside.position.z < 2);
  assert.equal(stages.length, 7);
  assert.equal(stages[0].at, 0);
  assert.equal(stages.at(-1).at, 1);
  for (let i = 1; i < knots.length; i++) assert.ok(knots[i].at > knots[i - 1].at);
  const camera = new THREE.CatmullRomCurve3(knots.map(knot => knot.position), false, 'catmullrom', 0.12);
  const look = new THREE.CatmullRomCurve3(knots.map(knot => knot.look), false, 'catmullrom', 0.12);
  let previous = camera.getPoint(0);
  for (let i = 0; i <= 2000; i++) {
    const point = camera.getPoint(i / 2000);
    assert.ok(point.toArray().every(Number.isFinite));
    assert.ok(point.y > 0.18, 'camera must stay above the ground');
    assert.ok(point.distanceTo(previous) < 0.5, 'curve must not jump between samples');
    assert.ok(point.distanceTo(look.getPoint(i / 2000)) > 0.1, 'camera and target must not coincide');
    previous = point;
  }
});

test('booking phone pattern rejects punctuation-only and malformed values', () => {
  const app = read('src/App.tsx');
  const match = app.match(/name="phone"[^\n]*?pattern="([^"]+)"/);
  assert.ok(match);
  const pattern = new RegExp(`^(?:${match[1]})$`, 'v');
  for (const value of ['0933446996', '+84 933 446 996', '(024) 3978-2251']) assert.ok(pattern.test(value), value);
  for (const value of ['--------', '........', '        ', '1234', '1234567890123456', '0933446996abc']) assert.ok(!pattern.test(value), value);
});

test('neighboring houses continue both restaurant street frontages', () => {
  const source = read('src/RestaurantScene.tsx');
  assert.match(source, /const frontage = side \? 3.5 : 2/);
  assert.match(source, /const rowStart = side \? -14.8 : -15.3/);
  assert.match(source, /const along = rowStart - i \* 5.55/);
  for (const side of [false, true]) {
    const first = side ? -14.8 : -15.3;
    const boundary = side ? -12 : -12.5;
    assert.ok(Math.abs(first + 5.5 / 2 - boundary) < 0.1, 'first neighbor must adjoin restaurant block');
    assert.ok(5.55 - 5.5 < 0.1, 'houses must form a continuous terrace');
  }
  assert.doesNotMatch(source, /const across = side \? -22 : -23/);
});

test('homepage opening resets root visits without overriding section links', () => {
  const source = read('src/main.tsx');
  const block = source.slice(source.indexOf('if (window.location.pathname'));
  const run = new Function('window', block.slice(0, block.indexOf('createRoot')));
  for (const [pathname, hash, reset] of [['/', '', true], ['/', '#home', true], ['/', '#dat-ban', false], ['/thuc-don', '', false]]) {
    let position = 2400;
    const window = { location: { pathname, hash }, history: { scrollRestoration: 'auto' }, scrollTo: options => { position = options.top; } };
    run(window);
    assert.equal(position, reset ? 0 : 2400);
  }
  assert.match(read('src/RestaurantScene.tsx'), /const value = index === 0 \? 0 : index === 6 \? 1/);
  assert.match(read('src/RestaurantScene.tsx'), /destination\?\.scrollIntoView\(\{ behavior: 'instant', block: 'start' \}\)/);
});

test('both welcome staff stand clear of the entrance corridor', () => {
  const source = read('src/RestaurantScene.tsx');
  for (const name of ['greeter', 'receptionist']) {
    const match = source.match(new RegExp(`${name}\\.body\\.position\\.set\\(([-\\d.]+), ([-\\d.]+), ([-\\d.]+)\\)`));
    assert.ok(match, name);
    const x = Number(match[1]);
    assert.ok(Math.abs(x) >= 1.8, `${name} must leave the 2.6m entrance plus body clearance open`);
  }
});

test('restaurant includes staffed counters and an animated cooking kitchen', () => {
  const source = read('src/RestaurantScene.tsx');
  assert.match(source, /sightline.intersectObjects\(sightlineBlockers, false\)/);
  for (const name of ['cashier-${name}', "['doorway',", "['booking',", 'cashier-chef', 'kitchen-stove', 'kitchen-pan', 'kitchen-steak', 'kitchen-flame-', 'kitchen-smoke-']) assert.ok(source.includes(name), name);
});

test('diagonal pavement corner and right wall gain branded details', () => {
  const source = read('src/RestaurantScene.tsx');
  assert.doesNotMatch(source, /GIẢM GIÁ|SALE|50%/);
  assert.match(source, /pocketBounds.intersectsBox\(entranceClearance\)/);
  assert.match(source, /advertisementBounds.min.x >= blankWallBounds.max.x/);
  for (const name of ['diagonal-corner-pocket', 'corner-planter', 'corner-bench', 'right-wall-advertisement']) assert.ok(source.includes(name), name);
});

test('cinematic story exposes seven chapters and truthful booking actions', () => {
  const app = read('src/App.tsx');
  const scene = read('src/RestaurantScene.tsx');
  for (const chapter of ['outside', 'doorway', 'signature', 'feedback', 'menu', 'booking', 'finale']) {
    assert.ok(scene.includes(`name: '${chapter}'`), `Missing chapter ${chapter}`);
  }
  assert.match(scene, /storychapter/);
  assert.match(scene, /storyseek/);
  assert.match(scene, /if \(reduced \|\| tourMode === 'steps'\) return/);
  assert.match(scene, /const tweenProgress/);
  assert.match(scene, /PMREMGenerator/);
  assert.match(scene, /RoomEnvironment/);
  assert.match(app, /<form/);
  assert.match(app, /required/);
  assert.match(app, /reportValidity\(\)/);
  assert.match(app, /digits.length >= 8 && digits.length <= 15/);
  assert.match(app, /<details/);
  assert.match(app, /<BookingForm/);
  assert.match(app, /mailto:/);
  assert.match(app, /07:00/);
  assert.match(app, /22:00/);
  assert.match(app, /href="\/thuc-don"/);
  assert.doesNotMatch(app, /5\/5|4\.9\/5|Đặt bàn thành công|window.location.href = href/);
  assert.match(app, /href=\{request\} target="_blank"/);
});

test('menu book is presented on a full-width stage rather than a small inset', () => {
  const css = read('src/menu.css');
  const menu = read('src/MenuPage.tsx');
  assert.match(menu, /notebook-stage/);
  assert.match(menu, /notebook-loading/);
  assert.match(menu, /<Suspense fallback=\{null\}>/);
  assert.match(css, /70dvh/);
  assert.match(css, /--notebook-table: var\(--ink\)/);
  assert.doesNotMatch(css, /--notebook-table: color-mix/);
  assert.match(menu, /aria-label=\{`Xem món/);
});

test('book camera fits cover bounds across wide and portrait viewports', async () => {
  const THREE = await import('three');
  const source = read('src/MenuBook3D.tsx');
  const start = source.indexOf('function fitCamera(eased: number) {');
  const end = source.indexOf('\n      function render', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source.slice(start, end), /\btransition\b|moving\.uniforms/);
  const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const W = 2.65, H = 3.65;
  for (const mobile of [false, true]) for (const aspect of [0.55, 1, 1.6, 2.4]) {
    const camera = new THREE.PerspectiveCamera(34, aspect, 0.1, 100);
    const direction = new THREE.Vector3(0, 1, 0.2).normalize();
    const fit = new Function('THREE', 'W', 'H', 'props', 'camera', 'fitPoint', 'viewDirection', 'viewUp', 'opening', 'transition', `${compiled}; return fitCamera;`)(THREE, W, H, { mobile }, camera, new THREE.Vector3(), direction, new THREE.Vector3(0, direction.z, -direction.y), 1, null);
    fit(1); camera.updateMatrixWorld();
    for (const x of [mobile ? -0.12 : -W - 0.12, W + 0.12]) for (const y of [-0.22, 0.12]) for (const z of [-H / 2 - 0.12, H / 2 + 0.12]) {
      const p = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(p.x) <= 0.95 && Math.abs(p.y) <= 0.95 && p.z > -1 && p.z < 1, `${mobile}/${aspect}: cover clipped`);
    }
  }
});

test('book materials isolate each sheet animation and keep the branded stage transparent', () => {
  const source = read('src/MenuBook3D.tsx');
  assert.match(source, /customProgramCacheKey/);
  assert.match(source, /createSheet\('left'\)/);
  assert.match(source, /createSheet\('right'\)/);
  assert.match(source, /createSheet\('moving'\)/);
  assert.match(source, /ShadowMaterial/);
  assert.match(source, /alpha: true/);
  assert.doesNotMatch(source, /scene.background = new THREE.Color\(sceneColors.timber\)/);
});

test('3D menu remains lazy and provides material and lifecycle safeguards', () => {
  const book = read('src/MenuBook3D.tsx');
  const menu = read('src/MenuPage.tsx');
  assert.match(menu, /lazy\(/);
  assert.match(book, /onBeforeCompile|SkinnedMesh/);
  assert.match(book, /normalMap/);
  assert.match(book, /anisotropy/);
  assert.match(book, /webglcontextlost/);
  assert.match(book, /cancelAnimationFrame/);
  assert.match(book, /ResizeObserver/);
  assert.match(book, /pointercancel/);
  assert.match(book, /\.dispose\(\)/);
});

test('folded doors remain against walls rather than projecting across approach paths', async () => {
  const THREE = await import('three');
  const source = read('src/RestaurantScene.tsx');
  const position = source.match(/connectingDoor.position.set\(([^)]+)\)/)[1].split(',').map(Number);
  const angle = source.match(/connectingDoor.rotation.y = ([^;]+);/)[1];
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.66, 1.94));
  const hinge = new THREE.Group(); hinge.position.fromArray(position); hinge.rotation.y = new Function(`return ${angle}`)();
  door.position.set(0, 1.33, 0.94); hinge.add(door); hinge.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(hinge);
  assert.ok(bounds.max.z < -5.8);
  assert.ok(bounds.max.x - bounds.min.x < 0.31, 'open connector leaf must lie flat along its wall');
  for (const side of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.96, 2.66, 0.3));
    const pivot = new THREE.Group(); pivot.position.set(-9 + side * 1.12, 0.1, 2.22); pivot.rotation.y = Math.PI;
    leaf.position.set(-side * 0.48, 1.33, 0); pivot.add(leaf); pivot.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(pivot);
    assert.ok(side < 0 ? b.max.x < -10 : b.min.x > -8, 'front doors must leave the entire entrance clear');
  }
});

test('both restaurant buildings have entrances and a connected interior', () => {
  const source = read('src/RestaurantScene.tsx');
  for (const name of ['left-entrance-door', 'interior-connecting-door', 'backdrop']) assert.ok(source.includes(name), name);
  assert.match(source, /connectingDoor.position.set\(-5.72, 0.1, -5.96\)/);
  assert.match(source, /connectingDoor.rotation.y = Math.PI;/);
  assert.match(source, /hinge.rotation.y = Math.PI;/);
  assert.match(source, /new THREE.Fog\(palette.ink, 24, 85\)/);
  assert.match(source, /distanceFog.color.copy\(scene.background\)/);
});

test('demo batches static geometry and isolates production diagnostics', () => {
  const scene = read('src/RestaurantScene.tsx');
  assert.match(scene, /static-architecture-batch/);
  assert.match(scene, /animatedRoots.has\(object\)/);
  assert.match(scene, /import.meta.env.DEV/);
  assert.match(scene, /dataset.renderedFps/);
  assert.match(scene, /dataset.drawCalls/);
  assert.match(read('src/main.tsx'), /lazy\(\(\) => import\('\.\/MenuPage'\)\)/);
  const deployment = JSON.parse(read('vercel.json'));
  assert.ok(deployment.rewrites.some(rule => rule.source === '/thuc-don' && rule.destination === '/index.html'));
  assert.match(read('.vercelignore'), /\.env\*/);
});

test('scroll lighting fills shadows without exposure spikes or abrupt AO', async () => {
  const THREE = await import('three');
  const source = read('src/RestaurantScene.tsx');
  const settings = source.match(/const sceneLighting = ([\s\S]*?) as const;/);
  const expression = source.match(/const aoIntensity = \(progress: number\) => ([^;]+);/);
  assert.ok(settings && expression);
  const lighting = new Function(`return (${settings[1]})`)();
  const intensity = new Function('THREE', 'sceneLighting', 'progress', `return ${expression[1]}`);
  assert.equal(lighting.dark.hemisphere, 0.55);
  assert.equal(lighting.dark.fill, 0.35);
  assert.equal(lighting.dark.environment, 0.35);
  assert.equal(lighting.dark.interior, 12);
  assert.equal(lighting.dark.entrance, 16);
  assert.match(source, /light.color.set\(palette.cream\).lerp\(new THREE.Color\(palette.amber\), dark \? 0.35 : 1\)/);
  assert.match(source, /housePalette\[index\], dark \? 0.06 : 0.35/);
  assert.equal(lighting.dark.exposure, 1.05);
  assert.ok(lighting.vignette <= 0.08);
  assert.equal(intensity(THREE, lighting, 0.24), 0);
  assert.equal(intensity(THREE, lighting, 0.88), 0);
  assert.ok(intensity(THREE, lighting, 0.241) < 0.001);
  for (let step = 0; step <= 1000; step++) {
    const value = intensity(THREE, lighting, step / 1000);
    assert.ok(value >= 0 && value <= 0.35);
  }
});

test('facade logo preserves source colors without emissive washout', () => {
  const source = read('src/RestaurantScene.tsx');
  assert.match(source, /const signMaterial = new THREE.MeshBasicMaterial\(\{ map: letterTexture, toneMapped: false \}\)/);
  assert.doesNotMatch(source, /signMaterial.emissiveIntensity/);
  assert.match(source, /ledBase = dark \? 1.9 : 0.2/);
});

test('scene theme updates retain natural materials and dispose postprocessing', () => {
  const scene = read('src/RestaurantScene.tsx');
  assert.match(scene, /UnrealBloomPass/);
  assert.match(scene, /OutputPass/);
  assert.match(scene, /sceneColors\.skin/);
  assert.match(scene, /sceneColors\.steak/);
  assert.match(scene, /\[theme\]/);
  assert.match(scene, /passes.forEach\(pass => pass.dispose\(\)\)/);
  assert.match(scene, /composer\?\.dispose\(\)/);
  assert.match(scene, /composer\?\.setSize\(width, height\)/);
  assert.doesNotMatch(scene, /#[\da-f]{6}\b/i);
});

test('copy and animation respect design constraints', () => {
  assert.doesNotMatch(read('src/App.tsx') + read('src/content.ts'), /[\u2013\u2014]/);
  const scene = read('src/RestaurantScene.tsx');
  assert.match(scene, /prefers-reduced-motion/);
  assert.match(scene, /if \(previousEntered.current === entered\) return;/);
  assert.match(scene, /gsap.killTweensOf\(progress\)/);
  assert.match(scene, /geometries.forEach\(item => item.dispose\(\)\)/);
  assert.match(scene, /intersection\?\.disconnect\(\)/);
  assert.match(scene, /cancelAnimationFrame/);
  assert.match(scene, /document.hidden/);
  assert.match(scene, /welcome-host/);
  assert.match(scene, /welcome-receptionist/);
  assert.match(scene, /welcome-board/);
  assert.match(scene, /facade-side/);
  assert.match(scene, /pedestrian-/);
  assert.match(scene, /ngoc-hieu-logo-white\.jpg/);
  assert.match(scene, /facade-ticker-/);
  assert.match(scene, /CapsuleGeometry/);
  assert.match(scene, /food-steak/);
  assert.match(scene, /led-strip-/);
  assert.match(scene, /street-tree-/);
  assert.match(scene, /falling-leaf-/);
  assert.match(scene, /walking-dog/);
  assert.match(scene, /dog-leash/);
  assert.match(scene, /ResizeObserver/);
  assert.match(scene, /closest<HTMLElement>\('\.hero'\)/);
  assert.match(scene, /new THREE.CanvasTexture\(signCanvas\)/);
  assert.match(scene, /fillText\('Ngọc Hiếu kính chào'/);
  assert.match(scene, /journey-finale-logo/);
  assert.match(scene, /steak-steam-/);
  assert.match(scene, /leafMaterials/);
  assert.doesNotMatch(scene, /brand-table-menu-/);
  assert.match(scene, /road-ground/);
  assert.match(scene, /sidewalk-ground/);
  assert.match(scene, /restaurant-building-right/);
  assert.match(scene, /restaurant-building-left/);
  assert.match(scene, /connector-opening/);
  assert.match(scene, /traffic-car-/);
  assert.match(scene, /street-house-/);
  assert.match(scene, /'front-left'/);
  assert.match(scene, /'front-right'/);
  assert.match(scene, /document.fonts.load/);
  assert.match(scene, /textures.forEach\(item => item.dispose\(\)\)/);
  assert.match(scene, /gsap.fromTo\(progress/);
  assert.match(scene, /ScrollTrigger/);
  assert.match(scene, /mobile: '\(max-width: 899px\)'/);
  assert.match(scene, /start: ["']top top["']/);
  assert.match(scene, /pin: true/);
  assert.match(scene, /scrub: 1/);
  assert.doesNotMatch(scene, /addEventListener\(["']scroll/);
});
