/**
 * 3D-орнітоптер для головної: «Atreides ornithopter Dune» від jorafe (Sketchfab, CC BY 4.0),
 * GLB — scripts/orni-atreides.mjs.
 *
 * Анімації моделі: крила, опори шасі, рампа. Кліп крил у файлі — це розкриття (0–0,8 с), пауза і
 * перехід у льотну позу (1,67–2,88 с: лопаті провертаються на 180°). Тож крила ведемо етапами:
 * розкриття окремим кліпом; у польоті кліп лише тримає розкриту позу, а кожна лопать махає вгору-вниз від неї
 * (шарнір у втулці, вісь уздовж корпусу), як маятник. Темп і амплітуда змахів,
 * розгін після зльоту і сповільнення після посадки — повзунками (зберігаються в налаштуваннях браузера).
 * «Завести двигун» на землі: крила розкриваються й махають у спокійному темпі, орні стоїть (біля дюн здіймається
 * пил); оберти — повзунком у налаштуваннях (за замовчуванням повні, як у польоті). «Злетіти» тоді розганяє змахи
 * одразу з поточного темпу, «Заглушити» — сповільнює й складає крила.
 * «Злетіти»: крила розкриваються → змахи розганяються → орні рівно відривається від піску, опори й рампа
 * ховаються; ще набираючи висоту, опускає ніс і рушає вперед: дюни пливуть назад і опускаються однією кривою
 * з нахилом, тож на висоту орні виходить уже в польоті.
 * «Сісти» — дзеркально: орні гальмує з легким підйомом носа, дюни зупиняються й повертаються, останні миті —
 * вертикально вниз; опори й рампа виходять → на піску змахи сповільнюються → крила складаються.
 * Сканер (промінь донизу і знахідки тижня в HUD) вмикається й вимикається кнопкою, лише в повітрі.
 * «Планувати» (режим стерв'ятника): двигун вимкнено — змахи сповільнюються й завмирають у розкритій позі
 * моделі, орні вирівнюється (ніс — у горизонт), знижується, гойдається на потоках; щойно крила завмерли — від кінчиків
 * бічних і задніх лопатей назад тягнуться смуги розрізаного повітря (прямі, по них біжать потоки). «Запустити
 * двигун» — змахи розганяються, орні набирає висоту.
 * «Прискорення» (у польоті й у плануванні): корені лопатей повертаються назад навколо вертикалі корпусу — поверх
 * пози моделі, сам кліп не змінюється, — ніс пірнає, орні робить ривок уперед, дюни й смуги біжать швидше.
 * Відступ від дюн, швидкості польоту, планування й прискорення і кут крил — повзунками (налаштування браузера).
 * Швидкість: роздільність сама знижується, якщо кадрів бракує, і повертається, коли запас є; пісок — без
 * фізичного матеріалу (світло рахує сам), хмарки пилу — з готової текстури; лічильник FPS — у налаштуваннях.
 * Якість — «Авто», «Висока», «Баланс», «Еко» (TIERS): на телефоні «Авто» бере баланс (легша модель, пісок без зерна)
 * і сам переходить на еко (простіший пісок, менше пилу), якщо й так не встигає. На телефоні краї згладжені (MSAA).
 * Кадр, у якому нічого не зрушило (орні стоїть, камера на місці), не малюється — телефон не гріється даремно.
 * Налаштування відкриваються вікном на весь екран: ліворуч сцена з пультом, праворуч панель. Сцена та сама —
 * полотно переїжджає зі сторінки у вікно й назад, тож другої сцени (й другого контексту WebGL) немає.
 * Дюни — латка піску під орні, що тане у фон: висота — з формули (та сама в шейдері й у коді), тож орні
 * сідає на гребінь, а промінь сканера дістає до піску; кільця сканера біжать по дюнах, і на них
 * проступає сітка рельєфу. Рушаючи вперед, орні наче набирає висоту: пісок опускається разом із розгоном.
 * Вигляд дюн — у налаштуваннях: «Пісок» (рельєф, брижа, зерно), «Смуги» (лінії по рельєфу) або «Нічого».
 * Пил: на зльоті й посадці, поки крила б'ють біля дюн, з-під орні розлітаються піщинки й хмарки пилу.
 *
 * Вид 3/4, прозорий фон (світіння — CSS), обертання мишею; керування — лише кнопками (клік по деталях
 * моделі прибрано: промінь по скінованих мешах рахує кожну вершину і підвішував сторінку).
 * Кадри крутяться лише поки блок видно на екрані.
 */
import { Fragment, type ReactElement, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { Bird, ChevronRight, DoorOpen, Feather, Film, Footprints, Moon, MoreHorizontal, PlaneLanding, PlaneTakeoff, Power, Radar, Route, SlidersHorizontal, Sun, X, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { prefGet, prefSet } from '@/lib/prefs'
import { t } from '@/lib/i18n'
import { DuneLoading } from '@/components/ui/dune-loader'

export interface ScanLine {
  label: string
  value: string
}

const MODEL_URL = '/models/orni-atreides.glb'
/** друга модель на вибір: дрон-розвідник «Buster Drone» (LaVADraGoN, CC BY 4.0) — GLB: scripts/buster-drone.mjs */
const DRONE_URL = '/models/buster-drone.glb'
export type ModelKey = 'orni' | 'drone'
const MODELS: [ModelKey, string][] = [['orni', t('Орнітоптер')], ['drone', t('Дрон')]]
/** той самий орні з удвічі простішою геометрією (трикутників — 45%, кістки й анімації ті самі) — для телефонів: scripts/orni-lite.mjs */
const MODEL_LITE_URL = '/models/orni-atreides-lite.glb'
/** якість сцени (пам'ятається): «Авто» вибирає за пристроєм і знижує сама, якщо кадрів бракує */
type Quality = 'auto' | 'high' | 'balanced' | 'eco'
type Tier = Exclude<Quality, 'auto'>
const QUALITY: [Quality, string][] = [['auto', t('Авто')], ['high', t('Висока')], ['balanced', t('Баланс')], ['eco', t('Еко')]]
const TIER_NAME: Record<Tier, string> = { high: t('висока'), balanced: t('баланс'), eco: t('еко') }
/**
 * Рівні якості: найбільша щільність пікселів, густота сітки піску (вершин ×seg²; біля орні крок однаковий — 5 см,
 * рідшає вдалині), частка пилу, зерно піску, брижа й плями у два шари, легка модель орні. Кадрів не обмежуємо
 * (30 за секунду — уже ривками); нижче ×1,5 на екранах ×3 (телефони) не опускаємось — там уже видно пікселі
 */
const TIERS: Record<Tier, { dpr: number; seg: number; dust: number; grain: boolean; detail: boolean; lite: boolean; hint: string }> = {
  high: { dpr: 2, seg: 360, dust: 1, grain: true, detail: true, lite: false, hint: t('Повна модель, пісок із зерном, різкість до ×2.') },
  balanced: { dpr: 2, seg: 220, dust: 0.6, grain: false, detail: true, lite: true, hint: t('Легша модель, пісок без зерна.') },
  eco: { dpr: 1.5, seg: 150, dust: 0.35, grain: false, detail: false, lite: true, hint: t('Легша модель, простіший пісок, менше пилу й пікселів — для слабких пристроїв.') },
}
let autoGuess: Tier | null = null
/** телефон: сенсорний екран, вужчий за планшет */
const isPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820
/** «Авто» за пристроєм: телефон чи слабкий комп'ютер — баланс, режим заощадження трафіку — еко, решта — висока */
const autoTier = (): Tier => {
  if (autoGuess) return autoGuess
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number }
  const phone = isPhone()
  const weak = (nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory ?? 8) <= 4
  autoGuess = nav.connection?.saveData ? 'eco' : phone || weak ? 'balanced' : 'high'
  return autoGuess
}
/** «Авто» вже знизило рівень на цій сторінці (не встигали кадри) — нова сцена (інша модель) одразу з нього */
let autoDown: Tier | null = null
/** найменша щільність пікселів: на звичайних екранах — 0,75, на щільних — половина екранної (не менше 1) */
const dprFloor = () => ((devicePixelRatio || 1) >= 1.5 ? Math.max(1, (devicePixelRatio || 1) / 2) : 0.75)
/**
 * Етапи єдиного кліпу дрона «Start_Liftoff» (с): 0 — спить, присівши; до 5 — прокидається й встає на ноги
 * (розкручуються турбіни); 5–8 — присідає, відштовхується, турбіни лягають горизонтально, ноги відриваються від
 * піску; 24,9 — стабільне зависання (ноги звисають). Посередині кліп ще й смикає дрон уперед і розвертає —
 * це вузол Drone_Controller, його доріжки прибираємо: рухом дрона по сцені керуємо самі
 */
const D_SLEEP = 0
const D_STAND = 5
const D_AIR = 8
const D_HOVER = 24.9
/** поштовх ногами в кліпі — тоді ж починається набір висоти */
const D_PUSH = 5.9

/**
 * Усі 21 анімація моделі за індексом у файлі (назви в ній іспанською з поламаним кодуванням).
 * Деякі в моделі повторюються (17, 18 і 20 однакові), але лишаємо всі, як у файлі.
 */
const ANIMS: { i: number; group: 'wings' | 'gear' | 'ramp'; label: string }[] = [
  { i: 0, group: 'gear', label: t('Передня ліва опора') },
  { i: 1, group: 'gear', label: t('Передня права опора') },
  { i: 2, group: 'ramp', label: t('Рампа всередину') },
  { i: 3, group: 'gear', label: t('Опори рампи') },
  { i: 4, group: 'ramp', label: t('Бічна стулка рампи') },
  { i: 5, group: 'gear', label: t('Задні опори') },
  { i: 6, group: 'gear', label: t('Передня права опора, варіант 2') },
  { i: 7, group: 'gear', label: t('Передня ліва опора, варіант 2') },
  { i: 8, group: 'gear', label: t('Передня ліва опора, варіант 3') },
  { i: 9, group: 'gear', label: t('Передня права опора, варіант 3') },
  { i: 10, group: 'gear', label: t('Передня ліва опора, варіант 4') },
  { i: 11, group: 'gear', label: t('Передня ліва опора, варіант 5') },
  { i: 12, group: 'gear', label: t('Передня права опора, варіант 4') },
  { i: 13, group: 'gear', label: t('Задні опори, швидко') },
  { i: 14, group: 'ramp', label: t('Закрити проріз рампи') },
  { i: 15, group: 'ramp', label: t('Рампа всередину, варіант 2') },
  { i: 16, group: 'wings', label: t('Розкрити крила') },
  { i: 17, group: 'wings', label: t('Розкриття і перехід у політ') },
  { i: 18, group: 'wings', label: t('Розкриття і перехід у політ, варіант 2') },
  { i: 19, group: 'wings', label: t('Розкриття і перехід у політ, повільно') },
  { i: 20, group: 'wings', label: t('Розкриття і перехід у політ, варіант 3') },
]
const GROUP_LABEL = { wings: t('Крила'), gear: t('Опори шасі'), ramp: t('Рампа') }
const GEAR = [5, 0, 1, 3]
const RAMP = [14, 2]
const UNFOLD = 16
const FLIGHT = 17
/** друга частина кліпу 17 починається з розкритої пози — її орні тримає в польоті (змахи — поворотом коренів лопатей) */
const BEAT_FROM = 1.6

/** один змах (вгору → вниз → у розкриту позу) за темпу 1, с; повзунок «Швидкість змахів» — множник */
const FLAP_PERIOD = 2.5
/** нормаль площини, уздовж якої лежать точки: напрям найменшого розкиду (степеневий метод для (слід·I − коваріація)) */
function planeNormal(P: THREE.Vector3[], guess: THREE.Vector3): THREE.Vector3 {
  const c = P.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(Math.max(1, P.length))
  const m = [0, 0, 0, 0, 0, 0] // xx xy xz yy yz zz
  for (const p of P) {
    const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z
    m[0] += x * x; m[1] += x * y; m[2] += x * z; m[3] += y * y; m[4] += y * z; m[5] += z * z
  }
  const tr = m[0] + m[3] + m[5]
  const v = guess.clone().normalize()
  const t = new THREE.Vector3()
  for (let i = 0; i < 60; i++) {
    t.set(tr * v.x - (m[0] * v.x + m[1] * v.y + m[2] * v.z), tr * v.y - (m[1] * v.x + m[3] * v.y + m[4] * v.z), tr * v.z - (m[2] * v.x + m[4] * v.y + m[5] * v.z))
    if (t.lengthSq() < 1e-20) break
    v.copy(t).normalize()
  }
  return v.dot(guess) < 0 ? v.negate() : v
}
/** нерухома поза з кліпу: кожна доріжка — її значення в момент at (ключі моделей рідкі й у різних кісток різні) */
function poseClip(src: THREE.AnimationClip, at: number, name: string): THREE.AnimationClip {
  return new THREE.AnimationClip(name, 1, src.tracks.map((tr) => {
    const v = Array.from((tr as unknown as { createInterpolant: () => THREE.Interpolant }).createInterpolant().evaluate(at) as ArrayLike<number>)
    const Track = tr.constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack
    return new Track(tr.name, [0, 1], [...v, ...v])
  }))
}
/** куля, найближча до точок (найменші квадрати: x²+y²+z² = 2a·x + 2b·y + 2c·z + d) */
function fitSphere(P: THREE.Vector3[]): { c: THREE.Vector3; r: number } {
  const A = Array.from({ length: 4 }, () => new Array<number>(5).fill(0))
  for (const p of P) {
    const row = [2 * p.x, 2 * p.y, 2 * p.z, 1]
    const y = p.lengthSq()
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]
      A[i][4] += row[i] * y
    }
  }
  for (let i = 0; i < 4; i++) {
    let m = i
    for (let k = i + 1; k < 4; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k
    ;[A[i], A[m]] = [A[m], A[i]]
    if (Math.abs(A[i][i]) < 1e-12) return { c: P[0]?.clone() ?? new THREE.Vector3(), r: 0 }
    for (let k = 0; k < 4; k++) {
      if (k === i) continue
      const f = A[k][i] / A[i][i]
      for (let j = i; j < 5; j++) A[k][j] -= f * A[i][j]
    }
  }
  const c = new THREE.Vector3(A[0][4] / A[0][0], A[1][4] / A[1][1], A[2][4] / A[2][2])
  return { c, r: Math.sqrt(Math.max(0, A[3][4] / A[3][3] + c.lengthSq())) }
}
/** нахил носа вниз, рад: поступальний політ (≈6°); у плануванні орні вирівнюється */
const CRUISE_PITCH = 0.1
const GLIDE_PITCH = 0
/** до якої висоти знижується орні, коли планує (висота польоту — 1,4) */
const GLIDE_ALT = 0.9
/**
 * Усе, що регулюється повзунками (зберігається в налаштуваннях браузера). Часи — у секундах, швидкості — з якою
 * дюни пливуть під орні (од./с), темп змахів — множник (1 — один змах за 2,5 с), амплітуда — у градусах.
 * Зліт і посадка дзеркальні: на зльоті орні turn с піднімається вертикально, далі, ще набираючи висоту, опускає
 * ніс і рушає вперед; на посадці гальмує, а останні turn с сідає вертикально
 */
const FLY = {
  takeoff: { min: 1, max: 10, step: 0.1, def: 2.6, pref: 'orni:tTakeoff' }, // підйом на висоту
  unfold: { min: 0.2, max: 4, step: 0.1, def: 1.2, pref: 'orni:tUnfold' }, // розкладання крил (кліп моделі — 0,8 с)
  fold: { min: 0.2, max: 4, step: 0.1, def: 2, pref: 'orni:tFold' }, // складання крил
  spin: { min: 0, max: 5, step: 0.1, def: 1.5, pref: 'orni:spin' }, // розкручування крил перед відривом
  throttle: { min: 0.05, max: 1, step: 0.05, def: 1, pref: 'orni:throttle' }, // оберти двигуна на землі — частка польотного темпу
  turn: { min: 0, max: 4, step: 0.1, def: 0.3, pref: 'orni:tTurn' }, // зліт: скільки вертикально, перш ніж рушити вперед
  turnDown: { min: 0, max: 4, step: 0.1, def: 0.8, pref: 'orni:tTurnDown' }, // посадка: скільки вертикально наприкінці
  land: { min: 1, max: 10, step: 0.1, def: 3.7, pref: 'orni:tLand' }, // спуск на пісок
  slow: { min: 0, max: 5, step: 0.1, def: 3.5, pref: 'orni:slow' }, // зупинка крил після посадки
  flap: { min: 1, max: 60, step: 1, def: 50, pref: 'orni:flap' },
  amp: { min: 0, max: 30, step: 0.5, def: 9, pref: 'orni:ampDeg' }, // амплітуда змахів: на скільки градусів лопать іде вгору і вниз
  baseUp: { min: -15, max: 15, step: 0.5, def: 3, pref: 'orni:baseUp' }, // рівень верхніх крил, ° (+ — вище): навколо нього вони махають
  baseLow: { min: -15, max: 15, step: 0.5, def: -5.5, pref: 'orni:baseLow' }, // рівень нижніх (бічних) крил, °
  cruise: { min: 0.5, max: 8, step: 0.1, def: 5.5, pref: 'orni:vCruise' },
  drop: { min: 0, max: 3, step: 0.1, def: 1.5, pref: 'orni:drop' }, // на скільки опускається пісок у польоті
  glideStop: { min: 0, max: 6, step: 0.1, def: 1.5, pref: 'orni:tGlideStop' }, // зупинка крил, коли вимкнули двигун
  glideSpin: { min: 0, max: 6, step: 0.1, def: 1.5, pref: 'orni:tGlideSpin' }, // розкручування, коли знову ввімкнули
  glide: { min: 0.5, max: 10, step: 0.1, def: 5, pref: 'orni:vGlide' },
  boostTime: { min: 0.2, max: 5, step: 0.1, def: 1.2, pref: 'orni:tBoost' }, // за скільки набирає й скидає швидкість
  boost: { min: 2, max: 20, step: 0.5, def: 8.5, pref: 'orni:vBoost' },
  sweep: { min: 0, max: 60, step: 1, def: 27, pref: 'orni:sweep' }, // крила назад у прискоренні, °
  scanEvery: { min: 0.2, max: 3, step: 0.05, def: 1, pref: 'orni:scanEvery' }, // імпульс сканера — раз на стільки с
  scanSpeed: { min: 1, max: 15, step: 0.5, def: 9, pref: 'orni:scanSpeed' }, // з якою швидкістю хвиля йде вниз, од./с
  scanPower: { min: 0.2, max: 3, step: 0.1, def: 0.5, pref: 'orni:scanPower' }, // яскравість хвиль і кілець
  // ---- дрон ----
  dWake: { min: 0.5, max: 10, step: 0.1, def: 3.5, pref: 'drone:tWake' }, // пробудження: встає на ноги (у кліпі — 5 с)
  dSleep: { min: 0.5, max: 10, step: 0.1, def: 3, pref: 'drone:tSleep' }, // засинання: присідає й завмирає
  dTakeoff: { min: 0.8, max: 6, step: 0.1, def: 2.4, pref: 'drone:tTakeoff' }, // відрив: присідає, відштовхується, турбіни лягають (у кліпі — 3 с)
  dClimb: { min: 0.5, max: 8, step: 0.1, def: 2.6, pref: 'drone:tClimb' }, // набір висоти після поштовху
  dHover: { min: 0, max: 2, step: 0.05, def: 0.35, pref: 'drone:hover' }, // висота зависання понад ту, на яку піднімає сам кліп (≈1 од.)
  dBob: { min: 0, max: 0.3, step: 0.01, def: 0.07, pref: 'drone:bob' }, // погойдування вгору-вниз
  dBobRate: { min: 0.2, max: 3, step: 0.1, def: 1, pref: 'drone:bobRate' }, // його темп
  dLegs: { min: 0, max: 25, step: 1, def: 7, pref: 'drone:legs' }, // ноги в повітрі погойдуються, °
  dRotorIdle: { min: 0, max: 6, step: 0.1, def: 1, pref: 'drone:rotorIdle' }, // оберти лопатей, коли стоїть, об/с (у кліпі ≈ 1)
  dRotorFly: { min: 1, max: 12, step: 0.1, def: 4.7, pref: 'drone:rotorFly' }, // оберти в повітрі, об/с (у кліпі ≈ 4,7)
  dSpin: { min: 0.2, max: 5, step: 0.1, def: 1.4, pref: 'drone:tSpin' }, // за скільки лопаті розкручуються чи зупиняються
  dGlow: { min: 0, max: 8, step: 0.1, def: 2.5, pref: 'drone:glow' }, // світіння ока й вогнів
  dLook: { min: 0, max: 35, step: 1, def: 14, pref: 'drone:look' }, // на скільки око роззирається, °
  dLookEvery: { min: 0.5, max: 8, step: 0.1, def: 2.4, pref: 'drone:lookEvery' }, // як часто переводить погляд, с
  dPatrol: { min: 0.5, max: 8, step: 0.1, def: 3, pref: 'drone:vPatrol' }, // швидкість патрулювання
  dTilt: { min: 0, max: 30, step: 1, def: 12, pref: 'drone:tilt' }, // нахил уперед у патрулі, °
  dPatrolTime: { min: 0.3, max: 5, step: 0.1, def: 1.6, pref: 'drone:tPatrol' }, // розгін і гальмування патруля
  dLand: { min: 0.8, max: 8, step: 0.1, def: 2.8, pref: 'drone:tLand' }, // спуск до піску
  dTouch: { min: 0.5, max: 6, step: 0.1, def: 1.8, pref: 'drone:tTouch' }, // стає на ноги (у кліпі — 3 с)
  sandR: { min: 6, max: 30, step: 1, def: 30, pref: 'orni:sandR' }, // дальність піску: радіус латки, за яким вона тане у фон
  duneH: { min: 0, max: 2, step: 0.05, def: 0.8, pref: 'orni:duneH' }, // висота дюн
  ripple: { min: 0, max: 2, step: 0.1, def: 1, pref: 'orni:ripple' }, // вітрова брижа на піску
  // пил з-під крил: загальне
  dust: { min: 0, max: 2, step: 0.1, def: 1, pref: 'orni:dust' }, // сила: множник кількості (0 — пилу немає)
  dustReach: { min: 0.5, max: 5, step: 0.1, def: 2.2, pref: 'orni:dustReach' }, // з якої висоти над піском крила його здіймають
  dustRadius: { min: 0.3, max: 3, step: 0.1, def: 1, pref: 'orni:dustRadius' }, // наскільки широко навколо орні
  // хмари пилу
  cloudRate: { min: 0, max: 400, step: 10, def: 170, pref: 'orni:cloudRate' }, // скільки за секунду
  cloudAlpha: { min: 0.02, max: 0.6, step: 0.01, def: 0.26, pref: 'orni:cloudAlpha' }, // щільність
  cloudSize: { min: 0.1, max: 2.5, step: 0.05, def: 0.65, pref: 'orni:cloudSize' }, // розмір при народженні
  cloudGrow: { min: 0, max: 3, step: 0.1, def: 0.7, pref: 'orni:cloudGrow' }, // як швидко розпливаються
  cloudLife: { min: 0.3, max: 6, step: 0.1, def: 2, pref: 'orni:cloudLife' }, // скільки живуть, с
  cloudRise: { min: 0, max: 1.5, step: 0.05, def: 0.15, pref: 'orni:cloudRise' }, // як швидко здіймаються
  cloudSpread: { min: 0.2, max: 5, step: 0.1, def: 1.7, pref: 'orni:cloudSpread' }, // як швидко стеляться вбік
  // піщинки
  grainRate: { min: 0, max: 1500, step: 25, def: 600, pref: 'orni:grainRate' }, // скільки за секунду
  grainSize: { min: 0.005, max: 0.12, step: 0.005, def: 0.035, pref: 'orni:grainSize' }, // розмір
  grainSpeed: { min: 0.5, max: 8, step: 0.1, def: 3, pref: 'orni:grainSpeed' }, // швидкість розльоту вбік
  grainHeight: { min: 0, max: 5, step: 0.1, def: 1.7, pref: 'orni:grainHeight' }, // наскільки високо злітають (швидкість угору)
  grainLife: { min: 0.2, max: 3, step: 0.1, def: 1.1, pref: 'orni:grainLife' }, // скільки живуть, с
} as const
type FlightKey = keyof typeof FLY
/** у прискоренні ніс опускається ще на стільки, рад */
const BOOST_PITCH = 0.07
/**
 * Змішування для світла (промінь сканера, смуги від крил): колір додаємо до того, що вже є, а прозорість
 * полотна підіймаємо до яскравості світла. Полотно прозоре; якщо прозорість не чіпати, браузер відкидає
 * світло там, де за ним порожній фон, — промінь і смуги ніби обрізало туманом по краю піску
 */
