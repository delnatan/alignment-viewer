// State
const state = {
  ref: null,
  query: null,
  alignment: null,
  colorScheme: null,
  searchMatches: [],
  currentMatch: -1,
  cursorPos: null
};

// API helpers
const api = {
  async get(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json();
  },
  async post(url, data) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json();
  },
  async postFile(url, file) {
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch(url, { method: 'POST', body: form });
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json();
  }
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });

  // Load color schemes
  await loadColorSchemes();

  // Settings listeners
  document.getElementById('chars-per-line').addEventListener('change', renderAlignment);
  document.getElementById('color-scheme').addEventListener('change', async (e) => {
    state.colorScheme = await api.get(`/api/color-schemes/${e.target.value}`);
    renderAlignment();
  });

  // Search on Enter
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  
  // Event delegation for alignment clicks
  document.getElementById('alignment-view').addEventListener('click', handleResidueClick);
});

async function loadColorSchemes() {
  const schemes = await api.get('/api/color-schemes');
  const select = document.getElementById('color-scheme');
  select.innerHTML = schemes.map(s => `<option value="${s}">${s}</option>`).join('');
  state.colorScheme = await api.get(`/api/color-schemes/${schemes[0]}`);
}

// Sequence loading
async function fetchUniprot(target) {
  const input = document.getElementById(`${target}-accession`);
  const accession = input.value.trim();
  if (!accession) return;

  try {
    const seq = await api.get(`/api/uniprot/${accession}`);
    setSequence(target, seq);
  } catch (e) {
    alert(`Failed to fetch: ${e.message}`);
  }
}

async function loadFasta(file, target) {
  if (!file) return;
  try {
    const sequences = await api.postFile('/api/parse-fasta', file);
    if (sequences.length > 0) setSequence(target, sequences[0]);
  } catch (e) {
    alert(`Failed to parse: ${e.message}`);
  }
}

function setSequence(target, seq) {
  state[target] = seq;
  
  const info = document.getElementById(`${target}-info`);
  info.innerHTML = `
    <h4>${seq.name || seq.id}</h4>
    <div class="meta">${seq.organism || seq.source}</div>
    <div class="length">${seq.sequence.length} residues</div>
  `;
  info.classList.remove('hidden');
  
  // Clear paste area
  document.getElementById(`${target}-paste`).value = '';
}

// Alignment
async function runAlignment() {
  // Check for pasted sequences first
  const refPaste = document.getElementById('ref-paste').value.trim();
  const queryPaste = document.getElementById('query-paste').value.trim();

  if (refPaste) {
    const sequences = await api.post('/api/parse-text', { text: refPaste });
    if (sequences.length > 0) setSequence('ref', sequences[0]);
  }
  if (queryPaste) {
    const sequences = await api.post('/api/parse-text', { text: queryPaste });
    if (sequences.length > 0) setSequence('query', sequences[0]);
  }

  if (!state.ref || !state.query) {
    alert('Please load both reference and query sequences');
    return;
  }

  try {
    state.alignment = await api.post('/api/align', {
      ref_sequence: state.ref.sequence,
      query_sequence: state.query.sequence,
      is_circular: document.getElementById('is-circular').checked
    });

    // Switch to view tab
    document.querySelector('[data-tab="view"]').click();
    
    // Reset search state
    state.searchMatches = [];
    state.currentMatch = -1;
    state.cursorPos = 0;
    
    renderAlignment();
    renderStats();
    renderFeatures();
    renderLegend();
    
    document.getElementById('status-bar').classList.remove('hidden');
    updateStatus();
  } catch (e) {
    alert(`Alignment failed: ${e.message}`);
  }
}

// Rendering
function renderAlignment() {
  if (!state.alignment) return;

  const container = document.getElementById('alignment-view');
  const charsPerLine = parseInt(document.getElementById('chars-per-line').value) || 60;
  const { reference, query, ref_indices, query_indices } = state.alignment;

  let html = '';
  for (let i = 0; i < reference.length; i += charsPerLine) {
    const end = Math.min(i + charsPerLine, reference.length);
    const refSlice = reference.slice(i, end);
    const querySlice = query.slice(i, end);

    html += `<div class="alignment-block">
      <div class="block-pos">${i + 1}</div>
      <div class="block-content">
        ${renderSeqRow('Ref', refSlice, ref_indices.slice(i, end), i)}
        ${renderSeqRow('Qry', querySlice, query_indices.slice(i, end), i)}
        ${renderConsensus(refSlice, querySlice)}
      </div>
    </div>`;
  }

  container.innerHTML = html;
}

