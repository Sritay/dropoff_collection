"""Integrity checks runnable in Slurm and independently in GitHub Actions."""
import csv
import importlib.util
import json
import math
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
D = json.loads((ROOT / 'dist/data.json').read_text())
spec = importlib.util.spec_from_file_location('export_data', ROOT / 'tools/export_data.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class DatasetTests(unittest.TestCase):
    def test_canonical_population(self):
        self.assertEqual(len(D['papers']), 63)
        self.assertEqual(sum(bool(p['pairs']) for p in D['papers']), 62)
        self.assertEqual(sum(bool(p['claims']) for p in D['papers']), 61)
        self.assertEqual(sum(len(p['pairs']) for p in D['papers']), 979)
        self.assertEqual(sum(len(p['claims']) for p in D['papers']), 114)
        self.assertEqual(len({p['source_sha256'] for p in D['papers']}), 63)
        self.assertFalse(any(p['folder'] == 'Rai2020' for p in D['papers']))

    def test_compound_specific_links_and_source_references(self):
        seen = set()
        for p in D['papers']:
            measurements = {m['measurement_id']: m for m in p['measurements']}
            assays = {a['assay_id']: a for a in p['assays']}
            compounds = {c['compound_id'] for c in p['compounds']}
            sources = {s['source_id'] for s in p['sources']}
            for item in p['measurements'] + p['assays'] + p['claims']:
                self.assertTrue(set(item['source_ids']) <= sources)
            for c in p['claims']:
                self.assertTrue(set(c['compound_ids']) <= compounds)
                for e in c['evidence']:
                    self.assertTrue(set(e['source_ids']) <= sources)
            for pair in p['pairs']:
                self.assertNotIn(pair['pair_id'], seen)
                seen.add(pair['pair_id'])
                bio, cell = measurements[pair['biochemical_id']], measurements[pair['cellular_id']]
                self.assertEqual(bio['compound_id'], cell['compound_id'])
                self.assertEqual(bio['compound_id'], pair['compound_id'])
                self.assertEqual(assays[bio['assay_id']]['assay_class'], 'biochemical')
                self.assertEqual(assays[cell['assay_id']]['assay_class'], 'cellular')
                expected = [c['claim_id'] for c in p['claims'] if pair['compound_id'] in c['compound_ids']]
                self.assertEqual(pair['claim_ids'], expected)
                eligible = [c['claim_id'] for c in p['claims'] if c['claim_id'] in expected
                            and c['classification']['assertion_status'] in ('supported', 'proposed')]
                self.assertEqual(pair['eligible_claim_ids'], eligible)
        self.assertEqual(len(seen), 979)

    def test_reconciles_existing_category_audit(self):
        counts = Counter()
        eligible = 0
        for paper in D['papers']:
            claims = {c['claim_id']: c for c in paper['claims']}
            for pair in paper['pairs']:
                eligible += bool(pair['eligible_claim_ids'])
                counts.update({claims[i]['classification']['cause_id'] for i in pair['eligible_claim_ids']})
        self.assertEqual(eligible, 731)
        self.assertEqual(dict(counts), {
            'physicochemical_defects':89, 'multitarget_binding':11, 'molecular_chameleonicity':3,
            'metabolism_efflux':110, 'intracellular_competition':113, 'target_conformation_ptm':10,
            'target_localization_oligomerization':13, 'permeability':280, 'other_reasons':262})

    def test_mixed_classification_provenance(self):
        methods = Counter(c['classification']['classification_method'] for p in D['papers'] for c in p['claims'])
        self.assertEqual(methods['reused_gemini_4_argon_v2'], 98)
        self.assertEqual(sum(methods.values()), 114)
        self.assertEqual(sum(v for k,v in methods.items() if k != 'reused_gemini_4_argon_v2'), 16)
        self.assertTrue(all(not p['verification']['human_verified'] for p in D['papers']))

    def test_bounds_and_unsupported_comparisons(self):
        exact = bounded = unavailable = 0
        for p in D['papers']:
            ms = {m['measurement_id']:m for m in p['measurements']}
            for pair in p['pairs']:
                r = pair['ratio']
                b,c = ms[pair['biochemical_id']], ms[pair['cellular_id']]
                if not pair['same_target_relationship']:
                    self.assertEqual(r['status'], 'unavailable')
                if r['status'] == 'unavailable':
                    unavailable += 1
                elif b['comparator'] in ('<','<=','>','>=','range') or c['comparator'] in ('<','<=','>','>=','range'):
                    bounded += 1
                    self.assertIsNone(r['value'])
                else:
                    exact += 1
                if b['origin']=='graph_estimate' or c['origin']=='graph_estimate':
                    if r['status'] != 'unavailable':
                        self.assertTrue(r['estimated'])
        self.assertGreater(exact, 0)
        self.assertGreater(bounded, 0)
        self.assertGreater(unavailable, 0)

    def test_ratio_guards(self):
        dummy = lambda m: {'ok': True}
        divide = lambda n,d: {'status':'central_value_ratio'}
        m = {'endpoint':'IC50','comparator':'=','unit':'nM','value':2}
        for edit in ({'endpoint':'pIC50'},{'value':0},{'value':-1},{'comparator':'unknown'}):
            self.assertEqual(exporter.ratio(m,{**m,**edit},True,dummy,divide)['status'], 'unavailable')
        self.assertEqual(exporter.ratio(m,m,False,dummy,divide)['status'], 'unavailable')

    def test_negative_log_conversion_and_bound_direction(self):
        m = {'endpoint':'pIC50','unit':'-log10(M)','value':7.89,'comparator':'=','origin':'table'}
        converted,error = exporter.concentration_measurement(m)
        self.assertIsNone(error)
        self.assertAlmostEqual(converted['value'], 10**(9-7.89))
        self.assertEqual(converted['unit'], 'nM')
        self.assertEqual(m['unit'], '-log10(M)')
        for a,b in [('<','>'),('<=','>='),('>','<'),('>=','<=')]:
            converted,error = exporter.concentration_measurement({**m,'comparator':a,'value':5})
            self.assertIsNone(error)
            self.assertEqual(converted['comparator'], b)
            self.assertAlmostEqual(converted['value'], 10000)
        converted,error = exporter.concentration_measurement({**m,'comparator':'range','lower':6,'upper':8,'value':None})
        self.assertIsNone(error)
        self.assertEqual((converted['lower'],converted['upper']),(10,1000))
        self.assertIsNone(exporter.concentration_measurement({**m,'value':-1})[1])

    def test_descriptive_endpoints_and_association_constant(self):
        for endpoint in ['Cellular IC50','IC50,TE','BCAA IC50','IC50,perm','IC50,external',
                         'IC50,biochem','IC50,cell','KD-APP','Ki_app','growth IC50','SF50','SF80','Dmax50']:
            m={'endpoint':endpoint,'unit':'nM','comparator':'=','value':2}
            converted,error=exporter.concentration_measurement(m)
            self.assertIsNone(error, endpoint)
            self.assertEqual(converted, m)
        converted,error=exporter.concentration_measurement({'endpoint':'K','unit':'10^6 M^-1','comparator':'=','value':14.2})
        self.assertIsNone(converted)
        self.assertIn('association constant',error)

    def test_exported_log_ratios_and_remaining_exclusions(self):
        log_pairs=0
        reasons=Counter()
        for paper in D['papers']:
            ms={m['measurement_id']:m for m in paper['measurements']}
            for pair in paper['pairs']:
                r=pair['ratio']
                if r['status']=='unavailable':
                    reasons[r['reason']]+=1
                b,c=ms[pair['biochemical_id']],ms[pair['cellular_id']]
                if b['unit'] in ['-log10(M)','-log(M)'] and c['unit'] in ['-log10(M)','-log(M)']:
                    log_pairs+=1
                    self.assertNotEqual(r['status'],'unavailable')
                    self.assertIn('conversion_note',r)
                    if b['comparator']=='=' and c['comparator']=='=':
                        self.assertTrue(math.isclose(r['value'],10**(b['value']-c['value']),rel_tol=1e-12))
                    if b['comparator']=='<' and c['comparator']=='=':
                        self.assertAlmostEqual(r['upper'],10**(b['value']-c['value']))
                        self.assertFalse(r['upper_inclusive'])
        self.assertEqual(log_pairs,60)
        self.assertEqual(sum(reasons.values()),31)
        self.assertEqual(sorted(reasons.values()),[15,16])

    def test_downloads_match(self):
        with (ROOT/'dist/pairs.csv').open() as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(len(rows), 979)
        self.assertEqual({r['pair_id'] for r in rows}, {x['pair_id'] for p in D['papers'] for x in p['pairs']})
        js = (ROOT/'dist/data.js').read_text()
        self.assertEqual(json.loads(js.removeprefix('window.CELL_POTENCY_DATA=').strip().removesuffix(';')), D)
        for file in ('index.html','app.js','styles.css','icon.svg','.nojekyll','manifest.json'):
            self.assertTrue((ROOT/'dist'/file).exists(), file)
        manifest = json.loads((ROOT/'dist/manifest.json').read_text())
        self.assertEqual(len(manifest['source_responses']), 63)
        self.assertEqual(manifest['paid_calls'], 0)
        self.assertFalse(manifest['pdfs_included'])


if __name__ == '__main__':
    unittest.main()
