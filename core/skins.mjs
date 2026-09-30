// 皮肤数据：从 dsh-ui-three-body 的客户端源码原样抽出（同一套视觉 DNA）。
// 只放数据与纯函数，不含任何渲染框架依赖，主进程/渲染进程/测试都能用。

/** 皮肤属性：iris 虹膜三色 / pupil 瞳孔形状 / blood 血丝强度 / fierce 凶恶眼神 / aura 特效 / glow 光晕色。 */
export const EYE_THEMES = {
  cyan: { iris: ['#8a5a3b', '#4a2e1a', '#160b06'], pupil: 'round', blood: 0.3, fierce: false, aura: 'none', glow: 'rgba(120,80,50,0.35)' },
  purple: { iris: ['#e9d5ff', '#9333ea', '#3b0764'], pupil: 'slit', blood: 0.45, fierce: true, aura: 'wraith', glow: 'rgba(168,85,247,0.6)' },
  void: { iris: ['#312e81', '#1e1b4b', '#030712'], pupil: 'ring', blood: 0.2, fierce: false, aura: 'abyss', glow: 'rgba(79,70,229,0.55)' },
  starfield: { iris: ['#4c1d95', '#312e81', '#0b0f14'], pupil: 'ring', blood: 0.15, fierce: false, aura: 'star', glow: 'rgba(139,92,246,0.6)' },
  sharingan: { iris: ['#ff8a8a', '#b91c1c', '#450a0a'], pupil: 'sharingan', blood: 0.5, fierce: true, aura: 'blood', glow: 'rgba(185,28,28,0.65)' },
  mangekyo: { iris: ['#fca5a5', '#7f1d1d', '#1c0000'], pupil: 'mangekyo', blood: 0.6, fierce: true, aura: 'blood', glow: 'rgba(127,29,29,0.65)' },
  rinnegan: { iris: ['#e9d5ff', '#a855f7', '#4c1d95'], pupil: 'rinnegan', blood: 0.2, fierce: false, aura: 'pale', glow: 'rgba(168,85,247,0.6)' },
  sophon: { iris: ['#cbd5e1', '#64748b', '#0f172a'], pupil: 'sophon', blood: 0.15, fierce: false, aura: 'star', glow: 'rgba(100,116,139,0.6)' },
  byakugan: { iris: ['#f5f3ff', '#c7d2fe', '#6366f1'], pupil: 'byakugan', blood: 0.4, fierce: true, aura: 'pale', glow: 'rgba(199,210,254,0.6)' },
  blood: { iris: ['#ff8a8a', '#dc2626', '#450a0a'], pupil: 'slit', blood: 1, fierce: true, aura: 'blood', glow: 'rgba(220,38,38,0.7)' },
  corpse: { iris: ['#d1d5db', '#9ca3af', '#374151'], pupil: 'round', blood: 0.1, fierce: false, aura: 'ash', glow: 'rgba(156,163,175,0.55)' },
  demon: { iris: ['#7f1d1d', '#450a0a', '#0a0000'], pupil: 'slit', blood: 0.7, fierce: true, aura: 'ember', glow: 'rgba(127,29,29,0.7)' },
}

/** 皮肤展示顺序（菜单循环切换）。从三体的默认顺序里剔除了未定义配色的 starfield 之外的项保持一致。 */
export const SKIN_ORDER = ['cyan', 'void', 'starfield', 'sharingan', 'mangekyo', 'rinnegan', 'sophon', 'byakugan', 'blood', 'corpse', 'demon']

/** 眼白血丝（放射状，从边缘向虹膜；按皮肤 blood 强度取前 N 条）。 */
export const BLOOD_VESSELS = [
  'M 8 26 Q 20 22 30 26',
  'M 12 58 Q 24 64 34 60',
  'M 88 30 Q 76 24 66 30',
  'M 84 62 Q 72 68 62 64',
  'M 20 12 Q 24 22 30 28',
  'M 76 10 Q 72 22 66 30',
  'M 18 80 Q 26 72 32 64',
  'M 78 82 Q 70 72 64 64',
  'M 6 42 Q 16 46 24 46',
  'M 90 44 Q 80 48 72 46',
]

/** 所有瞳孔形状。 */
export const PUPIL_SHAPES = ['round', 'slit', 'ring', 'sharingan', 'mangekyo', 'rinnegan', 'sophon', 'byakugan']

/**
 * 取皮肤定义；未知皮肤名回落到原色（人眼）。
 * @param {string} name 皮肤名。
 * @returns {object} 皮肤定义。
 */
export function skinOf(name) {
  return EYE_THEMES[name] ?? EYE_THEMES.cyan
}

/**
 * 按血丝强度取该皮肤要画的血管路径。
 * @param {object} skin 皮肤定义。
 * @returns {string[]} 路径数组。
 */
export function vesselsOf(skin) {
  const count = Math.round((skin?.blood ?? 0) * BLOOD_VESSELS.length)
  return BLOOD_VESSELS.slice(0, Math.max(0, Math.min(BLOOD_VESSELS.length, count)))
}

/**
 * 中文皮肤名（用于右键菜单/托盘提示）。
 * @param {string} name 皮肤名。
 * @returns {string} 显示名。
 */
export function skinLabel(name) {
  const labels = {
    cyan: '原色（人眼）',
    purple: '深渊',
    void: '宇宙死瞳',
    starfield: '星野',
    sharingan: '写轮眼',
    mangekyo: '万花筒',
    rinnegan: '轮回眼',
    sophon: '三体智子',
    byakugan: '白眼',
    blood: '血瞳',
    corpse: '尸瞳',
    demon: '魔瞳',
  }
  return labels[name] ?? name
}
