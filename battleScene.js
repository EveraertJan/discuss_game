// ============================================================
// THE MOVEMENT — Debate Scene
// Replaces the original battle system with an argument-tree
// driven persuasion mechanic.
//
// Flow:
//   1. NPC opens with a random root-level claim from the JSON.
//   2. Player picks from the children of that claim (shown as buttons).
//   3. Picking an OBJECTION gains more conviction than picking a SUPPORT.
//   4. The NPC counters with a random child of the player's pick.
//   5. Repeat until the tree is exhausted or conviction reaches 100%.
//   6. If conviction >= CONVICTION_THRESHOLD → NPC joins the movement.
// ============================================================

const CONVICTION_THRESHOLD = 65   // % needed to convince an NPC
const GAIN_OBJECTION      = 40    // conviction gained for an objection (strong counter)
const GAIN_SUPPORT        = 20    // conviction gained for a support (weaker choice)
const GAIN_CLAIM          = 25    // conviction gained for a claim type response
const GAIN_UNANSWERED     = 35    // bonus when NPC has no counter to your argument
const GAIN_BRANCH_END     = 30    // bonus when the tree branch exhausts after NPC speaks

// ---- Background sprite (reuse existing asset) ----
const battleBackgroundImage = new Image()
battleBackgroundImage.src = './img/battleBackground.png'
const battleBackground = new Sprite({
  position: { x: 0, y: 0 },
  image: battleBackgroundImage
})

// ---- Debate state ----
let currentDebateNPC = null
let npcDebateSprite  = null
let playerDebateSprite = null
let debateRenderedSprites = []
let battleAnimationId
let convictionLevel = 0

// ---- Argument tree helpers ----
function getChildren(nodeId) {
  if (!window.argumentData) return []
  return window.argumentData.nodes.filter((n) => n.parentId === nodeId)
}

function getRootClaims() {
  if (!window.argumentData) return []
  return window.argumentData.nodes.filter(n => n.parentId === null && n.type === 'claim')
}

// ---- Conviction bar helpers ----
function setConviction(value) {
  convictionLevel = Math.min(100, Math.max(0, value))
  const color = convictionLevel >= CONVICTION_THRESHOLD ? '#4CAF50' : '#66BB6A'
  gsap.to('#npcConvictionBar', {
    width: convictionLevel + '%',
    backgroundColor: color,
    duration: 0.4
  })
}

// ---- UI helper: show NPC statement ----
// onReady: optional callback, called when player clicks to continue
function showNPCStatement(node, onReady) {
  document.querySelector('#attacksBox').replaceChildren()
  document.querySelector('#attackType').innerHTML = '—'

  const nameLabel = currentDebateNPC
    ? (currentDebateNPC.name || 'VILLAGER').toUpperCase()
    : 'VILLAGER'

  const box = document.querySelector('#dialogueBox')
  box.style.display = 'block'
  box.onclick = null
  box.innerHTML = `
    <div style="font-size: 7px; color: #aaa; letter-spacing: 1px; margin-bottom: 8px;">
      ${nameLabel} ARGUES:
    </div>
    <div style="font-size: 9px; line-height: 1.8; color: #222;">${node.label}</div>
    ${onReady
      ? '<div style="font-size: 7px; color: #bbb; margin-top: 10px; text-align: right;">[ click to respond ]</div>'
      : ''}
  `

  if (onReady) {
    box.onclick = () => {
      box.onclick = null
      onReady()
    }
  }
}

// ---- UI helper: show player response buttons ----
function showPlayerOptions(parentNodeId) {
  document.querySelector('#dialogueBox').style.display = 'none'
  const children = getChildren(parentNodeId)
  document.querySelector('#attacksBox').replaceChildren()

  if (children.length === 0) {
    // Tree exhausted after NPC's last word — branch completion bonus
    setConviction(convictionLevel + GAIN_BRANCH_END)
    finalizeDebate()
    return
  }

  children.slice(0, 4).forEach((child) => {
    const button = document.createElement('button')
    button.innerHTML =
      `<span style="font-size: 7px; line-height: 1.5; color: #222;">${child.label}</span>`
    button.addEventListener('click', () => onPlayerResponds(child))
    document.querySelector('#attacksBox').append(button)
  })
}

