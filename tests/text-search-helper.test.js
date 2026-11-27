// 日本語コメント: テキスト検索共通ヘルパーの単体テスト (tests/text-search-helper.test.js)

import test from 'node:test';
import assert from 'node:assert/strict';
import { findTextMatches, computeNextMatchIndex } from '../client/src/core/text-search-helper.js';

test('findTextMatches: 大文字小文字を区別せず全一致箇所のオフセットを返す', () => {
  const text = 'Table users {\n  id int [pk]\n  user_name varchar\n}\nTable USER_ROLES {}';
  const matches = findTextMatches(text, 'user');
  assert.equal(matches.length, 3);
  assert.equal(text.slice(matches[0].start, matches[0].end), 'user');
  assert.equal(text.slice(matches[1].start, matches[1].end), 'user');
  assert.equal(text.slice(matches[2].start, matches[2].end), 'USER');
});

test('findTextMatches: 空文字や未一致時は空配列を返す', () => {
  assert.deepEqual(findTextMatches('Table users {}', ''), []);
  assert.deepEqual(findTextMatches('', 'users'), []);
  assert.deepEqual(findTextMatches('Table users {}', 'orders'), []);
});

test('computeNextMatchIndex: 前へ(-1)/次へ(+1)で循環移動する', () => {
  assert.equal(computeNextMatchIndex(-1, 3, 1), 0);
  assert.equal(computeNextMatchIndex(-1, 3, -1), 2);
  assert.equal(computeNextMatchIndex(0, 3, 1), 1);
  assert.equal(computeNextMatchIndex(2, 3, 1), 0);
  assert.equal(computeNextMatchIndex(0, 3, -1), 2);
  assert.equal(computeNextMatchIndex(0, 0, 1), -1);
});
