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
  'visualizer',
]);

const VERSION_MARKERS = [
  '1 hour',
  '10 hours',
  '8d',
  'acoustic',
  'bass boosted',
  'cover',
  'extended',
  'instrumental',
  'karaoke',
  'live',
  'lofi',
  'mashup',
  'nightcore',
  'parody',
  'reaction',
  'remaster',
  'remastered',
  'remix',
  'reverb',
  'review',
  'shorts',
  'slowed',
  'sped up',
  'teaser',
  'tiktok',
  'trailer',
];

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

// NFD -> strip Latin combining marks -> NFC preserves CJK/Kana dakuten/Hangul while folding Vietnamese/Latin diacritics.
function normalizeText(value) {
  return String(value || '')
    .replace(/[đĐ]/g, match => match === 'Đ' ? 'D' : 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Expand unspaced CJK runs into overlapping bigrams so titles without spaces match inside bracketed YouTube titles.
function tokens(value) {
  const result = [];
  for (const word of normalizeText(value).split(' ')) {
    if (!word || IGNORED_WORDS.has(word)) continue;
    if (CJK_RE.test(word) && word.length > 2) {
      const chars = Array.from(word);
      for (let i = 0; i < chars.length - 1; i += 1) {
        result.push(chars[i] + chars[i + 1]);
      }
    } else {
      result.push(word);
    }
  }
  return result;
}

function coverage(expected, actual) {
  const expectedTokens = [...new Set(tokens(expected))];
  if (!expectedTokens.length) return 0;
  const actualTokens = new Set(tokens(actual));
  return expectedTokens.filter(word => actualTokens.has(word)).length / expectedTokens.length;
}

function durationMs(track) {
  if (Number.isFinite(track?.durationMS) && track.durationMS > 0) return track.durationMS;
  if (Number.isFinite(track?.metadata?.duration_ms) && track.metadata.duration_ms > 0) return track.metadata.duration_ms;
  if (Number.isFinite(track?.duration) && track.duration > 0) return track.duration * 1_000;

  const parts = String(track?.duration || '').split(':').map(Number);
  if (!parts.length || parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0) * 1_000;
}

function versionPenalty(targetText, candidateText) {
  const target = normalizeText(targetText);
  const candidate = normalizeText(candidateText);
  const unexpectedMarkers = VERSION_MARKERS.filter(marker => candidate.includes(marker) && !target.includes(marker));
  return Math.min(unexpectedMarkers.length * 24, 48);
}

function durationScore(target, candidate) {
  const targetDuration = durationMs(target);
  const candidateDuration = durationMs(candidate);
  if (!targetDuration || !candidateDuration) return { score: 8, differenceSeconds: null };

  if (targetDuration >= 90_000 && candidateDuration < 45_000) {
    return { score: -30, differenceSeconds: Math.abs(targetDuration - candidateDuration) / 1_000 };
  }

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
  else if (normalizedCandidate.endsWith(' topic') && authorCoverage >= 0.5) score += 14;
  else if (authorCoverage >= 0.8 && (normalizedCandidate.includes('official') || normalizedCandidate.includes('vevo'))) score += 12;
  else if (authorCoverage >= 0.8) score += 5;

  if (/\b(fan|karaoke|lyrics?|reaction|parody)\b/.test(normalizedCandidate)) score -= 10;
  return score;
}

function scoreCandidate(target, candidate) {
  const targetTitle = target?.cleanTitle || target?.title || '';
  const candidateTitle = candidate?.cleanTitle || candidate?.title || '';
  const targetAuthor = target?.author || '';
  const candidateAuthor = candidate?.author || candidate?.uploader || '';
  const candidateIdentity = `${candidateTitle} ${candidateAuthor}`;

  const normalizedTargetTitle = normalizeText(targetTitle);
  const titleCoverage = coverage(targetTitle, candidateTitle);
  const artistCoverage = coverage(targetAuthor, candidateIdentity);
  const duration = durationScore(target, candidate);
  const exactTitle = normalizedTargetTitle && normalizeText(candidateTitle).includes(normalizedTargetTitle) ? 5 : 0;
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

// Re-rank plain-text YouTube search results so top hits avoid Shorts, karaoke, reactions, and multi-hour compilations unless requested.
function rankSearchTracks(rawQuery, tracks) {
  if (!Array.isArray(tracks) || tracks.length < 2) return tracks;
  const normalizedQuery = normalizeText(rawQuery);
  const wantsShort = /\b(shorts?|tiktok|intro|outro|teaser|preview)\b/.test(normalizedQuery);
  const wantsLong = /\b(1 hour|10 hours|hour|hours|loop|mix|playlist|compilation|full album|lofi|study|sleep)\b/.test(normalizedQuery);

  return tracks
    .map((track, index) => {
      const title = track?.cleanTitle || track?.title || '';
      const author = track?.author || '';
      const identity = `${title} ${author}`;
      const queryCoverage = coverage(rawQuery, identity);
      const dur = durationMs(track);
      const rankBonus = Math.max(0, 18 - index * 3);
      const penalty = versionPenalty(rawQuery, identity);
      let durationAdjustment = 0;

      if (!wantsShort && ((dur > 0 && dur < 45_000) || /#shorts?\b/i.test(title))) {
        durationAdjustment -= 35;
      } else if (!wantsLong && dur > 20 * 60_000) {
        durationAdjustment -= 25;
      } else if (dur >= 60_000 && dur <= 10 * 60_000) {
        durationAdjustment += 6;
      }

      const normAuthor = normalizeText(author);
      const officialBonus = normAuthor.endsWith(' topic') || /\b(official|vevo)\b/.test(normAuthor) ? 6 : 0;
      const score = queryCoverage * 55 + rankBonus + durationAdjustment + officialBonus - penalty;
      return { track, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(entry => entry.track);
}

module.exports = {
  coverage,
  durationMs,
  findBestCandidate,
  isConfidentMatch,
  normalizeText,
  rankCandidates,
  rankSearchTracks,
  scoreCandidate,
  tokens,
};
