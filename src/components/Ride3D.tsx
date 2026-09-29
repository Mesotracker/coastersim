import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { BuiltTrack, Frame, GRAVITY, METERS_PER_UNIT, frameAt, makeFrame } from '../lib/track';
import { CoasterMaterial, SimState, TelemetryPoint } from '../lib/physics';
import { Theme } from '../lib/themes';

export type CamMode = 'pov' | 'chase' | 'orbit';
export type WeatherType = 'day' | 'sunset' | 'night' | 'storm';

export type SupportStyle = 'auto' | 'tubular' | 'wooden' | 'truss' | 'flanged';
export type SupportDensity = 'sparse' | 'medium' | 'normal' | 'dense';

export interface SupportConfig {
  style: SupportStyle;
  density: SupportDensity;
  color?: string;
  crossBracing: boolean;
}

interface Props {
  built: BuiltTrack;
  simRef: React.RefObject<SimState>;
  theme: Theme;
  material?: CoasterMaterial;
  camMode: CamMode;
  weather?: WeatherType;
  aerialFollow?: boolean;
  supportConfig?: SupportConfig;
  gForceHeatMap?: boolean;
  telemetry?: TelemetryPoint[];
  /** Three.js raycast selection from the 3D rails/supports. */
  onSelectPiece?: (index: number) => void;
}

function getGColor(g: number, outColor: THREE.Color): THREE.Color {
  if (g < 0.2) {
    // Airtime: cyan/sky blue
    return outColor.setRGB(0.1, 0.8, 1.0);
  } else if (g < 1.0) {
    // Low G: cyan-emerald
    const t = (g - 0.2) / 0.8;
    return outColor.setRGB(0.1 + 0.15 * t, 0.8 + 0.12 * t, 1.0 - 0.65 * t);
  } else if (g < 2.2) {
    // Nominal / Comfortable: vibrant emerald green
    const t = (g - 1.0) / 1.2;
    return outColor.setRGB(0.25 + 0.65 * t, 0.92, 0.35 - 0.25 * t);
  } else if (g < 3.5) {
    // Moderate: bright amber / yellow
    const t = (g - 2.2) / 1.3;
    return outColor.setRGB(0.95 + 0.05 * t, 0.92 - 0.38 * t, 0.1);
  } else if (g < 4.8) {
    // High G: vivid orange
    const t = (g - 3.5) / 1.3;
    return outColor.setRGB(1.0, 0.54 - 0.34 * t, 0.1);
  } else {
    // Extreme / Danger: crimson red
    const t = Math.min(1, (g - 4.8) / 3.0);
    return outColor.setRGB(1.0, 0.2 - 0.16 * t, 0.2 + 0.2 * t);
  }
}

class PointsCurve extends THREE.Curve<THREE.Vector3> {
  pts: THREE.Vector3[];
  constructor(pts: THREE.Vector3[]) {
    super();
    this.pts = pts;
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const n = this.pts.length - 1;
    const f = Math.max(0, Math.min(1, t)) * n;
    const i0 = Math.floor(f);
    const i1 = Math.min(n, i0 + 1);
    return target.copy(this.pts[i0]).lerp(this.pts[i1], f - i0);
  }
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(canvas: HTMLCanvasElement, anisotropy: number, repeat = 180) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = anisotropy;
  return texture;
}

/** Procedural PBR terrain maps keep the standalone build detailed and asset-free. */
function groundTextures(anisotropy: number) {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = bumpCanvas.width = bumpCanvas.height = size;
  const color = colorCanvas.getContext('2d')!;
  const bump = bumpCanvas.getContext('2d')!;
  const rnd = mulberry(101);

  color.fillStyle = '#3f7333';
  color.fillRect(0, 0, size, size);
  bump.fillStyle = '#777';
  bump.fillRect(0, 0, size, size);

  // Layer broad turf variation, exposed soil, clover and high-frequency grass blades.
  for (let i = 0; i < 3200; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 0.7 + rnd() * 7;
    const val = rnd();
    color.fillStyle = val < 0.09
      ? 'rgba(95,76,43,.42)'
      : val < 0.48
        ? 'rgba(43,91,39,.58)'
        : val < 0.82
          ? 'rgba(83,137,55,.50)'
          : 'rgba(134,164,72,.34)';
    color.beginPath();
    color.arc(x, y, r, 0, Math.PI * 2);
    color.fill();
    const relief = Math.floor(82 + val * 90);
    bump.fillStyle = `rgba(${relief},${relief},${relief},.34)`;
    bump.fillRect(x, y, Math.max(1, r * 0.7), Math.max(1, r * 0.7));
  }

  color.lineWidth = 1;
  bump.lineWidth = 1;
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const lean = (rnd() - 0.5) * 4;
    const blade = 2 + rnd() * 6;
    color.strokeStyle = rnd() > 0.45 ? 'rgba(158,194,91,.42)' : 'rgba(24,78,34,.50)';
    color.beginPath();
    color.moveTo(x, y);
    color.lineTo(x + lean, y - blade);
    color.stroke();
    bump.strokeStyle = 'rgba(205,205,205,.48)';
    bump.beginPath();
    bump.moveTo(x, y);
    bump.lineTo(x + lean, y - blade);
    bump.stroke();
  }

  const map = canvasTexture(colorCanvas, anisotropy, 220);
  map.colorSpace = THREE.SRGBColorSpace;
  const bumpMap = canvasTexture(bumpCanvas, anisotropy, 220);
  return { map, bumpMap };
}

function surfaceDetailTexture(kind: CoasterMaterial, anisotropy: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rnd = mulberry(kind === 'wood' ? 731 : kind === 'plastic' ? 911 : 313);
  g.fillStyle = '#888';
  g.fillRect(0, 0, 256, 256);
  if (kind === 'wood') {
    for (let y = 0; y < 256; y += 5) {
      g.strokeStyle = `rgba(${65 + Math.floor(rnd() * 80)},${65 + Math.floor(rnd() * 80)},${65 + Math.floor(rnd() * 80)},.55)`;
      g.beginPath();
      g.moveTo(0, y + rnd() * 3);
      for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.07 + rnd()) * 3);
      g.stroke();
    }
  } else if (kind === 'metal') {
    for (let y = 0; y < 256; y += 2) {
      const v = 105 + Math.floor(rnd() * 55);
      g.fillStyle = `rgba(${v},${v},${v},.42)`;
      g.fillRect(0, y, 256, 1);
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = 'rgba(225,225,225,.16)';
      g.fillRect(rnd() * 256, rnd() * 256, 12 + rnd() * 50, 0.7);
    }
  } else {
    for (let i = 0; i < 900; i++) {
      const v = 112 + Math.floor(rnd() * 38);
      g.fillStyle = `rgba(${v},${v},${v},.22)`;
      g.fillRect(rnd() * 256, rnd() * 256, 1.2, 1.2);
    }
  }
  return canvasTexture(c, anisotropy, kind === 'wood' ? 16 : 28);
}

