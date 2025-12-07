# CLAUDE.md - Alignment Viewer

## Project Overview

**Alignment Viewer** is a web-based bioinformatics tool for visualizing and analyzing sequence alignments. It supports both protein and DNA sequences, providing features like:

- Fetching sequences from UniProt
- FASTA file parsing
- Pairwise sequence alignment (global/local)
- Circular DNA alignment support
- Interactive visualization with customizable color schemes
- Sequence feature annotation
- Pattern search (regex and literal)
- Project save/load functionality

**Tech Stack:**
- **Backend:** FastAPI (Python 3.13+), Biopython, Pydantic v2
- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3
- **Key Libraries:** httpx (async HTTP), uvicorn (ASGI server)

---

## Architecture

This is a **client-server architecture** with a clear separation:

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (SPA)                    │
│  - HTML/CSS/JS                                      │
│  - State management in JS                           │
│  - REST API consumption                             │
└────────────────┬────────────────────────────────────┘
                 │ HTTP/JSON
┌────────────────▼────────────────────────────────────┐
│              FastAPI Backend                        │
│  - REST API endpoints                               │
│  - Sequence processing (Biopython)                  │
│  - Alignment algorithms                             │
│  - Static file serving                              │
└─────────────────────────────────────────────────────┘
```

**Design Principles:**
- RESTful API design
- Type-safe data models (Pydantic)
- Async I/O for external requests (UniProt)
- Stateless server (all state in client)
- JSON for all data interchange

---

## Directory Structure

```
alignment-viewer/
├── backend/                    # Python FastAPI application
│   ├── main.py                # FastAPI app, routes, server config
│   ├── alignment.py           # Sequence alignment logic (Biopython)
│   ├── schemas.py             # Pydantic data models
│   ├── sequences.py           # Sequence fetching/parsing (UniProt, FASTA)
│   └── __pycache__/           # Python bytecode cache
├── frontend/                   # Static web application
│   ├── index.html             # Main HTML structure
│   ├── app.js                 # JavaScript application logic
│   └── style.css              # CSS styles (dark theme)
├── color_schemes/              # Color scheme definitions (JSON)
│   ├── clustal.json           # Classic Clustal coloring
│   ├── mildliner.json         # Custom color scheme
│   └── nucleotide.json        # DNA/RNA coloring
├── examples/                   # Example project files
│   └── egfr-erbb2-project.json # Sample EGFR vs ERBB2 alignment
└── requirements.txt            # Python dependencies
```

---

## Backend Components

### 1. **main.py** - FastAPI Application

**Key Responsibilities:**
- Route definitions for all API endpoints
- Static file serving for frontend
- Error handling and HTTP exceptions

**Endpoints Structure:**
```python
# Sequence endpoints
GET  /api/uniprot/{accession}       # Fetch from UniProt
POST /api/parse-fasta                # Parse FASTA file
POST /api/parse-text                 # Parse pasted text
GET  /api/detect-type                # Detect DNA vs protein

# Alignment endpoints
POST /api/align                      # Run alignment
GET  /api/search                     # Search sequences

# Color scheme endpoints
GET  /api/color-schemes              # List available schemes
GET  /api/color-schemes/{name}       # Get specific scheme

# Project endpoints
POST /api/project/export             # Export project JSON
POST /api/project/import             # Import project file
```

**Running the Server:**
```bash
python backend/main.py  # Runs on http://0.0.0.0:8000
```

### 2. **alignment.py** - Alignment Engine

**Core Algorithm:** Uses Biopython's `PairwiseAligner` with custom scoring:
- Match score: +2
- Mismatch score: -1
- Gap open: -10
- Gap extend: -0.5

**Key Functions:**

```python
align_sequences(ref, query, is_circular=False, algorithm="global") -> AlignmentResult
```
- Performs global or local alignment
- For circular DNA: tries all rotations and picks best score
- Returns aligned sequences with gap characters and index mappings

```python
are_similar(a, b) -> bool
```
- Checks amino acid similarity based on physicochemical groups
- Groups: hydrophobic, aromatic, charged, polar, etc.

```python
search_sequence(sequence, pattern, use_regex=False) -> list[SearchMatch]
```
- Find pattern occurrences (literal or regex)
- Case-insensitive matching

**Important Implementation Details:**
- `ref_indices` and `query_indices` maintain original sequence positions
- `None` values in indices represent gap positions
- Circular alignment rotates query sequence to find optimal alignment

### 3. **schemas.py** - Data Models

**All models use Pydantic v2 for validation and serialization.**

```python
class Sequence(BaseModel):
    id: str                        # Accession or identifier
    name: str                      # Display name
    sequence: str                  # Raw sequence string
    organism: str                  # Source organism
    features: list[Feature]        # Annotations (domains, sites, etc.)
    source: str                    # "uniprot", "fasta", "paste"
