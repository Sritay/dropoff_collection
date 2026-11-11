"""Run browser checks using the installed Firefox and its Marionette protocol.

No browser drivers or Python packages are installed. Use Slurm on Barkla.
Protocol: https://firefox-source-docs.mozilla.org/remote/marionette/Protocol.html
"""
import base64
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    assert os.environ.get('SLURM_JOB_ID'), 'Use Slurm for browser QA.'
    phase = os.environ.get('CELL_SITE_QA_PHASE')
    if not phase:
        for part in ['routes', 'flow', 'names', 'pdb', 'mobile-name']:
            print('Starting fresh browser session:', part, flush=True)
            subprocess.run([sys.executable, str(Path(__file__).resolve())],
                           env={**os.environ, 'CELL_SITE_QA_PHASE': part}, check=True)
        reports = [json.loads((ROOT / f'validation-browser-{part}.json').read_text()) for part in ['routes', 'flow', 'names', 'pdb', 'mobile-name']]
        report = {'status': 'passed', 'checks': list(dict.fromkeys(c for r in reports for c in r['checks'])),
                  'slurm_job_id': os.environ['SLURM_JOB_ID'], 'browser': 'Installed Firefox ESR',
                  'javascript_errors': [], 'isolated_sessions': ['routes', 'flow', 'names', 'pdb', 'mobile-name']}
        (ROOT/'validation-browser.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
        return
    with tempfile.TemporaryDirectory(prefix='potency-browser-') as temp:
        profile = Path(temp)
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        (profile/'user.js').write_text(f'user_pref("marionette.port", {port});\nuser_pref("browser.shell.checkDefaultBrowser", false);\n')
        env = {**os.environ, 'XDG_RUNTIME_DIR': temp, 'GSETTINGS_BACKEND':'memory', 'MOZ_CRASHREPORTER_DISABLE':'1'}
        with (ROOT/f'browser-qa-{phase}.log').open('w') as log:
            process = subprocess.Popen(['/usr/bin/firefox','--headless','--no-remote','--marionette','--profile',temp], stdout=log, stderr=log, env=env)
            sock = None
            try:
                for _ in range(100):
                    try:
                        sock = socket.create_connection(('127.0.0.1',port), timeout=1)
                        break
                    except OSError:
                        if process.poll() is not None:
                            raise RuntimeError('Firefox exited; see browser-qa.log')
                        time.sleep(.2)
                assert sock, 'Marionette did not start'
                sock.settimeout(45)
                stream = sock.makefile('rb')
                def receive():
                    size = bytearray()
                    while True:
                        char = stream.read(1)
                        if char == b':': break
                        if not char:
                            print('Firefox process return code:', process.poll(), flush=True)
                            raise RuntimeError('Marionette disconnected')
                        size.extend(char)
                    return json.loads(stream.read(int(size)))
                receive()
                sequence = 0
                def command(name, params=None):
                    nonlocal sequence
                    sequence += 1
                    payload = json.dumps([0,sequence,name,params or {}]).encode()
                    sock.sendall(str(len(payload)).encode()+b':'+payload)
                    result = receive()
                    assert result[0:2] == [1,sequence], result
                    if result[2]: raise RuntimeError(result[2])
                    return result[3]
                def js(script):
                    result = command('WebDriver:ExecuteScript', {'script':script, 'args':[], 'newSandbox':False, 'sandbox':None, 'line':0, 'filename':'browser_qa.py'})
                    return result.get('value',result) if isinstance(result,dict) else result
                def route(hash):
                    js(f'window.location.hash={json.dumps(hash)}; window.dispatchEvent(new HashChangeEvent("hashchange"));')
                def screenshot(file):
                    print('Screenshot:', file, 'Firefox running:', process.poll() is None, flush=True)
                    if os.environ.get('CELL_SITE_QA_SCREENSHOTS') == 'none':
                        return
                    if os.environ.get('CELL_SITE_QA_SCREENSHOTS') == 'names' and file not in {'preview-name-conflict.png', 'preview-mobile-paper-name.png'}:
                        return
                    time.sleep(.4)  # Let resize, hash events and painting settle before capture.
                    result = command('WebDriver:TakeScreenshot', {'id':None, 'full':False, 'hash':False, 'scroll':False})
                    value = result.get('value') if isinstance(result,dict) else result
                    (ROOT/file).write_bytes(base64.b64decode(value))
                results = []
                command('WebDriver:NewSession', {'capabilities':{'alwaysMatch':{'acceptInsecureCerts':True}}})
                command('WebDriver:SetWindowRect', {'width':1440,'height':1100})
                command('WebDriver:Navigate', {'url':(ROOT/'dist/index.html').as_uri()})
                assert js('return document.querySelector("#result-count").textContent;') == '63'
                js('window.qaErrors=[];window.addEventListener("error",e=>window.qaErrors.push(e.message));')
                if phase == 'mobile-name':
                    command('WebDriver:SetWindowRect', {'width':390,'height':844})
                    qian = js('return window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Qian2010").id;')
                    route('paper/'+qian+'/compounds')
                    js('Array.from(document.querySelectorAll("button[data-compound]")).find(e=>e.dataset.compound==="1").click();')
                    overflow = js('let d=document.querySelector("#detail"),r=d.getBoundingClientRect();return {scroll:d.scrollWidth,width:d.clientWidth,left:r.left,right:r.right,bad:[...d.querySelectorAll("*")].filter(x=>x.scrollWidth>x.clientWidth+1&&x.clientWidth>0).slice(0,15).map(x=>({tag:x.tagName,cls:x.className&&String(x.className),text:(x.textContent||"").slice(0,80),width:x.clientWidth,scroll:x.scrollWidth}))};')
                    assert overflow['scroll'] <= overflow['width'], overflow
                    screenshot('preview-mobile-paper-name.png')
                    assert js('return window.qaErrors;') == []
                    (ROOT/'validation-browser-mobile-name.json').write_text(json.dumps({'status':'passed','checks':['Mobile long-name structure card fits viewport'],'slurm_job_id':os.environ['SLURM_JOB_ID'],'javascript_errors':[]},indent=2)+'\n')
                    return
                if phase == 'pdb':
                    baell = js('return window.CELL_POTENCY_DATA.papers.find(p=>p.folder.startsWith("Baell et al.")).id;')
                    route('paper/'+baell+'/compounds')
                    for cid, entry, ligand, page in [('comp_wm8014','6BA2','7KM','2'),('comp_wm1119','6CT2','FCV','4')]:
                        js(f'document.querySelector("button[data-compound={cid}]").click();')
                        evidence = js('let d=document.querySelector("#detail");return {text:d.textContent,drawings:d.querySelectorAll(".chemical-drawing svg").length,links:[...d.querySelectorAll(".smiles-card a")].map(a=>a.href)};')
                        assert 'PDB ligand candidate' in evidence['text'] and 'review needed' in evidence['text'].lower(), evidence
                        assert 'PDF p. 5' in evidence['text'] and 'p. '+page in evidence['text'], evidence
                        assert evidence['drawings'] == 1 and any('/structure/'+entry in u for u in evidence['links'])
                        assert any('/ligand/'+ligand in u for u in evidence['links'])
                        if cid == 'comp_wm8014': screenshot('preview-pdb-ligand.png')
                        js('document.querySelector("[data-action=close]").click();')
                    route('papers')
                    js('document.querySelector("[data-action=reset]").click();let s=document.querySelector("[data-filter=smiles]");s.value="pdb_candidate";s.dispatchEvent(new Event("change",{bubbles:true}));')
                    assert js('return document.querySelector("#result-count").textContent;') == '1'
                    assert js('return window.qaErrors;') == []
                    report={'status':'passed','checks':['Two PDB ligand candidates show distinct accession/CCD links, source pages, drawings and review warnings; filter finds one paper'],
                            'slurm_job_id':os.environ['SLURM_JOB_ID'],'browser':'Installed Firefox ESR','javascript_errors':[]}
                    (ROOT/'validation-browser-pdb.json').write_text(json.dumps(report,indent=2)+'\n')
                    print(json.dumps(report,indent=2))
                    return
                screenshot('preview-desktop.png')
                results.append('63 papers rendered in Firefox')
                js('let s=document.querySelector("#search");s.value="JBJ-07-149";s.dispatchEvent(new Event("input",{bubbles:true}));')
                assert js('return document.querySelector("#result-count").textContent;') == '1'
                results.append('Compound search finds its paper')
                route('pairs')
                js('document.querySelector("[data-action=reset]").click();')
                assert js('return document.querySelector("#result-count").textContent;') == '979'
                js('let s=document.querySelector("[data-filter=cause]");s.value="permeability";s.dispatchEvent(new Event("change",{bubbles:true}));')
                js('let s=document.querySelector("[data-filter=linked]");s.checked=true;s.dispatchEvent(new Event("change",{bubbles:true}));')
                result_count = js('return document.querySelector("#result-count").textContent;')
                assert result_count == '280', result_count
                results.append('Global mechanism filter reconciles to 280 permeability pairs')
                js('document.querySelector("[data-pair]").click();')
                assert js('return document.querySelector("#detail").open;') is True
                assert js('return document.querySelectorAll("#detail .comparison>div").length;') == 2
                js('document.querySelector("[data-action=close]").click();')
                results.append('Compound dialog opens with both measurements and closes')
                route('papers')
                # Synchronous dispatch makes each route test independent of event-loop timing.
                audit = {'count': 0, 'failures': []}
                paper_ids = js('return window.CELL_POTENCY_DATA.papers.map(p=>p.id);')
                # Yield between small route batches so detached table DOM can be
                # collected rather than retaining 315 page renders in one task.
                for start in (range(0, len(paper_ids), 3) if phase == 'routes' else []):
                    batch = json.dumps(paper_ids[start:start+3])
                    print('Checking route batch', start, batch, flush=True)
                    result = js('const paperIds=' + batch + ';' + '''
                  let count=0,failures=[];
                  for(const p of window.CELL_POTENCY_DATA.papers.filter(p=>paperIds.includes(p.id))){
                    for(const tab of ['pairs','compounds','reasons','assays','sources']){
                      location.hash='paper/'+p.id+'/'+tab;
                      window.dispatchEvent(new HashChangeEvent('hashchange'));
                      let root=document.querySelector('#main');
                      if(!root.querySelector('h1')||root.querySelector('h1').textContent!==p.title) failures.push(p.id+'/'+tab);
                      if(/\\bundefined\\b|\\bNaN\\b/.test(root.textContent)) failures.push('invalid text '+p.id+'/'+tab);
                      if(/Gemini|SHA256|AI reviewed|AI-assisted PDF|Review method|Original extraction category|Human review is still needed/.test(root.textContent)) failures.push('internal details '+p.id+'/'+tab);
                      count++;
                    }
                  }
                  return {count,failures};
                ''')
                    audit['count'] += result['count']
                    audit['failures'].extend(result['failures'])
                if phase == 'routes':
                    assert audit['count'] == 315 and not audit['failures'], audit
                    results.append('All 315 paper section routes render without undefined/NaN text')
                    report = {'status':'passed','checks':results,'slurm_job_id':os.environ['SLURM_JOB_ID'],
                              'browser':'Installed Firefox ESR','javascript_errors':js('return window.qaErrors;')}
                    assert not report['javascript_errors']
                    (ROOT/'validation-browser-routes.json').write_text(json.dumps(report,indent=2)+'\n')
                    return
                if phase == 'names':
                    # A paper name yields an unverified candidate, with no implied
                    # identity when the label was not actually near that name.
                    qian = js('return window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Qian2010").id;')
                    route('paper/'+qian+'/compounds')
                    js('''let p=window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Qian2010"),c=p.cm["1"];
                      let basis=JSON.stringify({response:p.response_sha256,pdf:p.source_sha256,compound:c.compound_id,
                        reference:c.structure_review?.chembl&&[c.structure_review.chembl.molecule_id,c.structure_review.chembl.smiles],
                        provided:c.structure_review?.provided?.smiles||null,candidates:c.structure_review.agent_runs.map(r=>[r.run_id,r.candidates.map(a=>a.smiles)])});
                      localStorage.setItem(`cellpotency-smiles-review:${p.id}:${c.compound_id}`,JSON.stringify({basis,note:'Older paper note',structure_verdicts:{}}));''')
                    js('Array.from(document.querySelectorAll("button[data-compound]")).find(e=>e.dataset.compound==="1").click();')
                    assert js('return document.querySelector("#detail").textContent.includes("Paper-name / OPSIN candidate");') is True
                    assert js('return document.querySelector("#detail").textContent.includes("Paper number not confirmed");') is True
                    assert js('return document.querySelector("#detail").textContent.includes("PDF p. 1");') is True
                    assert js('return document.querySelectorAll("#detail .chemical-drawing svg").length;') >= 1
                    old_note = js('let p=window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Qian2010"),d=document.querySelector("#detail"),s=localStorage.getItem(`cellpotency-smiles-review:${p.id}:1`);return {warning:d.textContent.includes("verdict is inactive"),note:d.textContent.includes("Older paper note"),stored:!!s,current:d.querySelector("[data-review-note]").value};')
                    assert old_note['warning'] and old_note['note'], old_note
                    js('document.querySelector("[data-structure-verdict]").value="matches_paper";document.querySelector("[data-review-note]").value="New source review";document.querySelector("[data-save-review]").click();')
                    assert js('let p=window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Qian2010");return JSON.parse(localStorage.getItem(`cellpotency-smiles-review:${p.id}:1`)).history[0].note;') == 'Older paper note'
                    js('document.querySelector("[data-action=close]").click();Array.from(document.querySelectorAll("button[data-compound]")).find(e=>e.dataset.compound==="1").click();')
                    assert js('return document.querySelector("[data-structure-verdict]").value;') == 'matches_paper'
                    js('document.querySelector("[data-action=close]").click();let p=window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Qian2010");p.cm["1"].structure_review.paper_name_candidates[0].mentions[0].pdf_page++;Array.from(document.querySelectorAll("button[data-compound]")).find(e=>e.dataset.compound==="1").click();')
                    assert js('return document.querySelector("[data-structure-verdict]").value;') == 'unreviewed'
                    assert js('return document.querySelector("#detail").textContent.includes("verdict is inactive");') is True
                    js('document.querySelector("[data-action=close]").click();let p=window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Qian2010");p.cm["1"].structure_review.paper_name_candidates[0].mentions[0].pdf_page--;')
                    gonzalez = js('return window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="c3_Gonzalez2023").id;')
                    route('paper/'+gonzalez+'/compounds')
                    js('document.querySelector("button[data-compound=c19]").click();')
                    assert js('return document.querySelector("#detail").textContent.includes("Conflicting names or structures");') is True
                    assert js('return document.querySelectorAll("#detail .chemical-drawing svg").length;') == 2
                    screenshot('preview-name-conflict.png')
                    js('document.querySelector("[data-action=close]").click();')
                    route('papers')
                    assert js('return document.querySelector(".smiles-coverage").textContent.includes("292 / 605");') is True
                    js('document.querySelector("[data-action=reset]").click();let s=document.querySelector("[data-filter=smiles]");s.value="name_candidate";s.dispatchEvent(new Event("change",{bubbles:true}));')
                    assert js('return +document.querySelector("#result-count").textContent;') == js('return window.CELL_POTENCY_DATA.papers.filter(p=>p.compounds.some(c=>c.structure_review.paper_name_candidates.length)).length;')
                    results.append('Paper-name candidate sources, identity uncertainty, conflicting graphs, filter and review invalidation work')
                    assert js('return window.qaErrors;') == []
                    report = {'status':'passed','checks':results,'slurm_job_id':os.environ['SLURM_JOB_ID'],'browser':'Installed Firefox ESR','javascript_errors':[]}
                    (ROOT/'validation-browser-names.json').write_text(json.dumps(report,indent=2)+'\n')
                    print(json.dumps(report,indent=2))
                    return
                route('papers')
                js('document.querySelector("[data-action=reset]").click();let s=document.querySelector("[data-filter=smiles]");s.value="candidate";s.dispatchEvent(new Event("change",{bubbles:true}));')
                assert js('return document.querySelector("#result-count").textContent;') == '4'
                results.append('SMILES candidate filter finds the four control papers')
                ndubaku = js('return window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Ndubaku2015").id;')
                route('paper/'+ndubaku+'/compounds')
                assert js('return document.querySelectorAll("[data-compound]").length;') > 0
                js('''let p=window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Ndubaku2015"),c=p.cm.cmp_4;
                  let basis=JSON.stringify({response:p.response_sha256,pdf:p.source_sha256,compound:c.compound_id,
                    reference:c.structure_review?.chembl&&[c.structure_review.chembl.molecule_id,c.structure_review.chembl.smiles],
                    provided:c.structure_review?.provided?.smiles||null,candidates:c.structure_review.agent_runs.filter(r=>r.run_id!=="smiles_controls_name_followup_2026-11-10").map(r=>[r.run_id,r.candidates.map(a=>a.smiles)])});
                  localStorage.setItem(`cellpotency-smiles-review:${p.id}:${c.compound_id}`,JSON.stringify({basis,note:'Previously saved note',structure_verdicts:{chembl:'matches_paper'}}));''')
                js('document.querySelector("[data-compound=cmp_4]").click();')
                assert js('return document.querySelector("[data-review-note]").value;') == 'Previously saved note'
                assert js('return document.querySelector("[data-structure-verdict=chembl]").value;') == 'matches_paper'
                # A newly prepared run with no candidates must not invalidate an
                # existing review of otherwise identical structures.
                js('document.querySelector("[data-action=close]").click();let p=window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Ndubaku2015");p.cm.cmp_4.structure_review.agent_runs.push({run_id:"smiles_controls_name_followup_2026-11-10",status:"pending",candidates:[]});document.querySelector("[data-compound=cmp_4]").click();')
                assert js('return document.querySelector("[data-review-note]").value;') == 'Previously saved note'
                js('document.querySelector("[data-action=close]").click();let p=window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Ndubaku2015");p.cm.cmp_4.structure_review.agent_runs.pop();document.querySelector("[data-compound=cmp_4]").click();')
                assert js('return document.querySelectorAll("#detail .chemical-drawing svg").length;') == 2
                assert js('return document.querySelector("#detail").textContent.includes("Connectivity differs from ChEMBL");') is True
                assert js('return document.querySelectorAll("#detail .smiles-string textarea").length;') == 2
                assert js('return document.querySelector("#detail").textContent.includes("further extraction is pending");') == js('let p=window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Ndubaku2015");return p.cm.cmp_4.structure_review.agent_runs.some(r=>r.status==="pending");')
                screenshot('preview-smiles.png')
                js('document.querySelector("[data-structure-verdict=chembl]").value="matches_paper";document.querySelector("[data-review-note]").value="Synthetic browser QA note";document.querySelector("[data-save-review]").click();')
                assert js('return document.querySelector(".review-status").textContent.includes("Saved in this browser only");') is True
                js('document.querySelector("[data-action=close]").click();document.querySelector("[data-compound=cmp_4]").click();')
                assert js('return document.querySelector("[data-review-note]").value;') == 'Synthetic browser QA note'
                assert js('return document.querySelector("[data-structure-verdict=chembl]").value;') == 'matches_paper'
                # Changing source data invalidates the earlier verdict rather than silently reusing it.
                js('document.querySelector("[data-action=close]").click();let p=window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Ndubaku2015");p.response_sha256+="changed";document.querySelector("[data-compound=cmp_4]").click();')
                assert js('return document.querySelector("[data-structure-verdict=chembl]").value;') == 'unreviewed'
                assert js('return document.querySelector("#detail").textContent.includes("verdict is inactive");') is True
                js('document.querySelector("[data-action=close]").click();let p=window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="Ndubaku2015");p.response_sha256=p.response_sha256.replace(/changed$/,"");')
                results.append('Local reference/candidate SVGs render; mismatch remains visible; browser-local verdict persists and invalidates on source change')
                route('about')
                assert js('return !!document.querySelector("#result-count");') is True
                assert js("return document.querySelectorAll('[href*=about]').length;") == 0
                results.append('Removed About route falls back to papers; navigation has no About link')
                association = js('return window.CELL_POTENCY_DATA.papers.find(p=>p.folder==="alvaromartins2026").id;')
                route('paper/'+association)
                assert js('return document.querySelectorAll(".ratio-reason").length;') == 16
                assert js('return [...document.querySelectorAll(".ratio-reason")].every(e=>e.textContent.includes("association constant"));') is True
                results.append('Uncalculated ratios display a specific reason in the pair table')
                paper = js('return window.CELL_POTENCY_DATA.papers.find(p=>p.compounds.some(c=>[c.name,c.label,...(c.aliases||[])].includes("JBJ-07-149"))).id;')
                route('paper/'+paper)
                screenshot('preview-paper.png')
                js('document.querySelector("[data-pair]").click();')
                screenshot('preview-compound.png')
                js('document.querySelector("[data-action=close]").click();')
                command('WebDriver:SetWindowRect', {'width':390,'height':844})
                time.sleep(.4)
                route('papers')
                js('document.querySelector("[data-action=reset]").click();')
                screenshot('preview-mobile.png')
                overflow = js('return {scroll:document.documentElement.scrollWidth,width:window.innerWidth};')
                assert overflow['scroll'] <= overflow['width'], overflow
                assert overflow['width'] <= 450, overflow  # Firefox desktop enforces a minimum outer width.
                route('paper/'+paper)
                overflow = js('return {scroll:document.documentElement.scrollWidth,width:window.innerWidth};')
                assert overflow['scroll'] <= overflow['width'], overflow
                js('document.querySelector("[data-pair]").click();')
                screenshot('preview-mobile-compound.png')
                js('document.querySelector("[data-action=close]").click();')
                route('paper/'+ndubaku+'/compounds')
                js('document.querySelector("[data-compound=cmp_4]").click();')
                screenshot('preview-mobile-smiles.png')
                assert js('return document.querySelectorAll("#detail .chemical-drawing svg").length;') == 2
                js('document.querySelector("[data-action=close]").click();')
                assert js('return window.qaErrors;') == []
                results.append('Mobile paper list and paper record fit viewport; compound dialog renders')
                report = {'status':'passed','checks':results,'slurm_job_id':os.environ['SLURM_JOB_ID'],'browser':'Installed Firefox ESR','javascript_errors':[]}
                (ROOT/'validation-browser-flow.json').write_text(json.dumps(report,indent=2)+'\n')
                print(json.dumps(report,indent=2))
            finally:
                if sock: sock.close()
                if process.poll() is None:
                    process.terminate()
                try: process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill();process.wait()


if __name__ == '__main__':
    main()
