import { describe, expect, it } from 'vitest'
import * as client from './roadmapLevels'
// @ts-expect-error — сервер на .mjs без типів
import * as server from '../../server/lib/roadmap-access.mjs'

// рівні прав у вікні «Доступ» (клієнт) мають збігатися з тими, що перевіряє сервер
describe('рівні прав роадмапу: клієнт = сервер', () => {
  const owners = ['user', 'guild', 'site'] as const
  const vis = ['private', 'guild', 'link', 'public'] as const
  it('рівні й режими за власником і видимістю', () => {
    for (const ok of owners) for (const v of vis) {
      expect(client.modesFor(v)).toEqual(server.modesFor(v))
      for (const k of client.RIGHT_KEYS) expect(client.levelsFor(k, ok, v)).toEqual(server.levelsFor(k, ok, v))
    }
  })
  it('права за видами речей', () => {
    for (const k of ['roadmap', 'base', 'build', 'calc', 'marker', 'place', 'event'] as const) expect(client.rightsFor(k)).toEqual(server.rightsFor(k))
  })
  it('типові, підрізані й чинні права', () => {
    const samples = [null, { mark: 'users', progress: 'all', edit: 'recruit', settings: 'officer', copyTo: ['guild'] }, { mark: 'nobody', seeProgress: 'member', history: 'anyone' }]
    for (const kind of ['roadmap', 'base', 'build', 'calc', 'marker', 'place', 'event'] as const) for (const ok of owners) {
      expect(client.defaultAccess(ok, kind)).toEqual(server.defaultAccess(ok, kind))
      for (const a of samples) {
        expect(client.normAccess(a as never, ok, kind)).toEqual(server.normAccess(a, ok, kind))
        for (const v of vis) expect(client.effectiveAccess(a as never, ok, v, kind)).toEqual(server.effectiveAccess(a, ok, v, kind))
      }
    }
  })
})
