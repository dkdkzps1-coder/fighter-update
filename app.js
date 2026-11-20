// 몰래 격투 — 온라인(락스텝) + 화면 UI
'use strict';

const SERVER = new URLSearchParams(location.search).get('server') || 'wss://tictactoe-relay-agzs.onrender.com';
const DT = 1000 / 60;
// 실행 중인 게임 파일의 버전 (main.js가 주소 뒤에 ?v=번호 로 넘겨줌)
const APP_VERSION = Number(new URLSearchParams(location.search).get('v')) || 0;
const bridge = window.api || { toggle() {}, opacity() {}, quit() { window.close(); }, onHidden() {}, resize() {} };

const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');

// ---------------- 키 입력 / 키 설정 ----------------
// 동작마다 키 2개까지. 설정은 이 PC에 저장됨
const ACTIONS = [
  ['l', '왼쪽'], ['r', '오른쪽'], ['u', '점프'], ['g', '가드'],
  ['lp', '왼손'], ['rp', '오른손'], ['lk', '왼발'], ['rk', '오른발'], ['sp', '필살기'],
];
const DEFAULT_BINDS = {
  l: ['KeyA', 'ArrowLeft'], r: ['KeyD', 'ArrowRight'], u: ['KeyW', 'ArrowUp'], g: ['KeyS', 'ArrowDown'],
  lp: ['KeyF', 'KeyJ'], rp: ['KeyG', 'KeyK'], lk: ['KeyV', 'KeyM'], rk: ['KeyB', 'Comma'], sp: ['KeyH', 'KeyL'],
};
const ATTACK_KEYS = new Set(Game.BUTTONS);
// 게임 기능에 이미 쓰는 키는 지정 불가
const RESERVED = new Set(['Escape', 'Backquote', 'Enter', 'NumpadEnter', 'BracketLeft', 'BracketRight', 'Tab', 'MetaLeft', 'MetaRight']);
let binds = JSON.parse(JSON.stringify(DEFAULT_BINDS));
try {
  const saved = JSON.parse(localStorage.getItem('binds') || 'null');
  if (saved && typeof saved === 'object') {
    // 예전 버전의 '강공격(hp)' 키는 오른발로 옮김
    if (Array.isArray(saved.hp) && !saved.rk) saved.rk = saved.hp;
    for (const [a] of ACTIONS) if (Array.isArray(saved[a])) binds[a] = [saved[a][0] || '', saved[a][1] || ''];
    // 새로 생긴 동작의 기본 키가 이미 다른 동작에 쓰이고 있으면 비워 둠
    const used = new Set();
    for (const [a] of ACTIONS) if (Array.isArray(saved[a])) for (const c of binds[a]) if (c) used.add(c);
    for (const [a] of ACTIONS) if (!Array.isArray(saved[a])) binds[a] = binds[a].map(c => (used.has(c) ? '' : c));
  }
} catch {}
let KEYMAP = {};
function rebuildKeymap() {
  KEYMAP = {};
  for (const [a] of ACTIONS) for (const c of binds[a]) if (c) KEYMAP[c] = a;
  try { localStorage.setItem('binds', JSON.stringify(binds)); } catch {}
  renderKeyHelp();
}

