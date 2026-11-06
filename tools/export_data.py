"""Export completed canonical reviews to a self-contained GitHub Pages dataset.

Standard library only. Run corpus processing on Slurm on Barkla.
The original reviews and classifications are never modified.
"""
import argparse
import csv
import hashlib
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

CLASSIFICATION = 'verification/reason_classification_v3/combined-63-review-11173496/reasons_classified.json'
AUDIT = 'verification/figures/pair_counts_all_verified-11173496/pair_audit.json'


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def concentration_measurement(measurement):
    """Return a calculation-only copy; preserve published labels/values in the data.

    Only explicitly mapped endpoints are accepted. Negative-log molar potencies
    are converted with c[nM] = 10**(9-p); decreasing transforms reverse bounds.
    This does not convert association constants into dissociation constants.
    """
    m = dict(measurement)
    key = re.sub(r'[^a-z0-9]', '', m['endpoint'].lower())
    aliases = {'cellularic50':'ic50', 'ic50te':'ic50', 'bcaaic50':'ic50',
               'ic50perm':'ic50', 'ic50external':'ic50', 'ic50biochem':'ic50',
               'ic50cell':'ic50', 'kdapp':'kd', 'kiapp':'ki', 'growthic50':'ic50',
               'cellpic50':'pic50'}
    key = aliases.get(key, key)
    if m['unit'].replace(' ', '') == '10^6M^-1':
        return None, 'Binding association constant (1/M), not a concentration.'
    log_value = key in {'pic50','pec50','pki','pkd','pgi50','pcc50','pdc50','pac50'}
    if not log_value and key not in {'ic50','ec50','ki','kd','gi50','cc50','dc50','ac50','sf50','sf80','dmax50'}:
        return None, 'Endpoint needs review before calculating a concentration ratio.'
    if log_value and m['unit'].replace(' ', '') not in {'-log10(M)', '-log(M)'}:
        return None, 'Log potency is not explicitly reported relative to molar concentration.'
    if m['comparator'] not in ('=', '~', '<', '<=', '>', '>=', 'range'):
        return None, 'Measurement bound is not recognised.'
    values = [m.get('lower'),m.get('upper')] if m['comparator']=='range' else [m.get('value')]
    if any(v is None or not math.isfinite(v) or (not log_value and v <= 0) for v in values):
        return None, 'A positive concentration is needed.'
    if len(values)==2 and values[0] > values[1]:
        return None, 'Reported range needs review.'
    if log_value:
        try:
            converted = [10.0 ** (9-v) for v in values]
        except OverflowError:
            return None, 'Log potency is outside the supported numerical range.'
        if any(not math.isfinite(v) or v <= 0 for v in converted):
            return None, 'Log potency is outside the supported numerical range.'
        m['unit'] = 'nM'
        if m['comparator']=='range':
            m['lower'],m['upper'] = converted[1],converted[0]
        else:
            m['value'] = converted[0]
            m['comparator'] = {'<':'>','<=':'>=','>':'<','>=':'<='}.get(m['comparator'],m['comparator'])
    return m, None


def ratio(bio, cell, same_target, interval, divide):
    if not same_target:
        return {'status':'unavailable', 'reason':'Target relationship flagged in review; ratio not calculated.'}
    normalised = []
    for m in (bio, cell):
        converted, error = concentration_measurement(m)
        if error:
            return {'status':'unavailable', 'reason':error}
        normalised.append(converted)
    result = divide(interval(normalised[1]), interval(normalised[0]))
    if result['status'] == 'unavailable':
        result['reason'] = 'Units cannot be converted to the same concentration scale.'
    elif any(re.sub(r'[^a-z0-9]', '', m['endpoint'].lower()) in {'pic50','cellpic50','pgi50','pec50','pki','pkd','pcc50','pdc50','pac50'} for m in (bio,cell)):
        result['conversion_note'] = 'Calculated after converting negative-log molar values to concentrations; inequality signs are reversed during conversion.'
    return result


