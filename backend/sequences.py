"""Sequence fetching and parsing."""
import httpx
from io import StringIO
from Bio import SeqIO
from Bio.SeqRecord import SeqRecord
from schemas import Sequence, Feature

FEATURE_COLORS = {
    "Chain": "#3498db", "Domain": "#9b59b6", "Region": "#1abc9c",
    "Binding site": "#e74c3c", "Active site": "#e74c3c", "Site": "#f39c12",
    "Modified residue": "#27ae60", "Helix": "#e91e63", "Beta strand": "#2196f3",
    "Turn": "#4caf50", "Disulfide bond": "#ff9800", "Signal": "#00bcd4",
}

async def fetch_uniprot(accession: str) -> Sequence:
    """Fetch sequence and features from UniProt."""
    url = f"https://rest.uniprot.org/uniprotkb/{accession}.json"
    
    async with httpx.AsyncClient() as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
    
    features = []
    for f in data.get("features", []):
        loc = f.get("location", {})
        start = loc.get("start", {}).get("value", 1) - 1  # 0-indexed
        end = loc.get("end", {}).get("value", 1) - 1
        features.append(Feature(
            type=f.get("type", ""),
            start=start,
            end=end,
            description=f.get("description", f.get("type", "")),
            color=FEATURE_COLORS.get(f.get("type"), "#95a5a6")
        ))
    
    protein_desc = data.get("proteinDescription", {})
    rec_name = protein_desc.get("recommendedName", {})
    name = rec_name.get("fullName", {}).get("value", accession)
    
    return Sequence(
        id=data.get("primaryAccession", accession),
        name=name,
        sequence=data.get("sequence", {}).get("value", ""),
        organism=data.get("organism", {}).get("scientificName", ""),
        features=features,
        source="uniprot"
    )

def parse_fasta(content: str) -> list[Sequence]:
    """Parse FASTA format text into Sequence objects."""
    sequences = []
    
    for record in SeqIO.parse(StringIO(content), "fasta"):
        sequences.append(Sequence(
            id=record.id,
            name=record.description,
            sequence=str(record.seq),
            source="fasta"
        ))
    
    # Handle raw sequence (no header)
    if not sequences and content.strip():
        clean = "".join(content.split())
        if clean.isalpha():
            sequences.append(Sequence(
                id="pasted",
                name="Pasted sequence",
                sequence=clean,
                source="paste"
            ))
    
    return sequences

def detect_sequence_type(sequence: str) -> str:
    """Detect if sequence is DNA/RNA or protein."""
    upper = sequence.upper()
    dna_chars = set("ATGCUN")
    dna_count = sum(1 for c in upper if c in dna_chars)
    return "dna" if dna_count / len(upper) > 0.9 else "protein"
