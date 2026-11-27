// Luật chơi Puppet Stage: đếm ngược -> giao cầu -> rally -> điểm/mạng -> cao trào -> kết liễu -> kết quả
import { RallyEngine, GUARDS, GUARD_Y } from '../src/components/puppet/rallyEngine.js';
import { LAYOUT as L, RULES, AI, FINISHER } from '../src/components/puppet/puppetConfig.js';

// rng mặc định: dãy giả ngẫu nhiên xác định. KHÔNG dùng hằng số: engine có vòng do-while đổi tầng khiên
// (g === ai.guard) sẽ lặp vô hạn nếu rng luôn trả cùng một giá trị.
const lcg = (seed = 12345) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const make = (rng = lcg()) => {
  const events = [];
  const e = new RallyEngine((type, data) => events.push({ type, data }), rng);
  return { e, events, types: () => events.map((x) => x.type), find: (t) => events.find((x) => x.type === t) };
};
const step = (e, secs, input = {}, dt = 0.016) => { for (let t = 0; t < secs; t += dt) e.update(dt, input); };
// đưa engine thẳng vào pha rally với quả cầu đặt sẵn
const toRally = (e, ball = {}) => { e.phase = 'rally'; Object.assign(e.ball, { visible: true, lastHitBy: 'ai', ...ball }); };
const toFinisher = (e) => { e.beginClimax('test'); step(e, FINISHER.INTRO + 0.2); };

describe('hằng số xuất ra', () => {
  test('GUARDS: HIGH, MID, LOW', () => expect(GUARDS).toEqual(['HIGH', 'MID', 'LOW']));
  test('GUARD_Y: 3 tầng khiên, tăng dần từ cao xuống thấp', () => {
    expect(GUARD_Y).toHaveLength(3);
    expect(GUARD_Y[0]).toBeLessThan(GUARD_Y[1]);
    expect(GUARD_Y[1]).toBeLessThan(GUARD_Y[2]);
  });
});

describe('trạng thái ban đầu / reset', () => {
  test('mới tạo: idle, 0-0, đủ mạng, năng lượng 0, bóng ẩn', () => {
    const { e } = make();
    expect(e.phase).toBe('idle');
    expect(e.score).toEqual({ user: 0, ai: 0 });
    expect(e.lives).toBe(RULES.LIVES);
    expect(e.energy).toBe(0);
    expect(e.ball.visible).toBe(false);
    expect(e.result).toBeNull();
  });
  test('vũ khí ban đầu đang được cầm', () => expect(make().e.weapon.state).toBe('held'));
  test('khiên AI mặc định ở tầng GIỮA', () => expect(make().e.ai.guard).toBe(1));
  test('reset() sau khi chơi đưa mọi thứ về ban đầu', () => {
    const { e } = make();
    e.start(); e.score.user = 3; e.lives = 1; e.energy = 70;
    e.reset();
    expect(e.phase).toBe('idle');
    expect(e.score).toEqual({ user: 0, ai: 0 });
    expect(e.lives).toBe(RULES.LIVES);
    expect(e.energy).toBe(0);
  });
  test('update khi idle không làm gì và không ném lỗi', () => {
    const { e } = make();
    expect(() => step(e, 1)).not.toThrow();
    expect(e.phase).toBe('idle');
  });
  test('không truyền onEvent vẫn chạy được', () => {
    const e = new RallyEngine();
    expect(() => { e.start(); step(e, 5); }).not.toThrow();
  });
});