function handleResidueClick(e) {
  const residue = e.target.closest('.residue');
  if (residue) {
    const pos = parseInt(residue.dataset.pos);
    if (!isNaN(pos)) {
      setCursor(pos);
    }
  }
}

function renderSeqRow(label, seq, indices, offset) {
  const chars = seq.split('').map((c, i) => {
    const pos = offset + i;
    const color = getColor(c);
    const isHighlight = state.searchMatches.some(m => pos >= m.start && pos <= m.end);
    const isCursor = state.cursorPos === pos;
    const classes = ['residue', isHighlight && 'highlight', isCursor && 'cursor'].filter(Boolean).join(' ');
    return `<span class="${classes}" data-pos="${pos}" style="background:${color.bg};color:${color.fg}">${c}</span>`;
  }).join('');

  return `<div class="seq-row">
    <span class="seq-label">${label}</span>
    <span class="seq-chars">${chars}</span>
  </div>`;
}

function renderConsensus(ref, query) {
  const chars = ref.split('').map((r, i) => {
    const q = query[i];
    let sym = ' ';
    if (r !== '-' && q !== '-') {
      sym = r.toUpperCase() === q.toUpperCase() ? '|' : '·';
    }
    return `<span class="consensus-char">${sym}</span>`;
  }).join('');

  return `<div class="seq-row consensus-row">
    <span class="seq-label"></span>
    <span class="seq-chars">${chars}</span>
  </div>`;
}

function getColor(char) {
  if (!state.colorScheme) return { bg: '#ddd', fg: '#333' };
  return state.colorScheme.colors[char.toUpperCase()] || 
         state.colorScheme.colors.default || 
         { bg: '#ddd', fg: '#333' };
}

