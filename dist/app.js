/* Static, dependency-free literature explorer. All manuscript text is escaped. */
'use strict';
(() => {
  const D = window.CELL_POTENCY_DATA;
  const main = document.querySelector('#main');
  if (!D) { main.innerHTML = '<p class="empty">The dataset could not be loaded. Keep data.js beside index.html.</p>'; return; }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const unique = a => [...new Set(a.filter(Boolean))];
  const norm = s => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const fmt = n => Number(n).toLocaleString('en', {maximumSignificantDigits:4});
  const name = c => c?.name || c?.label || c?.compound_id || 'Unknown compound';
  const shortCauses = {physicochemical_defects:'Physicochemical properties',multitarget_binding:'Multitarget binding',molecular_chameleonicity:'Molecular chameleonicity',metabolism_efflux:'Metabolism / efflux',intracellular_competition:'Intracellular competition',target_conformation_ptm:'Target conformation / modification',target_localization_oligomerization:'Target localization / oligomerization',permeability:'Permeability',other_reasons:'Other reasons',colloidal_aggregation:'Colloidal aggregation',autofluorescent_interference:'Autofluorescence',ki_ic50_misapplication:'Ki / IC50 interpretation'};
  const cause = c => shortCauses[c.classification.cause_id] || c.category;
  const eligible = c => ['supported','proposed'].includes(c.classification.assertion_status);
  const doiLink = p => p.doi ? `<a class="doi" target="_blank" rel="noopener" href="https://doi.org/${encodeURIComponent(p.doi)}">${esc(p.doi)} ↗</a>` : '<span class="muted">DOI not reported</span>';
  const badge = (s, cls='') => `<span class="badge ${cls}">${esc(s)}</span>`;
  const candidates = c => (c.structure_review?.agent_runs||[]).flatMap(r=>r.candidates);
  function structureBadges(c) {
    const s=c?.structure_review||{};
    let html=s.has_smiles?badge('Has SMILES','green'):badge('No SMILES yet');
    if(s.chembl)html+=badge('ChEMBL reference');
    if(candidates(c).length)html+=badge('Agent candidate · review pending','amber');
    if(s.paper_name_candidates?.length)html+=badge('Paper-name candidate · review needed','amber');
    if(s.paper_name_candidates?.some(a=>a.identity_unconfirmed))html+=badge('Paper number unconfirmed','amber');
    if(s.paper_name_candidates?.some(a=>a.different_name_graphs))html+=badge('Paper-name candidates conflict','red');
    if(candidates(c).some(a=>a.comparison&&!a.comparison.exact_match))html+=badge('Differs from ChEMBL','red');
    if(s.chembl?.review_flags.length)html+=badge('Reference mapping warning','amber');
    if(s.chembl?.graph.review_flags.includes('unspecified_stereochemistry'))html+=badge('Reference stereo unspecified','amber');
    return html;
  }
  function compoundTable(p,compounds) {
    return `<div class="table-scroll"><table class="compound-table"><thead><tr><th>Compound</th><th>Structure availability</th><th>Paper structure sources</th><th></th></tr></thead><tbody>${compounds.map(c=>`<tr><td><button class="compound-button" data-compound="${esc(c.compound_id)}" data-paper="${p.id}">${esc(name(c))}</button><span class="sub">Paper label: ${esc(c.label)}</span></td><td>${structureBadges(c)}</td><td>${sources(p,c.structure_source_ids)||'<span class="muted">No structure page recorded</span>'}</td><td><button class="detail-button" data-compound="${esc(c.compound_id)}" data-paper="${p.id}" aria-label="SMILES for ${esc(name(c))}">Compare →</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  const reviewMemory = new Map();
  const reviewKey = (p,c) => `cellpotency-smiles-review:${p.id}:${c.compound_id}`;
  const reviewBasis = (p,c) => JSON.stringify({response:p.response_sha256,pdf:p.source_sha256,compound:c.compound_id,
    reference:c.structure_review?.chembl&&[c.structure_review.chembl.molecule_id,c.structure_review.chembl.smiles],
    provided:c.structure_review?.provided?.smiles||null,
    candidates:(c.structure_review?.agent_runs||[]).filter(r=>r.run_id!=='smiles_controls_name_followup_2026-11-10'||r.candidates.length).map(r=>[r.run_id,r.candidates.map(a=>a.smiles)]),
    ...(c.structure_review?.paper_name_candidates?.length?{paper_names:c.structure_review.paper_name_candidates.map(a=>[a.smiles,a.review_flags,a.mentions.map(m=>[m.name,m.file_name,m.pdf_page,m.label_near_name,m.source])])}:{})});
  function storedReview(p,c) {try{return reviewMemory.get(reviewKey(p,c))||JSON.parse(localStorage.getItem(reviewKey(p,c))||'null');}catch{return null;}}
  function currentReview(p,c) {const r=storedReview(p,c);return r?.basis===reviewBasis(p,c)?r:null;}
  function verdictControl(p,c,key) {
    const value=currentReview(p,c)?.structure_verdicts?.[key]||'unreviewed';
    return `<label class="structure-verdict">Your check of this SMILES against the paper<select data-structure-verdict="${esc(key)}">${[['unreviewed','Not reviewed'],['matches_paper','Matches paper drawing'],['differs_from_paper','Differs from paper drawing'],['uncertain','Uncertain']].map(([v,l])=>`<option value="${v}" ${value===v?'selected':''}>${l}</option>`).join('')}</select></label>`;
  }
  function structureCard(p,c,title,s,extra,key) {
    const g=s.graph||{},drawing=D.structure_drawings?.[g.drawing_key];
    return `<article class="smiles-card"><h4>${esc(title)}</h4>${extra||''}${drawing?`<div class="chemical-drawing" role="img" aria-label="Structure drawn from ${esc(title)} SMILES">${drawing}</div>`:'<p class="muted">Structure drawing unavailable.</p>'}<label class="smiles-string">SMILES<textarea readonly rows="3">${esc(s.smiles)}</textarea></label><button class="button secondary copy-smiles" data-copy-smiles>Copy SMILES</button>${g.formula?`<span class="sub">Formula: ${esc(g.formula)}</span>`:''}${g.review_flags?.length?`<p class="structure-warning">Graph limitations: ${esc(g.review_flags.map(f=>f.replaceAll('_',' ')).join('; '))}.</p>`:''}${verdictControl(p,c,key)}</article>`;
  }
  function structurePanel(p,c) {
    const s=c.structure_review||{},r=currentReview(p,c),old=storedReview(p,c);
    let cards='';
    if(s.chembl){const ref=s.chembl;
      const url=`https://www.ebi.ac.uk/chembl/explore/compound/${encodeURIComponent(ref.molecule_id)}`;
      cards+=structureCard(p,c,'ChEMBL reference',ref,`<p><a href="${url}" target="_blank" rel="noopener">${esc(ref.molecule_id)} · open ChEMBL ↗</a></p><p class="muted">Database assignment; confirm the paper label, attachment positions and stereochemistry.</p>${ref.review_flags.length?`<p class="structure-warning"><b>Mapping warnings:</b> ${esc(ref.review_flags.map(f=>f.replaceAll('_',' ')).join('; '))}.</p>`:''}`,'chembl');
    }
    if(s.provided)cards+=structureCard(p,c,'Previously supplied SMILES',s.provided,'<p class="muted">Supplied structure; compare with the paper.</p>','provided');
    for(const a of s.paper_name_candidates||[]){
      const warning=(a.identity_unconfirmed?'<p class="structure-warning"><b>Paper number not confirmed:</b> no compound label was found near this name. Check the original paper before assigning this graph.</p>':'')+
        (a.different_name_graphs?'<p class="structure-warning"><b>Conflicting names or structures:</b> other names associated with this compound produced a different graph. Check every source before choosing.</p>':'')+
        (a.review_flags.length?`<p class="structure-warning">Source and graph flags: ${esc(a.review_flags.map(f=>f.replaceAll('_',' ')).join('; '))}.</p>`:'');
      const names=a.mentions.map(m=>`<li><span class="paper-chemical-name">${esc(m.name)}</span><br><span class="source-ref">${esc(m.file_name)} · PDF p. ${m.pdf_page} · ${m.label_near_name?'compound number near name':'compound number not near name'}</span></li>`).join('');
      cards+=structureCard(p,c,'Paper-name / OPSIN candidate',a,`<p class="muted">Derived from a name located in the paper; compound identity and stereochemistry require your review.</p>${warning}<details open><summary>Names and paper locations</summary><ul class="paper-name-list">${names}</ul></details>`,`paper-name:${a.graph.drawing_key}`);
    }
    for(const run of s.agent_runs||[]){run.candidates.forEach((a,i)=>{
      const comparison=a.comparison?(a.comparison.exact_match?badge('Automated match to ChEMBL · not paper-verified','green'):badge(a.comparison.connectivity_match?'Stereochemistry differs from ChEMBL':'Connectivity differs from ChEMBL','red')):badge('No ChEMBL comparison available','amber');
      cards+=structureCard(p,c,'Agent candidate',a,`<div class="candidate-comparison">${comparison}</div><p class="muted">Unverified extraction candidate. Check the drawing and compound number independently.</p>${a.ambiguities.length?`<p class="structure-warning"><b>Assignment ambiguities:</b> ${esc(a.ambiguities.join('; '))}</p>`:''}${a.review_flags.length?`<p class="structure-warning">Candidate limitations: ${esc(a.review_flags.map(f=>f.replaceAll('_',' ')).join('; '))}</p>`:''}<details><summary>Candidate assignment and paper locations</summary><p>${esc((a.identity_basis||'Assignment note not available.').replace(/\b(?:MolParser|MolScribe|RGReco|Gemini)\b[^.!?]*(?:[.!?]|$)/gi,''))}</p>${a.evidence.map(e=>`<span class="source-ref">PDF p. ${e.pdf_page} · ${esc(e.label||e.file_name)}</span>`).join('')}</details>`,`candidate:${run.run_id}:${i}`);
    });}
    const pending=(s.agent_runs||[]).some(run=>run.status==='pending');
    const unresolved=(s.agent_runs||[]).some(run=>run.status==='unresolved');
    const previous=[...(old?.history||[]),...(old&&!r?[old]:[])];
    const history=previous.length?`<details><summary>Earlier notes for different source or structure data</summary>${previous.map(v=>`<p>${esc(v.note||'No note recorded.')}</p>`).join('')}</details>`:'';
    return `<section class="structure-review"><h3>SMILES comparison</h3><div>${structureBadges(c)}</div><p class="notice">Compare the structure drawings and exact SMILES with the original paper and ChEMBL. An automated graph match is separate from your paper review; all stereochemical and mapping warnings remain visible.</p><p>Paper structure locations: ${sources(p,c.structure_source_ids)||'Not recorded'} · ${doiLink(p)}</p>${pending?'<p class="pending-note">A further extraction is pending. Earlier candidates remain available below.</p>':''}${unresolved?'<p class="pending-note">One extraction left this compound unresolved.</p>':''}<div class="smiles-grid">${cards||'<p class="muted">No SMILES is available for this compound yet. Use the paper label and cited source pages.</p>'}</div><div id="structure-review-form" data-paper="${p.id}" data-compound="${esc(c.compound_id)}"><h4>Your manual review notes</h4><p class="muted">Choose a verdict separately for each displayed SMILES. These notes stay in this browser; they are not shared or added to the research dataset. Download a backup before changing browsers.</p>${old&&!r?'<p class="structure-warning">An older note was for different source or structure data. Its verdict is inactive; recheck the current structures before saving.</p>':''}${history}<label class="check"><input type="checkbox" data-paper-viewed ${r?.paper_viewed?'checked':''}> I viewed the paper structure source</label><label class="check"><input type="checkbox" data-chembl-viewed ${r?.chembl_viewed?'checked':''} ${!s.chembl?'disabled':''}> I viewed the ChEMBL entry</label><label>Review note<textarea data-review-note rows="3" placeholder="Compound label, attachments, stereo and any discrepancy…">${esc(r?.note||'')}</textarea></label><div class="review-actions"><button class="button" data-save-review>Save in this browser</button><button class="button secondary" data-download-reviews>Download all my reviews JSON</button></div><p class="review-status" role="status">${r?'Saved browser-local review loaded.':''}</p></div></section>`;
  }
  function openCompound(p,c) {
    document.querySelector('#detail-content').innerHTML=`<div class="dialog-top"><span class="eyebrow">COMPOUND STRUCTURES</span><button class="close" aria-label="Close compound details" data-action="close">×</button></div><h2 id="dialog-title">${esc(name(c))}</h2><p class="muted">Paper label ${esc(c.label)} · ${esc(p.folder.replace(/^c3_/,''))}</p>${structurePanel(p,c)}`;
    dialog.setAttribute('aria-labelledby','dialog-title');dialog.showModal();dialog.scrollTop=0;
  }
  async function copySmiles(button) {
    const area=button.closest('.smiles-card').querySelector('textarea');
    try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(area.value);else{area.select();if(!document.execCommand('copy'))throw Error('copy');}button.textContent='Copied';}catch{area.focus();area.select();button.textContent='Select and copy this SMILES';}
  }
  function saveReview() {
    const form=document.querySelector('#structure-review-form'),p=D.papers.find(p=>p.id===form.dataset.paper),c=p.cm[form.dataset.compound];
    const value={paper_id:p.id,paper:p.folder,compound_id:c.compound_id,compound_label:c.label,basis:reviewBasis(p,c),
      structure_verdicts:Object.fromEntries([...document.querySelectorAll('#detail [data-structure-verdict]')].map(e=>[e.dataset.structureVerdict,e.value])),
      paper_viewed:form.querySelector('[data-paper-viewed]').checked,chembl_viewed:form.querySelector('[data-chembl-viewed]').checked,
      note:form.querySelector('[data-review-note]').value,updated_at:new Date().toISOString()};
    const old=storedReview(p,c);
    if(old?.history?.length)value.history=old.history;
    if(old&&old.basis!==value.basis){const {history,...version}=old;value.history=[...(value.history||[]),version];}
    reviewMemory.set(reviewKey(p,c),value);let persistent=true;
    try{localStorage.setItem(reviewKey(p,c),JSON.stringify(value));}catch{persistent=false;}
    form.querySelector('.review-status').textContent=persistent?'Saved in this browser only. Download a backup to retain your work.':'Browser storage unavailable. Notes remain in this open tab; download them now.';
  }
  function downloadReviews() {
    const reviews=D.papers.flatMap(p=>p.compounds.map(c=>{const r=storedReview(p,c);return r?{...r,current_structure_data:r.basis===reviewBasis(p,c)}:null;})).filter(Boolean);
    const url=URL.createObjectURL(new Blob([JSON.stringify({kind:'browser_local_smiles_reviews',structure_date:D.structure_date,reviews},null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='my-smiles-reviews.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const tag = c => c.classification.cause_id === 'molecular_chameleonicity' ? badge('Molecular chameleonicity (provisional)', 'provisional') : badge(cause(c));
  D.papers.forEach(p => {
    p.cm = Object.fromEntries(p.compounds.map(c=>[c.compound_id,c]));
    p.mm = Object.fromEntries(p.measurements.map(m=>[m.measurement_id,m]));
    p.am = Object.fromEntries(p.assays.map(a=>[a.assay_id,a]));
    p.clm = Object.fromEntries(p.claims.map(c=>[c.claim_id,c]));
    p.sm = Object.fromEntries(p.sources.map(s=>[s.source_id,s]));
    p.targets = unique(p.assays.map(a=>a.target));
    p.search = norm([p.title,p.doi,p.folder,...p.targets,...p.compounds.flatMap(c=>[name(c),c.label,...(c.aliases||[])]),...p.claims.flatMap(c=>[cause(c),c.author_explanation])].join(' '));
  });
  const allPairs = D.papers.flatMap(p=>p.pairs.map(pair=>({p,pair})));
  let state = {q:'',cause:'',target:'',year:'',status:'',smiles:'',linked:false,sort:'title',page:1,view:'papers'};
  const pageSize = 25;
  function stats() { return `<div class="stats">${[[D.summary.papers,'PAPERS'],[D.summary.compounds,'COMPOUNDS'],[D.summary.pairs,'POTENCY PAIRS'],[D.summary.claims,'REPORTED EXPLANATIONS']].map(([n,l])=>`<div><strong>${n.toLocaleString()}</strong><span>${l}</span></div>`).join('')}</div>`; }
  function filters() {
    const options=(values,current)=>values.map(([v,l])=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(l)}</option>`).join('');
    const targets=unique(D.papers.flatMap(p=>p.targets)).sort((a,b)=>a.localeCompare(b));
    return `<aside class="filters"><div class="filter-heading">Refine results <button class="text-button" data-action="reset">Reset</button></div>
      <label>Reported mechanism<select data-filter="cause"><option value="">All mechanisms</option>${options(D.taxonomy.map(c=>[c.id,shortCauses[c.id]]),state.cause)}</select></label>
      <label>Target<select data-filter="target"><option value="">All targets</option>${options(targets.map(t=>[t,t]),state.target)}</select></label>
      <label>Publication year<select data-filter="year"><option value="">All years</option>${options(unique(D.papers.map(p=>p.year)).sort((a,b)=>b-a).map(y=>[String(y),y]),state.year)}</select></label>
      <label>Reason status<select data-filter="status"><option value="">All statuses</option>${options(['supported','proposed','ruled_out','mixed','unclear'].map(s=>[s,s.replace('_',' ')]),state.status)}</select></label>
      <label>SMILES availability<select data-filter="smiles"><option value="">All compounds</option>${options([['present','Has SMILES'],['missing','No SMILES yet'],['name_candidate','Has paper-name candidate'],['name_conflict','Conflicting paper-name candidates'],['candidate','Has agent candidate'],['mismatch','Candidate differs from ChEMBL']],state.smiles)}</select></label>
      <label class="check"><input type="checkbox" data-filter="linked" ${state.linked?'checked':''}> With supported / proposed reasons</label>
      <a class="download" href="pairs.csv" download>↓ Download all pairs <span>CSV</span></a><a class="download" href="structures.csv" download>↓ Compound SMILES <span>CSV</span></a><a class="download" href="data.json" download>↓ Complete dataset <span>JSON</span></a>
    </aside>`;
  }
  function claimMatches(c) { return (!state.cause || c.classification.cause_id===state.cause) && (!state.status || c.classification.assertion_status===state.status) && (!state.linked || eligible(c)); }
  function structureMatches(c) {
    const s=c.structure_review||{};
    if(state.smiles==='present')return !!s.has_smiles;
    if(state.smiles==='missing')return !s.has_smiles;
    if(state.smiles==='name_candidate')return !!s.paper_name_candidates?.length;
    if(state.smiles==='name_conflict')return (s.paper_name_candidates||[]).some(a=>a.different_name_graphs);
    if(state.smiles==='candidate')return (s.agent_runs||[]).some(r=>r.candidates.length);
    if(state.smiles==='mismatch')return (s.agent_runs||[]).some(r=>r.candidates.some(a=>a.comparison&&!a.comparison.exact_match));
    return true;
  }
  function paperMatches(p) {
    const words=norm(state.q).trim().split(/\s+/).filter(Boolean);
    return words.every(w=>p.search.includes(w)) && (!state.smiles||p.compounds.some(structureMatches)) && (!state.year || String(p.year)===state.year) && (!state.target || p.targets.includes(state.target)) &&
      (!(state.cause||state.status||state.linked) || p.claims.some(claimMatches));
  }
  function pairMatches({p,pair}) {
    const claims=pair.claim_ids.map(id=>p.clm[id]);
    const bio=p.mm[pair.biochemical_id],cell=p.mm[pair.cellular_id];
    const query=norm([p.title,p.folder,p.doi,name(p.cm[pair.compound_id]),p.cm[pair.compound_id]?.label,...(p.cm[pair.compound_id]?.aliases||[]),p.am[bio.assay_id].target,p.am[cell.assay_id].target,...claims.flatMap(c=>[cause(c),c.author_explanation])].join(' '));
    return structureMatches(p.cm[pair.compound_id]) && norm(state.q).trim().split(/\s+/).filter(Boolean).every(w=>query.includes(w)) && (!state.year||String(p.year)===state.year) &&
      (!state.target || [p.am[bio.assay_id].target,p.am[cell.assay_id].target].includes(state.target)) &&
      (!(state.cause||state.status||state.linked) || claims.some(claimMatches));
  }
  function renderBrowse(view) {
    state.view=view;
    main.innerHTML=`<section class="intro"><div class="eyebrow">BIOCHEMICAL & CELLULAR POTENCY</div><h1>Compare potencies across papers.</h1><p>Search papers and compounds, compare potencies, and read the authors’ explanations.</p>${stats()}<p class="smiles-coverage"><b>${D.structure_summary.with_smiles} / ${D.summary.compounds} compounds have SMILES</b> · ${D.structure_summary.with_chembl} ChEMBL references · ${D.structure_summary.with_paper_name_candidate} paper-name candidates · ${D.structure_summary.with_agent_candidate} also have agent candidates. All candidates await your paper checks.</p>
      <div class="search-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input id="search" type="search" aria-label="Search papers, compounds, targets or mechanisms" placeholder="Search a paper, compound, target or mechanism…" value="${esc(state.q)}"><kbd>/</kbd></div></section>
      <div class="workspace">${filters()}<section class="results" aria-label="Search results"><div class="results-heading"><div><span class="eyebrow">THE COLLECTION</span><h2>${view==='pairs'?'Potency pairs':'Papers'} <span id="result-count"></span></h2></div><label class="sort">Sort by <select id="sort">${(view==='papers'?[['title','Paper title'],['year','Newest first'],['pairs','Most pairs'],['claims','Most reasons']]:[['title','Paper title'],['year','Newest first'],['compound','Compound']]).map(([v,l])=>`<option value="${v}" ${v===state.sort?'selected':''}>${l}</option>`).join('')}</select></label></div><div id="results"></div></section></div>`;
    renderResults();
  }
  function renderResults() {
    const pairView=state.view==='pairs';
    let rows=pairView?allPairs.filter(pairMatches):D.papers.filter(paperMatches);
    rows.sort((a,b)=>{
      const x=pairView?a.p:a,y=pairView?b.p:b;
      if(state.sort==='year') return (y.year||0)-(x.year||0)||x.title.localeCompare(y.title);
      if(state.sort==='pairs')return y.pairs.length-x.pairs.length;
      if(state.sort==='claims')return y.claims.length-x.claims.length;
      if(state.sort==='compound'&&pairView)return name(x.cm[a.pair.compound_id]).localeCompare(name(y.cm[b.pair.compound_id]),'en',{numeric:true});
      return x.title.localeCompare(y.title);
    });
    const pages=Math.max(1,Math.ceil(rows.length/pageSize));state.page=Math.min(state.page,pages);
    document.querySelector('#result-count').textContent=rows.length.toLocaleString();
    const subset=rows.slice((state.page-1)*pageSize,state.page*pageSize);
    document.querySelector('#results').innerHTML = !rows.length ? '<div class="empty"><h3>No matching records</h3><p>Try fewer search terms or reset the filters.</p><button class="button" data-action="reset">Reset search and filters</button></div>' :
      `${pairView?pairTable(subset):paperTable(subset)}<div class="pagination"><span>${(state.page-1)*pageSize+1}–${Math.min(state.page*pageSize,rows.length)} of ${rows.length} ${pairView?'pairs':'papers'}</span><div><button data-action="prev" ${state.page===1?'disabled':''}>← Previous</button><span>${state.page} / ${pages}</span><button data-action="next" ${state.page===pages?'disabled':''}>Next →</button></div></div>`;
  }
  function paperTable(papers) { return `<div class="table-scroll"><table class="paper-table"><thead><tr><th>Publication</th><th>Target</th><th class="numeric">Pairs</th><th>Reasons</th></tr></thead><tbody>${papers.map(p=>{
    const causes=unique(p.claims.filter(eligible).map(c=>cause(c)));
    return `<tr><td><div class="paper-meta">${esc(p.year||'YEAR UNKNOWN')} <span>·</span> ${esc(p.folder.replace(/^c3_/, '').split(' et al.')[0].replace(/\d{4}$/, ''))}</div><a class="paper-title" href="#paper/${p.id}">${esc(p.title)} <span class="arrow">↗</span></a><div class="sub">${p.compounds.length} compound${p.compounds.length===1?'':'s'} · ${p.compounds.filter(c=>c.structure_review?.has_smiles).length} with SMILES · ${p.claims.length} reported explanation${p.claims.length===1?'':'s'}</div></td><td><div class="targets">${p.targets.slice(0,3).map(t=>badge(t)).join('')}${p.targets.length>3?`<span class="muted">+${p.targets.length-3}</span>`:''}</div></td><td class="numeric pair-count">${p.pairs.length}</td><td class="reason-cell">${causes.slice(0,2).map(c=>`<div class="reason-line"><span class="dot"></span>${esc(c)}</div>`).join('')||'<span class="muted">No supported or proposed reason</span>'}${causes.length>2?`<small>+${causes.length-2} more</small>`:''}</td></tr>`;
  }).join('')}</tbody></table></div>`; }
  function measurement(m) {
    let value = m.comparator==='range'?`${fmt(m.lower)}–${fmt(m.upper)}`:`${({'=':'','~':'≈','<=':'≤','>=':'≥'}[m.comparator]??m.comparator)}${fmt(m.value)}`;
    return `<strong>${esc(value)} <span class="unit">${esc(m.unit)}</span></strong><span class="sub">${esc(m.endpoint)}${m.origin==='graph_estimate'?' · graph estimate':''}</span>`;
  }
  function ratioText(r) {
    if(r.status==='unavailable') return 'Not calculated';
    let text;
    if(r.value!=null) text=fmt(r.value);
    else if(r.lower===0&&r.upper==null) return 'No useful bound';
    else if(r.upper==null)text=(r.lower_inclusive?'≥':'>')+fmt(r.lower);
    else if(r.lower===0)text=(r.upper_inclusive?'≤':'<')+fmt(r.upper);
    else text=`${r.lower_inclusive?'[':'('}${fmt(r.lower)}, ${fmt(r.upper)}${r.upper_inclusive?']':')'}`;
    return (r.estimated?'≈ ':'')+text+'×';
  }
  function pairTable(rows, showPaper=true) { return `<div class="table-scroll"><table class="pair-table"><thead><tr><th>Compound${showPaper?' / paper':''}</th><th>Biochemical</th><th>Cellular</th><th>Cell / bio <span title="Cellular concentration divided by biochemical concentration, in the same units">i</span></th><th>Linked explanation</th><th><span class="sr-only">Details</span></th></tr></thead><tbody>${rows.map(({p,pair})=>{
    const bio=p.mm[pair.biochemical_id],cell=p.mm[pair.cellular_id],claims=pair.eligible_claim_ids.map(id=>p.clm[id]);
    return `<tr><td><button class="compound-button" data-pair="${pair.pair_id}" data-paper="${p.id}">${esc(name(p.cm[pair.compound_id]))}</button><div class="smiles-badges">${structureBadges(p.cm[pair.compound_id])}</div>${showPaper?`<a class="sub paper-link" href="#paper/${p.id}">${esc(p.folder.replace(/^c3_/,''))}</a>`:''}<span class="sub">${esc(p.am[bio.assay_id].target)}</span></td><td>${measurement(bio)}</td><td>${measurement(cell)}<span class="sub">${esc(p.am[cell.assay_id].cell_line||p.am[cell.assay_id].target)}</span></td><td class="ratio ${pair.ratio.status==='unavailable'?'muted':''}" title="${esc(pair.ratio.reason||'Cellular / biochemical concentration; assay differences remain.')} ">${esc(ratioText(pair.ratio))}${pair.ratio.status==='unavailable'?`<span class="sub ratio-reason">${esc(pair.ratio.reason)}</span>`:''}</td><td>${unique(claims.map(c=>cause(c))).map(c=>badge(c)).join('')||'<span class="muted">No supported / proposed reason linked</span>'}${pair.claim_ids.length>claims.length?'<span class="sub">Other explanations listed in details</span>':''}</td><td><button class="detail-button" data-pair="${pair.pair_id}" data-paper="${p.id}" aria-label="Details for ${esc(name(p.cm[pair.compound_id]))}">→</button></td></tr>`;
  }).join('')}</tbody></table></div>`; }
  function sources(p, ids) { return unique(ids||[]).map(id=>{const s=p.sm[id];return s?`<span class="source-ref" title="${esc(s.file_name)}">p. ${s.pdf_page} · ${esc(s.label||s.kind)}</span>`:'';}).join(''); }
  function claimCard(p,c) {
    const cl=c.classification;
    return `<article class="claim-card" id="claim-${esc(c.claim_id)}"><div class="claim-heading"><div>${tag(c)} ${badge(cl.assertion_status.replace('_',' '),eligible(c)?'green':'amber')}</div><span class="grade">Evidence <b>${c.proposed_grade??'—'}</b><span>/ 5</span></span></div>
      <h3>${esc(c.author_explanation)}</h3><p class="applies"><b>Applies to:</b> ${c.compound_ids.map(id=>esc(name(p.cm[id]))).join(', ')||'No compounds specified'}</p>
      ${c.evidence.map(e=>`<div class="evidence"><div class="evidence-top"><span>${esc(e.kind.replaceAll('_',' '))}</span>${badge(e.stance,e.stance==='supports'?'green':'amber')} ${!e.current_paper?badge('Cited work · not checked','amber'):''}</div><h4>${esc(e.experiment)}</h4><p>${esc(e.result)}</p>${sources(p,e.source_ids)}</div>`).join('')}
      <details><summary>Evidence grade and mechanism</summary><p><b>Evidence grade rationale:</b> ${esc(c.grade_rationale)}</p><p><b>Mechanism:</b> ${esc(cl.rationale)}</p></details><div class="source-list">${sources(p,c.source_ids)}</div></article>`;
  }
  function assayCard(p,a) { return `<article class="assay-card"><div>${badge(a.assay_class)} ${badge(a.target||'Target not reported')}</div><h3>${esc(a.description)}</h3><dl>${['variant','cell_line','principle','readout','species','duration','substrate','serum','efflux_modulator'].map(k=>`<div><dt>${esc(k.replaceAll('_',' '))}</dt><dd>${esc(a[k]||'Not reported')}</dd></div>`).join('')}</dl>${a.conditions?.length?`<p>${a.conditions.map(esc).join(' · ')}</p>`:''}${sources(p,a.source_ids)}</article>`; }
  function renderPaper(p,tab='pairs') {
    if(tab==='provenance')tab='sources';
    if(!['pairs','compounds','reasons','assays','sources'].includes(tab))tab='pairs';
    main.innerHTML=`<section class="paper-header"><a class="back" href="#papers">← All papers</a><div class="paper-kicker">PAPER <span>·</span> ${p.year||'YEAR UNKNOWN'}</div><h1>${esc(p.title)}</h1><div class="paper-doi">${doiLink(p)}</div><div class="paper-stats"><span><b>${p.compounds.length}</b> compounds</span><span><b>${p.pairs.length}</b> potency pairs</span><span><b>${p.claims.length}</b> reported explanations</span><span>${p.targets.map(esc).join(' · ')}</span></div></section>
      <nav class="tabs" aria-label="Paper sections">${[['pairs','Potency pairs',p.pairs.length],['compounds','Compounds & SMILES',p.compounds.length],['reasons','Reasons & evidence',p.claims.length],['assays','Assays',p.assays.length],['sources','Sources','']].map(([t,label,n])=>`<a href="#paper/${p.id}/${t}" ${tab===t?'aria-current="page" class="active"':''}>${label} <span>${n}</span></a>`).join('')}</nav><section class="paper-body" id="paper-body"></section>`;
    const body=document.querySelector('#paper-body');
    if(tab==='pairs'){
      body.innerHTML=`<div class="section-lead"><div><h2>Paired potency measurements</h2><p>Click a compound to inspect assays, source locations and its linked explanations.</p></div><button class="button secondary" data-download-paper="${p.id}">↓ Paper JSON</button></div><div class="notice">Cell / bio = cellular concentration ÷ biochemical concentration, in the same units. A value of 10 means ten times the concentration was needed in cells. Assay differences can affect the comparison.</div><label class="paper-search">Find a compound in this paper<input type="search" id="paper-search" placeholder="Compound name, number or alias…"></label><div id="paper-pairs">${p.pairs.length?pairTable(p.pairs.map(pair=>({p,pair})),false):`<div class="empty"><h3>No paired potency measurements</h3><p>${esc(p.eligibility.reason)}</p></div>`}</div>`;
      document.querySelector('#paper-search').addEventListener('input',e=>{
        const q=norm(e.target.value);const rows=p.pairs.filter(pair=>norm([name(p.cm[pair.compound_id]),p.cm[pair.compound_id].label,...(p.cm[pair.compound_id].aliases||[])].join(' ')).includes(q));
        document.querySelector('#paper-pairs').innerHTML=rows.length?pairTable(rows.map(pair=>({p,pair})),false):'<div class="empty">No matching compound.</div>';
      });
    } else if(tab==='compounds') {
      body.innerHTML=`<div class="section-lead"><div><h2>Compounds & SMILES</h2><p>All ${p.compounds.length} compounds, including those without paired measurements. Open an entry to compare structures and source pages.</p></div><button class="button secondary" data-download-reviews>↓ My review notes</button></div><div class="notice">ChEMBL references and agent candidates are shown separately. An automated match does not verify the paper assignment or stereochemistry.</div><label class="paper-search">Find a compound<input type="search" id="compound-search" placeholder="Compound name, number or alias…"></label><div id="paper-compounds">${compoundTable(p,p.compounds)}</div>`;
      document.querySelector('#compound-search').addEventListener('input',e=>{const q=norm(e.target.value);document.querySelector('#paper-compounds').innerHTML=compoundTable(p,p.compounds.filter(c=>norm([name(c),c.label,...(c.aliases||[])].join(' ')).includes(q)));});
    } else if(tab==='reasons') body.innerHTML=`<div class="section-lead"><div><h2>Author explanations & experimental evidence</h2><p>All reported explanations are shown here, including explanations the experiments ruled out. The pair tables list supported or proposed explanations.</p></div></div>${p.claims.map(c=>claimCard(p,c)).join('')||'<div class="empty">No author explanation was recorded.</div>'}${p.interventions.length?`<h2 class="section-title">Reported interventions</h2>${p.interventions.map(i=>`<article class="assay-card"><h3>${esc(i.description)}</h3><p>${esc(i.comparison_rationale)}</p><div>${badge(i.intervention_class.replaceAll('_',' '))} ${badge(i.mechanism_isolated?'Mechanism isolated':'Mechanism not isolated','amber')}</div>${sources(p,i.source_ids)}</article>`).join('')}`:''}`;
    else if(tab==='assays')body.innerHTML=`<div class="section-lead"><div><h2>Assay context</h2><p>Original endpoints, systems and stated conditions are kept separately.</p></div></div><div class="assay-grid">${p.assays.map(a=>assayCard(p,a)).join('')}</div>`;
    else body.innerHTML=`<div class="section-lead"><div><h2>Sources</h2><p>Page numbers refer to the paper PDF. ${doiLink(p)}</p></div></div><div class="source-grid">${p.sources.map(s=>`<article class="source-card"><span class="eyebrow">PDF PAGE ${s.pdf_page} · ${esc(s.kind)}</span><h3>${esc(s.label)}</h3><p>${esc(s.paraphrase)}</p><small>${esc(s.file_name)}</small></article>`).join('')}</div>`;
  }
  const dialog=document.querySelector('#detail');
  function openPair(p,pair) {
    const c=p.cm[pair.compound_id],bio=p.mm[pair.biochemical_id],cell=p.mm[pair.cellular_id];
    document.querySelector('#detail-content').innerHTML=`<div class="dialog-top"><span class="eyebrow">COMPOUND POTENCIES</span><button class="close" aria-label="Close compound details" data-action="close">×</button></div><h2 id="dialog-title">${esc(name(c))}</h2><p class="muted">${esc(c.label)} · ${esc(p.folder.replace(/^c3_/,''))}</p><div class="comparison">${[[bio,'BIOCHEMICAL'],[cell,'CELLULAR']].map(([m,label])=>`<div><span class="eyebrow">${label}</span>${measurement(m)}<p>${esc(p.am[m.assay_id].description)}</p>${sources(p,m.source_ids)}<details><summary>Original measurement & assay</summary><p>Reported: ${esc(m.raw)} · ${esc(m.unit)}</p><p>${esc(m.footnote_notes||'')}${esc(m.precision_note||'')}</p>${m.graph_method?`<p>Graph method: ${esc(m.graph_method)}</p>`:''}${assayCard(p,p.am[m.assay_id])}</details></div>`).join('')}</div><div class="ratio-strip"><span>Cellular / biochemical concentration</span><strong>${esc(ratioText(pair.ratio))}</strong></div><p>${esc(pair.rationale)}</p>${pair.limitations.length?`<div class="limitations"><h3>Comparison limitations</h3><ul>${pair.limitations.map(l=>`<li>${esc(l)}</li>`).join('')}</ul></div>`:''}${pair.ratio.reason?`<p class="muted">${esc(pair.ratio.reason)}</p>`:''}${pair.ratio.conversion_note?`<p class="muted">${esc(pair.ratio.conversion_note)}</p>`:''}<h3 class="section-title">Explanations linked to this compound</h3>${pair.claim_ids.map(id=>claimCard(p,p.clm[id])).join('')||'<p class="muted">No author explanation was recorded for this compound.</p>'}<details class="structure"><summary>Compound identity & structure notes</summary><p>${esc(c.structure_notes||'No structure notes reported.')}</p><p>Aliases: ${esc((c.aliases||[]).join(', ')||'Not reported')}</p>${c.provided_smiles?`<p>Provided SMILES · not independently validated</p><code>${esc(c.provided_smiles)}</code>`:'<p>Structure records and comparisons are shown below.</p>'}${sources(p,c.structure_source_ids)}</details>${structurePanel(p,c)}`;
    dialog.setAttribute('aria-labelledby','dialog-title');dialog.showModal();dialog.scrollTop=0;
  }
  function downloadPaper(p) {
    const {cm,mm,am,clm,sm,search,targets,...clean}=p;
    const url=URL.createObjectURL(new Blob([JSON.stringify(clean,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`paper-${p.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function route() {
    if(dialog.open)dialog.close();
    let [view,id,tab] = location.hash.slice(1).split('/');
    if(!['paper','papers','pairs'].includes(view)) view='papers';
    document.querySelectorAll('[data-nav]').forEach(a=>{const active=a.dataset.nav===(view==='paper'?'papers':view||'papers');if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    if(view==='paper'){
      const p=D.papers.find(p=>p.id===id);
      if(p){renderPaper(p,tab);document.title=`${p.title} · CellPotency`;}
      else main.innerHTML='<div class="empty"><h1>Paper not found</h1><a href="#papers">Return to the collection</a></div>';
    }else{if(state.view!==(view==='pairs'?'pairs':'papers')){state.page=1;state.sort='title';}renderBrowse(view==='pairs'?'pairs':'papers');document.title='CellPotency · Literature database';}
    window.scrollTo(0,0);
  }
  document.addEventListener('input',e=>{if(e.target.id==='search'){state.q=e.target.value;state.page=1;renderResults();}});
  document.addEventListener('change',e=>{
    if(e.target.dataset.filter){state[e.target.dataset.filter]=e.target.type==='checkbox'?e.target.checked:e.target.value;state.page=1;renderResults();}
    if(e.target.id==='sort'){state.sort=e.target.value;state.page=1;renderResults();}
  });
  document.addEventListener('click',e=>{
    const action=e.target.closest('[data-action]')?.dataset.action;
    const compound=e.target.closest('button[data-compound]');if(compound){const p=D.papers.find(p=>p.id===compound.dataset.paper);openCompound(p,p.cm[compound.dataset.compound]);}
    const copy=e.target.closest('[data-copy-smiles]');if(copy){copySmiles(copy);}
    if(e.target.closest('[data-download-reviews]'))downloadReviews();
    if(e.target.closest('[data-save-review]'))saveReview();
    if(action==='close')dialog.close();
    if(action==='reset'){state={...state,q:'',cause:'',target:'',year:'',status:'',smiles:'',linked:false,page:1};renderBrowse(state.view);}
    if(action==='prev'||action==='next'){state.page+=action==='next'?1:-1;renderResults();document.querySelector('.results').scrollIntoView({block:'start'});}
    const pairButton=e.target.closest('[data-pair]');
    if(pairButton){const p=D.papers.find(p=>p.id===pairButton.dataset.paper);openPair(p,p.pairs.find(pair=>pair.pair_id===pairButton.dataset.pair));}
    const download=e.target.closest('[data-download-paper]');if(download)downloadPaper(D.papers.find(p=>p.id===download.dataset.downloadPaper));
  });
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!dialog.open){const search=document.querySelector('#search');if(search){e.preventDefault();search.focus();}}});
  window.addEventListener('hashchange',route);route();
})();
