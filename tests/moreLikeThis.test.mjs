import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMoreLikeThisTiers,
  filterNewUniqueItems,
  inferGenresFromItems,
  parseGenres,
} from '../src/utils/moreLikeThis.ts';

test('parseGenres splits, trims, and deduplicates genre lists', () => {
  assert.deepEqual(parseGenres('Drama, Mystery, drama, Sci-Fi & Fantasy , '), [
    'Drama',
    'Mystery',
    'Sci-Fi & Fantasy',
  ]);
  assert.deepEqual(parseGenres(undefined), []);
});

test('inferGenresFromItems picks the most frequent genres across similar results', () => {
  const inferred = inferGenresFromItems([
    { genres_str: 'Drama, Mystery' },
    { genres_str: 'Mystery, Thriller' },
    { genres_str: 'Drama, Mystery, Crime' },
  ]);
  assert.deepEqual(inferred, ['Mystery', 'Drama']);
});

test('buildMoreLikeThisTiers prioritizes two-genre intersection before broader single genres', () => {
  assert.deepEqual(
    buildMoreLikeThisTiers('series', ['Drama', 'Mystery', 'Sci-Fi']),
    [
      { params: { type: 'series', genre: 'Drama,Mystery' } },
      { params: { type: 'series', genre: 'Drama' } },
      { params: { type: 'series', genre: 'Mystery' } },
      { params: { type: 'series', genre: 'Sci-Fi' } },
    ]
  );

  assert.deepEqual(buildMoreLikeThisTiers('movie', ['Comedy']), [
    { params: { type: 'movie', genre: 'Comedy' } },
  ]);

  assert.deepEqual(buildMoreLikeThisTiers('movie', []), [
    { params: { type: 'movie' } },
  ]);
});

test('filterNewUniqueItems skips the current title and previously seen items', () => {
  const seen = new Set(['series_10', 'series_20']);
  const fresh = filterNewUniqueItems(
    [
      { id: 'series_10' },
      { id: 'series_30' },
      { id: 'series_20' },
      { id: 'series_30' },
      { id: 'series_40' },
    ],
    seen
  );
  assert.deepEqual(
    fresh.map((x) => x.id),
    ['series_30', 'series_40']
  );
  assert.equal(seen.has('series_40'), true);
});
