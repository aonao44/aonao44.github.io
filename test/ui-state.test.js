import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearYearInputState,
  rollbackEraControls,
  setYearInputInvalid,
  setSheetContentHidden,
  syncEraControls,
} from '../src/ui-state.js';

function fakeInput() {
  const classes = new Set(['is-invalid']);
  const attributes = new Map([['aria-invalid', 'true']]);
  return {
    value: '117',
    classes,
    attributes,
    classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
    setAttribute(name, value) { attributes.set(name, value); },
  };
}

test('failed era navigation rolls slider and label back to the committed era', () => {
  const controls = { slider: { value: '27' }, year: { textContent: '1492年' } };
  const labelFor = (index) => `era-${index}`;
  syncEraControls(controls, 34, labelFor);
  assert.deepEqual([controls.slider.value, controls.year.textContent], ['34', 'era-34']);

  assert.equal(rollbackEraControls(controls, 27, labelFor), true);
  assert.deepEqual([controls.slider.value, controls.year.textContent], ['27', 'era-27']);
  assert.equal(rollbackEraControls(controls, -1, labelFor), false);
});

test('a closed sheet makes its hidden content inert and aria-hidden', () => {
  const attributes = new Map();
  const content = {
    toggleAttribute(name, enabled) {
      if (enabled) attributes.set(name, '');
      else attributes.delete(name);
    },
    setAttribute(name, value) { attributes.set(name, value); },
  };

  setSheetContentHidden(content, true);
  assert.equal(attributes.has('inert'), true);
  assert.equal(attributes.get('aria-hidden'), 'true');
  setSheetContentHidden(content, false);
  assert.equal(attributes.has('inert'), false);
  assert.equal(attributes.get('aria-hidden'), 'false');
});

test('year validation is exposed through aria-invalid and stale input can be cleared', () => {
  const input = fakeInput();
  const hint = { textContent: '→ 100年の断面を表示' };
  setYearInputInvalid(input, true);
  assert.equal(input.attributes.get('aria-invalid'), 'true');
  assert.equal(input.classes.has('is-invalid'), true);

  clearYearInputState(input, hint);
  assert.equal(input.value, '');
  assert.equal(hint.textContent, '');
  assert.equal(input.attributes.get('aria-invalid'), 'false');
  assert.equal(input.classes.has('is-invalid'), false);
});
