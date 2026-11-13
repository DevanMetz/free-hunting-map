import { SCOUT_ACTIVITY, SCOUT_ACTIVITY_QUEUE, SCOUT_GROUPS, SCOUT_SHARES, shareableIcon, type ScoutGroup } from '../scout/grid';
import { createParty, inviteUrl, joinParty, leaveParty } from '../scout/client';
import type { WaypointIcon } from '../types';
import type { AppContext } from './context';
import { copyText, h, iconButton, toast } from './dom';

export function openPartyPanel(ctx: AppContext): void {
  const name = h('input', { type: 'text', class: 'field', placeholder: 'Name', 'aria-label': 'Name', maxlength: 40 });
  const invite = h('input', { type: 'text', class: 'field', placeholder: 'Invite', 'aria-label': 'Invite', maxlength: 300 });
  const list = h('div', { class: 'party-list' });
  const activity = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Share activity' });
  let busy = false;

  const render = (groups: ScoutGroup[]): void => {
    list.replaceChildren(...groups.filter(group => !group.left).map(group => h(
      'div', { class: 'party-row' },
      h('span', { class: 'name' }, group.name),
      iconButton('copy', 'Copy invite', () => { void copyText(inviteUrl(group)); }),
      h('button', { type: 'button', class: 'btn', onclick: () => { void leave(group); } }, 'Leave'),
    )));
  };

  const load = async (): Promise<void> => {
    const [groups, on] = await Promise.all([
      ctx.repo.getMeta<ScoutGroup[]>(SCOUT_GROUPS),
      ctx.repo.getMeta<boolean>(SCOUT_ACTIVITY),
    ]);
    activity.checked = on === true;
    render(Array.isArray(groups) ? groups : []);
  };

  const leave = async (group: ScoutGroup): Promise<void> => {
    if (busy || !confirm(`Leave ${group.name}?`)) return;
    busy = true;
    try { await leaveParty(ctx.repo, group.id); await load(); }
    catch { toast('Could not leave party'); }
    finally { busy = false; }
  };

  activity.addEventListener('change', () => {
    const on = activity.checked;
    activity.disabled = true;
    void (async () => {
      await ctx.repo.setMeta(SCOUT_ACTIVITY, on);
      if (!on) await ctx.repo.setMeta(SCOUT_ACTIVITY_QUEUE, []);
      ctx.repo.notifyScout();
    })().catch(() => { activity.checked = !on; toast('Could not save'); }).finally(() => { activity.disabled = false; });
  });

  const body = h(
    'div', { class: 'form' },
    h('div', { class: 'row' }, name, h('button', { type: 'button', class: 'btn primary', onclick: () => {
      if (busy) return;
      busy = true;
      void createParty(ctx.repo, name.value).then(async ok => {
        if (!ok) { toast('Could not create party'); return; }
        name.value = '';
        await load();
      }).catch(() => toast('Could not create party')).finally(() => { busy = false; });
    } }, 'Create')),
    h('div', { class: 'row' }, invite, h('button', { type: 'button', class: 'btn', onclick: () => {
      if (busy) return;
      busy = true;
      void joinParty(ctx.repo, invite.value).then(async ok => {
        if (!ok) { toast('Could not join party'); return; }
        invite.value = '';
        await load();
      }).catch(() => toast('Could not join party')).finally(() => { busy = false; });
    } }, 'Join')),
    h('label', { class: 'toggle' }, activity, 'Share activity'),
    list,
  );
  ctx.sheet.open('party', 'Party', body);
  void load().catch(() => toast('Could not load parties'));
}

/** Per-item party checkboxes. The selection is read when the item is saved. */
export function partyShareControl(ctx: AppContext, itemId: string, icon: () => WaypointIcon): { element: HTMLElement; selected: () => string[]; refresh: () => void } {
  const element = h('div', { class: 'party-shares' });
  let chosen = new Set<string>();
  let known: ScoutGroup[] = [];
  const render = (): void => {
    element.replaceChildren();
    if (!shareableIcon(icon())) return;
    const active = known.filter(group => !group.left && !group.rejected);
    if (!active.length) {
      element.append(h('button', { type: 'button', class: 'btn', onclick: () => openPartyPanel(ctx) }, 'Party'));
      return;
    }
    for (const group of active) {
      const input = h('input', {
        type: 'checkbox',
        checked: chosen.has(group.id),
        'aria-label': group.name,
        onchange: () => { if (input.checked) chosen.add(group.id); else chosen.delete(group.id); },
      });
      element.append(h('label', { class: 'toggle' }, input, group.name));
    }
  };
  void Promise.all([
    ctx.repo.getMeta<ScoutGroup[]>(SCOUT_GROUPS),
    ctx.repo.getMeta<Record<string, string[]>>(SCOUT_SHARES),
  ]).then(([saved, links]) => {
    known = Array.isArray(saved) ? saved : [];
    chosen = new Set(links?.[itemId]?.filter(id => known.some(group => group.id === id && !group.left)) ?? []);
    render();
  }).catch(() => {});
  return { element, selected: () => shareableIcon(icon()) ? [...chosen] : [], refresh: render };
}
