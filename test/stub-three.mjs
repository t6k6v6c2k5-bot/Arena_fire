// Заглушка three для дымового теста клиента в Node (без WebGL).
// Любой класс three — «всеядный» прокси: конструируется, вызывается, принимает любые свойства.
function make() {
  const cache = {};
  const f = function () {};
  return new Proxy(f, {
    get(_t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;
      if (p === Symbol.iterator) return undefined;
      return (cache[p] ??= make());
    },
    set(_t, p, v) { cache[p] = v; return true; },
    apply() { return make(); },
    construct() { return make(); },
  });
}
const U = make;

// Vector3 нужен по-настоящему: клиент считает по нему трассеры.
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  crossVectors(a, b) {
    this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; return this;
  }
}

// Минимальный Object3D: хранит трансформации и иерархию, чтобы математика моделей и эффектов реально считалась.
class V3b {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; this.order = 'XYZ'; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { this.x = this.y = this.z = s; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
}
class Obj {
  constructor() {
    this.position = new V3b(); this.rotation = new V3b(); this.scale = new V3b(1, 1, 1);
    this.children = []; this.parent = null; this.visible = true; this.userData = {}; this.renderOrder = 0;
  }
  add(...os) { for (const o of os) { this.children.push(o); o.parent = this; } return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); return this; }
  lookAt() {}
  rotateZ(a) { this.rotation.z += a; return this; }
  updateMatrixWorld() {}
}
class Geom {
  constructor(...args) { this.args = args; this.attributes = make(); }
  rotateX() { return this; } rotateY() { return this; } rotateZ() { return this; } translate() { return this; } setAttribute() { return this; }
}
class Mat {
  constructor(p = {}) { Object.assign(this, p); this.color = { set() {}, setHex(h) { this.hex = h; }, hex: p.color }; if (this.opacity === undefined) this.opacity = 1; }
}
class MeshS extends Obj { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
class SpriteS extends Obj { constructor(material) { super(); this.material = material; } }
class Cam extends Obj {
  constructor(fov = 50) { super(); this.fov = fov; this.aspect = 1; }
  updateProjectionMatrix() { this.projections = (this.projections || 0) + 1; }
}
class SceneS extends Obj {}
class Tex { constructor(c) { this.image = c; this.repeat = new V3b(); } }

export const Scene = SceneS, PerspectiveCamera = Cam, HemisphereLight = Obj, DirectionalLight = Obj, AmbientLight = Obj,
  Group = Obj, Mesh = MeshS, Sprite = SpriteS,
  BoxGeometry = Geom, PlaneGeometry = Geom, SphereGeometry = Geom, ConeGeometry = Geom, CylinderGeometry = Geom, CapsuleGeometry = Geom,
  OctahedronGeometry = Geom,
  MeshLambertMaterial = Mat, MeshPhongMaterial = Mat, MeshBasicMaterial = Mat, SpriteMaterial = Mat, LineBasicMaterial = Mat,
  CanvasTexture = Tex;
export const Color = U(), WebGLRenderer = U(), EdgesGeometry = U(), LineSegments = U(), Float32BufferAttribute = U(), Fog = U(),
  BufferGeometry = U(), Line = U();
export const SRGBColorSpace = 'srgb', RepeatWrapping = 1000, NearestFilter = 1003, BackSide = 1, DoubleSide = 2, AdditiveBlending = 2;
