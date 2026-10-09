"""Convert native NUL-separated plists, retaining only benchmark process IDs."""
import datetime
import json
import plistlib
import pathlib
import sys

allowed = set(json.loads(sys.argv[2]))
samples = []
with open(sys.argv[1], 'rb') as stream:
    for chunk in stream.read().split(b'\0'):
        if not chunk.strip():
            continue
        value = plistlib.loads(chunk)
        if not value.get('is_delta'):
            continue
        tasks = []
        for task in value.get('tasks', []):
            if task['pid'] not in allowed:
                continue
            cpu = task.get('cputime_sample_ms_per_s')
            tasks.append({
                'pid': task['pid'],
                'cpuPercent': cpu / 10 if isinstance(cpu, (int, float)) else None,
                'wakeupsPerSecond': task.get('idle_wakeups_per_s'),
                'energyImpact': task.get('energy_impact_per_s'),
            })
        stamp = value['timestamp'].replace(tzinfo=datetime.timezone.utc)
        samples.append({'endMs': stamp.timestamp() * 1000,
                        'seconds': value['elapsed_ns'] / 1e9, 'tasks': tasks})
# Keep only the selected app rows as an independently inspectable checkpoint.
# The unprivileged runner writes this destination before starting the sampler.
destination = pathlib.Path(sys.argv[1]).parent / 'report-directory.txt'
if destination.exists():
    target = pathlib.Path(destination.read_text()) / 'native-process-samples.json'
    target.write_text(json.dumps(samples))
json.dump(samples, sys.stdout)
