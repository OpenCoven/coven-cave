import json, os, pathlib, subprocess, tempfile, unittest

OBSERVER=pathlib.Path(__file__).with_name('node_observer.cjs')

class NodeObserverTests(unittest.TestCase):
    def test_compiler_receipt_preserves_exit_and_records_config_without_contents(self):
        with tempfile.TemporaryDirectory(prefix='c6036-node-') as tmp:
            root=pathlib.Path(tmp);out=root/'observations';out.mkdir()
            entry=root/'typescript/bin/tsc';entry.parent.mkdir(parents=True)
            entry.write_text('process.exitCode=7;')
            (root/'tsconfig.json').write_text('{"private-fixture-marker":true}')
            result=subprocess.run(['node','--require',str(OBSERVER),str(entry),'--noEmit'],cwd=root,
                env={**os.environ,'COVEN_TS_OBSERVATION_DIR':str(out)},capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,7,result.stderr)
            files=list(out.glob('*.jsonl'));self.assertEqual(len(files),1)
            raw=files[0].read_text();events=[json.loads(line) for line in raw.splitlines()]
            self.assertEqual([e['event'] for e in events],['start','exit'])
            self.assertEqual(events[0]['compiler_args'],['--noEmit'])
            self.assertEqual(len(events[0]['tsconfig_sha256']),64)
            self.assertNotIn('private-fixture-marker',raw)
            self.assertEqual(events[1]['exit_code'],7)
            self.assertEqual(events[0]['pid'],events[1]['pid'])
            self.assertGreaterEqual(events[1]['monotonic_ns'],events[0]['monotonic_ns'])

    def test_inherited_child_receipts_omit_noncompiler_arguments(self):
        with tempfile.TemporaryDirectory(prefix='c6036-node-') as tmp:
            root=pathlib.Path(tmp);out=root/'observations';out.mkdir()
            child=root/'child.cjs';child.write_text('process.stdout.write("child-ok")')
            parent=root/'parent.cjs';parent.write_text('require("node:child_process").spawnSync(process.execPath,[process.argv[2],"secret-argument"],{stdio:"inherit"});')
            result=subprocess.run(['node',str(parent),str(child)],cwd=root,
                env={**os.environ,'COVEN_TS_OBSERVATION_DIR':str(out),'NODE_OPTIONS':'--require '+str(OBSERVER)},capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout,'child-ok')
            files=list(out.glob('*.jsonl'));self.assertEqual(len(files),2)
            for file in files:
                raw=file.read_text();self.assertNotIn('secret-argument',raw)
                events=[json.loads(line) for line in raw.splitlines()]
                self.assertEqual([e['event'] for e in events],['start','exit'])
                self.assertNotIn('compiler_args',events[0])

    def test_directory_project_and_upward_config_discovery(self):
        import hashlib
        with tempfile.TemporaryDirectory(prefix='c6036-config-') as tmp:
            root=pathlib.Path(tmp);entry=root/'typescript/bin/tsc';entry.parent.mkdir(parents=True);entry.write_text('')
            config=root/'tsconfig.json';config.write_text('{"compilerOptions":{}}')
            child=root/'nested';child.mkdir()
            for index,args in enumerate([['-p',str(root)],['--project',str(config)],[]]):
                out=root/str(index);out.mkdir()
                result=subprocess.run(['node','--require',str(OBSERVER),str(entry),*args],cwd=child,
                    env={**os.environ,'COVEN_TS_OBSERVATION_DIR':str(out)},capture_output=True,text=True,timeout=5)
                self.assertEqual(result.returncode,0,result.stderr)
                event=json.loads(next(out.glob('*.jsonl')).read_text().splitlines()[0])
                self.assertEqual(pathlib.Path(event['tsconfig_path']).resolve(),config.resolve())
                self.assertEqual(event['tsconfig_sha256'],hashlib.sha256(config.read_bytes()).hexdigest())

    def test_worker_thread_receipts_are_not_separate_processes(self):
        with tempfile.TemporaryDirectory(prefix='c6036-thread-') as tmp:
            root=pathlib.Path(tmp);out=root/'observations';out.mkdir()
            entry=root/'worker.cjs'
            entry.write_text('const {Worker,isMainThread}=require("node:worker_threads");if(isMainThread)new Worker(__filename);')
            result=subprocess.run(['node','--require',str(OBSERVER),str(entry)],cwd=root,
                env={**os.environ,'COVEN_TS_OBSERVATION_DIR':str(out)},capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stderr)
            receipts=[[json.loads(line) for line in f.read_text().splitlines()] for f in out.glob('*.jsonl')]
            self.assertEqual(len(receipts),2)
            self.assertEqual(len({r[0]['pid'] for r in receipts}),1)
            self.assertEqual(len({r[0].get('thread_id') for r in receipts}),2)
            worker=next(r for r in receipts if not r[0]['is_main_thread'])
            self.assertNotIn('resource_usage',worker[-1])

    def test_invalid_config_observation_preserves_workload_exit(self):
        with tempfile.TemporaryDirectory(prefix='c6036-invalid-') as tmp:
            root=pathlib.Path(tmp);entry=root/'typescript/bin/tsc';entry.parent.mkdir(parents=True)
            entry.write_text('process.exitCode=7;')
            bad=root/'bad.json';bad.mkdir()
            for index,args in enumerate([['-p'],['-p',str(root/'missing.json')],['-p',str(bad)]]):
                out=root/str(index);out.mkdir()
                result=subprocess.run(['node','--require',str(OBSERVER),str(entry),*args],cwd=root,
                    env={**os.environ,'COVEN_TS_OBSERVATION_DIR':str(out)},capture_output=True,text=True,timeout=5)
                self.assertEqual(result.returncode,7,result.stderr)
                events=[json.loads(line) for line in next(out.glob('*.jsonl')).read_text().splitlines()]
                self.assertTrue(events[0].get('config_observation_error'))
                self.assertIsNone(events[0].get('tsconfig_sha256'))
                self.assertEqual(events[-1]['exit_code'],7)

    def test_real_receipts_validate_and_truncation_is_rejected(self):
        from observations import validate_observations
        with tempfile.TemporaryDirectory(prefix='c6036-validator-') as tmp:
            root=pathlib.Path(tmp);out=root/'observations';out.mkdir()
            entry=root/'typescript/bin/tsc';entry.parent.mkdir(parents=True)
            entry.write_text('const {Worker,isMainThread}=require("node:worker_threads");if(isMainThread)new Worker(__filename);')
            (root/'tsconfig.json').write_text('{}')
            result=subprocess.run(['node','--require',str(OBSERVER),str(entry),'--noEmit'],cwd=root,
                env={**os.environ,'COVEN_TS_OBSERVATION_DIR':str(out)},capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stderr)
            receipt=validate_observations(out)
            self.assertEqual(receipt['checking_invocations'],1)
            self.assertEqual(receipt['execution_contexts'],2)
            file=next(out.glob('*.jsonl'));file.write_bytes(file.read_bytes().splitlines(keepends=True)[0])
            with self.assertRaises(ValueError):validate_observations(out)

    def test_effective_heap_is_recorded_without_environment_contents(self):
        with tempfile.TemporaryDirectory(prefix='c6036-heap-') as tmp:
            out=pathlib.Path(tmp)
            result=subprocess.run(['node','--max-old-space-size=128','--require',str(OBSERVER),'-e','process.stdout.write(String(require("node:v8").getHeapStatistics().heap_size_limit))'],
                env={**os.environ,'COVEN_TS_OBSERVATION_DIR':str(out)},capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stderr)
            event=json.loads(next(out.glob('*.jsonl')).read_text().splitlines()[0])
            self.assertEqual(event['node_version'],subprocess.check_output(['node','--version'],text=True).strip())
            self.assertEqual(event['heap_size_limit_bytes'],int(result.stdout))
            self.assertLess(event['heap_size_limit_bytes'],4096*1024**2)

    def test_response_file_is_not_mislabeled_as_default_config(self):
        with tempfile.TemporaryDirectory(prefix='c6036-response-') as tmp:
            root=pathlib.Path(tmp);out=root/'observations';out.mkdir()
            entry=root/'typescript/bin/tsc';entry.parent.mkdir(parents=True);entry.write_text('')
            (root/'tsconfig.json').write_text('{}')
            result=subprocess.run(['node','--require',str(OBSERVER),str(entry),'@options.txt'],cwd=root,
                env={**os.environ,'COVEN_TS_OBSERVATION_DIR':str(out)},capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stderr)
            event=json.loads(next(out.glob('*.jsonl')).read_text().splitlines()[0])
            self.assertEqual(event.get('config_observation_error'),'unsupported-config-selection')
            self.assertIsNone(event.get('tsconfig_sha256'))

    def test_duplicate_project_selectors_are_not_mislabeled(self):
        with tempfile.TemporaryDirectory(prefix='c6036-duplicate-') as tmp:
            root=pathlib.Path(tmp);out=root/'observations';out.mkdir()
            entry=root/'typescript/bin/tsc';entry.parent.mkdir(parents=True);entry.write_text('')
            (root/'tsconfig.json').write_text('{}');(root/'alternate.json').write_text('{}')
            result=subprocess.run(['node','--require',str(OBSERVER),str(entry),'--noEmit',
                                   '-p','tsconfig.json','--project','alternate.json'],cwd=root,
                env={**os.environ,'COVEN_TS_OBSERVATION_DIR':str(out)},capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stderr)
            event=json.loads(next(out.glob('*.jsonl')).read_text().splitlines()[0])
            self.assertEqual(event.get('config_observation_error'),'unsupported-config-selection')
            self.assertIsNone(event.get('tsconfig_sha256'))
