import hashlib, json, pathlib, tempfile, unittest
from workload import validate

class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='c6036-artifact-')
        self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name)/'measurement'
        self.root.mkdir()
        self.oid='a'*40
        self.log=b'Files: 10\nTypes: 20\nMemory used: 100K\nTotal time: 1.00s\n'
        self.record={'exit_code':0,'stop_reason':None,'remaining_observed_pids':[],
            'command_seconds':1.0,'log_sha256':hashlib.sha256(self.log).hexdigest(),
            'log_snapshot_bytes':len(self.log),'descendant_cleanup':'unknown'}
        self.write()
    def write(self):
        (self.root/'command.log').write_bytes(self.log)
        (self.root/'result.json').write_text(json.dumps(self.record))
        (self.root/'samples.jsonl').write_text(json.dumps({'elapsed':.1,'processes':[], 'swap':'used = 0', 'vm_stat':'Pages free: 1'})+'\n')
    def test_valid_compiler_artifact(self):
        self.assertEqual(validate(self.root,'tsc')['command_seconds'],1.0)
    def test_incremental_artifact_rejects_nonincremental_command(self):
        self.record['command']=['pnpm','exec','tsc','--incremental','false']
        self.write()
        with self.assertRaises(ValueError):validate(self.root,'tsc-incremental')
        self.record['command']=['pnpm','exec','tsc','--noEmit','--incremental','true',
            '--extendedDiagnostics','--listFiles','--tsBuildInfoFile','/synthetic/.next/cache/.tsbuildinfo']
        self.write()
        provenance={'kind':'tsc-incremental','measurement_command':self.record['command'],
                    'incremental_build_info_before':'absent','incremental_build_info_sha256':'a'*64}
        receipt=self.root.parent/'provenance.json'
        with self.assertRaisesRegex(ValueError,'provenance'):validate(self.root,'tsc-incremental')
        for key,value in [('kind','tsc'),('measurement_command',[]),
                          ('incremental_build_info_before','present'),
                          ('incremental_build_info_sha256',None),
                          ('incremental_build_info_sha256','invalid')]:
            with self.subTest(key=key,value=value):
                invalid={**provenance,key:value}
                receipt.write_text(json.dumps(invalid))
                with self.assertRaisesRegex(ValueError,'provenance'):validate(self.root,'tsc-incremental')
        for malformed in ['not-json','[]']:
            receipt.write_text(malformed)
            with self.assertRaisesRegex(ValueError,'provenance'):validate(self.root,'tsc-incremental')
        receipt.write_text(json.dumps(provenance))
        self.assertEqual(validate(self.root,'tsc-incremental')['command_seconds'],1.0)
        with self.assertRaises(ValueError):validate(self.root,'unknown')
    def test_failure_or_incomplete_measurement_rejected(self):
        for key,value in [('exit_code',7),('stop_reason','timeout'),('remaining_observed_pids',None),('command_seconds',None),('cleanup_error','sampling unavailable')]:
            with self.subTest(key=key):
                before=dict(self.record);self.record[key]=value;self.write()
                with self.assertRaises(ValueError):validate(self.root,'tsc')
                self.record=before
    def test_missing_samples_rejected(self):
        (self.root/'samples.jsonl').write_text('')
        with self.assertRaises(ValueError):validate(self.root,'tsc')
    def test_appended_log_is_not_final_evidence(self):
        with (self.root/'command.log').open('ab') as out:out.write(b'late output')
        with self.assertRaises(ValueError):validate(self.root,'tsc')
    def test_build_requires_actual_typecheck_phase(self):
        with self.assertRaises(ValueError):validate(self.root,'build')
        self.log=b'Running TypeScript ...\nFinished TypeScript in 1s\n'
        self.record['log_sha256']=hashlib.sha256(self.log).hexdigest();self.record['log_snapshot_bytes']=len(self.log);self.write()
        self.assertEqual(validate(self.root,'build')['command_seconds'],1.0)
    def test_observed_build_requires_bound_receipts_and_log_offsets(self):
        from test_observations import ObservationTests
        fixture=ObservationTests();fixture.setUp();self.addCleanup(fixture.doCleanups)
        self.log=b'Running TypeScript ...\nFinished TypeScript in 1s\n'
        self.record.update(command=['pnpm','build'],node_observation=True,
                           log_sha256=hashlib.sha256(self.log).hexdigest(),log_snapshot_bytes=len(self.log))
        self.write()
        provenance={'kind':'build-observed','measurement_command':['pnpm','build'],'node_observation':True}
        (self.root.parent/'provenance.json').write_text(json.dumps(provenance))
        directory=self.root/'node-observations';directory.mkdir()
        (directory/'compiler.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in fixture.events))
        sample={'elapsed':.1,'processes':[],'swap':'used=0','vm_stat':'free=1','log_bytes':len(self.log)}
        samples=self.root/'samples.jsonl';samples.write_text(json.dumps(sample)+'\n')
        self.assertEqual(validate(self.root,'build-observed')['node_observations']['checking_invocations'],1)
        for value in [-1,len(self.log)+1,None]:
            samples.write_text(json.dumps({**sample,'log_bytes':value})+'\n')
            with self.assertRaises(ValueError):validate(self.root,'build-observed')
        samples.write_text(json.dumps(sample)+'\n')
        self.record['node_observation']=False;self.write()
        with self.assertRaises(ValueError):validate(self.root,'build-observed')

    def test_malformed_samples_rejected(self):
        for value in ['not-json',json.dumps({'elapsed':1}),json.dumps({'elapsed':-1,'processes':[],'swap':'x','vm_stat':'x'})]:
            (self.root/'samples.jsonl').write_text(value+'\n')
            with self.assertRaises(ValueError):validate(self.root,'tsc')


class CompilerModeTests(unittest.TestCase):
    def test_incremental_requires_cold_build_info_and_explicit_mode(self):
        from workload import compiler_command
        with tempfile.TemporaryDirectory() as tmp:
            source=pathlib.Path(tmp)
            command=compiler_command('tsc-incremental',source)
            self.assertEqual(command[command.index('--incremental')+1],'true')
            cache=pathlib.Path(command[command.index('--tsBuildInfoFile')+1])
            self.assertEqual(cache,source/'.next/cache/.tsbuildinfo')
            self.assertFalse(cache.exists())
            cache.parent.mkdir(parents=True);cache.write_text('prior compilation')
            with self.assertRaisesRegex(ValueError,'cold'):compiler_command('tsc-incremental',source)
            self.assertEqual(cache.read_text(),'prior compilation')
            cache.unlink();cache.symlink_to(source/'missing-build-info')
            with self.assertRaisesRegex(ValueError,'cold'):compiler_command('tsc-incremental',source)
            self.assertTrue(cache.is_symlink())
            control=compiler_command('tsc',source)
            self.assertEqual(control[control.index('--incremental')+1],'false')
            self.assertNotIn('--tsBuildInfoFile',control)
            with self.assertRaises(ValueError):compiler_command('unknown',source)



class DependencyGraphTests(unittest.TestCase):
    def test_optional_research_policy_matches_source_and_actual_install(self):
        from workload import installed_graph, validate_graph
        root=pathlib.Path(tempfile.mkdtemp(prefix='c6036-graph-'))
        for name,version in [('next','16.3.8'),('typescript','6.0.3'),('react','19.2.8')]:
            package=root/'node_modules'/name/'package.json';package.parent.mkdir(parents=True)
            package.write_text(json.dumps({'version':version}))
        (root/'package.json').write_text(json.dumps({'optionalDependencies':{'@opencoven/research':'fixture'}}))
        graph=installed_graph(root)
        self.assertTrue(graph['research_expected'])
        self.assertIsNone(graph['versions']['@opencoven/research'])
        with self.assertRaises(ValueError):validate_graph(graph)
        research=root/'node_modules/@opencoven/research/package.json';research.parent.mkdir(parents=True)
        research.write_text(json.dumps({'version':'0.1.0'}))
        graph=installed_graph(root);validate_graph(graph)
        self.assertEqual(graph['versions']['@opencoven/research'],'0.1.0')
        (root/'package.json').write_text('{}')
        with self.assertRaises(ValueError):validate_graph(installed_graph(root))
        research.unlink();validate_graph(installed_graph(root))

    def test_research_version_is_an_explicit_per_source_expectation(self):
        from workload import installed_graph, validate_graph
        root=pathlib.Path(tempfile.mkdtemp(prefix='c6036-graph-'))
        for name,version in [('next','16.3.8'),('typescript','6.0.3'),('react','19.2.8'),('@opencoven/research','0.2.0')]:
            package=root/'node_modules'/name/'package.json';package.parent.mkdir(parents=True)
            package.write_text(json.dumps({'version':version}))
        (root/'package.json').write_text(json.dumps({'optionalDependencies':{'@opencoven/research':'fixture'}}))
        graph=installed_graph(root)
        validate_graph(graph,research_version='0.2.0')
        with self.assertRaises(ValueError):validate_graph(graph)
        with self.assertRaises(ValueError):validate_graph(graph,research_version='0.3.0')

if __name__=='__main__':unittest.main()
