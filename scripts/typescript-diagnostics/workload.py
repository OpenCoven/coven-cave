"""One pinned diagnostic workload on an exclusively owned hosted macOS job."""
import argparse
import hashlib
import json
import math
import os
import pathlib
import platform
import re
import shutil
import subprocess
import sys
import measure


def digest(path):
    result=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):result.update(chunk)
    return result.hexdigest()


def validate(root, kind):
    if kind not in ('tsc', 'tsc-incremental', 'build'):
        raise ValueError('unknown workload kind')
    record=json.loads((root/'result.json').read_text())
    if kind == 'tsc-incremental':
        command=record.get('command')
        if (not isinstance(command,list) or len(command)!=10
            or command[:-1]!=['pnpm','exec','tsc','--noEmit','--incremental','true',
                '--extendedDiagnostics','--listFiles','--tsBuildInfoFile']
            or not isinstance(command[-1],str)
            or not pathlib.Path(command[-1]).is_absolute()
            or pathlib.Path(command[-1]).parts[-3:]!=('.next','cache','.tsbuildinfo')):
            raise ValueError('incremental artifact has wrong compiler command')
        try:
            provenance=json.loads((root.parent/'provenance.json').read_text())
        except (OSError,ValueError) as error:
            raise ValueError('missing or malformed incremental provenance') from error
        if (not isinstance(provenance,dict)
            or provenance.get('kind')!='tsc-incremental'
            or provenance.get('measurement_command')!=command
            or provenance.get('incremental_build_info_before')!='absent'
            or not isinstance(provenance.get('incremental_build_info_sha256'),str)
            or not re.fullmatch('[0-9a-f]{64}',provenance['incremental_build_info_sha256'])):
            raise ValueError('incomplete or inconsistent incremental provenance')
    if record.get('exit_code') != 0 or record.get('stop_reason') or record.get('cleanup_error') or record.get('direct_child_cleanup_error'):
        raise ValueError('command or measurement failed')
    seconds=record.get('command_seconds')
    if not isinstance(seconds,(int,float)) or not math.isfinite(seconds) or seconds < 0:
        raise ValueError('missing valid command timing')
    if record.get('remaining_observed_pids') != []:
        raise ValueError('incomplete final process observation')
    log=root/'command.log'
    if log.stat().st_size != record.get('log_snapshot_bytes') or digest(log) != record.get('log_sha256'):
        raise ValueError('log changed after observer snapshot')
    previous=-1
    count=0
    with (root/'samples.jsonl').open() as stream:
        for line in stream:
            sample=json.loads(line)
            elapsed=sample.get('elapsed')
            if not isinstance(elapsed,(int,float)) or not math.isfinite(elapsed) or elapsed < previous or elapsed < 0:
                raise ValueError('invalid sample timing')
            if not isinstance(sample.get('processes'),list) or not sample.get('swap') or not sample.get('vm_stat'):
                raise ValueError('incomplete resource sample')
            previous=elapsed;count+=1
    if not count:raise ValueError('missing resource samples')
    text=log.read_text(errors='replace')
    markers=('Running TypeScript', 'Finished TypeScript') if kind=='build' else ('Files:', 'Types:', 'Memory used:', 'Total time:')
    if not all(marker in text for marker in markers):raise ValueError('missing compiler phase evidence')
    return {'command_seconds':seconds,'sample_count':count,'log_sha256':record['log_sha256'],
            'descendant_cleanup':'unknown','interpretation':'completed observed workload; not a containment or causal proof'}


def installed_graph(source):
    manifest=json.loads((source/'package.json').read_text())
    versions={}
    for name in ['next','typescript','react','@opencoven/research']:
        package=source/'node_modules'/name/'package.json'
        versions[name]=json.loads(package.read_text()).get('version') if package.exists() else None
    return {'versions':versions,'research_expected':'@opencoven/research' in manifest.get('optionalDependencies',{})}


def validate_graph(graph):
    expected={'next':'16.3.8','typescript':'6.0.3','react':'19.2.8',
              '@opencoven/research':'0.1.0' if graph['research_expected'] else None}
    if graph['versions']!=expected:raise ValueError('installed graph differs from the pinned experiment policy')


def capture(command, cwd):
    return subprocess.check_output(command,cwd=cwd,text=True,timeout=15).strip()


