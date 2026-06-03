/*
Shared "is the user typing into a text field right now?" guard. Used
by every `window`-level keyboard listener (drawing tools, EditOverlay
shortcut keys, SvgCanvas clipboard, undo/redo) so that Enter/Escape/
Cmd+C/Cmd+Z inside a name input field doesn't leak through to the
tool that registered the listener.

This is both a UX guard (the user expects Enter in an input to confirm
the input, not commit a half-drawn polygon) and a security guard (a
keyboard listener that responds to typing inside an `<input>` is the
canonical bug that turns "paste something into the name field" into
"accidentally trigger a destructive shortcut").
*/

export function isTypingInFormField(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
