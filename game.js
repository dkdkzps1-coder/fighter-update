// 몰래 격투 — 게임 로직 + 그리기 (v8: 손발 4버튼 공격, 콤보·공중콤보, 필살기 컷인)
// 중요: step()은 같은 입력이 들어오면 두 PC에서 완전히 같은 결과가 나와야 함 (락스텝).
//       그래서 게임 상태를 바꾸는 코드에서는 Math.random()이나 시간 함수를 쓰지 않음.
'use strict';

const Game = (() => {
  const W = 800, H = 400, FLOOR = 330, GRAV = 1.0, LEFTB = 30, RIGHTB = 770;
  const PIX = '"Press Start 2P", monospace';
  const BUF_FRAMES = 5;
  const DTAP = 13;          // 방향키 두 번 누르기 인정 간격(프레임)

  // 입력 비트 (lp 왼손, rp 오른손, lk 왼발, rk 오른발, sp 필살기)
  const BIT = { l: 1, r: 2, u: 4, g: 8, lp: 16, rk: 32, sp: 64, pause: 128, enter: 256, rp: 512, lk: 1024 };
  const BUTTONS = ['lp', 'rp', 'lk', 'rk', 'sp'];
  const PRIORITY = ['sp', 'rk', 'lk', 'rp', 'lp'];

  // 기술 데이터 (프레임 단위, 60fps). rank: 콤보 순서 (맞히면 더 높은 rank 기술로 이어서 쓸 수 있음)
  const ATK = {
    lp:      { rank: 1, startup: 3,  active: 3,  recovery: 8,  dmg: 5,  hitstun: 15, blockstun: 8,  chip: 0, push: 4,  meter: 6,  lunge: 3,   box: { x: 20, y: -80, w: 48, h: 16 } },
    rp:      { rank: 2, startup: 6,  active: 3,  recovery: 12, dmg: 8,  hitstun: 18, blockstun: 10, chip: 0, push: 7,  meter: 8,  lunge: 5,   box: { x: 16, y: -76, w: 62, h: 18 } },
    lk:      { rank: 3, startup: 7,  active: 4,  recovery: 14, dmg: 9,  hitstun: 19, blockstun: 11, chip: 0, push: 7,  meter: 9,  lunge: 4,   box: { x: 14, y: -60, w: 60, h: 22 } },
    rk:      { rank: 4, startup: 10, active: 4,  recovery: 20, dmg: 13, hitstun: 26, blockstun: 13, chip: 1, push: 10, meter: 12, lunge: 7.5, box: { x: 18, y: -64, w: 66, h: 26 }, launch: true },
    // 앉아서 쓰는 기술 (lvl: 'low' = 앉아서만 막힘. 공중 공격은 자동으로 'high' = 서서만 막힘)
    clp:     { rank: 1, crouch: true, startup: 4, active: 3, recovery: 8,  dmg: 4,  hitstun: 14, blockstun: 8,  chip: 0, push: 4, meter: 5,  lunge: 2, box: { x: 18, y: -54, w: 48, h: 16 } },
    crp:     { rank: 2, crouch: true, startup: 5, active: 5, recovery: 16, dmg: 9,  hitstun: 20, blockstun: 10, chip: 0, push: 3, meter: 9,  lunge: 2, box: { x: 4, y: -116, w: 42, h: 72 }, antiAir: true },
    clk:     { rank: 3, crouch: true, startup: 5, active: 3, recovery: 11, dmg: 6,  hitstun: 16, blockstun: 9,  chip: 0, push: 5, meter: 7,  lunge: 2, box: { x: 14, y: -22, w: 60, h: 22 }, lvl: 'low' },
    crk:     { rank: 4, crouch: true, startup: 9, active: 5, recovery: 22, dmg: 10, hitstun: 0,  blockstun: 14, chip: 1, push: 4, meter: 11, lunge: 3, box: { x: 8, y: -20, w: 80, h: 20 }, lvl: 'low', sweep: true },
    special: { rank: 5, startup: 20, active: 1,  recovery: 28, dmg: 22, hitstun: 34, blockstun: 18, chip: 4, push: 13, meter: 0,  cost: 50, proj: true, launch: true, wall: true, lvl: 'mid' },
    dive:    { rank: 4, startup: 5,  active: 60, recovery: 0,  dmg: 11, hitstun: 22, blockstun: 12, chip: 1, push: 6,  meter: 10, box: { x: 8, y: -34, w: 50, h: 38 }, dive: true },
    // 잡기 (왼손+오른손 동시): 가드를 뚫음. 붙잡고 들어 올려 앞으로 던짐
    throw:   { rank: 0, dmg: 12, hitstun: 30, blockstun: 0, chip: 0, push: 7, meter: 10, launch: true, wall: true, throwPush: 6.5 },
  };
  const GRAB_RANGE = 80, THROW_LIFT = 6, THROW_TOSS = 16;

  function makeF(id, gi, belt) {
    return { id, x: 0, y: FLOOR, vx: 0, vy: 0, facing: 1, hp: 100, ghost: 100, meter: 0, state: 'idle', t: 0,
      atk: null, atkName: '', hit: false, stun: 0, airRank: 0, gi, belt, wins: 0, flash: 0, walkT: 0,
      prevDir: 0, tapDir: 0, tapAt: -99, lag: 0, landT: 0, wb: false, fromDash: false, juggle: 0, combo: 0, comboT: 0, trail: [] };
  }
  const F = [makeF(0, '#e8473c', '#2b1a17'), makeF(1, '#3f8ff0', '#141c2b')];
  const game = { phase: 'intro', t: 0, round: 1, timer: 99 * 60, hitstop: 0, shake: 0, msg: '', winner: -1, slow: 0, pausedBy: 0,
    zoom: 0, zx: W / 2, zy: H / 2, cutin: -1, cutinT: 0 };
  const CUTIN = 46;
  let projs = [], sparks = [], frameCount = 0;
  const newBuf = () => ({ lp: 0, rp: 0, lk: 0, rk: 0, sp: 0, ju: 0 });
  const bufs = [newBuf(), newBuf()];

  function resetRound() {
    F.forEach((f, i) => Object.assign(f, { x: i ? 550 : 250, y: FLOOR, vx: 0, vy: 0, facing: i ? -1 : 1, hp: 100, ghost: 100,
      state: 'idle', t: 0, atk: null, hit: false, stun: 0, airRank: 0, flash: 0, walkT: 0,
      prevDir: 0, tapDir: 0, tapAt: -99, lag: 0, landT: 0, wb: false, fromDash: false, juggle: 0, combo: 0, comboT: 0, trail: [] }));
    projs = []; sparks = [];
    bufs.forEach(b => { for (const n in b) b[n] = 0; });
    Object.assign(game, { phase: 'intro', t: 0, timer: 99 * 60, hitstop: 0, slow: 0, msg: '', zoom: 0, cutin: -1, cutinT: 0 });
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
  function ring(x, y, color, size, life) { sparks.push({ k: 'ring', x, y, color, size, life: life || 12, max: life || 12 }); }
  function dust(x, y, dir, n, power) {
    for (let i = 0; i < n; i++) {
      const sp = (0.6 + rnd(i) * 0.8) * power;
      sparks.push({ k: 'dust', x: x + (rnd(i + 7) - 0.5) * 16, y: y - rnd(i + 3) * 6, vx: dir * sp + (rnd(i + 11) - 0.5) * 1.5,
        vy: -rnd(i + 5) * 1.6, size: 4 + rnd(i + 13) * 5, life: 18 + (i % 3) * 4, max: 26 });
    }
  }
  function burst(x, y, color, n, power) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rnd(i) * 0.4, sp = power * (0.6 + rnd(i + 3) * 0.8);
      sparks.push({ k: 'bit', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, color, size: 3 + rnd(i + 9) * 3, life: 20 + (i % 4) * 3, max: 32 });
    }
  }
  function punchZoom(x, y, z) { if (z > game.zoom) { game.zoom = z; game.zx = x; game.zy = y; } }

  function startAtk(f, name) {
    const a = ATK[name];
    if (a.cost) { if (f.meter < a.cost) return false; f.meter -= a.cost; }
    f.fromDash = f.state === 'dash';
    f.state = 'attack'; f.atk = a; f.atkName = name; f.t = 0; f.hit = false;
    if (!onGround(f)) f.airRank = a.rank;
    if (a.proj) {      // 필살기: 얼굴 컷인 + 화면 정지
      game.cutin = f.id; game.cutinT = CUTIN; game.hitstop = Math.max(game.hitstop, CUTIN - 6);
      punchZoom(f.x, f.y - 60, 0.1);
      ring(f.x, f.y - 60, '#ffffff', 50, 22);
    }
    return true;
  }

  // 눌린 버튼 중 조건에 맞는 가장 센 기술 고르기 (ground: 땅 위, minRank: 이보다 높은 것만)
  function pickAtk(b, ground, minRank, down) {
    for (const n of PRIORITY) {
      if (!b[n]) continue;
      if (n === 'sp') { if (!ground) continue; }
      const name = n === 'sp' ? 'special' : !ground ? (n === 'rk' ? 'dive' : n) : (down ? 'c' + n : n);
      if (ATK[name].rank > minRank) return { n, name };
    }
    return null;
  }
  function tryAtk(f, b, ground, minRank, down) {
    if (ground && !down && minRank === 0 && b.lp && b.rp) {          // 왼손+오른손 → 잡기 시도
      b.lp = b.rp = 0;
      f.state = 'grab'; f.t = 0; f.atk = null; f.atkName = 'grab'; f.vx = f.facing * 2.5;
      return true;
    }
    const p = pickAtk(b, ground, minRank, down);
    if (!p) return false;
    if (!startAtk(f, p.name)) { b[p.n] = 0; return false; }
    b[p.n] = 0;
    return true;
  }

  function doJump(f, dirX, run) {
    f.vy = run ? -16 : -17; f.vx = run ? f.facing * 6.8 : dirX * 5.2;
    f.y -= 1; f.state = 'jump'; f.t = 0; f.airRank = 0;
    dust(f.x, FLOOR, -Math.sign(f.vx || f.facing), 4, 1.4);
  }

  function updateFighter(f, o, inp, b, canAct) {
    f.t++;
    if (f.flash > 0) f.flash--;
    if (f.landT > 0) f.landT--;
    if (f.comboT > 0 && --f.comboT === 0) f.combo = 0;
    const ground = onGround(f);
    if (f.state === 'thrown') {                              // 잡힌 동안은 잡은 쪽이 위치를 정함
      if (o.state === 'throw') return;
      f.state = 'hitstun'; f.stun = 10; f.t = 0;            // 잡은 쪽이 맞아서 놓치면 풀려남
    }

    // 방향키 두 번 연속 → 대시 / 백대시
    const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    let dashReq = 0;
    if (dir && dir !== f.prevDir) {
      if (dir === f.tapDir && frameCount - f.tapAt <= DTAP) { dashReq = dir; f.tapDir = 0; }
      else { f.tapDir = dir; f.tapAt = frameCount; }
    }
    f.prevDir = dir;
    // 스파 방식 막기: 상대 반대쪽을 누르고 있으면 막음 (앉아 있으면 앉아 막기)
    f.holdBack = ground && dir === -f.facing;
    f.down = ground && !!inp.g;

    if (f.state === 'ko' || f.state === 'win') {
      if (ground) f.vx *= 0.85;
    } else if (f.state === 'down') {                       // 다리 후리기에 넘어짐 → 누워 있다가 일어남 (무적)
      if (ground) f.vx *= 0.8;
      if (f.t >= f.stun && ground) { f.state = 'idle'; f.t = 0; f.juggle = 0; f.wb = false; }
    } else if (f.state === 'hitstun' || f.state === 'blockstun') {
      if (ground) f.vx *= 0.82;
      if (f.t >= f.stun && ground) { f.state = 'idle'; f.t = 0; f.wb = false; f.juggle = 0; }
    } else if (f.state === 'land') {
      f.vx *= 0.7;
      if (f.t >= f.lag) { f.state = 'idle'; f.t = 0; }
    } else if (f.state === 'grab') {
      f.vx *= 0.8;
      if (f.t === 3) {
        const can = ['idle', 'walk', 'guard', 'crouch', 'blockstun', 'land', 'dash', 'grab', 'attack'].includes(o.state) && onGround(o);
        if (can && Math.abs(o.x - f.x) < GRAB_RANGE && game.phase === 'fight') {
          f.state = 'throw'; f.t = 0; f.vx = 0;
          o.state = 'thrown'; o.t = 0; o.atk = null; o.vx = o.vy = 0; o.facing = -f.facing; o.trail = [];
          spark(f.x + f.facing * 30, f.y - 70, '#ffffff', 10);
          game.hitstop = Math.max(game.hitstop, 5); game.shake = Math.max(game.shake, 4);
        }
      }
      if (f.state === 'grab' && f.t >= 22) { f.state = 'idle'; f.t = 0; }   // 헛잡으면 빈틈
    } else if (f.state === 'throw') {
      // 0~THROW_LIFT: 붙잡기, ~THROW_TOSS: 머리 위로 들어 올리기, 그 다음 던지기
      if (o.state === 'thrown') {
        o.t = f.t;
        const lift = Math.max(0, f.t - THROW_LIFT) / (THROW_TOSS - THROW_LIFT);
        o.x = f.x + f.facing * (34 - lift * 20);
        o.y = FLOOR - lift * 70;
        o.x = Math.max(LEFTB, Math.min(RIGHTB, o.x));
        if (f.t === THROW_TOSS && game.phase !== 'fight') { o.state = 'hitstun'; o.stun = 10; o.t = 0; }
        else if (f.t === THROW_TOSS) {
          o.y = FLOOR;                                         // 땅 기준으로 맞은 판정 → 높이 띄워 날림
          applyHit(f, o, ATK.throw, f.facing, o.x, f.y - 90);
          if (o.state !== 'ko') o.y = FLOOR - 60;
          dust(f.x, FLOOR, -f.facing, 6, 2.4);
        }
      }
      f.vx = 0;
      if (f.t >= THROW_TOSS + 16) { f.state = 'idle'; f.t = 0; }
    } else if (f.state === 'attack') {
      const a = f.atk;
      // 콤보: 맞힌 뒤에는 더 높은 순서의 기술로 바로 이어짐 (공중에서도)
      let canceled = false;
      if (canAct && f.hit && f.t >= a.startup) {
        if (ground && f.atkName === 'rk' && (inp.u || b.ju)) {       // 띄우기(오른발) 맞히고 점프로 따라가기
          b.ju = 0; doJump(f, f.facing, false); f.vy = -15.5; f.vx = f.facing * 3.4; canceled = true;
        } else canceled = tryAtk(f, b, ground, Math.max(a.rank, ground ? 0 : f.airRank), f.down);
      }
      if (canceled) {
        // 새 기술 시작됨
      } else if (a.dive) {
        if (f.t < a.startup) { f.vy *= 0.35; f.vx *= 0.6; }          // 공중에서 잠깐 멈칫
        else if (f.t === a.startup) { f.vy = 11; f.vx = f.facing * 8; ring(f.x, f.y - 50, 'rgba(255,255,255,.8)', 18); }
      } else {
        if (ground) {
          if (f.t === 1 && a.lunge) f.vx = f.facing * a.lunge * (f.fromDash ? 1.5 : 1);
          f.vx *= f.t <= a.startup + a.active ? 0.9 : 0.72;
        } else if (f.t < a.startup + a.active) f.vy = Math.min(f.vy, f.vy * 0.8 + 0.4);   // 공중 타격 중엔 살짝 체공
        if (a.proj && f.t === a.startup) {
          const col = f.id ? '#8cc4ff' : '#ff9a7a';
          projs.push({ x: f.x + f.facing * 46, y: f.y - 64, vx: f.facing * 9, owner: f.id, life: 160, t: 0 });
          if (ground) f.vx = -f.facing * 5;                            // 반동으로 밀려남
          ring(f.x + f.facing * 46, f.y - 64, col, 40, 18); ring(f.x + f.facing * 46, f.y - 64, '#ffffff', 24, 12);
          burst(f.x + f.facing * 46, f.y - 64, col, 14, 5);
          dust(f.x, FLOOR, -f.facing, 8, 2.6);
          game.shake = Math.max(game.shake, 10);
        }
        if (f.t >= a.startup + a.active + a.recovery) { f.state = ground ? 'idle' : 'jump'; f.atk = null; f.t = 0; }
      }
    } else if (f.state === 'dash') {
      f.vx = f.facing * Math.max(3, 11 - f.t * 0.5);
      if (f.t % 4 === 0) dust(f.x - f.facing * 10, FLOOR, -f.facing, 1, 1.2);
      if (canAct && tryAtk(f, b, true, 0, false)) { /* 대시 공격 */ }
      else if (canAct && inp.u) doJump(f, f.facing, true);
      else if (f.t >= 15) { f.state = 'idle'; f.t = 0; }
    } else if (f.state === 'bdash') {
      // 공중에 살짝 뜬 채로 뒤로 빠짐 — 땅에 닿으면 끝
    } else if (canAct) {
      if (ground) {
        if (tryAtk(f, b, true, 0, f.down)) { /* 공격 시작 (앉아 있으면 앉아 기술) */ }
        else if (inp.u) doJump(f, dir, false);
        else if (inp.g) { f.state = 'crouch'; f.vx = 0; f.guardPose = f.holdBack && threatened(f, o); }
        else if (dashReq && dashReq === f.facing) {
          f.state = 'dash'; f.t = 0; f.vx = f.facing * 11;
          dust(f.x, FLOOR, -f.facing, 6, 2.2); ring(f.x - f.facing * 14, FLOOR - 30, 'rgba(255,255,255,.55)', 14);
        } else if (dashReq) {
          f.state = 'bdash'; f.t = 0; f.vx = -f.facing * 8; f.vy = -6.5; f.y -= 1;
          dust(f.x, FLOOR, f.facing, 5, 1.8);
        }
        else if (f.holdBack && threatened(f, o)) { f.state = 'guard'; f.vx = 0; }   // 상대가 공격 중이면 그 자리에서 막는 자세
        else {
          f.vx = dir * (dir === f.facing ? 4.2 : 3.2);
          if (dir) { f.state = 'walk'; f.walkT += dir * f.facing; } else f.state = 'idle';
        }
      } else {
        // 공중: 상대를 넘어가면 몸을 돌리고, 방향키로 궤도 조절
        if (f.state === 'jump') {
          if (o.x > f.x + 4) f.facing = 1; else if (o.x < f.x - 4) f.facing = -1;
          if (dir) f.vx = Math.max(-5.6, Math.min(5.6, f.vx + dir * 0.4));
          tryAtk(f, b, false, f.airRank, false);     // 한 번 점프에 손·발 각각 한 번씩 (순서대로)
        }
      }
    } else if (ground) { f.vx = 0; if (f.state === 'walk' || f.state === 'guard' || f.state === 'crouch' || f.state === 'dash') f.state = 'idle'; }

    if (!ground || f.vy < 0) f.vy += GRAV;
    f.x += f.vx; f.y += f.vy;
    if (f.y >= FLOOR) {
      const impact = f.vy;
      f.y = FLOOR; f.vy = 0;
      if (impact > 0) {
        f.airRank = 0;
        f.landT = Math.min(8, 3 + Math.round(impact / 3));
        if (impact > 6) dust(f.x, FLOOR, 1, 3, impact / 6), dust(f.x, FLOOR, -1, 3, impact / 6);
        if (f.state === 'jump' || f.state === 'bdash') { f.state = 'idle'; f.t = 0; }
        else if (f.state === 'attack') {
          if (f.atkName === 'dive') { f.state = 'land'; f.lag = 11; f.t = 0; game.shake = Math.max(game.shake, 3); }
          else f.state = 'idle';
          f.atk = null; f.t = 0;
        } else if (f.state === 'hitstun') {
          if (impact > 8) { f.vy = -impact * 0.4; f.y = FLOOR - 1; game.shake = Math.max(game.shake, 4); }   // 바닥에 튕김
          else f.stun = Math.min(f.stun, f.t + 12);                                                          // 착지 후 잠깐 뒤 회복
        } else if (f.state === 'ko' && impact > 5) {
          f.vy = -impact * 0.38; f.y = FLOOR - 1; f.vx *= 0.6;       // KO 되면 바닥에 한 번 튕김
          game.shake = Math.max(game.shake, 7);
        }
      }
    }
    // 세게 맞고 날아가다 벽에 부딪히면 튕겨 나옴
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
    if (onGround(f) && (f.state === 'idle' || f.state === 'walk' || f.state === 'guard' || f.state === 'crouch')) f.facing = o.x >= f.x ? 1 : -1;
  }

  // 상대가 공격 중이거나 장풍이 날아오는 중인지 (뒤로 누르고 있을 때 막는 자세를 취할지 결정)
  function threatened(f, o) {
    if ((o.state === 'attack' || o.state === 'grab') && Math.abs(o.x - f.x) < 190) return true;
    for (const p of projs) if (p.owner === o.id && Math.abs(p.x - f.x) < 240 && Math.sign(f.x - p.x) === Math.sign(p.vx)) return true;
    return false;
  }

  // 빠르게 움직일 때 잔상 남기기
  function isFast(f) {
    if (f.state === 'dash' || f.state === 'bdash') return true;
    if (f.state === 'attack' && f.atk && f.t >= f.atk.startup - 1 && (f.atk.dive || f.atkName === 'rk' || f.atkName === 'special')) return true;
    if (f.state === 'attack' && f.atk && f.y < FLOOR && f.t >= f.atk.startup - 1) return true;
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
    const low = f.state === 'crouch' || (f.state === 'blockstun' && f.blockLow) || (f.state === 'attack' && f.atk && f.atk.crouch);
    const h = f.state === 'down' ? 24 : low ? 64 : f.state === 'dash' ? 84 : 94;
    return { x: f.x - 18, y: f.y - h, w: 36, h };
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function applyHit(att, def, a, dirX, hx, hy) {
    const facingAtt = (att.x - def.x) * def.facing > 0 || Math.abs(att.x - def.x) < 2;
    // 상단(공중 공격) = 서서만, 하단 = 앉아서만, 중단 = 둘 다 막힘. 잡기는 못 막음
    const lvl = a.lvl || (!onGround(att) || a.dive ? 'high' : 'mid');
    const canGuard = !a.throwPush && onGround(def) && def.holdBack && ['idle', 'walk', 'crouch', 'guard', 'blockstun'].includes(def.state);
    const lvlOK = lvl === 'low' ? def.down : lvl === 'high' ? !def.down : true;
    const blocked = canGuard && facingAtt && lvlOK;
    if (blocked) def.blockLow = def.down;
    const big = a.dmg > 10, sup = !!a.proj;
    if (blocked) {
      def.hp -= a.chip;
      def.state = 'blockstun'; def.stun = a.blockstun; def.t = 0;
      def.vx = dirX * a.push * 0.9;
      def.meter = Math.min(100, def.meter + 4); att.meter = Math.min(100, att.meter + a.meter / 2);
      spark(hx, hy, '#9fd3ff', sup ? 16 : 8); ring(hx, hy, '#9fd3ff', sup ? 30 : 10);
      dust(def.x, FLOOR, dirX, 3, 1.5);
      game.hitstop = sup ? 10 : 5;
    } else {
      const wasAir = !onGround(def);
      // 콤보가 길어질수록 데미지 조금씩 감소
      const scale = Math.max(0.5, 1 - def.juggle * 0.08 - Math.max(0, att.combo - 2) * 0.05);
      def.hp -= Math.max(1, Math.round(a.dmg * scale));
      def.state = 'hitstun'; def.stun = a.hitstun; def.t = 0; def.atk = null;
      att.combo++; att.comboT = 60;
      if (a.dive && wasAir) { def.vy = 9; def.vx = dirX * 4; }                       // 공중에서 내려찍기 → 바닥으로 꽂힘
      else if (a.sweep && !wasAir) {                                                  // 다리 후리기 → 넘어짐
        def.state = 'down'; def.stun = 46; def.vy = -5; def.y = FLOOR - 1; def.vx = dirX * 2.5;
        dust(def.x, FLOOR, dirX, 6, 2);
      } else if (a.antiAir && wasAir) { def.vy = -9; def.vx = dirX * 4; }             // 어퍼컷 대공 → 높이 떠서 날아감
      else if (a.launch && !wasAir) {
        def.vy = sup ? -11 : -12.5; def.y = FLOOR - 1; def.vx = dirX * (a.throwPush || (sup ? a.push : 3.2));
        if (a.wall) def.wb = true;
      } else if (wasAir) {                                                            // 공중 콤보: 같이 떠 있게, 맞을수록 덜 뜸
        const lift = -6.5 + def.juggle * 0.9;
        if (lift < -1) def.vy = Math.min(def.vy, lift);
        def.vx = sup ? dirX * a.push : dirX * 1.6 + (onGround(att) ? 0 : att.vx * 0.6);
        def.juggle++;
      } else {
        def.vx = dirX * a.push;
        if (a.dive) { def.vy = -4; def.y = FLOOR - 1; }
      }
      if (!onGround(att) && !a.dive) { att.vy = Math.min(att.vy, -4); att.vx *= 0.5; }     // 공중에서 때리면 살짝 떠서 이어치기 쉽게
      def.flash = 8;
      def.meter = Math.min(100, def.meter + 6); att.meter = Math.min(100, att.meter + a.meter);
      if (sup) {
        const col = att.id ? '#8cc4ff' : '#ff9a7a';
        spark(hx, hy, '#ffffff', 30); ring(hx, hy, col, 60, 20); ring(hx, hy, '#ffffff', 36, 14); burst(hx, hy, col, 22, 7);
        game.hitstop = 16; game.shake = 16; punchZoom(hx, hy, 0.14);
      } else {
        spark(hx, hy, '#ffd84e', big ? 18 : 11); ring(hx, hy, big ? '#fff3b0' : 'rgba(255,255,255,.7)', big ? 26 : 14);
        game.hitstop = big ? 11 : 6; game.shake = big ? 10 : 4;
        if (big) punchZoom(hx, hy, 0.06);
      }
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
      // 공중 기술은 판정을 위아래로 넉넉하게 (공중 콤보가 너무 빡빡하지 않게)
      const bw = bx.w + (air ? 8 : 0), bh = bx.h + (air ? 24 : 0);
      const hb = { x: f.facing === 1 ? f.x + bx.x : f.x - bx.x - bw, y: f.y + bx.y + (air ? 6 : 0), w: bw, h: bh };
      if (o.state !== 'ko' && o.state !== 'thrown' && o.state !== 'down' && overlap(hb, hurtbox(o))) {
        f.hit = true;
        applyHit(f, o, a, f.facing, f.facing === 1 ? hb.x + hb.w - 6 : hb.x + 6, hb.y + hb.h / 2);
        if (a.dive && game.phase !== 'ko' && onGround(o)) {   // 땅에 있는 상대에게 내려찍기가 맞으면 뒤로 튕겨 오름
          f.state = 'jump'; f.atk = null; f.t = 0; f.vy = -9; f.vx = -f.facing * 3.5;
        }
        if (game.phase === 'ko') return;
      }
    }
  }

  function updateProjs() {
    for (const p of projs) {
      p.x += p.vx; p.life--; p.t++;
      if (p.t % 3 === 0) sparks.push({ k: 'bit', x: p.x - Math.sign(p.vx) * 20, y: p.y + (rnd(p.t) - 0.5) * 30, vx: -Math.sign(p.vx) * 1.5, vy: (rnd(p.t + 1) - 0.5) * 2,
        color: p.owner ? '#8cc4ff' : '#ff9a7a', size: 3 + rnd(p.t + 2) * 3, life: 16, max: 16 });
      const o = F[1 - p.owner];
      if (game.phase === 'fight' && o.state !== 'ko' && o.state !== 'thrown' && o.state !== 'down' && overlap({ x: p.x - 28, y: p.y - 28, w: 56, h: 56 }, hurtbox(o))) {
        p.life = 0;
        applyHit(F[p.owner], o, ATK.special, Math.sign(p.vx), p.x, p.y);
      }
    }
    for (let i = 0; i < projs.length; i++) for (let j = i + 1; j < projs.length; j++) {
      const a = projs[i], b = projs[j];
      if (a.owner !== b.owner && a.life > 0 && b.life > 0 && Math.abs(a.x - b.x) < 44 && Math.abs(a.y - b.y) < 44) {
        a.life = b.life = 0;
        const x = (a.x + b.x) / 2;
        spark(x, a.y, '#ffffff', 30); ring(x, a.y, '#ffffff', 70, 22); burst(x, a.y, '#ffffff', 20, 7);
        game.shake = Math.max(game.shake, 14); game.hitstop = Math.max(game.hitstop, 10); punchZoom(x, a.y, 0.1);
      }
    }
    projs = projs.filter(p => p.life > 0 && p.x > -60 && p.x < W + 60);
  }

  function separate() {
    const [a, b] = F;
    if (a.state === 'ko' || b.state === 'ko' || a.state === 'thrown' || b.state === 'thrown') return;
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
    for (const p of [0, 1]) for (const n of BUTTONS) if (ks[p] & BIT[n]) bufs[p][n] = BUF_FRAMES;
    for (const p of [0, 1]) if (ks[p] & BIT.u) bufs[p].ju = 8;     // 타격 정지 중 누른 점프도 기억 (띄우기 후 추격용)

    for (const s of sparks) {
      s.life--;
      if (s.k === 'dust' || s.k === 'bit') { s.x += s.vx; s.y += s.vy; s.vx *= 0.9; s.vy *= 0.9; }
    }
    sparks = sparks.filter(s => s.life > 0);
    F.forEach(f => { if (f.ghost > f.hp) f.ghost = Math.max(f.hp, f.ghost - 0.6); });
    if (game.shake > 0) game.shake--;
    if (game.cutinT > 0 && --game.cutinT === 0) game.cutin = -1;
    game.zoom = game.zoom > 0.002 ? game.zoom * (game.cutinT > 0 ? 0.98 : 0.88) : 0;

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


  // ---------------- 스프라이트 (그리기 전용: step()과 게임 결과에는 영향 없음) ----------------
  const SPR = { ready: false, loaded: 0, failed: 0, total: 0, img: {}, cfg: null };
  (function loadSprites() {
    if (typeof window === 'undefined' || typeof Image === 'undefined' || !window.SPRITE_CONFIG) return;
    const c = SPR.cfg = window.SPRITE_CONFIG;
    for (const name of ['kaze', 'kage']) for (const anim in c.counts) for (let i = 0; i < c.counts[anim]; i++) {
      const im = new Image(); SPR.total++; SPR.img[name + '/' + anim + '/' + i] = im;
      im.onload = () => { SPR.loaded++; SPR.ready = SPR.loaded === SPR.total; };
      im.onerror = () => { SPR.failed++; };
      im.src = c.images[name + '/' + anim + '/' + i];
    }
  })();
  const LEGS = 0.5, KICK_LEGS = 0.45;
  function sprAttackFrame(t, a, impact, n) {
    if (t < a.startup) return Math.min(impact - 1, Math.floor(t / Math.max(1, a.startup) * impact));
    if (t < a.startup + a.active) return impact;
    const k = (t - a.startup - a.active) / Math.max(1, a.recovery);
    return Math.min(n - 1, impact + 1 + Math.floor(k * (n - impact - 1)));
  }
  function sprPose(f) {
    const c = SPR.cfg, moves = c.chars[f.id ? 'kage' : 'kaze'].moves, st = f.state, air = f.y < FLOOR, idleF = Math.floor(frameCount / 7) % c.counts.idle;
    const P = (anim, frame, o) => Object.assign({ anim, frame, dx: 0, rot: 0, legs: 0, waist: 46, upperRot: 0, up: 0 }, o);
    if (st === 'attack' && f.atk) {
      const a = f.atk, nm = f.atkName, base = { lp: 'lp', rp: 'rp', lk: 'lk', rk: 'rk', clp: 'lp', crp: 'rp', clk: 'lk', crk: 'rk', dive: 'rk', special: 'rp' }[nm], m = moves[base], n = c.counts[m.anim];
      const frame = a.dive ? (f.t < a.startup ? sprAttackFrame(f.t, a, m.impact, n) : m.impact) : sprAttackFrame(f.t, a, m.impact, n);
      let k = 1; if (f.t < a.startup) k = f.t / Math.max(1, a.startup); else if (f.t >= a.startup + a.active) k = Math.max(0, 1 - (f.t - a.startup - a.active) / Math.max(1, a.recovery));
      const o = { dx: m.bodyDx * k, rot: a.dive && f.t >= a.startup ? 0.55 : 0 };
      if (nm === 'clp') Object.assign(o, { legs: LEGS });
      if (nm === 'crp') Object.assign(o, { legs: LEGS, upperRot: -0.95 * Math.min(1, f.t / Math.max(1, a.startup)), dx: Math.min(6, m.bodyDx * k) });
      if (nm === 'clk' || nm === 'crk') Object.assign(o, { legs: KICK_LEGS, waist: 38 });
      return P(m.anim, frame, o);
    }
    if (st === 'walk') return P('walk', ((Math.floor(f.walkT / 4) % 8) + 8) % 8);
    if (st === 'jump') return P('jump', f.vy < -8 ? 1 : f.vy < 2 ? 2 : 6);
    if (st === 'bdash') return P('jump', 2, { rot: -0.2 });
    if (st === 'dash') return P('walk', 4, { rot: 0.22 });
    if (st === 'crouch') return f.guardPose ? P('hit', 1, { legs: LEGS, rot: -0.04 }) : P('idle', idleF, { legs: LEGS });
    if (st === 'guard') return P('hit', 1, { rot: -0.06, dx: -2 });
    if (st === 'blockstun') return P('hit', 1, { rot: -0.1, dx: -3, legs: f.blockLow ? LEGS : 0 });
    if (st === 'land') return P('idle', 0, { legs: 0.72 });
    if (st === 'hitstun') { const k = Math.min(1, f.t / Math.max(1, f.stun)); return P('hit', Math.min(5, 2 + Math.floor(k * 4)), { rot: air ? -0.45 : -0.24 * (1 - k), dx: -8 * (1 - k) }); }
    if (st === 'thrown') { const k = Math.min(1, Math.max(0, f.t - THROW_LIFT) / (THROW_TOSS - THROW_LIFT)); return P('hit', 2, { rot: -k * 1.7 - 0.2, up: k * 42 }); }
    if (st === 'grab') return P('right_punch', Math.min(moves.rp.impact, f.t + 1));
    if (st === 'throw') { const lifting = f.t >= THROW_LIFT && f.t < THROW_TOSS; return P('right_punch', f.t < THROW_TOSS ? moves.rp.impact : Math.min(7, moves.rp.impact + 2), { legs: 0.86, upperRot: lifting ? -1.15 : f.t >= THROW_TOSS ? 0.28 : 0 }); }
    if (st === 'down') return !air && f.t >= f.stun - 8 ? P('idle', 0, { legs: LEGS }) : P('hit', 3, { rot: air ? -0.8 : -1.5, lying: !air });
    if (st === 'ko') return air ? P('hit', 3, { rot: -f.t * 0.28 }) : P('hit', 3, { rot: -1.5, lying: true });
    return P('idle', idleF);
  }
  const isLying = f => SPR.ready && (f.state === 'ko' || f.state === 'down') && f.y >= FLOOR;
  function drawSprite(f, ghost) {
    if (!SPR.ready) return false;
    const c = SPR.cfg, name = f.id ? 'kage' : 'kaze', p = sprPose(f), im = SPR.img[name + '/' + p.anim + '/' + p.frame];
    if (!im || !im.complete || !im.naturalWidth) return false;
    const S = c.scale, A = c.chars[name].anchorX, FW = c.frame[0], B = c.baseline + 1;
    let drawX = f.x, drawY = f.y - p.up;
    if (p.lying) {                                        // 누운 몸을 바닥에 맞추고 화면 안에 유지 (그림 위치만 보정)
      const L = c.chars[name].lying, e1 = f.x + f.facing * L.minX, e2 = f.x + f.facing * L.maxX, lo = Math.min(e1, e2), hi = Math.max(e1, e2);
      drawX += lo < 4 ? 4 - lo : hi > W - 4 ? W - 4 - hi : 0; drawY = f.y - L.lift;
    }
    ctx.translate(Math.round(drawX), Math.round(drawY)); ctx.scale(f.facing, 1); ctx.rotate(p.rot); ctx.translate(p.dx, 0);
    const smooth = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
    if (!ghost && f.flash > 0 && f.flash % 2) ctx.filter = 'brightness(2.4)';
    if (p.legs) {                                         // 다리만 접고 상체는 찌그러뜨리지 않음
      const legH = (B - p.waist) * S * p.legs;
      ctx.drawImage(im, 0, p.waist, FW, B - p.waist, -A * S, -legH, FW * S, legH);
      ctx.save(); ctx.translate(0, -legH); ctx.rotate(p.upperRot);
      ctx.drawImage(im, 0, 0, FW, p.waist + 1, -A * S, -p.waist * S, FW * S, (p.waist + 1) * S);
      ctx.restore();
    } else ctx.drawImage(im, -A * S, -B * S, FW * S, c.frame[1] * S);
    ctx.filter = 'none'; ctx.imageSmoothingEnabled = smooth;
    return true;
  }
  function drawSpriteFace(f) {                            // 필살기 컷인: 각 캐릭터의 실제 얼굴과 상체
    if (!SPR.ready) return false;
    const name = f.id ? 'kage' : 'kaze', im = SPR.img[name + '/idle/0'], A = SPR.cfg.chars[name].anchorX, Z = 4.3, sx = A - 22, sy = 10, w = 44, h = 35;
    const smooth = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, sx, sy, w, h, -w * Z / 2, -h * Z / 2, w * Z, h * Z);
    ctx.imageSmoothingEnabled = smooth;
    return true;
  }

  function drawFighter(f, isMe, ghost) {
    ctx.save();
    if (!ghost) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      const sh = Math.max(0.4, 1 - (FLOOR - f.y) / 200);
      ctx.beginPath(); ctx.ellipse(f.x, FLOOR + 3, 26 * sh, 6 * sh, 0, 0, Math.PI * 2); ctx.fill();
      if (isMe) { // 내 캐릭터 머리 위 표시
        ctx.fillStyle = f.id === 0 ? 'rgba(255,138,128,.6)' : 'rgba(140,196,255,.6)';
        const ty = f.y - 120 + Math.sin(frameCount / 10) * 2;
        ctx.beginPath(); ctx.moveTo(f.x - 5, ty); ctx.lineTo(f.x + 5, ty); ctx.lineTo(f.x, ty + 6); ctx.fill();
      }
      // 필살기 기 모으기 오라
      if (f.state === 'attack' && f.atkName === 'special' && f.t < f.atk.startup) {
        const col = f.id ? '110,190,255' : '255,130,90';
        const r = 60 + Math.sin(frameCount / 2) * 6;
        const g = ctx.createRadialGradient(f.x, f.y - 50, 10, f.x, f.y - 50, r);
        g.addColorStop(0, 'rgba(' + col + ',.45)'); g.addColorStop(1, 'rgba(' + col + ',0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(f.x, f.y - 50, r * 0.8, r, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    if (drawSprite(f, ghost)) { ctx.restore(); return; }
    ctx.translate(Math.round(f.x), Math.round(f.y));
    ctx.scale(f.facing, 1);

    const gi = ghost ? ghost : (f.flash > 0 && f.flash % 2 ? '#ffffff' : f.gi);
    const skin = ghost || SKIN, skinD = ghost || SKIN_D, hair = ghost || HAIR, belt = ghost || f.belt;
    const st = f.state, a = f.atk, nm = f.atkName;
    const active = st === 'attack' && a && f.t >= a.startup && f.t < a.startup + a.active + 3;
    const wind = st === 'attack' && a && f.t < a.startup;
    const air = f.y < FLOOR;
    const lvx = f.vx * f.facing;            // 바라보는 방향 기준 속도

    if ((st === 'ko' && !air && f.t > 10) || (st === 'down' && !air && f.t < f.stun - 8)) {   // 누워 있는 자세
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
      else if (active) tilt = { rk: 0.06, lk: -0.08, rp: 0.2, crp: -0.06, clk: -0.05, crk: -0.14 }[nm] ?? (a.dive ? -0.12 : 0.12);
      else tilt = 0.05;
    } else if (st === 'grab') tilt = 0.15;
    else if (st === 'throw') tilt = f.t < THROW_LIFT ? 0.05 : f.t < THROW_TOSS ? -0.18 : 0.32;
    else if (st === 'thrown') tilt = -Math.min(1, Math.max(0, f.t - THROW_LIFT) / (THROW_TOSS - THROW_LIFT)) * 1.7 - 0.2;
    else if (st === 'hitstun') tilt = air ? -0.55 : -0.3 * (1 - f.t / Math.max(1, f.stun));
    else if (st === 'blockstun') tilt = -0.1;
    else if (st === 'down') tilt = air ? -0.8 : 0;
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
    const CROUCH = 28;
    if (st === 'guard') crouch = 3;
    if (st === 'blockstun') crouch = f.blockLow ? CROUCH : 4;
    if (st === 'crouch' || (st === 'down' && !air)) crouch = CROUCH;
    if (st === 'dash') crouch = 8;
    if (st === 'land') crouch = 16;
    if (st === 'attack' && wind && !air && a && !a.dive) crouch = nm === 'special' ? 10 : 6;
    if (st === 'attack' && a && a.crouch) crouch = CROUCH;
    if (st === 'win') bob = -Math.abs(Math.sin(frameCount / 6)) * 6;

    const top = -44 + crouch;
    const kick = st === 'attack' && (nm === 'rk' || nm === 'lk') && active;
    const dive = st === 'attack' && a && a.dive;
    const ay = air ? 18 : 0;
    const lowKick = st === 'attack' && a && a.crouch && active && (nm === 'clk' || nm === 'crk');
    if (lowKick) {
      rect(-18, -18, 13, 18, gi); rect(-20, -6, 15, 6, skinD);                   // 접은 뒷다리
      if (nm === 'clk') { rect(-2, -18, 62, 11, gi); rect(58, -20, 12, 13, skinD); }   // 왼발: 낮게 찌르는 발차기
      else { rect(-6, -14, 82, 10, gi); rect(74, -16, 13, 12, skinD); }               // 오른발: 바닥 쓸기
    } else if (dive && !wind) {
      rect(-14, top, 11, 22, gi); rect(-16, top + 20, 13, 6, skinD);              // 접은 뒷다리
      ctx.save(); ctx.translate(0, -40); ctx.rotate(0.8);
      rect(-2, -6, 58, 12, gi); rect(54, -8, 13, 15, skinD);                       // 대각선으로 뻗은 발
      ctx.restore();
    } else if (kick) {
      // 받치는 다리
      if (air) { rect(-14, top, 11, 24, gi); rect(-16, top + 22, 13, 6, skinD); }
      else { rect(-14, top, 11, 44 - crouch, gi); rect(-16, -6, 14, 6, skinD); }
      if (nm === 'rk') {                     // 오른발: 높은 돌려차기
        rect(-2, top - 14 + ay, 80, 12, gi); rect(76, top - 16 + ay, 12, 14, skinD);
      } else {                               // 왼발: 몸통 앞차기
        rect(-2, -58 + ay, 66, 12, gi); rect(62, -61 + ay, 12, 15, skinD);
      }
    } else if (air || st === 'bdash') {
      rect(-12, top, 10, 26, gi); rect(2, top, 10, 22, gi);
      rect(-14, top + 24, 12, 6, skinD); rect(2, top + 20, 12, 6, skinD);
    } else {
      let s1 = 0, s2 = 0;
      if (st === 'walk') { s1 = Math.sin(f.walkT / 4) * 8; s2 = -s1; }
      if (st === 'dash') { s1 = -12; s2 = 12; }
      if (st === 'attack' && !air) { s1 = -6; s2 = nm === 'rp' ? 12 : 8; }       // 앞발 내딛기
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

    if (st === 'attack' && nm === 'crp' && active) {                // 앉아 오른손: 어퍼컷 (대공)
      rect(2, -134, 11, 60, skin); rect(0, -142, 15, 12, skinD); rect(-14, -70, 16, 9, skin);
    } else if (st === 'attack' && (nm === 'lp' || nm === 'clp') && active) {   // 왼손 잽 (앞손) / 앉아 잽
      rect(4, -78, 56, 8, skin); rect(56, -81, 11, 13, skinD); rect(-6, -72, 16, 9, skin); rect(8, -76, 9, 9, skinD);
    } else if (st === 'attack' && nm === 'rp' && active) {          // 오른손 스트레이트 (뒷손, 길게)
      rect(-6, -74, 76, 9, skin); rect(68, -77, 12, 15, skinD); rect(-22, -70, 16, 9, skin);
    } else if (st === 'attack' && nm === 'special') {
      if (f.t >= a.startup - 2) { rect(6, -72, 40, 12, skin); rect(6, -58, 40, 12, skin); rect(42, -75, 12, 32, skinD); }
      else {
        rect(-24, -68, 20, 11, skin); rect(-24, -56, 20, 11, skin);
        if (!ghost) {
          const r = 8 + f.t * 0.7;
          ctx.fillStyle = 'rgba(255,255,255,.85)';
          ctx.beginPath(); ctx.arc(-28, -56, r * 0.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = (f.id ? 'rgba(120,200,255,' : 'rgba(255,150,110,') + (0.45 + 0.35 * Math.sin(f.t)) + ')';
          ctx.beginPath(); ctx.arc(-28, -56, r, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (st === 'grab' && f.t < 14) {                       // 두 손 뻗어 붙잡기
      rect(4, -78, 44, 9, skin); rect(4, -66, 44, 9, skin); rect(44, -80, 10, 12, skinD); rect(44, -68, 10, 12, skinD);
    } else if (st === 'throw') {
      if (f.t < THROW_LIFT) { rect(4, -78, 34, 9, skin); rect(4, -66, 34, 9, skin); }
      else if (f.t < THROW_TOSS) { rect(2, -122, 10, 46, skin); rect(14, -120, 10, 44, skin); rect(0, -128, 26, 9, skinD); }
      else { rect(6, -72, 46, 9, skin); rect(6, -62, 42, 9, skin); }
    } else if (st === 'thrown') {
      rect(-20, -84, 10, 22, skin); rect(10, -86, 10, 20, skin);
    } else if (dive) {
      rect(-20, -82, 10, 20, skin); rect(8, -84, 10, 18, skin);                    // 팔 벌려 균형
    } else if (wind) {
      if (nm === 'rp') { rect(-24, -72, 18, 10, skin); rect(4, -78, 14, 10, skin); }
      else { rect(-22, -72, 16, 10, skin); rect(2, -66, 14, 10, skin); }
    } else if (st === 'guard' || st === 'blockstun' || (st === 'crouch' && f.guardPose)) {
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
    const col = p.owner === 0 ? '255,130,90' : '110,190,255';
    const d = Math.sign(p.vx);
    // 긴 꼬리
    for (let i = 5; i >= 1; i--) {
      ctx.fillStyle = 'rgba(' + col + ',' + (0.5 - i * 0.08) + ')';
      ctx.beginPath(); ctx.ellipse(p.x - d * (14 + i * 15), p.y + Math.sin(p.t / 3 + i) * 4, 30 - i * 4, 18 - i * 2.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    const r = 26 + Math.sin(p.t / 2) * 3;
    const g = ctx.createRadialGradient(p.x, p.y, 3, p.x, p.y, r + 18);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.95)');
    g.addColorStop(0.55, 'rgba(' + col + ',.95)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 18, 0, Math.PI * 2); ctx.fill();
    // 회전하는 기 고리
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.t * 0.25 * d);
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, r - 4, 0, Math.PI * 1.2); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + col + ',.9)';
    ctx.beginPath(); ctx.arc(0, 0, r + 6, Math.PI, Math.PI * 2.1); ctx.stroke();
    ctx.restore();
  }

  function drawSpark(s) {
    const k = 1 - s.life / s.max;
    ctx.save();
    if (s.k === 'dust') {
      ctx.globalAlpha = 0.5 * (s.life / s.max);
      ctx.fillStyle = '#d8d2c4';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size * (0.6 + k), 0, Math.PI * 2); ctx.fill();
    } else if (s.k === 'bit') {
      ctx.globalAlpha = Math.min(1, s.life / s.max * 1.5);
      ctx.fillStyle = s.color;
      ctx.fillRect(Math.round(s.x - s.size / 2), Math.round(s.y - s.size / 2), Math.round(s.size), Math.round(s.size));
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

  // ---- 필살기 컷인: 쓴 사람 쪽(1P 왼쪽, 2P 오른쪽)에서 얼굴이 크게 밀려 들어옴 ----
  function drawFace(f, s) {
    // 원점 = 얼굴 중앙, 오른쪽을 바라봄. s = 픽셀 크기
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x * s, y * s, w * s, h * s); };
    R(-13, 11, 28, 12, f.gi); R(-13, 11, 28, 2, 'rgba(0,0,0,.25)');           // 도복 깃
    R(-3, 8, 9, 5, SKIN_D);                                                   // 목
    R(-11, -11, 23, 21, SKIN);                                                // 얼굴
    R(-11, 6, 23, 4, SKIN_D);                                                 // 턱 그림자
    R(-12, -15, 25, 7, HAIR); R(-14, -12, 6, 14, HAIR);                       // 머리
    R(-12, -8, 26, 4, '#ffffff');                                             // 머리띠
    const fl = Math.sin(frameCount / 2) * 1.5;
    R(-19, -8 + fl, 8, 3, '#ffffff'); R(-25, -5 + fl * 1.6, 7, 3, '#ffffff'); // 머리띠 꼬리
    R(-5, -3, 6, 2, HAIR); R(3, -3, 3, 2, HAIR); R(6, -2, 5, 2, HAIR);        // 찌푸린 눈썹
    R(-4, 0, 4, 3, '#ffffff'); R(-2, 0, 2, 3, '#1b1b1f');                     // 뒤쪽 눈
    R(4, 0, 6, 3, '#ffffff'); R(7, 0, 2, 3, '#1b1b1f');                       // 앞쪽 눈
    R(10, 2, 3, 4, SKIN_D);                                                   // 코
    R(2, 6, 8, 3, '#5a1a14'); R(3, 6, 6, 1, '#ffffff');                       // 기합 지르는 입
  }

  function drawCutin() {
    if (game.cutin < 0 || game.cutinT <= 0) return;
    const f = F[game.cutin], left = f.id === 0;
    const t = CUTIN - game.cutinT;                                   // 0 → CUTIN
    const inK = Math.min(1, t / 7), outK = Math.min(1, game.cutinT / 6);
    const k = Math.min(inK, outK);
    const ease = 1 - Math.pow(1 - k, 3);
    const col = left ? '255,120,90' : '100,180,255';
    const bandY = 130, bandH = 150;
    ctx.save();
    // 비스듬한 띠
    ctx.globalAlpha = ease;
    ctx.beginPath();
    ctx.moveTo(0, bandY + 20); ctx.lineTo(W, bandY - 20); ctx.lineTo(W, bandY + bandH - 20); ctx.lineTo(0, bandY + bandH + 20); ctx.closePath();
    ctx.fillStyle = 'rgba(8,8,12,.82)'; ctx.fill();
    ctx.clip();
    // 집중선
    for (let i = 0; i < 14; i++) {
      const ly = bandY - 20 + ((i * 37 + frameCount * 3) % (bandH + 40));
      const lx = ((i * 131 + frameCount * 26 * (left ? 1 : -1)) % (W + 300) + W + 300) % (W + 300) - 150;
      ctx.fillStyle = 'rgba(' + col + ',' + (0.25 + (i % 3) * 0.12) + ')';
      ctx.fillRect(lx, ly, 120 + (i % 4) * 40, 2 + (i % 2) * 2);
    }
    // 얼굴
    const s = 6.5;
    const fx = left ? -170 + ease * 380 : W + 170 - ease * 380;
    ctx.save(); ctx.translate(fx + (left ? t * 0.6 : -t * 0.6), bandY + bandH / 2); ctx.scale(left ? 1 : -1, 1);
    ctx.shadowColor = 'rgba(' + col + ',.9)'; ctx.shadowBlur = 24;
    if (!drawSpriteFace(f)) drawFace(f, s);
    ctx.restore();
    // 글자
    ctx.font = '30px ' + PIX; ctx.textAlign = left ? 'left' : 'right';
    const tx = left ? 400 - (1 - ease) * 300 : 400 + (1 - ease) * 300;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText('SUPER!', tx + 3, bandY + bandH / 2 + 15);
    ctx.fillStyle = 'rgb(' + col + ')'; ctx.fillText('SUPER!', tx, bandY + bandH / 2 + 12);
    ctx.restore();
    // 띠 테두리
    ctx.save(); ctx.globalAlpha = ease; ctx.strokeStyle = 'rgba(' + col + ',.9)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, bandY + 20); ctx.lineTo(W, bandY - 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, bandY + bandH + 20); ctx.lineTo(W, bandY + bandH - 20); ctx.stroke();
    ctx.restore();
  }

  // ---- HUD: 회사에서 눈에 덜 띄도록 얇고 흐린 회색톤 ----
  function drawHUD(tick) {
    const bw = 240, bh = 6, y = 14;
    for (const f of F) {
      const left = f.id === 0;
      const x0 = left ? 24 : W - 24 - bw;
      rect(x0, y, bw, bh, 'rgba(255,255,255,.08)');
      const gw = bw * f.ghost / 100, hw = bw * f.hp / 100;
      rect(left ? x0 + bw - gw : x0, y, gw, bh, 'rgba(255,255,255,.14)');
      rect(left ? x0 + bw - hw : x0, y, hw, bh, f.hp > 30 ? 'rgba(210,214,222,.42)' : 'rgba(230,150,140,.5)');
      ctx.font = '7px ' + PIX; ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.textAlign = left ? 'left' : 'right';
      ctx.fillText((f.id + 1) + 'P', left ? x0 : x0 + bw, y + bh + 11);
      for (let i = 0; i < 2; i++) {
        const cx = left ? x0 + bw - 4 - i * 10 : x0 + 4 + i * 10;
        ctx.fillStyle = i < f.wins ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.1)';
        ctx.beginPath(); ctx.arc(cx, y + bh + 8, 2.5, 0, Math.PI * 2); ctx.fill();
      }
      if (f.combo >= 2 && f.comboT > 0) {
        ctx.font = '9px ' + PIX; ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.55, f.comboT / 40) + ')';
        ctx.fillText(f.combo + ' HIT', left ? x0 : x0 + bw, y + bh + 26);
      }
      const mw = 110, mx = left ? 24 : W - 24 - mw, my = H - 14;
      rect(mx, my, mw, 3, 'rgba(255,255,255,.08)');
      const ready = f.meter >= 50;
      const mww = mw * f.meter / 100;
      rect(left ? mx : mx + mw - mww, my, mww, 3, ready ? (tick % 30 < 15 ? 'rgba(170,220,255,.5)' : 'rgba(170,220,255,.32)') : 'rgba(255,255,255,.22)');
    }
    ctx.font = '9px ' + PIX; ctx.textAlign = 'center'; ctx.fillStyle = game.timer < 600 ? 'rgba(255,170,160,.5)' : 'rgba(255,255,255,.32)';
    ctx.fillText(String(Math.ceil(game.timer / 60)).padStart(2, '0'), W / 2, y + bh + 1);
  }

  function drawMsg(me) {
    let text = game.msg, sub = '';
    if (game.pausedBy) {
      text = 'PAUSE';
      sub = (me >= 0 && (game.pausedBy & (1 << me))) ? 'ESC로 계속' : '상대가 잠깐 자리를 비웠어요';
    } else if (game.phase === 'over') sub = 'ENTER로 다시 시작';
    if (!text) return;
    ctx.textAlign = 'center';
    ctx.font = (text.length > 9 ? 16 : 22) + 'px ' + PIX;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillText(text, W / 2 + 2, 192);
    ctx.fillStyle = text === 'K.O.' ? 'rgba(255,140,130,.75)' : 'rgba(255,255,255,.6)';
    ctx.fillText(text, W / 2, 190);
    if (sub) {
      ctx.font = 'bold 12px "Malgun Gothic", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(sub, W / 2, 218);
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
    const rank = f => (isLying(f) ? -1 : f.state === 'attack' ? 1 : 0), order = [...F].sort((a, b) => rank(a) - rank(b));
    order.forEach(f => drawFighter(f, f.id === opts.me));
    projs.forEach(drawProj);
    sparks.forEach(drawSpark);
    ctx.restore();
    drawCutin();
    drawHUD(opts.tick || 0);
    drawMsg(opts.me);
  }

  return { W, H, BIT, BUTTONS, step, render, newMatch, checksum, state: game, _F: F, _spr: SPR };
})();

if (typeof module !== 'undefined') module.exports = Game;
