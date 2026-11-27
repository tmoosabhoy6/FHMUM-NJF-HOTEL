import { useEffect, useState, type ReactNode } from 'react';
import type { PullMeta } from '../../shared/types';
import { useAlerts } from '../lib/alerts';
import type { SaveStatus } from '../lib/shared';
import { ago } from '../lib/time';
import { Brand } from './ui';

/** The page frame every tab shares: the coloured rail with the name, the tabs, the status and the pull button. */
export function Shell({ tabs, status, actions, banner, children }: { tabs: ReactNode; status?: ReactNode; actions?: ReactNode; banner?: ReactNode; children: ReactNode }) {
  return (
    <div className="app">
      <header className="rail">
        <div className="rail-inner">
          <Brand />
          {tabs}
          <div className="rail-end">
            {status}
            {actions}
          </div>
        </div>
      </header>
      {banner}
      {children}
    </div>
  );
}

/** When the data was pulled, whether edits are saved, and the automatic check. */
export function PullStatus({ meta, saveStatus, loaded, sample = false }: { meta: PullMeta | undefined; saveStatus: SaveStatus; loaded: boolean; sample?: boolean }) {
  const { monitor } = useAlerts();
  const save = sample ? 'Sample only, not saved' : saveStatus === 'saving' ? 'Saving…' : saveStatus === 'offline' ? 'Not saved yet, retrying' : loaded ? 'Saved for everyone' : '';
  const check = monitor?.check;
  const email = monitor?.email;
  const trouble = Boolean(check && (!check.ok || (email && !email.ok)));
  return (
    <div className="status" role="status">
      <span className="status-line" data-state={sample ? 'sample' : saveStatus} title="Hotel pax, room requests and hotel choices are shared by every device">
        <i aria-hidden="true" />
        {meta ? `Pulled ${ago(meta.fetchedAt)}` : null}
        {meta && save ? ' · ' : null}
        {save}
      </span>
      {check && monitor ? (
        <span className="status-sub" data-trouble={trouble} title={`NKERP is checked automatically every ${monitor.every ?? 15} minutes`}>
          Auto-check {ago(check.at)}
          {check.ok ? '' : `: ${check.message}`}
          {' · '}
          {!monitor.emailOn ? 'email alerts not set up' : email && !email.ok ? `email failed (${email.message}), will retry` : 'email alerts on'}
        </span>
      ) : null}
    </div>
  );
}

export interface Section {
  id: string;
  label: string;
  count?: number;
}

/** The bar that stays at the top while you work: the page title, links to its sections, and the page's actions. */
export function PageBar({ title, sections = [], actions }: { title: string; sections?: Section[]; actions?: ReactNode }) {
  const [current, setCurrent] = useState(sections[0]?.id ?? '');
  const ids = sections.map((s) => s.id).join(' ');
  useEffect(() => {
    const list = ids ? ids.split(' ') : [];
    if (!list.length) return;
    const onScroll = () => {
      let active = list[0];
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 140) active = id;
      }
      setCurrent(active);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [ids]);
  return (
    <div className="pagebar">
      <div className="pagebar-inner">
        <h1>{title}</h1>
        {sections.length ? (
          <nav className="jump" aria-label="Sections of this page">
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} aria-current={current === s.id ? 'true' : undefined}>
                {s.label}
                {s.count !== undefined ? <span className="jump-n">{s.count}</span> : null}
              </a>
            ))}
          </nav>
        ) : null}
        {actions ? <div className="pagebar-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
