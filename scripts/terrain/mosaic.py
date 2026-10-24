"""Build a newest-wins VRT mosaic from TNM 1 m DEM items (items.json from the TNM API)."""
import json, os, subprocess, sys
d = sys.argv[1]
items = json.load(open(f'{d}/items.json'))
items.sort(key=lambda i: i['publicationDate'])  # gdalbuildvrt: later sources win
files = [f"{d}/{os.path.basename(i['downloadURL'])}" for i in items]
files = [f for f in files if os.path.exists(f)]
open(f'{d}/files.txt', 'w').write('\n'.join(files) + '\n')
subprocess.run(['gdalbuildvrt', '-overwrite', '-r', 'bilinear', '-srcnodata', '-999999', '-vrtnodata', '-999999',
                '-input_file_list', f'{d}/files.txt', f'{d}/mosaic.vrt'], check=True)
print(len(files), 'files')
