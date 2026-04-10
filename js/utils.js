function rectangularCollision({ rectangle1, rectangle2 }) {
  return (
    rectangle1.position.x + rectangle1.width >= rectangle2.position.x &&
    rectangle1.position.x <= rectangle2.position.x + rectangle2.width &&
    rectangle1.position.y <= rectangle2.position.y + rectangle2.height &&
    rectangle1.position.y + rectangle1.height >= rectangle2.position.y
  )
}

// How many pixels around the player count as "close enough to talk"
const INTERACTION_RADIUS = 36

function checkForCharacterCollision({
  characters,
  player
}) {
  player.interactionAsset = null

  // Expand the player's hitbox in all directions by INTERACTION_RADIUS
  // so the player can talk to an NPC without being directly on top of them.
  const expanded = {
    position: {
      x: player.position.x - INTERACTION_RADIUS,
      y: player.position.y - INTERACTION_RADIUS
    },
    width:  player.width  + INTERACTION_RADIUS * 2,
    height: player.height + INTERACTION_RADIUS * 2
  }

  for (let i = 0; i < characters.length; i++) {
    const character = characters[i]
    if (rectangularCollision({ rectangle1: expanded, rectangle2: character })) {
      player.interactionAsset = character
      break
    }
  }
}
