// Выгружает геометрию арены (как её строит игра) в JSON для просмотра через world-shot.py.
import fs from 'node:fs';
import * as S from '../../public/shared.js';
import { buildWorldMesh } from '../../public/world.js';
const kit = JSON.parse(fs.readFileSync(new URL('../../public/world/kit.json', import.meta.url)));
const w = buildWorldMesh(kit, S.BOXES, S.MAP, { linear: false });
fs.writeFileSync(process.argv[2], JSON.stringify(w));
console.log('вершин', w.positions.length / 3, 'треугольников', w.indices.length / 3);