```

```python
class AlignmentResult(BaseModel):
    reference: str                 # Aligned ref (with gaps)
    query: str                     # Aligned query (with gaps)
    ref_indices: list[int | None]  # Original positions (None = gap)
    query_indices: list[int | None]
    score: float                   # Alignment score
    identity: float                # % identical residues
    similarity: float              # % similar residues (protein only)
    length: int                    # Alignment length
```

```python
class Feature(BaseModel):
    type: str                      # "Domain", "Active site", etc.
    start: int                     # 0-indexed start position
    end: int                       # 0-indexed end position
    description: str
    color: str                     # Hex color code
```

**Model Validation:**
- Pydantic automatically validates types and constraints
- `.model_dump()` converts to JSON-serializable dict
- Models can be constructed from API JSON: `Sequence(**data)`

### 4. **sequences.py** - Sequence I/O

**UniProt Integration:**
```python
async fetch_uniprot(accession: str) -> Sequence
```
- Fetches from `https://rest.uniprot.org/uniprotkb/{accession}.json`
- Extracts sequence, features, organism, protein name
- Maps feature types to colors (defined in `FEATURE_COLORS`)

**FASTA Parsing:**
```python
parse_fasta(content: str) -> list[Sequence]
```
- Uses Biopython's `SeqIO.parse()`
- Handles multi-sequence FASTA files
- Fallback: treats content as raw sequence if no FASTA header

**Sequence Type Detection:**
```python
detect_sequence_type(sequence: str) -> str
```
- Returns "dna" if >90% of characters are ATGCUN
- Otherwise returns "protein"

---

## Frontend Components

### 1. **app.js** - Application State and Logic

**State Management:**
```javascript
const state = {
  ref: null,              // Reference Sequence object
  query: null,            // Query Sequence object
  alignment: null,        // AlignmentResult object
  colorScheme: null,      // ColorScheme object
  searchMatches: [],      // Array of SearchMatch objects
  currentMatch: -1,       // Current search result index
  cursorPos: null         // Current cursor position in alignment
};
```

**Key Functions:**

| Function | Purpose |
|----------|---------|
| `fetchUniprot(target)` | Fetch sequence from UniProt by accession |
| `loadFasta(file, target)` | Parse and load FASTA file |
| `runAlignment()` | Execute alignment and switch to view tab |
| `renderAlignment()` | Render alignment blocks with coloring |
| `renderSeqRow(label, seq, indices, offset)` | Render single sequence row |
| `renderConsensus(ref, query)` | Render match indicators (`\|` or `·`) |
| `setCursor(pos)` | Update cursor position and scroll to view |
| `doSearch()` | Search for pattern in alignment |
| `exportProject()` | Download project as JSON |
| `importProject(file)` | Load project from JSON file |

**Event Handling:**
- Click on residue → set cursor position
- Search input → Enter key triggers search
- Settings changes → re-render alignment

### 2. **index.html** - UI Structure

**Layout:**
- **Header:** Title + Save/Open project buttons
- **Tabs:** Input panel | Alignment view panel
- **Input Panel:**
  - Reference sequence input (UniProt/FASTA/paste)
  - Query sequence input
  - Circular DNA checkbox
  - Align button
- **Alignment Panel:**
  - Search bar with regex option
  - Alignment visualization (rendered by JS)
  - Sidebar: Legend, Settings, Stats, Features
