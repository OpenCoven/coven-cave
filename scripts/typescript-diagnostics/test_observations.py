import copy, json, pathlib, tempfile, unittest

class ObservationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='c6036-receipt-');self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name)
        common={'pid':12,'ppid':1,'thread_id':0,'is_main_thread':True,
                'entry':'/source/node_modules/typescript/bin/tsc','cwd':'/source'}
        self.events=[{**common,'event':'start','monotonic_ns':100,
                      'node_version':'v24.22.0','heap_size_limit_bytes':4294967296,
                      'compiler_args':['--project','/source/tsconfig.json','--noEmit'],
                      'tsconfig_path':'/source/tsconfig.json','tsconfig_sha256':'a'*64},
                     {**common,'event':'exit','monotonic_ns':200,'exit_code':0,'resource_usage':{'maxRSS':42}}]
    def write(self,events):
        (self.root/'one.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in events))
    def validate(self):
        from observations import validate_observations
        return validate_observations(self.root)
    def test_complete_checker_receipt(self):
        self.write(self.events)
        self.assertEqual(self.validate()['checking_invocations'],1)
    def test_incomplete_or_contradictory_receipts_rejected(self):
        cases=[[],self.events[:1],self.events+self.events]
        for key,value in [('pid',13),('thread_id',2),('exit_code',7),('monotonic_ns',99)]:
            changed=copy.deepcopy(self.events);changed[1][key]=value;cases.append(changed)
        for key,value in [('node_version',None),('heap_size_limit_bytes',None),('heap_size_limit_bytes',0),('config_observation_error','ENOENT'),('tsconfig_sha256',None),
                          ('compiler_args',['--showConfig']),('compiler_args',['--noEmit','--help']),('is_main_thread',False)]:
            changed=copy.deepcopy(self.events);changed[0][key]=value;cases.append(changed)
        for events in cases:
            with self.subTest(events=events):
                self.write(events)
                with self.assertRaises(ValueError):self.validate()
    def test_noncompiler_cannot_supply_compiler_receipt(self):
        events=copy.deepcopy(self.events)
        for event in events:event['entry']='/source/unrelated.cjs'
        self.write(events)
        with self.assertRaises(ValueError):self.validate()

    def test_missing_malformed_truncated_and_duplicate_receipts_rejected(self):
        with self.assertRaises(ValueError):self.validate()
        for raw in ['not-json\n','[]\n',json.dumps(self.events[0])]:
            (self.root/'one.jsonl').write_text(raw)
            with self.assertRaises(ValueError):self.validate()
        self.write(self.events)
        (self.root/'two.jsonl').write_bytes((self.root/'one.jsonl').read_bytes())
        with self.assertRaises(ValueError):self.validate()
