// ============================================================
// THE MOVEMENT — Main Game Script
// ============================================================

// ---- Canvas resize ----
function resizeCanvas() {
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight
  // Re-centre player sprite if the game is already running
  if (player) {
    player.position.x = canvas.width  / 2 - 192 / 4 / 2
    player.position.y = canvas.height / 2 - 68  / 2
  }
}
window.addEventListener('resize', resizeCanvas)


// ---- Argument files (loaded from GitHub) ----
window.argumentData  = null   // set per-debate in battleScene.js
window.argumentFiles = []     // all files fetched from the repo
window.movementCount = 0
window.villagerTotal = 0

;(async function loadArgumentsFromGitHub() {
  const API  = 'https://api.github.com/repos/EveraertJan/arguments/contents/maps'
  const RAW  = 'https://raw.githubusercontent.com/EveraertJan/arguments/main/maps/'
  const statusEl = document.querySelector('#fileStatus')

  try {
    const listing = await fetch(API).then(r => r.json())
    const jsonFiles = listing.filter(f => f.name.endsWith('.json'))

    statusEl.textContent = `loading ${jsonFiles.length} argument file${jsonFiles.length !== 1 ? 's' : ''}…`

    const loaded = await Promise.all(
      jsonFiles.map(f => fetch(RAW + encodeURIComponent(f.name)).then(r => r.json()))
    )

    window.argumentFiles = loaded.filter(d => d.nodes && Array.isArray(d.nodes))

    statusEl.textContent  = `✓ ${window.argumentFiles.length} argument file${window.argumentFiles.length !== 1 ? 's' : ''} loaded`
    statusEl.classList.add('loaded')
    checkStartReady()
  } catch (err) {
    statusEl.textContent = '✗ could not load arguments from GitHub'
    console.warn('GitHub argument fetch failed:', err)
  }
})()

// ---- Canvas setup ----
const canvas = document.querySelector('canvas')
const c      = canvas.getContext('2d')
canvas.width  = window.innerWidth
canvas.height = window.innerHeight

// ---- Player sprites ----
const playerDownImage  = new Image(); playerDownImage.src  = './img/playerDown.png'
const playerUpImage    = new Image(); playerUpImage.src    = './img/playerUp.png'
const playerLeftImage  = new Image(); playerLeftImage.src  = './img/playerLeft.png'
const playerRightImage = new Image(); playerRightImage.src = './img/playerRight.png'

// ---- NPC sprites ----
const villagerImg = new Image(); villagerImg.src = './img/villager/Idle.png'
const oldManImg   = new Image(); oldManImg.src   = './img/oldMan/Idle.png'

// ---- NPC name pool ----
const villagerNames = [
  'Emma','Lucas','Sophie','Tom','Anna',
  'Marc','Julie','Peter','Sara','Lena','Felix','Nora'
]
let nameIndex = 0

// ---- Game state (set by initGame) ----
let tilemapRenderer = null
let characters      = []
let player          = null
let movables        = []
let renderables     = []

const battle = { initiated: false }
let animationId

// ---- Asset loading ----
let assetsLoaded   = false
let _mapData       = null
let _tilemapImg    = null
let _collisionData = null
let _elementsData  = null   // decoded like tilemap — R=tx, G=ty, A=0 means empty
let _occlusionData = null   // same encoding, drawn above the player

Promise.all([
  loadMapFromPNG('./level/tilemap.png'),
  loadImage('./img/kenney_rpg-urban-pack/Tilemap/tilemap_packed.png'),
  loadCollisionFromPNG('./level/collision.png'),
  loadMapFromPNG('./level/elements.png'),
  loadMapFromPNG('./level/occlusion.png'),
]).then(([mapData, tilemapImg, collisionData, elementsData, occlusionData]) => {
  _mapData       = mapData
  _tilemapImg    = tilemapImg
  _collisionData = collisionData
  _elementsData  = elementsData
  _occlusionData = occlusionData
  assetsLoaded   = true
  checkStartReady()
}).catch(err => {
  console.warn('Tilemap assets failed to load:', err.message)
  assetsLoaded = true   // allow start in fallback mode
  checkStartReady()
})

function checkStartReady() {
  if (window.argumentFiles.length > 0 && assetsLoaded) {
    document.querySelector('#startBtn').classList.add('ready')
  }
}

// ---- Start button ----
document.querySelector('#startBtn').addEventListener('click', function () {
  if (!window.argumentFiles.length) return
  document.querySelector('#startScreen').style.display = 'none'
  document.querySelector('#touchControls').style.display = 'block'
  try { audio.Map.play() } catch (_) {}
  initGame()
})

