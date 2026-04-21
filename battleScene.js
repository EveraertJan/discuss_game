// ============================================================
// THE MOVEMENT — Debate Scene
//
// Flow:
//   1. NPC opens with the root claim assigned to this character.
//   2. Player picks from the children of that claim.
//   3. Conviction goes up or down depending on the node's score.
//      · objection  → +GAIN_OBJECTION  (default +40)
//      · support    → +GAIN_SUPPORT    (default +20)
//      · claim      → 0 (neutral filler — advances the dialogue)
//      · fallacy    → –GAIN_OBJECTION  (bad argument, keeps going)
//      · node.score overrides the default when present
//   4. NPC counters with a random child of the player's pick.
//   5. Repeat until the branch is exhausted.
//   6. conviction >= CONVICTION_THRESHOLD at end → win; else lose.
// ============================================================

const CONVICTION_THRESHOLD = 65
const GAIN_OBJECTION      = 40
const GAIN_SUPPORT        = 20
const GAIN_UNANSWERED     = 35   // bonus: NPC has no counter to player's point
const GAIN_BRANCH_END     = 15   // small bonus when tree exhausts after NPC speaks

// ---- Background ----
const battleBackgroundImage = new Image()
battleBackgroundImage.src = './img/battleBackground.png'
const battleBackground = new Sprite({
  position: { x: 0, y: 0 },
  image: battleBackgroundImage
})

// ---- Debate state ----
let currentDebateNPC       = null
let npcDebateSprite        = null
let playerDebateSprite     = null
let debateRenderedSprites  = []
let battleAnimationId
let convictionLevel        = 0

// ---- Argument tree helpers ----
function getChildren(nodeId) {
  if (!window.argumentData) return []
  return window.argumentData.nodes.filter(n => n.parentId === nodeId)
}

function getRootClaims() {
  if (!window.argumentData) return []
  return window.argumentData.nodes.filter(n => n.parentId === null && n.type === 'claim')
}

// ---- Score a player node (Task 2 + 3) ----
// If the node has a numeric `score` field, use it directly (allows custom +/- values).
// Otherwise fall back to type-based defaults.
// `claim` type = neutral filler → 0 conviction change.
function getNodeScore(node) {
  if (typeof node.score === 'number') return node.score
  switch (node.type) {
    case 'objection': return  GAIN_OBJECTION
    case 'support':   return  GAIN_SUPPORT
    case 'fallacy':   return -GAIN_OBJECTION   // bad argument → lose points
    case 'claim':     return  0                // filler, just advances convo
    default:          return  GAIN_SUPPORT     // unknown type → small positive
  }
}

// ---- Conviction bar ----
function setConviction(value) {
  const prev = convictionLevel
  convictionLevel = Math.min(100, Math.max(0, value))
  const going_down = convictionLevel < prev
  const color = going_down
    ? '#e53935'                                          // red flash on loss
    : convictionLevel >= CONVICTION_THRESHOLD
      ? '#4CAF50'                                        // bright green: over threshold
      : '#66BB6A'                                        // normal green
  gsap.to('#npcConvictionBar', {
    width: convictionLevel + '%',
    backgroundColor: color,
    duration: 0.4,
    onComplete: () => {
      // After a downward flash, restore normal green
      if (going_down && convictionLevel < CONVICTION_THRESHOLD) {
        gsap.to('#npcConvictionBar', { backgroundColor: '#66BB6A', duration: 0.3 })
      }
    }
  })
}

// ---- Responsive font helper ----
function uiSz(portrait, landscape) {
  return window.innerWidth > window.innerHeight ? landscape : portrait
}

// ---- Typewriter animation (Task 7) ----
// Writes `text` into `el` character by character at `speed` ms/char.
// Returns a skip() function that immediately shows the full text.
// Calls onDone() when the animation completes (or is skipped).
function typewriter(el, text, speed, onDone) {
  let i        = 0
  let timer    = null
  let finished = false

  function tick() {
    if (i < text.length) {
      el.textContent = text.slice(0, ++i)
      timer = setTimeout(tick, speed)
    } else {
      finished = true
      if (onDone) onDone()
    }
  }

  tick()

  return function skip() {
    if (finished) return
    clearTimeout(timer)
    el.textContent = text
    finished = true
    if (onDone) onDone()
  }
}

