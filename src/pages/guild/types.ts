/** сторінка гільдії — як її віддає GET /api/guilds/:slug (routes/guilds.mjs) */
import type { Guild, GuildRole } from '@/lib/auth'
import type { Item } from '@/lib/items'
import type { Application, GuildProfile, OwnRequest } from '@/lib/guildProfile'

export interface Member { id: string; login: string; name: string; nick: string; color: string; role: GuildRole; joined: number; seen?: number | null }
export interface GuildData {
  guild: Guild
  role: GuildRole | 'admin' | null
  rank: number
  /** картка гільдії: офіцерам — уся (з видимістю й анкетою), іншим — лише видимі блоки */
  profile: GuildProfile
  members: Member[]
  /** ліміт учасників гільдії (налаштування сайту) */
  cap: number
  /** власна заявка того, хто дивиться (стан, причина відмови, відповіді) */
  request: OwnRequest | null
  /** черга заявок — офіцерам */
  requests: Application[]
  invites: { code: string; created: number; expires: number | null; uses: number; maxUses: number | null; role: GuildRole; by: string | null; live: boolean }[]
  public: Item[]
  /** мітки гільдійної бази на мапі, які глядач бачить */
  mapBases: { id: string; title: string; map: string }[]
}