// ---- Init game world from loaded assets ----
function initGame() {
  const mapData    = _mapData
  const tilemapImg = _tilemapImg

  // Camera offset: place the map so the player spawn tile is centred on canvas.
  // Player sprite is always drawn at canvas centre.
  let spawnCol = 8
  let spawnRow = 8
  if (mapData && mapData.playerStart) {
    spawnCol = mapData.playerStart.col
    spawnRow = mapData.playerStart.row
  }

  const mapStartX = Math.round(canvas.width  / 2 - spawnCol * TILE_RENDER - TILE_RENDER / 2)
  const mapStartY = Math.round(canvas.height / 2 - spawnRow * TILE_RENDER - TILE_RENDER / 2)

  // Player sprite centred on canvas
  player = new Sprite({
    position: {
      x: canvas.width  / 2 - 192 / 4 / 2,
      y: canvas.height / 2 - 68  / 2
    },
    image:  playerDownImage,
    frames: { max: 3, hold: 10 },
    sprites: { up: playerUpImage, left: playerLeftImage, right: playerRightImage, down: playerDownImage }
  })

  // Tilemap renderer
  if (mapData && tilemapImg) {
    tilemapRenderer = new TilemapRenderer({
      tilemapImage: tilemapImg,
      mapData,
      startX: mapStartX,
      startY: mapStartY
    })
  }

  // Objects layer — static tiles only (tx < 23); villager tiles are spawned as characters below
  const elementsRenderer = (_elementsData && tilemapImg)
    ? new TilemapRenderer({
        tilemapImage: tilemapImg,
        mapData: _elementsData,
        startX: mapStartX,
        startY: mapStartY,
        skipTransparent: true,
        tileFilter: tile => tile.tx < 23,
      })
    : null

  // Occlusion layer — same tileset, drawn above the player
  const occlusionRenderer = (_occlusionData && tilemapImg)
    ? new TilemapRenderer({
        tilemapImage: tilemapImg,
        mapData: _occlusionData,
        startX: mapStartX,
        startY: mapStartY,
        skipTransparent: true,
      })
    : null

  // Characters from map entities (tilemap.png B-channel) + villager tiles from elements.png
  characters = []

  if (mapData) {
    mapData.entities.forEach(entity => {
      const wx = mapStartX + entity.col * TILE_RENDER
      const wy = mapStartY + entity.row * TILE_RENDER

      if (entity.id === ENTITY_VILLAGER) {
        const npcName = villagerNames[nameIndex++ % villagerNames.length]
        characters.push(new Character({
          position: { x: wx, y: wy },
          image: villagerImg, frames: { max: 4, hold: 60 },
          scale: 3, animate: true, debatable: true, name: npcName,
          dialogue: ['...']
        }))
      } else if (entity.id === ENTITY_ELDER) {
        characters.push(new Character({
          position: { x: wx, y: wy },
          image: oldManImg, frames: { max: 4, hold: 60 },
          scale: 3, animate: true, debatable: false, name: 'Elder',
          dialogue: [
            'Walk up to a villager and press A / SPACE.',
            'Pick OBJECTION to counter their claims.',
            'Fill the conviction bar to win them over!'
          ]
        }))
      }
    })
  }

  if (_elementsData) {
    _elementsData.tiles.forEach((tileRow, row) => {
      tileRow.forEach((tile, col) => {
        if (tile.a === 0 || tile.tx < 23) return
        const wx = mapStartX + col * TILE_RENDER
        const wy = mapStartY + row * TILE_RENDER
        const npcName = villagerNames[nameIndex++ % villagerNames.length]
        const character = new Character({
          position: { x: wx, y: wy },
          image: villagerImg, frames: { max: 4, hold: 60 },
          scale: 3, animate: true, debatable: true, name: npcName,
          dialogue: ['...'],
          tileX: tile.tx,
          tileY: tile.ty,
        })
        // Randomly pre-convince some NPCs up to 50 %
        character.conviction = Math.floor(Math.random() * 51)
        characters.push(character)
      })
    })
  }

  // Expose total debatable villager count for the HUD
  window.villagerTotal = characters.filter(ch => ch.debatable).length

  // Build movables / renderables lists
  // All world-space objects must be in movables so the camera scroll applies to them.
  movables = [tilemapRenderer, elementsRenderer, occlusionRenderer, ...characters].filter(Boolean)

  // Draw order: tilemap → objects → NPCs → player → occlusion (draws over player)
  renderables = [tilemapRenderer, elementsRenderer, ...characters, player, occlusionRenderer].filter(Boolean)

  // Kick off the game loop
  animate()
}

