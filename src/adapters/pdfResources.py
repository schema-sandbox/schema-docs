"""Sample worker resources and enforce only explicitly supplied budgets."""
import json
import os
from pathlib import Path
import threading
import time
from contextlib import contextmanager


class ResourceMonitor:
    def __init__(self, roots=(), max_resident_bytes=0, max_temporary_bytes=0):
        self.roots = list(dict.fromkeys(str(Path(p).resolve()) for p in roots if p))
        self.memory_budget = int(max_resident_bytes or 0)
        self.disk_budget = int(max_temporary_bytes or 0)
        self.stop = threading.Event()
        self.metrics = {'peakResidentBytes': 0, 'peakTemporaryBytes': 0, 'samples': 0}
        self.thread = None
        self.deadlines = {}

    @contextmanager
    def deadline(self, scope, milliseconds):
        if float(milliseconds or 0) > 0:
            self.deadlines[scope] = time.monotonic() + float(milliseconds) / 1000
        try:
            yield
        finally:
            self.deadlines.pop(scope, None)

    def sample(self, disk=False):
        from pdfLayoutSession import peak_resident_bytes
        memory = peak_resident_bytes() or 0
        self.metrics.update(peakResidentBytes=max(memory, self.metrics['peakResidentBytes']),
                            sampledAt=time.time(), samples=self.metrics['samples'] + 1)
        if disk or self.disk_budget:
            size = 0
            seen = set()
            for root in self.roots:
                for folder, directories, files in os.walk(root, followlinks=False):
                    directories[:] = [name for name in directories if not Path(folder, name).is_symlink()]
                    for name in files:
                        file = Path(folder, name)
                        try:
                            if not file.is_symlink() and str(file) not in seen:
                                seen.add(str(file))
                                size += file.stat().st_size
                        except OSError:
                            pass
            self.metrics['peakTemporaryBytes'] = max(size, self.metrics['peakTemporaryBytes'])
        over = (self.memory_budget and memory > self.memory_budget) or (self.disk_budget and self.metrics['peakTemporaryBytes'] > self.disk_budget)
        expired = next((scope for scope, end in list(self.deadlines.items()) if time.monotonic() > end), None)
        print(json.dumps({'event': 'worker_resource', **self.metrics, 'budgetExceeded': bool(over), 'timeoutScope': expired}), flush=True)
        if over or expired:
            # Atomic page/region journals remain recoverable; the JS owner
            # removes its private scratch after observing this exit.
            os._exit(76 if expired else 75)

    def __enter__(self):
        self.sample()
        def watch():
            while not self.stop.wait(2):
                self.sample()
        self.thread = threading.Thread(target=watch, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.stop.set()
        self.thread.join()
        self.sample(disk=True)
