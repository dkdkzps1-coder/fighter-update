// 몰래 격투 — 게임 로직 + 그리기 (v6: 역동적인 동작)
// 중요: step()은 같은 입력이 들어오면 두 PC에서 완전히 같은 결과가 나와야 함 (락스텝).
//       그래서 게임 상태를 바꾸는 코드에서는 Math.random()이나 시간 함수를 쓰지 않음.
'use strict';

const Game = (() => {
  const W = 800, H = 400, FLOOR = 330, GRAV = 1.0, LEFTB = 30, RIGHTB = 770;
  const PIX = '"Press Start 2P", monospace';
  const BUF_FRAMES = 5;
  const DTAP = 13;          // 방향키 두 번 누르기 인정 간격(프레임)

  // 입력 비트
  const BIT = { l: 1, r: 2, u: 4, g: 8, lp: 16, hp: 32, sp: 64, pause: 128, enter: 256 };

  // 기술 데이터 (프레임 단위, 60fps). lunge = 시작할 때 앞으로 내딛는 힘
  const ATK = {
    light:   { startup: 4,  active: 3,  recovery: 9,  dmg: 6,  hitstun: 15, blockstun: 9,  chip: 0, push: 6,  meter: 8,  lunge: 3.5, box: { x: 20, y: -74, w: 48, h: 16 } },
    heavy:   { startup: 10, active: 4,  recovery: 20, dmg: 14, hitstun: 26, blockstun: 13, chip: 1, push: 11, meter: 12, lunge: 7.5, box: { x: 18, y: -60, w: 66, h: 24 }, launch: true, wall: true },
    special: { startup: 14, active: 1,  recovery: 26, dmg: 18, hitstun: 28, blockstun: 16, chip: 3, push: 10, meter: 0,  cost: 50, proj: true },
    dive:    { startup: 5,  active: 60, recovery: 0,  dmg: 12, hitstun: 22, blockstun: 12, chip: 1, push: 7,  meter: 10, box: { x: 8, y: -34, w: 50, h: 38 }, dive: true },
  };

  function makeF(id, gi, belt) {
    return { id, x: 0, y: FLOOR, vx: 0, vy: 0, facing: 1, hp: 100, ghost: 100, meter: 0, state: 'idle', t: 0,
      atk: null, atkName: '', hit: false, stun: 0, airAtk: false, gi, belt, wins: 0, flash: 0, walkT: 0,
      prevDir: 0, tapDir: 0, tapAt: -99, lag: 0, landT: 0, wb: false, fromDash: false, trail: [] };
  }
  const F = [makeF(0, '#e8473c', '#2b1a17'), makeF(1, '#3f8ff0', '#141c2b')];
  const game = { phase: 'intro', t: 0, round: 1, timer: 99 * 60, hitstop: 0, shake: 0, msg: '', winner: -1, slow: 0, pausedBy: 0,
    zoom: 0, zx: W / 2, zy: H / 2 };
  let projs = [], sparks = [], frameCount = 0;
  const bufs = [{ lp: 0, hp: 0, sp: 0 }, { lp: 0, hp: 0, sp: 0 }];

  function resetRound() {
    F.forEach((f, i) => Object.assign(f, { x: i ? 550 : 250, y: FLOOR, vx: 0, vy: 0, facing: i ? -1 : 1, hp: 100, ghost: 100,
      state: 'idle', t: 0, atk: null, hit: false, stun: 0, airAtk: false, flash: 0, walkT: 0,
      prevDir: 0, tapDir: 0, tapAt: -99, lag: 0, landT: 0, wb: false, fromDash: false, trail: [] }));
    projs = []; sparks = [];
    bufs.forEach(b => { b.lp = b.hp = b.sp = 0; });
    Object.assign(game, { phase: 'intro', t: 0, timer: 99 * 60, hitstop: 0, slow: 0, msg: '', zoom: 0 });
  }
  function newMatch() {
    F.forEach(f => { f.wins = 0; f.meter = 0; });
    game.round = 1; game.shake = 0; game.pausedBy = 0; frameCount = 0;
    resetRound();
  }

  const onGround = f => f.y >= FLOOR;
  const decode = k => ({ l: !!(k & BIT.l), r: !!(k & BIT.r), u: !!(k & BIT.u), g: !!(k & BIT.g) });
  // 이펙트용 고정 난수 (같은 프레임이면 두 PC에서 같은 값)
  const rnd = i => { const v = Math.sin(frameCount * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };

  // ---------------- 이펙트 (게임 결과에는 영향 없음) ----------------
  function spark(x, y, color, size) { sparks.push({ k: 'star', x, y, color, size, life: 14, max: 14, rot: (frameCount * 0.7) % Math.PI }); }
  function ring(x, y, color, size) { sparks.push({ k: 'ring', x, y, color, size, life: 12, max: 12 }); }
  function dust(x, y, dir, n, power) {
    for (let i = 0; i < n; i++) {
      const sp = (0.6 + rnd(i) * 0.8) * power;
      sparks.push({ k: 'dust', x: x + (rnd(i + 7) - 0.5) * 16, y: y - rnd(i + 3) * 6, vx: dir * sp + (rnd(i + 11) - 0.5) * 1.5,
        vy: -rnd(i + 5) * 1.6, size: 4 + rnd(i + 13) * 5, life: 18 + (i % 3) * 4, max: 26 });
    }
  }
  function punchZoom(x, y, z) { if (z > game.zoom) { game.zoom = z; game.zx = x; game.zy = y; } }

  function startAtk(f, name) {
    const a = ATK[name];
    if (a.cost) { if (f.meter < a.cost) return false; f.meter -= a.cost; }
    f.fromDash = f.state === 'dash';
    f.state = 'attack'; f.atk = a; f.atkName = name; f.t = 0; f.hit = false;
    if (!onGround(f)) f.airAtk = true;
    return true;
  }

  function doJump(f, dirX, run) {
    f.vy = run ? -16 : -17; f.vx = run ? f.facing * 6.8 : dirX * 5.2;
    f.y -= 1; f.state = 'jump'; f.t = 0;
    dust(f.x, FLOOR, -Math.sign(f.vx || f.facing), 4, 1.4);
  }

  function updateFighter(f, o, inp, b, canAct) {
    f.t++;
    if (f.flash > 0) f.flash--;
    if (f.landT > 0) f.landT--;
    const ground = onGround(f);

    // 방향키 두 번 연속 → 대시 / 백대시
    const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    let dashReq = 0;
    if (dir && dir !== f.prevDir) {
      if (dir === f.tapDir && frameCount - f.tapAt <= DTAP) { dashReq = dir; f.tapDir = 0; }
      else { f.tapDir = dir; f.tapAt = frameCount; }
    }
    f.prevDir = dir;

    if (f.state === 'ko' || f.state === 'win') {
      if (ground) f.vx *= 0.85;
    } else if (f.state === 'hitstun' || f.state === 'blockstun') {
      if (ground) f.vx *= 0.82;
      if (f.t >= f.stun && ground) { f.state = 'idle'; f.t = 0; f.wb = false; }
    } else if (f.state === 'land') {
      f.vx *= 0.7;
      if (f.t >= f.lag) { f.state = 'idle'; f.t = 0; }
    } else if (f.state === 'attack') {
      const a = f.atk;
      if (a.dive) {
        if (f.t < a.startup) { f.vy *= 0.35; f.vx *= 0.6; }          // 공중에서 잠깐 멈칫
        else if (f.t === a.startup) { f.vy = 11; f.vx = f.facing * 8; ring(f.x, f.y - 50, 'rgba(255,255,255,.8)', 18); }
      } else {
        if (ground) {
          if (f.t === 1 && a.lunge) f.vx = f.facing * a.lunge * (f.fromDash ? 1.5 : 1);
          f.vx *= f.t <= a.startup + a.active ? 0.9 : 0.72;
        }
        if (a.proj && f.t === a.startup) {
          projs.push({ x: f.x + f.facing * 40, y: f.y - 64, vx: f.facing * 8.5, owner: f.id, life: 160, t: 0 });
          if (ground) f.vx = -f.facing * 3.5;                          // 반동으로 살짝 밀려남
          ring(f.x + f.facing * 40, f.y - 64, f.id ? '#8cc4ff' : '#ff9a7a', 22);
          dust(f.x, FLOOR, -f.facing, 4, 1.6);
        }
        if (f.t >= a.startup + a.active + a.recovery) { f.state = ground ? 'idle' : 'jump'; f.atk = null; f.t = 0; }
      }
    } else if (f.state === 'dash') {
      f.vx = f.facing * Math.max(3, 11 - f.t * 0.5);
      if (f.t % 4 === 0) dust(f.x - f.facing * 10, FLOOR, -f.facing, 1, 1.2);
      if (canAct && b.sp && startAtk(f, 'special')) b.sp = 0;
      else if (canAct && b.hp) { startAtk(f, 'heavy'); b.hp = 0; }
      else if (canAct && b.lp) { startAtk(f, 'light'); b.lp = 0; }
      else if (canAct && inp.u) doJump(f, f.facing, true);
      else if (f.t >= 15) { f.state = 'idle'; f.t = 0; }
    } else if (f.state === 'bdash') {
      // 공중에 살짝 뜬 채로 뒤로 빠짐 — 땅에 닿으면 끝
    } else if (canAct) {
      if (ground) {
        if (b.sp && startAtk(f, 'special')) b.sp = 0;
        else if (b.hp) { startAtk(f, 'heavy'); b.hp = 0; }
        else if (b.lp) { startAtk(f, 'light'); b.lp = 0; }
        else if (dashReq && dashReq === f.facing) {
          f.state = 'dash'; f.t = 0; f.vx = f.facing * 11;
          dust(f.x, FLOOR, -f.facing, 6, 2.2); ring(f.x - f.facing * 14, FLOOR - 30, 'rgba(255,255,255,.55)', 14);
        } else if (dashReq) {
          f.state = 'bdash'; f.t = 0; f.vx = -f.facing * 8; f.vy = -6.5; f.y -= 1;
          dust(f.x, FLOOR, f.facing, 5, 1.8);
        }
        else if (inp.g) { f.state = 'guard'; f.vx = 0; }
        else if (inp.u) doJump(f, dir, false);
        else {
          f.vx = dir * (dir === f.facing ? 4.2 : 3.2);
          if (dir) { f.state = 'walk'; f.walkT += dir * f.facing; } else f.state = 'idle';
        }
      } else if (!f.airAtk) {
        if (b.hp) { startAtk(f, 'dive'); b.hp = 0; }
        else if (b.lp) { startAtk(f, 'light'); b.lp = 0; }
      }
    } else if (ground) { f.vx = 0; if (f.state === 'walk' || f.state === 'guard' || f.state === 'dash') f.state = 'idle'; }

    if (!ground || f.vy < 0) f.vy += GRAV;
    f.x += f.vx; f.y += f.vy;
    if (f.y >= FLOOR) {
      const impact = f.vy;
      f.y = FLOOR; f.vy = 0;
      if (impact > 0) {
        f.airAtk = false;
        f.landT = Math.min(8, 3 + Math.round(impact / 3));
        if (impact > 6) dust(f.x, FLOOR, 1, 3, impact / 6), dust(f.x, FLOOR, -1, 3, impact / 6);
        if (f.state === 'jump' || f.state === 'bdash') { f.state = 'idle'; f.t = 0; }
        else if (f.state === 'attack') {
          if (f.atkName === 'dive') { f.state = 'land'; f.lag = 11; f.t = 0; game.shake = Math.max(game.shake, 3); }
          else f.state = 'idle';
          f.atk = null; f.t = 0;
        } else if (f.state === 'ko' && impact > 5) {
          f.vy = -impact * 0.38; f.y = FLOOR - 1; f.vx *= 0.6;       // KO 되면 바닥에 한 번 튕김
          game.shake = Math.max(game.shake, 7);
        }
      }
    }
    // 강공격에 맞고 날아가다 벽에 부딪히면 튕겨 나옴
    if (f.x < LEFTB || f.x > RIGHTB) {
      if (f.wb && (f.state === 'hitstun' || f.state === 'ko') && Math.abs(f.vx) > 4) {
        f.vx = -f.vx * 0.55; f.vy = Math.min(f.vy, -6); f.wb = false;
        if (onGround(f)) f.y = FLOOR - 1;
        const wx = f.x < LEFTB ? LEFTB - 14 : RIGHTB + 14;
        spark(wx, f.y - 50, '#ffffff', 14); dust(wx, f.y - 30, Math.sign(f.vx), 5, 2);
        game.shake = Math.max(game.shake, 8); game.hitstop = Math.max(game.hitstop, 4);
      }
    }
    f.x = Math.max(LEFTB, Math.min(RIGHTB, f.x));
    if (onGround(f) && (f.state === 'idle' || f.state === 'walk' || f.state === 'guard')) f.facing = o.x >= f.x ? 1 : -1;
  }

  // 빠르게 움직일 때 잔상 남기기
  function isFast(f) {
    if (f.state === 'dash' || f.state === 'bdash') return true;
    if (f.state === 'attack' && f.atk && f.t >= f.atk.startup - 1 && (f.atk.dive || f.atkName === 'heavy')) return true;
    if ((f.state === 'hitstun' || f.state === 'ko') && (Math.abs(f.vx) > 6 || f.y < FLOOR - 20)) return true;
    return false;
  }
  function updateTrail(f) {
    if (isFast(f) && frameCount % 2 === 0) {
      const s = {}; for (const k in f) if (k !== 'trail') s[k] = f[k];
      f.trail.push(s);
      if (f.trail.length > 5) f.trail.shift();
    } else if (!isFast(f) && f.trail.length && frameCount % 2 === 0) f.trail.shift();
  }

  function hurtbox(f) {
    const h = f.state === 'guard' ? 74 : f.state === 'dash' ? 84 : 94;
    return { x: f.x - 18, y: f.y - h, w: 36, h };
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function applyHit(att, def, a, dirX, hx, hy) {
    const facingAtt = (att.x - def.x) * def.facing > 0 || Math.abs(att.x - def.x) < 2;
    const blocked = (def.state === 'guard' || def.state === 'blockstun') && facingAtt;
    const big = a.dmg > 10;
    if (blocked) {
      def.hp -= a.chip;
      def.state = 'blockstun'; def.stun = a.blockstun; def.t = 0;
      def.vx = dirX * a.push * 0.9;
      def.meter = Math.min(100, def.meter + 4); att.meter = Math.min(100, att.meter + a.meter / 2);
      spark(hx, hy, '#9fd3ff', 8); ring(hx, hy, '#9fd3ff', 10);
      dust(def.x, FLOOR, dirX, 3, 1.5);
      game.hitstop = 5;
    } else {
      def.hp -= a.dmg;
      def.state = 'hitstun'; def.stun = a.hitstun; def.t = 0; def.atk = null;
      def.vx = dirX * a.push;
      if (a.launch) { def.vy = -11; def.y = Math.min(def.y, FLOOR - 1); def.wb = true; }
      else if (!onGround(def)) { def.vy = -8; }
      else if (a.dive || a.proj) { def.vy = -4; def.y = FLOOR - 1; }
      def.flash = 8;
      def.meter = Math.min(100, def.meter + 6); att.meter = Math.min(100, att.meter + a.meter);
      spark(hx, hy, '#ffd84e', big ? 18 : 11); ring(hx, hy, big ? '#fff3b0' : 'rgba(255,255,255,.7)', big ? 26 : 14);
      game.hitstop = big ? 11 : 6; game.shake = big ? 10 : 4;
      if (big) punchZoom(hx, hy, 0.06);
    }
    if (def.hp <= 0) {
      def.hp = 0; def.state = 'ko'; def.t = 0; def.vy = -13; def.vx = dirX * 9; def.y = FLOOR - 1; def.wb = true;
      ring(hx, hy, '#ffffff', 40);
      punchZoom(hx, hy, 0.13);
      Object.assign(game, { phase: 'ko', t: 0, winner: att.id, slow: 60, hitstop: 20, shake: 14, msg: 'K.O.' });
    }
  }

  function checkHits() {
    for (const f of F) {
      const o = F[1 - f.id];
      if (f.state !== 'attack' || f.atk.proj || f.hit) continue;
      const a = f.atk;
      if (f.t < a.startup || f.t >= a.startup + a.active) continue;
      const bx = a.box, air = !onGround(f) && !a.dive;
      const hb = { x: f.facing === 1 ? f.x + bx.x : f.x - bx.x - bx.w, y: f.y + bx.y + (air ? 18 : 0), w: bx.w, h: bx.h };
      if (o.state !== 'ko' && overlap(hb, hurtbox(o))) {
        f.hit = true;
        applyHit(f, o, a, f.facing, f.facing === 1 ? hb.x + hb.w - 6 : hb.x + 6, hb.y + hb.h / 2);
        if (a.dive && game.phase !== 'ko') {          // 내려찍기가 맞으면 뒤로 튕겨 오름
          f.state = 'jump'; f.atk = null; f.t = 0; f.vy = -9; f.vx = -f.facing * 3.5;
        }
        if (game.phase === 'ko') return;
      }
    }
  }

  function updateProjs() {
    for (const p of projs) {
      p.x += p.vx; p.life--; p.t++;
      const o = F[1 - p.owner];
      if (game.phase === 'fight' && o.state !== 'ko' && overlap({ x: p.x - 14, y: p.y - 14, w: 28, h: 28 }, hurtbox(o))) {
        p.life = 0;
        applyHit(F[p.owner], o, ATK.special, Math.sign(p.vx), p.x, p.y);
      }
    }
    for (let i = 0; i < projs.length; i++) for (let j = i + 1; j < projs.length; j++) {
      const a = projs[i], b = projs[j];
      if (a.owner !== b.owner && a.life > 0 && b.life > 0 && Math.abs(a.x - b.x) < 26 && Math.abs(a.y - b.y) < 30) {
        a.life = b.life = 0; spark((a.x + b.x) / 2, a.y, '#ffffff', 18); ring((a.x + b.x) / 2, a.y, '#ffffff', 30);
        game.shake = Math.max(game.shake, 6);
      }
    }
    projs = projs.filter(p => p.life > 0 && p.x > -40 && p.x < W + 40);
  }

  function separate() {
    const [a, b] = F;
    if (a.state === 'ko' || b.state === 'ko') return;
    const dx = b.x - a.x, minD = 38;
    if (Math.abs(dx) < minD && Math.abs(a.y - b.y) < 80) {
      const push = (minD - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
      a.x -= push; b.x += push;
      a.x = Math.max(LEFTB, Math.min(RIGHTB, a.x)); b.x = Math.max(LEFTB, Math.min(RIGHTB, b.x));
      if (Math.abs(b.x - a.x) < minD) {
        if (a.x <= LEFTB + 1 || b.x <= LEFTB + 1) { const l = a.x < b.x ? a : b, r = l === a ? b : a; r.x = l.x + minD; }
        else { const r = a.x > b.x ? a : b, l = r === a ? b : a; l.x = r.x - minD; }
      }
    }
  }

  // 한 프레임 진행. k0 = 1P 입력, k1 = 2P 입력 (비트값)
  function step(k0, k1) {
    game.pausedBy = (k0 & BIT.pause ? 1 : 0) | (k1 & BIT.pause ? 2 : 0);
    if (game.pausedBy) return;
    if (game.phase === 'over') {
      if ((k0 | k1) & BIT.enter) newMatch();
      return;
    }
    frameCount++;
    const ks = [k0, k1];
    for (const p of [0, 1]) for (const n of ['lp', 'hp', 'sp']) if (ks[p] & BIT[n]) bufs[p][n] = BUF_FRAMES;

    for (const s of sparks) {
      s.life--;
      if (s.k === 'dust') { s.x += s.vx; s.y += s.vy; s.vx *= 0.9; s.vy *= 0.9; }
    }
    sparks = sparks.filter(s => s.life > 0);
    F.forEach(f => { if (f.ghost > f.hp) f.ghost = Math.max(f.hp, f.ghost - 0.6); });
    if (game.shake > 0) game.shake--;
    game.zoom = game.zoom > 0.002 ? game.zoom * 0.88 : 0;

    if (game.hitstop > 0) { game.hitstop--; return; }
    if (game.slow > 0) { game.slow--; if (game.slow % 2) return; }

    for (const p of [0, 1]) for (const n in bufs[p]) if (bufs[p][n] > 0) bufs[p][n]--;

    game.t++;
    const fighting = game.phase === 'fight';
    if (game.phase === 'intro') {
      game.msg = game.t < 70 ? 'ROUND ' + game.round : 'FIGHT!';
      if (game.t >= 100) { game.phase = 'fight'; game.t = 0; game.msg = ''; }
    }

    F.forEach(f => updateFighter(f, F[1 - f.id], fighting ? decode(ks[f.id]) : {}, fighting ? bufs[f.id] : {}, fighting));
    if (fighting) checkHits();
    updateProjs();
    separate();
    F.forEach(updateTrail);

    if (game.phase === 'fight') {
      game.timer--;
      if (game.timer <= 0) {
        Object.assign(game, { timer: 0, phase: 'ko', t: 0, msg: 'TIME', winner: F[0].hp === F[1].hp ? -1 : (F[0].hp > F[1].hp ? 0 : 1) });
      }
    } else if (game.phase === 'ko') {
      if (game.t === 90) {
        if (game.winner >= 0) { F[game.winner].wins++; if (F[game.winner].state !== 'ko') F[game.winner].state = 'win'; }
        game.msg = game.winner < 0 ? 'DRAW' : (game.winner + 1) + 'P WINS';
      }
      if (game.t >= 190) {
        const champ = F.find(f => f.wins >= 2);
        if (champ) { game.phase = 'over'; game.msg = (champ.id + 1) + 'P VICTORY!'; }
        else { game.round++; resetRound(); }
      }
    }
  }

  // 동기화 확인용 체크값 (두 PC가 같은 값이면 정상)
  function checksum() {
    let h = 0;
    for (const f of F) h = (h * 31 + Math.round(f.x * 100) + Math.round(f.y * 100) * 7 + f.hp * 131 + f.wins * 977) | 0;
    return (h * 31 + game.timer + projs.length * 17) | 0;
  }

  // ---------------- 그리기 ----------------
  const SKIN = '#f2c48d', SKIN_D = '#c98f5a', HAIR = '#1b1b1f', PANTS_D = 'rgba(0,0,0,.22)';
  let ctx;
  function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function drawFighter(f, isMe, ghost) {
    ctx.save();
    if (!ghost) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      const sh = Math.max(0.4, 1 - (FLOOR - f.y) / 200);
      ctx.beginPath(); ctx.ellipse(f.x, FLOOR + 3, 26 * sh, 6 * sh, 0, 0, Math.PI * 2); ctx.fill();
      if (isMe) { // 내 캐릭터 머리 위 표시
        ctx.fillStyle = f.id === 0 ? '#ff8a80' : '#8cc4ff';
        const ty = f.y - 120 + Math.sin(frameCount / 10) * 2;
        ctx.beginPath(); ctx.moveTo(f.x - 6, ty); ctx.lineTo(f.x + 6, ty); ctx.lineTo(f.x, ty + 7); ctx.fill();
      }
    }

    ctx.translate(Math.round(f.x), Math.round(f.y));
    ctx.scale(f.facing, 1);

    const gi = ghost ? ghost : (f.flash > 0 && f.flash % 2 ? '#ffffff' : f.gi);
    const skin = ghost || SKIN, skinD = ghost || SKIN_D, hair = ghost || HAIR, belt = ghost || f.belt;
    const st = f.state, a = f.atk;
    const active = st === 'attack' && a && f.t >= a.startup && f.t < a.startup + a.active + 3;
    const wind = st === 'attack' && a && f.t < a.startup;
    const air = f.y < FLOOR;
    const lvx = f.vx * f.facing;            // 바라보는 방향 기준 속도

    if (st === 'ko' && !air && f.t > 10) {
      rect(-44, -14, 60, 14, gi); rect(-44, -14, 60, 4, PANTS_D);
      rect(16, -16, 18, 16, skin); rect(16, -18, 18, 6, hair);
      rect(-10, -16, 6, 16, belt);
      ctx.restore(); return;
    }

    // ---- 몸 전체 기울기 + 찌그러짐/늘어남 ----
    let tilt = clamp(lvx * 0.022, -0.2, 0.2);
    let sx = 1, sy = 1;
    if (st === 'dash') tilt = 0.3;
    else if (st === 'bdash') tilt = -0.22;
    else if (st === 'attack' && a) {
      if (wind) tilt = a.dive ? -0.25 : -0.12 * (f.t / a.startup);
      else if (active) tilt = f.atkName === 'heavy' ? 0.06 : a.dive ? -0.12 : 0.14;
      else tilt = 0.05;
    } else if (st === 'hitstun') tilt = air ? -0.55 : -0.3 * (1 - f.t / Math.max(1, f.stun));
    else if (st === 'blockstun') tilt = -0.1;
    if (air && st !== 'attack') { const s = Math.min(Math.abs(f.vy) * 0.012, 0.16); sy = 1 + s; sx = 1 - s * 0.7; }
    if (f.landT > 0 && !air) { const s = f.landT / 8 * 0.2; sy = 1 - s; sx = 1 + s * 0.8; }
    if (st === 'attack' && a && !a.dive && wind && !air) { sy = 0.94; sx = 1.04; }       // 힘 모으기
    if (st === 'attack' && a && !a.dive && active && !air) { sy = 1.04; sx = 0.97; }     // 뻗기
    ctx.rotate(tilt);
    if (st === 'ko' && air) { ctx.translate(0, -50); ctx.rotate(-f.t * 0.28); ctx.translate(0, 50); }
    ctx.scale(sx, sy);

    let lean = 0, bob = 0, crouch = 0;
    if (st === 'idle') crouch = Math.abs(Math.sin(frameCount / 8)) * 4;            // 무릎 반동 스텝
    if (st === 'walk') bob = -Math.abs(Math.sin(f.walkT / 4)) * 3;
    if (st === 'hitstun' || st === 'ko') lean = -7;
    if (st === 'guard' || st === 'blockstun') crouch = 18;
    if (st === 'dash') crouch = 8;
    if (st === 'land') crouch = 16;
    if (st === 'attack' && wind && !air && a && !a.dive) crouch = 6;
    if (st === 'win') bob = -Math.abs(Math.sin(frameCount / 6)) * 6;

    const top = -44 + crouch;
    const kick = st === 'attack' && f.atkName === 'heavy' && active;
    const dive = st === 'attack' && a && a.dive;
    if (dive && !wind) {
      rect(-14, top, 11, 22, gi); rect(-16, top + 20, 13, 6, skinD);              // 접은 뒷다리
      ctx.save(); ctx.translate(0, -40); ctx.rotate(0.8);
      rect(-2, -6, 58, 12, gi); rect(54, -8, 13, 15, skinD);                       // 대각선으로 뻗은 발
      ctx.restore();
    } else if ((air || st === 'bdash') && !kick) {
      rect(-12, top, 10, 26, gi); rect(2, top, 10, 22, gi);
      rect(-14, top + 24, 12, 6, skinD); rect(2, top + 20, 12, 6, skinD);
    } else if (kick) {
      rect(-14, top, 11, 44 - crouch, gi);
      rect(-16, -6, 14, 6, skinD);
      rect(-2, top - 14 + (air ? 18 : 0), 78, 12, gi);
      rect(74, top - 16 + (air ? 18 : 0), 12, 14, skinD);
    } else {
      let s1 = 0, s2 = 0;
      if (st === 'walk') { s1 = Math.sin(f.walkT / 4) * 8; s2 = -s1; }
      if (st === 'dash') { s1 = -12; s2 = 12; }
      if (st === 'attack' && !air) { s1 = -6; s2 = 8; }                            // 앞발 내딛기
      const lh = 44 - crouch;
      rect(-15 + s1, top, 11, lh, gi); rect(4 + s2, top, 11, lh, gi);
      rect(-17 + s1, -6, 14, 6, skinD); rect(3 + s2, -6, 14, 6, skinD);
      rect(-15 + s1, top, 11, 4, PANTS_D); rect(4 + s2, top, 11, 4, PANTS_D);
    }

    ctx.translate(lean, bob + crouch);
    rect(-15, -78, 30, 36, gi);
    rect(-15, -48, 30, 6, belt);
    rect(-3, -78, 8, 22, skin);
    rect(-10, -98, 22, 20, skin);
    rect(-11, -101, 24, 8, hair);
    rect(-13, -96, 6, 8, hair);
    // 머리띠 꼬리: 움직이는 속도에 따라 펄럭임
    const flap = clamp(-lvx * 0.8 + (air ? -f.vy * 0.4 : 0), -10, 10) + Math.sin(frameCount / 4) * 1.5;
    rect(-10, -93, 24, 4, ghost || '#ffffff');
    rect(-16, -93 + flap * 0.2, 6, 3, ghost || '#ffffff'); rect(-21 + Math.min(0, flap) * 0.3, -90 + flap * 0.5, 6, 3, ghost || '#ffffff');
    rect(6, -88, 3, 3, ghost || '#1b1b1f');

    if (st === 'attack' && f.atkName === 'light' && active) {
      rect(4, -74, 64, 9, skin); rect(62, -77, 12, 14, skinD); rect(-8, -72, 14, 10, skin);
    } else if (st === 'attack' && f.atkName === 'special') {
      if (f.t >= a.startup - 2) { rect(6, -70, 36, 10, skin); rect(6, -58, 36, 10, skin); rect(38, -72, 10, 26, skinD); }
      else {
        rect(-22, -66, 18, 10, skin); rect(-22, -56, 18, 10, skin);
        if (!ghost) {
          const r = 6 + f.t * 0.4;
          ctx.fillStyle = 'rgba(120,200,255,' + (0.4 + 0.4 * Math.sin(f.t)) + ')';
          ctx.beginPath(); ctx.arc(-26, -56, r, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (dive) {
      rect(-20, -82, 10, 20, skin); rect(8, -84, 10, 18, skin);                    // 팔 벌려 균형
    } else if (wind) {
      rect(-22, -72, 16, 10, skin); rect(2, -66, 14, 10, skin);
    } else if (st === 'guard' || st === 'blockstun') {
      rect(6, -84, 10, 28, skin); rect(12, -80, 10, 22, skinD);
    } else if (st === 'hitstun') {
      rect(-20, -84, 10, 22, skin); rect(10, -86, 10, 20, skin);
    } else if (st === 'win') {
      rect(6, -118, 10, 40, skin); rect(4, -124, 14, 10, skinD);
    } else if (st === 'dash') {
      rect(-24, -70, 20, 9, skin); rect(10, -72, 18, 9, skin); rect(24, -76, 10, 10, skinD);
    } else {
      rect(6, -74, 22, 9, skin); rect(24, -80, 11, 11, skinD);
      rect(-6, -70, 18, 9, skin); rect(10, -74, 10, 10, skinD);
    }
    ctx.restore();
  }

  function drawTrail(f) {
    const n = f.trail.length;
    const col = f.id === 0 ? '#ff7b6b' : '#6fb2ff';
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.globalAlpha = 0.08 + 0.22 * (i + 1) / n;
      drawFighter(f.trail[i], false, col);
      ctx.restore();
    }
  }

  function drawProj(p) {
    const r = 13 + Math.sin(p.t / 2) * 2;
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, r + 6);
    const col = p.owner === 0 ? '255,130,90' : '110,190,255';
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(' + col + ',.95)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2); ctx.fill();
    const d = Math.sign(p.vx);
    for (let i = 1; i <= 3; i++) {
      ctx.fillStyle = 'rgba(' + col + ',' + (0.4 - i * 0.1) + ')';
      ctx.beginPath(); ctx.ellipse(p.x - d * (12 + i * 12), p.y + Math.sin(p.t / 3 + i) * 3, 18 - i * 3, 7 - i, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawSpark(s) {
    const k = 1 - s.life / s.max;
    ctx.save();
    if (s.k === 'dust') {
      ctx.globalAlpha = 0.5 * (s.life / s.max);
      ctx.fillStyle = '#d8d2c4';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size * (0.6 + k), 0, Math.PI * 2); ctx.fill();
    } else if (s.k === 'ring') {
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = s.color; ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size * (0.4 + k * 1.6), 0, Math.PI * 2); ctx.stroke();
    } else {
      const len = s.size * (0.6 + k * 1.4);
      ctx.translate(s.x, s.y); ctx.rotate(s.rot);
      ctx.strokeStyle = s.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const ang = i * Math.PI / 4, r0 = len * 0.35, l = i % 2 ? len * 0.7 : len;
        ctx.beginPath(); ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0); ctx.lineTo(Math.cos(ang) * l, Math.sin(ang) * l); ctx.stroke();
      }
    }
    ctx.restore();
  }


  function drawHUD(tick) {
    const bw = 320, bh = 18, y = 22;
    for (const f of F) {
      const left = f.id === 0;
      const x0 = left ? 30 : W - 30 - bw;
      rect(x0 - 3, y - 3, bw + 6, bh + 6, '#0b0b0e');
      rect(x0, y, bw, bh, '#3a1010');
      const gw = bw * f.ghost / 100, hw = bw * f.hp / 100;
      rect(left ? x0 + bw - gw : x0, y, gw, bh, '#ff3b3b');
      rect(left ? x0 + bw - hw : x0, y, hw, bh, f.hp > 30 ? '#ffd84e' : '#ff8a3d');
      rect(left ? x0 + bw - hw : x0, y, hw, 4, 'rgba(255,255,255,.35)');
      ctx.font = '10px ' + PIX; ctx.fillStyle = left ? '#ff8a80' : '#8cc4ff';
      ctx.textAlign = left ? 'left' : 'right';
      ctx.fillText((f.id + 1) + 'P', left ? x0 : x0 + bw, y + bh + 18);
      for (let i = 0; i < 2; i++) {
        const cx = left ? x0 + bw - 8 - i * 18 : x0 + 8 + i * 18;
        ctx.fillStyle = i < f.wins ? '#ffd84e' : '#2a2a30';
        ctx.beginPath(); ctx.arc(cx, y + bh + 13, 6, 0, Math.PI * 2); ctx.fill();
      }
      const mw = 160, mx = left ? 30 : W - 30 - mw, my = H - 24;
      rect(mx - 2, my - 2, mw + 4, 12, '#0b0b0e');
      rect(mx, my, mw, 8, '#1d2433');
      const ready = f.meter >= 50;
      const mww = mw * f.meter / 100;
      rect(left ? mx : mx + mw - mww, my, mww, 8, ready ? (tick % 20 < 10 ? '#7fe3ff' : '#c9f4ff') : '#3f7fd6');
      rect(mx + mw / 2 - 1, my - 2, 2, 12, '#0b0b0e');
      ctx.font = '8px ' + PIX; ctx.fillStyle = ready ? '#c9f4ff' : '#6d7894';
      ctx.fillText(ready ? 'SP READY' : 'SP', left ? mx : mx + mw, my - 6);
    }
    rect(W / 2 - 30, 12, 60, 40, '#0b0b0e');
    ctx.font = '20px ' + PIX; ctx.textAlign = 'center'; ctx.fillStyle = game.timer < 600 ? '#ff6b5e' : '#ffffff';
    ctx.fillText(String(Math.ceil(game.timer / 60)).padStart(2, '0'), W / 2, 44);
  }

  function drawMsg(me) {
    let text = game.msg, sub = '';
    if (game.pausedBy) {
      text = 'PAUSE';
      sub = (me >= 0 && (game.pausedBy & (1 << me))) ? 'ESC로 계속' : '상대가 잠깐 자리를 비웠어요';
    } else if (game.phase === 'over') sub = 'ENTER로 다시 시작';
    if (!text) return;
    ctx.textAlign = 'center';
    ctx.font = (text.length > 9 ? 26 : 38) + 'px ' + PIX;
    ctx.fillStyle = '#000'; ctx.fillText(text, W / 2 + 4, 194);
    ctx.fillStyle = text === 'K.O.' ? '#ff4b3e' : '#ffd84e';
    ctx.fillText(text, W / 2, 190);
    if (sub) {
      ctx.font = 'bold 14px "Malgun Gothic", system-ui, sans-serif';
      ctx.fillStyle = '#000'; ctx.fillText(sub, W / 2 + 1, 227);
      ctx.fillStyle = '#ffffff'; ctx.fillText(sub, W / 2, 226);
    }
  }

  // 배경 없음 (캐릭터·체력바만 그림). opts: { me: 내 번호(0/1, 모르면 -1), tick: 화면용 카운터 }
  function render(c, opts) {
    ctx = c;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (game.shake > 0) ctx.translate((Math.random() - .5) * game.shake, (Math.random() - .5) * game.shake);
    if (game.zoom > 0) { const z = 1 + game.zoom; ctx.translate(game.zx, game.zy); ctx.scale(z, z); ctx.translate(-game.zx, -game.zy); }
    F.forEach(drawTrail);
    const order = [...F].sort((a, b) => (a.state === 'attack') - (b.state === 'attack'));
    order.forEach(f => drawFighter(f, f.id === opts.me));
    projs.forEach(drawProj);
    sparks.forEach(drawSpark);
    ctx.restore();
    drawHUD(opts.tick || 0);
    drawMsg(opts.me);
  }

  return { W, H, BIT, step, render, newMatch, checksum, state: game, _F: F };
})();

if (typeof module !== 'undefined') module.exports = Game;
