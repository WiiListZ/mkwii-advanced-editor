// What to do next to have the game race a ghost and read its path (see src/ghost-replay.ts), as steps
// in the order of playing, from the reading's status and what is known about Dolphin and the game.

export function replaySteps(replay, game, trackName = 'its track') {
  const phase = replay?.phase || 'idle';
  const isGame = !!game?.game?.startsWith('RMC');
  const current = phase === 'done' ? 'done'
    : phase === 'reading' || phase === 'finished-first' || phase === 'failed' ? 'finish'
    : !isGame ? 'game' : 'race';
  const order = ['game', 'race', 'finish', 'done'], at = order.indexOf(current);
  const stateOf = (id) => {
    const here = order.indexOf(id);
    return here === at ? (id === 'done' ? 'done' : 'current') : here < at ? 'done' : 'waiting';
  };

  const gameText = isGame
    ? `Mario Kart Wii (${game.game}) is running. It reads the ghost files when it starts: if it was already running before this window opened, close Dolphin and start it again.`
    : game?.game ? `Dolphin is running another game (${game.game}). Start Mario Kart Wii from the game folder.`
    : 'Start Mario Kart Wii from the game folder: it reads the ghost files when it starts.';
  const raceText = phase === 'other-ghost'
    ? `This race is against another ghost. Choose the Staff ghost of ${trackName}. If you did, close Dolphin and start the game again: it reads the ghost files only when it starts.`
    : `In Time Trials, choose ${trackName} with any character, then race the Staff ghost.`;
  const share = replay?.frames ? Math.min(100, Math.floor(replay.reached / replay.frames * 100)) : 0;
  const finishText = phase === 'finished-first'
    ? 'You crossed the line first, which ends the race before the ghost has. Race it again and stay behind it.'
    : phase === 'failed' ? (replay.error || 'Part of the race was not read. Race it again.')
    : phase === 'reading' ? `Reading the ghost: ${share}%. Stay behind it, or stand still, until it crosses the line.`
    : 'Stay behind the ghost, or stand still: crossing the line first ends the race before the ghost has.';
  return {
    current,
    reading: phase === 'reading',
    share,
    steps: [
      { id: 'game', title: 'Start the game', text: gameText, state: stateOf('game') },
      { id: 'race', title: 'Race the staff ghost', text: raceText, state: stateOf('race') },
      { id: 'finish', title: 'Let the ghost finish first', text: finishText, state: stateOf('finish') },
      { id: 'done', title: 'Path read', text: 'Its path is ready, and the staff ghosts are back in the game folder.', state: stateOf('done') },
    ],
  };
}
