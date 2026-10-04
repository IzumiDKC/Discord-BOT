const { AudioFilters } = require('discord-player');

const AUDIO_PRESETS = Object.freeze({
  NATURAL: 'natural',
  BALANCED: 'balanced',
});
const DEFAULT_AUDIO_PRESET = AUDIO_PRESETS.BALANCED;
const BALANCED_FILTER = 'music_balanced';
const MANAGED_FILTERS = new Set([BALANCED_FILTER, 'normalizer2', 'softlimiter']);

AudioFilters.define(BALANCED_FILTER, 'dynaudnorm=f=500:g=31:m=3:p=0.9');

function filtersForPreset(preset) {
  if (preset === AUDIO_PRESETS.NATURAL) return [];
  if (preset === AUDIO_PRESETS.BALANCED) return [BALANCED_FILTER];
  throw new RangeError(`Unknown audio preset: ${preset}`);
}

function getAudioPreset(queue) {
  if (!queue) return DEFAULT_AUDIO_PRESET;
  const selected = queue.metadata?.audioPreset;
  if (selected === AUDIO_PRESETS.NATURAL || selected === AUDIO_PRESETS.BALANCED) return selected;

  const filters = queue.filters?.ffmpeg?.filters || [];
  return filters.some(filter => filter === BALANCED_FILTER || filter === 'normalizer2')
    ? AUDIO_PRESETS.BALANCED
    : AUDIO_PRESETS.NATURAL;
}

function setAudioPreset(queue, preset) {
  const managed = filtersForPreset(preset);
  const filterer = queue.filters.ffmpeg;
  const otherFilters = filterer.filters.filter(filter => !MANAGED_FILTERS.has(filter));
  filterer.setDefaults([...otherFilters, ...managed]);
  queue.setMetadata({ ...queue.metadata, audioPreset: preset });
}

function markActiveAudioPreset(queue) {
  queue.setMetadata({ ...queue.metadata, activeAudioPreset: getAudioPreset(queue) });
}

module.exports = {
  AUDIO_PRESETS,
  BALANCED_FILTER,
  DEFAULT_AUDIO_PRESET,
  filtersForPreset,
  getAudioPreset,
  markActiveAudioPreset,
  setAudioPreset,
};