export default function Ride3D({
  built,
  simRef,
  theme,
  material = 'metal',
  camMode,
  weather = 'day',
  aerialFollow = true,
  supportConfig,
  gForceHeatMap = false,
  telemetry,
  onSelectPiece,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    trackGroup: THREE.Group;
    sceneryGroup: THREE.Group;
    ground: THREE.Mesh;
    terrainMaps: { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture };
    surfaceMaps: Record<CoasterMaterial, THREE.CanvasTexture>;
    raycaster: THREE.Raycaster;
    raycastTargets: THREE.Object3D[];
    surveyMarker: THREE.Group;
    surveyLabel: HTMLDivElement;
    hoveredPiece: number | null;
    sun: THREE.DirectionalLight;
    hemi: THREE.HemisphereLight;
    fillLight: THREE.DirectionalLight;
    skyMat: THREE.ShaderMaterial;
    cockpit: THREE.Group;
    cars: THREE.Group[];
    carMat: THREE.MeshStandardMaterial;
    chassisMat: THREE.MeshStandardMaterial;
    seatMat: THREE.MeshStandardMaterial;
    chromeMat: THREE.MeshStandardMaterial;
    headlights: THREE.SpotLight[];
    rainPoints: THREE.Points;
    rainPositions: Float32Array;
    rainVelocities: Float32Array;
    aerialDrone: THREE.Group;
    pointerBeam: THREE.Mesh;
    targetReticle: THREE.Mesh;
    rotors: THREE.Mesh[];
    camPos: THREE.Vector3;
    camQuat: THREE.Quaternion;
    aerialAzimuth: number;
    aerialElevation: number;
    aerialDist: number;
    aerialTarget: THREE.Vector3;
    fov: number;
    ready: boolean;
  } | null>(null);
  const propsRef = useRef({ built, simRef, theme, material, camMode, weather, aerialFollow, supportConfig, onSelectPiece });
  propsRef.current = { built, simRef, theme, material, camMode, weather, aerialFollow, supportConfig, onSelectPiece };

  // ------------------------------------------------------------------ setup
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;
    renderer.setSize(wrap.clientWidth || 600, wrap.clientHeight || 400);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Exponential atmospheric extinction avoids a visible linear fog wall on the expanded map.
    scene.fog = new THREE.FogExp2(0xcfe8ff, 0.00018);

    const camera = new THREE.PerspectiveCamera(66, 1, 0.25, 30000);
    camera.position.set(0, 40, 120);

    // Sky dome with realistic atmospheric gradation
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#1e6fd8') },
        mid: { value: new THREE.Color('#85bff5') },
        bottom: { value: new THREE.Color('#e0f0fe') },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 c = mix(bottom, mid, smoothstep(-0.04, 0.32, h));
          c = mix(c, top, smoothstep(0.28, 0.90, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(18000, 36, 24), skyMat);
    sky.frustumCulled = false;
    scene.add(sky);

    // Lights
    const hemi = new THREE.HemisphereLight(0xcfe6fe, 0x274314, 1.15);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfffaee, 2.2);
    sun.position.set(360, 620, 240);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    scene.add(sun.target);

    // Directional rim/fill light to give specular highlights to shadowed tracks
    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.65);
    fillLight.position.set(-300, 400, -260);
    scene.add(fillLight);

    // Ground plane with procedural albedo + relief maps and hardware-max anisotropy.
    const maxAnisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    const terrainMaps = groundTextures(maxAnisotropy);
    const surfaceMaps: Record<CoasterMaterial, THREE.CanvasTexture> = {
      metal: surfaceDetailTexture('metal', maxAnisotropy),
      wood: surfaceDetailTexture('wood', maxAnisotropy),
      plastic: surfaceDetailTexture('plastic', maxAnisotropy),
    };
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000, 1, 1),
      new THREE.MeshStandardMaterial({
        map: terrainMaps.map,
        bumpMap: terrainMaps.bumpMap,
        bumpScale: 0.72,
        roughness: 0.91,
        metalness: 0.015,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const trackGroup = new THREE.Group();
    scene.add(trackGroup);
    const sceneryGroup = new THREE.Group();
    scene.add(sceneryGroup);

    // Precision raycasting survey marker used by the interactive 3D inspector.
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = 3;
    const surveyMarker = new THREE.Group();
    const surveyRingMat = new THREE.MeshBasicMaterial({
      color: 0xf2c14e,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const surveyRing = new THREE.Mesh(new THREE.RingGeometry(1.4, 2.05, 32), surveyRingMat);
    surveyMarker.add(surveyRing);
    const surveyCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    surveyMarker.add(surveyCore);
    surveyMarker.renderOrder = 50;
    surveyMarker.visible = false;
    scene.add(surveyMarker);

    const surveyLabel = document.createElement('div');
    surveyLabel.className = 'raycast-survey-label';
    surveyLabel.style.cssText = [
      'position:absolute',
      'display:none',
      'z-index:8',
      'pointer-events:none',
      'padding:6px 9px',
      'border:1px solid rgba(242,193,78,.65)',
      'border-radius:9px',
      'background:rgba(6,8,11,.88)',
      'color:#f8e8b0',
      'font:700 10px/1.2 ui-monospace,SFMono-Regular,monospace',
      'letter-spacing:.04em',
      'box-shadow:0 8px 28px rgba(0,0,0,.45)',
      'backdrop-filter:blur(8px)',
    ].join(';');
    wrap.appendChild(surveyLabel);

    // Train cars - High-fidelity PBR Coaster Train
    const carMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.20,
      metalness: 0.32,
    });
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.28,
      metalness: 0.85,
    });
    const seatMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.82,
      metalness: 0.08,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.12,
      metalness: 0.95,
    });
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.35,
      metalness: 0.80,
    });

    const cars: THREE.Group[] = [];
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Group();

      // Steel undercarriage / chassis
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.8, 11.2), chassisMat);
      chassis.position.y = -0.5;
      chassis.castShadow = true;
      c.add(chassis);

      // Running wheels & guide wheels on rail bogies
      for (const side of [-3.1, 3.1]) {
        for (const end of [-4.2, 4.2]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.45, 12), wheelMat);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(side, -1.0, end);
          c.add(wheel);
        }
      }

      // Fiberglass aerodynamic shell
      const body = new THREE.Mesh(new THREE.BoxGeometry(7.4, 2.6, 11.2), i === 0 ? carMat : chassisMat);
      body.position.y = 0.9;
      body.castShadow = true;
      c.add(body);

      // Side trim accents
      const trim = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.35, 11.4), chromeMat);
      trim.position.y = 1.3;
      c.add(trim);

      // Dual bucket seats (front row and back row)
      for (const z of [2.8, -2.8]) {
        // Seat cushion and backrest
        const seat = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.6, 1.3), seatMat);
        seat.position.set(0, 2.5, z);
        seat.castShadow = true;
        c.add(seat);

        // Headrest pads
        for (const x of [-1.8, 1.8]) {
          const headrest = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.9), seatMat);
          headrest.position.set(x, 4.0, z);
          headrest.castShadow = true;
          c.add(headrest);
        }

        // Chrome lap bar restraint
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5.4, 8), chromeMat);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, 2.8, z - 1.1);
        c.add(bar);
      }

      // Front car features: sculpted nosecone, emblem, and headlights
      if (i === 0) {
        const nosecone = new THREE.Mesh(new THREE.ConeGeometry(3.3, 5.2, 6), carMat);
        nosecone.rotation.x = -Math.PI / 2;
        nosecone.position.set(0, 0.8, -7.6);
        nosecone.castShadow = true;
        c.add(nosecone);

        // Chrome front intake grill
        const grill = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.9, 0.6), chromeMat);
        grill.position.set(0, 0.5, -9.2);
        c.add(grill);

        // Dual headlights with real dynamic SpotLights
        const lightMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xfef08a,
          emissiveIntensity: 0.9,
          roughness: 0.1,
        });
        for (const lx of [-1.5, 1.5]) {
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), lightMat);
          lamp.position.set(lx, 1.2, -8.6);
          c.add(lamp);
        }

        const headlightL = new THREE.SpotLight(0xfff7ed, 0, 340, Math.PI / 5, 0.45, 1.1);
        headlightL.position.set(-1.5, 1.2, -8.6);
        const targetL = new THREE.Object3D();
        targetL.position.set(-1.5, 0.5, -45);
        c.add(headlightL);
        c.add(targetL);
        headlightL.target = targetL;

        const headlightR = new THREE.SpotLight(0xfff7ed, 0, 340, Math.PI / 5, 0.45, 1.1);
        headlightR.position.set(1.5, 1.2, -8.6);
        const targetR = new THREE.Object3D();
        targetR.position.set(1.5, 0.5, -45);
        c.add(headlightR);
        c.add(targetR);
        headlightR.target = targetR;
      }

      scene.add(c);
      cars.push(c);
    }

    const headlights: THREE.SpotLight[] = [];
    cars[0].traverse((o) => {
      if (o instanceof THREE.SpotLight) headlights.push(o);
    });

    // Storm rain particles
    const rainCount = 2000;
    const rainGeo = new THREE.BufferGeometry();
    const rainPositions = new Float32Array(rainCount * 3);
    const rainVelocities = new Float32Array(rainCount);
    for (let i = 0; i < rainCount; i++) {
      rainPositions[i * 3] = (Math.random() - 0.5) * 1400;
      rainPositions[i * 3 + 1] = Math.random() * 600;
      rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 1400;
      rainVelocities[i] = 220 + Math.random() * 120;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    const rainMat = new THREE.PointsMaterial({
      color: 0x93c5fd,
      size: 2.2,
      transparent: true,
      opacity: 0.65,
    });
    const rainPoints = new THREE.Points(rainGeo, rainMat);
    rainPoints.visible = false;
    scene.add(rainPoints);

    // ================================================================
    // AERIAL OBSERVER: Movable 3D Drone Model with Pointer
    // ================================================================
    const aerialDrone = new THREE.Group();
    const droneBodyMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.88,
      roughness: 0.22,
    });
    const droneChassis = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.4, 6.4), droneBodyMat);
    droneChassis.castShadow = true;
    aerialDrone.add(droneChassis);

    // Canopy top with glowing cyan visor
    const canopyGeo = new THREE.CylinderGeometry(1.6, 2.0, 1.1, 16);
    canopyGeo.scale(1, 0.7, 1.4);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0369a1,
      emissiveIntensity: 0.7,
      roughness: 0.12,
      metalness: 0.85,
    });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 0.7, 0.4);
    aerialDrone.add(canopy);

    // 4 Quadcopter rotor arms and blades
    const rotors: THREE.Mesh[] = [];
    const armCoords = [
      { x: -3.8, z: -3.6, led: 0xef4444 }, // port rear
      { x: 3.8, z: -3.6, led: 0x22c55e },  // stbd rear
      { x: -3.8, z: 3.6, led: 0xef4444 },  // port front
      { x: 3.8, z: 3.6, led: 0x22c55e },   // stbd front
    ];
    armCoords.forEach((pos) => {
      // Boom arm strut
      const armGeo = new THREE.CylinderGeometry(0.24, 0.24, 4.6, 8);
      const armMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9, roughness: 0.3 });
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = Math.atan2(pos.z, pos.x);
      arm.position.set(pos.x * 0.5, 0, pos.z * 0.5);
      aerialDrone.add(arm);

      // Motor hub
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.7, 12), droneBodyMat);
      hub.position.set(pos.x, 0.2, pos.z);
      aerialDrone.add(hub);

      // Propeller rotor blade (spins dynamically)
      const bladeGeo = new THREE.BoxGeometry(6.4, 0.08, 0.65);
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.78,
        roughness: 0.25,
      });
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.set(pos.x, 0.62, pos.z);
      aerialDrone.add(blade);
      rotors.push(blade);

      // Wingtip LED
      const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 8, 8),
        new THREE.MeshBasicMaterial({ color: pos.led }),
      );
      led.position.set(pos.x, 0.75, pos.z);
      aerialDrone.add(led);
    });

    // Underslung camera gimbal pod
    const gimbal = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x020617, roughness: 0.3, metalness: 0.8 }),
    );
    gimbal.position.set(0, -0.9, 1.2);
    aerialDrone.add(gimbal);

    // Glowing cyan camera optical sensor
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.35, 16),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, -0.9, 2.2);
    aerialDrone.add(lens);

    // Directional Pointer Beam (Targeting guide beam emanating toward target)
    const pointerBeamGeo = new THREE.CylinderGeometry(0.12, 0.55, 1, 10);
    pointerBeamGeo.translate(0, 0.5, 0); // anchor top at gimbal
    pointerBeamGeo.rotateX(Math.PI / 2); // point forward toward +Z
    const pointerBeamMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const pointerBeam = new THREE.Mesh(pointerBeamGeo, pointerBeamMat);
    pointerBeam.position.set(0, -0.9, 2.2);
    aerialDrone.add(pointerBeam);

    scene.add(aerialDrone);

    // Target reticle ring on target point
    const reticleGeo = new THREE.RingGeometry(2.4, 3.2, 32);
    reticleGeo.rotateX(-Math.PI / 2);
    const targetReticle = new THREE.Mesh(
      reticleGeo,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    scene.add(targetReticle);

    // Cockpit for POV camera (first-person view)
    const cockpit = new THREE.Group();
    const hoodMat = carMat; // Matches the lead car finish
    const nose = new THREE.Mesh(new THREE.BoxGeometry(7.2, 2.2, 7.5), hoodMat);
    nose.position.set(0, -3.1, -4.2);
    cockpit.add(nose);

    const lip = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.6, 1.2), chromeMat);
    lip.position.set(0, -2.1, -7.4);
    cockpit.add(lip);

    // Front chrome safety handlebar with rubber grips
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 5.4, 8), chromeMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, -1.5, -2.8);
    cockpit.add(bar);

    const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 2.2, 6), chromeMat);
    post1.position.set(-2.5, -2.5, -2.8);
    cockpit.add(post1);
    const post2 = post1.clone();
    post2.position.x = 2.5;
    cockpit.add(post2);

    camera.add(cockpit);
    scene.add(camera);

    stateRef.current = {
      renderer,
      scene,
      camera,
      trackGroup,
      sceneryGroup,
      ground,
      terrainMaps,
      surfaceMaps,
      raycaster,
      raycastTargets: [],
      surveyMarker,
      surveyLabel,
      hoveredPiece: null,
      sun,
      hemi,
      fillLight,
      skyMat,
      cockpit,
      cars,
      carMat,
      chassisMat,
      seatMat,
      chromeMat,
      headlights,
      rainPoints,
      rainPositions,
      rainVelocities,
      aerialDrone,
      pointerBeam,
      targetReticle,
      rotors,
      camPos: new THREE.Vector3(0, 40, 120),
      camQuat: new THREE.Quaternion(),
      aerialAzimuth: 0.85,
      aerialElevation: 0.45,
      aerialDist: 260,
      aerialTarget: new THREE.Vector3(0, 30, 0),
      fov: 66,
      ready: true,
    };

    // ================================================================
    // POINTER & MULTI-TOUCH CONTROLS (Mobile Pinch-Zoom & Aerial Drone)
    // ================================================================
    let isDragging = false;
    let isPanning = false;
    let lastX = 0;
    let lastY = 0;
    const activePointers = new Map<number, { x: number; y: number }>();
    let initialPinchDist = 0;
    let initialAerialDist = 260;
    let dragTravel = 0;

    renderer.domElement.style.touchAction = 'none';

    const raycastFromPointer = (e: PointerEvent) => {
      const st = stateRef.current;
      if (!st || propsRef.current.camMode !== 'orbit' || st.raycastTargets.length === 0) {
        if (st) {
          st.hoveredPiece = null;
          st.surveyMarker.visible = false;
          st.surveyLabel.style.display = 'none';
        }
        return null;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      st.raycaster.setFromCamera(ndc, st.camera);
      const hit = st.raycaster.intersectObjects(st.raycastTargets, false)[0];
      if (!hit) {
        st.hoveredPiece = null;
        st.surveyMarker.visible = false;
        st.surveyLabel.style.display = 'none';
        renderer.domElement.style.cursor = isDragging ? 'grabbing' : 'grab';
        return null;
      }

      // Resolve the ray hit to the nearest centerline sample and therefore piece.
      const samples = propsRef.current.built.samples;
      let bestPiece: number | null = null;
      let bestDistance = Infinity;
      for (let i = 0; i < samples.length; i += 2) {
        const sm = samples[i];
        const dx = sm.px - hit.point.x;
        const dy = sm.py - hit.point.y;
        const dz = sm.pz - hit.point.z;
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPiece = sm.piece;
        }
      }
      st.hoveredPiece = bestPiece;
      st.surveyMarker.position.copy(hit.point);
      st.surveyMarker.visible = bestPiece !== null;
      if (bestPiece !== null) {
        const piece = propsRef.current.built.pieces?.[bestPiece];
        st.surveyLabel.textContent = `RAYCAST  •  PIECE ${bestPiece + 1}  •  ${piece?.kind ?? 'TRACK'}`.toUpperCase();
        st.surveyLabel.style.display = 'block';
        st.surveyLabel.style.left = `${e.clientX - rect.left + 14}px`;
        st.surveyLabel.style.top = `${e.clientY - rect.top + 14}px`;
        renderer.domElement.style.cursor = 'crosshair';
      }
      return bestPiece;
    };

    const onPointerDown = (e: PointerEvent) => {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        initialPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        initialAerialDist = stateRef.current?.aerialDist ?? 260;
        return;
      }

      if (propsRef.current.camMode !== 'orbit') return;
      isDragging = true;
      isPanning = e.button === 2 || e.shiftKey;
      dragTravel = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {}
      renderer.domElement.style.cursor = 'grabbing';
    };

    const onPointerMove = (e: PointerEvent) => {
      if (activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      const st = stateRef.current;
      if (!st) return;

      // Multi-touch pinch-to-zoom for mobile & tablets
      if (activePointers.size >= 2) {
        const pts = Array.from(activePointers.values());
        const currentPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (initialPinchDist > 12) {
          const ratio = initialPinchDist / Math.max(12, currentPinchDist);
          st.aerialDist = Math.max(30, Math.min(9000, initialAerialDist * ratio));
        }
        return;
      }

      if (!isDragging) {
        raycastFromPointer(e);
        return;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      dragTravel += Math.hypot(dx, dy);
      lastX = e.clientX;
      lastY = e.clientY;
      st.surveyMarker.visible = false;
      st.surveyLabel.style.display = 'none';

      if (isPanning) {
        // Pan aerial target on ground plane
        const forward = new THREE.Vector3();
        st.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const panSpeed = st.aerialDist * 0.0018;
        st.aerialTarget.addScaledVector(right, -dx * panSpeed);
        st.aerialTarget.addScaledVector(forward, dy * panSpeed);
      } else {
        // Rotate aerial azimuth & elevation with precision pointer
        st.aerialAzimuth -= dx * 0.006;
        st.aerialElevation = Math.max(0.06, Math.min(1.46, st.aerialElevation + dy * 0.005));
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) initialPinchDist = 0;
      const wasClick = isDragging && !isPanning && dragTravel < 5;
      isDragging = false;
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {}
      if (wasClick) {
        const piece = raycastFromPointer(e);
        if (piece !== null) propsRef.current.onSelectPiece?.(piece);
      }
      renderer.domElement.style.cursor = propsRef.current.camMode === 'orbit' ? 'grab' : 'default';
    };

    const onPointerLeave = () => {
      if (isDragging) return;
      const st = stateRef.current;
      if (!st) return;
      st.hoveredPiece = null;
      st.surveyMarker.visible = false;
      st.surveyLabel.style.display = 'none';
    };

    const onWheel = (e: WheelEvent) => {
      if (propsRef.current.camMode !== 'orbit') return;
      const st = stateRef.current;
      if (!st) return;
      e.preventDefault();
      st.aerialDist = Math.max(30, Math.min(3200, st.aerialDist * (1 + e.deltaY * 0.0012)));
    };

    const onContextMenu = (e: MouseEvent) => {
      if (propsRef.current.camMode === 'orbit') e.preventDefault();
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth || 1;
      const h = wrap.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      terrainMaps.map.dispose();
      terrainMaps.bumpMap.dispose();
      Object.values(surfaceMaps).forEach((texture) => texture.dispose());
      renderer.dispose();
      if (renderer.domElement.parentElement === wrap) wrap.removeChild(renderer.domElement);
      if (surveyLabel.parentElement === wrap) wrap.removeChild(surveyLabel);
      stateRef.current = null;
    };
  }, []);

  // --------------------------------------------------- build track + scenery
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const st = stateRef.current;
      if (!st) return;
      const S = built.samples;

      const dispose = (g: THREE.Group) => {
        g.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          const mat = m.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else if (mat) mat.dispose();
        });
        g.clear();
      };
      st.raycastTargets.length = 0;
      st.surveyMarker.visible = false;
      st.surveyLabel.style.display = 'none';
      dispose(st.trackGroup);
      dispose(st.sceneryGroup);
      if (S.length < 4) return;

      const G = built.groundY;
      // Expanded adaptive park map: enough terrain for large custom circuits without wasting fill-rate.
      const worldSize = Math.max(6500, Math.min(24000, built.radius3 * 9 + 3200));
      st.ground.geometry.dispose();
      st.ground.geometry = new THREE.PlaneGeometry(worldSize, worldSize, 1, 1);
      st.ground.position.set(built.center3.x, G, built.center3.z);
      st.aerialDist = Math.max(st.aerialDist, Math.min(2200, built.radius3 * 1.35));

      // Update train car finishes according to chosen material
      if (material === 'wood') {
        st.carMat.color.set(0x9a3412);
        st.carMat.roughness = 0.58;
        st.carMat.metalness = 0.12;
        st.chassisMat.color.set(0x27272a);
        st.chassisMat.roughness = 0.52;
        st.chassisMat.metalness = 0.70;
        st.seatMat.color.set(0x451a03);
        st.seatMat.roughness = 0.88;
        st.chromeMat.color.set(0xd97706);
        st.chromeMat.roughness = 0.28;
        st.chromeMat.metalness = 0.85;
      } else if (material === 'plastic') {
        st.carMat.color.set(theme.car);
        st.carMat.roughness = 0.22;
        st.carMat.metalness = 0.04;
        st.chassisMat.color.set(0x1e293b);
        st.chassisMat.roughness = 0.35;
        st.chassisMat.metalness = 0.08;
        st.seatMat.color.set(0x0f172a);
        st.seatMat.roughness = 0.40;
        st.chromeMat.color.set(0xffffff);
        st.chromeMat.roughness = 0.20;
        st.chromeMat.metalness = 0.25;
      } else {
        // Steel / Metal default
        st.carMat.color.set(theme.car);
        st.carMat.roughness = 0.20;
        st.carMat.metalness = 0.32;
        st.chassisMat.color.set(0x0f172a);
        st.chassisMat.roughness = 0.28;
        st.chassisMat.metalness = 0.85;
        st.seatMat.color.set(0x18181b);
        st.seatMat.roughness = 0.82;
        st.chromeMat.color.set(0xf1f5f9);
        st.chromeMat.roughness = 0.12;
        st.chromeMat.metalness = 0.95;
      }

      const n = S.length;
      const T = new THREE.Vector3();
      const N = new THREE.Vector3();
      const R = new THREE.Vector3();
      const P = new THREE.Vector3();
      const left: THREE.Vector3[] = [];
      const right: THREE.Vector3[] = [];
      const spine: THREE.Vector3[] = [];
      const nbArr: THREE.Vector3[] = [];
      const rbArr: THREE.Vector3[] = [];
      const GAP = 3.1;

      for (let i = 0; i < n; i++) {
        const s = S[i];
        T.set(built.tan[i * 3], built.tan[i * 3 + 1], built.tan[i * 3 + 2]);
        N.set(built.nor[i * 3], built.nor[i * 3 + 1], built.nor[i * 3 + 2]);
        R.copy(T).cross(N).normalize();
        const b = s.bank;
        const cb = Math.cos(b);
        const sb = Math.sin(b);
        const nb = new THREE.Vector3().copy(N).multiplyScalar(cb).addScaledVector(R, -sb).normalize();
        const rb = new THREE.Vector3().copy(R).multiplyScalar(cb).addScaledVector(N, sb).normalize();
        nbArr.push(nb);
        rbArr.push(rb);
        P.set(s.px, s.py, s.pz);
        left.push(new THREE.Vector3().copy(P).addScaledVector(rb, -GAP).addScaledVector(nb, 0.6));
        right.push(new THREE.Vector3().copy(P).addScaledVector(rb, GAP).addScaledVector(nb, 0.6));
        spine.push(new THREE.Vector3().copy(P).addScaledVector(nb, -1.9));
      }

      // Mid-Air Jump gap detector
      const isJumpGap = (i: number) => {
        if (S[i].special !== 3) return false;
        const pIdx = S[i].piece;
        const r = built.pieceRanges[pIdx];
        if (!r) return false;
        const t = (i - r.start) / Math.max(1, r.end - r.start);
        return t > 0.24 && t < 0.76;
      };

      // PBR Track Materials configured for Wood / Metal / Plastic
      let railMat: THREE.MeshStandardMaterial;
      let spineMat: THREE.MeshStandardMaterial;
      let tieMat: THREE.MeshStandardMaterial;
      let supMat: THREE.MeshStandardMaterial;
      let footerMat: THREE.MeshStandardMaterial;

      if (material === 'wood') {
        railMat = new THREE.MeshStandardMaterial({
          color: 0xd4d4d8,
          roughness: 0.38,
          metalness: 0.65,
          bumpMap: st.surfaceMaps.metal,
          bumpScale: 0.045,
        });
        spineMat = new THREE.MeshStandardMaterial({
          color: 0x78350f, // Heavy dark timber ledger
          roughness: 0.88,
          metalness: 0.04,
          bumpMap: st.surfaceMaps.wood,
          bumpScale: 0.16,
        });
        tieMat = new THREE.MeshStandardMaterial({
          color: 0x92400e, // Wooden railroad ties
          roughness: 0.92,
          metalness: 0.03,
          bumpMap: st.surfaceMaps.wood,
          bumpScale: 0.2,
        });
        supMat = new THREE.MeshStandardMaterial({
          color: 0x854d0e, // Timber support bents
          roughness: 0.90,
          metalness: 0.04,
        });
        footerMat = new THREE.MeshStandardMaterial({
          color: 0x78716c,
          roughness: 0.94,
          metalness: 0.03,
        });
      } else if (material === 'plastic') {
        railMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme.rail),
          roughness: 0.32,
          metalness: 0.03,
          bumpMap: st.surfaceMaps.plastic,
          bumpScale: 0.025,
        });
        spineMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme.spine),
          roughness: 0.28,
          metalness: 0.03,
          bumpMap: st.surfaceMaps.plastic,
          bumpScale: 0.03,
        });
        tieMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme.tie),
          roughness: 0.35,
          metalness: 0.02,
          bumpMap: st.surfaceMaps.plastic,
          bumpScale: 0.035,
        });
        supMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme.support),
          roughness: 0.34,
          metalness: 0.02,
        });
        footerMat = new THREE.MeshStandardMaterial({
          color: 0xe2e8f0,
          roughness: 0.40,
          metalness: 0.05,
        });
      } else {
        // Steel / Metal default
        railMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme.rail),
          roughness: 0.20,
          metalness: 0.82,
          envMapIntensity: 1.25,
          bumpMap: st.surfaceMaps.metal,
          bumpScale: 0.035,
        });
        spineMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme.spine),
          roughness: 0.32,
          metalness: 0.62,
          envMapIntensity: 1.1,
          bumpMap: st.surfaceMaps.metal,
          bumpScale: 0.05,
        });
        tieMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme.tie),
          roughness: 0.40,
          metalness: 0.52,
          bumpMap: st.surfaceMaps.metal,
          bumpScale: 0.06,
        });
        const supColor = supportConfig?.color || theme.support;
        supMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(supColor),
          roughness: 0.42,
          metalness: 0.45,
        });
        footerMat = new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.92,
          metalness: 0.05,
        });
      }

      const isWood = material === 'wood';
      const braceColor = new THREE.Color(supportConfig?.color || (isWood ? '#854d0e' : theme.support))
        .multiplyScalar(isWood ? 0.85 : 0.78);
      const braceMat = new THREE.MeshStandardMaterial({
        color: braceColor,
        roughness: isWood ? 0.92 : 0.50,
        metalness: isWood ? 0.03 : 0.40,
      });

      const brakeMat = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        roughness: 0.25,
        metalness: 0.85,
      });
      const boostMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.35,
        metalness: 0.80,
      });

      // If G-Force Heat Map is toggled ON, use vertex-colored materials
      if (gForceHeatMap) {
        railMat = new THREE.MeshStandardMaterial({
          roughness: 0.22,
          metalness: 0.75,
          vertexColors: true,
        });
        spineMat = new THREE.MeshStandardMaterial({
          roughness: 0.32,
          metalness: 0.65,
          vertexColors: true,
        });
      }

      // Sample G-force estimation along track
      const sampleG = (sampleIdx: number): number => {
        const sm = S[sampleIdx];
        if (!sm) return 1.0;
        if (telemetry && telemetry.length > 0) {
          let low = 0, high = telemetry.length - 1;
          while (low <= high) {
            const mid = (low + high) >> 1;
            if (telemetry[mid].s < sm.s) low = mid + 1;
            else high = mid - 1;
          }
          const idx = Math.min(telemetry.length - 1, Math.max(0, low));
          return telemetry[idx].g;
        }
        const hDrop = Math.max(0, built.maxHeight - sm.y);
        const vEst = Math.sqrt(2 * GRAVITY * METERS_PER_UNIT * hDrop + 16);
        const kappaM = sm.kappa / METERS_PER_UNIT;
        const yawRateM = sm.yawRate / METERS_PER_UNIT;
        const aNormVert = GRAVITY * Math.cos(sm.pitch) + vEst * vEst * kappaM;
        const aNormLat = vEst * vEst * yawRateM;
        return Math.hypot(aNormVert, aNormLat) / GRAVITY;
      };

      // Build continuous rail tubes with gaps over mid-air jump leaps
      const buildRailTubes = (pts: THREE.Vector3[], radius: number, mat: THREE.Material) => {
        const segs: THREE.Vector3[][] = [];
        let cur: THREE.Vector3[] = [];
        for (let i = 0; i < n; i++) {
          if (isJumpGap(i)) {
            if (cur.length >= 3) {
              segs.push(cur);
            }
            cur = [];
          } else {
            cur.push(pts[i]);
          }
        }
        if (cur.length >= 3) {
          segs.push(cur);
        }

        for (const ptsList of segs) {
          const tubeSegments = Math.max(6, Math.min(1200, ptsList.length));
          const geo = new THREE.TubeGeometry(new PointsCurve(ptsList), tubeSegments, radius, 8, false);

          if (gForceHeatMap) {
            const count = geo.attributes.position.count;
            const colors = new Float32Array(count * 3);
            const tempCol = new THREE.Color();
            const radSegs = 8;
            const rings = tubeSegments + 1;
            for (let r = 0; r < rings; r++) {
              const frac = r / tubeSegments;
              const pt = ptsList[Math.min(ptsList.length - 1, Math.floor(frac * ptsList.length))];
              // Find closest sample in track
              let bestIdx = Math.min(n - 1, Math.max(0, Math.floor(frac * n)));
              let bestDistSq = 1e9;
              const searchRange = 12;
              const startK = Math.max(0, bestIdx - searchRange);
              const endK = Math.min(n - 1, bestIdx + searchRange);
              for (let k = startK; k <= endK; k++) {
                const dx = S[k].px - pt.x;
                const dy = S[k].py - pt.y;
                const dz = S[k].pz - pt.z;
                const dsq = dx * dx + dy * dy + dz * dz;
                if (dsq < bestDistSq) {
                  bestDistSq = dsq;
                  bestIdx = k;
                }
              }
              const gVal = sampleG(bestIdx);
              getGColor(gVal, tempCol);
              for (let c = 0; c <= radSegs; c++) {
                const vIdx = (r * (radSegs + 1) + c) * 3;
                colors[vIdx] = tempCol.r;
                colors[vIdx + 1] = tempCol.g;
                colors[vIdx + 2] = tempCol.b;
              }
            }
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          }

          const mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = true;
          mesh.userData.raycastTrack = true;
          st.trackGroup.add(mesh);
          st.raycastTargets.push(mesh);
        }
      };

      for (const pts of [left, right]) {
        buildRailTubes(pts, 0.62, railMat);
      }
      buildRailTubes(spine, 1.15, spineMat);

      // Cross ties (skip mid-air jump gaps)
      const ds = S[1].s - S[0].s || 1.6;
      const tieEvery = Math.max(2, Math.round(6.5 / ds));
      const tieCount = Math.floor(n / tieEvery);
      const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), tieMat, tieCount);
      ties.castShadow = true;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      let ti = 0;
      for (let i = 0; i < n && ti < tieCount; i += tieEvery) {
        if (isJumpGap(i)) continue;
        const s = S[i];
        T.set(built.tan[i * 3], built.tan[i * 3 + 1], built.tan[i * 3 + 2]);
        const nb = nbArr[i];
        const rb = rbArr[i];
        const zAxis = new THREE.Vector3().copy(T).negate();
        const basis = new THREE.Matrix4().makeBasis(rb, nb, zAxis);
        q.setFromRotationMatrix(basis);
        scale.set(GAP * 2 + 1.6, 0.8, 1.9);
        m4.compose(
          new THREE.Vector3(s.px, s.py, s.pz).addScaledVector(nb, -0.9),
          q,
          scale,
        );
        ties.setMatrixAt(ti, m4);
        ti++;
      }
      ties.count = ti;
      ties.instanceMatrix.needsUpdate = true;
      ties.userData.raycastTrack = true;
      st.trackGroup.add(ties);
      st.raycastTargets.push(ties);

      // Special track elements: magnetic trim brake fins & LSM boost stators
      let brakeCount = 0;
      let boostCount = 0;
      for (let i = 0; i < n; i += 3) {
        if (S[i].special === 1) brakeCount++;
        else if (S[i].special === 2) boostCount++;
      }

      if (brakeCount > 0) {
        const brakeFins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 1.6, 3.8), brakeMat, brakeCount);
        brakeFins.castShadow = true;
        let bi = 0;
        for (let i = 0; i < n && bi < brakeCount; i += 3) {
          if (S[i].special !== 1) continue;
          const s = S[i];
          T.set(built.tan[i * 3], built.tan[i * 3 + 1], built.tan[i * 3 + 2]);
          const nb = nbArr[i];
          const rb = rbArr[i];
          const zAxis = new THREE.Vector3().copy(T).negate();
          const basis = new THREE.Matrix4().makeBasis(rb, nb, zAxis);
          q.setFromRotationMatrix(basis);
          m4.compose(new THREE.Vector3(s.px, s.py, s.pz).addScaledVector(nb, -0.3), q, new THREE.Vector3(1, 1, 1));
          brakeFins.setMatrixAt(bi, m4);
          bi++;
        }
        brakeFins.count = bi;
        brakeFins.instanceMatrix.needsUpdate = true;
        st.trackGroup.add(brakeFins);
      }

      if (boostCount > 0) {
        const boostStators = new THREE.InstancedMesh(new THREE.BoxGeometry(3.6, 0.9, 3.8), boostMat, boostCount);
        boostStators.castShadow = true;
        let bi = 0;
        for (let i = 0; i < n && bi < boostCount; i += 3) {
          if (S[i].special !== 2) continue;
          const s = S[i];
          T.set(built.tan[i * 3], built.tan[i * 3 + 1], built.tan[i * 3 + 2]);
          const nb = nbArr[i];
          const rb = rbArr[i];
          const zAxis = new THREE.Vector3().copy(T).negate();
          const basis = new THREE.Matrix4().makeBasis(rb, nb, zAxis);
          q.setFromRotationMatrix(basis);
          m4.compose(new THREE.Vector3(s.px, s.py, s.pz).addScaledVector(nb, -0.6), q, new THREE.Vector3(1, 1, 1));
          boostStators.setMatrixAt(bi, m4);
          bi++;
        }
        boostStators.count = bi;
        boostStators.instanceMatrix.needsUpdate = true;
        st.trackGroup.add(boostStators);
      }

      // =========================================================================
      // Custom Procedural Support Generator (Tubular, Wooden, Truss, Flanged)
      // =========================================================================
      const supDensity = supportConfig?.density ?? 'normal';
      const supEvery =
        supDensity === 'dense'
          ? Math.max(2, Math.round(15 / ds))
          : supDensity === 'sparse'
            ? Math.max(5, Math.round(40 / ds))
            : Math.max(3, Math.round(26 / ds));

      let resolvedStyle: 'tubular' | 'wooden' | 'truss' | 'flanged' = 'tubular';
      if (supportConfig?.style && supportConfig.style !== 'auto') {
        resolvedStyle = supportConfig.style;
      } else {
        if (material === 'wood') {
          resolvedStyle = 'wooden';
        } else if (built.maxHeight - built.groundY > 75) {
          resolvedStyle = 'truss';
        } else {
          resolvedStyle = 'tubular';
        }
      }
      const useCrossBrace = supportConfig?.crossBracing !== false;

      // Identify valid track coordinates for columns
      const supIndices: number[] = [];
      for (let i = 0; i < n; i += supEvery) {
        if (isJumpGap(i)) continue;
        const s = S[i];
        if (s.py - G < 7.5) continue;
        const nb = nbArr[i];
        if (nb.y < 0.32) continue; // Skip inverted loops where track runs overhead
        supIndices.push(i);
      }

      const numBents = supIndices.length;
      // Preallocate instanced meshes with ample capacity for complex bents
      const maxCols = Math.max(1, numBents * 4);
      const maxFooters = Math.max(1, numBents * 4);
      const maxBraces = Math.max(1, numBents * 18);
      const maxLedgers = Math.max(1, numBents * 12);

      const colMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12), supMat, maxCols);
      colMesh.castShadow = true;
      const footerMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.25, 1, 8), footerMat, maxFooters);
      footerMesh.receiveShadow = true;
      const braceMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), braceMat, maxBraces);
      braceMesh.castShadow = true;
      const ledgerMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), braceMat, maxLedgers);
      ledgerMesh.castShadow = true;

      const pA = new THREE.Vector3();
      const pB = new THREE.Vector3();
      const pC = new THREE.Vector3();
      const pD = new THREE.Vector3();
      const sDir = new THREE.Vector3();
      const sMid = new THREE.Vector3();
      const sUp = new THREE.Vector3(0, 1, 0);
      const sQ = new THREE.Quaternion();
      const sScale = new THREE.Vector3();

      const placeStrut = (p1: THREE.Vector3, p2: THREE.Vector3, radius: number, mesh: THREE.InstancedMesh, idx: number) => {
        sDir.subVectors(p2, p1);
        const len = sDir.length();
        if (len < 0.01) return;
        sMid.addVectors(p1, p2).multiplyScalar(0.5);
        sDir.normalize();
        sQ.setFromUnitVectors(sUp, sDir);
        sScale.set(radius, len, radius);
        m4.compose(sMid, sQ, sScale);
        mesh.setMatrixAt(idx, m4);
      };

      let ci = 0;
      let fi = 0;
      let bi = 0;
      let li = 0;

      for (let b = 0; b < numBents; b++) {
        const i = supIndices[b];
        const s = S[i];
        const nb = nbArr[i];
        const rb = rbArr[i];
        const T = new THREE.Vector3(built.tan[i * 3], built.tan[i * 3 + 1], built.tan[i * 3 + 2]);
        const hgt = s.py - G - 1.2;

        if (resolvedStyle === 'wooden') {
          // Timber trestle: Dual battered wooden posts spaced along track normal/right
          const topSpread = 3.2;
          const batter = Math.min(6.0, hgt * 0.05);
          const botSpread = topSpread + batter;

          pA.set(s.px - botSpread * rb.x, G + 1.0, s.pz - botSpread * rb.z);
          pB.set(s.px - topSpread * rb.x, s.py - 1.2, s.pz - topSpread * rb.z);
          placeStrut(pA, pB, 0.72, colMesh, ci++);

          pC.set(s.px + botSpread * rb.x, G + 1.0, s.pz + botSpread * rb.z);
          pD.set(s.px + topSpread * rb.x, s.py - 1.2, s.pz + topSpread * rb.z);
          placeStrut(pC, pD, 0.72, colMesh, ci++);

          // Pier footers under each timber post
          m4.compose(new THREE.Vector3(pA.x, G + 1.0, pA.z), new THREE.Quaternion(), new THREE.Vector3(1.8, 2.0, 1.8));
          footerMesh.setMatrixAt(fi++, m4);
          m4.compose(new THREE.Vector3(pC.x, G + 1.0, pC.z), new THREE.Quaternion(), new THREE.Vector3(1.8, 2.0, 1.8));
          footerMesh.setMatrixAt(fi++, m4);

          // Horizontal ledgers every 9-10 feet
          const tiers = Math.max(1, Math.floor(hgt / 9.5));
          for (let t = 1; t <= tiers; t++) {
            const frac = t / (tiers + 1);
            const lLeft = new THREE.Vector3().lerpVectors(pA, pB, frac);
            const lRight = new THREE.Vector3().lerpVectors(pC, pD, frac);
            placeStrut(lLeft, lRight, 0.55, ledgerMesh, li++);

            // Diagonal X-bracing between tiers
            if (useCrossBrace && t < tiers) {
              const fracNext = (t + 1) / (tiers + 1);
              const nLeft = new THREE.Vector3().lerpVectors(pA, pB, fracNext);
              const nRight = new THREE.Vector3().lerpVectors(pC, pD, fracNext);
              placeStrut(lLeft, nRight, 0.38, braceMesh, bi++);
              placeStrut(lRight, nLeft, 0.38, braceMesh, bi++);
            }
          }
        } else if (resolvedStyle === 'truss') {
          // Quad-chord lattice box tower
          const wTop = 2.4;
          const wBot = wTop + Math.min(5.0, hgt * 0.04);
          const topPts = [
            new THREE.Vector3(s.px - wTop * rb.x - wTop * T.x, s.py - 1.2, s.pz - wTop * rb.z - wTop * T.z),
            new THREE.Vector3(s.px + wTop * rb.x - wTop * T.x, s.py - 1.2, s.pz + wTop * rb.z - wTop * T.z),
            new THREE.Vector3(s.px + wTop * rb.x + wTop * T.x, s.py - 1.2, s.pz + wTop * rb.z + wTop * T.z),
            new THREE.Vector3(s.px - wTop * rb.x + wTop * T.x, s.py - 1.2, s.pz - wTop * rb.z + wTop * T.z),
          ];
          const botPts = [
            new THREE.Vector3(s.px - wBot * rb.x - wBot * T.x, G + 1.2, s.pz - wBot * rb.z - wBot * T.z),
            new THREE.Vector3(s.px + wBot * rb.x - wBot * T.x, G + 1.2, s.pz + wBot * rb.z - wBot * T.z),
            new THREE.Vector3(s.px + wBot * rb.x + wBot * T.x, G + 1.2, s.pz + wBot * rb.z + wBot * T.z),
            new THREE.Vector3(s.px - wBot * rb.x + wBot * T.x, G + 1.2, s.pz - wBot * rb.z + wBot * T.z),
          ];

          for (let k = 0; k < 4; k++) {
            placeStrut(botPts[k], topPts[k], 0.62, colMesh, ci++);
          }

          // Monolithic foundation block
          m4.compose(new THREE.Vector3(s.px, G + 1.2, s.pz), new THREE.Quaternion(), new THREE.Vector3(wBot * 1.8, 2.4, wBot * 1.8));
          footerMesh.setMatrixAt(fi++, m4);

          // Horizontal perimeter collars & diagonal lacing
          const tiers = Math.max(1, Math.floor(hgt / 12));
          for (let t = 1; t <= tiers; t++) {
            const f1 = t / (tiers + 1);
            const rPts = [
              new THREE.Vector3().lerpVectors(botPts[0], topPts[0], f1),
              new THREE.Vector3().lerpVectors(botPts[1], topPts[1], f1),
              new THREE.Vector3().lerpVectors(botPts[2], topPts[2], f1),
              new THREE.Vector3().lerpVectors(botPts[3], topPts[3], f1),
            ];
            placeStrut(rPts[0], rPts[1], 0.42, ledgerMesh, li++);
            placeStrut(rPts[1], rPts[2], 0.42, ledgerMesh, li++);
            placeStrut(rPts[2], rPts[3], 0.42, ledgerMesh, li++);
            placeStrut(rPts[3], rPts[0], 0.42, ledgerMesh, li++);

            if (useCrossBrace && t < tiers) {
              const f2 = (t + 1) / (tiers + 1);
              const nPts = [
                new THREE.Vector3().lerpVectors(botPts[0], topPts[0], f2),
                new THREE.Vector3().lerpVectors(botPts[1], topPts[1], f2),
                new THREE.Vector3().lerpVectors(botPts[2], topPts[2], f2),
                new THREE.Vector3().lerpVectors(botPts[3], topPts[3], f2),
              ];
              placeStrut(rPts[0], nPts[1], 0.32, braceMesh, bi++);
              placeStrut(rPts[1], nPts[2], 0.32, braceMesh, bi++);
              placeStrut(rPts[2], nPts[3], 0.32, braceMesh, bi++);
              placeStrut(rPts[3], nPts[0], 0.32, braceMesh, bi++);
            }
          }
        } else if (resolvedStyle === 'flanged') {
          // Heavy steel column with bolted structural collar discs
          pA.set(s.px, G + 1.2, s.pz);
          pB.set(s.px, s.py - 1.2, s.pz);
          placeStrut(pA, pB, 1.35, colMesh, ci++);

          m4.compose(new THREE.Vector3(s.px, G + 1.4, s.pz), new THREE.Quaternion(), new THREE.Vector3(3.4, 2.8, 3.4));
          footerMesh.setMatrixAt(fi++, m4);

          // Structural flange discs
          const tiers = Math.max(1, Math.floor(hgt / 12));
          for (let t = 1; t <= tiers; t++) {
            const yDisc = G + (t * (hgt / (tiers + 1)));
            m4.compose(new THREE.Vector3(s.px, yDisc, s.pz), new THREE.Quaternion(), new THREE.Vector3(2.5, 0.7, 2.5));
            ledgerMesh.setMatrixAt(li++, m4);
          }
        } else {
          // Tubular Steel Default: Central column + A-frame outriggers on tall sections
          pA.set(s.px, G + 1.2, s.pz);
          pB.set(s.px, s.py - 1.2, s.pz);
          placeStrut(pA, pB, 1.15, colMesh, ci++);

          m4.compose(new THREE.Vector3(s.px, G + 1.2, s.pz), new THREE.Quaternion(), new THREE.Vector3(2.6, 2.4, 2.6));
          footerMesh.setMatrixAt(fi++, m4);

          if (hgt > 22) {
            const spread = Math.min(26, hgt * 0.22);
            const apexY = G + hgt * 0.72;
            const apex = new THREE.Vector3(s.px, apexY, s.pz);
            const leg1Bot = new THREE.Vector3(s.px + spread * rb.x, G + 1.0, s.pz + spread * rb.z);
            const leg2Bot = new THREE.Vector3(s.px - spread * rb.x, G + 1.0, s.pz - spread * rb.z);

            placeStrut(leg1Bot, apex, 0.78, braceMesh, bi++);
            placeStrut(leg2Bot, apex, 0.78, braceMesh, bi++);

            m4.compose(new THREE.Vector3(leg1Bot.x, G + 1.0, leg1Bot.z), new THREE.Quaternion(), new THREE.Vector3(1.9, 2.0, 1.9));
            footerMesh.setMatrixAt(fi++, m4);
            m4.compose(new THREE.Vector3(leg2Bot.x, G + 1.0, leg2Bot.z), new THREE.Quaternion(), new THREE.Vector3(1.9, 2.0, 1.9));
            footerMesh.setMatrixAt(fi++, m4);

            if (useCrossBrace) {
              const strutY = G + hgt * 0.35;
              const s1 = new THREE.Vector3().lerpVectors(leg1Bot, apex, (strutY - G) / (apexY - G));
              const s2 = new THREE.Vector3().lerpVectors(leg2Bot, apex, (strutY - G) / (apexY - G));
              placeStrut(s1, s2, 0.45, ledgerMesh, li++);
            }
          }
        }
      }

      colMesh.count = ci;
      colMesh.instanceMatrix.needsUpdate = true;
      st.trackGroup.add(colMesh);

      footerMesh.count = fi;
      footerMesh.instanceMatrix.needsUpdate = true;
      st.trackGroup.add(footerMesh);

      if (bi > 0) {
        braceMesh.count = bi;
        braceMesh.instanceMatrix.needsUpdate = true;
        st.trackGroup.add(braceMesh);
      }

      if (li > 0) {
        ledgerMesh.count = li;
        ledgerMesh.instanceMatrix.needsUpdate = true;
        st.trackGroup.add(ledgerMesh);
      }

      // Mid-Air Jump Launch Ramp Lip, Catch Receiving Hopper & Flight Guide
      for (let pIdx = 0; pIdx < built.pieceRanges.length; pIdx++) {
        const r = built.pieceRanges[pIdx];
        if (!r) continue;
        const sMid = S[r.start];
        if (sMid?.special !== 3) continue;

        const takeoffI = Math.min(n - 1, r.start + Math.floor((r.end - r.start) * 0.24));
        const catchI = Math.min(n - 1, r.start + Math.floor((r.end - r.start) * 0.76));

        // Takeoff kicker lip
        const sT = S[takeoffI];
        const nbT = nbArr[takeoffI];
        const rbT = rbArr[takeoffI];
        T.set(built.tan[takeoffI * 3], built.tan[takeoffI * 3 + 1], built.tan[takeoffI * 3 + 2]);
        const zAxisT = new THREE.Vector3().copy(T).negate();
        const basisT = new THREE.Matrix4().makeBasis(rbT, nbT, zAxisT);
        q.setFromRotationMatrix(basisT);

        const lipMat = new THREE.MeshStandardMaterial({
          color: 0xf59e0b, // bright amber launch ramp
          roughness: 0.25,
          metalness: 0.75,
        });
        const lip = new THREE.Mesh(new THREE.BoxGeometry(GAP * 2 + 2.2, 1.4, 2.5), lipMat);
        lip.position.set(sT.px, sT.py, sT.pz).addScaledVector(nbT, -0.6);
        lip.quaternion.copy(q);
        lip.castShadow = true;
        st.trackGroup.add(lip);

        // Takeoff launch beacons
        const strobeMat = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x38bdf8,
          emissiveIntensity: 1.2,
          roughness: 0.1,
        });
        for (const side of [-GAP - 1.2, GAP + 1.2]) {
          const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.2, 8), strobeMat);
          beacon.position.set(sT.px, sT.py, sT.pz).addScaledVector(rbT, side).addScaledVector(nbT, 0.6);
          beacon.quaternion.copy(q);
          st.trackGroup.add(beacon);
        }

        // Catch receiving hopper
        const sC = S[catchI];
        const nbC = nbArr[catchI];
        const rbC = rbArr[catchI];
        T.set(built.tan[catchI * 3], built.tan[catchI * 3 + 1], built.tan[catchI * 3 + 2]);
        const zAxisC = new THREE.Vector3().copy(T).negate();
        const basisC = new THREE.Matrix4().makeBasis(rbC, nbC, zAxisC);
        q.setFromRotationMatrix(basisC);

        const hopperMat = new THREE.MeshStandardMaterial({
          color: 0x10b981, // emerald landing catch hopper
          roughness: 0.35,
          metalness: 0.6,
        });
        const hopper = new THREE.Mesh(new THREE.BoxGeometry(GAP * 2 + 3.2, 1.6, 2.8), hopperMat);
        hopper.position.set(sC.px, sC.py, sC.pz).addScaledVector(nbC, -0.6);
        hopper.quaternion.copy(q);
        hopper.castShadow = true;
        st.trackGroup.add(hopper);

        // Airborne trajectory flight guide through the gap
        const gapPoints: THREE.Vector3[] = [];
        for (let gi = takeoffI; gi <= catchI; gi += 2) {
          gapPoints.push(new THREE.Vector3(S[gi].px, S[gi].py + 0.1, S[gi].pz));
        }
        if (gapPoints.length >= 2) {
          const airMat = new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.5,
          });
          const airGeo = new THREE.TubeGeometry(new PointsCurve(gapPoints), 16, 0.2, 6, false);
          const airLine = new THREE.Mesh(airGeo, airMat);
          st.trackGroup.add(airLine);
        }
      }

      // Station platform with architectural concrete deck & safety yellow demarcation
      const platGroup = new THREE.Group();
      const platMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85, metalness: 0.1 });
      const plat = new THREE.Mesh(new THREE.BoxGeometry(28, 2.2, 18), platMat);
      const s0 = S[0];
      plat.position.set(s0.px + 6.5, s0.py - 3.2, s0.pz);
      plat.receiveShadow = true;
      platGroup.add(plat);

      // Caution stripe along the edge of the boarding platform
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.4, metalness: 0.2 });
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(28, 0.1, 0.8), stripeMat);
      stripe.position.set(s0.px + 6.5, s0.py - 2.05, s0.pz - 4.5);
      platGroup.add(stripe);

      // Station roof canopy
      const roofMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.accent),
        roughness: 0.35,
        metalness: 0.45,
      });
      const roof = new THREE.Mesh(new THREE.ConeGeometry(18, 7.5, 4), roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(s0.px + 6.5, s0.py + 9.5, s0.pz);
      roof.castShadow = true;
      platGroup.add(roof);
      st.trackGroup.add(platGroup);

      // Scenery with PBR Standard Materials
      const rnd = mulberry(1337);
      const coarse: THREE.Vector2[] = [];
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 120))) coarse.push(new THREE.Vector2(S[i].px, S[i].pz));
      const near = (x: number, z: number, d: number) => {
        for (const c of coarse) {
          const dx = c.x - x;
          const dz = c.y - z;
          if (dx * dx + dz * dz < d * d) return true;
        }
        return false;
      };

      const cx = built.center3.x;
      const cz = built.center3.z;
      const spread = Math.min(worldSize * 0.72, built.radius3 * 5 + 1800);

      const trunkGeo = new THREE.CylinderGeometry(1.1, 1.5, 7, 8);
      const leafGeo = new THREE.ConeGeometry(6.5, 20, 6);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e4a2e, roughness: 0.90, metalness: 0.05 });
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.65, metalness: 0.02 });
      const COUNT = Math.max(240, Math.min(560, Math.floor(220 + built.radius3 * 0.22)));
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, COUNT);
      const leaves = new THREE.InstancedMesh(leafGeo, leafMat, COUNT);
      leaves.castShadow = true;
      let k = 0;
      let guard = 0;
      while (k < COUNT && guard < COUNT * 20) {
        guard++;
        const x = cx + (rnd() - 0.5) * spread;
        const z = cz + (rnd() - 0.5) * spread;
        if (near(x, z, 34)) continue;
        const sc = 0.7 + rnd() * 1.1;
        m4.compose(new THREE.Vector3(x, G + 3.5 * sc, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc));
        trunks.setMatrixAt(k, m4);
        m4.compose(new THREE.Vector3(x, G + 16 * sc, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc));
        leaves.setMatrixAt(k, m4);
        k++;
      }
      trunks.count = k;
      leaves.count = k;
      trunks.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.needsUpdate = true;
      st.sceneryGroup.add(trunks, leaves);

      // Layered understory, stones and maintenance-road markers add scale cues at POV speed.
      const detailCount = Math.min(360, Math.floor(COUNT * 0.72));
      const shrubMat = new THREE.MeshStandardMaterial({ color: 0x315f2b, roughness: 0.94, metalness: 0 });
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x737b78, roughness: 0.96, metalness: 0.03, flatShading: true });
      const shrubs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), shrubMat, detailCount);
      const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rockMat, Math.floor(detailCount * 0.45));
      shrubs.castShadow = true;
      rocks.castShadow = true;
      rocks.receiveShadow = true;
      let shrubIndex = 0;
      let rockIndex = 0;
      let detailGuard = 0;
      while (shrubIndex < detailCount && detailGuard < detailCount * 14) {
        detailGuard++;
        const x = cx + (rnd() - 0.5) * spread;
        const z = cz + (rnd() - 0.5) * spread;
        if (near(x, z, 18)) continue;
        const sc = 1.1 + rnd() * 3.4;
        m4.compose(
          new THREE.Vector3(x, G + sc * 0.55, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * Math.PI, 0)),
          new THREE.Vector3(sc * 1.25, sc * 0.72, sc),
        );
        shrubs.setMatrixAt(shrubIndex++, m4);
        if (rockIndex < rocks.count && rnd() > 0.58) {
          const rs = 0.8 + rnd() * 3.3;
          m4.compose(
            new THREE.Vector3(x + 5 + rnd() * 12, G + rs * 0.45, z + (rnd() - 0.5) * 12),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 0.3, rnd() * Math.PI, rnd() * 0.25)),
            new THREE.Vector3(rs * 1.4, rs * 0.75, rs),
          );
          rocks.setMatrixAt(rockIndex++, m4);
        }
      }
      shrubs.count = shrubIndex;
      rocks.count = rockIndex;
      shrubs.instanceMatrix.needsUpdate = true;
      rocks.instanceMatrix.needsUpdate = true;
      st.sceneryGroup.add(shrubs, rocks);

      // Platinum park lamps trace the station approach without expensive per-lamp lights.
      const lampCount = 24;
      const lampPosts = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.18, 0.28, 1, 8),
        new THREE.MeshStandardMaterial({ color: 0x66707c, roughness: 0.32, metalness: 0.82 }),
        lampCount,
      );
      const lampGlobes = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.58, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xffe8a3, emissive: 0xd49c28, emissiveIntensity: 2.4, roughness: 0.18 }),
        lampCount,
      );
      for (let i = 0; i < lampCount; i++) {
        const angle = (i / lampCount) * Math.PI * 2;
        const radius = 56 + (i % 3) * 18;
        const x = S[0].px + Math.cos(angle) * radius;
        const z = S[0].pz + Math.sin(angle) * radius;
        m4.compose(new THREE.Vector3(x, G + 5, z), new THREE.Quaternion(), new THREE.Vector3(1, 10, 1));
        lampPosts.setMatrixAt(i, m4);
        m4.compose(new THREE.Vector3(x, G + 10.2, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        lampGlobes.setMatrixAt(i, m4);
      }
      lampPosts.instanceMatrix.needsUpdate = true;
      lampGlobes.instanceMatrix.needsUpdate = true;
      st.sceneryGroup.add(lampPosts, lampGlobes);

      // Distant hills with soft PBR shading
      const hillMat = new THREE.MeshStandardMaterial({ color: 0x5a9a46, roughness: 0.85, flatShading: true });
      const hills = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), hillMat, 14);
      for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * Math.PI * 2 + rnd() * 0.3;
        const dist = spread * 0.85 + rnd() * 500;
        const r = 150 + rnd() * 220;
        const hh = 70 + rnd() * 130;
        m4.compose(
          new THREE.Vector3(cx + Math.cos(ang) * dist, G + hh / 2 - 6, cz + Math.sin(ang) * dist),
          new THREE.Quaternion(),
          new THREE.Vector3(r, hh, r),
        );
        hills.setMatrixAt(i, m4);
      }
      hills.instanceMatrix.needsUpdate = true;
      st.sceneryGroup.add(hills);

      // Clouds
      const cloudMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.95,
        emissive: 0xb0cce8,
        emissiveIntensity: 0.28,
      });
      const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), cloudMat, 42);
      for (let i = 0; i < 42; i++) {
        const ang = rnd() * Math.PI * 2;
        const dist = 200 + rnd() * spread;
        const sx = 40 + rnd() * 70;
        m4.compose(
          new THREE.Vector3(cx + Math.cos(ang) * dist, G + 280 + rnd() * 240, cz + Math.sin(ang) * dist),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 3, 0)),
          new THREE.Vector3(sx, sx * 0.42, sx * 0.8),
        );
        clouds.setMatrixAt(i, m4);
      }
      clouds.instanceMatrix.needsUpdate = true;
      st.sceneryGroup.add(clouds);

      // Shadow camera
      const rad = built.radius3 + 180;
      const cam = st.sun.shadow.camera as THREE.OrthographicCamera;
      cam.left = -rad;
      cam.right = rad;
      cam.top = rad;
      cam.bottom = -rad;
      cam.near = 1;
      cam.far = 2600;
      st.sun.position.set(cx + 420, G + 760, cz + 320);
      st.sun.target.position.set(cx, G, cz);
      st.sun.target.updateMatrixWorld();
      cam.updateProjectionMatrix();
    }, 70);
    return () => window.clearTimeout(timer);
  }, [built, theme, material, supportConfig, gForceHeatMap, telemetry]);

  // ------------------------------------------------------------- frame loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const f: Frame = makeFrame();
    const cf: Frame = makeFrame();
    const cT = new THREE.Vector3();
    const cN = new THREE.Vector3();
    const cR = new THREE.Vector3();
    const cNB = new THREE.Vector3();
    const cRB = new THREE.Vector3();
    const cBasis = new THREE.Matrix4();
    const tmpT = new THREE.Vector3();
    const tmpN = new THREE.Vector3();
    const tmpR = new THREE.Vector3();
    const nb = new THREE.Vector3();
    const rb = new THREE.Vector3();
    const target = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    const lookM = new THREE.Matrix4();

    let lightningTimer = 6;
    let lightningFlash = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const st = stateRef.current;
      if (!st) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { built: bt, simRef: sr, camMode: mode, weather = 'day' } = propsRef.current;
      const sim = sr.current;
      if (bt.samples.length < 4) {
        st.renderer.render(st.scene, st.camera);
        return;
      }

      // ------------------------------------------------------------- Weather & Lighting
      if (weather === 'sunset') {
        st.skyMat.uniforms.top.value.set('#2c1654');
        st.skyMat.uniforms.mid.value.set('#ea580c');
        st.skyMat.uniforms.bottom.value.set('#fed7aa');
        (st.scene.fog as THREE.FogExp2).color.set(0xfb923c);
        (st.scene.fog as THREE.FogExp2).density = 0.00028;
        st.sun.color.set(0xf97316);
        st.sun.intensity = 2.8;
        st.sun.position.set(620, 180, 220);
        st.hemi.color.set(0xfb923c);
        st.hemi.groundColor.set(0x451a03);
        st.hemi.intensity = 0.95;
        st.fillLight.color.set(0xbe185d);
        st.fillLight.intensity = 0.75;
        st.renderer.toneMappingExposure = 1.12;
        st.headlights.forEach((hl) => {
          hl.intensity = 1.4;
        });
        st.rainPoints.visible = false;
      } else if (weather === 'night') {
        st.skyMat.uniforms.top.value.set('#020617');
        st.skyMat.uniforms.mid.value.set('#0f172a');
        st.skyMat.uniforms.bottom.value.set('#1e1b4b');
        (st.scene.fog as THREE.FogExp2).color.set(0x0a0f1d);
        (st.scene.fog as THREE.FogExp2).density = 0.00042;
        st.sun.color.set(0x93c5fd);
        st.sun.intensity = 0.45;
        st.sun.position.set(200, 520, 160);
        st.hemi.color.set(0x1e293b);
        st.hemi.groundColor.set(0x020617);
        st.hemi.intensity = 0.30;
        st.fillLight.color.set(0x6366f1);
        st.fillLight.intensity = 0.35;
        st.renderer.toneMappingExposure = 1.25;
        st.headlights.forEach((hl) => {
          hl.intensity = 4.2;
        });
        st.rainPoints.visible = false;
      } else if (weather === 'storm') {
        st.skyMat.uniforms.top.value.set('#1e293b');
        st.skyMat.uniforms.mid.value.set('#334155');
        st.skyMat.uniforms.bottom.value.set('#475569');
        (st.scene.fog as THREE.FogExp2).color.set(0x334155);
        (st.scene.fog as THREE.FogExp2).density = 0.00078;
        st.sun.color.set(0x94a3b8);
        st.sun.position.set(120, 480, 120);
        st.hemi.color.set(0x475569);
        st.hemi.groundColor.set(0x1e293b);
        st.hemi.intensity = 0.65;
        st.fillLight.color.set(0x64748b);
        st.fillLight.intensity = 0.30;
        st.renderer.toneMappingExposure = 0.95;
        st.headlights.forEach((hl) => {
          hl.intensity = 4.5;
        });

        // Lightning flash effect
        lightningTimer -= dt;
        if (lightningTimer <= 0) {
          lightningFlash = 0.12;
          lightningTimer = 7 + Math.random() * 8;
        }
        if (lightningFlash > 0) {
          lightningFlash -= dt;
          st.sun.intensity = 4.6;
          st.renderer.toneMappingExposure = 1.45;
        } else {
          st.sun.intensity = 0.70;
          st.renderer.toneMappingExposure = 0.95;
        }

        // Dynamic falling rain particles with wind tilt
        st.rainPoints.visible = true;
        const pos = st.rainPositions;
        const vel = st.rainVelocities;
        const n = vel.length;
        const gY = bt.groundY;
        for (let i = 0; i < n; i++) {
          pos[i * 3 + 1] -= vel[i] * dt;
          pos[i * 3] -= 32 * dt; // wind drift
          if (pos[i * 3 + 1] < gY) {
            pos[i * 3 + 1] = gY + 450 + Math.random() * 100;
            pos[i * 3] = (Math.random() - 0.5) * 1400;
            pos[i * 3 + 2] = (Math.random() - 0.5) * 1400;
          }
        }
        st.rainPoints.geometry.attributes.position.needsUpdate = true;
      } else {
        // Crisp sunny daytime
        st.skyMat.uniforms.top.value.set('#1e6fd8');
        st.skyMat.uniforms.mid.value.set('#85bff5');
        st.skyMat.uniforms.bottom.value.set('#e0f0fe');
        (st.scene.fog as THREE.FogExp2).color.set(0xcfe8ff);
        (st.scene.fog as THREE.FogExp2).density = 0.00018;
        st.sun.color.set(0xfffaee);
        st.sun.intensity = 2.2;
        st.sun.position.set(360, 620, 240);
        st.hemi.color.set(0xcfe6fe);
        st.hemi.groundColor.set(0x274314);
        st.hemi.intensity = 1.15;
        st.fillLight.color.set(0x93c5fd);
        st.fillLight.intensity = 0.65;
        st.renderer.toneMappingExposure = 1.08;
        st.headlights.forEach((hl) => {
          hl.intensity = 0;
        });
        st.rainPoints.visible = false;
      }

      // Animate quadcopter rotors dynamically
      for (let i = 0; i < st.rotors.length; i++) {
        st.rotors[i].rotation.y += dt * 55;
      }

      frameAt(bt, Math.min(sim.s, bt.length - 0.1), f);
      tmpT.set(f.tx, f.ty, f.tz).normalize();
      tmpN.set(f.nx, f.ny, f.nz).normalize();
      tmpR.copy(tmpT).cross(tmpN).normalize();
      const dynamicLean = Math.max(-0.25, Math.min(0.25, -sim.lat * 0.08));
      const b = f.bank + dynamicLean;
      nb.copy(tmpN).multiplyScalar(Math.cos(b)).addScaledVector(tmpR, -Math.sin(b)).normalize();
      rb.copy(tmpR).multiplyScalar(Math.cos(b)).addScaledVector(tmpN, Math.sin(b)).normalize();

      st.cockpit.visible = mode === 'pov';

      // Train cars
      for (let i = 0; i < st.cars.length; i++) {
        const car = st.cars[i];
        const cs = sim.s - i * 13.5;
        if (cs < 0 || bt.length < 6) {
          car.visible = false;
          continue;
        }
        car.visible = !(mode === 'pov' && i === 0);
        frameAt(bt, Math.min(cs, bt.length - 0.1), cf);
        cT.set(cf.tx, cf.ty, cf.tz).normalize();
        cN.set(cf.nx, cf.ny, cf.nz).normalize();
        cR.copy(cT).cross(cN).normalize();
        const cbk = cf.bank;
        cNB.copy(cN).multiplyScalar(Math.cos(cbk)).addScaledVector(cR, -Math.sin(cbk)).normalize();
        cRB.copy(cR).multiplyScalar(Math.cos(cbk)).addScaledVector(cN, Math.sin(cbk)).normalize();
        car.position.set(cf.px, cf.py, cf.pz).addScaledVector(cNB, 2.3);
        cBasis.makeBasis(cRB, cNB, cT.clone().negate());
        car.quaternion.setFromRotationMatrix(cBasis);
      }

      if (mode === 'pov') {
        // Vertical G-force inertia: passenger body compresses down on pullouts, floats up on airtime
        const gOffset = Math.max(-0.55, Math.min(0.45, (1 - sim.g) * 0.22));
        target
          .set(f.px, f.py, f.pz)
          .addScaledVector(nb, 3.6 + gOffset)
          .addScaledVector(tmpT, 3.2);

        basis.makeBasis(rb, nb, tmpT.clone().negate());
        q.setFromRotationMatrix(basis);

        // High-frequency harmonic rail vibration (steel wheel contact on tubular rails)
        const sh = sim.shake;
        if (sh > 0.001) {
          const t = now * 0.001;
          const rx = (Math.sin(t * 54.0) * 0.007 + Math.sin(t * 88.0) * 0.003) * sh;
          const ry = Math.sin(t * 42.0) * 0.008 * sh;
          const rz = (Math.sin(t * 63.0) * 0.007 + Math.sin(t * 110.0) * 0.002) * sh;
          q2.setFromEuler(new THREE.Euler(rx, ry, rz));
          q.multiply(q2);
          target.addScaledVector(nb, Math.sin(t * 70) * 0.12 * sh);
        }

        // Fast, responsive tracking without visual lag or jitter
        const kPos = 1 - Math.exp(-dt * 32);
        const kRot = 1 - Math.exp(-dt * 26);
        st.camPos.lerp(target, kPos);
        st.camQuat.slerp(q, kRot);
        st.camera.position.copy(st.camPos);
        st.camera.quaternion.copy(st.camQuat);

        // Realistic dynamic FOV expanding with speed (optical flow rush effect)
        const speedRatio = Math.min(1.2, sim.speed / 85);
        const fovTarget = 64 + speedRatio * 20; // 64 deg at rest -> 84+ deg at high speed
        st.fov += (fovTarget - st.fov) * Math.min(1, dt * 6);

        // In POV mode, the aerial 3D drone hovers overhead tracking the train with its laser pointer beam
        st.aerialDrone.visible = true;
        st.targetReticle.visible = false;
        const droneOverhead = new THREE.Vector3(f.px + 40, f.py + 75, f.pz + 40);
        st.aerialDrone.position.lerp(droneOverhead, 1 - Math.exp(-dt * 4));
        lookM.lookAt(st.aerialDrone.position, new THREE.Vector3(f.px, f.py, f.pz), new THREE.Vector3(0, 1, 0));
        q.setFromRotationMatrix(lookM);
        st.aerialDrone.quaternion.slerp(q, 1 - Math.exp(-dt * 6));
        const distToTrain = st.aerialDrone.position.distanceTo(new THREE.Vector3(f.px, f.py, f.pz));
        st.pointerBeam.scale.set(1, 1, distToTrain);
        st.pointerBeam.visible = true;
      } else if (mode === 'chase') {
        // Chase camera positioned behind the car along the track frame
        const speedRatio = Math.min(1.2, sim.speed / 85);
        target
          .set(f.px, f.py, f.pz)
          .addScaledVector(nb, 11 + speedRatio * 1.5)
          .addScaledVector(tmpT, -36 - speedRatio * 4);
        target.y = Math.max(target.y, bt.groundY + 8);
        const k = 1 - Math.exp(-dt * 12);
        st.camPos.lerp(target, k);
        st.camera.position.copy(st.camPos);

        // Use track normal `nb` as up-vector to avoid gimbal-lock flips in vertical loops
        lookM.lookAt(
          st.camPos,
          new THREE.Vector3(f.px, f.py, f.pz).addScaledVector(tmpT, 8),
          nb,
        );
        q.setFromRotationMatrix(lookM);
        st.camQuat.slerp(q, 1 - Math.exp(-dt * 18));
        st.camera.quaternion.copy(st.camQuat);
        const fovTarget = 60 + speedRatio * 8;
        st.fov += (fovTarget - st.fov) * Math.min(1, dt * 4);

        // In Chase mode, aerial drone hovers overhead tracking the train
        st.aerialDrone.visible = true;
        st.targetReticle.visible = false;
        const droneOverhead = new THREE.Vector3(f.px + 35, f.py + 70, f.pz + 35);
        st.aerialDrone.position.lerp(droneOverhead, 1 - Math.exp(-dt * 4));
        lookM.lookAt(st.aerialDrone.position, new THREE.Vector3(f.px, f.py, f.pz), new THREE.Vector3(0, 1, 0));
        q.setFromRotationMatrix(lookM);
        st.aerialDrone.quaternion.slerp(q, 1 - Math.exp(-dt * 6));
        const distToTrain = st.aerialDrone.position.distanceTo(new THREE.Vector3(f.px, f.py, f.pz));
        st.pointerBeam.scale.set(1, 1, distToTrain);
        st.pointerBeam.visible = true;
      } else {
        // =============================================================
        // Aerial Mode: Movable 3D Model with Pointer (NO AUTO-SPIN)
        // =============================================================
        const targetPos = new THREE.Vector3();
        if (propsRef.current.aerialFollow) {
          targetPos.set(f.px, f.py, f.pz);
          st.aerialTarget.lerp(targetPos, 1 - Math.exp(-dt * 6));
        } else {
          targetPos.copy(st.aerialTarget);
        }

        // Calculate drone position from user pointer azimuth, elevation, and distance
        const cosEl = Math.cos(st.aerialElevation);
        const sinEl = Math.sin(st.aerialElevation);
        const droneX = targetPos.x + Math.sin(st.aerialAzimuth) * cosEl * st.aerialDist;
        const droneY = targetPos.y + sinEl * st.aerialDist;
        const droneZ = targetPos.z + Math.cos(st.aerialAzimuth) * cosEl * st.aerialDist;
        const dronePos = new THREE.Vector3(droneX, Math.max(bt.groundY + 8, droneY), droneZ);

        // Position and orient the Movable 3D Aerial Drone Model
        st.aerialDrone.visible = true;
        st.aerialDrone.position.copy(dronePos);

        lookM.lookAt(dronePos, targetPos, new THREE.Vector3(0, 1, 0));
        q.setFromRotationMatrix(lookM);
        st.aerialDrone.quaternion.copy(q);

        // Directional pointer beam points accurately from drone to target
        const distToTarget = dronePos.distanceTo(targetPos);
        st.pointerBeam.scale.set(1, 1, distToTarget);
        st.pointerBeam.visible = true;

        // Ground reticle target ring
        st.targetReticle.position.set(targetPos.x, targetPos.y + 0.6, targetPos.z);
        st.targetReticle.visible = true;

        // Position camera behind and elevated from the movable 3D aerial model,
        // giving a pristine view of the 3D craft and its directional pointer beam navigating the scene
        const droneForward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const droneUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        target.copy(dronePos)
          .addScaledVector(droneForward, -22)
          .addScaledVector(droneUp, 9);
        target.y = Math.max(target.y, bt.groundY + 6);

        st.camPos.lerp(target, 1 - Math.exp(-dt * 14));
        st.camera.position.copy(st.camPos);

        lookM.lookAt(st.camPos, targetPos, new THREE.Vector3(0, 1, 0));
        q.setFromRotationMatrix(lookM);
        st.camQuat.slerp(q, 1 - Math.exp(-dt * 14));
        st.camera.quaternion.copy(st.camQuat);
        st.fov += (58 - st.fov) * Math.min(1, dt * 4);
      }

      if (mode !== 'orbit') {
        st.surveyMarker.visible = false;
        st.surveyLabel.style.display = 'none';
        st.hoveredPiece = null;
      } else if (st.surveyMarker.visible) {
        st.surveyMarker.quaternion.copy(st.camera.quaternion);
        const pulse = 1 + Math.sin(now * 0.008) * 0.12;
        st.surveyMarker.scale.setScalar(pulse);
      }

      if (Math.abs(st.camera.fov - st.fov) > 0.05) {
        st.camera.fov = st.fov;
        st.camera.updateProjectionMatrix();
      }
      st.renderer.render(st.scene, st.camera);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <div ref={wrapRef} className="absolute inset-0 overflow-hidden" />;
}