const GLOW = {
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
} as const
/** скільки триває рух уперед на зльоті чи гальмування на посадці: увесь час мінус вертикальна частина */
const moveOf = (total: number, turn: number) => Math.max(0.3, total - Math.min(turn, total - 0.3))
/** на посадці ніс трохи задирається, поки орні гальмує, рад */
const FLARE = 0.05

/**
 * Висота піску в точці (x, z) простору дюн, відносно рівня, де стоїть орні. Бархани — скошені хвилі з
 * гострими гребенями поперек напрямку польоту (гребені — вздовж Z), друга система під кутом, дрібна
 * брижа. Та сама формула — у шейдері піску (DUNE_GLSL): так орні знає, куди сідати і де пісок під носом.
 */
/** висота дюн — з повзунка (кадр оновлює її і для коду, і для шейдера) */
let duneAmp = 0.8
/**
 * профіль бархана: пологий навітряний схил, гострий гребінь, крутий підвітряний; западина між барханами —
 * заокруглена (м'який мінімум), а не кут: інакше на ній видно різку пряму лінію світла
 */
const duneProfile = (u: number) => {
  const s = u / (Math.PI * 2) - Math.floor(u / (Math.PI * 2))
  const v = s < 0.72 ? 1 - (1 - s / 0.72) ** 2 : (1 - (s - 0.72) / 0.28) ** 1.4
  return Math.sqrt(v * v + 0.0036) - 0.06
}
function duneH(x: number, z: number) {
  const a = duneProfile(x * 0.95 + z * 0.3 + 1.1 * Math.sin(z * 0.35 + x * 0.08))
  const b = duneProfile(x * 0.5 - z * 0.62 + 0.8 * Math.sin(x * 0.27))
  const c = Math.sin(x * 1.3 + z * 0.9) * Math.sin(z * 1.1 - x * 0.4)
  return duneAmp * (0.7 * a + 0.3 * b - 0.35) + 0.03 * c
}
/**
 * GLTFLoader дає кожній частині скінованої моделі власний скелет — ті самі кістки, окрема копія. Тоді щокадру
 * для кожної частини заново рахуються всі кістки й окремо вантажиться у відеокарту їхня текстура: в орні — 71 раз.
 * На комп'ютері цього не видно, а на iPhone (Safari) це ~9 мс із 12 на кадр. Частини з тими самими кістками й
 * матрицями прив'язки отримують один спільний скелет — одне оновлення й одне завантаження на кадр. Повертає,
 * скільки скелетів лишилось
 */
function shareSkeletons(root: THREE.Object3D) {
  const kept: THREE.Skeleton[] = []
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    const sk = mesh.skeleton
    const same = kept.find((k) => k.bones.length === sk.bones.length && k.bones.every((b, i) => b === sk.bones[i]) && k.boneInverses.every((m, i) => m.equals(sk.boneInverses[i])))
    if (!same) return void kept.push(sk)
    sk.dispose()
    mesh.skeleton = same // матриця прив'язки (bindMatrix) — своя в кожної частини, вона лишається
  })
  return kept.length
}

const DUNE_GLSL = `
uniform float uAmp;
float duneProfile(float u) {
  float s = fract(u / 6.2831853);
  float v = s < 0.72 ? 1.0 - pow(1.0 - s / 0.72, 2.0) : pow(max(0.0, 1.0 - (s - 0.72) / 0.28), 1.4);
  return sqrt(v * v + 0.0036) - 0.06;
}
float duneH(vec2 p) {
  float a = duneProfile(p.x * 0.95 + p.y * 0.3 + 1.1 * sin(p.y * 0.35 + p.x * 0.08));
  float b = duneProfile(p.x * 0.5 - p.y * 0.62 + 0.8 * sin(p.x * 0.27));
  float c = sin(p.x * 1.3 + p.y * 0.9) * sin(p.y * 1.1 - p.x * 0.4);
  return uAmp * (0.7 * a + 0.3 * b - 0.35) + 0.03 * c;
}
// профіль бархана і його похідна по u (для нахилу без зайвих обчислень висоти)
vec2 duneProfileD(float u) {
  float s = fract(u / 6.2831853);
  float v, dv;
  if (s < 0.72) { float t = 1.0 - s / 0.72; v = 1.0 - t * t; dv = 2.0 * t / 0.72; }
  else { float t = max(0.0, 1.0 - (s - 0.72) / 0.28); v = pow(t, 1.4); dv = -1.4 * pow(t, 0.4) / 0.28; }
  float r = sqrt(v * v + 0.0036);
  return vec2(r - 0.06, v / r * dv / 6.2831853);
}
// висота і нахил (dh/dx, dh/dz) однією формулою — та сама поверхня, що duneH
vec3 duneHG(vec2 p) {
  float sa = p.y * 0.35 + p.x * 0.08;
  float ua = p.x * 0.95 + p.y * 0.3 + 1.1 * sin(sa);
  vec2 A = duneProfileD(ua);
  float ca = 1.1 * cos(sa);
  float ub = p.x * 0.5 - p.y * 0.62 + 0.8 * sin(p.x * 0.27);
  vec2 B = duneProfileD(ub);
  float c1 = p.x * 1.3 + p.y * 0.9;
  float c2 = p.y * 1.1 - p.x * 0.4;
  float s1 = sin(c1), k1 = cos(c1), s2 = sin(c2), k2 = cos(c2);
  float h = uAmp * (0.7 * A.x + 0.3 * B.x - 0.35) + 0.03 * s1 * s2;
  float hx = uAmp * (0.7 * A.y * (0.95 + ca * 0.08) + 0.3 * B.y * (0.5 + 0.216 * cos(p.x * 0.27))) + 0.03 * (1.3 * k1 * s2 - 0.4 * s1 * k2);
  float hz = uAmp * (0.7 * A.y * (0.3 + ca * 0.35) + 0.3 * B.y * -0.62) + 0.03 * (0.9 * k1 * s2 + 1.1 * s1 * k2);
  return vec3(h, hx, hz);
}
`

interface Api {
  scan: (on: boolean) => void
  play: (i: number) => void
  takeoff: () => void
  land: () => void
  toggle: (g: 'wings' | 'gear' | 'ramp') => void
  glide: (on: boolean) => void
  boost: (on: boolean) => void
  /** двигун на землі: завести (крила махають, орні стоїть) чи заглушити */
  ignite: (on: boolean) => void
  /** куди показувати сцену: у повноекранне вікно налаштувань чи (null) назад на сторінку — полотно одне */
  host: (target: HTMLElement | null) => void
  /** дрон: прокинутися (встає на ноги, турбіни розкручуються) чи заснути (присідає, око гасне) */
  wake: (on: boolean) => void
  /** дрон: патрулювати (нахиляється й летить над дюнами) чи зависнути на місці */
  patrol: (on: boolean) => void
  /** дрон: кліп моделі цілком (25 с), на місці */
  demo: () => void
  /** замір швидкості на пристрої (поруч із лічильником FPS): почати, а коли готовий — сховати результат */
  bench: () => void
}

type WingPhase = 'folded' | 'opening' | 'open' | 'closing' | 'flying' | 'settling'
/** що зараз відбувається само (ручне керування заблоковане): зліт, посадка; у дрона ще пробудження, сон, кліп цілком */
type Seq = 'takeoff' | 'landing' | 'wake' | 'sleep' | 'demo' | null

/**
 * Криві для кожної дії (на вибір у панелі). «Без зайвих змахів» — лише для змахів: розкручування без стрибка,
 * від темпу моделі, але різко вгору (повільні змахи — частки секунди); зупинка тримає темп, гальмує до ×4 і з цим
 * же темпом спокійно стає в позу. Кадри не пропускаються — лише прискорюються. «Плавно на початку й наприкінці»
 * від темпу моделі (змах ≈ 2,5 с) натомість дає кілька повільних змахів на початку й наприкінці
 */
const EASE: Record<string, (x: number) => number> = {
  brisk: (x) => 1 - (1 - x) ** 3,
  smooth: (x) => x * x * (3 - 2 * x),
  smoother: (x) => x * x * x * (x * (x * 6 - 15) + 10),
  sine: (x) => 0.5 - 0.5 * Math.cos(Math.PI * x),
  linear: (x) => x,
  out: (x) => 1 - (1 - x) ** 3,
  in: (x) => x ** 3,
}
const MOVE_EASES: [string, string][] = [
  ['smoother', t('Дуже плавно')],
  ['smooth', t('Плавно на початку й наприкінці')],
  ['sine', t('Синусоїда')],
  ['linear', t('Рівномірно')],
  ['out', t('Швидко на початку, м’яко наприкінці')],
  ['in', t('М’яко на початку, швидко наприкінці')],
]
const FLAP_EASES: [string, string][] = [['brisk', t('Без зайвих змахів')], ...MOVE_EASES]
/** яка крива в якої дії (змахи — свої, з «Без зайвих змахів») */
const EZ = {
  eSpin: { def: 'smoother', pref: 'orni:eSpin', flaps: true },
  eTakeoff: { def: 'in', pref: 'orni:eTakeoff', flaps: false },
  eMove: { def: 'smoother', pref: 'orni:eMove', flaps: false },
  eLand: { def: 'smoother', pref: 'orni:eLand', flaps: false },
  eSlow: { def: 'brisk', pref: 'orni:eSlow', flaps: true },
  eGlideStop: { def: 'brisk', pref: 'orni:eGlideStop', flaps: true },
  eGlideSpin: { def: 'brisk', pref: 'orni:eGlideSpin', flaps: true },
  eBoost: { def: 'out', pref: 'orni:eBoost', flaps: false },
} as const
type EaseKey = keyof typeof EZ
/** площа під (1 − крива) від 0 до q — скільки дюн пропливе за гальмування (для точки посадки) */
const coast = (e: (x: number) => number, q: number) => {
  const n = 48
  let a = 0
  for (let i = 0; i < n; i++) {
    const u0 = (q * i) / n
    const u1 = (q * (i + 1)) / n
    a += ((2 - e(u0) - e(u1)) / 2) * (u1 - u0)
  }
  return a
}

const sec = (v: number) => t('{n} с', { n: v.toFixed(1) })
const num = (v: number) => v.toFixed(1)
/** пункт розділу: повзунок (ключ, назва, формат, крива дії, підпис кривої), перемикач вигляду дюн чи підзаголовок */
type Item = [FlightKey, string, (v: number) => string, EaseKey?, string?] | 'dunes' | 'fps' | 'model' | 'quality' | { h: string }
/** розділи налаштувань — у порядку польоту: що бачимо, зліт, політ, планування, прискорення, посадка, сканер */
const SECTIONS: { id: string; title: string; only?: ModelKey; items: Item[] }[] = [
  {
    id: 'scene',
    title: t('Сцена'),
    items: [
      'model',
      'quality',
      'dunes',
      'fps',
      ['duneH', t('Висота дюн'), (v) => `×${(v / 0.8).toFixed(2)}`],
      ['ripple', t('Брижа на піску'), (v) => (v ? `×${v.toFixed(1)}` : t('немає'))],
      ['sandR', t('Дальність піску'), (v) => `${v}`],
      ['drop', t('Відступ від дюн у польоті'), num],
    ],
  },
  {
    id: 'dust',
    title: t('Пил'),
    items: [
      ['dust', t('Сила'), (v) => (v ? `×${v.toFixed(1)}` : t('вимкнено'))],
      ['dustReach', t('З якої висоти здіймається'), num],
      ['dustRadius', t('Радіус'), (v) => `×${v.toFixed(1)}`],
      { h: t('Хмари') },
      ['cloudRate', t('Кількість, за секунду'), (v) => `${v}`],
      ['cloudAlpha', t('Щільність'), (v) => v.toFixed(2)],
      ['cloudSize', t('Розмір'), (v) => v.toFixed(2)],
      ['cloudGrow', t('Розпливання'), num],
      ['cloudLife', t('Тривалість'), sec],
      ['cloudRise', t('Підйом'), (v) => v.toFixed(2)],
      ['cloudSpread', t('Розлітання вбік'), num],
      { h: t('Піщинки') },
      ['grainRate', t('Кількість, за секунду'), (v) => `${v}`],
      ['grainSize', t('Розмір'), (v) => v.toFixed(3)],
      ['grainSpeed', t('Розліт убік'), num],
      ['grainHeight', t('Висота розльоту'), num],
      ['grainLife', t('Тривалість'), sec],
    ],
  },
  {
    id: 'takeoff',
    only: 'orni',
    title: t('Зліт'),
    items: [
      ['unfold', t('Розкладання крил'), sec],
      ['spin', t('Розкручування крил'), sec, 'eSpin'],
      ['throttle', t('Оберти двигуна на землі'), (v) => `${Math.round(v * 100)}%`],
      ['takeoff', t('Підйом'), sec, 'eTakeoff', t('Крива підйому')],
      ['turn', t('Вертикально, перш ніж рушити'), sec],
    ],
  },
  {
    id: 'flight',
    only: 'orni',
    title: t('Політ'),
    items: [
      ['flap', t('Швидкість змахів'), (v) => `×${v}`],
      ['amp', t('Амплітуда змахів'), (v) => `±${v}°`],
      ['baseUp', t('Рівень верхніх крил'), (v) => `${v > 0 ? '+' : ''}${v}°`],
      ['baseLow', t('Рівень нижніх крил'), (v) => `${v > 0 ? '+' : ''}${v}°`],
      ['cruise', t('Швидкість польоту'), num, 'eMove', t('Розгін і гальмування')],
    ],
  },
  {
    id: 'glide',
    only: 'orni',
    title: t('Планування'),
    items: [
      ['glideStop', t('Зупинка крил'), sec, 'eGlideStop'],
      ['glideSpin', t('Розкручування крил назад'), sec, 'eGlideSpin'],
      ['glide', t('Швидкість планування'), num],
    ],
  },
  {
    id: 'boost',
    only: 'orni',
    title: t('Прискорення'),
    items: [
      ['boostTime', t('Час прискорення'), sec, 'eBoost'],
      ['boost', t('Швидкість прискорення'), num],
      ['sweep', t('Крила назад'), (v) => `${v}°`],
    ],
  },
  {
    id: 'landing',
    only: 'orni',
    title: t('Посадка'),
    items: [
      ['land', t('Спуск'), sec, 'eLand', t('Крива спуску')],
      ['turnDown', t('Вертикально наприкінці'), sec],
      ['slow', t('Зупинка крил'), sec, 'eSlow'],
      ['fold', t('Складання крил'), sec],
    ],
  },
  {
    id: 'dWake',
    only: 'drone',
    title: t('Пробудження й сон'),
    items: [
      ['dWake', t('Пробудження'), sec],
      ['dSleep', t('Засинання'), sec],
    ],
  },
  {
    id: 'dFly',
    only: 'drone',
    title: t('Зліт і зависання'),
    items: [
      ['dTakeoff', t('Відрив від піску'), sec],
      ['dClimb', t('Набір висоти'), sec, 'eTakeoff', t('Крива підйому')],
      ['dHover', t('Висота зависання'), num],
      ['dBob', t('Погойдування'), (v) => (v ? v.toFixed(2) : t('немає'))],
      ['dBobRate', t('Темп погойдування'), (v) => `×${v.toFixed(1)}`],
      ['dLegs', t('Ноги в повітрі'), (v) => (v ? `±${v}°` : t('нерухомі'))],
    ],
  },
  {
    id: 'dRotor',
    only: 'drone',
    title: t('Турбіни'),
    items: [
      ['dRotorIdle', t('Оберти, коли стоїть'), (v) => t('{n} об/с', { n: v.toFixed(1) })],
      ['dRotorFly', t('Оберти в повітрі'), (v) => t('{n} об/с', { n: v.toFixed(1) })],
      ['dSpin', t('Розкручування й зупинка'), sec],
    ],
  },
  {
    id: 'dEye',
    only: 'drone',
    title: t('Око'),
    items: [
      ['dGlow', t('Світіння ока й вогнів'), (v) => (v ? `×${v.toFixed(1)}` : t('вимкнено'))],
      ['dLook', t('Роззирається'), (v) => (v ? `±${v}°` : t('ні'))],
      ['dLookEvery', t('Переводить погляд кожні'), sec],
    ],
  },
  {
    id: 'dPatrol',
    only: 'drone',
    title: t('Патрулювання'),
    items: [
      ['dPatrol', t('Швидкість'), num, 'eMove', t('Розгін і гальмування')],
      ['dPatrolTime', t('Час розгону й гальмування'), sec],
      ['dTilt', t('Нахил уперед'), (v) => `${v}°`],
    ],
  },
  {
    id: 'dLanding',
    only: 'drone',
    title: t('Посадка'),
    items: [
      ['dLand', t('Спуск'), sec, 'eLand', t('Крива спуску')],
      ['dTouch', t('Стає на ноги'), sec],
    ],
  },
  {
    id: 'scan',
    title: t('Сканер'),
    items: [
      ['scanEvery', t('Інтервал імпульсів'), (v) => t('{n} мс', { n: Math.round(v * 1000) })],
      ['scanSpeed', t('Швидкість хвилі'), num],
      ['scanPower', t('Інтенсивність'), (v) => `×${v.toFixed(1)}`],
    ],
  },
]
const DUNES = [['sand', t('Пісок')], ['lines', t('Смуги')], ['none', t('Нічого')]] as const
type DunesStyle = (typeof DUNES)[number][0]

/**
 * Дії в один рядок: скільки влазить — у рядку, решта — в меню «⋯» (з кінця списку). Ширину кнопок міряємо
 * невидимою копією рядка, тож підписи, що змінюються («Злетіти» ↔ «Сісти»), враховуються одразу
 */
