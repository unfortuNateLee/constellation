/**
 * attachMenu(trigger, getItems) — turn a button into a dropdown-menu trigger.
 *
 * `getItems` is an array, or a function returning an array (evaluated on each
 * open so item state can be dynamic), of:
 *   { label, onSelect, disabled?: bool | () => bool, danger?: bool }
 *   { separator: true }
 *
 * The popover is fixed-positioned just under the trigger (so it is never clipped
 * by an overflow:hidden ancestor) and closes on outside click, Escape, or a
 * selection. Idempotent per trigger.
 */
export function attachMenu(trigger, getItems) {
  if (!trigger || trigger._menuAttached) return;
  trigger._menuAttached = true;

  let popover = null;

  const close = () => {
    if (popover) {
      popover.remove();
      popover = null;
    }
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', close, true);
    trigger.setAttribute('aria-expanded', 'false');
  };

  const onDocDown = (e) => {
    if (popover && !popover.contains(e.target) && e.target !== trigger) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      close();
      trigger.focus();
    }
  };

  const open = () => {
    const items = typeof getItems === 'function' ? getItems() : getItems;
    popover = document.createElement('div');
    popover.className = 'menu-popover';
    popover.setAttribute('role', 'menu');

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'menu-separator';
        popover.appendChild(sep);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item' + (item.danger ? ' menu-item-danger' : '');
      b.textContent = item.label;
      const disabled = typeof item.disabled === 'function' ? item.disabled() : !!item.disabled;
      if (disabled) {
        b.disabled = true;
      } else {
        b.addEventListener('click', () => {
          close();
          item.onSelect?.();
        });
      }
      popover.appendChild(b);
    }

    document.body.appendChild(popover);

    // Position under the trigger, kept within the viewport. Flip above the
    // trigger when there isn't room below (e.g. trigger near the bottom edge).
    const r = trigger.getBoundingClientRect();
    const margin = 8;
    const h = popover.offsetHeight;
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - margin) {
      const above = r.top - 4 - h;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - margin - h);
    }
    popover.style.top = `${Math.round(top)}px`;
    const w = popover.offsetWidth;
    let left = r.left;
    if (left + w > window.innerWidth - margin)
      left = Math.max(margin, window.innerWidth - margin - w);
    popover.style.left = `${Math.round(left)}px`;

    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
  };

  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popover) close();
    else open();
  });
}
