// What to do next to record a ghost, as steps in the order of playing, from what is known about
// Dolphin and the game. The ghost is picked up whatever these say: they only guide.

const RACING = (stage) => stage === 0 || stage === 1 || stage === 2;

// capturedAtRace: how many ghosts had been picked up when the latest race was last seen running, so
// that the save of an earlier race does not count for this one. finishedAt: when that race was first
// seen finished, in ms, so that a save without a ghost is known to be this race's.
export function recordSteps(status, capturedAtRace = 0, finishedAt = 0) {
  const isGame = !!status?.game?.startsWith('RMC');
  const captured = status?.captured?.length || 0;
  const stage = isGame ? status.stage : null;
  const finished = stage !== null && stage >= 3;
  const saved = captured > 0 && (RACING(stage) ? false : !finished || captured > capturedAtRace);

  const current = !isGame ? 'game' : RACING(stage) ? 'drive' : finished && !saved ? 'save' : saved ? 'done' : 'race';
  const order = ['game', 'race', 'drive', 'save', 'done'], at = order.indexOf(current);
  const stateOf = (id) => {
    const here = order.indexOf(id);
    return here === at ? (id === 'done' ? 'done' : 'current') : here < at ? 'done' : 'waiting';
  };

  const gameText = isGame ? `Mario Kart Wii (${status.game}) is running.`
    : !status?.dolphin ? 'Dolphin is not open.'
    : status.game ? `Dolphin is running another game (${status.game}). Start Mario Kart Wii in it.`
    : 'Dolphin is open. Start Mario Kart Wii in it.';
  // Older dumps and other regions may not show the race: the ghost is still picked up when saved.
  const raceText = isGame && stage === null && current === 'race'
    ? 'Drive a Time Trial to the finish and save the ghost. This version of the game does not show its progress here, but the ghost still appears when it is saved.'
    : 'In the game, choose Time Trials, then your character, vehicle and track.';
  const recording = current === 'drive' && stage === 2;
  const driveText = recording ? 'The game is recording your ghost. Finish the race.'
    : current === 'drive' ? 'Get ready: recording begins when the race starts.'
    : 'Race to the finish line.';

  // There is no button for it: the game writes its save by itself after the race, with or without
  // this run's ghost. Which runs it keeps is the game's choice; a save without one is all that shows.
  const notKept = current === 'save' && finishedAt > 0 && status.savedWithoutGhost >= finishedAt;
  const savedAt = notKept ? new Date(status.savedWithoutGhost).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const savedText = notKept
    ? `The game saved at ${savedAt}, without a new ghost: it did not keep this run. Drive again to record another.`
    : 'Nothing to press: the game saves by itself after the race. Keep this window open until it has.';
  // A run the game did not keep was read from its memory as the race ended.
  const latest = status?.captured?.[captured - 1];
  const doneText = latest?.source === 'memory' && !latest.kept
    ? "The game did not keep this run in its save, so it was read from the game's memory as the race ended (beta). It joined your recorded ghosts."
    : 'It joined your recorded ghosts.';
  return {
    current,
    notKept,
    recording,
    steps: [
      { id: 'game', title: 'Open the game', text: gameText, state: stateOf('game') },
      { id: 'race', title: 'Start a Time Trial', text: raceText, state: stateOf('race') },
      { id: 'drive', title: 'Drive to the finish', text: driveText, state: stateOf('drive') },
      { id: 'save', title: 'Wait for the game to save', text: savedText, state: stateOf('save') },
      { id: 'done', title: 'Ghost recorded', text: doneText, state: stateOf('done') },
    ],
  };
}