// ---- Handle player picking a response ----
function onPlayerResponds(node) {
  // Disable all buttons while processing
  document.querySelectorAll('#attacksBox button').forEach((b) => {
    b.style.pointerEvents = 'none'
    b.style.opacity = '0.5'
  })

  // Show what the player said
  const box = document.querySelector('#dialogueBox')
  document.querySelector('#attacksBox').replaceChildren()
  box.style.display = 'block'
  box.onclick = null
  box.innerHTML = `
    <div style="font-size: 7px; color: #1976D2; letter-spacing: 1px; margin-bottom: 8px;">YOU SAY:</div>
    <div style="font-size: 9px; line-height: 1.8; color: #222;">${node.label}</div>
  `

  // Fallacy — the NPC calls it out and the debate ends immediately
  if (node.type === 'fallacy') {
    setTimeout(() => {
      box.innerHTML = `
        <div style="font-size: 8px; color: #e53935; margin-bottom: 8px;">⚠ LOGICAL FALLACY</div>
        <div style="font-size: 9px; line-height: 1.8; color: #555;">
          The villager sees through it. The debate is over.
        </div>
      `
      setTimeout(() => finalizeDebate(), 2500)
    }, 1800)
    return
  }

  // Award conviction for non-fallacy responses
  let gain = GAIN_CLAIM
  if (node.type === 'objection') gain = GAIN_OBJECTION
  else if (node.type === 'support') gain = GAIN_SUPPORT
  setConviction(convictionLevel + gain)

  setTimeout(() => {
    if (convictionLevel >= 100) {
      winDebate()
      return
    }

    const npcCounters = getChildren(node.id)

    if (npcCounters.length === 0) {
      // No counter — unanswerable point!
      setConviction(convictionLevel + GAIN_UNANSWERED)
      box.innerHTML = `
        <div style="font-size: 8px; color: #4CAF50; margin-bottom: 8px;">💡 UNANSWERABLE POINT!</div>
        <div style="font-size: 9px; line-height: 1.8; color: #555;">
          The villager has no counter to that argument.
        </div>
      `
      setTimeout(() => finalizeDebate(), 2200)
    } else {
      // NPC picks a random counter-argument
      const counter = npcCounters[Math.floor(Math.random() * npcCounters.length)]
      showNPCStatement(counter, () => {
        if (convictionLevel >= 100) {
          winDebate()
        } else {
          showPlayerOptions(counter.id)
        }
      })
    }
  }, 1800)
}

// ---- End states ----
function finalizeDebate() {
  if (convictionLevel >= CONVICTION_THRESHOLD) {
    winDebate()
  } else {
    loseDebate()
  }
}

function winDebate() {
  // Mark NPC as convinced and move them to the town square
  if (currentDebateNPC) {
    currentDebateNPC.convinced = true
    try { moveToTownSquare(currentDebateNPC) } catch (_) {}
  }

  // Update counter
  const isFirstWin = (window.movementCount || 0) === 0
  window.movementCount = (window.movementCount || 0) + 1
  document.querySelector('#movementCount').textContent =
    window.movementCount + ' of ' + (window.villagerTotal || '?')

  // Conviction bar to full green
  setConviction(100)

  document.querySelector('#attacksBox').replaceChildren()
  const box = document.querySelector('#dialogueBox')
  box.style.display = 'block'
  box.onclick = null
  box.innerHTML = `
    <div style="font-size: 12px; color: #4CAF50; line-height: 2.2;">
      ✓ CONVINCED!
    </div>
    <div style="font-size: 9px; color: #333; line-height: 1.8;">
      ${currentDebateNPC ? currentDebateNPC.name : 'The villager'} joins the movement!
    </div>
    ${isFirstWin ? `
    <div style="font-size: 7px; color: #888; line-height: 2; margin-top: 10px; border-top: 1px solid #eee; padding-top: 8px;">
      Convinced citizens gather at the protest in front of the factory.
    </div>` : ''}
  `

  try { audio.victory && audio.victory.play() } catch (e) {}

  setTimeout(() => exitDebate(), isFirstWin ? 5000 : 3200)
}

function loseDebate() {
  document.querySelector('#attacksBox').replaceChildren()
  const box = document.querySelector('#dialogueBox')
  box.style.display = 'block'
  box.onclick = null
  box.innerHTML = `
    <div style="font-size: 10px; color: #e53935; line-height: 2.2;">Not yet...</div>
    <div style="font-size: 9px; color: #555; line-height: 1.8;">
      Keep working on your arguments. Come back and try again!
    </div>
  `

  setTimeout(() => exitDebate(), 3000)
}

