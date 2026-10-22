import json, os, pathlib, signal, subprocess, sys, tempfile, time, unittest
from unittest import mock
import contextlib, io, measure
HELPER=pathlib.Path(__file__).with_name('measure.py')
class EvidenceTests(unittest.TestCase):
 def setUp(self): self.out=pathlib.Path(tempfile.mkdtemp(prefix='c6036-helper-test-'))/'sample'
 def start(self,code,timeout=2):
  return subprocess.Popen([sys.executable,str(HELPER),'--command','--output',str(self.out),'--timeout',str(timeout),'--interval','.05','--',sys.executable,'-c',code],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 def finish(self,p):
  try: output=p.communicate(timeout=8)
  except subprocess.TimeoutExpired: p.kill();p.communicate();self.fail('unbounded helper')
  return p.returncode,output
 def receipt(self):
  self.assertTrue((self.out/'result.json').exists(),'durable receipt missing')
  return json.loads((self.out/'result.json').read_text())
 def test_success_samples_and_synthetic_home(self):
  p=self.start("import os,time;print(os.environ['HOME'],flush=True);time.sleep(.2)");status,out=self.finish(p)
  self.assertEqual(status,0,out);self.assertEqual(self.receipt()['exit_code'],0)
  self.assertIn(str(self.out/'home'),(self.out/'command.log').read_text())
  rows=[json.loads(x) for x in (self.out/'samples.jsonl').read_text().splitlines()]
  self.assertTrue(rows);self.assertIn('swap',rows[0]);self.assertIn('vm_stat',rows[0])
 def test_ci_build_gates_remain_enabled(self):
  status,out=self.finish(self.start("import os;assert os.environ.get('CI') == 'true';assert 'COVEN_CAVE_SKIP_BUILD_TYPECHECK' not in os.environ;assert 'COVEN_CAVE_E2E' not in os.environ"))
  self.assertEqual(status,0,out)
 def test_nonzero_retained(self):
  status,_=self.finish(self.start('raise SystemExit(7)'));self.assertNotEqual(status,0);self.assertEqual(self.receipt()['exit_code'],7)
 def test_timeout_retains_samples(self):
  status,_=self.finish(self.start('import time;time.sleep(30)',.4));self.assertNotEqual(status,0)
  r=self.receipt();self.assertEqual(r['stop_reason'],'timeout');self.assertEqual(r['remaining_observed_pids'],[])
  self.assertTrue((self.out/'samples.jsonl').read_text())
 def test_signal_retains_samples(self):
  p=self.start('import time;time.sleep(30)',4);until=time.monotonic()+3
  while not (self.out/'samples.jsonl').exists() and p.poll() is None and time.monotonic()<until:time.sleep(.02)
  if p.poll() is None:p.send_signal(signal.SIGTERM)
  status,_=self.finish(p);self.assertNotEqual(status,0);self.assertEqual(self.receipt()['stop_reason'],'signal:15')
 def test_duplicate_refuses(self):
  self.finish(self.start('print("first")'));self.receipt();before=(self.out/'result.json').read_bytes()
  status,_=self.finish(self.start('print("second")'));self.assertNotEqual(status,0);self.assertEqual(before,(self.out/'result.json').read_bytes())
 def test_sampled_identity_is_never_signal_authority(self):
  real_popen=subprocess.Popen
  child=[]
  def spawn(*args,**kwargs):
   result=real_popen(*args,**kwargs);child.append(result);return result
  def sampled():
   if not child:return {}
   child[0].wait(timeout=3)
   return {child[0].pid:dict(pid=child[0].pid,ppid=0,rss_kib=1,cpu=0,identity='sample',state='S'),
           99999999:dict(pid=99999999,ppid=child[0].pid,rss_kib=1,cpu=0,identity='sample',state='S')}
  # Seed observation while the direct child is live; later samples cannot
  # establish ownership of a reused identity. Signals are intercepted here.
  calls=[0]
  def observations():
   calls[0]+=1
   if calls[0]==1:
    return {child[0].pid:dict(pid=child[0].pid,ppid=0,rss_kib=1,cpu=0,identity='sample',state='S'),
            99999999:dict(pid=99999999,ppid=child[0].pid,rss_kib=1,cpu=0,identity='sample',state='S')}
   return sampled()
  with mock.patch.object(measure.subprocess,'Popen',side_effect=spawn), mock.patch.object(measure,'processes',side_effect=observations), mock.patch.object(measure,'capture',return_value='fixture'), mock.patch.object(measure.os,'kill') as send, contextlib.redirect_stdout(io.StringIO()):
   measure.run([sys.executable,'-c','import time;time.sleep(.1)'],self.out.parent,self.out,2,.05)
  send.assert_not_called()
  self.assertEqual(self.receipt().get('descendant_cleanup'),'unknown')
 def test_fast_detached_child_is_not_claimed_cleaned(self):
  done=self.out.parent/'child-finished'
  childcode="import time,pathlib;time.sleep(.3);pathlib.Path("+repr(str(done))+").write_text('finished')"
  parentcode="import subprocess,sys;subprocess.Popen([sys.executable,'-c',"+repr(childcode)+"],start_new_session=True)"
  # Simulate the real observation gap: the parent and reparented child are
  # absent from every sample. Child is self-bounded; never signal a saved PID.
  with mock.patch.object(measure,'processes',return_value={}), contextlib.redirect_stdout(io.StringIO()):
   status=measure.run([sys.executable,'-c',parentcode],self.out.parent,self.out,2,.05)
  deadline=time.monotonic()+3
  while not done.exists() and time.monotonic()<deadline:time.sleep(.02)
  self.assertTrue(done.exists(),'bounded child did not finish')
  self.assertEqual(status,0)
  self.assertEqual(self.receipt()['remaining_observed_pids'],[])
  self.assertEqual(self.receipt()['descendant_cleanup'],'unknown')
 def test_completed_child_is_not_timed_out_by_slow_sampler(self):
  def slow_capture(command):time.sleep(.15);return 'fixture'
  with mock.patch.object(measure,'processes',return_value={}), mock.patch.object(measure,'capture',side_effect=slow_capture), contextlib.redirect_stdout(io.StringIO()):
   status=measure.run([sys.executable,'-c','pass'],self.out.parent,self.out,.2,.05)
  r=self.receipt()
  self.assertEqual(status,0,r)
  self.assertIsNone(r['stop_reason'])
  self.assertLess(r['command_seconds'],r['seconds'])
 def test_invalid_process_output_is_rejected(self):
  for output in ['', '123 4 5', '123 4 nope 0 Mon Oct 21 04:00:00 2026 S']:
   with self.subTest(output=output), mock.patch.object(measure,'capture',return_value=output):
    with self.assertRaises(ValueError):measure.processes()
 def test_log_hash_has_explicit_snapshot_length(self):
  self.finish(self.start('print("snapshot")'))
  r=self.receipt()
  self.assertEqual(r.get('log_snapshot_bytes'),len((self.out/'command.log').read_bytes()))
  self.assertEqual(r.get('log_finalized'),False)
 def test_deadline_supervision_does_not_wait_for_sampler(self):
  def slow_capture(command):time.sleep(.3);return 'fixture'
  with mock.patch.object(measure,'processes',return_value={}), mock.patch.object(measure,'capture',side_effect=slow_capture), contextlib.redirect_stdout(io.StringIO()):
   status=measure.run([sys.executable,'-c','import time;time.sleep(10)'],self.out.parent,self.out,.15,.05)
  r=self.receipt()
  self.assertNotEqual(status,0)
  self.assertEqual(r['stop_reason'],'timeout')
  self.assertLess(r['command_seconds'],.5)
  self.assertGreater(r['seconds'],.5)
 def test_snapshot_hash_does_not_claim_appended_log(self):
  import hashlib
  self.finish(self.start('print("first")'))
  r=self.receipt();log=self.out/'command.log'
  with log.open('ab') as stream:stream.write(b'later descendant output')
  data=log.read_bytes()
  self.assertGreater(len(data),r['log_snapshot_bytes'])
  self.assertEqual(hashlib.sha256(data[:r['log_snapshot_bytes']]).hexdigest(),r['log_sha256'])
  self.assertNotEqual(hashlib.sha256(data).hexdigest(),r['log_sha256'])
  self.assertFalse(r['log_finalized'])
 def test_late_signal_is_not_success(self):
  fired=[]
  def capture_after_exit(command):
   time.sleep(.1)
   if not fired:
    fired.append(True);signal.getsignal(signal.SIGTERM)(signal.SIGTERM,None)
   return 'fixture'
  with mock.patch.object(measure,'processes',return_value={}), mock.patch.object(measure,'capture',side_effect=capture_after_exit), contextlib.redirect_stdout(io.StringIO()):
   status=measure.run([sys.executable,'-c','pass'],self.out.parent,self.out,2,.05)
  self.assertNotEqual(status,0)
  self.assertIn(15,self.receipt()['received_signals'])
 def test_supervisor_start_failure_stops_owned_child(self):
  real_popen=subprocess.Popen;children=[];failure=None
  previous=signal.getsignal(signal.SIGTERM)
  def spawn(*args,**kwargs):
   child=real_popen(*args,**kwargs);children.append(child);return child
  try:
   with mock.patch.object(measure.subprocess,'Popen',side_effect=spawn), mock.patch.object(measure.threading.Thread,'start',side_effect=RuntimeError('fixture thread limit')), mock.patch.object(measure,'processes',return_value={}), contextlib.redirect_stdout(io.StringIO()):
    try:status=measure.run([sys.executable,'-c','import time;time.sleep(10)'],self.out.parent,self.out,2,.05)
    except Exception as error:failure=error
   self.assertIsNone(failure)
   self.assertNotEqual(status,0)
   self.assertIsNotNone(children[0].poll())
   self.assertIn('thread limit',self.receipt()['error'])
   self.assertEqual(signal.getsignal(signal.SIGTERM),previous)
  finally:
   for child in children:
    if child.poll() is None:child.terminate();child.wait(timeout=3)
   signal.signal(signal.SIGTERM,previous)
 def test_sampler_failure_stops_direct_child_and_keeps_unknown_cleanup(self):
  with mock.patch.object(measure,'processes',side_effect=RuntimeError('fixture sampler unavailable')), contextlib.redirect_stdout(io.StringIO()):
   status=measure.run([sys.executable,'-c','import time;time.sleep(30)'],self.out.parent,self.out,2,.05)
  self.assertNotEqual(status,0);r=self.receipt()
  self.assertIsNotNone(r['exit_code'],'direct child survives sampler failure')
  self.assertIsNone(r['remaining_observed_pids'],'must not invent descendant cleanup proof')
  self.assertIn('cleanup_error',r)
if __name__=='__main__':unittest.main(verbosity=2)
