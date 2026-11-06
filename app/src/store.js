// Keeps the in-memory state and the database in step. Every change runs inside one transaction: the action
// mutates the state, then only the records that actually changed are written. If anything throws, the
// transaction rolls back and the state is put back exactly as it was at the last save.
import {COLS, CFG0} from '../public/model.js';
import {tx, loadDocs} from './db.js';

const SEP = '\u0000';

export function createStore(db, S) {
  let saved = new Map();
  const up = db.prepare('INSERT INTO docs (col, id, data) VALUES (?, ?, ?) ON CONFLICT (col, id) DO UPDATE SET data = excluded.data');
  const del = db.prepare('DELETE FROM docs WHERE col = ? AND id = ?');

  function snapshot() {
    const m = new Map();
    for (const c of COLS) for (const x of S[c]) {
      if (typeof x.id !== 'string' || !x.id) throw new Error(`A ${c} record has no id`);
      const k = c + SEP + x.id;
      if (m.has(k)) throw new Error(`Two ${c} records share the id ${x.id}`);
      m.set(k, JSON.stringify(x));
    }
    m.set('cfg' + SEP + 'cfg', JSON.stringify(S.cfg));
    return m;
  }
  // Most refusals happen before anything is touched; then there is nothing to undo and every record keeps its identity.
  function restore() {
    try {
      const now = snapshot();
      if (now.size === saved.size && [...now].every(([k, v]) => saved.get(k) === v)) return;
    } catch { /* broken records: rebuild below */ }
    COLS.forEach(c => { S[c] = []; });
    for (const [k, v] of saved) { const c = k.slice(0, k.indexOf(SEP)); if (c === 'cfg') S.cfg = JSON.parse(v); else S[c].push(JSON.parse(v)); }
  }
  function load() {
    S.cfg = CFG0();
    loadDocs(db, S, COLS);
    // Settings saved by an older version get any newer defaults filled in.
    const d = CFG0();
    for (const k of Object.keys(d)) if (S.cfg[k] === undefined) S.cfg[k] = d[k];
    S.cfg.mail = {...d.mail, ...S.cfg.mail, modes: {...d.mail.modes, ...(S.cfg.mail?.modes || {})}};
    saved = snapshot();
  }

  // Runs fn (which may also write other tables) and saves what it changed, all or nothing.
  function run(fn) {
    let next;
    try {
      const out = tx(db, () => {
        const r = fn();
        next = snapshot();
        for (const [k, v] of next) if (saved.get(k) !== v) { const i = k.indexOf(SEP); up.run(k.slice(0, i), k.slice(i + 1), v); }
        for (const k of saved.keys()) if (!next.has(k)) { const i = k.indexOf(SEP); del.run(k.slice(0, i), k.slice(i + 1)); }
        return r;
      });
      saved = next;
      return out;
    } catch (err) {
      restore();
      throw err;
    }
  }

  load();
  return {run, load};
}