def export(root, output):
    sys.path.insert(0, str(root / 'src'))
    from potency.science import measurement_interval, divide_intervals
    classification_path = root / CLASSIFICATION
    audit_path = root / AUDIT
    classified = read(classification_path)
    by_claim = {(r['paper_sha256'], r['claim_id']): r for r in classified}
    assert len(by_claim) == len(classified)
    audits = {(r['paper_sha256'], r['biochemical_id'], r['cellular_id']): r for r in read(audit_path)}
    papers, pair_rows, hashes, seen = [], [], {}, set()
    for path in sorted((root / 'verification/agent_verified').glob('*/response_verified.json')):
        e = read(path)
        assert e['status'] == 'completed', path
        meta = e['verification']
        assert meta['method'] == 'adk_tool_assisted_pdf_review', path
        pdfs = [p for p in meta['inputs'] if p['file_name'].lower().endswith('.pdf')]
        assert len(pdfs) == 1
        source = pdfs[0]
        pdf_sha = source['sha256']
        assert pdf_sha not in seen, path
        seen.add(pdf_sha)
        digest = sha(path)
        hashes[str(path.relative_to(root))] = digest
        d = read(path)  # Parse envelope text, rather than a draft or original response.
        d = json.loads(d['text'])
        claims = []
        for claim in d['claims']:
            classification = by_claim[(pdf_sha, claim['claim_id'])]
            assert classification['raw_sha256'] == digest
            assert classification['request_key'] == meta['request_key']
            assert classification['author_explanation'] == claim['author_explanation']
            assert classification['compound_ids'] == claim['compound_ids']
            fields = ('cause_id', 'category', 'specific_cause', 'assertion_status', 'rationale',
                      'confidence', 'needs_review', 'classification_method', 'reason_id')
            claims.append({**claim, 'classification': {k: classification.get(k) for k in fields}})
        ms = {m['measurement_id']: m for m in d['measurements']}
        assays = {a['assay_id']: a for a in d['assays']}
        compounds = {c['compound_id']: c for c in d['compounds']}
        pairs, seen_pairs = [], set()
        for p in d['pairs']:
            key = (pdf_sha, p['biochemical_id'], p['cellular_id'])
            assert key not in seen_pairs, key
            seen_pairs.add(key)
            bio, cell = ms[p['biochemical_id']], ms[p['cellular_id']]
            assert bio['compound_id'] == cell['compound_id']
            assert assays[bio['assay_id']]['assay_class'] == 'biochemical'
            assert assays[cell['assay_id']]['assay_class'] == 'cellular'
            cid = bio['compound_id']
            claim_ids = [c['claim_id'] for c in claims if cid in c['compound_ids']]
            eligible_ids = [c['claim_id'] for c in claims if c['claim_id'] in claim_ids
                            and c['classification']['assertion_status'] in ('supported', 'proposed')]
            audit = audits[key]
            assert audit['raw_sha256'] == digest
            assert set(eligible_ids) == {r['claim_id'] for r in audit['reason_links']
                                       if r['assertion_status'] in ('supported', 'proposed')}
            pair_id = audit['pair_id']
            item = {**p, 'pair_id': pair_id, 'compound_id': cid, 'claim_ids': claim_ids,
                    'eligible_claim_ids': eligible_ids,
                    'ratio': ratio(bio, cell, p['same_target_relationship'], measurement_interval, divide_intervals)}
            pairs.append(item)
            compound = compounds[cid]
            pair_rows.append({'paper_id': pdf_sha[:16], 'title': d['title'], 'doi': d.get('doi'),
                'pair_id': pair_id, 'compound_id': cid, 'compound': compound.get('name') or compound['label'],
                'biochemical_endpoint': bio['endpoint'], 'biochemical_comparator': bio['comparator'],
                'biochemical_value': bio.get('value'), 'biochemical_lower': bio.get('lower'),
                'biochemical_upper': bio.get('upper'), 'biochemical_raw': bio['raw'], 'biochemical_unit': bio['unit'],
                'cellular_endpoint': cell['endpoint'], 'cellular_comparator': cell['comparator'],
                'cellular_value': cell.get('value'), 'cellular_lower': cell.get('lower'),
                'cellular_upper': cell.get('upper'), 'cellular_raw': cell['raw'], 'cellular_unit': cell['unit'],
                'same_target_relationship': p['same_target_relationship'],
                'claim_ids': ';'.join(claim_ids), 'eligible_claim_ids': ';'.join(eligible_ids),
                'ratio': json.dumps(item['ratio']), 'limitations': '; '.join(p['limitations'])})
        years = re.findall(r'(?:19|20)\d{2}', path.parent.name)
        papers.append({'id': pdf_sha[:16], 'folder': path.parent.name, 'year': int(years[-1]) if years else None,
            'title': d['title'], 'doi': d.get('doi'), 'file_name': source['file_name'],
            'source_sha256': pdf_sha, 'response_sha256': digest, 'request_key': meta['request_key'],
            'verification': {'method': meta['method'], 'model': e.get('model'), 'human_verified': False},
            'compounds': d['compounds'], 'assays': d['assays'], 'measurements': d['measurements'],
            'pairs': pairs, 'claims': claims, 'sources': d['sources'], 'interventions': d['interventions'],
            'coverage': d['coverage'], 'eligibility': d['eligibility'], 'insights': d['insights'],
            'review_notes': d['review_notes']})
    summary = {'papers': len(papers), 'paired_papers': sum(bool(p['pairs']) for p in papers),
               'compounds': sum(len(p['compounds']) for p in papers), 'pairs': len(pair_rows),
               'claims': sum(len(p['claims']) for p in papers),
               'pairs_with_eligible_reasons': sum(bool(p['eligible_claim_ids']) for d in papers for p in d['pairs']),
               'classification_methods': dict(Counter(c['classification']['classification_method'] for p in papers for c in p['claims']))}
    assert (summary['papers'], summary['pairs'], summary['claims'], summary['pairs_with_eligible_reasons']) == (63, 979, 114, 731), summary
    dataset = {'schema_version': 1, 'ratio_method':'concentration_units_and_negative_log_molar_v2', 'corpus_date': '2026-11-06', 'summary': summary,
               'taxonomy': read(root / 'config/reason_taxonomy.json')['causes'], 'papers': papers}
    output.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(dataset, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    (output / 'data.json').write_text(payload + '\n')
    # A script asset allows both GitHub Pages and direct file:// previews without fetch/CORS.
    (output / 'data.js').write_text('window.CELL_POTENCY_DATA=' + payload.replace('<', '\\u003c') + ';\n')
    with (output / 'pairs.csv').open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(pair_rows[0]))
        writer.writeheader()
        for row in pair_rows:
            # Protect spreadsheet consumers; JSON retains literal text.
            writer.writerow({k: "'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@')) else v for k, v in row.items()})
    manifest = {'summary': summary, 'source_responses': hashes, 'classification_path': CLASSIFICATION,
                'classification_sha256': sha(classification_path), 'pair_audit_path': AUDIT,
                'pair_audit_sha256': sha(audit_path), 'exporter_sha256': sha(Path(__file__)),
                'pdfs_included': False, 'paid_calls': 0}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(summary, indent=2))
    return dataset


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'dist')
    args = parser.parse_args()
    export(args.project_root, args.output)