// ---- Collision check against the collision PNG ----
// dx / dy are the deltas that would be applied to tilemapRenderer.position.
// Returns true if the move should be blocked.
function wouldCollide(dx, dy) {
  if (!_collisionData || !tilemapRenderer) return false

  // Player feet centre on canvas (a few pixels below sprite centre)
  const cx = canvas.width  / 2
  const cy = canvas.height / 2 + 20

  // After the map moves by (dx, dy) the player's world position becomes:
  //   worldX = cx - (mapX + dx)
  //   worldY = cy - (mapY + dy)
  const worldX = cx - tilemapRenderer.position.x - dx
  const worldY = cy - tilemapRenderer.position.y - dy

  // Two check-points on the leading edge of the player hitbox
  const hw = 10  // half-width
  const hh =  8  // half-height of feet zone
  let pts
  if      (dy > 0) pts = [{ x: worldX - hw, y: worldY - hh }, { x: worldX + hw, y: worldY - hh }] // up
  else if (dy < 0) pts = [{ x: worldX - hw, y: worldY + hh }, { x: worldX + hw, y: worldY + hh }] // down
  else if (dx > 0) pts = [{ x: worldX - hw, y: worldY - hh }, { x: worldX - hw, y: worldY + hh }] // left
  else             pts = [{ x: worldX + hw, y: worldY - hh }, { x: worldX + hw, y: worldY + hh }] // right

  for (const pt of pts) {
    const col = Math.floor(pt.x / TILE_RENDER)
    const row = Math.floor(pt.y / TILE_RENDER)
    if (row < 0 || row >= _collisionData.length)    return true
    if (col < 0 || col >= _collisionData[0].length) return true
    if (_collisionData[row][col]) return true
  }
  return false
}

// ---- Animation loop ----
function animate() {
  animationId = window.requestAnimationFrame(animate)

  // Fallback background when tilemap is unavailable
  if (!tilemapRenderer) {
    c.fillStyle = '#2d6a4f'
    c.fillRect(0, 0, canvas.width, canvas.height)
  }

  renderables.forEach(r => r.draw())

  // Draw ✓ badge above convinced NPCs
  characters.forEach(char => {
    if (char.convinced) {
      c.save()
      c.font = 'bold 18px Arial'
      c.fillStyle = '#4CAF50'
      c.fillText('✓', char.position.x + (char.width || 48) / 2 - 6, char.position.y - 8)
      c.restore()
    }
  })

  player.animate = false
  if (battle.initiated) return

  if (keys.w.pressed && lastKey === 'w') {
    player.animate = true; player.image = player.sprites.up
    checkForCharacterCollision({ characters, player })
    if (!wouldCollide(0, 3))  movables.forEach(m => m.position.y += 3)

  } else if (keys.a.pressed && lastKey === 'a') {
    player.animate = true; player.image = player.sprites.left
    checkForCharacterCollision({ characters, player })
    if (!wouldCollide(3, 0))  movables.forEach(m => m.position.x += 3)

  } else if (keys.s.pressed && lastKey === 's') {
    player.animate = true; player.image = player.sprites.down
    checkForCharacterCollision({ characters, player })
    if (!wouldCollide(0, -3)) movables.forEach(m => m.position.y -= 3)

  } else if (keys.d.pressed && lastKey === 'd') {
    player.animate = true; player.image = player.sprites.right
    checkForCharacterCollision({ characters, player })
    if (!wouldCollide(-3, 0)) movables.forEach(m => m.position.x -= 3)
  }
}

// ---- Space / Action handler (shared by keyboard + touch) ----
function handleSpacePress() {
  if (battle.initiated) return

  if (player.isInteracting) {
    player.interactionAsset.dialogueIndex++
    const { dialogueIndex, dialogue } = player.interactionAsset
    if (dialogueIndex <= dialogue.length - 1) {
      document.querySelector('#characterDialogueBox').innerHTML =
        player.interactionAsset.dialogue[dialogueIndex] +
        '<div style="font-size:7px;color:#bbb;position:absolute;bottom:8px;right:12px;">tap / SPACE to continue</div>'
      return
    }
    player.isInteracting = false
    player.interactionAsset.dialogueIndex = 0
    document.querySelector('#characterDialogueBox').style.display = 'none'
    return
  }

  if (!player.interactionAsset) return
  const target = player.interactionAsset

  if (target.debatable) {
    if (target.convinced) {
      document.querySelector('#characterDialogueBox').innerHTML =
        target.name + ' is already with the movement!'
      document.querySelector('#characterDialogueBox').style.display = 'flex'
      player.isInteracting = true
      return
    }
    if (!window.argumentFiles.length) {
      document.querySelector('#characterDialogueBox').innerHTML =
        'Argument files are still loading…'
      document.querySelector('#characterDialogueBox').style.display = 'flex'
      player.isInteracting = true
      return
    }
    document.querySelector('#characterDialogueBox').style.display = 'none'
    player.isInteracting = false
    triggerDebate(target)
    return
  }

  // Regular NPC — simple dialogue
  document.querySelector('#characterDialogueBox').innerHTML =
    target.dialogue[0] +
    '<div style="font-size:7px;color:#bbb;position:absolute;bottom:8px;right:12px;">tap / SPACE to continue</div>'
  document.querySelector('#characterDialogueBox').style.display = 'flex'
  player.isInteracting = true
}