// ---- Show NPC statement with typewriter ----
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
    <div style="font-size:${uiSz('14px','11px')}; color:#aaa; letter-spacing:1px; margin-bottom:8px;">
      ${nameLabel} ARGUES:
    </div>
    <div id="_tw" style="font-size:${uiSz('10px','14px')}; line-height:2; color:#222;"></div>
    ${onReady
      ? `<div style="font-size:${uiSz('14px','10px')}; color:#bbb; margin-top:10px; text-align:right;">[ click to respond ]</div>`
      : ''}
  `

  const twEl = box.querySelector('#_tw')

  if (onReady) {
    let animDone = false
    const skipFn = typewriter(twEl, node.label, 28, () => { animDone = true })

    box.onclick = () => {
      if (!animDone) {
        skipFn()      // first click: skip animation, show full text
      } else {
        box.onclick = null
        onReady()     // second click: advance
      }
    }
  } else {
    typewriter(twEl, node.label, 28)
  }
}

// ---- Show player response buttons (Task 6 layout handled in CSS) ----
function showPlayerOptions(parentNodeId) {
  document.querySelector('#dialogueBox').style.display = 'none'
  const children = getChildren(parentNodeId)
  document.querySelector('#attacksBox').replaceChildren()

  if (children.length === 0) {
    // Branch exhausted after NPC's last word
    setConviction(convictionLevel + GAIN_BRANCH_END)
    finalizeDebate()
    return
  }

  children.forEach(child => {
    const button = document.createElement('button')
    button.innerHTML =
      `<span style="font-size:${uiSz('10px','13px')}; line-height:1.8; color:#222;">${child.label}</span>`
    button.addEventListener('click', () => onPlayerResponds(child))
    document.querySelector('#attacksBox').append(button)
  })
}

// ---- Player picks a response (Tasks 1, 2, 3) ----
function onPlayerResponds(node) {
  document.querySelectorAll('#attacksBox button').forEach(b => {
    b.style.pointerEvents = 'none'
    b.style.opacity = '0.5'
  })

  const box = document.querySelector('#dialogueBox')
  document.querySelector('#attacksBox').replaceChildren()
  box.style.display = 'block'
  box.onclick = null
  box.innerHTML = `
    <div style="font-size:${uiSz('14px','14px')}; color:#1976D2; letter-spacing:1px; margin-bottom:8px;">YOU SAY:</div>
    <div style="font-size:${uiSz('14px','14px')}; line-height:1.8; color:#222;">${node.label}</div>
  `

  // Task 2 + 3: score every node type; fallacy = negative, claim = 0
  const score = getNodeScore(node)
  setConviction(convictionLevel + score)

  // Brief feedback label for negative / fallacy nodes
  if (score < 0) {
    const hint = document.createElement('div')
    hint.style.cssText = `font-size:${uiSz('9px','11px')}; color:#e53935; margin-top:6px;`
    hint.textContent = node.type === 'fallacy'
      ? '⚠ Logical fallacy — the villager sees through it.'
      : '✗ That doesn\'t land well.'
    box.appendChild(hint)
  }

  // Conversation ALWAYS continues (Task 1) — no early forced end for wrong answers.
  // Only early win if bar hits 100 %.
  setTimeout(() => {
    if (convictionLevel >= 100) {
      winDebate()
      return
    }

    const npcCounters = getChildren(node.id)

    if (npcCounters.length === 0) {
      // Unanswerable point — bonus conviction
      setConviction(convictionLevel + GAIN_UNANSWERED)
      box.innerHTML = `
        <div style="font-size:${uiSz('8px','12px')}; color:#4CAF50; margin-bottom:8px;">💡 UNANSWERABLE POINT!</div>
        <div style="font-size:${uiSz('14px','14px')}; line-height:1.8; color:#555;">
          The villager has no counter to that argument.
        </div>
      `
      setTimeout(() => finalizeDebate(), 2200)
    } else {
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
  if (currentDebateNPC) {
    currentDebateNPC.convinced = true
    try { moveToTownSquare(currentDebateNPC) } catch (_) {}
  }

  const isFirstWin = (window.movementCount || 0) === 0
  window.movementCount = (window.movementCount || 0) + 1
  document.querySelector('#movementCount').textContent =
    window.movementCount + ' of ' + (window.villagerTotal || '?')

  setConviction(100)

  document.querySelector('#attacksBox').replaceChildren()
  const box = document.querySelector('#dialogueBox')
  box.style.display = 'block'
  box.onclick = null
  box.innerHTML = `
    <div style="font-size:${uiSz('12px','18px')}; color:#4CAF50; line-height:2.2;">✓ CONVINCED!</div>
    <div style="font-size:${uiSz('14px','14px')}; color:#333; line-height:1.8;">
      ${currentDebateNPC ? currentDebateNPC.name : 'The villager'} joins the movement!
    </div>
    ${isFirstWin ? `
    <div style="font-size:${uiSz('14px','11px')}; color:#888; line-height:2; margin-top:10px; border-top:1px solid #eee; padding-top:8px;">
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
    <div style="font-size:${uiSz('10px','15px')}; color:#e53935; line-height:2.2;">Not yet…</div>
    <div style="font-size:${uiSz('14px','14px')}; color:#555; line-height:1.8;">
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
      animate()
      document.querySelector('#userInterface').style.display = 'none'
      document.querySelector('#dialogueBox').style.display = 'none'
      document.querySelector('#attacksBox').replaceChildren()

      gsap.to('#overlappingDiv', { opacity: 0, duration: 0.4 })

      battle.initiated = false
      try { showTouchControls() }  catch (_) {}
      try { audio.Map && audio.Map.play() } catch (_) {}
      try { checkVictory() } catch (_) {}
    }
  })
}