def compiler_command(kind, source):
    if kind not in ('tsc', 'tsc-incremental'):
        raise ValueError('unknown compiler kind')
    incremental = kind == 'tsc-incremental'
    command = ['pnpm','exec','tsc','--noEmit','--incremental',
               'true' if incremental else 'false','--extendedDiagnostics','--listFiles']
    if incremental:
        cache = source/'.next/cache/.tsbuildinfo'
        if cache.exists() or cache.is_symlink():
            raise ValueError('incremental comparison requires cold build info')
        command.extend(['--tsBuildInfoFile',str(cache)])
    return command


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=pathlib.Path,required=True)
    parser.add_argument('--output',type=pathlib.Path,required=True)
    parser.add_argument('--commit',required=True)
    parser.add_argument('--kind',choices=['tsc','tsc-incremental','build'],required=True)
    args=parser.parse_args()
    source=args.source.resolve();out=args.output.resolve()
    # This is an operator-facing protocol guard, not authentication of a host.
    if os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted' or platform.system()!='Darwin' or platform.machine()!='arm64':
        parser.error('requires a fresh GitHub-hosted macOS ARM64 job')
    if not re.fullmatch('[0-9a-f]{40}',args.commit):parser.error('full source OID required')
    if capture(['git','rev-parse','HEAD'],source)!=args.commit:parser.error('source OID mismatch')
    if capture(['git','status','--porcelain'],source):parser.error('source must start clean')
    if (source/'.next').exists() or (source/'node_modules').exists():parser.error('fresh source without build/dependency caches required')
    out.mkdir(parents=True,exist_ok=False)
    provenance={'source_oid':args.commit,'kind':args.kind,'harness_oid':capture(['git','rev-parse','HEAD'],pathlib.Path(__file__).resolve().parents[2]),
        'lock_sha256':digest(source/'pnpm-lock.yaml'),'node':capture(['node','--version'],source),'pnpm':capture(['pnpm','--version'],source),
        'os':platform.platform(),'architecture':platform.machine(),'physical_memory':capture(['sysctl','-n','hw.memsize'],source),
        'cpu_count':os.cpu_count(),'free_disk_bytes':shutil.disk_usage(source).free,
        'runner':{k:os.environ.get(k) for k in ['ImageOS','ImageVersion','RUNNER_ARCH','RUNNER_ENVIRONMENT','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT']},
        'heap_mib':4096,'ci':True,'typecheck_skip':False,'cache':'fresh checkout; no restored dependency/build cache',
        'isolation':'one measured workload per fresh hosted job; descendant cleanup unknown'}
    (out/'provenance.json').write_text(json.dumps(provenance,indent=2))
    if provenance['node']!='v24.22.0' or provenance['pnpm']!='10.34.0':raise ValueError('unexpected toolchain')
    if provenance['free_disk_bytes'] < 10*1024**3:raise ValueError('less than 10GiB free; preserve evidence and stop')
    if measure.run(['pnpm','install','--frozen-lockfile'],source,out/'install',900,1):return 1
    if digest(source/'pnpm-lock.yaml')!=provenance['lock_sha256']:raise ValueError('installation changed lockfile')
    provenance['installed_graph']=installed_graph(source)
    (out/'provenance.json').write_text(json.dumps(provenance,indent=2))
    validate_graph(provenance['installed_graph'])
    if args.kind in ('tsc','tsc-incremental'):
        if measure.run(['pnpm','exec','next','typegen'],source,out/'typegen',300,1):return 1
        command=compiler_command(args.kind,source)
    else:command=['pnpm','build']
    provenance['measurement_command']=command
    provenance['incremental_build_info_before']='absent' if args.kind=='tsc-incremental' else 'not-applicable'
    (out/'provenance.json').write_text(json.dumps(provenance,indent=2))
    if measure.run(command,source,out/'measurement',2700,1):return 1
    if args.kind=='tsc-incremental':
        cache=source/'.next/cache/.tsbuildinfo'
        if not cache.is_file():raise ValueError('incremental compiler produced no build info')
        provenance['incremental_build_info_sha256']=digest(cache)
        (out/'provenance.json').write_text(json.dumps(provenance,indent=2))
    result=validate(out/'measurement',args.kind)
    (out/'validation.json').write_text(json.dumps(result,indent=2))
    return 0


if __name__=='__main__':sys.exit(main())
