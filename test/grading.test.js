'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gradeQuestion, gradeResponse } = require('../src/grading');
const { cleanQuestion, cleanAnswers } = require('../src/schema');

const radio = { id: 'q1', type: 'radio', points: 10, correct: ['b'], options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], config: {} };
const check = { id: 'q2', type: 'checkbox', points: 10, correct: ['a', 'c'], options: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], config: {} };
const short = { id: 'q3', type: 'short', points: 5, correct: ['Soekarno', 'Bung Karno'], options: [], config: {} };
const essay = { id: 'q4', type: 'paragraph', points: 20, correct: [], options: [], config: {} };

test('pilihan ganda: benar/salah', () => {
  assert.equal(gradeQuestion(radio, 'b').points, 10);
  assert.equal(gradeQuestion(radio, 'a').points, 0);
  assert.equal(gradeQuestion(radio, undefined).correct, false);
});

test('checkbox: harus tepat; sebagian bila diaktifkan', () => {
  assert.equal(gradeQuestion(check, ['c', 'a']).points, 10);
  assert.equal(gradeQuestion(check, ['a']).points, 0);
  assert.equal(gradeQuestion(check, ['a', 'b']).points, 0);
  const partial = { ...check, config: { partial: true } };
  assert.equal(gradeQuestion(partial, ['a']).points, 5);
  assert.equal(gradeQuestion(partial, ['a', 'b']).points, 0); // 1 benar - 1 salah
});

test('isian singkat: abaikan huruf besar dan spasi ganda', () => {
  assert.equal(gradeQuestion(short, '  soekarno ').points, 5);
  assert.equal(gradeQuestion(short, 'BUNG   KARNO').points, 5);
  assert.equal(gradeQuestion(short, 'Hatta').points, 0);
});

test('esai: nilai manual dibatasi poin maksimum dan menandai needsManual', () => {
  assert.equal(gradeQuestion(essay, 'x', 99).points, 20);
  const r = gradeResponse([radio, essay], { q1: 'b', q4: 'uraian' }, {});
  assert.equal(r.needsManual, true);
  assert.equal(r.max, 30);
  assert.equal(r.score, 10);
  const r2 = gradeResponse([radio, essay], { q1: 'b', q4: 'uraian' }, { q4: 15 });
  assert.equal(r2.needsManual, false);
  assert.equal(r2.score, 25);
});

test('soal tanpa kunci atau poin tidak dihitung', () => {
  const noKey = { ...radio, correct: [] };
  assert.equal(gradeResponse([noKey], { q1: 'a' }, {}).max, 0);
});

test('sanitasi pertanyaan: kunci hanya id opsi yang valid, radio hanya satu kunci', () => {
  const q = cleanQuestion({ type: 'radio', title: 'T', options: [{ id: 'x', text: 'X' }, { id: 'y', text: 'Y' }], correct: ['y', 'x', 'zzz'], points: 5 }, 0);
  assert.deepEqual(q.correct, ['y']);
  const c = cleanQuestion({ type: 'checkbox', options: [{ id: 'x', text: 'X' }, { id: 'y', text: 'Y' }], correct: ['y', 'x', 'zzz'] }, 1);
  assert.deepEqual(c.correct, ['y', 'x']);
});

test('sanitasi jawaban: buang id yang tidak dikenal dan nilai di luar skala', () => {
  const qs = [
    cleanQuestion({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', type: 'radio', options: [{ id: 'a', text: 'A' }] }, 0),
    cleanQuestion({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', type: 'scale', config: { min: 1, max: 5 } }, 1),
  ];
  const out = cleanAnswers(qs, { [qs[0].id]: 'hack', [qs[1].id]: '9', unknown: 'x' });
  assert.deepEqual(out, {});
  assert.deepEqual(cleanAnswers(qs, { [qs[0].id]: 'a', [qs[1].id]: 4 }), { [qs[0].id]: 'a', [qs[1].id]: '4' });
});
