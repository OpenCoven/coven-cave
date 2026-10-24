"""Validate retained Node observations; this does not prove process containment."""
import hashlib
import json
import pathlib
import re


def validate_observations(directory):
    directory=pathlib.Path(directory)
    files=sorted(directory.glob('*.jsonl'))
    if not files:raise ValueError('missing Node observations')
    identities=set();checking=0;receipts=[]
    for file in files:
        if file.is_symlink():raise ValueError('observation symlink')
        raw=file.read_bytes()
        if not raw.endswith(b'\n'):raise ValueError('truncated observation')
        try:events=[json.loads(line) for line in raw.splitlines()]
        except (ValueError,UnicodeError) as error:raise ValueError('malformed observation') from error
        if len(events)!=2 or not all(isinstance(e,dict) for e in events):
            raise ValueError('incomplete observation lifecycle')
        start,end=events
        if start.get('event')!='start' or end.get('event')!='exit':raise ValueError('wrong lifecycle order')
        for key in ('pid','ppid','thread_id','is_main_thread','entry','cwd'):
            if key not in start or start[key]!=end.get(key):raise ValueError('inconsistent observation identity')
        if any(type(start[k]) is not int or start[k]<0 for k in ('pid','ppid','thread_id')) or start['pid']==0:
            raise ValueError('invalid process identity')
        if type(start['is_main_thread']) is not bool or start['is_main_thread']!=(start['thread_id']==0):
            raise ValueError('invalid thread identity')
        if any(not isinstance(start[k],str) for k in ('entry','cwd')):raise ValueError('invalid entry/cwd')
        if any(type(e.get('monotonic_ns')) is not int or e['monotonic_ns']<0 for e in events):
            raise ValueError('invalid observation clock')
        identity=(start['pid'],start['thread_id'],start['monotonic_ns'])
        if identity in identities:raise ValueError('duplicate observation')
        identities.add(identity)
        if end['monotonic_ns']<start['monotonic_ns']:raise ValueError('reversed observation clock')
        if type(end.get('exit_code')) is not int or end['exit_code']!=0:raise ValueError('observed execution failed')
        if not start['is_main_thread'] and 'resource_usage' in end:raise ValueError('worker has process-wide resources')
        compiler=bool(re.search(r'[/\\]typescript[/\\](?:bin[/\\]tsc|lib[/\\](?:_?tsc)\.js)$',start['entry']))
        if compiler != ('compiler_args' in start):raise ValueError('compiler entry/arguments mismatch')
        if compiler:
            args=start['compiler_args']
            if not isinstance(args,list) or not all(isinstance(a,str) for a in args):raise ValueError('invalid compiler arguments')
            if start.get('config_observation_error') or not isinstance(start.get('tsconfig_sha256'),str) or not re.fullmatch('[0-9a-f]{64}',start['tsconfig_sha256']):
                raise ValueError('incomplete config observation')
            if not isinstance(start.get('tsconfig_path'),str) or not pathlib.Path(start['tsconfig_path']).is_absolute():
                raise ValueError('invalid config path')
            if start['is_main_thread'] and '--noEmit' in args and not set(args).intersection(('--showConfig','--help','-h','--version','-v','--init')):
                checking+=1
        receipts.append({'file':file.name,'sha256':hashlib.sha256(raw).hexdigest()})
    if not checking:raise ValueError('missing completed checking invocation')
    return {'checking_invocations':checking,'execution_contexts':len(files),'receipts':receipts,
            'coverage':'retained preload receipts only; missing unobserved contexts cannot be excluded'}
