const $ = s => document.querySelector(s);
let state = { dest: null, headers: [], mappings: {}, hiddenFields: {}, privacyAccepted: false, page: null, existingRow: null, stored: [], dirty: new Set(), submitting: false };
const storage = chrome.storage.local;
function call(message) { return chrome.runtime.sendMessage(message).then(r => { if (!r?.ok) throw new Error(r?.error || 'Request failed'); return r.value; }); }
function setStatus(text, kind = 'idle') { const node = $('#status'); node.textContent = text; node.dataset.kind = kind; }
function say(text) { $('#notice').textContent = text; }
function applyPrivacyGate() {
  $('#privacy-notice').hidden = state.privacyAccepted;
  $('#connection').querySelectorAll('input, button').forEach(node => { node.disabled = !state.privacyAccepted; });
  if (!state.privacyAccepted) { $('#toolbox').hidden = true; $('#mapping-box').hidden = true; $('#submit-area').hidden = true; setStatus('REVIEW PRIVACY NOTICE'); }
}
function handlePageError(error) {
  if (error.message === 'SITE_ACCESS_REQUIRED') { setStatus('SITE ACCESS NEEDED', 'idle'); $('#allow-site').hidden = false; say('Allow this shopping site to read product details from the page you are viewing.'); }
  else { setStatus('PAGE ERROR', 'error'); say(error.message); }
}
function parseUrl(input) {
  const url = new URL(input); const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/); const gid = url.hash.match(/gid=(\d+)/)?.[1] || url.searchParams.get('gid');
  if (!match || gid === null) throw new Error('Paste a worksheet URL with both the spreadsheet ID and #gid= worksheet ID.');
  return { spreadsheetId: match[1], gid: String(gid) };
}
function defaultFormula(header) {
  const h = header.toLowerCase();
  if (/(name|item|product|title)/.test(h)) return 'title'; if (/price|cost/.test(h)) return 'price'; if (/canonical/.test(h)) return 'canonicalUrl';
  if (/\burl|link|website/.test(h)) return 'url'; if (/vendor|store|domain/.test(h)) return 'vendor'; if (/image/.test(h)) return 'image';
  if (/(sku|asin|product id|item id)/.test(h)) return 'productId'; if (/description/.test(h)) return 'description'; return '';
}
function formulaFor(header) { return Object.hasOwn(state.mappings, header) ? state.mappings[header] : defaultFormula(header); }
function evaluate(formula) { return state.page?.[formula] ?? ''; }
function values() { return state.headers.map((h, i) => $(`[data-index="${i}"]`)?.value ?? state.stored[i] ?? evaluate(formulaFor(h.name))); }
function render() {
  const form = $('#form'); form.replaceChildren();
  if (!state.dest) { form.innerHTML = '<p class="empty">Connect a worksheet to load its headers.</p>'; $('#submit-area').hidden = true; return; }
  state.headers.forEach((header, i) => {
    if (state.hiddenFields[header.name]) return;
    const node = $('#field-template').content.firstElementChild.cloneNode(true); const input = node.querySelector('input');
    input.dataset.index = i; input.value = state.stored[i] ?? (state.dirty.has(i) ? input.value : evaluate(formulaFor(header.name)));
    node.querySelector('.field-name').textContent = header.name;
    const formula = formulaFor(header.name); const hint = node.querySelector('.hint'); hint.hidden = !formula; hint.textContent = formula ? `Auto: ${formula}` : ''; hint.className = 'hint auto';
    input.addEventListener('input', () => { state.dirty.add(i); setStatus('UNSAVED CHANGES', 'changed'); }); form.append(node);
  });
  $('#submit-area').hidden = false; $('#submit').textContent = state.existingRow ? 'Update Item' : 'Add to Sheet'; $('#remove').hidden = !state.existingRow;
  renderMappings();
}
function renderMappings() {
  const box = $('#mapping-box'); if (!state.dest) { box.hidden = true; return; } box.hidden = false;
  const host = $('#mapping-fields'); host.replaceChildren();
  state.headers.forEach(header => { const label = document.createElement('label'); label.textContent = header.name; const input = document.createElement('input'); input.dataset.mapping = header.name; input.placeholder = 'Manual (no automatic extraction)'; input.value = formulaFor(header.name); const show = document.createElement('input'); show.type = 'checkbox'; show.dataset.visibility = header.name; show.checked = !state.hiddenFields[header.name]; const showLabel = document.createElement('span'); showLabel.className = 'show-field'; showLabel.append(show, ' Show while shopping'); label.append(input, showLabel); host.append(label); });
}
function matchingRow(allRows) {
  const urlIndex = state.headers.find(h => /url|link|website/i.test(h.name))?.index;
  const idIndex = state.headers.find(h => /sku|asin|product id|item id/i.test(h.name))?.index;
  const dataRows = allRows.slice(1);
  // Check every cell as well as the expected column. This protects older
  // sheets whose headers use unexpected names or whose URL/ID is in another
  // column, while exact matching avoids partial-title false positives.
  if (state.page.productId) {
    const wanted = String(state.page.productId).trim().toUpperCase();
    const r = dataRows.findIndex(row => [row[idIndex], ...row].some(value => String(value || '').trim().toUpperCase() === wanted));
    if (r >= 0) return r + 2;
  }
  const pageUrls = new Set([state.page.normalizedUrl, state.page.url, state.page.canonicalUrl].filter(Boolean).map(normalize));
  if (pageUrls.size) {
    const r = dataRows.findIndex(row => [row[urlIndex], ...row].some(value => pageUrls.has(normalize(value))));
    if (r >= 0) return r + 2;
  }
  return null;
}
function normalize(v) {
  try {
    const u = new URL(v); const asin = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1];
    if (/(^|\.)amazon\./i.test(u.hostname) && asin) return `${u.hostname.toLowerCase()}/dp/${asin.toUpperCase()}`;
    [...u.searchParams.keys()].filter(isTrackingParameter).forEach(k => u.searchParams.delete(k));
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = decodeURIComponent(u.pathname).replace(/\/$/, '').toLowerCase();
    return `${host}${path}${u.search}`;
  } catch { return v; }
}
function isTrackingParameter(key) {
  const k = key.toLowerCase();
  return /^utm_/.test(k) || /^mc_/.test(k) || ['ref', 'tag', 'affiliate', 'src', 'source', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'fbclid', '_gl', '_ga', '_gac', '_gs', '_up'].includes(k);
}
async function refreshPage(preserve = true) {
  if (!state.dest) return; const before = preserve ? values() : []; state.page = await call({ type: 'page-data' }); const all = await call({ type: 'rows', dest: state.dest });
  state.existingRow = matchingRow(all); state.stored = state.existingRow ? (all[state.existingRow - 1] || []) : [];
  render(); if (preserve) before.forEach((v, i) => { if (state.dirty.has(i)) { const input = $(`[data-index="${i}"]`); if (input) input.value = v; } });
  $('#allow-site').hidden = true;
  if (state.existingRow) { setStatus(state.page.ambiguousPrice ? 'ALREADY IN SHEET — CHECK PRICE' : 'ALREADY IN SHEET', 'existing'); say(`Matched row ${state.existingRow}. Review and update as needed.`); }
  else { setStatus(state.page.ambiguousPrice ? 'NEW ITEM — CHECK PRICE' : 'NEW ITEM', 'new'); say('Review all extracted values before adding.'); }
}
async function connect() {
  if (!state.privacyAccepted) throw new Error('Review and accept the Privacy Policy before connecting a sheet.');
  const base = parseUrl($('#sheet-url').value); const info = await call({ type: 'sheet-info', ...base }); state.dest = { ...base, ...info }; state.headers = await call({ type: 'headers', dest: state.dest });
  const saved = await storage.get(['mappings', 'hiddenFields']); state.mappings = saved.mappings || {}; state.hiddenFields = saved.hiddenFields || {}; await storage.set({ destination: state.dest }); $('#destination').textContent = `${info.spreadsheetName} — ${info.sheetName}`; $('#toolbox').hidden = false; state.dirty.clear(); await refreshPage(false);
}
async function submit() {
  if (state.submitting) return; state.submitting = true; $('#submit').disabled = true;
  try {
    // A final live read prevents a second append even if the page changed or
    // the earlier automatic scan was stale.
    const liveRows = await call({ type: 'rows', dest: state.dest });
    const matchedRow = matchingRow(liveRows);
    if (!state.existingRow && matchedRow) {
      state.existingRow = matchedRow; state.stored = liveRows[matchedRow - 1] || []; state.dirty.clear(); render();
      setStatus('ALREADY IN SHEET', 'existing'); say(`Matched row ${matchedRow}. It was not added again.`); return;
    }
    const row = values(); if (state.existingRow) await call({ type: 'update', dest: state.dest, row: state.existingRow, values: row }); else await call({ type: 'append', dest: state.dest, values: row }); state.stored = row; state.dirty.clear(); setStatus('SAVED', 'new'); say('Saved to the selected worksheet.'); await refreshPage(false);
  }
  catch (e) { setStatus('WRITE ERROR', 'error'); say(e.message); } finally { state.submitting = false; $('#submit').disabled = false; }
}
$('#connect').addEventListener('click', () => connect().catch(e => { setStatus('CONNECTION ERROR', 'error'); say(e.message); }));
$('#disconnect').addEventListener('click', async () => { state = { ...state, dest:null, headers:[], existingRow:null, stored:[] }; await storage.remove('destination'); $('#destination').textContent = 'No worksheet connected.'; $('#toolbox').hidden=true; setStatus('CONNECT A SHEET'); render(); });
$('#refresh').addEventListener('click', () => refreshPage(true).catch(handlePageError));
$('#allow-site').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); const url = new URL(tab?.url || '');
    if (!/^https?:$/.test(url.protocol)) throw new Error('Open a regular shopping website first.');
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) throw new Error('Site access was not granted. You can allow it later from this button.');
    await refreshPage(false);
  } catch (e) { handlePageError(e); }
});
$('#open-sheet').addEventListener('click', () => chrome.tabs.create({ url:`https://docs.google.com/spreadsheets/d/${state.dest.spreadsheetId}/edit#gid=${state.dest.gid}` }));
$('#save-mappings').addEventListener('click', async () => { document.querySelectorAll('[data-mapping]').forEach(input => { state.mappings[input.dataset.mapping] = input.value.trim(); }); document.querySelectorAll('[data-visibility]').forEach(input => { state.hiddenFields[input.dataset.visibility] = !input.checked; }); await storage.set({ mappings: state.mappings, hiddenFields: state.hiddenFields }); render(); setStatus('MAPPINGS SAVED', 'new'); say('Field visibility and page extraction rules updated.'); });
$('#submit').addEventListener('click', submit);
$('#remove').addEventListener('click', async () => { if (!state.existingRow || !confirm('Remove only this matched row from the selected worksheet?')) return; try { await call({ type:'remove', dest:state.dest, row:state.existingRow }); state.existingRow=null; state.stored=[]; state.dirty.clear(); render(); setStatus('NEW ITEM','new'); say('Row removed.'); } catch(e) { setStatus('REMOVE ERROR','error'); say(e.message); } });
$('#accept-privacy').addEventListener('click', async () => {
  if (!$('#privacy-consent').checked) { setStatus('CONSENT REQUIRED', 'error'); return; }
  state.privacyAccepted = true; await storage.set({ privacyAccepted: true }); applyPrivacyGate(); render();
});
chrome.runtime.onMessage.addListener(message => { if (message.type === 'page-changed' && state.dest && state.privacyAccepted) refreshPage(true).catch(handlePageError); });
(async () => { const saved = await storage.get(['destination','mappings','hiddenFields','privacyAccepted']); state.mappings = saved.mappings || {}; state.hiddenFields = saved.hiddenFields || {}; state.privacyAccepted = saved.privacyAccepted === true; applyPrivacyGate(); if (saved.destination && state.privacyAccepted) { state.dest=saved.destination; $('#sheet-url').value=`https://docs.google.com/spreadsheets/d/${state.dest.spreadsheetId}/edit#gid=${state.dest.gid}`; $('#destination').textContent=`${state.dest.spreadsheetName} — ${state.dest.sheetName}`; $('#toolbox').hidden=false; try { state.headers=await call({type:'headers',dest:state.dest}); await refreshPage(false); } catch(e) { setStatus('CONNECTION ERROR','error'); say(e.message); } } else render(); })();
