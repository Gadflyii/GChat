# Deployed private fixture definition

Retained for service maintenance; the shared S1 deployment is authoritative. Do not regenerate during another lane's transfer.

## generate.py

```python
#!/usr/bin/env python3
"""Generate this one private catalog from retained release metadata, without reading payloads."""
import collections
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
WAVE = Path('/mnt/nas/AltaStratusAI/GInfer/artifacts/release-waves/v1')
ORIGIN = 'http://192.168.1.109:18761'
MEASURED_TIERS = {'full-context-tested', 'calculated-startup-smoke', 'screened-startup'}

def main():
    assert ROOT == Path('/media/ron/SSD_RAID/ai/gchat-private-dev-catalog-v1')
    web = ROOT / 'www'
    assert not web.exists(), 'one shared generation only; existing fixture must not be replaced'
    versioned = json.loads((ROOT / 'inputs/versioned-profiles.json').read_text())
    flash = json.loads((ROOT / 'inputs/flash-screened-profile.json').read_text())
    assert flash['schema'] == 'ginfer-launch-profiles-v1'
    profile_sources = []
    for name, source in sorted(versioned['sources'].items()):
        assert source['catalog']['schema'] == 'ginfer-launch-profiles-v1'
        profile_sources.extend((profile, 'ginfer/config/launch-profiles/' + name) for profile in source['catalog']['profiles'])
    profile_sources.extend((profile, 'inputs/flash-screened-profile.json') for profile in flash['profiles'])
    sums_bytes = (WAVE / 'SHA256SUMS').read_bytes()
    artifacts = {}
    for line in sums_bytes.decode().splitlines():
        digest, filename = line.split()
        filename = filename.lstrip('*')
        assert re.fullmatch(r'[a-f0-9]{64}', digest)
        assert Path(filename).name == filename and filename.endswith('.ginfer')
        assert digest not in artifacts
        path = WAVE / filename
        assert path.is_file() and not path.is_symlink()
        artifacts[digest] = {'file': filename, 'path': str(path), 'bytes': path.stat().st_size}
    assert len(artifacts) == 25
    profiles = collections.defaultdict(list)
    pending = collections.Counter()
    source_paths = collections.defaultdict(list)
    seen = set()
    for profile, source in profile_sources:
        sha = profile['artifact_sha256']
        if sha not in artifacts:
            continue
        if profile['qualification']['tier'] not in MEASURED_TIERS:
            pending[artifacts[sha]['file']] += 1
            continue
        assert profile['id'] not in seen, 'duplicate profile id'
        seen.add(profile['id'])
        assert profile['artifact_bytes'] == artifacts[sha]['bytes']
        assert profile['platform'] in ('linux', 'windows')
        assert profile['tp'] in (1, 2, 4)
        assert profile['min_memory_mib_per_gpu'] > 0
        assert profile['compute_capability'] in ('8.0', '8.6', '8.9', '12.0')
        assert profile['qualification']['engine_revision'] and profile['qualification']['evidence']
        assert profile['qualification']['free_bytes_per_gpu'] >= profile['options']['kv_arena_headroom_bytes']
        tier = profile['qualification']['tier']
        if tier == 'full-context-tested':
            assert profile['qualification']['full_context_requests'] == profile['concurrency']
        else:
            assert profile['qualification']['full_context_requests'] == 0
            assert profile['qualification']['smoke_requests'] == profile['concurrency']
        profiles[sha].append(profile)
        source_paths[sha].append(source)
    assert len(profiles) == 7 and sum(map(len, profiles.values())) == 112
    names = {'qwen3.8-27b': 'Qwen 3.8 27B', 'muse-glimmer-30b': 'Muse Glimmer 30B', 'qwen3.8-flash-next': 'Qwen 3.8 Flash Next 180B'}
    variants = {'groupwise-int-dflash2-q4': 'INT DFlash2', 'groupwise-int-dflash-q4': 'INT DFlash2', 'nvfp4': 'NVFP4 with Q4 DFlash2', 'nvfp4-dflash2-q4': 'NVFP4 with Q4 DFlash2', 'nvfp4-dflash2-nvfp4': 'NVFP4 DFlash2', 'nvfp4-dflash-nvfp4': 'NVFP4 DFlash2', 'smol-q2g64': 'SMOL screened'}
    models = {}
    selected = []
    for sha, rows in sorted(profiles.items(), key=lambda item: artifacts[item[0]]['file']):
        artifact = artifacts[sha]
        rows = sorted(rows, key=lambda row: row['id'])
        first = rows[0]
        assert all(p['identity'] == first['identity'] and p['tp'] == first['tp'] for p in rows)
        identity = first['identity']
        family = names[identity['model_id']]
        name = family + ' ' + variants[identity['weights_id']]
        release = {
            'name': name,
            'identity': identity,
            'url': ORIGIN + '/' + artifact['file'],
            'sha256': sha,
            'bytes': artifact['bytes'],
            'tp': first['tp'],
            'qualified_sm': sorted({p['compute_capability'] for p in rows}, key=lambda sm: tuple(map(int, sm.split('.')))),
            'min_vram_mib_per_gpu': min(p['min_memory_mib_per_gpu'] for p in rows),
            'capabilities': [],
            'launch_profiles': rows,
        }
        model_id = identity['model_id']
        if model_id not in models:
            models[model_id] = {'model_name': 'SectileLabs/' + model_id, 'name': family, 'description': 'Private development catalog from retained release-wave packages and existing measured or screened profiles. These entries do not qualify a changed Engine.', 'library_name': 'ginfer', 'downloads': 0, 'releases': []}
        models[model_id]['releases'].append(release)
        selected.append({**artifact, 'sha256': sha, 'identity': identity, 'tp': first['tp'], 'profile_count': len(rows), 'platform_counts': dict(collections.Counter(p['platform'] for p in rows)), 'tier_counts': dict(collections.Counter(p['qualification']['tier'] for p in rows)), 'qualified_sm': release['qualified_sm'], 'min_vram_mib_per_gpu': release['min_vram_mib_per_gpu'], 'profile_sources': sorted(set(source_paths[sha]))})
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    catalog = {'manifest_version': 1, 'schema_version': 1, 'updated_at': now, 'models': [models[k] for k in sorted(models)]}
    catalog_bytes = (json.dumps(catalog, indent=2, ensure_ascii=False) + '\n').encode()
    web.mkdir(mode=0o755)
    (web / 'catalog.json').write_bytes(catalog_bytes)
    for item in selected:
        (web / item['file']).symlink_to(item['path'])
    receipt = {
        'purpose': 'Shared private development fixture only; no publication or release-build reference',
        'generated_at': now, 'host': 'AIS-2-8592-L01', 'origin': ORIGIN,
        'source_wave': str(WAVE), 'source_inventory': str(WAVE / 'SHA256SUMS'),
        'source_inventory_sha256': hashlib.sha256(sums_bytes).hexdigest(),
        'profile_repository_revision': versioned['revision'], 'profile_sources_clean': not versioned['dirty_profile_sources'],
        'flash_profile_source': {k: flash[k] for k in ('source', 'source_appdir_revision', 'source_bytes', 'source_sha256')},
        'selected_packages': selected,
        'excluded_packages': [{'file': artifact['file'], 'reason': 'No matching measured or screened launch profile in retained inputs', 'pending_profiles_omitted': pending[artifact['file']]} for sha, artifact in sorted(artifacts.items(), key=lambda item: item[1]['file']) if sha not in profiles],
        'pending_profile_rows_omitted': sum(pending.values()), 'package_payloads_copied': False, 'package_payloads_rehashed': False,
        'catalog_bytes': len(catalog_bytes), 'catalog_sha256': hashlib.sha256(catalog_bytes).hexdigest(),
        'http_policy': {'bind': '192.168.1.109', 'port': 18761, 'methods': ['GET', 'HEAD'], 'rate_bytes_per_second_per_get': 8 * 1024 * 1024, 'routes': ['catalog.json'] + [item['file'] for item in selected]},
        'validation': 'Exact current SHA256SUMS membership, source metadata bytes, identity/TP/profile binding, original profile tiers and measured guards checked; no payload bytes read; native Host parsing remains consumer validation',
    }
    (ROOT / 'generation-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'packages': len(selected), 'profiles': sum(map(len, profiles.values())), 'excluded_packages': len(receipt['excluded_packages']), 'omitted_pending_profiles': sum(pending.values()), 'catalog_bytes': len(catalog_bytes), 'catalog_sha256': receipt['catalog_sha256']}))

if __name__ == '__main__':
    main()
```