// ---- Exit debate → return to map ----
function exitDebate() {
  gsap.to('#overlappingDiv', {
    opacity: 1,
    duration: 0.4,
    onComplete: () => {
      cancelAnimationFrame(battleAnimationId)
      if (currentDebateNPC) currentDebateNPC.conviction = convictionLevel
      animate()  // resume map loop (defined in index.js)
      document.querySelector('#userInterface').style.display = 'none'
      document.querySelector('#dialogueBox').style.display = 'none'
      document.querySelector('#attacksBox').replaceChildren()

      gsap.to('#overlappingDiv', { opacity: 0, duration: 0.4 })

      battle.initiated = false
      try { showTouchControls() } catch (_) {}  // restore D-pad
      try { audio.Map && audio.Map.play() } catch (_) {}
      try { checkVictory() } catch (_) {}
    }
  })
}

// ---- initDebate: entry point called from index.js ----
function initDebate(character) {
  // Pick a random file that actually contains root claims, trying every file before giving up
  const files = window.argumentFiles
  let roots = []
  const order = files.map((_, i) => i).sort(() => Math.random() - 0.5)
  for (const i of order) {
    window.argumentData = files[i]
    roots = getRootClaims()
    if (roots.length > 0) break
  }

  currentDebateNPC = character
  convictionLevel = character.conviction ?? 0

  // Show UI
  document.querySelector('#userInterface').style.display = 'block'
  document.querySelector('#dialogueBox').style.display = 'none'
  document.querySelector('#npcName').textContent = character.name || 'Villager'
  document.querySelector('#npcConvictionBar').style.width = convictionLevel + '%'
  document.querySelector('#npcConvictionBar').style.backgroundColor = '#66BB6A'
  document.querySelector('#attacksBox').replaceChildren()
  document.querySelector('#attackType').innerHTML = '—'

  // Build debate sprites — sizes are derived from canvas dimensions so they
  // look correct regardless of screen resolution or window size.

  // NPC tile: ~18 % of canvas height (source is 16 × 16 px)
  const BATTLE_TILE_PX = Math.round(canvas.height * 0.18)
  npcDebateSprite = {
    position: { x: Math.round(canvas.width * 0.78), y: Math.round(canvas.height * 0.14) },
    draw() {
      if (_tilemapImg && character.tileX !== null) {
        c.imageSmoothingEnabled = false
        c.drawImage(
          _tilemapImg,
          character.tileX * TILE_SIZE, character.tileY * TILE_SIZE,
          TILE_SIZE, TILE_SIZE,
          this.position.x, this.position.y,
          BATTLE_TILE_PX, BATTLE_TILE_PX
        )
      }
    }
  }

  // Player sprite: scale so rendered height ≈ 22 % of canvas height
  const playerNaturalH = playerDownImage.naturalHeight || 22
  const playerScale    = (canvas.height * 0.22) / playerNaturalH
  playerDebateSprite = new Sprite({
    position: { x: Math.round(canvas.width * 0.27), y: Math.round(canvas.height * 0.56) },
    image: playerDownImage,
    frames: { max: 3, hold: 10 },
    animate: false,
    scale: playerScale
  })

  debateRenderedSprites = [npcDebateSprite, playerDebateSprite]

  if (roots.length === 0) {
    // Every file was empty — nothing to debate
    document.querySelector('#dialogueBox').style.display = 'block'
    document.querySelector('#dialogueBox').innerHTML =
      '<div style="font-size: 9px;">No arguments found in any loaded file.</div>'
    setTimeout(() => exitDebate(), 2500)
    return
  }

  const opening = roots[Math.floor(Math.random() * roots.length)]
  showNPCStatement(opening, () => showPlayerOptions(opening.id))
}

// ---- Battle render loop (canvas) ----
function animateBattle() {
  battleAnimationId = window.requestAnimationFrame(animateBattle)
  c.clearRect(0, 0, canvas.width, canvas.height)
  c.drawImage(battleBackgroundImage, 0, 0, canvas.width, canvas.height)
  debateRenderedSprites.forEach((sprite) => sprite.draw())
}

// (map loop is started by initGame() in index.js after assets load)