- **Footer:** Status bar (position, residues)

**UI Patterns:**
- File inputs hidden in `<label>` buttons
- Tab switching via `data-tab` attributes
- Conditional visibility with `.hidden` class

### 3. **style.css** - Styling

**Design System:**
```css
:root {
  --bg: #0f1419;                    /* Dark background */
  --bg-secondary: #1a1f26;          /* Panel background */
  --accent: #00d4aa;                /* Primary accent color */
  --font-mono: 'JetBrains Mono';    /* Monospace for sequences */
}
```

**Key Classes:**
- `.residue` - Individual sequence character
- `.highlight` - Search match highlighting
- `.cursor` - Current cursor position
- `.consensus-char` - Match/mismatch indicators
- `.feature-item` - Clickable feature annotations

**Responsive Layout:**
- Flexbox-based layouts
- Monospace font for sequence alignment
- Smooth scrolling to cursor position

---

## Color Schemes

Color schemes are JSON files defining residue colors:

```json
{
  "name": "Clustal",
  "description": "Classic Clustal-style coloring",
  "type": "protein",
  "colors": {
    "A": {"bg": "#80a0f0", "fg": "#000"},
    "K": {"bg": "#f01505", "fg": "#fff"},
    "-": {"bg": "transparent", "fg": "#666"},
    "default": {"bg": "#ddd", "fg": "#333"}
  }
}
```

**Available Schemes:**
- **clustal.json** - Classic Clustal colors (hydrophobic blue, charged red/magenta)
- **nucleotide.json** - DNA/RNA coloring
- **mildliner.json** - Custom pastel scheme

**Creating New Schemes:**
1. Create JSON file in `color_schemes/`
2. Define colors for each residue (single letter code)
3. Include `default` for unknown residues
4. Use `"transparent"` for gap background

---

## Development Workflow

### Initial Setup

```bash
# 1. Install Python dependencies
pip install -r requirements.txt

# 2. Start the server
cd backend
python main.py

# 3. Open browser
# Navigate to http://localhost:8000
```

### Project Dependencies

```
fastapi>=0.104.0          # Web framework
uvicorn[standard]>=0.24.0 # ASGI server
biopython>=1.82           # Sequence analysis
httpx>=0.25.0             # Async HTTP client
pydantic>=2.5.0           # Data validation
python-multipart>=0.0.6   # File upload support
```

### Testing Workflow

**Manual Testing:**
1. Load example project: `examples/egfr-erbb2-project.json`
2. Test UniProt fetch: Use accessions like `P00533` (EGFR)
3. Test FASTA upload: Use any `.fasta` file
4. Test search: Try patterns in aligned sequences

**Common Test Cases:**
- Global vs local alignment
- Circular DNA alignment
- Regex search patterns
- Color scheme switching
- Project save/load cycle

---

## Code Conventions

### Python (Backend)

**Style:**
- Follow PEP 8 conventions
- Type hints required for function signatures
- Docstrings for public functions
- Async functions for I/O operations (UniProt API)

**Patterns:**
```python
# Type-safe endpoint with Pydantic
@app.post("/api/align")
async def align(request: AlignmentRequest) -> AlignmentResult:
    return align_sequences(...)

# Error handling with HTTPException
if not sequences:
    raise HTTPException(status_code=400, detail="No valid sequences")
```

**File Organization:**
- `main.py` - Routes only, no business logic
- `alignment.py` - Pure functions for alignment
- `sequences.py` - I/O and parsing
- `schemas.py` - Data models only

### JavaScript (Frontend)

**Style:**
- ES6+ features (async/await, arrow functions, destructuring)
- Functional approach where possible
- No frameworks (vanilla JS)

**Patterns:**
```javascript
// Async API calls
const data = await api.post('/api/align', requestData);

// State updates trigger re-renders
state.alignment = data;
renderAlignment();

// Event delegation for dynamic elements
document.getElementById('alignment-view').addEventListener('click', handler);
```

**Naming:**
- `camelCase` for variables and functions
- `UPPER_SNAKE_CASE` for constants
- Descriptive names (no abbreviations except standard ones like `ref`, `seq`)