function keyLabel(code) {
  if (!code) return '—';
  const named = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Comma: ',', Period: '.', Slash: '/',
    Semicolon: ';', Quote: "'", Backslash: '\\', Minus: '-', Equal: '=', ShiftLeft: '왼Shift', ShiftRight: '오른Shift',
    ControlLeft: '왼Ctrl', ControlRight: '오른Ctrl', AltLeft: '왼Alt', AltRight: '오른Alt', Backspace: 'Backspace', Delete: 'Del',
    Insert: 'Ins', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', CapsLock: 'Caps', ContextMenu: '메뉴' };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}

let capturing = null; // { action, slot }
function renderKeyHelp() {
  const L = a => binds[a].filter(Boolean).map(keyLabel).join('/') || '없음';
  const el = $('keysHelp');
  if (el) el.innerHTML = `이동 ${L('l')} ${L('r')} · 점프 ${L('u')} · 가드 ${L('g')} · 방향키 두 번 대시<br>왼손 ${L('lp')} · 오른손 ${L('rp')} · 왼발 ${L('lk')} · 오른발 ${L('rk')} · 필살기 ${L('sp')}<br>왼손+오른손 잡기 · 맞히면 손→발 순서로 콤보 · 오른발 띄우고 점프로 공중콤보<br>Esc 일시정지 · \` 또는 Alt+Q 숨기기 · [ ] 투명도<br>창 위에 마우스를 올리면 상단 바(이동)와 오른쪽 아래 크기 조절 손잡이가 보여요`;
}
function renderKeyTable() {
  const t = $('keyTable');
  t.innerHTML = '';
  for (const [a, name] of ACTIONS) {
    const row = document.createElement('div'); row.className = 'krow';
    const lab = document.createElement('span'); lab.textContent = name; row.appendChild(lab);
    for (let slot = 0; slot < 2; slot++) {
      const b = document.createElement('button');
      b.className = 'kbtn';
      const isCap = capturing && capturing.action === a && capturing.slot === slot;
      if (isCap) { b.textContent = '키를 누르세요'; b.classList.add('cap'); }
      else b.textContent = keyLabel(binds[a][slot]);
      b.onclick = () => { capturing = { action: a, slot }; $('keyMsg').textContent = '지정할 키를 누르세요 (Esc 취소, Backspace 지우기)'; renderKeyTable(); };
      row.appendChild(b);
    }
    t.appendChild(row);
  }
}
function captureKey(e) {
  e.preventDefault();
  const { action, slot } = capturing;
  if (e.code === 'Escape') { capturing = null; $('keyMsg').textContent = ''; renderKeyTable(); return; }
  if (e.code === 'Backspace') { binds[action][slot] = ''; capturing = null; $('keyMsg').textContent = ''; rebuildKeymap(); renderKeyTable(); return; }
  if (RESERVED.has(e.code)) { $('keyMsg').textContent = keyLabel(e.code) + ' 키는 다른 기능에 쓰고 있어서 지정할 수 없어요'; return; }
  // 다른 동작에 이미 쓰인 키면 그쪽에서 빼기
  for (const [a] of ACTIONS) for (let i = 0; i < 2; i++) if (binds[a][i] === e.code) binds[a][i] = '';
  binds[action][slot] = e.code;
  capturing = null;
  $('keyMsg').textContent = '';
  rebuildKeymap(); renderKeyTable();
}

const held = {};
let pressed = 0;         // 마지막 샘플 이후 눌린 공격 버튼 (짧게 눌러도 놓치지 않게)
let localPause = false;
let opacity = 1;

function inLobbyInput(e) { return e.target && e.target.tagName === 'INPUT'; }

addEventListener('keydown', e => {
  if (capturing) { captureKey(e); return; }
  if (inLobbyInput(e)) { if (e.code === 'Enter') joinRoom(); return; }
  if (e.code === 'Backquote') { localPause = true; bridge.toggle(); e.preventDefault(); return; }
  if (e.code === 'Escape') { if (mode !== 'idle') localPause = !localPause; return; }
  if (e.code === 'BracketLeft') { opacity = Math.max(0.3, opacity - 0.1); bridge.opacity(opacity); return; }
  if (e.code === 'BracketRight') { opacity = Math.min(1, opacity + 0.1); bridge.opacity(opacity); return; }
  if (e.code === 'Enter' && !e.repeat) pressed |= Game.BIT.enter;
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  if (!held[k] && ATTACK_KEYS.has(k)) pressed |= Game.BIT[k];
  held[k] = true;
});
addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) held[k] = false; });
addEventListener('blur', () => { for (const k in held) held[k] = false; });
bridge.onHidden(() => { localPause = true; });

function sample() {
  const B = Game.BIT;
  let k = pressed;
  pressed = 0;
  if (held.l) k |= B.l;
  if (held.r) k |= B.r;
  if (held.u) k |= B.u;
  if (held.g) k |= B.g;
  if (localPause) k = B.pause; // 일시정지 중엔 다른 입력 무시
  return k;
}

