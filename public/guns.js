// Детальные модели оружия (low-poly, запечённые в несколько мешей). Ствол смотрит в −Z, верх — +Y.
import * as THREE from 'three';
import { Part, cachedGeo, glossMat, matteMat, shade } from './geo.js';

const K = {
  gun: 0x2c3036, black: 0x141619, steel: 0x9aa3ad, dsteel: 0x4b5159, wood: 0x8b5a2e, wood2: 0x5f3a1b,
  poly: 0x2a2d31, olive: 0x4a5640, brass: 0xc9a23c, red: 0xb3281f, lens: 0x3a7ac0, tan: 0x9d8b63, rubber: 0x0e0f11,
};

let flashMat = null;
function makeFlash(size) {
  flashMat ??= new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const f = new THREE.Group();
  const g1 = cachedGeo('flashA', () => flashPart(false));
  const g2 = cachedGeo('flashB', () => flashPart(true));
  f.add(new THREE.Mesh(g1, flashMat), new THREE.Mesh(g2, flashMat));
  f.scale.setScalar(size);
  f.visible = false;
  return f;
}
// вспышка: звезда из длинных узких граней вдоль ствола + диск
function flashPart(rot) {
  const p = new Part();
  const z = rot ? Math.PI / 2 : 0;
  p.box(0.004, 0.12, 0.34, 0xffe2a0, 0, 0, -0.14, 0, 0, z);
  p.box(0.004, 0.06, 0.2, 0xffffff, 0, 0, -0.1, 0, 0, z);
  if (!rot) p.box(0.14, 0.14, 0.004, 0xffc060, 0, 0, -0.02);
  return p;
}

const mk = (key, build, glossy) => new THREE.Mesh(cachedGeo(key, build), glossy ? glossMat() : matteMat());

