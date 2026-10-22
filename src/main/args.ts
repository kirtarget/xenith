// CLI → LaunchIntent (pure, unit-tested).
//   --xhome              stream the last used console (or the first one) on launch
//   --xhome=<serverId>   stream a specific console
//   --xcloud=<titleId>   launch an xCloud title (used by Steam shortcuts)
import type { LaunchIntent } from '../shared/api';

const ID = /^[A-Za-z0-9._-]{1,64}$/;
const clean = (s: string | undefined) => {
  const t = (s ?? '').trim().replace(/^["']|["']$/g, '');
  return ID.test(t) && t !== '.' && t !== '..' ? t : '';
};

export function parseLaunchArgs(argv: readonly string[]): LaunchIntent {
  for (const a of argv) {
    if (typeof a !== 'string') continue;
    let m = /^--xcloud(?:=(.*))?$/i.exec(a);
    if (m) {
      const id = clean(m[1]);
      return id ? { kind: 'cloud', targetId: id } : { kind: null, targetId: null };
    }
    m = /^--xhome(?:=(.*))?$/i.exec(a);
    if (m) return { kind: 'home', targetId: clean(m[1]) || null };
  }
  return { kind: null, targetId: null };
}
