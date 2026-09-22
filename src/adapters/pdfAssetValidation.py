"""Decode each unique retained image before claiming structural success."""
import json
from pathlib import Path
import sys
from PIL import Image

request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
root = Path(request['root']).resolve()
issues, checked, seen = [], 0, set()
for region in request['regions']:
    name = region['file']
    if name in seen:
        continue
    seen.add(name)
    try:
        file = root / name
        if Path(name).name != name or file.is_symlink() or file.resolve().parent != root:
            raise ValueError('Asset escapes its directory')
        with Image.open(file) as image:
            image.verify()
        with Image.open(file) as image:
            image.load()
            if min(image.size) < 1:
                raise ValueError('Empty image')
        checked += 1
    except Exception as error:
        issues.append({'code': 'asset_invalid', **region, 'message': str(error)})
print(json.dumps({'checked': checked, 'issues': issues}))
