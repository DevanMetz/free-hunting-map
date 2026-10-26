#!/usr/bin/env python3
"""Stream completed EE Drive shards using the existing EE OAuth login."""
import hashlib
import json
import shutil
from pathlib import Path
import ee
from google.auth.transport.requests import AuthorizedSession
from export_ee import FOLDER, PREFIX

WORK = Path('/workspace/gee/cuts')

def main():
    ee.Initialize(project='free-hunting-map')
    session = AuthorizedSession(ee.data.get_persistent_credentials().with_quota_project(None))
    def listing(query):
        files, token = [], None
        while True:
            r = session.get('https://www.googleapis.com/drive/v3/files', params={
                'q': query, 'fields': 'nextPageToken,files(id,name,size,md5Checksum,mimeType)',
                'pageSize': 1000, **({'pageToken': token} if token else {})}, timeout=60)
            r.raise_for_status()
            data = r.json()
            files.extend(data.get('files', []))
            token = data.get('nextPageToken')
            if not token:
                return files
    folders = listing(f"name = '{FOLDER}' and trashed = false and mimeType = 'application/vnd.google-apps.folder'")
    if len(folders) != 1:
        raise RuntimeError(f'Expected one export folder; found {len(folders)} (export may still be running)')
    files = listing(f"'{folders[0]['id']}' in parents and trashed = false")
    files = sorted([f for f in files if f['name'].startswith(PREFIX) and f['name'].endswith('.tif')], key=lambda f: f['name'])
    (WORK / 'drive-files.json').write_text(json.dumps({'folder': folders[0], 'files': files, 'bytes': sum(int(f['size']) for f in files)}, indent=2)+'\n')
    dest = WORK / 'downloads'
    dest.mkdir(exist_ok=True)
    for f in files:
        path = dest / Path(f['name']).name
        if path.exists() and path.stat().st_size == int(f['size']):
            with path.open('rb') as stream:
                if hashlib.file_digest(stream, 'md5').hexdigest() == f['md5Checksum']:
                    continue
        if shutil.disk_usage(WORK).free < int(f['size']) + 10 * 1024**3:
            raise RuntimeError('Download would cross 10 GiB free-space floor')
        tmp = path.with_suffix('.partial')
        digest = hashlib.md5()
        with session.get(f"https://www.googleapis.com/drive/v3/files/{f['id']}", params={'alt': 'media'}, stream=True, timeout=180) as r:
            r.raise_for_status()
            with tmp.open('wb') as stream:
                for chunk in r.iter_content(1024*1024):
                    stream.write(chunk)
                    digest.update(chunk)
        assert tmp.stat().st_size == int(f['size']), 'Incomplete download'
        assert digest.hexdigest() == f['md5Checksum'], 'Checksum mismatch'
        tmp.replace(path)
        print(path.name, path.stat().st_size, flush=True)
    print('Drive bytes:', sum(int(f['size']) for f in files), 'Files:', len(files), flush=True)

if __name__ == '__main__':
    main()
