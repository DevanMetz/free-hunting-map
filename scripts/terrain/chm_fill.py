"""Copy finite cells of a grid-aligned fill CHM into the NaN cells of the main CHM (in place).

  python chm_fill.py <chm.tif> <fill.tif>
"""
import sys
import numpy as np
import rasterio
from rasterio.windows import from_bounds


def main(dst, src):
    with rasterio.open(src) as f:
        fill = f.read(1)
        b = f.bounds
    with rasterio.open(dst, 'r+') as d:
        win = from_bounds(*b, transform=d.transform).round_offsets().round_lengths()
        a = d.read(1, window=win)
        h, w = min(a.shape[0], fill.shape[0]), min(a.shape[1], fill.shape[1])
        a, fill = a[:h, :w], fill[:h, :w]
        gap = ~np.isfinite(a) & np.isfinite(fill)
        a[gap] = fill[gap]
        d.write(a, 1, window=rasterio.windows.Window(win.col_off, win.row_off, w, h))
    print('filled', int(gap.sum()), 'cells', flush=True)


if __name__ == '__main__':
    main(*sys.argv[1:3])
