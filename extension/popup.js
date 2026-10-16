const $ = (id) => document.getElementById(id);

async function render() {
  const { status = 'disconnected', detail = '' } = await chrome.storage.session.get(['status', 'detail']);
  const el = $('status');
  el.textContent = status === 'connected' ? 'Connected to the app' : status === 'unpaired' ? 'Not paired yet' : `Not connected. ${detail}`;
  el.className = `status ${status === 'connected' ? 'connected' : ''}`;
}

(async () => {
  const { token = '', port = 5174 } = await chrome.storage.local.get(['token', 'port']);
  $('token').value = token;
  $('port').value = port;
  render();
})();

$('save').addEventListener('click', async () => {
  const token = $('token').value.trim();
  const port = Number($('port').value) || 5174;
  await chrome.storage.local.set({ token, port });
  await chrome.runtime.sendMessage({ type: 'reconnect' });
  setTimeout(render, 800);
});

chrome.storage.session.onChanged.addListener(render);