// ---------------- 서버 연결 ----------------
// 서버는 방 찾기 + 직접 연결 정보 전달 + (직접 연결 실패 시) 입력 중계를 맡음
let ws = null, wsReady = false, retry = 0;
let mode = 'idle';      // idle | waiting | sync | online | practice
let me = -1, roomCode = '', session = -1, inRoom = false;
let net = null;

function setStatus(t) { $('status').textContent = t; }

function connect() {
  setStatus('서버에 연결하는 중… (처음엔 서버가 깨어나느라 최대 1분 걸려요)');
  ws = new WebSocket(SERVER);
  ws.onopen = () => { wsReady = true; retry = 0; setStatus('연결됐어요. 방을 만들거나 코드를 입력하세요.'); };
  ws.onclose = () => {
    wsReady = false;
    // 직접 연결로 게임 중이면 서버가 끊겨도 계속 진행
    if (!(mode === 'online' && p2p)) {
      if (mode === 'online' || mode === 'sync' || mode === 'waiting') { mode = 'idle'; net = null; closeP2P(); showLobby(); }
    }
    setStatus('서버 연결이 끊겼어요. 다시 연결하는 중…');
    setTimeout(connect, Math.min(10000, 1000 * ++retry));
  };
  ws.onerror = () => {};
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    onMessage(m);
  };
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function relay(d) { send({ type: 'relay', d }); }

// 게임 데이터 전송: 직접 연결이 열려 있으면 그쪽으로, 아니면 서버 경유
function sendNet(d) {
  if (p2p && dc && dc.readyState === 'open') {
    try { dc.send(JSON.stringify(d)); return; } catch {}
  }
  relay(d);
}

function onMessage(m) {
  if (m.type === 'error') { setStatus(m.message); return; }
  if ((m.type === 'state' || m.type === 'relay') && !inRoom) return;
  if (m.type === 'state') {
    if (m.game !== 'fighter') return;
    me = m.you === 'X' ? 0 : 1;
    roomCode = m.room;
    $('roomCode').textContent = roomCode;
    $('waitCode').textContent = roomCode;
    if (m.status === 'playing') {
      if (m.session !== session) { session = m.session; beginSync(); }
    } else {
      if (mode === 'online' || mode === 'sync') setStatus('상대가 나갔어요. 다시 들어오면 새 경기로 시작해요.');
      else setStatus('친구에게 방 코드를 알려주세요: ' + roomCode);
      mode = 'waiting'; net = null;
      closeP2P();
      showLobby(true);
    }
    return;
  }
  if (m.type === 'relay') {
    if (m.s !== session) return; // 이전 판에서 늦게 도착한 데이터
    if (m.d && m.d.sig) { onSig(m.d.sig); return; }
    onData(m.d);
  }
}

// ---------------- 직접 연결 (WebRTC) ----------------
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
let pc = null, dc = null, p2p = false;
let pendingCands = [], sdpParts = {};

function closeP2P() {
  const oldDc = dc, oldPc = pc;
  pc = null; dc = null; p2p = false; pendingCands = []; sdpParts = {};
  try { oldDc && oldDc.close(); } catch {}
  try { oldPc && oldPc.close(); } catch {}
}

function startP2P() {
  closeP2P();
  if (typeof RTCPeerConnection === 'undefined') return;
  const myPc = pc = new RTCPeerConnection({ iceServers: ICE });
  myPc.onicecandidate = e => { if (pc === myPc && e.candidate) relay({ sig: { c: e.candidate.toJSON() } }); };
  myPc.onconnectionstatechange = () => {
    if (pc !== myPc) return;
    if (myPc.connectionState === 'failed' || myPc.connectionState === 'closed') onP2PDown();
  };
  if (me === 0) {
    // 순서 보장·재전송 없이 최대한 빠르게. 대신 매번 최근 입력 여러 개를 같이 보내서 유실을 메움
    setupDC(myPc.createDataChannel('g', { ordered: false, maxRetransmits: 0 }), myPc);
    myPc.createOffer().then(o => myPc.setLocalDescription(o)).then(() => { if (pc === myPc) sendSdp(myPc.localDescription); }).catch(() => {});
  } else {
    myPc.ondatachannel = e => { if (pc === myPc) setupDC(e.channel, myPc); };
  }
}

