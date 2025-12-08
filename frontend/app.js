// State
const state = {
  ref: null,
  query: null,
  alignment: null,
  colorScheme: null,
  searchMatches: [],
  currentMatch: -1,
  cursorPos: null,
  expandedFeatureGroups: {}, // Track which feature groups are expanded in sidebar
  showFeatureTracks: true,   // Toggle feature tracks visibility globally
  visibleFeatureTypes: {}    // Track visibility of each feature type in tracks
};

// Theme management
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  setTheme(savedTheme);
}

function setTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  updateThemeButton(theme);
}

function toggleTheme() {
  const currentTheme = document.body.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
}

function updateThemeButton(theme) {
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
  }
}

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
  // Initialize theme
  initTheme();

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
        ${state.showFeatureTracks ? renderFeatureTracks(i, end, charsPerLine) : ''}
      </div>
    </div>`;
  }

  container.innerHTML = html;

  // Add click handlers for feature track bars
  container.querySelectorAll('.feature-track-bar').forEach(bar => {
    bar.addEventListener('click', () => {
      const pos = parseInt(bar.dataset.alignStart);
      if (!isNaN(pos)) setCursor(pos);
    });
  });
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

// Feature track rendering - independent tracks per feature type
function renderFeatureTracks(blockStart, blockEnd, charsPerLine) {
  const hasRefFeatures = state.ref?.features?.length > 0;
  const hasQueryFeatures = state.query?.features?.length > 0;

  if (!hasRefFeatures && !hasQueryFeatures) return '';

  const { ref_indices, query_indices } = state.alignment;
  const charWidth = 16; // Width of each character cell (14px + 2px margin)
  const blockWidth = (blockEnd - blockStart) * charWidth;

  // Get features that overlap with this block
  const refFeatures = hasRefFeatures ?
    getVisibleFeatures(state.ref.features, ref_indices, blockStart, blockEnd) : [];
  const queryFeatures = hasQueryFeatures ?
    getVisibleFeatures(state.query.features, query_indices, blockStart, blockEnd) : [];

  // Group features by type
  const featuresByType = {};
  for (const f of refFeatures) {
    if (!featuresByType[f.type]) featuresByType[f.type] = { ref: [], query: [], color: f.color };
    featuresByType[f.type].ref.push(f);
  }
  for (const f of queryFeatures) {
    if (!featuresByType[f.type]) featuresByType[f.type] = { ref: [], query: [], color: f.color };
    featuresByType[f.type].query.push(f);
  }

  const types = Object.keys(featuresByType);
  if (types.length === 0) return '';

  // Filter by visibility
  const visibleTypes = types.filter(t => state.visibleFeatureTypes[t] !== false);
  if (visibleTypes.length === 0) return '';

  let html = `<div class="feature-tracks-container" style="width:${blockWidth}px">`;

  for (const type of visibleTypes) {
    const group = featuresByType[type];
    html += `<div class="feature-track-group" data-type="${escapeHtml(type)}">
      <div class="feature-track-type-row">
        <span class="feature-track-type-label" style="color:${group.color}">${escapeHtml(type)}</span>
      </div>
      <div class="feature-track-lanes">
        <div class="feature-track-lane" data-seq="ref">
          ${renderTrackBars(group.ref, ref_indices, blockStart, blockEnd, charWidth, blockWidth)}
        </div>
        <div class="feature-track-lane" data-seq="query">
          ${renderTrackBars(group.query, query_indices, blockStart, blockEnd, charWidth, blockWidth)}
        </div>
      </div>
    </div>`;
  }

  html += '</div>';
  return html;
}

function getVisibleFeatures(features, indices, blockStart, blockEnd) {
  // Map sequence positions to alignment positions for this block
  const result = [];

  for (const feature of features) {
    // Find alignment positions for this feature
    let alignStart = null;
    let alignEnd = null;

    for (let i = blockStart; i < blockEnd; i++) {
      const seqPos = indices[i];
      if (seqPos === null) continue;

      if (seqPos >= feature.start && seqPos <= feature.end) {
        if (alignStart === null) alignStart = i;
        alignEnd = i;
      }
    }

    if (alignStart !== null) {
      result.push({
        ...feature,
        alignStart,
        alignEnd
      });
    }
  }

  return result;
}

function renderTrackBars(features, indices, blockStart, blockEnd, charWidth, blockWidth) {
  if (features.length === 0) return '';

  return features.map(f => {
    const left = (f.alignStart - blockStart) * charWidth;
    let width = (f.alignEnd - f.alignStart + 1) * charWidth - 2;
    // Constrain width to not exceed block boundary
    if (left + width > blockWidth) {
      width = blockWidth - left - 2;
    }
    const tooltip = `${f.description} (${f.start + 1}-${f.end + 1})`;

    return `<div class="feature-track-bar"
      style="left:${left}px;width:${Math.max(width, 4)}px;background:${f.color}"
      title="${escapeHtml(tooltip)}"
      data-align-start="${f.alignStart}"></div>`;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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

  const refName = state.ref.name || state.ref.id;
  const queryName = state.query.name || state.query.id;

  legend.innerHTML = `
    <h4>Legend</h4>
    <div class="legend-item">
      <span class="legend-label">Ref</span>
      <span class="legend-name"><span class="legend-name-text">${escapeHtml(truncate(refName, 22))}</span></span>
      <div class="legend-tooltip">${escapeHtml(refName)}${state.ref.organism ? `<br><em>${escapeHtml(state.ref.organism)}</em>` : ''}</div>
    </div>
    <div class="legend-item">
      <span class="legend-label">Qry</span>
      <span class="legend-name"><span class="legend-name-text">${escapeHtml(truncate(queryName, 22))}</span></span>
      <div class="legend-tooltip">${escapeHtml(queryName)}${state.query.organism ? `<br><em>${escapeHtml(state.query.organism)}</em>` : ''}</div>
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
  renderFeatureTrackToggles();
}

