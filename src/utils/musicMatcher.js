const IGNORED_WORDS = new Set([
  'audio',
  'hd',
  'hq',
  'lyrics',
  'lyric',
  'mv',
  'music',
  'official',
  'video',
]);

const VERSION_MARKERS = [
  '8d',
  'acoustic',
  'cover',
  'instrumental',
  'karaoke',
  'live',
  'lofi',
  'mashup',
  'nightcore',
  'reaction',
  'remaster',
  'remastered',
  'remix',
  'reverb',
  'slowed',
  'sped up',
];

function normalizeText(value) {
  return String(value || '')
    .replace(/[đĐ]/g, match => match === 'Đ' ? 'D' : 'd')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(value) {
  return normalizeText(value)
    .split(' ')
    .filter(word => word && !IGNORED_WORDS.has(word));
}

function coverage(expected, actual) {
  const expectedTokens = [...new Set(tokens(expected))];
  if (!expectedTokens.length) return 0;
  const actualTokens = new Set(tokens(actual));
  return expectedTokens.filter(word => actualTokens.has(word)).length / expectedTokens.length;
}

function durationMs(track) {
  if (Number.isFinite(track?.durationMS) && track.durationMS > 0) return track.durationMS;
  if (Number.isFinite(track?.duration) && track.duration > 0) return track.duration * 1_000;

  const parts = String(track?.duration || '').split(':').map(Number);
  if (!parts.length || parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0) * 1_000;
}

function versionPenalty(targetText, candidateText) {
  const target = normalizeText(targetText);
  const candidate = normalizeText(candidateText);
  const unexpectedMarkers = VERSION_MARKERS.filter(marker => candidate.includes(marker) && !target.includes(marker));
  return Math.min(unexpectedMarkers.length * 24, 40);
}

function durationScore(target, candidate) {
  const targetDuration = durationMs(target);
  const candidateDuration = durationMs(candidate);
  if (!targetDuration || !candidateDuration) return { score: 8, differenceSeconds: null };

  const differenceSeconds = Math.abs(targetDuration - candidateDuration) / 1_000;
  if (differenceSeconds <= 3) return { score: 20, differenceSeconds };
  if (differenceSeconds <= 10) return { score: 17, differenceSeconds };
  if (differenceSeconds <= 25) return { score: 12, differenceSeconds };
  if (differenceSeconds <= 45) return { score: 6, differenceSeconds };
  if (differenceSeconds <= 90) return { score: 0, differenceSeconds };
  return { score: -20, differenceSeconds };
}

function channelQualityScore(targetAuthor, candidateAuthor) {
  const normalizedTarget = normalizeText(targetAuthor);
  const normalizedCandidate = normalizeText(candidateAuthor);
  const authorCoverage = coverage(targetAuthor, candidateAuthor);
  let score = 0;

  if (normalizedTarget && normalizedCandidate === normalizedTarget) score += 12;
  else if (authorCoverage >= 0.8 && normalizedCandidate.includes('official')) score += 12;
  else if (authorCoverage >= 0.8) score += 5;

  if (/\b(fan|karaoke|lyrics?)\b/.test(normalizedCandidate)) score -= 10;
  return score;
}

function scoreCandidate(target, candidate) {
  const targetTitle = target?.cleanTitle || target?.title || '';
  const candidateTitle = candidate?.cleanTitle || candidate?.title || '';
  const targetAuthor = target?.author || '';
  const candidateAuthor = candidate?.author || candidate?.uploader || '';
  const candidateIdentity = `${candidateTitle} ${candidateAuthor}`;

  const titleCoverage = coverage(targetTitle, candidateTitle);
  const artistCoverage = coverage(targetAuthor, candidateIdentity);
  const duration = durationScore(target, candidate);
  const exactTitle = normalizeText(candidateTitle).includes(normalizeText(targetTitle)) ? 5 : 0;
  const penalty = versionPenalty(`${targetTitle} ${targetAuthor}`, candidateIdentity);
  const channelQuality = channelQualityScore(targetAuthor, candidateAuthor);
  const score = Math.round(
    titleCoverage * 58
    + artistCoverage * 17
    + duration.score
    + exactTitle
    + channelQuality
    - penalty
  );

  return {
    candidate,
    score,
    titleCoverage,
    artistCoverage,
    durationDifferenceSeconds: duration.differenceSeconds,
    channelQuality,
    versionPenalty: penalty,
  };
}

function isConfidentMatch(match) {
  if (!match || match.score < 58 || match.titleCoverage < 0.66) return false;
  if (match.durationDifferenceSeconds !== null && match.durationDifferenceSeconds > 90) return false;
  return match.artistCoverage >= 0.34 || match.titleCoverage >= 0.99;
}

function rankCandidates(target, candidates) {
  return candidates
    .map(candidate => scoreCandidate(target, candidate))
    .sort((left, right) => right.score - left.score);
}

function findBestCandidate(target, candidates) {
  const [best] = rankCandidates(target, candidates);
  return isConfidentMatch(best) ? best : null;
}

module.exports = {
  findBestCandidate,
  isConfidentMatch,
  normalizeText,
  rankCandidates,
  scoreCandidate,
};
