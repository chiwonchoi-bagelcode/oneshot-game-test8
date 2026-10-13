import * as THREE from 'three';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  container: HTMLElement;
  lowEnd: boolean;
  env: THREE.Texture;
}

function makeOutdoorEnv(renderer: THREE.WebGLRenderer) {
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const colors: number[] = [];
  const pos = geo.attributes.position;
  const top = new THREE.Color('#8fc0f0');
  const hor = new THREE.Color('#fff6e6');
  const bot = new THREE.Color('#5e8a34');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y > 0) c.copy(hor).lerp(top, Math.pow(y, 0.6));
    else c.copy(hor).lerp(bot, Math.min(1, -y * 3));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8, 6.5) }));
  sun.position.set(-4, 7, 3);
  envScene.add(sun);
  // a few bright "windows" give clay its soft speculars from many angles
  const soft = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.1) });
  for (const [x, y, z] of [[6, 4, -3], [-5, 3, -6], [2, 5, 7]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), soft);
    p.position.set(x, y, z);
    p.lookAt(0, 0, 0);
    envScene.add(p);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(envScene, 0.03);
  pm.dispose();
  return rt.texture;
}

export function createStage(container: HTMLElement): Stage {
  const lowEnd = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) && (navigator.hardwareConcurrency || 4) <= 4;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  const camera = new THREE.PerspectiveCamera(50, 9 / 16, 0.05, 80);
  const env = makeOutdoorEnv(renderer);
  const stage = { renderer, camera, container, lowEnd, env } as unknown as Stage;
  buildScene(stage);
  return stage;
}

/** (Re)build a fresh scene graph with lights; used at boot and on retry. */
export function buildScene(stage: Stage) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bfdcef');
  scene.fog = new THREE.Fog('#d9e8d6', 16, 38);
  scene.environment = stage.env;
  scene.environmentIntensity = 0.85;

  const hemi = new THREE.HemisphereLight('#dcecff', '#6d8f3c', 1.05);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#fff0d6', 2.7);
  sun.position.set(-3.5, 9, 4);
  sun.target.position.set(0, 0, -0.5);
  sun.castShadow = true;
  const sm = stage.lowEnd ? 1024 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = -4.2; sc.right = 4.2; sc.top = 5.2; sc.bottom = -5.2; sc.near = 1; sc.far = 25;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight('#ffe1c4', 0.55);
  fill.position.set(5, 3, 6);
  scene.add(fill);
  stage.scene = scene;
  stage.sun = sun;
  stage.hemi = hemi;
  return scene;
}
