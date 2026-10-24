"""Color tables for the Byte (0-254, 255 = nodata) terrain rasters."""
import numpy as np

STOPS = {
    # Local relief: depressions blue, neutral pale, raised beds/berms orange-red.
    'lrm': [(0, (33, 72, 153)), (70, (103, 150, 206)), (127, (242, 240, 232)),
            (184, (232, 150, 70)), (254, (150, 35, 20))],
    'openness': [(0, (20, 20, 22)), (160, (150, 150, 146)), (254, (252, 252, 248))],
    'hillshade': [(0, (24, 24, 26)), (254, (250, 250, 246))],
    'slope': [(0, (250, 248, 240)), (90, (214, 190, 150)), (180, (140, 95, 55)), (254, (60, 30, 15))],
    # Canopy height 0-40 m: open ground pale, tall timber dark green.
    'chm': [(0, (245, 243, 228)), (12, (226, 232, 170)), (60, (150, 196, 110)),
            (140, (60, 140, 70)), (254, (10, 60, 35))],
}


def table(name):
    stops = STOPS[name]
    xs = [s[0] for s in stops]
    lut = np.zeros((256, 4), np.uint8)
    for c in range(3):
        lut[:255, c] = np.round(np.interp(np.arange(255), xs, [s[1][c] for s in stops]))
    lut[:255, 3] = 255
    return lut


def colormap(name):
    return {i: tuple(int(v) for v in row) for i, row in enumerate(table(name))}