function setupDC(ch, myPc) {
  dc = ch;
  ch.onopen = () => {
    if (pc !== myPc) return;
    p2p = true;
    if (mode === 'sync') measurePing();
  };
  ch.onmessage = e => {
    if (pc !== myPc) return;
    let d; try { d = JSON.parse(e.data); } catch { return; }
    onData(d);
  };
  ch.onclose = () => { if (pc === myPc) onP2PDown(); };
}

// 직접 연결이 끊기면 서버 경유로 전환하고, 상대가 못 받았을 수 있는 입력을 다시 보냄
function onP2PDown() {
  const was = p2p;
  p2p = false;
  if (was && net && mode === 'online') {
    const fs = [...net.local.keys()].sort((a, b) => a - b);
    if (fs.length) relay({ f0: fs[0], ks: fs.map(f => net.local.get(f)) });
  }
}

// 서버 메시지 크기 제한(1KB) 때문에 연결 정보를 조각내서 보냄
function sendSdp(desc) {
  const s = desc.sdp, size = 600, id = Math.floor(performance.now()) % 100000;
  const n = Math.ceil(s.length / size);
  for (let i = 0; i < n; i++) relay({ sig: { t: desc.type, id, i, n, p: s.slice(i * size, (i + 1) * size) } });
}

function onSig(sig) {
  const myPc = pc;
  if (!myPc) return;
  if (sig.c) {
    if (myPc.remoteDescription) myPc.addIceCandidate(sig.c).catch(() => {});
    else pendingCands.push(sig.c);
    return;
  }
  if (!sig.t) return;
  const key = sig.t + sig.id;
  const buf = sdpParts[key] || (sdpParts[key] = []);
  buf[sig.i] = sig.p;
  if (buf.filter(x => x !== undefined).length !== sig.n) return;
  delete sdpParts[key];
  const desc = { type: sig.t, sdp: buf.join('') };
  myPc.setRemoteDescription(desc).then(() => {
    if (pc !== myPc) return;
    pendingCands.forEach(c => myPc.addIceCandidate(c).catch(() => {}));
    pendingCands = [];
    if (desc.type === 'offer') {
      return myPc.createAnswer().then(a => myPc.setLocalDescription(a)).then(() => { if (pc === myPc) sendSdp(myPc.localDescription); });
    }
  }).catch(() => {});
}

// ---------------- 시작 동기화 ----------------
// 직접 연결을 먼저 시도하고(최대 4초), 연결된 경로로 1P가 핑을 재서 입력 지연을 정함
function beginSync() {
  mode = 'sync';
  net = { pings: [], D: 0, pinging: false, verOk: false, wantPing: false };
  hideLobby();
  setStatus('상대 PC와 직접 연결하는 중…');
  relay({ ver: APP_VERSION });          // 서로 버전 확인 (다르면 화면이 어긋나므로 시작하지 않음)
  startP2P();
  const mySession = session;
  setTimeout(() => { if (mode === 'sync' && session === mySession) measurePing(); }, 4000);
  setTimeout(() => { if (mode === 'sync' && session === mySession && net && !net.verOk) versionMismatch(0); }, 7000);
}

function versionMismatch(theirs) {
  leave();
  setStatus(`상대와 게임 버전이 달라요 (나 v${APP_VERSION} / 상대 ${theirs ? 'v' + theirs : '구버전'}). 둘 다 프로그램을 껐다 켜면 자동으로 최신 버전이 돼요.`);
}

function measurePing() {
  if (me !== 0 || !net || net.pinging) return;
  if (!net.verOk) { net.wantPing = true; return; }
  net.pinging = true;
  let n = 0;
  const timer = setInterval(() => {
    if (mode !== 'sync' || n >= 6) { clearInterval(timer); return; }
    n++; sendNet({ ping: performance.now() });
  }, 100);
}

function startOnline(D, rtt) {
  Game.newMatch();
  mode = 'online';
  localPause = false; pressed = 0;
  net = { D, f: 0, local: new Map(), remote: new Map(), stall: 0, rtt: rtt || 0, sums: new Map(), desync: false, lastPing: 0 };
  for (let i = 0; i < D; i++) { net.local.set(i, 0); net.remote.set(i, 0); }
  hideLobby();
  cv.focus();
}

