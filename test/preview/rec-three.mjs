// «Записывающая» заглушка three: строит настоящую геометрию и матрицы, чтобы отрисовать модели в SVG.
globalThis.document ??= { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), width: 0, height: 0 }) };
globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), width: 0, height: 0 }) };
const mul = (a, b) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j]; return r; };
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const Rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; };
const Ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; };
const Rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
export const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3], m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7], m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11]];

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; this.order = 'XYZ'; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { this.x = this.y = this.z = s; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  toArray() { return [this.x, this.y, this.z]; }
}
export class Object3D {
  constructor() { this.position = new V3(); this.rotation = new V3(); this.scale = new V3(1, 1, 1); this.children = []; this.parent = null; this.visible = true; this.userData = {}; }
  add(...os) { for (const o of os) { this.children.push(o); o.parent = this; } return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); return this; }
  lookAt() {} rotateZ(a) { this.rotation.z += a; return this; }
  local() {
    const R = { X: Rx(this.rotation.x), Y: Ry(this.rotation.y), Z: Rz(this.rotation.z) };
    const o = this.rotation.order || 'XYZ';
    let m = mul(mul(R[o[0]], R[o[1]]), R[o[2]]);
    const S = [this.scale.x, 0, 0, 0, 0, this.scale.y, 0, 0, 0, 0, this.scale.z, 0, 0, 0, 0, 1];
    m = mul(m, S);
    m[3] = this.position.x; m[7] = this.position.y; m[11] = this.position.z;
    return m;
  }
}
export class Geom {
  constructor(v = [], f = []) { this.v = v; this.f = f; this.attributes = {}; }
  tf(m) { this.v = this.v.map((p) => apply(m, p)); return this; }
  rotateX(a) { return this.tf(Rx(a)); } rotateY(a) { return this.tf(Ry(a)); } rotateZ(a) { return this.tf(Rz(a)); }
  translate(x, y, z) { this.v = this.v.map((p) => [p[0] + x, p[1] + y, p[2] + z]); return this; }
  scale(x, y, z) { this.v = this.v.map((p) => [p[0] * x, p[1] * y, p[2] * z]); return this; }
  setAttribute() { return this; }
}
export class BoxGeometry extends Geom {
  constructor(w = 1, h = 1, d = 1) {
    const x = w / 2, y = h / 2, z = d / 2;
    super([[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]],
      [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]]);
  }
}
export class CylinderGeometry extends Geom {
  constructor(rt = 1, rb = 1, h = 1, seg = 8) {
    const v = [], f = [];
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; v.push([Math.sin(a) * rt, h / 2, Math.cos(a) * rt]); }
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; v.push([Math.sin(a) * rb, -h / 2, Math.cos(a) * rb]); }
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; f.push([i, seg + i, seg + j, j]); }
    f.push([...Array(seg).keys()].reverse()); f.push([...Array(seg).keys()].map((i) => seg + i));
    super(v, f);
  }
}
export class SphereGeometry extends Geom {
  constructor(r = 1, ws = 8, hs = 6, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) {
    const v = [], f = [];
    for (let iy = 0; iy <= hs; iy++) for (let ix = 0; ix <= ws; ix++) {
      const u = ps + (ix / ws) * pl, t = ts + (iy / hs) * tl;
      v.push([-r * Math.cos(u) * Math.sin(t), r * Math.cos(t), r * Math.sin(u) * Math.sin(t)]);
    }
    for (let iy = 0; iy < hs; iy++) for (let ix = 0; ix < ws; ix++) {
      const a = iy * (ws + 1) + ix, b = a + 1, c = a + ws + 1, d = c + 1;
      f.push([a, c, d, b]);
    }
    super(v, f);
  }
}
export class CapsuleGeometry extends Geom {
  constructor(r = 1, len = 1, cs = 3, rs = 8) {
    const v = [], f = [], rings = [];
    for (let i = 0; i <= cs; i++) { const t = (i / cs) * Math.PI / 2; rings.push([Math.sin(t) * r, len / 2 + Math.cos(t) * r]); }
    for (let i = cs; i >= 0; i--) { const t = (i / cs) * Math.PI / 2; rings.push([Math.sin(t) * r, -len / 2 - Math.cos(t) * r]); }
    for (const [rr, y] of rings) for (let k = 0; k <= rs; k++) { const a = (k / rs) * Math.PI * 2; v.push([Math.sin(a) * rr, y, Math.cos(a) * rr]); }
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < rs; k++) { const a = i * (rs + 1) + k; f.push([a, a + 1, a + rs + 2, a + rs + 1]); }
    super(v, f);
  }
}
export class BufferGeometry { constructor() { this.attributes = {}; } setAttribute(n, a) { this.attributes[n] = a; return this; } }
export class Float32BufferAttribute { constructor(arr, n) { this.array = arr; this.itemSize = n; } }
export class PlaneGeometry extends Geom { constructor(w = 1, h = 1) { super([[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]], [[0, 1, 2, 3]]); } }
export class ConeGeometry extends CylinderGeometry { constructor(r, h, seg) { super(0.001, r, h, seg); } }
export class OctahedronGeometry extends BoxGeometry {}
export class Mat {
  constructor(p = {}) { Object.assign(this, p); this.col = typeof p.color === 'number' ? p.color : 0x888888; this.color = { setHex: (h) => { this.col = h; }, set() {} }; if (this.opacity === undefined) this.opacity = 1; }
}
export class Mesh extends Object3D { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
export class Sprite extends Object3D { constructor(m) { super(); this.material = m; this.isSprite = true; } }
export class Group extends Object3D {}
export class Scene extends Object3D {}
export class PerspectiveCamera extends Object3D { updateProjectionMatrix() {} }
export class CanvasTexture { constructor() { this.repeat = new V3(); } }
export const MeshPhongMaterial = Mat, MeshLambertMaterial = Mat, MeshBasicMaterial = Mat, SpriteMaterial = Mat;
export const SRGBColorSpace = 'srgb', DoubleSide = 2, AdditiveBlending = 2;
export { mul, I };
