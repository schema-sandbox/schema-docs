import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink, stat } from 'node:fs/promises';
import { cleanRealMaterialTestArtifacts as clean } from '../src/cli/clean-real-material-artifacts.js';
import { acquireEvaluationLock } from '../src/cli/realMaterialRun.js';

test('cleaner protects baselines, links, live/unknown locks and resume; deletes only a selected owned run', async () => {
  const before=process.cwd(), scratch=await mkdtemp(path.join(os.tmpdir(),'schema-r4-clean-'));
  process.chdir(scratch);
  const root=path.join(scratch,'.ai-doc-exchange/real-material-final'), runs=path.join(root,'real-material-artifacts');
  const owned=async(id,retained=false)=>{
    const folder=path.join(runs,id); await mkdir(folder,{recursive:true});
    await writeFile(path.join(folder,'.run-owner.json'),JSON.stringify({schema:'schema-docs.real-material-run',runId:id,retained}));
    await writeFile(path.join(folder,'sentinel'),'keep'); return folder;
  };
  try {
    const history=await owned('baseline',true), current=await owned('scratch');
    await assert.rejects(clean(root),/explicit run ID/);
    await assert.rejects(clean(root,{runId:'baseline',apply:true}),/retained/);
    assert.equal((await clean(root,{runId:'scratch',mode:'resume',apply:true})).retained,true);
    assert.equal((await clean(root,{runId:'scratch'})).dryRun,true);
    assert.equal(await readFile(path.join(current,'sentinel'),'utf8'),'keep');
    const lock=await acquireEvaluationLock(root,{runId:'active'});
    await assert.rejects(clean(root,{runId:'scratch',apply:true}),/owns/); lock.release();
    const lockPath=path.join(root,'.real-material-evaluation.lock');
    await writeFile(lockPath,'{"pid":null}');
    await assert.rejects(clean(root,{runId:'scratch',apply:true}),/Unknown/); await unlink(lockPath);
    const outside=path.join(scratch,'outside'); await mkdir(outside); await writeFile(path.join(outside,'sentinel'),'outside');
    await symlink(outside,path.join(runs,'linked'),'junction');
    await assert.rejects(clean(root,{runId:'linked',apply:true}),/linked/);
    await unlink(path.join(runs,'linked'));
    await symlink(outside,path.join(current,'inside-link'),'junction');
    const result=await clean(root,{runId:'scratch',apply:true});
    assert.deepEqual(result.removed,[current]);
    assert.equal(await readFile(path.join(outside,'sentinel'),'utf8'),'outside');
    assert.equal(await readFile(path.join(history,'sentinel'),'utf8'),'keep');
    // Root and parent junctions must be rejected before reading run ownership.
    await rm(runs,{recursive:true}); await symlink(outside,runs,'junction');
    await assert.rejects(clean(root,{runId:'scratch',apply:true}),/linked/); await unlink(runs);
    await rm(root,{recursive:true}); await symlink(outside,root,'junction');
    await assert.rejects(clean(root,{runId:'scratch',apply:true}),/linked/); await unlink(root);
    await stat(outside);
  } finally { process.chdir(before); await rm(scratch,{recursive:true,force:true}); }
});
