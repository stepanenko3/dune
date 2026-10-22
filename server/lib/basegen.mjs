/*
 * Генератор баз на сервері: той самий модуль, що в браузері (src/engine/basegen), з рушієм сайту через require.
 * Сервер генерує сам із параметрів і перевіряє правила гри — документ із браузера не береться.
 */
import { createRequire } from 'node:module'
import { generateBase as gen, normalizeParams } from '../../src/engine/basegen/index.mjs'

const require = createRequire(import.meta.url)
export const ENGINE = {
  PIECES: require('../../src/engine/pieces.js'),
  STABILITY: require('../../src/engine/stability.js'),
  BASEDATA: require('../../src/engine/hydrate.js'),
  CONVERT: require('../../src/engine/convert.js'),
  PRESETS: require('../../src/components/base/builder/presets.json'),
}

export const generateBase = (params) => gen(params, ENGINE)
export { normalizeParams }
