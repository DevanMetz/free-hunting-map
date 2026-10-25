"""Fill NaN CHM cells from a grid-aligned neighbouring project, in bounded windows."""
import sys
import numpy as np
import rasterio
from rasterio.windows import Window


def main(dst, src):
    total = 0
    with rasterio.open(src) as f, rasterio.open(dst, 'r+') as d:
        if f.crs != d.crs or f.res != d.res:
            raise ValueError('CHM grids must have the same CRS and resolution')
        dx = (f.transform.c - d.transform.c) / d.res[0]
        dy = (d.transform.f - f.transform.f) / d.res[1]
        if abs(dx-round(dx)) > 1e-6 or abs(dy-round(dy)) > 1e-6:
            raise ValueError('CHM grids must align')
        dx, dy = round(dx), round(dy)
        for _, win in f.block_windows(1):
            x, y = max(0, win.col_off+dx), max(0, win.row_off+dy)
            right, bottom = min(d.width, win.col_off+dx+win.width), min(d.height, win.row_off+dy+win.height)
            if right <= x or bottom <= y:
                continue
            dw = Window(x, y, right-x, bottom-y)
            fill = f.read(1, window=Window(x-dx, y-dy, right-x, bottom-y))
            a = d.read(1, window=dw)
            gap = ~np.isfinite(a) & np.isfinite(fill)
            a[gap] = fill[gap]
            d.write(a, 1, window=dw)
            total += int(gap.sum())
    print('filled', total, 'cells', flush=True)


if __name__ == '__main__':
    main(*sys.argv[1:3])
