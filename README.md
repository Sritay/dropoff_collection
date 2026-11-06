# CellPotency

A static literature evidence explorer for the `dropoff_collection` GitHub Pages repository.
Open a paper, inspect its same-compound biochemical/cellular potency pairs, and follow
the compound-linked author explanations, experiments, grades and source pages.

## Contents

- `dist/`: complete publishable website, including its exported data. No installation or build required.
- `tools/export_data.py`: reproducible, read-only export from the project’s canonical completed reviews.
- `tests/test_dataset.py`: corpus, compound-link, classification, ratio and download checks.
- `.github/workflows/pages.yml`: validate and publish `dist/` using GitHub Actions.
- `tools/browser_qa.py`: checks using the existing Firefox ESR and Marionette, without installing drivers.

The website supports full-text search, mechanism/target/year/assertion filters,
paper and pair browsing, sortable paginated tables, paper sections, compound details,
CSV/JSON downloads and mobile layouts. Hash routes work under a GitHub Pages
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

Expected URL after successful deployment: `https://sritay.github.io/dropoff_collection/`.
The URL is not a claim that deployment has already happened.

The workflow follows the [GitHub Pages custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
It publishes only `dist/`, never the research project, source PDFs, model responses,
credentials, benchmark private references or spending ledgers. Source documents
remain accessible via DOI links and recorded PDF page references.

## Refresh the data

On Barkla, from `/users/sritay/fastscratch/assay_cell_dropoff2`:

```bash
sbatch slurm/build_website.sbatch
sbatch slurm/test_website_browser.sbatch
```

The export uses only direct `verification/agent_verified/*/response_verified.json`
files with completed status. It checks classification joins against exact PDF
hashes, verified-response hashes and request keys. Every pair’s eligible claim
links reconcile against the existing full-corpus pair audit. Frozen research
inputs and old outputs are unchanged. No model/API calls are made.

The exporter deliberately pins the 6 November 2026 classification/audit snapshot
and expected totals. For a new corpus version, update the pinned paths and
scientific regression expectations together; do not silently absorb new files.

Outside Barkla, with a copy of the original project:

```bash
python3 tools/export_data.py --project-root /path/to/assay_cell_dropoff2
python3 -m unittest discover -s tests -v
node --check dist/app.js
```

## Scientific interpretation

The snapshot contains 63 completed reviews, 605 paper-local compound records,
979 explicit potency pairs and 114 reason claims. Compound records are not
globally deduplicated chemical identities. 731 pairs have supported/proposed
compound-linked reasons; 248 do not. No paper-level reason is propagated to
unmentioned compounds. All assertion statuses remain visible.

The original 98 claims reuse Argon v2 classifications; 16 added claims use offline
assistant semantic review. Those methods stay attached to individual claims.
González2023 chameleonicity remains explicitly provisional. These are model-reviewed
extractions, not human-verified facts. The displayed evidence grades are original
model-proposed extraction grades on the 1–5 scale, with their rationale.

Cell/bio ratios use existing deterministic concentration-unit and interval
functions. Bounds, graph estimates and comparison limitations are retained.
Logarithmic endpoints, unsupported units, nonpositive values and flagged target
relationships do not receive computed ratios. An operational concentration ratio
does not establish assay equivalence or explain the mechanism of potency loss.

No paper reuse license is inferred from open-access status. PDFs, figure crops
and reconstructed chemical drawings are not part of this static release. Source
labels, PDF pages, structure notes and supplied SMILES remain available in records.

`dist/manifest.json` contains the input SHA256 hashes and export provenance.
