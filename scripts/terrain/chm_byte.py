"""Scale chm.py float metres to the 0-254 Byte index used by tile.py (255 = nodata).

  python chm_byte.py <chm.tif> <out.tif> [max_m=40]
"""
import sys
import numpy as np
import rasterio
from rasterio.windows import Window


def main(src, dst, top=40.0):
    top = float(top)
    with rasterio.open(src) as s:
        prof = s.profile.copy()
        prof.update(dtype='uint8', nodata=255, predictor=2, compress='deflate', tiled=True,
                    blockxsize=512, blockysize=512, bigtiff='yes')
        with rasterio.open(dst, 'w', **prof) as d:
            for r in range(0, s.height, 2048):
                win = Window(0, r, s.width, min(2048, s.height - r))
                a = s.read(1, window=win)
                b = np.where(np.isfinite(a), np.round(np.clip(a / top, 0, 1) * 254), 255).astype('uint8')
                d.write(b, 1, window=win)
    print('wrote', dst, flush=True)


if __name__ == '__main__':
    main(*sys.argv[1:])
