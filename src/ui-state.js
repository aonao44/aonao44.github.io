/** スライダー値と表示年を同じ断面へ揃える。 */
export function syncEraControls(controls, index, labelFor) {
  controls.slider.value = String(index);
  controls.year.textContent = labelFor(index);
}

/** 最後に表示成功した断面へ操作UIを戻す。初回ロード前なら何もしない。 */
export function rollbackEraControls(controls, shownIndex, labelFor) {
  if (!Number.isInteger(shownIndex) || shownIndex < 0) return false;
  syncEraControls(controls, shownIndex, labelFor);
  return true;
}

/** 年入力の見た目と aria-invalid を常に同じ状態へ揃える。 */
export function setYearInputInvalid(input, invalid) {
  input.classList.toggle('is-invalid', invalid);
  input.setAttribute('aria-invalid', String(invalid));
}

/** スライダー等の別経路で移動するとき、古い年入力と結果表示を残さない。 */
export function clearYearInputState(input, hint) {
  input.value = '';
  hint.textContent = '';
  setYearInputInvalid(input, false);
}

/** 閉じたモバイルシートの中身を Tab 順とアクセシビリティツリーから外す。 */
export function setSheetContentHidden(content, hidden) {
  content.toggleAttribute('inert', hidden);
  content.setAttribute('aria-hidden', String(hidden));
}
