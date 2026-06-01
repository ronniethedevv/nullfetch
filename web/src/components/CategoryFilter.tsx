import { CATEGORIES, type CategoryName } from '../abi';

interface Props {
  active: CategoryName | 'all';
  onChange: (cat: CategoryName | 'all') => void;
}

export function CategoryFilter({ active, onChange }: Props) {
  return (
    <div className="cat-filter" role="tablist" aria-label="Filter by category">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'all'}
        className={`cat-chip ${active === 'all' ? 'cat-chip--active' : ''}`}
        onClick={() => onChange('all')}
      >
        all
      </button>
      {CATEGORIES.map((c) => (
        <button
          type="button"
          role="tab"
          aria-selected={active === c}
          key={c}
          className={`cat-chip ${active === c ? 'cat-chip--active' : ''}`}
          onClick={() => onChange(c)}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
