import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { BuiltTrack, Frame, frameAt, makeFrame } from '../lib/track';
import { SimState } from '../lib/physics';
import { Theme } from '../lib/themes';

export type CamMode = 'pov' | 'chase' | 'orbit';

interface Props {
  built: BuiltTrack;
  simRef: React.RefObject<SimState>;
  theme: Theme;
  camMode: CamMode;
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
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6ec25a';
  g.fillRect(0, 0, 128, 128);
  const rnd = mulberry(7);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * 128;
    const y = rnd() * 128;
    const r = 2 + rnd() * 7;
    g.fillStyle = rnd() > 0.5 ? 'rgba(96,180,74,0.55)' : 'rgba(132,204,102,0.55)';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(70,150,60,0.35)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(220, 220);
  tex.anisotropy = 4;
  return tex;
}

export default function Ride3D({ built, simRef, theme, camMode }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    trackGroup: THREE.Group;
    sceneryGroup: THREE.Group;
    ground: THREE.Mesh;
    sun: THREE.DirectionalLight;
    cockpit: THREE.Group;
    cars: THREE.Group[];
    carMat: THREE.MeshLambertMaterial;
    camPos: THREE.Vector3;
    camQuat: THREE.Quaternion;
    fov: number;
    orbit: number;
    ready: boolean;
  } | null>(null);
  const propsRef = useRef({ built, simRef, theme, camMode });
  propsRef.current = { built, simRef, theme, camMode };

  // ------------------------------------------------------------------ setup
  useEffect(() => {
    const wrap = wrapRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(wrap.clientWidth || 600, wrap.clientHeight || 400);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xcfe8ff, 700, 3400);

    const camera = new THREE.PerspectiveCamera(66, 1, 0.4, 9000);
    camera.position.set(0, 40, 120);

    // Sky dome
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#2f7fe0') },
        mid: { value: new THREE.Color('#8ec6f7') },
        bottom: { value: new THREE.Color('#e8f4ff') },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 c = mix(bottom, mid, smoothstep(-0.05, 0.28, h));
          c = mix(c, top, smoothstep(0.25, 0.85, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 24, 16), skyMat);
    sky.frustumCulled = false;
    scene.add(sky);

    // Lights
    const hemi = new THREE.HemisphereLight(0xdcefff, 0x6aa84f, 1.05);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff6e0, 1.5);
    sun.position.set(360, 620, 240);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0009;
    scene.add(sun);
    scene.add(sun.target);

    // Ground plane
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000),
      new THREE.MeshLambertMaterial({ map: groundTexture() }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const trackGroup = new THREE.Group();
    scene.add(trackGroup);
    const sceneryGroup = new THREE.Group();
    scene.add(sceneryGroup);

    // Train cars
    const carMat = new THREE.MeshLambertMaterial({ color: 0xfacc15 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x1f2937 });
    const cars: THREE.Group[] = [];
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(7.4, 3.2, 11.5), i === 0 ? carMat : darkMat);
      body.castShadow = true;
      c.add(body);
      for (const z of [3.1, -3.1]) {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(6.6, 2.4, 1.4), darkMat);
        seat.position.set(0, 2.4, z);
        seat.castShadow = true;
        c.add(seat);
      }
      if (i === 0) {
        const nosecone = new THREE.Mesh(new THREE.ConeGeometry(3.3, 5, 6), carMat);
        nosecone.rotation.x = -Math.PI / 2;
        nosecone.position.set(0, 0, -7.5);
        c.add(nosecone);
      }
      scene.add(c);
      cars.push(c);
    }

    // Cockpit for POV camera
    const cockpit = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x1f2937 });
    const nose = new THREE.Mesh(new THREE.BoxGeometry(7.2, 2.0, 7), bodyMat);
    nose.position.set(0, -3.1, -4.2);
    cockpit.add(nose);
    const accentMat = new THREE.MeshLambertMaterial({ color: 0xfacc15 });
    const lip = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.55, 1.1), accentMat);
    lip.position.set(0, -2.2, -7.1);
    cockpit.add(lip);
    const barMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 5.4, 8), barMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, -1.6, -2.6);
    cockpit.add(bar);
    const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.2, 6), barMat);
    post1.position.set(-2.6, -2.5, -2.6);
    cockpit.add(post1);
    const post2 = post1.clone();
    post2.position.x = 2.6;
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
      cockpit,
      cars,
      carMat,
      camPos: new THREE.Vector3(0, 40, 120),
      camQuat: new THREE.Quaternion(),
      fov: 66,
      orbit: 0,
      ready: true,
    };

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
      st.carMat.color.set(theme.car);
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

      const railMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.rail) });
      const spineMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.spine) });
      const tieMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.tie) });
      const supMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.support) });

      const segs = Math.min(2400, n);
      for (const pts of [left, right]) {
        const geo = new THREE.TubeGeometry(new PointsCurve(pts), segs, 0.62, 6, false);
        const mesh = new THREE.Mesh(geo, railMat);
        mesh.castShadow = true;
        st.trackGroup.add(mesh);
      }
      const spineGeo = new THREE.TubeGeometry(new PointsCurve(spine), Math.floor(segs / 2), 1.15, 6, false);
      const spineMesh = new THREE.Mesh(spineGeo, spineMat);
      spineMesh.castShadow = true;
      st.trackGroup.add(spineMesh);

      // Cross ties
      const ds = S[1].s - S[0].s || 1.6;
      const tieEvery = Math.max(2, Math.round(6.5 / ds));
      const tieCount = Math.floor(n / tieEvery);
      const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), tieMat, tieCount);
      ties.castShadow = true;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      let ti = 0;
      for (let i = 0; i < n && ti < tieCount; i += tieEvery, ti++) {
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
      }
      ties.count = ti;
      ties.instanceMatrix.needsUpdate = true;
      st.trackGroup.add(ties);

      // Supports
      const supEvery = Math.max(4, Math.round(26 / ds));
      const supMax = Math.floor(n / supEvery) + 2;
      const sup = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), supMat, supMax);
      sup.castShadow = true;
      let si = 0;
      for (let i = 0; i < n && si < supMax; i += supEvery) {
        const s = S[i];
        if (s.py - G < 8) continue;
        const nb = nbArr[i];
        if (nb.y < 0.35) continue; // Skip columns through inverted loop portions
        const hgt = s.py - G - 1.5;
        m4.compose(
          new THREE.Vector3(s.px, G + hgt / 2, s.pz),
          new THREE.Quaternion(),
          new THREE.Vector3(2.1, hgt, 2.1),
        );
        sup.setMatrixAt(si, m4);
        si++;
      }
      sup.count = si;
      sup.instanceMatrix.needsUpdate = true;
      st.trackGroup.add(sup);

      // Station platform
      const plat = new THREE.Mesh(
        new THREE.BoxGeometry(26, 2, 16),
        new THREE.MeshLambertMaterial({ color: 0xcbd5e1 }),
      );
      const s0 = S[0];
      plat.position.set(s0.px + 6, s0.py - 3, s0.pz);
      plat.receiveShadow = true;
      st.trackGroup.add(plat);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(17, 8, 4),
        new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.accent) }),
      );
      roof.rotation.y = Math.PI / 4;
      roof.position.set(s0.px + 6, s0.py + 9, s0.pz);
      roof.castShadow = true;
      st.trackGroup.add(roof);

      // Scenery
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

      const trunkGeo = new THREE.CylinderGeometry(1.1, 1.5, 7, 5);
      const leafGeo = new THREE.ConeGeometry(6.5, 20, 6);
      const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8b5e3c });
      const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f9e4d });
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

      // Distant hills
      const hillMat = new THREE.MeshLambertMaterial({ color: 0x74b85f, flatShading: true });
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
      const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9ab8d8, emissiveIntensity: 0.25 });
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
  }, [built, theme]);

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

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const st = stateRef.current;
      if (!st) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { built: bt, simRef: sr, camMode: mode } = propsRef.current;
      const sim = sr.current;
      if (bt.samples.length < 4) {
        st.renderer.render(st.scene, st.camera);
        return;
      }

      frameAt(bt, Math.min(sim.s, bt.length - 0.1), f);
      tmpT.set(f.tx, f.ty, f.tz).normalize();
      tmpN.set(f.nx, f.ny, f.nz).normalize();
      tmpR.copy(tmpT).cross(tmpN).normalize();
      const dynamicLean = Math.max(-0.3, Math.min(0.3, sim.lat * 0.1));
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
        target.set(f.px, f.py, f.pz).addScaledVector(nb, 3.6).addScaledVector(tmpT, 3.2);
        basis.makeBasis(rb, nb, tmpT.clone().negate());
        q.setFromRotationMatrix(basis);

        // Dynamic speed shake
        const sh = sim.shake;
        if (sh > 0.001) {
          const t = now * 0.001;
          const rx = Math.sin(t * 37.1) * 0.010 * sh + Math.sin(t * 13.3) * 0.004 * sh;
          const ry = Math.sin(t * 29.7) * 0.012 * sh;
          const rz = Math.sin(t * 23.3) * 0.010 * sh;
          q2.setFromEuler(new THREE.Euler(rx, ry, rz));
          q.multiply(q2);
          target.addScaledVector(nb, Math.sin(t * 41) * 0.16 * sh);
        }
        const k = 1 - Math.exp(-dt * 22);
        st.camPos.lerp(target, k);
        st.camQuat.slerp(q, 1 - Math.exp(-dt * 16));
        st.camera.position.copy(st.camPos);
        st.camera.quaternion.copy(st.camQuat);

        // Speed fov effect (imperial mph scaling)
        const fovTarget = 62 + Math.min(28, (sim.speed / 85) * 26);
        st.fov += (fovTarget - st.fov) * Math.min(1, dt * 3);
      } else if (mode === 'chase') {
        // Chase camera positioned behind the car along the track frame
        target
          .set(f.px, f.py, f.pz)
          .addScaledVector(nb, 11)
          .addScaledVector(tmpT, -36);
        target.y = Math.max(target.y, bt.groundY + 8);
        const k = 1 - Math.exp(-dt * 7);
        st.camPos.lerp(target, k);
        st.camera.position.copy(st.camPos);

        // Use track normal `nb` as up-vector to avoid gimbal-lock flips in vertical loops
        lookM.lookAt(
          st.camPos,
          new THREE.Vector3(f.px, f.py, f.pz).addScaledVector(tmpT, 10),
          nb,
        );
        q.setFromRotationMatrix(lookM);
        st.camQuat.slerp(q, 1 - Math.exp(-dt * 12));
        st.camera.quaternion.copy(st.camQuat);
        st.fov += (60 - st.fov) * Math.min(1, dt * 3);
      } else {
        // Aerial orbit
        st.orbit += dt * 0.09;
        const r = bt.radius3 * 1.9 + 160;
        const cx = bt.center3.x;
        const cz = bt.center3.z;
        target.set(
          cx + Math.cos(st.orbit) * r,
          bt.maxHeight * 0.9 + 110,
          cz + Math.sin(st.orbit) * r,
        );
        st.camPos.lerp(target, 1 - Math.exp(-dt * 5));
        st.camera.position.copy(st.camPos);
        lookM.lookAt(st.camPos, new THREE.Vector3(cx, bt.maxHeight * 0.35, cz), new THREE.Vector3(0, 1, 0));
        q.setFromRotationMatrix(lookM);
        st.camQuat.slerp(q, 1 - Math.exp(-dt * 6));
        st.camera.quaternion.copy(st.camQuat);
        st.fov += (55 - st.fov) * Math.min(1, dt * 3);
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