describe('đếm ngược và giao cầu', () => {
  test('start(): phase countdown, timer = COUNTDOWN, phát sự kiện "start"', () => {
    const { e, types } = make();
    e.start();
    expect(e.phase).toBe('countdown');
    expect(e.timer).toBe(RULES.COUNTDOWN);
    expect(types()).toEqual(['start']);
  });
  test('đếm ngược phát 3, 2, 1 mỗi số đúng một lần', () => {
    const { e, events } = make();
    e.start(); step(e, 3.2);
    expect(events.filter((x) => x.type === 'countdown').map((x) => x.data.n)).toEqual([3, 2, 1]);
  });
  test('hết đếm ngược -> vào pha serve, bóng hiện ra', () => {
    const { e } = make();
    e.start(); step(e, 3.2);
    expect(e.phase).toBe('serve');
    expect(e.ball.visible).toBe(true);
  });
  test('hết SERVE_DELAY -> AI giao cầu, vào rally, phát "serve"', () => {
    const { e, types } = make();
    e.start(); step(e, 3.2 + RULES.SERVE_DELAY + 0.2);
    expect(e.phase).toBe('rally');
    expect(types()).toContain('serve');
    expect(e.ball.lastHitBy).toBe('ai');
  });
  test('cú giao cầu bay sang phía người chơi (vx < 0)', () => {
    const { e } = make();
    e.start(); step(e, 3.2 + RULES.SERVE_DELAY + 0.1);
    expect(e.ball.vx).toBeLessThan(0);
  });
  test('dt quá lớn bị kẹp 0.05 giây (chống nhảy cóc khi tab bị treo)', () => {
    const { e } = make();
    e.start(); e.update(10);
    expect(e.timer).toBeCloseTo(RULES.COUNTDOWN - 0.05, 6);
  });
});

describe('tính điểm và mạng', () => {
  test('bóng rơi xuống sàn phía người chơi -> AI được điểm, mất 1 mạng, năng lượng giảm 25', () => {
    const { e, find } = make();
    e.energy = 60; toRally(e, { x: 300, y: 900, vx: 0, vy: 100 });
    step(e, 0.05);
    expect(e.score).toEqual({ user: 0, ai: 1 });
    expect(e.lives).toBe(RULES.LIVES - 1);
    expect(e.energy).toBe(35);
    expect(e.phase).toBe('point');
    expect(find('floor')).toBeDefined();
    expect(find('point').data).toMatchObject({ who: 'ai', reason: 'You missed the ball' });
  });
  test('bóng rơi phía AI -> người chơi được điểm, không mất mạng', () => {
    const { e, find } = make();
    toRally(e, { x: 1200, y: 900, vx: 0, vy: 100 });
    step(e, 0.05);
    expect(e.score).toEqual({ user: 1, ai: 0 });
    expect(e.lives).toBe(RULES.LIVES);
    expect(find('point').data.reason).toBe('AI missed the ball');
  });
  test('năng lượng không xuống dưới 0 khi bị mất điểm', () => {
    const { e } = make();
    e.energy = 10; toRally(e, { x: 300, y: 900, vy: 100 });
    step(e, 0.05);
    expect(e.energy).toBe(0);
  });
  test('bóng bay ra khỏi biên trái -> tính cho AI', () => {
    const { e } = make();
    toRally(e, { x: -100, y: 500 });
    step(e, 0.05);
    expect(e.score.ai).toBe(1);
  });
  test('bóng bay ra khỏi biên phải -> tính cho người chơi', () => {
    const { e } = make();
    toRally(e, { x: 1600, y: 500 });
    step(e, 0.05);
    expect(e.score.user).toBe(1);
  });
  test('người chơi đánh mà bóng nảy ở bàn mình -> AI được điểm', () => {
    const { e, find } = make();
    toRally(e, { x: 500, y: 680, vx: 0, vy: 300, lastHitBy: 'user' });
    step(e, 0.05);
    expect(find('bounce')).toBeDefined();
    expect(find('point').data).toMatchObject({ who: 'ai', reason: 'Your ball bounced on your own side' });
  });
  test('AI đánh mà bóng nảy ở bàn AI -> người chơi được điểm', () => {
    const { e, find } = make();
    toRally(e, { x: 950, y: 680, vx: 0, vy: 300, lastHitBy: 'ai' });
    step(e, 0.05);
    expect(find('point').data).toMatchObject({ who: 'user', reason: 'AI hit its own side' });
  });
  test('hết mạng -> kết thúc với kết quả "lose"', () => {
    const { e, find } = make();
    e.lives = 1; toRally(e, { x: 300, y: 900, vy: 100 });
    step(e, 0.05);
    expect(e.phase).toBe('result');
    expect(e.result).toMatchObject({ kind: 'lose', reason: 'You ran out of lives' });
    expect(find('result')).toBeDefined();
  });
  test('chỉ tính điểm khi đang rally (không cộng điểm ở pha khác)', () => {
    const { e } = make();
    e.phase = 'serve';
    e._point('user', 'x');
    expect(e.score.user).toBe(0);
  });
  test('sau khi có điểm (1.4s) bóng mới được giao lại', () => {
    const { e } = make();
    toRally(e, { x: 1200, y: 900, vy: 100 });
    step(e, 0.05);
    expect(e.phase).toBe('point');
    step(e, 1.6);
    expect(e.phase).toBe('serve');
  });
  test('đạt MATCH_POINT thì thay vì giao cầu sẽ vào cao trào', () => {
    const { e, find } = make();
    e.phase = 'point'; e.timer = 0.01; e.score.user = RULES.MATCH_POINT;
    step(e, 0.05);
    expect(e.phase).toBe('climax');
    expect(find('climax').data.reason).toBe('match');
  });
});