// ---- initDebate: entry point called from index.js (Task 8) ----
// Each character has an assignedFile + assignedRootClaim set by initGame().
function initDebate(character) {
  currentDebateNPC = character
  convictionLevel  = character.conviction ?? 0

  // Use the pre-assigned argument file for this NPC
  window.argumentData = character.assignedFile || (window.argumentFiles && window.argumentFiles[0])
  const opening       = character.assignedRootClaim

  // Show UI
  document.querySelector('#userInterface').style.display = 'block'
  document.querySelector('#dialogueBox').style.display = 'none'
  document.querySelector('#npcName').textContent = character.name || 'Villager'
  document.querySelector('#npcConvictionBar').style.width = convictionLevel + '%'
  document.querySelector('#npcConvictionBar').style.backgroundColor = '#66BB6A'
  document.querySelector('#attacksBox').replaceChildren()
  document.querySelector('#attackType').innerHTML = '—'

  // Build debate sprites
  const BATTLE_TILE_PX = Math.round(canvas.height * 0.18)

  npcDebateSprite = {
    position: { x: Math.round(canvas.width * 0.72), y: Math.round(canvas.height * 0.15) },
    draw() {
      if (_tilemapImg && character.tileX !== undefined && character.tileX !== null) {
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

  const playerNaturalH = playerUpImage.naturalHeight || 22
  const playerScale    = (canvas.height * 0.30) / playerNaturalH
  playerDebateSprite = new Sprite({
    position: { x: Math.round(canvas.width * 0.06), y: Math.round(canvas.height * 0.35) },
    image: playerUpImage,
    frames: { max: 3, hold: 10 },
    animate: false,
    scale: playerScale
  })

  debateRenderedSprites = [npcDebateSprite, playerDebateSprite]

  if (!opening) {
    document.querySelector('#dialogueBox').style.display = 'block'
    document.querySelector('#dialogueBox').innerHTML =
      '<div style="font-size:14px;">No argument assigned to this villager.</div>'
    setTimeout(() => exitDebate(), 2500)
    return
  }

  showNPCStatement(opening, () => showPlayerOptions(opening.id))
}

// ---- Battle render loop ----
function animateBattle() {
  battleAnimationId = window.requestAnimationFrame(animateBattle)
  c.clearRect(0, 0, canvas.width, canvas.height)
  c.drawImage(battleBackgroundImage, 0, 0, canvas.width, canvas.height)
  debateRenderedSprites.forEach(sprite => sprite.draw())
}

// (map loop is started by initGame() in index.js after assets load)
