/**
 * Найкраща точка для полів меланжу (головна — середні й великі разом, мапа — поля однієї величини): місце, з якого в межах радіуса найбільше полів, — туди
 * найшвидше дістатись до більшості з них (не сектор, де їх найбільше: поля по краях сусідніх секторів теж рахуються).
 * Кандидати — самі поля й центри їхніх сусідств; рівно — більше великих полів. Спільне для сервера (головна) і мапи.
 */
/** @param {[number, number, 'small' | 'medium' | 'large'][]} fields поля [x, y, величина]; @param {number} radius */
export function bestSpot(fields, radius) {
  if (!fields.length) return null
  const r2 = radius * radius
  const around = (x, y) => fields.filter((f) => (f[0] - x) ** 2 + (f[1] - y) ** 2 <= r2)
  let best = null
  const consider = (x, y) => {
    const near = around(x, y)
    const large = near.filter((f) => f[2] === 'large').length
    if (!best || near.length > best.n || (near.length === best.n && large > best.large)) best = { x, y, n: near.length, large }
  }
  for (const f of fields) {
    // спершу центр сусідства поля (ближче до всіх його полів), далі саме поле; рівно — лишається перше
    const near = around(f[0], f[1])
    consider(near.reduce((s, g) => s + g[0], 0) / near.length, near.reduce((s, g) => s + g[1], 0) / near.length)
    consider(f[0], f[1])
  }
  return { ...best, x: Math.round(best.x), y: Math.round(best.y) }
}