describe('cú đánh của người chơi', () => {
  const racketAt = (b, over = {}) => ({ x: b.x, y: b.y, vx: 0, vy: 0, ...over });

  test('vợt chạm bóng -> phát "hit", bóng thuộc về người chơi, tăng số lần đánh', () => {
    const { e, find } = make();
    toRally(e, { x: 400, y: 500, vx: 0, vy: 0 });
    step(e, 0.016, { racket: racketAt(e.ball) });
    expect(find('hit')).toBeDefined();
    expect(e.ball.lastHitBy).toBe('user');
    expect(e.rallyHits).toBe(1);
  });
  test('cú đánh bay sang phía AI (vx > 0)', () => {
    const { e } = make();
    toRally(e, { x: 400, y: 500 });
    step(e, 0.016, { racket: racketAt(e.ball) });
    expect(e.ball.vx).toBeGreaterThan(0);
  });
  test('mỗi cú đánh tích ENERGY_PER_RETURN năng lượng', () => {
    const { e } = make();
    toRally(e, { x: 400, y: 500 });
    step(e, 0.016, { racket: racketAt(e.ball) });
    expect(e.energy).toBe(RULES.ENERGY_PER_RETURN);
  });
  test('vung nhanh (> 900) được thưởng thêm ENERGY_FAST_BONUS', () => {
    const { e } = make();
    toRally(e, { x: 400, y: 500 });
    step(e, 0.016, { racket: racketAt(e.ball, { vx: 1000 }) });
    expect(e.energy).toBe(RULES.ENERGY_PER_RETURN + RULES.ENERGY_FAST_BONUS);
  });
  test('vợt ở quá xa thì không đánh trúng', () => {
    const { e, find } = make();
    toRally(e, { x: 400, y: 500 });
    step(e, 0.016, { racket: { x: 400, y: 800, vx: 0, vy: 0 } });
    expect(find('hit')).toBeUndefined();
  });
  test('hitCd 0.25s: không đánh liên tiếp 2 lần trong cùng một khoảnh khắc', () => {
    const { e, events } = make();
    toRally(e, { x: 400, y: 500 });
    step(e, 0.05, { racket: racketAt(e.ball) }, 0.016);
    expect(events.filter((x) => x.type === 'hit')).toHaveLength(1);
  });
  test('bóng đã qua lưới phía AI thì vợt không với tới', () => {
    const { e, find } = make();
    toRally(e, { x: L.NET_X + 200, y: 500 });
    step(e, 0.016, { racket: racketAt(e.ball) });
    expect(find('hit')).toBeUndefined();
  });
  test('năng lượng đầy -> vào cao trào (reason "energy")', () => {
    const { e, find } = make();
    e.energy = RULES.ENERGY_MAX - 5; toRally(e, { x: 400, y: 500 });
    step(e, 0.016, { racket: racketAt(e.ball) });
    expect(e.energy).toBe(RULES.ENERGY_MAX);
    expect(e.phase).toBe('climax');
    expect(find('climax').data.reason).toBe('energy');
  });
  test('năng lượng bị kẹp ở ENERGY_MAX', () => {
    const { e } = make();
    e.energy = 99; toRally(e, { x: 400, y: 500 });
    step(e, 0.016, { racket: racketAt(e.ball, { vx: 2000 }) });
    expect(e.energy).toBeLessThanOrEqual(RULES.ENERGY_MAX);
  });
});

