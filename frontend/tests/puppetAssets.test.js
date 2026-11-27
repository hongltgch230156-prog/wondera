import { svgUrl, PRESET_PUPPETS, AI_PUPPET, EQUIPMENT, BALLS, findBall, findEquipment } from '../src/components/puppet/puppetAssets.js';

describe('svgUrl', () => {
  test('tạo data URL image/svg+xml', () => expect(svgUrl('<svg/>').startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true));
  test('mã hoá ký tự đặc biệt để an toàn trong URL', () => {
    const u = svgUrl('<svg a="1">#</svg>');
    expect(u).not.toMatch(/[<>"# ]/);
  });
  test('giải mã lại ra đúng SVG gốc', () => {
    const s = '<svg width="10"><text>Xin chào & #1</text></svg>';
    expect(decodeURIComponent(svgUrl(s).split(',').slice(1).join(','))).toBe(s);
  });
});

describe('PRESET_PUPPETS', () => {
  test('có 3 con rối mẫu: kitsune, jade, crane', () => expect(PRESET_PUPPETS.map((p) => p.id)).toEqual(['kitsune', 'jade', 'crane']));
  test('mỗi con có tên và SVG hợp lệ', () => {
    PRESET_PUPPETS.forEach((p) => { expect(p.name.length).toBeGreaterThan(0); expect(p.svg).toContain('<svg'); expect(p.svg).toContain('</svg>'); });
  });
  test('ba con rối khác nhau về hình', () => expect(new Set(PRESET_PUPPETS.map((p) => p.svg)).size).toBe(3));
  test('AI_PUPPET có SVG', () => expect(JSON.stringify(AI_PUPPET)).toContain('<svg'));
});

describe('BALLS / findBall', () => {
  test('4 loại bóng: pearl, star, lantern, shuttle', () => expect(BALLS.map((b) => b.id)).toEqual(['pearl', 'star', 'lantern', 'shuttle']));
  test.each([['pearl'], ['star'], ['lantern'], ['shuttle']])('findBall(%s) trả đúng bóng', (id) => expect(findBall(id).id).toBe(id));
  test.each([['nope'], [undefined], [null], ['']])('findBall(%p) rơi về bóng đầu tiên', (id) => expect(findBall(id)).toBe(BALLS[0]));
  test('mỗi bóng có svg', () => BALLS.forEach((b) => expect(b.svg).toContain('<svg')));
});

describe('EQUIPMENT / findEquipment', () => {
  const kinds = Object.keys(EQUIPMENT).filter((k) => Array.isArray(EQUIPMENT[k])); // (EQUIPMENT.shield không phải danh sách)
  test('có ít nhất một loại trang bị', () => expect(kinds.length).toBeGreaterThan(0));
  test.each(kinds)('loại "%s": có ít nhất 1 món, id không trùng, mỗi món có svg và vị trí cầm', (kind) => {
    const list = EQUIPMENT[kind];
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list.map((e) => e.id)).size).toBe(list.length);
    list.forEach((e) => { expect(e.svg).toContain('<svg'); expect(Array.isArray(e.grip)).toBe(true); expect(e.grip).toHaveLength(2); });
  });
  test.each(kinds)('findEquipment("%s", id không tồn tại) rơi về món đầu tiên', (kind) => {
    expect(findEquipment(kind, 'zzz')).toBe(EQUIPMENT[kind][0]);
  });
  test.each(kinds)('findEquipment("%s", id đúng) trả đúng món', (kind) => {
    const last = EQUIPMENT[kind][EQUIPMENT[kind].length - 1];
    expect(findEquipment(kind, last.id)).toBe(last);
  });
  test('loại không tồn tại -> undefined (không ném lỗi)', () => expect(findEquipment('xyz', 'a')).toBeUndefined());
});
