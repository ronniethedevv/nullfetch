interface Props {
  state: 'idle' | 'pending' | 'true' | 'false';
}

const TEXT: Record<Props['state'], string> = {
  idle: 'awaiting verify',
  pending: 'computing…',
  true: 'true',
  false: 'false',
};

const SUB: Record<Props['state'], string> = {
  idle: 'submit an encrypted candidate',
  pending: 'tx → event → user-decrypt',
  true: 'ebool decrypted = 1',
  false: 'ebool decrypted = 0',
};

export function ResultTile({ state }: Props) {
  return (
    <div className={`result-tile result-tile--${state}`}>
      <div className="result-tile__main">{TEXT[state]}</div>
      <div className="result-tile__sub">{SUB[state]}</div>
    </div>
  );
}