// Render feature type toggles for track visibility
function renderFeatureTrackToggles() {
  const container = document.getElementById('feature-track-toggles');
  if (!container) return;

  // Collect all unique feature types from both sequences
  const allTypes = new Set();
  const typeColors = {};

  if (state.ref?.features) {
    for (const f of state.ref.features) {
      allTypes.add(f.type);
      if (!typeColors[f.type]) typeColors[f.type] = f.color;
    }
  }
  if (state.query?.features) {
    for (const f of state.query.features) {
      allTypes.add(f.type);
      if (!typeColors[f.type]) typeColors[f.type] = f.color;
    }
  }

  if (allTypes.size === 0) {
    container.classList.add('hidden');
    return;
  }

  // Initialize visibility for new types (default to visible)
  for (const type of allTypes) {
    if (state.visibleFeatureTypes[type] === undefined) {
      state.visibleFeatureTypes[type] = true;
    }
  }

  const togglesHtml = Array.from(allTypes).sort().map(type => {
    const isVisible = state.visibleFeatureTypes[type] !== false;
    const color = typeColors[type] || '#888';
    return `
      <label class="feature-toggle-item" style="border-left-color:${color}">
        <input type="checkbox" ${isVisible ? 'checked' : ''} data-feature-type="${escapeHtml(type)}">
        <span class="feature-toggle-name">${escapeHtml(type)}</span>
      </label>
    `;
  }).join('');

  container.innerHTML = `
    <h4>Feature Tracks</h4>
    <div class="feature-toggles-list">
      ${togglesHtml}
    </div>
  `;
  container.classList.remove('hidden');

  // Add event listeners
  container.querySelectorAll('input[data-feature-type]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const type = e.target.dataset.featureType;
      state.visibleFeatureTypes[type] = e.target.checked;
      renderAlignment();
    });
  });
}