function onData(d) {
  if (!d || typeof d !== 'object') return;
  if (d.ver !== undefined) {
    if (mode !== 'sync' || !net) return;
    if (d.ver !== APP_VERSION) { versionMismatch(d.ver); return; }
    net.verOk = true;
    if (net.wantPing) { net.wantPing = false; measurePing(); }
    return;
  }
  if (d.ping !== undefined) { sendNet({ pong: d.ping }); return; }
  if (d.pong !== undefined) {
    const rtt = performance.now() - d.pong;
    if (mode === 'sync' && me === 0) {
      net.pings.push(rtt);
      if (net.pings.length === 6) {
        const sorted = net.pings.slice().sort((a, b) => a - b);
        const med = sorted[3];
        // 상대 PC까지 한 방향 시간 ≈ rtt/2 → 그만큼 프레임 늦게 실행하면 끊김 없이 맞춰짐
        const D = Math.max(2, Math.min(20, Math.ceil(med / 2 / DT) + (p2p ? 1 : 2)));
        sendNet({ start: D, rtt: med });
        startOnline(D, med);
      }
    } else if (net) net.rtt = net.rtt ? net.rtt * 0.7 + rtt * 0.3 : rtt;
    return;
  }
  if (d.start !== undefined) { if (me === 1 && mode === 'sync' && net.verOk) startOnline(d.start, d.rtt); return; }
  if (!net || mode !== 'online') return;
  if (d.f0 !== undefined && Array.isArray(d.ks)) {
    for (let i = 0; i < d.ks.length; i++) {
      const f = d.f0 + i;
      if (f >= net.f && !net.remote.has(f)) net.remote.set(f, d.ks[i] | 0);
    }
  }
  if (d.cs !== undefined) {
    const mine = net.sums.get(d.cs[0]);
    if (mine !== undefined && mine !== d.cs[1]) net.desync = true;
  }
}

// ---------------- 게임 진행 (고정 60fps) ----------------
// 창이 숨겨져도 계속 돌아야 상대가 멈추지 않으므로 requestAnimationFrame 대신 setInterval 사용
const REDUNDANT = 8; // 보낼 때마다 최근 입력 8프레임치를 같이 보냄
function netTick() {
  if (mode === 'practice') { Game.step(sample(), 0); return; }
  if (mode !== 'online') return;
  const tf = net.f + net.D;
  if (!net.local.has(tf)) {
    net.local.set(tf, sample());
    const f0 = Math.max(0, tf - REDUNDANT + 1), ks = [];
    for (let f = f0; f <= tf; f++) ks.push(net.local.has(f) ? net.local.get(f) : 0);
    sendNet({ f0, ks });
  }
  if (!net.remote.has(net.f)) { net.stall++; return; }
  const kl = net.local.get(net.f), kr = net.remote.get(net.f);
  if (me === 0) Game.step(kl, kr); else Game.step(kr, kl);
  net.remote.delete(net.f);
  net.local.delete(net.f - 60); // 재전송용으로 최근 60프레임은 보관
  net.f++;
  net.stall = 0;
  if (net.f % 120 === 0) {
    const c = Game.checksum();
    net.sums.set(net.f, c);
    if (net.sums.size > 20) net.sums.delete(net.sums.keys().next().value);
    sendNet({ cs: [net.f, c] });
  }
  if (performance.now() - net.lastPing > 2000) { net.lastPing = performance.now(); sendNet({ ping: performance.now() }); }
}

let acc = 0, last = performance.now();
setInterval(() => {
  const now = performance.now();
  acc += Math.min(250, now - last); last = now;
  let n = 0;
  while (acc >= DT && n < 5) { acc -= DT; n++; netTick(); }
  if (acc > DT * 5) acc = DT * 2;
}, 4);

// 창 크기에 맞춰 캔버스 해상도 조절 (게임 좌표는 항상 800x400)
function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  ctx.setTransform(w / Game.W, 0, 0, h / Game.H, 0, 0);
  document.documentElement.style.setProperty('--z', Math.max(0.45, Math.min(1.6, innerWidth / 800)).toFixed(3));
}

