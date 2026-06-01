import { useMemo } from 'react';
import { digestHalves } from '../fhe/keyHelpers';

interface Props {
  value: string;
  tone: 'cool' | 'warm';
}

export function HashTrace({ value, tone }: Props) {
  const trace = useMemo(() => {
    if (!value) return null;
    return digestHalves(value);
  }, [value]);

  return (
    <div className={`hash-trace hash-trace--${tone}`}>
      <div className="hash-trace__caption">
        computed locally — only the encrypted form is submitted on-chain
      </div>
      <div className="hash-trace__row">
        <span className="hash-trace__label">key</span>
        <span className="hash-trace__value">
          {value ? `"${value}"` : '—'}
        </span>
      </div>
      <div className="hash-trace__row">
        <span className="hash-trace__label">keccak256</span>
        <span className="hash-trace__value mono">
          {trace ? trace.digest : '—'}
        </span>
      </div>
      <div className="hash-trace__row">
        <span className="hash-trace__label">hi (16B)</span>
        <span className="hash-trace__value mono">
          {trace ? trace.hiHex : '—'}
        </span>
      </div>
      <div className="hash-trace__row">
        <span className="hash-trace__label">lo (16B)</span>
        <span className="hash-trace__value mono">
          {trace ? trace.loHex : '—'}
        </span>
      </div>
    </div>
  );
}
