import { useEffect, useRef } from 'react';

export type LogLevel = 'info' | 'ok' | 'warn' | 'error';
export interface LogEntry {
  ts: number;
  level: LogLevel;
  msg: string;
}

interface Props {
  entries: LogEntry[];
  tone: 'cool' | 'warm';
}

function fmt(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

export function StatusLog({ entries, tone }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className={`status-log status-log--${tone}`} ref={ref}>
      {entries.length === 0 ? (
        <div className="status-log__empty">— no activity yet —</div>
      ) : (
        entries.map((e, i) => (
          <div key={i} className={`status-log__row status-log__row--${e.level}`}>
            <span className="status-log__ts">{fmt(e.ts)}</span>
            <span className="status-log__level">[{e.level}]</span>
            <span className="status-log__msg">{e.msg}</span>
          </div>
        ))
      )}
    </div>
  );
}