// Make dialogue box tappable on mobile
document.querySelector('#characterDialogueBox').addEventListener('click', handleSpacePress)

// ---- Debate trigger ----
function triggerDebate(character) {
  window.cancelAnimationFrame(animationId)
  battle.initiated = true
  document.querySelector('#touchControls').style.display = 'none'
  try { audio.Map.stop() } catch (_) {}
  try { audio.initBattle.play() } catch (_) {}

  gsap.to('#overlappingDiv', {
    opacity: 1, repeat: 3, yoyo: true, duration: 0.4,
    onComplete() {
      gsap.to('#overlappingDiv', {
        opacity: 1, duration: 0.4,
        onComplete() {
          initDebate(character)
          animateBattle()
          gsap.to('#overlappingDiv', { opacity: 0, duration: 0.4 })
        }
      })
    }
  })
}

// ---- Town-square gathering ----
// Convinced villagers are relocated to random free cells between (34,49)–(39,52).
const _townSquareOccupied = new Set()

function moveToTownSquare(character) {
  const COL_MIN = 34, COL_MAX = 39
  const ROW_MIN = 49, ROW_MAX = 52

  const free = []
  for (let row = ROW_MIN; row <= ROW_MAX; row++) {
    for (let col = COL_MIN; col <= COL_MAX; col++) {
      if (!_townSquareOccupied.has(`${col},${row}`)) free.push({ col, row })
    }
  }
  if (!free.length || !tilemapRenderer) return

  const { col, row } = free[Math.floor(Math.random() * free.length)]
  _townSquareOccupied.add(`${col},${row}`)

  character.position.x = tilemapRenderer.position.x + col * TILE_RENDER
  character.position.y = tilemapRenderer.position.y + row * TILE_RENDER
}

// Called by battleScene.js exitDebate() to restore D-pad
function showTouchControls() {
  document.querySelector('#touchControls').style.display = 'block'
}

// Called by battleScene.js exitDebate() after every debate
function checkVictory() {
  const debatable = characters.filter(ch => ch.debatable)
  if (debatable.length === 0) return
  if (!debatable.every(ch => ch.convinced)) return

  // All villagers convinced — stop the world and show victory
  cancelAnimationFrame(animationId)
  try { audio.Map && audio.Map.stop() } catch (_) {}
  document.querySelector('#touchControls').style.display = 'none'
  document.querySelector('#victoryCount').textContent = debatable.length
  document.querySelector('#victoryScreen').style.display = 'flex'
}

// ---- Keyboard input ----
const keys = { w:{pressed:false}, a:{pressed:false}, s:{pressed:false}, d:{pressed:false} }
let lastKey = ''

window.addEventListener('keydown', e => {
  switch (e.key) {
    case ' ': handleSpacePress(); break
    case 'w': keys.w.pressed = true; lastKey = 'w'; break
    case 'a': keys.a.pressed = true; lastKey = 'a'; break
    case 's': keys.s.pressed = true; lastKey = 's'; break
    case 'd': keys.d.pressed = true; lastKey = 'd'; break
  }
})

window.addEventListener('keyup', e => {
  switch (e.key) {
    case 'w': keys.w.pressed = false; break
    case 'a': keys.a.pressed = false; break
    case 's': keys.s.pressed = false; break
    case 'd': keys.d.pressed = false; break
  }
})

// ---- Touch D-pad ----
const dpadMap = {
  'dpad-up':    'w',
  'dpad-left':  'a',
  'dpad-right': 'd',
  'dpad-down':  's'
}

function vibrate() {
  try { navigator.vibrate && navigator.vibrate(8) } catch (_) {}
}

Object.entries(dpadMap).forEach(([id, key]) => {
  const btn = document.getElementById(id)
  if (!btn) return

  const start = e => {
    e.preventDefault()
    keys[key].pressed = true
    lastKey = key
    vibrate()
  }
  const end = e => {
    e.preventDefault()
    keys[key].pressed = false
  }

  btn.addEventListener('touchstart', start, { passive: false })
  btn.addEventListener('touchend',   end,   { passive: false })
  btn.addEventListener('touchcancel',end,   { passive: false })
  btn.addEventListener('mousedown',  start)
  btn.addEventListener('mouseup',    end)
  btn.addEventListener('mouseleave', end)
})

// ---- Touch Action button (SPACE equivalent) ----
const actionBtn = document.getElementById('action-btn')
if (actionBtn) {
  actionBtn.addEventListener('touchstart', e => {
    e.preventDefault()
    vibrate()
    handleSpacePress()
  }, { passive: false })
  actionBtn.addEventListener('click', handleSpacePress)
}

// Prevent rubber-band scrolling on iOS
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false })