### Data Flow

**Backend → Frontend:**
1. API returns Pydantic model
2. FastAPI serializes to JSON
3. Frontend parses and stores in `state`
4. UI renders from `state`

**Frontend → Backend:**
1. User action triggers event
2. JavaScript collects data
3. API call with JSON payload
4. Backend validates with Pydantic
5. Process and return result

---

## Key Algorithms

### Pairwise Alignment

**Algorithm:** Needleman-Wunsch (global) or Smith-Waterman (local) via Biopython

**Process:**
1. Create `PairwiseAligner` with scoring matrix
2. Run alignment: `aligner.align(ref, query)`
3. Extract best alignment (highest score)
4. Parse alignment coordinates to build gap-aware strings
5. Calculate identity and similarity metrics

**Circular DNA Handling:**
```python
# Try all rotations
for i in range(len(query)):
    rotated = query[i:] + query[:i]
    result = _do_alignment(ref, rotated, algorithm)
    # Keep best score
```

### Index Mapping

**Purpose:** Map aligned positions back to original sequence positions

```python
# Example alignment:
# Ref:  A T - G C
# Qry:  A - T G C
#
# ref_indices:   [0, 1, None, 2, 3]
# query_indices: [0, None, 1, 2, 3]
```

**Usage:**
- Status bar shows original position when clicking residue
- Feature mapping from original sequence to alignment
- Search result highlighting

### Similarity Calculation

**Protein Similarity Groups:**
```python
SIMILAR_GROUPS = [
    set('GAVLI'),      # Small hydrophobic
    set('FYW'),        # Aromatic
    set('CM'),         # Sulfur-containing
    set('ST'),         # Hydroxyl
    set('KRH'),        # Positive
    set('DE'),         # Negative
    set('NQ'),         # Amide
    set('P'),          # Proline
]
```

**Calculation:**
- Identity: exact matches / aligned pairs
- Similarity: (matches + similar pairs) / aligned pairs

---

## Adding Features

### Adding a New API Endpoint

**Example: Add motif scanning**

1. **Define schema** in `schemas.py`:
```python
class Motif(BaseModel):
    name: str
    pattern: str
    matches: list[SearchMatch]
```

2. **Add logic** in `alignment.py` or new module:
```python
def scan_motifs(sequence: str, motifs: dict) -> list[Motif]:
    results = []
    for name, pattern in motifs.items():
        matches = search_sequence(sequence, pattern, use_regex=True)
        results.append(Motif(name=name, pattern=pattern, matches=matches))
    return results
```

3. **Create endpoint** in `main.py`:
```python
@app.post("/api/scan-motifs")
async def scan_motifs_endpoint(request: dict) -> list[Motif]:
    return scan_motifs(request["sequence"], request["motifs"])
```

4. **Call from frontend** in `app.js`:
```javascript
async function scanMotifs() {
  const motifs = await api.post('/api/scan-motifs', {
    sequence: state.ref.sequence,
    motifs: { "Kinase": "K.{2,4}K" }
  });
  renderMotifs(motifs);
}
```

### Adding a New Color Scheme

1. Create JSON file: `color_schemes/my_scheme.json`
2. Define colors for all residues
3. Reload app - scheme appears in dropdown automatically

### Adding Sequence Features

**Backend:** Extend `fetch_uniprot()` or `parse_fasta()` to extract features

**Frontend:** Features auto-render in sidebar if present in `Sequence.features`

---

## Common Tasks

### Task: Add Multiple Sequence Alignment (MSA)

**Changes Required:**
1. Update `AlignmentRequest` schema to accept `list[str]` sequences
2. Modify `align_sequences()` to use `Bio.Align.MultipleSeqAlignment`
3. Update frontend to handle >2 sequences
4. Modify rendering to show multiple rows

### Task: Export Alignment as Image

**Approach:**
1. Add `html2canvas` library to frontend
2. Create export button
3. Capture `#alignment-view` as canvas
4. Download as PNG

**Code:**
```javascript
async function exportImage() {
  const canvas = await html2canvas(document.getElementById('alignment-view'));
  const link = document.createElement('a');
  link.download = 'alignment.png';
  link.href = canvas.toDataURL();
  link.click();
}
```

