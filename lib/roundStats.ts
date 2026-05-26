import type { HoleDraft } from '@/types/round';

export function shouldAskThreePutt(par: number, score: number | null | undefined) {
  if (!score) return false;
  if ((par === 3 || par === 4) && score >= par + 1) return true;
  if (par === 5 && score >= 5) return true;
  return false;
}

export function deriveChipInOffGreen(hole: HoleDraft, par: number) {
  return (
    hole.hitGreen === false &&
    hole.girMissPenalty === false &&
    hole.nearGreen === true &&
    typeof hole.score === 'number' &&
    hole.score < par
  );
}

export function deriveAutoOnePutt(hole: HoleDraft, par: number): boolean | null {
  if (typeof hole.score !== 'number') return null;

  if (hole.hitGreen === true) {
    if (par === 3 && hole.score === 2) return true;
    if (par === 4 && hole.score === 3) return true;
    return null;
  }

  if (hole.hitGreen === false && hole.girMissPenalty === false && hole.nearGreen === true) {
    if (hole.score === par) return true;
    if (hole.score < par) return false;
  }

  return null;
}

export function shouldAskOnePutt(hole: HoleDraft, par: number) {
  if (typeof hole.score !== 'number') return false;

  const auto = deriveAutoOnePutt(hole, par);
  if (auto !== null) return false;

  const hadPenalty = hole.drivePenalty === true || hole.girMissPenalty === true;

  if (hadPenalty && hole.score === par) return true;
  if (par === 4 && hole.hitGreen === true && hole.score === 2) return true;
  if (par === 5 && hole.hitGreen === true && (hole.score === 4 || hole.score === 3)) return true;

  return false;
}

export function deriveUpAndDownMade(hole: HoleDraft, par: number) {
  if (typeof hole.score !== 'number') return null;
  return (
    hole.hitGreen === false &&
    hole.girMissPenalty === false &&
    hole.nearGreen === true &&
    hole.score <= par
  );
}

export function deriveTotalPutts(hole: HoleDraft, par: number) {
  if (typeof hole.totalPutts === 'number') return hole.totalPutts;
  if (deriveChipInOffGreen(hole, par)) return 0;
  if (hole.onePutt === true) return 1;
  if (hole.threePutt === true) return 3;
  return 2;
}

export function finalizeHoleStats(hole: HoleDraft, par: number): HoleDraft {
  const autoOnePutt = deriveAutoOnePutt(hole, par);
  const upAndDownMade = deriveUpAndDownMade(hole, par);
  const hasEnteredTotalPutts = typeof hole.totalPutts === 'number';
  const onePuttFromFlag = autoOnePutt !== null ? autoOnePutt : (hole.onePutt ?? false);
  const totalPutts = hasEnteredTotalPutts
    ? Number(hole.totalPutts)
    : deriveTotalPutts({ ...hole, onePutt: onePuttFromFlag }, par);
  const onePutt = hasEnteredTotalPutts ? totalPutts === 1 : totalPutts === 1 || onePuttFromFlag;
  const threePutt = totalPutts >= 3;

  return {
    ...hole,
    onePutt,
    threePutt,
    upAndDownMade,
    totalPutts,
  };
}

export function summarizeRound(holes: HoleDraft[]) {
  return {
    totalScore: holes.reduce((sum, hole) => sum + (hole.score ?? 0), 0),
    totalPutts: holes.reduce((sum, hole) => sum + (hole.totalPutts ?? 0), 0),
    onePutts: holes.filter((hole) => hole.onePutt === true).length,
    threePutts: holes.filter((hole) => hole.threePutt === true).length,
    upAndDowns: holes.filter((hole) => hole.upAndDownMade === true).length,
    fairwaysHit: holes.filter((hole) => hole.driveSafe === true).length,
    greensInRegulation: holes.filter((hole) => hole.hitGreen === true).length,
    nearGreenCount: holes.filter((hole) => hole.nearGreen === true).length,
    penalties: holes.filter((hole) => hole.drivePenalty === true || hole.girMissPenalty === true).length,
    doublesOrWorse: holes.filter((hole) => typeof hole.score === 'number' && hole.score >= 6).length,
  };
}
