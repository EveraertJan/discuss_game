// ============================================================
// THE MOVEMENT — Tilemap System
//
// Map PNG encoding (one pixel per tile):
//   R channel = tile column (tx) in tilemap_packed.png
//   G channel = tile row    (ty) in tilemap_packed.png
//   B channel = entity ID   (0=none, 1=villager, 2=elder, 255=player spawn)
//
// Source tiles are 16×16px; rendered at TILE_RENDER (48px) = 3× scale.
// ============================================================

const TILE_SIZE   = 16                    // source tile size in tilemap_packed.png
const TILE_SCALE  = 3                     // display scale factor
const TILE_RENDER = TILE_SIZE * TILE_SCALE // 48 rendered px on canvas

// Entity IDs encoded in the B channel
const ENTITY_PLAYER_SPAWN = 255
const ENTITY_VILLAGER     = 1
const ENTITY_ELDER        = 2

// ---- Async helpers ----

// Load a map PNG and decode it into { width, height, tiles, entities, playerStart }.
// tiles[row][col] = { tx, ty }
// entities       = [{ col, row, id }]
// playerStart    = { col, row } | null
function loadMapFromPNG(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = function () {
      const w = img.naturalWidth
      const h = img.naturalHeight

      const tmp = document.createElement('canvas')
      tmp.width  = w
      tmp.height = h
      const ctx  = tmp.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, w, h)

      const tiles     = []
      const entities  = []
      let playerStart = null

      for (let row = 0; row < h; row++) {
        const tileRow = []
        for (let col = 0; col < w; col++) {
          const i = (row * w + col) * 4
          const r = data[i]       // tile column (tx)
          const g = data[i + 1]   // tile row    (ty)
          const b = data[i + 2]   // entity id
          const a = data[i + 3]   // alpha (0 = empty / skip)

          tileRow.push({ tx: r, ty: g, a })

          if (b === ENTITY_PLAYER_SPAWN) {
            playerStart = { col, row }
          } else if (b > 0) {
            entities.push({ col, row, id: b })
          }
        }
        tiles.push(tileRow)
      }

      resolve({ width: w, height: h, tiles, entities, playerStart })
    }
    img.onerror = () => reject(new Error('Could not load map: ' + src))
    img.src = src
  })
}

// Load an Image element via Promise
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image: ' + src))
    img.src = src
  })
}

// Load a collision PNG and return a 2-D boolean array.
// collisionData[row][col] === true means that tile is impassable.
// Any pixel that is opaque and near-black is treated as a wall.
function loadCollisionFromPNG(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = function () {
      const w = img.naturalWidth
      const h = img.naturalHeight
      const tmp = document.createElement('canvas')
      tmp.width  = w
      tmp.height = h
      const ctx  = tmp.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, w, h)

      const rows = []
      for (let row = 0; row < h; row++) {
        const cols = []
        for (let col = 0; col < w; col++) {
          const i = (row * w + col) * 4
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
          cols.push(a > 128 && r < 30 && g < 30 && b < 30)
        }
        rows.push(cols)
      }
      resolve(rows)
    }
    img.onerror = () => reject(new Error('Could not load collision map: ' + src))
    img.src = src
  })
}

// ---- TilemapRenderer ----
// Participates in the movables / renderables arrays like any other game object.
// position is mutated each frame by the scrolling system.
class TilemapRenderer {
  // skipTransparent: when true, tiles with a === 0 are not drawn (used for object layers)
  // tileFilter: optional (tile) => bool — return false to skip a tile
  constructor({ tilemapImage, mapData, startX, startY, skipTransparent = false, tileFilter = null }) {
    this.tilemapImage    = tilemapImage
    this.mapData         = mapData
    this.position        = { x: startX, y: startY }
    this.skipTransparent = skipTransparent
    this.tileFilter      = tileFilter
    // Stubs required by movables / collision checks
    this.width  = 0
    this.height = 0
  }

  draw() {
    c.imageSmoothingEnabled = false // pixel-art nearest-neighbour

    const { tiles, width: mapW, height: mapH } = this.mapData
    const ox = this.position.x
    const oy = this.position.y

    // Only render tiles currently visible on the canvas
    const colStart = Math.max(0, Math.floor(-ox / TILE_RENDER))
    const colEnd   = Math.min(mapW, Math.ceil((canvas.width  - ox) / TILE_RENDER) + 1)
    const rowStart = Math.max(0, Math.floor(-oy / TILE_RENDER))
    const rowEnd   = Math.min(mapH, Math.ceil((canvas.height - oy) / TILE_RENDER) + 1)

    for (let row = rowStart; row < rowEnd; row++) {
      for (let col = colStart; col < colEnd; col++) {
        const tile = tiles[row][col]
        const { tx, ty, a } = tile
        if (this.skipTransparent && a === 0) continue
        if (this.tileFilter && !this.tileFilter(tile)) continue
        c.drawImage(
          this.tilemapImage,
          tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE,
          Math.floor(ox + col * TILE_RENDER),
          Math.floor(oy + row * TILE_RENDER),
          TILE_RENDER, TILE_RENDER
        )
      }
    }
  }
}
