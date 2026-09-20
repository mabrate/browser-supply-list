const API = 'https://sheets.googleapis.com/v4/spreadsheets';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.warn);
chrome.tabs.onActivated.addListener(() => chrome.runtime.sendMessage({ type: 'page-changed' }).catch(() => {}));
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.status === 'complete') chrome.runtime.sendMessage({ type: 'page-changed' }).catch(() => {});
});

async function token(interactive = true) {
  // Manifest V3 Chrome returns { token, grantedScopes }; older implementations
  // returned the token string directly. Support both so the Authorization header
  // is never sent as "Bearer [object Object]".
  const result = await chrome.identity.getAuthToken({ interactive });
  const accessToken = typeof result === 'string' ? result : result?.token;
  if (!accessToken) throw new Error('Google did not return an access token. Confirm the extension OAuth client and consent screen setup.');
  return accessToken;
}
async function api(path, options = {}) {
  const accessToken = await token();
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.status === 204 ? null : response.json();
}
const enc = encodeURIComponent;
function range(sheetTitle, suffix = '') { return enc(`'${sheetTitle.replaceAll("'", "''")}'${suffix}`); }

async function sheetInfo(spreadsheetId, gid) {
  const data = await api(`/${spreadsheetId}?fields=properties.title,sheets.properties`);
  const sheet = data.sheets.find(s => String(s.properties.sheetId) === String(gid));
  if (!sheet) throw new Error('The worksheet in the pasted URL no longer exists.');
  return { spreadsheetName: data.properties.title, sheetName: sheet.properties.title, gid: String(sheet.properties.sheetId) };
}
async function headers(dest) {
  const data = await api(`/${dest.spreadsheetId}/values/${range(dest.sheetName, '!1:1')}`);
  const values = data.values?.[0] || [];
  if (!values.length || values.every(v => !String(v).trim())) throw new Error('The connected worksheet has no header row. Add headers in row 1 first.');
  return values.map((name, index) => ({ name: name || `Column ${index + 1}`, index }));
}
async function rows(dest) {
  const data = await api(`/${dest.spreadsheetId}/values/${range(dest.sheetName, '!A:ZZ')}`);
  return data.values || [];
}
async function append(dest, values) {
  return api(`/${dest.spreadsheetId}/values/${range(dest.sheetName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: [values] }) });
}
async function update(dest, row, values) {
  return api(`/${dest.spreadsheetId}/values/${range(dest.sheetName, `!A${row}:ZZ${row}`)}?valueInputOption=USER_ENTERED`, { method: 'PUT', body: JSON.stringify({ values: [values] }) });
}
async function remove(dest, row) {
  // Google Sheets batchUpdate uses the immutable sheetId, not its display name.
  return api(`/${dest.spreadsheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: Number(dest.gid), dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }] }) });
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  (async () => {
    switch (message.type) {
      case 'sheet-info': return sheetInfo(message.spreadsheetId, message.gid);
      case 'headers': return headers(message.dest);
      case 'rows': return rows(message.dest);
      case 'append': return append(message.dest, message.values);
      case 'update': return update(message.dest, message.row, message.values);
      case 'remove': return remove(message.dest, message.row);
      case 'page-data': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url) throw new Error('No accessible shopping tab found.');
        const url = new URL(tab.url);
        if (!/^https?:$/.test(url.protocol)) throw new Error('Open a regular shopping website to collect page data.');
        const origin = `${url.origin}/*`;
        if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error('SITE_ACCESS_REQUIRED');
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        return chrome.tabs.sendMessage(tab.id, { type: 'extract-page' });
      }
      default: throw new Error('Unknown request.');
    }
  })().then(value => reply({ ok: true, value })).catch(error => reply({ ok: false, error: error.message }));
  return true;
});
