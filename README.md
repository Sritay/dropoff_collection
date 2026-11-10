# CellPotency

A static literature evidence explorer for the `dropoff_collection` GitHub Pages repository.
Open a paper, inspect its same-compound biochemical/cellular potency pairs, and follow
the compound-linked author explanations, experiments, grades and source pages.

## Contents

- `dist/`: complete publishable website, including its exported data. No installation or build required.
- `tools/export_data.py`: reproducible, read-only export from the project’s canonical completed reviews.
- `tests/test_dataset.py`: corpus, compound-link, classification, ratio and download checks.
- `.github/workflows/pages.yml`: validate and publish `dist/` using GitHub Actions.
- `tools/browser_qa.py`: checks using the existing Firefox ESR and Marionette, without installing drivers. Route stress checks and realistic structure/review/mobile flows use separate fresh sessions.

The website supports full-text search, mechanism/target/year/assertion and SMILES filters,
paper and pair browsing, sortable paginated tables, paper sections with scientific source locations, compound details,
CSV/JSON downloads and mobile layouts. The **Compounds & SMILES** paper tab lists
all compounds, including entries without a paired potency record. Hash routes work under a GitHub Pages
repository subpath and on refresh. All assets are local; no external scripts,
fonts, analytics or API calls are needed.

## Preview

Open `dist/index.html` directly in a browser. `data.js` supports direct file previews
without a local server. Alternatively, serve `dist/` with an ordinary static web server.

## GitHub Pages

Put **the contents of this `website/` directory** at the repository root, preserving
the hidden `.github/` directory and `dist/.nojekyll`.

1. Create `Sritay/dropoff_collection` and push these files to its `main` branch.
2. In the repository, open **Settings → Pages → Build and deployment → Source**,
   and choose **GitHub Actions**.
3. Run the **Publish CellPotency** workflow, or push a change to `main`.

Live site: `https://sritay.github.io/dropoff_collection/`.

