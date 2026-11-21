import assert from 'node:assert/strict';
import test from 'node:test';
import {
  continueCatalogIdOf,
  continueItemsOf,
  normalizeCatalogId,
} from '../src/utils/continueItems.ts';

test('normalizeCatalogId preserves prefixed ids and prefixes bare ids from search/category opens', () => {
  assert.equal(normalizeCatalogId('series_4218', true), 'series_4218');
  assert.equal(normalizeCatalogId('4218', true), 'series_4218');
  assert.equal(normalizeCatalogId('901', false), 'movie_901');
  assert.equal(normalizeCatalogId('', true), undefined);
});

test('continueItemsOf collapses duplicate episodes of one show and inherits catalogId + backdrop', () => {
  const records = [
    // Newest record: auto-queued next episode from old completePlayback (0%, missing catalogId & backdrop)
    {
      mediaId: 'ep_3',
      progress: 0,
      completed: false,
      meta: {
        id: 'ep_2',
        itemId: 'ep_2',
        playbackFileId: 'ep_3',
        mediaId: 'ep_3',
        type: 'series',
        title: 'The Big Bang Theory',
        episodeTitle: 'The Big Bang Theory: Season 1',
        is_series: 1,
        currentTime: 0,
        duration: 0,
        progressPercent: 0,
        timestamp: 3000,
      },
    },
    // Older unfinished row for the same show (also from completePlayback)
    {
      mediaId: 'ep_2',
      progress: 0,
      completed: false,
      meta: {
        id: 'ep_1',
        itemId: 'ep_1',
        playbackFileId: 'ep_2',
        mediaId: 'ep_2',
        type: 'series',
        title: 'The Big Bang Theory',
        episodeTitle: 'The Big Bang Theory: Season 1',
        is_series: 1,
        currentTime: 0,
        duration: 0,
        progressPercent: 0,
        timestamp: 2000,
      },
    },
    // Completed row from earlier playback that DID carry the series catalogId and backdrop
    {
      mediaId: '4218',
      progress: 1300,
      completed: true,
      backdrop_path: '/tbbt-backdrop.jpg',
      meta: {
        id: 'ep_1',
        itemId: 'ep_1',
        mediaId: '4218',
        type: 'series',
        title: 'The Big Bang Theory',
        is_series: 1,
        catalogId: '4218', // bare id from old searchOpenTitle bug
        currentTime: 1300,
        duration: 1350,
        progressPercent: 96,
        timestamp: 1000,
      },
    },
  ];

  const items = continueItemsOf(records);
  // Deduplicated to one card for The Big Bang Theory
  assert.equal(items.length, 1);
  // Inherited normalized catalogId & backdrop from sibling row
  assert.equal(items[0].catalogId, 'series_4218');
  assert.equal(continueCatalogIdOf(items[0]), 'series_4218');
  assert.equal(items[0].cw_backdrop, '/tbbt-backdrop.jpg');
  // Cleaned redundant show-name prefix in subtitle detail
  assert.equal(items[0].cw_detail, 'Season 1');
});

test('continueItemsOf avoids treating an episode playbackFileId as a series catalogId when no sibling exists', () => {
  const items = continueItemsOf([
    {
      mediaId: 'ep_99',
      progress: 0,
      completed: false,
      meta: {
        id: 'ep_98',
        itemId: 'ep_98',
        playbackFileId: 'ep_99',
        mediaId: 'ep_99',
        type: 'series',
        title: 'Young Sheldon',
        episodeTitle: 'Young Sheldon – Young Sheldon: Season 1',
        is_series: 1,
        currentTime: 0,
        duration: 0,
        progressPercent: 0,
        timestamp: 5000,
      },
    },
  ]);

  assert.equal(items.length, 1);
  // Does not fabricate bogus series_ep_99; continueCard falls back to searching by show title
  assert.equal(items[0].catalogId, undefined);
  assert.equal(continueCatalogIdOf(items[0]), null);
  assert.equal(items[0].cw_detail, 'Season 1');
});
