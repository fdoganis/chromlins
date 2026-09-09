// The seven stolen rainbow colors (ROYGBIV). An actor carries one; its index
// here is the actor's `tag`. Shared by Scoring (the rules), RunState's spawn
// scheduler (the body color) and Rainbow (the gauge, which derives its own
// unlit tints from these).
export const RAINBOW = ['#F00', '#FF7F00', '#FF0', '#0F0', '#00F', '#4B0082', '#8B00FF'];

// One warm off-white for every HUD / status label — HI, SCORE, TIMER, GAME OVER,
// the START and TAP TO PLACE prompts, the name-entry letters. Lit white voxels
// read grey under the phong rig; the unicorn's cream does not. The between-level
// cards (WinState) and the "+N" score popups keep their own colors.
export const HUD_TEXT = '#f3ead7';
