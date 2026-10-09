#!/usr/bin/env python3
"""Простой программный рендер арены: python3 world-shot.py dump.json out.png eye_x eye_y eye_z target_x target_y target_z [fov]"""
import json, sys, math
import numpy as np
from PIL import Image, ImageDraw
d = json.load(open(sys.argv[1])); out = sys.argv[2]
ex, ey, ez, tx, ty, tz = map(float, sys.argv[3:9]); fov = float(sys.argv[9]) if len(sys.argv) > 9 else 60
W, H = 1200, 700
P = np.array(d['positions']).reshape(-1, 3); N = np.array(d['normals']).reshape(-1, 3); C = np.array(d['colors']).reshape(-1, 3); I = np.array(d['indices']).reshape(-1, 3)
f = np.array([tx-ex, ty-ey, tz-ez]); f /= np.linalg.norm(f)
r = np.cross(f, [0, 1, 0]); r /= np.linalg.norm(r); u = np.cross(r, f)
rel = P - [ex, ey, ez]
cam = np.stack([rel @ r, rel @ u, rel @ f], 1)
sc = (H / 2) / math.tan(math.radians(fov) / 2)
z = cam[:, 2]
sx = W/2 + cam[:, 0] / np.maximum(z, 0.01) * sc
sy = H/2 - cam[:, 1] / np.maximum(z, 0.01) * sc
L = np.array([0.4, 0.8, 0.45]); L /= np.linalg.norm(L)
light = 0.45 + 0.65 * np.clip(N @ L, 0, 1)
col = np.clip(C * light[:, None], 0, 1)
tri_z = z[I].mean(1); ok = (z[I] > 0.2).all(1)
order = np.argsort(-tri_z)
img = Image.new('RGB', (W, H), (205, 228, 245)); dr = ImageDraw.Draw(img)
dr.rectangle([0, H//2, W, H], fill=(125, 148, 104))
for t in order:
    if not ok[t]: continue
    a, b, c = I[t]
    c3 = tuple(int(v * 255) for v in col[[a, b, c]].mean(0))
    dr.polygon([(sx[a], sy[a]), (sx[b], sy[b]), (sx[c], sy[c])], fill=c3)
img.save(out); print('ok', out)
