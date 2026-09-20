import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { BuiltTrack, Frame, frameAt, makeFrame } from '../lib/track';
import { CoasterMaterial, SimState } from '../lib/physics';
import { Theme } from '../lib/themes';

export type CamMode = 'pov' | 'chase' | 'orbit';
export type WeatherType = 'day' | 'sunset' | 'night' | 'storm';

interface Props {
  built: BuiltTrack;
  simRef: React.RefObject<SimState>;
  theme: Theme;
  material?: CoasterMaterial;
  camMode: CamMode;
  weather?: WeatherType;
  aerialFollow?: boolean;
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

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4c8738';
  g.fillRect(0, 0, 256, 256);
  const rnd = mulberry(101);
  // Realistic grassy field variation with fine noise
  for (let i = 0; i < 750; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const r = 1.2 + rnd() * 5.5;
    const val = rnd();
    g.fillStyle =
      val < 0.38
        ? 'rgba(56,108,40,0.65)'
        : val < 0.72
          ? 'rgba(88,155,62,0.60)'
          : 'rgba(118,178,76,0.50)';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Fine grass blades and soil variation
  g.strokeStyle = 'rgba(132,196,96,0.45)';
  g.lineWidth = 1.4;
  for (let i = 0; i < 160; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 5, y - 3 - rnd() * 5);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(160, 160);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function Ride3D({
  built,
  simRef,
  theme,
  material = 'metal',
  camMode,
  weather = 'day',
  aerialFollow = true,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    trackGroup: THREE.Group;
    sceneryGroup: THREE.Group;
    ground: THREE.Mesh;
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
  const propsRef = useRef({ built, simRef, theme, material, camMode, weather, aerialFollow });
  propsRef.current = { built, simRef, theme, material, camMode, weather, aerialFollow };

  // ------------------------------------------------------------------ setup
  useEffect(() => {
    const wrap = wrapRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(wrap.clientWidth || 600, wrap.clientHeight || 400);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xcfe8ff, 650, 3600);

    const camera = new THREE.PerspectiveCamera(66, 1, 0.4, 9000);
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
    const sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 24, 16), skyMat);
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

    // Ground plane with PBR Standard Material
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000),
      new THREE.MeshStandardMaterial({
        map: groundTexture(),
        roughness: 0.88,
        metalness: 0.04,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const trackGroup = new THREE.Group();
    scene.add(trackGroup);
    const sceneryGroup = new THREE.Group();
    scene.add(sceneryGroup);

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

    renderer.domElement.style.touchAction = 'none';

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
          st.aerialDist = Math.max(30, Math.min(3200, initialAerialDist * ratio));
        }
        return;
      }

      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

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
      if (activePointers.size < 2) {
        initialPinchDist = 0;
      }
      isDragging = false;
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {}
      renderer.domElement.style.cursor = propsRef.current.camMode === 'orbit' ? 'grab' : 'default';
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
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      renderer.dispose();
      if (renderer.domElement.parentElement === wrap) wrap.removeChild(renderer.domElement);
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
      dispose(st.trackGroup);
      dispose(st.sceneryGroup);
      if (S.length < 4) return;

      const G = built.groundY;
      st.ground.position.y = G;

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
        });
        spineMat = new THREE.MeshStandardMaterial({
          color: 0x78350f, // Heavy dark timber ledger
          roughness: 0.88,
          metalness: 0.04,
        });
        tieMat = new THREE.MeshStandardMaterial({
          color: 0x92400e, // Wooden railroad ties
          roughness: 0.92,
          metalness: 0.03,
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
        });
        spineMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme.spine),
          roughness: 0.28,
          metalness: 0.03,
        });
        tieMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme.tie),
          roughness: 0.35,
          metalness: 0.02,
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
        });
        spineMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme.spine),
          roughness: 0.32,
          metalness: 0.62,
          envMapIntensity: 1.1,
        });
        tieMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme.tie),
          roughness: 0.40,
          metalness: 0.52,
        });
        supMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(theme.support),
          roughness: 0.42,
          metalness: 0.45,
        });
        footerMat = new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.92,
          metalness: 0.05,
        });
      }

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
          const mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = true;
          st.trackGroup.add(mesh);
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
      st.trackGroup.add(ties);

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

      // Supports with realistic tubular columns and concrete foundation footers
      const supEvery = Math.max(4, Math.round(26 / ds));
      const supMax = Math.floor(n / supEvery) + 2;
      const sup = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.2, 1.2, 1, 10), supMat, supMax);
      sup.castShadow = true;
      const footers = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.4, 2.9, 2.6, 8), footerMat, supMax);
      footers.receiveShadow = true;
      let si = 0;
      for (let i = 0; i < n && si < supMax; i += supEvery) {
        if (isJumpGap(i)) continue;
        const s = S[i];
        if (s.py - G < 8) continue;
        const nb = nbArr[i];
        if (nb.y < 0.35) continue; // Skip columns through inverted loop portions
        const hgt = s.py - G - 1.5;

        // Support column
        m4.compose(
          new THREE.Vector3(s.px, G + hgt / 2, s.pz),
          new THREE.Quaternion(),
          new THREE.Vector3(1, hgt, 1),
        );
        sup.setMatrixAt(si, m4);

        // Concrete footer at ground level
        m4.compose(
          new THREE.Vector3(s.px, G + 1.3, s.pz),
          new THREE.Quaternion(),
          new THREE.Vector3(1, 1, 1),
        );
        footers.setMatrixAt(si, m4);
        si++;
      }
      sup.count = si;
      sup.instanceMatrix.needsUpdate = true;
      footers.count = si;
      footers.instanceMatrix.needsUpdate = true;
      st.trackGroup.add(sup);
      st.trackGroup.add(footers);

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
      const spread = built.radius3 * 2.4 + 400;

      const trunkGeo = new THREE.CylinderGeometry(1.1, 1.5, 7, 6);
      const leafGeo = new THREE.ConeGeometry(6.5, 20, 6);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e4a2e, roughness: 0.90, metalness: 0.05 });
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.65, metalness: 0.02 });
      const COUNT = 150;
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
  }, [built, theme, material]);

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
        (st.scene.fog as THREE.Fog).color.set(0xfb923c);
        (st.scene.fog as THREE.Fog).near = 500;
        (st.scene.fog as THREE.Fog).far = 3200;
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
        (st.scene.fog as THREE.Fog).color.set(0x0a0f1d);
        (st.scene.fog as THREE.Fog).near = 380;
        (st.scene.fog as THREE.Fog).far = 2200;
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
        (st.scene.fog as THREE.Fog).color.set(0x334155);
        (st.scene.fog as THREE.Fog).near = 220;
        (st.scene.fog as THREE.Fog).far = 1700;
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
        (st.scene.fog as THREE.Fog).color.set(0xcfe8ff);
        (st.scene.fog as THREE.Fog).near = 650;
        (st.scene.fog as THREE.Fog).far = 3600;
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