function renderFeatureList(target, seq) {
  const el = document.getElementById(`${target}-features`);
  const targetLabel = target === 'ref' ? 'Reference' : 'Query';

  // Always show the section with add button
  const features = seq?.features || [];

  // Group features by type
  const groups = {};
  for (const f of features) {
    if (!groups[f.type]) {
      groups[f.type] = { type: f.type, color: f.color, items: [] };
    }
    groups[f.type].items.push(f);
  }

  const groupsHtml = Object.values(groups).map(g => {
    const groupKey = `${target}-${g.type}`;
    const isExpanded = state.expandedFeatureGroups[groupKey];

    return `
      <div class="feature-group ${isExpanded ? 'expanded' : ''}" data-group-key="${groupKey}">
        <div class="feature-group-header" style="border-left-color:${g.color}" data-group-key="${groupKey}">
          <span class="feature-group-toggle">▶</span>
          <span class="feature-group-type">${g.type}</span>
          <span class="feature-group-count">${g.items.length}</span>
        </div>
        <div class="feature-group-items">
          ${g.items.map(f => `
            <div class="feature-item" style="border-left-color:${f.color}" data-start="${f.start}" data-target="${target}">
              <span class="feature-range">${f.start + 1}-${f.end + 1}</span>
              ${f.description ? `<span class="feature-desc" title="${escapeHtml(f.description)}">${f.description}</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <div class="features-header">
      <h4>${targetLabel} Features</h4>
      <button class="add-feature-btn" data-target="${target}">+ Add</button>
    </div>
    <div class="feature-list">
      ${groupsHtml || '<div class="no-features">No features</div>'}
    </div>
  `;
  el.classList.remove('hidden');

  // Click handlers for group headers (expand/collapse)
  el.querySelectorAll('.feature-group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      const groupKey = header.dataset.groupKey;
      state.expandedFeatureGroups[groupKey] = !state.expandedFeatureGroups[groupKey];
      const group = header.closest('.feature-group');
      group.classList.toggle('expanded');
    });
  });

  // Click to navigate to feature
  el.querySelectorAll('.feature-item').forEach(item => {
    item.addEventListener('click', () => {
      const seqPos = parseInt(item.dataset.start);
      const t = item.dataset.target;
      const pos = findAlignmentPos(t, seqPos);
      if (pos !== null && pos >= 0) setCursor(pos);
    });
  });

  // Click handler for add button
  el.querySelector('.add-feature-btn').addEventListener('click', () => {
    openFeatureModal(target);
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

// Custom Feature Modal
let currentFeatureTarget = null;

const FEATURE_TYPES = [
  { type: 'Domain', color: '#9b59b6' },
  { type: 'Region', color: '#1abc9c' },
  { type: 'Motif', color: '#e67e22' },
  { type: 'Binding site', color: '#e74c3c' },
  { type: 'Active site', color: '#c0392b' },
  { type: 'Helix', color: '#e91e63' },
  { type: 'Beta strand', color: '#2196f3' },
  { type: 'Turn', color: '#4caf50' },
  { type: 'Modified residue', color: '#27ae60' },
  { type: 'Signal', color: '#00bcd4' },
  { type: 'Custom', color: '#95a5a6' }
];

function openFeatureModal(target) {
  currentFeatureTarget = target;
  const modal = document.getElementById('feature-modal');
  const seq = state[target];

  if (!seq) {
    alert('Please load a sequence first');
    return;
  }

  // Populate type dropdown
  const typeSelect = document.getElementById('feature-type-select');
  typeSelect.innerHTML = FEATURE_TYPES.map(t =>
    `<option value="${t.type}" data-color="${t.color}">${t.type}</option>`
  ).join('');

  // Set default values
  document.getElementById('feature-start').value = '1';
  document.getElementById('feature-end').value = seq.sequence.length;
  document.getElementById('feature-description').value = '';
  document.getElementById('feature-color').value = FEATURE_TYPES[0].color;
  document.getElementById('feature-color-text').value = FEATURE_TYPES[0].color;

  // Update color when type changes
  typeSelect.onchange = () => {
    const selected = typeSelect.options[typeSelect.selectedIndex];
    const color = selected.dataset.color;
    document.getElementById('feature-color').value = color;
    document.getElementById('feature-color-text').value = color;
  };

  modal.classList.add('active');
}

function closeFeatureModal() {
  document.getElementById('feature-modal').classList.remove('active');
  currentFeatureTarget = null;
}

function syncColorFromPicker() {
  const color = document.getElementById('feature-color').value;
  document.getElementById('feature-color-text').value = color;
}

function syncColorFromText() {
  const text = document.getElementById('feature-color-text').value;
  if (/^#[0-9a-fA-F]{6}$/.test(text)) {
    document.getElementById('feature-color').value = text;
  }
}

function addCustomFeature() {
  if (!currentFeatureTarget) return;

  const seq = state[currentFeatureTarget];
  if (!seq) return;

  const type = document.getElementById('feature-type-select').value;
  const start = parseInt(document.getElementById('feature-start').value) - 1; // Convert to 0-indexed
  const end = parseInt(document.getElementById('feature-end').value) - 1;
  const description = document.getElementById('feature-description').value.trim();
  const color = document.getElementById('feature-color').value;

  // Validation
  if (isNaN(start) || isNaN(end)) {
    alert('Please enter valid start and end positions');
    return;
  }

  if (start < 0 || end < 0 || start >= seq.sequence.length || end >= seq.sequence.length) {
    alert(`Positions must be between 1 and ${seq.sequence.length}`);
    return;
  }

  if (start > end) {
    alert('Start position must be less than or equal to end position');
    return;
  }

  // Create new feature
  const newFeature = {
    type,
    start,
    end,
    description: description || type,
    color
  };

  // Initialize features array if needed
  if (!seq.features) {
    seq.features = [];
  }

  // Add feature
  seq.features.push(newFeature);

  // Re-render
  renderFeatures();
  renderAlignment();

  closeFeatureModal();
}

// Toggle feature tracks visibility
function toggleFeatureTracks() {
  state.showFeatureTracks = !state.showFeatureTracks;
  const btn = document.getElementById('toggle-tracks-btn');
  if (btn) {
    btn.textContent = state.showFeatureTracks ? 'Hide Tracks' : 'Show Tracks';
  }
  renderAlignment();
}