describe('AI đỡ bóng', () => {
  const incoming = { x: L.AI_X - 20, y: 600, vx: 300, vy: 0, lastHitBy: 'user' };

  test('rng thấp (< xác suất) -> AI đỡ được, phát "aiReturn", bóng bay ngược lại', () => {
    const { e, find } = make(() => 0);
    toRally(e, incoming);
    step(e, 0.016);
    expect(find('aiReturn')).toBeDefined();
    expect(e.ball.lastHitBy).toBe('ai');
    expect(e.ball.vx).toBeLessThan(0);
  });
  test('rng cao (>= xác suất) -> AI không đỡ', () => {
    const { e, find } = make(() => 0.999);
    toRally(e, incoming);
    step(e, 0.016);
    expect(find('aiReturn')).toBeUndefined();
  });
  test('AI chỉ đỡ khi bóng vào vùng REACH_X', () => {
    const { e, find } = make(() => 0);
    toRally(e, { ...incoming, x: L.AI_X - AI.REACH_X - 200 });
    step(e, 0.016);
    expect(find('aiReturn')).toBeUndefined();
  });
  test('rally càng dài AI càng khó đỡ nhưng không dưới RETURN_CHANCE_MIN', () => {
    const chance = (hits) => Math.max(AI.RETURN_CHANCE_MIN, AI.RETURN_CHANCE_START - hits * AI.RETURN_DECAY_PER_HIT);
    expect(chance(0)).toBe(AI.RETURN_CHANCE_START);
    expect(chance(5)).toBeLessThan(chance(0));
    expect(chance(1000)).toBe(AI.RETURN_CHANCE_MIN);
  });
  test('AI không đỡ bóng do chính AI vừa đánh', () => {
    const { e, find } = make(() => 0);
    toRally(e, { ...incoming, lastHitBy: 'ai' });
    step(e, 0.016);
    expect(find('aiReturn')).toBeUndefined();
  });
});

