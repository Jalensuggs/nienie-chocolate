"""生成"闭眼"贴图：用胸口的毛做纹理，泊松融合盖住两只眼睛。
运行：python3 tools/make_closed_eyes.py  → assets/cat-closed.webp，并更新 js/cat-image.js
"""
import base64, subprocess
import numpy as np
from PIL import Image
from scipy import ndimage as nd
from scipy.sparse import lil_matrix
from scipy.sparse.linalg import factorized

ROOT = __file__.rsplit('/tools/', 1)[0]
SIZE = 1024
EYES = [(0.3413, 0.3374), (0.6187, 0.3374)]   # 与 renderer.js 的 RIG 保持一致
RAD = (0.0605, 0.057)
COVER = 1.28                                   # 盖住眼眶外的阴影和高光
CHEST = (0.49, 0.55)                           # 取毛的位置
CROP = (221, 205, 512, 256)                    # 输出裁切区域 x, y, w, h（2 的幂，便于做 mipmap）

img = Image.open(f'{ROOT}/assets/cat.png').convert('RGBA')
a = np.asarray(img).astype(np.float64)
rgb = a[..., :3].copy()

def poisson(dst, src, mask):
    """在 mask 内求解 Δf = Δsrc，边界取 dst。"""
    ys, xs = np.nonzero(mask)
    idx = -np.ones(mask.shape, int)
    idx[ys, xs] = np.arange(len(ys))
    n = len(ys)
    A = lil_matrix((n, n))
    for i, (y, x) in enumerate(zip(ys, xs)):
        A[i, i] = 4
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if idx[y + dy, x + dx] >= 0:
                A[i, idx[y + dy, x + dx]] = -1
    solve = factorized(A.tocsc())
    out = dst.copy()
    for ch in range(3):
        b = np.zeros(n)
        s, d = src[..., ch], dst[..., ch]
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = ys + dy, xs + dx
            b += s[ys, xs] - s[ny, nx]
            outside = idx[ny, nx] < 0
            b[outside] += d[ny[outside], nx[outside]]
        out[ys, xs, ch] = solve(b)
    return out

Y, X = np.mgrid[0:SIZE, 0:SIZE] + 0.5
for k, (eu, ev) in enumerate(EYES):
    cx, cy = eu * SIZE, ev * SIZE
    rx, ry = RAD[0] * SIZE * COVER, RAD[1] * SIZE * COVER
    mask = ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 < 1
    # 胸口的毛：只保留高频细节，明暗交给泊松融合去贴合周围
    sx, sy = int(CHEST[0] * SIZE - cx), int(CHEST[1] * SIZE - cy)
    src = np.roll(rgb, (-sy, -sx), axis=(0, 1))
    if k == 1:   # 右眼用镜像，避免两边一模一样
        x0, x1 = int(cx - rx - 4), int(cx + rx + 4)
        src[:, x0:x1] = src[:, x0:x1][:, ::-1]
    hp = src - nd.gaussian_filter(src, (5, 5, 0))
    # 胸口的毛比脸上细腻，按眼眶外一圈的纹理强度自动放大细节
    ring = (((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 > 1.1) & (((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 < 2.0)
    face_hp = rgb - nd.gaussian_filter(rgb, (5, 5, 0))
    gain = face_hp[ring].mean(1).std() / max(1e-6, hp[mask].mean(1).std())
    guide = hp * gain
    rgb = poisson(rgb, guide, mask)

rgb = np.clip(rgb, 0, 255)
out = np.dstack([rgb, a[..., 3]]).astype(np.uint8)
x, y, w, h = CROP
closed = Image.fromarray(out, 'RGBA').crop((x, y, x + w, y + h))
closed.save(f'{ROOT}/assets/cat-closed.png')  # 临时文件，转成 webp 后删除
subprocess.run(['cwebp', '-quiet', '-q', '92', '-m', '6', f'{ROOT}/assets/cat-closed.png', '-o', f'{ROOT}/assets/cat-closed.webp'], check=True)

main = base64.b64encode(open(f'{ROOT}/assets/cat.webp', 'rb').read()).decode()
eyes = base64.b64encode(open(f'{ROOT}/assets/cat-closed.webp', 'rb').read()).decode()
with open(f'{ROOT}/js/cat-image.js', 'w') as f:
    f.write('// 由 assets/cat.webp 和 assets/cat-closed.webp 生成（tools/make_closed_eyes.py）：\n')
    f.write('// 内嵌为 data URI，这样双击 index.html 也能用 WebGL 加载贴图\n')
    f.write(f'window.CAT_IMAGE_SRC="data:image/webp;base64,{main}";\n')
    f.write(f'window.CAT_CLOSED_SRC="data:image/webp;base64,{eyes}";\n')
    f.write(f'window.CAT_CLOSED_RECT=[{x / SIZE},{y / SIZE},{w / SIZE},{h / SIZE}];\n')
print('ok', closed.size)