function renderLegend() {
  const legend = document.getElementById('legend');
  if (!state.ref || !state.query) return;
  
  legend.innerHTML = `
    <h4>Legend</h4>
    <div class="legend-item">
      <span class="legend-label">Ref</span>
      <span class="legend-name" title="${state.ref.name || state.ref.id}">${truncate(state.ref.name || state.ref.id, 22)}</span>
    </div>
    <div class="legend-item">
      <span class="legend-label">Qry</span>
      <span class="legend-name" title="${state.query.name || state.query.id}">${truncate(state.query.name || state.query.id, 22)}</span>
    </div>
  `;
  legend.classList.remove('hidden');
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

function renderStats() {
  if (!state.alignment) return;
  const { identity, similarity, score, length } = state.alignment;

  document.getElementById('stats').innerHTML = `
    <h4>Statistics</h4>
    <div class="stats-grid">
      <div class="stat"><span class="stat-label">Identity</span><span class="stat-value">${identity}%</span></div>
      <div class="stat"><span class="stat-label">Similarity</span><span class="stat-value">${similarity}%</span></div>
      <div class="stat"><span class="stat-label">Score</span><span class="stat-value">${score}</span></div>
      <div class="stat"><span class="stat-label">Length</span><span class="stat-value">${length}</span></div>
    </div>
  `;
  document.getElementById('stats').classList.remove('hidden');
}

function renderFeatures() {
  renderFeatureList('ref', state.ref);
  renderFeatureList('query', state.query);
}

function renderFeatureList(target, seq) {
  const el = document.getElementById(`${target}-features`);
  if (!seq?.features?.length) {
    el.classList.add('hidden');
    return;
  }

  el.innerHTML = `
    <h4>${target === 'ref' ? 'Reference' : 'Query'} Features</h4>
    <div class="feature-list">
      ${seq.features.map(f => `
        <div class="feature-item" style="border-left-color:${f.color}" data-start="${f.start}" data-target="${target}">
          <span class="feature-type">${f.type}</span>
          <span class="feature-range">${f.start + 1}-${f.end + 1}</span>
        </div>
      `).join('')}
    </div>
  `;
  el.classList.remove('hidden');

  // Click to navigate
  el.querySelectorAll('.feature-item').forEach(item => {
    item.addEventListener('click', () => {
      const seqPos = parseInt(item.dataset.start);
      const t = item.dataset.target;
      const pos = findAlignmentPos(t, seqPos);
      if (pos !== null && pos >= 0) setCursor(pos);
    });
  });
}

function findAlignmentPos(target, seqPos) {
  if (!state.alignment) return null;
  const indices = target === 'ref' ? state.alignment.ref_indices : state.alignment.query_indices;
  return indices.findIndex(i => i === seqPos);
}

// Cursor & Status
function setCursor(pos) {
  state.cursorPos = pos;
  
  // Update cursor display without full re-render
  document.querySelectorAll('.residue.cursor').forEach(el => el.classList.remove('cursor'));
  const newCursor = document.querySelector(`.residue[data-pos="${pos}"]`);
  if (newCursor) {
    newCursor.classList.add('cursor');
    newCursor.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }
  
  updateStatus();
}

function updateStatus() {
  if (!state.alignment || state.cursorPos === null) return;
  
  const { ref_indices, query_indices, reference, query } = state.alignment;
  const pos = state.cursorPos;

  // Global alignment position (1-indexed)
  document.getElementById('status-pos').textContent = pos + 1;
  
  // Reference position
  const refIdx = ref_indices[pos];
  const refChar = reference[pos];
  document.getElementById('status-ref').textContent = 
    refIdx !== null ? `${refIdx + 1} (${refChar})` : `- (${refChar})`;
  
  // Query position
  const queryIdx = query_indices[pos];
  const queryChar = query[pos];
  document.getElementById('status-query').textContent = 
    queryIdx !== null ? `${queryIdx + 1} (${queryChar})` : `- (${queryChar})`;
}

// Search
async function doSearch() {
  if (!state.alignment) return;
  const pattern = document.getElementById('search-input').value;
  const regex = document.getElementById('search-regex').checked;

  if (!pattern) {
    state.searchMatches = [];
    state.currentMatch = -1;
    updateSearchInfo();
    renderAlignment();
    return;
  }

  state.searchMatches = await api.get(
    `/api/search?sequence=${encodeURIComponent(state.alignment.reference)}&pattern=${encodeURIComponent(pattern)}&regex=${regex}`
  );
  state.currentMatch = state.searchMatches.length > 0 ? 0 : -1;

  updateSearchInfo();
  renderAlignment();
  
  if (state.currentMatch >= 0) {
    setCursor(state.searchMatches[0].start);
  }
}

function updateSearchInfo() {
  const info = document.getElementById('search-info');
  if (state.searchMatches.length === 0) {
    info.textContent = state.currentMatch === -1 ? '' : 'No matches';
  } else {
    info.textContent = `${state.currentMatch + 1} of ${state.searchMatches.length}`;
  }
}

function nextMatch() {
  if (state.searchMatches.length === 0) return;
  state.currentMatch = (state.currentMatch + 1) % state.searchMatches.length;
  setCursor(state.searchMatches[state.currentMatch].start);
  updateSearchInfo();
}

function prevMatch() {
  if (state.searchMatches.length === 0) return;
  state.currentMatch = (state.currentMatch - 1 + state.searchMatches.length) % state.searchMatches.length;
  setCursor(state.searchMatches[state.currentMatch].start);
  updateSearchInfo();
}

// Project save/load
function exportProject() {
  const project = {
    version: '1.0',
    reference: state.ref,
    query: state.query,
    alignment: state.alignment,
    colorScheme: state.colorScheme
  };

  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'alignment_project.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importProject(file) {
  if (!file) return;
  const text = await file.text();
  try {
    const project = JSON.parse(text);
    state.ref = project.reference;
    state.query = project.query;
    state.alignment = project.alignment;
    if (project.colorScheme) state.colorScheme = project.colorScheme;

    if (state.ref) setSequence('ref', state.ref);
    if (state.query) setSequence('query', state.query);

    if (state.alignment) {
      state.cursorPos = 0;
      document.querySelector('[data-tab="view"]').click();
      renderAlignment();
      renderStats();
      renderFeatures();
      renderLegend();
      document.getElementById('status-bar').classList.remove('hidden');
      updateStatus();
    }
  } catch (e) {
    alert(`Failed to load project: ${e.message}`);
  }
}

async function loadColorScheme(file) {
  if (!file) return;
  try {
    const text = await file.text();
    state.colorScheme = JSON.parse(text);
    renderAlignment();
  } catch (e) {
    alert(`Invalid color scheme: ${e.message}`);
  }
}
