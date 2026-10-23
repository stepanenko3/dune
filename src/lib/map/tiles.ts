/**
 * Тайли мапи без просвітів. Масштаб мапи безперервний (zoomSnap 0), і на дробовому масштабі сусідні тайли стикуються на
 * частині пікселя, і по межах тайлів видно тонкі світлі смуги. Кожен тайл на 1 px ширший і вищий — сусіди трохи
 * накладаються, — і зі звичайним змішуванням: CSS Leaflet дає тайлам mix-blend-mode: plus-lighter, а з ним накладка
 * двох тайлів додає кольори й світиться смугою.
 */
import L from 'leaflet'

type InitTile = { _initTile(tile: HTMLElement): void }

const Gapless = L.TileLayer.extend({
  _initTile(this: L.TileLayer, tile: HTMLElement) {
    ;(L.TileLayer.prototype as unknown as InitTile)._initTile.call(this, tile)
    const size = this.getTileSize()
    tile.style.width = `${size.x + 1}px`
    tile.style.height = `${size.y + 1}px`
    tile.style.mixBlendMode = 'normal'
  },
}) as unknown as new (url: string, opts?: L.TileLayerOptions) => L.TileLayer

export const tileLayer = (url: string, opts?: L.TileLayerOptions): L.TileLayer => new Gapless(url, opts)
