import assert from 'node:assert/strict';
import test from 'node:test';
import { baseShowName, episodeTitle } from '../src/utils/episodeInfo.ts';

test('baseShowName strips trailing season markers, years and quality tags', () => {
  assert.equal(
    baseShowName('The Big Bang Theory: Season 1 - 12'),
    'The Big Bang Theory'
  );
  assert.equal(
    baseShowName('Young Sheldon : Season 04 To Current'),
    'Young Sheldon'
  );
  assert.equal(
    baseShowName('The Big Bang Theory (2007)'),
    'The Big Bang Theory'
  );
  assert.equal(baseShowName('Friends [HD]'), 'Friends');
});

test('episodeTitle strips show+season stamps even when seriesTitle carries a year or season range', () => {
  assert.equal(
    episodeTitle(
      { id: '1', name: 'Episode 1. The Big Bang Theory: Season 1' },
      0,
      'The Big Bang Theory: Season 1 - 12'
    ),
    'Episode 1'
  );
  assert.equal(
    episodeTitle(
      { id: '2', name: 'Episode 2. The Big Bang Theory: Season 1' },
      1,
      'The Big Bang Theory (2007)'
    ),
    'Episode 2'
  );
  assert.equal(
    episodeTitle(
      { id: '3', name: 'The Big Bang Theory: Season 1', episode_num: 3 },
      2,
      'Big Bang Theory'
    ),
    'Episode 3'
  );
  // Real TMDB or portal episode titles are kept intact
  assert.equal(
    episodeTitle(
      { id: '1', name: 'Episode 1. Pilot' },
      0,
      'The Big Bang Theory'
    ),
    'Pilot'
  );
  assert.equal(
    episodeTitle(
      { id: '2', name: 'Episode 2. The Big Bran Hypothesis' },
      1,
      'The Big Bang Theory'
    ),
    'The Big Bran Hypothesis'
  );
  assert.equal(
    episodeTitle(
      { id: '24', name: 'Episode 24. Season Finale' },
      23,
      'The Big Bang Theory'
    ),
    'Season Finale'
  );
  // Prefers TMDB-enriched name when title still holds a placeholder
  assert.equal(
    episodeTitle(
      {
        id: '1',
        title: 'Episode 1. The Big Bang Theory: Season 1',
        name: 'Episode 1. Pilot',
      },
      0,
      'The Big Bang Theory'
    ),
    'Pilot'
  );
});
