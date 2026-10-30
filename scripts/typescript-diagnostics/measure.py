"""Diagnostic observer. Only the directly spawned child is owned for cleanup."""
import argparse, datetime, hashlib, json, os, pathlib, signal, subprocess, sys, time, threading


def capture(command):
    p = subprocess.run(command, capture_output=True, text=True, timeout=2)
    if p.returncode:
        raise RuntimeError('sampler failed: ' + command[0])
    return p.stdout


def processes():
    rows = {}
    for line in capture(['ps', '-axo', 'pid=,ppid=,rss=,pcpu=,lstart=,stat=']).splitlines():
        f = line.split()
        if not f: continue
        if len(f) != 10: raise ValueError('invalid ps row')
        if len(f) == 10:
            rows[int(f[0])] = dict(pid=int(f[0]), ppid=int(f[1]), rss_kib=int(f[2]),
                                  cpu=float(f[3]), identity=' '.join(f[4:9]), state=f[9])
    if not rows: raise ValueError('empty ps sample')
    return rows


def run(command, cwd, output, timeout, interval, *, observe_node=False):
    original = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        return _run(command, cwd, output, timeout, interval, observe_node=observe_node)
    finally:
        for sig, handler in original.items(): signal.signal(sig, handler)


def _run(command, cwd, output, timeout, interval, *, observe_node=False):
    output.mkdir(parents=True, exist_ok=False)
    home = output / 'home'
    home.mkdir()
    env = {k: v for k, v in os.environ.items() if k in ('PATH', 'LANG', 'LC_ALL', 'TMPDIR')}
    env.update(CI='true', HOME=str(home), COVEN_HOME=str(home/'coven'), COVEN_CAVE_HOME=str(home/'cave'),
               NODE_OPTIONS='--max-old-space-size=4096', NODE_ENV='production', NEXT_TELEMETRY_DISABLED='1')
    if observe_node:
        observations=output/'node-observations'
        observations.mkdir()
        observer=pathlib.Path(__file__).with_name('node_observer.cjs').resolve()
        env['NODE_OPTIONS'] += ' --require ' + json.dumps(str(observer))
        env['COVEN_TS_OBSERVATION_DIR']=str(observations.resolve())
    start = time.monotonic()
    record = dict(node_observation=observe_node, command=command, cwd=str(cwd), started_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  stop_reason=None, exit_code=None, cleanup_scope='direct child only; descendant observations are not ownership', descendant_cleanup='unknown')
    stopped = []
    previous = {}
    for sig in (signal.SIGINT, signal.SIGTERM):
        previous[sig] = signal.signal(sig, lambda number, frame: stopped.append(number))
    known = {}
    p = None
    supervisor = None
    supervisor_started = False
    stop_child = threading.Event()
    completed = threading.Event()
    def supervise():
        child_start = time.monotonic()
        try:
            while p.poll() is None:
                if stop_child.is_set() or stopped or time.monotonic()-child_start >= timeout:
                    if not stop_child.is_set() and not stopped:
                        record['stop_reason'] = 'timeout'
                    if stopped:
                        record['stop_reason'] = 'signal:' + str(stopped[0])
                    p.terminate()
                    try:
                        p.wait(timeout=1.5)
                    except subprocess.TimeoutExpired:
                        p.kill()
                        try:
                            p.wait(timeout=1.5)
                        except subprocess.TimeoutExpired:
                            record['direct_child_cleanup_error'] = 'child did not settle after SIGKILL'
                    break
                try:
                    p.wait(timeout=min(.05, max(.001, timeout-(time.monotonic()-child_start))))
                except subprocess.TimeoutExpired:
                    pass
        except Exception as error:
            record['direct_child_cleanup_error'] = str(error)
        finally:
            record['command_seconds'] = time.monotonic()-child_start
            record['command_timing'] = 'direct-child exit observation; scheduler and <=50ms polling uncertainty'
            record['exit_code'] = p.poll()
            completed.set()
    def members():
        rows = processes()
        owned = {pid for pid, identity in known.items() if pid in rows and rows[pid]['identity'] == identity}
        if p is not None and p.poll() is None and p.pid in rows:
            owned.add(p.pid)
        while True:
            extra = {pid for pid, row in rows.items() if row['ppid'] in owned}
            if extra <= owned:
                break
            owned |= extra
        for pid in owned:
            known[pid] = rows[pid]['identity']
        return [rows[pid] for pid in owned if not rows[pid]['state'].startswith('Z')]
    try:
        with (output/'command.log').open('x') as log, (output/'samples.jsonl').open('x') as samples:
            p = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            record['pid'] = p.pid
            supervisor = threading.Thread(target=supervise, daemon=True)
            supervisor.start()
            supervisor_started = True
            while True:
                sample = dict(elapsed=time.monotonic()-start, processes=members(),
                              swap=capture(['sysctl', 'vm.swapusage']), vm_stat=capture(['vm_stat']),
                              log_bytes=os.fstat(log.fileno()).st_size)
                samples.write(json.dumps(sample)+'\n'); samples.flush(); os.fsync(samples.fileno())
                if completed.is_set() or stopped:
                    break
                time.sleep(interval)
    except Exception as error:
        record['stop_reason'] = 'error:' + type(error).__name__
        record['error'] = str(error)
    finally:
        try:
            record['remaining_observed_pids'] = [r['pid'] for r in members()]
        except Exception as error:
            record['cleanup_error'] = str(error)
            record['remaining_observed_pids'] = None
        stop_child.set()
        if supervisor_started:
            supervisor.join(timeout=4)
            if supervisor.is_alive():
                record['direct_child_cleanup_error'] = 'supervisor did not settle'
        elif p is not None:
            # Thread construction/start can fail under resource pressure.
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=1.5)
                except subprocess.TimeoutExpired:
                    p.kill()
                    try:
                        p.wait(timeout=1.5)
                    except subprocess.TimeoutExpired:
                        record['direct_child_cleanup_error'] = 'fallback child did not settle'
            record['exit_code'] = p.poll()
        try:
            record['remaining_observed_pids'] = [r['pid'] for r in members()]
        except Exception as error:
            record['cleanup_error'] = str(error)
            record['remaining_observed_pids'] = None
        record['seconds'] = time.monotonic()-start
        record['observed_identities'] = known
        log_path = output/'command.log'
        if log_path.exists():
            length = log_path.stat().st_size
            digest = hashlib.sha256()
            remaining = length
            with log_path.open('rb') as stream:
                while remaining:
                    chunk = stream.read(min(65536, remaining))
                    if not chunk: raise RuntimeError('log truncated during snapshot')
                    digest.update(chunk)
                    remaining -= len(chunk)
            record['log_sha256'] = digest.hexdigest()
            record['log_snapshot_bytes'] = length
            record['log_snapshot_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            record['log_finalized'] = False
        record['received_signals'] = list(stopped)
        if stopped and not record['stop_reason']:
            record['stop_reason'] = 'signal:' + str(stopped[0])
        with (output/'result.json').open('x') as result:
            json.dump(record, result, indent=2); result.flush(); os.fsync(result.fileno())
        for sig, handler in previous.items(): signal.signal(sig, handler)
    print(json.dumps(record))
    return 0 if record['exit_code'] == 0 and not stopped and not record['stop_reason'] and not record.get('direct_child_cleanup_error') and record['remaining_observed_pids'] == [] else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--command', action='store_true', required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--cwd', type=pathlib.Path, default=pathlib.Path.cwd())
    parser.add_argument('--timeout', type=float, default=2700)
    parser.add_argument('--interval', type=float, default=1)
    parser.add_argument('args', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.args[1:] if args.args[:1] == ['--'] else args.args
    if not command or args.timeout <= 0 or args.interval <= 0: parser.error('command and positive limits required')
    return run(command, args.cwd.resolve(), args.output.resolve(), args.timeout, args.interval)

if __name__ == '__main__': sys.exit(main())
