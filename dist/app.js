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
  const tag = c => badge(cause(c), c.classification.classification_method === 'assistant_semantic_review' ? 'provisional' : '');
  const methods = method => method === 'reused_gemini_4_argon_v2' ? 'Gemini 4 Argon · reused v2 classification' : 'Assistant semantic review · provisional classification';
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
  let state = {q:'',cause:'',target:'',year:'',status:'',linked:false,sort:'title',page:1,view:'papers'};
  const pageSize = 25;
  function stats() { return `<div class="stats">${[[D.summary.papers,'REVIEWED PAPERS'],[D.summary.compounds,'PAPER-LOCAL COMPOUNDS'],[D.summary.pairs,'POTENCY PAIRS'],[D.summary.claims,'REASON CLAIMS']].map(([n,l])=>`<div><strong>${n.toLocaleString()}</strong><span>${l}</span></div>`).join('')}</div>`; }
  function filters() {
    const options=(values,current)=>values.map(([v,l])=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(l)}</option>`).join('');
    const targets=unique(D.papers.flatMap(p=>p.targets)).sort((a,b)=>a.localeCompare(b));
    return `<aside class="filters"><div class="filter-heading">Refine results <button class="text-button" data-action="reset">Reset</button></div>
      <label>Reported mechanism<select data-filter="cause"><option value="">All mechanisms</option>${options(D.taxonomy.map(c=>[c.id,shortCauses[c.id]]),state.cause)}</select></label>
      <label>Target<select data-filter="target"><option value="">All targets</option>${options(targets.map(t=>[t,t]),state.target)}</select></label>
      <label>Publication year<select data-filter="year"><option value="">All years</option>${options(unique(D.papers.map(p=>p.year)).sort((a,b)=>b-a).map(y=>[String(y),y]),state.year)}</select></label>
      <label>Reason assertion<select data-filter="status"><option value="">All assertions</option>${options(['supported','proposed','ruled_out','mixed','unclear'].map(s=>[s,s.replace('_',' ')]),state.status)}</select></label>
      <label class="check"><input type="checkbox" data-filter="linked" ${state.linked?'checked':''}> With supported / proposed reasons</label>
      <div class="filter-note"><span class="dot"></span>Completed reviews only<p>Same-compound pairs from the canonical verified folder. Evidence grades and reason classifications remain provisional.</p><a href="#about">Read the curation notes →</a></div>
      <a class="download" href="pairs.csv" download>↓ Download all pairs <span>CSV</span></a><a class="download" href="data.json" download>↓ Complete dataset <span>JSON</span></a>
    </aside>`;
  }
  function claimMatches(c) { return (!state.cause || c.classification.cause_id===state.cause) && (!state.status || c.classification.assertion_status===state.status) && (!state.linked || eligible(c)); }
  function paperMatches(p) {
    const words=norm(state.q).trim().split(/\s+/).filter(Boolean);
    return words.every(w=>p.search.includes(w)) && (!state.year || String(p.year)===state.year) && (!state.target || p.targets.includes(state.target)) &&
      (!(state.cause||state.status||state.linked) || p.claims.some(claimMatches));
  }
  function pairMatches({p,pair}) {
    const claims=pair.claim_ids.map(id=>p.clm[id]);
    const bio=p.mm[pair.biochemical_id],cell=p.mm[pair.cellular_id];
    const query=norm([p.title,p.folder,p.doi,name(p.cm[pair.compound_id]),p.cm[pair.compound_id]?.label,...(p.cm[pair.compound_id]?.aliases||[]),p.am[bio.assay_id].target,p.am[cell.assay_id].target,...claims.flatMap(c=>[cause(c),c.author_explanation])].join(' '));
    return norm(state.q).trim().split(/\s+/).filter(Boolean).every(w=>query.includes(w)) && (!state.year||String(p.year)===state.year) &&
      (!state.target || [p.am[bio.assay_id].target,p.am[cell.assay_id].target].includes(state.target)) &&
      (!(state.cause||state.status||state.linked) || claims.some(claimMatches));
  }
  function renderBrowse(view) {
    state.view=view;
    main.innerHTML=`<section class="intro"><div class="eyebrow">BIOCHEMICAL → CELLULAR EVIDENCE</div><h1>Explore the potency difference.</h1><p>Follow the reported measurements, author explanations and experiments behind cellular potency.</p>${stats()}
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
    return `<tr><td><div class="paper-meta">${esc(p.year||'YEAR UNKNOWN')} <span>·</span> ${esc(p.folder.replace(/^c3_/, '').split(' et al.')[0].replace(/\d{4}$/, ''))}</div><a class="paper-title" href="#paper/${p.id}">${esc(p.title)} <span class="arrow">↗</span></a><div class="sub">${p.compounds.length} compounds · ${p.claims.length} reason claims</div></td><td><div class="targets">${p.targets.slice(0,3).map(t=>badge(t)).join('')}${p.targets.length>3?`<span class="muted">+${p.targets.length-3}</span>`:''}</div></td><td class="numeric pair-count">${p.pairs.length}</td><td class="reason-cell">${causes.slice(0,2).map(c=>`<div class="reason-line"><span class="dot"></span>${esc(c)}</div>`).join('')||'<span class="muted">No eligible reason</span>'}${causes.length>2?`<small>+${causes.length-2} more</small>`:''}</td></tr>`;
  }).join('')}</tbody></table></div>`; }
  function measurement(m) {
    let value = m.comparator==='range'?`${fmt(m.lower)}–${fmt(m.upper)}`:`${({'=':'','~':'≈','<=':'≤','>=':'≥'}[m.comparator]??m.comparator)}${fmt(m.value)}`;
    return `<strong>${esc(value)} <span class="unit">${esc(m.unit)}</span></strong><span class="sub">${esc(m.endpoint)}${m.origin==='graph_estimate'?' · graph estimate':''}</span>`;
  }
  function ratioText(r) {
    if(r.status==='unavailable') return 'Unavailable';
    let text;
    if(r.value!=null) text=fmt(r.value);
    else if(r.lower===0&&r.upper==null) return 'Uninformative bounds';
    else if(r.upper==null)text=(r.lower_inclusive?'≥':'>')+fmt(r.lower);
    else if(r.lower===0)text=(r.upper_inclusive?'≤':'<')+fmt(r.upper);
    else text=`${r.lower_inclusive?'[':'('}${fmt(r.lower)}, ${fmt(r.upper)}${r.upper_inclusive?']':')'}`;
    return (r.estimated?'≈ ':'')+text+'×';
  }
  function pairTable(rows, showPaper=true) { return `<div class="table-scroll"><table class="pair-table"><thead><tr><th>Compound${showPaper?' / paper':''}</th><th>Biochemical</th><th>Cellular</th><th>Cell / bio <span title="Operational concentration ratio; cross-assay comparison, not a mechanistic measurement">i</span></th><th>Linked explanation</th><th><span class="sr-only">Details</span></th></tr></thead><tbody>${rows.map(({p,pair})=>{
    const bio=p.mm[pair.biochemical_id],cell=p.mm[pair.cellular_id],claims=pair.eligible_claim_ids.map(id=>p.clm[id]);
    return `<tr><td><button class="compound-button" data-pair="${pair.pair_id}" data-paper="${p.id}">${esc(name(p.cm[pair.compound_id]))}</button>${showPaper?`<a class="sub paper-link" href="#paper/${p.id}">${esc(p.folder.replace(/^c3_/,''))}</a>`:''}<span class="sub">${esc(p.am[bio.assay_id].target)}</span></td><td>${measurement(bio)}</td><td>${measurement(cell)}<span class="sub">${esc(p.am[cell.assay_id].cell_line||p.am[cell.assay_id].target)}</span></td><td class="ratio ${pair.ratio.status==='unavailable'?'muted':''}" title="${esc(pair.ratio.reason||'Cellular / biochemical concentration; assay differences remain.')} ">${esc(ratioText(pair.ratio))}${!pair.same_target_relationship?'<span class="sub">Target comparison flagged</span>':''}</td><td>${unique(claims.map(c=>cause(c))).map(c=>badge(c)).join('')||'<span class="muted">No supported / proposed reason linked</span>'}${pair.claim_ids.length>claims.length?'<span class="sub">Other assertion statuses recorded</span>':''}</td><td><button class="detail-button" data-pair="${pair.pair_id}" data-paper="${p.id}" aria-label="Details for ${esc(name(p.cm[pair.compound_id]))}">→</button></td></tr>`;
  }).join('')}</tbody></table></div>`; }
  function sources(p, ids) { return unique(ids||[]).map(id=>{const s=p.sm[id];return s?`<span class="source-ref" title="${esc(s.file_name)}">p. ${s.pdf_page} · ${esc(s.label||s.kind)}</span>`:'';}).join(''); }
  function claimCard(p,c) {
    const cl=c.classification;
    return `<article class="claim-card" id="claim-${esc(c.claim_id)}"><div class="claim-heading"><div>${tag(c)} ${badge(cl.assertion_status.replace('_',' '),eligible(c)?'green':'amber')}</div><span class="grade">Evidence <b>${c.proposed_grade??'—'}</b><span>/ 5</span></span></div>
      <h3>${esc(c.author_explanation)}</h3><p class="applies"><b>Applies to:</b> ${c.compound_ids.map(id=>esc(name(p.cm[id]))).join(', ')||'No compound-specific link recorded'}</p>
      ${c.evidence.map(e=>`<div class="evidence"><div class="evidence-top"><span>${esc(e.kind.replaceAll('_',' '))}</span>${badge(e.stance,e.stance==='supports'?'green':'amber')} ${!e.current_paper?badge('Cited work · not checked','amber'):''}</div><h4>${esc(e.experiment)}</h4><p>${esc(e.result)}</p>${sources(p,e.source_ids)}</div>`).join('')}
      <details><summary>Evidence grade and classification notes</summary><p><b>Model-proposed grade:</b> ${esc(c.grade_rationale)}</p><p><b>Classification:</b> ${esc(cl.rationale)}</p><p>${esc(methods(cl.classification_method))} · Confidence: ${esc(cl.confidence)}${cl.needs_review?' · Review requested':''}</p><p>Original extraction category: ${esc(c.category)}. Author attribution: ${esc(c.origin)}.</p></details><div class="source-list">${sources(p,c.source_ids)}</div></article>`;
  }
  function assayCard(p,a) { return `<article class="assay-card"><div>${badge(a.assay_class)} ${badge(a.target||'Target not reported')}</div><h3>${esc(a.description)}</h3><dl>${['variant','cell_line','principle','readout','species','duration','substrate','serum','efflux_modulator'].map(k=>`<div><dt>${esc(k.replaceAll('_',' '))}</dt><dd>${esc(a[k]||'Not reported')}</dd></div>`).join('')}</dl>${a.conditions?.length?`<p>${a.conditions.map(esc).join(' · ')}</p>`:''}${sources(p,a.source_ids)}</article>`; }
  function renderPaper(p,tab='pairs') {
    if(!['pairs','reasons','assays','provenance'].includes(tab))tab='pairs';
    main.innerHTML=`<section class="paper-header"><a class="back" href="#papers">← All papers</a><div class="paper-kicker">PUBLICATION RECORD <span>·</span> ${p.year||'YEAR UNKNOWN'} <span>·</span> ${badge('Model reviewed')}</div><h1>${esc(p.title)}</h1><div class="paper-doi">${doiLink(p)}</div><div class="paper-stats"><span><b>${p.compounds.length}</b> compounds</span><span><b>${p.pairs.length}</b> potency pairs</span><span><b>${p.claims.length}</b> reason claims</span><span>${p.targets.map(esc).join(' · ')}</span></div></section>
      <nav class="tabs" aria-label="Paper sections">${[['pairs','Potency pairs',p.pairs.length],['reasons','Reasons & evidence',p.claims.length],['assays','Assays',p.assays.length],['provenance','Sources & curation','']].map(([t,label,n])=>`<a href="#paper/${p.id}/${t}" ${tab===t?'aria-current="page" class="active"':''}>${label} <span>${n}</span></a>`).join('')}</nav><section class="paper-body" id="paper-body"></section>`;
    const body=document.querySelector('#paper-body');
    if(tab==='pairs'){
      body.innerHTML=`<div class="section-lead"><div><h2>Paired potency measurements</h2><p>Click a compound to inspect assays, source locations and its linked explanations.</p></div><button class="button secondary" data-download-paper="${p.id}">↓ Paper JSON</button></div><div class="notice">Cell / bio is an operational concentration ratio. Endpoint, assay and target differences remain visible in each record. Bounds and graph estimates are retained.</div><label class="paper-search">Find a compound in this paper<input type="search" id="paper-search" placeholder="Compound name, number or alias…"></label><div id="paper-pairs">${p.pairs.length?pairTable(p.pairs.map(pair=>({p,pair})),false):`<div class="empty"><h3>No qualifying potency pairs</h3><p>${esc(p.eligibility.reason)}</p></div>`}</div>`;
      document.querySelector('#paper-search').addEventListener('input',e=>{
        const q=norm(e.target.value);const rows=p.pairs.filter(pair=>norm([name(p.cm[pair.compound_id]),p.cm[pair.compound_id].label,...(p.cm[pair.compound_id].aliases||[])].join(' ')).includes(q));
        document.querySelector('#paper-pairs').innerHTML=rows.length?pairTable(rows.map(pair=>({p,pair})),false):'<div class="empty">No matching compound.</div>';
      });
    } else if(tab==='reasons') body.innerHTML=`<div class="section-lead"><div><h2>Author explanations & experimental evidence</h2><p>All recorded assertions are shown. Only supported / proposed claims appear as eligible reasons in pair tables.</p></div></div>${p.claims.map(c=>claimCard(p,c)).join('')||'<div class="empty">No author explanation was extracted.</div>'}${p.interventions.length?`<h2 class="section-title">Reported interventions</h2>${p.interventions.map(i=>`<article class="assay-card"><h3>${esc(i.description)}</h3><p>${esc(i.comparison_rationale)}</p><div>${badge(i.intervention_class.replaceAll('_',' '))} ${badge(i.mechanism_isolated?'Mechanism isolated':'Mechanism not isolated','amber')}</div>${sources(p,i.source_ids)}</article>`).join('')}`:''}`;
    else if(tab==='assays')body.innerHTML=`<div class="section-lead"><div><h2>Assay context</h2><p>Original endpoints, systems and stated conditions are kept separately.</p></div></div><div class="assay-grid">${p.assays.map(a=>assayCard(p,a)).join('')}</div>`;
    else body.innerHTML=`<div class="section-lead"><div><h2>Sources & curation</h2><p>Page numbers refer to the supplied PDF. Original papers are linked through their DOI.</p></div></div><div class="notice">Model review is not human verification. Classification and evidence grades remain provisional.</div><article class="assay-card"><h3>Record provenance</h3><dl><div><dt>Source PDF</dt><dd>${esc(p.file_name)}</dd></div><div><dt>PDF SHA256</dt><dd><code>${p.source_sha256}</code></dd></div><div><dt>Response SHA256</dt><dd><code>${p.response_sha256}</code></dd></div><div><dt>Review method</dt><dd>ADK tool-assisted PDF review · ${esc(p.verification.model)}</dd></div><div><dt>Classification</dt><dd>${unique(p.claims.map(c=>methods(c.classification.classification_method))).map(esc).join('<br>')||'No claims'}</dd></div></dl></article>${p.review_notes.length?`<article class="assay-card"><h3>Review notes</h3><ul>${p.review_notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul></article>`:''}<h2 class="section-title">Source locations</h2><div class="source-grid">${p.sources.map(s=>`<article class="source-card"><span class="eyebrow">PDF PAGE ${s.pdf_page} · ${esc(s.kind)}</span><h3>${esc(s.label)}</h3><p>${esc(s.paraphrase)}</p><small>${esc(s.file_name)}</small></article>`).join('')}</div>`;
  }
  const dialog=document.querySelector('#detail');
  function openPair(p,pair) {
    const c=p.cm[pair.compound_id],bio=p.mm[pair.biochemical_id],cell=p.mm[pair.cellular_id];
    document.querySelector('#detail-content').innerHTML=`<div class="dialog-top"><span class="eyebrow">COMPOUND PAIR RECORD</span><button class="close" aria-label="Close compound details" data-action="close">×</button></div><h2 id="dialog-title">${esc(name(c))}</h2><p class="muted">${esc(c.label)} · ${esc(p.folder.replace(/^c3_/,''))}</p><div class="comparison">${[[bio,'BIOCHEMICAL'],[cell,'CELLULAR']].map(([m,label])=>`<div><span class="eyebrow">${label}</span>${measurement(m)}<p>${esc(p.am[m.assay_id].description)}</p>${sources(p,m.source_ids)}<details><summary>Original measurement & assay</summary><p>Reported: ${esc(m.raw)} · ${esc(m.unit)}</p><p>${esc(m.footnote_notes||'')}${esc(m.precision_note||'')}</p>${m.graph_method?`<p>Graph method: ${esc(m.graph_method)}</p>`:''}${assayCard(p,p.am[m.assay_id])}</details></div>`).join('')}</div><div class="ratio-strip"><span>Cellular / biochemical concentration</span><strong>${esc(ratioText(pair.ratio))}</strong></div><p>${esc(pair.rationale)}</p>${pair.limitations.length?`<div class="limitations"><h3>Comparison limitations</h3><ul>${pair.limitations.map(l=>`<li>${esc(l)}</li>`).join('')}</ul></div>`:''}${pair.ratio.reason?`<p class="muted">${esc(pair.ratio.reason)}</p>`:''}<h3 class="section-title">Explanations linked to this compound</h3>${pair.claim_ids.map(id=>claimCard(p,p.clm[id])).join('')||'<p class="muted">No compound-linked author explanation was extracted. No reason has been inferred from other compounds in this paper.</p>'}<details class="structure"><summary>Compound identity & structure notes</summary><p>${esc(c.structure_notes||'No structure notes reported.')}</p><p>Aliases: ${esc((c.aliases||[]).join(', ')||'Not reported')}</p>${c.provided_smiles?`<p>Provided SMILES · not independently validated</p><code>${esc(c.provided_smiles)}</code>`:'<p>No SMILES supplied. Structure identity is retained through paper-local labels and source references.</p>'}${sources(p,c.structure_source_ids)}</details><p class="muted small">Pair ID: <code>${pair.pair_id}</code></p>`;
    dialog.setAttribute('aria-labelledby','dialog-title');dialog.showModal();dialog.scrollTop=0;
  }
  function renderAbout() { main.innerHTML=`<section class="about"><div class="eyebrow">CURATION & PROVENANCE</div><h1>Read the measurements.<br>Keep the evidence in view.</h1><p class="about-lead">CellPotency brings together reported biochemical and cellular potencies with the authors’ explanations for differences between them.</p>${stats()}<div class="about-grid"><article><h2>What is included?</h2><p>63 completed canonical ADK PDF reviews: 53 original reviews and 10 additional collection-c3 reviews. There are 979 explicit same-compound pairs in 62 papers, and 114 reason claims in 61 papers. The unfinished Rai2020 review is excluded. Sassano2013 is retained as a completed review with no qualifying pairs.</p><p>Compounds use paper-local identities. The 605 compound records are not a count of globally unique chemical structures. This site preserves all recorded endpoints, bounds and target-comparison flags; the corpus is not filtered to numerical potency loss.</p><h2>How are reasons linked?</h2><p>Each explanation is linked only to the compounds named in that claim. 731 pairs have at least one supported or proposed compound-linked reason. Another 248 do not. Ruled-out, mixed and unclear assertions remain visible and do not count as eligible explanations. Mechanism categories overlap across pairs.</p><h2>What does the ratio mean?</h2><p>Cell / bio = cellular concentration divided by biochemical concentration, after conversion to the same molar units. A ratio of 10 means ten times the concentration is required for the recorded cellular endpoint. This operational comparison does not establish a mechanism, intracellular exposure or assay equivalence.</p><p>Bounds and estimates stay labelled. Unsupported units, logarithmic endpoints, nonpositive values and flagged target relationships have no calculated ratio. Ranges use brackets for inclusive bounds and parentheses for open bounds. Different endpoint types and conditions must be interpreted in context.</p></article><article><h2>How was the data reviewed?</h2><p>Initial Gemini 3.8 Flash native-PDF extraction was followed by Gemini 4 Argon tool-assisted PDF review. These are model-reviewed records; independent human adjudication is pending.</p><h2>Classification provenance</h2><p>98 claims from the original 53 papers reuse the separate Argon v2 classifications. The remaining 16 claims use offline assistant semantic review. Ten of those additional assignments carry review flags. This is mixed-provenance classification, not uniform Argon classification.</p><p>The three molecular-chameleonicity pairs all derive from a provisional González2023 assignment. Conformational switching was not directly demonstrated, and physicochemical properties remain an alternative classification.</p><h2>Evidence grades</h2><ol class="grade-list"><li>Author statement or hypothesis</li><li>Association / correlation</li><li>Relevant mechanistic measurement</li><li>Controlled causal intervention</li><li>Rescue plus independent mechanistic evidence and controls</li></ol><p>Displayed grades are the extraction’s model-proposed 1–5 grades, with their original rationale. They are not human-adjudicated gold labels or the benchmark’s separate 0–4 scale. Missing is ungraded.</p></article></div><div class="about-downloads"><a class="button" download href="pairs.csv">Download pairs · CSV</a><a class="button secondary" download href="data.json">Complete data · JSON</a><a class="button secondary" href="manifest.json">Provenance manifest</a></div><p class="muted">Corpus snapshot: 6 November 2026. Source PDFs are not redistributed. DOI links lead to the original publications. No new model calls were made for this site.</p></section>`; }
  function downloadPaper(p) {
    const {cm,mm,am,clm,sm,search,targets,...clean}=p;
    const url=URL.createObjectURL(new Blob([JSON.stringify(clean,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`paper-${p.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function route() {
    if(dialog.open)dialog.close();
    const [view,id,tab] = location.hash.slice(1).split('/');
    document.querySelectorAll('[data-nav]').forEach(a=>{const active=a.dataset.nav===(view==='paper'?'papers':view||'papers');if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    if(view==='paper'){
      const p=D.papers.find(p=>p.id===id);
      if(p){renderPaper(p,tab);document.title=`${p.title} · CellPotency`;}
      else main.innerHTML='<div class="empty"><h1>Paper not found</h1><a href="#papers">Return to the collection</a></div>';
    }else if(view==='about'){renderAbout();document.title='About the data · CellPotency';}
    else{if(state.view!==(view==='pairs'?'pairs':'papers')){state.page=1;state.sort='title';}renderBrowse(view==='pairs'?'pairs':'papers');document.title='CellPotency · Literature evidence explorer';}
    window.scrollTo(0,0);
  }
  document.addEventListener('input',e=>{if(e.target.id==='search'){state.q=e.target.value;state.page=1;renderResults();}});
  document.addEventListener('change',e=>{
    if(e.target.dataset.filter){state[e.target.dataset.filter]=e.target.type==='checkbox'?e.target.checked:e.target.value;state.page=1;renderResults();}
    if(e.target.id==='sort'){state.sort=e.target.value;state.page=1;renderResults();}
  });
  document.addEventListener('click',e=>{
    const action=e.target.closest('[data-action]')?.dataset.action;
    if(action==='close')dialog.close();
    if(action==='reset'){state={...state,q:'',cause:'',target:'',year:'',status:'',linked:false,page:1};renderBrowse(state.view);}
    if(action==='prev'||action==='next'){state.page+=action==='next'?1:-1;renderResults();document.querySelector('.results').scrollIntoView({block:'start'});}
    const pairButton=e.target.closest('[data-pair]');
    if(pairButton){const p=D.papers.find(p=>p.id===pairButton.dataset.paper);openPair(p,p.pairs.find(pair=>pair.pair_id===pairButton.dataset.pair));}
    const download=e.target.closest('[data-download-paper]');if(download)downloadPaper(D.papers.find(p=>p.id===download.dataset.downloadPaper));
  });
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!dialog.open){const search=document.querySelector('#search');if(search){e.preventDefault();search.focus();}}});
  window.addEventListener('hashchange',route);route();
})();