// Возвращает Group; userData: mag, mover, muzzle, eject, grip, fore, hold, magDrop, magHold, type, sightY, adsZ, travel, flash
export function buildGun(index) {
  const g = new THREE.Group();
  const ud = g.userData;
  const mag = new THREE.Group(), mover = new THREE.Group();
  g.add(mag, mover);
  const k = `gun${index}`;

  if (index === 0) { // автомат (АК-образный)
    g.add(mk(k + 'm', () => {
      const p = new Part();
      p.box(0.062, 0.078, 0.38, K.gun, 0, 0, 0.02);                      // ствольная коробка
      p.box(0.054, 0.024, 0.34, K.dsteel, 0, 0.049, 0.02);                // крышка
      for (let i = 0; i < 4; i++) p.box(0.058, 0.006, 0.014, K.black, 0, 0.063, -0.1 + i * 0.06);
      p.box(0.07, 0.03, 0.05, K.dsteel, 0, 0.0, -0.2);                    // казённик/узел крепления
      p.tz(0.0115, 0.0115, 0.26, K.steel, 0, 0.05, -0.37, { seg: 8 });    // газовая трубка
      p.box(0.032, 0.05, 0.05, K.gun, 0, 0.032, -0.52);                   // газоблок
      p.tz(0.0125, 0.0125, 0.34, K.dsteel, 0, 0.012, -0.56, { seg: 10 }); // ствол
      p.tz(0.0175, 0.0175, 0.065, K.black, 0, 0.012, -0.76, { seg: 10 }); // дульный тормоз
      p.box(0.036, 0.006, 0.02, K.dsteel, 0, 0.012, -0.76);
      p.box(0.022, 0.05, 0.02, K.gun, 0, 0.05, -0.7);                     // основание мушки
      p.box(0.005, 0.03, 0.005, K.black, 0, 0.084, -0.7);
      p.box(0.032, 0.02, 0.05, K.dsteel, 0, 0.059, -0.2);                 // прицельная колодка
      p.box(0.004, 0.02, 0.008, K.black, 0, 0.074, -0.19);
      p.box(0.008, 0.05, 0.016, K.steel, 0.036, 0.0, 0.03);               // флажок предохранителя
      p.box(0.007, 0.007, 0.1, K.dsteel, 0, -0.115, 0.06);                // спусковая скоба
      p.box(0.007, 0.036, 0.007, K.dsteel, 0, -0.098, 0.108);
      p.box(0.007, 0.032, 0.007, K.dsteel, 0, -0.098, 0.012);
      p.box(0.006, 0.03, 0.01, K.steel, 0, -0.085, 0.06, -0.3);           // спуск
      p.box(0.02, 0.02, 0.02, K.dsteel, 0, 0.0, -0.78);
      return p;
    }, true));
    g.add(mk(k + 'p', () => {
      const p = new Part();
      p.box(0.07, 0.048, 0.21, K.wood, 0, -0.012, -0.31);                 // нижнее цевьё
      p.box(0.062, 0.03, 0.18, K.wood, 0, 0.034, -0.31);                  // верхняя накладка
      for (let i = 0; i < 5; i++) p.box(0.072, 0.004, 0.006, K.wood2, 0, -0.006, -0.39 + i * 0.04);
      p.box(0.048, 0.1, 0.056, K.wood2, 0, -0.098, 0.14, 0.32);           // рукоять
      p.box(0.054, 0.1, 0.26, K.wood, 0, -0.018, 0.32, 0.06);             // приклад
      p.box(0.056, 0.012, 0.2, K.wood2, 0, 0.034, 0.31, 0.06);
      p.box(0.056, 0.115, 0.016, K.rubber, 0, -0.025, 0.455, 0.06);       // затылок
      return p;
    }, false));
    mag.add(mk(k + 'mag', () => {
      const p = new Part();
      p.box(0.052, 0.11, 0.07, K.poly, 0, -0.085, -0.025, 0.1);
      p.box(0.052, 0.1, 0.07, K.poly, 0, -0.18, 0.0, 0.34);
      p.box(0.054, 0.012, 0.074, K.black, 0, -0.145, -0.012, 0.22);
      p.box(0.056, 0.012, 0.074, K.black, 0, -0.226, 0.03, 0.4);
      return p;
    }, false));
    mover.add(mk(k + 'v', () => new Part().box(0.016, 0.026, 0.05, K.steel, 0.04, 0.026, -0.04).box(0.012, 0.012, 0.02, K.dsteel, 0.048, 0.026, -0.06), true));
    ud.muzzle = [0, 0.012, -0.8]; ud.eject = [0.04, 0.03, -0.02];
    ud.grip = [0, -0.12, 0.13]; ud.fore = [0, -0.05, -0.32]; ud.hold = [0.12, -0.16, -0.16];
    ud.magDrop = [0, -0.2, 0.0]; ud.magHold = [0, -0.1, -0.03]; ud.type = 'mag'; ud.sightY = 0.084; ud.adsZ = -0.34; ud.travel = 0.05; ud.flashSize = 1;
  } else if (index === 1) { // пистолет
    g.add(mk(k + 'f', () => {
      const p = new Part();
      p.box(0.038, 0.032, 0.185, K.poly, 0, 0.006, -0.02);                // рамка
      p.box(0.03, 0.012, 0.05, K.poly, 0, 0.0, -0.1);                     // рельса
      p.box(0.044, 0.112, 0.062, K.poly, 0, -0.072, 0.075, 0.2);          // рукоять
      for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) p.box(0.004, 0.018, 0.034, K.black, sx * 0.023, -0.05 - i * 0.026, 0.07 + i * 0.005, 0.2);
      p.box(0.036, 0.024, 0.04, K.poly, 0, -0.012, 0.11, 0.2);            // «хвост»
      p.box(0.006, 0.026, 0.1, K.black, 0, -0.04, -0.03);                 // спусковая скоба
      p.box(0.006, 0.03, 0.006, K.black, 0, -0.026, -0.082);
      p.box(0.006, 0.03, 0.006, K.black, 0, -0.026, 0.02);
      p.box(0.006, 0.024, 0.008, K.steel, 0, -0.018, 0.0, -0.3);
      p.box(0.012, 0.01, 0.012, K.steel, 0, 0.025, 0.15);                 // курок
      return p;
    }, false));
    mover.add(mk(k + 's', () => {
      const p = new Part();
      p.box(0.036, 0.04, 0.215, K.dsteel, 0, 0.044, -0.03);               // затвор-кожух
      p.box(0.037, 0.008, 0.215, K.gun, 0, 0.066, -0.03);
      for (let i = 0; i < 5; i++) p.box(0.04, 0.034, 0.005, K.black, 0, 0.044, 0.045 + i * 0.012); // насечки
      p.box(0.006, 0.02, 0.05, K.black, 0.019, 0.05, -0.04);              // окно выброса
      p.box(0.014, 0.012, 0.01, K.black, 0, 0.072, -0.125);               // мушка
      p.box(0.022, 0.012, 0.01, K.black, 0, 0.072, 0.065);                // целик
      p.tz(0.0085, 0.0085, 0.02, K.steel, 0, 0.044, -0.145, { seg: 8 });
      return p;
    }, true));
    mag.add(mk(k + 'mag', () => new Part().box(0.03, 0.095, 0.04, K.gun, 0, -0.105, 0.08, 0.2).box(0.036, 0.012, 0.05, K.black, 0, -0.158, 0.092, 0.2), false));
    ud.muzzle = [0, 0.044, -0.155]; ud.eject = [0.03, 0.06, -0.02];
    ud.grip = [0, -0.085, 0.08]; ud.fore = [-0.025, -0.1, 0.06]; ud.hold = [0.04, -0.1, -0.34];
    ud.magDrop = [0, -0.22, 0.04]; ud.magHold = [0, -0.09, 0.08]; ud.type = 'mag'; ud.sightY = 0.08; ud.adsZ = -0.3; ud.travel = 0.07; ud.flashSize = 0.7;
  } else if (index === 2) { // дробовик (помповый)
    g.add(mk(k + 'm', () => {
      const p = new Part();
      p.box(0.064, 0.088, 0.27, K.gun, 0, 0, 0.05);                       // ствольная коробка
      p.box(0.066, 0.02, 0.2, K.black, 0, 0.044, 0.05);
      p.box(0.006, 0.04, 0.08, K.black, 0.033, 0.01, 0.07);               // окно выброса
      p.tz(0.02, 0.02, 0.8, K.dsteel, 0, 0.03, -0.39, { seg: 12 });      // ствол
      p.tz(0.0165, 0.0165, 0.6, K.gun, 0, -0.022, -0.37, { seg: 10 });   // трубчатый магазин
      p.tz(0.023, 0.023, 0.025, K.black, 0, -0.022, -0.67, { seg: 10 }); // торцевая заглушка
      for (const z of [-0.3, -0.58]) p.box(0.048, 0.07, 0.014, K.black, 0, 0.004, z); // хомуты
      p.tz(0.022, 0.022, 0.03, K.black, 0, 0.03, -0.77, { seg: 10 });    // дульный срез
      p.ball(0.008, K.brass, 0, 0.062, -0.78, { ws: 6, hs: 4 });          // мушка-бусина
      p.box(0.012, 0.012, 0.12, K.black, 0, 0.056, -0.22);                // прицельная планка
      // боковая «патронташ»-планка с красными гильзами
      p.box(0.01, 0.07, 0.15, K.olive, -0.037, -0.002, 0.1);
      for (let i = 0; i < 5; i++) p.tz(0.0105, 0.0105, 0.04, K.red, -0.049, -0.002 + (i % 2) * 0.0, 0.04 + i * 0.026, { seg: 8, ry: 0 });
      return p;
    }, true));
    g.add(mk(k + 'w', () => {
      const p = new Part();
      p.box(0.056, 0.1, 0.28, K.wood, 0, -0.02, 0.33, 0.09);              // приклад
      p.box(0.05, 0.1, 0.06, K.wood, 0, -0.09, 0.12, 0.3);                // шейка
      p.box(0.058, 0.115, 0.02, K.rubber, 0, -0.03, 0.475, 0.09);         // затылок
      p.box(0.006, 0.026, 0.1, K.black, 0, -0.075, 0.07);                 // скоба
      return p;
    }, false));
    mover.add(mk(k + 'p', () => {
      const p = new Part();
      p.box(0.074, 0.06, 0.2, K.wood, 0, -0.04, -0.34);                   // цевьё
      for (let i = 0; i < 7; i++) p.box(0.076, 0.004, 0.006, K.wood2, 0, -0.016, -0.41 + i * 0.024);
      p.box(0.008, 0.02, 0.22, K.dsteel, 0.02, -0.022, -0.34);            // штанга
      p.box(0.008, 0.02, 0.22, K.dsteel, -0.02, -0.022, -0.34);
      return p;
    }, false));
    mag.add(mk(k + 'mag', () => new Part().tz(0.011, 0.011, 0.045, K.red, 0, -0.06, 0.06, { seg: 8 }).box(0.014, 0.014, 0.01, K.brass, 0, -0.06, 0.08), false));
    ud.muzzle = [0, 0.03, -0.8]; ud.eject = [0.04, 0.02, 0.0];
    ud.grip = [0, -0.11, 0.12]; ud.fore = [0, -0.075, -0.34]; ud.hold = [0.12, -0.17, -0.13];
    ud.magDrop = [0, -0.05, 0.04]; ud.magHold = [0.02, -0.07, 0.08]; ud.type = 'shell'; ud.sightY = 0.07; ud.adsZ = -0.3; ud.travel = 0.13; ud.pumpHand = true; ud.flashSize = 1.5;
  } else if (index === 3) { // пистолет-пулемёт
    g.add(mk(k + 'm', () => {
      const p = new Part();
      p.box(0.056, 0.074, 0.3, K.gun, 0, 0, 0);                           // коробка
      p.box(0.046, 0.05, 0.22, K.poly, 0, 0.004, -0.26);                  // цевьё
      for (let i = 0; i < 4; i++) p.box(0.05, 0.006, 0.02, K.black, 0, 0.03, -0.18 - i * 0.04);
      p.tz(0.02, 0.02, 0.18, K.black, 0, 0.01, -0.46, { seg: 10 });       // глушитель
      for (let i = 0; i < 3; i++) p.tz(0.0215, 0.0215, 0.012, K.dsteel, 0, 0.01, -0.4 - i * 0.05, { seg: 10 });
      p.box(0.034, 0.02, 0.2, K.dsteel, 0, 0.047, -0.05);                 // рельса
      for (let i = 0; i < 6; i++) p.box(0.036, 0.006, 0.01, K.black, 0, 0.059, -0.13 + i * 0.03);
      // коллиматор
      p.box(0.04, 0.012, 0.07, K.black, 0, 0.062, -0.05);
      p.box(0.036, 0.04, 0.012, K.black, 0, 0.088, -0.02);
      p.box(0.036, 0.04, 0.012, K.black, 0, 0.088, -0.08);
      p.box(0.036, 0.008, 0.07, K.black, 0, 0.108, -0.05);
      p.box(0.026, 0.03, 0.004, K.lens, 0, 0.088, -0.082);
      p.box(0.004, 0.004, 0.004, 0xff3030, 0, 0.088, -0.078);
      // вертикальная рукоять
      p.box(0.03, 0.085, 0.036, K.poly, 0, -0.068, -0.27, 0.05);
      // рукоять управления огнём
      p.box(0.046, 0.1, 0.058, K.poly, 0, -0.088, 0.1, 0.25);
      p.box(0.006, 0.03, 0.09, K.black, 0, -0.058, 0.04);
      // складной приклад
      p.box(0.012, 0.012, 0.2, K.steel, 0.02, -0.005, 0.25);
      p.box(0.012, 0.012, 0.2, K.steel, -0.02, -0.005, 0.25);
      p.box(0.05, 0.08, 0.014, K.poly, 0, -0.01, 0.355);
      p.box(0.012, 0.03, 0.02, K.dsteel, 0.032, 0.03, -0.03);             // рукоять затвора
      return p;
    }, true));
    mag.add(mk(k + 'mag', () => new Part().box(0.04, 0.12, 0.058, K.poly, 0, -0.1, -0.02, 0.05).box(0.04, 0.08, 0.058, K.poly, 0, -0.19, 0.005, 0.2).box(0.044, 0.012, 0.062, K.black, 0, -0.23, 0.02, 0.2), false));
    mover.add(mk(k + 'v', () => new Part().box(0.014, 0.022, 0.04, K.steel, 0.036, 0.028, -0.02), true));
    ud.muzzle = [0, 0.01, -0.56]; ud.eject = [0.035, 0.03, -0.02];
    ud.grip = [0, -0.1, 0.1]; ud.fore = [0, -0.06, -0.27]; ud.hold = [0.11, -0.15, -0.2];
    ud.magDrop = [0, -0.2, 0.0]; ud.magHold = [0, -0.1, -0.015]; ud.type = 'mag'; ud.sightY = 0.1; ud.adsZ = -0.3; ud.travel = 0.04; ud.flashSize = 0.8;
  } else { // снайперская винтовка
    g.add(mk(k + 'm', () => {
      const p = new Part();
      p.box(0.06, 0.082, 0.42, K.gun, 0, 0, 0.04);                        // ствольная коробка
      p.tz(0.0145, 0.0145, 0.74, K.dsteel, 0, 0.014, -0.58, { seg: 10 }); // ствол
      p.tz(0.02, 0.02, 0.07, K.black, 0, 0.014, -0.97, { seg: 10 });      // дульный тормоз
      for (const z of [-0.95, -0.985]) p.box(0.05, 0.008, 0.012, K.dsteel, 0, 0.014, z);
      p.tz(0.024, 0.024, 0.03, K.dsteel, 0, 0.014, -0.91, { seg: 10 });
      // оптика
      p.tz(0.03, 0.03, 0.28, K.black, 0, 0.1, -0.02, { seg: 12 });
      p.tz(0.04, 0.03, 0.09, K.black, 0, 0.1, -0.2, { seg: 12 });        // объектив
      p.tz(0.034, 0.036, 0.07, K.black, 0, 0.1, 0.16, { seg: 12 });       // окуляр
      p.tz(0.034, 0.034, 0.004, K.lens, 0, 0.1, -0.247, { seg: 12 });     // линза спереди
      p.tz(0.028, 0.028, 0.004, K.lens, 0, 0.1, 0.197, { seg: 12 });
      p.ty(0.014, 0.014, 0.04, K.dsteel, 0, 0.14, -0.02, { seg: 8 });     // барабан вертикальной поправки
      p.ty(0.014, 0.014, 0.04, K.dsteel, 0.04, 0.1, -0.02, { seg: 8, rz: Math.PI / 2 }); // горизонтальной
      for (const z of [-0.1, 0.07]) { p.box(0.03, 0.042, 0.03, K.gun, 0, 0.056, z); p.tz(0.036, 0.036, 0.016, K.gun, 0, 0.1, z, { seg: 10 }); }
      // сошки (сложены)
      p.tz(0.006, 0.006, 0.24, K.steel, 0.02, -0.05, -0.34, { seg: 6, ry: 0 });
      p.tz(0.006, 0.006, 0.24, K.steel, -0.02, -0.05, -0.34, { seg: 6 });
      p.box(0.06, 0.012, 0.03, K.dsteel, 0, -0.04, -0.23);
      p.box(0.007, 0.007, 0.1, K.dsteel, 0, -0.1, 0.12);                  // скоба
      return p;
    }, true));
    g.add(mk(k + 'w', () => {
      const p = new Part();
      p.box(0.056, 0.1, 0.34, K.olive, 0, -0.02, 0.4, 0.04);              // ложа
      p.box(0.05, 0.034, 0.16, shade(K.olive, 1.1), 0, 0.04, 0.46, 0.04); // подщёчник
      p.box(0.05, 0.1, 0.06, K.olive, 0, -0.095, 0.17, 0.3);              // рукоять
      p.box(0.052, 0.052, 0.24, K.olive, 0, -0.04, -0.24);                // цевьё
      p.box(0.058, 0.115, 0.022, K.rubber, 0, -0.03, 0.575, 0.04);        // затылок
      p.box(0.054, 0.012, 0.3, shade(K.olive, 0.8), 0, -0.05, 0.4, 0.04);
      return p;
    }, false));
    mag.add(mk(k + 'mag', () => new Part().box(0.04, 0.08, 0.06, K.gun, 0, -0.07, 0.02).box(0.044, 0.012, 0.064, K.black, 0, -0.114, 0.02), false));
    mover.add(mk(k + 'v', () => {
      const p = new Part();
      p.tz(0.007, 0.007, 0.07, K.steel, 0.05, 0.02, 0.1, { seg: 6, rz: 0 });
      p.ball(0.018, K.black, 0.075, 0.02, 0.14, { ws: 8, hs: 6 });
      p.box(0.034, 0.02, 0.1, K.steel, 0.03, 0.03, 0.06);
      return p;
    }, true));
    ud.muzzle = [0, 0.014, -1.0]; ud.eject = [0.045, 0.03, 0.08];
    ud.grip = [0, -0.12, 0.17]; ud.fore = [0, -0.06, -0.25]; ud.hold = [0.12, -0.17, -0.12];
    ud.magDrop = [0, -0.18, 0.0]; ud.magHold = [0, -0.07, 0.0]; ud.type = 'bolt'; ud.sightY = 0.1; ud.adsZ = -0.22; ud.travel = 0.09; ud.flashSize = 1.7;
  }
  ud.mag = mag; ud.mover = mover;
  ud.flash = makeFlash(ud.flashSize || 1);
  ud.flash.position.set(ud.muzzle[0], ud.muzzle[1], ud.muzzle[2]);
  g.add(ud.flash);
  return g;
}
