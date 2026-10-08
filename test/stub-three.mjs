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

export const Scene = U(), Color = U(), PerspectiveCamera = U(), HemisphereLight = U(), DirectionalLight = U(),
  AmbientLight = U(), WebGLRenderer = U(), EdgesGeometry = U(), LineSegments = U(), BoxGeometry = U(), Mesh = U(),
  MeshLambertMaterial = U(), LineBasicMaterial = U(), CanvasTexture = U(), PlaneGeometry = U(), MeshBasicMaterial = U(),
  SphereGeometry = U(), Float32BufferAttribute = U(), Fog = U(), ConeGeometry = U(), Group = U(), Sprite = U(),
  SpriteMaterial = U(), BufferGeometry = U(), Line = U(), OctahedronGeometry = U();
export const SRGBColorSpace = 'srgb', RepeatWrapping = 1000, NearestFilter = 1003, BackSide = 1, DoubleSide = 2, AdditiveBlending = 2;
