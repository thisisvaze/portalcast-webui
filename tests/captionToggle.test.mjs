import assert from 'node:assert/strict';
import test from 'node:test';
import { planCaptionToggle, matchesPreferredLanguage } from '../src/utils/captionToggle.ts';
import { LIVE_CAPTIONS_ID } from '../src/utils/liveCaptions/preference.ts';

const liveTrack = {
  id: LIVE_CAPTIONS_ID,
  kind: 'captions',
  label: 'Live (automatic, English)',
  language: 'en',
  mode: 'disabled',
};

test('VOD with only live auto captions triggers Best match when tapping C', () => {
  const plan = planCaptionToggle({
    tracks: [liveTrack],
    contentType: 'movie',
    lastTrackKey: null,
    preferredLanguage: 'en',
    isSearchingBest: false,
  });
  assert.deepEqual(plan, { action: 'best-match' });
});

test('tapping C while Best match search is in flight cancels it', () => {
  const plan = planCaptionToggle({
    tracks: [liveTrack],
    contentType: 'movie',
    lastTrackKey: null,
    preferredLanguage: 'en',
    isSearchingBest: true,
  });
  assert.deepEqual(plan, { action: 'cancel-search' });
});

test('tapping C while a track is showing turns it off and remembers it, then toggles it back on', () => {
  const onlineTrack = {
    id: 'sub_123',
    kind: 'subtitles',
    label: 'EN — Movie.1080p',
    language: 'en',
    mode: 'showing',
  };
  const offPlan = planCaptionToggle({
    tracks: [liveTrack, onlineTrack],
    contentType: 'movie',
    lastTrackKey: null,
    preferredLanguage: 'en',
    isSearchingBest: false,
  });
  assert.deepEqual(offPlan, {
    action: 'off',
    index: 1,
    trackId: 'sub_123',
    trackKey: 'sub_123',
  });

  const onPlan = planCaptionToggle({
    tracks: [liveTrack, { ...onlineTrack, mode: 'disabled' }],
    contentType: 'movie',
    lastTrackKey: offPlan.trackKey,
    preferredLanguage: 'en',
    isSearchingBest: false,
  });
  assert.deepEqual(onPlan, {
    action: 'select',
    index: 1,
    trackId: 'sub_123',
    trackKey: 'sub_123',
  });
});

test('VOD reuses an already-loaded online or device subtitle track before searching again', () => {
  const deviceTrack = {
    id: 'blob:http://127.0.0.1:5173/abc',
    kind: 'subtitles',
    label: 'my-sub',
    language: 'und',
    mode: 'disabled',
  };
  const plan = planCaptionToggle({
    tracks: [liveTrack, deviceTrack],
    contentType: 'series',
    lastTrackKey: null,
    preferredLanguage: 'en',
    isSearchingBest: false,
  });
  assert.deepEqual(plan, {
    action: 'select',
    index: 1,
    trackId: deviceTrack.id,
    trackKey: deviceTrack.id,
  });
});

test('VOD picks an embedded/external track matching preferred language, else Best match', () => {
  const french = { id: '0', kind: 'subtitles', label: 'French', language: 'fra', mode: 'disabled' };
  const english = { id: '1', kind: 'subtitles', label: 'English', language: 'eng', mode: 'disabled' };

  assert.deepEqual(
    planCaptionToggle({
      tracks: [french, english, liveTrack],
      contentType: 'movie',
      lastTrackKey: null,
      preferredLanguage: 'en',
      isSearchingBest: false,
    }),
    { action: 'select', index: 1, trackId: '1', trackKey: '1' }
  );

  assert.deepEqual(
    planCaptionToggle({
      tracks: [french, liveTrack],
      contentType: 'movie',
      lastTrackKey: null,
      preferredLanguage: 'en',
      isSearchingBest: false,
    }),
    { action: 'best-match' }
  );
});

test('Live TV toggles Live automatic captions on and off', () => {
  const onPlan = planCaptionToggle({
    tracks: [liveTrack],
    contentType: 'tv',
    lastTrackKey: null,
    preferredLanguage: 'en',
    isSearchingBest: false,
  });
  assert.deepEqual(onPlan, {
    action: 'select',
    index: 0,
    trackId: LIVE_CAPTIONS_ID,
    trackKey: LIVE_CAPTIONS_ID,
  });

  const offPlan = planCaptionToggle({
    tracks: [{ ...liveTrack, mode: 'showing' }],
    contentType: 'tv',
    lastTrackKey: null,
    preferredLanguage: 'en',
    isSearchingBest: false,
  });
  assert.deepEqual(offPlan, {
    action: 'off',
    index: 0,
    trackId: LIVE_CAPTIONS_ID,
    trackKey: LIVE_CAPTIONS_ID,
  });
});

test('ignores metadata/chapter tracks and preserves exact track indices', () => {
  const chapters = { id: 'ch0', kind: 'chapters', label: 'Chapters', mode: 'showing' };
  const subs = { id: 'ext_0', kind: 'subtitles', label: 'English (SDH)', language: 'und', mode: 'disabled' };

  assert.equal(matchesPreferredLanguage(subs, 'en'), true);
  assert.deepEqual(
    planCaptionToggle({
      tracks: [chapters, subs],
      contentType: 'movie',
      lastTrackKey: null,
      preferredLanguage: 'en',
      isSearchingBest: false,
    }),
    { action: 'select', index: 1, trackId: 'ext_0', trackKey: 'ext_0' }
  );
});