describe('cao trào và cú kết liễu', () => {
  test('beginClimax: phase climax, bóng đứng yên, khiên ở tầng giữa', () => {
    const { e, find } = make();
    e.ball.vx = 500; e.beginClimax('test');
    expect(e.phase).toBe('climax');
    expect([e.ball.vx, e.ball.vy]).toEqual([0, 0]);
    expect(e.ai.guard).toBe(1);
    expect(find('climax')).toBeDefined();
  });
  test.each([['climax'], ['finisher'], ['strike'], ['result']])('beginClimax bị bỏ qua khi đang ở pha %s', (phase) => {
    const { e, events } = make();
    e.phase = phase; e.beginClimax('x');
    expect(e.phase).toBe(phase);
    expect(events.filter((x) => x.type === 'climax')).toHaveLength(0);
  });
  test('con rối nhảy lên dần trong pha climax', () => {
    const { e } = make();
    e.beginClimax('t'); step(e, 0.5);
    expect(e.user.jump).toBeGreaterThan(0);
    expect(e.user.jump).toBeLessThan(FINISHER.JUMP_HEIGHT);
  });
  test('sau INTRO giây -> pha finisher, phát "finisherStart" với cửa sổ WINDOW giây', () => {
    const { e, find } = make();
    toFinisher(e);
    expect(e.phase).toBe('finisher');
    expect(find('finisherStart').data.window).toBe(FINISHER.WINDOW);
  });
  test('không vung trong WINDOW giây -> "fizzle": năng lượng về 40, điểm bị kéo xuống dưới match point', () => {
    const { e, find } = make();
    e.score.user = RULES.MATCH_POINT; toFinisher(e);
    step(e, FINISHER.WINDOW + 0.3);
    expect(find('fizzle')).toBeDefined();
    expect(e.energy).toBe(40);
    expect(e.score.user).toBe(RULES.MATCH_POINT - 1);
    expect(e.phase).toBe('point');
  });
  test.each([[-1, 0], [-0.31, 0], [-0.3, 1], [0, 1], [0.3, 1], [0.31, 2], [1, 2], [undefined, 1]])('vung dirY=%p -> tầng %i (0 cao, 1 giữa, 2 thấp)', (dirY, height) => {
    const { e, find } = make();
    toFinisher(e);
    e.update(0.016, { swing: { dirY, speed: 5 } });
    expect(find('strike').data.height).toBe(height);
  });
  test('vung trúng tầng khiên đang chặn -> blocked=true', () => {
    const { e, find } = make();
    toFinisher(e); e.ai.guard = 1; e.ai.guardTimer = 99;
    e.update(0.016, { swing: { dirY: 0 } });
    expect(find('strike').data).toMatchObject({ blocked: true, guard: 1 });
    expect(e.phase).toBe('strike');
  });
  test('vung khác tầng khiên -> blocked=false', () => {
    const { e, find } = make();
    toFinisher(e); e.ai.guard = 1; e.ai.guardTimer = 99;
    e.update(0.016, { swing: { dirY: -1 } });
    expect(find('strike').data.blocked).toBe(false);
  });
  test('khiên AI đổi tư thế sau mỗi GUARD_SWITCH giây và luôn đổi sang tầng KHÁC', () => {
    const seq = [0, 0.5, 0.99, 0.1, 0.6];
    let i = 0;
    const { e, events } = make(() => seq[i++ % seq.length]);
    toFinisher(e);
    let prev = e.ai.guard;
    step(e, 3, {}, 0.016);
    events.filter((x) => x.type === 'guard').forEach((g) => { expect(g.data.guard).not.toBe(prev); prev = g.data.guard; });
    expect(events.filter((x) => x.type === 'guard').length).toBeGreaterThanOrEqual(3);
  });
  const playStrike = (blocked) => {
    const ctx = make();
    toFinisher(ctx.e); ctx.e.ai.guard = 1; ctx.e.ai.guardTimer = 999;
    ctx.e.update(0.016, { swing: { dirY: blocked ? 0 : -1, speed: 5 } });
    step(ctx.e, 12);
    return ctx;
  };
  test('đòn trúng: chuỗi release -> impact -> shatter -> catch -> result "win"', () => {
    const { e, types } = playStrike(false);
    expect(e.phase).toBe('result');
    expect(e.result.kind).toBe('win');
    const t = types();
    ['strike', 'release', 'impact', 'shatter', 'catch', 'result'].forEach((x) => expect(t).toContain(x));
    expect(t.indexOf('release')).toBeLessThan(t.indexOf('impact'));
    expect(t.indexOf('impact')).toBeLessThan(t.indexOf('catch'));
    expect(t.indexOf('catch')).toBeLessThan(t.indexOf('result'));
  });
  test('đòn trúng làm AI vỡ khiên và bị đánh bay', () => {
    const { e } = playStrike(false);
    expect(e.ai.shattered).toBe(true);
  });
  test('đòn bị khiên đỡ: phát "blocked", vũ khí bật ngược, kết quả "lose"', () => {
    const { e, types } = playStrike(true);
    expect(types()).toContain('blocked');
    expect(types()).not.toContain('shatter');
    expect(e.result.kind).toBe('lose');
    expect(e.result.reason).toMatch(/blocked/);
  });
  test('vũ khí về tay (state held) trước khi hiện kết quả', () => {
    expect(playStrike(false).e.weapon.state).toBe('held');
  });
  test('con rối hạ xuống đất sau khi ném và phát "land" đúng 1 lần', () => {
    const { e, events } = playStrike(false);
    expect(events.filter((x) => x.type === 'land')).toHaveLength(1);
    expect(e.user.jump).toBe(0);
  });
  test('kết quả chỉ được chốt một lần (gọi _finish lần nữa không đổi)', () => {
    const { e, events } = playStrike(false);
    e._finish('lose', 'again');
    expect(e.result.kind).toBe('win');
    expect(events.filter((x) => x.type === 'result')).toHaveLength(1);
  });
  test('kể cả khi không có dữ liệu vị trí vũ khí, pha strike vẫn kết thúc trong 10 giây', () => {
    const { e } = make();
    toFinisher(e); e.ai.guardTimer = 999;
    e.update(0.016, { swing: { dirY: -1 } });
    step(e, 10);
    expect(e.phase).toBe('result');
  });
  test('vị trí cầm vũ khí do giao diện truyền vào được dùng làm điểm ném', () => {
    const { e, find } = make();
    toFinisher(e); e.ai.guardTimer = 999;
    e.update(0.016, { swing: { dirY: -1 }, weapon: { x: 321, y: 432, angle: 0.1, k: 0.5 } });
    step(e, 0.5, { weapon: { x: 321, y: 432, angle: 0.1, k: 0.5 } });
    expect(find('release').data).toEqual({ x: 321, y: 432 });
  });
});

describe('tính xác định (cùng rng -> cùng kết quả)', () => {
  const run = () => {
    let s = 7; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const { e, types } = make(rng);
    e.start(); step(e, 6);
    return { phase: e.phase, bx: Math.round(e.ball.x), types: types().join(',') };
  };
  test('hai lần chạy giống hệt nhau', () => expect(run()).toEqual(run()));
});