## srv.py

```python
#!/usr/bin/env python3
"""Read-only LAN test fixture; exact known routes, resumable 8 MiB/s-per-GET transfers."""
import http.server
import json
from pathlib import Path
import re
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'www'
BIND = '192.168.1.109'
PORT = 18761
RATE = 8 * 1024 * 1024
CHUNK = 256 * 1024
receipt = json.loads((ROOT / 'generation-receipt.json').read_text())
ROUTES = {'catalog.json': {'path': str(WEB / 'catalog.json'), 'bytes': receipt['catalog_bytes']}}
ROUTES.update({item['file']: item for item in receipt['selected_packages']})

class Handler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_HEAD(self):
        self.serve(head=True)

    def do_GET(self):
        self.serve(head=False)

    def serve(self, head):
        request = urlsplit(self.path)
        name = request.path.removeprefix('/')
        cache_buster = request.path == '/catalog.json' and re.fullmatch(r't=[0-9]+', request.query)
        if (request.query and not cache_buster) or request.fragment or request.path != '/' + name or name not in ROUTES:
            self.send_error(404)
            return
        item = ROUTES[name]
        path = WEB / name
        try:
            # Only catalog.json or one explicitly generated package symlink can be opened.
            if path.resolve(strict=True) != Path(item['path']).resolve(strict=True):
                self.send_error(404)
                return
            size = path.stat().st_size
            if size != item['bytes']:
                self.send_error(503, 'Retained fixture input size changed')
                return
            start, end, code = 0, size - 1, 200
            requested = self.headers.get('Range')
            if requested:
                match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested)
                valid = match is not None and any(match.groups())
                if valid:
                    first, last = match.groups()
                    if first:
                        start = int(first)
                        end = min(int(last), size - 1) if last else size - 1
                    else:
                        count = int(last)
                        valid = count > 0
                        start = max(0, size - count)
                    valid = valid and 0 <= start <= end < size
                if not valid:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.send_header('Content-Length', '0')
                    self.send_header('Accept-Ranges', 'bytes')
                    self.end_headers()
                    return
                code = 206
            length = end - start + 1
            self.send_response(code)
            self.send_header('Content-Type', 'application/json' if name == 'catalog.json' else 'application/octet-stream')
            self.send_header('Content-Length', str(length))
            self.send_header('Accept-Ranges', 'bytes')
            if code == 206:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.end_headers()
            if head:
                return
            with path.open('rb') as stream:
                stream.seek(start)
                remaining = length
                transferred = 0
                began = time.monotonic()
                while remaining:
                    data = stream.read(min(CHUNK, remaining))
                    if not data:
                        break
                    self.wfile.write(data)
                    remaining -= len(data)
                    transferred += len(data)
                    delay = transferred / RATE - (time.monotonic() - began)
                    if delay > 0:
                        time.sleep(delay)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except FileNotFoundError:
            self.send_error(404)

if __name__ == '__main__':
    with http.server.ThreadingHTTPServer((BIND, PORT), Handler) as server:
        print(f'Private development fixture: http://{BIND}:{PORT}/catalog.json; GET/HEAD only; {RATE} bytes/s per GET', flush=True)
        server.serve_forever()
```