function ActionBar({ items }: { items: { key: string; el: ReactElement }[] }) {
  const row = useRef<HTMLDivElement>(null)
  const meas = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(items.length)
  const [menu, setMenu] = useState(false)
  useLayoutEffect(() => {
    const GAP = 8
    const MORE = 36 // кнопка «⋯»
    const calc = () => {
      const w = row.current?.clientWidth ?? 0
      const widths = [...(meas.current?.children ?? [])].map((k) => (k as HTMLElement).offsetWidth)
      const all = widths.reduce((x, k, i) => x + k + (i ? GAP : 0), 0)
      if (all <= w) return setFit(widths.length)
      let used = 0
      let n = 0
      for (const k of widths) {
        const next = used + (n ? GAP : 0) + k
        if (next + GAP + MORE > w) break
        used = next
        n++
      }
      setFit(Math.max(1, n))
    }
    calc()
    const ro = new ResizeObserver(calc)
    if (row.current) ro.observe(row.current)
    if (meas.current) ro.observe(meas.current)
    return () => ro.disconnect()
  }, [items.length])
  // меню закривається кліком повз нього й Escape (Escape не закриває заразом вікно налаштувань)
  useEffect(() => {
    if (!menu) return
    const away = (e: PointerEvent) => { if (!row.current?.contains(e.target as Node)) setMenu(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(false) } }
    document.addEventListener('pointerdown', away)
    addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', away); removeEventListener('keydown', key, true) }
  }, [menu])
  const shown = items.slice(0, fit)
  const rest = items.slice(fit)
  useEffect(() => { if (!rest.length) setMenu(false) }, [rest.length])
  return (
    <div ref={row} className="relative flex w-full min-w-0 flex-nowrap justify-center gap-2">
      {/* невидима копія — лише для мірок; обгортка нульової висоти обрізає її, щоб сторінка не прокручувалась убік */}
      <div aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
        <div ref={meas} className="flex w-max gap-2">
          {items.map((i) => <Fragment key={i.key}>{i.el}</Fragment>)}
        </div>
      </div>
      {shown.map((i) => <Fragment key={i.key}>{i.el}</Fragment>)}
      {rest.length > 0 && (
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label={t('Ще дії')}
            aria-expanded={menu}
            aria-haspopup="menu"
            onClick={() => setMenu(!menu)}
            className={cn('grid h-9 w-9 place-items-center rounded-lg border transition-colors', menu ? 'border-[rgb(238_147_64/0.7)] bg-[rgb(238_147_64/0.15)] text-[rgb(255_200_150)]' : 'border-[rgb(235_220_196/0.25)] text-[rgb(235_220_196)] hover:bg-[rgb(235_220_196/0.08)]')}
          >
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <div
              role="menu"
              onClick={() => setMenu(false)}
              className="absolute bottom-full right-0 z-10 mb-2 grid min-w-[13rem] gap-1 rounded-xl border border-[rgb(235_220_196/0.2)] bg-[rgb(24_17_12/0.97)] p-1.5 shadow-2xl backdrop-blur-md [&>button]:w-full [&>button]:justify-start"
            >
              {rest.map((i) => <Fragment key={i.key}>{i.el}</Fragment>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Slider({ label, value, min, max, step, fmt, onChange, curve }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  fmt: (v: number) => string
  onChange: (v: number) => void
  /** крива цієї дії — список під повзунком */
  curve?: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }
}) {
  return (
    <div className="grid content-start gap-1 text-[12.5px] text-[rgb(235_220_196/0.7)]">
      <label className="grid gap-1">
        <span className="flex justify-between gap-2">
          {label} <span className="shrink-0 whitespace-nowrap font-mono text-[rgb(255_200_150)]">{fmt(value)}</span>
        </span>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[rgb(238_147_64)]" />
      </label>
      {curve && (
        <select
          value={curve.value}
          onChange={(e) => curve.onChange(e.target.value)}
          aria-label={`${curve.label}: ${label}`}
          title={curve.label}
          className="h-7 w-full min-w-0 rounded-md border border-[rgb(235_220_196/0.2)] bg-[rgb(20_14_10/0.6)] px-1.5 text-[12px] text-[rgb(235_220_196/0.85)]"
        >
          {curve.options.map(([v, l]) => (
            <option key={v} value={v}>{curve.label === t('Крива') ? l : `${curve.label}: ${l.toLowerCase()}`}</option>
          ))}
        </select>
      )}
    </div>
  )
}

export function Orni3D({ scan, onMissing, aside, start = true }: {
  scan: ScanLine[]
  onMissing?: () => void
  aside?: ReactNode | ((model: ModelKey) => ReactNode)
  /** false — сцену ще не будувати (модель важка: завантаження й шейдери на телефоні на секунду-дві займають сторінку) */
  start?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)
  const [scanning, setScanning] = useState(false)
  const [ready, setReady] = useState(false)
  const [anims, setAnims] = useState(0)
  const [airborne, setAirborne] = useState(false)
  /** орні набрав висоту — лише тоді працює сканер */
  const [aloft, setAloft] = useState(false)
  /** йде зліт чи посадка — ручне керування крилами, опорами, рампою й анімаціями заблоковане */
  const [seq, setSeqState] = useState<Seq>(null)
  /** режим стерв'ятника: двигун вимкнено, орні планує */
  const [gliding, setGliding] = useState(false)
  /** прискорення в плануванні */
  const [boosting, setBoosting] = useState(false)
  /** двигун заведено на землі */
  const [idling, setIdling] = useState(false)
  const [state, setState] = useState({ wings: false, gear: false, ramp: false })
  /** яка модель на сцені (пам'ятається): орнітоптер чи дрон — сцена будується наново */
  const [model, setModelState] = useState<ModelKey>(() => (prefGet<string>('scene:model', 'orni') === 'drone' ? 'drone' : 'orni'))
  const setModel = (v: ModelKey) => { setModelState(v); prefSet('scene:model', v) }
  const [quality, setQualityState] = useState<Quality>(() => {
    const q = prefGet<string>('scene:quality', 'auto')
    return QUALITY.some(([k]) => k === q) ? (q as Quality) : 'auto'
  })
  const setQuality = (v: Quality) => {
    if (v === 'auto') autoDown = null // «Авто» знову — пробує з рівня за пристроєм
    setQualityState(v)
    prefSet('scene:quality', v)
  }
  /** з яким рівнем зараз малює сцена (для «Авто» — що воно вибрало) */
  const [tierNow, setTierNow] = useState<Tier>('high')
  /** легка модель орні — за рівнем, з яким сцена стартує (пониження на ходу модель не міняє — сцена не перезапускається) */
  const lite = model === 'orni' && TIERS[quality === 'auto' ? autoTier() : quality].lite
  /** дрон прокинувся (стоїть на ногах чи в повітрі) */
  const [awake, setAwake] = useState(false)
  /** дрон патрулює: летить над дюнами */
  const [patrolling, setPatrolling] = useState(false)
  /** налаштування — вікно на весь екран: ліворуч сцена (та сама, перенесена зі сторінки), праворуч панель */
  const [full, setFull] = useState(false)
  const fullBox = useRef<HTMLDivElement>(null)
  const fullRef = useRef(full)
  fullRef.current = full
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false) }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [full])
  // полотно — у вікно до першого кадру вікна, назад — щойно воно закривається
  useLayoutEffect(() => {
    if (!full || !fullBox.current) return
    api.current?.host(fullBox.current)
    return () => api.current?.host(null)
  }, [full])
  /** вигляд дюн: рельєфний пісок чи лінії по рельєфу */
  const [dunes, setDunes] = useState<DunesStyle>(() => prefGet<DunesStyle>('orni:dunes', 'sand'))
  /** лічильник FPS поверх сцени (вмикається в налаштуваннях, пам'ятається) — текст пише сам кадр, без React */
  const [showFps, setShowFps] = useState(() => prefGet('orni:fps', false))
  const fpsEl = useRef<HTMLSpanElement>(null)
  /** замір швидкості: ще не було, іде, результат на екрані */
  const [bench, setBench] = useState<'idle' | 'running' | 'done'>('idle')
  /** який розділ налаштувань розгорнутий — лише один за раз (пам'ятаємо між відкриттями) */
  const [openSec, setOpenSec] = useState<string | null>(() => prefGet<string | null>('orni:sec', 'scene'))
  /**
   * Клік по заголовку розділу: перемикаємо самі, а не браузер — інакше він відкриває новий розділ одразу,
   * а старий згортається лише кадром пізніше, і на мить видно обидва
   */
  const pickSec = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setOpenSec((x) => {
      const next = x === id ? null : id
      prefSet('orni:sec', next)
      return next
    })
  }
  const [fl, setFl] = useState(() => Object.fromEntries((Object.keys(FLY) as FlightKey[]).map((k) => [k, prefGet(FLY[k].pref, FLY[k].def)])) as Record<FlightKey, number>)
  const setFlight = (k: FlightKey, v: number) => { setFl((x) => ({ ...x, [k]: v })); prefSet(FLY[k].pref, v) }
  const [ez, setEz] = useState(() => Object.fromEntries((Object.keys(EZ) as EaseKey[]).map((k) => [k, prefGet<string>(EZ[k].pref, EZ[k].def)])) as Record<EaseKey, string>)
  const setEase = (k: EaseKey, v: string) => { setEz((x) => ({ ...x, [k]: v })); prefSet(EZ[k].pref, v) }
  const resetFlight = () => {
    for (const k of Object.keys(FLY) as FlightKey[]) setFlight(k, FLY[k].def)
    for (const k of Object.keys(EZ) as EaseKey[]) setEase(k, EZ[k].def)
  }
  // повзунки й криві читаються в кожному кадрі — через ref, щоб не перезбирати сцену
  const tune = useRef({ dunes, fl, ez, showFps, quality })
  tune.current = { dunes, fl, ez, showFps, quality }

  useEffect(() => {
    const el = box.current
    if (!el || !start) return
    let renderer: THREE.WebGLRenderer
    /** рівень якості, з яким малюємо (див. TIERS); «Авто» може знизити його на ходу */
    let tier: Tier = tune.current.quality === 'auto' ? (autoDown ?? autoTier()) : tune.current.quality
    let qualityNow = tune.current.quality
    let dustK = TIERS[tier].dust
    /** намалювати наступний кадр, навіть якщо в сцені нічого не зрушило (розмір полотна, роздільність, шейдер) */
    let dirty = true
    try {
      // згладжування країв (MSAA): на щільному екрані комп'ютера його майже не видно, а на великому полотні коштує
      // воно чимало; на телефоні полотно маленьке, а їхні відеокарти рахують згладжування в пам'яті плитки — майже
      // задарма, і без нього краї орні й дюн «драбинками». Потужну відеокарту (у ноутбуків із двома — окрему,
      // гарячу) просимо лише на високій якості
      renderer = new THREE.WebGLRenderer({ antialias: (devicePixelRatio || 1) < 1.5 || isPhone(), alpha: true, powerPreference: tier === 'high' ? 'high-performance' : 'default' })
    } catch {
      onMissing?.()
      return
    }
    // система забрала контекст (iOS у фоні, збій драйвера): three.js сам його відновлює — лишається перемалювати кадр
    const onRestored = () => { dirty = true }
    renderer.domElement.addEventListener('webglcontextrestored', onRestored)
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const isDrone = model === 'drone'
    // інша модель — сцена будується наново, пульт — з чистого стану
    setReady(false)
    setAnims(0)
    setAirborne(false)
    setAloft(false)
    setScanning(false)
    setSeqState(null)
    setGliding(false)
    setBoosting(false)
    setIdling(false)
    setState({ wings: false, gear: false, ramp: false })
    setAwake(false)
    setPatrolling(false)
    setTierNow(tier)
    /**
     * Роздільність підлаштовується під швидкість: якщо дві секунди поспіль кадрів менше, ніж треба, — знижуємо
     * щільність пікселів (не нижче 1 на щільних екранах, 0,75 — на звичайних), якщо чотири секунди поспіль кадрів
     * досить — повертаємо (не вище екранної і стелі рівня якості)
     */
    let DPR_MAX = Math.min(devicePixelRatio || 1, TIERS[tier].dpr)
    let DPR_MIN = Math.min(DPR_MAX, dprFloor())
    let dpr = DPR_MAX
    renderer.setPixelRatio(dpr)
    renderer.setClearColor(0x000000, 0)
    renderer.outputEncoding = THREE.sRGBEncoding
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.physicallyCorrectLights = true
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // відблиски на металі — від «кімнати», а не від порожнечі
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200)
    camera.position.set(-7.4, 3.4, 7.8)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableZoom = false
    controls.enablePan = false
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minPolarAngle = Math.PI * 0.2
    controls.maxPolarAngle = Math.PI * 0.47 // не під пісок
    controls.rotateSpeed = 0.6
    controls.target.set(0, -0.2, 0)

    const hemi = new THREE.HemisphereLight(0xffe6c4, 0x1a120c, 0.8)
    scene.add(hemi)
    const key = new THREE.DirectionalLight(0xffe2b8, 2.6)
    key.position.set(5, 8, 6)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xff9a45, 3)
    rim.position.set(-6, 3, -7)
    scene.add(rim)

    const orni = new THREE.Group()
    scene.add(orni)
    const lift = new THREE.Group() // висота польоту — окремо від погойдування
    orni.add(lift)
    const pitch = new THREE.Group() // нахил носа (ніс — у −X, тож додатний поворот навколо Z опускає ніс)
    lift.add(pitch)

    // ---------- сканер ----------
    // імпульси-кола: раз на scanEvery с з-під носа вниз опускається пласке коло й розширюється. Кожне живе своїм
    // життям: у мить дотику до піску запам'ятовує точку й радіус і далі розходиться по дюнах звідти (кільце малює
    // шейдер піску), за ним проступає сітка рельєфу. Кола незалежні — ідуть одне за одним, хоч як часто
    const WAVES = 16
    const ringGeo = new THREE.PlaneGeometry(2, 2)
    ringGeo.rotateX(-Math.PI / 2)
    const rings = Array.from({ length: WAVES }, () => {
      const m = new THREE.Mesh(
        ringGeo,
        new THREE.ShaderMaterial({
          uniforms: { uR: { value: 1 }, uS: { value: 1 }, uA: { value: 0 } },
          ...GLOW,
          vertexShader: `varying vec2 vP;
            void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          // тонке яскраве коло з ореолом і ледь помітним заповненням; uR — радіус, uS — розмір площини (обидва в од.)
          fragmentShader: `uniform float uR; uniform float uS; uniform float uA; varying vec2 vP;
            void main() {
              float d = length(vP) * uS;
              float x = (d - uR);
              float a = exp(-x * x / 0.0022) + 0.35 * exp(-x * x / 0.03) + 0.07 * (1.0 - smoothstep(uR - 0.05, uR, d));
              a *= uA;
              gl_FragColor = vec4(vec3(0.47, 0.77, 1.0) * a, min(a, 1.0));
            }`,
        }),
      )
      m.visible = false
      m.renderOrder = 1
      scene.add(m)
      return m
    })

    // ---------- дюни ----------
    // площина в просторі сцени (не орні: вона не гойдається з ним), висоту й нормаль дає шейдер за duneH;
    // зсув uScroll — наскільки дюни відпливли назад (+X), бо орні летить носом у −X
    const sandU = {
      uScroll: { value: 0 },
      uRings: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, // кільця сканера на піску: x, z, радіус, яскравість
      uShadow: { value: new THREE.Vector4(0, 0, 1.6, 0) }, // x, z, розмір і густина тіні орні
      uShadowK: { value: 1.9 }, // наскільки тінь витягнута вздовж корпусу (дрон — майже кругла)
      uRadius: { value: 10 },
      uRes: { value: new THREE.Vector2(1, 1) }, // розмір полотна в пікселях: пісок тане до його країв
      uStyle: { value: 0 }, // 0 — пісок, 1 — смуги, 2 — нічого (рівна невидима земля, видно лише сканер)
      uAmp: { value: 0.8 }, // висота дюн
      uRipple: { value: 1 }, // брижа
      uRingN: { value: 0 }, // скільки кілець сканера зараз на піску (решту не перебираємо)
      // світло сцени — те саме, що на орні: пісок рахує його сам (дешевше за фізичний матеріал з відблисками)
      uSky: { value: hemi.color.clone().multiplyScalar(hemi.intensity) },
      uGround: { value: hemi.groundColor.clone().multiplyScalar(hemi.intensity) },
      uKeyDir: { value: key.position.clone().normalize() },
      uKeyCol: { value: key.color.clone().multiplyScalar(key.intensity) },
      uRimDir: { value: rim.position.clone().normalize() },
      uRimCol: { value: rim.color.clone().multiplyScalar(rim.intensity) },
      uEnv: { value: 0.2 }, // замість розсіяного світла «кімнати» (на орні — карта оточення)
      uSpec: { value: 0.012 }, // і замість ледь помітного білого відблиску матового піску
      // шум піску — з текстури 256×256 (чотири незалежні канали), а не синусами в кожному пікселі; вдалині
      // зменшені копії текстури (mipmap) самі згладжують дрібниці
      uNoise: {
        value: (() => {
          const N = 256
          const d = new Uint8Array(N * N * 4)
          for (let i = 0; i < d.length; i++) d[i] = Math.floor(Math.random() * 256)
          const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat)
          t.wrapS = t.wrapT = THREE.RepeatWrapping
          t.magFilter = THREE.LinearFilter
          t.minFilter = THREE.LinearMipmapLinearFilter
          t.generateMipmaps = true
          t.needsUpdate = true
          return t
        })(),
      },
    }
    /**
     * Пісок — без фізичного матеріалу (MeshBasicMaterial): світло сцени (небо/земля, ключове, контрове й розсіяне)
     * рахуємо самі за тими ж формулами, що three.js для матового матеріалу, але без відблисків і карти оточення —
     * у кожному пікселі це в рази дешевше, а вигляд той самий. Рельєф, брижа, зерно — теж у пікселі
     */
    const sandMat = new THREE.MeshBasicMaterial({ color: 0x8a5d35, transparent: true })
    // що з дрібниць піску рахувати (рівень якості): зерно; брижу й плями у два шари
    const sandDefines = () => ({ SAND_GRAIN: TIERS[tier].grain ? 1 : 0, SAND_DETAIL: TIERS[tier].detail ? 1 : 0 })
    sandMat.defines = sandDefines()
    ;(sandMat as unknown as { extensions: { derivatives: boolean } }).extensions = { derivatives: true } // fwidth: чіткі лінії без мерехтіння
    sandMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, sandU)
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uScroll;\nuniform float uStyle;\nvarying vec2 vSand;\nvarying float vH;\nvarying vec2 vSp;\nvarying float vDist;\n${DUNE_GLSL}`)
        .replace(
          '#include <begin_vertex>',
          `vec2 sp = vec2(position.x - uScroll, position.z);
          float hk = uStyle > 1.5 ? 0.0 : 1.0; // «Нічого» — рівна земля
          vH = hk * duneH(sp);
          vec3 transformed = vec3(position.x, vH, position.z);
          vSand = position.xz;
          vSp = sp;`,
        )
        .replace('#include <project_vertex>', '#include <project_vertex>\nvDist = length(mvPosition.xyz);')
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec4 uRings[16];
          uniform float uRingN;
          uniform vec4 uShadow;
          uniform float uShadowK;
          uniform float uRadius;
          uniform vec2 uRes;
          uniform float uStyle;
          uniform float uRipple;
          uniform vec3 uSky;
          uniform vec3 uGround;
          uniform vec3 uKeyDir;
          uniform vec3 uKeyCol;
          uniform vec3 uRimDir;
          uniform vec3 uRimCol;
          uniform float uEnv;
          uniform float uSpec;
          uniform sampler2D uNoise;
          varying vec2 vSand;
          varying float vH;
          varying vec2 vSp;
          varying float vDist;
          ${DUNE_GLSL}
          // шум: випадкові значення в клітинках текстури, між ними — плавно (згладжена позиція всередині клітинки,
          // як у старого шуму на синусах), одна вибірка замість чотирьох синусів. Рівень зменшеної копії — за
          // справжньою зміною p, інакше на межах клітинок проступали б тонкі лінії
          vec4 sandNoise4(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 uv = (i + f * f * (3.0 - 2.0 * f) + 0.5) * (1.0 / 256.0);
          #if __VERSION__ >= 300
            return textureGrad(uNoise, uv, dFdx(p) * (1.0 / 256.0), dFdy(p) * (1.0 / 256.0));
          #else
            return texture2D(uNoise, uv);
          #endif
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // рельєф — у кожному пікселі (а не між вершинами сітки): гребені й схили чіткі, як сам орні
          float hkF = uStyle > 1.5 ? 0.0 : 1.0;
          vec3 hg = hkF * duneHG(vSp); // висота й нахил однією формулою
          float hP = hg.x;
          vec3 sandN = normalize(vec3(-hg.y, 1.0, -hg.z));
          float sandK = uStyle < 0.5 ? 1.0 : 0.0; // фактура — лише у вигляді «Пісок»
          // вітрова брижа — мікрорельєф (а не смуги кольору): дрібні хвилі поперек вітру, з пологим навітряним і
          // крутішим підвітряним боком, покручені шумом; ловить світло. На крутих підвітряних схилах її немає,
          // удалині (де хвиля дрібніша за піксель) — гасне; шум рахуємо лише там, де брижу видно
        #if SAND_DETAIL
          float ru0 = vSp.x * 16.0 + 2.2 * sin(vSp.y * 1.3 + vSp.x * 0.2);
          float rFade = (1.0 - smoothstep(0.45, 1.2, fwidth(ru0))) * smoothstep(0.8, 0.93, sandN.y) * uRipple * sandK;
          float rw = (sandNoise4(vSp * 0.55).b - 0.5) * 2.2 + (sandNoise4(vSp * 1.7 + 7.0).a - 0.5) * 0.6;
          float ru = ru0 + rw * 3.0;
          float rd = cos(ru + 0.6 * sin(ru)) * (1.0 + 0.6 * cos(ru)); // похідна профілю хвилі
          vec2 rg = rd * vec2(16.0, 2.2 * 1.3 * cos(vSp.y * 1.3 + vSp.x * 0.2)) * 0.0045 * rFade;
        #else
          vec2 rg = vec2(0.0); // «Еко»: без брижі
        #endif
          // дрібне зерно — теж рельєфом: легкий шум нормалі зблизька (лише на високій якості)
        #if SAND_GRAIN
          float gK = (1.0 - smoothstep(0.3, 0.9, fwidth(vSp.x * 70.0))) * sandK;
          float g0 = sandNoise4(vSp * 70.0).r;
          vec2 gg = vec2(sandNoise4(vSp * 70.0 + vec2(0.35, 0.0)).r - g0, sandNoise4(vSp * 70.0 + vec2(0.0, 0.35)).r - g0) * 0.13 * gK;
        #else
          float gK = 0.0;
          float g0 = 0.5;
          vec2 gg = vec2(0.0);
        #endif
          sandN = normalize(sandN + vec3(-rg.x - gg.x, 0.0, -rg.y - gg.y));
          vec2 sd = (vSand - uShadow.xy) / vec2(uShadow.z * uShadowK, uShadow.z); // тінь витягнута вздовж корпусу
          diffuseColor.rgb *= 1.0 - uShadow.w * exp(-dot(sd, sd));
          // низьке сонце збоку: освітлені й тіньові схили барханів (світло сцени надто високе для рельєфу)
          float lit = dot(sandN, normalize(vec3(0.62, 0.42, 0.66)));
          float shade = 0.2 + 0.95 * smoothstep(-0.15, 0.75, lit);
          // сітка рельєфу: лінії вздовж польоту (гребені видно профілем) і поперечні, що пливуть із дюнами.
          // Це вигляд «Смуги»; під сканером вона проступає в обох виглядах — інакше її не рахуємо
          float grid = 0.0;
          if (uStyle > 0.5 || uRingN > 0.5) {
            float lz = vSand.y * 2.6;
            float lx = vSp.x * 1.3;
            float dz = abs(fract(lz - 0.5) - 0.5) / fwidth(lz);
            float dx = abs(fract(lx - 0.5) - 0.5) / fwidth(lx);
            grid = max(1.0 - smoothstep(0.5, 1.5, dz), 0.5 * (1.0 - smoothstep(0.5, 1.5, dx)));
          }
          float line = 0.0;
          if (uStyle < 0.5) {
            // пісок не однотонний: великі плями світлішого й рудішого піску, гребені — світліші й жовтіші,
            // западини — рудіші; тіньові схили холодніші (небо), освітлені — теплі (сонце)
          #if SAND_DETAIL
            float blot = 0.65 * sandNoise4(vSp * 0.22).r + 0.35 * sandNoise4(vSp * 0.7 + 3.0).g;
          #else
            float blot = sandNoise4(vSp * 0.22).r;
          #endif
            vec3 albedo = diffuseColor.rgb * (0.86 + 0.28 * blot);
            float crest = smoothstep(-0.1, 0.35, hP / max(0.05, uAmp));
            albedo *= mix(vec3(0.92, 0.86, 0.82), vec3(1.07, 1.04, 0.97), crest);
            float sunK = smoothstep(-0.2, 0.8, lit);
            vec3 shadeC = mix(vec3(0.2, 0.19, 0.25), vec3(1.2, 1.12, 1.0), sunK);
            float speck = (g0 - 0.5) * gK; // окремі світліші й темніші піщинки
            diffuseColor.rgb = albedo * shadeC * (1.0 + 0.12 * speck);
          } else {
            line = grid;
            diffuseColor.rgb = mix(vec3(0.05, 0.034, 0.024), diffuseColor.rgb * shade * 1.6, line);
          }
          // світло сцени, як для матового матеріалу three.js: небо/земля + ключове + контрове + розсіяне, ÷ π
          vec3 irr = mix(uGround, uSky, 0.5 * sandN.y + 0.5)
            + uKeyCol * max(0.0, dot(sandN, uKeyDir))
            + uRimCol * max(0.0, dot(sandN, uRimDir))
            + vec3(uEnv);
          diffuseColor.rgb = diffuseColor.rgb * irr * RECIPROCAL_PI + vec3(uSpec) * hkF;
          // кільця сканера: кожне — коло, що опустилося з-під носа й розходиться від точки дотику; за кільцем
          // проступає сітка рельєфу й гасне разом із ним
          float glow = 0.0;
          float reveal = 0.0;
          for (int i = 0; i < 16; i++) {
            if (float(i) >= uRingN) break;
            vec4 R = uRings[i];
            if (R.w <= 0.0) continue;
            float sr = length(vSand - R.xy);
            float x = sr - R.z;
            glow += R.w * (exp(-x * x / 0.0022) + 0.35 * exp(-x * x / 0.03));
            reveal = max(reveal, R.w * smoothstep(R.z + 0.1, R.z - 0.7, sr));
          }
          glow += 0.9 * grid * min(reveal, 1.0);
          diffuseColor.rgb += vec3(0.47, 0.77, 1.0) * glow + vec3(0.85, 0.55, 0.28) * line * 0.12; // смуги ледь світяться
          // латка тане у фон: від центру і до країв полотна
          vec2 sc = (gl_FragCoord.xy / uRes - vec2(0.5, 0.42)) * vec2(1.0, 1.35);
          float vigA = (1.0 - smoothstep(uRadius * 0.55, uRadius, length(vSand))) * (1.0 - smoothstep(0.33, 0.52, length(sc)));
          diffuseColor.a *= vigA;`,
        )
        // «Нічого»: самого піску не видно — лише кола сканера й сітка, яку вони проявляють
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          if (uStyle > 1.5) gl_FragColor = vec4(0.62, 0.86, 1.0, min(glow, 1.0) * vigA);
          // далекі дюни тонуть у пиловій імлі пустелі — глибина сцени
          if (uStyle < 0.5) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.74, 0.58, 0.42), smoothstep(7.0, 30.0, vDist) * 0.5);`,
        )
    }
    // сітка піску — на всю дальність; вершини густіші біля орні (≈5 см) і рідшають до країв, де пісок тане:
    // u ∈ [−1, 1] → r·(a·|u| + (1 − a)·|u|^2,5). Світло й дрібниці малює шейдер у кожному пікселі
    const sand = new THREE.Mesh(new THREE.BufferGeometry(), sandMat)
    let sandR = 0
    let sandSeg = 0
    const buildSand = (r: number) => {
      const seg = TIERS[tier].seg
      sandSeg = seg
      const a = Math.min(1, (0.05 * seg) / (2 * r))
      const f = (u: number) => Math.sign(u) * r * (a * Math.abs(u) + (1 - a) * Math.abs(u) ** 2.5)
      const g = new THREE.PlaneGeometry(2, 2, seg, seg)
      const pos = g.attributes.position
      for (let i = 0; i < pos.count; i++) pos.setXY(i, f(pos.getX(i)), f(pos.getY(i)))
      g.rotateX(-Math.PI / 2)
      sand.geometry.dispose()
      sand.geometry = g
      sandU.uRadius.value = r
      sandR = r
    }
    buildSand(tune.current.fl.sandR)
    sand.frustumCulled = false
    sand.renderOrder = -1 // прозорий (краї тануть): малюємо раніше за промінь і смуги, інакше пісок їх перекрив би
    scene.add(sand)

    // ---------- пил з-під крил ----------
    // на зльоті й посадці, поки крила б'ють близько до піску, з-під орні розлітається пісок: піщинки віялом
    // в усі боки й угору (падають назад на дюни) і м'які хмарки пилу, що повільно розпливаються. Що ближче
    // до піску й що швидші змахи — то більше. Частинки — у повітрі над дюнами: відпливають разом із ними
    const DUST = 4000
    const dPos = new Float32Array(DUST * 3)
    const dVel = new Float32Array(DUST * 3)
    const dAge = new Float32Array(DUST).fill(9)
    const dLife = new Float32Array(DUST).fill(1)
    const dSize0 = new Float32Array(DUST)
    const dPeak = new Float32Array(DUST) // найбільша непрозорість: піщинки щільні, хмарки ледь видно
    const dBig = new Uint8Array(DUST)
    const dGrow = new Float32Array(DUST) // як швидко частинка ширшає
    const dAlpha = new Float32Array(DUST)
    const dSize = new Float32Array(DUST)
    const dTone = new Float32Array(DUST)
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3))
    dustGeo.setAttribute('aAlpha', new THREE.BufferAttribute(dAlpha, 1))
    dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dSize, 1))
    dustGeo.setAttribute('aTone', new THREE.BufferAttribute(dTone, 1))
    dustGeo.setAttribute('aBig', new THREE.BufferAttribute(dBig, 1)) // 0 чи 1 як є, без нормалізації до 1/255
    /**
     * Хмарка пилу — готова текстура 64×64 (гаусова пляма з легким шумом, що спадає до нуля на краях), а не шум,
     * який рахувався б у кожному пікселі кожної хмарки: хмарок сотні, і вони великі. Кожна хмарка повернута
     * по-своєму, тож однаковими вони не виглядають
     */
    const puffTex = (() => {
      const N = 64
      const G = 9
      const lat = Array.from({ length: G * G }, () => Math.random())
      const vn = (x: number, y: number) => {
        const xi = Math.floor(x), yi = Math.floor(y)
        const fx = x - xi, fy = y - yi
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
        const at = (i: number, j: number) => lat[(((j % G) + G) % G) * G + (((i % G) + G) % G)]
        return (at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx) * (1 - sy) + (at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx) * sy
      }
      const data = new Uint8Array(N * N * 4)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const u = (x + 0.5) / N - 0.5, v = (y + 0.5) / N - 0.5
          const r2 = (u * u + v * v) * 4
          const fall = Math.exp(-r2 * 3.2) * (1 - THREE.MathUtils.smoothstep(r2, 0.55, 1))
          const cloud = 0.55 + 0.45 * (0.6 * vn(u * 2.6 + 3, v * 2.6 + 3) + 0.4 * vn(u * 5.5 + 7, v * 5.5 + 1))
          const k = (y * N + x) * 4
          data[k] = data[k + 1] = data[k + 2] = 255
          data[k + 3] = Math.round(255 * fall * cloud)
        }
      const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat)
      t.magFilter = THREE.LinearFilter
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.generateMipmaps = true
      t.needsUpdate = true
      return t
    })()
    const dustU = { uScale: { value: 1000 }, uRes: sandU.uRes, uPuff: { value: puffTex } }
    /**
     * Два шари з однієї геометрії: піщинки — тверді темніші цятки; хмарки — м'який пил (текстура вище), що спадає
     * до нуля, тож сусідні зливаються в імлу. Спрайт має одну глибину на всю площу, тож хмарку,
     * що наполовину в піску, дюна різала б різкою лінією, — центр хмарки тримаємо над піском на її розмір
     * (кадр). Обидва шари тануть до країв кадру, як і пісок
     */
    const dustMat = (clouds: boolean) =>
      new THREE.ShaderMaterial({
        uniforms: dustU,
        transparent: true,
        depthWrite: false,

        vertexShader: `attribute float aAlpha; attribute float aSize; attribute float aTone; attribute float aBig; uniform float uScale;
          varying float vA; varying float vT; varying vec2 vRot;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vRot = vec2(cos(aTone * 6.2832), sin(aTone * 6.2832)); // поворот хмарки
            gl_Position = projectionMatrix * mv;
            // у кожному шарі — лише свої частинки
            bool mine = ${clouds ? 'aBig > 0.5' : 'aBig < 0.5'};
            gl_PointSize = mine ? aSize * uScale / max(0.1, -mv.z) : 0.0;
            vA = mine ? aAlpha : 0.0;
            vT = aTone;
          }`,
        fragmentShader: `uniform vec2 uRes; uniform sampler2D uPuff; varying float vA; varying float vT; varying vec2 vRot;
          void main() {
            vec2 pc = gl_PointCoord - 0.5;
            float r2 = dot(pc, pc) * 4.0; // 0 — центр, 1 — край спрайта
            float a;
            vec3 c;
            ${clouds
              ? `a = r2 < 1.0 ? texture2D(uPuff, vec2(pc.x * vRot.x - pc.y * vRot.y, pc.x * vRot.y + pc.y * vRot.x) + 0.5).a : 0.0;
            c = mix(vec3(0.84, 0.72, 0.55), vec3(0.95, 0.87, 0.72), vT);`
              : `a = 1.0 - smoothstep(0.35, 1.0, r2);
            c = mix(vec3(0.42, 0.3, 0.18), vec3(0.62, 0.47, 0.3), vT);`}
            vec2 sc = (gl_FragCoord.xy / uRes - vec2(0.5, 0.42)) * vec2(1.0, 1.35);
            a *= vA * (1.0 - smoothstep(0.33, 0.52, length(sc)));
            if (a < 0.003) discard;
            gl_FragColor = vec4(c, a);
          }`,
      })
    const dustGrains = new THREE.Points(dustGeo, dustMat(false))
    const dustClouds = new THREE.Points(dustGeo, dustMat(true))
    for (const [p, order] of [[dustGrains, 1], [dustClouds, 3]] as const) {
      p.frustumCulled = false
      p.renderOrder = order // хмарки — після піску, смуг і сканера
      p.visible = false
      scene.add(p)
    }
    let dustNext = 0 // яку частинку брати наступною (по колу)
    let dustAlive = 0 // скільки частинок жило минулого кадру — 0 і нових немає: пил не рахуємо зовсім
    let grainCarry = 0 // дробовий залишок «скільки народити» між кадрами: піщинок і хмарок
    let cloudCarry = 0
    let base = -2 // рівень піску, де стоїть орні (низ моделі з опорами)
    let scroll = 0
    let vel = 0
    let landFrom = -1 // посадка: коли почали гальмувати
    let landS0 = 0
    let landV0 = 0
    /** висота землі для коду (посадка, сканер, тінь): без піску («Нічого») — рівна */
    const terrainH = (x: number, z: number) => (tune.current.dunes === 'none' ? 0 : duneH(x, z))
    let padY = 0 // висота орні, коли він стоїть на піску
    let restDunes = '' // з яким виглядом і висотою дюн рахували, як стоїть: змінили на землі — стає наново
    let restRX = 0 // і нахил, щоб опори лягли на схил: вбік (навколо X) і вздовж (навколо Z)
    let restRZ = 0
    /**
     * Нижній контур орні: найнижча точка моделі (шасі випущене) в кожній клітинці сітки 16×7 під ним — у просторі
     * висоти, при нульовому нахилі. foot — опора (торкається землі), решта — днище, ніс, корма
     */
    let hull: { p: THREE.Vector3; foot: boolean }[] = []
    /**
     * Як орні стане на пісок, якщо дюни зсунуті на s: для кожного невеликого нахилу (уздовж до ±0,22 рад, убік до
     * ±0,16) висота — найменша, за якої жодна частина днища не нижче піску, а опори вгрузають щонайбільше на 3 см
     * (пісок м'який); з таких беремо нахил, за якого опори найменше висять над піском
     */
    const restAt = (s: number) => {
      let best = { lift: 0, rx: 0, rz: 0, score: Infinity }
      const e = new THREE.Euler()
      const v = new THREE.Vector3()
      const sink = tune.current.dunes === 'none' ? 0 : 0.03
      for (let rz = -0.22; rz <= 0.2201; rz += 0.02)
        for (let rx = -0.16; rx <= 0.1601; rx += 0.02) {
          e.set(rx, 0, rz)
          let lift = -Infinity
          let footLo = Infinity
          for (const h of hull) {
            v.copy(h.p).applyEuler(e)
            const need = base + terrainH(v.x - s, v.z) - v.y // на скільки підняти, щоб ця точка торкнулась піску
            lift = Math.max(lift, h.foot ? need - sink : need + 0.02)
            if (h.foot) footLo = Math.min(footLo, need)
          }
          const score = lift - footLo + 0.12 * (Math.abs(rx) + Math.abs(rz)) // як високо висить найвища опора; трохи — за сам нахил
          if (score < best.score) best = { lift, rx, rz, score }
        }
      return best
    }

    // ---------- смуги з кінчиків крил (планування) ----------
    // прямі промені назад (+X) від кінчиків лопатей: довжина — від швидкості, уздовж біжать штрихи-потоки.
    // Не слід кінчика: той повторював би кожен рух лопаті (змійки), а на великій швидкості летів би в камеру.
    // Дві стрічки навхрест (горизонтальна й вертикальна) — видно з будь-якого боку
    const SEG = 24
    /** кінчики лопатей: остання кістка лопаті, точка кінчика в її просторі і корінь лопаті */
    const tips: { bone: THREE.Object3D; off: THREE.Vector3; root: THREE.Object3D }[] = []
    const rootAt = new THREE.Vector3()
    const trailGeo = new THREE.BufferGeometry()
    // колір вершини — RGBA: прозорість дорівнює яскравості, тож смугу видно й над порожнім фоном
    const trailMat = new THREE.MeshBasicMaterial({ vertexColors: true, ...GLOW })
    const trail = new THREE.Mesh(trailGeo, trailMat)
    trail.frustumCulled = false
    trail.renderOrder = 2
    scene.add(trail)
    const setupTrails = () => {
      const n = tips.length * SEG * 4
      trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
      trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4), 4))
      const idx: number[] = []
      tips.forEach((_, k) => {
        for (let i = 0; i < SEG - 1; i++) {
          const a = (k * SEG + i) * 4
          const b = a + 4
          idx.push(a, a + 1, b, a + 1, b + 1, b, a + 2, a + 3, b + 2, a + 3, b + 3, b + 2)
        }
      })
      trailGeo.setIndex(idx)
    }
    const tv = new THREE.Vector3()
    const updateTrails = (t: number, glow: number) => {
      const pos = trailGeo.getAttribute('position') as THREE.BufferAttribute | undefined
      trail.visible = glow > 0.002
      if (!pos || !trail.visible) return
      const col = trailGeo.getAttribute('color') as THREE.BufferAttribute
      const len = Math.min(3.2, 0.45 + vel * 0.32) // що швидше, то довші
      tips.forEach((tip, k) => {
        tip.bone.updateWorldMatrix(true, false)
        tv.copy(tip.off).applyMatrix4(tip.bone.matrixWorld)
        // лише лопаті, що дивляться вбік чи назад: промінь із лопаті, витягнутої вперед, ліг би вздовж неї й корпусу
        rootAt.setFromMatrixPosition(tip.root.matrixWorld)
        const behind = Math.max(0, Math.min(1, tv.x - rootAt.x + 1.5))
        for (let i = 0; i < SEG; i++) {
          const q = i / (SEG - 1)
          const x = tv.x + len * q
          const w = 0.02 * (1 - q * 0.5)
          const a = (k * SEG + i) * 4
          pos.setXYZ(a, x, tv.y, tv.z + w)
          pos.setXYZ(a + 1, x, tv.y, tv.z - w)
          pos.setXYZ(a + 2, x, tv.y + w, tv.z)
          pos.setXYZ(a + 3, x, tv.y - w, tv.z)
          const flow = 0.55 + 0.45 * Math.sin((len * q - t * vel) * 5 + k * 1.7) // штрихи біжать назад зі швидкістю повітря
          const c = glow * behind * (1 - q) ** 1.5 * Math.min(1, i / 2) * flow
          for (let v = 0; v < 4; v++) col.setXYZW(a + v, c * 0.95, c * 0.9, c * 0.82, c)
        }
      })
      pos.needsUpdate = true
      col.needsUpdate = true
    }
    const nose = new THREE.Vector3()
    let mixer: THREE.AnimationMixer | null = null
    let actions: THREE.AnimationAction[] = []
    let beat: THREE.AnimationAction | null = null
    let targetLift = 0
    // висота — плавною кривою (розгін і гальмування), а не «одразу на повній швидкості»
    let liftFrom = 0
    let liftAt = 0
    let liftDur = 1
    let liftEase = EASE.smoother
    const flyTo = (to: number, dur: number, ease = 'smoother') => {
      liftEase = EASE[ease] ?? EASE.smoother
      liftFrom = lift.position.y
      targetLift = to
      liftAt = clock.getElapsedTime()
      liftDur = dur
    }
    let flying = false
    // нахил носа — так само плавною кривою; швидкість дюн іде тією самою кривою: орні рушає вперед,
    // коли нахиляється, і гальмує, коли вирівнюється
    let pitchNow = 0
    let pitchFrom = 0
    let pitchTo = 0
    let pitchAt = 0
    let pitchDur = 1
    let velFrom = 0
    // пісок опускається (орні наче вище над дюнами), коли орні рушає вперед, і повертається, коли зупиняється, —
    // тією ж кривою, що нахил і швидкість
    let dropMix = 0
    let dropFrom = 0
    /** режим швидкості: стоїмо, політ, планування, прискорення — саму швидкість дають повзунки */
    let pace: 'stop' | 'cruise' | 'glide' | 'boost' | 'patrol' = 'stop'
    const paceSpeed = () => (pace === 'stop' ? 0 : pace === 'patrol' ? tune.current.fl.dPatrol : tune.current.fl[pace])
    let pitchEase = EASE.smoother
    const tilt = (to: number, dur: number, p: typeof pace = pace, ease = 'smoother') => {
      pitchEase = EASE[ease] ?? EASE.smoother
      pitchFrom = pitchNow
      pitchTo = to
      pitchAt = clock.getElapsedTime()
      pitchDur = dur
      velFrom = vel
      dropFrom = dropMix
      pace = p
    }

    /** промінь сканера: з-під носа (з урахуванням нахилу) прямовисно до піску під ним; кільця — на дюнах */
    /** радіус кола біля носа і на скільки воно ширшає на кожну одиницю шляху — униз і далі по піску */
    const RING_R0 = 0.12
    const RING_SPREAD = 0.42
    /** на піску кільце розходиться щонайменше так швидко (од./с) і гасне за GROUND_LIFE с — навіть коли хвиля повільна */
    const GROUND_SPEED = 1.8
    const GROUND_LIFE = 1.6
    /**
     * Хвиля сканера: народилась під носом (born, x, z, y0), опускається; у мить дотику до піску (landed)
     * запам'ятовує точку в просторі дюн (tx — відпливає разом із ними) і радіус r0
     */
    interface Wave { born: number; x: number; z: number; y0: number; landed: number; tx: number; r0: number }
    const waves: Wave[] = []
    let nextWave = 0
    /** пил з-під крил щокадру: скільки народити (від близькості до піску й темпу змахів), рух, згасання */
    const updateDust = (dt: number) => {
      const f = tune.current.fl
      const amount = f.dust
      let power = 0
      // що здіймає пил: у дрона — турбіни на польотних обертах, в орні — змахи
      const flapK = isDrone
        ? THREE.MathUtils.clamp((rotor - f.dRotorIdle) / Math.max(0.1, f.dRotorFly - f.dRotorIdle), 0, 1)
        : beat && phase === 'flying' ? Math.min(1, Math.abs(beat.timeScale) / Math.max(1, f.flap)) : 0
      if (amount > 0 && !reduce && tune.current.dunes !== 'none' && flapK > 0) {
        // наскільки низ орні над піском під серединою корпусу
        const clear = base + lift.position.y + orni.position.y - (sand.position.y + terrainH(orni.position.x - scroll, 0))
        power = flapK * (1 - THREE.MathUtils.smoothstep(clear, 0.15, Math.max(0.2, f.dustReach)))
      }
      if (power <= 0 && dustAlive === 0) {
        grainCarry = cloudCarry = 0
        dustGrains.visible = dustClouds.visible = false
        return
      }
      grainCarry += power * amount * f.grainRate * dt * dustK // менше пилу на нижчій якості
      cloudCarry += power * amount * f.cloudRate * dt * dustK
      const grains = Math.floor(grainCarry)
      const clouds = Math.floor(cloudCarry)
      grainCarry -= grains
      cloudCarry -= clouds
      const rnd = (v: number) => v * (0.7 + Math.random() * 0.6) // ±30% навколо значення з повзунка
      const total = Math.min(grains + clouds, DUST / 4) // не більше чверті запасу за кадр
      for (let k = 0; k < total; k++) {
        const i = dustNext
        dustNext = (dustNext + 1) % DUST
        const big = k >= Math.min(grains, total)
        const ang = Math.random() * Math.PI * 2
        const ca = Math.cos(ang)
        const sa = Math.sin(ang)
        const r = (0.4 + Math.random() * 2.6) * f.dustRadius
        const x = orni.position.x + ca * r * (isDrone ? 1 : 1.3) // уздовж корпусу орні — ширше
        const z = sa * r
        dPos[i * 3] = x
        dPos[i * 3 + 1] = sand.position.y + terrainH(x - scroll, z) + 0.03
        dPos[i * 3 + 2] = z
        // хмарки стеляться по піску вбік (низхідний потік від крил) і повільно здіймаються; піщинки — віялом угору
        const sp = rnd(big ? f.cloudSpread : f.grainSpeed) * (0.6 + 0.4 * power)
        dVel[i * 3] = ca * sp
        dVel[i * 3 + 1] = rnd(big ? f.cloudRise : f.grainHeight)
        dVel[i * 3 + 2] = sa * sp
        dAge[i] = 0
        dLife[i] = rnd(big ? f.cloudLife : f.grainLife)
        dSize0[i] = rnd(big ? f.cloudSize : f.grainSize)
        dSize[i] = dSize0[i]
        dGrow[i] = big ? f.cloudGrow : 0.2
        if (big) dPos[i * 3 + 1] += dSize0[i] * 0.45 // хмарка — одразу над піском
        dPeak[i] = big ? Math.min(1, rnd(f.cloudAlpha)) : 0.75 + Math.random() * 0.25
        dBig[i] = big ? 1 : 0
        dTone[i] = Math.random()
      }
      let live = false
      dustAlive = 0
      for (let i = 0; i < DUST; i++) {
        if (dAge[i] >= dLife[i]) { dAlpha[i] = 0; continue }
        live = true
        dustAlive++
        const age = (dAge[i] += dt)
        const big = dBig[i] === 1
        const drag = Math.exp(-(big ? 1.2 : 0.9) * dt)
        dVel[i * 3] *= drag
        dVel[i * 3 + 2] *= drag
        dVel[i * 3 + 1] = dVel[i * 3 + 1] * drag - (big ? 0.02 : 3) * dt
        dPos[i * 3] += (dVel[i * 3] + vel) * dt // і відпливає разом із дюнами
        dPos[i * 3 + 1] += dVel[i * 3 + 1] * dt
        dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt
        if (big) {
          // хмарка котиться над дюною: центр не нижче за половину її розміру над піском — інакше пісок зріже спрайт
          const g = sand.position.y + terrainH(dPos[i * 3] - scroll, dPos[i * 3 + 2]) + dSize[i] * 0.45
          if (dPos[i * 3 + 1] < g) { dPos[i * 3 + 1] = g; if (dVel[i * 3 + 1] < 0) dVel[i * 3 + 1] = 0 }
        } else if (dVel[i * 3 + 1] < 0) {
          // піщинка впала на дюну — лежить і гасне
          const g = sand.position.y + terrainH(dPos[i * 3] - scroll, dPos[i * 3 + 2])
          if (dPos[i * 3 + 1] < g) { dPos[i * 3 + 1] = g; dVel[i * 3] *= 0.3; dVel[i * 3 + 1] = 0; dVel[i * 3 + 2] *= 0.3 }
        }
        const q = age / dLife[i]
        dAlpha[i] = dPeak[i] * Math.min(1, age / (big ? 0.3 : 0.06)) * (1 - q * q)
        dSize[i] = dSize0[i] * (1 + age * dGrow[i])
      }
      dustGrains.visible = dustClouds.visible = live
      if (!live) return
      dustGeo.attributes.position.needsUpdate = true
      dustGeo.attributes.aAlpha.needsUpdate = true
      dustGeo.attributes.aSize.needsUpdate = true
      dustGeo.attributes.aTone.needsUpdate = true
      dustGeo.attributes.aBig.needsUpdate = true
      // розмір у пікселях кадру: висота полотна і кут камери (з наближенням)
      dustU.uScale.value = (renderer.domElement.height * camera.zoom) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    }

    /** сканер щокадру: нові хвилі раз на інтервал, кола в повітрі й кільця на піску */
    const updateScan = (fade: number, t: number) => {
      const { scanEvery, scanSpeed, scanPower } = tune.current.fl
      if (fade <= 0) waves.length = 0
      else if (scanOn) {
        // ніс у світі (з нахилом) — звідси стартує нова хвиля
        const c = Math.cos(pitchNow), s = Math.sin(pitchNow)
        const nx = nose.x * c - nose.y * s + orni.position.x
        const ny = nose.x * s + nose.y * c + lift.position.y + orni.position.y
        if (t - nextWave > 1) nextWave = t // після паузи (блок був поза екраном) — без зливи хвиль
        while (t >= nextWave) {
          waves.push({ born: nextWave, x: nx, z: nose.z, y0: ny, landed: -1, tx: 0, r0: 0 })
          nextWave += scanEvery
        }
      }
      const a = fade * scanPower * 1.3
      const gs = Math.max(GROUND_SPEED, scanSpeed * RING_SPREAD)
      // стан: опускається → торкнулась піску → розходиться → згасла
      for (let i = 0; i < waves.length; i++) {
        const w = waves[i]
        if (w.landed < 0) {
          const d = (t - w.born) * scanSpeed
          if (w.y0 - d <= sand.position.y + terrainH(w.x - scroll, w.z)) { w.landed = t; w.tx = w.x - scroll; w.r0 = RING_R0 + d * RING_SPREAD }
        } else if (t - w.landed > GROUND_LIFE) waves.splice(i--, 1)
      }
      if (waves.length > 48) waves.splice(0, waves.length - 48)
      // показ: найновіші — першими
      let air = 0
      let ground = 0
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i]
        if (w.landed < 0) {
          if (air >= rings.length) continue
          const d = (t - w.born) * scanSpeed
          const r = RING_R0 + d * RING_SPREAD
          const S = r + 0.45
          const m = rings[air++]
          m.visible = true
          m.position.set(w.x, w.y0 - d, w.z)
          m.scale.setScalar(S)
          const u = (m.material as THREE.ShaderMaterial).uniforms
          u.uR.value = r
          u.uS.value = S
          u.uA.value = a * Math.min(1, d / 0.15)
        } else if (ground < sandU.uRings.value.length) {
          const age = t - w.landed
          const life = 1 - Math.max(0, Math.min(1, (age / GROUND_LIFE - 0.45) / 0.55)) // яскраве, тоді гасне
          sandU.uRings.value[ground++].set(w.tx + scroll, w.z, w.r0 + age * gs, a * life)
        }
      }
      for (let k = air; k < rings.length; k++) rings[k].visible = false
      for (let k = ground; k < sandU.uRings.value.length; k++) sandU.uRings.value[k].w = 0
      sandU.uRingN.value = ground
    }

    /**
     * Межі моделі: у скінованих мешів геометрія лежить у «сирому» просторі, а форму дає скелет,
     * тож Box3.setFromObject бреше — рахуємо по вершинах після скіна (кожна n-на вистачає).
     */
    const boxOf = (o: THREE.Object3D) => {
      o.updateMatrixWorld(true)
      const bb = new THREE.Box3()
      const v = new THREE.Vector3()
      o.traverse((x) => {
        const mesh = x as THREE.SkinnedMesh
        if (!mesh.isMesh) return
        if (!mesh.isSkinnedMesh) return void bb.expandByObject(mesh)
        mesh.skeleton.update()
        const pos = mesh.geometry.attributes.position
        const step = Math.max(1, Math.floor(pos.count / 600))
        for (let i = 0; i < pos.count; i += step) bb.expandByPoint(mesh.boneTransform(i, v).applyMatrix4(mesh.matrixWorld))
      })
      return bb
    }

    // нижній контур: найнижча вершина в кожній клітинці сітки 16×7 під моделлю (шасі чи ноги випущені);
    // клітинки, де низ — на рівні опор, — опори, решта — днище, ніс, корма
    const computeHull = (m: THREE.Object3D, bb: THREE.Box3) => {
      const NX = 16
      const NZ = 7
      const low = new Array<THREE.Vector3 | null>(NX * NZ).fill(null)
      const v = new THREE.Vector3()
      m.traverse((o) => {
        const mesh = o as THREE.SkinnedMesh
        if (!mesh.isMesh) return
        const pos = mesh.geometry.attributes.position
        const step = Math.max(1, Math.floor(pos.count / 20000))
        for (let i = 0; i < pos.count; i += step) {
          if (mesh.isSkinnedMesh) mesh.boneTransform(i, v)
          else v.fromBufferAttribute(pos, i)
          v.applyMatrix4(mesh.matrixWorld)
          const cx = Math.min(NX - 1, Math.floor(((v.x - bb.min.x) / (bb.max.x - bb.min.x)) * NX))
          const cz = Math.min(NZ - 1, Math.floor(((v.z - bb.min.z) / (bb.max.z - bb.min.z)) * NZ))
          const k = cz * NX + cx
          if (!low[k] || v.y < low[k]!.y) low[k] = v.clone()
        }
      })
      hull = low.filter((p): p is THREE.Vector3 => !!p).map((p) => ({ p, foot: p.y < base + 0.12 }))
    }

    // ---------- завантаження моделі ----------
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    let disposed = false
    loader.load(
      isDrone ? DRONE_URL : lite ? MODEL_LITE_URL : MODEL_URL,
      (gltf) => {
        if (disposed) return
        if (isDrone) return setupDrone(gltf)
        const m = gltf.scene
        pitch.add(m)
        shareSkeletons(m)
        const size = boxOf(m).getSize(new THREE.Vector3())
        m.scale.multiplyScalar(6.2 / Math.max(size.x, size.y, size.z)) // із запасом: розкриті крила вдвічі довші за корпус
        m.position.sub(boxOf(m).getCenter(new THREE.Vector3()))
        m.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.frustumCulled = false
          ;(mesh.material as THREE.MeshStandardMaterial).envMapIntensity = 0.9
        })

        // доріжки: у кожному кліпі моделі є значення для всіх кісток. Кліпи крил лишаємо лише з
        // кістками крил (разом із нерухомими — вони тримають розкриту позу), решті — лише те, що
        // рухається; інакше опори скидали б крила в початкову позу, а крила — опори
        const moving = (t: THREE.KeyframeTrack) => {
          const n = t.getValueSize(), v = t.values
          for (let i = n; i < v.length; i++) if (Math.abs(v[i] - v[i % n]) > 1e-4) return true
          return false
        }
        const isWing = (t: THREE.KeyframeTrack) => /^Ala/.test(t.name)
        for (const clip of gltf.animations) clip.tracks = clip.tracks.some((t) => isWing(t) && moving(t)) ? clip.tracks.filter(isWing) : clip.tracks.filter(moving)
        mixer = new THREE.AnimationMixer(m)
        const once = (a: THREE.AnimationAction) => {
          a.setLoop(THREE.LoopOnce, 1)
          a.clampWhenFinished = true
          return a
        }
        actions = gltf.animations.map((clip) => once(mixer!.clipAction(clip)))
        const src = gltf.animations[FLIGHT]
        // розкрита поза на час польоту — значення кожної кістки крила в кліпі в момент BEAT_FROM (ключі в моделі
        // рідкі й у різних кісток у різні моменти: вирізка кадрів дала б лише частину кісток, а решта скинулась би)
        if (src)
          beat = mixer.clipAction(
            new THREE.AnimationClip('beat', 1, src.tracks.map((tr) => {
              const v = Array.from((tr as unknown as { createInterpolant: () => THREE.Interpolant }).createInterpolant().evaluate(BEAT_FROM) as ArrayLike<number>)
              const Track = tr.constructor as new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack
              return new Track(tr.name, [0, 1], [...v, ...v])
            })),
          )
        mixer.addEventListener('finished', onFinished)
        setAnims(actions.length)

        // ніс у цієї моделі — у −X (кабіна ліворуч у кадрі): сканер — під ним
        const bb = boxOf(m)
        const cz = (bb.min.z + bb.max.z) / 2
        nose.set(bb.min.x + (bb.max.x - bb.min.x) * 0.12, bb.min.y + 0.4, cz)
        // пісок — під опорами
        base = bb.min.y
        sand.position.y = base
        computeHull(m, bb)
        // кінчики лопатей: кістки «…_end_…» стоять не на самому кінці, тож беремо найдальшу вершину лопаті,
        // що висить на останній кістці (батьку «_end_»), і запам'ятовуємо її в просторі цієї кістки
        const last: THREE.Object3D[] = []
        m.traverse((o) => { if (/^Ala_.*_end_/.test(o.name) && o.parent) last.push(o.parent) })
        const far = last.map(() => ({ d: -1, p: new THREE.Vector3() }))
        const joint = new THREE.Vector3()
        const vtx = new THREE.Vector3()
        m.traverse((o) => {
          const mesh = o as THREE.SkinnedMesh
          if (!mesh.isSkinnedMesh) return
          const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight
          const which = last.map((b) => mesh.skeleton.bones.indexOf(b as THREE.Bone))
          for (let i = 0; i < si.count; i++) {
            const w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)]
            const j = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)][w.indexOf(Math.max(...w))]
            const k = which.indexOf(j)
            if (k < 0) continue
            mesh.boneTransform(i, vtx).applyMatrix4(mesh.matrixWorld)
            const d = vtx.distanceTo(joint.setFromMatrixPosition(last[k].matrixWorld))
            if (d > far[k].d) { far[k].d = d; far[k].p.copy(vtx) }
          }
        })
        last.forEach((b, k) => {
          if (far[k].d > 0) tips.push({ bone: b, off: far[k].p.clone().applyMatrix4(new THREE.Matrix4().copy(b.matrixWorld).invert()), root: b.parent?.parent ?? b })
        })
        setupTrails()
        // кульові шарніри лопатей. Сам шарнір — купол моделі (кістка x.1) з кріпленням і лопаттю; без опори він виглядав
        // приліпленим, тож довкола нього — гніздо-«дзвін», що стоїть на плиті під втулкою (і має її фарбу). Купол
        // зменшено навколо його центру так, що весь уміщається в кулю, меншу за отвір губи гнізда; махи, відведення в
        // прискоренні й складання крил повертають купол разом із кріпленням навколо цього центру — він крутиться на
        // місці, як куля, і на жодному кадрі не зачіпає гнізда.
        // Змахи — вгору-вниз навколо осі корпусу, прискорення — назад навколо його вертикалі. Бік (R/L) — з назви,
        // а в який бік світу дивиться R — з положення кореня бічної лопаті; поворот навколо осі +X корпусу піднімає
        // лопать, що дивиться в −Z
        const zR = new THREE.Vector3()
        m.traverse((o) => { if (/^Ala_lateral_11_R_/.test(o.name)) zR.setFromMatrixPosition(o.matrixWorld) })
        const sR = zR.z >= 0 ? 1 : -1
        type Pt = { p: THREE.Vector3; uv: THREE.Vector2 | null; mat: THREE.Material }
        const hubs: { o: THREE.Object3D; mount: THREE.Object3D; side: string; dome: Pt[]; arm: THREE.Vector3[] }[] = []
        m.traverse((o) => {
          const x = /^Ala_(lateral|Up)_[12]1_([RL])_\d+$/.exec(o.name)
          const mount = x && o.children.find((c) => /^Ala_(lateral|Up)_[12]2_/.test(c.name))
          if (x && mount) hubs.push({ o, mount, side: x[2], dome: [], arm: [] })
        })
        // усе — у розкритій позі (її тримає кліп польоту), потім кістки повертаються в початкову
        beat?.play()
        mixer.update(0)
        m.updateMatrixWorld(true)
        const plate: Pt[] = [] // плита під втулками: матеріал крил, але висить на корпусі
        const domeMeshes: THREE.SkinnedMesh[] = []
        const domeFit: { bone: THREE.Object3D; c: THREE.Vector3; s: number }[] = [] // центр купола (світ) і зменшення
        m.traverse((o) => {
          const mesh = o as THREE.SkinnedMesh
          if (!mesh.isSkinnedMesh) return
          const g = mesh.geometry
          const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, uv = g.attributes.uv
          const bones = mesh.skeleton.bones
          const domeK = hubs.map((h) => bones.indexOf(h.o as THREE.Bone))
          const armK = hubs.map((h) => bones.indexOf(h.mount as THREE.Bone))
          const mat = mesh.material as THREE.Material
          const isPlate = mat.name === 'Alas'
          let inDome = 0
          for (let i = 0; i < si.count; i++) {
            const w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)]
            const j = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)][w.indexOf(Math.max(...w))]
            const d = domeK.indexOf(j)
            const r = armK.indexOf(j)
            if (d < 0 && r < 0 && !(isPlate && !/^Ala/.test(bones[j]?.name ?? ''))) continue
            const p = mesh.boneTransform(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
            const t = uv ? new THREE.Vector2(uv.getX(i), uv.getY(i)) : null
            if (d >= 0) { hubs[d].dome.push({ p, uv: t, mat }); inDome++ }
            else if (r >= 0) hubs[r].arm.push(p)
            else plate.push({ p, uv: t, mat })
          }
          if (inDome > si.count * 0.9) domeMeshes.push(mesh) // купол моделі — зменшимо, коли знатимемо його центр
        })
        const near = (P: Pt[], q: THREE.Vector3) => P.reduce<Pt | null>((b, x) => (!b || x.p.distanceToSquared(q) < b.p.distanceToSquared(q) ? x : b), null)
        /** матеріал моделі без скінінгу й карти нормалей, з текстури — лише маленька латка навколо uv0 */
        const patch = (pt: Pt | null, geo: THREE.BufferGeometry, fallback: THREE.Color) => {
          const src = pt?.mat as THREE.MeshStandardMaterial | undefined
          const mat = src ? src.clone() : new THREE.MeshStandardMaterial({ color: fallback, metalness: 0.6, roughness: 0.5 })
          ;(mat as unknown as { skinning: boolean }).skinning = false
          mat.normalMap = null
          mat.side = THREE.DoubleSide
          const uv = geo.attributes.uv
          if (pt?.uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, pt.uv.x + (uv.getX(i) - 0.5) * 0.02, pt.uv.y + (uv.getY(i) - 0.5) * 0.02)
          return mat
        }
        const Y = new THREE.Vector3(0, 1, 0)
        for (const h of hubs) {
          if (h.dome.length < 20 || !h.o.parent) continue
          // центр і радіус купола: спершу куля за всіма вершинами, тоді — лише за зовнішньою оболонкою
          const all = fitSphere(h.dome.map((x) => x.p))
          const shellPts = h.dome.filter((x) => x.p.distanceTo(all.c) > all.r).map((x) => x.p)
          const sph = shellPts.length > 20 ? fitSphere(shellPts) : all
          const c = sph.c
          const k = sph.r
          const armC = h.arm.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(Math.max(1, h.arm.length))
          const axisW = armC.sub(c).normalize() // з кулі назовні — куди дивиться кріплення
          // гніздо-«дзвін» стоїть на поверхні під втулкою: вісь — нормаль цієї поверхні (площина кільця-основи моделі,
          // де стояв купол), нахилена до кріплення лише настільки, щоб між кріпленням і віссю лишалося ≤ 35°: тоді
          // кріплення не зачіпає губу ні в змахах (до ±20°) із відведенням, ні під час складання. Губа обіймає кулю над
          // її екватором; дно подовжене на нахил, щоб гніздо всім низом заходило в поверхню. Профіль — радіус і висота
          // вздовж осі, у радіусах купола
          const ring = plate.filter((x) => x.p.distanceTo(c) < 1.6 * k).map((x) => x.p)
          const n = ring.length > 30 ? planeNormal(ring, axisW) : axisW.clone()
          const alpha = n.angleTo(axisW)
          const tilt = Math.max(0, alpha - THREE.MathUtils.degToRad(35))
          const axis = n.clone().lerp(axisW, alpha > 1e-6 ? tilt / alpha : 0).normalize()
          const yBot = -(0.8 + 1.4 * Math.tan(n.angleTo(axis)))
          const prof: [number, number][] = [[0, yBot], [1.3, yBot], [1.3, -0.62], [1.2, -0.46], [1.1, -0.26], [1.06, 0.0], [1.02, 0.12], [0.95, 0.18], [0.86, 0.17], [0.8, 0.11], [0.79, -0.05]]
          const housingGeo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * k, y * k)), 48)
          const housingMat = patch(near(plate, c.clone().addScaledVector(axis, -0.35 * k)), housingGeo, new THREE.Color(0x6f675c))
          const parts: [THREE.Mesh, THREE.Vector3, THREE.Vector3][] = [[new THREE.Mesh(housingGeo, housingMat), c, axis]]
          // купол — у кулю радіуса 0,76k (губа гнізда — 0,79k): найдальша його точка від центру
          const far = Math.max(...h.dome.map((x) => x.p.distanceTo(c)))
          domeFit.push({ bone: h.o, c: c.clone(), s: Math.min(1, (0.76 * k) / far) })
          // кільце-основа моделі ширше за низ гнізда й трохи зсунуте — де воно виходить за край, накриваємо його
          // низькою кришкою врівень із поверхнею, у тій самій фарбі
          if (ring.length > 30) {
            const B = ring.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(ring.length)
            const outside = Math.max(...ring.map((p) => { const d = p.clone().sub(c); return d.addScaledVector(axis, -d.dot(axis)).length() }))
            if (outside > 1.27 * k) {
              const hr = ring.map((p) => { const d = p.clone().sub(B); const y = d.dot(n); return { y, r: d.addScaledVector(n, -y).length() } })
              const rs = hr.map((x) => x.r).sort((x, y) => x - y)
              const ys = hr.map((x) => x.y).sort((x, y) => x - y)
              const rC = (rs[Math.floor(rs.length * 0.92)] ?? k) + 0.06 * k
              const top = (ys[Math.floor(ys.length * 0.95)] ?? 0) + 0.03 * k
              const coverGeo = new THREE.LatheGeometry([[0, -0.3 * k], [rC, -0.3 * k], [rC, top - 0.06 * k], [rC - 0.04 * k, top - 0.01 * k], [rC - 0.1 * k, top], [0, top]].map(([r, y]) => new THREE.Vector2(r, y)), 48)
              parts.push([new THREE.Mesh(coverGeo, patch(near(plate, B), coverGeo, new THREE.Color(0x6f675c))), B, n])
            }
          }
          for (const [x, at, dir] of parts) {
            x.frustumCulled = false
            x.position.copy(at)
            x.quaternion.setFromUnitVectors(Y, dir)
            x.updateMatrixWorld()
            h.o.parent.attach(x) // нерухомі разом із корпусом
          }
          const cL = h.o.worldToLocal(c.clone())
          hubFix.push({ bone: h.o, at: h.o.parent.worldToLocal(c.clone()), c: cL })
          roots.push({
            bone: h.o, // купол: його поворот (навколо центру — див. hubFix) несе кріплення й лопать
            sign: h.side === 'R' ? sR : -sR,
            lift: pitch.worldToLocal(h.o.getWorldPosition(new THREE.Vector3())).z < 0 ? 1 : -1,
            upper: /^Ala_Up_/.test(h.o.name),
            T: new THREE.Quaternion(),
            on: false,
          })
        }
        // зменшуємо куполи у вихідних координатах сітки: для вершин однієї кістки це подібне перетворення, тож
        // зменшення навколо центру в них — те саме зменшення навколо центру у світі
        for (const mesh of domeMeshes) {
          const g = mesh.geometry
          const pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight
          const fits = domeFit.map((f) => {
            const j = mesh.skeleton.bones.indexOf(f.bone as THREE.Bone)
            if (j < 0) return null
            const A = new THREE.Matrix4().copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(f.bone.matrixWorld).multiply(mesh.skeleton.boneInverses[j]).multiply(mesh.bindMatrix)
            return { j, s: f.s, cb: f.c.clone().applyMatrix4(A.invert()) }
          })
          const v = new THREE.Vector3()
          for (let i = 0; i < pos.count; i++) {
            const w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)]
            const j = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)][w.indexOf(Math.max(...w))]
            const f = fits.find((x) => x && x.j === j)
            if (!f) continue
            v.fromBufferAttribute(pos, i).sub(f.cb).multiplyScalar(f.s).add(f.cb)
            pos.setXYZ(i, v.x, v.y, v.z)
          }
          pos.needsUpdate = true
          g.computeBoundingSphere()
        }
        beat?.stop()
        // стає на дюни тієї висоти, що в повзунку (кадр далі стежить за змінами)
        duneAmp = tune.current.fl.duneH
        sandU.uAmp.value = duneAmp
        restDunes = `${tune.current.dunes}|${duneAmp}`
        const rest = restAt(scroll)
        padY = rest.lift
        restRX = rest.rx
        restRZ = rest.rz
        lift.position.y = liftFrom = targetLift = padY
        // шейдери всього, що з'являється пізніше (пил, кола сканера, смуги), — зараз, а не в мить появи: у Safari
        // збірка шейдера — помітна зупинка, і вона припадала б на посадку чи ввімкнення сканера
        renderer.compile(scene, camera)
        setReady(true)
        if (autoWanted) autoPlay() // блок уже був на екрані, поки модель вантажилась
      },
      undefined,
      () => { if (!disposed) onMissing?.() },
    )

    // ---------- анімації ----------
    const clock = new THREE.Clock()
    let turnAt = -1 // коли орні на зльоті опустить ніс і рушить уперед
    // іде підйом зльоту: «на висоті» — лише коли він закінчився (орні на піску може стояти й на гребені,
    // тож висота понад нуль ще не означає, що злетів)
    let climbing = false
    let scanOn = false
    let scanFrom = 0
    let scanOff = -10
    const st = { wings: false, gear: false, ramp: false }
    const sync = () => setState({ ...st })

    /** грати дію і зупинити інші, що рухають ті самі кістки (спершу play — інакше спільні кістки скинулись би в позу спокою) */
    const solo = (a: THREE.AnimationAction) => {
      a.paused = false
      a.play()
      const mine = new Set(a.getClip().tracks.map((t) => t.name))
      for (const b of [...actions, beat]) {
        if (!b || b === a || !b.isScheduled()) continue
        if (b.getClip().tracks.some((t) => mine.has(t.name))) b.stop()
      }
    }
    const run = (i: number, reverse = false) => {
      const a = actions[i]
      if (!a) return
      a.reset()
      a.timeScale = reverse ? -1 : 1
      if (reverse) a.time = a.getClip().duration
      solo(a)
    }

    // крила — етапами: складені → розкриття → розкриті → (політ: перехід туди-назад) → назад
    let phase: WingPhase = 'folded'
    let flapFrom = 0
    let spinBase = 1 // з якого темпу розганяємось (повторний зліт посеред сповільнення — з поточного)
    let beatPhase = 0 // фаза змаху: 0 — розкрита поза, 0,25 — угорі, 0,75 — унизу
    let levelMix = 0 // рівень крил із повзунків: 1 — крила розкриті, 0 — складені (плавно між ними)
    let liftPending = false
    let high = false // набрав висоту — сканер можна вмикати
    let landPending = false // чекаємо, поки торкнеться піску
    let slowFrom = -1 // коли почали сповільнювати змахи (після посадки чи коли вимкнули двигун)
    let slowDur = 1.5 // за скільки зупиняються: після посадки чи на плануванні — свій повзунок
    let spinDur = 1.5 // за скільки розкручуються: перед зльотом чи з планування — свій повзунок
    let turnMove = 1 // скільки триває рух уперед на поточному зльоті
    let landMove = 1 // скільки триває гальмування на поточній посадці
    let landEase = EASE.smoother // і якою кривою
    let spinEase: EaseKey = 'eSpin' // крива розкручування змахів: перед зльотом чи з планування
    let slowEase: EaseKey = 'eSlow' // крива зупинки змахів: після посадки чи на плануванні
    let slowBase = 1
    let slowTo: 'folded' | 'open' = 'folded' // після сповільнення: посадка — скласти крила, планування — тримати розкритими
    let gliding = false
    let glideMix = 0 // 0 — політ на двигуні, 1 — планування: плавно, для погойдування
    let boost = false // прискорення в плануванні
    let boostMix = 0
    let trailMix = 0 // смуги: з'являються, лише коли крила вже завмерли
    /** корені лопатей і їхній поворот назад у прискоренні (T — щоб зняти його перед наступним кадром) */
    const roots: { bone: THREE.Object3D; sign: number; lift: number; upper: boolean; T: THREE.Quaternion; on: boolean }[] = []
    /** кістки куполів: кліпи моделі крутять їх навколо власного початку, а ми — навколо центру кулі (at — він у просторі батька) */
    const hubFix: { bone: THREE.Object3D; at: THREE.Vector3; c: THREE.Vector3 }[] = []
    const hubTmp = new THREE.Vector3()
    const pwq = new THREE.Quaternion()
    const qY = new THREE.Quaternion()
    const qF = new THREE.Quaternion()
    const axis = new THREE.Vector3()
    const axisX = new THREE.Vector3()
    let boostAt = -10
    let want: 'folded' | 'open' | 'flying' = 'folded'
    const unfold = () => actions[UNFOLD]
    const wings = () => {
      const u = unfold()
      if (!u) return
      // темп кліпу розкриття — з повзунків «Розкладання» і «Складання крил» (кліп моделі — 0,8 с)
      const open = u.getClip().duration / Math.max(0.05, tune.current.fl.unfold)
      const close = u.getClip().duration / Math.max(0.05, tune.current.fl.fold)
      if (phase === 'folded' && want !== 'folded') {
        u.reset(); u.timeScale = open; solo(u); phase = 'opening'
      } else if (phase === 'opening' && want === 'folded') {
        u.timeScale = -close; u.paused = false; phase = 'closing'
      } else if (phase === 'closing' && want !== 'folded') {
        u.timeScale = open; u.paused = false; phase = 'opening'
      } else if (phase === 'open' && want === 'flying' && beat) {
        // змахи: кліп тримає розкриту позу (дія на паузі), рух — поворот коренів лопатей щокадру
        beat.reset(); beat.timeScale = 1; solo(beat); beat.paused = true; beatPhase = 0; phase = 'flying'; flapFrom = clock.getElapsedTime(); spinBase = 1
      } else if (phase === 'open' && want === 'folded') {
        // розкриту позу міг тримати й кліп польоту — згортаємо кліпом розкриття з кінця
        if (!u.isScheduled() || u.time < u.getClip().duration - 1e-3) { u.reset(); u.time = u.getClip().duration }
        u.timeScale = -close; solo(u); phase = 'closing'
      } else if (phase === 'flying' && want !== 'flying' && beat) {
        // зупинка: доводимо лопаті до розкритої пози (найближче її проходження)
        beat.timeScale = Math.max(1.6, Math.abs(beat.timeScale)); phase = 'settling'
      } else if (phase === 'settling' && want === 'flying' && beat) {
        beat.timeScale = 1; phase = 'flying'; flapFrom = clock.getElapsedTime(); spinBase = 1
      }
    }
    function onFinished(ev: THREE.Event) {
      const e = ev as THREE.Event & { action: THREE.AnimationAction; direction: number }
      if (e.action === unfold()) {
        phase = e.direction > 0 ? 'open' : 'folded'
        if (phase === 'folded' && seqNow === 'landing') setSeq(null) // посадка завершилась: крила складені
        wings()
      }
    }
    const setWings = (w: typeof want) => {
      want = w
      st.wings = w !== 'folded'
      sync()
      wings()
    }

    // послідовність зльоту/посадки: поки триває, вручну нічого не рухаємо (її кроки рухають самі)
    let seqNow: Seq = null
    const setSeq = (v: typeof seqNow) => { seqNow = v; setSeqState(v) }

    const later: number[] = []
    const after = (ms: number, fn: () => void) => later.push(window.setTimeout(fn, ms))
    const toggle = (g: 'wings' | 'gear' | 'ramp') => {
      if (!mixer) return
      if (g === 'wings') {
        if (!flying && !idling) setWings(st.wings ? 'folded' : 'open') // поки двигун працює, крила — його
        return
      }
      st[g] = !st[g]
      if (g === 'gear') GEAR.forEach((i) => run(i, !st.gear))
      if (g === 'ramp') RAMP.forEach((i) => run(i, !st.ramp))
      sync()
    }
    /** двигун заведено на землі: крила махають у темпі «змахи на землі», орні стоїть */
    let idling = false
    const setIdle = (v: boolean) => { idling = v; setIdling(v) }
    /** завести двигун на землі: крила розкриваються, змахи розганяються до темпу на землі */
    const startEngine = () => {
      if (!mixer || flying || seqNow || idling) return
      setIdle(true)
      spinDur = tune.current.fl.spin
      spinEase = 'eSpin'
      if (slowFrom >= 0 && beat) {
        // заводимо посеред зупинки — розганяємось із поточного темпу
        slowFrom = -1
        flapFrom = clock.getElapsedTime()
        spinBase = Math.abs(beat.timeScale)
      }
      setWings('flying')
    }
    /** заглушити: змахи сповільнюються, крила складаються — як після посадки */
    const stopEngine = () => {
      if (!idling || flying) return
      setIdle(false)
      slowDur = tune.current.fl.slow
      slowEase = 'eSlow'
      if (beat && phase === 'flying') { slowFrom = clock.getElapsedTime(); slowBase = Math.abs(beat.timeScale); slowTo = 'folded' }
      else setWings('folded')
    }
    const takeoff = () => {
      if (!mixer || flying) return
      spinDur = tune.current.fl.spin
      spinEase = 'eSpin'
      if (idling) {
        // двигун уже заведено: змахи розганяються з темпу на землі до польотного
        setIdle(false)
        if (beat && phase === 'flying') { flapFrom = clock.getElapsedTime(); spinBase = Math.abs(beat.timeScale) }
      }
      flying = true
      setAirborne(true)
      setSeq('takeoff')
      landPending = false
      landFrom = -1 // зліт посеред гальмування: дюни пливуть далі з поточною швидкістю
      if (slowFrom >= 0 && beat) {
        // зліт посеред сповільнення: розганяємось знову з поточного темпу
        slowFrom = -1
        flapFrom = clock.getElapsedTime()
        spinBase = Math.abs(beat.timeScale)
      }
      if (!st.ramp) toggle('ramp') // рампа закривається одразу, ще до відриву
      setWings('flying') // розкриття, далі — змахи з розгоном; відрив — коли змахи розігнались (кадр)
      liftPending = true
    }
    const liftOff = () => {
      const { takeoff: up, turn } = tune.current.fl
      flyTo(1.4, up, tune.current.ez.eTakeoff)
      climbing = true
      if (!high) {
        // зліт (а не повернення на висоту після планування): спершу вертикально, далі ще й уперед
        turnMove = moveOf(up, turn)
        turnAt = clock.getElapsedTime() + (up - turnMove)
      }
      after(700, () => { if (flying && !st.gear) toggle('gear') })
    }
    const land = () => {
      if (!mixer || !flying) return
      flying = false
      setBoost(false)
      if (gliding) engine() // сідаємо на двигуні: змахи розганяються знову, поки орні знижується
      autoScan = false // сіли раніше, ніж набрали висоту, — автосканер уже не потрібен
      setSeq('landing')
      liftPending = false
      high = false
      setAloft(false)
      setAirborne(false)
      setScan(false)
      // гальмуємо за час спуску: дюни зупиняться там, де вже відомо наперед, — сідаємо на пісок саме там
      landFrom = clock.getElapsedTime()
      landS0 = scroll
      landV0 = vel
      turnAt = -1
      climbing = false
      const { land: down, turnDown: turn } = tune.current.fl
      landMove = moveOf(down, turn)
      landEase = EASE[tune.current.ez.eMove] ?? EASE.smoother
      const rest = restAt(scroll + vel * landMove * coast(landEase, 1))
      padY = rest.lift
      restRX = rest.rx
      restRZ = rest.rz
      flyTo(padY, down, tune.current.ez.eLand)
      tilt(0, landMove, 'stop', tune.current.ez.eMove) // гальмує й вирівнюється разом; останні миті — уже вертикально вниз
      after(200, () => { if (!flying && st.gear) toggle('gear') })
      landPending = true // далі — кадр: сів на пісок → рампа відкривається, змахи сповільнюються → крила складаються
    }
    const setScan = (on: boolean) => {
      if (on === scanOn || (on && !high)) return
      scanOn = on
      if (on) scanFrom = nextWave = clock.getElapsedTime()
      else scanOff = clock.getElapsedTime()
      setScanning(on)
    }
    /** двигун знову: змахи розганяються з поточного темпу; у польоті (не на посадці) — далі набір висоти */
    /** нахил і швидкість для поточного режиму: політ чи планування, з прискоренням чи без */
    const settle = (dur: number, ease = tune.current.ez.eMove) =>
      tilt((gliding ? GLIDE_PITCH : CRUISE_PITCH) + (boost ? BOOST_PITCH : 0), dur, boost ? 'boost' : gliding ? 'glide' : 'cruise', ease)
    const engine = () => {
      spinDur = tune.current.fl.glideSpin
      spinEase = 'eGlideSpin'
      gliding = false
      setGliding(false)
      if (slowFrom >= 0 && beat) { slowFrom = -1; flapFrom = clock.getElapsedTime(); spinBase = Math.abs(beat.timeScale) }
      setWings('flying')
      if (flying) { liftPending = true; settle(Math.max(0.5, tune.current.fl.glideSpin)) }
    }
    /** режим стерв'ятника: двигун вимкнено — змахи сповільнюються й завмирають, орні планує вниз */
    const glide = (on: boolean) => {
      if (!mixer || !flying || !high || seqNow || on === gliding) return
      if (!on) return engine()
      gliding = true
      setGliding(true)
      liftPending = false
      slowDur = tune.current.fl.glideStop
      slowEase = 'eGlideStop'
      if (beat && phase === 'flying') { slowFrom = clock.getElapsedTime(); slowBase = Math.abs(beat.timeScale); slowTo = 'open' }
      settle(Math.max(0.8, tune.current.fl.glideStop))
      flyTo(GLIDE_ALT, 9)
    }
    /** прискорення (у польоті й у плануванні): крила відводяться назад (кадр), ніс пірнає, ривок уперед, дюни біжать швидше */
    function setBoost(on: boolean) {
      if (on === boost || (on && (!flying || !high || seqNow))) return
      boost = on
      setBoosting(on)
      if (on) boostAt = clock.getElapsedTime()
      if (flying && high) settle(tune.current.fl.boostTime, tune.current.ez.eBoost)
    }
    // ---------- дрон ----------
    // Кліп моделі один (див. D_*): його час задаємо самі (дія на паузі), етапами — сон, пробудження, стійка, відрив;
    // поза зависання (кінець кліпу) — окрема дія, між ними — плавне змішування. Поверх пози моделі щокадру: лопаті
    // турбін крутяться власними обертами (їхні доріжки з кліпу прибрано), око роззирається, у сканері дивиться вниз,
    // ноги в повітрі погойдуються, у патрулі відводяться назад, а турбіни нахиляються вперед
    type DState = 'sleep' | 'waking' | 'stand' | 'sleeping' | 'lifting' | 'hover' | 'descending' | 'touchdown' | 'demo'
    let dState: DState = 'sleep'
    let dAct: THREE.AnimationAction | null = null
    let dHoverAct: THREE.AnimationAction | null = null
    let dT = D_SLEEP // час кліпу зараз
    let dFrom = D_SLEEP
    let dTo = D_SLEEP
    let dAt = 0
    let dDur = 1
    let dLinear = false // кліп іде рівно (відрив, кліп цілком), а не плавно розганяючись і гальмуючи
    let dThen: (() => void) | null = null
    let hoverMix = 0 // 0 — поза з кліпу, 1 — поза зависання
    let hoverFrom = 0
    let hoverTo = 0
    let hoverAt = 0
    let hoverDur = 1
    let dClimbed = false // на цьому зльоті вже рушили вгору — разом із поштовхом ніг у кліпі
    let rotor = 0 // оберти лопатей зараз, об/с
    let rotorAngle = 0
    let glowMix = 0
    let patrolOn = false
    let patrolMix = 0
    let lookYaw = 0
    let lookPitch = 0
    let lookYawTo = 0
    let lookPitchTo = 0
    let lookNext = 0
    const dBlades: { o: THREE.Object3D; base: THREE.Quaternion; sign: number }[] = []
    const dLegs: { o: THREE.Object3D; base: THREE.Quaternion; phase: number }[] = []
    const dTurbs: { o: THREE.Object3D; T: THREE.Quaternion; on: boolean }[] = []
    let dEye: { o: THREE.Object3D; T: THREE.Quaternion; on: boolean } | null = null
    let dLens: THREE.Object3D | null = null
    const dGlowMats: THREE.MeshStandardMaterial[] = []
    const dq = new THREE.Quaternion()
    const dq2 = new THREE.Quaternion()
    const dv = new THREE.Vector3()
    const dUp = new THREE.Vector3()
    const dSide = new THREE.Vector3()
    const Y_AXIS = new THREE.Vector3(0, 1, 0)
    /** час кліпу — від поточного до `to` за `dur` с, тоді `then` */
    const clipTo = (to: number, dur: number, then: (() => void) | null = null, linear = false) => {
      dFrom = dT
      dTo = to
      dAt = clock.getElapsedTime()
      dDur = Math.max(0.01, dur)
      dThen = then
      dLinear = linear
    }
    const hoverBlend = (to: number, dur: number) => {
      hoverFrom = hoverMix
      hoverTo = to
      hoverAt = clock.getElapsedTime()
      hoverDur = Math.max(0.01, dur)
    }
    const setPatrolUi = (on: boolean) => {
      patrolOn = on
      setPatrolling(on)
    }
    /** набір висоти — разом із поштовхом ніг у кліпі */
    const droneClimb = () => {
      dClimbed = true
      flyTo(padY + tune.current.fl.dHover, tune.current.fl.dClimb, tune.current.ez.eTakeoff)
      climbing = true
    }
    /** відрив: присідає, відштовхується (тоді ж рушає вгору), турбіни лягають горизонтально; далі — поза зависання */
    const droneLift = () => {
      dState = 'lifting'
      dClimbed = false
      if (dT >= D_PUSH) droneClimb()
      clipTo(D_AIR, (tune.current.fl.dTakeoff * (D_AIR - dT)) / (D_AIR - D_STAND), () => hoverBlend(1, 0.9), true)
    }
    const droneTakeoff = () => {
      if (!dAct || flying || dState === 'demo') return
      flying = true
      setAirborne(true)
      setSeq('takeoff')
      setAwake(true)
      landPending = false
      landFrom = -1
      // спить чи засинає — спершу прокидається (з того місця кліпу, де зараз), стоїть — одразу відрив
      if (dT >= D_STAND) droneLift()
      else {
        dState = 'waking'
        clipTo(D_STAND, (tune.current.fl.dWake * (D_STAND - dT)) / D_STAND, droneLift)
      }
    }
    /** стає на ноги з пози зависання чи з відриву: кліп від поточного моменту назад до стійки */
    const droneTouch = (done: () => void) => {
      dState = 'touchdown'
      const d = tune.current.fl.dTouch
      hoverBlend(0, Math.min(0.8, d * 0.45))
      clipTo(D_STAND, (d * Math.max(0, dT - D_STAND)) / (D_AIR - D_STAND), () => {
        dState = 'stand'
        done()
      })
    }
    const droneLand = () => {
      if (!dAct || !flying) return
      const f = tune.current.fl
      flying = false
      autoScan = false
      setSeq('landing')
      high = false
      climbing = false
      setAloft(false)
      setAirborne(false)
      setScan(false)
      setPatrolUi(false)
      dThen = null // відрив, якщо ще йшов, далі не веде в зависання — сідаємо
      if (hoverTo < 1) hoverBlend(1, 0.6)
      // гальмуємо дорогою вниз: дюни зупиняться там, де відомо наперед, — там дрон і стане на ноги
      landFrom = clock.getElapsedTime()
      landS0 = scroll
      landV0 = vel
      landMove = f.dLand
      landEase = EASE[tune.current.ez.eMove] ?? EASE.smoother
      const rest = restAt(scroll + vel * landMove * coast(landEase, 1))
      padY = rest.lift
      restRX = rest.rx
      restRZ = rest.rz
      flyTo(padY, f.dLand, tune.current.ez.eLand)
      tilt(0, landMove, 'stop', tune.current.ez.eMove)
      dState = 'descending'
      landPending = true // далі — кадр: опустився до піску → стає на ноги
    }
    const droneWake = (on: boolean) => {
      if (!dAct || flying || (seqNow && seqNow !== 'wake' && seqNow !== 'sleep')) return
      const f = tune.current.fl
      if (on && (dState === 'sleep' || dState === 'sleeping')) {
        dState = 'waking'
        setSeq('wake')
        setAwake(true)
        clipTo(D_STAND, (f.dWake * (D_STAND - dT)) / D_STAND, () => {
          dState = 'stand'
          setSeq(null)
        })
      } else if (!on && (dState === 'stand' || dState === 'waking')) {
        dState = 'sleeping'
        setSeq('sleep')
        setAwake(false)
        clipTo(D_SLEEP, (f.dSleep * dT) / D_STAND, () => {
          dState = 'sleep'
          setSeq(null)
        })
      }
    }
    /** патруль: нахиляється вперед і летить над дюнами (вони пливуть назад), ноги — назад, турбіни — вперед */
    const dronePatrol = (on: boolean) => {
      if (on === patrolOn || (on && (!flying || !high || seqNow))) return
      const f = tune.current.fl
      setPatrolUi(on)
      tilt(on ? THREE.MathUtils.degToRad(f.dTilt) : 0, f.dPatrolTime, on ? 'patrol' : 'stop', tune.current.ez.eMove)
    }
    /** кліп моделі цілком (на місці): присідає, прокидається, злітає, зависає — і знову стає на ноги */
    const droneDemo = () => {
      if (!dAct || flying || seqNow) return
      dState = 'demo'
      setSeq('demo')
      setAwake(true)
      const play = () => clipTo(D_HOVER, D_HOVER - D_SLEEP, () => {
        // кінець кліпу — поза зависання: стає на ноги тим самим шляхом, що після посадки
        hoverMix = hoverFrom = hoverTo = 1
        dT = D_AIR
        droneTouch(() => setSeq(null))
      }, true)
      if (dT > D_SLEEP + 0.01) clipTo(D_SLEEP, 0.8 * (dT / D_STAND), play) // спершу — присісти, звідки кліп починається
      else play()
    }
    /** кадр, до міксера: час кліпу, змішування з позою зависання, оберти, світіння, погляд; знімаємо торішні повороти */
    const droneFrame = (t: number, dt: number) => {
      if (!dAct || !dHoverAct) return
      const f = tune.current.fl
      const q = Math.min(1, (t - dAt) / dDur)
      dT = dFrom + (dTo - dFrom) * (dLinear ? q : EASE.smooth(q))
      if (q >= 1 && dThen) {
        const fn = dThen
        dThen = null
        fn()
      }
      const hq = Math.min(1, (t - hoverAt) / hoverDur)
      hoverMix = hoverFrom + (hoverTo - hoverFrom) * EASE.smooth(hq)
      if (dState === 'lifting') {
        if (!dClimbed && dT >= D_PUSH && flying) droneClimb()
        if (hoverTo === 1 && hq >= 1) dState = 'hover'
      }
      // опустився до піску — стає на ноги
      if (dState === 'descending' && landPending && t - liftAt >= liftDur) {
        landPending = false
        droneTouch(() => { if (seqNow === 'landing') setSeq(null) })
      }
      dAct.time = dT
      dAct.setEffectiveWeight(1 - hoverMix)
      dHoverAct.setEffectiveWeight(hoverMix)
      // оберти: уві сні стоять, на ногах — холостий хід, у повітрі (щойно відштовхнувся) — польотні
      const asleep = dState === 'sleep' || dState === 'sleeping'
      const aloftNow = dState === 'lifting' ? dT >= D_PUSH : dState === 'hover' || dState === 'descending' || (dState === 'demo' && dT >= D_PUSH && dT < D_HOVER)
      const target = asleep ? 0 : aloftNow ? f.dRotorFly : f.dRotorIdle
      rotor += (target - rotor) * Math.min(1, (dt * 3) / Math.max(0.2, f.dSpin))
      rotorAngle = (rotorAngle + rotor * Math.PI * 2 * dt) % (Math.PI * 2)
      glowMix += ((asleep ? 0.03 : 1) - glowMix) * Math.min(1, dt * (asleep ? 1.2 : 2))
      patrolMix += ((patrolOn ? 1 : 0) - patrolMix) * Math.min(1, (dt * 2.5) / Math.max(0.2, f.dPatrolTime))
      // погляд: уві сні — донизу, у сканері — вниз на пісок, інакше роззирається (у патрулі — трохи вперед і вниз)
      const look = THREE.MathUtils.degToRad(f.dLook)
      if (asleep) {
        lookYawTo = 0
        lookPitchTo = 0.25
      } else if (scanOn) {
        lookYawTo = 0
        lookPitchTo = THREE.MathUtils.degToRad(22)
      } else if (t >= lookNext) {
        lookYawTo = (Math.random() * 2 - 1) * look
        lookPitchTo = (Math.random() * 2 - 1) * look * 0.5 + (patrolOn ? look * 0.35 : 0)
        lookNext = t + f.dLookEvery * (0.6 + Math.random() * 0.8)
      }
      const k = Math.min(1, dt * 5)
      lookYaw += (lookYawTo - lookYaw) * k
      lookPitch += (lookPitchTo - lookPitch) * k
      // повороти ока й турбін з минулого кадру знімаємо: міксер переписує кістку, лише коли поза змінилась
      if (dEye?.on) {
        dEye.o.quaternion.premultiply(dq.copy(dEye.T).invert())
        dEye.on = false
      }
      for (const tb of dTurbs) if (tb.on) {
        tb.o.quaternion.premultiply(dq.copy(tb.T).invert())
        tb.on = false
      }
    }
    /** поворот w (у світі) — у просторі батька вузла o: P⁻¹·w·P */
    const inParent = (o: THREE.Object3D, w: THREE.Quaternion, out: THREE.Quaternion) => {
      o.parent!.getWorldQuaternion(dq2)
      return out.copy(dq2).invert().multiply(w).multiply(dq2)
    }
    /** кадр, після міксера: лопаті, око, турбіни, ноги, світіння; точка, звідки йде сканер, — око */
    const droneAfter = (t: number) => {
      if (!dAct) return
      const f = tune.current.fl
      pitch.getWorldQuaternion(pwq)
      dUp.set(0, 1, 0).applyQuaternion(pwq) // вертикаль дрона
      dSide.set(0, 0, 1).applyQuaternion(pwq) // поперечна вісь (ніс — у −X)
      for (const b of dBlades) b.o.quaternion.copy(b.base).multiply(dq.setFromAxisAngle(Y_AXIS, rotorAngle * b.sign))
      if (dEye) {
        qF.setFromAxisAngle(dUp, lookYaw).multiply(qY.setFromAxisAngle(dSide, lookPitch))
        dEye.o.quaternion.premultiply(inParent(dEye.o, qF, dEye.T))
        dEye.on = true
      }
      // у патрулі турбіни нахиляються вперед — тяга вперед
      const lean = patrolMix * THREE.MathUtils.degToRad(f.dTilt) * 0.6
      if (lean > 1e-4) for (const tb of dTurbs) {
        qF.setFromAxisAngle(dSide, lean)
        tb.o.quaternion.premultiply(inParent(tb.o, qF, tb.T))
        tb.on = true
      }
      // ноги: у повітрі погойдуються кожна у своїй фазі, у патрулі — відведені назад (ступні — до +X)
      const air = THREE.MathUtils.clamp((lift.position.y - padY) / Math.max(0.2, f.dHover), 0, 1) * hoverMix
      const swing = THREE.MathUtils.degToRad(f.dLegs) * air
      for (const l of dLegs) {
        qF.setFromAxisAngle(dSide, swing * Math.sin(t * 1.15 + l.phase) + patrolMix * air * 0.28)
        l.o.quaternion.copy(inParent(l.o, qF, dq)).multiply(l.base)
      }
      // світіння ока й вогнів; поки сканує — пульсує в такт імпульсам
      const pulse = scanOn ? 1 + 0.4 * Math.max(0, Math.cos(((t - scanFrom) / Math.max(0.2, f.scanEvery)) * Math.PI * 2)) : 1
      for (const mat of dGlowMats) mat.emissiveIntensity = glowMix * f.dGlow * pulse
      if (dLens) {
        dLens.getWorldPosition(dv)
        nose.copy(pitch.worldToLocal(dv))
      }
    }
    /** дрон завантажився: доріжки, розміри, низ (ноги), вузли, що рухаємо самі; спить на піску */
    const setupDrone = (gltf: GLTF) => {
      const m = gltf.scene
      const src = gltf.animations[0]
      if (!src) return void onMissing?.()
      // рух дрона по сцені — наш: доріжки, що смикають і розвертають увесь дрон, прибираємо; лопаті крутимо самі
      src.tracks = src.tracks.filter((tr) => !/^(Drone_Controller|Turbine_Controller|Drone_Turb_Blade_[LR])\./.test(tr.name))
      m.rotation.y = -Math.PI / 2 // око (+Z моделі) — уперед, у −X, як ніс орні
      pitch.add(m)
      m.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.frustumCulled = false
        const mat = mesh.material as THREE.MeshStandardMaterial
        mat.envMapIntensity = 0.9
        if (mat.emissiveMap && !dGlowMats.includes(mat)) dGlowMats.push(mat)
      })
      mixer = new THREE.AnimationMixer(m)
      dAct = mixer.clipAction(src)
      dHoverAct = mixer.clipAction(poseClip(src, D_HOVER, 'hover'))
      for (const a of [dAct, dHoverAct]) {
        a.play()
        a.paused = true
      }
      dHoverAct.setEffectiveWeight(0)
      // розмір і низ — у позі «стоїть на ногах»
      dAct.time = D_STAND
      mixer.update(0)
      const size = boxOf(m).getSize(new THREE.Vector3())
      m.scale.multiplyScalar(3.4 / Math.max(size.x, size.y, size.z)) // з розгорнутими турбінами — як орні в кадрі
      m.position.sub(boxOf(m).getCenter(new THREE.Vector3()))
      const bb = boxOf(m)
      base = bb.min.y
      sand.position.y = base
      computeHull(m, bb)
      sandU.uShadowK.value = 1.15
      const get = (n: string) => m.getObjectByName(n)
      for (const [n, sign] of [['Drone_Turb_Blade_L', -1], ['Drone_Turb_Blade_R', 1]] as const) {
        const o = get(n)
        if (o) dBlades.push({ o, base: o.quaternion.clone(), sign })
      }
      ;['Drone_leg_F', 'Drone_leg_L', 'Drone_leg_R'].forEach((n, i) => {
        const o = get(n)
        if (o) dLegs.push({ o, base: o.quaternion.clone(), phase: i * 2.1 })
      })
      for (const n of ['Drone_Turb_M_L', 'Drone_Turb_M_R']) {
        const o = get(n)
        if (o) dTurbs.push({ o, T: new THREE.Quaternion(), on: false })
      }
      const eye = get('Drone_IEye')
      if (eye) dEye = { o: eye, T: new THREE.Quaternion(), on: false }
      dLens = get('Drone_ILens') ?? null
      // спить: присів, турбіни стоять, око ледь жевріє
      dT = dFrom = dTo = D_SLEEP
      dAct.time = D_SLEEP
      mixer.update(0)
      m.updateMatrixWorld(true)
      if (dLens) nose.copy(pitch.worldToLocal(dLens.getWorldPosition(dv)))
      duneAmp = tune.current.fl.duneH
      sandU.uAmp.value = duneAmp
      restDunes = `${tune.current.dunes}|${duneAmp}`
      const rest = restAt(scroll)
      padY = rest.lift
      restRX = rest.rx
      restRZ = rest.rz
      lift.position.y = liftFrom = targetLift = padY
      setAnims(1)
      renderer.compile(scene, camera) // шейдери пилу й сканера — заздалегідь (див. орні)
      setReady(true)
      if (autoWanted) autoPlay()
    }

    api.current = {
      bench: () => toggleBench(),
      scan: setScan,
      play: (i) => {
        if (seqNow) return
        const g = ANIMS.find((a) => a.i === i)?.group
        if (g === 'wings') {
          if (flying || idling) return
          // кліп крил із файлу цілком: починається складеним, закінчується розкритим
          run(i)
          phase = 'open'
          want = 'open'
          st.wings = true
          sync()
        } else run(i)
      },
      takeoff: isDrone ? droneTakeoff : takeoff,
      land: isDrone ? droneLand : land,
      wake: droneWake,
      patrol: dronePatrol,
      demo: droneDemo,
      glide,
      boost: setBoost,
      ignite: (on) => (on ? startEngine() : stopEngine()),
      // ручне керування — лише поза зльотом і посадкою; кроки самих послідовностей кличуть toggle напряму
      toggle: (g) => { if (!seqNow) toggle(g) },
      // сцена одна: те саме полотно переїжджає у вікно налаштувань і назад — другої сцени (й контексту WebGL)
      // не створюємо, а на сторінці, поки вікно відкрите, сцени немає
      host: (target) => {
        const next = target ?? el
        if (next === host) return
        host = next
        next.appendChild(renderer.domElement)
        dirty = true // на новому місці — свіжий кадр, навіть якщо сцена стоїть
        ro.disconnect()
        ro.observe(next)
        io.disconnect()
        io.observe(next)
      },
    }

    let host: HTMLElement = el // де зараз полотно: на сторінці чи у вікні налаштувань
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      renderer.getDrawingBufferSize(sandU.uRes.value)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      camera.aspect = w / h
      // кадр вужчий за блок на сторінці (16:10) — вікно налаштувань, телефон: камера трохи віддаляється, щоб
      // орні з розкритими крилами вміщався так само
      camera.zoom = Math.min(1, w / h / 1.6)
      camera.updateProjectionMatrix()
      dirty = true
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    let raf = 0
    let visible = true
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible && !raf) { clock.getDelta(); perfFrom = 0; raf = requestAnimationFrame(frame) }
    })

    // ---------- швидкість: FPS за секунду, час кадру на процесорі, адаптивна роздільність ----------
    let perfFrom = 0
    let perfFrames = 0
    let perfCpu = 0
    let slowRuns = 0
    let fastRuns = 0
    // ціль — частота екрана (60, 90, 120, 144 Гц…): найвищий FPS, який сцена показувала (напр. поки вантажилась
    // модель і кадри були легкі). Роздільність нижче 1 на екранах з високою щільністю — надто розмита
    const RATES = [60, 75, 90, 100, 120, 144, 165, 240]
    let refresh = 60
    let lowRuns = 0
    /** роздільність щойно знизили: з якої і скільки було кадрів — за вікно перевіримо, чи це допомогло */
    let tried: { from: number; fps: number; skip: number } | null = null
    /** знижували — і кадрів не додалось: гальмує не кількість пікселів, тож пів хвилини різкість не віддаємо */
    let dprUseless = false
    let uselessAt = 0
    /** на місці лічильника FPS — результат заміру: не перезаписуємо, доки його не сховають */
    let benchHold = false
    let dprCeil = DPR_MAX // вище не піднімаємо: тут уже не встигали; за пів хвилини знову пробуємо
    let ceilAt = 0
    const setDpr = (v: number) => {
      const next = Math.round(Math.max(DPR_MIN, Math.min(DPR_MAX, v)) * 100) / 100
      if (next === dpr) return
      dpr = next
      renderer.setPixelRatio(dpr)
      resize()
    }
    const perfTick = (cpuMs: number, rawDt: number) => {
      const now = performance.now()
      if (!perfFrom || rawDt > 0.25) { perfFrom = now; perfFrames = 0; perfCpu = 0; return } // пауза — вікно заново
      perfFrames++
      perfCpu += cpuMs
      const span = now - perfFrom
      if (span < 1000) return
      const fps = (perfFrames * 1000) / span
      const cpu = perfCpu / perfFrames
      perfFrom = now
      perfFrames = 0
      perfCpu = 0
      refresh = Math.max(refresh, RATES.filter((r) => r <= fps * 1.04).pop() ?? 60)
      const goal = refresh
      if (dprCeil < DPR_MAX && now - ceilAt > 30000) dprCeil = DPR_MAX
      if (dprUseless && now - uselessAt > 30000) dprUseless = false // сцена могла змінитись (пил) — знову можна
      // знизили роздільність — а кадрів (за друге вікно, перше — з перебудовою) і близько не стало досить, і додалось
      // менше ніж 5% (у межах звичайних коливань): гальмує не кількість пікселів, повертаємо різкість
      if (tried && tried.skip-- <= 0) {
        if (fps < goal * 0.95 && fps < tried.fps * 1.05) {
          dprUseless = true
          uselessAt = now
          dprCeil = DPR_MAX
          setDpr(tried.from)
        }
        tried = null
      }
      // повільно (і не через процесор — тоді менша роздільність не допоможе): знижуємо одразу на скільки треба —
      // пікселів стільки ж разів менше, у скільки бракує кадрів
      if (!dprUseless && !tried && fps < goal * 0.9 && dpr > DPR_MIN && cpu < 700 / goal) {
        if (++slowRuns >= 2) {
          slowRuns = 0
          fastRuns = -4 // після зниження — пауза перед новою спробою
          const next = Math.min(dpr - 0.25, Math.floor(dpr * Math.sqrt(fps / goal) * 4) / 4)
          dprCeil = Math.max(DPR_MIN, next)
          ceilAt = now
          tried = { from: dpr, fps, skip: 1 }
          setDpr(next)
        }
      } else slowRuns = 0
      if (!tried && fps >= goal * 0.97 && dpr < Math.min(DPR_MAX, dprCeil)) {
        if (++fastRuns >= 4) { fastRuns = 0; setDpr(dpr + 0.25) }
      } else if (fps < goal * 0.97) fastRuns = Math.min(fastRuns, 0)
      // «Авто»: роздільність уже найменша (чи її зниження не допомагає), а кадрів досі помітно бракує (слабкий
      // телефон, режим енергозбереження, що ріже кадри до 30) — п'ять секунд поспіль (не коротка посадка з пилом),
      // і рівень якості нижче
      if (tune.current.quality === 'auto' && tier !== 'eco' && (dprUseless || dpr <= DPR_MIN + 0.01) && fps < goal * 0.8) {
        if (++lowRuns >= 5) {
          autoDown = tier === 'high' ? 'balanced' : 'eco'
          applyTier(autoDown, true)
        }
      } else lowRuns = 0
      const el = fpsEl.current
      if (el && tune.current.showFps && !benchHold) el.textContent = t('{fps} FPS · кадр {ms} мс · CPU {cpu} мс · ×{dpr} · {tier}', { fps: Math.round(fps), ms: (1000 / fps).toFixed(1), cpu: cpu.toFixed(1), dpr, tier: TIER_NAME[tier] })
    }
    /**
     * Інший рівень якості — на ходу, без перезапуску сцени: стеля роздільності, частка пилу, дрібниці
     * піску (шейдер перезбирається) і густота його сітки. Легку модель міняє лише перезапуск (вибір у налаштуваннях)
     */
    const applyTier = (t: Tier, down = false) => {
      tier = t
      const T = TIERS[t]
      DPR_MAX = Math.min(devicePixelRatio || 1, T.dpr)
      DPR_MIN = Math.min(DPR_MAX, dprFloor())
      dprCeil = DPR_MAX
      setDpr(down ? Math.min(dpr, DPR_MAX) : DPR_MAX) // вниз — з тієї, що вже є; вгору — з найвищої, далі підлаштується
      dustK = T.dust
      sandMat.defines = sandDefines()
      sandMat.needsUpdate = true
      if (T.seg !== sandSeg) buildSand(sandR)
      slowRuns = fastRuns = lowRuns = 0
      tried = null
      dprUseless = false
      perfFrom = 0
      dirty = true
      setTierNow(t)
    }
    io.observe(el)
    // вікно налаштувань уже відкрите (модель змінили в ньому) — нове полотно одразу туди
    if (fullRef.current && fullBox.current) api.current?.host(fullBox.current)

    // показ: блок уперше повністю на екрані — орні злітає сам, а на висоті вмикає сканер. Один раз за
    // відкриття сторінки; модель ще вантажиться — злетить, щойно завантажиться. Без анімацій у системі — ні.
    let autoWanted = false
    let autoDone = false
    let autoScan = false
    const autoPlay = () => {
      if (autoDone || reduce || !mixer) return
      autoDone = true
      autoScan = true
      if (isDrone) droneTakeoff()
      else takeoff()
    }
    const full = new IntersectionObserver(([e]) => {
      if (e.intersectionRatio < 0.98) return
      autoWanted = true
      autoPlay()
    }, { threshold: [0.98] })
    full.observe(el)

    // ---------- кадр без змін не малюємо ----------
    // після всіх оновлень порівнюємо з минулим кадром усе, що видно: камеру, кожен вузол моделі (кістки теж), пісок
    // (зсув, висота, рельєф, тінь), світіння дрона; пил, смуги й сканер — рух самі по собі. Нічого не зрушило
    // (орні стоїть на піску, дрон спить) — на екрані лишається минулий кадр, відеокарта відпочиває
    let idleShown = false // минулий кадр не малювали — підпис FPS уже каже, що сцена стоїть
    let sig = new Float64Array(512)
    let sigAt = 0
    let sigDiff = false
    const sigPut = (v: number) => {
      if (sigAt >= sig.length) {
        const n = new Float64Array(sig.length * 2)
        n.set(sig)
        sig = n
      }
      if (Math.abs(sig[sigAt] - v) > 1e-5) { sig[sigAt] = v; sigDiff = true }
      sigAt++
    }
    const sigNode = (o: THREE.Object3D) => {
      const p = o.position, q = o.quaternion, k = o.scale
      sigPut(p.x); sigPut(p.y); sigPut(p.z)
      sigPut(q.x); sigPut(q.y); sigPut(q.z); sigPut(q.w)
      sigPut(k.x + k.y * 3 + k.z * 7); sigPut(o.visible ? 1 : 0)
    }
    const moving = () => {
      sigAt = 0
      sigDiff = false
      sigNode(camera)
      sigPut(camera.fov); sigPut(camera.zoom); sigPut(camera.aspect)
      orni.traverse(sigNode)
      sigPut(sand.position.y)
      for (const k of ['uScroll', 'uStyle', 'uAmp', 'uRipple', 'uRadius'] as const) sigPut(sandU[k].value)
      const sh = sandU.uShadow.value
      sigPut(sh.x); sigPut(sh.y); sigPut(sh.z); sigPut(sh.w)
      for (const m of dGlowMats) sigPut(m.emissiveIntensity)
      sigPut(sigAt) // інша кількість вузлів (модель довантажилась) — теж зміна
      return sigDiff || dustAlive > 0 || trail.visible || waves.length > 0 || sandU.uRingN.value > 0
    }

    // ---------- замір на пристрої ----------
    // «Заміряти» біля лічильника FPS: по черзі прибираємо частини сцени й міняємо роздільність, і для кожного
    // варіанта міряємо, скільки коштує кадр — разом із відеокартою: після кадру читаємо один піксель, а це чекає,
    // доки відеокарта домалює. По 40 кадрів (перші 10 — розгін, без них), медіана. Так видно, що саме гальмує на
    // конкретному телефоні, а не вгадуємо
    interface BenchStep { name: string; start?: () => void; each?: () => void; after?: () => void; end?: () => void }
    const gl = renderer.getContext()
    const benchPx = new Uint8Array(4)
    let benchRun: { steps: BenchStep[]; i: number; n: number; js: number[]; all: number[]; out: string[]; head: string } | null = null
    const benchRes = (v: number) => ({
      name: `×${String(v).replace('.', ',')}`,
      start: () => { renderer.setPixelRatio(v); resize() },
      end: () => { renderer.setPixelRatio(dpr); resize() },
    })
    const startBench = () => {
      const env = scene.environment
      let seen: boolean[] = []
      const hide = (list: () => THREE.Object3D[]): Pick<BenchStep, 'each' | 'after'> => ({
        each: () => { const l = list(); seen = l.map((o) => o.visible); l.forEach((o) => { o.visible = false }) },
        after: () => list().forEach((o, k) => { o.visible = seen[k] }),
      })
      const steps: BenchStep[] = [
        { name: t('усе') },
        { name: t('без піску'), ...hide(() => [sand]) },
        { name: t('без моделі'), ...hide(() => [orni]) },
        { name: t('без пилу'), ...hide(() => [dustGrains, dustClouds]) },
        { name: t('без сканера'), ...hide(() => [...rings, trail]) },
        { name: t('без відблисків'), start: () => { scene.environment = null }, end: () => { scene.environment = env } },
        { name: t('порожньо'), ...hide(() => [sand, orni, dustGrains, dustClouds, ...rings, trail]) },
        ...[1, 1.5, 2, Math.min(3, devicePixelRatio || 1)].filter((v, k, a) => v !== dpr && a.indexOf(v) === k).map(benchRes),
      ]
      benchRun = { steps, i: 0, n: 0, js: [], all: [], out: [], head: '' }
      benchHold = true
      const el = fpsEl.current
      if (el) el.textContent = t('Замір… ~10 с, не крути сцену')
      setBench('running')
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? 0
    const benchFrame = (cpu0: number) => {
      const b = benchRun!
      const st = b.steps[b.i]
      if (b.n === 0) st.start?.()
      st.each?.()
      const tR = performance.now()
      renderer.render(scene, camera)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, benchPx)
      const t1 = performance.now()
      st.after?.()
      if (b.n >= 10) { b.js.push(tR - cpu0); b.all.push(t1 - cpu0) }
      if (b.i === 0 && b.n === 10) {
        const c = renderer.domElement
        b.head = t('Замір · {tier} · ×{dpr} · {w}×{h} · {calls} викл. · {tris} тис. трик.', { tier: TIER_NAME[tier], dpr, w: c.width, h: c.height, calls: renderer.info.render.calls, tris: Math.round(renderer.info.render.triangles / 1000) })
      }
      if (++b.n < 40) return
      b.out.push(b.i === 0 ? t('{name}: {ms} мс (з них JS {js})', { name: st.name, ms: med(b.all).toFixed(1), js: med(b.js).toFixed(1) }) : t('{name}: {ms} мс', { name: st.name, ms: med(b.all).toFixed(1) }))
      st.end?.()
      b.i++
      b.n = 0
      b.js = []
      b.all = []
      if (b.i < b.steps.length) return
      benchRun = null
      const el = fpsEl.current
      if (el) el.textContent = [b.head, ...b.out].join('\n')
      setBench('done')
      perfFrom = 0
      dirty = true
    }
    const toggleBench = () => {
      if (benchRun) return
      if (benchHold) {
        benchHold = false
        setBench('idle')
        const el = fpsEl.current
        if (el) el.textContent = 'FPS…'
        return
      }
      startBench()
    }

    // підпис лічильника, коли сцена стоїть (поза frame(): там `t` — час кадру)
    const idleText = () => t('стоїть — кадр не перемальовується · ×{dpr} · {tier}', { dpr, tier: TIER_NAME[tier] })

    function frame() {
      raf = 0
      if (!visible) return
      // якість змінили в налаштуваннях
      if (tune.current.quality !== qualityNow) {
        qualityNow = tune.current.quality
        const t = qualityNow === 'auto' ? (autoDown ?? autoTier()) : qualityNow
        if (t !== tier) applyTier(t)
      }
      const cpu0 = performance.now()
      const rawDt = clock.getDelta()
      const dt = Math.min(rawDt, 0.1)
      const t = clock.getElapsedTime()
      // сів: спуск закінчився повністю (а не «майже біля піску»)
      if (!isDrone && landPending && !flying && t - liftAt >= liftDur) {
        landPending = false
        if (st.ramp) toggle('ramp') // рампа відкривається лише на піску
        if (phase === 'folded' && seqNow === 'landing') setSeq(null) // крила й так складені — посадка вже завершена
        slowDur = tune.current.fl.slow
        slowEase = 'eSlow'
        if (beat && phase === 'flying') { slowFrom = t; slowBase = Math.abs(beat.timeScale); slowTo = 'folded' } else setWings('folded')
      }
      if (beat && phase === 'flying') {
        // на землі із заведеним двигуном — оберти з повзунка (частка польотного темпу; за замовчуванням — повні)
        const top = tune.current.fl.flap * (idling ? tune.current.fl.throttle : 1)
        let speed: number
        if (slowFrom >= 0) {
          // змахи сповільнюються, тоді крила складаються (посадка) чи завмирають розкритими (планування).
          // «Без зайвих змахів»: темп тримається до кінця і падає лише до третини — крила стають у позу одразу;
          // решта кривих — до темпу моделі (наприкінці кілька повільних змахів)
          const q = slowDur > 0 ? Math.min(1, (t - slowFrom) / slowDur) : 1
          const e = tune.current.ez[slowEase]
          if (e === 'brisk') {
            const end = Math.min(slowBase, 4) // далі крила стають у позу з цим самим темпом — без ривка
            speed = end + (slowBase - end) * (1 - q ** 4)
          } else speed = 1 + (slowBase - 1) * (1 - (EASE[e] ?? EASE.smooth)(q))
          if (q >= 1) { slowFrom = -1; setWings(slowTo) }
        } else {
          // змахи розганяються до заданого темпу за «розгін» секунд. «Без зайвих змахів»: старт одразу з майже
          // половини темпу; решта кривих — від темпу моделі (на початку кілька повільних змахів)
          const p = spinDur > 0 ? Math.min(1, (t - flapFrom) / spinDur) : 1
          const e = tune.current.ez[spinEase]
          // «Без зайвих змахів»: від поточного темпу (без стрибка), але різко вгору
          speed = spinBase + (top - spinBase) * (e === 'brisk' ? 1 - (1 - p) ** 4 : (EASE[e] ?? EASE.smooth)(p))
          if (liftPending && p >= 1) { liftPending = false; liftOff() }
        }
        beat.timeScale = speed
      }
      // змах: лопать — вгору-вниз від розкритої пози, як маятник. Зупинка — щойно вона знову в розкритій позі
      // (двічі за змах)
      let flapA = 0
      if (beat && (phase === 'flying' || phase === 'settling')) {
        const prev = beatPhase
        beatPhase += (dt * Math.abs(beat.timeScale)) / FLAP_PERIOD
        if (phase === 'settling' && Math.floor(beatPhase * 2) > Math.floor(prev * 2)) {
          beatPhase = 0
          phase = 'open'
          wings()
        } else {
          beatPhase %= 1
          flapA = ((tune.current.fl.amp * Math.PI) / 180) * Math.sin(2 * Math.PI * beatPhase)
        }
      }
      // рівень верхніх і нижніх крил (повзунки): мах — навколо нього. З'являється, коли крила розкриті, і плавно
      // зникає, коли складаються
      const wingsOut = phase === 'flying' || phase === 'settling' || phase === 'open'
      levelMix += ((wingsOut ? 1 : 0) - levelMix) * Math.min(1, dt * 4)
      if (!wingsOut && levelMix < 1e-3) levelMix = 0
      const lvUp = levelMix * THREE.MathUtils.degToRad(tune.current.fl.baseUp)
      const lvLow = levelMix * THREE.MathUtils.degToRad(tune.current.fl.baseLow)
      if (isDrone) droneFrame(t, dt)
      // поворот кріплень лопатей з минулого кадру знімаємо: міксер переписує кістку, лише коли поза змінилась
      for (const r of roots) {
        if (!r.on) continue
        r.bone.quaternion.premultiply(qY.copy(r.T).invert())
        r.on = false
      }
      mixer?.update(dt)
      if (isDrone) droneAfter(t)
      // куполи з кріпленнями лопатей поверх пози моделі: рівень і змах — вгору-вниз навколо осі корпусу, прискорення —
      // назад навколо його вертикалі (з нахилом)
      if ((boostMix > 0.002 || flapA !== 0 || lvUp !== 0 || lvLow !== 0) && roots.length) {
        pitch.getWorldQuaternion(pwq)
        axis.set(0, 1, 0).applyQuaternion(pwq)
        axisX.set(1, 0, 0).applyQuaternion(pwq)
        for (const r of roots) {
          r.bone.parent!.getWorldQuaternion(pwq)
          qY.setFromAxisAngle(axis, ((tune.current.fl.sweep * Math.PI) / 180) * boostMix * r.sign)
          qY.multiply(qF.setFromAxisAngle(axisX, (flapA + (r.upper ? lvUp : lvLow)) * r.lift)) // спершу вгору-вниз (від рівня), тоді назад
          r.T.copy(pwq).invert().multiply(qY).multiply(pwq) // у просторі батька: q' = P⁻¹·W·P·q
          r.bone.quaternion.premultiply(r.T)
          r.on = true
        }
      }
      // кістки куполів крутимо (кліп складання, змахи, відведення) навколо центру купола, а не власного початку:
      // зсуваємо кістку так, щоб центр купола лишався в центрі гнізда
      for (const h of hubFix) h.bone.position.copy(h.at).sub(hubTmp.copy(h.c).multiply(h.bone.scale).applyQuaternion(h.bone.quaternion))
      // зліт: ще набираючи висоту, орні опускає ніс і рушає вперед
      if (turnAt >= 0 && t >= turnAt) {
        turnAt = -1
        if (flying) settle(turnMove)
      }
      const q = Math.min(1, (t - liftAt) / liftDur)
      lift.position.y = liftFrom + (targetLift - liftFrom) * liftEase(q) // крива — з вибору дії (зліт, посадка)
      if (flying && climbing && q >= 1) {
        climbing = false
        if (!high) {
          high = true
          setAloft(true)
          if (seqNow === 'takeoff') setSeq(null) // зліт завершився: на висоті
          if (autoScan) {
            autoScan = false
            setScan(true) // автопоказ: сканер — щойно набрав висоту
            if (isDrone) dronePatrol(true) // дрон одразу рушає в патруль над дюнами
          }
        }
      }
      const pq = Math.min(1, (t - pitchAt) / pitchDur)
      const sq = pitchEase(pq)
      pitchNow = pitchFrom + (pitchTo - pitchFrom) * sq
      pitch.rotation.z = pitchNow
      // дюни: швидкість — тією ж кривою, що й нахил; на посадці — гальмування рівно до точки, де орні сідає
      if (landFrom >= 0) {
        const lq = Math.min(1, (t - landFrom) / landMove)
        scroll = landS0 + landV0 * landMove * coast(landEase, lq) // скільки пропливло за гальмування цією кривою
        vel = landV0 * (1 - landEase(lq))
        if (lq >= 1) { landFrom = -1; vel = 0 }
      } else {
        vel = velFrom + (paceSpeed() - velFrom) * sq
        scroll += vel * dt
      }
      sandU.uScroll.value = scroll
      sandU.uStyle.value = tune.current.dunes === 'none' ? 2 : tune.current.dunes === 'lines' ? 1 : 0
      // на землі змінили вигляд дюн (рівна земля ↔ дюни) — орні плавно стає на нову поверхню
      duneAmp = tune.current.fl.duneH
      sandU.uAmp.value = duneAmp
      sandU.uRipple.value = tune.current.fl.ripple
      const restKey = `${tune.current.dunes}|${duneAmp}`
      if (restKey !== restDunes) {
        const was = restDunes
        restDunes = restKey
        if (was && !flying && !landPending && landFrom < 0 && hull.length) {
          const rest = restAt(scroll)
          padY = rest.lift
          restRX = rest.rx
          restRZ = rest.rz
          flyTo(padY, 0.6)
        }
      }
      if (tune.current.fl.sandR !== sandR) buildSand(tune.current.fl.sandR) // дальність змінили повзунком
      // рушаючи вперед, орні наче набирає висоту: пісок опускається разом із розгоном (на зльоті — ще ні,
      // на посадці повертається, коли орні гальмує), тож у польоті між ними більше простору, а орні — в кадрі
      const up = Math.max(0, Math.min(1, (lift.position.y - padY) / (isDrone ? Math.max(0.2, tune.current.fl.dHover) : Math.max(0.3, 1.4 - padY))))
      dropMix = dropFrom + ((pace === 'stop' ? 0 : 1) - dropFrom) * sq
      sand.position.y = base - tune.current.fl.drop * dropMix
      // посадка: поки гальмує, ніс трохи задирається, до кінця гальмування — знову рівно
      if (landFrom >= 0) pitch.rotation.z = pitchNow - FLARE * Math.sin(Math.PI * Math.min(1, (t - landFrom) / landMove))
      // на піску орні стоїть на схилі: нахил під опори з'являється під кінець спуску й зникає на зльоті
      pitch.rotation.z += restRZ * (1 - up)
      pitch.rotation.x = restRX * (1 - up)
      glideMix += ((gliding ? 1 : 0) - glideMix) * Math.min(1, dt * 0.7)
      boostMix += ((boost ? 1 : 0) - boostMix) * Math.min(1, dt * 1.5)
      // смуги — лише коли крила вже завмерли; щойно рушили (двигун, посадка) — гаснуть швидко
      const still = gliding && phase === 'open'
      trailMix += ((still ? 1 : 0) - trailMix) * Math.min(1, dt * (still ? 2.5 : 9))
      if (!reduce && isDrone) {
        // дрон висить на турбінах: м'яко погойдується вгору-вниз і злегка хитається — лише в повітрі
        const f = tune.current.fl
        const w = t * f.dBobRate
        orni.position.y = (Math.sin(w * 1.7) * f.dBob + Math.sin(w * 0.63 + 1) * f.dBob * 0.4) * up
        orni.rotation.x = Math.sin(w * 0.9) * 0.035 * up
        orni.rotation.z = Math.sin(w * 0.71 + 0.5) * 0.025 * up
      } else if (!reduce) {
        // погойдування росте разом із висотою (на піску — ні), а не вмикається стрибком у момент відриву;
        // у плануванні — повільніше й ширше, як на висхідних потоках; у прискоренні — дрібне тремтіння
        const g = glideMix
        const air = up
        const b = boostMix
        orni.position.y = (Math.sin(t * 1.2) * 0.1 * (1 - g) + Math.sin(t * 0.55) * 0.16 * g) * air + Math.sin(t * 27) * 0.003 * b
        orni.rotation.x = (Math.sin(t * 0.8) * 0.02 * (1 - g) + Math.sin(t * 0.42) * 0.07 * g) * air + Math.sin(t * 31) * 0.0015 * b
        orni.rotation.z = Math.sin(t * 0.33) * 0.02 * g
      }
      // ривок уперед (−X) на старті прискорення, далі орні тримається трохи попереду
      const kick = Math.max(0, t - boostAt) / 0.5
      orni.position.x = -0.3 * boostMix - (boost ? 0.3 * kick * Math.exp(1 - kick) : 0)
      // ширший кут камери — відчуття швидкості
      const fov = 30 + 3.5 * boostMix
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix() }
      // тінь орні на піску: падає від ключового світла, з висотою розпливається й блідне
      const alt = Math.max(0, base + lift.position.y + orni.position.y - sand.position.y - terrainH(orni.position.x - scroll, 0)) + 1
      sandU.uShadow.value.set(orni.position.x - 0.62 * alt, -0.75 * alt, 1.3 + alt * 0.35, 0.6 / (1 + alt * 0.5))
      updateTrails(t, trailMix * (0.45 + 0.55 * boostMix))
      updateDust(dt)
      // сканер: плавно з'являється й гасне, кільця біжать по дюнах, поки увімкнено
      const fade = scanOn ? Math.min(1, (t - scanFrom) * 1.5) : Math.max(0, 1 - (t - scanOff) * 2.5)
      updateScan(fade, t)
      controls.update()
      if (benchRun) {
        benchFrame(cpu0)
        raf = requestAnimationFrame(frame)
        return
      }
      const mv = moving()
      if (mv || dirty) {
        dirty = false
        idleShown = false
        renderer.render(scene, camera)
        perfTick(performance.now() - cpu0, rawDt)
      } else {
        perfFrom = 0 // стоїть — швидкість не міряємо (вікно заміру — заново, коли рушить)
        const el = fpsEl.current
        if (!idleShown && el && tune.current.showFps && !benchHold) el.textContent = idleText()
        idleShown = true
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      disposed = true
      later.forEach(clearTimeout)
      cancelAnimationFrame(raf)
      io.disconnect()
      full.disconnect()
      ro.disconnect()
      controls.dispose()
      if (mixer) {
        mixer.removeEventListener('finished', onFinished)
        mixer.stopAllAction()
      }
      // матеріали й їхні текстури (моделі GLB несуть свої): інакше кожна зміна моделі лишає їх у пам'яті відеокарти
      const freeMat = (m: THREE.Material) => {
        for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose()
        m.dispose()
      }
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        mesh.geometry?.dispose?.()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach(freeMat)
        else if (mat) freeMat(mat)
      })
      envTex.dispose()
      pmrem.dispose()
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored)
      renderer.dispose()
      // контекст віддаємо одразу, а не коли прибере збирач сміття: у Safari на iPhone їх мало, і після кількох змін
      // моделі нова сцена лишалась чорною
      renderer.forceContextLoss()
      renderer.domElement.remove()
      api.current = null
    }
  }, [onMissing, model, lite, start])

  const btn = 'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'
  const dust = 'border-[rgb(235_220_196/0.25)] text-[rgb(235_220_196)] enabled:hover:bg-[rgb(235_220_196/0.08)]'
  const on = 'border-[rgb(238_147_64/0.7)] bg-[rgb(238_147_64/0.15)] text-[rgb(255_200_150)]'
  const list = ANIMS.filter((a) => a.i < anims)
  /** на дюнах орні стоїть на опорах — прибрати їх можна лише в повітрі (або коли дюн немає) */
  const gearStuck = !airborne && dunes !== 'none' && !state.gear
  /** поверх сцени: підпис зльоту чи посадки і HUD сканера — там, де зараз сцена */
  const overlays = (
    <>
      {showFps && (
        <div className="absolute right-[3%] top-[4%] z-10 flex max-w-[94%] flex-col items-end gap-1">
          <span ref={fpsEl} aria-hidden className="pointer-events-none whitespace-pre-line rounded-md bg-[rgb(12_9_7/0.78)] px-2 py-1 font-mono text-[11px] leading-snug text-[rgb(190_225_255)]">
            FPS…
          </span>
          <button
            type="button"
            disabled={bench === 'running'}
            onClick={() => api.current?.bench()}
            className="rounded-md border border-[rgb(150_210_255/0.35)] bg-[rgb(12_20_30/0.82)] px-2 py-0.5 text-[11px] text-[rgb(190_225_255)] hover:border-[rgb(150_210_255/0.7)] disabled:opacity-60"
          >
            {bench === 'running' ? t('Заміряю…') : bench === 'done' ? t('Сховати замір') : t('Заміряти швидкість')}
          </button>
        </div>
      )}
      {/* зліт чи посадка — підпис поверх сцени: у потоці він розтягував блок і той підстрибував */}
      <p aria-live="polite" className={cn('pointer-events-none absolute left-[3%] top-[4%] max-w-[55%] rounded-md bg-[rgb(12_9_7/0.7)] px-2.5 py-1 text-[11.5px] text-[rgb(235_220_196/0.85)] transition-opacity', seq ? 'opacity-100' : 'opacity-0')}>
        {seq === 'takeoff'
          ? t('Іде зліт — керування повернеться на висоті')
          : seq === 'landing'
            ? model === 'drone' ? t('Іде посадка — керування повернеться, коли дрон стане на ноги') : t('Іде посадка — керування повернеться, коли орні сяде')
            : seq === 'wake'
              ? t('Дрон прокидається')
              : seq === 'sleep'
                ? t('Дрон засинає')
                : seq === 'demo'
                  ? t('Кліп моделі цілком — 25 с')
                  : ''}
      </p>
      <div className="orni-hud pointer-events-none absolute bottom-[6%] left-[3%] grid gap-1 rounded-lg border border-[rgb(150_210_255/0.35)] bg-[rgb(12_20_30/0.82)] px-3 py-2 font-mono text-[11.5px] text-[rgb(190_225_255)]" aria-live="polite">
      {scanning &&
        scan.map((l, i) => (
          <div key={l.label} className="orni-hud-line" style={{ animationDelay: `${0.5 + i * 0.35}s` }}>
            <span className="text-[rgb(150_210_255/0.7)]">{l.label}</span> {l.value}
          </div>
        ))}
      </div>
    </>
  )
  /**
   * Пульт — у порядку важливості: що не влазить у рядок, іде в меню «⋯» з кінця (першими — крила, опори, рампа)
   */
  const actions: { key: string; el: ReactElement }[] = [
    {
      key: 'fly',
      el: (
        <button type="button" onClick={() => (airborne ? api.current?.land() : api.current?.takeoff())} className={cn(btn, 'border-transparent bg-spice font-semibold text-on-spice hover:bg-spice/90')}>
          {airborne ? <PlaneLanding size={15} /> : <PlaneTakeoff size={15} />} {airborne ? t('Сісти') : t('Злетіти')}
        </button>
      ),
    },
    ...(!airborne
      ? [
          {
            key: 'engine',
            el: (
              <button
                type="button"
                disabled={!!seq}
                aria-pressed={idling}
                title={idling ? t('Змахи сповільняться, крила складуться') : t('Крила розкриються й махатимуть, орні лишиться на землі')}
                onClick={() => api.current?.ignite(!idling)}
                className={cn(btn, idling ? on : dust)}
              >
                <Power size={15} /> {idling ? t('Заглушити двигун') : t('Завести двигун')}
              </button>
            ),
          },
        ]
      : []),
    {
      key: 'glide',
      el: (
        <button
          type="button"
          disabled={!aloft || !!seq}
          aria-pressed={gliding}
          title={gliding ? t('Змахи розженуться, орні набере висоту') : aloft ? t('Режим стерв\'ятника: двигун вимкнено, орні планує на розкритих крилах') : t('Планувати можна, коли орні набере висоту')}
          onClick={() => api.current?.glide(!gliding)}
          className={cn(btn, gliding ? on : dust)}
        >
          <Bird size={15} /> {gliding ? t('Запустити двигун') : t('Планувати')}
        </button>
      ),
    },
    ...(aloft
      ? [
          {
            key: 'boost',
            el: (
              <button
                type="button"
                disabled={!!seq}
                aria-pressed={boosting}
                title={boosting ? t('Скинути швидкість — крила повернуться на місце') : t('Крила відводяться назад, орні пірнає й набирає швидкість')}
                onClick={() => api.current?.boost(!boosting)}
                className={cn(btn, boosting ? on : dust)}
              >
                <Zap size={15} /> {boosting ? t('Скинути швидкість') : t('Прискорення')}
              </button>
            ),
          },
        ]
      : []),
    {
      key: 'scan',
      el: (
        <button
          type="button"
          disabled={!aloft}
          aria-pressed={scanning}
          title={aloft ? undefined : airborne ? t('Сканер — коли орні набере висоту') : t('Сканер працює в польоті')}
          onClick={() => api.current?.scan(!scanning)}
          className={cn(btn, scanning ? 'border-[rgb(150_210_255/0.8)] bg-[rgb(150_210_255/0.16)] text-[rgb(215_238_255)]' : 'border-[rgb(150_210_255/0.4)] text-[rgb(190_225_255)] enabled:hover:bg-[rgb(150_210_255/0.1)]')}
        >
          <Radar size={15} /> {scanning ? t('Вимкнути сканер') : t('Сканувати пісок')}
        </button>
      ),
    },
    {
      key: 'wings',
      el: (
        <button
          type="button"
          disabled={airborne || idling || !!seq}
          aria-pressed={state.wings}
          title={idling ? t('Поки двигун працює, крила махають — спершу заглуши') : undefined}
          onClick={() => api.current?.toggle('wings')}
          className={cn(btn, state.wings ? on : dust)}
        >
          <Feather size={15} /> {state.wings ? t('Скласти крила') : t('Розкрити крила')}
        </button>
      ),
    },
    {
      key: 'gear',
      el: (
        <button
          type="button"
          disabled={!!seq || gearStuck}
          aria-pressed={state.gear}
          title={gearStuck ? t('Орні стоїть на опорах — прибрати їх можна в повітрі') : undefined}
          onClick={() => api.current?.toggle('gear')}
          className={cn(btn, state.gear ? on : dust)}
        >
          <Footprints size={15} /> {state.gear ? t('Випустити опори') : t('Прибрати опори')}
        </button>
      ),
    },
    {
      key: 'ramp',
      el: (
        <button type="button" disabled={!!seq} aria-pressed={state.ramp} onClick={() => api.current?.toggle('ramp')} className={cn(btn, state.ramp ? on : dust)}>
          <DoorOpen size={15} /> {state.ramp ? t('Відкрити рампу') : t('Закрити рампу')}
        </button>
      ),
    },
  ]
  /** пульт дрона: зліт/посадка, сон, патруль, сканер */
  const droneActions: { key: string; el: ReactElement }[] = [
    {
      key: 'fly',
      el: (
        <button type="button" disabled={!!seq && seq !== 'takeoff' && seq !== 'landing'} onClick={() => (airborne ? api.current?.land() : api.current?.takeoff())} className={cn(btn, 'border-transparent bg-spice font-semibold text-on-spice hover:bg-spice/90')}>
          {airborne ? <PlaneLanding size={15} /> : <PlaneTakeoff size={15} />} {airborne ? t('Сісти') : t('Злетіти')}
        </button>
      ),
    },
    ...(!airborne
      ? [
          {
            key: 'wake',
            el: (
              <button
                type="button"
                disabled={!!seq && seq !== 'wake' && seq !== 'sleep'}
                aria-pressed={awake}
                title={awake ? t('Присяде, турбіни зупиняться, око згасне') : t('Встане на ноги, турбіни розкрутяться, око засвітиться')}
                onClick={() => api.current?.wake(!awake)}
                className={cn(btn, awake ? on : dust)}
              >
                {awake ? <Moon size={15} /> : <Sun size={15} />} {awake ? t('Заснути') : t('Прокинутися')}
              </button>
            ),
          },
        ]
      : []),
    {
      key: 'patrol',
      el: (
        <button
          type="button"
          disabled={!aloft || !!seq}
          aria-pressed={patrolling}
          title={aloft ? (patrolling ? t('Сповільниться й зависне на місці') : t('Нахилиться вперед і полетить над дюнами')) : t('Патрулювати — коли дрон набере висоту')}
          onClick={() => api.current?.patrol(!patrolling)}
          className={cn(btn, patrolling ? on : dust)}
        >
          <Route size={15} /> {patrolling ? t('Зависнути') : t('Патрулювати')}
        </button>
      ),
    },
    {
      key: 'scan',
      el: (
        <button
          type="button"
          disabled={!aloft}
          aria-pressed={scanning}
          title={aloft ? t('Око дивиться вниз, імпульси розходяться по дюнах') : airborne ? t('Сканер — коли дрон набере висоту') : t('Сканер працює в польоті')}
          onClick={() => api.current?.scan(!scanning)}
          className={cn(btn, scanning ? 'border-[rgb(150_210_255/0.8)] bg-[rgb(150_210_255/0.16)] text-[rgb(215_238_255)]' : 'border-[rgb(150_210_255/0.4)] text-[rgb(190_225_255)] enabled:hover:bg-[rgb(150_210_255/0.1)]')}
        >
          <Radar size={15} /> {scanning ? t('Вимкнути сканер') : t('Сканувати пісок')}
        </button>
      ),
    },
  ]
  const controls = <ActionBar items={model === 'drone' ? droneActions : actions} />
  /** вибір моделі — однаковий у панелі налаштувань і під сценою */
  const modelSwitch = (wide?: boolean) => (
    <span className={cn('inline-flex rounded-md border border-[rgb(235_220_196/0.2)] p-0.5', wide && 'w-full')} role="group" aria-label={t('Модель')}>
      {MODELS.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={model === v}
          onClick={() => model !== v && setModel(v)}
          className={cn('rounded px-2 py-1 text-[12.5px] transition-colors', wide && 'flex-1', model === v ? 'bg-[rgb(238_147_64/0.25)] text-[rgb(255_200_150)]' : 'text-[rgb(235_220_196/0.7)] hover:text-[rgb(235_220_196)]')}
        >
          {label}
        </button>
      ))}
    </span>
  )
  /** панель налаштувань: заголовок і розділи */
  const settings = (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-[rgb(235_220_196/0.12)] px-4 py-3">
        <SlidersHorizontal size={15} className="text-[rgb(255_200_150)]" />
        <h3 id="orni-settings" className="min-w-0 flex-1 font-display text-[14px] font-semibold">{model === 'drone' ? t('Налаштування дрона') : t('Налаштування орнітоптера')}</h3>
        <button
          type="button"
          onClick={() => setFull(false)}
          aria-label={t('Закрити')}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[rgb(235_220_196/0.2)] text-[rgb(235_220_196/0.7)] hover:text-[rgb(235_220_196)]"
        >
          <X size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        {/* розділи в порядку польоту; розгорнутий лише один — відкриття іншого згортає попередній */}
        {SECTIONS.filter((g) => !g.only || g.only === model).map((g) => (
          <details
            key={g.id}
            open={openSec === g.id}
            className="group border-b border-[rgb(235_220_196/0.1)]"
          >
            <summary onClick={(e) => pickSec(e, g.id)} className="flex cursor-pointer list-none items-center gap-2 py-3 font-display text-[13px] font-semibold text-[rgb(235_220_196/0.92)] hover:text-[rgb(255_200_150)] [&::-webkit-details-marker]:hidden">
              <ChevronRight size={14} className="shrink-0 text-[rgb(235_220_196/0.5)] transition-transform group-open:rotate-90" />
              {g.title}
            </summary>
            <div className="grid gap-3 pb-4 pl-[22px]">
              {g.items.map((it) =>
                typeof it === 'object' && 'h' in it ? (
                  <h5 key={it.h} className="-mb-1 mt-1 text-[12px] font-semibold text-[rgb(255_200_150/0.85)]">{it.h}</h5>
                ) : it === 'model' ? (
                  <div key="model" className="grid gap-1 text-[12.5px] text-[rgb(235_220_196/0.7)]">
                    {t('Модель')}
                    {modelSwitch(true)}
                  </div>
                ) : it === 'quality' ? (
                  <div key="quality" className="grid gap-1 text-[12.5px] text-[rgb(235_220_196/0.7)]">
                    {t('Якість')}
                    <span className="inline-flex w-full rounded-md border border-[rgb(235_220_196/0.2)] p-0.5" role="group" aria-label={t('Якість сцени')}>
                      {QUALITY.map(([v, label]) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={quality === v}
                          onClick={() => setQuality(v)}
                          className={cn('flex-1 rounded px-1.5 py-1 text-[12.5px] transition-colors', quality === v ? 'bg-[rgb(238_147_64/0.25)] text-[rgb(255_200_150)]' : 'hover:text-[rgb(235_220_196)]')}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                    <span className="text-[11.5px] leading-snug text-[rgb(235_220_196/0.5)]">
                      {quality === 'auto' ? t('Зараз — {tier}: {hint} Якщо кадрів бракує, сцена сама перейде нижче.', { tier: TIER_NAME[tierNow], hint: `${TIERS[tierNow].hint.charAt(0).toLowerCase()}${TIERS[tierNow].hint.slice(1)}` }) : TIERS[quality].hint}
                    </span>
                  </div>
                ) : it === 'fps' ? (
                  <button
                    key="fps"
                    type="button"
                    role="switch"
                    aria-checked={showFps}
                    onClick={() => { setShowFps(!showFps); prefSet('orni:fps', !showFps) }}
                    className="flex items-center justify-between gap-2 text-left text-[12.5px] text-[rgb(235_220_196/0.7)] hover:text-[rgb(235_220_196)]"
                  >
                    {t('Показувати FPS')}
                    <span className={cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', showFps ? 'bg-[rgb(238_147_64)]' : 'bg-[rgb(235_220_196/0.25)]')}>
                      <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-[rgb(24_17_12)] transition-[left]', showFps ? 'left-3.5' : 'left-0.5')} />
                    </span>
                  </button>
                ) : it === 'dunes' ? (
                  <div key="dunes" className="grid gap-1 text-[12.5px] text-[rgb(235_220_196/0.7)]">
                    {t('Дюни')}
                    <span className="inline-flex w-full rounded-md border border-[rgb(235_220_196/0.2)] p-0.5" role="group" aria-label={t('Вигляд дюн')}>
                      {DUNES.map(([v, label]) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={dunes === v}
                          onClick={() => {
                            setDunes(v)
                            prefSet('orni:dunes', v)
                            // на землі з прибраними опорами з'явились дюни — орні стає на опори
                            if (!airborne && v !== 'none' && state.gear) api.current?.toggle('gear')
                          }}
                          className={cn('flex-1 rounded px-2 py-1 text-[12.5px] transition-colors', dunes === v ? 'bg-[rgb(238_147_64/0.25)] text-[rgb(255_200_150)]' : 'hover:text-[rgb(235_220_196)]')}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                  </div>
                ) : (
                  <Slider
                    key={it[0]}
                    label={it[1]}
                    value={fl[it[0]]}
                    min={FLY[it[0]].min}
                    max={FLY[it[0]].max}
                    step={FLY[it[0]].step}
                    fmt={it[2]}
                    onChange={(v) => setFlight(it[0], v)}
                    curve={it[3] && { label: it[4] ?? t('Крива'), value: ez[it[3]], options: EZ[it[3]].flaps ? FLAP_EASES : MOVE_EASES, onChange: (v) => setEase(it[3]!, v) }}
                  />
                ),
              )}
            </div>
          </details>
        ))}
        <details
          open={openSec === 'anims'}
          className="group border-b border-[rgb(235_220_196/0.1)]"
        >
          <summary onClick={(e) => pickSec(e, 'anims')} className="flex cursor-pointer list-none items-center gap-2 py-3 font-display text-[13px] font-semibold text-[rgb(235_220_196/0.92)] hover:text-[rgb(255_200_150)] [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} className="shrink-0 text-[rgb(235_220_196/0.5)] transition-transform group-open:rotate-90" />
            {t('Анімації моделі')} <span className="font-sans text-[12px] font-normal text-[rgb(235_220_196/0.5)]">{model === 'drone' ? 1 : list.length}</span>
          </summary>
          <div className="grid gap-3 pb-4 pl-[22px]">
            {model === 'drone' && (
              <button
                type="button"
                disabled={airborne || !!seq}
                title={airborne ? t('Кліп — на землі: спершу посади дрон') : t('Присяде, прокинеться, злетить, зависне — і знову стане на ноги')}
                onClick={() => api.current?.demo()}
                className="inline-flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12.5px] text-[rgb(235_220_196/0.75)] enabled:hover:bg-[rgb(235_220_196/0.08)] enabled:hover:text-[rgb(235_220_196)] disabled:opacity-40"
              >
                <Film size={14} /> {t('Кліп моделі цілком (25 с)')}
              </button>
            )}
            {model === 'orni' && (['wings', 'gear', 'ramp'] as const).map((g) => (
              <div key={g}>
                <h4 className="mb-1 text-[12px] font-semibold text-[rgb(235_220_196/0.8)]">{GROUP_LABEL[g]}</h4>
                <ul className="grid gap-0.5">
                  {list.filter((a) => a.group === g).map((a) => (
                    <li key={a.i}>
                      <button
                        type="button"
                        disabled={!!seq || (g === 'wings' && (airborne || idling)) || (g === 'gear' && gearStuck)}
                        onClick={() => api.current?.play(a.i)}
                        className="w-full rounded px-2 py-1 text-left text-[12.5px] text-[rgb(235_220_196/0.75)] enabled:hover:bg-[rgb(235_220_196/0.08)] enabled:hover:text-[rgb(235_220_196)] disabled:opacity-40"
                      >
                        {a.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
        <button type="button" onClick={resetFlight} className="mt-4 text-[12px] text-[rgb(235_220_196/0.6)] underline underline-offset-2 hover:text-[rgb(235_220_196)]">
          {t('Повернути всі повзунки й криві до початкових')}
        </button>
      </div>
    </>
  )
  // сітка: модель і текст в одному рядку, пульт — під моделлю, щоб його висота не зсувала
  // ні світіння (воно на блоці моделі), ні текст праворуч
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="orni-stage">
        <div className="orni3d relative aspect-[16/10] w-full" ref={box}>
          {!ready && <div className="absolute inset-0 grid place-items-center"><DuneLoading page label={t('Завантаження моделі…')} className="text-[rgb(235_220_196/0.7)]" /></div>}
          {full && <p className="absolute inset-0 grid place-items-center text-[13px] text-[rgb(235_220_196/0.5)]">{model === 'drone' ? t('Дрон — у вікні налаштувань') : t('Орнітоптер — у вікні налаштувань')}</p>}
        </div>
        {!full && overlays}
      </div>
      {anims > 0 && (
        <div className={cn('min-w-0 lg:col-start-1 lg:row-start-2', full && 'invisible')}>
          {controls}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            {modelSwitch()}
            <button
              type="button"
              onClick={() => setFull(true)}
              aria-haspopup="dialog"
              className="inline-flex items-center gap-1.5 text-[12.5px] text-[rgb(235_220_196/0.6)] hover:text-[rgb(235_220_196)]"
            >
              <SlidersHorizontal size={14} /> {t('Налаштування й анімації')}
            </button>
          </div>
        </div>
      )}
      {full &&
        createPortal(
          // на весь екран: ліворуч сцена й пульт, праворуч панель (на телефоні — сцена згори, панель знизу)
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="orni-settings"
            className="fixed inset-0 z-[1000] flex flex-col bg-[rgb(20_14_10)] text-[rgb(235_220_196)] sm:flex-row"
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[radial-gradient(ellipse_at_45%_45%,rgb(238_147_64/0.22),transparent_65%)]">
              <div className="relative min-h-0 flex-1">
                <div ref={fullBox} className="orni3d absolute inset-0" />
                {overlays}
              </div>
              <div className="shrink-0 px-3 pb-3 pt-1">{controls}</div>
            </div>
            <aside className="flex max-h-[52dvh] min-h-0 flex-col border-t border-[rgb(235_220_196/0.15)] bg-[rgb(24_17_12/0.96)] sm:max-h-none sm:w-[400px] sm:border-l sm:border-t-0">
              {settings}
            </aside>
          </div>,
          document.body,
        )}
      {aside && <div className="lg:col-start-2 lg:row-start-1 lg:self-center">{typeof aside === 'function' ? aside(model) : aside}</div>}
    </div>
  )
}