### Task: Add Authentication

**Backend:**
1. Add `fastapi-users` or similar auth library
2. Protect routes with dependencies
3. Add user database (SQLAlchemy)

**Frontend:**
1. Add login/register forms
2. Store JWT token in localStorage
3. Include token in API calls

### Task: Add Alignment Presets

**Implementation:**
1. Store presets in `backend/presets.json`:
```json
{
  "strict": {"match": 5, "mismatch": -4, "gap_open": -12},
  "relaxed": {"match": 2, "mismatch": -1, "gap_open": -5}
}
```

2. Add endpoint to fetch presets
3. Add dropdown in frontend UI
4. Pass preset parameters to alignment endpoint

---

## Troubleshooting

### Common Issues

**Issue: Alignment is very slow**
- Cause: Very long sequences (>10,000 residues)
- Solution: Use local alignment or implement chunking

**Issue: UniProt fetch fails**
- Cause: Network issues or invalid accession
- Solution: Check accession format, verify internet connection

**Issue: Color scheme not loading**
- Cause: Invalid JSON or missing "default" color
- Solution: Validate JSON, ensure "default" key exists

**Issue: Features not showing in alignment**
- Cause: Feature positions don't map to alignment
- Solution: Implement feature projection using `ref_indices`

---

## Performance Considerations

**Backend:**
- Alignment scales O(m×n) with sequence lengths
- Consider caching alignment results
- Use local alignment for large sequences

**Frontend:**
- Long alignments (>10,000 characters) may slow rendering
- Consider virtualization for very long sequences
- Limit search regex complexity

**Optimization Tips:**
1. Batch API requests where possible
2. Use pagination for very long alignments
3. Implement web workers for heavy client-side computation
4. Cache color scheme lookups

---

## Future Enhancements

**Potential Features:**
- [ ] Multiple sequence alignment (MSA)
- [ ] Phylogenetic tree generation
- [ ] Batch alignment processing
- [ ] Export to various formats (PDF, SVG, Clustal)
- [ ] Real-time collaboration
- [ ] Protein structure integration (PDB)
- [ ] Conservation score calculation
- [ ] Custom scoring matrices (BLOSUM, PAM)
- [ ] Alignment quality metrics (Q-score)
- [ ] Sequence logo generation

---

## API Reference Quick Guide

### Sequence Endpoints

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| GET | `/api/uniprot/{accession}` | Fetch from UniProt | - | `Sequence` |
| POST | `/api/parse-fasta` | Parse FASTA file | File | `list[Sequence]` |
| POST | `/api/parse-text` | Parse pasted text | `{text: str}` | `list[Sequence]` |
| GET | `/api/detect-type?sequence={seq}` | Detect sequence type | - | `{type: str}` |

### Alignment Endpoints

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| POST | `/api/align` | Run alignment | `AlignmentRequest` | `AlignmentResult` |
| GET | `/api/search?sequence={seq}&pattern={pat}&regex={bool}` | Search pattern | - | `list[SearchMatch]` |

### Color Scheme Endpoints

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| GET | `/api/color-schemes` | List schemes | `list[str]` |
| GET | `/api/color-schemes/{name}` | Get scheme | `ColorScheme` |

### Project Endpoints

| Method | Endpoint | Description | Request | Response |
|--------|----------|-------------|---------|----------|
| POST | `/api/project/export` | Export project | `Project` | `dict` |
| POST | `/api/project/import` | Import project | File | `Project` |

---

## Contact and Contribution

**For AI Assistants:**
- Always read relevant source files before making changes
- Maintain type safety with Pydantic models
- Test alignment with various sequence types
- Preserve existing color scheme format
- Follow the established code organization patterns
- Add docstrings for new functions
- Update this CLAUDE.md when adding major features

**Key Files to Check Before Modifying:**
- `schemas.py` - For data structure changes
- `main.py` - For API changes
- `alignment.py` - For algorithm changes
- `app.js` state object - For frontend state changes

---

*Last Updated: 2025-12-07*
*Alignment Viewer v1.0*
