import io
import unittest
import numpy as np
from PIL import Image
from tile import palette, encode, STOPS

class CutsTest(unittest.TestCase):
    def test_year_palette_and_transparent_nodata(self):
        lut=palette()
        self.assertEqual(lut[0].tolist(),[0,0,0,0])
        self.assertTrue(np.all(lut[26:]==0))
        for year,color in STOPS:
            self.assertEqual(lut[year].tolist(),[int(color[i:i+2],16) for i in (1,3,5)]+[255])
        self.assertEqual(len(set(map(tuple,lut[1:26]))),25)

    def test_lossless_tiles_and_sparse_parent_alpha(self):
        values=np.zeros((512,512),dtype='uint8')
        values[0,0]=25
        values[10:12,10:12]=1
        image=Image.fromarray(palette()[values])
        decoded=Image.open(io.BytesIO(encode(image)))
        np.testing.assert_array_equal(np.array(decoded),np.array(image))
        parent=np.array(decoded.resize((256,256),Image.Resampling.BOX))
        self.assertEqual(parent[0,0,3],64)
        np.testing.assert_allclose(parent[0,0,:3],palette()[25,:3],atol=2)
        self.assertEqual(parent[5,5,3],255)
        self.assertEqual(parent[20,20,3],0)

if __name__=='__main__': unittest.main()