// 오른쪽 아래 손잡이로 크기 조절
(() => {
  const grip = $('grip');
  let startX = 0, startW = 0, dragging = false;
  grip.addEventListener('pointerdown', e => {
    dragging = true; startX = e.screenX; startW = innerWidth;
    grip.setPointerCapture(e.pointerId); e.preventDefault();
  });
  grip.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.screenX - startX;
    bridge.resize(startW + dx);
  });
  const end = () => { dragging = false; try { localStorage.setItem('winW', String(innerWidth)); } catch {} };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  try { const w = +localStorage.getItem('winW'); if (w >= 320) bridge.resize(w); } catch {}
})();

let tick = 0;
function frame() {
  tick++;
  fitCanvas();
  if (mode === 'online' || mode === 'practice') {
    Game.render(ctx, { me: mode === 'online' ? me : 0, tick });
    if (mode === 'online') {
      const info = [];
      info.push(p2p ? '직접 연결' : '서버 경유');
      info.push('핑 ' + Math.round(net.rtt) + 'ms');
      info.push('지연 ' + net.D + 'f');
      if (net.stall > 20) info.push('⚠ 상대 응답 대기 중');
      if (net.desync) info.push('⚠ 화면 어긋남 — 다시 시작 권장');
      $('netinfo').textContent = info.join(' · ');
    } else $('netinfo').textContent = '혼자 연습 (상대는 가만히 서 있어요)';
  } else {
    ctx.clearRect(0, 0, Game.W, Game.H);
    $('netinfo').textContent = '';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- 로비 ----------------
function showLobby(waiting) {
  $('lobby').classList.remove('hidden');
  $('keyBox').classList.add('hidden');
  capturing = null;
  $('waitBox').classList.toggle('hidden', !waiting);
  $('menuBox').classList.toggle('hidden', !!waiting);
}
function hideLobby() { $('lobby').classList.add('hidden'); }

function createRoom() {
  if (!wsReady) { setStatus('아직 서버에 연결 중이에요. 잠시만요…'); return; }
  session = -1; inRoom = true;
  send({ type: 'create', game: 'fighter' });
}
function joinRoom() {
  const code = $('codeInput').value.trim().toUpperCase();
  if (!code) return;
  if (!wsReady) { setStatus('아직 서버에 연결 중이에요. 잠시만요…'); return; }
  session = -1; inRoom = true;
  send({ type: 'join', room: code });
}
function leave() {
  send({ type: 'leave' });
  inRoom = false;   // 나간 뒤 늦게 도착하는 방 소식은 무시
  closeP2P();
  mode = 'idle'; net = null; session = -1; roomCode = '';
  $('roomCode').textContent = '-';
  showLobby(false);
  setStatus(wsReady ? '방을 만들거나 코드를 입력하세요.' : '서버에 연결하는 중…');
}
function practice() {
  mode = 'practice'; localPause = false; me = 0;
  Game.newMatch();
  hideLobby(); cv.focus();
}

$('btnCreate').onclick = createRoom;
$('btnJoin').onclick = joinRoom;
$('btnPractice').onclick = practice;
$('btnKeys').onclick = () => { $('menuBox').classList.add('hidden'); $('keyBox').classList.remove('hidden'); $('keyMsg').textContent = ''; renderKeyTable(); };
$('btnKeysDone').onclick = () => showLobby(false);
$('btnKeysReset').onclick = () => { binds = JSON.parse(JSON.stringify(DEFAULT_BINDS)); capturing = null; rebuildKeymap(); renderKeyTable(); };
$('btnCancel').onclick = leave;
$('btnLeave').onclick = () => { if (mode === 'practice') { mode = 'idle'; showLobby(false); } else leave(); };
$('btnHide').onclick = () => { localPause = true; bridge.toggle(); };
$('btnClose').onclick = () => bridge.quit();
$('btnCopy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(roomCode).catch(() => {}); $('btnCopy').textContent = '복사됨'; setTimeout(() => $('btnCopy').textContent = '복사', 1200); };

rebuildKeymap();
$('verLabel').textContent = 'v' + APP_VERSION + (new URLSearchParams(location.search).get('upd') === '1' ? ' · 방금 업데이트됨' : '');
connect();
