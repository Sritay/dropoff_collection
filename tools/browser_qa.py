"""Run browser checks using the installed Firefox and its Marionette protocol.

No browser drivers or Python packages are installed. Use Slurm on Barkla.
Protocol: https://firefox-source-docs.mozilla.org/remote/marionette/Protocol.html
"""
import base64
import json
import os
import socket
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    assert os.environ.get('SLURM_JOB_ID'), 'Use Slurm for browser QA.'
    with tempfile.TemporaryDirectory(prefix='potency-browser-') as temp:
        profile = Path(temp)
        port = 28280
        (profile/'user.js').write_text(f'user_pref("marionette.port", {port});\nuser_pref("browser.shell.checkDefaultBrowser", false);\n')
        env = {**os.environ, 'XDG_RUNTIME_DIR': temp, 'GSETTINGS_BACKEND':'memory', 'MOZ_CRASHREPORTER_DISABLE':'1'}
        with (ROOT/'browser-qa.log').open('w') as log:
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
                        if not char: raise RuntimeError('Marionette disconnected')
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
                audit = js('''
                  let count=0,failures=[];
                  for(const p of window.CELL_POTENCY_DATA.papers){
                    for(const tab of ['pairs','reasons','assays','provenance']){
                      location.hash='paper/'+p.id+'/'+tab;
                      window.dispatchEvent(new HashChangeEvent('hashchange'));
                      let root=document.querySelector('#main');
                      if(!root.querySelector('h1')||root.querySelector('h1').textContent!==p.title) failures.push(p.id+'/'+tab);
                      if(/\\bundefined\\b|\\bNaN\\b/.test(root.textContent)) failures.push('invalid text '+p.id+'/'+tab);
                      count++;
                    }
                  }
                  return {count,failures};
                ''')
                assert audit['count'] == 252 and not audit['failures'], audit
                results.append('All 252 paper section routes render without undefined/NaN text')
                route('about')
                assert js('return document.querySelector("#main").textContent.toLowerCase().includes("paper-local");') is False
                results.append('Public wording no longer uses paper-local terminology')
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
                assert js('return window.qaErrors;') == []
                results.append('Mobile paper list and paper record fit viewport; compound dialog renders')
                report = {'status':'passed','checks':results,'slurm_job_id':os.environ['SLURM_JOB_ID'],'browser':'Installed Firefox ESR','javascript_errors':[]}
                (ROOT/'validation-browser.json').write_text(json.dumps(report,indent=2)+'\n')
                print(json.dumps(report,indent=2))
                command('Marionette:Quit', {'flags':['eForceQuit']})
            finally:
                if sock: sock.close()
                if process.poll() is None:
                    process.terminate()
                try: process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill();process.wait()


if __name__ == '__main__':
    main()
