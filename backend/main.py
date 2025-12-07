"""FastAPI application for sequence alignment viewer."""
import json
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from schemas import (
    Sequence, AlignmentResult, AlignmentRequest, 
    SearchMatch, ColorScheme, Project
)
from sequences import fetch_uniprot, parse_fasta, detect_sequence_type
from alignment import align_sequences, search_sequence

app = FastAPI(title="Alignment Viewer", version="1.0")

# Serve frontend
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
COLOR_SCHEMES_DIR = Path(__file__).parent.parent / "color_schemes"

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
async def index():
    return FileResponse(FRONTEND_DIR / "index.html")

# --- Sequence endpoints ---

@app.get("/api/uniprot/{accession}")
async def get_uniprot(accession: str) -> Sequence:
    """Fetch sequence from UniProt."""
    try:
        return await fetch_uniprot(accession)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"UniProt entry not found: {accession}")

@app.post("/api/parse-fasta")
async def parse_fasta_endpoint(file: UploadFile = File(...)) -> list[Sequence]:
    """Parse uploaded FASTA file."""
    content = await file.read()
    sequences = parse_fasta(content.decode("utf-8"))
    if not sequences:
        raise HTTPException(status_code=400, detail="No valid sequences found")
    return sequences

@app.post("/api/parse-text")
async def parse_text(data: dict) -> list[Sequence]:
    """Parse pasted sequence text."""
    content = data.get("text", "")
    sequences = parse_fasta(content)
    if not sequences:
        raise HTTPException(status_code=400, detail="No valid sequences found")
    return sequences

@app.get("/api/detect-type")
async def detect_type(sequence: str) -> dict:
    """Detect if sequence is DNA or protein."""
    return {"type": detect_sequence_type(sequence)}

# --- Alignment endpoints ---

@app.post("/api/align")
async def align(request: AlignmentRequest) -> AlignmentResult:
    """Align two sequences."""
    if not request.ref_sequence or not request.query_sequence:
        raise HTTPException(status_code=400, detail="Both sequences required")
    
    return align_sequences(
        request.ref_sequence,
        request.query_sequence,
        is_circular=request.is_circular,
        algorithm=request.algorithm
    )

@app.get("/api/search")
async def search(sequence: str, pattern: str, regex: bool = False) -> list[SearchMatch]:
    """Search for pattern in sequence."""
    return search_sequence(sequence, pattern, use_regex=regex)

# --- Color scheme endpoints ---

@app.get("/api/color-schemes")
async def list_color_schemes() -> list[str]:
    """List available color schemes."""
    return [f.stem for f in COLOR_SCHEMES_DIR.glob("*.json")]

@app.get("/api/color-schemes/{name}")
async def get_color_scheme(name: str) -> ColorScheme:
    """Get a color scheme by name."""
    path = COLOR_SCHEMES_DIR / f"{name}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Color scheme not found: {name}")
    
    with open(path) as f:
        return ColorScheme(**json.load(f))

# --- Project endpoints ---

@app.post("/api/project/export")
async def export_project(project: Project) -> dict:
    """Export project as JSON."""
    return project.model_dump()

@app.post("/api/project/import")
async def import_project(file: UploadFile = File(...)) -> Project:
    """Import project from JSON file."""
    content = await file.read()
    try:
        data = json.loads(content.decode("utf-8"))
        return Project(**data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid project file: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
