"""Data models for the alignment viewer."""
from pydantic import BaseModel
from typing import Optional

class Feature(BaseModel):
    type: str
    start: int
    end: int
    description: str = ""
    color: str = "#95a5a6"

class Sequence(BaseModel):
    id: str
    name: str = ""
    sequence: str
    organism: str = ""
    features: list[Feature] = []
    source: str = "unknown"
    
    @property
    def length(self) -> int:
        return len(self.sequence)

class AlignmentResult(BaseModel):
    reference: str  # aligned sequence with gaps
    query: str
    ref_indices: list[Optional[int]]  # original indices (None for gaps)
    query_indices: list[Optional[int]]
    score: float
    identity: float
    similarity: float  # for proteins, based on BLOSUM62 groups
    length: int

class AlignmentRequest(BaseModel):
    ref_sequence: str
    query_sequence: str
    is_circular: bool = False
    algorithm: str = "global"  # global, local

class SearchMatch(BaseModel):
    start: int
    end: int
    text: str

class ColorScheme(BaseModel):
    name: str
    description: str = ""
    type: str = "protein"  # protein, dna
    colors: dict[str, dict[str, str]]  # residue -> {bg, fg}

class Project(BaseModel):
    version: str = "1.0"
    reference: Optional[Sequence] = None
    query: Optional[Sequence] = None
    alignment: Optional[AlignmentResult] = None
    color_scheme: Optional[ColorScheme] = None
