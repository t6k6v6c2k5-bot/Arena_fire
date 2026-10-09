#!/usr/bin/env python3
"""Конвертирует набор Kenney Mini Arena (GLB, CC0) в один компактный public/world/kit.json.
Текстура-палитра запекается в цвета вершин, поэтому игре не нужны ни загрузчик GLTF, ни текстуры.
Запуск: python3 tools/convert-kenney.py "<папка Models/GLB format>" public/world/kit.json"""
import json, struct, sys, os, math
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
SKIP = {'character-soldier', 'weapon-sword', 'weapon-spear'}
tex = Image.open(os.path.join(src, 'Textures', 'colormap.png')).convert('RGB')
TW, TH = tex.size

def srgb(v): return v  # цвета палитры уже в sRGB; в игре материал читает их как есть

def mat_mul(a, b):
    return [sum(a[r*4+k]*b[k*4+c] for k in range(4)) for r in range(4) for c in range(4)]
def trs(n):
    if 'matrix' in n:
        m = n['matrix']; return [m[0],m[4],m[8],m[12],m[1],m[5],m[9],m[13],m[2],m[6],m[10],m[14],m[3],m[7],m[11],m[15]]
    t = n.get('translation',[0,0,0]); q = n.get('rotation',[0,0,0,1]); s = n.get('scale',[1,1,1])
    x,y,z,w = q
    r = [[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
    return [r[0][0]*s[0],r[0][1]*s[1],r[0][2]*s[2],t[0], r[1][0]*s[0],r[1][1]*s[1],r[1][2]*s[2],t[1], r[2][0]*s[0],r[2][1]*s[1],r[2][2]*s[2],t[2], 0,0,0,1]

def load(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'glTF'
    off = 12; js = None; bn = None
    while off < len(d):
        ln, tp = struct.unpack_from('<II', d, off); body = d[off+8:off+8+ln]; off += 8 + ln
        if tp == 0x4E4F534A: js = json.loads(body)
        elif tp == 0x004E4942: bn = body
    return js, bn

def accessor(js, bn, i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
    n = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    fmt = {5126:'f',5123:'H',5125:'I',5121:'B',5120:'b',5122:'h'}[a['componentType']]
    sz = struct.calcsize(fmt); stride = bv.get('byteStride') or sz*n
    base = bv.get('byteOffset',0) + a.get('byteOffset',0)
    return [struct.unpack_from('<'+fmt*n, bn, base+k*stride) for k in range(a['count'])]

def convert(path):
    js, bn = load(path)
    P, N, C, I = [], [], [], []
    def walk(ni, parent):
        n = js['nodes'][ni]; m = mat_mul(parent, trs(n))
        if 'mesh' in n:
            for pr in js['meshes'][n['mesh']]['primitives']:
                at = pr['attributes']; pos = accessor(js, bn, at['POSITION'])
                nor = accessor(js, bn, at['NORMAL']) if 'NORMAL' in at else [(0,1,0)]*len(pos)
                uv = accessor(js, bn, at['TEXCOORD_0']) if 'TEXCOORD_0' in at else [(0.5,0.5)]*len(pos)
                idx = [v[0] for v in accessor(js, bn, pr['indices'])] if 'indices' in pr else list(range(len(pos)))
                base = len(P)
                for (x,y,z),(nx,ny,nz),(u,v) in zip(pos, nor, uv):
                    P.append((m[0]*x+m[1]*y+m[2]*z+m[3], m[4]*x+m[5]*y+m[6]*z+m[7], m[8]*x+m[9]*y+m[10]*z+m[11]))
                    a_,b_,c_ = (m[0]*nx+m[1]*ny+m[2]*nz, m[4]*nx+m[5]*ny+m[6]*nz, m[8]*nx+m[9]*ny+m[10]*nz)
                    l = math.sqrt(a_*a_+b_*b_+c_*c_) or 1
                    N.append((a_/l, b_/l, c_/l))
                    px = min(TW-1, max(0, int(u*TW))); py = min(TH-1, max(0, int(v*TH)))
                    C.append(tex.getpixel((px, py)))
                I.extend(base+i for i in idx)
        for c in n.get('children', []): walk(c, m)
    ident = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
    for r in js['scenes'][js.get('scene',0)]['nodes']: walk(r, ident)
    return P, N, C, I

# Склеиваем вершины с одинаковыми позицией, нормалью и цветом: файл заметно меньше.
def weld(P, N, C, I):
    key = {}; np_, nn, nc, remap = [], [], [], []
    for p, n, c in zip(P, N, C):
        k = (round(p[0],3), round(p[1],3), round(p[2],3), round(n[0],2), round(n[1],2), round(n[2],2), c)
        if k not in key: key[k] = len(np_); np_.append((k[0],k[1],k[2])); nn.append((k[3],k[4],k[5])); nc.append(c)
        remap.append(key[k])
    ni = [remap[i] for i in I]
    tris = [ni[i:i+3] for i in range(0, len(ni), 3)]
    tris = [t for t in tris if len(set(t)) == 3]
    return np_, nn, nc, [i for t in tris for i in t]

kit = {}
for f in sorted(os.listdir(src)):
    if not f.endswith('.glb'): continue
    name = f[:-4]
    if name in SKIP: continue
    P, N, C, I = weld(*convert(os.path.join(src, f)))
    xs = [p[0] for p in P]; ys = [p[1] for p in P]; zs = [p[2] for p in P]
    kit[name] = {
        'min': [min(xs), min(ys), min(zs)], 'max': [max(xs), max(ys), max(zs)],
        'p': [round(v, 3) for p in P for v in p],
        'n': [round(v * 100) for n in N for v in n],              # нормали, умноженные на 100
        'c': [(c[0] << 16) | (c[1] << 8) | c[2] for c in C],       # цвет вершины 0xRRGGBB
        'i': I,
    }
    b = kit[name]; print(f"{name:20s} вершин {len(P):5d} треуг. {len(I)//3:5d}  размер {b['max'][0]-b['min'][0]:.2f} x {b['max'][1]-b['min'][1]:.2f} x {b['max'][2]-b['min'][2]:.2f}  min {[round(v,2) for v in b['min']]}")
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(kit, open(out, 'w'), separators=(',', ':'))
print('записано', out, os.path.getsize(out) // 1024, 'КБ')