The workflow follows the [GitHub Pages custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
It publishes only `dist/`, never the research project, source PDFs, model responses,
credentials, benchmark private references or spending ledgers. Source documents
remain accessible via DOI links and recorded PDF page references.

## Refresh the data

On Barkla, from `/users/sritay/fastscratch/assay_cell_dropoff2`:

```bash
sbatch slurm/build_website.sbatch
sbatch --mem=6G slurm/test_website_browser.sbatch
```

The export uses only direct `verification/agent_verified/*/response_verified.json`
files with completed status. It checks classification joins against exact PDF
hashes, verified-response hashes and request keys. Every pair’s eligible claim
links reconcile against the existing full-corpus pair audit. Frozen research
inputs and old outputs are unchanged. No model/API calls are made.

The exporter deliberately pins the 6 November 2026 classification/audit snapshot
and expected totals. For a new corpus version, update the pinned paths and
scientific regression expectations together; do not silently absorb new files.

The 10 November SMILES overlay is independently joined by the canonical paper-local
compound ID, exact response/PDF hashes and request key. It adds 236 ChEMBL reference
entries across the same 605 compounds. A separate audit of names found in paper PDFs
adds candidates for 54 previously unresolved compounds, bringing the total with at
least one SMILES to 290; 315 still have none. These name-derived structures remain
unverified. Four compounds lack a nearby paper label for their names, and two have
conflicting name-derived graphs. Both limitations are shown explicitly. Six of the 236
also have unverified extraction candidates. Four candidates match their ChEMBL graph
exactly and two differ in connectivity. A pending follow-up never hides earlier
candidates. Eleven database mappings retain their original review warnings, and
graph-level stereochemical limitations remain visible separately.

Structure data come from `verification/chembl37_structure_lookup-11217655/smiles_matched.csv`
the explicit original pilot/control/follow-up resolver exports, and the hash-bound
`verification/smiles_opsin_name_audit_2026-11-10_v4` audit. The manifest
records every overlay input hash. Only scientific fields and source locations are
published: no model request payloads, crop text/images, backend setup, budgets,
ledgers or node-local paths. The existing RDKit installation generates local structure
diagrams packed into the data assets to avoid hundreds of files.
Exporting requires RDKit; testing or serving the exported website does not.

ChEMBL 37 reference structure data are attributed to
[ChEMBL](https://www.ebi.ac.uk/chembl/) under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). This attribution
does not assign that licence to the original papers, PDFs or the rest of the corpus.

## Manual SMILES checks

Open **Compounds & SMILES** for a paper, then **Compare**. The dialog shows ChEMBL
references, paper-name/OPSIN candidates and agent candidates separately, with local molecular drawings,
copyable exact SMILES, the ChEMBL entry link, paper page/table locations and
automated graph comparison. Neither an automated match nor a valid graph verifies
the paper assignment or complete stereochemistry. A valid name conversion does not
establish that a name belongs to the compound number or matches its drawing.
Candidate, name-conflict, identity and mapping warnings
remain visible when review notes are added. Original structure notes are navigation
hints, not verified chemical truth.

Each displayed SMILES has its own manual verdict (not reviewed, matches the paper,
differs, or uncertain). Paper-viewed/ChEMBL-viewed checkboxes record what was inspected;
they do not imply that every displayed structure is correct. Notes are saved only in
the current browser's local storage. **Download all my reviews JSON** provides a
backup; there is no server sync or automatic update of the research dataset. A
verdict becomes inactive if the source response/PDF, a reference/candidate SMILES,
or a paper-name candidate's names/pages/source flags change. Old notes remain in the downloaded backup with their data version marked
stale. Imported human decisions remain separate from browser-local notes.

Outside Barkla, with a copy of the original project:

```bash
python3 tools/export_data.py --project-root /path/to/assay_cell_dropoff2
python3 -m unittest discover -s tests -v
node --check dist/app.js
```

## Scientific interpretation

The snapshot contains 63 completed reviews, 605 compound records (counted separately in each paper),
979 explicit potency pairs and 114 reason claims. Compound records are not
globally deduplicated chemical identities. 731 pairs have supported/proposed
compound-linked reasons; 248 do not. No paper-level reason is propagated to
unmentioned compounds. All assertion statuses remain visible.

The original 98 claims reuse Argon v2 classifications; 16 added claims use offline
assistant semantic review. Those methods stay attached to individual claims.
González2023 chameleonicity remains explicitly provisional. These are model-reviewed
extractions, not human-verified facts. The displayed evidence grades are original
model-proposed extraction grades on the 1–5 scale, with their rationale.

Cell/bio ratios use concentration-unit and interval functions. Explicit endpoint
aliases such as Cellular IC50, IC50,TE, KD-APP and Ki_app are recognised without
changing the reported labels. Negative-log molar potencies are converted using
c[nM] = 10**(9-p), with reversed inequality signs and range endpoints. Survival
and half-maximal degradation concentrations retain their original endpoint
definitions. Bounds, graph estimates and comparison limitations are retained.
Association constants in inverse-molar units, unsupported units, nonpositive
concentrations and flagged target relationships do not receive computed ratios.
The current snapshot has 948 calculated ratios and 31 not calculated: 16 binding
association-constant comparisons and 15 flagged target relationships. Some
calculated intervals have no useful bound when both measurements are censored. An operational concentration ratio
does not establish assay equivalence or explain the mechanism of potency loss.

No paper reuse license is inferred from open-access status. PDFs and figure crops
are not part of this static release. The included molecular diagrams are generated
locally from the attributed ChEMBL/reference and unverified candidate graphs, not
copied manuscript figures. Source labels, PDF pages and structure notes remain
available in records; the original provided-SMILES field is preserved separately.

`dist/manifest.json` contains the input SHA256 hashes and export provenance.

The public interface focuses on papers, compounds, assays and evidence. Collection
methods, review workflow, file checksums and internal identifiers are kept in the
repository and data files rather than displayed as website pages.
