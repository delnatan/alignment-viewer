"""Sequence alignment using Biopython."""
from Bio import Align
from schemas import AlignmentResult, SearchMatch

# Similar amino acid groups based on physicochemical properties (BLOSUM62-like)
SIMILAR_GROUPS = [
    set('GAVLI'),      # Small hydrophobic
    set('FYW'),        # Aromatic
    set('CM'),         # Sulfur-containing
    set('ST'),         # Hydroxyl
    set('KRH'),        # Positive charge
    set('DE'),         # Negative charge
    set('NQ'),         # Amide
    set('P'),          # Proline (unique)
]

def are_similar(a: str, b: str) -> bool:
    """Check if two amino acids are similar."""
    a, b = a.upper(), b.upper()
    if a == b:
        return True
    for group in SIMILAR_GROUPS:
        if a in group and b in group:
            return True
    return False

def align_sequences(
    ref: str, 
    query: str, 
    is_circular: bool = False,
    algorithm: str = "global"
) -> AlignmentResult:
    """
    Align two sequences using Biopython's PairwiseAligner.
    
    For circular DNA, tries all rotations of query to find best alignment.
    """
    if is_circular and len(query) < len(ref) * 2:
        best_result = None
        best_score = float("-inf")
        
        for i in range(len(query)):
            rotated = query[i:] + query[:i]
            result = _do_alignment(ref, rotated, algorithm)
            if result.score > best_score:
                best_score = result.score
                best_result = result
        
        return best_result
    
    return _do_alignment(ref, query, algorithm)

def _do_alignment(ref: str, query: str, algorithm: str) -> AlignmentResult:
    """Perform the actual alignment."""
    aligner = Align.PairwiseAligner()
    
    # Configure aligner
    aligner.mode = "global" if algorithm == "global" else "local"
    aligner.match_score = 2
    aligner.mismatch_score = -1
    aligner.open_gap_score = -10
    aligner.extend_gap_score = -0.5
    
    # Get best alignment
    alignments = aligner.align(ref, query)
    best = alignments[0]
    
    # Extract aligned sequences and build index mappings
    aligned_ref, aligned_query, ref_indices, query_indices = _extract_alignment(best, ref, query)
    
    # Calculate identity and similarity
    matches = 0
    similar = 0
    aligned_pairs = 0
    
    for r, q in zip(aligned_ref, aligned_query):
        if r != "-" and q != "-":
            aligned_pairs += 1
            if r.upper() == q.upper():
                matches += 1
                similar += 1
            elif are_similar(r, q):
                similar += 1
    
    identity = (matches / aligned_pairs * 100) if aligned_pairs > 0 else 0
    similarity = (similar / aligned_pairs * 100) if aligned_pairs > 0 else 0
    
    return AlignmentResult(
        reference=aligned_ref,
        query=aligned_query,
        ref_indices=ref_indices,
        query_indices=query_indices,
        score=best.score,
        identity=round(identity, 1),
        similarity=round(similarity, 1),
        length=len(aligned_ref)
    )

def _extract_alignment(alignment, ref: str, query: str) -> tuple:
    """Extract aligned sequences and index mappings from Biopython alignment."""
    # Use alignment coordinates to reconstruct aligned sequences
    # alignment.aligned returns ((ref_blocks), (query_blocks))
    ref_aligned = list(alignment.aligned[0])  # [(start, end), ...]
    query_aligned = list(alignment.aligned[1])
    
    aligned_ref = []
    aligned_query = []
    ref_indices = []
    query_indices = []
    
    ref_pos = 0
    query_pos = 0
    
    for (rs, re), (qs, qe) in zip(ref_aligned, query_aligned):
        # Add gaps before this block if needed
        while ref_pos < rs:
            aligned_ref.append(ref[ref_pos])
            aligned_query.append('-')
            ref_indices.append(ref_pos)
            query_indices.append(None)
            ref_pos += 1
        
        while query_pos < qs:
            aligned_ref.append('-')
            aligned_query.append(query[query_pos])
            ref_indices.append(None)
            query_indices.append(query_pos)
            query_pos += 1
        
        # Add aligned block
        for i in range(re - rs):
            aligned_ref.append(ref[rs + i])
            aligned_query.append(query[qs + i])
            ref_indices.append(rs + i)
            query_indices.append(qs + i)
        
        ref_pos = re
        query_pos = qe
    
    # Add remaining gaps at the end
    while ref_pos < len(ref):
        aligned_ref.append(ref[ref_pos])
        aligned_query.append('-')
        ref_indices.append(ref_pos)
        query_indices.append(None)
        ref_pos += 1
    
    while query_pos < len(query):
        aligned_ref.append('-')
        aligned_query.append(query[query_pos])
        ref_indices.append(None)
        query_indices.append(query_pos)
        query_pos += 1
    
    return "".join(aligned_ref), "".join(aligned_query), ref_indices, query_indices

def search_sequence(sequence: str, pattern: str, use_regex: bool = False) -> list[SearchMatch]:
    """Find all occurrences of pattern in sequence."""
    import re
    matches = []
    
    if not pattern or not sequence:
        return matches
    
    if use_regex:
        try:
            for m in re.finditer(pattern, sequence, re.IGNORECASE):
                matches.append(SearchMatch(start=m.start(), end=m.end() - 1, text=m.group()))
        except re.error:
            pass
    else:
        seq_upper = sequence.upper()
        pat_upper = pattern.upper()
        pos = 0
        while True:
            pos = seq_upper.find(pat_upper, pos)
            if pos == -1:
                break
            matches.append(SearchMatch(start=pos, end=pos + len(pattern) - 1, text=sequence[pos:pos+len(pattern)]))
            pos += 1
    
    return matches
