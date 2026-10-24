// Tiny Chrome DevTools Protocol client used by the e2e smoke test.
export async function connect(port, match = () => true) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let page;
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      page = list.find(t => t.type === 'page' && match(t));
    } catch { /* not up yet */ }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('no page target on port ' + port);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method) listeners.forEach(fn => fn(d));
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
    return r.result.result.value;
  };
  // Node's WebSocket does not keep the event loop alive on its own.
  const keepAlive = setInterval(() => {}, 1000);
  return { send, evaluate, on: fn => listeners.push(fn), close: () => { clearInterval(keepAlive); ws.close(); } };
}
